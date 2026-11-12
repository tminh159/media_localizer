import type { CharacterDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { UnmatchedGalleryCandidate } from "./core/downloader.ts";
import {
  reconcileCharacterGalleryWithIndex,
  refreshScanResultWithIndexState,
} from "./core/gallery-reconciler.ts";
import { MediaIndexStore } from "./core/index-store.ts";
import { MediaQueueManager, type QueuedMediaTask } from "./core/queue.ts";
import { buildEffectiveFilter, sanitizeOverride } from "./shared/download-config.ts";
import { buildLibraryMedia } from "./shared/library-media.ts";
import {
  type CharacterMediaScanResult,
  type DownloadFilterOptions,
  type LibraryCharacterSummary,
  type MediaLocalizerSettings,
  type MediaSourceSection,
  type PendingGalleryLinkItem,
} from "./shared/types.ts";
import {
  filterScanItemsForDownload,
  scanCharacterMedia,
  type ScannableRegexScriptInput,
  type ScannableWorldBookInput,
} from "./shared/url-scanner.ts";

declare const spindle: SpindleAPI;

const MAX_KNOWN_USERS = 500;
const MAX_CHARACTER_CACHE_ENTRIES = 500;
const CHARACTER_SCAN_CACHE_TTL_MS = 60_000;
const MIN_FILE_SIZE_BYTES = 1 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function logWarn(message: string, err?: unknown): void {
  const full =
    err !== undefined
      ? `[media_localizer] ${message} ${formatErrorMessage(err)}`
      : `[media_localizer] ${message}`;
  try {
    if (typeof spindle?.log?.warn === "function") {
      spindle.log.warn(full);
      return;
    }
  } catch {
    // Fall back to console.warn if spindle.log is unavailable
  }
  console.warn(full);
}

function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function getLruMapEntry<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key)!;
  map.delete(key);
  map.set(key, value);
  return value;
}

interface CharacterScanCacheEntry {
  userId: string;
  characterId: string;
  includeResources: boolean;
  wbIds: string[];
  updatedAt: string;
  scanBareUrls: boolean;
  wbIdsKey: string;
  cachedAt: number;
  scan: CharacterMediaScanResult;
}

const indexStore = new MediaIndexStore(spindle.userStorage);
const knownUsers = new Set<string>();
const unmatchedGalleryCache = new Map<
  string,
  { userId: string; characterId: string; items: UnmatchedGalleryCandidate[] }
>();
const pendingGalleryLinksCache = new Map<
  string,
  { userId: string; characterId: string; items: PendingGalleryLinkItem[] }
>();
const characterScanCache = new Map<string, CharacterScanCacheEntry>();
const inFlightAutoLocalize = new Set<string>();
const failedWorldBookPromises = new WeakSet<Promise<ScannableWorldBookInput | null>>();

function recordKnownUser(userId: string): void {
  if (knownUsers.has(userId)) {
    knownUsers.delete(userId);
  }
  knownUsers.add(userId);
  while (knownUsers.size > MAX_KNOWN_USERS) {
    const oldest = knownUsers.values().next().value;
    if (oldest === undefined) break;
    knownUsers.delete(oldest);
  }
}

