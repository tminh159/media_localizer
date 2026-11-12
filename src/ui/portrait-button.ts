import type { QueueJobProgress } from "../shared/types.ts";
import { createIcon, isQueueActiveStatus } from "./ui-helpers.ts";

export interface PortraitPanelButtonCallbacks {
  getActiveCharacterId(): string | null;
  getPendingCount(): number;
  getQueueProgress(): QueueJobProgress;
  onLocalizeActiveCharacter(characterId: string): Promise<void>;
  onOpenCharacterTab(characterId: string): void;
}

const WRAP_CLASS = "ml-portrait-localize-wrap";
const BTN_CLASS = "ml-portrait-localize-btn";

/**
 * Injects a sleek one-click "Localize (N)" pill directly inside Lumiverse's
 * Portrait Panel under the character name, keeping it attached across React re-renders.
 */
export class PortraitPanelLocalizeController {
  private observer: MutationObserver | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private wrapEl: HTMLElement | null = null;
  private btnEl: HTMLButtonElement | null = null;
  private busyStarting = false;
  private lastQueueStatus: QueueJobProgress["status"] = "idle";
  private justCompleted = false;
  private completedTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderKey = "";
  private stopped = false;

  constructor(private readonly callbacks: PortraitPanelButtonCallbacks) {}

