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
  clearWarmGalleryThumbs,
  getDefaultGalleryPreferences,
  LibraryGalleryView,
  sanitizeGalleryPreferences,
  type LibraryGalleryCacheSnapshot,
  type LibraryGalleryState,
} from "./library-gallery.ts";
import {
  applyScrollTopWithSettlement,
  canOpenNativeCharacterEditor,
  CHARACTER_PREFS_STORAGE_KEY,
  createIcon,
  createIconButton,
  createInfoTip,
  createThumbnailSizeSegmented,
  GALLERY_PREFS_STORAGE_KEY,
  isElementScrollable,
  isQueueActiveStatus,
  loadPrefsFromStorage,
  openNativeCharacterEditor,
  renderQueueBanner,
  renderSharedDownloadConfigControls,
  resolveScrollContainer,
  savePrefsToStorage,
  type IconName,
  type PendingScrollRestore,
} from "./ui-helpers.ts";

const LIBRARY_BATCH_PAGE_SIZE = 50;

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
  private renderedTab: DrawerTabId | null = null;
  private isRenderingBody = false;
  private rememberedScrollContainer: HTMLElement | null = null;
  private cachedScrollContainer: HTMLElement | null = null;
  private galleryHostEl: HTMLElement | null = null;
  private pendingScrollRestore: PendingScrollRestore | null = null;
  private isSettlingScrollRestore = false;
  private scrollSettleRafIds: number[] = [];
  private tabScrollTops: Record<DrawerTabId, number> = {
    character: 0,
    gallery: 0,
    library: 0,
    settings: 0,
  };
  private innerScrollTops = new Map<string, number>();

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private settings: MediaLocalizerSettings,
    private stats: StorageStatsSummary,
    private queueProgress: QueueJobProgress,
    private readonly callbacks: DrawerPanelCallbacks,
    private readonly options?: {
      onCharacterPrefsUpdated?: () => void;
    },
  ) {
    this.librarySelectedSections = new Set(settings.defaultSections);
    this.libraryBatchCap = settings.defaultBatchCap;
  }

  mount(container: HTMLElement): () => void {
    const mountGen = ++this.mountGen;
    const prevContainerWidth = container.style?.width ?? "";
    const prevContainerHeight = container.style?.height ?? "";
    const prevContainerMinHeight = container.style?.minHeight ?? "";
    if (container.style) {
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.minHeight = "0";
    }
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "ml-drawer-root";

    const nav = document.createElement("div");
    nav.className = "ml-drawer-nav";

    const tabs: Array<{ id: DrawerTabId; label: string; icon: IconName }> = [
      { id: "character", label: "Character", icon: "user" },
      { id: "gallery", label: "Gallery", icon: "image" },
      { id: "library", label: "Library Batch", icon: "layers" },
      { id: "settings", label: "Settings", icon: "settings" },
    ];

    this.navButtons.clear();
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ml-drawer-nav-btn ${this.activeTab === t.id ? "is-active" : ""}`;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = t.label;
      btn.append(createIcon(t.icon, 13), labelSpan);
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
    const recordScrollFromTarget = (targetEl: HTMLElement | null) => {
      if (
        !targetEl ||
        targetEl.clientHeight === 0 ||
        this.isRenderingBody ||
        !this.renderedTab ||
        this.renderedTab !== this.activeTab ||
        this.isShowingPlaceholder(body) ||
        body.isConnected === false
      ) {
        return;
      }
      if (targetEl !== this.cachedScrollContainer) {
        this.cachedScrollContainer = null;
        const activeScroller = this.getActiveScrollContainer();
        if (activeScroller && targetEl !== activeScroller) {
          return;
        }
      }
      if (typeof targetEl.scrollTop === "number" && Number.isFinite(targetEl.scrollTop)) {
        const nextTop = Math.max(0, targetEl.scrollTop);
        if (
          this.isSettlingScrollRestore &&
          nextTop === 0 &&
          this.tabScrollTops[this.renderedTab] > 0
        ) {
          return;
        }
        this.rememberedScrollContainer = targetEl;
        this.tabScrollTops[this.renderedTab] = nextTop;
      }
    };
    body.addEventListener(
      "scroll",
      () => {
        recordScrollFromTarget(body);
      },
      { passive: true },
    );

    let offDocScroll: (() => void) | null = null;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const onCaptureScroll = (ev: Event) => {
        if (
          this.isRenderingBody ||
          !this.renderedTab ||
          this.renderedTab !== this.activeTab ||
          body.isConnected === false
        ) {
          return;
        }
        const rawTarget = ev.target;
        if (!rawTarget || rawTarget === body) return;
        const targetEl =
          rawTarget === document
            ? (document.scrollingElement as HTMLElement | null)
            : (rawTarget as HTMLElement);
        if (!targetEl || typeof targetEl.contains !== "function") return;
        if (targetEl === this.cachedScrollContainer || targetEl.contains(body)) {
          recordScrollFromTarget(targetEl);
        }
      };
      document.addEventListener("scroll", onCaptureScroll, {
        capture: true,
        passive: true,
      });
      offDocScroll = () => {
        document.removeEventListener("scroll", onCaptureScroll, {
          capture: true,
        });
      };
    }

    let offWinResize: (() => void) | null = null;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      const onResize = () => {
        this.cachedScrollContainer = null;
      };
      window.addEventListener("resize", onResize, { passive: true });
      offWinResize = () => {
        window.removeEventListener("resize", onResize);
      };
    }

    this.bodyEl = body;
    this.cachedScrollContainer = null;

    root.append(nav, bannerHost, body);
    container.appendChild(root);

    this.renderStickyQueueBanner();
    this.renderBody();

    return () => {
      if (this.mountGen === mountGen) {
        this.mountGen++;
      }
      this.captureScrollPositions();
      this.cancelScrollSettleTracker();
      this.pendingScrollRestore?.cancel();
      this.pendingScrollRestore = null;
      offDocScroll?.();
      offDocScroll = null;
      offWinResize?.();
      offWinResize = null;
      this.rememberedScrollContainer = null;
      this.cachedScrollContainer = null;
      this.galleryHostEl = null;
      if (container.style) {
        container.style.width = prevContainerWidth;
        container.style.height = prevContainerHeight;
        container.style.minHeight = prevContainerMinHeight;
      }
      this.renderedTab = null;
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
    const prevCharId = this.resolveCurrentCharacterId();
    this.activeTab = tab;
    this.actionError = null;
    if (characterId !== undefined) {
      this.inspectedCharacterId = characterId;
    }
    const nextCharId = this.resolveCurrentCharacterId();
    const characterChanged =
      tab === "character" && characterId !== undefined && nextCharId !== prevCharId;
    if (characterChanged) {
      this.tabScrollTops.character = 0;
      this.clearCharacterInnerScrollTops();
    }
    this.expandNextCharacterConfig = Boolean(options?.expandOptions);
    for (const [id, b] of this.navButtons.entries()) {
      b.classList.toggle("is-active", id === this.activeTab);
    }
    this.renderBody(characterChanged && this.renderedTab === "character");
  }

  syncPreferencesFromStorage(): void {
    const loaded = loadPrefsFromStorage(
      CHARACTER_PREFS_STORAGE_KEY,
      sanitizeCharacterPreferences,
      () => getDefaultCharacterPreferences(true),
    );
    const prevThumbnailSize = this.characterUiState.thumbnailSize;
    this.characterUiState = {
      ...this.characterUiState,
      showGreetingSubfilter: loaded.showGreetingSubfilter,
      showWorldBookSubfilter: loaded.showWorldBookSubfilter,
      showUrlPicker: loaded.showUrlPicker,
      showRemoteThumbnails: loaded.showRemoteThumbnails,
      mediaViewMode: loaded.mediaViewMode,
      mediaFilter: loaded.mediaFilter,
      thumbnailSize: loaded.thumbnailSize,
    };
    if (this.characterWidget) {
      this.characterWidget.applySharedPreferences({
        showGreetingSubfilter: loaded.showGreetingSubfilter,
        showWorldBookSubfilter: loaded.showWorldBookSubfilter,
        showUrlPicker: loaded.showUrlPicker,
        showRemoteThumbnails: loaded.showRemoteThumbnails,
        mediaViewMode: loaded.mediaViewMode,
        mediaFilter: loaded.mediaFilter,
        thumbnailSize: loaded.thumbnailSize,
      });
    } else if (
      this.activeTab === "settings" &&
      this.bodyEl &&
      loaded.thumbnailSize !== prevThumbnailSize
    ) {
      this.renderBody();
    }
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
    const queueCompleted = wasActive && !nowActive;

    const galleryInvalidated = stats.totalAssets !== prevStatsAssets || queueCompleted;
    if (galleryInvalidated) {
      this.invalidateGalleryCache();
    }
    if (
      galleryInvalidated ||
      stats.totalFailedUrls !== prevStatsFailed ||
      queueCompleted ||
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
      if (queueCompleted || galleryInvalidated) {
        void this.galleryView?.refresh({ reshuffleRandom: false });
      }
      return;
    }

    if (
      !dataChanged &&
      !queueCompleted &&
      (prevStatus === queueProgress.status || (wasActive && nowActive))
    ) {
      return;
    }
    if (this.activeTab === "settings" && !dataChanged && !queueCompleted) return;
    if (this.activeTab === "library" && !dataChanged && !queueCompleted) return;
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
    if (this.activeTab === "character" && this.bodyEl) {
      const currentId = this.characterWidget?.getCharacterId() ?? null;
      const prevInspected = this.inspectedCharacterId;
      this.inspectedCharacterId = null;
      const nextId = this.resolveCurrentCharacterId();
      if (this.characterWidget && nextId && currentId === nextId) {
        this.inspectedCharacterId = prevInspected;
        return;
      }
      this.tabScrollTops.character = 0;
      this.clearCharacterInnerScrollTops();
      if (this.characterWidget && nextId) {
        this.applyTabScrollTop(0);
        this.characterWidget.setCharacterId(nextId);
        return;
      }
      this.renderBody(true);
      return;
    }
    this.inspectedCharacterId = null;
    this.tabScrollTops.character = 0;
    this.clearCharacterInnerScrollTops();
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
    const isGalleryActiveInOpenDrawer =
      Boolean(this.bodyEl) &&
      this.activeTab === "gallery" &&
      Boolean(this.galleryView);
    if (!isGalleryActiveInOpenDrawer) {
      this.galleryView?.invalidateCache();
    }
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

  private isShowingPlaceholder(body: HTMLElement): boolean {
    if (this.renderedTab !== "gallery") return false;
    const host = this.galleryHostEl;
    const wrap = host?.firstElementChild ?? host?.children?.[0];
    if (wrap && wrap.children) {
      for (let i = 0; i < wrap.children.length; i++) {
        if (wrap.children[i]?.classList?.contains("ml-placeholder")) {
          return true;
        }
      }
      return false;
    }
    return Boolean(body.querySelector(".ml-placeholder"));
  }

  private getActiveScrollContainer(): HTMLElement | null {
    const body = this.bodyEl;
    if (!body) return null;
    const cached = this.cachedScrollContainer;
    if (
      cached &&
      cached.isConnected !== false &&
      (cached === body || (typeof cached.contains === "function" && cached.contains(body)))
    ) {
      return cached;
    }
    const resolved = resolveScrollContainer(body, this.rememberedScrollContainer, body);
    if (resolved && isElementScrollable(resolved)) {
      this.cachedScrollContainer = resolved;
    } else {
      this.cachedScrollContainer = null;
    }
    return resolved;
  }

  private readTabScrollTop(): number {
    const scroller = this.getActiveScrollContainer();
    if (scroller && typeof scroller.scrollTop === "number" && Number.isFinite(scroller.scrollTop)) {
      this.rememberedScrollContainer = scroller;
      return Math.max(0, scroller.scrollTop);
    }
    return this.tabScrollTops[this.activeTab] ?? 0;
  }

  private clearCharacterInnerScrollTops(): void {
    for (const key of [
      "localized-asset-grid",
      "url-picker-list",
      "greetings-subfilter",
      "worldbooks-subfilter",
    ]) {
      this.innerScrollTops.delete(key);
    }
  }

  private cancelScrollSettleTracker(): void {
    if (typeof cancelAnimationFrame === "function") {
      for (const id of this.scrollSettleRafIds) {
        cancelAnimationFrame(id);
      }
    }
    this.scrollSettleRafIds = [];
    this.isSettlingScrollRestore = false;
  }

  private applyTabScrollTop(scrollTop: number): void {
    const mountGen = this.mountGen;
    this.cancelScrollSettleTracker();
    this.pendingScrollRestore = applyScrollTopWithSettlement(
      () => this.getActiveScrollContainer(),
      scrollTop,
      this.pendingScrollRestore,
      () => !this.bodyEl || this.mountGen !== mountGen,
    );
    this.isSettlingScrollRestore = Boolean(this.pendingScrollRestore);
    if (this.pendingScrollRestore && typeof requestAnimationFrame === "function") {
      const raf1 = requestAnimationFrame(() => {
        if (this.mountGen !== mountGen) return;
        const raf2 = requestAnimationFrame(() => {
          if (this.mountGen !== mountGen) return;
          this.isSettlingScrollRestore = false;
          this.scrollSettleRafIds = [];
        });
        this.scrollSettleRafIds = [raf2];
      });
      this.scrollSettleRafIds = [raf1];
    }
  }

  restoreScrollIfReset(): void {
    const body = this.bodyEl;
    if (!body || this.isRenderingBody || this.isShowingPlaceholder(body)) return;
    const saved = this.tabScrollTops[this.activeTab] ?? 0;
    if (saved > 0 && this.readTabScrollTop() === 0) {
      this.applyTabScrollTop(saved);
    }
  }

  private captureScrollPositions(): void {
    const body = this.bodyEl;
    if (!body || !this.renderedTab) return;
    if (!this.isShowingPlaceholder(body) && body.isConnected !== false && body.clientHeight !== 0) {
      const scroller = this.getActiveScrollContainer();
      if (
        scroller &&
        scroller.clientHeight !== 0 &&
        typeof scroller.scrollTop === "number" &&
        Number.isFinite(scroller.scrollTop)
      ) {
        const nextTop = Math.max(0, scroller.scrollTop);
        if (
          !(
            this.isSettlingScrollRestore &&
            nextTop === 0 &&
            this.tabScrollTops[this.renderedTab] > 0
          )
        ) {
          this.rememberedScrollContainer = scroller;
          this.tabScrollTops[this.renderedTab] = nextTop;
        }
      }
    }
    for (const el of body.querySelectorAll<HTMLElement>("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (id && typeof el.scrollTop === "number" && Number.isFinite(el.scrollTop)) {
        this.innerScrollTops.set(id, Math.max(0, el.scrollTop));
      }
    }
  }

  private restoreScrollPositions(): void {
    const body = this.bodyEl;
    if (!body) return;
    for (const el of body.querySelectorAll<HTMLElement>("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (!id) continue;
      const saved = this.innerScrollTops.get(id);
      if (saved !== undefined) {
        el.scrollTop = saved;
      }
    }
    this.applyTabScrollTop(this.tabScrollTops[this.activeTab] ?? 0);
  }

  private renderBody(skipCaptureScroll = false): void {
    const body = this.bodyEl;
    if (!body) return;

    if (!skipCaptureScroll) {
      this.captureScrollPositions();
    }
    this.isRenderingBody = true;
    this.cachedScrollContainer = null;
    this.galleryHostEl = null;
    try {
      this.characterWidget?.flushPendingOverrideSave();
      this.characterWidget?.destroy();
      this.characterWidget = null;
      this.galleryView?.destroy();
      this.galleryView = null;
      body.innerHTML = "";
      this.renderedTab = this.activeTab;

      if (this.actionError) {
        const errBox = document.createElement("div");
        errBox.className = "ml-error-banner";
        const errText = document.createElement("span");
        errText.textContent = `Error: ${this.actionError}`;
        errBox.append(createIcon("alert", 14), errText);
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

      this.restoreScrollPositions();
    } finally {
      this.isRenderingBody = false;
    }
  }

  private renderCharacterTab(body: HTMLElement): void {
    const charId = this.resolveCurrentCharacterId();
    if (!charId) {
      const empty = document.createElement("div");
      empty.className = "ml-section ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("image", 20));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent =
        "Open a character chat or Character Editor to inspect and localize its media.";
      empty.append(iconWrap, textEl);
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

    const onOpenCharacterEditor =
      this.callbacks.onOpenCharacterEditor ??
      (canOpenNativeCharacterEditor(this.ctx)
        ? (targetCharId: string) => {
            void openNativeCharacterEditor(this.ctx, targetCharId);
          }
        : undefined);

    const widgetCallbacks: CharacterMediaWidgetCallbacks = {
      ...this.callbacks,
      onOpenCharacterEditor,
      onPurgeCharacterCache: async (targetCharId, urls) => {
        await this.callbacks.onPurgeCharacterCache(targetCharId, urls);
        clearWarmGalleryThumbs();
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
          this.options?.onCharacterPrefsUpdated?.();
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
    this.galleryHostEl = host;
    body.appendChild(host);

    const onOpenCharacterEditor =
      this.callbacks.onOpenCharacterEditor ??
      (canOpenNativeCharacterEditor(this.ctx)
        ? (characterId: string) => {
            void openNativeCharacterEditor(this.ctx, characterId);
          }
        : undefined);

    const gallery = new LibraryGalleryView(
      host,
      {
        onLoadLibraryMedia: this.callbacks.onListLibraryMedia,
        onPurgeAsset: async (characterId, normalizedUrl) => {
          await this.callbacks.onPurgeCharacterCache(characterId, [normalizedUrl]);
          clearWarmGalleryThumbs();
          this.invalidateCharacterCache(characterId);
          this.invalidateLibrarySummaries();
        },
        onOpenCharacterTab: (characterId) => {
          this.setActiveTab("character", characterId);
        },
        onOpenCharacterEditor,
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
          this.tabScrollTops.gallery = 0;
          this.cachedScrollContainer = null;
          if (this.bodyEl && this.renderedTab === "gallery") {
            this.applyTabScrollTop(0);
          }
        },
        onGetScrollTop: () => {
          const bodyEl = this.bodyEl;
          if (
            bodyEl &&
            this.renderedTab === "gallery" &&
            !this.isRenderingBody &&
            !this.isShowingPlaceholder(bodyEl)
          ) {
            return this.readTabScrollTop();
          }
          return this.tabScrollTops.gallery;
        },
        onSetScrollTop: (scrollTop) => {
          const next = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
          this.tabScrollTops.gallery = next;
          this.cachedScrollContainer = null;
          if (this.bodyEl && this.renderedTab === "gallery") {
            this.applyTabScrollTop(next);
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
    const topBar = document.createElement("div");
    topBar.className = "ml-header-bar";

    const info = document.createElement("div");
    info.className = "ml-inline-title";
    const title = document.createElement("span");
    title.className = "ml-title";
    title.textContent = "Library Scanner & Batch";
    info.append(
      createIcon("layers", 14),
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
      className: `ml-btn is-primary is-sm ${this.libraryScanning ? "is-busy" : ""}`,
      size: 13,
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
          this.tabScrollTops.library = 0;
          this.innerScrollTops.set("library-char-list", 0);
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

    if (!this.librarySummaries) {
      const scanSection = document.createElement("div");
      scanSection.className = "ml-section";
      const intro = document.createElement("div");
      intro.className = "ml-lib-intro";
      intro.textContent =
        "Scan your character cards, linked World Books, and Regex scripts locally with zero network traffic to filter by section, batch-download, or purge cached media.";
      scanSection.append(topBar, intro);
      body.appendChild(scanSection);
      return;
    }

    const scanSection = document.createElement("div");
    scanSection.className = "ml-section";
    scanSection.appendChild(topBar);

    const summaryStrip = document.createElement("div");
    summaryStrip.className = "ml-stat-strip";
    const totalLocal = this.librarySummaries.reduce((sum, c) => sum + c.localizedCount, 0);
    const totalFailed = this.librarySummaries.reduce((sum, c) => sum + c.failedCount, 0);
    const totalBytes = this.librarySummaries.reduce((sum, c) => sum + c.localizedBytes, 0);
    const addLibChip = (label: string, variant: string) => {
      const chip = document.createElement("span");
      chip.className = `ml-stat-chip ${variant}`;
      chip.textContent = label;
      summaryStrip.appendChild(chip);
    };
    addLibChip(`${this.librarySummaries.length} chars`, "is-muted");
    addLibChip(
      `${this.libraryTotalRemote} remote`,
      this.libraryTotalRemote > 0 ? "is-warn" : "is-muted",
    );
    addLibChip(
      `${totalLocal} local${totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}`,
      totalLocal > 0 ? "is-success" : "is-muted",
    );
    if (totalFailed > 0) {
      addLibChip(`${totalFailed} failed`, "is-danger");
    }
    scanSection.appendChild(summaryStrip);

    if (this.librarySummariesStale) {
      const staleNote = document.createElement("div");
      staleNote.className = "ml-warn-banner";
      const staleText = document.createElement("span");
      staleText.textContent =
        "Library media changed since last scan. Click Rescan Library to refresh counts.";
      staleNote.append(createIcon("alert", 14), staleText);
      scanSection.appendChild(staleNote);
    }
    body.appendChild(scanSection);

    const filterSection = document.createElement("div");
    filterSection.className = "ml-section";

    const secHeader = document.createElement("div");
    secHeader.className = "ml-section-title";
    const secLeft = document.createElement("div");
    secLeft.className = "ml-inline-title";
    const secStep = document.createElement("span");
    secStep.className = "ml-step-num";
    secStep.textContent = "1";
    const secText = document.createElement("span");
    secText.textContent = "Sections to Download";
    secLeft.append(
      secStep,
      secText,
      createInfoTip("Only remote items found inside checked sections are queued across selected characters."),
    );
    secHeader.appendChild(secLeft);
    filterSection.appendChild(secHeader);

    let charHeaderTitle!: HTMLSpanElement;
    let charHeaderText!: HTMLSpanElement;
    let listSlotEl!: HTMLElement;
    let footerSlotEl!: HTMLElement;
    const cardCheckboxes = new Map<string, HTMLInputElement>();
    const cardElements = new Map<string, HTMLElement>();

    const updateHeaderSummary = () => {
      const text = `Characters (${this.librarySelectedCharIds.size} sel · ${this.libraryTotalRemote} remote)`;
      if (charHeaderText) {
        charHeaderText.textContent = text;
      } else {
        charHeaderTitle.textContent = `2. ${text}`;
      }
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
                clearWarmGalleryThumbs();
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
      cardElements.clear();

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

      if (totalPages > 1) {
        const pagBar = document.createElement("div");
        pagBar.className = "ml-gallery-pagination";

        const pagInfo = document.createElement("div");
        pagInfo.className = "ml-gallery-pagination-info";
        const pagText = document.createElement("span");
        pagText.textContent = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} characters`;
        pagInfo.appendChild(pagText);
        pagBar.appendChild(pagInfo);

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
            rerenderCharList({ resetListScroll: true });
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
            rerenderCharList({ resetListScroll: true });
          },
        });
        pagActions.append(prevBtn, pageLabel, nextBtn);
        pagBar.appendChild(pagActions);
        slot.appendChild(pagBar);
      }

      const charList = document.createElement("div");
      charList.className = "ml-url-list is-tall";
      charList.dataset.scrollId = "library-char-list";
      charList.addEventListener(
        "scroll",
        () => {
          if (
            !this.isRenderingBody &&
            typeof charList.scrollTop === "number" &&
            Number.isFinite(charList.scrollTop)
          ) {
            this.innerScrollTops.set("library-char-list", Math.max(0, charList.scrollTop));
          }
        },
        { passive: true },
      );
      if (pageChars.length === 0) {
        const emptyList = document.createElement("div");
        emptyList.className = "ml-empty";
        emptyList.textContent =
          (this.librarySummaries?.length ?? 0) === 0
            ? "No character cards found in your library."
            : "All scanned characters are localized. Uncheck \"Remote only\" to view them.";
        charList.appendChild(emptyList);
      }
      for (const c of pageChars) {
        const isExpanded = this.libraryExpandedCharIds.has(c.characterId);
        const isSelected = this.librarySelectedCharIds.has(c.characterId);
        const card = document.createElement("div");
        card.className = `ml-lib-item-card ${isExpanded ? "is-expanded" : ""} ${isSelected ? "is-selected" : ""}`.trim();
        cardElements.set(c.characterId, card);

        const row = document.createElement("div");
        row.className = "ml-lib-row";

        const left = document.createElement("div");
        left.className = "ml-check-card-left";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "ml-row-checkbox";
        cb.checked = isSelected;
        cb.addEventListener("click", (e) => e.stopPropagation());
        cb.addEventListener("change", () => {
          if (cb.checked) {
            this.librarySelectedCharIds.add(c.characterId);
            card.classList.add("is-selected");
          } else {
            this.librarySelectedCharIds.delete(c.characterId);
            card.classList.remove("is-selected");
          }
          updateSummaryAndFooter();
        });
        cardCheckboxes.set(c.characterId, cb);

        const dot = document.createElement("span");
        const dotVariant =
          c.failedCount > 0
            ? "is-danger"
            : c.remoteCount > 0
              ? "is-warn"
              : c.localizedCount > 0
                ? "is-success"
                : "is-muted";
        dot.className = `ml-status-dot ${dotVariant}`;
        dot.setAttribute("aria-hidden", "true");

        const nameSpan = document.createElement("span");
        nameSpan.className = "ml-lib-char-name";
        nameSpan.textContent = c.characterName;
        nameSpan.title = c.characterName;
        left.append(cb, dot, nameSpan);

        const right = document.createElement("div");
        right.className = "ml-header-actions";
        const badge = document.createElement("span");
        const pending = c.remoteCount + c.failedCount;
        badge.className = `ml-badge ${pending > 0 ? "is-warn" : "is-success"}`;
        badge.textContent =
          pending > 0
            ? `${pending} rem · ${c.localizedCount}/${c.totalUnique}`
            : `${c.localizedCount}/${c.totalUnique} local`;
        badge.title =
          pending > 0
            ? `${pending} remote/failed, ${c.localizedCount} of ${c.totalUnique} localized`
            : `${c.localizedCount} of ${c.totalUnique} localized`;
        right.appendChild(badge);

        if (c.localizedBytes > 0) {
          const sizeBadge = document.createElement("span");
          sizeBadge.className = "ml-badge is-muted";
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

    const rerenderCharList = (options?: { resetListScroll?: boolean }) => {
      const prevBodyScroll = this.readTabScrollTop();
      const prevCharList = listSlotEl.querySelector<HTMLElement>(
        '[data-scroll-id="library-char-list"]',
      );
      const prevListScroll = options?.resetListScroll
        ? 0
        : prevCharList && typeof prevCharList.scrollTop === "number"
          ? Math.max(0, prevCharList.scrollTop)
          : (this.innerScrollTops.get("library-char-list") ?? 0);
      const nextSlot = buildCharListSlot();
      listSlotEl.replaceWith(nextSlot);
      listSlotEl = nextSlot;
      this.innerScrollTops.set("library-char-list", prevListScroll);
      const nextCharList = nextSlot.querySelector<HTMLElement>(
        '[data-scroll-id="library-char-list"]',
      );
      if (nextCharList) {
        nextCharList.scrollTop = prevListScroll;
      }
      this.applyTabScrollTop(prevBodyScroll);
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
    filterSection.appendChild(secRow);
    body.appendChild(filterSection);

    const charsSection = document.createElement("div");
    charsSection.className = "ml-section";

    const charHeader = document.createElement("div");
    charHeader.className = "ml-batch-char-header";
    charHeaderTitle = document.createElement("span");
    charHeaderTitle.className = "ml-section-title";
    const charStep = document.createElement("span");
    charStep.className = "ml-step-num";
    charStep.textContent = "2";
    charHeaderText = document.createElement("span");
    charHeaderTitle.append(charStep, charHeaderText);
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
      rerenderCharList({ resetListScroll: true });
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
          cardElements.get(c.characterId)?.classList.add("is-selected");
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
      for (const card of cardElements.values()) {
        card.classList.remove("is-selected");
      }
      updateSummaryAndFooter();
    });

    charHeaderBtns.append(onlyRemoteLabel, selAllBtn, clearAllBtn);
    charHeader.append(charHeaderTitle, charHeaderBtns);
    charsSection.appendChild(charHeader);

    listSlotEl = buildCharListSlot();
    charsSection.appendChild(listSlotEl);

    footerSlotEl = buildFooter();
    charsSection.appendChild(footerSlotEl);
    body.appendChild(charsSection);
  }

  private renderSettingsTab(body: HTMLElement): void {
    // 1. Storage & Cache Summary
    const statsSection = document.createElement("div");
    statsSection.className = "ml-section";
    const statsRow = document.createElement("div");
    statsRow.className = "ml-header-bar";
    const statsLeft = document.createElement("div");
    statsLeft.className = "ml-inline-stats";
    const statsTitle = document.createElement("span");
    statsTitle.className = "ml-section-title";
    const statsTitleText = document.createElement("span");
    statsTitleText.textContent = "Localized Cache Summary";
    statsTitle.append(createIcon("database", 14), statsTitleText);

    const statsStrip = document.createElement("div");
    statsStrip.className = "ml-stat-strip";
    const addStatChip = (label: string, variant: string) => {
      const chip = document.createElement("span");
      chip.className = `ml-stat-chip ${variant}`;
      chip.textContent = label;
      statsStrip.appendChild(chip);
    };
    addStatChip(`${this.stats.totalAssets} URLs`, "is-info");
    addStatChip(formatBytes(this.stats.totalSizeBytes), "is-muted");
    addStatChip(
      `${this.stats.totalFailedUrls} failed`,
      this.stats.totalFailedUrls > 0 ? "is-danger" : "is-muted",
    );
    statsLeft.append(statsTitle, statsStrip);

    const clearFailedBtn = createIconButton({
      icon: "trash",
      label: `Clear Failed (${this.stats.totalFailedUrls})`,
      title: "Clear all recorded failed download URLs",
      className: "ml-btn is-sm",
      size: 12,
      disabled: this.stats.totalFailedUrls === 0,
      onClick: async () => {
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
      },
    });

    statsRow.append(statsLeft, clearFailedBtn);
    statsSection.appendChild(statsRow);
    body.appendChild(statsSection);

    // 1b. Display & Thumbnails
    const displaySection = document.createElement("div");
    displaySection.className = "ml-section";
    const displayTitleRow = document.createElement("div");
    displayTitleRow.className = "ml-section-title";
    const displayTitleLeft = document.createElement("div");
    displayTitleLeft.className = "ml-inline-title";
    const displayTitleText = document.createElement("span");
    displayTitleText.textContent = "Display & Thumbnails";
    displayTitleLeft.append(
      createIcon("image", 14),
      displayTitleText,
      createInfoTip(
        "Choose Small (S), Medium (M), or Large (L) thumbnail presets independently for Gallery and Character Media views. Large also loads higher-resolution thumbnails for local images.",
      ),
    );
    displayTitleRow.appendChild(displayTitleLeft);
    displaySection.appendChild(displayTitleRow);

    const displayGrid = document.createElement("div");
    displayGrid.className = "ml-check-grid";

    const addThumbSizeCard = (
      label: string,
      control: HTMLElement,
    ) => {
      const card = document.createElement("div");
      card.className = "ml-check-card";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      card.append(lbl, control);
      displayGrid.appendChild(card);
    };

    addThumbSizeCard(
      "Gallery Thumbnails",
      createThumbnailSizeSegmented(this.galleryState.thumbnailSize, (nextSize) => {
        this.galleryState = {
          ...this.galleryState,
          thumbnailSize: nextSize,
        };
        savePrefsToStorage(
          GALLERY_PREFS_STORAGE_KEY,
          sanitizeGalleryPreferences(this.galleryState),
        );
      }),
    );

    addThumbSizeCard(
      "Character Media Thumbnails",
      createThumbnailSizeSegmented(
        this.characterUiState.thumbnailSize,
        (nextSize) => {
          this.characterUiState = {
            ...this.characterUiState,
            thumbnailSize: nextSize,
          };
          savePrefsToStorage(
            CHARACTER_PREFS_STORAGE_KEY,
            sanitizeCharacterPreferences(this.characterUiState, true),
          );
          this.characterWidget?.applySharedPreferences({ thumbnailSize: nextSize });
          this.options?.onCharacterPrefsUpdated?.();
        },
      ),
    );

    displaySection.appendChild(displayGrid);
    body.appendChild(displaySection);

    // 2. Global Download Defaults (applies to one-click Localize, Portrait button, and Library Batch)
    const defaultsSection = document.createElement("div");
    defaultsSection.className = "ml-section";
    const defTitleRow = document.createElement("div");
    defTitleRow.className = "ml-section-title";
    const defTitleLeft = document.createElement("div");
    defTitleLeft.className = "ml-inline-title";
    const defTitleText = document.createElement("span");
    defTitleText.textContent = "Global Download Defaults";
    defTitleLeft.append(
      createIcon("sliders", 14),
      defTitleText,
      createInfoTip(
        "Used by the one-click Localize button across Character tabs and Portrait Panel unless a card defines Custom overrides.",
      ),
    );
    defTitleRow.appendChild(defTitleLeft);
    defaultsSection.appendChild(defTitleRow);

    const sharedState = {
      sections: new Set(this.settings.defaultSections),
      mediaKinds: new Set(this.settings.defaultMediaKinds),
      includeFailed: this.settings.defaultIncludeFailed,
      batchCap: this.settings.defaultBatchCap,
    };

    defaultsSection.appendChild(
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
    body.appendChild(defaultsSection);

    // 3. Automation & Guardrails
    const formSection = document.createElement("div");
    formSection.className = "ml-section";

    const formTitle = document.createElement("div");
    formTitle.className = "ml-section-title";
    const formTitleText = document.createElement("span");
    formTitleText.textContent = "Automation & Guardrails";
    formTitle.append(createIcon("shield", 14), formTitleText);
    formSection.appendChild(formTitle);

    const toggleGrid = document.createElement("div");
    toggleGrid.className = "ml-setting-toggle-grid";

    const addToggleSetting = (
      label: string,
      tip: string,
      key:
        | "autoLocalizeOnOpen"
        | "scanBareUrls"
        | "autoLinkGallery"
        | "adoptNativeGalleryImages"
        | "deleteImagesOnPurge",
      isCaution = false,
    ) => {
      const row = document.createElement("div");
      row.className = isCaution
        ? "ml-setting-toggle-row is-caution"
        : "ml-setting-toggle-row";
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
      toggleGrid.appendChild(row);
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
      true,
    );

    formSection.appendChild(toggleGrid);

    const limitsLabel = document.createElement("div");
    limitsLabel.className = "ml-subsection-label";
    limitsLabel.textContent = "Queue & Safety Limits";
    formSection.appendChild(limitsLabel);

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

    formSection.appendChild(numGrid);
    body.appendChild(formSection);
  }
}