function readCharUpdatedAtKey(character: CharacterDTO): string {
  const raw = (character as unknown as { updated_at?: unknown }).updated_at;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

function resolveActingUser(userId?: string | null): string | undefined {
  if (typeof userId === "string" && userId.trim().length > 0) {
    recordKnownUser(userId);
    return userId;
  }
  return knownUsers.size === 1 ? knownUsers.values().next().value : undefined;
}

function evictCharacterCaches(
  characterId: string,
  targetUsers: string[] | null,
  options?: { scanOnly?: boolean },
): void {
  if (targetUsers && targetUsers.length > 0) {
    for (const userId of targetUsers) {
      const key = `${userId}:${characterId}`;
      characterScanCache.delete(key);
      if (!options?.scanOnly) {
        unmatchedGalleryCache.delete(key);
        pendingGalleryLinksCache.delete(key);
      }
    }
    return;
  }

  for (const [key, entry] of characterScanCache.entries()) {
    if (entry.characterId === characterId) {
      characterScanCache.delete(key);
    }
  }
  if (!options?.scanOnly) {
    for (const [key, entry] of unmatchedGalleryCache.entries()) {
      if (entry.characterId === characterId) {
        unmatchedGalleryCache.delete(key);
      }
    }
    for (const [key, entry] of pendingGalleryLinksCache.entries()) {
      if (entry.characterId === characterId) {
        pendingGalleryLinksCache.delete(key);
      }
    }
  }
}

function invalidateUserScanCaches(targetUsers: string[] | null): void {
  if (!targetUsers) {
    characterScanCache.clear();
    return;
  }
  const userSet = new Set(targetUsers);
  for (const [key, entry] of characterScanCache.entries()) {
    if (userSet.has(entry.userId)) {
      characterScanCache.delete(key);
    }
  }
}

function invalidateWorldBookScanCaches(
  worldBookId: string | undefined,
  targetUsers: string[] | null,
): void {
  const userSet = targetUsers ? new Set(targetUsers) : null;
  for (const [key, entry] of characterScanCache.entries()) {
    if (userSet && !userSet.has(entry.userId)) continue;
    if (!entry.includeResources) continue;
    if (worldBookId ? entry.wbIds.includes(worldBookId) : entry.wbIds.length > 0) {
      characterScanCache.delete(key);
    }
  }
}

function invalidateRegexScanCaches(
  scope: string,
  scopeId: string,
  targetUsers: string[] | null,
): void {
  if (scope === "character" && scopeId) {
    evictCharacterCaches(scopeId, targetUsers, { scanOnly: true });
    return;
  }
  if (scope === "global" || scope === "chat") {
    return;
  }
  const userSet = targetUsers ? new Set(targetUsers) : null;
  for (const [key, entry] of characterScanCache.entries()) {
    if (userSet && !userSet.has(entry.userId)) continue;
    if (entry.includeResources) {
      characterScanCache.delete(key);
    }
  }
}

async function syncUrlMapToFrontend(userId: string): Promise<void> {
  try {
    const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
    spindle.sendToFrontend(
      {
        type: "URL_MAP_UPDATED",
        urlMapPayload,
      },
      userId,
    );
  } catch (err) {
    logWarn("Failed to sync URL map:", err);
  }
}

try {
  spindle.rpcPool?.handle?.(
    "media_localizer.url_map",
    async (_ctx) => {
      if (knownUsers.size === 1) {
        const soleUserId = knownUsers.values().next().value;
        if (soleUserId) {
          return indexStore.buildActiveDisplayUrlMap(soleUserId);
        }
      }
      if (knownUsers.size === 0) {
        try {
          // User-scoped extensions infer the extension owner when userId is omitted.
          return await indexStore.buildActiveDisplayUrlMap(
            undefined as unknown as string,
          );
        } catch (err) {
          logWarn(
            "media_localizer.url_map could not resolve default user storage before any user session:",
            err,
          );
          return null;
        }
      }
      logWarn(
        `media_localizer.url_map cannot disambiguate across ${knownUsers.size} known users because SharedRpcRequestContextDTO carries no userId.`,
      );
      return null;
    },
    { requires: [] },
  );
} catch (err) {
  logWarn("Failed to register media_localizer.url_map RPC handler:", err);
}

const urlMapSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Coalesces bursts of changes (e.g. one per downloaded file) into a single URL-map broadcast. */
function scheduleUrlMapSync(userId: string): void {
  if (urlMapSyncTimers.has(userId)) return;
  urlMapSyncTimers.set(
    userId,
    setTimeout(() => {
      urlMapSyncTimers.delete(userId);
      void syncUrlMapToFrontend(userId);
    }, 200),
  );
}

const queueManager = new MediaQueueManager(
  spindle,
  indexStore,
  (userId, progress, newAsset) => {
    try {
      spindle.sendToFrontend(
        {
          type: "QUEUE_PROGRESS",
          progress,
          ...(newAsset ? { newAsset } : {}),
        },
        userId,
      );
    } catch (err) {
      logWarn("Failed to send QUEUE_PROGRESS to frontend:", err);
    }
    if (
      newAsset ||
      progress.status === "completed" ||
      progress.status === "cancelled"
    ) {
      scheduleUrlMapSync(userId);
    }
    if (progress.status === "completed" && progress.totalQueued > 0) {
      try {
        if (progress.failedCount > 0) {
          spindle.toast?.warning?.(
            `Localized ${progress.succeededCount} of ${progress.totalQueued} media files (${progress.failedCount} failed).`,
            { title: "Media Localizer", userId },
          );
        } else if (progress.succeededCount > 0) {
          spindle.toast?.success?.(
            `Successfully localized ${progress.succeededCount} media file${progress.succeededCount === 1 ? "" : "s"}.`,
            { title: "Media Localizer", userId },
          );
        }
      } catch (err) {
        logWarn("Failed to show queue completion toast:", err);
      }
    }
  },
);

function extractCharacterWorldBookIds(character: CharacterDTO): string[] {
  const ids = new Set<string>();
  if (Array.isArray(character.world_book_ids)) {
    for (const id of character.world_book_ids) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  const ext = character.extensions;
  if (ext && typeof ext === "object") {
    const extIds = (ext as Record<string, unknown>).world_book_ids ??
      (ext as Record<string, unknown>).world_books;
    if (Array.isArray(extIds)) {
      for (const id of extIds) {
        if (typeof id === "string" && id.trim()) ids.add(id.trim());
      }
    }
  }
  return Array.from(ids);
}

function extractEmbeddedCharacterBook(
  character: CharacterDTO,
): ScannableWorldBookInput | null {
  const ext = character.extensions;
  if (!ext || typeof ext !== "object") return null;
  const charBook = (ext as Record<string, unknown>).character_book;
  if (!charBook || typeof charBook !== "object") return null;

  const rawEntries = (charBook as Record<string, unknown>).entries;
  const entriesList: Array<{ id?: string; comment?: string | null; content?: string | null }> = [];

  if (Array.isArray(rawEntries)) {
    for (const entry of rawEntries) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.content === "string" && e.content.trim()) {
          entriesList.push({
            id: typeof e.id === "string" || typeof e.id === "number" ? String(e.id) : undefined,
            comment: typeof e.comment === "string" ? e.comment : typeof e.name === "string" ? e.name : null,
            content: e.content,
          });
        }
      }
    }
  } else if (rawEntries && typeof rawEntries === "object") {
    for (const entry of Object.values(rawEntries as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.content === "string" && e.content.trim()) {
          entriesList.push({
            id: typeof e.id === "string" || typeof e.id === "number" ? String(e.id) : undefined,
            comment: typeof e.comment === "string" ? e.comment : typeof e.name === "string" ? e.name : null,
            content: e.content,
          });
        }
      }
    }
  }

  if (entriesList.length === 0) return null;
  const bookName =
    typeof (charBook as Record<string, unknown>).name === "string" &&
    ((charBook as Record<string, unknown>).name as string).trim()
      ? ((charBook as Record<string, unknown>).name as string).trim()
      : "Embedded Lorebook";

  return {
    id: "__embedded_character_book__",
    name: bookName,
    entries: entriesList,
  };
}

