import {
  ALL_MEDIA_KINDS,
  ALL_MEDIA_SECTIONS,
  formatBytes,
  SECTION_LABELS,
  type MediaKind,
  type MediaSourceSection,
  type QueueJobProgress,
  type SectionCountSummary,
} from "../shared/types.ts";

function hasBalancedParens(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Validates that a URL is either a single-slash relative path (`/path`) or an
 * explicit `http:` / `https:` URL, blocking `javascript:`, `data:`, and `//host`.
 */
export function sanitizeSafeMediaUrl(
  rawUrl: string | null | undefined,
): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("/\\")
  ) {
    if (/[\s"'\\<>()`]/.test(trimmed)) return null;
    return trimmed;
  }
  if (/[\s"'\\<>`]/.test(trimmed) || !hasBalancedParens(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Opens an external URL in a new tab with `noopener,noreferrer` only after
 * validating its scheme via {@link sanitizeSafeMediaUrl}.
 */
export function safeOpenExternalUrl(
  rawUrl: string | null | undefined,
): boolean {
  const safeUrl = sanitizeSafeMediaUrl(rawUrl);
  if (!safeUrl || typeof window === "undefined") return false;
  window.open(safeUrl, "_blank", "noopener,noreferrer");
  return true;
}

export interface HostSurfacesCapableContext {
  host?: {
    surfaces?: {
      invoke?(
        ref: { kind: string; id: string },
        params?: Record<string, unknown>,
      ): void | Promise<void>;
    };
  };
  permissions?: {
    request?(
      permissions: string[],
      options?: { reason?: string },
    ): Promise<string[]>;
  };
}

/**
 * Returns true if the Lumiverse host exposes `ctx.host.surfaces.invoke(...)`
 * so the extension can open the native Character Editor modal directly.
 */
export function canOpenNativeCharacterEditor(ctx: unknown): boolean {
  const invoke = (ctx as HostSurfacesCapableContext | null | undefined)?.host
    ?.surfaces?.invoke;
  return typeof invoke === "function";
}

/**
 * Opens Lumiverse's native Character Editor (`modal:character_editor`, falling
 * back to `route:/characters/:id`) for the given character ID.
 */
export async function openNativeCharacterEditor(
  ctx: unknown,
  characterId: string,
): Promise<boolean> {
  const trimmedId = typeof characterId === "string" ? characterId.trim() : "";
  if (!trimmedId) return false;
  const capCtx = ctx as HostSurfacesCapableContext | null | undefined;
  const invoke = capCtx?.host?.surfaces?.invoke;
  if (typeof invoke !== "function") return false;

  try {
    await invoke({ kind: "modal", id: "character_editor" }, { id: trimmedId });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("PERMISSION_DENIED") &&
      typeof capCtx?.permissions?.request === "function"
    ) {
      try {
        const granted = await capCtx.permissions.request(["characters"], {
          reason:
            "Allow Media Localizer to open Lumiverse's native Character Editor for this card.",
        });
        if (Array.isArray(granted) && granted.includes("characters")) {
          await invoke(
            { kind: "modal", id: "character_editor" },
            { id: trimmedId },
          );
          return true;
        }
      } catch {
        // Fall through to route fallback
      }
    }
    try {
      await invoke({ kind: "route", id: "/characters/:id" }, { id: trimmedId });
      return true;
    } catch {
      console.warn(
        "[media_localizer] Failed to open native Character Editor:",
        err,
      );
      return false;
    }
  }
}

export type IconName =
  | "download"
  | "settings"
  | "refresh"
  | "info"
  | "trash"
  | "grid"
  | "list"
  | "group"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "check"
  | "x"
  | "alert"
  | "copy"
  | "external-link"
  | "pause"
  | "image"
  | "video"
  | "sparkles"
  | "rotate-ccw"
  | "arrow-up"
  | "arrow-down"
  | "shuffle"
  | "users"
  | "edit"
  | "search"
  | "play"
  | "smile"
  | "user"
  | "sliders"
  | "layers"
  | "folder"
  | "database"
  | "shield"
  | "filter";

const ICON_PATHS: Record<IconName, string> = {
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  refresh:
    '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  info:
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  grid:
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  list:
    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  group:
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  "chevron-left": '<polyline points="15 18 9 12 15 6"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  copy:
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  "external-link":
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  video:
    '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  sparkles:
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  "rotate-ccw":
    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  "arrow-up":
    '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  "arrow-down":
    '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  shuffle:
    '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  users:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  edit:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  search:
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  smile:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  user:
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  folder:
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  shield:
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  filter:
    '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
};

export function createIcon(name: IconName, size = 14): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ml-icon");
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

export function createIconButton(options: {
  icon: IconName;
  label?: string;
  title: string;
  className?: string;
  size?: number;
  disabled?: boolean;
  onClick: (ev: MouseEvent) => void;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = options.className ?? "ml-btn ml-icon-btn";
  btn.title = options.title;
  btn.setAttribute("aria-label", options.title);
  if (options.disabled) btn.disabled = true;
  btn.appendChild(createIcon(options.icon, options.size ?? 14));
  if (options.label) {
    const span = document.createElement("span");
    span.textContent = options.label;
    btn.appendChild(span);
  }
  btn.addEventListener("click", options.onClick);
  return btn;
}

let activeTipCloseFn: (() => void) | null = null;
let activeTipTrigger: HTMLElement | null = null;
let tipDocListenersAttached = false;

function onTipDocumentClick(ev: Event): void {
  if (!activeTipCloseFn) return;
  if (activeTipTrigger && activeTipTrigger.isConnected === false) {
    activeTipCloseFn();
    return;
  }
  const target = ev.target as Node | null;
  if (target && (target as HTMLElement).closest?.(".ml-tip-wrap.is-open")) {
    return;
  }
  activeTipCloseFn();
}

function onTipDocumentKeyDown(ev: KeyboardEvent): void {
  if (!activeTipCloseFn) return;
  if (activeTipTrigger && activeTipTrigger.isConnected === false) {
    activeTipCloseFn();
    return;
  }
  if (ev.key === "Escape") {
    activeTipCloseFn();
  }
}

function ensureTipDocListeners(): void {
  if (tipDocListenersAttached || typeof document === "undefined") return;
  if (typeof document.addEventListener !== "function") return;
  document.addEventListener("click", onTipDocumentClick);
  document.addEventListener("keydown", onTipDocumentKeyDown);
  tipDocListenersAttached = true;
}

function detachTipDocListeners(): void {
  if (!tipDocListenersAttached || typeof document === "undefined") return;
  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("click", onTipDocumentClick);
    document.removeEventListener("keydown", onTipDocumentKeyDown);
  }
  tipDocListenersAttached = false;
}

/**
 * Compact `ⓘ` help trigger that shows a hover tooltip on desktop and a
 * tap/click popover on mobile or keyboard focus without cluttering the layout.
 */
export function createInfoTip(text: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "ml-tip-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ml-tip-btn";
  btn.setAttribute("aria-label", text);
  btn.title = text;
  btn.appendChild(createIcon("info", 12));

  const popover = document.createElement("div");
  popover.className = "ml-tip-popover";
  popover.setAttribute("role", "tooltip");
  popover.textContent = text;

  const updateTipAlignment = () => {
    wrap.classList.remove("is-align-right");
    popover.style.left = "";
    popover.style.right = "";
    popover.style.maxWidth = "";

    if (typeof wrap.getBoundingClientRect !== "function") return;
    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect || wrapRect.width <= 0) return;

    const container = wrap.closest?.(
      ".ml-drawer-body, .ml-gallery-host, .ml-widget",
    ) as HTMLElement | null;
    const boundsRect =
      typeof container?.getBoundingClientRect === "function"
        ? container.getBoundingClientRect()
        : null;
    const winWidth =
      typeof window !== "undefined" && typeof window.innerWidth === "number"
        ? window.innerWidth
        : 0;
    const leftBound =
      boundsRect && boundsRect.width > 0 ? boundsRect.left + 8 : 8;
    const rightBound =
      boundsRect && boundsRect.width > 0
        ? boundsRect.right - 8
        : winWidth > 0
          ? winWidth - 8
          : 0;
    if (rightBound <= leftBound) return;

    const popRect =
      typeof popover.getBoundingClientRect === "function"
        ? popover.getBoundingClientRect()
        : null;
    const clampedMaxWidth = Math.max(120, Math.floor(rightBound - leftBound));
    const tipWidth =
      popRect && popRect.width > 0
        ? popRect.width
        : Math.min(240, clampedMaxWidth);

    if (wrapRect.left + tipWidth > rightBound) {
      if (wrapRect.right - tipWidth >= leftBound) {
        wrap.classList.add("is-align-right");
      } else {
        const targetLeft = Math.max(
          leftBound,
          Math.min(wrapRect.left, rightBound - Math.min(tipWidth, clampedMaxWidth)),
        );
        popover.style.left = `${Math.round(targetLeft - wrapRect.left)}px`;
        popover.style.right = "auto";
        popover.style.maxWidth = `${clampedMaxWidth}px`;
      }
    } else if (popRect && popRect.width > 0 && popRect.left < leftBound) {
      const targetLeft = Math.max(leftBound, wrapRect.left);
      popover.style.left = `${Math.round(targetLeft - wrapRect.left)}px`;
      popover.style.right = "auto";
      popover.style.maxWidth = `${clampedMaxWidth}px`;
    }
  };

  const close = () => {
    wrap.classList.remove("is-open", "is-align-right");
    popover.style.left = "";
    popover.style.right = "";
    popover.style.maxWidth = "";
    if (activeTipCloseFn === close) {
      activeTipCloseFn = null;
      activeTipTrigger = null;
      detachTipDocListeners();
    }
  };

  wrap.addEventListener("pointerenter", updateTipAlignment);
  btn.addEventListener("focus", updateTipAlignment);

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    const wasOpen = wrap.classList.contains("is-open");
    if (activeTipCloseFn && activeTipCloseFn !== close) {
      activeTipCloseFn();
    }
    if (wasOpen) {
      close();
    } else {
      wrap.classList.add("is-open");
      activeTipCloseFn = close;
      activeTipTrigger = wrap;
      ensureTipDocListeners();
      updateTipAlignment();
    }
  });

  wrap.append(btn, popover);
  return wrap;
}

