import type { SpindleAPI } from "lumiverse-spindle-types";
import { isOverrideEmpty, sanitizeOverride } from "../shared/download-config.ts";
import {
  ALL_MEDIA_KINDS,
  ALL_MEDIA_SECTIONS,
  DEFAULT_SETTINGS,
  NATIVE_EXPRESSION_SENTINEL,
  type ActiveDisplayUrlMapPayload,
  type CharacterDownloadOverride,
  type FailedUrlRecord,
  type LocalizedAssetEntry,
  type MediaKind,
  type MediaLocalizerSettings,
  type MediaSourceSection,
  type StorageStatsSummary,
} from "../shared/types.ts";

export type UserStorageAPI = SpindleAPI["userStorage"];

const INDEX_FILE = "media_index.json";

export interface PersistedUserMediaState {
  version: 1;
  settings: MediaLocalizerSettings;
  /** Per-character download option overrides ("Custom" state); absent = global defaults. */
  characterOverrides: Record<string, CharacterDownloadOverride>;
  /** Characters that already had one-time auto-localization run on open. */
  autoLocalizedCharacterIds: string[];
  assets: Record<string, LocalizedAssetEntry>;
  failedUrls: Record<string, FailedUrlRecord>;
}

const UNSAFE_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isSafeRecordKey(key: string): boolean {
  return typeof key === "string" && key.length > 0 && !UNSAFE_RECORD_KEYS.has(key);
}

function createNullProtoRecord<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>;
}

function getOwnRecordValue<V>(
  record: Record<string, V> | undefined | null,
  key: string,
): V | undefined {
  if (!record || !isSafeRecordKey(key)) return undefined;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function setOwnRecordValue<V>(
  record: Record<string, V>,
  key: string,
  value: V,
): boolean {
  if (!isSafeRecordKey(key)) return false;
  record[key] = value;
  return true;
}

function deleteOwnRecordValue<V>(
  record: Record<string, V>,
  key: string,
): boolean {
  if (!isSafeRecordKey(key) || !Object.hasOwn(record, key)) return false;
  delete record[key];
  return true;
}

function createDefaultUserState(): PersistedUserMediaState {
  return {
    version: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      defaultSections: [...DEFAULT_SETTINGS.defaultSections],
      defaultMediaKinds: [...DEFAULT_SETTINGS.defaultMediaKinds],
    },
    characterOverrides: createNullProtoRecord(),
    autoLocalizedCharacterIds: [],
    assets: createNullProtoRecord(),
    failedUrls: createNullProtoRecord(),
  };
}

function cloneOverride(o: CharacterDownloadOverride): CharacterDownloadOverride {
  const copy: CharacterDownloadOverride = {};
  if (o.sections) copy.sections = [...o.sections];
  if (o.greetingIndices) copy.greetingIndices = [...o.greetingIndices];
  if (o.worldBookIds) copy.worldBookIds = [...o.worldBookIds];
  if (o.domains) copy.domains = [...o.domains];
  if (o.mediaKinds) copy.mediaKinds = [...o.mediaKinds];
  if (o.includeFailed !== undefined) copy.includeFailed = o.includeFailed;
  if (o.maxItems !== undefined) copy.maxItems = o.maxItems;
  if (o.excludedUrls) copy.excludedUrls = [...o.excludedUrls];
  return copy;
}

function cloneUserState(state: PersistedUserMediaState): PersistedUserMediaState {
  const characterOverrides = createNullProtoRecord<CharacterDownloadOverride>();
  for (const [k, v] of Object.entries(state.characterOverrides)) {
    if (isSafeRecordKey(k)) {
      characterOverrides[k] = cloneOverride(v);
    }
  }

  const assets = createNullProtoRecord<LocalizedAssetEntry>();
  for (const [k, entry] of Object.entries(state.assets)) {
    if (!isSafeRecordKey(k)) continue;
    let galleryItemIds: Record<string, string> | undefined;
    if (entry.galleryItemIds) {
      galleryItemIds = createNullProtoRecord<string>();
      for (const [cid, gid] of Object.entries(entry.galleryItemIds)) {
        if (isSafeRecordKey(cid) && typeof gid === "string") {
          galleryItemIds[cid] = gid;
        }
      }
    }
    assets[k] = {
      ...entry,
      rawUrls: [...entry.rawUrls],
      characterIds: [...entry.characterIds],
      ...(galleryItemIds ? { galleryItemIds } : {}),
    };
  }

  const failedUrls = createNullProtoRecord<FailedUrlRecord>();
  for (const [k, rec] of Object.entries(state.failedUrls)) {
    if (isSafeRecordKey(k)) {
      failedUrls[k] = { ...rec };
    }
  }

  return {
    version: 1,
    settings: {
      ...state.settings,
      defaultSections: [...state.settings.defaultSections],
      defaultMediaKinds: [...state.settings.defaultMediaKinds],
    },
    characterOverrides,
    autoLocalizedCharacterIds: [...state.autoLocalizedCharacterIds],
    assets,
    failedUrls,
  };
}

