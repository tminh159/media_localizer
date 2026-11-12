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

interface FlatMediaEntry {
  characterId: string;
  characterName: string;
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
  private loading = false;
  private error: string | null = null;
  private activeRefreshPromise: Promise<void> | null = null;
  private pendingRefresh: { preserveActive: boolean } | null = null;

  private grouped = true;
  private viewMode: "grid" | "list" = "grid";
  private sortMode: GallerySortMode = "name";
  private sortDirection: GallerySortDirection = "asc";
  private selectedMediaTypes = new Set<GalleryMediaType>(ALL_GALLERY_MEDIA_TYPES);
  private includeEmptyCharacters = false;
  private loadedIncludeEmpty = false;
  private randomWeights = new Map<string, number>();
  private searchQuery = "";
  private activeCharacterId: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: LibraryGalleryCallbacks,
  ) {}

  async refresh(preserveActive = true): Promise<void> {
    if (this.activeRefreshPromise) {
      this.pendingRefresh = {
        preserveActive: this.pendingRefresh
          ? this.pendingRefresh.preserveActive && preserveActive
          : preserveActive,
      };
      return this.activeRefreshPromise;
    }

    const run = (async () => {
      let nextPreserveActive: boolean | null = preserveActive;
      while (nextPreserveActive !== null) {
        const currentPreserve: boolean = nextPreserveActive;
        nextPreserveActive = null;
        this.loading = true;
        this.error = null;
        const requestedIncludeEmpty = this.includeEmptyCharacters;
        if (this.sortMode === "random") {
          this.reshuffleRandomOrder();
        }
        if (!this.characters) this.render();
        try {
          this.characters = await this.callbacks.onLoadLibraryMedia({
            includeEmpty: requestedIncludeEmpty,
          });
          this.loadedIncludeEmpty = requestedIncludeEmpty;
          if (
            !currentPreserve ||
            (this.activeCharacterId &&
              !this.characters.some((c) => c.characterId === this.activeCharacterId))
          ) {
            this.activeCharacterId = null;
          }
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
        } finally {
          this.loading = false;
        }

        if (this.pendingRefresh !== null) {
          nextPreserveActive = this.pendingRefresh.preserveActive;
          this.pendingRefresh = null;
        } else if (
          !this.error &&
          this.includeEmptyCharacters &&
          !this.loadedIncludeEmpty
        ) {
          nextPreserveActive = currentPreserve;
        }
      }
      this.render();
    })().finally(() => {
      this.activeRefreshPromise = null;
    });

    this.activeRefreshPromise = run;
    return run;
  }

  async ensureLoaded(): Promise<void> {
    if (this.activeRefreshPromise) {
      await this.activeRefreshPromise;
      return;
    }
    if (this.characters === null || (this.includeEmptyCharacters && !this.loadedIncludeEmpty)) {
      await this.refresh();
    }
  }

  invalidateCache(): void {
    this.characters = null;
    this.loadedIncludeEmpty = false;
  }

  reshuffleRandomOrder(): void {
    this.randomWeights.clear();
  }

  private getRandomWeight(key: string): number {
    let w = this.randomWeights.get(key);
    if (w === undefined) {
      w = Math.random();
      this.randomWeights.set(key, w);
    }
    return w;
  }

  render(): void {
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

    if (this.loading && !this.characters) {
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
        "Browse localized media and character expressions across your entire library. Toggle Group to inspect cards by character (avatar first) or view all sorted media flat.",
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
        if (!this.grouped) {
          this.activeCharacterId = null;
          if (this.sortMode === "count") {
            this.sortMode = "recent";
            this.sortDirection = defaultDirectionForSort("recent");
          }
        }
        if (this.sortMode === "random") this.reshuffleRandomOrder();
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
        if (this.sortMode === "random") this.reshuffleRandomOrder();
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
    searchInput.placeholder = "Search character, filename, expression...";
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      const bodyOnly = this.root.querySelector<HTMLElement>(".ml-gallery-content-slot");
      if (bodyOnly) {
        const selectedChar = this.activeCharacterId
          ? this.characters?.find((c) => c.characterId === this.activeCharacterId)
          : undefined;
        const nextContent = this.grouped
          ? selectedChar
            ? this.renderCharacterDrilldown(selectedChar)
            : this.renderGroupedCharacters(this.characters ?? [])
          : this.renderFlatMedia(this.characters ?? []);
        bodyOnly.replaceWith(nextContent);
      } else {
        this.render();
      }
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
    sortSelect.addEventListener("change", () => {
      this.sortMode = sortSelect.value as GallerySortMode;
      if (this.sortMode === "random") {
        this.reshuffleRandomOrder();
      } else {
        this.sortDirection = defaultDirectionForSort(this.sortMode);
      }
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
        this.render();
      });
      row3.appendChild(pill);
    }

    box.append(row1, row2, row3);
    return box;
  }

  private getCharEntries(char: LibraryMediaCharacter, includeAvatar: boolean): FlatMediaEntry[] {
    const out: FlatMediaEntry[] = [];

    if (includeAvatar && char.avatarUrl && this.selectedMediaTypes.has("avatar")) {
      out.push({
        characterId: char.characterId,
        characterName: char.characterName,
        title: `${char.characterName} — Avatar`,
        subtitle: "Character card avatar",
        localUrl: char.avatarUrl,
        mediaKind: "image",
        sizeBytes: 0,
        localizedAt: char.lastLocalizedAt,
        isExpression: false,
        isAvatar: true,
        badgeText: "Avatar",
        searchBlob: `${char.characterName} avatar`.toLowerCase(),
      });
    }

    for (const asset of char.localizedAssets) {
      const kind = inferKind(asset.mimeType, asset.filename);
      if (!this.selectedMediaTypes.has(kind)) continue;
      out.push({
        characterId: char.characterId,
        characterName: char.characterName,
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
        searchBlob: `${char.characterName} ${asset.filename} ${asset.normalizedUrl}`.toLowerCase(),
      });
    }

    if (this.selectedMediaTypes.has("expression")) {
      for (const expr of char.expressions) {
        out.push({
          characterId: char.characterId,
          characterName: char.characterName,
          title: expr.label,
          subtitle: `${char.characterName} · Expression${expr.groupName ? ` (${expr.groupName})` : ""}`,
          localUrl: expr.localUrl,
          mediaKind: "image",
          sizeBytes: 0,
          localizedAt: char.lastLocalizedAt,
          isExpression: true,
          isAvatar: false,
          badgeText: "Expr",
          searchBlob: `${char.characterName} ${expr.label} ${expr.groupName ?? ""} expression`.toLowerCase(),
        });
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
      return entries.sort(
        (a, b) => this.getRandomWeight(entryKey(a)) - this.getRandomWeight(entryKey(b)),
      );
    }

    const dir = this.sortDirection === "asc" ? 1 : -1;
    const pinAvatar = Boolean(options?.pinAvatarFirst);

    return entries.sort((a, b) => {
      if (pinAvatar && a.isAvatar !== b.isAvatar) {
        return a.isAvatar ? -1 : 1;
      }
      if (this.sortMode === "name") {
        return (
          (a.characterName.localeCompare(b.characterName) ||
            a.title.localeCompare(b.title)) * dir
        );
      }
      if (this.sortMode === "size") {
        return (
          (a.sizeBytes - b.sizeBytes) * dir ||
          (a.localizedAt - b.localizedAt) * dir ||
          a.title.localeCompare(b.title)
        );
      }
      // "recent"
      return (
        (a.localizedAt - b.localizedAt) * dir ||
        a.characterName.localeCompare(b.characterName) ||
        a.title.localeCompare(b.title)
      );
    });
  }

  private renderGroupedCharacters(chars: LibraryMediaCharacter[]): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";

    const q = this.searchQuery.trim().toLowerCase();
    const filtered = chars.filter((char) => {
      if (!this.includeEmptyCharacters && !hasCharacterMedia(char)) {
        return false;
      }
      const entries = this.getCharEntries(char, true);
      if (!this.includeEmptyCharacters && entries.length === 0) {
        return false;
      }
      if (!q) return true;
      if (char.characterName.toLowerCase().includes(q)) return true;
      return entries.some((e) => e.searchBlob.includes(q));
    });

    if (this.sortMode === "random") {
      filtered.sort(
        (a, b) =>
          this.getRandomWeight(`char:${a.characterId}`) -
          this.getRandomWeight(`char:${b.characterId}`),
      );
    } else {
      const dir = this.sortDirection === "asc" ? 1 : -1;
      filtered.sort((a, b) => {
        const countA = a.localizedAssets.length + a.expressions.length;
        const countB = b.localizedAssets.length + b.expressions.length;
        if (this.sortMode === "count") {
          return (countA - countB) * dir || a.characterName.localeCompare(b.characterName);
        }
        if (this.sortMode === "size") {
          return (
            (a.totalSizeBytes - b.totalSizeBytes) * dir ||
            a.characterName.localeCompare(b.characterName)
          );
        }
        if (this.sortMode === "recent") {
          return (
            (a.lastLocalizedAt - b.lastLocalizedAt) * dir ||
            a.characterName.localeCompare(b.characterName)
          );
        }
        return a.characterName.localeCompare(b.characterName) * dir;
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
      if (this.sortMode === "random") this.reshuffleRandomOrder();
      this.render();
    };

    if (this.viewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      for (const char of filtered) {
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
        meta.append(name, sub);

        const chevron = createIcon("chevron-right", 14);
        row.append(meta, chevron);
        list.appendChild(row);
      }
      slot.appendChild(list);
      return slot;
    }

    const grid = document.createElement("div");
    grid.className = "ml-char-card-grid";

    for (const char of filtered) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ml-char-card";
      card.addEventListener("click", () => openDrilldown(char.characterId));

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

    slot.appendChild(grid);
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
        if (this.sortMode === "random") this.reshuffleRandomOrder();
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

    const q = this.searchQuery.trim().toLowerCase();
    const entries = this.sortFlatEntries(
      this.getCharEntries(char, true).filter((e) => !q || e.searchBlob.includes(q)),
      { pinAvatarFirst: this.sortMode !== "random" },
    );

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent =
        this.selectedMediaTypes.size === 0
          ? "No media types selected. Click All Media or enable a media type."
          : !hasCharacterMedia(char) && !q
            ? "No localized media yet. Click Manage to scan and localize this character."
            : "No items match the current filter.";
      slot.appendChild(empty);
      return slot;
    }

    slot.appendChild(this.renderMediaEntries(entries));
    return slot;
  }

  private renderFlatMedia(chars: LibraryMediaCharacter[]): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";

    const q = this.searchQuery.trim().toLowerCase();
    const entries: FlatMediaEntry[] = [];
    for (const char of chars) {
      if (!this.includeEmptyCharacters && !hasCharacterMedia(char)) {
        continue;
      }
      for (const entry of this.getCharEntries(char, true)) {
        if (!q || entry.searchBlob.includes(q)) {
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

    slot.appendChild(this.renderMediaEntries(entries));
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
              await this.refresh();
            }
          : undefined,
    }));

    const onAfterRemove = () => void this.refresh();

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