export function isQueueActiveStatus(status: QueueJobProgress["status"]): boolean {
  return status === "running" || status === "paused" || status === "cancelling";
}

export function renderQueueBanner(
  q: QueueJobProgress,
  onQueueControl: (
    control: "pause" | "resume" | "skip_current" | "cancel_all",
    targetUrl?: string,
  ) => Promise<void>,
): HTMLElement {
  const banner = document.createElement("div");
  const stateClass =
    q.status === "paused"
      ? "is-paused"
      : q.status === "cancelling"
        ? "is-cancelling"
        : "is-running";
  banner.className = `ml-queue-banner ${stateClass}`;

  const topRow = document.createElement("div");
  topRow.className = "ml-header-bar";

  const statusWrap = document.createElement("div");
  statusWrap.className = "ml-inline-title";

  const statusIcon = createIcon(
    q.status === "paused"
      ? "pause"
      : q.status === "cancelling"
        ? "rotate-ccw"
        : "download",
    13,
  );
  const statusText = document.createElement("span");
  statusText.className = "ml-queue-status-text";
  const pct =
    q.totalQueued > 0
      ? Math.min(100, Math.round((q.completedCount / q.totalQueued) * 100))
      : 0;
  const stateLabel =
    q.status === "paused"
      ? "Paused"
      : q.status === "cancelling"
        ? "Stopping..."
        : "Downloading";
  statusText.textContent = `${stateLabel}: ${q.completedCount} / ${q.totalQueued} (${pct}%)`;
  statusWrap.append(statusIcon, statusText);

  const controls = document.createElement("div");
  controls.className = "ml-header-actions";

  if (q.status === "running") {
    controls.appendChild(
      createIconButton({
        icon: "pause",
        label: "Pause",
        title: "Pause active downloads",
        className: "ml-btn is-sm",
        size: 12,
        onClick: () => void onQueueControl("pause"),
      }),
    );
  } else if (q.status === "paused") {
    controls.appendChild(
      createIconButton({
        icon: "download",
        label: "Resume",
        title: "Resume paused downloads",
        className: "ml-btn is-primary is-sm",
        size: 12,
        onClick: () => void onQueueControl("resume"),
      }),
    );
  }

  if (q.activeUrls.length > 0) {
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "ml-btn is-sm";
    skipBtn.textContent = "Skip File";
    skipBtn.title = "Abort only the currently downloading file and move to the next";
    skipBtn.addEventListener("click", () => void onQueueControl("skip_current"));
    controls.appendChild(skipBtn);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ml-btn is-danger is-sm";
  cancelBtn.textContent = "Cancel All";
  cancelBtn.title = "Immediately stop all active downloads and clear the queue";
  cancelBtn.addEventListener("click", () => void onQueueControl("cancel_all"));
  controls.appendChild(cancelBtn);

  topRow.append(statusWrap, controls);

  const track = document.createElement("div");
  track.className = "ml-progress-track";
  const fill = document.createElement("div");
  fill.className =
    q.status === "running" ? "ml-progress-fill is-active" : "ml-progress-fill";
  fill.style.width = `${pct}%`;
  track.appendChild(fill);

  const statStrip = document.createElement("div");
  statStrip.className = "ml-stat-strip";

  const savedChip = document.createElement("span");
  savedChip.className = "ml-stat-chip is-success";
  savedChip.textContent = `${q.succeededCount} saved`;
  const skippedChip = document.createElement("span");
  skippedChip.className = "ml-stat-chip is-muted";
  skippedChip.textContent = `${q.skippedCount} skipped`;
  const failedChip = document.createElement("span");
  failedChip.className =
    q.failedCount > 0 ? "ml-stat-chip is-danger" : "ml-stat-chip is-muted";
  failedChip.textContent = `${q.failedCount} failed`;
  statStrip.append(savedChip, skippedChip, failedChip);

  banner.append(topRow, track, statStrip);

  if (q.activeUrls.length > 0) {
    const activeLine = document.createElement("div");
    activeLine.className = "ml-url-sources";
    activeLine.textContent = `Active: ${q.activeUrls.map((a) => a.url).join(" | ")}`;
    banner.appendChild(activeLine);
  }

  return banner;
}

export interface SharedDownloadFilterState {
  sections: Set<MediaSourceSection>;
  mediaKinds: Set<MediaKind>;
  includeFailed: boolean;
  batchCap: number;
}

/**
 * Renders the shared Filter by Card Section + Media Types + Retry Failed + Batch Limit
 * controls used identically by Global Download Defaults (Settings) and Per-Card Options.
 */
export function renderSharedDownloadConfigControls(options: {
  state: SharedDownloadFilterState;
  sectionCounts?: Record<MediaSourceSection, SectionCountSummary>;
  batchCapHint?: string;
  sectionTip?: string;
  onChange: (state: SharedDownloadFilterState) => void;
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ml-stack";

  // Sections
  const secHeader = document.createElement("div");
  secHeader.className = "ml-config-label-row";
  const secTitle = document.createElement("span");
  secTitle.className = "ml-config-label";
  secTitle.textContent = "Filter by Card Section";
  secHeader.appendChild(secTitle);
  if (options.sectionTip) {
    secHeader.appendChild(createInfoTip(options.sectionTip));
  }
  wrap.appendChild(secHeader);

  const secGrid = document.createElement("div");
  secGrid.className = "ml-checkbox-grid";
  for (const section of ALL_MEDIA_SECTIONS) {
    const countInfo = options.sectionCounts?.[section];
    const lbl = document.createElement("label");
    lbl.className = "ml-checkbox-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = options.state.sections.has(section);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        options.state.sections.add(section);
      } else if (options.state.sections.size > 1) {
        options.state.sections.delete(section);
      } else {
        cb.checked = true;
        return;
      }
      options.onChange(options.state);
    });

    const text = document.createElement("span");
    if (countInfo) {
      const pending = countInfo.remoteCount + countInfo.failedCount;
      text.textContent = `${SECTION_LABELS[section]} (${pending} pending / ${countInfo.totalUnique})`;
    } else {
      text.textContent = SECTION_LABELS[section];
    }

    lbl.append(cb, text);
    secGrid.appendChild(lbl);
  }
  wrap.appendChild(secGrid);

  // Media types + Retry failed + Batch cap row
  const row = document.createElement("div");
  row.className = "ml-checkbox-grid";

  for (const kind of ALL_MEDIA_KINDS) {
    const lbl = document.createElement("label");
    lbl.className = "ml-checkbox-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = options.state.mediaKinds.has(kind);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        options.state.mediaKinds.add(kind);
      } else if (options.state.mediaKinds.size > 1) {
        options.state.mediaKinds.delete(kind);
      } else {
        cb.checked = true;
        return;
      }
      options.onChange(options.state);
    });
    const span = document.createElement("span");
    span.textContent = kind === "image" ? "Images" : "Videos";
    lbl.append(cb, span);
    row.appendChild(lbl);
  }

  const failedLbl = document.createElement("label");
  failedLbl.className = "ml-checkbox-item";
  const failedCb = document.createElement("input");
  failedCb.type = "checkbox";
  failedCb.checked = options.state.includeFailed;
  failedCb.addEventListener("change", () => {
    options.state.includeFailed = failedCb.checked;
    options.onChange(options.state);
  });
  const failedSpan = document.createElement("span");
  failedSpan.textContent = "Retry previously failed URLs";
  failedLbl.append(failedCb, failedSpan);
  row.appendChild(failedLbl);

  const capLbl = document.createElement("label");
  capLbl.className = "ml-checkbox-item";
  capLbl.title = options.batchCapHint ?? "0 = unlimited";
  const capSpan = document.createElement("span");
  capSpan.textContent = "Limit:";
  const capInput = document.createElement("input");
  capInput.type = "number";
  capInput.className = "ml-input-num";
  capInput.min = "0";
  capInput.max = "2000";
  capInput.value = String(options.state.batchCap);
  capInput.addEventListener("change", () => {
    const rawNum = Number(capInput.value);
    const parsed = Number.isFinite(rawNum)
      ? Math.min(2000, Math.max(0, Math.floor(rawNum)))
      : options.state.batchCap;
    capInput.value = String(parsed);
    options.state.batchCap = parsed;
    options.onChange(options.state);
  });
  capLbl.append(capSpan, capInput, createInfoTip("Maximum URLs queued per batch (0 = unlimited)."));
  row.appendChild(capLbl);

  wrap.appendChild(row);
  return wrap;
}