function sanitizeSettings(raw: unknown): MediaLocalizerSettings {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_SETTINGS,
      defaultSections: [...DEFAULT_SETTINGS.defaultSections],
      defaultMediaKinds: [...DEFAULT_SETTINGS.defaultMediaKinds],
    };
  }
  const obj = raw as Record<string, unknown>;
  const validSections = Array.isArray(obj.defaultSections)
    ? obj.defaultSections.filter(
        (s): s is MediaSourceSection =>
          typeof s === "string" &&
          (ALL_MEDIA_SECTIONS as readonly string[]).includes(s),
      )
    : [...DEFAULT_SETTINGS.defaultSections];

  const validKinds = Array.isArray(obj.defaultMediaKinds)
    ? obj.defaultMediaKinds.filter(
        (k): k is MediaKind =>
          typeof k === "string" &&
          (ALL_MEDIA_KINDS as readonly string[]).includes(k),
      )
    : [...DEFAULT_SETTINGS.defaultMediaKinds];

  return {
    defaultSections:
      validSections.length > 0
        ? Array.from(new Set(validSections))
        : [...DEFAULT_SETTINGS.defaultSections],
    defaultMediaKinds:
      validKinds.length > 0
        ? Array.from(new Set(validKinds))
        : [...DEFAULT_SETTINGS.defaultMediaKinds],
    defaultIncludeFailed:
      typeof obj.defaultIncludeFailed === "boolean"
        ? obj.defaultIncludeFailed
        : DEFAULT_SETTINGS.defaultIncludeFailed,
    defaultBatchCap:
      typeof obj.defaultBatchCap === "number" &&
      Number.isFinite(obj.defaultBatchCap) &&
      obj.defaultBatchCap >= 0
        ? Math.floor(obj.defaultBatchCap)
        : DEFAULT_SETTINGS.defaultBatchCap,
    confirmThreshold:
      typeof obj.confirmThreshold === "number" &&
      Number.isFinite(obj.confirmThreshold) &&
      obj.confirmThreshold >= 1
        ? Math.floor(obj.confirmThreshold)
        : DEFAULT_SETTINGS.confirmThreshold,
    maxFileSizeMb:
      typeof obj.maxFileSizeMb === "number" &&
      Number.isFinite(obj.maxFileSizeMb) &&
      obj.maxFileSizeMb >= 1
        ? Math.min(200, Math.max(1, Math.floor(obj.maxFileSizeMb)))
        : DEFAULT_SETTINGS.maxFileSizeMb,
    timeoutSeconds:
      typeof obj.timeoutSeconds === "number" &&
      Number.isFinite(obj.timeoutSeconds) &&
      obj.timeoutSeconds >= 5
        ? Math.min(120, Math.max(5, Math.floor(obj.timeoutSeconds)))
        : DEFAULT_SETTINGS.timeoutSeconds,
    concurrency:
      typeof obj.concurrency === "number" &&
      Number.isFinite(obj.concurrency) &&
      obj.concurrency >= 1
        ? Math.min(5, Math.max(1, Math.floor(obj.concurrency)))
        : DEFAULT_SETTINGS.concurrency,
    scanBareUrls:
      typeof obj.scanBareUrls === "boolean"
        ? obj.scanBareUrls
        : DEFAULT_SETTINGS.scanBareUrls,
    autoLocalizeOnOpen:
      typeof obj.autoLocalizeOnOpen === "boolean"
        ? obj.autoLocalizeOnOpen
        : DEFAULT_SETTINGS.autoLocalizeOnOpen,
    deleteImagesOnPurge:
      typeof obj.deleteImagesOnPurge === "boolean"
        ? obj.deleteImagesOnPurge
        : DEFAULT_SETTINGS.deleteImagesOnPurge,
    autoLinkGallery:
      typeof obj.autoLinkGallery === "boolean"
        ? obj.autoLinkGallery
        : DEFAULT_SETTINGS.autoLinkGallery,
    adoptNativeGalleryImages:
      typeof obj.adoptNativeGalleryImages === "boolean"
        ? obj.adoptNativeGalleryImages
        : DEFAULT_SETTINGS.adoptNativeGalleryImages,
  };
}

