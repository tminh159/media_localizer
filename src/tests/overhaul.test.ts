import { describe, expect, test } from "bun:test";
import { MediaIndexStore, type UserStorageAPI } from "../core/index-store.ts";
import {
  buildEffectiveFilter,
  isOverrideEmpty,
  sanitizeOverride,
} from "../shared/download-config.ts";
import { buildLibraryMedia } from "../shared/library-media.ts";
import {
  DEFAULT_SETTINGS,
  NATIVE_EXPRESSION_SENTINEL,
  type LibraryMediaCharacter,
  type LocalizedAssetEntry,
  type MediaLocalizerSettings,
} from "../shared/types.ts";
import { LibraryGalleryView } from "../ui/library-gallery.ts";
import { PortraitPanelLocalizeController } from "../ui/portrait-button.ts";

function createMemoryStorageWithInitial(
  initial: Record<string, string>,
): { storage: UserStorageAPI; files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  const storage: UserStorageAPI = {
    async exists(relPath: string) {
      return files.has(relPath);
    },
    async read(relPath: string) {
      return files.get(relPath) ?? null;
    },
    async write(relPath: string, data: string | Uint8Array) {
      files.set(
        relPath,
        typeof data === "string" ? data : new TextDecoder().decode(data),
      );
    },
    async move(src: string, dest: string) {
      const v = files.get(src);
      if (v !== undefined) {
        files.set(dest, v);
        files.delete(src);
      }
    },
    async delete(relPath: string) {
      files.delete(relPath);
    },
  } as unknown as UserStorageAPI;
  return { storage, files };
}

describe("download-config helpers", () => {
  test("sanitizeOverride filters invalid values and detects empty overrides", () => {
    const clean = sanitizeOverride({
      sections: ["creator_notes", "bogus_sec", "creator_notes"],
      mediaKinds: ["video", "invalid"],
      domains: [" Example.COM ", ""],
      greetingIndices: [-1, 0, 2.7, 2],
      excludedUrls: [" https://a.com/1.png ", ""],
      includeFailed: false,
      maxItems: 12.9,
    });

    expect(clean.sections).toEqual(["creator_notes"]);
    expect(clean.mediaKinds).toEqual(["video"]);
    expect(clean.domains).toEqual(["example.com"]);
    expect(clean.greetingIndices).toEqual([0, 2]);
    expect(clean.excludedUrls).toEqual(["https://a.com/1.png"]);
    expect(clean.includeFailed).toBe(false);
    expect(clean.maxItems).toBe(12);
    expect(isOverrideEmpty(clean)).toBe(false);
    expect(isOverrideEmpty(sanitizeOverride({}))).toBe(true);
  });

  test("buildEffectiveFilter merges global defaults with per-card overrides", () => {
    const settings: MediaLocalizerSettings = {
      ...DEFAULT_SETTINGS,
      defaultSections: ["first_mes", "core_fields"],
      defaultMediaKinds: ["image"],
      defaultIncludeFailed: false,
      defaultBatchCap: 30,
      maxFileSizeMb: 10,
      timeoutSeconds: 15,
      concurrency: 3,
    };

    const baseFilter = buildEffectiveFilter(settings);
    expect(baseFilter.sections).toEqual(["first_mes", "core_fields"]);
    expect(baseFilter.mediaKinds).toEqual(["image"]);
    expect(baseFilter.includeFailed).toBe(false);
    expect(baseFilter.maxItems).toBe(30);
    expect(baseFilter.maxFileSizeBytes).toBe(10 * 1024 * 1024);
    expect(baseFilter.timeoutMs).toBe(15_000);
    expect(baseFilter.concurrency).toBe(3);

    const customFilter = buildEffectiveFilter(settings, undefined, {
      sections: ["world_books"],
      includeFailed: true,
      maxItems: 5,
      worldBookIds: ["wb-1"],
      excludedUrls: ["https://cdn.example.com/skip.png"],
    });
    expect(customFilter.sections).toEqual(["world_books"]);
    expect(customFilter.mediaKinds).toEqual(["image"]);
    expect(customFilter.includeFailed).toBe(true);
    expect(customFilter.maxItems).toBe(5);
    expect(customFilter.worldBookIds).toEqual(["wb-1"]);
    expect(customFilter.excludedUrls).toEqual(["https://cdn.example.com/skip.png"]);
  });
});