async function fetchWorldBookWithEntries(
  wbId: string,
  userId: string,
  onError?: () => void,
): Promise<ScannableWorldBookInput | null> {
  try {
    const wb = await spindle.world_books.get(wbId, userId);
    if (!wb) return null;
    const entries: ScannableWorldBookInput["entries"] = [];
    let offset = 0;
    const pageLimit = 200;
    for (let page = 0; page < 100; page++) {
      const entriesRes = await spindle.world_books.entries.list(wbId, {
        limit: pageLimit,
        offset,
        userId,
      });
      const rows = Array.isArray(entriesRes?.data) ? entriesRes.data : [];
      if (rows.length === 0) break;
      for (const e of rows) {
        entries.push({
          id: e.id,
          comment: e.comment,
          content: e.content,
        });
      }
      offset += rows.length;
      const total = typeof entriesRes?.total === "number" ? entriesRes.total : offset;
      if (rows.length < pageLimit || offset >= total) break;
    }
    return {
      id: wb.id,
      name: wb.name || wb.id,
      entries,
    };
  } catch (err) {
    logWarn(`Failed to fetch world book ${wbId}:`, err);
    onError?.();
    return null;
  }
}

async function fetchCharacterRegexScripts(
  characterId: string,
  userId: string,
): Promise<{ scripts: ScannableRegexScriptInput[]; failed: boolean }> {
  const regexScripts: ScannableRegexScriptInput[] = [];
  let failed = false;
  try {
    let offset = 0;
    const pageLimit = 200;
    for (let page = 0; page < 50; page++) {
      const scriptsRes = await spindle.regex_scripts.list({
        scope: "character",
        scopeId: characterId,
        limit: pageLimit,
        offset,
        userId,
      });
      const scripts = Array.isArray(scriptsRes?.data) ? scriptsRes.data : [];
      if (scripts.length === 0) break;
      for (const s of scripts) {
        regexScripts.push({
          id: s.id,
          script_name: s.name,
          replace_string: s.replace_string,
        });
      }
      offset += scripts.length;
      const total = typeof scriptsRes?.total === "number" ? scriptsRes.total : offset;
      if (scripts.length < pageLimit || offset >= total) break;
    }
  } catch (err) {
    failed = true;
    logWarn(`Failed to fetch regex scripts for character ${characterId}:`, err);
  }
  return { scripts: regexScripts, failed };
}

export async function performCharacterScan(
  userId: string,
  characterId: string,
  includeResources = true,
  worldBookCache?: Map<string, Promise<ScannableWorldBookInput | null>>,
  options?: {
    preloadedCharacter?: CharacterDTO;
    forceRefresh?: boolean;
  },
): Promise<CharacterMediaScanResult> {
  const character =
    options?.preloadedCharacter ?? (await spindle.characters.get(characterId, userId));
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const state = await indexStore.getState(userId);
  const override = state.characterOverrides[characterId] ?? null;
  const cacheKey = `${userId}:${characterId}`;
  const wbIds = includeResources ? extractCharacterWorldBookIds(character) : [];
  const wbIdsKey = `${includeResources ? "1" : "0"}:${wbIds.join(",")}`;
  const updatedAtKey = readCharUpdatedAtKey(character);
  const cachedRaw = !options?.forceRefresh ? characterScanCache.get(cacheKey) : undefined;
  const now = Date.now();
  const isCacheValid = Boolean(
    cachedRaw &&
      updatedAtKey !== "" &&
      cachedRaw.updatedAt === updatedAtKey &&
      cachedRaw.scanBareUrls === state.settings.scanBareUrls &&
      cachedRaw.wbIdsKey === wbIdsKey &&
      now - cachedRaw.cachedAt < CHARACTER_SCAN_CACHE_TTL_MS,
  );
  if (cachedRaw && !isCacheValid) {
    characterScanCache.delete(cacheKey);
  }

  let scan: CharacterMediaScanResult;
  if (isCacheValid && cachedRaw) {
    const cached = getLruMapEntry(characterScanCache, cacheKey) ?? cachedRaw;
    scan = {
      ...cached.scan,
      sectionCounts: { ...cached.scan.sectionCounts },
      override,
      scannedAt: now,
      items: cached.scan.items.map((item) => ({ ...item })),
    };
    refreshScanResultWithIndexState(scan, state.assets, state.failedUrls);
  } else {
    const worldBooks: ScannableWorldBookInput[] = [];
    let regexScripts: ScannableRegexScriptInput[] = [];
    let resourceFetchFailed = false;

    if (includeResources) {
      for (const wbId of wbIds) {
        let wbPromise = worldBookCache?.get(wbId);
        if (!wbPromise) {
          let wbFailed = false;
          let created!: Promise<ScannableWorldBookInput | null>;
          created = fetchWorldBookWithEntries(wbId, userId, () => {
            wbFailed = true;
          }).then((res) => {
            if (wbFailed) {
              failedWorldBookPromises.add(created);
            }
            return res;
          });
          wbPromise = created;
          worldBookCache?.set(wbId, wbPromise);
        }
        const loadedWb = await wbPromise;
        if (failedWorldBookPromises.has(wbPromise)) {
          resourceFetchFailed = true;
        }
        if (loadedWb) {
          worldBooks.push(loadedWb);
        }
      }

      // Fall back to embedded character_book only if no linked World Books were loaded
      if (worldBooks.length === 0) {
        const embeddedBook = extractEmbeddedCharacterBook(character);
        if (embeddedBook) {
          worldBooks.push(embeddedBook);
        }
      }

      const regexRes = await fetchCharacterRegexScripts(characterId, userId);
      regexScripts = regexRes.scripts;
      if (regexRes.failed) {
        resourceFetchFailed = true;
      }
    }

    const localizedMap = new Map(Object.entries(state.assets));
    const failedMap = new Map(Object.entries(state.failedUrls));

    scan = scanCharacterMedia(character, worldBooks, regexScripts, {
      override,
      localizedByNormalizedUrl: localizedMap,
      failedByNormalizedUrl: failedMap,
      scanBareUrls: state.settings.scanBareUrls,
    });

    if (updatedAtKey !== "" && !resourceFetchFailed) {
      setBoundedMapEntry(
        characterScanCache,
        cacheKey,
        {
          userId,
          characterId,
          includeResources,
          wbIds,
          updatedAt: updatedAtKey,
          scanBareUrls: state.settings.scanBareUrls,
          wbIdsKey,
          cachedAt: Date.now(),
          scan,
        },
        MAX_CHARACTER_CACHE_ENTRIES,
      );
    }
  }

  // Opportunistically link shared assets already localized by another character
  let linkedAny = false;
  for (const item of scan.items) {
    if (
      item.status === "localized" &&
      item.localizedEntry &&
      !item.localizedEntry.characterIds.includes(characterId)
    ) {
      await indexStore.linkExistingAssetToCharacter(
        userId,
        item.normalizedUrl,
        item.rawUrls,
        characterId,
      );
      linkedAny = true;
    }
  }

  // Reconcile native Lumiverse Gallery (`character_gallery` + `images`) with MediaIndexStore:
  // - Adopts images downloaded to the native Gallery when the extension was off (zero redownload)
  // - Prunes localized links if the user deleted an item from the native Gallery
  // - Collects any localized images that still need to be linked into `character_gallery`
  const reconciliation = await reconcileCharacterGalleryWithIndex(
    spindle,
    indexStore,
    userId,
    character,
    scan.items,
  );

  if (reconciliation.unmatchedGalleryCandidates.length > 0) {
    setBoundedMapEntry(
      unmatchedGalleryCache,
      cacheKey,
      {
        userId,
        characterId,
        items: reconciliation.unmatchedGalleryCandidates,
      },
      MAX_CHARACTER_CACHE_ENTRIES,
    );
  } else {
    unmatchedGalleryCache.delete(cacheKey);
  }

  if (reconciliation.pendingGalleryLinks.length > 0) {
    setBoundedMapEntry(
      pendingGalleryLinksCache,
      cacheKey,
      {
        userId,
        characterId,
        items: reconciliation.pendingGalleryLinks,
      },
      MAX_CHARACTER_CACHE_ENTRIES,
    );
  } else {
    pendingGalleryLinksCache.delete(cacheKey);
  }

  if (reconciliation.indexChanged || linkedAny) {
    const updatedState = await indexStore.getState(userId);
    refreshScanResultWithIndexState(
      scan,
      updatedState.assets,
      updatedState.failedUrls,
    );
    scheduleUrlMapSync(userId);
  }

  {
    const mediaState = await indexStore.getState(userId);
    scan.media =
      buildLibraryMedia(
        [
          {
            id: character.id,
            name: character.name,
            image_id: (character as { image_id?: string | null }).image_id ?? null,
            extensions: (character.extensions as Record<string, unknown> | null) ?? null,
          },
        ],
        mediaState.assets,
        { includeEmpty: true },
      )[0] ?? null;
  }

  if (state.settings.autoLinkGallery && reconciliation.pendingGalleryLinks.length > 0) {
    try {
      spindle.sendToFrontend(
        {
          type: "ENSURE_GALLERY_LINKS",
          characterId,
          links: reconciliation.pendingGalleryLinks,
        },
        userId,
      );
    } catch (err) {
      logWarn(`Failed to send ENSURE_GALLERY_LINKS for character ${characterId}:`, err);
    }
  }

  return scan;
}