export interface FailedMediaEntry {
  normalizedUrl: string;
  error: string;
  lastAttemptAt?: number;
  domain: string;
}

export function categorizeFailureReason(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();
  if (/timeout|timed out|abort/i.test(lower)) return "Timeout";
  if (/too large|exceed|size limit|max size/i.test(lower)) return "File Too Large";
  if (/\b404\b|\b403\b|\b401\b|\b410\b|http 4\d\d/i.test(lower)) return "HTTP 4xx / Not Found";
  if (/\b50\d\b|http 5\d\d/i.test(lower)) return "Server Error (5xx)";
  if (/cors|network|failed to fetch|econn|enotfound|dns/i.test(lower)) return "Network / CORS";
  if (/mime|content-type|ssrf|blocked|redirect/i.test(lower)) return "Blocked / Unsupported";
  return "Other Error";
}

/**
 * Renders a grouped Failed URLs panel with Retry / Ignore per item and bulk Retry All / Ignore All.
 */
export function renderFailedItemsPanel(options: {
  items: FailedMediaEntry[];
  onRetryUrls: (urls: string[]) => void;
  onIgnoreUrls: (urls: string[]) => void;
}): HTMLElement | null {
  if (options.items.length === 0) return null;

  const box = document.createElement("div");
  box.className = "ml-section ml-failed-panel";

  const top = document.createElement("div");
  top.className = "ml-section-title";

  const left = document.createElement("span");
  left.className = "ml-inline-title";
  left.appendChild(createIcon("alert", 14));
  const titleText = document.createElement("span");
  titleText.textContent = `Failed URLs (${options.items.length})`;
  left.append(
    titleText,
    createInfoTip("URLs that failed to download, grouped by error reason. Retry or Ignore permanently broken links."),
  );

  const actions = document.createElement("div");
  actions.className = "ml-header-actions";
  const allUrls = options.items.map((i) => i.normalizedUrl);

  const retryAllBtn = createIconButton({
    icon: "refresh",
    label: "Retry All",
    title: "Re-queue all failed URLs now",
    className: "ml-btn is-primary is-sm",
    size: 12,
    onClick: () => options.onRetryUrls(allUrls),
  });
  const ignoreAllBtn = document.createElement("button");
  ignoreAllBtn.type = "button";
  ignoreAllBtn.className = "ml-btn is-sm";
  ignoreAllBtn.textContent = "Ignore All";
  ignoreAllBtn.title = "Clear these failed markers and exclude them on this character";
  ignoreAllBtn.addEventListener("click", () => options.onIgnoreUrls(allUrls));
  actions.append(retryAllBtn, ignoreAllBtn);

  top.append(left, actions);
  box.appendChild(top);

  const groups = new Map<string, FailedMediaEntry[]>();
  for (const item of options.items) {
    const reason = categorizeFailureReason(item.error);
    const list = groups.get(reason) ?? [];
    list.push(item);
    groups.set(reason, list);
  }

  const groupList = document.createElement("div");
  groupList.className = "ml-stack";
  for (const [reason, entries] of groups.entries()) {
    const groupEl = document.createElement("div");
    groupEl.className = "ml-failed-group";

    const gh = document.createElement("div");
    gh.className = "ml-failed-group-title";
    gh.textContent = `${reason} (${entries.length})`;
    groupEl.appendChild(gh);

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "ml-failed-row";

      const urlWrap = document.createElement("div");
      urlWrap.className = "ml-failed-url-col";
      const urlSpan = document.createElement("div");
      urlSpan.className = "ml-url-text";
      urlSpan.textContent = entry.normalizedUrl;
      urlSpan.title = `${entry.normalizedUrl}\n${entry.error}`;

      const errSpan = document.createElement("div");
      errSpan.className = "ml-url-sources";
      errSpan.textContent = entry.error;
      urlWrap.append(urlSpan, errSpan);

      const rowActions = document.createElement("div");
      rowActions.className = "ml-header-actions";
      rowActions.appendChild(
        createIconButton({
          icon: "refresh",
          title: "Retry this URL",
          className: "ml-btn ml-icon-btn is-sm",
          size: 12,
          onClick: () => options.onRetryUrls([entry.normalizedUrl]),
        }),
      );
      rowActions.appendChild(
        createIconButton({
          icon: "x",
          title: "Ignore and exclude this failed URL",
          className: "ml-btn ml-icon-btn is-sm",
          size: 12,
          onClick: () => options.onIgnoreUrls([entry.normalizedUrl]),
        }),
      );

      row.append(urlWrap, rowActions);
      groupEl.appendChild(row);
    }

    groupList.appendChild(groupEl);
  }

  box.appendChild(groupList);
  return box;
}

