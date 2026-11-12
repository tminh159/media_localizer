import type { SpindleAPI } from "lumiverse-spindle-types";
import type { LocalizedAssetEntry, QueueJobProgress } from "../shared/types.ts";
import {
  downloadAndStoreMedia,
  type UnmatchedGalleryCandidate,
} from "./downloader.ts";
import type { MediaIndexStore } from "./index-store.ts";

export interface QueuedMediaTask {
  characterId: string;
  characterName: string;
  normalizedUrl: string;
  rawUrls: string[];
  unmatchedGalleryCandidates?: UnmatchedGalleryCandidate[];
}

export interface EnqueueBatchOptions {
  userId: string;
  tasks: QueuedMediaTask[];
  maxItems: number;
  maxFileSizeBytes: number;
  timeoutMs: number;
  concurrency: number;
}

type TaskOutcome = "ok" | "failed" | "aborted";

interface ActiveTaskControl {
  id: string;
  url: string;
  characterId: string;
  characterName: string;
  startedAt: number;
  controller: AbortController;
  skipped: boolean;
}

function createIdleProgress(): QueueJobProgress {
  return {
    status: "idle",
    jobId: null,
    totalQueued: 0,
    completedCount: 0,
    succeededCount: 0,
    skippedCount: 0,
    failedCount: 0,
    activeUrls: [],
    recentErrors: [],
    cappedByLimit: false,
    skippedByCapCount: 0,
  };
}

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const MIN_FILE_SIZE_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 5_000;

export class UserDownloadQueue {
  private progress: QueueJobProgress = createIdleProgress();
  private pendingTasks: QueuedMediaTask[] = [];
  private activeControls = new Map<string, ActiveTaskControl>();
  private activeTaskCount = 0;
  private pauseGate: Promise<void> | null = null;
  private resumeResolver: (() => void) | null = null;
  private cancelRequested = false;
  private currentOptions: {
    maxFileSizeBytes: number;
    timeoutMs: number;
    concurrency: number;
  } = {
    maxFileSizeBytes: 25 * 1024 * 1024,
    timeoutMs: 20_000,
    concurrency: 2,
  };
  private seq = 0;
  /** Bumped for every new job so stale workers from a cancelled job cannot touch the new one. */
  private generation = 0;
  private runPromise: Promise<void> | null = null;
  private enqueueLock: Promise<void> = Promise.resolve();
  private readonly inFlight = new Map<string, Promise<TaskOutcome>>();

  constructor(
    private readonly userId: string,
    private readonly spindle: SpindleAPI,
    private readonly indexStore: MediaIndexStore,
    private readonly onUpdate: (
      userId: string,
      progress: QueueJobProgress,
      newAsset?: LocalizedAssetEntry,
    ) => void,
  ) {}

  getProgress(): QueueJobProgress {
    return {
      ...this.progress,
      activeUrls: Array.from(this.activeControls.values()).map((a) => ({
        url: a.url,
        characterId: a.characterId,
        characterName: a.characterName,
        startedAt: a.startedAt,
      })),
      recentErrors: [...this.progress.recentErrors],
    };
  }

  private emit(newAsset?: LocalizedAssetEntry): void {
    this.onUpdate(this.userId, this.getProgress(), newAsset);
  }