export async function performLibraryScan(
  userId: string,
  options?: { forceRefresh?: boolean },
): Promise<{
  characters: LibraryCharacterSummary[];
  totalUniqueRemote: number;
}> {
  const allCharacters: CharacterDTO[] = [];
  let offset = 0;
  const pageLimit = 500;
  for (let page = 0; page < 20; page++) {
    const allCharactersRes = await spindle.characters.list({
      limit: pageLimit,
      offset,
      userId,
    });
    const rows = Array.isArray(allCharactersRes?.data)
      ? allCharactersRes.data
      : [];
    allCharacters.push(...rows);
    offset += rows.length;
    const total =
      typeof allCharactersRes?.total === "number"
        ? allCharactersRes.total
        : rows.length;
    if (rows.length < pageLimit || offset >= total) break;
  }

  const summaries: LibraryCharacterSummary[] = [];
  const globalRemoteUrls = new Set<string>();
  const worldBookCache = new Map<string, Promise<ScannableWorldBookInput | null>>();

  const scanOneCharacter = async (char: CharacterDTO): Promise<LibraryCharacterSummary> => {
    const scan = await performCharacterScan(userId, char.id, true, worldBookCache, {
      preloadedCharacter: char,
      forceRefresh: Boolean(options?.forceRefresh),
    });

    let localizedCount = 0;
    let remoteCount = 0;
    let failedCount = 0;
    let localizedBytes = 0;
    for (const item of scan.items) {
      if (item.status === "localized") {
        localizedCount++;
        localizedBytes += item.localizedEntry?.sizeBytes ?? 0;
      }
      else if (item.status === "failed") {
        failedCount++;
        globalRemoteUrls.add(item.normalizedUrl);
      } else {
        remoteCount++;
        globalRemoteUrls.add(item.normalizedUrl);
      }
    }

    const sectionRemoteCounts: Record<MediaSourceSection, number> = {
      creator_notes:
        scan.sectionCounts.creator_notes.remoteCount +
        scan.sectionCounts.creator_notes.failedCount,
      first_mes:
        scan.sectionCounts.first_mes.remoteCount +
        scan.sectionCounts.first_mes.failedCount,
      core_fields:
        scan.sectionCounts.core_fields.remoteCount +
        scan.sectionCounts.core_fields.failedCount,
      alternate_greetings:
        scan.sectionCounts.alternate_greetings.remoteCount +
        scan.sectionCounts.alternate_greetings.failedCount,
      world_books:
        scan.sectionCounts.world_books.remoteCount +
        scan.sectionCounts.world_books.failedCount,
      regex_scripts:
        scan.sectionCounts.regex_scripts.remoteCount +
        scan.sectionCounts.regex_scripts.failedCount,
    };

    return {
      characterId: char.id,
      characterName: char.name,
      totalUnique: scan.items.length,
      localizedCount,
      localizedBytes,
      remoteCount,
      failedCount,
      sectionRemoteCounts,
    };
  };

  // Process library characters with bounded concurrency (6 at a time)
  const concurrency = 6;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, allCharacters.length) },
    async () => {
      while (cursor < allCharacters.length) {
        const idx = cursor++;
        const char = allCharacters[idx];
        if (!char) continue;
        try {
          const summary = await scanOneCharacter(char);
          summaries.push(summary);
        } catch (err) {
          logWarn(
            `Failed to scan character ${char.id} (${char.name}) during library scan:`,
            err,
          );
        }
      }
    },
  );
  await Promise.all(workers);

  summaries.sort(
    (a, b) =>
      b.remoteCount + b.failedCount - (a.remoteCount + a.failedCount) ||
      b.totalUnique - a.totalUnique ||
      a.characterName.localeCompare(b.characterName),
  );

  return {
    characters: summaries,
    totalUniqueRemote: globalRemoteUrls.size,
  };
}