export interface LightboxItem {
  id: string;
  localUrl: string;
  mediaKind: MediaKind;
  title: string;
  subtitle?: string;
  originalUrl?: string;
  readOnly?: boolean;
  badgeText?: string;
  onRemove?: () => Promise<void>;
  onEditCharacter?: () => void;
}

let activeLightboxCloseFn: (() => void) | null = null;

/**
 * Full-screen shared Lightbox modal with keyboard/button navigation,
 * attribution metadata, Copy URL, Open Original/Local, and Remove (for non-protected items).
 */
export function openMediaLightbox(
  items: LightboxItem[],
  startIndex: number,
  onAfterRemove?: () => void,
): void {
  if (items.length === 0 || typeof document === "undefined" || !document.body) {
    return;
  }
  activeLightboxCloseFn?.();
  const workingItems = [...items];
  const removingItems = new WeakSet<LightboxItem>();
  let idx = Math.max(0, Math.min(workingItems.length - 1, startIndex));
  let closed = false;

  const backdrop = document.createElement("div");
  backdrop.className = "ml-lightbox-backdrop";
  backdrop.tabIndex = -1;

  const dialog = document.createElement("div");
  dialog.className = "ml-lightbox-dialog";

  const topBar = document.createElement("div");
  topBar.className = "ml-lightbox-topbar";
  const counterEl = document.createElement("span");
  counterEl.className = "ml-lightbox-counter";
  const closeBtn = createIconButton({
    icon: "x",
    title: "Close preview (Esc)",
    className: "ml-btn ml-icon-btn",
    size: 16,
    onClick: () => close(),
  });
  topBar.append(counterEl, closeBtn);

  const stage = document.createElement("div");
  stage.className = "ml-lightbox-stage";

  const prevBtn = createIconButton({
    icon: "chevron-left",
    title: "Previous (Left Arrow)",
    className: "ml-btn ml-icon-btn ml-lightbox-nav",
    size: 20,
    onClick: (ev) => {
      ev.stopPropagation();
      step(-1);
    },
  });

  const mediaSlot = document.createElement("div");
  mediaSlot.className = "ml-lightbox-media-slot";

  const nextBtn = createIconButton({
    icon: "chevron-right",
    title: "Next (Right Arrow)",
    className: "ml-btn ml-icon-btn ml-lightbox-nav",
    size: 20,
    onClick: (ev) => {
      ev.stopPropagation();
      step(1);
    },
  });

  stage.append(prevBtn, mediaSlot, nextBtn);

  const footer = document.createElement("div");
  footer.className = "ml-lightbox-footer";
  const metaCol = document.createElement("div");
  metaCol.className = "ml-lightbox-meta";
  const actionsCol = document.createElement("div");
  actionsCol.className = "ml-header-actions";
  footer.append(metaCol, actionsCol);

  dialog.append(topBar, stage, footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      ev.stopPropagation();
      step(-1);
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      ev.stopPropagation();
      step(1);
    }
  };
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("keydown", onKeyDown, true);
  }

  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });

  function close() {
    if (closed) return;
    closed = true;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("keydown", onKeyDown, true);
    }
    backdrop.remove();
    if (activeLightboxCloseFn === close) {
      activeLightboxCloseFn = null;
    }
  }
  activeLightboxCloseFn = close;

  function step(delta: number) {
    if (workingItems.length <= 1) return;
    idx = (idx + delta + workingItems.length) % workingItems.length;
    renderCurrent();
  }

  function updateNavChrome() {
    counterEl.textContent = `${idx + 1} / ${workingItems.length}`;
    prevBtn.style.visibility = workingItems.length > 1 ? "visible" : "hidden";
    nextBtn.style.visibility = workingItems.length > 1 ? "visible" : "hidden";
  }

  function renderCurrent() {
    if (closed) return;
    const item = workingItems[idx];
    if (!item) {
      close();
      return;
    }

    updateNavChrome();

    const safeLocalUrl = sanitizeSafeMediaUrl(item.localUrl);
    mediaSlot.innerHTML = "";
    if (!safeLocalUrl) {
      const blocked = document.createElement("div");
      blocked.className = "ml-empty";
      blocked.textContent = "Blocked unsafe media URL.";
      mediaSlot.appendChild(blocked);
    } else if (item.mediaKind === "video") {
      const video = document.createElement("video");
      video.className = "ml-lightbox-media";
      video.src = safeLocalUrl;
      video.controls = true;
      video.autoplay = true;
      video.loop = true;
      mediaSlot.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.className = "ml-lightbox-media";
      img.src = safeLocalUrl;
      img.alt = item.title;
      mediaSlot.appendChild(img);
    }

    metaCol.innerHTML = "";
    const titleRow = document.createElement("div");
    titleRow.className = "ml-lightbox-title";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = item.title;
    titleRow.appendChild(titleSpan);
    if (item.badgeText) {
      const badge = document.createElement("span");
      badge.className = "ml-badge is-info";
      badge.textContent = item.badgeText;
      titleRow.appendChild(badge);
    }
    metaCol.appendChild(titleRow);
    if (item.subtitle) {
      const sub = document.createElement("div");
      sub.className = "ml-url-sources";
      sub.textContent = item.subtitle;
      metaCol.appendChild(sub);
    }

    actionsCol.innerHTML = "";
    const openBtn = createIconButton({
      icon: "external-link",
      label: "Open",
      title: safeLocalUrl
        ? "Open local asset in a new tab"
        : "Cannot open unsafe media URL",
      className: "ml-btn is-sm",
      size: 13,
      disabled: !safeLocalUrl,
      onClick: () => safeOpenExternalUrl(item.localUrl),
    });
    actionsCol.appendChild(openBtn);

    if (item.originalUrl) {
      const copyBtn = createIconButton({
        icon: "copy",
        label: "Copy URL",
        title: `Copy original remote URL: ${item.originalUrl}`,
        className: "ml-btn is-sm",
        size: 13,
        onClick: () => {
          void navigator.clipboard?.writeText?.(item.originalUrl!);
          const labelSpan = copyBtn.querySelector("span");
          if (labelSpan) labelSpan.textContent = "Copied";
        },
      });
      actionsCol.appendChild(copyBtn);
    }

    if (item.onEditCharacter) {
      const editBtn = createIconButton({
        icon: "edit",
        label: "Edit Card",
        title: "Open native Character Editor for this character",
        className: "ml-btn is-sm",
        size: 13,
        onClick: () => {
          const onEdit = item.onEditCharacter;
          close();
          onEdit?.();
        },
      });
      actionsCol.appendChild(editBtn);
    }

    if (!item.readOnly && item.onRemove) {
      const removeBtn = createIconButton({
        icon: "trash",
        label: "Remove",
        title: "Remove this localized asset from cache & Character Gallery",
        className: "ml-btn is-danger is-sm",
        size: 13,
        disabled: removingItems.has(item),
        onClick: async () => {
          if (closed || removingItems.has(item)) return;
          removingItems.add(item);
          removeBtn.disabled = true;
          try {
            await item.onRemove!();
            let removeAt = workingItems.indexOf(item);
            if (removeAt === -1) {
              removeAt = workingItems.findIndex((entry) => entry.id === item.id);
            }
            const removedCurrentSlide = removeAt !== -1 && removeAt === idx;
            if (removeAt !== -1) {
              workingItems.splice(removeAt, 1);
              if (removeAt < idx) {
                idx = Math.max(0, idx - 1);
              } else if (removeAt === idx) {
                idx = Math.min(idx, Math.max(0, workingItems.length - 1));
              }
            }
            onAfterRemove?.();
            if (closed) return;
            if (workingItems.length === 0) {
              close();
            } else {
              idx = Math.max(0, Math.min(idx, workingItems.length - 1));
              if (removedCurrentSlide) {
                renderCurrent();
              } else {
                updateNavChrome();
              }
            }
          } catch (err) {
            console.warn("[media_localizer] Failed removing lightbox item:", err);
          } finally {
            removingItems.delete(item);
            if (!closed && removeBtn.isConnected !== false) {
              removeBtn.disabled = false;
            }
          }
        },
      });
      actionsCol.appendChild(removeBtn);
    }
  }

  renderCurrent();
  backdrop.focus();
}

