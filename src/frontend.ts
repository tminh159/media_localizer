import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { buildEffectiveFilter } from "./shared/download-config.ts";
import {
  DEFAULT_SETTINGS,
  type ActiveDisplayUrlMapPayload,
  type CharacterDownloadOverride,
  type CharacterMediaScanResult,
  type DownloadFilterOptions,
  type LibraryCharacterSummary,
  type LibraryMediaCharacter,
  type LocalizedAssetEntry,
  type MediaLocalizerSettings,
  type PendingGalleryLinkItem,
  type QueueJobProgress,
  type StorageStatsSummary,
} from "./shared/types.ts";
import { filterScanItemsForDownload } from "./shared/url-scanner.ts";
import { NonDestructiveDisplaySwapper } from "./ui/display-swapper.ts";
import {
  MediaLocalizerDrawerPanel,
  type DrawerPanelCallbacks,
} from "./ui/drawer-panel.ts";
import { NativeGalleryTabIntegrator } from "./ui/gallery-integrator.ts";
import { PortraitPanelLocalizeController } from "./ui/portrait-button.ts";
import { MEDIA_LOCALIZER_STYLES } from "./ui/styles.ts";
import { cleanupUiHelpers, isQueueActiveStatus } from "./ui/ui-helpers.ts";

const REQUIRED_PERMISSIONS = [
  "characters",
  "chats",
  "world_books",
  "regex_scripts",
  "images",
  "cors_proxy",
  "ui_panels",
] as const;

interface NativeGalleryApiItem {
  id: string;
  character_id: string;
  image_id: string;
  caption?: string;
}

function isGalleryFetchCallbackSrc(src: string): boolean {
  if (src.includes("isGalleryItemRemoved")) {
    return !src.includes("setShowGalleryPicker") && !src.includes("(!0)");
  }
  return (
    src.includes(".list(") &&
    src.includes(".image_id") &&
    src.includes(".filter(") &&
    !src.includes("(!0)") &&
    !src.includes("(true)")
  );
}

function isGalleryFetchEffectSrc(src: string): boolean {
  if (src.includes("isGalleryItemRemoved")) {
    return !src.includes("onGalleryItemRemoved") && !src.includes(".finally(");
  }
  return (
    src.includes(".list(") &&
    src.includes(".image_id") &&
    src.includes(".filter(") &&
    !src.includes("onGalleryItemRemoved") &&
    !src.includes(".finally(")
  );
}