export async function handleFrontendRpcAction(
  userId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  switch (action) {
    case "get_init_state": {
      const [urlMapPayload, stats] = await Promise.all([
        indexStore.buildActiveDisplayUrlMap(userId),
        indexStore.getStorageStats(userId),
      ]);
      const queueProgress = queueManager.getQueue(userId).getProgress();
      return { urlMapPayload, stats, queueProgress };
    }

    case "scan_character": {
      const characterId = String(payload.characterId ?? "").trim();
      if (!characterId) throw new Error("characterId is required");
      const forceRefresh = Boolean(payload.forceRefresh);
      const scan = await performCharacterScan(userId, characterId, true, undefined, {
        forceRefresh,
      });
      const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
      const { settings } = await indexStore.getState(userId);
      const pendingGalleryLinks = settings.autoLinkGallery
        ? (getLruMapEntry(pendingGalleryLinksCache, `${userId}:${characterId}`)?.items ?? [])
        : [];
      return { scan, urlMapPayload, pendingGalleryLinks };
    }

    case "scan_library": {
      const forceRefresh = payload.forceRefresh === true;
      const result = await performLibraryScan(userId, { forceRefresh });
      const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
      return { ...result, urlMapPayload };
    }

    case "enqueue_download": {
      const filter = (payload.filter ?? {}) as DownloadFilterOptions;
      const useCharacterOverrides = Boolean(payload.useCharacterOverrides);
      const charIds = Array.isArray(filter.characterIds)
        ? filter.characterIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [];
      if (charIds.length === 0) {
        throw new Error("Select at least one character to localize");
      }

      const state = await indexStore.getState(userId);
      const settings = state.settings;
      const tasks: QueuedMediaTask[] = [];

      const definedFilter = Object.fromEntries(
        Object.entries(filter).filter(([, v]) => v !== undefined),
      ) as Partial<DownloadFilterOptions>;
      const hasValidFilterMaxItems =
        typeof filter.maxItems === "number" &&
        Number.isFinite(filter.maxItems) &&
        filter.maxItems >= 0;
      let resolvedMaxItems = hasValidFilterMaxItems
        ? Math.floor(filter.maxItems as number)
        : settings.defaultBatchCap;

      for (const charId of charIds) {
        const scan = await performCharacterScan(userId, charId, true);
        const unmatchedCandidates = getLruMapEntry(
          unmatchedGalleryCache,
          `${userId}:${scan.characterId}`,
        )?.items;
        const effective = useCharacterOverrides
          ? buildEffectiveFilter(settings, scan)
          : null;
        if (
          effective &&
          charIds.length === 1 &&
          !hasValidFilterMaxItems &&
          typeof effective.maxItems === "number" &&
          Number.isFinite(effective.maxItems) &&
          effective.maxItems >= 0
        ) {
          resolvedMaxItems = Math.floor(effective.maxItems);
        }
        const charFilter: Omit<DownloadFilterOptions, "characterIds"> = effective
          ? { ...effective, ...definedFilter }
          : filter;
        const matchingItems = filterScanItemsForDownload(scan, charFilter);
        for (const item of matchingItems) {
          tasks.push({
            characterId: scan.characterId,
            characterName: scan.characterName,
            normalizedUrl: item.normalizedUrl,
            rawUrls: item.rawUrls,
            ...(unmatchedCandidates && unmatchedCandidates.length > 0
              ? { unmatchedGalleryCandidates: unmatchedCandidates }
              : {}),
          });
        }
      }

      const clampPositiveInt = (
        raw: unknown,
        fallback: number,
        min: number,
        max: number,
      ): number => {
        const value =
          typeof raw === "number" && Number.isFinite(raw) && raw > 0
            ? Math.floor(raw)
            : fallback;
        return Math.min(max, Math.max(min, value));
      };

      const maxItems = resolvedMaxItems;
      const maxFileSizeBytes = clampPositiveInt(
        filter.maxFileSizeBytes,
        settings.maxFileSizeMb * 1024 * 1024,
        MIN_FILE_SIZE_BYTES,
        MAX_FILE_SIZE_BYTES,
      );
      const timeoutMs = clampPositiveInt(
        filter.timeoutMs,
        settings.timeoutSeconds * 1000,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      );
      const concurrency = clampPositiveInt(
        filter.concurrency,
        settings.concurrency,
        MIN_CONCURRENCY,
        MAX_CONCURRENCY,
      );

      const queueProgress = await queueManager
        .getQueue(userId)
        .startOrAppendBatch({
          userId,
          tasks,
          maxItems,
          maxFileSizeBytes,
          timeoutMs,
          concurrency,
        });

      return { queueProgress };
    }

    case "queue_control": {
      const control = String(payload.control ?? "");
      const targetUrl =
        typeof payload.targetUrl === "string" ? payload.targetUrl : undefined;
      const q = queueManager.getQueue(userId);
      let queueProgress;
      if (control === "pause") queueProgress = q.pause();
      else if (control === "resume") queueProgress = q.resume();
      else if (control === "skip_current") queueProgress = q.skipCurrent(targetUrl);
      else if (control === "cancel_all") queueProgress = q.cancelAll();
      else queueProgress = q.getProgress();
      return { queueProgress };
    }

    case "save_character_override": {
      const characterId = String(payload.characterId ?? "").trim();
      if (!characterId) throw new Error("characterId is required");
      const override =
        payload.override === null ? null : sanitizeOverride(payload.override);
      await indexStore.setCharacterOverride(userId, characterId, override);
      return { override };
    }

    case "list_library_media": {
      const includeEmpty = Boolean(payload?.includeEmpty);
      const allCharacters: CharacterDTO[] = [];
      let offset = 0;
      const pageLimit = 500;
      for (let page = 0; page < 20; page++) {
        const res = await spindle.characters.list({ limit: pageLimit, offset, userId });
        const rows = Array.isArray(res?.data) ? res.data : [];
        allCharacters.push(...rows);
        offset += rows.length;
        const total = typeof res?.total === "number" ? res.total : rows.length;
        if (rows.length < pageLimit || offset >= total) break;
      }
      const { assets } = await indexStore.getState(userId);
      const characters = buildLibraryMedia(
        allCharacters.map((c) => ({
          id: c.id,
          name: c.name,
          image_id: (c as { image_id?: string | null }).image_id ?? null,
          extensions: (c.extensions as Record<string, unknown> | null) ?? null,
        })),
        assets,
        { includeEmpty },
      );
      return { characters };
    }

    case "auto_localize_character": {
      const characterId = String(payload.characterId ?? "").trim();
      if (!characterId) throw new Error("characterId is required");
      const state = await indexStore.getState(userId);
      if (!state.settings.autoLocalizeOnOpen) return { started: false };
      if (state.autoLocalizedCharacterIds.includes(characterId)) {
        return { started: false };
      }
      const lockKey = `${userId}:${characterId}`;
      if (inFlightAutoLocalize.has(lockKey)) return { started: false };
      inFlightAutoLocalize.add(lockKey);
      try {
        const scan = await performCharacterScan(userId, characterId, true);
        const filter = buildEffectiveFilter(state.settings, scan);
        const matching = filterScanItemsForDownload(scan, filter);
        if (matching.length === 0) {
          await indexStore.markAutoLocalized(userId, characterId);
          return { started: false };
        }
        const result = (await handleFrontendRpcAction(userId, "enqueue_download", {
          filter: { ...filter, characterIds: [characterId] },
        })) as { queueProgress: unknown };
        await indexStore.markAutoLocalized(userId, characterId);
        return { started: true, queueProgress: result.queueProgress };
      } finally {
        inFlightAutoLocalize.delete(lockKey);
      }
    }

    case "update_settings": {
      const patch = (payload.patch ?? {}) as Partial<MediaLocalizerSettings>;
      const settings = await indexStore.updateSettings(userId, patch);
      const stats = await indexStore.getStorageStats(userId);
      const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
      scheduleUrlMapSync(userId);
      return { settings, stats, urlMapPayload };
    }

    case "clear_failed": {
      const urls = Array.isArray(payload.urls)
        ? payload.urls.filter((u): u is string => typeof u === "string")
        : undefined;
      const cleared = await indexStore.clearFailedUrls(userId, urls);
      const stats = await indexStore.getStorageStats(userId);
      return { cleared, stats };
    }

    case "record_gallery_links": {
      const rawLinks = Array.isArray(payload.links) ? payload.links : [];
      const links: Array<{
        characterId: string;
        normalizedUrl?: string;
        imageId: string;
        galleryItemId: string;
      }> = [];
      for (const item of rawLinks) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const characterId = String(obj.characterId ?? "").trim();
        const imageId = String(obj.imageId ?? "").trim();
        const galleryItemId = String(obj.galleryItemId ?? "").trim();
        const normalizedUrl =
          typeof obj.normalizedUrl === "string" && obj.normalizedUrl.trim()
            ? obj.normalizedUrl.trim()
            : undefined;
        if (characterId && imageId && galleryItemId) {
          links.push({
            characterId,
            imageId,
            galleryItemId,
            ...(normalizedUrl ? { normalizedUrl } : {}),
          });
        }
      }
      const updated = await indexStore.recordGalleryLinks(userId, links);
      return { updated };
    }

    case "purge_character_cache":
    case "purge_characters": {
      const targetCharacterIds =
        action === "purge_characters" && Array.isArray(payload.characterIds)
          ? payload.characterIds
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((id) => id.trim())
          : [String(payload.characterId ?? "").trim()].filter(Boolean);
      if (targetCharacterIds.length === 0) {
        throw new Error("characterId is required");
      }
      const urls =
        action === "purge_character_cache" && Array.isArray(payload.urls)
          ? payload.urls.filter((u): u is string => typeof u === "string")
          : undefined;

      const state = await indexStore.getState(userId);
      const deleteImages = state.settings.deleteImagesOnPurge;
      const allOrphanedImageIds = new Set<string>();
      const allRemovedGalleryItemIds = new Set<string>();
      const allRemovedImageIds = new Set<string>();
      let removedCount = 0;

      for (const characterId of targetCharacterIds) {
        const res = await indexStore.removeCharacterAssets(userId, characterId, urls);
        removedCount += res.removedCount;
        for (const id of res.orphanedImageIds) allOrphanedImageIds.add(id);
        for (const id of res.removedGalleryItemIds) allRemovedGalleryItemIds.add(id);
        for (const id of res.removedImageIds) allRemovedImageIds.add(id);
      }

      const orphanedImageIds = Array.from(allOrphanedImageIds);
      let deletedImagesCount = 0;
      if (deleteImages && orphanedImageIds.length > 0) {
        try {
          await spindle.images.deleteMany(orphanedImageIds, { userId });
          deletedImagesCount = orphanedImageIds.length;
        } catch (err) {
          logWarn("Failed to delete orphaned images:", err);
        }
      }

      const [stats, urlMapPayload] = await Promise.all([
        indexStore.getStorageStats(userId),
        indexStore.buildActiveDisplayUrlMap(userId),
      ]);
      scheduleUrlMapSync(userId);
      return {
        removedCount,
        deletedImagesCount,
        removedGalleryItemIds: deleteImages ? Array.from(allRemovedGalleryItemIds) : [],
        removedImageIds: deleteImages ? Array.from(allRemovedImageIds) : [],
        stats,
        urlMapPayload,
      };
    }

    default:
      throw new Error(`Unknown RPC action: ${action}`);
  }
}