let sharedThumbObserver: IntersectionObserver | null = null;
let thumbCallbacks = new WeakMap<Element, () => void>();
const observedThumbElements = new Set<Element>();
let thumbPruneTimer: ReturnType<typeof setTimeout> | null = null;

function pruneDetachedThumbTargets(): void {
  if (!sharedThumbObserver) {
    observedThumbElements.clear();
    return;
  }
  for (const el of observedThumbElements) {
    if (el.isConnected === false) {
      sharedThumbObserver.unobserve(el);
      observedThumbElements.delete(el);
    }
  }
}

function scheduleThumbPrune(delayMs = 50): void {
  if (thumbPruneTimer !== null || observedThumbElements.size === 0) return;
  thumbPruneTimer = setTimeout(() => {
    thumbPruneTimer = null;
    pruneDetachedThumbTargets();
    if (observedThumbElements.size > 0 && sharedThumbObserver) {
      scheduleThumbPrune(2000);
    }
  }, delayMs);
  (thumbPruneTimer as { unref?: () => void }).unref?.();
}

function observeThumbElement(
  observer: IntersectionObserver,
  el: Element,
  cb: () => void,
): void {
  thumbCallbacks.set(el, cb);
  observedThumbElements.add(el);
  observer.observe(el);
  scheduleThumbPrune(50);
}

function getThumbObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!sharedThumbObserver) {
    sharedThumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            if (entry.target.isConnected === false) {
              sharedThumbObserver?.unobserve(entry.target);
              observedThumbElements.delete(entry.target);
            }
            continue;
          }
          const cb = thumbCallbacks.get(entry.target);
          sharedThumbObserver?.unobserve(entry.target);
          thumbCallbacks.delete(entry.target);
          observedThumbElements.delete(entry.target);
          cb?.();
        }
        pruneDetachedThumbTargets();
      },
      { rootMargin: "600px" },
    );
  }
  return sharedThumbObserver;
}

/**
 * Re-attaches `sharedThumbObserver` (or runs the deferred `src` callback if
 * `IntersectionObserver` is unavailable) for any cached lazy `<img>`/`<video>`
 * elements that were pruned while temporarily detached from the DOM.
 */
export function reobserveLazyMedia(
  root: ParentNode | Element | null | undefined,
): void {
  if (!root) return;
  const candidates: Element[] = [];
  const rootTag = (root as { tagName?: unknown }).tagName;
  if (typeof rootTag === "string") {
    const lower = rootTag.toLowerCase();
    if (lower === "img" || lower === "video") {
      candidates.push(root as Element);
    }
  }
  const queried = (
    root as { querySelectorAll?: (selectors: string) => Iterable<Element> }
  ).querySelectorAll?.("img, video");
  if (queried) {
    for (const el of Array.from(queried)) {
      candidates.push(el);
    }
  }
  if (candidates.length === 0) return;

  const observer = getThumbObserver();
  for (const el of candidates) {
    const cb = thumbCallbacks.get(el);
    if (!cb) continue;
    const currentSrc =
      typeof (el as { getAttribute?: (name: string) => string | null })
        .getAttribute === "function"
        ? el.getAttribute("src")
        : (el as { src?: string }).src;
    if (currentSrc) {
      thumbCallbacks.delete(el);
      continue;
    }
    if (observer) {
      if (!observedThumbElements.has(el)) {
        observeThumbElement(observer, el, cb);
      }
    } else {
      thumbCallbacks.delete(el);
      cb();
    }
  }
}

