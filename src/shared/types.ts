export type MediaSourceSection =
  | "creator_notes"
  | "first_mes"
  | "core_fields"
  | "alternate_greetings"
  | "world_books"
  | "regex_scripts";

export const ALL_MEDIA_SECTIONS: readonly MediaSourceSection[] = [
  "creator_notes",
  "first_mes",
  "core_fields",
  "alternate_greetings",
  "world_books",
  "regex_scripts",
] as const;

export const SECTION_LABELS: Record<MediaSourceSection, string> = {
  creator_notes: "Creator's Notes",
  first_mes: "First Message",
  core_fields: "Description & Core Fields",
  alternate_greetings: "Alternate Greetings",
  world_books: "Attached World Books",
  regex_scripts: "Character Regex Scripts",
};

export type MediaKind = "image" | "video";

export const ALL_MEDIA_KINDS: readonly MediaKind[] = ["image", "video"] as const;

/**
 * Sentinel stored in `LocalizedAssetEntry.galleryItemIds[characterId]` when a
 * localized URL reuses an image owned by Lumiverse's native Expressions system
 * (`character.extensions.expressions` / `expression_groups`) rather than a
 * `character_gallery` row. Prevents duplicating expression sprites into the
 * Character Gallery and protects expression images from cache purges.
 */
export const NATIVE_EXPRESSION_SENTINEL = "__native_expression__";

export interface MediaSourceRef {
  section: MediaSourceSection;
  label: string;
  greetingIndex?: number;
  worldBookId?: string;
  worldBookName?: string;
  regexScriptId?: string;
  regexScriptName?: string;
}

export interface LocalizedAssetEntry {
  normalizedUrl: string;
  rawUrls: string[];
  imageId: string;
  localUrl: string;
  mimeType: string;
  sizeBytes: number;
  filename: string;
  characterIds: string[];
  /**
   * Maps characterId -> native `character_gallery.id` for characters where
   * this asset is linked in the native Character Gallery.
   */
  galleryItemIds?: Record<string, string>;
  localizedAt: number;
}

export interface PendingGalleryLinkItem {
  characterId: string;
  imageId: string;
  normalizedUrl: string;
  caption: string;
}

export interface FailedUrlRecord {
  error: string;
  lastAttemptAt: number;
}

export interface DiscoveredMediaItem {
  normalizedUrl: string;
  rawUrls: string[];
  domain: string;
  mediaKind: MediaKind;
  sources: MediaSourceRef[];
  occurrenceCount: number;
  status: "localized" | "remote" | "failed";
  localizedEntry?: LocalizedAssetEntry;
  failureInfo?: FailedUrlRecord;
}

export interface SectionCountSummary {
  totalUnique: number;
  remoteCount: number;
  localizedCount: number;
  failedCount: number;
}

export interface GreetingBreakdownItem {
  greetingIndex: number;
  label: string;
  totalUnique: number;
  remoteCount: number;
  localizedCount: number;
  failedCount: number;
}

export interface WorldBookBreakdownItem {
  worldBookId: string;
  worldBookName: string;
  totalUnique: number;
  remoteCount: number;
  localizedCount: number;
  failedCount: number;
}

export interface DomainBreakdownItem {
  domain: string;
  totalUnique: number;
  remoteCount: number;
  localizedCount: number;
  failedCount: number;
}

export interface CharacterDownloadOverride {
  sections?: MediaSourceSection[];
  greetingIndices?: number[];
  worldBookIds?: string[];
  domains?: string[];
  mediaKinds?: MediaKind[];
  includeFailed?: boolean;
  /** Maximum URLs queued per batch (0 = unlimited). */
  maxItems?: number;
  excludedUrls?: string[];
}

export interface LibraryExpressionItem {
  label: string;
  groupName?: string;
  imageId: string;
  localUrl: string;
}

export interface LibraryMediaCharacter {
  characterId: string;
  characterName: string;
  avatarImageId: string | null;
  avatarUrl: string | null;
  localizedAssets: LocalizedAssetEntry[];
  expressions: LibraryExpressionItem[];
  totalSizeBytes: number;
  lastLocalizedAt: number;
}