function sanitizeAssetEntry(
  key: string,
  raw: unknown,
): LocalizedAssetEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<LocalizedAssetEntry>;
  if (typeof e.imageId !== "string" || !e.imageId) return null;
  const normalizedUrl =
    typeof e.normalizedUrl === "string" && e.normalizedUrl
      ? e.normalizedUrl
      : key;
  if (!isSafeRecordKey(normalizedUrl)) return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const galleryItemIds = createNullProtoRecord<string>();
  if (e.galleryItemIds && typeof e.galleryItemIds === "object") {
    for (const [k, v] of Object.entries(e.galleryItemIds)) {
      if (isSafeRecordKey(k) && typeof v === "string") {
        galleryItemIds[k] = v;
      }
    }
  }
  return {
    normalizedUrl,
    rawUrls: strArr(e.rawUrls),
    imageId: e.imageId,
    localUrl:
      typeof e.localUrl === "string" && e.localUrl
        ? e.localUrl
        : `/api/v1/images/${e.imageId}`,
    mimeType: typeof e.mimeType === "string" ? e.mimeType : "image/png",
    sizeBytes: typeof e.sizeBytes === "number" ? e.sizeBytes : 0,
    filename: typeof e.filename === "string" ? e.filename : "media",
    characterIds: strArr(e.characterIds),
    ...(Object.keys(galleryItemIds).length > 0 ? { galleryItemIds } : {}),
    localizedAt: typeof e.localizedAt === "number" ? e.localizedAt : 0,
  };
}

function sanitizeFailedRecord(raw: unknown): FailedUrlRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<FailedUrlRecord>;
  return {
    error: typeof r.error === "string" ? r.error : "Unknown error",
    lastAttemptAt: typeof r.lastAttemptAt === "number" ? r.lastAttemptAt : 0,
  };
}

function applyRecordLocalizedAsset(
  state: PersistedUserMediaState,
  entry: LocalizedAssetEntry,
  options?: { replaceIfImageId?: string },
): { changed: boolean; result: LocalizedAssetEntry } {
  if (!isSafeRecordKey(entry.normalizedUrl)) {
    throw new Error("Invalid normalizedUrl key");
  }
  const existing = getOwnRecordValue(state.assets, entry.normalizedUrl);
  const isReplacingDeadImage = Boolean(
    existing &&
      options?.replaceIfImageId &&
      existing.imageId === options.replaceIfImageId,
  );
  const mergedRawUrls = Array.from(
    new Set([...(existing?.rawUrls ?? []), ...entry.rawUrls, entry.normalizedUrl]),
  );
  const mergedCharIds = Array.from(
    new Set([...(existing?.characterIds ?? []), ...entry.characterIds]),
  );
  const mergedGalleryItemIds = createNullProtoRecord<string>();
  // When healing a dead imageId, drop stale galleryItemIds from the dead image so the
  // replacement upload is not treated as already linked to a missing Gallery row.
  if (!isReplacingDeadImage && existing?.galleryItemIds) {
    for (const [k, v] of Object.entries(existing.galleryItemIds)) {
      if (isSafeRecordKey(k) && typeof v === "string") {
        mergedGalleryItemIds[k] = v;
      }
    }
  }
  if (entry.galleryItemIds) {
    for (const [k, v] of Object.entries(entry.galleryItemIds)) {
      if (isSafeRecordKey(k) && typeof v === "string") {
        mergedGalleryItemIds[k] = v;
      }
    }
  }

  // If a concurrent download already registered this URL with a different healthy image, keep
  // the existing one so Gallery links and display maps stay stable; the caller discards the duplicate.
  // Only replace `existing` when its `imageId` still matches the dead `replaceIfImageId`.
  const base = existing && !isReplacingDeadImage ? existing : entry;
  const saved: LocalizedAssetEntry = {
    normalizedUrl: entry.normalizedUrl,
    rawUrls: mergedRawUrls,
    imageId: base.imageId,
    localUrl: base.localUrl,
    mimeType: base.mimeType,
    sizeBytes: base.sizeBytes,
    filename: base.filename,
    characterIds: mergedCharIds,
    ...(Object.keys(mergedGalleryItemIds).length > 0
      ? { galleryItemIds: mergedGalleryItemIds }
      : {}),
    localizedAt: base.localizedAt,
  };

  setOwnRecordValue(state.assets, entry.normalizedUrl, saved);
  deleteOwnRecordValue(state.failedUrls, entry.normalizedUrl);
  return { changed: true, result: saved };
}

