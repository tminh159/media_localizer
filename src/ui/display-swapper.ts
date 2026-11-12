import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { ActiveDisplayUrlMapPayload } from "../shared/types.ts";
import { decodeHtmlEntities } from "../shared/url-scanner.ts";
import { sanitizeSafeMediaUrl } from "./ui-helpers.ts";

const CSS_URL_RE = /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/gi;

export class NonDestructiveDisplaySwapper {
  private payload: ActiveDisplayUrlMapPayload = {
    characterUrlMaps: {},
    allUrlsMap: {},
    updatedAt: 0,
  };

  private observer: MutationObserver | null = null;
  private errorListener: ((e: Event) => void) | null = null;
  private rafScheduled = false;
  private rafId: number | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly iframeLoadListeners = new Map<HTMLIFrameElement, () => void>();

  constructor(private readonly ctx: SpindleFrontendContext) {}

  start(): void {
    this.stopped = false;
    this.schedulePass();

    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      this.observer = new MutationObserver((records) => {
        if (records.some((r) => this.isRelevantMutation(r))) {
          this.schedulePass();
        }
      });
      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src", "data-src", "srcset", "href", "xlink:href", "poster", "style", "srcdoc"],
        });
      }
    }

    if (typeof document !== "undefined") {
      this.errorListener = (event: Event) => {
        const target = event.target;
        if (
          target instanceof HTMLImageElement ||
          target instanceof HTMLVideoElement ||
          target instanceof HTMLSourceElement ||
          (typeof SVGImageElement !== "undefined" && target instanceof SVGImageElement)
        ) {
          this.decorateMediaElement(target, this.getActiveCharacterIds());
        }
      };
      document.addEventListener("error", this.errorListener, true);
    }
  }

  /** Filters out mutations caused by our own writes or that cannot affect swappable media. */
  private isRelevantMutation(r: MutationRecord): boolean {
    const target = r.target;
    const targetEl =
      target instanceof Element ? target : (target.parentElement ?? null);
    if (targetEl?.closest(".ml-gallery-host, .ml-drawer-root")) return false;

    if (r.type === "attributes" && target instanceof Element) {
      const name = r.attributeName ?? "";
      if (name === "style") {
        const style = target.getAttribute("style") ?? "";
        return (
          style.includes("url(") || target.hasAttribute("data-ml-original-style")
        );
      }
      if (
        name === "src" ||
        name === "data-src" ||
        name === "srcset" ||
        name === "href" ||
        name === "xlink:href" ||
        name === "poster"
      ) {
        const safeKey = name.replace(":", "-");
        const value = target.getAttribute(name);
        // Our own write: nothing to do
        return value !== target.getAttribute(`data-ml-applied-${safeKey}`);
      }
      return true;
    }

    if (r.type === "childList") {
      for (const n of Array.from(r.addedNodes)) {
        if (n.nodeType === 1) return true;
      }
      // Text changes inside <style> tags can introduce url(...) references
      return targetEl?.tagName === "STYLE";
    }
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.rafScheduled = false;
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.errorListener && typeof document !== "undefined") {
      document.removeEventListener("error", this.errorListener, true);
      this.errorListener = null;
    }
    for (const [iframe, listener] of this.iframeLoadListeners) {
      iframe.removeEventListener("load", listener);
    }
    this.iframeLoadListeners.clear();
    if (typeof document !== "undefined" && document.body) {
      this.revertContainer(document.body);
      this.processSameOriginIframes([], true);
    }
  }

  updateMap(next: ActiveDisplayUrlMapPayload): void {
    this.payload = next;
    if (this.stopped) return;
    this.runPassNow();
  }

  schedulePass(): void {
    if (this.stopped || this.rafScheduled) return;
    this.rafScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.rafScheduled = false;
        if (!this.stopped) {
          this.runPassNow();
        }
      });
    } else {
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null;
        this.rafScheduled = false;
        if (!this.stopped) {
          this.runPassNow();
        }
      }, 16);
    }
  }

  private getActiveCharacterIds(): string[] {
    const ids = new Set<string>();
    try {
      const activeChat = this.ctx.getActiveChat?.();
      if (activeChat?.characterId) ids.add(activeChat.characterId);
    } catch {
      // ignore
    }
    try {
      const editorState = this.ctx.ui?.characterEditor?.getState?.();
      if (editorState?.open && editorState.characterId) {
        ids.add(editorState.characterId);
      }
    } catch {
      // ignore
    }
    return Array.from(ids);
  }

  resolveLocalUrl(rawUrl: string, activeCharacterIds: string[]): string | null {
    if (!rawUrl || rawUrl.startsWith("/api/v1/images/") || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
      return null;
    }

    const candidates = [rawUrl.trim()];
    const decoded = decodeHtmlEntities(rawUrl.trim());
    if (decoded !== rawUrl.trim()) candidates.push(decoded);
    try {
      const href = new URL(decoded).href;
      if (!candidates.includes(href)) candidates.push(href);
    } catch {
      // ignore
    }

    // 1. Check active character maps first
    for (const charId of activeCharacterIds) {
      const charMap = this.payload.characterUrlMaps[charId];
      if (!charMap) continue;
      for (const c of candidates) {
        const hit = sanitizeSafeMediaUrl(charMap[c]);
        if (hit) return hit;
      }
    }

    // 2. Fallback to the global map of every localized URL
    for (const c of candidates) {
      const globalHit = sanitizeSafeMediaUrl(this.payload.allUrlsMap[c]);
      if (globalHit) return globalHit;
    }

    return null;
  }

  runPassNow(): void {
    if (this.stopped || typeof document === "undefined" || !document.body) return;
    const activeCharIds = this.getActiveCharacterIds();

    this.decorateContainer(document.body, activeCharIds);
    this.processSameOriginIframes(activeCharIds, false);
  }

  private processSameOriginIframes(
    activeCharIds: string[],
    revertOnly: boolean,
  ): void {
    if (typeof document === "undefined") return;
    if (!revertOnly) {
      for (const [trackedIframe, listener] of this.iframeLoadListeners) {
        if (trackedIframe.isConnected === false) {
          trackedIframe.removeEventListener("load", listener);
          this.iframeLoadListeners.delete(trackedIframe);
        }
      }
    }
    const iframes = document.querySelectorAll<HTMLIFrameElement>("iframe");
    for (const iframe of Array.from(iframes)) {
      if (iframe.closest(".ml-gallery-host, .ml-drawer-root")) continue;
      if (!revertOnly && !this.iframeLoadListeners.has(iframe)) {
        const onLoad = () => {
          if (!this.stopped) {
            this.schedulePass();
          }
        };
        this.iframeLoadListeners.set(iframe, onLoad);
        iframe.addEventListener("load", onLoad);
      }
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) continue;
        if (revertOnly) {
          this.revertContainer(doc.documentElement);
        } else {
          this.decorateContainer(doc.documentElement, activeCharIds);
        }
      } catch {
        // Cross-origin or inaccessible iframe
      }
    }
  }

  /**
   * Determines the "original" value for a swapped attribute. We remember both the original
   * value and the value we wrote (`applied`). If the live value no longer equals what we
   * wrote, the host (e.g. React) changed it, so the live value becomes the new original and
   * our stale bookkeeping is discarded.
   */
  private resolveBase(el: Element, name: string, current: string): string {
    const orig = el.getAttribute(`data-ml-original-${name}`);
    const applied = el.getAttribute(`data-ml-applied-${name}`);
    if (orig !== null && applied !== null && current === applied) {
      return orig;
    }
    if (orig !== null) {
      el.removeAttribute(`data-ml-original-${name}`);
    }
    if (applied !== null) {
      el.removeAttribute(`data-ml-applied-${name}`);
    }
    return current;
  }

  private markApplied(el: Element, name: string, original: string, applied: string): void {
    if (el.getAttribute(`data-ml-original-${name}`) !== original) {
      el.setAttribute(`data-ml-original-${name}`, original);
    }
    if (el.getAttribute(`data-ml-applied-${name}`) !== applied) {
      el.setAttribute(`data-ml-applied-${name}`, applied);
    }
  }

  private clearManaged(el: Element, name: string): void {
    el.removeAttribute(`data-ml-original-${name}`);
    el.removeAttribute(`data-ml-applied-${name}`);
  }

  private decorateUrlAttribute(
    el: Element,
    attrName: string,
    activeCharIds: string[],
  ): boolean {
    const safeKey = attrName.replace(":", "-");
    const currentVal = el.getAttribute(attrName) ?? "";
    const baseVal = this.resolveBase(el, safeKey, currentVal);
    if (!baseVal) return false;

    const localUrl = this.resolveLocalUrl(baseVal, activeCharIds);
    if (localUrl) {
      let changed = false;
      if (currentVal !== localUrl) {
        el.setAttribute(attrName, localUrl);
        changed = true;
      }
      this.markApplied(el, safeKey, baseVal, localUrl);
      return changed;
    } else if (currentVal !== baseVal) {
      el.setAttribute(attrName, baseVal);
      this.clearManaged(el, safeKey);
      return true;
    }
    return false;
  }

  private rewriteSrcset(
    srcsetText: string,
    activeCharIds: string[],
  ): { replaced: string; changed: boolean } {
    let changed = false;
    const parts = srcsetText.split(",").map((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) return segment;
      const tokens = trimmed.split(/\s+/);
      const rawUrl = tokens[0] ?? "";
      const localUrl = this.resolveLocalUrl(rawUrl, activeCharIds);
      if (!localUrl) return segment;
      changed = true;
      return [localUrl, ...tokens.slice(1)].join(" ");
    });
    return { replaced: parts.join(", "), changed };
  }

  private decorateMediaElement(
    el: Element,
    activeCharIds: string[],
  ): void {
    // 1. Handle `src`
    const srcChanged = this.decorateUrlAttribute(el, "src", activeCharIds);
    if (
      srcChanged &&
      typeof HTMLSourceElement !== "undefined" &&
      el instanceof HTMLSourceElement &&
      typeof HTMLVideoElement !== "undefined" &&
      el.parentElement instanceof HTMLVideoElement
    ) {
      try {
        el.parentElement.load();
      } catch {
        // ignore
      }
    }

    // 2. Handle `data-src`
    if (el.hasAttribute("data-src") || el.hasAttribute("data-ml-original-data-src")) {
      this.decorateUrlAttribute(el, "data-src", activeCharIds);
    }

    // 3. Handle `srcset` on <img> / <source>
    if (el.hasAttribute("srcset") || el.hasAttribute("data-ml-original-srcset")) {
      const currentSrcset = el.getAttribute("srcset") ?? "";
      const baseSrcset = this.resolveBase(el, "srcset", currentSrcset);
      if (baseSrcset) {
        const { replaced, changed } = this.rewriteSrcset(baseSrcset, activeCharIds);
        if (changed) {
          if (currentSrcset !== replaced) {
            el.setAttribute("srcset", replaced);
          }
          this.markApplied(el, "srcset", baseSrcset, replaced);
        } else if (currentSrcset !== baseSrcset) {
          el.setAttribute("srcset", baseSrcset);
          this.clearManaged(el, "srcset");
        }
      }
    }

    // 4. Handle SVG `<image href="..." xlink:href="...">`
    if (el.tagName.toLowerCase() === "image") {
      if (el.hasAttribute("href") || el.hasAttribute("data-ml-original-href")) {
        this.decorateUrlAttribute(el, "href", activeCharIds);
      }
      if (el.hasAttribute("xlink:href") || el.hasAttribute("data-ml-original-xlink-href")) {
        this.decorateUrlAttribute(el, "xlink:href", activeCharIds);
      }
    }

    // 5. Handle `poster` on <video>
    if (typeof HTMLVideoElement !== "undefined" && el instanceof HTMLVideoElement) {
      this.decorateUrlAttribute(el, "poster", activeCharIds);
    }
  }

  private rewriteCssUrls(cssText: string, activeCharIds: string[]): { replaced: string; changed: boolean } {
    let changed = false;
    const replaced = cssText.replace(
      CSS_URL_RE,
      (fullMatch, dQuoted, sQuoted, unquoted) => {
        const raw = dQuoted ?? sQuoted ?? unquoted ?? "";
        if (!raw) return fullMatch;
        const localUrl = this.resolveLocalUrl(raw, activeCharIds);
        if (!localUrl) return fullMatch;
        changed = true;
        return `url("${localUrl}")`;
      },
    );
    return { replaced, changed };
  }

  decorateContainer(root: ParentNode, activeCharIds: string[]): void {
    // 1. Media elements: <img>, <image>, <video>, <source>
    const mediaEls = root.querySelectorAll<Element>(
      "img[src], img[data-src], img[srcset], image[href], image[*|href], video[src], video[poster], source[src], source[srcset], [data-ml-original-src], [data-ml-original-data-src], [data-ml-original-srcset], [data-ml-original-href], [data-ml-original-xlink-href], [data-ml-original-poster]",
    );
    for (const el of Array.from(mediaEls)) {
      if (el.closest(".ml-gallery-host, .ml-drawer-root")) continue;
      this.decorateMediaElement(el, activeCharIds);
    }

    // 2. Inline style="...url(...)..."
    const styledEls = root.querySelectorAll<HTMLElement>(
      '[style*="url("], [data-ml-original-style]',
    );
    for (const el of Array.from(styledEls)) {
      if (el.closest(".ml-gallery-host, .ml-drawer-root")) continue;
      const currentStyle = el.getAttribute("style") ?? "";
      const baseStyle = this.resolveBase(el, "style", currentStyle);
      if (!baseStyle) continue;

      const { replaced, changed } = this.rewriteCssUrls(baseStyle, activeCharIds);
      if (changed) {
        if (currentStyle !== replaced) {
          el.setAttribute("style", replaced);
        }
        // Read back: the browser may have normalized the serialized value
        this.markApplied(el, "style", baseStyle, el.getAttribute("style") ?? replaced);
      } else if (currentStyle !== baseStyle) {
        el.setAttribute("style", baseStyle);
        this.clearManaged(el, "style");
      }
    }

    // 3. Scoped <style> tags inside messages / creator notes
    const styleTags = root.querySelectorAll<HTMLStyleElement>("style");
    for (const styleEl of Array.from(styleTags)) {
      const currentCss = styleEl.textContent ?? "";
      const baseCss = this.resolveBase(styleEl, "css", currentCss);
      if (!baseCss || !baseCss.includes("url(")) continue;

      const { replaced, changed } = this.rewriteCssUrls(baseCss, activeCharIds);
      if (changed) {
        if (currentCss !== replaced) {
          styleEl.textContent = replaced;
        }
        this.markApplied(styleEl, "css", baseCss, replaced);
      } else if (currentCss !== baseCss) {
        styleEl.textContent = baseCss;
        this.clearManaged(styleEl, "css");
      }
    }
  }

  revertContainer(root: ParentNode): void {
    const revertAttr = (attrName: string) => {
      const safeKey = attrName.replace(":", "-");
      const els = root.querySelectorAll<Element>(`[data-ml-original-${safeKey}]`);
      for (const el of Array.from(els)) {
        const orig = el.getAttribute(`data-ml-original-${safeKey}`);
        const applied = el.getAttribute(`data-ml-applied-${safeKey}`);
        // Only restore if the live value is still ours; otherwise the host owns it now
        if (orig !== null && (applied === null || el.getAttribute(attrName) === applied)) {
          el.setAttribute(attrName, orig);
        }
        this.clearManaged(el, safeKey);
      }
    };

    revertAttr("src");
    revertAttr("data-src");
    revertAttr("srcset");
    revertAttr("href");
    revertAttr("xlink:href");
    revertAttr("poster");
    revertAttr("style");

    const cssTags = root.querySelectorAll<HTMLStyleElement>("[data-ml-original-css]");
    for (const el of Array.from(cssTags)) {
      const orig = el.getAttribute("data-ml-original-css");
      const applied = el.getAttribute("data-ml-applied-css");
      if (orig !== null && (applied === null || el.textContent === applied)) {
        el.textContent = orig;
      }
      this.clearManaged(el, "css");
    }
  }
}
