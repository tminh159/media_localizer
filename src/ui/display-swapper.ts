import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { ActiveDisplayUrlMapPayload } from "../shared/types.ts";
import { decodeHtmlEntities, parseSrcsetCandidates } from "../shared/url-scanner.ts";
import { sanitizeSafeMediaUrl } from "./ui-helpers.ts";

const CSS_URL_RE = /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/gi;
const SWAPPABLE_MEDIA_TAGS = new Set([
  "img",
  "video",
  "audio",
  "source",
  "image",
]);

function isElementNode(
  node: Node | EventTarget | null | undefined,
): node is Element {
  return Boolean(node && (node as Node).nodeType === 1);
}

function isSwappableMediaElement(
  target: EventTarget | null | undefined,
): target is Element {
  if (!isElementNode(target)) return false;
  const tag =
    typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  return SWAPPABLE_MEDIA_TAGS.has(tag);
}

interface TrackedIframeDoc {
  doc: Document;
  observer: MutationObserver | null;
  errorListener: ((e: Event) => void) | null;
}

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
  private readonly iframeDocTrackers = new Map<
    HTMLIFrameElement,
    TrackedIframeDoc
  >();

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
        if (isSwappableMediaElement(event.target)) {
          this.decorateMediaElement(event.target, this.getActiveCharacterIds());
        }
      };
      document.addEventListener("error", this.errorListener, true);
    }
  }

  /** Filters out mutations caused by our own writes or that cannot affect swappable media. */
  private isRelevantMutation(r: MutationRecord): boolean {
    const target = r.target;
    const targetEl = isElementNode(target)
      ? target
      : (target?.parentElement ?? null);
    if (targetEl?.closest?.(".ml-gallery-host, .ml-drawer-root")) return false;

    if (r.type === "attributes" && isElementNode(target)) {
      const name = r.attributeName ?? "";
      if (name === "style") {
        const style = target.getAttribute("style") ?? "";
        return (
          style.toLowerCase().includes("url(") ||
          target.hasAttribute("data-ml-original-style")
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
      return targetEl?.tagName?.toLowerCase() === "style";
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
    for (const iframe of Array.from(this.iframeDocTrackers.keys())) {
      this.cleanupIframeDocTracker(iframe);
    }
    if (typeof document !== "undefined" && document.body) {
      this.revertContainer(document.body);
      this.processSameOriginIframes([], true);
    }
  }

  updateMap(next: ActiveDisplayUrlMapPayload): void {
    if (!next || typeof next !== "object") return;
    const nextUpdatedAt =
      typeof next.updatedAt === "number" && Number.isFinite(next.updatedAt)
        ? next.updatedAt
        : 0;
    if (nextUpdatedAt < this.payload.updatedAt) {
      return;
    }
    this.payload = {
      characterUrlMaps: next.characterUrlMaps ?? {},
      allUrlsMap: next.allUrlsMap ?? {},
      updatedAt: nextUpdatedAt,
    };
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

  private cleanupIframeDocTracker(iframe: HTMLIFrameElement): void {
    const tracked = this.iframeDocTrackers.get(iframe);
    if (!tracked) return;
    tracked.observer?.disconnect();
    if (tracked.errorListener) {
      try {
        tracked.doc.removeEventListener?.("error", tracked.errorListener, true);
      } catch {
        // Ignore inaccessible or torn-down iframe document
      }
    }
    this.iframeDocTrackers.delete(iframe);
  }

  private ensureIframeDocListeners(
    iframe: HTMLIFrameElement,
    doc: Document,
  ): void {
    const existing = this.iframeDocTrackers.get(iframe);
    if (existing && existing.doc === doc) {
      return;
    }
    if (existing) {
      this.cleanupIframeDocTracker(iframe);
    }

    let observer: MutationObserver | null = null;
    const observeRoot = doc.documentElement ?? doc.body;
    if (typeof MutationObserver !== "undefined" && observeRoot) {
      observer = new MutationObserver((records) => {
        if (!this.stopped && records.some((r) => this.isRelevantMutation(r))) {
          this.schedulePass();
        }
      });
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "src",
          "data-src",
          "srcset",
          "href",
          "xlink:href",
          "poster",
          "style",
          "srcdoc",
        ],
      });
    }

    let errorListener: ((e: Event) => void) | null = null;
    if (typeof doc.addEventListener === "function") {
      errorListener = (event: Event) => {
        if (this.stopped) return;
        if (isSwappableMediaElement(event.target)) {
          this.decorateMediaElement(event.target, this.getActiveCharacterIds());
        }
      };
      doc.addEventListener("error", errorListener, true);
    }

    this.iframeDocTrackers.set(iframe, { doc, observer, errorListener });
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
      for (const trackedIframe of Array.from(this.iframeDocTrackers.keys())) {
        if (trackedIframe.isConnected === false) {
          this.cleanupIframeDocTracker(trackedIframe);
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
        if (!doc || !doc.body) {
          this.cleanupIframeDocTracker(iframe);
          continue;
        }
        const root = doc.documentElement ?? doc.body;
        if (revertOnly) {
          this.revertContainer(root);
        } else {
          this.ensureIframeDocListeners(iframe, doc);
          this.decorateContainer(root, activeCharIds);
        }
      } catch {
        // Cross-origin or inaccessible iframe
        this.cleanupIframeDocTracker(iframe);
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
    const candidates = parseSrcsetCandidates(srcsetText);
    if (candidates.length === 0) {
      return { replaced: srcsetText, changed: false };
    }
    let changed = false;
    const parts = candidates.map((candidate) => {
      const localUrl = this.resolveLocalUrl(candidate.url, activeCharIds);
      const effectiveUrl = localUrl ?? candidate.url;
      if (localUrl && localUrl !== candidate.url) {
        changed = true;
      }
      return candidate.descriptors
        ? `${effectiveUrl} ${candidate.descriptors}`
        : effectiveUrl;
    });
    return { replaced: changed ? parts.join(", ") : srcsetText, changed };
  }

  private decorateMediaElement(
    el: Element,
    activeCharIds: string[],
  ): void {
    // 1. Handle `src`
    const srcChanged = this.decorateUrlAttribute(el, "src", activeCharIds);
    const elTag = el.tagName?.toLowerCase() ?? "";
    const parentTag = el.parentElement?.tagName?.toLowerCase() ?? "";
    if (
      srcChanged &&
      elTag === "source" &&
      (parentTag === "video" || parentTag === "audio")
    ) {
      try {
        (el.parentElement as HTMLMediaElement).load?.();
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
    if (elTag === "image") {
      if (el.hasAttribute("href") || el.hasAttribute("data-ml-original-href")) {
        this.decorateUrlAttribute(el, "href", activeCharIds);
      }
      if (el.hasAttribute("xlink:href") || el.hasAttribute("data-ml-original-xlink-href")) {
        this.decorateUrlAttribute(el, "xlink:href", activeCharIds);
      }
    }

    // 5. Handle `poster` on <video>
    if (elTag === "video") {
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
        if (!localUrl || /[\s"'\\<>()\u0000-\u001f\u007f]/.test(localUrl)) {
          return fullMatch;
        }
        changed = true;
        return `url("${localUrl}")`;
      },
    );
    return { replaced, changed };
  }

  decorateContainer(root: ParentNode, activeCharIds: string[]): void {
    // 1. Media elements: <img>, <image>, <video>, <audio>, <source>
    const mediaEls = root.querySelectorAll<Element>(
      "img[src], img[data-src], img[srcset], image[href], image[*|href], video[src], video[data-src], video[poster], audio[src], audio[data-src], source[src], source[data-src], source[srcset], [data-ml-original-src], [data-ml-original-data-src], [data-ml-original-srcset], [data-ml-original-href], [data-ml-original-xlink-href], [data-ml-original-poster]",
    );
    for (const el of Array.from(mediaEls)) {
      if (el.closest(".ml-gallery-host, .ml-drawer-root")) continue;
      this.decorateMediaElement(el, activeCharIds);
    }

    // 2. Inline style="...url(...)..." (case-insensitive `URL(`)
    const styledEls = root.querySelectorAll<HTMLElement>(
      "[style], [data-ml-original-style]",
    );
    for (const el of Array.from(styledEls)) {
      if (el.closest(".ml-gallery-host, .ml-drawer-root")) continue;
      const currentStyle = el.getAttribute("style") ?? "";
      if (
        !currentStyle.toLowerCase().includes("url(") &&
        !el.hasAttribute("data-ml-original-style")
      ) {
        continue;
      }
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
      if (styleEl.closest(".ml-gallery-host, .ml-drawer-root")) continue;
      const currentCss = styleEl.textContent ?? "";
      if (
        !currentCss.toLowerCase().includes("url(") &&
        !styleEl.hasAttribute("data-ml-original-css")
      ) {
        continue;
      }
      const baseCss = this.resolveBase(styleEl, "css", currentCss);
      if (!baseCss || !baseCss.toLowerCase().includes("url(")) continue;

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