function applyLinkExistingAssetToCharacter(
  state: PersistedUserMediaState,
  normalizedUrl: string,
  rawUrls: string[],
  characterId: string,
  galleryItemId?: string,
): { changed: boolean; result: LocalizedAssetEntry | null } {
  if (!isSafeRecordKey(normalizedUrl) || !isSafeRecordKey(characterId)) {
    return { changed: false, result: null };
  }
  const existing = getOwnRecordValue(state.assets, normalizedUrl);
  if (!existing) return { changed: false, result: null };

  let changed = false;
  if (!existing.characterIds.includes(characterId)) {
    existing.characterIds.push(characterId);
    changed = true;
  }
  if (galleryItemId) {
    if (!existing.galleryItemIds) {
      existing.galleryItemIds = createNullProtoRecord<string>();
    }
    if (getOwnRecordValue(existing.galleryItemIds, characterId) !== galleryItemId) {
      setOwnRecordValue(existing.galleryItemIds, characterId, galleryItemId);
      changed = true;
    }
  }
  for (const raw of rawUrls) {
    if (!existing.rawUrls.includes(raw)) {
      existing.rawUrls.push(raw);
      changed = true;
    }
  }
  if (deleteOwnRecordValue(state.failedUrls, normalizedUrl)) {
    changed = true;
  }
  return { changed, result: existing };
}

function applyRecordGalleryLinks(
  state: PersistedUserMediaState,
  links: Array<{
    characterId: string;
    normalizedUrl?: string;
    imageId: string;
    galleryItemId: string;
  }>,
): { changed: boolean; result: number } {
  if (!Array.isArray(links) || links.length === 0) {
    return { changed: false, result: 0 };
  }
  let updated = 0;

  for (const link of links) {
    if (!link.characterId || !isSafeRecordKey(link.characterId) || !link.galleryItemId) {
      continue;
    }
    for (const entry of Object.values(state.assets)) {
      const matchesUrl =
        link.normalizedUrl && entry.normalizedUrl === link.normalizedUrl;
      const matchesImage = link.imageId && entry.imageId === link.imageId;
      if (!matchesUrl && !matchesImage) continue;

      if (!entry.characterIds.includes(link.characterId)) {
        entry.characterIds.push(link.characterId);
        updated++;
      }
      if (!entry.galleryItemIds) {
        entry.galleryItemIds = createNullProtoRecord<string>();
      }
      if (getOwnRecordValue(entry.galleryItemIds, link.characterId) !== link.galleryItemId) {
        setOwnRecordValue(entry.galleryItemIds, link.characterId, link.galleryItemId);
        updated++;
      }
    }
  }

  return { changed: updated > 0, result: updated };
}

function applyUnlinkByCharacterImageId(
  state: PersistedUserMediaState,
  characterId: string,
  imageId?: string,
  galleryItemId?: string,
): { changed: boolean; result: number } {
  if (!characterId || !isSafeRecordKey(characterId) || (!imageId && !galleryItemId)) {
    return { changed: false, result: 0 };
  }
  let removed = 0;

  for (const [normUrl, entry] of Object.entries(state.assets)) {
    if (!entry.characterIds.includes(characterId)) continue;
    const matchesImage = Boolean(imageId && entry.imageId === imageId);
    const currentGalleryId = getOwnRecordValue(entry.galleryItemIds, characterId);
    const matchesGalleryItem = Boolean(
      galleryItemId && currentGalleryId === galleryItemId,
    );
    if (!matchesImage && !matchesGalleryItem) continue;

    entry.characterIds = entry.characterIds.filter((id) => id !== characterId);
    if (entry.galleryItemIds) {
      deleteOwnRecordValue(entry.galleryItemIds, characterId);
    }
    removed++;
    if (entry.characterIds.length === 0) {
      deleteOwnRecordValue(state.assets, normUrl);
    }
  }

  return { changed: removed > 0, result: removed };
}

function applyRemoveByImageId(
  state: PersistedUserMediaState,
  imageId: string,
): { changed: boolean; result: number } {
  let removed = 0;
  for (const [normUrl, entry] of Object.entries(state.assets)) {
    if (entry.imageId === imageId) {
      if (deleteOwnRecordValue(state.assets, normUrl)) {
        removed++;
      }
    }
  }
  return { changed: removed > 0, result: removed };
}

