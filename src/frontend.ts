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
import { clearWarmGalleryThumbs } from "./ui/library-gallery.ts";
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

  let hasLiveStatsUpdate = false;
  let hasLiveQueueUpdate = false;

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
    if (unloaded) {
      return Promise.reject(new Error("Media Localizer was unloaded"));
    }
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
  let pendingNativeGalleryRefreshWhenQueueIdle = false;
  function scheduleNativeGalleryUiRefresh(delayMs = 150): void {
    if (unloaded) return;
    if (isQueueActiveStatus(currentQueueProgress.status)) {
      pendingNativeGalleryRefreshWhenQueueIdle = true;
      return;
    }
    pendingNativeGalleryRefreshWhenQueueIdle = false;
    if (uiRefreshTimer !== null) {
      clearTimeout(uiRefreshTimer);
    }
    uiRefreshTimer = setTimeout(() => {
      uiRefreshTimer = null;
      if (unloaded) return;
      if (isQueueActiveStatus(currentQueueProgress.status)) {
        pendingNativeGalleryRefreshWhenQueueIdle = true;
        return;
      }
      try {
        triggerNativeGalleryAndPortraitReactRefresh();
      } catch {
        // ignore
      }
    }, delayMs);
  }

  // Coalesce gallery link requests per character and track session-linked imageIds
  const pendingGalleryLinkItemsByCharacter = new Map<
    string,
    Map<string, PendingGalleryLinkItem>
  >();
  const inFlightGalleryLinkDrainByCharacter = new Map<string, Promise<void>>();
  const knownLinkedGalleryRowByCharacter = new Map<
    string,
    Map<string, { galleryItemId: string; recordedUrls: Set<string> }>
  >();

  cleanups.push(() => {
    if (uiRefreshTimer !== null) {
      clearTimeout(uiRefreshTimer);
      uiRefreshTimer = null;
    }
    pendingNativeGalleryRefreshWhenQueueIdle = false;
    pendingGalleryLinkItemsByCharacter.clear();
    inFlightGalleryLinkDrainByCharacter.clear();
    knownLinkedGalleryRowByCharacter.clear();
  });

  const activeFetchControllers = new Set<AbortController>();
  const NATIVE_GALLERY_FETCH_TIMEOUT_MS = 15_000;

  async function fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs = NATIVE_GALLERY_FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    if (unloaded) {
      throw new Error("Media Localizer was unloaded");
    }
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (controller) {
      activeFetchControllers.add(controller);
      timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }
    try {
      return await fetch(input, {
        ...init,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (controller) {
        activeFetchControllers.delete(controller);
      }
    }
  }

  cleanups.push(() => {
    for (const controller of activeFetchControllers) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }
    activeFetchControllers.clear();
  });

  /**
   * Direct REST fallback for Lumiverse's character gallery endpoint:
   * `SpindleFrontendContext` (`lumiverse-spindle-types`) only exposes `ctx.characters.get`
   * and backend `getGallery`, with no frontend gallery link/delete endpoints.
   */
  async function fetchNativeCharacterGallery(
    characterId: string,
  ): Promise<NativeGalleryApiItem[] | null> {
    if (typeof fetch !== "function" || !characterId || unloaded) return null;
    try {
      const response = await fetchWithTimeout(
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
        return null;
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
      if (!unloaded) {
        console.warn("[media_localizer] Failed fetching native gallery:", err);
      }
      return null;
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

    let pendingMap = pendingGalleryLinkItemsByCharacter.get(characterId);
    if (!pendingMap) {
      pendingMap = new Map<string, PendingGalleryLinkItem>();
      pendingGalleryLinkItemsByCharacter.set(characterId, pendingMap);
    }
    let addedAny = false;
    for (const item of items) {
      if (!item.imageId) continue;
      pendingMap.set(`${item.imageId}\u0000${item.normalizedUrl}`, item);
      addedAny = true;
    }

    const existingDrain = inFlightGalleryLinkDrainByCharacter.get(characterId);
    if (existingDrain) {
      return existingDrain;
    }
    if (!addedAny) {
      if (pendingMap.size === 0) {
        pendingGalleryLinkItemsByCharacter.delete(characterId);
      }
      return;
    }

    const drainPromise = (async () => {
      while (!unloaded) {
        await Promise.resolve();
        if (unloaded) break;
        const charPending = pendingGalleryLinkItemsByCharacter.get(characterId);
        if (!charPending || charPending.size === 0) {
          break;
        }
        let batchAddedNewGalleryRow = false;
        const batch = Array.from(charPending.values());
        charPending.clear();

        let knownRows = knownLinkedGalleryRowByCharacter.get(characterId);
        if (!knownRows) {
          knownRows = new Map<
            string,
            { galleryItemId: string; recordedUrls: Set<string> }
          >();
          knownLinkedGalleryRowByCharacter.set(characterId, knownRows);
        }

        const recordedLinks: Array<{
          characterId: string;
          normalizedUrl?: string;
          imageId: string;
          galleryItemId: string;
        }> = [];
        const unlinkedItems: PendingGalleryLinkItem[] = [];

        for (const item of batch) {
          const known = knownRows.get(item.imageId);
          if (known) {
            if (!item.normalizedUrl || !known.recordedUrls.has(item.normalizedUrl)) {
              recordedLinks.push({
                characterId,
                normalizedUrl: item.normalizedUrl,
                imageId: item.imageId,
                galleryItemId: known.galleryItemId,
              });
              if (item.normalizedUrl) {
                known.recordedUrls.add(item.normalizedUrl);
              }
            }
          } else {
            unlinkedItems.push(item);
          }
        }

        if (unlinkedItems.length > 0 && !unloaded) {
          const existingGallery =
            (await fetchNativeCharacterGallery(characterId)) ?? [];
          const existingByImageId = new Map<string, NativeGalleryApiItem>();
          for (const gItem of existingGallery) {
            existingByImageId.set(gItem.image_id, gItem);
            if (!knownRows.has(gItem.image_id)) {
              knownRows.set(gItem.image_id, {
                galleryItemId: gItem.id,
                recordedUrls: new Set<string>(),
              });
            }
          }

          for (const item of unlinkedItems) {
            if (unloaded) break;
            const already = existingByImageId.get(item.imageId);
            if (already) {
              const known = knownRows.get(item.imageId);
              if (known && item.normalizedUrl) {
                known.recordedUrls.add(item.normalizedUrl);
              }
              recordedLinks.push({
                characterId,
                normalizedUrl: item.normalizedUrl,
                imageId: item.imageId,
                galleryItemId: already.id,
              });
              continue;
            }

            try {
              const response = await fetchWithTimeout(
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
                const recordedUrls = new Set<string>();
                if (item.normalizedUrl) {
                  recordedUrls.add(item.normalizedUrl);
                }
                knownRows.set(item.imageId, {
                  galleryItemId: created.id,
                  recordedUrls,
                });
                recordedLinks.push({
                  characterId,
                  normalizedUrl: item.normalizedUrl,
                  imageId: item.imageId,
                  galleryItemId: created.id,
                });
                batchAddedNewGalleryRow = true;
              }
            } catch (err) {
              if (!unloaded) {
                console.warn(
                  "[media_localizer] Network error linking gallery image:",
                  err,
                );
              }
            }
          }
        }

        if (unloaded) break;
        if (batchAddedNewGalleryRow && !unloaded) {
          scheduleNativeGalleryUiRefresh();
        }
        if (recordedLinks.length > 0) {
          try {
            await callBackend("record_gallery_links", { links: recordedLinks });
          } catch (err) {
            console.warn("[media_localizer] Failed recording gallery links:", err);
          }
        }
      }
    })().finally(() => {
      if (inFlightGalleryLinkDrainByCharacter.get(characterId) === drainPromise) {
        inFlightGalleryLinkDrainByCharacter.delete(characterId);
      }
      if (pendingGalleryLinkItemsByCharacter.get(characterId)?.size === 0) {
        pendingGalleryLinkItemsByCharacter.delete(characterId);
      }
    });

    inFlightGalleryLinkDrainByCharacter.set(characterId, drainPromise);
    await drainPromise;
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
    options?: { trustGalleryItemIdsWithoutLookup?: boolean },
  ): Promise<void> {
    if (
      typeof fetch !== "function" ||
      !characterId ||
      unloaded ||
      (galleryItemIds.length === 0 && imageIds.length === 0)
    ) {
      return;
    }

    const targetGalleryIds = new Set<string>(galleryItemIds.filter(Boolean));
    const targetImageIds = new Set<string>(imageIds.filter(Boolean));
    if (targetGalleryIds.size === 0 && targetImageIds.size === 0) {
      return;
    }

    const idsToDelete = new Set<string>();
    const existingGallery = await fetchNativeCharacterGallery(characterId);
    if (existingGallery !== null) {
      for (const gItem of existingGallery) {
        if (!gItem.id) continue;
        if (targetGalleryIds.has(gItem.id) || targetImageIds.has(gItem.image_id)) {
          idsToDelete.add(gItem.id);
        }
      }
    } else if (options?.trustGalleryItemIdsWithoutLookup) {
      for (const id of targetGalleryIds) {
        idsToDelete.add(id);
      }
    }

    if (idsToDelete.size === 0 || unloaded) return;

    let deletedAny = false;
    for (const itemId of idsToDelete) {
      if (unloaded) break;
      try {
        const res = await fetchWithTimeout(
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
        if (!unloaded) {
          console.warn("[media_localizer] Network error deleting gallery item:", err);
        }
      }
    }

    if (deletedAny && !unloaded) {
      knownLinkedGalleryRowByCharacter.delete(characterId);
      scheduleNativeGalleryUiRefresh();
    }
  }

  // 4. Display-Time Swapper
  const inFlightScans = new Map<string, Promise<CharacterMediaScanResult>>();
  let scanSeq = 0;
  const latestScanSeqByChar = new Map<string, number>();
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
      const forcedKey = `${characterId}:1`;
      const scanKey = `${characterId}:${forceRefresh ? "1" : "0"}`;
      const inflight =
        (!forceRefresh ? inFlightScans.get(forcedKey) : undefined) ??
        inFlightScans.get(scanKey);
      if (inflight) return inflight;

      const mySeq = ++scanSeq;
      latestScanSeqByChar.set(characterId, mySeq);

      const run = (async () => {
        const res = await callBackend<{
          scan: CharacterMediaScanResult;
          urlMapPayload: ActiveDisplayUrlMapPayload;
          pendingGalleryLinks?: PendingGalleryLinkItem[];
        }>("scan_character", { characterId, forceRefresh });
        if (unloaded) return res.scan;
        const isLatestForChar = latestScanSeqByChar.get(characterId) === mySeq;
        if (isLatestForChar && res.urlMapPayload) {
          displaySwapper.updateMap(res.urlMapPayload);
        }
        const activeCharId = resolveActiveContextCharacterId();
        if (isLatestForChar && activeCharId && activeCharId === characterId && res.scan) {
          lastActiveCharacterScan = res.scan;
          refreshPendingCountsFromActiveScan();
        }
        if (
          isLatestForChar &&
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
        if (inFlightScans.get(scanKey) === run) {
          inFlightScans.delete(scanKey);
        }
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
        hasLiveStatsUpdate = true;
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
        hasLiveQueueUpdate = true;
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
        hasLiveQueueUpdate = true;
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
        { trustGalleryItemIdsWithoutLookup: true },
      );

      if (res.stats) {
        hasLiveStatsUpdate = true;
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      latestScanSeqByChar.set(characterId, ++scanSeq);
      inFlightScans.delete(`${characterId}:0`);
      inFlightScans.delete(`${characterId}:1`);
      knownLinkedGalleryRowByCharacter.delete(characterId);
      if (urls && urls.length > 0) {
        const urlSet = new Set(urls);
        const pendingForChar = pendingGalleryLinkItemsByCharacter.get(characterId);
        if (pendingForChar) {
          for (const [k, item] of pendingForChar.entries()) {
            if (urlSet.has(item.normalizedUrl)) {
              pendingForChar.delete(k);
            }
          }
          if (pendingForChar.size === 0) {
            pendingGalleryLinkItemsByCharacter.delete(characterId);
          }
        }
      } else {
        pendingGalleryLinkItemsByCharacter.delete(characterId);
      }
      drawerPanel.invalidateCharacterCache(characterId);
      clearWarmGalleryThumbs();
      if (lastActiveCharacterScan?.characterId === characterId) {
        lastActiveCharacterScan = null;
      }
      notifyUiStateChanged();
      const activeCharId =
        resolveActiveContextCharacterId() ?? lastObservedContextCharId;
      if (!unloaded && activeCharId && activeCharId === characterId) {
        void callbacks.onScanCharacter(activeCharId, true).catch(() => {});
      }
      if (!unloaded) {
        galleryIntegrator.refreshActiveScan(characterId);
      }
    },

    async onBulkPurgeCharacters(characterIds: string[]): Promise<void> {
      const uniqueCharIds = Array.from(
        new Set(
          characterIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      );
      if (uniqueCharIds.length === 0) return;

      const res = await callBackend<{
        removedGalleryItemIds?: string[];
        removedImageIds?: string[];
        stats: StorageStatsSummary;
        urlMapPayload: ActiveDisplayUrlMapPayload;
      }>("purge_characters", { characterIds: uniqueCharIds });

      const removedGalleryIds = res.removedGalleryItemIds ?? [];
      const removedImageIds = res.removedImageIds ?? [];
      if (removedGalleryIds.length > 0 || removedImageIds.length > 0) {
        for (const charId of uniqueCharIds) {
          if (unloaded) break;
          await removeItemsFromNativeGallery(
            charId,
            removedGalleryIds,
            removedImageIds,
            { trustGalleryItemIdsWithoutLookup: uniqueCharIds.length === 1 },
          );
        }
      }

      if (res.stats) {
        hasLiveStatsUpdate = true;
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      for (const charId of uniqueCharIds) {
        latestScanSeqByChar.set(charId, ++scanSeq);
        inFlightScans.delete(`${charId}:0`);
        inFlightScans.delete(`${charId}:1`);
        knownLinkedGalleryRowByCharacter.delete(charId);
        pendingGalleryLinkItemsByCharacter.delete(charId);
        drawerPanel.invalidateCharacterCache(charId);
      }
      clearWarmGalleryThumbs();
      if (
        lastActiveCharacterScan &&
        uniqueCharIds.includes(lastActiveCharacterScan.characterId)
      ) {
        lastActiveCharacterScan = null;
      }
      notifyUiStateChanged();
      const activeCharId =
        resolveActiveContextCharacterId() ?? lastObservedContextCharId;
      if (!unloaded && activeCharId && uniqueCharIds.includes(activeCharId)) {
        void callbacks.onScanCharacter(activeCharId, true).catch(() => {});
      }
      if (!unloaded) {
        for (const charId of uniqueCharIds) {
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
      hasLiveStatsUpdate = true;
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
      hasLiveStatsUpdate = true;
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
    {
      onCharacterPrefsUpdated: () => drawerPanel.syncPreferencesFromStorage(),
    },
  );
  cleanups.push(() => galleryIntegrator.stop());
  cleanups.push(() => clearWarmGalleryThumbs());

  // 7. Drawer Panel & Portrait Button
  const drawerPanel = new MediaLocalizerDrawerPanel(
    ctx,
    currentSettings,
    currentStats,
    currentQueueProgress,
    callbacks,
    {
      onCharacterPrefsUpdated: () => galleryIntegrator.syncPreferencesFromStorage(),
    },
  );

  let drawerTabRegistered = false;
  function tryRegisterDrawerTab(): void {
    if (unloaded || drawerTabRegistered || !ctx.ui?.registerDrawerTab) return;
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
      drawerTabRegistered = true;
      drawerTabSetBadge = (text) => tab.setBadge(text);
      activateDrawerTab = () => tab.activate();
      updateDrawerTabBadge();
      const unmountDrawer = drawerPanel.mount(tab.root);
      cleanups.push(unmountDrawer);
    } catch (err) {
      console.warn("[media_localizer] Failed to register drawer tab:", err);
    }
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
        hasLiveQueueUpdate = true;
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
      if (msg.stats) {
        hasLiveStatsUpdate = true;
        currentStats = msg.stats as StorageStatsSummary;
        currentSettings = currentStats.settings;
        notifyUiStateChanged();
      }
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
      if (characterId) {
        knownLinkedGalleryRowByCharacter.delete(characterId);
      } else {
        knownLinkedGalleryRowByCharacter.clear();
      }
      galleryIntegrator.refreshActiveScan(characterId);
      drawerPanel.refreshActiveScan(characterId);
      return;
    }

    if (msg.type === "QUEUE_PROGRESS" && msg.progress) {
      const wasActive = isQueueActiveStatus(currentQueueProgress.status);
      hasLiveQueueUpdate = true;
      currentQueueProgress = msg.progress as QueueJobProgress;
      if (msg.stats) {
        hasLiveStatsUpdate = true;
        currentStats = msg.stats as StorageStatsSummary;
        currentSettings = currentStats.settings;
      }
      const nowActive = isQueueActiveStatus(currentQueueProgress.status);
      notifyUiStateChanged();

      if (wasActive && !nowActive) {
        if (pendingNativeGalleryRefreshWhenQueueIdle) {
          pendingNativeGalleryRefreshWhenQueueIdle = false;
          scheduleNativeGalleryUiRefresh(150);
        }
        if (lastObservedContextCharId) {
          void callbacks.onScanCharacter(lastObservedContextCharId, false).catch(() => {});
        }
      }

      // Automatically link every newly localized image into the character's native Gallery & Portrait Panel
      if (msg.newAsset && currentSettings.autoLinkGallery) {
        const asset = msg.newAsset as LocalizedAssetEntry;
        if (asset.imageId && asset.mimeType.startsWith("image/")) {
          for (const charId of asset.characterIds) {
            if (!charId) continue;
            // Already linked in galleryItemIds (e.g. reused existing gallery image); no refresh needed
            if (asset.galleryItemIds?.[charId]) {
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
                hasLiveQueueUpdate = true;
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

  const refreshEvents = [
    "CHAT_SWITCHED",
    "CHARACTER_MESSAGE_RENDERED",
    "USER_MESSAGE_RENDERED",
    "MESSAGE_EDITED",
    "MESSAGE_SWIPED",
    "CHARACTER_EDITED",
  ] as const;

  let hasChatActiveSub = false;
  let hasDrawerChangeSub = false;
  let hasEditorStateSub = false;
  let hasEditingIdSub = false;
  const boundRefreshEvents = new Set<string>();

  function bindPermissionGatedSubscriptions(): void {
    if (unloaded) return;
    tryRegisterDrawerTab();
    galleryIntegrator.start();

    if (!hasChatActiveSub) {
      try {
        const offChatActive = ctx.state?.subscribe?.("chat.active", () => {
          handleActiveCharacterContextChanged();
        });
        if (typeof offChatActive === "function") {
          hasChatActiveSub = true;
          cleanups.push(offChatActive);
        }
      } catch {
        // Permission may not be granted yet
      }
    }

    if (!hasDrawerChangeSub) {
      try {
        const offDrawerChange = ctx.ui?.events?.onDrawerChange?.((state) => {
          if (state.open && state.tabId === "media_localizer") {
            handleActiveCharacterContextChanged();
            drawerPanel.restoreScrollIfReset();
          }
        });
        if (typeof offDrawerChange === "function") {
          hasDrawerChangeSub = true;
          cleanups.push(offDrawerChange);
        }
      } catch {
        // Permission may not be granted yet
      }
    }

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

    for (const evName of refreshEvents) {
      if (boundRefreshEvents.has(evName)) continue;
      try {
        const off = ctx.events?.on?.(evName, () => {
          displaySwapper.schedulePass();
          if (evName === "CHARACTER_EDITED") {
            drawerPanel.refreshActiveScan(resolveActiveContextCharacterId() ?? undefined);
          }
          if (evName === "CHAT_SWITCHED" || evName === "CHARACTER_EDITED") {
            handleActiveCharacterContextChanged(true);
          }
        });
        if (typeof off === "function") {
          boundRefreshEvents.add(evName);
          cleanups.push(off);
        }
      } catch {
        // Permission may not be granted yet
      }
    }
  }
  bindPermissionGatedSubscriptions();

  // Re-bind deferred registrations once permissions resolve (including partial/denied grants)
  try {
    if (ctx.permissions?.getGranted) {
      void ctx.permissions
        .getGranted()
        .then(async (granted) => {
          if (unloaded) return;
          const grantedSet = new Set(Array.isArray(granted) ? granted : []);
          const missing = REQUIRED_PERMISSIONS.filter(
            (p) => !grantedSet.has(p),
          );
          if (missing.length > 0 && ctx.permissions?.request) {
            try {
              const updated = await ctx.permissions.request([...missing]);
              const updatedSet = new Set(Array.isArray(updated) ? updated : []);
              const stillMissing = REQUIRED_PERMISSIONS.filter(
                (p) => !updatedSet.has(p) && !grantedSet.has(p),
              );
              if (stillMissing.length > 0) {
                console.warn(
                  `[media_localizer] Some permissions were not granted (${stillMissing.join(", ")}); continuing with available permissions.`,
                );
              }
            } catch (err) {
              console.warn(
                "[media_localizer] Permission request was denied or failed; continuing with available permissions:",
                err,
              );
            }
          }
          if (unloaded) return;
          bindPermissionGatedSubscriptions();
          handleActiveCharacterContextChanged(true);
        })
        .catch((err) => {
          if (unloaded) return;
          console.warn("[media_localizer] Failed checking granted permissions:", err);
          bindPermissionGatedSubscriptions();
          handleActiveCharacterContextChanged(true);
        });
    }
  } catch {
    // ignore
  }

  // 10. Initial Bootstrap
  void callBackend<{
    urlMapPayload: ActiveDisplayUrlMapPayload;
    stats: StorageStatsSummary;
    queueProgress: QueueJobProgress;
  }>("get_init_state")
    .then((init) => {
      if (unloaded) return;
      if (init.stats && !hasLiveStatsUpdate) {
        currentStats = init.stats;
        currentSettings = init.stats.settings;
      }
      if (init.queueProgress && !hasLiveQueueUpdate) {
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
