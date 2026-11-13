import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  ALL_MEDIA_SECTIONS,
  formatBytes,
  SECTION_LABELS,
  type CharacterMediaScanResult,
  type LibraryCharacterSummary,
  type LibraryMediaCharacter,
  type MediaLocalizerSettings,
  type MediaSourceSection,
  type QueueJobProgress,
  type StorageStatsSummary,
} from "../shared/types.ts";
import {
  CharacterMediaWidget,
  getDefaultCharacterPreferences,
  sanitizeCharacterPreferences,
  type CharacterMediaWidgetCallbacks,
  type CharacterWidgetUiState,
} from "./character-media-widget.ts";
import {
  getDefaultGalleryPreferences,
  LibraryGalleryView,
  sanitizeGalleryPreferences,
  type LibraryGalleryCacheSnapshot,
  type LibraryGalleryState,
} from "./library-gallery.ts";
import {
  createIconButton,
  createInfoTip,
  isQueueActiveStatus,
  renderQueueBanner,
  renderSharedDownloadConfigControls,
} from "./ui-helpers.ts";

const GALLERY_PREFS_STORAGE_KEY = "lumiverse.media_localizer.gallery_prefs.v1";
const CHARACTER_PREFS_STORAGE_KEY = "lumiverse.media_localizer.character_prefs.v1";
const LIBRARY_BATCH_PAGE_SIZE = 50;

function loadPrefsFromStorage<T>(
  key: string,
  sanitize: (raw: unknown) => T,
  fallback: () => T,
): T {
  try {
    const raw = globalThis.localStorage?.getItem?.(key);
    if (!raw) return fallback();
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback();
  }
}

function savePrefsToStorage<T>(key: string, prefs: T): void {
  try {
    globalThis.localStorage?.setItem?.(key, JSON.stringify(prefs));
  } catch {
    // Ignore storage unavailability (private browsing, test envs)
  }
}

export type DrawerTabId = "character" | "gallery" | "library" | "settings";

export interface DrawerPanelCallbacks extends CharacterMediaWidgetCallbacks {
  onScanLibrary(forceRefresh?: boolean): Promise<{
    characters: LibraryCharacterSummary[];
    totalUniqueRemote: number;
  }>;
  onListLibraryMedia(options?: {
    includeEmpty?: boolean;
  }): Promise<LibraryMediaCharacter[]>;
  onBulkPurgeCharacters(characterIds: string[]): Promise<void>;
  onUpdateSettings(
    patch: Partial<MediaLocalizerSettings>,
  ): Promise<{ settings: MediaLocalizerSettings; stats: StorageStatsSummary }>;
  onClearFailed(): Promise<{ cleared: number; stats: StorageStatsSummary }>;
}

export class MediaLocalizerDrawerPanel {
  private activeTab: DrawerTabId = "character";
  private bodyEl: HTMLElement | null = null;
  private stickyBannerHost: HTMLElement | null = null;
  private navButtons = new Map<DrawerTabId, HTMLButtonElement>();
  private characterWidget: CharacterMediaWidget | null = null;
  private characterUiState: CharacterWidgetUiState = {
    ...loadPrefsFromStorage(
      CHARACTER_PREFS_STORAGE_KEY,
      sanitizeCharacterPreferences,
      () => getDefaultCharacterPreferences(true),
    ),
    expandedUrls: [],
  };
  private characterScanCache = new Map<string, CharacterMediaScanResult>();
  private galleryView: LibraryGalleryView | null = null;
  private galleryState: LibraryGalleryState = {
    ...loadPrefsFromStorage(
      GALLERY_PREFS_STORAGE_KEY,
      sanitizeGalleryPreferences,
      getDefaultGalleryPreferences,
    ),
    searchQuery: "",
    currentPage: 1,
    activeCharacterId: null,
  };
  private galleryCache: LibraryGalleryCacheSnapshot = {
    characters: null,
    loadedIncludeEmpty: false,
  };
  private actionError: string | null = null;
  private mountGen = 0;