describe("buildLibraryMedia", () => {
  test("groups avatars, deduplicated localized assets, and native expressions cleanly", () => {
    const assets: Record<string, LocalizedAssetEntry> = {
      "https://cdn.example.com/scene.png": {
        normalizedUrl: "https://cdn.example.com/scene.png",
        rawUrls: ["https://cdn.example.com/scene.png"],
        imageId: "img-scene",
        localUrl: "/api/v1/images/img-scene",
        mimeType: "image/png",
        sizeBytes: 2048,
        filename: "scene.png",
        characterIds: ["char-1"],
        localizedAt: 200,
      },
      "https://cdn.example.com/joy.png": {
        normalizedUrl: "https://cdn.example.com/joy.png",
        rawUrls: ["https://cdn.example.com/joy.png"],
        imageId: "expr-joy-id",
        localUrl: "/api/v1/images/expr-joy-id",
        mimeType: "image/png",
        sizeBytes: 1024,
        filename: "joy.png",
        characterIds: ["char-1"],
        galleryItemIds: { "char-1": NATIVE_EXPRESSION_SENTINEL },
        localizedAt: 100,
      },
    };

    const rows = buildLibraryMedia(
      [
        {
          id: "char-1",
          name: "Aurelia",
          image_id: "avatar-aurelia",
          extensions: {
            expressions: {
              mappings: { joy: "expr-joy-id", sad: "expr-sad-id" },
            },
            expression_groups: {
              casual: { smile: "expr-smile-id" },
            },
          },
        },
        {
          id: "char-empty",
          name: "Empty Card",
          image_id: "avatar-empty",
          extensions: null,
        },
      ],
      assets,
    );

    expect(rows.length).toBe(1);
    const aurelia = rows[0]!;
    expect(aurelia.avatarUrl).toBe("/api/v1/images/avatar-aurelia");
    // expr-joy-id is already present as an expression, so it should not duplicate inside localizedAssets
    expect(aurelia.localizedAssets.map((a) => a.imageId)).toEqual(["img-scene"]);
    expect(aurelia.expressions.length).toBe(3);
    expect(aurelia.expressions.map((e) => e.label)).toEqual([
      "joy",
      "sad",
      "smile",
    ]);
    expect(aurelia.expressions[2]?.groupName).toBe("casual");
    expect(aurelia.totalSizeBytes).toBe(3072);
    expect(aurelia.lastLocalizedAt).toBe(200);

    const withEmpty = buildLibraryMedia(
      [{ id: "char-empty", name: "Empty Card", image_id: "avatar-empty" }],
      assets,
      { includeEmpty: true },
    );
    expect(withEmpty.length).toBe(1);
    expect(withEmpty[0]?.avatarUrl).toBe("/api/v1/images/avatar-empty");
  });
});

