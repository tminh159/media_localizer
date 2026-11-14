import {
  formatBytes,
  type LibraryMediaCharacter,
  type MediaKind,
} from "../shared/types.ts";
import {
  applyScrollTopWithSettlement,
  createIcon,
  createIconButton,
  createInfoTip,
  createLazyMediaElement,
  createThumbnailSizeSegmented,
  DEFAULT_THUMBNAIL_SIZE,
  getThumbnailImageTier,
  getThumbnailSizeClass,
  openMediaLightbox,
  reobserveLazyMedia,
  resolveScrollContainer,
  sanitizeSafeMediaUrl,
  sanitizeThumbnailSize,
  toThumbnailMediaUrl,
  type IconName,
  type LightboxItem,
  type PendingScrollRestore,
  type ThumbnailImageTier,
  type ThumbnailSize,
} from "./ui-helpers.ts";

export interface LibraryGalleryCallbacks {
  onLoadLibraryMedia(options?: {
    includeEmpty?: boolean;
  }): Promise<LibraryMediaCharacter[]>;
  onPurgeAsset(characterId: string, normalizedUrl: string): Promise<void>;
  onOpenCharacterTab?(characterId: string): void;
  onOpenCharacterEditor?(characterId: string): void;
  onStateChange?(state: LibraryGalleryState): void;
  onCacheChange?(cache: LibraryGalleryCacheSnapshot): void;
  onScrollToTop?(): void;
  onGetScrollTop?(): number;
  onSetScrollTop?(scrollTop: number): void;
}

export type GalleryMediaType = "image" | "video" | "expression" | "avatar";
export const ALL_GALLERY_MEDIA_TYPES: readonly GalleryMediaType[] = [
  "image",
  "video",
  "expression",
  "avatar",
] as const;

export type GallerySortMode = "recent" | "name" | "count" | "size" | "random";
export type GallerySortDirection = "asc" | "desc";

export const GALLERY_PAGE_SIZE_OPTIONS = [24, 48, 96, 192, 0] as const;
export const DEFAULT_GALLERY_PAGE_SIZE = 48;

export interface LibraryGalleryPreferences {
  grouped: boolean;
  viewMode: "grid" | "list";
  sortMode: GallerySortMode;
  sortDirection: GallerySortDirection;
  selectedMediaTypes: GalleryMediaType[];
  includeEmptyCharacters: boolean;
  pageSize: number;
  thumbnailSize: ThumbnailSize;
}

export interface LibraryGalleryState extends LibraryGalleryPreferences {
  searchQuery: string;
  currentPage: number;
  activeCharacterId: string | null;
  listScrollTop?: number;
  listPageBeforeDrilldown?: number;
}

export interface LibraryGalleryCacheSnapshot {
  characters: LibraryMediaCharacter[] | null;
  loadedIncludeEmpty: boolean;
  randomWeights?: Map<string, number>;
}

const VALID_SORT_MODES = new Set<GallerySortMode>([
  "recent",
  "name",
  "count",
  "size",
  "random",
]);

export function getDefaultGalleryPreferences(): LibraryGalleryPreferences {
  return {
    grouped: true,
    viewMode: "grid",
    sortMode: "name",
    sortDirection: "asc",
    selectedMediaTypes: [...ALL_GALLERY_MEDIA_TYPES],
    includeEmptyCharacters: false,
    pageSize: DEFAULT_GALLERY_PAGE_SIZE,
    thumbnailSize: DEFAULT_THUMBNAIL_SIZE,
  };
}

export function sanitizeGalleryPreferences(
  raw: unknown,
): LibraryGalleryPreferences {
  const defaults = getDefaultGalleryPreferences();
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Record<string, unknown>;

  const grouped = typeof obj.grouped === "boolean" ? obj.grouped : defaults.grouped;
  const viewMode =
    obj.viewMode === "grid" || obj.viewMode === "list"
      ? obj.viewMode
      : defaults.viewMode;
  let sortMode =
    typeof obj.sortMode === "string" &&
    VALID_SORT_MODES.has(obj.sortMode as GallerySortMode)
      ? (obj.sortMode as GallerySortMode)
      : defaults.sortMode;
  if (!grouped && sortMode === "count") {
    sortMode = "recent";
  }
  const sortDirection =
    obj.sortDirection === "asc" || obj.sortDirection === "desc"
      ? obj.sortDirection
      : defaults.sortDirection;
  const selectedMediaTypes = Array.isArray(obj.selectedMediaTypes)
    ? Array.from(
        new Set(
          obj.selectedMediaTypes.filter((t): t is GalleryMediaType =>
            (ALL_GALLERY_MEDIA_TYPES as readonly string[]).includes(String(t)),
          ),
        ),
      )
    : [...defaults.selectedMediaTypes];
  const includeEmptyCharacters =
    typeof obj.includeEmptyCharacters === "boolean"
      ? obj.includeEmptyCharacters
      : defaults.includeEmptyCharacters;
  const rawPageSize = Number(obj.pageSize);
  const pageSize = (GALLERY_PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : defaults.pageSize;
  const thumbnailSize = sanitizeThumbnailSize(obj.thumbnailSize);

  return {
    grouped,
    viewMode,
    sortMode,
    sortDirection,
    selectedMediaTypes,
    includeEmptyCharacters,
    pageSize,
    thumbnailSize,
  };
}

export interface ParsedGallerySearchQuery {
  hasQuery: boolean;
  tagFilters: string[];
  hashOrTextFilters: string[];
  textTerms: string[];
}

/**
 * Parses Gallery search input into explicit `tag:` filters, `#tag` filters
 * (which match tags or literal `#term`), and plain search terms (which match
 * character name, character tags, filenames, expressions, and URLs).
 */
export function parseGallerySearchQuery(raw: string): ParsedGalleryQuery {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      hasQuery: false,
      tagFilters: [],
      hashOrTextFilters: [],
      textTerms: [],
    };
  }

  const tagFilters: string[] = [];
  const hashOrTextFilters: string[] = [];
  const textTerms: string[] = [];

  const tokenRe = /(?:tag:|#)("[^"]*"|\S+)|"([^"]*)"|(\S+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(trimmed)) !== null) {
    const full = match[0];
    if (match[1] !== undefined) {
      const rawInner = match[1];
      const inner = (
        rawInner.startsWith('"')
          ? rawInner.slice(1, rawInner.endsWith('"') && rawInner.length > 1 ? -1 : undefined)
          : rawInner
      )
        .trim()
        .toLowerCase();
      if (!inner) continue;
      if (full.toLowerCase().startsWith("tag:")) {
        tagFilters.push(inner);
      } else {
        hashOrTextFilters.push(inner);
      }
      continue;
    }
    const plain = (match[2] ?? match[3] ?? "").trim().toLowerCase();
    if (!plain || plain === "tag:" || plain === "#") continue;
    textTerms.push(plain);
  }

  return {
    hasQuery:
      tagFilters.length > 0 ||
      hashOrTextFilters.length > 0 ||
      textTerms.length > 0,
    tagFilters,
    hashOrTextFilters,
    textTerms,
  };
}

type ParsedGalleryQuery = ParsedGallerySearchQuery;

function matchesTagFilters(
  lowerTags: string[],
  parsed: ParsedGallerySearchQuery,
): boolean {
  for (const tagFilter of parsed.tagFilters) {
    if (!lowerTags.some((t) => t.includes(tagFilter))) {
      return false;
    }
  }
  return true;
}

function matchesSearchText(
  haystacks: string[],
  lowerTags: string[],
  parsed: ParsedGallerySearchQuery,
): boolean {
  if (!parsed.hasQuery) return true;
  if (!matchesTagFilters(lowerTags, parsed)) return false;

  for (const hashTerm of parsed.hashOrTextFilters) {
    const tagHit = lowerTags.some((t) => t.includes(hashTerm));
    const literalHit = haystacks.some((h) => h.includes(`#${hashTerm}`));
    if (!tagHit && !literalHit) return false;
  }

  for (const term of parsed.textTerms) {
    const tagHit = lowerTags.some((t) => t.includes(term));
    const textHit = haystacks.some((h) => h.includes(term));
    if (!tagHit && !textHit) return false;
  }

  return true;
}

interface FlatMediaEntry {
  characterId: string;
  characterName: string;
  lowerTags: string[];
  title: string;
  subtitle: string;
  localUrl: string;
  mediaKind: MediaKind;
  sizeBytes: number;
  localizedAt: number;
  isExpression: boolean;
  isAvatar: boolean;
  badgeText: string;
  originalUrl?: string;
  searchBlob: string;
}

interface PrecomputedCharData {
  lowerName: string;
  lowerTags: string[];
  tagsSig: string;
  summaryText: string;
  hasMedia: boolean;
  hasAvatar: boolean;
  hasImage: boolean;
  hasVideo: boolean;
  hasExpression: boolean;
  videoCount: number;
  thumbUrl: string;
  thumbKind: MediaKind;
  avatarEntry: FlatMediaEntry | null;
  localizedEntries: Array<{ kind: MediaKind; entry: FlatMediaEntry }>;
  expressionEntries: FlatMediaEntry[];
}

const GALLERY_COLLATOR = new Intl.Collator();
const MAX_WARM_THUMB_CACHE = 240;
const MAX_DOM_NODE_CACHE = 192;
const EAGER_PAGE_ITEM_LIMIT = 96;
const EAGER_LEADING_WINDOW = 48;
const warmThumbCache = new Map<string, HTMLImageElement>();

