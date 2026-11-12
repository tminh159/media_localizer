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
  isQueueActiveStatus,
  openMediaLightbox,
  renderFailedItemsPanel,
  renderQueueBanner,
  renderSharedDownloadConfigControls,
  safeOpenExternalUrl,
  sanitizeSafeMediaUrl,
  type LightboxItem,
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
}

type MediaGridFilter = "all" | "localized" | "expressions" | "video";

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
    } = {},
  ) {
    this.characterId = characterId;
    this.batchCap = settings.defaultBatchCap;
    this.showDownloadConfig = Boolean(options.defaultExpandConfig);
  }

  destroy(): void {
    this.destroyed = true;
    this.scanGeneration++;
    if (this.overrideSaveTimer !== null) {
      clearTimeout(this.overrideSaveTimer);
      this.overrideSaveTimer = null;
    }
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
    this.characterId = nextId;
    this.scan = null;
    this.error = null;
    this.filtersInitializedForChar = null;
    void this.refreshScan(false);
  }

  updateExternalState(
    settings: MediaLocalizerSettings,
    queueProgress: QueueJobProgress,
  ): void {
    if (this.destroyed) return;
    const prevStatus = this.queueProgress.status;
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(this.settings);
    this.settings = settings;
    this.queueProgress = queueProgress;

    if (settingsChanged && this.scan && !this.hasCustomOverride) {
      this.filtersInitializedForChar = null;
      this.initFiltersFromScan(this.scan);
    }

    const wasActive = isQueueActiveStatus(prevStatus);
    const nowActive = isQueueActiveStatus(queueProgress.status);

    if (wasActive && !nowActive) {
      void this.refreshScan(false);
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
    }
    try {
      const result = await this.callbacks.onScanCharacter(targetId, forceRefresh);
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      this.scan = result;
      this.initFiltersFromScan(result, forceRefresh);
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

  private initFiltersFromScan(scan: CharacterMediaScanResult, preserveEdits = false): void {
    if (!preserveEdits && this.filtersInitializedForChar === scan.characterId) {
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
    }

    if (this.overrideSaveTimer) clearTimeout(this.overrideSaveTimer);
    this.overrideSaveTimer = setTimeout(() => {
      this.overrideSaveTimer = null;
      if (this.destroyed) return;
      void this.callbacks
        .onSaveCharacterOverride(targetCharId, nextOverride)
        .catch((err) => console.warn("[media_localizer] Failed saving character override:", err));
    }, 150);
  }

  private async resetToGlobalDefaults(): Promise<void> {
    if (!this.scan) return;
    if (this.overrideSaveTimer) {
      clearTimeout(this.overrideSaveTimer);
      this.overrideSaveTimer = null;
    }
    this.scan.override = null;
    this.hasCustomOverride = false;
    this.filtersInitializedForChar = null;
    this.initFiltersFromScan(this.scan);
    await this.callbacks.onSaveCharacterOverride(this.scan.characterId, null);
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
    const scan = this.scan;
    if (!scan) return;
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
      if (!res?.confirmed) return;
    }

    await this.runAction(() =>
      this.callbacks.onStartDownload({
        characterIds: [scan.characterId],
        ...filter,
      }),
    );
  }

  render(): void {
    if (this.destroyed) return;
    const scrollState = this.captureScrollState();
    this.root.innerHTML = "";
    this.queueBannerEl = null;

    const wrap = document.createElement("div");
    wrap.className = "ml-widget";

    if (!this.characterId) {
      const empty = document.createElement("div");
      empty.className = "ml-section ml-empty";
      empty.textContent = "Open a character chat or editor to manage its media.";
      wrap.appendChild(empty);
      this.root.appendChild(wrap);
      return;
    }

    if (this.error) {
      const err = document.createElement("div");
      err.className = "ml-error-banner";
      err.textContent = this.error;
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
      loadingEl.className = "ml-section ml-empty";
      loadingEl.textContent = "Scanning character media...";
      wrap.appendChild(loadingEl);
      this.root.appendChild(wrap);
      return;
    }

    if (!this.scan) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ml-btn is-primary";
      retry.textContent = "Scan Character Media";
      retry.addEventListener("click", () => void this.refreshScan(true));
      wrap.appendChild(retry);
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

    // 1. Header Card
    wrap.appendChild(this.renderHeaderSection(scan, effectivePendingCount, selectedPending.length));

    // 2. Collapsible Per-Card Download Options (expanded only when user clicks gear)
    if (this.showDownloadConfig) {
      wrap.appendChild(
        this.renderOptionsSection(scan, candidateItems, selectedPending, effectivePendingCount),
      );
    }

    // 3. Grouped Failed Items Panel (actionable Recovery UI)
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
          await this.callbacks.onClearFailedUrls(urls);
          await this.refreshScan(false);
        });
      },
    });
    if (failedPanel) {
      wrap.appendChild(failedPanel);
    }

    // 4. Always-visible Downloaded Media & Expressions Section
    wrap.appendChild(this.renderMediaGallerySection(scan));

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

    const safeAvatarUrl = sanitizeSafeMediaUrl(scan.media?.avatarUrl);
    if (safeAvatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "ml-char-avatar";
      avatar.src = safeAvatarUrl;
      avatar.alt = scan.characterName;
      identityRow.appendChild(avatar);
    }

    const titleCol = document.createElement("div");
    titleCol.className = "ml-char-meta";

    const titleLine = document.createElement("div");
    titleLine.className = "ml-header-bar";

    const titleGroup = document.createElement("div");
    titleGroup.className = "ml-inline-title";
    const nameEl = document.createElement("span");
    nameEl.className = "ml-title";
    nameEl.textContent = scan.characterName;
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
      className: `ml-btn ${effectivePendingCount > 0 ? "is-primary" : ""}`,
      size: 14,
      disabled: effectivePendingCount === 0,
      onClick: () => void this.triggerOneClickLocalize(),
    });

    const gearBtn = createIconButton({
      icon: "settings",
      title: this.showDownloadConfig
        ? "Hide download options & URL inspector"
        : "Customize per-card download options & inspect individual URLs",
      className: `ml-btn ml-icon-btn ${this.showDownloadConfig ? "is-active" : ""}`,
      size: 14,
      onClick: () => {
        this.showDownloadConfig = !this.showDownloadConfig;
        this.render();
      },
    });

    const refreshBtn = createIconButton({
      icon: "refresh",
      title: "Rescan character fields, linked World Books, and Regex scripts",
      className: `ml-btn ml-icon-btn ${this.loading ? "is-busy" : ""}`,
      size: 14,
      disabled: this.loading,
      onClick: () => void this.refreshScan(true),
    });

    actions.append(localizeBtn, gearBtn, refreshBtn);
    titleLine.append(titleGroup, actions);

    const statusLine = document.createElement("div");
    statusLine.className = "ml-status-row";

    const addBadge = (text: string, variant = "") => {
      const b = document.createElement("span");
      b.className = `ml-badge ${variant}`.trim();
      b.textContent = text;
      statusLine.appendChild(b);
    };

    addBadge(
      `${localizedItems.length} localized${totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}`,
      localizedItems.length > 0 ? "is-success" : "",
    );
    addBadge(`${remoteCount} remote`, remoteCount > 0 ? "is-warn" : "");
    if (failedCount > 0) addBadge(`${failedCount} failed`, "is-danger");
    if (exprCount > 0) addBadge(`${exprCount} expressions`, "is-info");

    titleCol.append(titleLine, statusLine);
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
    container.className = "ml-section ml-options-panel";

    const top = document.createElement("div");
    top.className = "ml-section-title";

    const titleGroup = document.createElement("div");
    titleGroup.className = "ml-inline-title";
    const heading = document.createElement("span");
    heading.textContent = "Per-Card Download Options";
    const statusPill = document.createElement("span");
    statusPill.className = `ml-badge ${this.hasCustomOverride ? "is-info" : ""}`;
    statusPill.textContent = this.hasCustomOverride ? "Custom" : "Using global defaults";
    titleGroup.append(
      heading,
      statusPill,
      createInfoTip(
        "Customize which sections, greetings, World Books, domains, or specific URLs are included when clicking Localize for this character.",
      ),
    );

    const resetBtn = createIconButton({
      icon: "rotate-ccw",
      label: "Reset to global",
      title: "Clear per-card customizations and use Settings global defaults",
      className: "ml-btn is-sm",
      size: 12,
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
        onChange: () => {
          this.scheduleSaveOverride();
          this.render();
        },
      }),
    );

    // Greeting Sub-Selector
    if (
      this.selectedSections.has("alternate_greetings") &&
      scan.greetingBreakdown.length > 1
    ) {
      const subBar = document.createElement("div");
      subBar.className = "ml-header-bar";
      const subBtn = document.createElement("button");
      subBtn.type = "button";
      subBtn.className = "ml-btn is-sm";
      subBtn.textContent = this.showGreetingSubfilter
        ? "Hide Greeting Picker"
        : `Filter Greetings (${scan.greetingBreakdown.length})...`;
      subBtn.addEventListener("click", () => {
        this.showGreetingSubfilter = !this.showGreetingSubfilter;
        this.render();
      });
      subBar.appendChild(subBtn);
      container.appendChild(subBar);

      if (this.showGreetingSubfilter) {
        const subBox = document.createElement("div");
        subBox.className = "ml-subfilter-box";
        const subList = document.createElement("div");
        subList.className = "ml-subfilter-list";
        subList.dataset.scrollId = "greetings-subfilter";
        for (const g of scan.greetingBreakdown) {
          const gLabel = document.createElement("label");
          gLabel.className = "ml-checkbox-item";
          const gCb = document.createElement("input");
          gCb.type = "checkbox";
          gCb.checked =
            this.selectedGreetings === null ||
            this.selectedGreetings.has(g.greetingIndex);
          gCb.addEventListener("change", () => {
            if (this.selectedGreetings === null) {
              this.selectedGreetings = new Set(
                scan.greetingBreakdown.map((item) => item.greetingIndex),
              );
            }
            if (gCb.checked) this.selectedGreetings.add(g.greetingIndex);
            else this.selectedGreetings.delete(g.greetingIndex);
            if (this.selectedGreetings.size === scan.greetingBreakdown.length) {
              this.selectedGreetings = null;
            }
            this.scheduleSaveOverride();
            this.render();
          });
          const gFailed =
            (g as typeof g & { failedCount?: number }).failedCount ?? 0;
          const gSummary =
            gFailed > 0
              ? `${g.remoteCount} remote, ${gFailed} failed`
              : `${g.remoteCount} remote`;
          gLabel.append(gCb, document.createTextNode(`${g.label} (${gSummary})`));
          subList.appendChild(gLabel);
        }
        subBox.appendChild(subList);
        container.appendChild(subBox);
      }
    }

    // World Book Sub-Selector
    if (this.selectedSections.has("world_books") && scan.worldBookBreakdown.length > 1) {
      const wbRow = document.createElement("div");
      wbRow.className = "ml-header-bar";
      const wbBtn = document.createElement("button");
      wbBtn.type = "button";
      wbBtn.className = "ml-btn is-sm";
      wbBtn.textContent = this.showWorldBookSubfilter
        ? "Hide World Book Picker"
        : `Filter World Books (${scan.worldBookBreakdown.length})...`;
      wbBtn.addEventListener("click", () => {
        this.showWorldBookSubfilter = !this.showWorldBookSubfilter;
        this.render();
      });
      wbRow.appendChild(wbBtn);
      container.appendChild(wbRow);

      if (this.showWorldBookSubfilter) {
        const wbBox = document.createElement("div");
        wbBox.className = "ml-subfilter-box";
        wbBox.dataset.scrollId = "worldbooks-subfilter";
        for (const wb of scan.worldBookBreakdown) {
          const wbLabel = document.createElement("label");
          wbLabel.className = "ml-checkbox-item";
          const wbCb = document.createElement("input");
          wbCb.type = "checkbox";
          wbCb.checked =
            this.selectedWorldBooks === null ||
            this.selectedWorldBooks.has(wb.worldBookId);
          wbCb.addEventListener("change", () => {
            if (this.selectedWorldBooks === null) {
              this.selectedWorldBooks = new Set(
                scan.worldBookBreakdown.map((item) => item.worldBookId),
              );
            }
            if (wbCb.checked) this.selectedWorldBooks.add(wb.worldBookId);
            else this.selectedWorldBooks.delete(wb.worldBookId);
            if (this.selectedWorldBooks.size === scan.worldBookBreakdown.length) {
              this.selectedWorldBooks = null;
            }
            this.scheduleSaveOverride();
            this.render();
          });
          const wbFailed =
            (wb as typeof wb & { failedCount?: number }).failedCount ?? 0;
          const wbSummary =
            wbFailed > 0
              ? `${wb.remoteCount} remote, ${wbFailed} failed`
              : `${wb.remoteCount} remote`;
          wbLabel.append(
            wbCb,
            document.createTextNode(`${wb.worldBookName} (${wbSummary})`),
          );
          wbBox.appendChild(wbLabel);
        }
        container.appendChild(wbBox);
      }
    }

    // Domain pills
    const remoteDomains = scan.domainBreakdown.filter((d) => {
      const failed = (d as typeof d & { failedCount?: number }).failedCount ?? 0;
      return d.remoteCount + failed > 0;
    });
    if (remoteDomains.length > 1) {
      const domLabel = document.createElement("div");
      domLabel.className = "ml-config-label";
      domLabel.textContent = "Host Domains";
      container.appendChild(domLabel);

      const pillRow = document.createElement("div");
      pillRow.className = "ml-pill-row";
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
            this.selectedDomains.delete(dom.domain);
          } else {
            this.selectedDomains.add(dom.domain);
          }
          if (this.selectedDomains.size === remoteDomains.length) {
            this.selectedDomains = null;
          }
          this.scheduleSaveOverride();
          this.render();
        });
        pillRow.appendChild(pill);
      }
      container.appendChild(pillRow);
    }

    // Expandable Individual URL Inspector & Picker
    const pickerBar = document.createElement("div");
    pickerBar.className = "ml-header-bar";
    const togglePickerBtn = document.createElement("button");
    togglePickerBtn.type = "button";
    togglePickerBtn.className = "ml-btn is-sm";
    togglePickerBtn.textContent = this.showUrlPicker
      ? `Hide URL List (${selectedPending.length}/${candidateItems.length})`
      : `Inspect & Pick URLs (${selectedPending.length}/${candidateItems.length})...`;
    togglePickerBtn.addEventListener("click", () => {
      this.showUrlPicker = !this.showUrlPicker;
      this.render();
    });
    pickerBar.appendChild(togglePickerBtn);

    if (this.showUrlPicker && candidateItems.length > 0) {
      const thumbToggle = document.createElement("label");
      thumbToggle.className = "ml-toggle-label";
      const thumbCb = document.createElement("input");
      thumbCb.type = "checkbox";
      thumbCb.checked = this.showRemoteThumbnails;
      thumbCb.addEventListener("change", () => {
        this.showRemoteThumbnails = thumbCb.checked;
        this.render();
      });
      thumbToggle.append(thumbCb, document.createTextNode("Remote Previews"));
      pickerBar.appendChild(thumbToggle);
    }
    container.appendChild(pickerBar);

    if (this.showUrlPicker && candidateItems.length > 0) {
      container.appendChild(this.renderUrlPicker(scan, candidateItems));
    }

    const summaryBar = document.createElement("div");
    summaryBar.className = "ml-download-bar";
    const countNote = document.createElement("span");
    countNote.className = "ml-subtitle";
    countNote.textContent =
      effectivePendingCount < selectedPending.length
        ? `${effectivePendingCount} of ${selectedPending.length} selected files will download (limit ${this.batchCap}).`
        : `${selectedPending.length} matching file(s) ready.`;
    const applyBtn = createIconButton({
      icon: "download",
      label: `Localize (${effectivePendingCount})`,
      title: "Start downloading selected items now",
      className: "ml-btn is-primary is-sm",
      size: 13,
      disabled: effectivePendingCount === 0,
      onClick: () => void this.triggerOneClickLocalize(),
    });
    summaryBar.append(countNote, applyBtn);
    container.appendChild(summaryBar);

    return container;
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
    checkAllBtn.className = "ml-btn is-sm";
    checkAllBtn.textContent = "Check All";
    checkAllBtn.addEventListener("click", () => {
      for (const item of candidateItems) this.excludedUrls.delete(item.normalizedUrl);
      this.scheduleSaveOverride();
      this.render();
    });

    const uncheckAllBtn = document.createElement("button");
    uncheckAllBtn.type = "button";
    uncheckAllBtn.className = "ml-btn is-sm";
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
      collapseAllBtn.className = "ml-btn is-sm";
      collapseAllBtn.textContent = `Collapse (${this.expandedUrls.size})`;
      collapseAllBtn.addEventListener("click", () => {
        this.expandedUrls.clear();
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
      sourcesText.textContent = `${item.mediaKind.toUpperCase()} · ${item.domain} · ${item.occurrenceCount} ref${item.occurrenceCount === 1 ? "" : "s"} · ${item.sources[0]?.label ?? ""}`;
      meta.append(urlText, sourcesText);

      const expandHint = document.createElement("span");
      expandHint.className = "ml-expand-hint";
      expandHint.textContent = isExpanded ? "Hide ▴" : "Info ▾";

      const singleBtn = document.createElement("button");
      singleBtn.type = "button";
      singleBtn.className = "ml-btn is-sm";
      singleBtn.textContent = item.status === "failed" ? "Retry" : "Localize";
      singleBtn.addEventListener("click", (e) => {
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
      });

      row.append(meta, expandHint, singleBtn);
      row.addEventListener("click", () => {
        if (this.expandedUrls.has(item.normalizedUrl)) {
          this.expandedUrls.delete(item.normalizedUrl);
        } else {
          this.expandedUrls.add(item.normalizedUrl);
        }
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
      label: "Copy URL",
      title: "Copy URL",
      className: "ml-btn is-sm",
      size: 12,
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
      className: "ml-btn is-sm",
      size: 12,
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
      className: "ml-btn is-primary is-sm",
      size: 12,
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

  private renderMediaGallerySection(scan: CharacterMediaScanResult): HTMLElement {
    const box = document.createElement("div");
    box.className = "ml-section";

    const expressions = scan.media?.expressions ?? [];
    const exprImageIds = new Set(expressions.map((e) => e.imageId));
    const localizedItems = scan.items.filter(
      (item): item is DiscoveredMediaItem & { localizedEntry: NonNullable<DiscoveredMediaItem["localizedEntry"]> } =>
        item.status === "localized" &&
        Boolean(item.localizedEntry) &&
        !exprImageIds.has(item.localizedEntry!.imageId),
    );
    const hasAvatar = Boolean(scan.media?.avatarUrl);

    // Build unified tiles list: Avatar first -> Localized Media -> Native Expressions (read-only)
    type CharacterTile = {
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

    if (hasAvatar && scan.media?.avatarUrl) {
      allTiles.push({
        lightbox: {
          id: `avatar:${scan.characterId}`,
          localUrl: scan.media.avatarUrl,
          mediaKind: "image",
          title: `${scan.characterName} — Avatar`,
          subtitle: "Character card avatar",
          readOnly: true,
          badgeText: "Avatar",
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
        lightbox: {
          id: entry.imageId,
          localUrl: entry.localUrl,
          mediaKind: item.mediaKind,
          title: entry.filename,
          subtitle: `${formatBytes(entry.sizeBytes)} · ${item.sources.map((s) => s.label).join(", ")}`,
          originalUrl: item.normalizedUrl,
          readOnly: false,
          badgeText: item.mediaKind === "video" ? "Video" : "Localized",
          onRemove: async () => {
            await this.callbacks.onPurgeCharacterCache(scan.characterId, [item.normalizedUrl]);
            await this.refreshScan(false);
          },
        },
        badge: item.mediaKind === "video" ? "Video" : "Localized",
        caption: entry.filename,
        subcaption: `${formatBytes(entry.sizeBytes)} · ${item.sources[0]?.label ?? item.domain}`,
        isExpression: false,
        mediaKind: item.mediaKind,
        urlToRemove: item.normalizedUrl,
      });
    }

    for (const expr of expressions) {
      allTiles.push({
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

    const topBar = document.createElement("div");
    topBar.className = "ml-section-title";

    const titleWrap = document.createElement("div");
    titleWrap.className = "ml-inline-title";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = `Downloaded Media (${localizedItems.length}${expressions.length > 0 ? ` + ${expressions.length} expr` : ""})`;
    titleWrap.append(
      titleSpan,
      createInfoTip(
        "Click any tile to open the lightbox. Character Avatar and native Expressions are read-only; localized assets can be removed individually or in bulk.",
      ),
    );

    const toolbar = document.createElement("div");
    toolbar.className = "ml-header-actions";

    const filterSelect = document.createElement("select");
    filterSelect.className = "ml-select is-sm";
    filterSelect.title = "Filter shown media tiles";
    const filterChoices: Array<{ val: MediaGridFilter; label: string }> = [
      { val: "all", label: `All (${allTiles.length})` },
      { val: "localized", label: `Localized (${localizedItems.length})` },
      { val: "expressions", label: `Expressions (${expressions.length})` },
      { val: "video", label: "Videos" },
    ];
    for (const c of filterChoices) {
      const opt = document.createElement("option");
      opt.value = c.val;
      opt.textContent = c.label;
      if (c.val === this.mediaFilter) opt.selected = true;
      filterSelect.appendChild(opt);
    }
    filterSelect.addEventListener("change", () => {
      this.mediaFilter = filterSelect.value as MediaGridFilter;
      this.render();
    });
    toolbar.appendChild(filterSelect);

    toolbar.appendChild(
      createIconButton({
        icon: "grid",
        title: "Grid view",
        className: `ml-btn ml-icon-btn is-sm ${this.mediaViewMode === "grid" ? "is-active" : ""}`,
        size: 13,
        onClick: () => {
          this.mediaViewMode = "grid";
          this.render();
        },
      }),
    );
    toolbar.appendChild(
      createIconButton({
        icon: "list",
        title: "List view",
        className: `ml-btn ml-icon-btn is-sm ${this.mediaViewMode === "list" ? "is-active" : ""}`,
        size: 13,
        onClick: () => {
          this.mediaViewMode = "list";
          this.render();
        },
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
            if (!res?.confirmed) return;
            await this.runAction(async () => {
              await this.callbacks.onPurgeCharacterCache(scan.characterId);
              await this.refreshScan(false);
            });
          },
        }),
      );
    }

    topBar.append(titleWrap, toolbar);
    box.appendChild(topBar);

    if (filteredTiles.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent =
        allTiles.length === 0
          ? "No downloaded media or expressions yet. Click Localize above to fetch remote media."
          : "No items match this filter.";
      box.appendChild(empty);
      return box;
    }

    const lightboxItems = filteredTiles.map((t) => t.lightbox);

    if (this.mediaViewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      list.dataset.scrollId = "localized-asset-grid";

      filteredTiles.forEach((tile, index) => {
        const row = document.createElement("div");
        row.className = "ml-media-list-row";
        row.addEventListener("click", () => openMediaLightbox(lightboxItems, index));

        const thumb = createLazyMediaElement({
          src: tile.lightbox.localUrl,
          mediaKind: tile.mediaKind,
          alt: tile.caption,
          className: "ml-media-list-thumb",
        });

        const info = document.createElement("div");
        info.className = "ml-url-meta";
        const cap = document.createElement("div");
        cap.className = "ml-url-text";
        cap.textContent = tile.caption;
        const sub = document.createElement("div");
        sub.className = "ml-url-sources";
        sub.textContent = tile.subcaption;
        info.append(cap, sub);

        const badge = document.createElement("span");
        badge.className = `ml-badge ${tile.badgeVariant ?? ""}`.trim();
        badge.textContent = tile.badge;

        row.append(thumb, info, badge);

        if (tile.urlToRemove) {
          const rmBtn = createIconButton({
            icon: "trash",
            title: "Remove localized asset",
            className: "ml-btn ml-icon-btn is-danger is-sm",
            size: 12,
            onClick: async (ev) => {
              ev.stopPropagation();
              rmBtn.disabled = true;
              await this.runAction(async () => {
                await this.callbacks.onPurgeCharacterCache(scan.characterId, [
                  tile.urlToRemove!,
                ]);
                await this.refreshScan(false);
              });
            },
          });
          row.appendChild(rmBtn);
        }

        list.appendChild(row);
      });

      box.appendChild(list);
      return box;
    }

    const grid = document.createElement("div");
    grid.className = "ml-asset-grid";
    grid.dataset.scrollId = "localized-asset-grid";

    filteredTiles.forEach((tile, index) => {
      const card = document.createElement("div");
      card.className = "ml-asset-card";

      const mediaWrap = document.createElement("div");
      mediaWrap.className = "ml-asset-thumb-wrap";
      const thumb = createLazyMediaElement({
        src: tile.lightbox.localUrl,
        mediaKind: tile.mediaKind,
        alt: tile.caption,
        className: "ml-asset-preview",
        title: `${tile.caption} — Click to preview`,
      });
      mediaWrap.addEventListener("click", () => openMediaLightbox(lightboxItems, index));

      const cornerBadge = document.createElement("span");
      cornerBadge.className = `ml-tile-badge ${tile.badgeVariant ?? ""}`.trim();
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
        const rmBtn = createIconButton({
          icon: "trash",
          title: "Remove from cache & Character Gallery",
          className: "ml-btn ml-icon-btn is-danger is-xs",
          size: 11,
          onClick: async (ev) => {
            ev.stopPropagation();
            rmBtn.disabled = true;
            await this.runAction(async () => {
              await this.callbacks.onPurgeCharacterCache(scan.characterId, [
                tile.urlToRemove!,
              ]);
              await this.refreshScan(false);
            });
          },
        });
        capRow.appendChild(rmBtn);
      }

      footer.appendChild(capRow);
      card.append(mediaWrap, footer);
      grid.appendChild(card);
    });

    box.appendChild(grid);
    return box;
  }
}