describe("MediaIndexStore overrides, auto-localize guard, and legacy compatibility", () => {
  test("ignores removed Display Swap fields in legacy media_index.json without errors", async () => {
    const legacyJson = JSON.stringify({
      version: 1,
      settings: {
        globalEnabled: false,
        defaultSections: ["creator_notes"],
        defaultBatchCap: 25,
      },
      characterEnabled: { "char-legacy": false },
      assets: {},
      failedUrls: {},
    });

    const { storage, files } = createMemoryStorageWithInitial({
      "media_index.json": legacyJson,
    });
    const store = new MediaIndexStore(storage);
    const state = await store.getState("user-1");

    expect(state.settings.defaultSections).toEqual(["creator_notes"]);
    expect(state.settings.defaultBatchCap).toBe(25);
    expect(state.settings.defaultMediaKinds).toEqual(["image", "video"]);
    expect(state.characterOverrides).toEqual({});
    expect(state.autoLocalizedCharacterIds).toEqual([]);
    expect(
      Array.from(files.keys()).some((k) => k.includes("corrupt")),
    ).toBe(false);
  });

  test("persists per-character overrides and triggers markAutoLocalized only once", async () => {
    const { storage } = createMemoryStorageWithInitial({});
    const store = new MediaIndexStore(storage);

    await store.setCharacterOverride("u1", "c1", {
      sections: ["first_mes"],
      includeFailed: false,
      excludedUrls: ["https://cdn.example.com/skip.png"],
    });

    let loaded = await store.getState("u1");
    expect(loaded.characterOverrides["c1"]?.sections).toEqual(["first_mes"]);
    expect(loaded.characterOverrides["c1"]?.includeFailed).toBe(false);

    // Clearing override returns state back to global defaults
    await store.setCharacterOverride("u1", "c1", null);
    loaded = await store.getState("u1");
    expect(loaded.characterOverrides["c1"]).toBeUndefined();

    expect(await store.markAutoLocalized("u1", "c1")).toBe(true);
    expect(await store.markAutoLocalized("u1", "c1")).toBe(false);
  });
});

interface MockDomElement {
  tagName: string;
  className: string;
  type?: string;
  value: string;
  selected: boolean;
  disabled: boolean;
  placeholder?: string;
  src?: string;
  loading?: string;
  decoding?: string;
  alt?: string;
  muted?: boolean;
  preload?: string;
  controls?: boolean;
  textContent: string;
  innerHTML: string;
  title: string;
  style: Record<string, string>;
  children: MockDomElement[];
  parentElement: MockDomElement | null;
  offsetParent: object | null;
  listeners: Map<string, Array<(ev: Record<string, unknown>) => void>>;
  classList: {
    add: (...cls: string[]) => void;
    remove: (...cls: string[]) => void;
    contains: (cls: string) => boolean;
  };
  setAttribute: (k: string, v: string) => void;
  appendChild: (child: MockDomElement) => MockDomElement;
  append: (...nodes: MockDomElement[]) => void;
  after: (node: MockDomElement) => void;
  replaceWith: (node: MockDomElement) => void;
  remove: () => void;
  contains: (other: unknown) => boolean;
  querySelector: (selector: string) => MockDomElement | null;
  getClientRects: () => unknown[];
  addEventListener: (
    type: string,
    fn: (ev: Record<string, unknown>) => void,
  ) => void;
  dispatch: (type: string, extra?: Record<string, unknown>) => Record<string, unknown>;
  readonly nextElementSibling: MockDomElement | null;
}