function warmGalleryThumb(url: string): void {
  if (!url || typeof Image !== "function") return;
  const existing = warmThumbCache.get(url);
  if (existing) {
    warmThumbCache.delete(url);
    warmThumbCache.set(url, existing);
    return;
  }
  try {
    const preloader = new Image();
    preloader.decoding = "async";
    preloader.src = url;
    warmThumbCache.set(url, preloader);
    if (warmThumbCache.size > MAX_WARM_THUMB_CACHE) {
      const oldestKey = warmThumbCache.keys().next().value;
      if (oldestKey !== undefined) {
        warmThumbCache.delete(oldestKey);
      }
    }
  } catch {
    // Ignore non-browser environments
  }
}

export function clearWarmGalleryThumbs(url?: string): void {
  if (url !== undefined) {
    warmThumbCache.delete(url);
    return;
  }
  warmThumbCache.clear();
}

function createGalleryMediaElement(options: {
  src: string;
  mediaKind: MediaKind;
  alt: string;
  className: string;
  title?: string;
  eager?: boolean;
  thumbTier?: ThumbnailImageTier;
}): HTMLImageElement | HTMLVideoElement {
  const thumbTier = options.thumbTier ?? "sm";
  if (options.mediaKind === "image" && options.eager) {
    const safeSrc = sanitizeSafeMediaUrl(options.src);
    const thumbSrc = toThumbnailMediaUrl(safeSrc, "image", thumbTier);
    const img = document.createElement("img");
    img.className = options.className;
    img.loading = "eager";
    img.decoding = "async";
    img.alt = options.alt;
    if (options.title) img.title = options.title;
    if (thumbSrc) {
      img.src = thumbSrc;
      warmGalleryThumb(thumbSrc);
    }
    return img;
  }

  const el = createLazyMediaElement({
    src: options.src,
    mediaKind: options.mediaKind,
    alt: options.alt,
    className: options.className,
    title: options.title,
    eager: options.eager,
    thumbTier,
  });
  if (options.mediaKind === "image") {
    const img = el as HTMLImageElement;
    // Avoid Chromium's native loading="lazy" offscreen eviction / re-evaluation
    img.loading = "eager";
    const safeSrc = sanitizeSafeMediaUrl(options.src);
    const thumbSrc = toThumbnailMediaUrl(safeSrc, "image", thumbTier);
    if (thumbSrc) {
      if (img.complete && img.src) {
        warmGalleryThumb(thumbSrc);
      } else if (typeof img.addEventListener === "function") {
        img.addEventListener("load", () => warmGalleryThumb(thumbSrc), { once: true });
      }
    }
  }
  return el;
}

function isGalleryMediaContainer(el: Element): boolean {
  const cls = el.className ?? "";
  return (
    cls.includes("ml-char-card-grid") ||
    cls.includes("ml-asset-grid") ||
    cls.includes("ml-media-list")
  );
}

function reconcileContainerChildren(
  container: HTMLElement,
  nextChildren: HTMLElement[],
): void {
  const current = Array.from(container.children);
  if (
    current.length === nextChildren.length &&
    nextChildren.every((el, idx) => current[idx] === el)
  ) {
    return;
  }

  if (typeof container.insertBefore !== "function") {
    container.innerHTML = "";
    for (const child of nextChildren) {
      container.appendChild(child);
    }
    return;
  }

  const keepSet = new Set<Element>(nextChildren);
  for (const child of current) {
    if (!keepSet.has(child)) {
      child.remove();
    }
  }

  let cursor: Element | null = container.firstElementChild;
  for (const target of nextChildren) {
    while (cursor && !keepSet.has(cursor)) {
      const nextSib = cursor.nextElementSibling;
      cursor.remove();
      cursor = nextSib;
    }
    if (cursor === target) {
      cursor = cursor.nextElementSibling;
    } else {
      container.insertBefore(target, cursor);
    }
  }
}

function updateContentSlotInPlace(
  bodyOnly: HTMLElement,
  nextContent: HTMLElement,
): void {
  if (typeof bodyOnly.insertBefore !== "function") {
    bodyOnly.replaceWith(nextContent);
    return;
  }

  const oldChildren = Array.from(bodyOnly.children) as HTMLElement[];
  const newChildren = Array.from(nextContent.children) as HTMLElement[];
  const oldGrid = oldChildren.find(isGalleryMediaContainer);
  const newGrid = newChildren.find(isGalleryMediaContainer);

  if (!oldGrid || !newGrid || oldGrid.className !== newGrid.className) {
    bodyOnly.replaceWith(nextContent);
    return;
  }

  const nextCards = Array.from(newGrid.children) as HTMLElement[];
  reconcileContainerChildren(oldGrid, nextCards);

  const newGridIdx = newChildren.indexOf(newGrid);
  for (const child of oldChildren) {
    if (child !== oldGrid) {
      child.remove();
    }
  }
  for (let i = 0; i < newChildren.length; i++) {
    if (i === newGridIdx) continue;
    const child = newChildren[i]!;
    if (i < newGridIdx) {
      bodyOnly.insertBefore(child, oldGrid);
    } else {
      bodyOnly.appendChild(child);
    }
  }
}

function inferKind(mimeType: string, filename: string): MediaKind {
  if (mimeType.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(filename)) {
    return "video";
  }
  return "image";
}

function hasCharacterMedia(char: LibraryMediaCharacter): boolean {
  return char.localizedAssets.length > 0 || char.expressions.length > 0;
}

function formatCharacterSummary(char: LibraryMediaCharacter): string {
  const parts: string[] = [];
  if (char.localizedAssets.length > 0) {
    parts.push(`${char.localizedAssets.length} media`);
  }
  if (char.expressions.length > 0) {
    parts.push(`${char.expressions.length} expr`);
  }
  if (char.totalSizeBytes > 0) {
    parts.push(formatBytes(char.totalSizeBytes));
  }
  return parts.length > 0 ? parts.join(" · ") : "No media";
}

function defaultDirectionForSort(mode: GallerySortMode): GallerySortDirection {
  return mode === "name" ? "asc" : "desc";
}

function buildGalleryEmptyState(options: {
  icon: IconName;
  message: string;
  className?: string;
}): HTMLElement {
  const el = document.createElement("div");
  el.className = options.className ?? "ml-empty ml-empty-card";

  const iconWrap = document.createElement("span");
  iconWrap.className = "ml-empty-icon";
  iconWrap.appendChild(createIcon(options.icon, 15));

  const text = document.createElement("div");
  text.className = "ml-empty-text";
  text.textContent = options.message;

  el.append(iconWrap, text);
  return el;
}

function buildTileKindBadge(options: {
  icon?: IconName;
  label: string;
  modifier?: string;
  title?: string;
}): HTMLElement {
  const badge = document.createElement("span");
  badge.className = options.modifier ? `ml-tile-badge ${options.modifier}` : "ml-tile-badge";
  if (options.title) badge.title = options.title;
  if (options.icon) {
    badge.appendChild(createIcon(options.icon, 9));
  }
  const span = document.createElement("span");
  span.textContent = options.label;
  badge.appendChild(span);
  return badge;
}

export class LibraryGalleryView {
  private characters: LibraryMediaCharacter[] | null = null;
  private precomputedCharCache = new WeakMap<LibraryMediaCharacter, PrecomputedCharData>();
  private loading = false;
  private error: string | null = null;
  private destroyed = false;
  private activeRefreshPromise: Promise<void> | null = null;
  private pendingRefresh: { preserveActive: boolean; reshuffleRandom: boolean } | null = null;