  start(): void {
    this.stopped = false;
    if (this.observer || typeof document === "undefined" || !document.body) {
      this.sync();
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      if (this.stopped) return;
      if (mutations.some((m) => this.isRelevantMutation(m))) {
        this.scheduleSync();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    this.sync();
  }

  private isRelevantMutation(m: MutationRecord): boolean {
    const target = m.target;
    if (this.wrapEl && this.wrapEl.contains(target)) {
      return false;
    }
    const targetEl =
      target && target.nodeType === 1
        ? (target as Element)
        : (target?.parentElement ?? null);
    if (
      targetEl?.closest?.(
        ".ml-gallery-host, .ml-drawer-root, .ml-lightbox-backdrop, .ml-portrait-localize-wrap",
      )
    ) {
      return false;
    }

    const mountedPanel = this.wrapEl?.parentElement ?? null;
    if (!mountedPanel || mountedPanel.isConnected === false) {
      return true;
    }
    if (mountedPanel.contains(target) || target.contains?.(mountedPanel)) {
      return true;
    }

    const nodeMayBePanel = (node: Node): boolean => {
      if (node.nodeType !== 1) return false;
      const el = node as Element;
      if (el.classList?.contains(WRAP_CLASS)) return true;
      if (el.matches?.('[class*="panelOuter"], [class*="panel"]')) return true;
      return el.querySelector?.('[class*="panelOuter"] [class*="panel"]') !== null;
    };

    for (const node of Array.from(m.addedNodes)) {
      if (nodeMayBePanel(node)) return true;
    }
    for (const node of Array.from(m.removedNodes)) {
      if (nodeMayBePanel(node)) return true;
    }
    return false;
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.completedTimer !== null) {
      clearTimeout(this.completedTimer);
      this.completedTimer = null;
    }
    this.clearLongPress();
    this.wrapEl?.remove();
    this.wrapEl = null;
    this.btnEl = null;
    this.lastRenderKey = "";
  }

  update(): void {
    if (this.stopped) return;
    const q = this.callbacks.getQueueProgress();
    const wasActive = isQueueActiveStatus(this.lastQueueStatus);
    const nowActive = isQueueActiveStatus(q.status);
    this.lastQueueStatus = q.status;

    if (wasActive && !nowActive && q.succeededCount > 0) {
      this.justCompleted = true;
      if (this.completedTimer) clearTimeout(this.completedTimer);
      this.completedTimer = setTimeout(() => {
        this.completedTimer = null;
        if (this.stopped) return;
        this.justCompleted = false;
        this.renderButtonState();
      }, 2600);
    }

    this.sync();
  }

  private scheduleSync(): void {
    if (this.stopped || this.syncTimer !== null) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (!this.stopped) {
        this.sync();
      }
    }, 60);
  }

  private ensureElements(): HTMLButtonElement {
    if (this.wrapEl && this.btnEl) {
      return this.btnEl;
    }
    this.lastRenderKey = "";

    const wrap = document.createElement("div");
    wrap.className = WRAP_CLASS;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;

    let longPressTriggered = false;

    btn.addEventListener("pointerdown", (ev) => {
      if (this.stopped) return;
      longPressTriggered = false;
      // Only arm touch/pen/primary-mouse long-press so right-click uses contextmenu cleanly.
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      const charId = this.callbacks.getActiveCharacterId();
      if (!charId) return;
      this.clearLongPress();
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        if (this.stopped) return;
        longPressTriggered = true;
        this.callbacks.onOpenCharacterTab(charId);
      }, 520);
    });
    const onCancelLongPress = () => this.clearLongPress();
    btn.addEventListener("pointerup", onCancelLongPress);
    btn.addEventListener("pointercancel", onCancelLongPress);
    btn.addEventListener("pointerleave", onCancelLongPress);

    btn.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.clearLongPress();
      longPressTriggered = false;
      if (this.stopped) return;
      const charId = this.callbacks.getActiveCharacterId();
      if (charId) this.callbacks.onOpenCharacterTab(charId);
    });

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      if (this.stopped) return;
      const charId = this.callbacks.getActiveCharacterId();
      if (!charId || this.busyStarting) return;

      const q = this.callbacks.getQueueProgress();
      if (isQueueActiveStatus(q.status)) {
        this.callbacks.onOpenCharacterTab(charId);
        return;
      }

      if (this.callbacks.getPendingCount() <= 0) return;
      this.busyStarting = true;
      this.renderButtonState();
      void this.callbacks
        .onLocalizeActiveCharacter(charId)
        .finally(() => {
          this.busyStarting = false;
          if (!this.stopped) {
            this.renderButtonState();
          }
        });
    });

    wrap.appendChild(btn);
    this.wrapEl = wrap;
    this.btnEl = btn;
    return btn;
  }

  private findTargetPortraitPanel(): HTMLElement | null {
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[class*="panelOuter"] [class*="panel"]',
      ),
    );
    if (panels.length === 0) return null;
    return (
      panels.find(
        (el) =>
          el.offsetParent !== null ||
          (typeof el.getClientRects === "function" &&
            el.getClientRects().length > 0),
      ) ??
      panels[0] ??
      null
    );
  }

  sync(): void {
    if (this.stopped || typeof document === "undefined") return;
    const panel = this.findTargetPortraitPanel();
    if (!panel) {
      return;
    }

    this.ensureElements();
    const wrap = this.wrapEl!;
    const nameEl = panel.querySelector<HTMLElement>('[class*="name"]');

    // Keep wrap mounted cleanly right under the character name inside PortraitPanel
    if (nameEl && nameEl.parentElement === panel) {
      if (wrap.parentElement !== panel || nameEl.nextElementSibling !== wrap) {
        nameEl.after(wrap);
      }
    } else if (wrap.parentElement !== panel) {
      panel.appendChild(wrap);
    }

    this.renderButtonState();
  }

  private renderButtonState(): void {
    const wrap = this.wrapEl;
    const btn = this.btnEl;
    if (!wrap || !btn || this.stopped) return;

    const charId = this.callbacks.getActiveCharacterId();
    const q = this.callbacks.getQueueProgress();
    const pending = this.callbacks.getPendingCount();
    const queueActive = isQueueActiveStatus(q.status);

    let nextKey = "hidden";
    if (charId) {
      if (queueActive) {
        nextKey = `running:${q.completedCount}:${q.totalQueued}`;
      } else if (this.busyStarting) {
        nextKey = "starting";
      } else if (pending > 0) {
        nextKey = `pending:${pending}`;
      } else if (this.justCompleted) {
        nextKey = "done";
      }
    }

    if (nextKey === this.lastRenderKey) {
      return;
    }
    this.lastRenderKey = nextKey;

    btn.innerHTML = "";
    btn.classList.remove("is-running", "is-done");

    if (!charId) {
      wrap.style.display = "none";
      return;
    }

    if (queueActive) {
      wrap.style.display = "flex";
      btn.classList.add("is-running");
      btn.appendChild(createIcon("download", 12));
      const label = document.createElement("span");
      label.textContent = `${q.completedCount}/${q.totalQueued}`;
      btn.appendChild(label);
      btn.title = "Localizing media... Click to open Media Localizer";
      return;
    }

    if (this.busyStarting) {
      wrap.style.display = "flex";
      btn.classList.add("is-running");
      btn.appendChild(createIcon("refresh", 12));
      const label = document.createElement("span");
      label.textContent = "Starting...";
      btn.appendChild(label);
      btn.title = "Starting localization queue...";
      return;
    }

    if (pending > 0) {
      wrap.style.display = "flex";
      btn.appendChild(createIcon("download", 12));
      const label = document.createElement("span");
      label.textContent = `Localize (${pending})`;
      btn.appendChild(label);
      btn.title = `Download ${pending} remote media file(s) · Right-click for options`;
      return;
    }

    if (this.justCompleted) {
      wrap.style.display = "flex";
      btn.classList.add("is-done");
      btn.appendChild(createIcon("check", 12));
      const label = document.createElement("span");
      label.textContent = "Localized";
      btn.appendChild(label);
      btn.title = "Media localization complete";
      return;
    }

    wrap.style.display = "none";
  }
}