  private async withEnqueueLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.enqueueLock;
    let release!: () => void;
    this.enqueueLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async startOrAppendBatch(options: EnqueueBatchOptions): Promise<QueueJobProgress> {
    return this.withEnqueueLock(async () => {
      // Any draining/previous job must fully exit before a new job starts, even if
      // cancelAll() already transitioned status or workers are still unwinding.
      while (
        this.runPromise &&
        this.progress.status !== "running" &&
        this.progress.status !== "paused"
      ) {
        await this.runPromise.catch(() => {});
      }

      const maxItems =
        typeof options.maxItems === "number" &&
        Number.isFinite(options.maxItems) &&
        options.maxItems > 0
          ? Math.floor(options.maxItems)
          : 0;

      // Drop duplicate (character, url) pairs within the batch
      const seenKeys = new Set<string>();
      let incoming = options.tasks.filter((t) => {
        const key = `${t.characterId}|${t.normalizedUrl}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      let cappedByLimit = false;
      let skippedByCapCount = 0;

      const isAlreadyActive =
        this.progress.status === "running" || this.progress.status === "paused";

      if (isAlreadyActive) {
        // Skip pairs that are already pending or currently downloading
        const pendingKeys = new Set(
          this.pendingTasks.map((t) => `${t.characterId}|${t.normalizedUrl}`),
        );
        for (const a of this.activeControls.values()) {
          pendingKeys.add(`${a.characterId}|${a.url}`);
        }
        incoming = incoming.filter(
          (t) => !pendingKeys.has(`${t.characterId}|${t.normalizedUrl}`),
        );
      }

      if (maxItems > 0 && incoming.length > maxItems) {
        cappedByLimit = true;
        skippedByCapCount = incoming.length - maxItems;
        incoming = incoming.slice(0, maxItems);
      }

      const rawMaxBytes =
        typeof options.maxFileSizeBytes === "number" &&
        Number.isFinite(options.maxFileSizeBytes) &&
        options.maxFileSizeBytes > 0
          ? options.maxFileSizeBytes
          : 25 * 1024 * 1024;
      const rawTimeoutMs =
        typeof options.timeoutMs === "number" &&
        Number.isFinite(options.timeoutMs) &&
        options.timeoutMs > 0
          ? options.timeoutMs
          : 20_000;
      const rawConcurrency =
        typeof options.concurrency === "number" &&
        Number.isFinite(options.concurrency) &&
        options.concurrency > 0
          ? Math.floor(options.concurrency)
          : 2;

      this.currentOptions = {
        maxFileSizeBytes: Math.min(
          MAX_FILE_SIZE_BYTES,
          Math.max(MIN_FILE_SIZE_BYTES, rawMaxBytes),
        ),
        timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, rawTimeoutMs)),
        concurrency: Math.min(5, Math.max(1, rawConcurrency)),
      };

      if (!isAlreadyActive) {
        this.cancelRequested = false;
        this.pauseGate = null;
        this.resumeResolver = null;
        this.pendingTasks = [...incoming];
        this.inFlight.clear();
        const gen = ++this.generation;
        this.progress = {
          status: incoming.length > 0 ? "running" : "completed",
          jobId: `job_${Date.now()}_${++this.seq}`,
          totalQueued: incoming.length,
          completedCount: 0,
          succeededCount: 0,
          skippedCount: 0,
          failedCount: 0,
          activeUrls: [],
          recentErrors: [],
          cappedByLimit,
          skippedByCapCount,
        };
        this.emit();
        if (incoming.length > 0) {
          const run = this.runWorkers(this.currentOptions.concurrency, gen).finally(
            () => {
              if (this.runPromise === run) {
                this.runPromise = null;
              }
            },
          );
          this.runPromise = run;
          void run;
        }
      } else {
        this.pendingTasks.push(...incoming);
        this.progress.totalQueued += incoming.length;
        if (cappedByLimit) {
          this.progress.cappedByLimit = true;
          this.progress.skippedByCapCount += skippedByCapCount;
        }
        this.emit();
      }

      return this.getProgress();
    });
  }

  pause(): QueueJobProgress {
    if (this.progress.status !== "running") return this.getProgress();
    this.progress.status = "paused";
    this.pauseGate = new Promise<void>((resolve) => {
      this.resumeResolver = resolve;
    });
    this.emit();
    return this.getProgress();
  }

  resume(): QueueJobProgress {
    if (this.progress.status !== "paused") return this.getProgress();
    this.progress.status = "running";
    const resolve = this.resumeResolver;
    this.pauseGate = null;
    this.resumeResolver = null;
    resolve?.();
    this.emit();
    return this.getProgress();
  }

  skipCurrent(targetUrl?: string): QueueJobProgress {
    const controls = Array.from(this.activeControls.values());
    if (controls.length === 0) return this.getProgress();

    const target = targetUrl
      ? controls.find((c) => c.url === targetUrl) ?? controls[0]
      : controls.sort((a, b) => a.startedAt - b.startedAt)[0];

    if (target) {
      for (const ctrl of controls) {
        if (ctrl.url === target.url) {
          ctrl.skipped = true;
          ctrl.controller.abort(new DOMException("Skipped by user", "AbortError"));
        }
      }

      // Drop remaining pending tasks for the same skipped URL in this batch so
      // shared-URL characters don't re-trigger the skipped download.
      if (this.pendingTasks.length > 0) {
        let skippedPending = 0;
        const remaining: QueuedMediaTask[] = [];
        for (const t of this.pendingTasks) {
          if (t.normalizedUrl === target.url) {
            skippedPending++;
          } else {
            remaining.push(t);
          }
        }
        if (skippedPending > 0) {
          this.pendingTasks = remaining;
          this.progress.skippedCount += skippedPending;
          this.progress.completedCount += skippedPending;
        }
      }
    }
    this.emit();
    return this.getProgress();
  }

  cancelAll(): QueueJobProgress {
    if (
      this.progress.status !== "running" &&
      this.progress.status !== "paused"
    ) {
      return this.getProgress();
    }

    this.cancelRequested = true;
    const droppedCount = this.pendingTasks.length;
    this.pendingTasks = [];
    this.progress.skippedCount += droppedCount;
    this.progress.completedCount += droppedCount;
    this.progress.status = "cancelling";

    // Unblock paused workers so they can exit immediately
    const resolve = this.resumeResolver;
    this.pauseGate = null;
    this.resumeResolver = null;
    resolve?.();

    for (const active of this.activeControls.values()) {
      active.skipped = true;
      active.controller.abort(new DOMException("Cancelled by user", "AbortError"));
    }

    // Only mark fully "cancelled" synchronously if no workers are currently inside a task
    // (including pre-download getState/images.get awaits).
    if (this.activeTaskCount === 0 && this.activeControls.size === 0) {
      this.progress.status = "cancelled";
    }
    this.emit();
    return this.getProgress();
  }

  private async runWorkers(concurrency: number, gen: number): Promise<void> {
    while (!this.cancelRequested && gen === this.generation) {
      if (this.pauseGate) {
        await this.pauseGate;
      }
      if (this.cancelRequested || gen !== this.generation) break;
      if (this.pendingTasks.length === 0) break;

      const workers: Promise<void>[] = [];
      for (let i = 0; i < concurrency; i++) {
        workers.push(this.workerLoop(gen));
      }
      await Promise.allSettled(workers);
    }

    // A newer job owns the progress state now; never overwrite it.
    if (gen !== this.generation) return;

    const alreadyCancelled = this.progress.status === "cancelled";
    this.progress.status = this.cancelRequested ? "cancelled" : "completed";
    if (!alreadyCancelled) {
      this.emit();
    }
  }

  private async workerLoop(gen: number): Promise<void> {
    while (!this.cancelRequested && gen === this.generation) {
      if (this.pauseGate) {
        await this.pauseGate;
      }
      if (this.cancelRequested || gen !== this.generation) break;

      const task = this.pendingTasks.shift();
      if (!task) break;

      await this.processSingleTask(task, gen);
    }
  }

  /**
   * Serializes work per URL: if another worker is already downloading the same URL
   * (e.g. a shared banner used by several characters), wait for it and then either
   * link this character to the resulting asset or mirror the skip/failure outcome.
   */
  private async processSingleTask(
    task: QueuedMediaTask,
    gen: number,
  ): Promise<void> {
    this.activeTaskCount++;
    try {
      const key = task.normalizedUrl;

      while (true) {
        if (gen !== this.generation) return;
        if (this.cancelRequested) {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
          return;
        }

        const prior = this.inFlight.get(key);
        if (!prior) break;

        const outcome = await prior.catch((): TaskOutcome => "failed");
        if (gen !== this.generation) return;

        if (this.cancelRequested || outcome === "aborted") {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
          return;
        }

        if (outcome === "failed") {
          // Same URL just failed for another character; don't hammer the host again.
          let failureError = "Download failed";
          try {
            const state = await this.indexStore.getState(this.userId);
            if (gen !== this.generation) return;
            const failure = Object.hasOwn(state.failedUrls, key)
              ? state.failedUrls[key]
              : undefined;
            if (failure?.error) failureError = failure.error;
          } catch {
            // ignore lookup error
          }
          if (gen !== this.generation) return;
          if (this.cancelRequested) {
            this.progress.completedCount++;
            this.progress.skippedCount++;
            this.emit();
            return;
          }
          this.progress.completedCount++;
          this.progress.failedCount++;
          this.progress.recentErrors.unshift({
            url: key,
            characterName: task.characterName,
            error: failureError,
          });
          if (this.progress.recentErrors.length > 25) {
            this.progress.recentErrors.length = 25;
          }
          this.emit();
          return;
        }
        // outcome === "ok": loop back to re-check inFlight before calling runTask
        // so multiple woken waiters still serialize cleanly.
      }

      if (gen !== this.generation) return;
      if (this.cancelRequested) {
        this.progress.completedCount++;
        this.progress.skippedCount++;
        this.emit();
        return;
      }

      const run = this.runTask(task, gen).finally(() => {
        if (this.inFlight.get(key) === run) {
          this.inFlight.delete(key);
        }
      });
      this.inFlight.set(key, run);
      await run;
    } finally {
      this.activeTaskCount--;
    }
  }

  private async runTask(
    task: QueuedMediaTask,
    gen: number,
  ): Promise<TaskOutcome> {
    const checkAbortedOrStale = (): TaskOutcome | null => {
      if (gen !== this.generation) return "aborted";
      if (this.cancelRequested) {
        this.progress.completedCount++;
        this.progress.skippedCount++;
        this.emit();
        return "aborted";
      }
      return null;
    };

    const preStateAborted = checkAbortedOrStale();
    if (preStateAborted) return preStateAborted;

    // 1. Check if this URL is already localized in our index (and image still exists)
    const state = await this.indexStore.getState(this.userId);
    const postStateAborted = checkAbortedOrStale();
    if (postStateAborted) return postStateAborted;

    const existing = Object.hasOwn(state.assets, task.normalizedUrl)
      ? state.assets[task.normalizedUrl]
      : undefined;
    if (existing) {
      try {
        const img = await this.spindle.images.get(
          existing.imageId,
          this.userId,
        );
        const postGetAborted = checkAbortedOrStale();
        if (postGetAborted) return postGetAborted;

        if (img) {
          const linked = await this.indexStore.linkExistingAssetToCharacter(
            this.userId,
            task.normalizedUrl,
            task.rawUrls,
            task.characterId,
          );
          const postLinkAborted = checkAbortedOrStale();
          if (postLinkAborted) return postLinkAborted;

          this.progress.completedCount++;
          this.progress.succeededCount++;
          this.emit(linked ?? existing);
          return "ok";
        }
      } catch {
        const errAborted = checkAbortedOrStale();
        if (errAborted) return errAborted;
        // Proceed to download if image lookup fails
      }
    }

    const preControlAborted = checkAbortedOrStale();
    if (preControlAborted) return preControlAborted;

    // 2. Download & store with AbortController
    const controlId = `ctrl_${Date.now()}_${++this.seq}`;
    const controller = new AbortController();
    const control: ActiveTaskControl = {
      id: controlId,
      url: task.normalizedUrl,
      characterId: task.characterId,
      characterName: task.characterName,
      startedAt: Date.now(),
      controller,
      skipped: false,
    };

    this.activeControls.set(controlId, control);
    if (this.cancelRequested || gen !== this.generation) {
      this.activeControls.delete(controlId);
      return checkAbortedOrStale() ?? "aborted";
    }
    this.emit();

    try {
      const entry = await downloadAndStoreMedia(this.spindle, {
        userId: this.userId,
        characterId: task.characterId,
        normalizedUrl: task.normalizedUrl,
        rawUrls: task.rawUrls,
        maxBytes: this.currentOptions.maxFileSizeBytes,
        timeoutMs: this.currentOptions.timeoutMs,
        signal: controller.signal,
        unmatchedGalleryCandidates: task.unmatchedGalleryCandidates,
      });

      if (gen !== this.generation || this.cancelRequested || control.skipped) {
        if (
          !entry.galleryItemIds &&
          typeof this.spindle.images?.deleteMany === "function"
        ) {
          try {
            await this.spindle.images.deleteMany([entry.imageId], {
              userId: this.userId,
            });
          } catch {
            // ignore cleanup failure
          }
        }
        this.activeControls.delete(controlId);
        if (gen === this.generation) {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
        }
        return "aborted";
      }

      const saved = await this.indexStore.recordLocalizedAsset(this.userId, entry);
      // A parallel path registered this URL first: discard our duplicate upload (never an
      // adopted Gallery image, which would have the same id as `saved`).
      if (
        saved.imageId !== entry.imageId &&
        !entry.galleryItemIds &&
        typeof this.spindle.images?.deleteMany === "function"
      ) {
        try {
          await this.spindle.images.deleteMany([entry.imageId], {
            userId: this.userId,
          });
        } catch {
          // ignore cleanup failure
        }
      }

      this.activeControls.delete(controlId);
      if (gen !== this.generation) return "aborted";

      this.progress.completedCount++;
      this.progress.succeededCount++;
      this.emit(saved);
      return "ok";
    } catch (err) {
      this.activeControls.delete(controlId);
      if (gen !== this.generation) return "aborted";

      this.progress.completedCount++;

      const isAborted =
        control.skipped ||
        this.cancelRequested ||
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError") ||
        (err instanceof Error && /AbortError|cancelled|Skipped/i.test(err.message));

      if (isAborted) {
        this.progress.skippedCount++;
        this.emit();
        return "aborted";
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.progress.failedCount++;
      this.progress.recentErrors.unshift({
        url: task.normalizedUrl,
        characterName: task.characterName,
        error: errorMessage,
      });
      if (this.progress.recentErrors.length > 25) {
        this.progress.recentErrors.length = 25;
      }

      try {
        await this.indexStore.recordFailure(
          this.userId,
          task.normalizedUrl,
          errorMessage,
        );
      } catch {
        // Ignore persistence error when recording failure
      }
      if (gen !== this.generation) return "aborted";
      this.emit();
      return "failed";
    } finally {
      this.activeControls.delete(controlId);
    }
  }
}

export class MediaQueueManager {
  private readonly queues = new Map<string, UserDownloadQueue>();

  constructor(
    private readonly spindle: SpindleAPI,
    private readonly indexStore: MediaIndexStore,
    private readonly onUpdate: (
      userId: string,
      progress: QueueJobProgress,
      newAsset?: LocalizedAssetEntry,
    ) => void,
  ) {}

  getQueue(userId: string): UserDownloadQueue {
    let q = this.queues.get(userId);
    if (!q) {
      q = new UserDownloadQueue(
        userId,
        this.spindle,
        this.indexStore,
        this.onUpdate,
      );
      this.queues.set(userId, q);
    }
    return q;
  }

  cancelAllUsers(): void {
    for (const q of this.queues.values()) {
      q.cancelAll();
    }
  }
}
