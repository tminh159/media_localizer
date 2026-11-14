import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { buildEffectiveFilter, isOverrideEmpty } from "../shared/download-config.ts";
import {
  formatBytes,
  type CharacterDownloadOverride,
  type CharacterMediaScanResult,
  type DiscoveredMediaItem,
  type DownloadFilterOptions,
  type MediaKind,
  type MediaLocalizerSettings,
  type MediaSourceSection,
  type QueueJobProgress,
} from "../shared/types.ts";
import { filterScanItemsForDownload } from "../shared/url-scanner.ts";
import {
  createIcon,
  createIconButton,
  createInfoTip,
  createLazyMediaElement,
  createThumbnailSizeSegmented,
  DEFAULT_THUMBNAIL_SIZE,
  getThumbnailImageTier,
  getThumbnailSizeClass,
  isQueueActiveStatus,
  openMediaLightbox,
  renderFailedItemsPanel,
  renderQueueBanner,
  renderSharedDownloadConfigControls,
  reobserveLazyMedia,
  safeOpenExternalUrl,
  sanitizeSafeMediaUrl,
  sanitizeThumbnailSize,
  toThumbnailMediaUrl,
  type LightboxItem,
  type ThumbnailSize,
} from "./ui-helpers.ts";

export interface CharacterMediaWidgetCallbacks {
  onScanCharacter(characterId: string, forceRefresh?: boolean): Promise<CharacterMediaScanResult>;
  onStartDownload(filter: DownloadFilterOptions): Promise<void>;
  onSaveCharacterOverride(
    characterId: string,
    override: CharacterDownloadOverride | null,
  ): Promise<CharacterDownloadOverride | null>;
  onClearFailedUrls(urls: string[]): Promise<void>;
  onQueueControl(
    control: "pause" | "resume" | "skip_current" | "cancel_all",
    targetUrl?: string,
  ): Promise<void>;
  onPurgeCharacterCache(characterId: string, urls?: string[]): Promise<void>;
  onOpenCharacterEditor?(characterId: string): void;
}

export type MediaGridFilter = "all" | "localized" | "expressions" | "video";

export interface CharacterWidgetPreferences {
  showDownloadConfig: boolean;
  showGreetingSubfilter: boolean;
  showWorldBookSubfilter: boolean;
  showUrlPicker: boolean;
  showRemoteThumbnails: boolean;
  mediaViewMode: "grid" | "list";
  mediaFilter: MediaGridFilter;
  showDownloadedMedia: boolean;
  thumbnailSize: ThumbnailSize;
}

export interface CharacterWidgetUiState extends CharacterWidgetPreferences {
  expandedUrls: string[];
}

const VALID_MEDIA_FILTERS = new Set<MediaGridFilter>([
  "all",
  "localized",
  "expressions",
  "video",
]);

export function getDefaultCharacterPreferences(
  defaultExpandDownloadedMedia = true,
): CharacterWidgetPreferences {
  return {
    showDownloadConfig: false,
    showGreetingSubfilter: false,
    showWorldBookSubfilter: false,
    showUrlPicker: false,
    showRemoteThumbnails: false,
    mediaViewMode: "grid",
    mediaFilter: "all",
    showDownloadedMedia: defaultExpandDownloadedMedia,
    thumbnailSize: DEFAULT_THUMBNAIL_SIZE,
  };
}

export function sanitizeCharacterPreferences(
  raw: unknown,
  defaultExpandDownloadedMedia = true,
): CharacterWidgetPreferences {
  const defaults = getDefaultCharacterPreferences(defaultExpandDownloadedMedia);
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Record<string, unknown>;
  const mediaFilter =
    typeof obj.mediaFilter === "string" &&
    VALID_MEDIA_FILTERS.has(obj.mediaFilter as MediaGridFilter)
      ? (obj.mediaFilter as MediaGridFilter)
      : defaults.mediaFilter;

  return {
    showDownloadConfig:
      typeof obj.showDownloadConfig === "boolean"
        ? obj.showDownloadConfig
        : defaults.showDownloadConfig,
    showGreetingSubfilter:
      typeof obj.showGreetingSubfilter === "boolean"
        ? obj.showGreetingSubfilter
        : defaults.showGreetingSubfilter,
    showWorldBookSubfilter:
      typeof obj.showWorldBookSubfilter === "boolean"
        ? obj.showWorldBookSubfilter
        : defaults.showWorldBookSubfilter,
    showUrlPicker:
      typeof obj.showUrlPicker === "boolean"
        ? obj.showUrlPicker
        : defaults.showUrlPicker,
    showRemoteThumbnails:
      typeof obj.showRemoteThumbnails === "boolean"
        ? obj.showRemoteThumbnails
        : defaults.showRemoteThumbnails,
    mediaViewMode: obj.mediaViewMode === "list" ? "list" : "grid",
    mediaFilter,
    showDownloadedMedia:
      typeof obj.showDownloadedMedia === "boolean"
        ? obj.showDownloadedMedia
        : defaults.showDownloadedMedia,
    thumbnailSize: sanitizeThumbnailSize(obj.thumbnailSize),
  };
}

function sameSetAsList<T>(set: Set<T>, list: readonly T[]): boolean {
  const target = new Set(list);
  if (set.size !== target.size) return false;
  for (const item of set) {
    if (!target.has(item)) return false;
  }
  return true;
}

export class CharacterMediaWidget {
  private characterId: string;
  private scan: CharacterMediaScanResult | null = null;
  private loading = false;
  private error: string | null = null;

  // UI state
  private showDownloadConfig = false;
  private showGreetingSubfilter = false;
  private showWorldBookSubfilter = false;
  private showUrlPicker = false;
  private showRemoteThumbnails = false;
  private mediaViewMode: "grid" | "list" = "grid";
  private mediaFilter: MediaGridFilter = "all";
  private showDownloadedMedia = true;
  private thumbnailSize: ThumbnailSize = DEFAULT_THUMBNAIL_SIZE;
  private queueBannerEl: HTMLElement | null = null;