/**
 * Disconnects global UI observers, closes any active tooltip or lightbox modal,
 * and removes module-level document/window event listeners on extension unload.
 */
export function cleanupUiHelpers(): void {
  activeTipCloseFn?.();
  activeTipCloseFn = null;
  activeTipTrigger = null;
  detachTipDocListeners();
  activeLightboxCloseFn?.();
  activeLightboxCloseFn = null;
  if (thumbPruneTimer !== null) {
    clearTimeout(thumbPruneTimer);
    thumbPruneTimer = null;
  }
  if (sharedThumbObserver) {
    sharedThumbObserver.disconnect();
    sharedThumbObserver = null;
  }
  observedThumbElements.clear();
  thumbCallbacks = new WeakMap<Element, () => void>();
}

const LOCAL_IMAGE_THUMB_PATH_RE = /^\/api\/v1\/images\/(?!remote$|wallpapers$)[^/?#]+$/;

export type ThumbnailSize = "sm" | "md" | "lg";
export type ThumbnailImageTier = "sm" | "lg";

export const THUMBNAIL_SIZE_OPTIONS: readonly ThumbnailSize[] = [
  "sm",
  "md",
  "lg",
] as const;

export const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize = "md";

/**
 * Validates a persisted or user-supplied thumbnail size preset, falling back
 * to {@link DEFAULT_THUMBNAIL_SIZE}.
 */
export function sanitizeThumbnailSize(raw: unknown): ThumbnailSize {
  return raw === "sm" || raw === "md" || raw === "lg"
    ? raw
    : DEFAULT_THUMBNAIL_SIZE;
}

/**
 * Maps a UI thumbnail size preset to a Lumiverse `/api/v1/images/:id?size=`
 * tier (`sm` ~300px or `lg` ~700px; `md` is not a host endpoint tier).
 */
export function getThumbnailImageTier(size: ThumbnailSize): ThumbnailImageTier {
  return size === "lg" ? "lg" : "sm";
}

/**
 * Returns the `.ml-widget` modifier class corresponding to a thumbnail size.
 */
export function getThumbnailSizeClass(size: ThumbnailSize): string {
  return `is-thumb-${size}`;
}

const THUMBNAIL_SIZE_LABELS: Record<
  ThumbnailSize,
  { short: string; title: string }
> = {
  sm: { short: "S", title: "Small thumbnails" },
  md: { short: "M", title: "Medium thumbnails" },
  lg: { short: "L", title: "Large thumbnails" },
};

/**
 * Builds a compact `S / M / L` segmented toggle for thumbnail size presets.
 */
export function createThumbnailSizeSegmented(
  currentSize: ThumbnailSize,
  onChange: (size: ThumbnailSize) => void,
): HTMLElement {
  let activeSize = currentSize;
  const wrap = document.createElement("div");
  wrap.className = "ml-segmented ml-thumb-size-segmented";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Thumbnail size");

  const buttons = new Map<ThumbnailSize, HTMLButtonElement>();
  const syncActive = () => {
    for (const [sz, button] of buttons) {
      const isAct = sz === activeSize;
      button.className = `ml-btn is-xs${isAct ? " is-active" : ""}`;
      button.setAttribute("aria-pressed", isAct ? "true" : "false");
    }
  };

  for (const size of THUMBNAIL_SIZE_OPTIONS) {
    const meta = THUMBNAIL_SIZE_LABELS[size];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = meta.short;
    btn.title = meta.title;
    btn.setAttribute("aria-label", meta.title);
    btn.addEventListener("click", () => {
      if (size === activeSize) return;
      activeSize = size;
      syncActive();
      onChange(size);
    });
    buttons.set(size, btn);
    wrap.appendChild(btn);
  }

  syncActive();
  return wrap;
}

/**
 * Converts a bare local `/api/v1/images/:id` URL into a lightweight `?size=sm`
 * or `?size=lg` thumbnail URL for image tiles so full-resolution bitmaps do
 * not exhaust Chromium's decoded-image cache during scrolling.
 */
export function toThumbnailMediaUrl(
  safeSrc: string | null,
  mediaKind: MediaKind = "image",
  tier: ThumbnailImageTier = "sm",
): string | null {
  if (!safeSrc || mediaKind !== "image") return safeSrc;
  return LOCAL_IMAGE_THUMB_PATH_RE.test(safeSrc)
    ? `${safeSrc}?size=${tier}`
    : safeSrc;
}

/**
 * Creates an `<img>` or muted preview `<video>` tile, optionally deferring `src`
 * assignment via `sharedThumbObserver` until the tile scrolls near the viewport.
 */
export function createLazyMediaElement(options: {
  src: string;
  mediaKind: MediaKind;
  alt: string;
  className: string;
  title?: string;
  eager?: boolean;
  thumbTier?: ThumbnailImageTier;
}): HTMLImageElement | HTMLVideoElement {
  const safeSrc = sanitizeSafeMediaUrl(options.src);
  const observer = safeSrc && !options.eager ? getThumbObserver() : null;
  if (options.mediaKind === "video") {
    const vid = document.createElement("video");
    vid.className = options.className;
    vid.muted = true;
    vid.preload = "metadata";
    vid.controls = false;
    if (options.title) vid.title = options.title;
    if (safeSrc) {
      if (observer) {
        observeThumbElement(observer, vid, () => {
          thumbCallbacks.delete(vid);
          vid.src = safeSrc;
        });
      } else {
        vid.src = safeSrc;
      }
    }
    return vid;
  }

  const thumbSrc = toThumbnailMediaUrl(
    safeSrc,
    "image",
    options.thumbTier ?? "sm",
  );
  const img = document.createElement("img");
  img.className = options.className;
  img.loading = "eager";
  img.decoding = "async";
  img.alt = options.alt;
  if (options.title) img.title = options.title;
  if (thumbSrc) {
    if (observer) {
      observeThumbElement(observer, img, () => {
        thumbCallbacks.delete(img);
        img.src = thumbSrc;
      });
    } else {
      img.src = thumbSrc;
    }
  }
  return img;
}

export function formatByteBadge(bytes: number): string {
  return bytes > 0 ? formatBytes(bytes) : "0 B";
}

export interface PendingScrollRestore {
  cancel: () => void;
}

const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

function isAncestorOrSelf(
  ancestor: HTMLElement | null,
  node: HTMLElement | null,
): boolean {
  let cur: HTMLElement | null = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Returns true if `el` is currently scrolled or has vertical overflow inside a
 * scrollable container (including `document.scrollingElement`).
 */
export function isElementScrollable(el: HTMLElement | null | undefined): boolean {
  if (!el || typeof el.scrollTop !== "number" || !Number.isFinite(el.scrollTop)) {
    return false;
  }
  if (el.scrollTop > 0) {
    return true;
  }
  const hasOverflow =
    typeof el.scrollHeight === "number" &&
    typeof el.clientHeight === "number" &&
    el.clientHeight > 0 &&
    el.scrollHeight > el.clientHeight + 1;
  if (!hasOverflow) {
    return false;
  }

  const doc = typeof document !== "undefined" ? document : undefined;
  if (
    doc &&
    (el === (doc.scrollingElement as HTMLElement | null) ||
      el === (doc.documentElement as HTMLElement | null))
  ) {
    return true;
  }

  if (typeof getComputedStyle === "function") {
    try {
      const computedOverflowY = getComputedStyle(el as Element).overflowY;
      if (computedOverflowY) {
        return SCROLLABLE_OVERFLOW_VALUES.has(computedOverflowY);
      }
    } catch {
      // Ignore mock elements that are not native DOM Element instances
    }
  }

  const inlineOverflowY = (el as { style?: { overflowY?: string } }).style?.overflowY;
  if (inlineOverflowY) {
    return SCROLLABLE_OVERFLOW_VALUES.has(inlineOverflowY);
  }

  return true;
}

/**
 * Finds the nearest scrollable element starting at `startEl` and walking up
 * `parentElement` (including `document.scrollingElement`), falling back to a
 * previously observed scroll container or `fallbackEl` when layout metrics are absent.
 */
export function resolveScrollContainer(
  startEl: HTMLElement | null,
  rememberedEl?: HTMLElement | null,
  fallbackEl?: HTMLElement | null,
): HTMLElement | null {
  let cur: HTMLElement | null = startEl;
  while (cur) {
    if (isElementScrollable(cur)) {
      return cur;
    }
    cur = cur.parentElement;
  }

  const docScrollEl =
    typeof document !== "undefined"
      ? (document.scrollingElement as HTMLElement | null)
      : null;
  if (docScrollEl && isElementScrollable(docScrollEl)) {
    return docScrollEl;
  }

  if (
    rememberedEl &&
    startEl &&
    isAncestorOrSelf(rememberedEl, startEl) &&
    typeof rememberedEl.scrollTop === "number"
  ) {
    return rememberedEl;
  }

  return fallbackEl ?? startEl;
}

/**
 * Sets `scrollTop` synchronously on the resolved scroll container and, when
 * restoring a non-zero offset in a browser environment, guards against
 * pre-layout clamping by re-applying on up to two animation frames if clamped.
 */
export function applyScrollTopWithSettlement(
  getContainer: () => HTMLElement | null,
  scrollTop: number,
  prevPending: PendingScrollRestore | null,
  shouldAbort?: () => boolean,
): PendingScrollRestore | null {
  prevPending?.cancel();
  const next = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
  const host = getContainer();
  if (!host || typeof host.scrollTop !== "number") {
    return null;
  }
  host.scrollTop = next;
  if (next <= 0 || typeof requestAnimationFrame !== "function") {
    return null;
  }

  const afterSync = Number.isFinite(host.scrollTop) ? host.scrollTop : 0;
  let cancelled = false;
  let rafId = 0;
  let followUpRafId = 0;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (typeof cancelAnimationFrame === "function") {
      if (rafId) cancelAnimationFrame(rafId);
      if (followUpRafId) cancelAnimationFrame(followUpRafId);
    }
  };

  const reapplyIfClamped = (): number => {
    if (cancelled || shouldAbort?.()) return next;
    const target = getContainer();
    if (!target || typeof target.scrollTop !== "number") return next;
    const current = Number.isFinite(target.scrollTop) ? target.scrollTop : 0;
    if (current < next && (afterSync < next || current === 0)) {
      target.scrollTop = next;
      return Number.isFinite(target.scrollTop) ? target.scrollTop : 0;
    }
    return current;
  };

  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const current = reapplyIfClamped();
    if (
      !cancelled &&
      !shouldAbort?.() &&
      current < next &&
      (afterSync < next || current === 0)
    ) {
      followUpRafId = requestAnimationFrame(() => {
        followUpRafId = 0;
        reapplyIfClamped();
      });
    }
  });

  return { cancel };
}

export const GALLERY_PREFS_STORAGE_KEY =
  "lumiverse.media_localizer.gallery_prefs.v1";
export const CHARACTER_PREFS_STORAGE_KEY =
  "lumiverse.media_localizer.character_prefs.v1";

/**
 * Loads and sanitizes persisted UI preferences from `localStorage`, falling back
 * to `fallback()` when storage is empty, malformed, or unavailable.
 */
export function loadPrefsFromStorage<T>(
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

/**
 * Persists UI preferences to `localStorage`, ignoring storage unavailability
 * (e.g. private browsing or test environments).
 */
export function savePrefsToStorage<T>(key: string, prefs: T): void {
  try {
    globalThis.localStorage?.setItem?.(key, JSON.stringify(prefs));
  } catch {
    // Ignore storage unavailability (private browsing, test envs)
  }
}
