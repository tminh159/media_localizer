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

type TaskOutcome =
  | "ok"
  | "failed"
  | "aborted"
  | "aborted_character"
  | "aborted_url";

interface ActiveTaskControl {
  id: string;
  url: string;
  characterId: string;
  characterName: string;
  startedAt: number;
  controller: AbortController;
  skipped: boolean;
  abortScope?: "character" | "url" | "all";
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
  private readonly cancelledCharacterUrls = new Map<string, Set<string> | null>();
  private readonly activeWorkerLoops = new Set<Promise<void>>();

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
        this.cancelledCharacterUrls.clear();
        this.activeWorkerLoops.clear();
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
          const run = this.runWorkers(gen).finally(
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
        for (const t of incoming) {
          const cancelled = this.cancelledCharacterUrls.get(t.characterId);
          if (cancelled === null) {
            this.cancelledCharacterUrls.delete(t.characterId);
          } else if (cancelled) {
            cancelled.delete(t.normalizedUrl);
            if (cancelled.size === 0) {
              this.cancelledCharacterUrls.delete(t.characterId);
            }
          }
        }
        this.pendingTasks.push(...incoming);
        this.progress.totalQueued += incoming.length;
        if (cappedByLimit) {
          this.progress.cappedByLimit = true;
          this.progress.skippedByCapCount += skippedByCapCount;
        }
        this.emit();
        this.spawnWorkerLoops(this.currentOptions.concurrency, this.generation);
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
    this.spawnWorkerLoops(this.currentOptions.concurrency, this.generation);
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
          ctrl.abortScope = "url";
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

  private isTaskCancelledForCharacter(
    characterId: string,
    normalizedUrl: string,
  ): boolean {
    const entry = this.cancelledCharacterUrls.get(characterId);
    if (entry === undefined) return false;
    return entry === null || entry.has(normalizedUrl);
  }

  /**
   * Cancels pending and active download tasks for a character (optionally restricted
   * to specific normalized URLs) without cancelling other characters in the batch.
   */
  cancelCharacterTasks(characterId: string, onlyUrls?: string[]): number {
    if (!characterId) return 0;
    const isActive =
      this.progress.status === "running" ||
      this.progress.status === "paused" ||
      this.progress.status === "cancelling";
    if (!isActive) return 0;

    const urlSet =
      onlyUrls && onlyUrls.length > 0 ? new Set(onlyUrls) : null;

    if (!urlSet) {
      this.cancelledCharacterUrls.set(characterId, null);
    } else {
      const existing = this.cancelledCharacterUrls.get(characterId);
      if (existing !== null) {
        const next = existing ?? new Set<string>();
        for (const u of urlSet) next.add(u);
        this.cancelledCharacterUrls.set(characterId, next);
      }
    }

    let affected = 0;
    if (this.pendingTasks.length > 0) {
      const remaining: QueuedMediaTask[] = [];
      let droppedPending = 0;
      for (const t of this.pendingTasks) {
        if (
          t.characterId === characterId &&
          (!urlSet || urlSet.has(t.normalizedUrl))
        ) {
          droppedPending++;
        } else {
          remaining.push(t);
        }
      }
      if (droppedPending > 0) {
        this.pendingTasks = remaining;
        this.progress.skippedCount += droppedPending;
        this.progress.completedCount += droppedPending;
        affected += droppedPending;
      }
    }

    for (const active of this.activeControls.values()) {
      if (
        active.characterId === characterId &&
        (!urlSet || urlSet.has(active.url))
      ) {
        if (!active.skipped) {
          active.skipped = true;
          active.abortScope = "character";
          active.controller.abort(
            new DOMException("Cancelled by character purge", "AbortError"),
          );
          affected++;
        }
      }
    }

    if (affected > 0) {
      this.emit();
    }
    return affected;
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
      active.abortScope = "all";
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

  private spawnWorkerLoops(targetCount: number, gen: number): void {
    if (this.cancelRequested || gen !== this.generation) return;
    const maxAllowed = Math.min(
      targetCount,
      this.activeWorkerLoops.size + this.pendingTasks.length,
    );
    while (
      this.activeWorkerLoops.size < maxAllowed &&
      this.pendingTasks.length > 0 &&
      !this.cancelRequested &&
      gen === this.generation
    ) {
      const loopPromise = this.workerLoop(gen).finally(() => {
        this.activeWorkerLoops.delete(loopPromise);
      });
      this.activeWorkerLoops.add(loopPromise);
    }
  }

  private async runWorkers(gen: number): Promise<void> {
    while (!this.cancelRequested && gen === this.generation) {
      if (this.pauseGate) {
        await this.pauseGate;
      }
      if (this.cancelRequested || gen !== this.generation) break;
      if (this.pendingTasks.length === 0 && this.activeWorkerLoops.size === 0) {
        break;
      }

      this.spawnWorkerLoops(this.currentOptions.concurrency, gen);
      if (this.activeWorkerLoops.size === 0) break;

      await Promise.allSettled(Array.from(this.activeWorkerLoops));
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
        if (
          this.cancelRequested ||
          this.isTaskCancelledForCharacter(task.characterId, key)
        ) {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
          return;
        }

        const prior = this.inFlight.get(key);
        if (!prior) break;

        const outcome = await prior.catch((): TaskOutcome => "failed");
        if (gen !== this.generation) return;

        if (
          this.cancelRequested ||
          outcome === "aborted" ||
          outcome === "aborted_url" ||
          this.isTaskCancelledForCharacter(task.characterId, key)
        ) {
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
          if (
            this.cancelRequested ||
            this.isTaskCancelledForCharacter(task.characterId, key)
          ) {
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
      if (
        this.cancelRequested ||
        this.isTaskCancelledForCharacter(task.characterId, key)
      ) {
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
      if (this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)) {
        this.progress.completedCount++;
        this.progress.skippedCount++;
        this.emit();
        return "aborted_character";
      }
      return null;
    };

    let controlId: string | null = null;
    let control: ActiveTaskControl | null = null;

    try {
      const preStateAborted = checkAbortedOrStale();
      if (preStateAborted) return preStateAborted;

      // 1. Check if this URL is already localized in our index (and image still exists)
      const state = await this.indexStore.getState(this.userId);
      const postStateAborted = checkAbortedOrStale();
      if (postStateAborted) return postStateAborted;

      const existing = Object.hasOwn(state.assets, task.normalizedUrl)
        ? state.assets[task.normalizedUrl]
        : undefined;
      let deadImageId: string | undefined;
      if (existing) {
        let existingImg: unknown = null;
        try {
          existingImg = await this.spindle.images.get(
            existing.imageId,
            this.userId,
          );
        } catch {
          // Treat unreadable image lookup as missing so a replacement can be downloaded
          existingImg = null;
        }
        const postGetAborted = checkAbortedOrStale();
        if (postGetAborted) return postGetAborted;

        if (existingImg) {
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
        deadImageId = existing.imageId;
      }

      const preControlAborted = checkAbortedOrStale();
      if (preControlAborted) return preControlAborted;

      // 2. Download & store with AbortController
      controlId = `ctrl_${Date.now()}_${++this.seq}`;
      const controller = new AbortController();
      control = {
        id: controlId,
        url: task.normalizedUrl,
        characterId: task.characterId,
        characterName: task.characterName,
        startedAt: Date.now(),
        controller,
        skipped: false,
      };

      this.activeControls.set(controlId, control);
      if (
        this.cancelRequested ||
        gen !== this.generation ||
        this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)
      ) {
        this.activeControls.delete(controlId);
        controlId = null;
        return checkAbortedOrStale() ?? "aborted";
      }
      this.emit();

      const downloadResult = await downloadAndStoreMedia(this.spindle, {
        userId: this.userId,
        characterId: task.characterId,
        normalizedUrl: task.normalizedUrl,
        rawUrls: task.rawUrls,
        maxBytes: this.currentOptions.maxFileSizeBytes,
        timeoutMs: this.currentOptions.timeoutMs,
        signal: controller.signal,
        unmatchedGalleryCandidates: task.unmatchedGalleryCandidates,
      });
      const { reusedExistingImage, ...entry } = downloadResult;

      if (
        gen !== this.generation ||
        this.cancelRequested ||
        control.skipped ||
        this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)
      ) {
        if (
          !reusedExistingImage &&
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
        const scope = control.abortScope;
        this.activeControls.delete(controlId);
        controlId = null;
        if (gen !== this.generation) {
          return "aborted";
        }
        this.progress.completedCount++;
        this.progress.skippedCount++;
        this.emit();
        if (this.cancelRequested || scope === "all") return "aborted";
        if (scope === "url") return "aborted_url";
        if (
          scope === "character" ||
          this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)
        ) {
          return "aborted_character";
        }
        return "aborted";
      }

      const saved = await this.indexStore.recordLocalizedAsset(
        this.userId,
        entry,
        deadImageId ? { replaceIfImageId: deadImageId } : undefined,
      );
      // A parallel path registered this URL first: discard our duplicate upload (never a
      // pre-existing or adopted Gallery image).
      if (
        saved.imageId !== entry.imageId &&
        !reusedExistingImage &&
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
      controlId = null;
      if (gen !== this.generation) return "aborted";

      this.progress.completedCount++;
      this.progress.succeededCount++;
      this.emit(saved);
      return "ok";
    } catch (err) {
      if (controlId) {
        this.activeControls.delete(controlId);
        controlId = null;
      }
      if (gen !== this.generation) return "aborted";

      this.progress.completedCount++;

      const isAborted =
        Boolean(control?.skipped) ||
        this.cancelRequested ||
        Boolean(control?.controller.signal.aborted) ||
        this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl) ||
        (err instanceof Error && err.name === "AbortError") ||
        (err instanceof Error && /AbortError|cancelled|Skipped/i.test(err.message));

      if (isAborted) {
        this.progress.skippedCount++;
        this.emit();
        const scope = control?.abortScope;
        if (this.cancelRequested || scope === "all") return "aborted";
        if (scope === "url") return "aborted_url";
        if (
          scope === "character" ||
          this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)
        ) {
          return "aborted_character";
        }
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
      if (controlId) {
        this.activeControls.delete(controlId);
      }
    }
  }
}

const MAX_QUEUED_USERS = 500;

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
    if (q) {
      this.queues.delete(userId);
      this.queues.set(userId, q);
      return q;
    }
    q = new UserDownloadQueue(
      userId,
      this.spindle,
      this.indexStore,
      this.onUpdate,
    );
    this.queues.set(userId, q);
    if (this.queues.size > MAX_QUEUED_USERS) {
      for (const [uid, candidate] of this.queues.entries()) {
        if (this.queues.size <= MAX_QUEUED_USERS) break;
        if (uid === userId) continue;
        const st = candidate.getProgress().status;
        if (st === "idle" || st === "completed" || st === "cancelled") {
          this.queues.delete(uid);
        }
      }
    }
    return q;
  }

  cancelAllUsers(): void {
    for (const q of this.queues.values()) {
      q.cancelAll();
    }
  }
}