function createMockElement(tag: string): MockDomElement {
  const classes = new Set<string>();
  let classNameValue = "";
  let innerHtmlValue = "";
  const el: MockDomElement = {
    tagName: tag.toUpperCase(),
    get className() {
      return classNameValue;
    },
    set className(val: string) {
      classNameValue = val;
      classes.clear();
      for (const c of val.split(/\s+/).filter(Boolean)) classes.add(c);
    },
    value: "",
    selected: false,
    disabled: false,
    textContent: "",
    get innerHTML() {
      return innerHtmlValue;
    },
    set innerHTML(val: string) {
      innerHtmlValue = val;
      if (val === "") {
        for (const c of el.children) c.parentElement = null;
        el.children = [];
      }
    },
    title: "",
    style: {},
    children: [],
    parentElement: null,
    offsetParent: null,
    listeners: new Map(),
    classList: {
      add: (...cls: string[]) => {
        for (const c of cls) classes.add(c);
      },
      remove: (...cls: string[]) => {
        for (const c of cls) classes.delete(c);
      },
      contains: (cls: string) => classes.has(cls),
    },
    setAttribute: () => {},
    appendChild(child: MockDomElement) {
      if (child.parentElement) {
        const idx = child.parentElement.children.indexOf(child);
        if (idx >= 0) child.parentElement.children.splice(idx, 1);
      }
      child.parentElement = el;
      el.children.push(child);
      if (el.tagName === "SELECT" && child.selected && !el.value) {
        el.value = child.value;
      }
      return child;
    },
    append(...nodes: MockDomElement[]) {
      for (const node of nodes) {
        el.appendChild(node);
      }
    },
    after(node: MockDomElement) {
      const parent = el.parentElement;
      if (!parent) return;
      if (node.parentElement) {
        const oldIdx = node.parentElement.children.indexOf(node);
        if (oldIdx >= 0) node.parentElement.children.splice(oldIdx, 1);
      }
      const idx = parent.children.indexOf(el);
      node.parentElement = parent;
      parent.children.splice(idx + 1, 0, node);
    },
    replaceWith(node: MockDomElement) {
      const parent = el.parentElement;
      if (!parent) return;
      const idx = parent.children.indexOf(el);
      if (idx >= 0) {
        el.parentElement = null;
        node.parentElement = parent;
        parent.children.splice(idx, 1, node);
      }
    },
    remove() {
      if (!el.parentElement) return;
      const idx = el.parentElement.children.indexOf(el);
      if (idx >= 0) el.parentElement.children.splice(idx, 1);
      el.parentElement = null;
    },
    contains(other: unknown): boolean {
      if (other === el) return true;
      return el.children.some((c) => c.contains(other));
    },
    querySelector(selector: string) {
      if (selector.includes("name")) {
        return el.children.find((c) => c.className.includes("name")) ?? null;
      }
      const classMatch = selector.startsWith(".") ? selector.slice(1) : null;
      const walk = (node: MockDomElement): MockDomElement | null => {
        for (const child of node.children) {
          if (classMatch && child.className.split(/\s+/).includes(classMatch)) {
            return child;
          }
          const nested = walk(child);
          if (nested) return nested;
        }
        return null;
      };
      return classMatch ? walk(el) : null;
    },
    getClientRects() {
      return el.offsetParent ? [{}] : [];
    },
    addEventListener(type: string, fn: (ev: Record<string, unknown>) => void) {
      const arr = el.listeners.get(type) ?? [];
      arr.push(fn);
      el.listeners.set(type, arr);
    },
    dispatch(type: string, extra: Record<string, unknown> = {}) {
      let defaultPrevented = false;
      let propagationStopped = false;
      const ev: Record<string, unknown> = {
        type,
        preventDefault: () => {
          defaultPrevented = true;
        },
        stopPropagation: () => {
          propagationStopped = true;
        },
        ...extra,
      };
      for (const fn of el.listeners.get(type) ?? []) {
        fn(ev);
      }
      return { defaultPrevented, propagationStopped };
    },
    get nextElementSibling() {
      if (!el.parentElement) return null;
      const idx = el.parentElement.children.indexOf(el);
      return idx >= 0 ? (el.parentElement.children[idx + 1] ?? null) : null;
    },
  } as unknown as MockDomElement;
  return el;
}