spindle.onFrontendMessage(async (msg: unknown, rawUserId: string) => {
  if (!msg || typeof msg !== "object") return;
  const envelope = msg as Record<string, unknown>;
  if (envelope.type !== "RPC_REQUEST") return;

  const requestId = String(envelope.requestId ?? "");
  const action = String(envelope.action ?? "");
  const payload =
    envelope.payload && typeof envelope.payload === "object"
      ? (envelope.payload as Record<string, unknown>)
      : {};
  const userId = resolveActingUser(rawUserId);
  if (!userId) {
    if (requestId) {
      spindle.sendToFrontend(
        {
          type: "RPC_RESPONSE",
          requestId,
          error: "Could not resolve active user session",
        },
        rawUserId,
      );
    }
    return;
  }

  try {
    const result = await handleFrontendRpcAction(userId, action, payload);
    if (requestId) {
      spindle.sendToFrontend(
        {
          type: "RPC_RESPONSE",
          requestId,
          result,
        },
        userId,
      );
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (requestId) {
      spindle.sendToFrontend(
        {
          type: "RPC_RESPONSE",
          requestId,
          error: errorMsg,
        },
        userId,
      );
    }
  }
});

function extractStringField(
  obj: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return "";
}

function resolveEventUsers(
  event: unknown,
  rawUserId?: string,
): {
  ev: Record<string, unknown> | null;
  explicitUserId?: string;
  targetUsers: string[];
} {
  const ev =
    event && typeof event === "object" ? (event as Record<string, unknown>) : null;
  const fromRaw =
    typeof rawUserId === "string" && rawUserId.trim().length > 0
      ? rawUserId.trim()
      : "";
  const fromEvent = ev ? extractStringField(ev, "userId", "user_id") : "";
  const explicitUserId = fromRaw || fromEvent || resolveActingUser(undefined);
  if (explicitUserId) {
    recordKnownUser(explicitUserId);
    return { ev, explicitUserId, targetUsers: [explicitUserId] };
  }
  return {
    ev,
    explicitUserId: undefined,
    targetUsers: Array.from(knownUsers.values()),
  };
}

// Keep knownUsers and scan caches fresh across host lifecycle and resource edits
spindle.on("CONNECTED", (event: unknown, rawUserId?: string) => {
  resolveEventUsers(event, rawUserId);
});

spindle.on("CHARACTER_EDITED", (event: unknown, rawUserId?: string) => {
  const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
  if (!ev) return;
  const nestedChar =
    ev.character && typeof ev.character === "object"
      ? (ev.character as Record<string, unknown>)
      : null;
  const characterId =
    extractStringField(ev, "characterId", "character_id", "id") ||
    (nestedChar ? extractStringField(nestedChar, "id", "characterId", "character_id") : "");
  const scopeUsers = explicitUserId ? [explicitUserId] : null;
  if (characterId) {
    evictCharacterCaches(characterId, scopeUsers);
  } else {
    invalidateUserScanCaches(scopeUsers);
  }
});

for (const wbEvent of ["WORLD_BOOK_CHANGED", "WORLD_BOOK_DELETED"] as const) {
  spindle.on(wbEvent, (event: unknown, rawUserId?: string) => {
    const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
    const worldBookId = ev
      ? extractStringField(ev, "worldBookId", "world_book_id", "bookId", "id")
      : "";
    invalidateWorldBookScanCaches(
      worldBookId || undefined,
      explicitUserId ? [explicitUserId] : null,
    );
  });
}

for (const wbEntryEvent of [
  "WORLD_BOOK_ENTRY_CHANGED",
  "WORLD_BOOK_ENTRY_DELETED",
] as const) {
  spindle.on(wbEntryEvent, (event: unknown, rawUserId?: string) => {
    const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
    const entryObj =
      ev?.entry && typeof ev.entry === "object"
        ? (ev.entry as Record<string, unknown>)
        : null;
    const worldBookId =
      (ev ? extractStringField(ev, "worldBookId", "world_book_id", "bookId") : "") ||
      (entryObj
        ? extractStringField(entryObj, "worldBookId", "world_book_id", "bookId")
        : "");
    invalidateWorldBookScanCaches(
      worldBookId || undefined,
      explicitUserId ? [explicitUserId] : null,
    );
  });
}

for (const regexEvent of ["REGEX_SCRIPT_CHANGED", "REGEX_SCRIPT_DELETED"] as const) {
  spindle.on(regexEvent, (event: unknown, rawUserId?: string) => {
    const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
    const scriptObj =
      ev?.script && typeof ev.script === "object"
        ? (ev.script as Record<string, unknown>)
        : null;
    const scope =
      (ev ? extractStringField(ev, "scope") : "") ||
      (scriptObj ? extractStringField(scriptObj, "scope") : "");
    const scopeId =
      (ev
        ? extractStringField(ev, "scopeId", "scope_id", "characterId", "character_id")
        : "") ||
      (scriptObj
        ? extractStringField(
            scriptObj,
            "scopeId",
            "scope_id",
            "characterId",
            "character_id",
          )
        : "");
    invalidateRegexScanCaches(
      scope,
      scopeId,
      explicitUserId ? [explicitUserId] : null,
    );
  });
}

// Clean up orphaned localized images and caches when a character is deleted
spindle.on("CHARACTER_DELETED", async (event: unknown, rawUserId?: string) => {
  const { ev, explicitUserId, targetUsers } = resolveEventUsers(event, rawUserId);
  if (!ev) return;
  const characterId = extractStringField(ev, "characterId", "character_id", "id");
  if (!characterId) return;

  evictCharacterCaches(characterId, explicitUserId ? [explicitUserId] : null);

  for (const userId of targetUsers) {
    try {
      const { orphanedImageIds, removedCount } =
        await indexStore.removeCharacterAssets(userId, characterId);
      const { settings } = await indexStore.getState(userId);
      if (settings.deleteImagesOnPurge && orphanedImageIds.length > 0) {
        await spindle.images.deleteMany(orphanedImageIds, { userId });
      }
      if (removedCount > 0) {
        scheduleUrlMapSync(userId);
      }
    } catch (err) {
      logWarn(`Failed to clean up deleted character ${characterId} for ${userId}:`, err);
    }
  }
});

// Unlink localized status when an item is removed from the character's native Gallery
spindle.on("CHARACTER_GALLERY_ITEM_REMOVED", async (event: unknown, rawUserId?: string) => {
  const { ev, explicitUserId, targetUsers } = resolveEventUsers(event, rawUserId);
  if (!ev) return;
  const characterId = extractStringField(ev, "characterId", "character_id");
  const imageId = extractStringField(ev, "imageId", "image_id");
  const galleryItemId = extractStringField(ev, "id") || undefined;
  if (!characterId || (!imageId && !galleryItemId)) return;

  if (explicitUserId) {
    evictCharacterCaches(characterId, [explicitUserId]);
  }

  for (const userId of targetUsers) {
    try {
      const removed = await indexStore.unlinkByCharacterImageId(
        userId,
        characterId,
        imageId || undefined,
        galleryItemId,
      );
      if (removed > 0) {
        evictCharacterCaches(characterId, [userId]);
        scheduleUrlMapSync(userId);
        spindle.sendToFrontend(
          {
            type: "GALLERY_SYNC_CHANGED",
            characterId,
          },
          userId,
        );
      }
    } catch (err) {
      logWarn(
        `Failed to unlink removed gallery item for character ${characterId} (${userId}):`,
        err,
      );
    }
  }
});

// Clean up index entries if an image is deleted directly
spindle.on("IMAGE_DELETED", async (event: unknown, rawUserId?: string) => {
  const { ev, targetUsers } = resolveEventUsers(event, rawUserId);
  if (!ev) return;
  const imageId = extractStringField(ev, "imageId", "image_id", "id");
  if (!imageId) return;

  for (const userId of targetUsers) {
    try {
      const removed = await indexStore.removeByImageId(userId, imageId);
      if (removed > 0) {
        scheduleUrlMapSync(userId);
        spindle.sendToFrontend(
          {
            type: "GALLERY_SYNC_CHANGED",
          },
          userId,
        );
      }
    } catch (err) {
      logWarn(`Failed to remove deleted image ${imageId} from index (${userId}):`, err);
    }
  }
});

// Register Command Palette entries
try {
  spindle.commands?.register?.([
    {
      id: "open-media-localizer",
      label: "Media Localizer: Open Drawer",
      description: "Inspect and localize embedded remote media for the active character or library",
      keywords: ["media", "localize", "gallery", "images", "cache", "download"],
      scope: "global",
    },
    {
      id: "localize-active-character-media",
      label: "Media Localizer: Localize Active Character Media",
      description: "Download embedded media for the current character using your global download defaults",
      keywords: ["media", "localize", "download", "character", "gallery"],
      scope: "chat",
    },
  ]);

  spindle.commands?.onInvoked?.(async (commandId, context, origin) => {
    const userId = resolveActingUser(origin?.userId);
    if (commandId === "open-media-localizer") {
      try {
        await spindle.ui?.openDrawerTab?.("media_localizer", userId ? { userId } : undefined);
      } catch (err) {
        logWarn("Failed to open media_localizer drawer tab:", err);
      }
      return;
    }

    if (commandId === "localize-active-character-media") {
      if (!userId) return;
      try {
        const charId =
          typeof context?.characterId === "string" && context.characterId.trim()
            ? context.characterId.trim()
            : (await spindle.chats?.getActive?.(userId))?.character_id ?? "";
        if (!charId) {
          spindle.toast?.info?.("Open a character chat first to localize its media.", {
            title: "Media Localizer",
            userId,
          });
          return;
        }
        const state = await indexStore.getState(userId);
        const scan = await performCharacterScan(userId, charId, true);
        await handleFrontendRpcAction(userId, "enqueue_download", {
          filter: {
            ...buildEffectiveFilter(state.settings, scan),
            characterIds: [charId],
          },
        });
        try {
          await spindle.ui?.openDrawerTab?.("media_localizer", { userId });
        } catch (err) {
          logWarn("Failed to open media_localizer drawer tab:", err);
        }
      } catch (err) {
        logWarn("localize-active-character-media command failed:", err);
        try {
          spindle.toast?.error?.(
            `Failed to localize character media: ${err instanceof Error ? err.message : String(err)}`,
            { title: "Media Localizer", userId },
          );
        } catch (toastErr) {
          logWarn("Failed to send error toast:", toastErr);
        }
      }
    }
  });
} catch (err) {
  logWarn("Command Palette registration skipped:", err);
}
