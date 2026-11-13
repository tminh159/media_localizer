import {
  formatBytes,
  type LibraryMediaCharacter,
  type MediaKind,
} from "../shared/types.ts";
import {
  createIcon,
  createIconButton,
  createInfoTip,
  createLazyMediaElement,
  openMediaLightbox,
  type LightboxItem,
} from "./ui-helpers.ts";

export interface LibraryGalleryCallbacks {
  onLoadLibraryMedia(options?: {
    includeEmpty?: boolean;
  }): Promise<LibraryMediaCharacter[]>;
  onPurgeAsset(characterId: string, normalizedUrl: string): Promise<void>;
  onOpenCharacterTab?(characterId: string): void;
  onStateChange?(state: LibraryGalleryState): void;
  onCacheChange?(cache: LibraryGalleryCacheSnapshot): void;
  onScrollToTop?(): void;
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
}

export interface LibraryGalleryState extends LibraryGalleryPreferences {
  searchQuery: string;
  currentPage: number;
  activeCharacterId: string | null;
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

  return {
    grouped,
    viewMode,
    sortMode,
    sortDirection,
    selectedMediaTypes,
    includeEmptyCharacters,
    pageSize,
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
  hasMedia: boolean;
  avatarEntry: FlatMediaEntry | null;
  localizedEntries: Array<{ kind: MediaKind; entry: FlatMediaEntry }>;
  expressionEntries: FlatMediaEntry[];
}

const GALLERY_COLLATOR = new Intl.Collator();

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
  return parts.length > 0 ? parts.join(" · ") : "No localized media yet";
}