  private grouped = true;
  private viewMode: "grid" | "list" = "grid";
  private sortMode: GallerySortMode = "name";
  private sortDirection: GallerySortDirection = "asc";
  private selectedMediaTypes = new Set<GalleryMediaType>(ALL_GALLERY_MEDIA_TYPES);
  private includeEmptyCharacters = false;
  private loadedIncludeEmpty = false;
  private pageSize = DEFAULT_GALLERY_PAGE_SIZE;
  private thumbnailSize: ThumbnailSize = DEFAULT_THUMBNAIL_SIZE;
  private currentPage = 1;
  private randomWeights = new Map<string, number>();
  private randomWeightsDirty = false;
  private searchQuery = "";
  private activeCharacterId: string | null = null;
  private listScrollTop = 0;
  private listPageBeforeDrilldown = 1;
  private widgetWrapEl: HTMLElement | null = null;
  private refreshBtnEl: HTMLButtonElement | null = null;
  private charCardCache = new Map<string, { sig: string; el: HTMLElement }>();
  private assetCardCache = new Map<string, { sig: string; el: HTMLElement }>();
  private listRowCache = new Map<string, { sig: string; el: HTMLElement }>();
  private cardClickHandlers = new WeakMap<HTMLElement, () => void>();
  private cardEditHandlers = new WeakMap<HTMLElement, () => void>();
  private rememberedScrollContainer: HTMLElement | null = null;
  private pendingScrollRestore: PendingScrollRestore | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: LibraryGalleryCallbacks,
    initial?: {
      state?: Partial<LibraryGalleryState>;
      cache?: LibraryGalleryCacheSnapshot;
    },
  ) {
    if (initial?.state) {
      const prefs = sanitizeGalleryPreferences(initial.state);
      this.grouped = prefs.grouped;
      this.viewMode = prefs.viewMode;
      this.sortMode = prefs.sortMode;
      this.sortDirection = prefs.sortDirection;
      this.selectedMediaTypes = new Set(prefs.selectedMediaTypes);
      this.includeEmptyCharacters = prefs.includeEmptyCharacters;
      this.pageSize = prefs.pageSize;
      this.thumbnailSize = prefs.thumbnailSize;
      if (typeof initial.state.searchQuery === "string") {
        this.searchQuery = initial.state.searchQuery;
      }
      if (
        typeof initial.state.currentPage === "number" &&
        Number.isFinite(initial.state.currentPage) &&
        initial.state.currentPage >= 1
      ) {
        this.currentPage = Math.floor(initial.state.currentPage);
      }
      if (
        typeof initial.state.activeCharacterId === "string" ||
        initial.state.activeCharacterId === null
      ) {
        this.activeCharacterId = initial.state.activeCharacterId;
      }
      if (
        typeof initial.state.listScrollTop === "number" &&
        Number.isFinite(initial.state.listScrollTop) &&
        initial.state.listScrollTop >= 0
      ) {
        this.listScrollTop = initial.state.listScrollTop;
      }
      if (
        typeof initial.state.listPageBeforeDrilldown === "number" &&
        Number.isFinite(initial.state.listPageBeforeDrilldown) &&
        initial.state.listPageBeforeDrilldown >= 1
      ) {
        this.listPageBeforeDrilldown = Math.floor(initial.state.listPageBeforeDrilldown);
      }
    }
    if (initial?.cache) {
      this.characters = initial.cache.characters;
      this.loadedIncludeEmpty = Boolean(initial.cache.loadedIncludeEmpty);
      if (initial.cache.randomWeights) {
        this.randomWeights = new Map(initial.cache.randomWeights);
      }
    }
  }

  getState(): LibraryGalleryState {
    return {
      grouped: this.grouped,
      viewMode: this.viewMode,
      sortMode: this.sortMode,
      sortDirection: this.sortDirection,
      selectedMediaTypes: Array.from(this.selectedMediaTypes),
      includeEmptyCharacters: this.includeEmptyCharacters,
      pageSize: this.pageSize,
      thumbnailSize: this.thumbnailSize,
      searchQuery: this.searchQuery,
      currentPage: this.currentPage,
      activeCharacterId: this.activeCharacterId,
      listScrollTop: this.listScrollTop,
      listPageBeforeDrilldown: this.listPageBeforeDrilldown,
    };
  }

  private getScrollContainer(): HTMLElement | null {
    return resolveScrollContainer(
      this.root.parentElement,
      this.rememberedScrollContainer,
      this.root.parentElement,
    );
  }

  private readScrollTop(): number {
    if (this.callbacks.onGetScrollTop) {
      const value = this.callbacks.onGetScrollTop();
      return Number.isFinite(value) && value >= 0 ? value : 0;
    }
    const host = this.getScrollContainer();
    if (host && typeof host.scrollTop === "number" && Number.isFinite(host.scrollTop)) {
      this.rememberedScrollContainer = host;
      return Math.max(0, host.scrollTop);
    }
    return 0;
  }

  private applyScrollTop(scrollTop: number): void {
    const next = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
    if (this.callbacks.onSetScrollTop) {
      this.callbacks.onSetScrollTop(next);
      return;
    }
    this.pendingScrollRestore = applyScrollTopWithSettlement(
      () => this.getScrollContainer(),
      next,
      this.pendingScrollRestore,
      () => this.destroyed,
    );
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingScrollRestore?.cancel();
    this.pendingScrollRestore = null;
    this.rememberedScrollContainer = null;
    this.pendingRefresh = null;
    this.widgetWrapEl = null;
    this.refreshBtnEl = null;
    this.clearRenderCaches();
  }

  private syncWrapperThumbnailClass(): void {
    if (this.widgetWrapEl) {
      this.widgetWrapEl.className = `ml-widget ${getThumbnailSizeClass(this.thumbnailSize)}`;
    }
  }

  private clearRenderCaches(): void {
    this.charCardCache.clear();
    this.assetCardCache.clear();
    this.listRowCache.clear();
  }

  private pruneRenderCache(
    cache: Map<string, { sig: string; el: HTMLElement }>,
    usedKeys: Set<string>,
    maxSize = MAX_DOM_NODE_CACHE,
  ): void {
    const limit = Math.max(maxSize, usedKeys.size);
    if (cache.size <= limit) return;
    for (const key of cache.keys()) {
      if (cache.size <= limit) break;
      if (!usedKeys.has(key)) {
        cache.delete(key);
      }
    }
  }

  private syncToolbarControls(): void {
    if (this.refreshBtnEl) {
      this.refreshBtnEl.disabled = this.loading;
      this.refreshBtnEl.className = `ml-btn ml-icon-btn is-sm${this.loading ? " is-busy" : ""}`;
    }
  }

  private emitStateChange(): void {
    if (this.destroyed) return;
    this.callbacks.onStateChange?.(this.getState());
  }

  private emitCacheChange(): void {
    if (this.destroyed) return;
    this.callbacks.onCacheChange?.({
      characters: this.characters,
      loadedIncludeEmpty: this.loadedIncludeEmpty,
      randomWeights: new Map(this.randomWeights),
    });
  }

  private flushRandomWeightsCache(): void {
    if (!this.randomWeightsDirty) return;
    this.randomWeightsDirty = false;
    this.emitCacheChange();
  }

  async refresh(
    options: boolean | { preserveActive?: boolean; reshuffleRandom?: boolean } = true,
  ): Promise<void> {
    if (this.destroyed) return;
    const preserveActive =
      typeof options === "boolean" ? options : (options.preserveActive ?? true);
    const reshuffleRandom =
      typeof options === "boolean" ? true : (options.reshuffleRandom ?? true);

    if (this.activeRefreshPromise) {
      this.pendingRefresh = {
        preserveActive: this.pendingRefresh
          ? this.pendingRefresh.preserveActive && preserveActive
          : preserveActive,
        reshuffleRandom: this.pendingRefresh
          ? this.pendingRefresh.reshuffleRandom || reshuffleRandom
          : reshuffleRandom,
      };
      return this.activeRefreshPromise;
    }

    const run = (async () => {
      const prevActiveCharId = this.activeCharacterId;
      const prevHadError =
        Boolean(this.error) || Boolean(this.root.querySelector(".ml-error-banner"));
      let drilldownExited = false;
      let nextRefresh: { preserveActive: boolean; reshuffleRandom: boolean } | null = {
        preserveActive,
        reshuffleRandom,
      };
      while (nextRefresh !== null && !this.destroyed) {
        const current: { preserveActive: boolean; reshuffleRandom: boolean } =
          nextRefresh;
        nextRefresh = null;
        this.loading = true;
        this.error = null;
        const requestedIncludeEmpty = this.includeEmptyCharacters;
        if (this.sortMode === "random" && current.reshuffleRandom) {
          this.reshuffleRandomOrder();
        }
        if (!this.characters) {
          this.render();
        } else if (this.root.querySelector(".ml-gallery-toolbar")) {
          this.syncToolbarControls();
        }
        try {
          const loaded = await this.callbacks.onLoadLibraryMedia({
            includeEmpty: requestedIncludeEmpty,
          });
          if (this.destroyed) return;
          this.characters = loaded;
          this.precomputedCharCache = new WeakMap();
          this.loadedIncludeEmpty = requestedIncludeEmpty;
          const activeCharMissing =
            Boolean(this.activeCharacterId) &&
            !this.characters.some((c) => c.characterId === this.activeCharacterId);
          if (!current.preserveActive || activeCharMissing) {
            this.activeCharacterId = null;
            if (activeCharMissing && current.preserveActive) {
              this.currentPage =
                this.listPageBeforeDrilldown >= 1 ? this.listPageBeforeDrilldown : 1;
              drilldownExited = true;
            }
          }
          this.emitCacheChange();
          this.emitStateChange();
        } catch (err) {
          if (this.destroyed) return;
          this.error = err instanceof Error ? err.message : String(err);
        } finally {
          this.loading = false;
        }

        if (this.destroyed) return;
        if (this.pendingRefresh !== null) {
          nextRefresh = this.pendingRefresh;
          this.pendingRefresh = null;
        } else if (
          !this.error &&
          this.includeEmptyCharacters &&
          !this.loadedIncludeEmpty
        ) {
          nextRefresh = current;
        }
      }
      if (!this.destroyed) {
        drilldownExited =
          drilldownExited &&
          prevActiveCharId !== null &&
          this.activeCharacterId === null;
        const canUpdateInPlace =
          Boolean(this.characters && this.characters.length > 0) &&
          !this.error &&
          !prevHadError &&
          this.activeCharacterId === prevActiveCharId &&
          Boolean(this.root.querySelector(".ml-gallery-toolbar")) &&
          Boolean(this.root.querySelector(".ml-gallery-content-slot"));
        if (canUpdateInPlace) {
          this.syncToolbarControls();
          this.rerenderContentSlot();
        } else {
          this.render(drilldownExited ? { scrollTop: this.listScrollTop } : undefined);
        }
      }
    })().finally(() => {
      this.activeRefreshPromise = null;
    });

    this.activeRefreshPromise = run;
    return run;
  }

  async ensureLoaded(): Promise<void> {
    if (this.destroyed) return;
    if (this.activeRefreshPromise) {
      await this.activeRefreshPromise;
      return;
    }
    if (this.characters === null || (this.includeEmptyCharacters && !this.loadedIncludeEmpty)) {
      await this.refresh();
    }
  }

  invalidateCache(): void {
    if (this.destroyed) return;
    this.characters = null;
    this.precomputedCharCache = new WeakMap();
    this.loadedIncludeEmpty = false;
    this.emitCacheChange();
  }

  reshuffleRandomOrder(): void {
    if (this.destroyed) return;
    this.randomWeights.clear();
    this.randomWeightsDirty = false;
    this.emitCacheChange();
  }

  private getRandomWeight(key: string): number {
    let w = this.randomWeights.get(key);
    if (w === undefined) {
      w = Math.random();
      this.randomWeights.set(key, w);
      this.randomWeightsDirty = true;
    }
    return w;
  }

  render(options?: { scrollTop?: number }): void {
    if (this.destroyed) return;
    const isPlaceholder = !this.characters && (this.loading || !this.error);
    const targetScrollTop =
      options?.scrollTop !== undefined
        ? options.scrollTop
        : isPlaceholder
          ? undefined
          : this.readScrollTop();
    this.root.innerHTML = "";
    this.widgetWrapEl = null;
    this.refreshBtnEl = null;
    const wrap = document.createElement("div");
    wrap.className = `ml-widget ${getThumbnailSizeClass(this.thumbnailSize)}`;
    this.widgetWrapEl = wrap;

    if (this.error) {
      const err = document.createElement("div");
      err.className = "ml-error-banner";
      err.appendChild(createIcon("alert", 13));
      const errText = document.createElement("span");
      errText.textContent = this.error;
      err.appendChild(errText);
      wrap.appendChild(err);
    }

    // Toolbar
    const toolbar = this.renderToolbar();
    wrap.appendChild(toolbar);

    if (isPlaceholder) {
      this.clearRenderCaches();
      wrap.appendChild(
        buildGalleryEmptyState({
          icon: "refresh",
          message: "Loading library media gallery...",
          className: "ml-section ml-empty ml-loading-card ml-placeholder",
        }),
      );
      this.root.appendChild(wrap);
      return;
    }

    const chars = this.characters ?? [];
    if (chars.length === 0) {
      this.clearRenderCaches();
      wrap.appendChild(
        buildGalleryEmptyState({
          icon: "image",
          message: this.includeEmptyCharacters
            ? "No character cards found in your library."
            : "No localized media or native expressions found yet. Enable All Cards to browse every character.",
          className: "ml-section ml-empty ml-empty-card",
        }),
      );
      this.root.appendChild(wrap);
      if (targetScrollTop !== undefined) {
        this.applyScrollTop(targetScrollTop);
      }
      return;
    }

    if (this.grouped) {
      if (this.activeCharacterId) {
        const selected = chars.find((c) => c.characterId === this.activeCharacterId);
        if (selected) {
          wrap.appendChild(this.renderCharacterDrilldown(selected));
          this.root.appendChild(wrap);
          if (targetScrollTop !== undefined) {
            this.applyScrollTop(targetScrollTop);
          }
          return;
        }
        this.activeCharacterId = null;
        this.currentPage =
          this.listPageBeforeDrilldown >= 1 ? this.listPageBeforeDrilldown : 1;
      }
      wrap.appendChild(this.renderGroupedCharacters(chars));
    } else {
      wrap.appendChild(this.renderFlatMedia(chars));
    }

    this.root.appendChild(wrap);
    if (targetScrollTop !== undefined) {
      this.applyScrollTop(targetScrollTop);
    }
  }

  private renderToolbar(): HTMLElement {
    const box = document.createElement("div");
    box.className = "ml-section ml-gallery-toolbar";

    const row1 = document.createElement("div");
    row1.className = "ml-gallery-controls";

    const infoTip = createInfoTip(
      "Browse localized media and character expressions across your entire library. Search by character name, tag (e.g. tag:fantasy or #fantasy), filename, or expression.",
    );

    const searchWrap = document.createElement("div");
    searchWrap.className = "ml-input-wrap";
    const searchIcon = document.createElement("span");
    searchIcon.className = "ml-input-icon";
    searchIcon.appendChild(createIcon("search", 13));

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "ml-input-text has-icon";
    searchInput.placeholder = "Search name, tag, tag:name, file...";
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.currentPage = 1;
      this.emitStateChange();
      this.rerenderContentSlot();
    });
    searchWrap.append(searchIcon, searchInput);

    const gridBtn = createIconButton({
      icon: "grid",
      title: "Grid view",
      className: `ml-btn ml-icon-btn is-sm${this.viewMode === "grid" ? " is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.viewMode = "grid";
        this.emitStateChange();
        this.render();
      },
    });

    const listBtn = createIconButton({
      icon: "list",
      title: "List view",
      className: `ml-btn ml-icon-btn is-sm${this.viewMode === "list" ? " is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.viewMode = "list";
        this.emitStateChange();
        this.render();
      },
    });

    const viewSegmented = document.createElement("div");
    viewSegmented.className = "ml-segmented";
    viewSegmented.append(gridBtn, listBtn);

    const refreshBtn = createIconButton({
      icon: "refresh",
      title: "Refresh library media list",
      className: `ml-btn ml-icon-btn is-sm${this.loading ? " is-busy" : ""}`,
      size: 13,
      disabled: this.loading,
      onClick: () => void this.refresh(),
    });
    this.refreshBtnEl = refreshBtn;

    const viewActions = document.createElement("div");
    viewActions.className = "ml-header-actions";
    viewActions.append(viewSegmented, refreshBtn);

    row1.append(infoTip, searchWrap, viewActions);

    const row2 = document.createElement("div");
    row2.className = "ml-header-bar";

    const sortGroup = document.createElement("div");
    sortGroup.className = "ml-sort-group";

    const sortSelect = document.createElement("select");
    sortSelect.className = "ml-select is-sm";
    sortSelect.title = "Sort order";
    const isGroupedCards = this.grouped && !this.activeCharacterId;
    const sortOpts: Array<{ value: GallerySortMode; label: string }> = [
      ...(isGroupedCards
        ? [
            { value: "name" as const, label: "Sort: Name" },
            { value: "count" as const, label: "Sort: Count" },
            { value: "size" as const, label: "Sort: Size" },
            { value: "recent" as const, label: "Sort: Recent" },
          ]
        : [
            { value: "recent" as const, label: "Sort: Recent" },
            { value: "name" as const, label: "Sort: Name" },
            { value: "size" as const, label: "Sort: Size" },
          ]),
      { value: "random", label: "Sort: Random" },
    ];
    for (const sOpt of sortOpts) {
      const opt = document.createElement("option");
      opt.value = sOpt.value;
      opt.textContent = sOpt.label;
      if (sOpt.value === this.sortMode) opt.selected = true;
      sortSelect.appendChild(opt);
    }
    sortSelect.value = sortOpts.some((o) => o.value === this.sortMode)
      ? this.sortMode
      : (sortOpts[0]?.value ?? "name");
    sortSelect.addEventListener("change", () => {
      this.sortMode = sortSelect.value as GallerySortMode;
      this.currentPage = 1;
      if (this.sortMode === "random") {
        this.reshuffleRandomOrder();
      } else {
        this.sortDirection = defaultDirectionForSort(this.sortMode);
      }
      this.emitStateChange();
      this.render();
    });

    const sortDirBtn =
      this.sortMode === "random"
        ? createIconButton({
            icon: "shuffle",
            title: "Randomize list again",
            className: "ml-btn ml-icon-btn is-sm is-active",
            size: 13,
            onClick: () => {
              this.reshuffleRandomOrder();
              this.currentPage = 1;
              this.emitStateChange();
              this.render();
            },
          })
        : createIconButton({
            icon: this.sortDirection === "asc" ? "arrow-up" : "arrow-down",
            title:
              this.sortDirection === "asc"
                ? "Ascending order (click for descending)"
                : "Descending order (click for ascending)",
            className: "ml-btn ml-icon-btn is-sm",
            size: 13,
            onClick: () => {
              this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
              this.currentPage = 1;
              this.emitStateChange();
              this.render();
            },
          });

    sortGroup.append(sortSelect, sortDirBtn);

    const modeBtns = document.createElement("div");
    modeBtns.className = "ml-header-actions";

    const groupBtn = createIconButton({
      icon: "group",
      label: "Group",
      title: this.grouped
        ? "Grouped by character card (click for flat media view)"
        : "Flat media view (click to group by character card)",
      className: `ml-btn is-sm ${this.grouped ? "is-active" : ""}`,
      size: 12,
      onClick: () => {
        this.grouped = !this.grouped;
        this.currentPage = 1;
        if (!this.grouped) {
          this.activeCharacterId = null;
          if (this.sortMode === "count") {
            this.sortMode = "recent";
            this.sortDirection = defaultDirectionForSort("recent");
          }
        }
        if (this.sortMode === "random") this.reshuffleRandomOrder();
        this.emitStateChange();
        this.render();
      },
    });

    const allCardsBtn = createIconButton({
      icon: "users",
      label: "All Cards",
      title: "Show all character cards in the library, even those without localized media yet",
      className: `ml-btn is-sm ${this.includeEmptyCharacters ? "is-active" : ""}`,
      size: 12,
      onClick: () => {
        this.includeEmptyCharacters = !this.includeEmptyCharacters;
        this.currentPage = 1;
        if (this.sortMode === "random") this.reshuffleRandomOrder();
        this.emitStateChange();
        if (this.includeEmptyCharacters && !this.loadedIncludeEmpty) {
          this.render();
          void this.refresh();
        } else {
          this.render();
        }
      },
    });

    const thumbSizeToggle = createThumbnailSizeSegmented(
      this.thumbnailSize,
      (nextSize) => {
        this.thumbnailSize = nextSize;
        this.syncWrapperThumbnailClass();
        this.emitStateChange();
        this.rerenderContentSlot();
      },
    );

    modeBtns.append(thumbSizeToggle, groupBtn, allCardsBtn);
    row2.append(sortGroup, modeBtns);

    const row3 = document.createElement("div");
    row3.className = "ml-pill-row ml-gallery-type-pills";

    const allOn = this.selectedMediaTypes.size === ALL_GALLERY_MEDIA_TYPES.length;
    const allPill = document.createElement("button");
    allPill.type = "button";
    allPill.className = `ml-pill ${allOn ? "is-selected" : ""}`;
    allPill.title = "Turn on all media types";
    allPill.appendChild(createIcon("layers", 11));
    const allPillLabel = document.createElement("span");
    allPillLabel.textContent = "All Media";
    allPill.appendChild(allPillLabel);
    allPill.addEventListener("click", () => {
      this.selectedMediaTypes = new Set(ALL_GALLERY_MEDIA_TYPES);
      this.currentPage = 1;
      this.emitStateChange();
      this.render();
    });
    row3.appendChild(allPill);

    const typeToggles: Array<{
      type: GalleryMediaType;
      label: string;
      title: string;
      icon: IconName;
      pillClass: string;
    }> = [
      { type: "image", label: "Images", title: "Toggle localized images", icon: "image", pillClass: "is-image" },
      { type: "video", label: "Videos", title: "Toggle localized videos", icon: "video", pillClass: "is-video" },
      { type: "expression", label: "Expressions", title: "Toggle character expressions", icon: "smile", pillClass: "is-expression" },
      { type: "avatar", label: "Avatars", title: "Toggle character card avatars", icon: "user", pillClass: "is-avatar" },
    ];
    for (const def of typeToggles) {
      const isSelected = this.selectedMediaTypes.has(def.type);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `ml-pill ${def.pillClass}${isSelected ? " is-selected" : ""}`;
      pill.title = def.title;
      pill.appendChild(createIcon(def.icon, 11));
      const pillLabel = document.createElement("span");
      pillLabel.textContent = def.label;
      pill.appendChild(pillLabel);
      pill.addEventListener("click", () => {
        if (this.selectedMediaTypes.has(def.type)) {
          this.selectedMediaTypes.delete(def.type);
        } else {
          this.selectedMediaTypes.add(def.type);
        }
        this.currentPage = 1;
        this.emitStateChange();
        this.render();
      });
      row3.appendChild(pill);
    }

    box.append(row1, row2, row3);
    return box;
  }

  private rerenderContentSlot(): void {
    if (this.destroyed) return;
    if (!this.characters) {
      this.render();
      return;
    }
    const bodyOnly = this.root.querySelector<HTMLElement>(".ml-gallery-content-slot");
    if (bodyOnly) {
      const savedScrollTop = this.readScrollTop();
      const selectedChar = this.activeCharacterId
        ? this.characters.find((c) => c.characterId === this.activeCharacterId)
        : undefined;
      const nextContent = this.grouped
        ? selectedChar
          ? this.renderCharacterDrilldown(selectedChar)
          : this.renderGroupedCharacters(this.characters)
        : this.renderFlatMedia(this.characters);
      updateContentSlotInPlace(bodyOnly, nextContent);
      this.applyScrollTop(savedScrollTop);
    } else {
      this.render();
    }
  }

  private getPrecomputedChar(char: LibraryMediaCharacter): PrecomputedCharData {
    let cached = this.precomputedCharCache.get(char);
    if (cached) return cached;

    const lowerTags = Array.isArray(char.tags)
      ? char.tags.map((t) => t.toLowerCase()).filter(Boolean)
      : [];
    const lowerName = char.characterName.toLowerCase();

    const avatarEntry: FlatMediaEntry | null = char.avatarUrl
      ? {
          characterId: char.characterId,
          characterName: char.characterName,
          lowerTags,
          title: `${char.characterName} — Avatar`,
          subtitle: "Character card avatar",
          localUrl: char.avatarUrl,
          mediaKind: "image",
          sizeBytes: 0,
          localizedAt: char.lastLocalizedAt,
          isExpression: false,
          isAvatar: true,
          badgeText: "Avatar",
          searchBlob: `${lowerName} avatar`,
        }
      : null;

    let hasImage = false;
    let videoCount = 0;
    const localizedEntries: Array<{ kind: MediaKind; entry: FlatMediaEntry }> =
      char.localizedAssets.map((asset) => {
        const kind = inferKind(asset.mimeType, asset.filename);
        if (kind === "video") {
          videoCount++;
        } else {
          hasImage = true;
        }
        return {
          kind,
          entry: {
            characterId: char.characterId,
            characterName: char.characterName,
            lowerTags,
            title: asset.filename,
            subtitle: `${char.characterName} · ${formatBytes(asset.sizeBytes)}`,
            localUrl: asset.localUrl,
            mediaKind: kind,
            sizeBytes: asset.sizeBytes,
            localizedAt: asset.localizedAt,
            isExpression: false,
            isAvatar: false,
            badgeText: kind === "video" ? "Video" : "Localized",
            originalUrl: asset.normalizedUrl,
            searchBlob: `${lowerName} ${asset.filename} ${asset.normalizedUrl}`.toLowerCase(),
          },
        };
      });

    const expressionEntries: FlatMediaEntry[] = char.expressions.map((expr) => ({
      characterId: char.characterId,
      characterName: char.characterName,
      lowerTags,
      title: expr.label,
      subtitle: `${char.characterName} · Expression${expr.groupName ? ` (${expr.groupName})` : ""}`,
      localUrl: expr.localUrl,
      mediaKind: "image",
      sizeBytes: 0,
      localizedAt: char.lastLocalizedAt,
      isExpression: true,
      isAvatar: false,
      badgeText: "Expr",
      searchBlob: `${lowerName} ${expr.label} ${expr.groupName ?? ""} expression`.toLowerCase(),
    }));

    const fallbackAsset = !char.avatarUrl ? char.localizedAssets[0] : undefined;
    const thumbUrl =
      char.avatarUrl ??
      fallbackAsset?.localUrl ??
      char.expressions[0]?.localUrl ??
      "";
    const thumbKind: MediaKind = fallbackAsset
      ? inferKind(fallbackAsset.mimeType, fallbackAsset.filename)
      : "image";

    cached = {
      lowerName,
      lowerTags,
      tagsSig: (char.tags ?? []).join("\u0000"),
      summaryText: formatCharacterSummary(char),
      hasMedia: hasCharacterMedia(char),
      hasAvatar: avatarEntry !== null,
      hasImage,
      hasVideo: videoCount > 0,
      hasExpression: expressionEntries.length > 0,
      videoCount,
      thumbUrl,
      thumbKind,
      avatarEntry,
      localizedEntries,
      expressionEntries,
    };
    this.precomputedCharCache.set(char, cached);
    return cached;
  }

  private hasAnySelectedEntry(pre: PrecomputedCharData): boolean {
    return (
      (pre.hasAvatar && this.selectedMediaTypes.has("avatar")) ||
      (pre.hasImage && this.selectedMediaTypes.has("image")) ||
      (pre.hasVideo && this.selectedMediaTypes.has("video")) ||
      (pre.hasExpression && this.selectedMediaTypes.has("expression"))
    );
  }

  private getCharEntries(char: LibraryMediaCharacter, includeAvatar: boolean): FlatMediaEntry[] {
    const pre = this.getPrecomputedChar(char);
    const out: FlatMediaEntry[] = [];

    if (includeAvatar && pre.avatarEntry && this.selectedMediaTypes.has("avatar")) {
      out.push(pre.avatarEntry);
    }

    for (const item of pre.localizedEntries) {
      if (this.selectedMediaTypes.has(item.kind)) {
        out.push(item.entry);
      }
    }

    if (this.selectedMediaTypes.has("expression")) {
      for (const exprEntry of pre.expressionEntries) {
        out.push(exprEntry);
      }
    }

    return out;
  }

  private sortFlatEntries(
    entries: FlatMediaEntry[],
    options?: { pinAvatarFirst?: boolean },
  ): FlatMediaEntry[] {
    const entryKey = (e: FlatMediaEntry) =>
      `item:${e.characterId}:${e.badgeText}:${e.localUrl}:${e.title}`;
    if (this.sortMode === "random") {
      entries.sort(
        (a, b) => this.getRandomWeight(entryKey(a)) - this.getRandomWeight(entryKey(b)),
      );
      this.flushRandomWeightsCache();
      return entries;
    }

    const dir = this.sortDirection === "asc" ? 1 : -1;
    const pinAvatar = Boolean(options?.pinAvatarFirst);

    return entries.sort((a, b) => {
      if (pinAvatar && a.isAvatar !== b.isAvatar) {
        return a.isAvatar ? -1 : 1;
      }
      if (this.sortMode === "name") {
        return (
          (GALLERY_COLLATOR.compare(a.characterName, b.characterName) ||
            GALLERY_COLLATOR.compare(a.title, b.title)) * dir
        );
      }
      if (this.sortMode === "size") {
        return (
          (a.sizeBytes - b.sizeBytes) * dir ||
          (a.localizedAt - b.localizedAt) * dir ||
          GALLERY_COLLATOR.compare(a.title, b.title)
        );
      }
      // "recent"
      return (
        (a.localizedAt - b.localizedAt) * dir ||
        GALLERY_COLLATOR.compare(a.characterName, b.characterName) ||
        GALLERY_COLLATOR.compare(a.title, b.title)
      );
    });
  }

  private buildPaginationBar(options: {
    totalItems: number;
    startIndex: number;
    endIndex: number;
    page: number;
    totalPages: number;
    unitLabel: string;
    includePageSizeSelect: boolean;
    scrollToTopOnFlip?: boolean;
  }): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "ml-gallery-pagination";

    const info = document.createElement("div");
    info.className = "ml-gallery-pagination-info";
    const summary = document.createElement("span");
    summary.textContent =
      options.totalPages > 1
        ? `${options.startIndex + 1}–${options.endIndex} / ${options.totalItems} ${options.unitLabel}`
        : `${options.totalItems} ${options.unitLabel}`;
    info.appendChild(summary);

    if (options.includePageSizeSelect) {
      const sizeSelect = document.createElement("select");
      sizeSelect.className = "ml-select is-sm";
      sizeSelect.title = "Items per page";
      for (const size of GALLERY_PAGE_SIZE_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = String(size);
        opt.textContent = size === 0 ? "All" : `${size} / pg`;
        if (size === this.pageSize) opt.selected = true;
        sizeSelect.appendChild(opt);
      }
      sizeSelect.value = String(this.pageSize);
      sizeSelect.addEventListener("change", () => {
        this.pageSize = Number(sizeSelect.value);
        this.currentPage = 1;
        this.emitStateChange();
        this.rerenderContentSlot();
      });
      info.appendChild(sizeSelect);
    }

    bar.appendChild(info);

    if (options.totalPages > 1) {
      const actions = document.createElement("div");
      actions.className = "ml-gallery-pagination-actions";

      const goToPage = (nextPage: number) => {
        this.currentPage = Math.max(1, Math.min(options.totalPages, nextPage));
        this.emitStateChange();
        this.rerenderContentSlot();
        if (options.scrollToTopOnFlip) {
          this.callbacks.onScrollToTop?.();
        }
      };

      const prevBtn = createIconButton({
        icon: "chevron-left",
        label: "Prev",
        title: "Previous page",
        className: "ml-btn is-sm",
        size: 12,
        disabled: options.page <= 1,
        onClick: () => goToPage(options.page - 1),
      });

      const pageLabel = document.createElement("span");
      pageLabel.className = "ml-url-sources";
      pageLabel.textContent = `Page ${options.page} / ${options.totalPages}`;

      const nextBtn = createIconButton({
        icon: "chevron-right",
        label: "Next",
        title: "Next page",
        className: "ml-btn is-sm",
        size: 12,
        disabled: options.page >= options.totalPages,
        onClick: () => goToPage(options.page + 1),
      });

      actions.append(prevBtn, pageLabel, nextBtn);
      bar.appendChild(actions);
    }

    return bar;
  }

  private appendPaginatedContent<T>(
    slot: HTMLElement,
    items: T[],
    unitLabel: string,
    renderPageItems: (pageItems: T[]) => HTMLElement,
  ): void {
    const totalItems = items.length;
    const effectiveSize = this.pageSize > 0 ? this.pageSize : totalItems;
    const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, effectiveSize)));
    const page = Math.max(1, Math.min(totalPages, this.currentPage));
    this.currentPage = page;
    const startIndex = (page - 1) * effectiveSize;
    const endIndex = Math.min(totalItems, startIndex + effectiveSize);
    const pageItems =
      this.pageSize > 0 ? items.slice(startIndex, endIndex) : items;

    const showPageSizeSelect =
      totalItems > GALLERY_PAGE_SIZE_OPTIONS[0] ||
      totalPages > 1 ||
      this.pageSize !== DEFAULT_GALLERY_PAGE_SIZE;

    slot.appendChild(
      this.buildPaginationBar({
        totalItems,
        startIndex,
        endIndex,
        page,
        totalPages,
        unitLabel,
        includePageSizeSelect: showPageSizeSelect,
      }),
    );

    slot.appendChild(renderPageItems(pageItems));

    if (totalPages > 1 && pageItems.length >= 12) {
      slot.appendChild(
        this.buildPaginationBar({
          totalItems,
          startIndex,
          endIndex,
          page,
          totalPages,
          unitLabel,
          includePageSizeSelect: false,
          scrollToTopOnFlip: true,
        }),
      );
    }
  }

  private renderGroupedCharacters(chars: LibraryMediaCharacter[]): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";

    const parsedQuery = parseGallerySearchQuery(this.searchQuery);
    const filtered = chars.filter((char) => {
      const pre = this.getPrecomputedChar(char);
      if (!this.includeEmptyCharacters && !pre.hasMedia) {
        return false;
      }
      if (!this.includeEmptyCharacters && !this.hasAnySelectedEntry(pre)) {
        return false;
      }
      if (!parsedQuery.hasQuery) return true;
      const entries = this.getCharEntries(char, true);
      const haystacks = [pre.lowerName, ...entries.map((e) => e.searchBlob)];
      return matchesSearchText(haystacks, pre.lowerTags, parsedQuery);
    });

    if (this.sortMode === "random") {
      filtered.sort(
        (a, b) =>
          this.getRandomWeight(`char:${a.characterId}`) -
          this.getRandomWeight(`char:${b.characterId}`),
      );
      this.flushRandomWeightsCache();
    } else {
      const dir = this.sortDirection === "asc" ? 1 : -1;
      filtered.sort((a, b) => {
        const countA = a.localizedAssets.length + a.expressions.length;
        const countB = b.localizedAssets.length + b.expressions.length;
        if (this.sortMode === "count") {
          return (
            (countA - countB) * dir ||
            GALLERY_COLLATOR.compare(a.characterName, b.characterName)
          );
        }
        if (this.sortMode === "size") {
          return (
            (a.totalSizeBytes - b.totalSizeBytes) * dir ||
            GALLERY_COLLATOR.compare(a.characterName, b.characterName)
          );
        }
        if (this.sortMode === "recent") {
          return (
            (a.lastLocalizedAt - b.lastLocalizedAt) * dir ||
            GALLERY_COLLATOR.compare(a.characterName, b.characterName)
          );
        }
        return GALLERY_COLLATOR.compare(a.characterName, b.characterName) * dir;
      });
    }

    if (filtered.length === 0) {
      slot.appendChild(
        buildGalleryEmptyState({
          icon: this.selectedMediaTypes.size === 0 && !this.includeEmptyCharacters ? "filter" : "search",
          message:
            this.selectedMediaTypes.size === 0 && !this.includeEmptyCharacters
              ? "No media types selected. Click All Media or enable a media type."
              : "No character cards match the current search/filter.",
        }),
      );
      return slot;
    }

    const openDrilldown = (characterId: string) => {
      this.listScrollTop = this.readScrollTop();
      this.listPageBeforeDrilldown = this.currentPage >= 1 ? this.currentPage : 1;
      this.activeCharacterId = characterId;
      this.currentPage = 1;
      if (this.sortMode === "random") this.reshuffleRandomOrder();
      this.emitStateChange();
      this.render({ scrollTop: 0 });
    };

    const thumbTier = getThumbnailImageTier(this.thumbnailSize);
    const computeCharSig = (
      char: LibraryMediaCharacter,
      pre: PrecomputedCharData,
    ): string => {
      const thumbSrc = pre.thumbUrl
        ? (toThumbnailMediaUrl(
            sanitizeSafeMediaUrl(pre.thumbUrl),
            pre.thumbKind,
            thumbTier,
          ) ?? pre.thumbUrl)
        : "";
      return [
        char.characterName,
        thumbSrc,
        pre.thumbKind,
        pre.videoCount,
        char.localizedAssets.length,
        char.expressions.length,
        char.totalSizeBytes,
        char.lastLocalizedAt,
        pre.tagsSig,
      ].join("\u0001");
    };

    this.appendPaginatedContent(slot, filtered, "cards", (pageChars) => {
      const usedKeys = new Set<string>();
      const eagerAllOnPage = pageChars.length <= EAGER_PAGE_ITEM_LIMIT;

      if (this.viewMode === "list") {
        const list = document.createElement("div");
        list.className = "ml-media-list";
        pageChars.forEach((char, idx) => {
          const pre = this.getPrecomputedChar(char);
          const sig = computeCharSig(char, pre);
          const cacheKey = `char:${char.characterId}`;
          usedKeys.add(cacheKey);
          const cached = this.listRowCache.get(cacheKey);

          let row: HTMLElement;
          if (cached && cached.sig === sig) {
            row = cached.el;
            reobserveLazyMedia(row);
            this.listRowCache.delete(cacheKey);
            this.listRowCache.set(cacheKey, cached);
          } else {
            row = document.createElement("div");
            row.className = "ml-media-list-row";
            row.addEventListener("click", () => this.cardClickHandlers.get(row)?.());

            const thumbWrap = document.createElement("div");
            thumbWrap.className = "ml-media-list-thumb-wrap";
            if (pre.thumbUrl) {
              thumbWrap.appendChild(
                createGalleryMediaElement({
                  src: pre.thumbUrl,
                  mediaKind: pre.thumbKind,
                  alt: char.characterName,
                  className: "ml-media-list-thumb",
                  eager: eagerAllOnPage || idx < EAGER_LEADING_WINDOW,
                  thumbTier,
                }),
              );
              if (pre.thumbKind === "video" || pre.videoCount > 0) {
                const kindBadge = document.createElement("span");
                kindBadge.className = "ml-media-list-kind-badge";
                kindBadge.appendChild(createIcon("video", 9));
                thumbWrap.appendChild(kindBadge);
              }
            } else {
              const placeholder = document.createElement("div");
              placeholder.className = "ml-media-list-placeholder";
              placeholder.appendChild(createIcon("user", 15));
              thumbWrap.appendChild(placeholder);
            }
            row.appendChild(thumbWrap);

            const meta = document.createElement("div");
            meta.className = "ml-url-meta";
            const name = document.createElement("div");
            name.className = "ml-url-text";
            name.textContent = char.characterName;
            const sub = document.createElement("div");
            sub.className = "ml-url-sources";
            sub.textContent = pre.summaryText;
            if (char.tags && char.tags.length > 0) {
              row.title = `Tags: ${char.tags.join(", ")}`;
            }
            meta.append(name, sub);

            const chevron = createIcon("chevron-right", 13);
            row.appendChild(meta);
            if (this.callbacks.onOpenCharacterEditor) {
              const editBtn = createIconButton({
                icon: "edit",
                title: `Edit "${char.characterName}" in native Character Editor`,
                className: "ml-btn ml-icon-btn is-sm",
                size: 12,
                onClick: (ev) => {
                  ev.stopPropagation();
                  this.cardEditHandlers.get(row)?.();
                },
              });
              row.appendChild(editBtn);
            }
            row.appendChild(chevron);
            this.listRowCache.set(cacheKey, { sig, el: row });
          }

          this.cardClickHandlers.set(row, () => openDrilldown(char.characterId));
          if (this.callbacks.onOpenCharacterEditor) {
            const onOpenEdit = this.callbacks.onOpenCharacterEditor;
            this.cardEditHandlers.set(row, () => onOpenEdit(char.characterId));
          }
          list.appendChild(row);
        });
        this.pruneRenderCache(this.listRowCache, usedKeys);
        return list;
      }

      const grid = document.createElement("div");
      grid.className = "ml-char-card-grid";

      pageChars.forEach((char, idx) => {
        const pre = this.getPrecomputedChar(char);
        const sig = computeCharSig(char, pre);
        const cacheKey = char.characterId;
        usedKeys.add(cacheKey);
        const cached = this.charCardCache.get(cacheKey);

        let card: HTMLElement;
        if (cached && cached.sig === sig) {
          card = cached.el;
          reobserveLazyMedia(card);
          this.charCardCache.delete(cacheKey);
          this.charCardCache.set(cacheKey, cached);
        } else {
          const cardEl = document.createElement("div");
          cardEl.className = "ml-char-card";
          cardEl.setAttribute("role", "button");
          cardEl.tabIndex = 0;
          cardEl.addEventListener("click", () => this.cardClickHandlers.get(cardEl)?.());
          cardEl.addEventListener("keydown", (ev) => {
            if (ev.target === cardEl && (ev.key === "Enter" || ev.key === " ")) {
              ev.preventDefault();
              this.cardClickHandlers.get(cardEl)?.();
            }
          });
          if (char.tags && char.tags.length > 0) {
            cardEl.title = `${char.characterName}\nTags: ${char.tags.join(", ")}`;
          }

          const mediaWrap = document.createElement("div");
          mediaWrap.className = "ml-char-card-thumb-wrap";
          if (pre.thumbUrl) {
            mediaWrap.appendChild(
              createGalleryMediaElement({
                src: pre.thumbUrl,
                mediaKind: pre.thumbKind,
                alt: char.characterName,
                className: "ml-char-card-thumb",
                eager: eagerAllOnPage || idx < EAGER_LEADING_WINDOW,
                thumbTier,
              }),
            );
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "ml-char-card-placeholder";
            placeholder.appendChild(createIcon("user", 24));
            mediaWrap.appendChild(placeholder);
          }

          const scrim = document.createElement("div");
          scrim.className = "ml-char-card-scrim";
          mediaWrap.appendChild(scrim);

          const badgesWrap = document.createElement("div");
          badgesWrap.className = "ml-char-card-badges";
          const total = char.localizedAssets.length + char.expressions.length;
          badgesWrap.appendChild(
            buildTileKindBadge({
              label: `${total}`,
              title: `${total} total item(s)`,
            }),
          );
          if (pre.videoCount > 0) {
            badgesWrap.appendChild(
              buildTileKindBadge({
                icon: "video",
                label: `${pre.videoCount}`,
                modifier: "is-video",
                title: `${pre.videoCount} localized video(s)`,
              }),
            );
          }
          if (char.expressions.length > 0) {
            badgesWrap.appendChild(
              buildTileKindBadge({
                icon: "smile",
                label: `${char.expressions.length}`,
                modifier: "is-expression",
                title: `${char.expressions.length} character expression(s)`,
              }),
            );
          }
          mediaWrap.appendChild(badgesWrap);

          if (this.callbacks.onOpenCharacterEditor) {
            const editBtn = createIconButton({
              icon: "edit",
              title: `Edit "${char.characterName}" in native Character Editor`,
              className: "ml-char-card-edit-btn",
              size: 11,
              onClick: (ev) => {
                ev.stopPropagation();
                this.cardEditHandlers.get(cardEl)?.();
              },
            });
            editBtn.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.stopPropagation();
              }
            });
            mediaWrap.appendChild(editBtn);
          }

          const footer = document.createElement("div");
          footer.className = "ml-char-card-footer";
          const nameEl = document.createElement("div");
          nameEl.className = "ml-char-card-name";
          nameEl.textContent = char.characterName;
          nameEl.title = char.characterName;

          const statLine = document.createElement("div");
          statLine.className = "ml-url-sources";
          statLine.textContent = pre.summaryText;
          statLine.title = pre.summaryText;

          footer.append(nameEl, statLine);
          cardEl.append(mediaWrap, footer);
          card = cardEl;
          this.charCardCache.set(cacheKey, { sig, el: card });
        }

        this.cardClickHandlers.set(card, () => openDrilldown(char.characterId));
        if (this.callbacks.onOpenCharacterEditor) {
          const onOpenEdit = this.callbacks.onOpenCharacterEditor;
          this.cardEditHandlers.set(card, () => onOpenEdit(char.characterId));
        }
        grid.appendChild(card);
      });

      this.pruneRenderCache(this.charCardCache, usedKeys);
      return grid;
    });

    return slot;
  }

  private renderCharacterDrilldown(char: LibraryMediaCharacter): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";

    const top = document.createElement("div");
    top.className = "ml-gallery-drilldown-header";

    const backBtn = createIconButton({
      icon: "chevron-left",
      label: "All Characters",
      title: "Return to character library grid",
      className: "ml-btn is-sm",
      size: 12,
      onClick: () => {
        this.activeCharacterId = null;
        this.currentPage =
          this.listPageBeforeDrilldown >= 1 ? this.listPageBeforeDrilldown : 1;
        const restoredScrollTop = this.listScrollTop;
        this.emitStateChange();
        this.render({ scrollTop: restoredScrollTop });
      },
    });

    const charLabel = document.createElement("div");
    charLabel.className = "ml-gallery-drilldown-title";
    if (char.avatarUrl) {
      charLabel.appendChild(
        createGalleryMediaElement({
          src: char.avatarUrl,
          mediaKind: "image",
          alt: char.characterName,
          className: "ml-gallery-drilldown-avatar",
          eager: true,
        }),
      );
    }
    const nameEl = document.createElement("span");
    nameEl.className = "ml-gallery-drilldown-name";
    nameEl.textContent = char.characterName;
    nameEl.title = char.characterName;
    charLabel.appendChild(nameEl);
    if (char.totalSizeBytes > 0) {
      const sizeBadge = document.createElement("span");
      sizeBadge.className = "ml-badge is-muted";
      sizeBadge.textContent = formatBytes(char.totalSizeBytes);
      charLabel.appendChild(sizeBadge);
    }

    const actions = document.createElement("div");
    actions.className = "ml-header-actions";
    if (this.callbacks.onOpenCharacterTab) {
      const manageBtn = createIconButton({
        icon: "settings",
        label: "Manage",
        title: "Open this character in the Character tab",
        className: "ml-btn is-sm",
        size: 12,
        onClick: () => this.callbacks.onOpenCharacterTab!(char.characterId),
      });
      actions.appendChild(manageBtn);
    }
    if (this.callbacks.onOpenCharacterEditor) {
      const editBtn = createIconButton({
        icon: "edit",
        label: "Edit",
        title: "Open native Character Editor for this character",
        className: "ml-btn is-sm",
        size: 12,
        onClick: () => this.callbacks.onOpenCharacterEditor!(char.characterId),
      });
      actions.appendChild(editBtn);
    }

    top.append(backBtn, charLabel, actions);
    slot.appendChild(top);

    const parsedQuery = parseGallerySearchQuery(this.searchQuery);
    const entries = this.sortFlatEntries(
      this.getCharEntries(char, true).filter((e) =>
        matchesSearchText([e.searchBlob], e.lowerTags, parsedQuery),
      ),
      { pinAvatarFirst: this.sortMode !== "random" },
    );

    if (entries.length === 0) {
      slot.appendChild(
        buildGalleryEmptyState({
          icon: this.selectedMediaTypes.size === 0 ? "filter" : !hasCharacterMedia(char) && !parsedQuery.hasQuery ? "image" : "search",
          message:
            this.selectedMediaTypes.size === 0
              ? "No media types selected. Click All Media or enable a media type."
              : !hasCharacterMedia(char) && !parsedQuery.hasQuery
                ? "No localized media yet. Click Manage to scan and localize this character."
                : "No items match the current filter.",
        }),
      );
      return slot;
    }

    this.appendPaginatedContent(slot, entries, "items", (pageEntries) =>
      this.renderMediaEntries(pageEntries),
    );
    return slot;
  }

  private renderFlatMedia(chars: LibraryMediaCharacter[]): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";

    const parsedQuery = parseGallerySearchQuery(this.searchQuery);
    const entries: FlatMediaEntry[] = [];
    for (const char of chars) {
      if (!this.includeEmptyCharacters && !hasCharacterMedia(char)) {
        continue;
      }
      for (const entry of this.getCharEntries(char, true)) {
        if (matchesSearchText([entry.searchBlob], entry.lowerTags, parsedQuery)) {
          entries.push(entry);
        }
      }
    }

    this.sortFlatEntries(entries);

    if (entries.length === 0) {
      slot.appendChild(
        buildGalleryEmptyState({
          icon: this.selectedMediaTypes.size === 0 ? "filter" : "search",
          message:
            this.selectedMediaTypes.size === 0
              ? "No media types selected. Click All Media or enable a media type."
              : "No media items match the current search/filter.",
        }),
      );
      return slot;
    }

    this.appendPaginatedContent(slot, entries, "items", (pageEntries) =>
      this.renderMediaEntries(pageEntries),
    );
    return slot;
  }

  private renderMediaEntries(entries: FlatMediaEntry[]): HTMLElement {
    if (entries.length === 0) {
      return buildGalleryEmptyState({
        icon: "search",
        message: "No items match the current filter.",
      });
    }

    const lightboxItems: LightboxItem[] = entries.map((e) => ({
      id: `${e.characterId}:${e.localUrl}:${e.title}`,
      localUrl: e.localUrl,
      mediaKind: e.mediaKind,
      title: e.title,
      subtitle: e.subtitle,
      originalUrl: e.originalUrl,
      readOnly: e.isAvatar || e.isExpression,
      badgeText: e.badgeText,
      onEditCharacter: this.callbacks.onOpenCharacterEditor
        ? () => this.callbacks.onOpenCharacterEditor!(e.characterId)
        : undefined,
      onRemove:
        !e.isAvatar && !e.isExpression && e.originalUrl
          ? async () => {
              const safeSrc = sanitizeSafeMediaUrl(e.localUrl);
              for (const tier of ["sm", "lg"] as const) {
                const thumbSrc = toThumbnailMediaUrl(
                  safeSrc,
                  e.mediaKind,
                  tier,
                );
                if (thumbSrc) clearWarmGalleryThumbs(thumbSrc);
              }
              await this.callbacks.onPurgeAsset(e.characterId, e.originalUrl!);
            }
          : undefined,
    }));

    const onAfterRemove = () => void this.refresh({ reshuffleRandom: false });
    const seenBaseKeys = new Map<string, number>();
    const usedKeys = new Set<string>();
    const eagerAllOnPage = entries.length <= EAGER_PAGE_ITEM_LIMIT;

    const nextUniqueKey = (entry: FlatMediaEntry): string => {
      const kindPrefix = entry.isAvatar ? "avatar" : entry.isExpression ? "expr" : "loc";
      const baseKey = `${entry.characterId}:${kindPrefix}:${entry.localUrl}:${entry.title}`;
      const occ = seenBaseKeys.get(baseKey) ?? 0;
      seenBaseKeys.set(baseKey, occ + 1);
      return occ === 0 ? baseKey : `${baseKey}#${occ}`;
    };

    const thumbTier = getThumbnailImageTier(this.thumbnailSize);
    const computeEntrySig = (entry: FlatMediaEntry): string => {
      const thumbSrc =
        toThumbnailMediaUrl(
          sanitizeSafeMediaUrl(entry.localUrl),
          entry.mediaKind,
          thumbTier,
        ) ?? entry.localUrl;
      return [
        thumbSrc,
        entry.mediaKind,
        entry.title,
        entry.subtitle,
        entry.badgeText,
        entry.isExpression ? "1" : "0",
        entry.isAvatar ? "1" : "0",
        entry.originalUrl ?? "",
        entry.sizeBytes,
      ].join("\u0001");
    };

    const getEntryTileBadgeSpec = (entry: FlatMediaEntry): {
      icon?: IconName;
      modifier: string;
    } => {
      if (entry.mediaKind === "video") {
        return { icon: "play", modifier: "is-video" };
      }
      if (entry.isExpression) {
        return { icon: "smile", modifier: "is-expression" };
      }
      if (entry.isAvatar) {
        return { icon: "user", modifier: "is-avatar" };
      }
      return { modifier: "is-local" };
    };

    if (this.viewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      entries.forEach((entry, index) => {
        const cacheKey = `media:${nextUniqueKey(entry)}`;
        const sig = computeEntrySig(entry);
        usedKeys.add(cacheKey);
        const cached = this.listRowCache.get(cacheKey);

        let row: HTMLElement;
        if (cached && cached.sig === sig) {
          row = cached.el;
          reobserveLazyMedia(row);
          this.listRowCache.delete(cacheKey);
          this.listRowCache.set(cacheKey, cached);
        } else {
          row = document.createElement("div");
          row.className = "ml-media-list-row";
          row.addEventListener("click", () => this.cardClickHandlers.get(row)?.());

          const thumbWrap = document.createElement("div");
          thumbWrap.className = "ml-media-list-thumb-wrap";
          thumbWrap.appendChild(
            createGalleryMediaElement({
              src: entry.localUrl,
              mediaKind: entry.mediaKind,
              alt: entry.title,
              className: "ml-media-list-thumb",
              eager: eagerAllOnPage || index < EAGER_LEADING_WINDOW,
              thumbTier,
            }),
          );
          if (entry.mediaKind === "video") {
            const kindBadge = document.createElement("span");
            kindBadge.className = "ml-media-list-kind-badge";
            kindBadge.appendChild(createIcon("play", 8));
            thumbWrap.appendChild(kindBadge);
          }

          const info = document.createElement("div");
          info.className = "ml-url-meta";
          const t = document.createElement("div");
          t.className = "ml-url-text";
          t.textContent = entry.title;
          const s = document.createElement("div");
          s.className = "ml-url-sources";
          s.textContent = entry.subtitle;
          info.append(t, s);

          const badge = document.createElement("span");
          const listBadgeClass =
            entry.isExpression || entry.isAvatar
              ? "is-info"
              : entry.mediaKind === "video"
                ? "is-type"
                : "is-local";
          badge.className = `ml-badge ${listBadgeClass}`;
          badge.textContent = entry.badgeText;

          row.append(thumbWrap, info, badge);
          this.listRowCache.set(cacheKey, { sig, el: row });
        }

        this.cardClickHandlers.set(row, () =>
          openMediaLightbox(lightboxItems, index, onAfterRemove),
        );
        list.appendChild(row);
      });
      this.pruneRenderCache(this.listRowCache, usedKeys);
      return list;
    }

    const grid = document.createElement("div");
    grid.className = "ml-asset-grid ml-gallery-grid";
    entries.forEach((entry, index) => {
      const cacheKey = nextUniqueKey(entry);
      const sig = computeEntrySig(entry);
      usedKeys.add(cacheKey);
      const cached = this.assetCardCache.get(cacheKey);

      let card: HTMLElement;
      if (cached && cached.sig === sig) {
        card = cached.el;
        reobserveLazyMedia(card);
        this.assetCardCache.delete(cacheKey);
        this.assetCardCache.set(cacheKey, cached);
      } else {
        card = document.createElement("div");
        card.className = "ml-asset-card";

        const wrap = document.createElement("div");
        wrap.className = "ml-asset-thumb-wrap";
        wrap.addEventListener("click", () => this.cardClickHandlers.get(card)?.());
        wrap.appendChild(
          createGalleryMediaElement({
            src: entry.localUrl,
            mediaKind: entry.mediaKind,
            alt: entry.title,
            className: "ml-asset-preview",
            title: `${entry.title}\n${entry.subtitle}`,
            eager: eagerAllOnPage || index < EAGER_LEADING_WINDOW,
            thumbTier,
          }),
        );

        const badgeSpec = getEntryTileBadgeSpec(entry);
        wrap.appendChild(
          buildTileKindBadge({
            icon: badgeSpec.icon,
            label: entry.badgeText,
            modifier: badgeSpec.modifier,
          }),
        );

        const footer = document.createElement("div");
        footer.className = "ml-asset-footer";
        const cap = document.createElement("div");
        cap.className = "ml-url-sources";
        cap.textContent = entry.isExpression || entry.isAvatar ? entry.title : entry.subtitle;
        cap.title = `${entry.title}\n${entry.subtitle}`;
        footer.appendChild(cap);

        card.append(wrap, footer);
        this.assetCardCache.set(cacheKey, { sig, el: card });
      }

      this.cardClickHandlers.set(card, () =>
        openMediaLightbox(lightboxItems, index, onAfterRemove),
      );
      grid.appendChild(card);
    });

    this.pruneRenderCache(this.assetCardCache, usedKeys);
    return grid;
  }
}