export interface MediaIndexBatchTransaction {
  readonly state: PersistedUserMediaState;
  recordLocalizedAsset(
    entry: LocalizedAssetEntry,
    options?: { replaceIfImageId?: string },
  ): LocalizedAssetEntry;
  linkExistingAssetToCharacter(
    normalizedUrl: string,
    rawUrls: string[],
    characterId: string,
    galleryItemId?: string,
  ): LocalizedAssetEntry | null;
  recordGalleryLinks(
    links: Array<{
      characterId: string;
      normalizedUrl?: string;
      imageId: string;
      galleryItemId: string;
    }>,
  ): number;
  unlinkByCharacterImageId(
    characterId: string,
    imageId?: string,
    galleryItemId?: string,
  ): number;
  removeByImageId(imageId: string): number;
}

const MAX_CACHED_USERS = 500;

export class MediaIndexStore {
  private readonly cache = new Map<string, PersistedUserMediaState>();
  private readonly loading = new Map<string, Promise<PersistedUserMediaState>>();
  private readonly writeLocks = new Map<string, Promise<void>>();
  private tmpSeq = 0;

  constructor(private readonly userStorage: UserStorageAPI) {}

  private setCachedState(userId: string, state: PersistedUserMediaState): void {
    if (this.cache.has(userId)) {
      this.cache.delete(userId);
    }
    this.cache.set(userId, state);
    if (this.cache.size <= MAX_CACHED_USERS) return;
    for (const candidateKey of this.cache.keys()) {
      if (this.cache.size <= MAX_CACHED_USERS) break;
      if (candidateKey === userId) continue;
      if (this.writeLocks.has(candidateKey) || this.loading.has(candidateKey)) {
        continue;
      }
      this.cache.delete(candidateKey);
    }
  }