describe("PortraitPanelLocalizeController interactions", () => {
  test("targets visible panel and triggers onOpenCharacterTab on right-click", async () => {
    const prevDoc = (globalThis as { document?: unknown }).document;
    const hiddenPanel = createMockElement("div");
    const visiblePanel = createMockElement("div");
    visiblePanel.offsetParent = {};
    const nameEl = createMockElement("span");
    nameEl.className = "PortraitPanel_name_123";
    visiblePanel.appendChild(nameEl);

    const panels = [hiddenPanel, visiblePanel];
    (globalThis as { document: unknown }).document = {
      createElement: (tag: string) => createMockElement(tag),
      createElementNS: (_ns: string, tag: string) => createMockElement(tag),
      querySelectorAll: (selector: string) =>
        selector.includes("panelOuter") ? panels : [],
    };

    try {
      const opened: string[] = [];
      const localized: string[] = [];
      const controller = new PortraitPanelLocalizeController({
        getActiveCharacterId: () => "char-1",
        getPendingCount: () => 3,
        getQueueProgress: () => ({
          status: "idle",
          jobId: null,
          totalQueued: 0,
          completedCount: 0,
          succeededCount: 0,
          skippedCount: 0,
          failedCount: 0,
          activeUrls: [],
          recentErrors: [],
          cappedByLimit: false,
          skippedByCapCount: 0,
        }),
        onLocalizeActiveCharacter: async (charId) => {
          localized.push(charId);
        },
        onOpenCharacterTab: (charId) => {
          opened.push(charId);
        },
      });

      controller.sync();

      expect(hiddenPanel.children.length).toBe(0);
      expect(visiblePanel.children.length).toBe(2);
      const wrap = visiblePanel.children[1];
      const btn = wrap?.children[0];
      expect(wrap?.className).toBe("ml-portrait-localize-wrap");
      expect(btn?.className).toBe("ml-portrait-localize-btn");

      // Mouse right-click: pointerdown button=2 followed by contextmenu
      btn?.dispatch("pointerdown", { pointerType: "mouse", button: 2 });
      const ctxRes = btn?.dispatch("contextmenu");
      expect(ctxRes?.defaultPrevented).toBe(true);
      expect(ctxRes?.propagationStopped).toBe(true);
      expect(opened).toEqual(["char-1"]);
      expect(localized).toEqual([]);

      // Primary left-click still localizes
      btn?.dispatch("click");
      await Promise.resolve();
      expect(localized).toEqual(["char-1"]);
    } finally {
      if (prevDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDoc;
      }
    }
  });
});

function findMockElements(
  root: MockDomElement,
  predicate: (el: MockDomElement) => boolean,
): MockDomElement[] {
  const out: MockDomElement[] = [];
  const walk = (node: MockDomElement) => {
    if (predicate(node)) out.push(node);
    for (const c of node.children) walk(c);
  };
  walk(root);
  return out;
}