  // Library Batch tab state
  private libraryScanning = false;
  private librarySummaries: LibraryCharacterSummary[] | null = null;
  private librarySummariesStale = false;
  private libraryTotalRemote = 0;
  private libraryPage = 1;
  private librarySelectedCharIds = new Set<string>();
  private libraryExpandedCharIds = new Set<string>();
  private librarySelectedSections = new Set<MediaSourceSection>();
  private libraryBatchCap = 50;
  private libraryOnlyWithRemote = true;
  private inspectedCharacterId: string | null = null;
  private expandNextCharacterConfig = false;

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private settings: MediaLocalizerSettings,
    private stats: StorageStatsSummary,
    private queueProgress: QueueJobProgress,
    private readonly callbacks: DrawerPanelCallbacks,
  ) {
    this.librarySelectedSections = new Set(settings.defaultSections);
    this.libraryBatchCap = settings.defaultBatchCap;
  }

  mount(container: HTMLElement): () => void {
    const mountGen = ++this.mountGen;
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "ml-drawer-root";

    const nav = document.createElement("div");
    nav.className = "ml-drawer-nav";

    const tabs: Array<{ id: DrawerTabId; label: string }> = [
      { id: "character", label: "Character" },
      { id: "gallery", label: "Gallery" },
      { id: "library", label: "Library Batch" },
      { id: "settings", label: "Settings" },
    ];

    this.navButtons.clear();
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ml-drawer-nav-btn ${this.activeTab === t.id ? "is-active" : ""}`;
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        this.setActiveTab(t.id);
      });
      this.navButtons.set(t.id, btn);
      nav.appendChild(btn);
    }

    const bannerHost = document.createElement("div");
    bannerHost.className = "ml-drawer-sticky-banner";
    this.stickyBannerHost = bannerHost;

    const body = document.createElement("div");
    body.className = "ml-drawer-body";
    this.bodyEl = body;

    root.append(nav, bannerHost, body);
    container.appendChild(root);

    this.renderStickyQueueBanner();
    this.renderBody();

    return () => {
      if (this.mountGen === mountGen) {
        this.mountGen++;
      }
      this.characterWidget?.flushPendingOverrideSave();
      this.characterWidget?.destroy();
      this.characterWidget = null;
      this.bodyEl = null;
      this.stickyBannerHost = null;
      this.galleryView?.destroy();
      this.galleryView = null;
      this.navButtons.clear();
    };
  }

  setActiveTab(
    tab: DrawerTabId,
    characterId?: string | null,
    options?: { expandOptions?: boolean },
  ): void {
    this.activeTab = tab;
    this.actionError = null;
    if (characterId !== undefined) {
      this.inspectedCharacterId = characterId;
    }
    this.expandNextCharacterConfig = Boolean(options?.expandOptions);
    for (const [id, b] of this.navButtons.entries()) {
      b.classList.toggle("is-active", id === this.activeTab);
    }
    this.renderBody();
  }

  private renderStickyQueueBanner(): void {
    if (!this.stickyBannerHost) return;
    this.stickyBannerHost.innerHTML = "";
    if (!isQueueActiveStatus(this.queueProgress.status)) return;
    this.stickyBannerHost.appendChild(
      renderQueueBanner(this.queueProgress, this.callbacks.onQueueControl),
    );
  }

  updateExternalState(
    settings: MediaLocalizerSettings,
    stats: StorageStatsSummary,
    queueProgress: QueueJobProgress,
  ): void {
    const prevSettings = this.settings;
    const prevStatus = this.queueProgress.status;
    const prevStatsAssets = this.stats.totalAssets;
    const prevStatsFailed = this.stats.totalFailedUrls;
    const scanSettingsChanged =
      settings.scanBareUrls !== prevSettings.scanBareUrls ||
      settings.adoptNativeGalleryImages !== prevSettings.adoptNativeGalleryImages;
    const dataChanged =
      JSON.stringify(settings) !== JSON.stringify(this.settings) ||
      JSON.stringify(stats) !== JSON.stringify(this.stats);
    this.settings = settings;
    this.stats = stats;
    this.queueProgress = queueProgress;

    this.renderStickyQueueBanner();

    const wasActive = isQueueActiveStatus(prevStatus);
    const nowActive = isQueueActiveStatus(queueProgress.status);

    const galleryInvalidated = stats.totalAssets !== prevStatsAssets;
    if (galleryInvalidated) {
      this.invalidateGalleryCache();
    }
    if (
      galleryInvalidated ||
      stats.totalFailedUrls !== prevStatsFailed ||
      (wasActive && !nowActive) ||
      scanSettingsChanged
    ) {
      this.invalidateCharacterCache();
      this.invalidateLibrarySummaries();
    }

    if (this.activeTab === "character") {
      const nextId = this.resolveCurrentCharacterId();
      const currentId = this.characterWidget?.getCharacterId() ?? null;
      if (nextId !== currentId) {
        if (this.bodyEl) this.renderBody();
        return;
      }
      if (this.characterWidget) {
        this.characterWidget.updateExternalState(settings, queueProgress);
        return;
      }
    }

    if (!this.bodyEl) return;

    if (this.activeTab === "gallery") {
      if ((wasActive && !nowActive) || galleryInvalidated) {
        void this.galleryView?.refresh({ reshuffleRandom: false });
      }
      return;
    }

    if (!dataChanged && (prevStatus === queueProgress.status || (wasActive && nowActive))) {
      return;
    }
    if (this.activeTab === "settings" && !dataChanged) return;
    if (this.activeTab === "library" && !dataChanged) return;
    this.renderBody();
  }

  private async guard(
    fn: () => Promise<unknown>,
    expectedTab: DrawerTabId = this.activeTab,
  ): Promise<boolean> {
    const mountGen = this.mountGen;
    try {
      this.actionError = null;
      await fn();
      return true;
    } catch (err) {
      if (!this.bodyEl || this.mountGen !== mountGen || this.activeTab !== expectedTab) {
        return false;
      }
      this.actionError = err instanceof Error ? err.message : String(err);
      this.renderBody();
      return false;
    }
  }

  notifyActiveChatChanged(): void {
    this.inspectedCharacterId = null;
    if (this.activeTab === "character" && this.bodyEl) {
      const nextId = this.resolveCurrentCharacterId();
      const currentId = this.characterWidget?.getCharacterId() ?? null;
      if (this.characterWidget && nextId && currentId === nextId) {
        return;
      }
      if (this.characterWidget && nextId) {
        this.characterWidget.setCharacterId(nextId);
        return;
      }
      this.renderBody();
    }
  }

  invalidateCharacterCache(characterId?: string): void {
    if (characterId) {
      this.characterScanCache.delete(characterId);
    } else {
      this.characterScanCache.clear();
    }
  }

  private invalidateGalleryCache(): void {
    this.galleryCache = {
      characters: null,
      loadedIncludeEmpty: false,
      randomWeights: this.galleryCache.randomWeights,
    };
    this.galleryView?.invalidateCache();
  }

  private invalidateLibrarySummaries(): void {
    this.librarySummaries = null;
    this.librarySummariesStale = false;
    this.librarySelectedCharIds.clear();
    this.libraryExpandedCharIds.clear();
    this.libraryPage = 1;
  }

  refreshActiveScan(characterId?: string): void {
    this.invalidateGalleryCache();
    this.invalidateCharacterCache(characterId);
    this.invalidateLibrarySummaries();
    if (this.activeTab === "gallery" && this.bodyEl && this.galleryView) {
      void this.galleryView.refresh({ reshuffleRandom: false });
    }
    if (!this.characterWidget) {
      if (this.activeTab === "character" && this.bodyEl && this.resolveCurrentCharacterId()) {
        this.renderBody();
      }
      return;
    }
    if (characterId && this.characterWidget.getCharacterId() !== characterId) {
      return;
    }
    void this.characterWidget.refreshScan(true);
  }

  private resolveCurrentCharacterId(): string | null {
    if (this.inspectedCharacterId) return this.inspectedCharacterId;
    try {
      const editorState = this.ctx.ui?.characterEditor?.getState?.();
      if (editorState?.open && editorState.characterId) {
        return editorState.characterId;
      }
    } catch {
      // ignore
    }
    try {
      const editingId = this.ctx.state?.get?.("characters.editingId");
      if (typeof editingId === "string" && editingId) {
        return editingId;
      }
    } catch {
      // ignore
    }
    try {
      const activeChat = this.ctx.getActiveChat?.();
      if (activeChat?.characterId) return activeChat.characterId;
    } catch {
      // ignore
    }
    try {
      const activeState = this.ctx.state?.get?.("chat.active") as
        | { characterId?: string | null }
        | undefined;
      if (activeState?.characterId) return activeState.characterId;
    } catch {
      // ignore
    }
    return null;
  }

  private renderBody(): void {
    const body = this.bodyEl;
    if (!body) return;

    const savedBodyScrollTop = body.scrollTop;
    const savedInnerScrolls = new Map<string, number>();
    for (const el of body.querySelectorAll<HTMLElement>("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (id && el.scrollTop > 0) {
        savedInnerScrolls.set(id, el.scrollTop);
      }
    }

    this.characterWidget?.flushPendingOverrideSave();
    this.characterWidget?.destroy();
    this.characterWidget = null;
    this.galleryView?.destroy();
    this.galleryView = null;
    body.innerHTML = "";

    if (this.actionError) {
      const errBox = document.createElement("div");
      errBox.className = "ml-error-banner";
      errBox.textContent = `Error: ${this.actionError}`;
      body.appendChild(errBox);
    }

    if (this.activeTab === "character") {
      this.renderCharacterTab(body);
    } else if (this.activeTab === "gallery") {
      this.renderGalleryTab(body);
    } else if (this.activeTab === "library") {
      this.renderLibraryTab(body);
    } else {
      this.renderSettingsTab(body);
    }

    for (const [id, top] of savedInnerScrolls.entries()) {
      const el = body.querySelector<HTMLElement>(`[data-scroll-id="${id}"]`);
      if (el) el.scrollTop = top;
    }
    body.scrollTop = savedBodyScrollTop;
  }

  private renderCharacterTab(body: HTMLElement): void {
    const charId = this.resolveCurrentCharacterId();
    if (!charId) {
      const empty = document.createElement("div");
      empty.className = "ml-section-box ml-empty";
      empty.textContent =
        "Open a character chat or Character Editor to inspect and localize its media.";
      body.appendChild(empty);
      return;
    }

    const forceExpandConfig = this.expandNextCharacterConfig;
    this.expandNextCharacterConfig = false;
    if (forceExpandConfig && !this.characterUiState.showDownloadConfig) {
      this.characterUiState = {
        ...this.characterUiState,
        showDownloadConfig: true,
      };
      savePrefsToStorage(
        CHARACTER_PREFS_STORAGE_KEY,
        sanitizeCharacterPreferences(this.characterUiState, true),
      );
    }

    const cachedScan = this.characterScanCache.get(charId) ?? null;

    const host = document.createElement("div");
    host.className = "ml-gallery-host";
    host.style.marginTop = "0";
    body.appendChild(host);

    const widgetCallbacks: CharacterMediaWidgetCallbacks = {
      ...this.callbacks,
      onPurgeCharacterCache: async (targetCharId, urls) => {
        await this.callbacks.onPurgeCharacterCache(targetCharId, urls);
        this.invalidateGalleryCache();
        this.invalidateLibrarySummaries();
      },
    };

    const widget = new CharacterMediaWidget(
      host,
      this.ctx,
      charId,
      this.settings,
      this.queueProgress,
      widgetCallbacks,
      {
        inDrawer: true,
        defaultExpandConfig: this.characterUiState.showDownloadConfig,
        defaultExpandDownloadedMedia: this.characterUiState.showDownloadedMedia,
        initialUiState: this.characterUiState,
        initialScan: cachedScan,
        onUiStateChange: (nextState) => {
          this.characterUiState = {
            ...nextState,
            expandedUrls: [...nextState.expandedUrls],
          };
          savePrefsToStorage(
            CHARACTER_PREFS_STORAGE_KEY,
            sanitizeCharacterPreferences(this.characterUiState, true),
          );
        },
        onScanChange: (nextScan) => {
          if (nextScan) {
            this.characterScanCache.set(nextScan.characterId, nextScan);
          }
        },
      },
    );
    this.characterWidget = widget;
    if (cachedScan) {
      widget.render();
    } else {
      void widget.refreshScan(false);
    }
  }

  private renderGalleryTab(body: HTMLElement): void {
    const host = document.createElement("div");
    body.appendChild(host);

    const gallery = new LibraryGalleryView(
      host,
      {
        onLoadLibraryMedia: this.callbacks.onListLibraryMedia,
        onPurgeAsset: async (characterId, normalizedUrl) => {
          await this.callbacks.onPurgeCharacterCache(characterId, [normalizedUrl]);
          this.invalidateCharacterCache(characterId);
          this.invalidateLibrarySummaries();
        },
        onOpenCharacterTab: (characterId) => {
          this.setActiveTab("character", characterId);
        },
        onStateChange: (nextState) => {
          this.galleryState = {
            ...nextState,
            selectedMediaTypes: [...nextState.selectedMediaTypes],
          };
          savePrefsToStorage(
            GALLERY_PREFS_STORAGE_KEY,
            sanitizeGalleryPreferences(this.galleryState),
          );
        },
        onCacheChange: (nextCache) => {
          this.galleryCache = nextCache;
        },
        onScrollToTop: () => {
          if (this.bodyEl) {
            this.bodyEl.scrollTop = 0;
          }
        },
      },
      {
        state: this.galleryState,
        cache: this.galleryCache,
      },
    );
    this.galleryView = gallery;
    gallery.render();
    void gallery.ensureLoaded();
  }

  private renderLibraryTab(body: HTMLElement): void {
    const scanBox = document.createElement("div");
    scanBox.className = "ml-section-box";

    const topBar = document.createElement("div");
    topBar.className = "ml-header-bar";

    const info = document.createElement("div");
    info.className = "ml-inline-title";
    const title = document.createElement("span");
    title.className = "ml-title";
    title.textContent = "Library Scanner & Batch Operations";
    info.append(
      title,
      createInfoTip(
        "Scans characters, World Books, and Regex scripts locally with zero network traffic so you can batch-download or clear storage.",
      ),
    );

    const scanBtn = createIconButton({
      icon: "refresh",
      label: this.libraryScanning
        ? "Scanning..."
        : this.librarySummaries
          ? "Rescan Library"
          : "Scan Library",
      title: "Scan all characters, linked World Books, and Regex scripts locally",
      className: `ml-btn is-primary ${this.libraryScanning ? "is-busy" : ""}`,
      size: 14,
      disabled: this.libraryScanning,
      onClick: async () => {
        const mountGen = this.mountGen;
        this.actionError = null;
        this.libraryScanning = true;
        if (this.activeTab === "library" && this.bodyEl) {
          this.renderBody();
        }
        try {
          const res = await this.callbacks.onScanLibrary(Boolean(this.librarySummaries));
          if (!this.bodyEl || this.mountGen !== mountGen) return;
          this.librarySummaries = res.characters;
          this.librarySummariesStale = false;
          this.libraryTotalRemote = res.totalUniqueRemote;
          this.libraryPage = 1;
          this.librarySelectedCharIds = new Set(
            res.characters
              .filter((c) => c.remoteCount + c.failedCount > 0)
              .map((c) => c.characterId),
          );
        } catch (err) {
          if (this.bodyEl && this.mountGen === mountGen && this.activeTab === "library") {
            this.actionError = err instanceof Error ? err.message : String(err);
          }
        } finally {
          this.libraryScanning = false;
          if (this.activeTab === "library" && this.bodyEl && this.mountGen === mountGen) {
            this.renderBody();
          }
        }
      },
    });

    topBar.append(info, scanBtn);
    scanBox.appendChild(topBar);
    body.appendChild(scanBox);

    if (!this.librarySummaries) return;

    if (this.librarySummariesStale) {
      const staleNote = document.createElement("div");
      staleNote.className = "ml-section-box ml-subtitle";
      staleNote.textContent =
        "Library media changed since last scan. Click Rescan Library to refresh counts.";
      body.appendChild(staleNote);
    }

    const filterBox = document.createElement("div");
    filterBox.className = "ml-section-box";

    const secHeader = document.createElement("div");
    secHeader.className = "ml-section-title";
    const secLeft = document.createElement("div");
    secLeft.className = "ml-inline-title";
    secLeft.append(
      document.createTextNode("1. Sections to Download"),
      createInfoTip("Only remote items found inside checked sections are queued across selected characters."),
    );
    secHeader.appendChild(secLeft);
    filterBox.appendChild(secHeader);

    let charHeaderTitle!: HTMLSpanElement;
    let listSlotEl!: HTMLElement;
    let footerSlotEl!: HTMLElement;
    const cardCheckboxes = new Map<string, HTMLInputElement>();

    const updateHeaderSummary = () => {
      charHeaderTitle.textContent = `2. Characters (${this.librarySelectedCharIds.size} selected · ${this.libraryTotalRemote} unique remote)`;
    };

    const buildCharDetails = (c: LibraryCharacterSummary): HTMLElement => {
      const details = document.createElement("div");
      details.className = "ml-item-details";

      const statRow = document.createElement("div");
      statRow.className = "ml-detail-kv-row";

      const addMiniBadge = (label: string, variant = "") => {
        const b = document.createElement("span");
        b.className = `ml-badge ${variant}`.trim();
        b.textContent = label;
        statRow.appendChild(b);
      };
      addMiniBadge(`${c.totalUnique} Unique URLs`);
      addMiniBadge(`${c.localizedCount} Localized`, "is-success");
      addMiniBadge(`${c.remoteCount} Remote`, c.remoteCount > 0 ? "is-warn" : "");
      if (c.failedCount > 0) addMiniBadge(`${c.failedCount} Failed`, "is-danger");
      if (c.localizedBytes > 0) addMiniBadge(`Size: ${formatBytes(c.localizedBytes)}`);
      details.appendChild(statRow);

      const secList = document.createElement("div");
      secList.className = "ml-detail-source-list";
      for (const sec of ALL_MEDIA_SECTIONS) {
        const count = c.sectionRemoteCounts[sec] || 0;
        if (count === 0) continue;
        const chip = document.createElement("span");
        chip.className = "ml-detail-source-chip";
        chip.textContent = `${SECTION_LABELS[sec]}: ${count} remote`;
        secList.appendChild(chip);
      }
      if (secList.childElementCount > 0) {
        details.appendChild(secList);
      }

      const actionsRow = document.createElement("div");
      actionsRow.className = "ml-detail-kv-row";
      const inspectBtn = document.createElement("button");
      inspectBtn.type = "button";
      inspectBtn.className = "ml-btn is-sm is-primary";
      inspectBtn.textContent = "Open in Character Tab ↗";
      inspectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setActiveTab("character", c.characterId);
      });
      actionsRow.appendChild(inspectBtn);
      details.appendChild(actionsRow);
      return details;
    };

    const buildFooter = (): HTMLElement => {
      let estimatedMatching = 0;
      let selectedLocalizedChars = 0;
      for (const c of this.librarySummaries ?? []) {
        if (!this.librarySelectedCharIds.has(c.characterId)) continue;
        if (c.localizedCount > 0) selectedLocalizedChars++;
        let charSum = 0;
        for (const sec of this.librarySelectedSections) {
          charSum += c.sectionRemoteCounts[sec] || 0;
        }
        estimatedMatching += Math.min(c.remoteCount + c.failedCount, charSum);
      }

      const footer = document.createElement("div");
      footer.className = "ml-download-bar";

      const capLabel = document.createElement("label");
      capLabel.className = "ml-toggle-label";
      capLabel.textContent = "Limit:";
      const capSelect = document.createElement("select");
      capSelect.className = "ml-select is-sm";
      for (const v of [10, 25, 50, 100, 250, 0]) {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = v === 0 ? "Unlimited" : `Max ${v}`;
        if (v === this.libraryBatchCap) opt.selected = true;
        capSelect.appendChild(opt);
      }
      capSelect.addEventListener("change", () => {
        this.libraryBatchCap = Number(capSelect.value);
        updateSummaryAndFooter();
      });
      capLabel.appendChild(capSelect);

      const footerBtns = document.createElement("div");
      footerBtns.className = "ml-header-actions";

      if (selectedLocalizedChars > 0) {
        footerBtns.appendChild(
          createIconButton({
            icon: "trash",
            label: `Remove (${selectedLocalizedChars})`,
            title: `Remove all localized cache assets for ${selectedLocalizedChars} selected character(s)`,
            className: "ml-btn is-danger is-sm",
            size: 13,
            onClick: async () => {
              const mountGen = this.mountGen;
              const targetIds = Array.from(this.librarySelectedCharIds);
              if (targetIds.length === 0) return;
              const res = await this.ctx.ui.showConfirm({
                title: "Remove Localized Cache for Selected Characters",
                message: `Remove localized media for ${targetIds.length} selected character(s)? Original card URLs and native expressions are untouched.`,
                confirmLabel: "Remove Localized",
                cancelLabel: "Cancel",
                variant: "danger",
              });
              if (
                !this.bodyEl ||
                this.mountGen !== mountGen ||
                this.activeTab !== "library" ||
                !res?.confirmed
              ) {
                return;
              }
              const purgeSucceeded = await this.guard(async () => {
                await this.callbacks.onBulkPurgeCharacters(targetIds);
                if (!this.bodyEl || this.mountGen !== mountGen) return;
                const rescanned = await this.callbacks.onScanLibrary(false);
                if (!this.bodyEl || this.mountGen !== mountGen) return;
                this.librarySummaries = rescanned.characters;
                this.librarySummariesStale = false;
                this.libraryTotalRemote = rescanned.totalUniqueRemote;
                this.libraryPage = 1;
                this.librarySelectedCharIds = new Set(
                  Array.from(this.librarySelectedCharIds).filter((id) =>
                    rescanned.characters.some((c) => c.characterId === id),
                  ),
                );
                for (const id of targetIds) {
                  this.invalidateCharacterCache(id);
                }
                this.invalidateGalleryCache();
              }, "library");
              if (
                purgeSucceeded &&
                this.activeTab === "library" &&
                this.bodyEl &&
                this.mountGen === mountGen
              ) {
                this.renderBody();
              }
            },
          }),
        );
      }

      const effectiveBatchCount =
        this.libraryBatchCap > 0
          ? Math.min(estimatedMatching, this.libraryBatchCap)
          : estimatedMatching;

      const batchStartBtn = createIconButton({
        icon: "download",
        label: `Download (~${effectiveBatchCount})`,
        title: `Queue up to ${effectiveBatchCount} files across ${this.librarySelectedCharIds.size} selected cards`,
        className: "ml-btn is-primary is-sm",
        size: 13,
        disabled:
          this.librarySelectedCharIds.size === 0 ||
          this.librarySelectedSections.size === 0 ||
          effectiveBatchCount === 0,
        onClick: async () => {
          const mountGen = this.mountGen;
          const charIds = Array.from(this.librarySelectedCharIds);
          const sections = Array.from(this.librarySelectedSections);
          const maxItems = this.libraryBatchCap;
          if (effectiveBatchCount > this.settings.confirmThreshold) {
            const res = await this.ctx.ui.showConfirm({
              title: "Confirm Library Batch Download",
              message: `Start downloading up to ${effectiveBatchCount} remote media files across ${charIds.length} selected characters?`,
              confirmLabel: `Start Batch (${effectiveBatchCount})`,
              cancelLabel: "Cancel",
            });
            if (
              !this.bodyEl ||
              this.mountGen !== mountGen ||
              this.activeTab !== "library" ||
              !res?.confirmed
            ) {
              return;
            }
          }
          batchStartBtn.disabled = true;
          try {
            await this.guard(
              () =>
                this.callbacks.onStartDownload({
                  characterIds: charIds,
                  sections,
                  mediaKinds: this.settings.defaultMediaKinds,
                  includeFailed: this.settings.defaultIncludeFailed,
                  maxItems,
                }),
              "library",
            );
          } finally {
            batchStartBtn.disabled =
              this.librarySelectedCharIds.size === 0 ||
              this.librarySelectedSections.size === 0 ||
              effectiveBatchCount === 0;
          }
        },
      });

      footerBtns.appendChild(batchStartBtn);
      footer.append(capLabel, footerBtns);
      return footer;
    };

    const updateSummaryAndFooter = () => {
      updateHeaderSummary();
      const nextFooter = buildFooter();
      footerSlotEl.replaceWith(nextFooter);
      footerSlotEl = nextFooter;
    };

    const buildCharListSlot = (): HTMLElement => {
      const slot = document.createElement("div");
      slot.className = "ml-stack";
      cardCheckboxes.clear();

      const visibleChars = (this.librarySummaries ?? []).filter(
        (c) => !this.libraryOnlyWithRemote || c.remoteCount + c.failedCount > 0,
      );
      const totalItems = visibleChars.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / LIBRARY_BATCH_PAGE_SIZE));
      const page = Math.max(1, Math.min(totalPages, this.libraryPage));
      this.libraryPage = page;
      const startIndex = (page - 1) * LIBRARY_BATCH_PAGE_SIZE;
      const endIndex = Math.min(totalItems, startIndex + LIBRARY_BATCH_PAGE_SIZE);
      const pageChars = visibleChars.slice(startIndex, endIndex);

      if (totalItems > 0) {
        const pagBar = document.createElement("div");
        pagBar.className = "ml-gallery-pagination";

        const pagInfo = document.createElement("div");
        pagInfo.className = "ml-gallery-pagination-info";
        const pagText = document.createElement("span");
        pagText.textContent =
          totalPages > 1
            ? `Showing ${startIndex + 1}–${endIndex} of ${totalItems} characters`
            : `${totalItems} character${totalItems === 1 ? "" : "s"}`;
        pagInfo.appendChild(pagText);
        pagBar.appendChild(pagInfo);

        if (totalPages > 1) {
          const pagActions = document.createElement("div");
          pagActions.className = "ml-gallery-pagination-actions";
          const prevBtn = createIconButton({
            icon: "chevron-left",
            label: "Prev",
            title: "Previous page",
            className: "ml-btn is-sm",
            size: 12,
            disabled: page <= 1,
            onClick: () => {
              this.libraryPage = Math.max(1, page - 1);
              rerenderCharList();
            },
          });
          const pageLabel = document.createElement("span");
          pageLabel.className = "ml-url-sources";
          pageLabel.textContent = `Page ${page} / ${totalPages}`;
          const nextBtn = createIconButton({
            icon: "chevron-right",
            label: "Next",
            title: "Next page",
            className: "ml-btn is-sm",
            size: 12,
            disabled: page >= totalPages,
            onClick: () => {
              this.libraryPage = Math.min(totalPages, page + 1);
              rerenderCharList();
            },
          });
          pagActions.append(prevBtn, pageLabel, nextBtn);
          pagBar.appendChild(pagActions);
        }
        slot.appendChild(pagBar);
      }

      const charList = document.createElement("div");
      charList.className = "ml-url-list";
      charList.dataset.scrollId = "library-char-list";
      for (const c of pageChars) {
        const isExpanded = this.libraryExpandedCharIds.has(c.characterId);
        const card = document.createElement("div");
        card.className = `ml-lib-item-card ${isExpanded ? "is-expanded" : ""}`;

        const row = document.createElement("div");
        row.className = "ml-lib-row";

        const left = document.createElement("div");
        left.className = "ml-check-card-left";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "ml-row-checkbox";
        cb.checked = this.librarySelectedCharIds.has(c.characterId);
        cb.addEventListener("click", (e) => e.stopPropagation());
        cb.addEventListener("change", () => {
          if (cb.checked) this.librarySelectedCharIds.add(c.characterId);
          else this.librarySelectedCharIds.delete(c.characterId);
          updateSummaryAndFooter();
        });
        cardCheckboxes.set(c.characterId, cb);

        const nameSpan = document.createElement("span");
        nameSpan.style.fontWeight = "500";
        nameSpan.textContent = c.characterName;
        left.append(cb, nameSpan);

        const right = document.createElement("div");
        right.className = "ml-header-actions";
        const badge = document.createElement("span");
        const pending = c.remoteCount + c.failedCount;
        badge.className = `ml-badge ${pending > 0 ? "is-warn" : "is-success"}`;
        badge.textContent =
          pending > 0
            ? `${pending} remote (${c.localizedCount}/${c.totalUnique} local)`
            : `${c.localizedCount}/${c.totalUnique} local`;
        right.appendChild(badge);

        if (c.localizedBytes > 0) {
          const sizeBadge = document.createElement("span");
          sizeBadge.className = "ml-badge";
          sizeBadge.textContent = formatBytes(c.localizedBytes);
          right.appendChild(sizeBadge);
        }

        const expandHint = document.createElement("span");
        expandHint.className = "ml-expand-hint";
        expandHint.textContent = isExpanded ? "Hide ▴" : "Info ▾";
        right.appendChild(expandHint);

        row.append(left, right);
        let detailsEl: HTMLElement | null = isExpanded ? buildCharDetails(c) : null;
        row.addEventListener("click", () => {
          const nowExpanded = !this.libraryExpandedCharIds.has(c.characterId);
          if (nowExpanded) {
            this.libraryExpandedCharIds.add(c.characterId);
            card.classList.add("is-expanded");
            expandHint.textContent = "Hide ▴";
            if (!detailsEl) {
              detailsEl = buildCharDetails(c);
            }
            card.appendChild(detailsEl);
          } else {
            this.libraryExpandedCharIds.delete(c.characterId);
            card.classList.remove("is-expanded");
            expandHint.textContent = "Info ▾";
            detailsEl?.remove();
            detailsEl = null;
          }
        });

        card.appendChild(row);
        if (detailsEl) {
          card.appendChild(detailsEl);
        }

        charList.appendChild(card);
      }
      slot.appendChild(charList);
      return slot;
    };

    const rerenderCharList = () => {
      const nextSlot = buildCharListSlot();
      listSlotEl.replaceWith(nextSlot);
      listSlotEl = nextSlot;
    };

    const secRow = document.createElement("div");
    secRow.className = "ml-pill-row";
    for (const sec of ALL_MEDIA_SECTIONS) {
      const selected = this.librarySelectedSections.has(sec);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `ml-pill ${selected ? "is-selected" : ""}`;
      pill.textContent = SECTION_LABELS[sec];
      pill.addEventListener("click", () => {
        if (this.librarySelectedSections.has(sec)) {
          this.librarySelectedSections.delete(sec);
          pill.classList.remove("is-selected");
        } else {
          this.librarySelectedSections.add(sec);
          pill.classList.add("is-selected");
        }
        updateSummaryAndFooter();
      });
      secRow.appendChild(pill);
    }
    filterBox.appendChild(secRow);

    const charHeader = document.createElement("div");
    charHeader.className = "ml-section-title";
    charHeaderTitle = document.createElement("span");
    updateHeaderSummary();

    const charHeaderBtns = document.createElement("div");
    charHeaderBtns.className = "ml-header-actions";

    const onlyRemoteLabel = document.createElement("label");
    onlyRemoteLabel.className = "ml-toggle-label";
    onlyRemoteLabel.style.textTransform = "none";
    const onlyRemoteCb = document.createElement("input");
    onlyRemoteCb.type = "checkbox";
    onlyRemoteCb.checked = this.libraryOnlyWithRemote;
    onlyRemoteCb.addEventListener("change", () => {
      if (onlyRemoteCb.checked === this.libraryOnlyWithRemote) return;
      this.libraryOnlyWithRemote = onlyRemoteCb.checked;
      this.libraryPage = 1;
      rerenderCharList();
      updateSummaryAndFooter();
    });
    onlyRemoteLabel.append(onlyRemoteCb, document.createTextNode("Remote only"));

    const selAllBtn = document.createElement("button");
    selAllBtn.type = "button";
    selAllBtn.className = "ml-btn is-sm";
    selAllBtn.textContent = "Select All";
    selAllBtn.addEventListener("click", () => {
      for (const c of this.librarySummaries ?? []) {
        if (!this.libraryOnlyWithRemote || c.remoteCount + c.failedCount > 0) {
          this.librarySelectedCharIds.add(c.characterId);
          const cb = cardCheckboxes.get(c.characterId);
          if (cb) cb.checked = true;
        }
      }
      updateSummaryAndFooter();
    });

    const clearAllBtn = document.createElement("button");
    clearAllBtn.type = "button";
    clearAllBtn.className = "ml-btn is-sm";
    clearAllBtn.textContent = "Clear";
    clearAllBtn.addEventListener("click", () => {
      this.librarySelectedCharIds.clear();
      for (const cb of cardCheckboxes.values()) {
        cb.checked = false;
      }
      updateSummaryAndFooter();
    });

    charHeaderBtns.append(onlyRemoteLabel, selAllBtn, clearAllBtn);
    charHeader.append(charHeaderTitle, charHeaderBtns);
    filterBox.appendChild(charHeader);

    listSlotEl = buildCharListSlot();
    filterBox.appendChild(listSlotEl);

    footerSlotEl = buildFooter();
    filterBox.appendChild(footerSlotEl);
    body.appendChild(filterBox);
  }

  private renderSettingsTab(body: HTMLElement): void {
    // 1. Storage & Cache Summary
    const statsBox = document.createElement("div");
    statsBox.className = "ml-section-box";
    const statsTitle = document.createElement("div");
    statsTitle.className = "ml-section-title";
    statsTitle.textContent = "Localized Cache Summary";

    const statsRow = document.createElement("div");
    statsRow.className = "ml-header-bar";
    const statsInfo = document.createElement("div");
    statsInfo.textContent = `${this.stats.totalAssets} cached URLs · ${formatBytes(
      this.stats.totalSizeBytes,
    )} total · ${this.stats.totalFailedUrls} failed`;

    const clearFailedBtn = document.createElement("button");
    clearFailedBtn.type = "button";
    clearFailedBtn.className = "ml-btn is-sm";
    clearFailedBtn.disabled = this.stats.totalFailedUrls === 0;
    clearFailedBtn.textContent = `Clear Failed (${this.stats.totalFailedUrls})`;
    clearFailedBtn.addEventListener("click", async () => {
      const mountGen = this.mountGen;
      await this.guard(async () => {
        await this.callbacks.onClearFailed();
        this.invalidateCharacterCache();
        if (this.librarySummaries !== null) {
          this.librarySummariesStale = true;
        }
      }, "settings");
      if (this.activeTab === "settings" && this.bodyEl && this.mountGen === mountGen) {
        this.renderBody();
      }
    });

    statsRow.append(statsInfo, clearFailedBtn);
    statsBox.append(statsTitle, statsRow);
    body.appendChild(statsBox);

    // 2. Global Download Defaults (applies to one-click Localize, Portrait button, and Library Batch)
    const defaultsBox = document.createElement("div");
    defaultsBox.className = "ml-section-box";
    const defTitleRow = document.createElement("div");
    defTitleRow.className = "ml-section-title";
    const defTitleLeft = document.createElement("div");
    defTitleLeft.className = "ml-inline-title";
    defTitleLeft.append(
      document.createTextNode("Global Download Defaults"),
      createInfoTip(
        "Used by the one-click Localize button across Character tabs and Portrait Panel unless a card defines Custom overrides.",
      ),
    );
    defTitleRow.appendChild(defTitleLeft);
    defaultsBox.appendChild(defTitleRow);

    const sharedState = {
      sections: new Set(this.settings.defaultSections),
      mediaKinds: new Set(this.settings.defaultMediaKinds),
      includeFailed: this.settings.defaultIncludeFailed,
      batchCap: this.settings.defaultBatchCap,
    };

    defaultsBox.appendChild(
      renderSharedDownloadConfigControls({
        state: sharedState,
        sectionTip: "Default card sections included for one-click media localization.",
        onChange: () => {
          void this.guard(
            () =>
              this.callbacks.onUpdateSettings({
                defaultSections: Array.from(sharedState.sections),
                defaultMediaKinds: Array.from(sharedState.mediaKinds),
                defaultIncludeFailed: sharedState.includeFailed,
                defaultBatchCap: sharedState.batchCap,
              }),
            "settings",
          );
        },
      }),
    );
    body.appendChild(defaultsBox);

    // 3. Automation & Guardrails
    const formBox = document.createElement("div");
    formBox.className = "ml-section-box";

    const formTitle = document.createElement("div");
    formTitle.className = "ml-section-title";
    formTitle.textContent = "Automation & Guardrails";
    formBox.appendChild(formTitle);

    const addToggleSetting = (
      label: string,
      tip: string,
      key:
        | "autoLocalizeOnOpen"
        | "scanBareUrls"
        | "autoLinkGallery"
        | "adoptNativeGalleryImages"
        | "deleteImagesOnPurge",
    ) => {
      const row = document.createElement("div");
      row.className = "ml-setting-toggle-row";
      const lbl = document.createElement("label");
      lbl.className = "ml-toggle-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.settings[key];
      cb.addEventListener("change", () => {
        void this.guard(
          () => this.callbacks.onUpdateSettings({ [key]: cb.checked }),
          "settings",
        );
      });
      lbl.append(cb, document.createTextNode(label));
      row.append(lbl, createInfoTip(tip));
      formBox.appendChild(row);
    };

    addToggleSetting(
      "Auto-localize on character open",
      "Automatically runs one-click localization once per character when opening a chat, obeying global or custom defaults.",
      "autoLocalizeOnOpen",
    );
    addToggleSetting(
      "Detect bare media URLs",
      "Also scan bare http/https image & video URLs in addition to Markdown, HTML, and CSS tags.",
      "scanBareUrls",
    );
    addToggleSetting(
      "Sync localized assets to native Gallery & Portrait Panel",
      "Automatically adds downloaded images into Lumiverse's Character Gallery and Portrait Panel.",
      "autoLinkGallery",
    );
    addToggleSetting(
      "Adopt matching images already in native Gallery",
      "Reuses existing Character Gallery images that match a card URL instead of re-downloading.",
      "adoptNativeGalleryImages",
    );
    addToggleSetting(
      "Delete images from native Gallery & storage when purging",
      "When off, removing localized media only unlinks it from Media Localizer while keeping Gallery items.",
      "deleteImagesOnPurge",
    );

    const numGrid = document.createElement("div");
    numGrid.className = "ml-check-grid";

    const addNumberSetting = (
      label: string,
      value: number,
      min: number,
      max: number,
      onChange: (val: number) => void,
    ) => {
      const card = document.createElement("div");
      card.className = "ml-check-card";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "ml-input-num";
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
      input.addEventListener("change", () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed)) {
          onChange(Math.min(max, Math.max(min, Math.floor(parsed))));
        }
      });
      card.append(lbl, input);
      numGrid.appendChild(card);
    };

    addNumberSetting(
      "Confirm Above Count",
      this.settings.confirmThreshold,
      1,
      500,
      (v) =>
        void this.guard(
          () => this.callbacks.onUpdateSettings({ confirmThreshold: v }),
          "settings",
        ),
    );
    addNumberSetting(
      "Max File Size (MB)",
      this.settings.maxFileSizeMb,
      1,
      200,
      (v) =>
        void this.guard(
          () => this.callbacks.onUpdateSettings({ maxFileSizeMb: v }),
          "settings",
        ),
    );
    addNumberSetting(
      "Timeout per File (s)",
      this.settings.timeoutSeconds,
      5,
      120,
      (v) =>
        void this.guard(
          () => this.callbacks.onUpdateSettings({ timeoutSeconds: v }),
          "settings",
        ),
    );
    addNumberSetting(
      "Concurrent Downloads",
      this.settings.concurrency,
      1,
      5,
      (v) =>
        void this.guard(
          () => this.callbacks.onUpdateSettings({ concurrency: v }),
          "settings",
        ),
    );

    formBox.appendChild(numGrid);
    body.appendChild(formBox);
  }
}
