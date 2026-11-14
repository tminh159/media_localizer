import type {
  SpindleCharacterEditorState,
  SpindleFrontendContext,
} from "lumiverse-spindle-types";
import type {
  MediaLocalizerSettings,
  QueueJobProgress,
} from "../shared/types.ts";
import {
  CharacterMediaWidget,
  getDefaultCharacterPreferences,
  sanitizeCharacterPreferences,
  type CharacterMediaWidgetCallbacks,
  type CharacterWidgetUiState,
} from "./character-media-widget.ts";
import {
  CHARACTER_PREFS_STORAGE_KEY,
  isQueueActiveStatus,
  loadPrefsFromStorage,
  savePrefsToStorage,
} from "./ui-helpers.ts";

const DOM_WAIT_TIMEOUT_MS = 10_000;

export class NativeGalleryTabIntegrator {
  private unsubscribeEditor: (() => void) | null = null;
  private domWaitObserver: MutationObserver | null = null;
  private domWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private galleryContentObserver: MutationObserver | null = null;
  private galleryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastKnownGalleryCardCount = -1;
  private pendingExternalRefreshWhileQueueActive = false;
  private hostEl: HTMLElement | null = null;
  private mountedTabEl: HTMLElement | null = null;
  private widget: CharacterMediaWidget | null = null;
  private stopped = false;
  private currentState: SpindleCharacterEditorState = {
    open: false,
    characterId: null,
    activeTabId: null,
    extensions: {},
  };

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private settings: MediaLocalizerSettings,
    private queueProgress: QueueJobProgress,
    private readonly callbacks: CharacterMediaWidgetCallbacks,
    private readonly options: {
      onCharacterPrefsUpdated?: () => void;
    } = {},
  ) {}

  start(): void {
    this.stopped = false;
    if (this.unsubscribeEditor) return;
    const editorApi = this.ctx.ui?.characterEditor;
    if (!editorApi) return;

    try {
      this.currentState = editorApi.getState();
      this.handleEditorState(this.currentState);

      this.unsubscribeEditor = editorApi.onChange((state) => {
        if (this.stopped) return;
        this.currentState = state;
        this.handleEditorState(state);
      });
    } catch {
      // Permission may not be granted yet; can be retried after permissions resolve
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.unsubscribeEditor) {
      this.unsubscribeEditor();
      this.unsubscribeEditor = null;
    }
    this.disconnectDomWaitObserver();
    this.disconnectGalleryContentObserver();
    this.unmountHost();
  }

  updateExternalState(
    settings: MediaLocalizerSettings,
    queueProgress: QueueJobProgress,
  ): void {
    const wasActive = isQueueActiveStatus(this.queueProgress.status);
    const nowActive = isQueueActiveStatus(queueProgress.status);
    const shouldForceRefresh =
      wasActive && !nowActive && this.pendingExternalRefreshWhileQueueActive;
    this.settings = settings;
    this.queueProgress = queueProgress;
    if (wasActive && !nowActive) {
      this.pendingExternalRefreshWhileQueueActive = false;
    }
    if (this.stopped) return;
    this.widget?.updateExternalState(settings, queueProgress, shouldForceRefresh);
  }

  syncPreferencesFromStorage(): void {
    if (this.stopped || !this.widget) return;
    const prefs = loadPrefsFromStorage(
      CHARACTER_PREFS_STORAGE_KEY,
      (raw) => sanitizeCharacterPreferences(raw, false),
      () => getDefaultCharacterPreferences(false),
    );
    this.widget.applySharedPreferences({
      thumbnailSize: prefs.thumbnailSize,
      mediaViewMode: prefs.mediaViewMode,
      mediaFilter: prefs.mediaFilter,
      showGreetingSubfilter: prefs.showGreetingSubfilter,
      showWorldBookSubfilter: prefs.showWorldBookSubfilter,
      showUrlPicker: prefs.showUrlPicker,
      showRemoteThumbnails: prefs.showRemoteThumbnails,
    });
  }

  refreshActiveScan(characterId?: string): void {
    if (this.stopped || !this.widget) return;
    if (characterId && this.widget.getCharacterId() !== characterId) return;
    void this.widget.refreshScan(true);
  }

  private disconnectDomWaitObserver(): void {
    if (this.domWaitTimer !== null) {
      clearTimeout(this.domWaitTimer);
      this.domWaitTimer = null;
    }
    if (this.domWaitObserver) {
      this.domWaitObserver.disconnect();
      this.domWaitObserver = null;
    }
  }

  private disconnectGalleryContentObserver(): void {
    if (this.galleryContentObserver) {
      this.galleryContentObserver.disconnect();
      this.galleryContentObserver = null;
    }
    if (this.galleryRefreshTimer !== null) {
      clearTimeout(this.galleryRefreshTimer);
      this.galleryRefreshTimer = null;
    }
    this.lastKnownGalleryCardCount = -1;
    this.pendingExternalRefreshWhileQueueActive = false;
  }

  private unmountHost(): void {
    this.disconnectGalleryContentObserver();
    this.widget?.flushPendingOverrideSave();
    this.widget?.destroy();
    this.widget = null;
    if (this.mountedTabEl) {
      this.mountedTabEl.classList.remove("ml-gallery-tab-active");
      this.mountedTabEl = null;
    }
    if (this.hostEl && this.hostEl.parentElement) {
      this.hostEl.parentElement.removeChild(this.hostEl);
    }
    this.hostEl = null;
  }

  private handleEditorState(state: SpindleCharacterEditorState): void {
    this.disconnectDomWaitObserver();
    if (this.stopped) return;

    if (!state.open || state.activeTabId !== "gallery" || !state.characterId) {
      this.unmountHost();
      return;
    }

    const characterId = state.characterId;
    if (this.tryMountIntoGalleryTab(characterId)) {
      return;
    }

    // If React hasn't committed `.galleryTab` yet, observe briefly until it mounts
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      this.domWaitObserver = new MutationObserver(() => {
        if (this.stopped) {
          this.disconnectDomWaitObserver();
          return;
        }
        if (
          this.currentState.open &&
          this.currentState.activeTabId === "gallery" &&
          this.currentState.characterId === characterId
        ) {
          if (this.tryMountIntoGalleryTab(characterId)) {
            this.disconnectDomWaitObserver();
          }
        } else {
          this.disconnectDomWaitObserver();
        }
      });
      this.domWaitObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
      this.domWaitTimer = setTimeout(() => {
        this.domWaitTimer = null;
        this.disconnectDomWaitObserver();
      }, DOM_WAIT_TIMEOUT_MS);
    }
  }

  private tryMountIntoGalleryTab(characterId: string): boolean {
    if (this.stopped || typeof document === "undefined") return false;
    const galleryTab = document.querySelector<HTMLElement>('[class*="galleryTab"]');
    if (!galleryTab) return false;

    if (this.hostEl && galleryTab.contains(this.hostEl) && this.widget) {
      this.widget.setCharacterId(characterId);
      return true;
    }

    this.unmountHost();

    const host = document.createElement("div");
    host.className = "ml-gallery-host is-embedded";
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Media Localizer");
    galleryTab.classList.add("ml-gallery-tab-active");
    galleryTab.appendChild(host);

    const storedPrefs = loadPrefsFromStorage(
      CHARACTER_PREFS_STORAGE_KEY,
      (raw) => sanitizeCharacterPreferences(raw, false),
      () => getDefaultCharacterPreferences(false),
    );

    const widget = new CharacterMediaWidget(
      host,
      this.ctx,
      characterId,
      this.settings,
      this.queueProgress,
      this.callbacks,
      {
        inDrawer: false,
        defaultExpandConfig: false,
        defaultExpandDownloadedMedia: false,
        initialUiState: {
          ...storedPrefs,
          showDownloadConfig: false,
          showDownloadedMedia: false,
          expandedUrls: [],
        },
        onUiStateChange: (state: CharacterWidgetUiState) => {
          const existing = loadPrefsFromStorage(
            CHARACTER_PREFS_STORAGE_KEY,
            (raw) => sanitizeCharacterPreferences(raw, true),
            () => getDefaultCharacterPreferences(true),
          );
          const changed =
            existing.thumbnailSize !== state.thumbnailSize ||
            existing.mediaViewMode !== state.mediaViewMode ||
            existing.mediaFilter !== state.mediaFilter ||
            existing.showGreetingSubfilter !== state.showGreetingSubfilter ||
            existing.showWorldBookSubfilter !== state.showWorldBookSubfilter ||
            existing.showUrlPicker !== state.showUrlPicker ||
            existing.showRemoteThumbnails !== state.showRemoteThumbnails;
          if (!changed) return;
          savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, {
            ...existing,
            thumbnailSize: state.thumbnailSize,
            mediaViewMode: state.mediaViewMode,
            mediaFilter: state.mediaFilter,
            showGreetingSubfilter: state.showGreetingSubfilter,
            showWorldBookSubfilter: state.showWorldBookSubfilter,
            showUrlPicker: state.showUrlPicker,
            showRemoteThumbnails: state.showRemoteThumbnails,
          });
          this.options.onCharacterPrefsUpdated?.();
        },
      },
    );

    this.mountedTabEl = galleryTab;
    this.hostEl = host;
    this.widget = widget;
    this.observeNativeGalleryChanges(galleryTab);
    void widget.refreshScan();
    return true;
  }

  private observeNativeGalleryChanges(galleryTab: HTMLElement): void {
    this.disconnectGalleryContentObserver();
    if (typeof MutationObserver === "undefined") return;

    const countCards = () =>
      galleryTab.querySelectorAll(
        '[class*="galleryItem"], [class*="galleryCard"]',
      ).length;
    this.lastKnownGalleryCardCount = countCards();

    this.galleryContentObserver = new MutationObserver((mutations) => {
      if (this.stopped) return;
      // Ignore mutations strictly inside our own widget host
      const hasExternalMutation = mutations.some(
        (m) => !this.hostEl || !this.hostEl.contains(m.target),
      );
      if (!hasExternalMutation) return;

      const nextCount = countCards();
      if (nextCount === this.lastKnownGalleryCardCount) return;
      this.lastKnownGalleryCardCount = nextCount;

      if (this.galleryRefreshTimer !== null) {
        clearTimeout(this.galleryRefreshTimer);
      }
      this.galleryRefreshTimer = setTimeout(() => {
        this.galleryRefreshTimer = null;
        if (this.stopped || !this.widget) return;
        if (isQueueActiveStatus(this.queueProgress.status)) {
          this.pendingExternalRefreshWhileQueueActive = true;
          return;
        }
        this.pendingExternalRefreshWhileQueueActive = false;
        void this.widget.refreshScan(true);
      }, 600);
    });

    this.galleryContentObserver.observe(galleryTab, {
      childList: true,
      subtree: true,
    });
  }
}