  getState(userId: string): Promise<PersistedUserMediaState> {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return this.loadState(userId);
    }
    const cached = this.cache.get(userId);
    if (cached) {
      this.cache.delete(userId);
      this.cache.set(userId, cached);
      return Promise.resolve(cached);
    }
    // Share a single in-flight load so concurrent first callers get the same state object.
    let pending = this.loading.get(userId);
    if (!pending) {
      pending = this.loadState(userId)
        .then((loaded) => {
          this.setCachedState(userId, loaded);
          return loaded;
        })
        .finally(() => {
          if (this.loading.get(userId) === pending) {
            this.loading.delete(userId);
          }
        });
      this.loading.set(userId, pending);
    }
    return pending;
  }

  private async loadState(userId: string): Promise<PersistedUserMediaState> {
    // Let transient storage existence/read failures reject rather than caching an empty
    // default state that could overwrite media_index.json on the next write.
    const exists = await this.userStorage.exists(INDEX_FILE, userId);
    if (!exists) return createDefaultUserState();

    const rawData: unknown = await this.userStorage.read(INDEX_FILE, userId);
    if (rawData == null) {
      throw new Error("Failed to read media_index.json: storage returned null");
    }
    const text =
      typeof rawData === "string"
        ? rawData
        : rawData instanceof Uint8Array
          ? new TextDecoder().decode(rawData)
          : String(rawData);

    let parsed: Partial<PersistedUserMediaState>;
    try {
      const candidate = JSON.parse(text) as unknown;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("media_index.json is not an object");
      }
      parsed = candidate as Partial<PersistedUserMediaState>;
    } catch (err) {
      console.warn(
        "[media_localizer] Corrupt media_index.json; preserving a backup and starting fresh:",
        err,
      );
      // Never silently overwrite a corrupt index: keep a copy so mappings can be recovered.
      if (text) {
        try {
          await this.userStorage.write(
            `media_index.corrupt-${Date.now()}.json`,
            text,
            userId,
          );
        } catch {
          // ignore backup failure
        }
      }
      return createDefaultUserState();
    }

    const assets = createNullProtoRecord<LocalizedAssetEntry>();
    if (parsed.assets && typeof parsed.assets === "object") {
      for (const [key, raw] of Object.entries(parsed.assets)) {
        if (!isSafeRecordKey(key)) continue;
        const entry = sanitizeAssetEntry(key, raw);
        if (entry && isSafeRecordKey(entry.normalizedUrl)) {
          assets[entry.normalizedUrl] = entry;
        }
      }
    }

    const failedUrls = createNullProtoRecord<FailedUrlRecord>();
    if (parsed.failedUrls && typeof parsed.failedUrls === "object") {
      for (const [key, raw] of Object.entries(parsed.failedUrls)) {
        if (!isSafeRecordKey(key)) continue;
        const rec = sanitizeFailedRecord(raw);
        if (rec) failedUrls[key] = rec;
      }
    }

    const characterOverrides = createNullProtoRecord<CharacterDownloadOverride>();
    if (parsed.characterOverrides && typeof parsed.characterOverrides === "object") {
      for (const [k, v] of Object.entries(parsed.characterOverrides)) {
        if (!isSafeRecordKey(k)) continue;
        const sanitized = sanitizeOverride(v);
        if (!isOverrideEmpty(sanitized)) {
          characterOverrides[k] = sanitized;
        }
      }
    }

    const autoLocalizedCharacterIds = Array.isArray(parsed.autoLocalizedCharacterIds)
      ? Array.from(
          new Set(
            parsed.autoLocalizedCharacterIds.filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0,
            ),
          ),
        )
      : [];

    return {
      version: 1,
      settings: sanitizeSettings(parsed.settings),
      characterOverrides,
      autoLocalizedCharacterIds,
      assets,
      failedUrls,
    };
  }

  private async writeStateToStorage(
    userId: string,
    state: PersistedUserMediaState,
  ): Promise<void> {
    const tmpPath = `${INDEX_FILE}.${Date.now()}.${++this.tmpSeq}.tmp`;
    const jsonText = JSON.stringify(state, null, 2);
    let moved = false;
    try {
      await this.userStorage.write(tmpPath, jsonText, userId);
      try {
        await this.userStorage.move(tmpPath, INDEX_FILE, userId);
        moved = true;
      } catch {
        await this.userStorage.write(INDEX_FILE, jsonText, userId);
      }
    } finally {
      if (!moved) {
        try {
          await this.userStorage.delete(tmpPath, userId);
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  private async mutateState<T>(
    userId: string,
    fn: (draft: PersistedUserMediaState) => { changed: boolean; result: T },
  ): Promise<T> {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("userId is required");
    }
    const prevLock = this.writeLocks.get(userId) ?? Promise.resolve();
    const task = prevLock
      .catch(() => {})
      .then(async () => {
        const current = await this.getState(userId);
        const draft = cloneUserState(current);
        const outcome = fn(draft);
        if (outcome.changed) {
          await this.writeStateToStorage(userId, draft);
          this.setCachedState(userId, draft);
        }
        return outcome.result;
      });
    const cleanup = task
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.writeLocks.get(userId) === cleanup) {
          this.writeLocks.delete(userId);
        }
      });
    this.writeLocks.set(userId, cleanup);
    return await task;
  }

  /**
   * Executes multiple index mutations inside a single serialized transaction
   * and performs at most one `media_index.json` disk write when done.
   */
  async batchUpdate<T>(
    userId: string,
    fn: (tx: MediaIndexBatchTransaction) => T,
  ): Promise<{ changed: boolean; result: T }> {
    return this.mutateState(userId, (draft) => {
      let changed = false;
      const tx: MediaIndexBatchTransaction = {
        state: draft,
        recordLocalizedAsset(entry, options) {
          const res = applyRecordLocalizedAsset(draft, entry, options);
          if (res.changed) changed = true;
          return res.result;
        },
        linkExistingAssetToCharacter(normalizedUrl, rawUrls, characterId, galleryItemId) {
          const res = applyLinkExistingAssetToCharacter(
            draft,
            normalizedUrl,
            rawUrls,
            characterId,
            galleryItemId,
          );
          if (res.changed) changed = true;
          return res.result;
        },
        recordGalleryLinks(links) {
          const res = applyRecordGalleryLinks(draft, links);
          if (res.changed) changed = true;
          return res.result;
        },
        unlinkByCharacterImageId(characterId, imageId, galleryItemId) {
          const res = applyUnlinkByCharacterImageId(
            draft,
            characterId,
            imageId,
            galleryItemId,
          );
          if (res.changed) changed = true;
          return res.result;
        },
        removeByImageId(imageId) {
          const res = applyRemoveByImageId(draft, imageId);
          if (res.changed) changed = true;
          return res.result;
        },
      };
      const result = fn(tx);
      return { changed, result: { changed, result } };
    });
  }

  async setCharacterOverride(
    userId: string,
    characterId: string,
    override: CharacterDownloadOverride | null,
  ): Promise<CharacterDownloadOverride | null> {
    if (!isSafeRecordKey(characterId)) {
      throw new Error("Invalid characterId");
    }
    return this.mutateState(userId, (draft) => {
      const sanitized = override ? sanitizeOverride(override) : null;
      if (!sanitized || isOverrideEmpty(sanitized)) {
        const deleted = deleteOwnRecordValue(draft.characterOverrides, characterId);
        return { changed: deleted, result: null };
      }
      setOwnRecordValue(draft.characterOverrides, characterId, sanitized);
      return { changed: true, result: sanitized };
    });
  }

  async markAutoLocalized(userId: string, characterId: string): Promise<boolean> {
    return this.mutateState(userId, (draft) => {
      if (draft.autoLocalizedCharacterIds.includes(characterId)) {
        return { changed: false, result: false };
      }
      draft.autoLocalizedCharacterIds.push(characterId);
      return { changed: true, result: true };
    });
  }

  async updateSettings(
    userId: string,
    patch: Partial<MediaLocalizerSettings>,
  ): Promise<MediaLocalizerSettings> {
    return this.mutateState(userId, (draft) => {
      draft.settings = sanitizeSettings({
        ...draft.settings,
        ...patch,
      });
      return { changed: true, result: draft.settings };
    });
  }

  async recordLocalizedAsset(
    userId: string,
    entry: LocalizedAssetEntry,
    options?: { replaceIfImageId?: string },
  ): Promise<LocalizedAssetEntry> {
    return this.mutateState(userId, (draft) =>
      applyRecordLocalizedAsset(draft, entry, options),
    );
  }

  async linkExistingAssetToCharacter(
    userId: string,
    normalizedUrl: string,
    rawUrls: string[],
    characterId: string,
    galleryItemId?: string,
  ): Promise<LocalizedAssetEntry | null> {
    return this.mutateState(userId, (draft) =>
      applyLinkExistingAssetToCharacter(
        draft,
        normalizedUrl,
        rawUrls,
        characterId,
        galleryItemId,
      ),
    );
  }

  async recordGalleryLinks(
    userId: string,
    links: Array<{
      characterId: string;
      normalizedUrl?: string;
      imageId: string;
      galleryItemId: string;
    }>,
  ): Promise<number> {
    if (!Array.isArray(links) || links.length === 0) return 0;
    return this.mutateState(userId, (draft) =>
      applyRecordGalleryLinks(draft, links),
    );
  }

  async unlinkByCharacterImageId(
    userId: string,
    characterId: string,
    imageId?: string,
    galleryItemId?: string,
  ): Promise<number> {
    if (!characterId || !isSafeRecordKey(characterId) || (!imageId && !galleryItemId)) {
      return 0;
    }
    return this.mutateState(userId, (draft) =>
      applyUnlinkByCharacterImageId(draft, characterId, imageId, galleryItemId),
    );
  }

  async recordFailure(
    userId: string,
    normalizedUrl: string,
    error: string,
  ): Promise<void> {
    if (!isSafeRecordKey(normalizedUrl)) return;
    await this.mutateState(userId, (draft) => {
      setOwnRecordValue(draft.failedUrls, normalizedUrl, {
        error,
        lastAttemptAt: Date.now(),
      });
      return { changed: true, result: undefined };
    });
  }

  async clearFailedUrls(userId: string, urls?: string[]): Promise<number> {
    return this.mutateState(userId, (draft) => {
      let cleared = 0;
      if (urls && urls.length > 0) {
        for (const u of urls) {
          if (deleteOwnRecordValue(draft.failedUrls, u)) {
            cleared++;
          }
        }
      } else {
        cleared = Object.keys(draft.failedUrls).length;
        draft.failedUrls = createNullProtoRecord();
      }
      return { changed: cleared > 0, result: cleared };
    });
  }

  /**
   * Unlinks a character from all localized assets (or a single asset).
   * Returns any `imageId`s that no longer have any referencing characters so the caller
   * can delete them via `spindle.images.deleteMany`.
   */
  async removeCharacterAssets(
    userId: string,
    characterId: string,
    onlyNormalizedUrls?: string[],
  ): Promise<{
    orphanedImageIds: string[];
    removedCount: number;
    removedGalleryItemIds: string[];
    removedImageIds: string[];
  }> {
    if (!isSafeRecordKey(characterId)) {
      return {
        orphanedImageIds: [],
        removedCount: 0,
        removedGalleryItemIds: [],
        removedImageIds: [],
      };
    }

    return this.mutateState(userId, (draft) => {
      const targetFilter =
        onlyNormalizedUrls && onlyNormalizedUrls.length > 0
          ? new Set(onlyNormalizedUrls)
          : null;

      const candidateOrphanImageIds = new Set<string>();
      const removedGalleryItemIds = new Set<string>();
      const removedImageIds = new Set<string>();
      let removedCount = 0;

      for (const [normUrl, entry] of Object.entries(draft.assets)) {
        if (targetFilter && !targetFilter.has(normUrl)) continue;
        if (!entry.characterIds.includes(characterId)) continue;

        const galleryLinkId = getOwnRecordValue(entry.galleryItemIds, characterId);
        const isNativeExpression = galleryLinkId === NATIVE_EXPRESSION_SENTINEL;
        if (galleryLinkId) {
          if (!isNativeExpression) {
            removedGalleryItemIds.add(galleryLinkId);
          }
          if (entry.galleryItemIds) {
            deleteOwnRecordValue(entry.galleryItemIds, characterId);
          }
        }
        if (!isNativeExpression) {
          removedImageIds.add(entry.imageId);
        }
        entry.characterIds = entry.characterIds.filter((id) => id !== characterId);
        removedCount++;
        if (entry.characterIds.length === 0) {
          if (!isNativeExpression) {
            candidateOrphanImageIds.add(entry.imageId);
          }
          deleteOwnRecordValue(draft.assets, normUrl);
        }
      }

      const stillUsedImageIds = new Set<string>();
      for (const entry of Object.values(draft.assets)) {
        stillUsedImageIds.add(entry.imageId);
      }
      const orphanedImageIds = Array.from(candidateOrphanImageIds).filter(
        (id) => !stillUsedImageIds.has(id),
      );

      let metadataChanged = false;
      if (!targetFilter) {
        const prevLen = draft.autoLocalizedCharacterIds.length;
        if (prevLen > 0) {
          draft.autoLocalizedCharacterIds = draft.autoLocalizedCharacterIds.filter(
            (id) => id !== characterId,
          );
          if (draft.autoLocalizedCharacterIds.length !== prevLen) {
            metadataChanged = true;
          }
        }
        if (deleteOwnRecordValue(draft.characterOverrides, characterId)) {
          metadataChanged = true;
        }
      }

      return {
        changed: removedCount > 0 || metadataChanged,
        result: {
          orphanedImageIds,
          removedCount,
          removedGalleryItemIds: Array.from(removedGalleryItemIds),
          removedImageIds: Array.from(removedImageIds),
        },
      };
    });
  }

  async removeByImageId(userId: string, imageId: string): Promise<number> {
    return this.mutateState(userId, (draft) =>
      applyRemoveByImageId(draft, imageId),
    );
  }

  async getStorageStats(userId: string): Promise<StorageStatsSummary> {
    const state = await this.getState(userId);
    const entries = Object.values(state.assets);
    const seenImageIds = new Set<string>();
    let totalSizeBytes = 0;
    for (const entry of entries) {
      if (!seenImageIds.has(entry.imageId)) {
        seenImageIds.add(entry.imageId);
        totalSizeBytes += entry.sizeBytes || 0;
      }
    }
    return {
      totalAssets: entries.length,
      totalSizeBytes,
      totalFailedUrls: Object.keys(state.failedUrls).length,
      settings: state.settings,
    };
  }

  async buildActiveDisplayUrlMap(userId?: string): Promise<ActiveDisplayUrlMapPayload> {
    const state =
      typeof userId === "string" && userId.trim().length > 0
        ? await this.getState(userId)
        : await this.loadState(undefined as unknown as string);
    const characterUrlMaps = createNullProtoRecord<Record<string, string>>();
    const allUrlsMap = createNullProtoRecord<string>();

    const addUrlVariants = (
      target: Record<string, string>,
      url: string,
      localUrl: string,
    ) => {
      setOwnRecordValue(target, url, localUrl);
      const ampEncoded = url.replace(/&/g, "&amp;");
      if (ampEncoded !== url) {
        setOwnRecordValue(target, ampEncoded, localUrl);
      }
    };

    for (const entry of Object.values(state.assets)) {
      addUrlVariants(allUrlsMap, entry.normalizedUrl, entry.localUrl);
      for (const raw of entry.rawUrls) {
        addUrlVariants(allUrlsMap, raw, entry.localUrl);
      }

      for (const charId of entry.characterIds) {
        if (!isSafeRecordKey(charId)) continue;
        let charMap = getOwnRecordValue(characterUrlMaps, charId);
        if (!charMap) {
          charMap = createNullProtoRecord<string>();
          setOwnRecordValue(characterUrlMaps, charId, charMap);
        }
        addUrlVariants(charMap, entry.normalizedUrl, entry.localUrl);
        for (const raw of entry.rawUrls) {
          addUrlVariants(charMap, raw, entry.localUrl);
        }
      }
    }

    return {
      characterUrlMaps,
      allUrlsMap,
      updatedAt: Date.now(),
    };
  }
}