function defaultDirectionForSort(mode: GallerySortMode): GallerySortDirection {
  return mode === "name" ? "asc" : "desc";
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
  private currentPage = 1;
  private randomWeights = new Map<string, number>();
  private randomWeightsDirty = false;
  private searchQuery = "";
  private activeCharacterId: string | null = null;

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
      searchQuery: this.searchQuery,
      currentPage: this.currentPage,
      activeCharacterId: this.activeCharacterId,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingRefresh = null;
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
        if (!this.characters) this.render();
        try {
          const loaded = await this.callbacks.onLoadLibraryMedia({
            includeEmpty: requestedIncludeEmpty,
          });
          if (this.destroyed) return;
          this.characters = loaded;
          this.precomputedCharCache = new WeakMap();
          this.loadedIncludeEmpty = requestedIncludeEmpty;
          if (
            !current.preserveActive ||
            (this.activeCharacterId &&
              !this.characters.some((c) => c.characterId === this.activeCharacterId))
          ) {
            this.activeCharacterId = null;
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
        this.render();
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

  render(): void {
    if (this.destroyed) return;
    this.root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "ml-widget";

    if (this.error) {
      const err = document.createElement("div");
      err.className = "ml-error-banner";
      err.textContent = this.error;
      wrap.appendChild(err);
    }

    // Toolbar
    const toolbar = this.renderToolbar();
    wrap.appendChild(toolbar);

    if (!this.characters && (this.loading || !this.error)) {
      const msg = document.createElement("div");
      msg.className = "ml-section ml-empty";
      msg.textContent = "Loading library media gallery...";
      wrap.appendChild(msg);
      this.root.appendChild(wrap);
      return;
    }

    const chars = this.characters ?? [];
    if (chars.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ml-section ml-empty";
      empty.textContent = this.includeEmptyCharacters
        ? "No character cards found in your library."
        : "No localized media or native expressions found yet. Enable All Cards to browse every character.";
      wrap.appendChild(empty);
      this.root.appendChild(wrap);
      return;
    }

    if (this.grouped) {
      if (this.activeCharacterId) {
        const selected = chars.find((c) => c.characterId === this.activeCharacterId);
        if (selected) {
          wrap.appendChild(this.renderCharacterDrilldown(selected));
          this.root.appendChild(wrap);
          return;
        }
        this.activeCharacterId = null;
      }
      wrap.appendChild(this.renderGroupedCharacters(chars));
    } else {
      wrap.appendChild(this.renderFlatMedia(chars));
    }

    this.root.appendChild(wrap);
  }

  private renderToolbar(): HTMLElement {
    const box = document.createElement("div");
    box.className = "ml-section ml-gallery-toolbar";

    const row1 = document.createElement("div");
    row1.className = "ml-header-bar";

    const titleWrap = document.createElement("div");
    titleWrap.className = "ml-inline-title";
    const title = document.createElement("span");
    title.className = "ml-title";
    title.textContent = "Library Gallery";
    titleWrap.append(
      title,
      createInfoTip(
        "Browse localized media and character expressions across your entire library. Search by character name, tag (e.g. tag:fantasy or #fantasy), filename, or expression.",
      ),
    );

    const rightBtns = document.createElement("div");
    rightBtns.className = "ml-header-actions";

    const groupBtn = createIconButton({
      icon: "group",
      label: "Group",
      title: this.grouped
        ? "Grouped by character card (click for flat media view)"
        : "Flat media view (click to group by character card)",
      className: `ml-btn is-sm ${this.grouped ? "is-active" : ""}`,
      size: 13,
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
      size: 13,
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

    const gridBtn = createIconButton({
      icon: "grid",
      title: "Grid view",
      className: `ml-btn ml-icon-btn is-sm ${this.viewMode === "grid" ? "is-active" : ""}`,
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
      className: `ml-btn ml-icon-btn is-sm ${this.viewMode === "list" ? "is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.viewMode = "list";
        this.emitStateChange();
        this.render();
      },
    });

    const refreshBtn = createIconButton({
      icon: "refresh",
      title: "Refresh library media list",
      className: `ml-btn ml-icon-btn is-sm ${this.loading ? "is-busy" : ""}`,
      size: 13,
      disabled: this.loading,
      onClick: () => void this.refresh(),
    });

    rightBtns.append(groupBtn, allCardsBtn, gridBtn, listBtn, refreshBtn);
    row1.append(titleWrap, rightBtns);

    const row2 = document.createElement("div");
    row2.className = "ml-gallery-controls";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "ml-input-text";
    searchInput.placeholder = "Search name, tag, tag:name, filename...";
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.currentPage = 1;
      this.emitStateChange();
      this.rerenderContentSlot();
    });

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
            { value: "count" as const, label: "Sort: Media Count" },
            { value: "size" as const, label: "Sort: File Size" },
            { value: "recent" as const, label: "Sort: Recent" },
          ]
        : [
            { value: "recent" as const, label: "Sort: Recent" },
            { value: "name" as const, label: "Sort: Name" },
            { value: "size" as const, label: "Sort: File Size" },
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
    row2.append(searchInput, sortGroup);

    const row3 = document.createElement("div");
    row3.className = "ml-pill-row ml-gallery-type-pills";

    const allOn = this.selectedMediaTypes.size === ALL_GALLERY_MEDIA_TYPES.length;
    const allPill = document.createElement("button");
    allPill.type = "button";
    allPill.className = `ml-pill ${allOn ? "is-selected" : ""}`;
    allPill.textContent = "All Media";
    allPill.title = "Turn on all media types";
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
    }> = [
      { type: "image", label: "Images", title: "Toggle localized images" },
      { type: "video", label: "Videos", title: "Toggle localized videos" },
      { type: "expression", label: "Expressions", title: "Toggle character expressions" },
      { type: "avatar", label: "Avatars", title: "Toggle character card avatars" },
    ];
    for (const def of typeToggles) {
      const isSelected = this.selectedMediaTypes.has(def.type);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `ml-pill ${isSelected ? "is-selected" : ""}`;
      pill.textContent = def.label;
      pill.title = def.title;
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
      const selectedChar = this.activeCharacterId
        ? this.characters.find((c) => c.characterId === this.activeCharacterId)
        : undefined;
      const nextContent = this.grouped
        ? selectedChar
          ? this.renderCharacterDrilldown(selectedChar)
          : this.renderGroupedCharacters(this.characters)
        : this.renderFlatMedia(this.characters);
      bodyOnly.replaceWith(nextContent);
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

    const localizedEntries: Array<{ kind: MediaKind; entry: FlatMediaEntry }> =
      char.localizedAssets.map((asset) => {
        const kind = inferKind(asset.mimeType, asset.filename);
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

    cached = {
      lowerName,
      lowerTags,
      hasMedia: hasCharacterMedia(char),
      avatarEntry,
      localizedEntries,
      expressionEntries,
    };
    this.precomputedCharCache.set(char, cached);
    return cached;
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
        ? `Showing ${options.startIndex + 1}–${options.endIndex} of ${options.totalItems} ${options.unitLabel}`
        : `${options.totalItems} ${options.unitLabel}`;
    info.appendChild(summary);

    if (options.includePageSizeSelect) {
      const sizeSelect = document.createElement("select");
      sizeSelect.className = "ml-select is-sm";
      sizeSelect.title = "Items per page";
      for (const size of GALLERY_PAGE_SIZE_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = String(size);
        opt.textContent = size === 0 ? "Show: All" : `${size} / page`;
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

    slot.appendChild(
      this.buildPaginationBar({
        totalItems,
        startIndex,
        endIndex,
        page,
        totalPages,
        unitLabel,
        includePageSizeSelect: true,
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
      const entries = this.getCharEntries(char, true);
      if (!this.includeEmptyCharacters && entries.length === 0) {
        return false;
      }
      if (!parsedQuery.hasQuery) return true;
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
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent =
        this.selectedMediaTypes.size === 0 && !this.includeEmptyCharacters
          ? "No media types selected. Click All Media or enable a media type."
          : "No character cards match the current search/filter.";
      slot.appendChild(empty);
      return slot;
    }

    const openDrilldown = (characterId: string) => {
      this.activeCharacterId = characterId;
      this.currentPage = 1;
      if (this.sortMode === "random") this.reshuffleRandomOrder();
      this.emitStateChange();
      this.render();
    };

    this.appendPaginatedContent(slot, filtered, "cards", (pageChars) => {
      if (this.viewMode === "list") {
        const list = document.createElement("div");
        list.className = "ml-media-list";
        for (const char of pageChars) {
          const row = document.createElement("div");
          row.className = "ml-media-list-row";
          row.addEventListener("click", () => openDrilldown(char.characterId));

          const thumbUrl =
            char.avatarUrl ??
            char.localizedAssets[0]?.localUrl ??
            char.expressions[0]?.localUrl;
          if (thumbUrl) {
            row.appendChild(
              createLazyMediaElement({
                src: thumbUrl,
                mediaKind: "image",
                alt: char.characterName,
                className: "ml-media-list-thumb",
              }),
            );
          }

          const meta = document.createElement("div");
          meta.className = "ml-url-meta";
          const name = document.createElement("div");
          name.className = "ml-url-text";
          name.textContent = char.characterName;
          const sub = document.createElement("div");
          sub.className = "ml-url-sources";
          sub.textContent = formatCharacterSummary(char);
          if (char.tags && char.tags.length > 0) {
            row.title = `Tags: ${char.tags.join(", ")}`;
          }
          meta.append(name, sub);

          const chevron = createIcon("chevron-right", 14);
          row.append(meta, chevron);
          list.appendChild(row);
        }
        return list;
      }

      const grid = document.createElement("div");
      grid.className = "ml-char-card-grid";

      for (const char of pageChars) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "ml-char-card";
        card.addEventListener("click", () => openDrilldown(char.characterId));
        if (char.tags && char.tags.length > 0) {
          card.title = `${char.characterName}\nTags: ${char.tags.join(", ")}`;
        }

        const thumbUrl =
          char.avatarUrl ??
          char.localizedAssets[0]?.localUrl ??
          char.expressions[0]?.localUrl;

        const mediaWrap = document.createElement("div");
        mediaWrap.className = "ml-char-card-thumb-wrap";
        if (thumbUrl) {
          mediaWrap.appendChild(
            createLazyMediaElement({
              src: thumbUrl,
              mediaKind: "image",
              alt: char.characterName,
              className: "ml-char-card-thumb",
            }),
          );
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "ml-char-card-placeholder";
          placeholder.appendChild(createIcon("image", 24));
          mediaWrap.appendChild(placeholder);
        }

        const countPill = document.createElement("span");
        countPill.className = "ml-tile-badge";
        const total = char.localizedAssets.length + char.expressions.length;
        countPill.textContent = `${total}`;
        mediaWrap.appendChild(countPill);

        const footer = document.createElement("div");
        footer.className = "ml-char-card-footer";
        const nameEl = document.createElement("div");
        nameEl.className = "ml-char-card-name";
        nameEl.textContent = char.characterName;
        nameEl.title = char.characterName;

        const statLine = document.createElement("div");
        statLine.className = "ml-url-sources";
        statLine.textContent = formatCharacterSummary(char);

        footer.append(nameEl, statLine);
        card.append(mediaWrap, footer);
        grid.appendChild(card);
      }

      return grid;
    });

    return slot;
  }

  private renderCharacterDrilldown(char: LibraryMediaCharacter): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";

    const top = document.createElement("div");
    top.className = "ml-header-bar";

    const backBtn = createIconButton({
      icon: "chevron-left",
      label: "All Characters",
      title: "Return to character library grid",
      className: "ml-btn is-sm",
      size: 13,
      onClick: () => {
        this.activeCharacterId = null;
        this.currentPage = 1;
        if (this.sortMode === "random") this.reshuffleRandomOrder();
        this.emitStateChange();
        this.render();
      },
    });

    const charLabel = document.createElement("div");
    charLabel.className = "ml-inline-title";
    const nameEl = document.createElement("span");
    nameEl.className = "ml-title";
    nameEl.textContent = char.characterName;
    charLabel.appendChild(nameEl);
    if (char.totalSizeBytes > 0) {
      const sizeBadge = document.createElement("span");
      sizeBadge.className = "ml-badge";
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
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent =
        this.selectedMediaTypes.size === 0
          ? "No media types selected. Click All Media or enable a media type."
          : !hasCharacterMedia(char) && !parsedQuery.hasQuery
            ? "No localized media yet. Click Manage to scan and localize this character."
            : "No items match the current filter.";
      slot.appendChild(empty);
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
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent =
        this.selectedMediaTypes.size === 0
          ? "No media types selected. Click All Media or enable a media type."
          : "No media items match the current search/filter.";
      slot.appendChild(empty);
      return slot;
    }

    this.appendPaginatedContent(slot, entries, "items", (pageEntries) =>
      this.renderMediaEntries(pageEntries),
    );
    return slot;
  }

  private renderMediaEntries(entries: FlatMediaEntry[]): HTMLElement {
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent = "No items match the current filter.";
      return empty;
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
      onRemove:
        !e.isAvatar && !e.isExpression && e.originalUrl
          ? async () => {
              await this.callbacks.onPurgeAsset(e.characterId, e.originalUrl!);
            }
          : undefined,
    }));

    const onAfterRemove = () => void this.refresh({ reshuffleRandom: false });

    if (this.viewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "ml-media-list-row";
        row.addEventListener("click", () =>
          openMediaLightbox(lightboxItems, index, onAfterRemove),
        );

        row.appendChild(
          createLazyMediaElement({
            src: entry.localUrl,
            mediaKind: entry.mediaKind,
            alt: entry.title,
            className: "ml-media-list-thumb",
          }),
        );

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
        badge.className = `ml-badge ${entry.isExpression || entry.isAvatar ? "is-info" : ""}`;
        badge.textContent = entry.badgeText;

        row.append(info, badge);
        list.appendChild(row);
      });
      return list;
    }

    const grid = document.createElement("div");
    grid.className = "ml-asset-grid ml-gallery-grid";
    entries.forEach((entry, index) => {
      const card = document.createElement("div");
      card.className = "ml-asset-card";

      const wrap = document.createElement("div");
      wrap.className = "ml-asset-thumb-wrap";
      wrap.addEventListener("click", () =>
        openMediaLightbox(lightboxItems, index, onAfterRemove),
      );
      wrap.appendChild(
        createLazyMediaElement({
          src: entry.localUrl,
          mediaKind: entry.mediaKind,
          alt: entry.title,
          className: "ml-asset-preview",
          title: `${entry.title}\n${entry.subtitle}`,
        }),
      );

      const badge = document.createElement("span");
      badge.className = `ml-tile-badge ${entry.isExpression || entry.isAvatar ? "is-info" : ""}`;
      badge.textContent = entry.badgeText;
      wrap.appendChild(badge);

      const footer = document.createElement("div");
      footer.className = "ml-asset-footer";
      const cap = document.createElement("div");
      cap.className = "ml-url-sources";
      cap.textContent = entry.isExpression || entry.isAvatar ? entry.title : entry.subtitle;
      cap.title = `${entry.title}\n${entry.subtitle}`;
      footer.appendChild(cap);

      card.append(wrap, footer);
      grid.appendChild(card);
    });

    return grid;
  }
}