export interface CharacterMediaScanResult {
  characterId: string;
  characterName: string;
  scannedAt: number;
  totalOccurrences: number;
  items: DiscoveredMediaItem[];
  sectionCounts: Record<MediaSourceSection, SectionCountSummary>;
  greetingBreakdown: GreetingBreakdownItem[];
  worldBookBreakdown: WorldBookBreakdownItem[];
  domainBreakdown: DomainBreakdownItem[];
  override?: CharacterDownloadOverride | null;
  media?: LibraryMediaCharacter | null;
}

export interface DownloadFilterOptions {
  characterIds: string[];
  sections?: MediaSourceSection[];
  greetingIndices?: number[];
  worldBookIds?: string[];
  domains?: string[];
  mediaKinds?: MediaKind[];
  explicitUrls?: string[];
  excludedUrls?: string[];
  includeFailed?: boolean;
  /** Maximum URLs queued per batch (0 = unlimited). */
  maxItems?: number;
  maxFileSizeBytes?: number;
  timeoutMs?: number;
  concurrency?: number;
}

export interface MediaLocalizerSettings {
  defaultSections: MediaSourceSection[];
  defaultMediaKinds: MediaKind[];
  defaultIncludeFailed: boolean;
  defaultBatchCap: number;
  confirmThreshold: number;
  maxFileSizeMb: number;
  timeoutSeconds: number;
  concurrency: number;
  scanBareUrls: boolean;
  autoLocalizeOnOpen: boolean;
  /** Delete the underlying image (and Gallery row) when localized media is removed or its character is deleted. */
  deleteImagesOnPurge: boolean;
  /** Automatically add localized images to the native Character Gallery & Portrait Panel. */
  autoLinkGallery: boolean;
  /** Adopt images already in the native Gallery that match a card URL instead of re-downloading. */
  adoptNativeGalleryImages: boolean;
}

export const DEFAULT_SETTINGS: MediaLocalizerSettings = {
  defaultSections: [
    "creator_notes",
    "first_mes",
    "core_fields",
    "alternate_greetings",
  ],
  defaultMediaKinds: ["image", "video"],
  defaultIncludeFailed: true,
  defaultBatchCap: 50,
  confirmThreshold: 25,
  maxFileSizeMb: 25,
  timeoutSeconds: 20,
  concurrency: 2,
  scanBareUrls: true,
  autoLocalizeOnOpen: false,
  deleteImagesOnPurge: true,
  autoLinkGallery: true,
  adoptNativeGalleryImages: true,
};

export interface QueueJobProgress {
  status: "idle" | "running" | "paused" | "cancelling" | "completed" | "cancelled";
  jobId: string | null;
  totalQueued: number;
  completedCount: number;
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  activeUrls: Array<{
    url: string;
    characterId: string;
    characterName: string;
    startedAt: number;
  }>;
  recentErrors: Array<{
    url: string;
    characterName: string;
    error: string;
  }>;
  cappedByLimit: boolean;
  skippedByCapCount: number;
}

export interface LibraryCharacterSummary {
  characterId: string;
  characterName: string;
  totalUnique: number;
  localizedCount: number;
  localizedBytes: number;
  remoteCount: number;
  failedCount: number;
  sectionRemoteCounts: Record<MediaSourceSection, number>;
}

export interface StorageStatsSummary {
  totalAssets: number;
  totalSizeBytes: number;
  totalFailedUrls: number;
  settings: MediaLocalizerSettings;
}

export interface ActiveDisplayUrlMapPayload {
  /**
   * Maps characterId -> (rawOrNormalizedUrl -> localUrl).
   */
  characterUrlMaps: Record<string, Record<string, string>>;
  /**
   * Global lookup across all localized assets (rawOrNormalizedUrl -> localUrl)
   * for fallback error recovery or views where characterId is not scoped.
   */
  allUrlsMap: Record<string, string>;
  updatedAt: number;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}