function invokeHookSafely(fn: () => unknown): unknown {
  try {
    const res = fn();
    if (res && typeof (res as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(res).catch((err) => {
        console.warn("[media_localizer] Native gallery refresh hook rejected:", err);
      });
    }
    return res;
  } catch (err) {
    console.warn("[media_localizer] Native gallery refresh hook failed:", err);
    return undefined;
  }
}

/**
 * Triggers a live state refresh on the open Character Editor Gallery tab (`CharacterEditorPage`)
 * and chat Portrait Panel (`PortraitPanel`) by invoking their React gallery-fetch hooks in place.
 *
 * Retained as a hardened bridge because `SpindleFrontendContext` in `lumiverse-spindle-types`
 * does not yet expose a native Gallery/PortraitPanel refresh API.
 */
export function triggerNativeGalleryAndPortraitReactRefresh(): void {
  if (
    typeof document === "undefined" ||
    typeof document.querySelectorAll !== "function"
  ) {
    return;
  }

  const targetSelectors = [
    '[class*="galleryTab"]',
    '[class*="avatarZone"]',
    '[class*="tabBar"]',
    '[class*="panelOuter"]',
    '[class*="mosaic"]',
  ];

  const visitedFibers = new Set<object>();

  for (const selector of targetSelectors) {
    let elements: NodeListOf<HTMLElement>;
    try {
      elements = document.querySelectorAll<HTMLElement>(selector);
    } catch {
      continue;
    }
    for (const el of Array.from(elements)) {
      if (!el || typeof el !== "object") continue;
      let fiberKey: string | undefined;
      try {
        fiberKey = Object.keys(el).find(
          (k) =>
            k.startsWith("__reactFiber$") ||
            k.startsWith("__reactInternalInstance$"),
        );
      } catch {
        continue;
      }
      if (!fiberKey) continue;

      let fiber: any = (el as unknown as Record<string, unknown>)[fiberKey];
      let depth = 0;
      while (fiber && typeof fiber === "object" && depth < 35) {
        depth++;
        if (!visitedFibers.has(fiber)) {
          visitedFibers.add(fiber);
          let hook = fiber.memoizedState;
          let hookDepth = 0;
          const visitedHooks = new Set<object>();
          while (hook && typeof hook === "object" && hookDepth < 60) {
            if (visitedHooks.has(hook)) break;
            visitedHooks.add(hook);
            hookDepth++;
            const memo = hook.memoizedState;

            // 1. Check `useCallback` tuple `[fn, deps]` (e.g. `fetchGallery` in CharacterEditorPage)
            if (Array.isArray(memo) && typeof memo[0] === "function") {
              try {
                const src = Function.prototype.toString.call(memo[0]);
                if (typeof src === "string" && isGalleryFetchCallbackSrc(src)) {
                  invokeHookSafely(memo[0]);
                }
              } catch {
                // ignore
              }
            }

            // 2. Check `useEffect` object `{ create, destroy/inst, deps, ... }` (e.g. gallery loader in PortraitPanel)
            if (
              memo &&
              typeof memo === "object" &&
              typeof memo.create === "function"
            ) {
              try {
                const src = Function.prototype.toString.call(memo.create);
                if (typeof src === "string" && isGalleryFetchEffectSrc(src)) {
                  if (typeof memo.destroy === "function") {
                    invokeHookSafely(() => memo.destroy());
                    memo.destroy = undefined;
                  } else if (
                    memo.inst &&
                    typeof memo.inst === "object" &&
                    typeof memo.inst.destroy === "function"
                  ) {
                    invokeHookSafely(() => memo.inst.destroy());
                    memo.inst.destroy = undefined;
                  }
                  const cleanup = invokeHookSafely(() => memo.create());
                  if (typeof cleanup === "function") {
                    if (memo.inst && typeof memo.inst === "object") {
                      memo.inst.destroy = cleanup;
                    } else {
                      memo.destroy = cleanup;
                    }
                  }
                }
              } catch {
                // ignore
              }
            }

            hook = hook.next;
          }
        }
        fiber = fiber.return;
      }
    }
  }
}

export function setup(ctx: SpindleFrontendContext): () => void {
  const cleanups: Array<() => void> = [() => cleanupUiHelpers()];
  let unloaded = false;

  // 1. Inject styles
  try {
    const removeStyle = ctx.dom.addStyle(MEDIA_LOCALIZER_STYLES);
    if (typeof removeStyle === "function") cleanups.push(removeStyle);
  } catch {
    // ignore
  }

  // 2. State & RPC Bridge
  let currentSettings: MediaLocalizerSettings = {
    ...DEFAULT_SETTINGS,
    defaultSections: [...DEFAULT_SETTINGS.defaultSections],
    defaultMediaKinds: [...DEFAULT_SETTINGS.defaultMediaKinds],
  };
  let currentStats: StorageStatsSummary = {
    totalAssets: 0,
    totalSizeBytes: 0,
    totalFailedUrls: 0,
    settings: currentSettings,
  };
  let currentQueueProgress: QueueJobProgress = {
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

  let reqSeq = 0;
  const pendingRpc = new Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  function callBackend<T = any>(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 60_000,
  ): Promise<T> {
    const requestId = `ml_rpc_${Date.now()}_${++reqSeq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpc.delete(requestId);
        reject(new Error(`RPC timeout for ${action}`));
      }, timeoutMs);

      pendingRpc.set(requestId, { resolve, reject, timer });
      ctx.sendToBackend({
        type: "RPC_REQUEST",
        requestId,
        action,
        payload,
      });
    });
  }

  // Debounced native Gallery & Portrait Panel UI refresh
  let uiRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleNativeGalleryUiRefresh(): void {
    if (unloaded) return;
    if (uiRefreshTimer !== null) {
      clearTimeout(uiRefreshTimer);
    }
    uiRefreshTimer = setTimeout(() => {
      uiRefreshTimer = null;
      if (unloaded) return;
      try {
        triggerNativeGalleryAndPortraitReactRefresh();
      } catch {
        // ignore
      }
    }, 150);
  }
  cleanups.push(() => {
    if (uiRefreshTimer !== null) {
      clearTimeout(uiRefreshTimer);
      uiRefreshTimer = null;
    }
  });

  // Track in-flight gallery link operations per `characterId:imageId` to prevent duplicates
  const inFlightGalleryLinks = new Set<string>();
  const characterLinkLocks = new Map<string, Promise<void>>();

  /**
   * Direct REST fallback for Lumiverse's character gallery endpoint:
   * `SpindleFrontendContext` (`lumiverse-spindle-types`) only exposes `ctx.characters.get`
   * and backend `getGallery`, with no frontend gallery link/delete endpoints.
   */
  async function fetchNativeCharacterGallery(
    characterId: string,
  ): Promise<NativeGalleryApiItem[]> {
    if (typeof fetch !== "function" || !characterId || unloaded) return [];
    try {
      const response = await fetch(
        `/api/v1/characters/${encodeURIComponent(characterId)}/gallery`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        console.warn(
          `[media_localizer] Failed fetching native gallery (${response.status} ${response.statusText})`,
        );
        return [];
      }
      const body = (await response.json()) as
        | NativeGalleryApiItem[]
        | { data?: NativeGalleryApiItem[] }
        | null;
      const list = Array.isArray(body)
        ? body
        : Array.isArray(body?.data)
          ? body.data
          : [];
      return list.filter(
        (item): item is NativeGalleryApiItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.image_id === "string",
      );
    } catch (err) {
      console.warn("[media_localizer] Failed fetching native gallery:", err);
      return [];
    }
  }

  /**
   * Ensures that the given localized images are linked in the character's native
   * Lumiverse Gallery (`character_gallery`), recording their `galleryItemId`s back
   * in `MediaIndexStore` and refreshing the native Gallery & Portrait Panel UI.
   */
  async function ensureGalleryLinksForCharacter(
    characterId: string,
    items: PendingGalleryLinkItem[],
  ): Promise<void> {
    if (
      typeof fetch !== "function" ||
      !characterId ||
      items.length === 0 ||
      unloaded
    ) {
      return;
    }

    const filtered = items.filter((item) => {
      if (!item.imageId) return false;
      const key = `${characterId}:${item.imageId}`;
      if (inFlightGalleryLinks.has(key)) return false;
      inFlightGalleryLinks.add(key);
      return true;
    });
    if (filtered.length === 0) return;

    const prevLock = characterLinkLocks.get(characterId) ?? Promise.resolve();
    const run = async () => {
      const recordedLinks: Array<{
        characterId: string;
        normalizedUrl?: string;
        imageId: string;
        galleryItemId: string;
      }> = [];
      let addedNewGalleryRow = false;

      try {
        if (unloaded) return;
        const existingGallery = await fetchNativeCharacterGallery(characterId);
        const existingByImageId = new Map<string, NativeGalleryApiItem>();
        for (const gItem of existingGallery) {
          existingByImageId.set(gItem.image_id, gItem);
        }

        for (const item of filtered) {
          if (unloaded) break;
          const already = existingByImageId.get(item.imageId);
          if (already) {
            recordedLinks.push({
              characterId,
              normalizedUrl: item.normalizedUrl,
              imageId: item.imageId,
              galleryItemId: already.id,
            });
            continue;
          }

          try {
            const response = await fetch(
              `/api/v1/characters/${encodeURIComponent(characterId)}/gallery/link`,
              {
                method: "POST",
                credentials: "include",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  image_id: item.imageId,
                  ...(item.caption ? { caption: item.caption } : {}),
                }),
              },
            );
            if (!response.ok) {
              console.warn(
                `[media_localizer] Failed linking gallery image (${response.status} ${response.statusText})`,
              );
              continue;
            }
            const body = (await response.json()) as
              | NativeGalleryApiItem
              | { data?: NativeGalleryApiItem }
              | null;
            const created =
              body && typeof (body as NativeGalleryApiItem).id === "string"
                ? (body as NativeGalleryApiItem)
                : (body as { data?: NativeGalleryApiItem } | null)?.data;
            if (created?.id) {
              existingByImageId.set(item.imageId, created);
              recordedLinks.push({
                characterId,
                normalizedUrl: item.normalizedUrl,
                imageId: item.imageId,
                galleryItemId: created.id,
              });
              addedNewGalleryRow = true;
            }
          } catch (err) {
            console.warn(
              "[media_localizer] Network error linking gallery image:",
              err,
            );
          }
        }
      } finally {
        for (const item of filtered) {
          inFlightGalleryLinks.delete(`${characterId}:${item.imageId}`);
        }
      }

      if (unloaded) return;
      if (recordedLinks.length > 0) {
        try {
          await callBackend("record_gallery_links", { links: recordedLinks });
        } catch (err) {
          console.warn("[media_localizer] Failed recording gallery links:", err);
        }
      }

      if ((addedNewGalleryRow || recordedLinks.length > 0) && !unloaded) {
        scheduleNativeGalleryUiRefresh();
      }
    };

    const nextLock = prevLock.then(run, run);
    characterLinkLocks.set(characterId, nextLock);
    try {
      await nextLock;
    } finally {
      if (characterLinkLocks.get(characterId) === nextLock) {
        characterLinkLocks.delete(characterId);
      }
    }
  }

  /**
   * Removes the specified gallery items (or imageIds) from the character's native
   * Lumiverse Gallery (`DELETE /api/v1/characters/:id/gallery/:itemId`) so that
   * removing/purging localized media stays 100% synchronized with the Gallery & Portrait panel.
   */
  async function removeItemsFromNativeGallery(
    characterId: string,
    galleryItemIds: string[],
    imageIds: string[],
  ): Promise<void> {
    if (
      typeof fetch !== "function" ||
      !characterId ||
      unloaded ||
      (galleryItemIds.length === 0 && imageIds.length === 0)
    ) {
      return;
    }

    const idsToDelete = new Set<string>(galleryItemIds.filter(Boolean));
    const targetImages = imageIds.filter(Boolean);
    if (targetImages.length > 0 && idsToDelete.size < targetImages.length) {
      const targetImageSet = new Set<string>(targetImages);
      const existingGallery = await fetchNativeCharacterGallery(characterId);
      for (const gItem of existingGallery) {
        if (targetImageSet.has(gItem.image_id) && gItem.id) {
          idsToDelete.add(gItem.id);
        }
      }
    }

    if (idsToDelete.size === 0 || unloaded) return;

    let deletedAny = false;
    for (const itemId of idsToDelete) {
      if (unloaded) break;
      try {
        const res = await fetch(
          `/api/v1/characters/${encodeURIComponent(characterId)}/gallery/${encodeURIComponent(itemId)}`,
          {
            method: "DELETE",
            credentials: "include",
            headers: {
              Accept: "application/json",
            },
          },
        );
        if (res.ok || res.status === 204) {
          deletedAny = true;
        } else if (res.status !== 404) {
          console.warn(
            `[media_localizer] Failed deleting gallery item (${res.status} ${res.statusText})`,
          );
        }
      } catch (err) {
        console.warn("[media_localizer] Network error deleting gallery item:", err);
      }
    }

    if (deletedAny && !unloaded) {
      scheduleNativeGalleryUiRefresh();
    }
  }

  // 4. Display-Time Swapper
  const inFlightScans = new Map<string, Promise<CharacterMediaScanResult>>();
  const displaySwapper = new NonDestructiveDisplaySwapper(ctx);
  displaySwapper.start();
  cleanups.push(() => displaySwapper.stop());

  let lastActiveCharacterScan: CharacterMediaScanResult | null = null;
  let lastActiveCharacterRemoteCount = 0;
  let drawerTabSetBadge: ((text: string | null) => void) | null = null;
  let activateDrawerTab: (() => void) | null = null;
  let portraitButton: PortraitPanelLocalizeController | null = null;

  function computeEffectivePendingCount(scan: CharacterMediaScanResult | null): number {
    if (!scan) return 0;
    const filter = buildEffectiveFilter(currentSettings, scan);
    const matched = filterScanItemsForDownload(scan, filter);
    return filter.maxItems && filter.maxItems > 0
      ? Math.min(matched.length, filter.maxItems)
      : matched.length;
  }

  function refreshPendingCountsFromActiveScan(): void {
    const activeCharId = resolveActiveContextCharacterId();
    if (!activeCharId || !lastActiveCharacterScan || lastActiveCharacterScan.characterId !== activeCharId) {
      lastActiveCharacterRemoteCount = 0;
    } else {
      lastActiveCharacterRemoteCount = computeEffectivePendingCount(lastActiveCharacterScan);
    }
    updateDrawerTabBadge();
    portraitButton?.update();
  }

  function resolveActiveContextCharacterId(): string | null {
    try {
      const editorState = ctx.ui?.characterEditor?.getState?.();
      if (editorState?.open && editorState.characterId) {
        return editorState.characterId;
      }
    } catch {
      // ignore
    }
    try {
      const editingId = ctx.state?.get?.("characters.editingId");
      if (typeof editingId === "string" && editingId) {
        return editingId;
      }
    } catch {
      // ignore
    }
    try {
      const activeChat = ctx.getActiveChat?.();
      if (activeChat?.characterId) return activeChat.characterId;
    } catch {
      // ignore
    }
    try {
      const activeState = ctx.state?.get?.("chat.active") as
        | { characterId?: string | null }
        | undefined;
      if (activeState?.characterId) return activeState.characterId;
    } catch {
      // ignore
    }
    return null;
  }

  function updateDrawerTabBadge(): void {
    if (!drawerTabSetBadge) return;
    try {
      if (
        currentQueueProgress.status === "running" ||
        currentQueueProgress.status === "paused"
      ) {
        drawerTabSetBadge(
          `${currentQueueProgress.completedCount}/${currentQueueProgress.totalQueued}`,
        );
      } else if (lastActiveCharacterRemoteCount > 0) {
        drawerTabSetBadge(String(lastActiveCharacterRemoteCount));
      } else {
        drawerTabSetBadge(null);
      }
    } catch {
      // ignore
    }
  }

  // 5. Shared Callbacks for Gallery Tab & Drawer Panel
  const callbacks: DrawerPanelCallbacks = {
    async onScanCharacter(
      characterId: string,
      forceRefresh = false,
    ): Promise<CharacterMediaScanResult> {
      const scanKey = `${characterId}:${forceRefresh ? "1" : "0"}`;
      const inflight = inFlightScans.get(scanKey);
      if (inflight) return inflight;
      const run = (async () => {
        const res = await callBackend<{
          scan: CharacterMediaScanResult;
          urlMapPayload: ActiveDisplayUrlMapPayload;
          pendingGalleryLinks?: PendingGalleryLinkItem[];
        }>("scan_character", { characterId, forceRefresh });
        if (res.urlMapPayload) {
          displaySwapper.updateMap(res.urlMapPayload);
        }
        const activeCharId = resolveActiveContextCharacterId();
        if (activeCharId && activeCharId === characterId && res.scan) {
          lastActiveCharacterScan = res.scan;
          refreshPendingCountsFromActiveScan();
        }
        if (
          currentSettings.autoLinkGallery &&
          Array.isArray(res.pendingGalleryLinks) &&
          res.pendingGalleryLinks.length > 0
        ) {
          void ensureGalleryLinksForCharacter(
            characterId,
            res.pendingGalleryLinks,
          );
        }
        return res.scan;
      })();
      inFlightScans.set(scanKey, run);
      try {
        return await run;
      } finally {
        inFlightScans.delete(scanKey);
      }
    },

    async onSaveCharacterOverride(
      characterId: string,
      override: CharacterDownloadOverride | null,
    ): Promise<CharacterDownloadOverride | null> {
      const res = await callBackend<{ override: CharacterDownloadOverride | null }>(
        "save_character_override",
        { characterId, override },
      );
      if (lastActiveCharacterScan && lastActiveCharacterScan.characterId === characterId) {
        lastActiveCharacterScan.override = res.override ?? null;
        refreshPendingCountsFromActiveScan();
      }
      return res.override ?? null;
    },

    async onClearFailedUrls(urls: string[]): Promise<void> {
      const res = await callBackend<{
        cleared: number;
        stats: StorageStatsSummary;
      }>("clear_failed", { urls });
      if (res.stats) {
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      notifyUiStateChanged();
    },

    async onStartDownload(filter: DownloadFilterOptions): Promise<void> {
      const res = await callBackend<{ queueProgress: QueueJobProgress }>(
        "enqueue_download",
        { filter },
      );
      if (res.queueProgress) {
        currentQueueProgress = res.queueProgress;
        notifyUiStateChanged();
      }
    },

    async onQueueControl(
      control: "pause" | "resume" | "skip_current" | "cancel_all",
      targetUrl?: string,
    ): Promise<void> {
      const res = await callBackend<{ queueProgress: QueueJobProgress }>(
        "queue_control",
        { control, targetUrl },
      );
      if (res.queueProgress) {
        currentQueueProgress = res.queueProgress;
        notifyUiStateChanged();
      }
    },

    async onPurgeCharacterCache(
      characterId: string,
      urls?: string[],
    ): Promise<void> {
      const res = await callBackend<{
        removedGalleryItemIds?: string[];
        removedImageIds?: string[];
        stats: StorageStatsSummary;
        urlMapPayload: ActiveDisplayUrlMapPayload;
      }>("purge_character_cache", { characterId, urls });

      await removeItemsFromNativeGallery(
        characterId,
        res.removedGalleryItemIds ?? [],
        res.removedImageIds ?? [],
      );

      if (res.stats) {
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      if (lastActiveCharacterScan?.characterId === characterId) {
        lastActiveCharacterScan = null;
      }
      notifyUiStateChanged();
      const activeCharId =
        resolveActiveContextCharacterId() ?? lastObservedContextCharId;
      if (!unloaded && activeCharId && activeCharId === characterId) {
        await callbacks.onScanCharacter(activeCharId, true).catch(() => {});
      }
      if (!unloaded) {
        galleryIntegrator.refreshActiveScan(characterId);
      }
    },

    async onBulkPurgeCharacters(characterIds: string[]): Promise<void> {
      const res = await callBackend<{
        removedGalleryItemIds?: string[];
        removedImageIds?: string[];
        stats: StorageStatsSummary;
        urlMapPayload: ActiveDisplayUrlMapPayload;
      }>("purge_characters", { characterIds });

      for (const charId of characterIds) {
        await removeItemsFromNativeGallery(
          charId,
          res.removedGalleryItemIds ?? [],
          res.removedImageIds ?? [],
        );
      }

      if (res.stats) {
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      if (
        lastActiveCharacterScan &&
        characterIds.includes(lastActiveCharacterScan.characterId)
      ) {
        lastActiveCharacterScan = null;
      }
      notifyUiStateChanged();
      const activeCharId =
        resolveActiveContextCharacterId() ?? lastObservedContextCharId;
      if (!unloaded && activeCharId && characterIds.includes(activeCharId)) {
        void callbacks.onScanCharacter(activeCharId, true).catch(() => {});
      }
      if (!unloaded) {
        for (const charId of characterIds) {
          galleryIntegrator.refreshActiveScan(charId);
        }
      }
    },

    async onScanLibrary(forceRefresh = false): Promise<{
      characters: LibraryCharacterSummary[];
      totalUniqueRemote: number;
    }> {
      const res = await callBackend<{
        characters: LibraryCharacterSummary[];
        totalUniqueRemote: number;
        urlMapPayload: ActiveDisplayUrlMapPayload;
      }>("scan_library", { forceRefresh }, 180_000);
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      return {
        characters: res.characters,
        totalUniqueRemote: res.totalUniqueRemote,
      };
    },

    async onListLibraryMedia(options?: {
      includeEmpty?: boolean;
    }): Promise<LibraryMediaCharacter[]> {
      const res = await callBackend<{ characters: LibraryMediaCharacter[] }>(
        "list_library_media",
        { includeEmpty: Boolean(options?.includeEmpty) },
        120_000,
      );
      return Array.isArray(res?.characters) ? res.characters : [];
    },

    async onUpdateSettings(
      patch: Partial<MediaLocalizerSettings>,
    ): Promise<{ settings: MediaLocalizerSettings; stats: StorageStatsSummary }> {
      const res = await callBackend<{
        settings: MediaLocalizerSettings;
        stats: StorageStatsSummary;
        urlMapPayload: ActiveDisplayUrlMapPayload;
      }>("update_settings", { patch });
      currentSettings = res.settings;
      currentStats = res.stats;
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      notifyUiStateChanged();
      return { settings: res.settings, stats: res.stats };
    },

    async onClearFailed(): Promise<{ cleared: number; stats: StorageStatsSummary }> {
      const res = await callBackend<{
        cleared: number;
        stats: StorageStatsSummary;
      }>("clear_failed", {});
      currentStats = res.stats;
      currentSettings = res.stats.settings;
      notifyUiStateChanged();
      return res;
    },
  };

  // 6. Native Character Editor 'gallery' Tab Integrator
  const galleryIntegrator = new NativeGalleryTabIntegrator(
    ctx,
    currentSettings,
    currentQueueProgress,
    callbacks,
  );
  galleryIntegrator.start();
  cleanups.push(() => galleryIntegrator.stop());

  // 7. Drawer Tab Registration
  const drawerPanel = new MediaLocalizerDrawerPanel(
    ctx,
    currentSettings,
    currentStats,
    currentQueueProgress,
    callbacks,
  );

  try {
    const tab = ctx.ui.registerDrawerTab({
      id: "media_localizer",
      title: "Media Localizer",
      shortName: "Media",
      description:
        "Non-destructively localizes external media embedded in character cards into the Character Gallery & Portrait Panel with granular filters and display-time swapping.",
      keywords: ["media", "localize", "images", "gallery", "cache", "offline"],
      headerTitle: "Media Localizer",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
      guide: {
        title: "Media Localizer Guide",
        markdown: [
          "### Non-Destructive Media Localization",
          "Media Localizer scans character cards, linked World Books, and Regex Scripts for external image, video, and audio URLs.",
          "",
          "- **Zero Card Mutation**: Original character card JSON and text fields are never overwritten.",
          "- **Live Display Swapping**: Localized URLs are transparently swapped in the DOM at display time (`<img>`, `<video>`, `<audio>`, `<source>`, `srcset`, inline SVG `<image>`, CSS `background-image`, and same-origin iframes).",
          "- **Native Gallery Sync**: Downloaded images are automatically linked into the character's native Lumiverse Gallery & Portrait Panel, and existing Gallery images are adopted automatically.",
          "- **Granular Controls**: Filter by card section, individual alternate greetings, domain, or explicit URLs.",
        ].join("\n"),
      },
    });
    drawerTabSetBadge = (text) => tab.setBadge(text);
    activateDrawerTab = () => tab.activate();
    updateDrawerTabBadge();
    const unmountDrawer = drawerPanel.mount(tab.root);
    cleanups.push(unmountDrawer);
  } catch (err) {
    console.warn("[media_localizer] Failed to register drawer tab:", err);
  }

  portraitButton = new PortraitPanelLocalizeController({
    getActiveCharacterId: () => resolveActiveContextCharacterId(),
    getPendingCount: () => lastActiveCharacterRemoteCount,
    getQueueProgress: () => currentQueueProgress,
    async onLocalizeActiveCharacter(characterId: string): Promise<void> {
      const scan =
        lastActiveCharacterScan && lastActiveCharacterScan.characterId === characterId
          ? lastActiveCharacterScan
          : await callbacks.onScanCharacter(characterId, false);
      const effective = buildEffectiveFilter(currentSettings, scan);
      const matched = filterScanItemsForDownload(scan, effective);
      const count =
        effective.maxItems && effective.maxItems > 0
          ? Math.min(matched.length, effective.maxItems)
          : matched.length;
      if (count === 0) return;

      if (count > currentSettings.confirmThreshold) {
        const res = await ctx.ui.showConfirm({
          title: "Confirm Media Localization Batch",
          message: `Download ${count} remote media file(s) for "${scan.characterName}"?`,
          confirmLabel: `Localize ${count}`,
          cancelLabel: "Cancel",
        });
        if (!res?.confirmed) return;
      }

      const enqueueRes = await callBackend<{ queueProgress: QueueJobProgress }>(
        "enqueue_download",
        {
          filter: { ...effective, characterIds: [characterId] },
          useCharacterOverrides: true,
        },
      );
      if (enqueueRes.queueProgress) {
        currentQueueProgress = enqueueRes.queueProgress;
        notifyUiStateChanged();
      }
    },
    onOpenCharacterTab(characterId: string): void {
      drawerPanel.setActiveTab("character", characterId, {
        expandOptions: true,
      });
      try {
        activateDrawerTab?.();
      } catch {
        // ignore if drawer tab is unavailable
      }
    },
  });
  portraitButton.start();
  cleanups.push(() => portraitButton?.stop());

  function notifyUiStateChanged(): void {
    galleryIntegrator.updateExternalState(currentSettings, currentQueueProgress);
    drawerPanel.updateExternalState(
      currentSettings,
      currentStats,
      currentQueueProgress,
    );
    refreshPendingCountsFromActiveScan();
  }

  // 8. Backend Message Listener
  const offBackend = ctx.onBackendMessage((rawMsg: unknown) => {
    if (!rawMsg || typeof rawMsg !== "object") return;
    const msg = rawMsg as Record<string, unknown>;

    if (msg.type === "RPC_RESPONSE") {
      const requestId = String(msg.requestId ?? "");
      const pending = pendingRpc.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRpc.delete(requestId);
      if (typeof msg.error === "string" && msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (msg.type === "URL_MAP_UPDATED" && msg.urlMapPayload) {
      displaySwapper.updateMap(msg.urlMapPayload as ActiveDisplayUrlMapPayload);
      return;
    }

    if (
      msg.type === "ENSURE_GALLERY_LINKS" &&
      Array.isArray(msg.links) &&
      currentSettings.autoLinkGallery
    ) {
      const characterId = String(msg.characterId ?? "");
      if (characterId) {
        void ensureGalleryLinksForCharacter(
          characterId,
          msg.links as PendingGalleryLinkItem[],
        );
      }
      return;
    }

    if (msg.type === "GALLERY_SYNC_CHANGED") {
      const characterId =
        typeof msg.characterId === "string" ? msg.characterId : undefined;
      galleryIntegrator.refreshActiveScan(characterId);
      drawerPanel.refreshActiveScan(characterId);
      return;
    }

    if (msg.type === "QUEUE_PROGRESS" && msg.progress) {
      const wasActive = isQueueActiveStatus(currentQueueProgress.status);
      currentQueueProgress = msg.progress as QueueJobProgress;
      const nowActive = isQueueActiveStatus(currentQueueProgress.status);
      notifyUiStateChanged();

      if (wasActive && !nowActive && lastObservedContextCharId) {
        void callbacks.onScanCharacter(lastObservedContextCharId, false).catch(() => {});
      }

      // Automatically link every newly localized image into the character's native Gallery & Portrait Panel
      if (msg.newAsset && currentSettings.autoLinkGallery) {
        const asset = msg.newAsset as LocalizedAssetEntry;
        if (asset.imageId && asset.mimeType.startsWith("image/")) {
          for (const charId of asset.characterIds) {
            if (!charId) continue;
            // If already linked in galleryItemIds (e.g. reused existing gallery image), still refresh UI
            if (asset.galleryItemIds?.[charId]) {
              scheduleNativeGalleryUiRefresh();
              continue;
            }
            void ensureGalleryLinksForCharacter(charId, [
              {
                characterId: charId,
                imageId: asset.imageId,
                normalizedUrl: asset.normalizedUrl,
                caption: asset.filename,
              },
            ]);
          }
        }
      }
    }
  });
  if (typeof offBackend === "function") cleanups.push(offBackend);

  // 9. Host Event & State Listeners for Display Swapping & Active Character Updates
  let lastObservedContextCharId: string | null = resolveActiveContextCharacterId();

  function handleActiveCharacterContextChanged(force = false): void {
    if (unloaded) return;
    const nextCharId = resolveActiveContextCharacterId();
    const changed = force || nextCharId !== lastObservedContextCharId;
    lastObservedContextCharId = nextCharId;

    displaySwapper.schedulePass();
    if (changed) {
      drawerPanel.notifyActiveChatChanged();
    }

    if (nextCharId) {
      if (changed) {
        void callbacks.onScanCharacter(nextCharId, false).catch(() => {});
        if (currentSettings.autoLocalizeOnOpen) {
          void callBackend<{ started?: boolean; queueProgress?: QueueJobProgress }>(
            "auto_localize_character",
            { characterId: nextCharId },
          )
            .then((res) => {
              if (res?.started && res.queueProgress) {
                currentQueueProgress = res.queueProgress;
                notifyUiStateChanged();
              }
            })
            .catch(() => {});
        }
      }
    } else if (changed) {
      lastActiveCharacterScan = null;
      lastActiveCharacterRemoteCount = 0;
      updateDrawerTabBadge();
      portraitButton?.update();
    }
  }

  try {
    const offChatActive = ctx.state?.subscribe?.("chat.active", () => {
      handleActiveCharacterContextChanged();
    });
    if (typeof offChatActive === "function") cleanups.push(offChatActive);
  } catch {
    // ignore
  }

  try {
    const offDrawerChange = ctx.ui?.events?.onDrawerChange?.((state) => {
      if (state.open && state.tabId === "media_localizer") {
        handleActiveCharacterContextChanged();
      }
    });
    if (typeof offDrawerChange === "function") cleanups.push(offDrawerChange);
  } catch {
    // ignore
  }

  let hasEditorStateSub = false;
  let hasEditingIdSub = false;
  function bindPermissionGatedSubscriptions(): void {
    if (unloaded) return;
    galleryIntegrator.start();
    if (!hasEditorStateSub) {
      try {
        const offEditor = ctx.ui?.characterEditor?.onChange?.(() => {
          handleActiveCharacterContextChanged();
        });
        if (typeof offEditor === "function") {
          hasEditorStateSub = true;
          cleanups.push(offEditor);
        }
      } catch {
        // Permission may not be granted yet
      }
    }
    if (!hasEditingIdSub) {
      try {
        const offEditingId = ctx.state?.subscribe?.(
          "characters.editingId",
          () => {
            handleActiveCharacterContextChanged();
          },
        );
        if (typeof offEditingId === "function") {
          hasEditingIdSub = true;
          cleanups.push(offEditingId);
        }
      } catch {
        // Permission may not be granted yet
      }
    }
  }
  bindPermissionGatedSubscriptions();

  // Re-bind permission-gated listeners once permissions resolve
  try {
    if (ctx.permissions?.getGranted) {
      void ctx.permissions
        .getGranted()
        .then((granted) => {
          const grantedSet = new Set(granted);
          const missing = REQUIRED_PERMISSIONS.filter(
            (p) => !grantedSet.has(p),
          );
          if (missing.length > 0 && ctx.permissions?.request) {
            return ctx.permissions.request([...missing]);
          }
          return granted;
        })
        .then(() => {
          if (unloaded) return;
          bindPermissionGatedSubscriptions();
          handleActiveCharacterContextChanged(true);
        })
        .catch(() => {});
    }
  } catch {
    // ignore
  }

  const refreshEvents = [
    "CHAT_SWITCHED",
    "CHARACTER_MESSAGE_RENDERED",
    "USER_MESSAGE_RENDERED",
    "MESSAGE_EDITED",
    "MESSAGE_SWIPED",
    "CHARACTER_EDITED",
  ] as const;

  for (const evName of refreshEvents) {
    try {
      const off = ctx.events.on(evName, () => {
        displaySwapper.schedulePass();
        if (evName === "CHAT_SWITCHED" || evName === "CHARACTER_EDITED") {
          handleActiveCharacterContextChanged(true);
        }
      });
      if (typeof off === "function") cleanups.push(off);
    } catch {
      // ignore
    }
  }

  // 10. Initial Bootstrap
  void callBackend<{
    urlMapPayload: ActiveDisplayUrlMapPayload;
    stats: StorageStatsSummary;
    queueProgress: QueueJobProgress;
  }>("get_init_state")
    .then((init) => {
      if (unloaded) return;
      if (init.stats) {
        currentStats = init.stats;
        currentSettings = init.stats.settings;
      }
      if (init.queueProgress) {
        currentQueueProgress = init.queueProgress;
      }
      if (init.urlMapPayload) {
        displaySwapper.updateMap(init.urlMapPayload);
      }
      notifyUiStateChanged();
      handleActiveCharacterContextChanged(true);
    })
    .catch(() => {});

  try {
    ctx.ready();
  } catch {
    // ignore on older hosts
  }

  return () => {
    unloaded = true;
    for (const [, p] of pendingRpc) {
      clearTimeout(p.timer);
      p.reject(new Error("Media Localizer was unloaded"));
    }
    pendingRpc.clear();
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    try {
      ctx.dom.cleanup();
    } catch {
      // ignore
    }
  };
}