describe("LibraryGalleryView filters, sorting direction, random, and All Cards", () => {
  test("supports multi-select media toggles, All Media reset, Asc/Desc arrow, Random sort, and All Cards toggle", async () => {
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document: unknown }).document = {
      createElement: (tag: string) => createMockElement(tag),
      createElementNS: (_ns: string, tag: string) => createMockElement(tag),
      querySelectorAll: () => [],
    };

    try {
      const loadCalls: Array<boolean> = [];
      const mediaChars: LibraryMediaCharacter[] = [
        {
          characterId: "c-zeta",
          characterName: "Zeta",
          avatarImageId: "av-z",
          avatarUrl: "/api/v1/images/av-z",
          localizedAssets: [
            {
              normalizedUrl: "https://example.com/z.mp4",
              rawUrls: ["https://example.com/z.mp4"],
              imageId: "vid-z",
              localUrl: "/api/v1/images/vid-z",
              mimeType: "video/mp4",
              filename: "z.mp4",
              sizeBytes: 500,
              localizedAt: 200,
              characterIds: ["c-zeta"],
              galleryItemIds: {},
            },
          ],
          expressions: [],
          totalSizeBytes: 500,
          lastLocalizedAt: 200,
        },
        {
          characterId: "c-alpha",
          characterName: "Alpha",
          avatarImageId: "av-a",
          avatarUrl: "/api/v1/images/av-a",
          localizedAssets: [
            {
              normalizedUrl: "https://example.com/a.png",
              rawUrls: ["https://example.com/a.png"],
              imageId: "img-a",
              localUrl: "/api/v1/images/img-a",
              mimeType: "image/png",
              filename: "a.png",
              sizeBytes: 100,
              localizedAt: 100,
              characterIds: ["c-alpha"],
              galleryItemIds: {},
            },
          ],
          expressions: [
            {
              label: "happy",
              imageId: "exp-a",
              localUrl: "/api/v1/images/exp-a",
            },
          ],
          totalSizeBytes: 100,
          lastLocalizedAt: 100,
        },
      ];
      const emptyChar: LibraryMediaCharacter = {
        characterId: "c-middle",
        characterName: "Middle Empty",
        avatarImageId: "av-m",
        avatarUrl: "/api/v1/images/av-m",
        localizedAssets: [],
        expressions: [],
        totalSizeBytes: 0,
        lastLocalizedAt: 0,
      };

      const root = createMockElement("div");
      const gallery = new LibraryGalleryView(root as unknown as HTMLElement, {
        onLoadLibraryMedia: async (opts) => {
          const includeEmpty = Boolean(opts?.includeEmpty);
          loadCalls.push(includeEmpty);
          return includeEmpty ? [...mediaChars, emptyChar] : [...mediaChars];
        },
        onPurgeAsset: async () => {},
      });

      await gallery.ensureLoaded();
      expect(loadCalls).toEqual([false]);

      const getCardNames = () =>
        findMockElements(root, (el) => el.className.includes("ml-char-card-name")).map(
          (el) => el.textContent,
        );
      const getButtonByLabel = (label: string) =>
        findMockElements(
          root,
          (el) =>
            el.tagName === "BUTTON" &&
            (el.textContent === label ||
              el.children.some((c) => c.tagName === "SPAN" && c.textContent === label)),
        )[0];

      // Default Sort: Name ascending => Alpha, Zeta (empty card excluded)
      expect(getCardNames()).toEqual(["Alpha", "Zeta"]);

      // Click ascending/descending arrow button next to Sort => flips to Zeta, Alpha
      const ascBtn = findMockElements(root, (el) =>
        el.title.includes("Ascending order"),
      )[0];
      expect(ascBtn).toBeDefined();
      ascBtn?.dispatch("click");
      expect(getCardNames()).toEqual(["Zeta", "Alpha"]);

      // Toggle Videos OFF => Zeta (only has video + avatar) stays only if Avatars is ON,
      // then toggle Avatars OFF too => Zeta disappears; Alpha stays.
      getButtonByLabel("Videos")?.dispatch("click");
      expect(getButtonByLabel("All Media")?.className.includes("is-selected")).toBe(
        false,
      );
      getButtonByLabel("Avatars")?.dispatch("click");
      expect(getCardNames()).toEqual(["Alpha"]);

      // Clicking All Media turns everything back ON
      getButtonByLabel("All Media")?.dispatch("click");
      expect(getButtonByLabel("All Media")?.className.includes("is-selected")).toBe(
        true,
      );
      expect(getCardNames()).toEqual(["Zeta", "Alpha"]);

      // Toggle All Cards ON => fetches with includeEmpty: true and renders Middle Empty too
      getButtonByLabel("All Cards")?.dispatch("click");
      await new Promise((r) => setTimeout(r, 0));
      expect(loadCalls).toEqual([false, true]);
      expect(getCardNames()).toEqual(["Zeta", "Middle Empty", "Alpha"]);

      // Toggle All Cards OFF => hides Middle Empty again cleanly
      getButtonByLabel("All Cards")?.dispatch("click");
      expect(getCardNames()).toEqual(["Zeta", "Alpha"]);

      // Switch Sort to Random => displays shuffle button and randomizes each time clicked
      const prevRandom = Math.random;
      let seq = [0.9, 0.1, 0.1, 0.9];
      let idx = 0;
      Math.random = () => seq[idx++ % seq.length] ?? 0.5;
      try {
        const sortSelect = findMockElements(root, (el) => el.tagName === "SELECT")[0]!;
        sortSelect.value = "random";
        sortSelect.dispatch("change");
        const firstRandomOrder = getCardNames();
        expect(firstRandomOrder).toEqual(["Zeta", "Alpha"]);

        const shuffleBtn = findMockElements(root, (el) =>
          el.title.includes("Randomize list again"),
        )[0];
        expect(shuffleBtn).toBeDefined();
        shuffleBtn?.dispatch("click");
        const secondRandomOrder = getCardNames();
        expect(secondRandomOrder).toEqual(["Alpha", "Zeta"]);
        expect(secondRandomOrder).not.toEqual(firstRandomOrder);
      } finally {
        Math.random = prevRandom;
      }
    } finally {
      if (prevDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDoc;
      }
    }
  });
});