  // Effective filter state (defaults from global settings, overlaid by per-card override)
  private selectedSections = new Set<MediaSourceSection>();
  private selectedGreetings: Set<number> | null = null;
  private selectedWorldBooks: Set<string> | null = null;
  private selectedDomains: Set<string> | null = null;
  private selectedKinds = new Set<MediaKind>(["image", "video"]);
  private includeFailed = true;
  private excludedUrls = new Set<string>();
  private expandedUrls = new Set<string>();
  private batchCap = 50;
  private hasCustomOverride = false;
  private filtersInitializedForChar: string | null = null;
  private overrideSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOverrideSave: {
    charId: string;
    override: CharacterDownloadOverride | null;
  } | null = null;
  private inFlightOverrideSaves = new Map<string, Promise<void>>();
  private refreshBtnEl: HTMLButtonElement | null = null;
  private mediaTileCache = new Map<string, { sig: string; el: HTMLElement }>();
  private tileClickHandlers = new WeakMap<HTMLElement, () => void>();
  private scanGeneration = 0;
  private destroyed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: SpindleFrontendContext,
    characterId: string,
    private settings: MediaLocalizerSettings,
    private queueProgress: QueueJobProgress,
    private readonly callbacks: CharacterMediaWidgetCallbacks,
    private readonly options: {
      inDrawer?: boolean;
      defaultExpandConfig?: boolean;
      defaultExpandDownloadedMedia?: boolean;
      initialUiState?: Partial<CharacterWidgetUiState>;
      initialScan?: CharacterMediaScanResult | null;
      onUiStateChange?: (state: CharacterWidgetUiState) => void;
      onScanChange?: (scan: CharacterMediaScanResult | null) => void;
    } = {},
  ) {
    this.characterId = characterId;
    this.batchCap = settings.defaultBatchCap;
    const defaultExpandDownloaded =
      options.defaultExpandDownloadedMedia ?? options.inDrawer !== false;
    const prefs = sanitizeCharacterPreferences(
      options.initialUiState,
      defaultExpandDownloaded,
    );
    this.showDownloadConfig =
      options.defaultExpandConfig === true ? true : prefs.showDownloadConfig;
    this.showGreetingSubfilter = prefs.showGreetingSubfilter;
    this.showWorldBookSubfilter = prefs.showWorldBookSubfilter;
    this.showUrlPicker = prefs.showUrlPicker;
    this.showRemoteThumbnails = prefs.showRemoteThumbnails;
    this.mediaViewMode = prefs.mediaViewMode;
    this.mediaFilter = prefs.mediaFilter;
    this.showDownloadedMedia =
      options.initialUiState?.showDownloadedMedia !== undefined
        ? prefs.showDownloadedMedia
        : defaultExpandDownloaded;
    this.thumbnailSize = prefs.thumbnailSize;
    if (Array.isArray(options.initialUiState?.expandedUrls)) {
      this.expandedUrls = new Set(options.initialUiState.expandedUrls);
    }
    if (options.initialScan && options.initialScan.characterId === characterId) {
      this.scan = options.initialScan;
      this.initFiltersFromScan(options.initialScan, true);
    }
  }

  private emitUiStateChange(): void {
    this.options.onUiStateChange?.({
      showDownloadConfig: this.showDownloadConfig,
      showGreetingSubfilter: this.showGreetingSubfilter,
      showWorldBookSubfilter: this.showWorldBookSubfilter,
      showUrlPicker: this.showUrlPicker,
      showRemoteThumbnails: this.showRemoteThumbnails,
      mediaViewMode: this.mediaViewMode,
      mediaFilter: this.mediaFilter,
      showDownloadedMedia: this.showDownloadedMedia,
      thumbnailSize: this.thumbnailSize,
      expandedUrls: Array.from(this.expandedUrls),
    });
  }

  private persistOverrideNow(
    charId: string,
    override: CharacterDownloadOverride | null,
  ): Promise<void> {
    const prev = this.inFlightOverrideSaves.get(charId);
    const runSave = () =>
      this.callbacks.onSaveCharacterOverride(charId, override);
    const next = (prev ? prev.catch(() => undefined).then(runSave) : runSave())
      .then(() => undefined)
      .catch((err) => {
        console.warn("[media_localizer] Failed saving character override:", err);
      })
      .finally(() => {
        if (this.inFlightOverrideSaves.get(charId) === next) {
          this.inFlightOverrideSaves.delete(charId);
        }
      });
    this.inFlightOverrideSaves.set(charId, next);
    return next;
  }

  private hasPendingOverrideFor(charId: string): boolean {
    return (
      (this.pendingOverrideSave !== null && this.pendingOverrideSave.charId === charId) ||
      this.inFlightOverrideSaves.has(charId)
    );
  }

  flushPendingOverrideSave(): Promise<void> {
    if (this.overrideSaveTimer !== null) {
      clearTimeout(this.overrideSaveTimer);
      this.overrideSaveTimer = null;
    }
    const pending = this.pendingOverrideSave;
    this.pendingOverrideSave = null;
    if (!pending) {
      return this.inFlightOverrideSaves.get(this.characterId) ?? Promise.resolve();
    }
    return this.persistOverrideNow(pending.charId, pending.override);
  }

  destroy(): void {
    this.destroyed = true;
    this.scanGeneration++;
    this.refreshBtnEl = null;
    this.mediaTileCache.clear();
    void this.flushPendingOverrideSave();
  }

  getCharacterId(): string {
    return this.characterId;
  }

  getScan(): CharacterMediaScanResult | null {
    return this.scan;
  }

  getPendingDownloadCount(): number {
    if (!this.scan) return 0;
    const matched = filterScanItemsForDownload(this.scan, this.buildCurrentFilter(true));
    return this.batchCap > 0 ? Math.min(matched.length, this.batchCap) : matched.length;
  }

  setCharacterId(nextId: string): void {
    if (this.destroyed) return;
    if (this.characterId === nextId && (this.scan || this.loading)) return;
    if (this.characterId !== nextId) {
      void this.flushPendingOverrideSave();
      this.mediaTileCache.clear();
      for (const el of this.root.querySelectorAll<HTMLElement>("[data-scroll-id]")) {
        el.scrollTop = 0;
      }
      if (this.expandedUrls.size > 0) {
        this.expandedUrls.clear();
        this.emitUiStateChange();
      }
    }
    this.characterId = nextId;
    this.scan = null;
    this.error = null;
    this.filtersInitializedForChar = null;
    void this.refreshScan(false);
  }

  applySharedPreferences(prefs: Partial<CharacterWidgetPreferences>): void {
    if (this.destroyed || !prefs || typeof prefs !== "object") return;
    const sanitized = sanitizeCharacterPreferences({
      showDownloadConfig: this.showDownloadConfig,
      showGreetingSubfilter: this.showGreetingSubfilter,
      showWorldBookSubfilter: this.showWorldBookSubfilter,
      showUrlPicker: this.showUrlPicker,
      showRemoteThumbnails: this.showRemoteThumbnails,
      mediaViewMode: this.mediaViewMode,
      mediaFilter: this.mediaFilter,
      showDownloadedMedia: this.showDownloadedMedia,
      thumbnailSize: this.thumbnailSize,
      ...prefs,
    });

    let changed = false;
    if (
      prefs.showGreetingSubfilter !== undefined &&
      sanitized.showGreetingSubfilter !== this.showGreetingSubfilter
    ) {
      this.showGreetingSubfilter = sanitized.showGreetingSubfilter;
      changed = true;
    }
    if (
      prefs.showWorldBookSubfilter !== undefined &&
      sanitized.showWorldBookSubfilter !== this.showWorldBookSubfilter
    ) {
      this.showWorldBookSubfilter = sanitized.showWorldBookSubfilter;
      changed = true;
    }
    if (
      prefs.showUrlPicker !== undefined &&
      sanitized.showUrlPicker !== this.showUrlPicker
    ) {
      this.showUrlPicker = sanitized.showUrlPicker;
      changed = true;
    }
    if (
      prefs.showRemoteThumbnails !== undefined &&
      sanitized.showRemoteThumbnails !== this.showRemoteThumbnails
    ) {
      this.showRemoteThumbnails = sanitized.showRemoteThumbnails;
      changed = true;
    }
    if (
      prefs.mediaViewMode !== undefined &&
      sanitized.mediaViewMode !== this.mediaViewMode
    ) {
      this.mediaViewMode = sanitized.mediaViewMode;
      this.mediaTileCache.clear();
      changed = true;
    }
    if (
      prefs.mediaFilter !== undefined &&
      sanitized.mediaFilter !== this.mediaFilter
    ) {
      this.mediaFilter = sanitized.mediaFilter;
      changed = true;
    }
    if (
      prefs.thumbnailSize !== undefined &&
      sanitized.thumbnailSize !== this.thumbnailSize
    ) {
      this.thumbnailSize = sanitized.thumbnailSize;
      this.mediaTileCache.clear();
      changed = true;
    }

    if (changed) {
      this.render();
    }
  }

  updateExternalState(
    settings: MediaLocalizerSettings,
    queueProgress: QueueJobProgress,
    forceRefresh = false,
  ): void {
    if (this.destroyed) return;
    const prevSettings = this.settings;
    const prevStatus = this.queueProgress.status;
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(this.settings);
    const scanSettingsChanged =
      settings.scanBareUrls !== prevSettings.scanBareUrls ||
      settings.adoptNativeGalleryImages !== prevSettings.adoptNativeGalleryImages;
    this.settings = settings;
    this.queueProgress = queueProgress;

    if (
      settingsChanged &&
      this.scan &&
      !this.hasCustomOverride &&
      !this.hasPendingOverrideFor(this.scan.characterId)
    ) {
      this.filtersInitializedForChar = null;
      this.initFiltersFromScan(this.scan);
    }

    const wasActive = isQueueActiveStatus(prevStatus);
    const nowActive = isQueueActiveStatus(queueProgress.status);

    if ((wasActive && !nowActive) || (scanSettingsChanged && this.scan) || forceRefresh) {
      void this.refreshScan(scanSettingsChanged || forceRefresh);
      return;
    }

    if (!this.options.inDrawer && this.queueBannerEl && nowActive) {
      const next = renderQueueBanner(this.queueProgress, this.callbacks.onQueueControl);
      this.queueBannerEl.replaceWith(next);
      this.queueBannerEl = next;
      return;
    }

    if (settingsChanged || wasActive !== nowActive) {
      this.render();
    }
  }

  async refreshScan(forceRefresh = false): Promise<void> {
    if (this.destroyed) return;
    const targetId = this.characterId;
    const gen = ++this.scanGeneration;
    if (!targetId) {
      this.scan = null;
      this.loading = false;
      this.error = null;
      this.render();
      return;
    }
    this.loading = true;
    this.error = null;
    if (!this.scan) {
      this.render();
    } else if (this.refreshBtnEl) {
      this.refreshBtnEl.disabled = true;
      this.refreshBtnEl.classList.add("is-busy");
    }
    try {
      if (this.hasPendingOverrideFor(targetId)) {
        await this.flushPendingOverrideSave();
        await this.inFlightOverrideSaves.get(targetId);
        if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
          return;
        }
      }
      const result = await this.callbacks.onScanCharacter(targetId, forceRefresh);
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      if (this.hasPendingOverrideFor(result.characterId)) {
        // User edited local filters while scan was in-flight; preserve local edits instead of wiping them.
        const localOverride = this.buildOverrideFromState();
        result.override = localOverride;
        this.hasCustomOverride = localOverride !== null;
        this.scan = result;
      } else {
        this.scan = result;
        this.initFiltersFromScan(result, forceRefresh);
      }
      this.options.onScanChange?.(result);
    } catch (err) {
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      this.loading = false;
      this.render();
    }
  }

  private async runAction(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (this.destroyed) return;
      this.error = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }

  private initFiltersFromScan(scan: CharacterMediaScanResult, reinitExisting = false): void {
    if (!reinitExisting && this.filtersInitializedForChar === scan.characterId) {
      this.hasCustomOverride = Boolean(scan.override && !isOverrideEmpty(scan.override));
      return;
    }
    this.filtersInitializedForChar = scan.characterId;
    const override = scan.override ?? null;
    this.hasCustomOverride = Boolean(override && !isOverrideEmpty(override));

    const effective = buildEffectiveFilter(this.settings, scan, override);
    this.selectedSections = new Set(effective.sections ?? this.settings.defaultSections);
    this.selectedKinds = new Set(effective.mediaKinds ?? this.settings.defaultMediaKinds);
    this.includeFailed = effective.includeFailed ?? this.settings.defaultIncludeFailed;
    this.batchCap = effective.maxItems ?? this.settings.defaultBatchCap;

    this.selectedGreetings =
      override?.greetingIndices && override.greetingIndices.length > 0
        ? new Set(override.greetingIndices)
        : null;
    this.selectedWorldBooks =
      override?.worldBookIds && override.worldBookIds.length > 0
        ? new Set(override.worldBookIds)
        : null;
    this.selectedDomains =
      override?.domains && override.domains.length > 0
        ? new Set(override.domains)
        : null;
    this.excludedUrls = new Set(override?.excludedUrls ?? []);
  }

  private buildOverrideFromState(): CharacterDownloadOverride | null {
    const matchesSections = sameSetAsList(
      this.selectedSections,
      this.settings.defaultSections,
    );
    const matchesKinds = sameSetAsList(
      this.selectedKinds,
      this.settings.defaultMediaKinds,
    );
    const matchesFailed = this.includeFailed === this.settings.defaultIncludeFailed;
    const matchesCap = this.batchCap === this.settings.defaultBatchCap;

    if (
      matchesSections &&
      matchesKinds &&
      matchesFailed &&
      matchesCap &&
      this.selectedGreetings === null &&
      this.selectedWorldBooks === null &&
      this.selectedDomains === null &&
      this.excludedUrls.size === 0
    ) {
      return null;
    }

    const override: CharacterDownloadOverride = {};
    if (!matchesSections) override.sections = Array.from(this.selectedSections);
    if (!matchesKinds) override.mediaKinds = Array.from(this.selectedKinds);
    if (!matchesFailed) override.includeFailed = this.includeFailed;
    if (!matchesCap) override.maxItems = this.batchCap;
    if (this.selectedGreetings !== null) {
      override.greetingIndices = Array.from(this.selectedGreetings);
    }
    if (this.selectedWorldBooks !== null) {
      override.worldBookIds = Array.from(this.selectedWorldBooks);
    }
    if (this.selectedDomains !== null) {
      override.domains = Array.from(this.selectedDomains);
    }
    if (this.excludedUrls.size > 0) {
      override.excludedUrls = Array.from(this.excludedUrls);
    }
    return isOverrideEmpty(override) ? null : override;
  }

  private scheduleSaveOverride(): void {
    if (this.destroyed) return;
    const targetCharId = this.characterId;
    if (!targetCharId) return;
    const nextOverride = this.buildOverrideFromState();
    this.hasCustomOverride = nextOverride !== null;
    if (this.scan && this.scan.characterId === targetCharId) {
      this.scan.override = nextOverride;
      this.options.onScanChange?.(this.scan);
    }

    if (this.overrideSaveTimer) clearTimeout(this.overrideSaveTimer);
    this.pendingOverrideSave = { charId: targetCharId, override: nextOverride };
    this.overrideSaveTimer = setTimeout(() => {
      this.overrideSaveTimer = null;
      this.pendingOverrideSave = null;
      if (this.destroyed) return;
      void this.persistOverrideNow(targetCharId, nextOverride);
    }, 150);
  }

  private async resetToGlobalDefaults(): Promise<void> {
    if (!this.scan) return;
    const targetCharId = this.scan.characterId;
    if (this.overrideSaveTimer) {
      clearTimeout(this.overrideSaveTimer);
      this.overrideSaveTimer = null;
    }
    this.pendingOverrideSave = null;
    this.scan.override = null;
    this.hasCustomOverride = false;
    this.filtersInitializedForChar = null;
    this.initFiltersFromScan(this.scan);
    this.options.onScanChange?.(this.scan);
    await this.persistOverrideNow(targetCharId, null);
    if (this.destroyed || this.characterId !== targetCharId) return;
    this.render();
  }

  private captureScrollState(): {
    internal: Map<string, number>;
    ancestors: Array<{ el: HTMLElement; top: number }>;
  } {
    const internal = new Map<string, number>();
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (id && el.scrollTop > 0) {
        internal.set(id, el.scrollTop);
      }
    }
    const ancestors: Array<{ el: HTMLElement; top: number }> = [];
    let parent = this.root.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (parent.scrollTop > 0) {
        ancestors.push({ el: parent, top: parent.scrollTop });
      }
      parent = parent.parentElement;
    }
    return { internal, ancestors };
  }

  private restoreScrollState(state: {
    internal: Map<string, number>;
    ancestors: Array<{ el: HTMLElement; top: number }>;
  }): void {
    for (const [id, top] of state.internal.entries()) {
      const el = this.root.querySelector<HTMLElement>(`[data-scroll-id="${id}"]`);
      if (el) el.scrollTop = top;
    }
    for (const { el, top } of state.ancestors) {
      el.scrollTop = top;
    }
  }

  private buildCurrentFilter(includeExcluded = true): Omit<DownloadFilterOptions, "characterIds"> {
    return {
      sections: Array.from(this.selectedSections),
      greetingIndices:
        this.selectedGreetings !== null ? Array.from(this.selectedGreetings) : undefined,
      worldBookIds:
        this.selectedWorldBooks !== null ? Array.from(this.selectedWorldBooks) : undefined,
      domains: this.selectedDomains !== null ? Array.from(this.selectedDomains) : undefined,
      mediaKinds: Array.from(this.selectedKinds),
      includeFailed: this.includeFailed,
      excludedUrls: includeExcluded ? Array.from(this.excludedUrls) : undefined,
      maxItems: this.batchCap,
    };
  }

  async triggerOneClickLocalize(): Promise<void> {
    if (this.destroyed) return;
    const scan = this.scan;
    if (!scan) return;
    const targetCharId = scan.characterId;
    const filter = this.buildCurrentFilter(true);
    const matched = filterScanItemsForDownload(scan, filter);
    const effectiveCount =
      this.batchCap > 0 ? Math.min(matched.length, this.batchCap) : matched.length;
    if (effectiveCount === 0) return;

    if (effectiveCount > this.settings.confirmThreshold) {
      const res = await this.ctx.ui.showConfirm({
        title: "Confirm Media Localization Batch",
        message: `Download ${effectiveCount} remote media file(s) for "${scan.characterName}"?`,
        confirmLabel: `Localize ${effectiveCount}`,
        cancelLabel: "Cancel",
      });
      if (this.destroyed || this.characterId !== targetCharId || !res?.confirmed) {
        return;
      }
    }

    await this.runAction(() =>
      this.callbacks.onStartDownload({
        characterIds: [targetCharId],
        ...filter,
      }),
    );
  }

  render(): void {
    if (this.destroyed) return;
    const scrollState = this.captureScrollState();
    this.root.innerHTML = "";
    this.queueBannerEl = null;
    this.refreshBtnEl = null;

    const wrap = document.createElement("div");
    const thumbClass = getThumbnailSizeClass(this.thumbnailSize);
    wrap.className =
      this.options.inDrawer === true
        ? `ml-widget is-drawer ${thumbClass}`
        : this.options.inDrawer === false
          ? `ml-widget is-embedded ${thumbClass}`
          : `ml-widget ${thumbClass}`;

    if (!this.characterId) {
      const empty = document.createElement("div");
      empty.className = "ml-section ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("image", 20));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent = "Open a character chat or editor to manage its media.";
      empty.append(iconWrap, textEl);
      wrap.appendChild(empty);
      this.root.appendChild(wrap);
      return;
    }

    if (this.error) {
      const err = document.createElement("div");
      err.className = "ml-error-banner";
      const errText = document.createElement("span");
      errText.textContent = this.error;
      err.append(createIcon("alert", 14), errText);
      wrap.appendChild(err);
    }

    // Embedded contexts (Character Editor Gallery tab) render their own queue banner.
    // The Drawer renders one single sticky banner above all tabs.
    if (!this.options.inDrawer && isQueueActiveStatus(this.queueProgress.status)) {
      this.queueBannerEl = renderQueueBanner(
        this.queueProgress,
        this.callbacks.onQueueControl,
      );
      wrap.appendChild(this.queueBannerEl);
    }

    if (this.loading && !this.scan) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "ml-section ml-empty ml-loading-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("refresh", 18));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent = "Scanning character media...";
      loadingEl.append(iconWrap, textEl);
      wrap.appendChild(loadingEl);
      this.root.appendChild(wrap);
      return;
    }

    if (!this.scan) {
      const retryCard = document.createElement("div");
      retryCard.className = "ml-section ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("search", 18));
      const retry = createIconButton({
        icon: "refresh",
        label: "Scan Character Media",
        title: "Scan character fields, linked World Books, and Regex scripts",
        className: "ml-btn is-primary",
        size: 13,
        onClick: () => void this.refreshScan(true),
      });
      retryCard.append(iconWrap, retry);
      wrap.appendChild(retryCard);
      this.root.appendChild(wrap);
      return;
    }

    const scan = this.scan;
    const candidateItems = filterScanItemsForDownload(scan, this.buildCurrentFilter(false));
    const selectedPending = candidateItems.filter(
      (i) => !this.excludedUrls.has(i.normalizedUrl),
    );
    const effectivePendingCount =
      this.batchCap > 0
        ? Math.min(selectedPending.length, this.batchCap)
        : selectedPending.length;

    // 1. Header
    wrap.appendChild(this.renderHeaderSection(scan, effectivePendingCount, selectedPending.length));

    // 2. Grouped Failed Items Panel (actionable Recovery UI)
    const failedEntries = scan.items
      .filter((i) => i.status === "failed" && !this.excludedUrls.has(i.normalizedUrl))
      .map((i) => ({
        normalizedUrl: i.normalizedUrl,
        error: i.failureInfo?.error || "Download failed",
        lastAttemptAt: i.failureInfo?.lastAttemptAt,
        domain: i.domain,
      }));
    const failedPanel = renderFailedItemsPanel({
      items: failedEntries,
      onRetryUrls: (urls) => {
        void this.runAction(() =>
          this.callbacks.onStartDownload({
            characterIds: [scan.characterId],
            explicitUrls: urls,
            includeFailed: true,
            maxItems: urls.length,
          }),
        );
      },
      onIgnoreUrls: (urls) => {
        for (const u of urls) this.excludedUrls.add(u);
        this.scheduleSaveOverride();
        void this.runAction(async () => {
          await this.flushPendingOverrideSave();
          await this.callbacks.onClearFailedUrls(urls);
          await this.refreshScan(false);
        });
      },
    });
    if (failedPanel) {
      wrap.appendChild(failedPanel);
    }

    // 3. Combined Collapsible Section: Downloaded Media & Per-Card Download Options
    wrap.appendChild(
      this.renderCombinedOptionsAndMediaSection(
        scan,
        candidateItems,
        selectedPending,
        effectivePendingCount,
      ),
    );

    this.root.appendChild(wrap);
    this.restoreScrollState(scrollState);
  }

  private renderHeaderSection(
    scan: CharacterMediaScanResult,
    effectivePendingCount: number,
    totalMatchedCount: number,
  ): HTMLElement {
    const localizedItems = scan.items.filter((i) => i.status === "localized");
    const remoteCount = scan.items.filter((i) => i.status === "remote").length;
    const failedCount = scan.items.filter((i) => i.status === "failed").length;
    const exprCount = scan.media?.expressions.length ?? 0;
    const totalBytes = scan.media?.totalSizeBytes ?? 0;

    const header = document.createElement("div");
    header.className = "ml-section ml-char-header";

    const identityRow = document.createElement("div");
    identityRow.className = "ml-char-identity";

    const safeAvatarUrl =
      this.options.inDrawer !== false
        ? sanitizeSafeMediaUrl(scan.media?.avatarUrl)
        : null;
    if (safeAvatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "ml-char-avatar";
      avatar.src = safeAvatarUrl;
      avatar.alt = scan.characterName;
      identityRow.appendChild(avatar);
    } else if (this.options.inDrawer !== false) {
      const avatarFallback = document.createElement("div");
      avatarFallback.className = "ml-char-avatar-fallback";
      avatarFallback.setAttribute("aria-hidden", "true");
      avatarFallback.appendChild(createIcon("user", 18));
      identityRow.appendChild(avatarFallback);
    }

    const titleCol = document.createElement("div");
    titleCol.className = "ml-char-meta";

    const titleLine = document.createElement("div");
    titleLine.className = "ml-header-bar";

    const titleGroup = document.createElement("div");
    titleGroup.className = "ml-inline-title";
    const nameEl = document.createElement("span");
    nameEl.className = "ml-title ml-char-name";
    nameEl.textContent = scan.characterName;
    nameEl.title = scan.characterName;
    titleGroup.append(
      nameEl,
      createInfoTip(
        "Localized media is automatically displayed instead of remote URLs while keeping your character card untouched.",
      ),
    );
    if (this.hasCustomOverride) {
      const customBadge = document.createElement("span");
      customBadge.className = "ml-badge is-info";
      customBadge.textContent = "Custom";
      customBadge.title = "Using custom per-card download options instead of global defaults";
      titleGroup.appendChild(customBadge);
    }

    const actions = document.createElement("div");
    actions.className = "ml-header-actions";

    const localizeBtn = createIconButton({
      icon: "download",
      label:
        effectivePendingCount > 0
          ? effectivePendingCount < totalMatchedCount
            ? `Localize (${effectivePendingCount}/${totalMatchedCount})`
            : `Localize (${effectivePendingCount})`
          : "Localized",
      title:
        effectivePendingCount > 0
          ? `Download ${effectivePendingCount} remote media file(s) using ${this.hasCustomOverride ? "custom card options" : "global download defaults"}`
          : "No pending remote media matches the current filter options",
      className: `ml-btn is-sm ${effectivePendingCount > 0 ? "is-primary" : ""}`,
      size: 13,
      disabled: effectivePendingCount === 0,
      onClick: () => void this.triggerOneClickLocalize(),
    });

    const refreshBtn = createIconButton({
      icon: "refresh",
      title: "Rescan character fields, linked World Books, and Regex scripts",
      className: `ml-btn ml-icon-btn is-sm ${this.loading ? "is-busy" : ""}`,
      size: 13,
      disabled: this.loading,
      onClick: () => {
        if (this.loading) return;
        void this.refreshScan(true);
      },
    });
    this.refreshBtnEl = refreshBtn;

    actions.appendChild(localizeBtn);
    if (this.callbacks.onOpenCharacterEditor) {
      const editBtn = createIconButton({
        icon: "edit",
        label: "Edit",
        title: "Open native Character Editor for this character",
        className: "ml-btn is-sm",
        size: 13,
        onClick: () => this.callbacks.onOpenCharacterEditor?.(scan.characterId),
      });
      actions.appendChild(editBtn);
    }
    actions.appendChild(refreshBtn);
    titleLine.append(titleGroup, actions);

    const statusLine = document.createElement("div");
    statusLine.className = "ml-status-row";

    const addBadge = (
      text: string,
      variant = "",
      icon?: "check" | "download" | "alert" | "sparkles",
    ) => {
      const b = document.createElement("span");
      b.className = `ml-badge ${variant}`.trim();
      const textSpan = document.createElement("span");
      textSpan.textContent = text;
      if (icon) {
        b.append(createIcon(icon, 11), textSpan);
      } else {
        b.appendChild(textSpan);
      }
      statusLine.appendChild(b);
    };

    addBadge(
      `${localizedItems.length} localized${totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}`,
      localizedItems.length > 0 ? "is-local" : "is-muted",
      localizedItems.length > 0 ? "check" : undefined,
    );
    if (remoteCount > 0 || (localizedItems.length === 0 && failedCount === 0)) {
      addBadge(
        `${remoteCount} remote`,
        remoteCount > 0 ? "is-remote" : "is-muted",
        remoteCount > 0 ? "download" : undefined,
      );
    }
    if (failedCount > 0) addBadge(`${failedCount} failed`, "is-failed", "alert");
    if (exprCount > 0) addBadge(`${exprCount} expr`, "is-info", "sparkles");

    titleCol.append(titleLine, statusLine);

    if (scan.items.length > 0) {
      const pct = Math.min(100, Math.round((localizedItems.length / scan.items.length) * 100));
      const progress = document.createElement("div");
      progress.className = "ml-mini-progress";
      progress.title = `${localizedItems.length} of ${scan.items.length} scanned URLs localized (${pct}%)`;
      const fill = document.createElement("div");
      fill.className = "ml-mini-progress-fill";
      fill.style.width = `${pct}%`;
      progress.appendChild(fill);
      titleCol.appendChild(progress);
    }

    identityRow.appendChild(titleCol);
    header.appendChild(identityRow);
    return header;
  }

  private renderOptionsSection(
    scan: CharacterMediaScanResult,
    candidateItems: DiscoveredMediaItem[],
    selectedPending: DiscoveredMediaItem[],
    effectivePendingCount: number,
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "ml-combined-pane ml-options-panel";

    const top = document.createElement("div");
    top.className = "ml-section-title";

    const titleGroup = document.createElement("div");
    titleGroup.className = "ml-inline-title";
    const heading = document.createElement("span");
    heading.textContent = "Per-Card Download Options";
    const statusPill = document.createElement("span");
    statusPill.className = `ml-badge ${this.hasCustomOverride ? "is-info" : ""}`;
    statusPill.textContent = this.hasCustomOverride ? "Custom" : "Global defaults";
    titleGroup.append(
      createIcon("sliders", 13),
      heading,
      statusPill,
      createInfoTip(
        "Customize which sections, greetings, World Books, domains, or specific URLs are included when clicking Localize for this character.",
      ),
    );

    const resetBtn = createIconButton({
      icon: "rotate-ccw",
      label: "Reset",
      title: "Clear per-card customizations and use Settings global defaults",
      className: "ml-btn is-xs",
      size: 11,
      disabled: !this.hasCustomOverride,
      onClick: () => void this.runAction(() => this.resetToGlobalDefaults()),
    });

    top.append(titleGroup, resetBtn);
    container.appendChild(top);

    // Shared section, media types, retry failed, and batch limit controls
    container.appendChild(
      renderSharedDownloadConfigControls({
        state: {
          sections: this.selectedSections,
          mediaKinds: this.selectedKinds,
          includeFailed: this.includeFailed,
          batchCap: this.batchCap,
        },
        sectionCounts: scan.sectionCounts,
        sectionTip: "Unchecking sections skips them for one-click localization on this character.",
        onChange: (nextState) => {
          this.selectedSections = nextState.sections;
          this.selectedKinds = nextState.mediaKinds;
          this.includeFailed = nextState.includeFailed;
          this.batchCap = nextState.batchCap;
          this.scheduleSaveOverride();
          this.render();
        },
      }),
    );

    // Domain pills (inline label + pills to save a vertical row)
    const remoteDomains = scan.domainBreakdown.filter((d) => {
      const failed = (d as typeof d & { failedCount?: number }).failedCount ?? 0;
      return d.remoteCount + failed > 0;
    });
    if (remoteDomains.length > 1) {
      const pillRow = document.createElement("div");
      pillRow.className = "ml-pill-row";
      pillRow.style.alignItems = "center";
      const domLabel = document.createElement("span");
      domLabel.className = "ml-config-label";
      domLabel.textContent = "Domains";
      pillRow.appendChild(domLabel);

      for (const dom of remoteDomains) {
        const isSelected =
          this.selectedDomains === null || this.selectedDomains.has(dom.domain);
        const domFailed =
          (dom as typeof dom & { failedCount?: number }).failedCount ?? 0;
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `ml-pill ${isSelected ? "is-selected" : ""}`;
        pill.textContent = `${dom.domain} (${dom.remoteCount + domFailed})`;
        pill.addEventListener("click", () => {
          if (this.selectedDomains === null) {
            this.selectedDomains = new Set(remoteDomains.map((d) => d.domain));
          }
          if (this.selectedDomains.has(dom.domain)) {
            const remaining = remoteDomains.filter(
              (d) => d.domain !== dom.domain && this.selectedDomains!.has(d.domain),
            );
            if (remaining.length === 0) {
              return;
            }
            this.selectedDomains.delete(dom.domain);
          } else {
            this.selectedDomains.add(dom.domain);
          }
          if (remoteDomains.every((d) => this.selectedDomains!.has(d.domain))) {
            this.selectedDomains = null;
          }
          this.scheduleSaveOverride();
          this.render();
        });
        pillRow.appendChild(pill);
      }
      container.appendChild(pillRow);
    }

    // Consolidated row for Greeting sub-filter, World Book sub-filter, and URL Inspector triggers
    const hasGreetingSubfilter =
      this.selectedSections.has("alternate_greetings") &&
      scan.greetingBreakdown.length > 1;
    const hasWorldBookSubfilter =
      this.selectedSections.has("world_books") && scan.worldBookBreakdown.length > 1;

    const triggerRow = document.createElement("div");
    triggerRow.className = "ml-compact-row";

    if (hasGreetingSubfilter) {
      triggerRow.appendChild(
        createIconButton({
          icon: "filter",
          label: this.showGreetingSubfilter
            ? `Hide Greetings (${scan.greetingBreakdown.length})`
            : `Filter Greetings (${scan.greetingBreakdown.length})`,
          title: "Toggle per-greeting filter",
          className: `ml-btn is-xs ${this.showGreetingSubfilter ? "is-active" : ""}`,
          size: 11,
          onClick: () => {
            this.showGreetingSubfilter = !this.showGreetingSubfilter;
            this.emitUiStateChange();
            this.render();
          },
        }),
      );
    }

    if (hasWorldBookSubfilter) {
      triggerRow.appendChild(
        createIconButton({
          icon: "filter",
          label: this.showWorldBookSubfilter
            ? `Hide World Books (${scan.worldBookBreakdown.length})`
            : `Filter World Books (${scan.worldBookBreakdown.length})`,
          title: "Toggle per-World Book filter",
          className: `ml-btn is-xs ${this.showWorldBookSubfilter ? "is-active" : ""}`,
          size: 11,
          onClick: () => {
            this.showWorldBookSubfilter = !this.showWorldBookSubfilter;
            this.emitUiStateChange();
            this.render();
          },
        }),
      );
    }

    triggerRow.appendChild(
      createIconButton({
        icon: "list",
        label: this.showUrlPicker
          ? `Hide URL List (${selectedPending.length}/${candidateItems.length})`
          : `Inspect & Pick URLs (${selectedPending.length}/${candidateItems.length})`,
        title: "Inspect individual candidate URLs and toggle them",
        className: `ml-btn is-xs ${this.showUrlPicker ? "is-active" : ""}`,
        size: 11,
        onClick: () => {
          this.showUrlPicker = !this.showUrlPicker;
          this.emitUiStateChange();
          this.render();
        },
      }),
    );

    if (this.showUrlPicker && candidateItems.length > 0) {
      const thumbToggle = document.createElement("label");
      thumbToggle.className = "ml-toggle-label";
      const thumbCb = document.createElement("input");
      thumbCb.type = "checkbox";
      thumbCb.checked = this.showRemoteThumbnails;
      thumbCb.addEventListener("change", () => {
        this.showRemoteThumbnails = thumbCb.checked;
        this.emitUiStateChange();
        this.render();
      });
      thumbToggle.append(thumbCb, document.createTextNode("Previews"));
      triggerRow.appendChild(thumbToggle);
    }
    container.appendChild(triggerRow);

    // Greeting & World Book Sub-Selector Panels
    if (hasGreetingSubfilter && this.showGreetingSubfilter) {
      container.appendChild(
        this.renderSubfilterBox({
          title: hasWorldBookSubfilter && this.showWorldBookSubfilter ? "Greetings" : undefined,
          scrollId: "greetings-subfilter",
          entries: scan.greetingBreakdown.map((g) => ({
            key: g.greetingIndex,
            label: g.label,
            remoteCount: g.remoteCount,
            failedCount: (g as typeof g & { failedCount?: number }).failedCount ?? 0,
          })),
          getSelected: () => this.selectedGreetings,
          setSelected: (next) => {
            this.selectedGreetings = next;
          },
        }),
      );
    }

    if (hasWorldBookSubfilter && this.showWorldBookSubfilter) {
      container.appendChild(
        this.renderSubfilterBox({
          title: hasGreetingSubfilter && this.showGreetingSubfilter ? "World Books" : undefined,
          scrollId: "worldbooks-subfilter",
          entries: scan.worldBookBreakdown.map((wb) => ({
            key: wb.worldBookId,
            label: wb.worldBookName,
            remoteCount: wb.remoteCount,
            failedCount: (wb as typeof wb & { failedCount?: number }).failedCount ?? 0,
          })),
          getSelected: () => this.selectedWorldBooks,
          setSelected: (next) => {
            this.selectedWorldBooks = next;
          },
        }),
      );
    }

    if (this.showUrlPicker && candidateItems.length > 0) {
      container.appendChild(this.renderUrlPicker(scan, candidateItems));
    }

    const summaryBar = document.createElement("div");
    summaryBar.className = "ml-download-bar";
    const countNote = document.createElement("span");
    countNote.className = "ml-subtitle";
    countNote.textContent =
      effectivePendingCount < selectedPending.length
        ? `${effectivePendingCount} of ${selectedPending.length} selected (limit ${this.batchCap})`
        : `${selectedPending.length} selected`;
    const applyBtn = createIconButton({
      icon: "download",
      label: `Localize (${effectivePendingCount})`,
      title: "Start downloading selected items now",
      className: "ml-btn is-primary is-xs",
      size: 12,
      disabled: effectivePendingCount === 0,
      onClick: () => void this.triggerOneClickLocalize(),
    });
    summaryBar.append(countNote, applyBtn);
    container.appendChild(summaryBar);

    return container;
  }

  private renderSubfilterBox<K>(opts: {
    title?: string;
    scrollId: string;
    entries: Array<{
      key: K;
      label: string;
      remoteCount: number;
      failedCount: number;
    }>;
    getSelected: () => Set<K> | null;
    setSelected: (next: Set<K> | null) => void;
  }): HTMLElement {
    const box = document.createElement("div");
    box.className = "ml-subfilter-box";
    if (opts.title) {
      const titleEl = document.createElement("div");
      titleEl.className = "ml-config-label";
      titleEl.textContent = opts.title;
      box.appendChild(titleEl);
    }
    const list = document.createElement("div");
    list.className = "ml-subfilter-list";
    list.dataset.scrollId = opts.scrollId;

    for (const entry of opts.entries) {
      const lbl = document.createElement("label");
      lbl.className = "ml-checkbox-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const current = opts.getSelected();
      cb.checked = current === null || current.has(entry.key);
      cb.addEventListener("change", () => {
        let next = opts.getSelected();
        if (next === null) {
          next = new Set(opts.entries.map((item) => item.key));
        }
        if (cb.checked) {
          next.add(entry.key);
        } else {
          const remaining = opts.entries.filter(
            (item) => item.key !== entry.key && next!.has(item.key),
          );
          if (remaining.length === 0) {
            cb.checked = true;
            return;
          }
          next.delete(entry.key);
        }
        if (opts.entries.every((item) => next!.has(item.key))) {
          next = null;
        }
        opts.setSelected(next);
        this.scheduleSaveOverride();
        this.render();
      });
      const summary =
        entry.failedCount > 0
          ? `${entry.remoteCount} rem, ${entry.failedCount} err`
          : `${entry.remoteCount}`;
      lbl.append(cb, document.createTextNode(`${entry.label} (${summary})`));
      list.appendChild(lbl);
    }

    box.appendChild(list);
    return box;
  }

  private renderUrlPicker(
    scan: CharacterMediaScanResult,
    candidateItems: DiscoveredMediaItem[],
  ): HTMLElement {
    const urlBox = document.createElement("div");
    urlBox.className = "ml-subfilter-box";

    const urlTopBar = document.createElement("div");
    urlTopBar.className = "ml-header-bar";
    const urlTopBtns = document.createElement("div");
    urlTopBtns.className = "ml-header-actions";

    const checkAllBtn = document.createElement("button");
    checkAllBtn.type = "button";
    checkAllBtn.className = "ml-btn is-xs";
    checkAllBtn.textContent = "Check All";
    checkAllBtn.addEventListener("click", () => {
      for (const item of candidateItems) this.excludedUrls.delete(item.normalizedUrl);
      this.scheduleSaveOverride();
      this.render();
    });

    const uncheckAllBtn = document.createElement("button");
    uncheckAllBtn.type = "button";
    uncheckAllBtn.className = "ml-btn is-xs";
    uncheckAllBtn.textContent = "Uncheck All";
    uncheckAllBtn.addEventListener("click", () => {
      for (const item of candidateItems) this.excludedUrls.add(item.normalizedUrl);
      this.scheduleSaveOverride();
      this.render();
    });
    urlTopBtns.append(checkAllBtn, uncheckAllBtn);

    if (this.expandedUrls.size > 0) {
      const collapseAllBtn = document.createElement("button");
      collapseAllBtn.type = "button";
      collapseAllBtn.className = "ml-btn is-xs";
      collapseAllBtn.textContent = `Collapse (${this.expandedUrls.size})`;
      collapseAllBtn.addEventListener("click", () => {
        this.expandedUrls.clear();
        this.emitUiStateChange();
        this.render();
      });
      urlTopBtns.appendChild(collapseAllBtn);
    }

    urlTopBar.append(
      urlTopBtns,
      createInfoTip("Check or uncheck URLs to remember exclusions on this card. Click a row to inspect preview and sources."),
    );
    urlBox.appendChild(urlTopBar);

    const urlList = document.createElement("div");
    urlList.className = "ml-url-list";
    urlList.dataset.scrollId = "url-picker-list";

    for (const item of candidateItems) {
      const isExpanded = this.expandedUrls.has(item.normalizedUrl);
      const card = document.createElement("div");
      card.className = `ml-url-item-card ${isExpanded ? "is-expanded" : ""}`;

      const row = document.createElement("div");
      row.className = "ml-url-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ml-row-checkbox";
      cb.checked = !this.excludedUrls.has(item.normalizedUrl);
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) this.excludedUrls.delete(item.normalizedUrl);
        else this.excludedUrls.add(item.normalizedUrl);
        this.scheduleSaveOverride();
        this.render();
      });
      row.appendChild(cb);

      const safeThumbUrl = sanitizeSafeMediaUrl(item.normalizedUrl);
      if (this.showRemoteThumbnails && item.mediaKind === "image" && safeThumbUrl) {
        const thumb = document.createElement("img");
        thumb.className = "ml-url-thumb";
        thumb.loading = "lazy";
        thumb.src = safeThumbUrl;
        row.appendChild(thumb);
      }

      const meta = document.createElement("div");
      meta.className = "ml-url-meta";
      const urlText = document.createElement("div");
      urlText.className = "ml-url-text";
      urlText.textContent = item.normalizedUrl;
      const sourcesText = document.createElement("div");
      sourcesText.className = "ml-url-sources";
      const kindChip = document.createElement("span");
      const kindClass =
        item.status === "failed"
          ? "is-failed"
          : item.mediaKind === "video"
            ? "is-video"
            : "is-image";
      kindChip.className = `ml-kind-chip ${kindClass}`;
      kindChip.textContent =
        item.status === "failed"
          ? "FAILED"
          : item.mediaKind === "video"
            ? "VID"
            : "IMG";
      const refTag = item.occurrenceCount > 1 ? ` ×${item.occurrenceCount}` : "";
      const srcLabel = item.sources[0]?.label ?? "";
      sourcesText.append(
        kindChip,
        document.createTextNode(` · ${item.domain}${refTag}${srcLabel ? ` · ${srcLabel}` : ""}`),
      );
      meta.append(urlText, sourcesText);

      const expandHint = document.createElement("span");
      expandHint.className = "ml-expand-hint";
      expandHint.textContent = isExpanded ? "▴" : "▾";
      expandHint.title = isExpanded ? "Hide URL details" : "Inspect preview & sources";

      const singleBtn = createIconButton({
        icon: item.status === "failed" ? "refresh" : "download",
        title: item.status === "failed" ? "Retry this URL" : "Localize this URL",
        className: "ml-btn ml-icon-btn is-xs",
        size: 11,
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          singleBtn.disabled = true;
          void this.runAction(() =>
            this.callbacks.onStartDownload({
              characterIds: [scan.characterId],
              explicitUrls: [item.normalizedUrl],
              includeFailed: true,
              maxItems: 1,
            }),
          );
        },
      });

      row.append(meta, expandHint, singleBtn);
      row.addEventListener("click", () => {
        if (this.expandedUrls.has(item.normalizedUrl)) {
          this.expandedUrls.delete(item.normalizedUrl);
        } else {
          this.expandedUrls.add(item.normalizedUrl);
        }
        this.emitUiStateChange();
        this.render();
      });

      card.appendChild(row);
      if (isExpanded) {
        card.appendChild(this.renderUrlItemDetails(scan, item));
      }
      urlList.appendChild(card);
    }

    urlBox.appendChild(urlList);
    return urlBox;
  }

  private renderUrlItemDetails(
    scan: CharacterMediaScanResult,
    item: DiscoveredMediaItem,
  ): HTMLElement {
    const details = document.createElement("div");
    details.className = "ml-item-details";

    const top = document.createElement("div");
    top.className = "ml-detail-top";

    const previewBox = document.createElement("div");
    previewBox.className = "ml-detail-preview-box";
    const previewCaption = document.createElement("div");
    previewCaption.className = "ml-detail-preview-caption";
    const safeUrl = sanitizeSafeMediaUrl(item.normalizedUrl);

    if (!safeUrl) {
      previewCaption.textContent = "Blocked unsafe media URL";
      previewBox.appendChild(previewCaption);
    } else if (item.mediaKind === "video") {
      const vid = document.createElement("video");
      vid.className = "ml-detail-preview-media";
      vid.controls = true;
      vid.preload = "metadata";
      vid.src = safeUrl;
      previewCaption.textContent = "Video preview";
      vid.addEventListener("loadedmetadata", () => {
        if (vid.videoWidth && vid.videoHeight) {
          previewCaption.textContent = `${vid.videoWidth} × ${vid.videoHeight}`;
        }
      });
      vid.addEventListener("error", () => {
        previewCaption.textContent = "Preview failed";
      });
      previewBox.append(vid, previewCaption);
    } else {
      const img = document.createElement("img");
      img.className = "ml-detail-preview-media";
      img.src = safeUrl;
      img.alt = "Remote preview";
      previewCaption.textContent = "Loading preview...";
      img.addEventListener("load", () => {
        previewCaption.textContent =
          img.naturalWidth && img.naturalHeight
            ? `${img.naturalWidth} × ${img.naturalHeight} px`
            : "Image loaded";
      });
      img.addEventListener("error", () => {
        previewCaption.textContent = "Preview unavailable";
      });
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        safeOpenExternalUrl(safeUrl);
      });
      previewBox.append(img, previewCaption);
    }

    const infoCol = document.createElement("div");
    infoCol.className = "ml-detail-info-col";

    const urlBox = document.createElement("div");
    urlBox.className = "ml-detail-url-box";
    urlBox.textContent = item.normalizedUrl;

    const actionsRow = document.createElement("div");
    actionsRow.className = "ml-detail-kv-row";

    const copyBtn = createIconButton({
      icon: "copy",
      label: "Copy",
      title: "Copy URL",
      className: "ml-btn is-xs",
      size: 11,
      onClick: (e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText?.(item.normalizedUrl);
        const span = copyBtn.querySelector("span");
        if (span) span.textContent = "Copied";
      },
    });

    const openBtn = createIconButton({
      icon: "external-link",
      label: "Open",
      title: safeUrl ? "Open original URL in new tab" : "Blocked unsafe media URL",
      className: "ml-btn is-xs",
      size: 11,
      disabled: !safeUrl,
      onClick: (e) => {
        e.stopPropagation();
        safeOpenExternalUrl(item.normalizedUrl);
      },
    });

    const dlBtn = createIconButton({
      icon: "download",
      label: item.status === "failed" ? "Retry" : "Localize",
      title: "Queue this single media item",
      className: "ml-btn is-primary is-xs",
      size: 11,
      onClick: (e) => {
        e.stopPropagation();
        void this.runAction(() =>
          this.callbacks.onStartDownload({
            characterIds: [scan.characterId],
            explicitUrls: [item.normalizedUrl],
            includeFailed: true,
            maxItems: 1,
          }),
        );
      },
    });

    actionsRow.append(copyBtn, openBtn, dlBtn);
    infoCol.append(urlBox, actionsRow);

    const sourcesList = document.createElement("div");
    sourcesList.className = "ml-detail-source-list";
    for (const src of item.sources) {
      const chip = document.createElement("span");
      chip.className = "ml-detail-source-chip";
      chip.textContent = src.label;
      sourcesList.appendChild(chip);
    }
    infoCol.appendChild(sourcesList);

    if (item.failureInfo) {
      const errBox = document.createElement("div");
      errBox.className = "ml-detail-error-box";
      errBox.textContent = item.failureInfo.error;
      infoCol.appendChild(errBox);
    }

    top.append(previewBox, infoCol);
    details.appendChild(top);
    return details;
  }

  private renderCombinedOptionsAndMediaSection(
    scan: CharacterMediaScanResult,
    candidateItems: DiscoveredMediaItem[],
    selectedPending: DiscoveredMediaItem[],
    effectivePendingCount: number,
  ): HTMLElement {
    const section = document.createElement("div");
    section.className = "ml-section ml-combined-drawer";

    const expressions = scan.media?.expressions ?? [];
    const exprImageIds = new Set(expressions.map((e) => e.imageId));
    const localizedItems = scan.items.filter(
      (item): item is DiscoveredMediaItem & { localizedEntry: NonNullable<DiscoveredMediaItem["localizedEntry"]> } =>
        item.status === "localized" &&
        Boolean(item.localizedEntry) &&
        !exprImageIds.has(item.localizedEntry!.imageId),
    );
    const hasAvatar = Boolean(scan.media?.avatarUrl);

    // Unified compact trigger strip for both Downloaded Media and Per-Card Options
    const bar = document.createElement("div");
    bar.className = "ml-combined-bar";

    const mediaBtn = document.createElement("button");
    mediaBtn.type = "button";
    mediaBtn.className = `ml-combined-trigger ${this.showDownloadedMedia ? "is-active" : ""}`.trim();
    const mediaTitle = this.showDownloadedMedia
      ? "Collapse Downloaded Media"
      : "Expand Downloaded Media";
    mediaBtn.title = mediaTitle;
    mediaBtn.setAttribute("aria-label", mediaTitle);
    mediaBtn.setAttribute("aria-expanded", String(this.showDownloadedMedia));
    mediaBtn.appendChild(createIcon("image", 13));
    const mediaLabel = document.createElement("span");
    mediaLabel.textContent = `Downloaded Media (${localizedItems.length}${expressions.length > 0 ? ` + ${expressions.length} expr` : ""})`;
    mediaBtn.append(
      mediaLabel,
      createIcon(this.showDownloadedMedia ? "chevron-down" : "chevron-right", 12),
    );
    mediaBtn.addEventListener("click", () => {
      this.showDownloadedMedia = !this.showDownloadedMedia;
      this.emitUiStateChange();
      this.render();
    });

    const mediaTip = createInfoTip(
      "Click any tile to open the lightbox. Character Avatar and native Expressions are read-only; localized assets can be removed individually or in bulk.",
    );

    const optionsBtn = document.createElement("button");
    optionsBtn.type = "button";
    optionsBtn.className = `ml-combined-trigger ${this.showDownloadConfig ? "is-active" : ""}`.trim();
    const optionsTitle = this.showDownloadConfig
      ? "Hide download options & URL inspector"
      : "Customize per-card download options & inspect individual URLs";
    optionsBtn.title = optionsTitle;
    optionsBtn.setAttribute("aria-label", optionsTitle);
    optionsBtn.setAttribute("aria-expanded", String(this.showDownloadConfig));
    optionsBtn.appendChild(createIcon("sliders", 13));
    const optionsLabel = document.createElement("span");
    optionsLabel.textContent = "Options";
    optionsBtn.appendChild(optionsLabel);
    if (this.hasCustomOverride) {
      const customBadge = document.createElement("span");
      customBadge.className = "ml-badge is-info";
      customBadge.textContent = "Custom";
      optionsBtn.appendChild(customBadge);
    }
    optionsBtn.appendChild(
      createIcon(this.showDownloadConfig ? "chevron-down" : "chevron-right", 12),
    );
    optionsBtn.addEventListener("click", () => {
      this.showDownloadConfig = !this.showDownloadConfig;
      this.emitUiStateChange();
      this.render();
    });

    bar.append(mediaBtn, mediaTip, optionsBtn);
    section.appendChild(bar);

    if (this.showDownloadConfig) {
      section.appendChild(
        this.renderOptionsSection(scan, candidateItems, selectedPending, effectivePendingCount),
      );
    }

    if (!this.showDownloadedMedia) {
      this.mediaTileCache.clear();
      return section;
    }

    // Build unified tiles list: Avatar first -> Localized Media -> Native Expressions (read-only)
    type CharacterTile = {
      cacheKey: string;
      lightbox: LightboxItem;
      badge: string;
      badgeVariant?: string;
      caption: string;
      subcaption: string;
      isExpression: boolean;
      mediaKind: MediaKind;
      urlToRemove?: string;
    };

    const allTiles: CharacterTile[] = [];

    const onEditCharacter = this.callbacks.onOpenCharacterEditor
      ? () => this.callbacks.onOpenCharacterEditor!(scan.characterId)
      : undefined;

    if (hasAvatar && scan.media?.avatarUrl) {
      allTiles.push({
        cacheKey: `avatar:${scan.characterId}`,
        lightbox: {
          id: `avatar:${scan.characterId}`,
          localUrl: scan.media.avatarUrl,
          mediaKind: "image",
          title: `${scan.characterName} — Avatar`,
          subtitle: "Character card avatar",
          readOnly: true,
          badgeText: "Avatar",
          onEditCharacter,
        },
        badge: "Avatar",
        badgeVariant: "is-info",
        caption: "Character Avatar",
        subcaption: scan.characterName,
        isExpression: false,
        mediaKind: "image",
      });
    }

    for (const item of localizedItems) {
      const entry = item.localizedEntry;
      allTiles.push({
        cacheKey: `loc:${entry.imageId}:${item.normalizedUrl}`,
        lightbox: {
          id: entry.imageId,
          localUrl: entry.localUrl,
          mediaKind: item.mediaKind,
          title: entry.filename,
          subtitle: `${formatBytes(entry.sizeBytes)} · ${item.sources.map((s) => s.label).join(", ")}`,
          originalUrl: item.normalizedUrl,
          readOnly: false,
          badgeText: item.mediaKind === "video" ? "Video" : "Localized",
          onEditCharacter,
          onRemove: async () => {
            await this.callbacks.onPurgeCharacterCache(scan.characterId, [item.normalizedUrl]);
          },
        },
        badge: item.mediaKind === "video" ? "Vid" : "Local",
        caption: entry.filename,
        subcaption: `${formatBytes(entry.sizeBytes)} · ${item.sources[0]?.label ?? item.domain}`,
        isExpression: false,
        mediaKind: item.mediaKind,
        urlToRemove: item.normalizedUrl,
      });
    }

    for (const expr of expressions) {
      allTiles.push({
        cacheKey: `expr:${expr.imageId}:${expr.label}`,
        lightbox: {
          id: `expr:${expr.imageId}:${expr.label}`,
          localUrl: expr.localUrl,
          mediaKind: "image",
          title: expr.label,
          subtitle: expr.groupName
            ? `Native expression (${expr.groupName}) · read-only`
            : "Native expression · read-only",
          readOnly: true,
          badgeText: "Expression",
          onEditCharacter,
        },
        badge: "Expr",
        badgeVariant: "is-info",
        caption: expr.label,
        subcaption: expr.groupName ? `Group: ${expr.groupName}` : "Native Expression",
        isExpression: true,
        mediaKind: "image",
      });
    }

    const filteredTiles = allTiles.filter((t) => {
      if (this.mediaFilter === "localized") return !t.isExpression && !t.badge.includes("Avatar");
      if (this.mediaFilter === "expressions") return t.isExpression;
      if (this.mediaFilter === "video") return t.mediaKind === "video";
      return true;
    });

    const mediaPane = document.createElement("div");
    mediaPane.className = "ml-combined-pane ml-media-pane";

    const mediaToolbar = document.createElement("div");
    mediaToolbar.className = "ml-header-bar ml-media-toolbar";

    const filterSelect = document.createElement("select");
    filterSelect.className = "ml-select is-sm";
    filterSelect.title = "Filter shown media tiles";
    const filterChoices: Array<{ val: MediaGridFilter; label: string }> = [
      { val: "all", label: `All (${allTiles.length})` },
      { val: "localized", label: `Local (${localizedItems.length})` },
      { val: "expressions", label: `Expr (${expressions.length})` },
      { val: "video", label: "Videos" },
    ];
    for (const c of filterChoices) {
      const opt = document.createElement("option");
      opt.value = c.val;
      opt.textContent = c.label;
      if (c.val === this.mediaFilter) opt.selected = true;
      filterSelect.appendChild(opt);
    }
    filterSelect.value = this.mediaFilter;
    filterSelect.addEventListener("change", () => {
      this.mediaFilter = filterSelect.value as MediaGridFilter;
      this.emitUiStateChange();
      this.render();
    });

    const toolbar = document.createElement("div");
    toolbar.className = "ml-header-actions";

    const seg = document.createElement("div");
    seg.className = "ml-segmented";
    seg.appendChild(
      createIconButton({
        icon: "grid",
        title: "Grid view",
        className: `ml-btn ml-icon-btn is-sm ${this.mediaViewMode === "grid" ? "is-active" : ""}`,
        size: 13,
        onClick: () => {
          this.mediaViewMode = "grid";
          this.emitUiStateChange();
          this.render();
        },
      }),
    );
    seg.appendChild(
      createIconButton({
        icon: "list",
        title: "List view",
        className: `ml-btn ml-icon-btn is-sm ${this.mediaViewMode === "list" ? "is-active" : ""}`,
        size: 13,
        onClick: () => {
          this.mediaViewMode = "list";
          this.emitUiStateChange();
          this.render();
        },
      }),
    );
    toolbar.appendChild(seg);
    toolbar.appendChild(
      createThumbnailSizeSegmented(this.thumbnailSize, (nextSize) => {
        if (nextSize === this.thumbnailSize) return;
        this.thumbnailSize = nextSize;
        this.emitUiStateChange();
        this.render();
      }),
    );

    if (localizedItems.length > 0) {
      toolbar.appendChild(
        createIconButton({
          icon: "trash",
          title: `Remove all ${localizedItems.length} localized assets for this character`,
          className: "ml-btn ml-icon-btn is-danger is-sm",
          size: 13,
          onClick: async () => {
            const targetCharId = scan.characterId;
            const msg = this.settings.deleteImagesOnPurge
              ? `Remove all ${localizedItems.length} localized media assets for "${scan.characterName}" from the Gallery & local cache? Original card URLs and native expressions remain untouched.`
              : `Remove all ${localizedItems.length} localized index entries for "${scan.characterName}"? Stored Gallery images will be kept.`;
            const res = await this.ctx.ui.showConfirm({
              title: "Remove Localized Media",
              message: msg,
              confirmLabel: "Remove All",
              cancelLabel: "Cancel",
              variant: "danger",
            });
            if (this.destroyed || this.characterId !== targetCharId || !res?.confirmed) {
              return;
            }
            await this.runAction(async () => {
              await this.callbacks.onPurgeCharacterCache(targetCharId);
              if (this.destroyed || this.characterId !== targetCharId) return;
              await this.refreshScan(false);
            });
          },
        }),
      );
    }

    mediaToolbar.append(filterSelect, toolbar);
    mediaPane.appendChild(mediaToolbar);

    if (filteredTiles.length === 0) {
      this.mediaTileCache.clear();
      const empty = document.createElement("div");
      empty.className = "ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon(allTiles.length === 0 ? "image" : "filter", 18));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent =
        allTiles.length === 0
          ? "No downloaded media or expressions yet."
          : "No items match this filter.";
      empty.append(iconWrap, textEl);
      mediaPane.appendChild(empty);
      section.appendChild(mediaPane);
      return section;
    }

    const lightboxItems = filteredTiles.map((t) => t.lightbox);
    const seenKeys = new Map<string, number>();
    const usedKeys = new Set<string>();

    const nextTileCacheKey = (tile: CharacterTile): string => {
      const base = `${this.mediaViewMode}:${tile.cacheKey}`;
      const occ = seenKeys.get(base) ?? 0;
      seenKeys.set(base, occ + 1);
      return occ === 0 ? base : `${base}#${occ}`;
    };

    const thumbTier = getThumbnailImageTier(this.thumbnailSize);
    const computeTileSig = (tile: CharacterTile): string => {
      const thumbSrc =
        toThumbnailMediaUrl(
          sanitizeSafeMediaUrl(tile.lightbox.localUrl),
          tile.mediaKind,
          thumbTier,
        ) ?? tile.lightbox.localUrl;
      return [
        scan.characterId,
        thumbSrc,
        tile.mediaKind,
        tile.caption,
        tile.subcaption,
        tile.badge,
        tile.badgeVariant ?? "",
        tile.isExpression ? "1" : "0",
        tile.urlToRemove ?? "",
      ].join("\u0001");
    };

    if (this.mediaViewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      list.dataset.scrollId = "localized-asset-grid";

      filteredTiles.forEach((tile, index) => {
        const key = nextTileCacheKey(tile);
        const sig = computeTileSig(tile);
        usedKeys.add(key);
        const cached = this.mediaTileCache.get(key);

        let row: HTMLElement;
        if (cached && cached.sig === sig) {
          row = cached.el;
          reobserveLazyMedia(row);
          const rmBtn = row.querySelector<HTMLButtonElement>("button.is-danger");
          if (rmBtn) rmBtn.disabled = false;
        } else {
          row = document.createElement("div");
          row.className = "ml-media-list-row";
          row.addEventListener("click", () => this.tileClickHandlers.get(row)?.());

          const thumbWrap = document.createElement("div");
          thumbWrap.className = "ml-media-list-thumb-wrap";
          const thumb = createLazyMediaElement({
            src: tile.lightbox.localUrl,
            mediaKind: tile.mediaKind,
            alt: tile.caption,
            className: "ml-media-list-thumb",
            thumbTier,
          });
          thumbWrap.appendChild(thumb);
          if (tile.mediaKind === "video") {
            const kindIndicator = document.createElement("span");
            kindIndicator.className = "ml-media-list-kind-badge";
            kindIndicator.setAttribute("aria-hidden", "true");
            kindIndicator.appendChild(createIcon("play", 9));
            thumbWrap.appendChild(kindIndicator);
          }

          const info = document.createElement("div");
          info.className = "ml-url-meta";
          const cap = document.createElement("div");
          cap.className = "ml-url-text";
          cap.textContent = tile.caption;
          const sub = document.createElement("div");
          sub.className = "ml-url-sources";
          sub.textContent = tile.subcaption;
          info.append(cap, sub);

          const badgeVariant =
            tile.badgeVariant ?? (tile.mediaKind === "video" ? "is-info" : "is-success");
          const badge = document.createElement("span");
          badge.className = `ml-badge ${badgeVariant}`.trim();
          badge.textContent = tile.badge;

          row.append(thumbWrap, info, badge);

          if (tile.urlToRemove) {
            const urlToRemove = tile.urlToRemove;
            const rmBtn = createIconButton({
              icon: "trash",
              title: "Remove localized asset",
              className: "ml-btn ml-icon-btn is-danger is-sm",
              size: 12,
              onClick: async (ev) => {
                ev.stopPropagation();
                rmBtn.disabled = true;
                try {
                  await this.runAction(async () => {
                    await this.callbacks.onPurgeCharacterCache(scan.characterId, [
                      urlToRemove,
                    ]);
                    await this.refreshScan(false);
                  });
                } finally {
                  if (!this.destroyed) {
                    rmBtn.disabled = false;
                  }
                }
              },
            });
            row.appendChild(rmBtn);
          }

          this.mediaTileCache.set(key, { sig, el: row });
        }

        this.tileClickHandlers.set(row, () =>
          openMediaLightbox(lightboxItems, index, () => void this.refreshScan(false)),
        );
        list.appendChild(row);
      });

      for (const key of this.mediaTileCache.keys()) {
        if (!usedKeys.has(key)) this.mediaTileCache.delete(key);
      }

      mediaPane.appendChild(list);
      section.appendChild(mediaPane);
      return section;
    }

    const grid = document.createElement("div");
    grid.className = "ml-asset-grid";
    grid.dataset.scrollId = "localized-asset-grid";

    filteredTiles.forEach((tile, index) => {
      const key = nextTileCacheKey(tile);
      const sig = computeTileSig(tile);
      usedKeys.add(key);
      const cached = this.mediaTileCache.get(key);

      let card: HTMLElement;
      if (cached && cached.sig === sig) {
        card = cached.el;
        reobserveLazyMedia(card);
        const rmBtn = card.querySelector<HTMLButtonElement>("button.is-danger");
        if (rmBtn) rmBtn.disabled = false;
      } else {
        card = document.createElement("div");
        card.className = "ml-asset-card";

        const mediaWrap = document.createElement("div");
        mediaWrap.className = "ml-asset-thumb-wrap";
        const thumb = createLazyMediaElement({
          src: tile.lightbox.localUrl,
          mediaKind: tile.mediaKind,
          alt: tile.caption,
          className: "ml-asset-preview",
          title: `${tile.caption} — Click to preview`,
          thumbTier,
        });
        mediaWrap.addEventListener("click", () => this.tileClickHandlers.get(card)?.());

        const tileBadgeVariant =
          tile.badge === "Avatar"
            ? "is-avatar"
            : tile.isExpression
              ? "is-expression"
              : tile.mediaKind === "video"
                ? "is-video"
                : "is-local";
        const cornerBadge = document.createElement("span");
        cornerBadge.className = `ml-tile-badge ${tileBadgeVariant}`;
        cornerBadge.textContent = tile.badge;
        mediaWrap.append(thumb, cornerBadge);

        const footer = document.createElement("div");
        footer.className = "ml-asset-footer";

        const capRow = document.createElement("div");
        capRow.className = "ml-asset-cap-row";
        const metaLine = document.createElement("div");
        metaLine.className = "ml-url-sources";
        metaLine.textContent = tile.isExpression ? tile.caption : tile.subcaption;
        metaLine.title = `${tile.caption}\n${tile.subcaption}`;
        capRow.appendChild(metaLine);

        if (tile.urlToRemove) {
          const urlToRemove = tile.urlToRemove;
          const rmBtn = createIconButton({
            icon: "trash",
            title: "Remove from cache & Character Gallery",
            className: "ml-btn ml-icon-btn is-danger is-xs",
            size: 11,
            onClick: async (ev) => {
              ev.stopPropagation();
              rmBtn.disabled = true;
              try {
                await this.runAction(async () => {
                  await this.callbacks.onPurgeCharacterCache(scan.characterId, [
                    urlToRemove,
                  ]);
                  await this.refreshScan(false);
                });
              } finally {
                if (!this.destroyed) {
                  rmBtn.disabled = false;
                }
              }
            },
          });
          capRow.appendChild(rmBtn);
        }

        footer.appendChild(capRow);
        card.append(mediaWrap, footer);
        this.mediaTileCache.set(key, { sig, el: card });
      }

      this.tileClickHandlers.set(card, () =>
        openMediaLightbox(lightboxItems, index, () => void this.refreshScan(false)),
      );
      grid.appendChild(card);
    });

    for (const key of this.mediaTileCache.keys()) {
      if (!usedKeys.has(key)) this.mediaTileCache.delete(key);
    }

    mediaPane.appendChild(grid);
    section.appendChild(mediaPane);
    return section;
  }
}
