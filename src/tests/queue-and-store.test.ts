import { describe, expect, test } from "bun:test";
import type { CharacterDTO, SpindleAPI } from "lumiverse-spindle-types";
import { detectMediaMimeType, downloadAndStoreMedia } from "../core/downloader.ts";
import {
  reconcileCharacterGalleryWithIndex,
  refreshScanResultWithIndexState,
} from "../core/gallery-reconciler.ts";
import { MediaIndexStore, type UserStorageAPI } from "../core/index-store.ts";
import { UserDownloadQueue } from "../core/queue.ts";
import { triggerNativeGalleryAndPortraitReactRefresh } from "../frontend.ts";
import { scanCharacterMedia } from "../shared/url-scanner.ts";

function createMemoryStorage(): UserStorageAPI {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      const val = files.get(path);
      if (val === undefined) throw new Error(`ENOENT: ${path}`);
      return val;
    },
    async write(path: string, data: string | Uint8Array) {
      files.set(
        path,
        typeof data === "string" ? data : new TextDecoder().decode(data),
      );
    },
    async exists(path: string) {
      return files.has(path);
    },
    async delete(path: string) {
      files.delete(path);
    },
    async list() {
      return Array.from(files.keys());
    },
    async move(fromPath: string, toPath: string) {
      const val = files.get(fromPath);
      if (val === undefined) throw new Error(`ENOENT: ${fromPath}`);
      files.set(toPath, val);
      files.delete(fromPath);
    },
    async stat(path: string) {
      const val = files.get(path);
      if (val === undefined) return null;
      return { size: val.length, mtimeMs: Date.now(), isDirectory: false };
    },
    async getJson<T = unknown>(path: string, opts?: { fallback?: T }) {
      const val = files.get(path);
      if (val === undefined) return opts?.fallback as T;
      return JSON.parse(val) as T;
    },
    async setJson(path: string, value: unknown) {
      files.set(path, JSON.stringify(value, null, 2));
    },
  } as unknown as UserStorageAPI;
}

describe("downloader & index-store & queue", () => {
  test("detectMediaMimeType detects PNG/JPEG/WEBP and rejects HTML error pages", () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(detectMediaMimeType(pngBytes)).toEqual({
      mimeType: "image/png",
      ext: "png",
    });

    const htmlBytes = new TextEncoder().encode(
      "<!DOCTYPE html><html><body>404 Not Found</body></html>",
    );
    expect(() => detectMediaMimeType(htmlBytes, "text/html")).toThrow(
      /HTML page/,
    );
  });

  test("MediaIndexStore tracks multi-character references, HTML entity variants, and orphaned imageIds", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const userId = "user-1";

    await store.recordLocalizedAsset(userId, {
      normalizedUrl: "https://example.com/img.png?a=1&b=2",
      rawUrls: ["https://example.com/img.png?a=1&amp;b=2"],
      imageId: "img-shared",
      localUrl: "/api/v1/images/img-shared",
      mimeType: "image/png",
      sizeBytes: 1024,
      filename: "img.png",
      characterIds: ["char-A"],
      localizedAt: Date.now(),
    });

    await store.linkExistingAssetToCharacter(
      userId,
      "https://example.com/img.png?a=1&b=2",
      ["https://example.com/img.png?a=1&b=2"],
      "char-B",
    );

    const mapPayload = await store.buildActiveDisplayUrlMap(userId);
    expect(
      mapPayload.characterUrlMaps["char-A"]?.[
        "https://example.com/img.png?a=1&amp;b=2"
      ],
    ).toBe("/api/v1/images/img-shared");
    expect(
      mapPayload.characterUrlMaps["char-B"]?.[
        "https://example.com/img.png?a=1&b=2"
      ],
    ).toBe("/api/v1/images/img-shared");

    // Removing char-A should NOT orphan img-shared because char-B still uses it
    const resA = await store.removeCharacterAssets(userId, "char-A");
    expect(resA.orphanedImageIds).toEqual([]);

    // Removing char-B SHOULD orphan img-shared
    const resB = await store.removeCharacterAssets(userId, "char-B");
    expect(resB.orphanedImageIds).toEqual(["img-shared"]);
  });

  test("UserDownloadQueue enforces batch caps and supports cancelAll", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    let uploadedSeq = 0;

    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);

    const mockSpindle = {
      files: {
        async fetch(_url: string, opts: { signal?: AbortSignal }) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 15);
            opts.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
          return {
            fileId: "staged-1",
            size: pngBytes.byteLength,
            mimeType: "image/png",
          };
        },
        async readChunk(_src: unknown, offset: number) {
          if (offset > 0) {
            return {
              data: new Uint8Array(0),
              offset,
              size: pngBytes.byteLength,
              eof: true,
            };
          }
          return {
            data: pngBytes,
            offset: 0,
            size: pngBytes.byteLength,
            eof: true,
          };
        },
        async delete() {},
      },
      images: {
        async get() {
          return null;
        },
        async upload() {
          const id = `up-${++uploadedSeq}`;
          return {
            id,
            url: `/api/v1/images/${id}`,
            mime_type: "image/png",
          };
        },
      },
    } as unknown as SpindleAPI;

    const updates: string[] = [];
    const queue = new UserDownloadQueue(
      "user-1",
      mockSpindle,
      store,
      (_uid, prog) => {
        updates.push(prog.status);
      },
    );

    const tasks = Array.from({ length: 10 }, (_, idx) => ({
      characterId: "char-1",
      characterName: "Test",
      normalizedUrl: `https://example.com/pic_${idx}.png`,
      rawUrls: [`https://example.com/pic_${idx}.png`],
    }));

    const initial = await queue.startOrAppendBatch({
      userId: "user-1",
      tasks,
      maxItems: 3,
      maxFileSizeBytes: 5 * 1024 * 1024,
      timeoutMs: 5000,
      concurrency: 1,
    });

    expect(initial.totalQueued).toBe(3);
    expect(initial.cappedByLimit).toBe(true);
    expect(initial.skippedByCapCount).toBe(7);

    // Wait for completion
    while (queue.getProgress().status === "running") {
      await new Promise((r) => setTimeout(r, 10));
    }

    const finalProg = queue.getProgress();
    expect(finalProg.status).toBe("completed");
    expect(finalProg.succeededCount).toBe(3);
    expect(updates).toContain("completed");
  });

  test("reconcileCharacterGalleryWithIndex adopts native Gallery images downloaded while extension was off and unlinks removed Gallery items", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const userId = "user-1";

    const character = {
      id: "char-gallery-1",
      name: "Seraphina",
      first_mes: "![Opening](https://files.catbox.moe/opening_banner.png)",
      creator_notes: "<img src='https://cdn.example.com/custom_art.webp'>",
      alternate_greetings: ["![Scene](https://files.catbox.moe/scene_two.jpg)"],
    } as unknown as CharacterDTO;

    const initialScan = scanCharacterMedia(character, [], [], {
      localizedByNormalizedUrl: new Map(),
      failedByNormalizedUrl: new Map(),
    });
    expect(initialScan.items.every((i) => i.status === "remote")).toBe(true);

    // Simulate images that were added to the native Gallery while Media Localizer was off:
    // 1. `img-ext-1` and `img-ext-2` via native `/gallery/extract` (`extracted.png`, `extracted.webp`)
    // 2. `img-named-3` via filename match (`scene_two.jpg`)
    let galleryRows = [
      {
        id: "gal-1",
        character_id: "char-gallery-1",
        image_id: "img-ext-1",
        caption: "",
        sort_order: 0,
        created_at: "2026-11-12T00:00:01Z",
        url: "/api/v1/images/img-ext-1",
        mime_type: "image/png",
      },
      {
        id: "gal-2",
        character_id: "char-gallery-1",
        image_id: "img-ext-2",
        caption: "",
        sort_order: 1,
        created_at: "2026-11-12T00:00:02Z",
        url: "/api/v1/images/img-ext-2",
        mime_type: "image/webp",
      },
      {
        id: "gal-3",
        character_id: "char-gallery-1",
        image_id: "img-named-3",
        caption: "scene_two.jpg",
        sort_order: 2,
        created_at: "2026-11-12T00:00:03Z",
        url: "/api/v1/images/img-named-3",
        mime_type: "image/jpeg",
      },
    ];

    const imageRows = [
      {
        id: "img-ext-1",
        original_filename: "extracted.png",
        mime_type: "image/png",
        byte_size: 4096,
        created_at: "2026-11-12T00:00:01Z",
      },
      {
        id: "img-ext-2",
        original_filename: "extracted.webp",
        mime_type: "image/webp",
        byte_size: 8192,
        created_at: "2026-11-12T00:00:02Z",
      },
      {
        id: "img-named-3",
        original_filename: "scene_two.jpg",
        mime_type: "image/jpeg",
        byte_size: 12288,
        created_at: "2026-11-12T00:00:03Z",
      },
    ];

    const mockSpindle = {
      characters: {
        async getGallery() {
          return galleryRows;
        },
      },
      images: {
        async list() {
          return { data: imageRows };
        },
        async get(id: string) {
          return imageRows.find((r) => r.id === id) ?? null;
        },
      },
    } as unknown as SpindleAPI;

    const rec1 = await reconcileCharacterGalleryWithIndex(
      mockSpindle,
      store,
      userId,
      character,
      initialScan.items,
    );

    expect(rec1.adoptedCount).toBe(3);
    expect(rec1.indexChanged).toBe(true);
    expect(rec1.pendingGalleryLinks.length).toBe(0);

    const stateAfterAdopt = await store.getState(userId);
    refreshScanResultWithIndexState(
      initialScan,
      stateAfterAdopt.assets,
      stateAfterAdopt.failedUrls,
    );

    expect(initialScan.items.every((i) => i.status === "localized")).toBe(true);
    expect(
      stateAfterAdopt.assets["https://files.catbox.moe/opening_banner.png"]?.imageId,
    ).toBe("img-ext-1");
    expect(
      stateAfterAdopt.assets["https://cdn.example.com/custom_art.webp"]?.imageId,
    ).toBe("img-ext-2");
    expect(
      stateAfterAdopt.assets["https://files.catbox.moe/scene_two.jpg"]?.imageId,
    ).toBe("img-named-3");

    // Now simulate the user deleting `gal-2` (`img-ext-2`) from the native Gallery while the extension is off
    galleryRows = galleryRows.filter((g) => g.id !== "gal-2");
    const rec2 = await reconcileCharacterGalleryWithIndex(
      mockSpindle,
      store,
      userId,
      character,
      initialScan.items,
    );
    expect(rec2.prunedCount).toBe(1);

    const stateAfterPrune = await store.getState(userId);
    refreshScanResultWithIndexState(
      initialScan,
      stateAfterPrune.assets,
      stateAfterPrune.failedUrls,
    );
    const customArtItem = initialScan.items.find(
      (i) => i.normalizedUrl === "https://cdn.example.com/custom_art.webp",
    );
    expect(customArtItem?.status).toBe("remote");
  });

  test("downloadAndStoreMedia deduplicates byte-identical images already in the native Gallery via readBinary", async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb, 0xcc, 0xdd,
    ]);
    let uploadCalled = false;

    const mockSpindle = {
      files: {
        async fetch() {
          return {
            fileId: "staged-dup",
            size: pngBytes.byteLength,
            mimeType: "image/png",
          };
        },
        async readChunk() {
          return {
            data: pngBytes,
            offset: 0,
            size: pngBytes.byteLength,
            eof: true,
          };
        },
        async delete() {},
      },
      images: {
        async readBinary(id: string) {
          if (id === "existing-gallery-img-99") return pngBytes;
          return null;
        },
        async upload() {
          uploadCalled = true;
          return {
            id: "newly-uploaded",
            url: "/api/v1/images/newly-uploaded",
            mime_type: "image/png",
          };
        },
      },
    } as unknown as SpindleAPI;

    const entry = await downloadAndStoreMedia(mockSpindle, {
      userId: "user-1",
      characterId: "char-1",
      normalizedUrl: "https://example.com/obfuscated_hash.png",
      rawUrls: ["https://example.com/obfuscated_hash.png"],
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 5000,
      unmatchedGalleryCandidates: [
        {
          imageId: "existing-gallery-img-99",
          galleryItemId: "gal-row-99",
          byteSize: pngBytes.byteLength,
          mimeType: "image/png",
        },
      ],
    });

    expect(uploadCalled).toBe(false);
    expect(entry.imageId).toBe("existing-gallery-img-99");
    expect(entry.galleryItemIds?.["char-1"]).toBe("gal-row-99");
  });

  test("detectMediaMimeType rejects non-media bodies instead of defaulting to PNG", () => {
    const json = new TextEncoder().encode('{"error":"nope"}');
    expect(() =>
      detectMediaMimeType(json, "application/json", "https://x.com/a.png"),
    ).toThrow(/Unsupported response content-type/);
    expect(() =>
      detectMediaMimeType(json, "text/plain", "https://x.com/a.png"),
    ).toThrow(/Unsupported response content-type/);
    expect(() => detectMediaMimeType(json, undefined, "https://x.com/file")).toThrow(
      /Unrecognized media format/,
    );
    // JSON error bodies must NOT bypass via octet-stream + media extension
    expect(() =>
      detectMediaMimeType(json, "application/octet-stream", "https://x.com/a.webp"),
    ).toThrow(/JSON/i);
    // CDNs that serve binary bytes as octet-stream still work via the URL extension
    const binaryBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    expect(
      detectMediaMimeType(binaryBytes, "application/octet-stream", "https://x.com/a.webp")
        .mimeType,
    ).toBe("image/webp");
  });

  test("MediaIndexStore avoids caching undefined userId and cleans character metadata only on full character removal", async () => {
    const storage = createMemoryStorage();
    const store = new MediaIndexStore(storage);

    await store.recordLocalizedAsset("default", {
      normalizedUrl: "https://example.com/a.png",
      rawUrls: ["https://example.com/a.png"],
      imageId: "img-a",
      localUrl: "/api/v1/images/img-a",
      mimeType: "image/png",
      sizeBytes: 100,
      filename: "a.png",
      characterIds: ["char-1"],
      localizedAt: 1,
    });
    const undefinedMap = await store.buildActiveDisplayUrlMap(undefined);
    expect(undefinedMap.allUrlsMap["https://example.com/a.png"]).toBe("/api/v1/images/img-a");
    expect((store as unknown as { cache: Map<string, unknown> }).cache.has(undefined as unknown as string)).toBe(false);

    await store.setCharacterOverride("u1", "char-1", { sections: ["first_mes"] });
    await store.markAutoLocalized("u1", "char-1");
    await store.recordLocalizedAsset("u1", {
      normalizedUrl: "https://example.com/b.png",
      rawUrls: ["https://example.com/b.png"],
      imageId: "img-b",
      localUrl: "/api/v1/images/img-b",
      mimeType: "image/png",
      sizeBytes: 100,
      filename: "b.png",
      characterIds: ["char-1"],
      localizedAt: 2,
    });

    // Partial URL removal keeps override & autoLocalized status
    await store.removeCharacterAssets("u1", "char-1", ["https://example.com/b.png"]);
    let st = await store.getState("u1");
    expect(st.characterOverrides["char-1"]).toBeDefined();
    expect(st.autoLocalizedCharacterIds).toContain("char-1");

    // Full character removal clears override & autoLocalized status
    await store.removeCharacterAssets("u1", "char-1");
    st = await store.getState("u1");
    expect(st.characterOverrides["char-1"]).toBeUndefined();
    expect(st.autoLocalizedCharacterIds).not.toContain("char-1");
  });

  test("downloadAndStoreMedia fails on truncated staged files", async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const mockSpindle = {
      files: {
        async fetch() {
          return { fileId: "f", size: pngBytes.byteLength + 50, mimeType: "image/png" };
        },
        async readChunk() {
          return { data: pngBytes, offset: 0, size: pngBytes.byteLength + 50, eof: true };
        },
        async delete() {},
      },
      images: {
        async upload() {
          throw new Error("must not upload truncated data");
        },
      },
    } as unknown as SpindleAPI;
    await expect(
      downloadAndStoreMedia(mockSpindle, {
        userId: "u",
        characterId: "c",
        normalizedUrl: "https://x.com/a.png",
        rawUrls: [],
        maxBytes: 1024 * 1024,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/incomplete/);
  });

  test("MediaIndexStore backs up a corrupt index, sanitizes entries and shares concurrent loads", async () => {
    const storage = createMemoryStorage();
    await storage.write("media_index.json", "{ not json", "u1");
    const store = new MediaIndexStore(storage);
    const [a, b] = await Promise.all([store.getState("u1"), store.getState("u1")]);
    expect(a).toBe(b);
    const files = await storage.list("", "u1");
    expect(files.some((f: string) => f.startsWith("media_index.corrupt-"))).toBe(true);
    expect(a.settings.deleteImagesOnPurge).toBe(true);
    expect(a.settings.autoLinkGallery).toBe(true);
    expect(a.settings.adoptNativeGalleryImages).toBe(true);

    const storage2 = createMemoryStorage();
    await storage2.write(
      "media_index.json",
      JSON.stringify({
        version: 1,
        assets: {
          "https://x.com/ok.png": { imageId: "i1" },
          "https://x.com/bad.png": { nope: true },
        },
      }),
      "u1",
    );
    const state = await new MediaIndexStore(storage2).getState("u1");
    expect(Object.keys(state.assets)).toEqual(["https://x.com/ok.png"]);
    expect(state.assets["https://x.com/ok.png"]?.characterIds).toEqual([]);
  });

  function makePngSpindle(opts: { delayMs: number; onUpload?: (id: string) => void }) {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    let seq = 0;
    const deleted: string[] = [];
    const spindle = {
      files: {
        async fetch(_url: string, o: { signal?: AbortSignal }) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, opts.delayMs);
            o.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
          return { fileId: "f", size: pngBytes.byteLength, mimeType: "image/png" };
        },
        async readChunk(_s: unknown, offset: number) {
          return offset > 0
            ? { data: new Uint8Array(0), offset, size: pngBytes.byteLength, eof: true }
            : { data: pngBytes, offset: 0, size: pngBytes.byteLength, eof: true };
        },
        async delete() {},
      },
      images: {
        async get(id: string) {
          return id.startsWith("up-") ? { id } : null;
        },
        async upload() {
          const id = `up-${++seq}`;
          opts.onUpload?.(id);
          return { id, url: `/api/v1/images/${id}`, mime_type: "image/png" };
        },
        async deleteMany(ids: string[]) {
          deleted.push(...ids);
        },
      },
    } as unknown as SpindleAPI;
    return { spindle, deleted, uploads: () => seq };
  }

  async function waitForIdle(queue: UserDownloadQueue) {
    for (let i = 0; i < 200; i++) {
      const s = queue.getProgress().status;
      if (s === "completed" || s === "cancelled") return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("queue did not finish");
  }

  test("queue downloads a URL shared by several characters only once", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const mock = makePngSpindle({ delayMs: 20 });
    const queue = new UserDownloadQueue("u1", mock.spindle, store, () => {});
    const url = "https://example.com/shared_banner.png";
    await queue.startOrAppendBatch({
      userId: "u1",
      tasks: ["A", "B", "C"].map((c) => ({
        characterId: c,
        characterName: c,
        normalizedUrl: url,
        rawUrls: [url],
      })),
      maxItems: 0,
      maxFileSizeBytes: 5 * 1024 * 1024,
      timeoutMs: 5000,
      concurrency: 3,
    });
    await waitForIdle(queue);
    expect(mock.uploads()).toBe(1);
    const state = await store.getState("u1");
    expect(state.assets[url]?.characterIds.sort()).toEqual(["A", "B", "C"]);
    expect(queue.getProgress().succeededCount).toBe(3);
  });

  test("starting a batch while cancelling does not revive the cancelled job", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const mock = makePngSpindle({ delayMs: 40 });
    const queue = new UserDownloadQueue("u1", mock.spindle, store, () => {});
    const mk = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        characterId: "c1",
        characterName: "c1",
        normalizedUrl: `https://example.com/${prefix}_${i}.png`,
        rawUrls: [`https://example.com/${prefix}_${i}.png`],
      }));
    const base = {
      userId: "u1",
      maxItems: 0,
      maxFileSizeBytes: 5 * 1024 * 1024,
      timeoutMs: 5000,
      concurrency: 2,
    };
    await queue.startOrAppendBatch({ ...base, tasks: mk("old", 6) });
    await new Promise((r) => setTimeout(r, 10));
    queue.cancelAll();
    await queue.startOrAppendBatch({ ...base, tasks: mk("new", 2) });
    await waitForIdle(queue);
    const p = queue.getProgress();
    expect(p.status).toBe("completed");
    expect(p.totalQueued).toBe(2);
    expect(p.succeededCount).toBe(2);
    expect(p.completedCount).toBe(2);
    const state = await store.getState("u1");
    expect(Object.keys(state.assets).every((u) => u.includes("/new_"))).toBe(true);
  });

  test("reconciler does not bind unrelated extracted.* images to URLs with incompatible types", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const character = {
      id: "char-x",
      name: "X",
      first_mes: "![a](https://cdn.example.com/photo.jpg)",
      extensions: {},
    } as unknown as CharacterDTO;
    const scan = scanCharacterMedia(
      character as never,
      [],
      [],
      {
        localizedByNormalizedUrl: new Map(),
        failedByNormalizedUrl: new Map(),
      },
    );
    const spindle = {
      characters: {
        async getGallery() {
          return [
            {
              id: "g1",
              character_id: "char-x",
              image_id: "img-png",
              caption: "",
              sort_order: 0,
              created_at: "2026-01-01",
              mime_type: "image/png",
            },
          ];
        },
      },
      images: {
        async list() {
          return {
            data: [
              {
                id: "img-png",
                original_filename: "extracted.png",
                mime_type: "image/png",
              },
            ],
          };
        },
        async get(id: string) {
          return { id, original_filename: "extracted.png", mime_type: "image/png" };
        },
      },
    } as unknown as SpindleAPI;
    const res = await reconcileCharacterGalleryWithIndex(
      spindle,
      store,
      "u1",
      character,
      scan.items,
    );
    expect(res.adoptedCount).toBe(0);
    expect((await store.getState("u1")).assets).toEqual({});
  });

  test("MediaIndexStore.buildActiveDisplayUrlMap exposes assets for all owning characters without display-swap gating", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const userId = "user-1";

    await store.recordLocalizedAsset(userId, {
      normalizedUrl: "https://example.com/exclusive_char_a.png",
      rawUrls: ["https://example.com/exclusive_char_a.png"],
      imageId: "img-a",
      localUrl: "/api/v1/images/img-a",
      mimeType: "image/png",
      sizeBytes: 512,
      filename: "exclusive_char_a.png",
      characterIds: ["char-A"],
      localizedAt: Date.now(),
    });

    const mapForA = await store.buildActiveDisplayUrlMap(userId);
    expect(mapForA.characterUrlMaps["char-A"]?.["https://example.com/exclusive_char_a.png"]).toBe(
      "/api/v1/images/img-a",
    );
    expect(mapForA.allUrlsMap["https://example.com/exclusive_char_a.png"]).toBe(
      "/api/v1/images/img-a",
    );

    await store.linkExistingAssetToCharacter(
      userId,
      "https://example.com/exclusive_char_a.png",
      ["https://example.com/exclusive_char_a.png"],
      "char-B",
    );
    const mapWithCharB = await store.buildActiveDisplayUrlMap(userId);
    expect(mapWithCharB.characterUrlMaps["char-B"]?.["https://example.com/exclusive_char_a.png"]).toBe(
      "/api/v1/images/img-a",
    );
  });

  test("downloadAndStoreMedia decodes base64 string body from spindle.cors fallback", async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04,
    ]);
    let binaryStr = "";
    for (let i = 0; i < pngBytes.length; i++) {
      binaryStr += String.fromCharCode(pngBytes[i]!);
    }
    const base64Body = btoa(binaryStr);

    let uploadedBytes: Uint8Array | undefined;
    const mockSpindle = {
      cors: async () => ({
        status: 200,
        headers: { "content-type": "image/png" },
        body: base64Body,
      }),
      images: {
        async upload(input: { data?: Uint8Array }) {
          uploadedBytes = input.data;
          return {
            id: "cors-b64-img",
            url: "/api/v1/images/cors-b64-img",
            mime_type: "image/png",
          };
        },
      },
    } as unknown as SpindleAPI;

    const entry = await downloadAndStoreMedia(mockSpindle, {
      userId: "u1",
      characterId: "c1",
      normalizedUrl: "https://example.com/cors_fallback.png",
      rawUrls: ["https://example.com/cors_fallback.png"],
      maxBytes: 1024 * 1024,
      timeoutMs: 5000,
    });

    expect(entry.imageId).toBe("cors-b64-img");
    expect(uploadedBytes).toEqual(pngBytes);
  });

  test("reconcileCharacterGalleryWithIndex adopts already-downloaded native expression images without adding them to pendingGalleryLinks or deleting them on purge", async () => {
    const store = new MediaIndexStore(createMemoryStorage());
    const joyUrl = "https://avatars.charhub.io/avatars/joy_sprite.png";
    const character = {
      id: "char-expr",
      name: "Chloe",
      // The author also referenced the joy expression URL directly in creator_notes
      creator_notes: `![Joy](${joyUrl})`,
      extensions: {
        chub: {
          expressions: {
            expressions: {
              joy: joyUrl,
              anger: "https://avatars.charhub.io/avatars/anger_sprite.png",
            },
          },
        },
        expressions: {
          enabled: true,
          defaultExpression: "joy",
          mappings: {
            joy: "native-expr-joy-id",
            anger: "native-expr-anger-id",
          },
        },
      },
    } as unknown as CharacterDTO;

    const scan = scanCharacterMedia(
      character as never,
      [],
      [],
      {
        localizedByNormalizedUrl: new Map(),
        failedByNormalizedUrl: new Map(),
      },
    );
    // Only joyUrl (from creator_notes) is scanned; anger_sprite in chub.expressions is ignored
    expect(scan.items.map((i) => i.normalizedUrl)).toEqual([joyUrl]);

    const spindle = {
      characters: {
        async getGallery() {
          return [];
        },
      },
      images: {
        async list() {
          return {
            data: [
              {
                id: "native-expr-joy-id",
                original_filename: "chub-expression-0.png",
                mime_type: "image/png",
                byte_size: 4096,
              },
            ],
            total: 1,
          };
        },
        async get(id: string) {
          if (id === "native-expr-joy-id") {
            return {
              id: "native-expr-joy-id",
              original_filename: "chub-expression-0.png",
              mime_type: "image/png",
              byte_size: 4096,
            };
          }
          return null;
        },
      },
    } as unknown as SpindleAPI;

    const rec = await reconcileCharacterGalleryWithIndex(
      spindle,
      store,
      "u1",
      character,
      scan.items,
    );

    expect(rec.adoptedCount).toBe(1);
    // Must NOT queue native expression sprites into character_gallery
    expect(rec.pendingGalleryLinks).toEqual([]);

    const state = await store.getState("u1");
    expect(state.assets[joyUrl]?.imageId).toBe("native-expr-joy-id");
    expect(state.assets[joyUrl]?.localUrl).toBe("/api/v1/images/native-expr-joy-id");

    // Purging character cache must unlink the URL without marking the native expression image for deletion
    const purged = await store.removeCharacterAssets("u1", "char-expr");
    expect(purged.removedCount).toBe(1);
    expect(purged.orphanedImageIds).toEqual([]);
    expect(purged.removedImageIds).toEqual([]);
    expect(purged.removedGalleryItemIds).toEqual([]);
  });

  test("triggerNativeGalleryAndPortraitReactRefresh invokes both unminified and minified gallery hooks", () => {
    const prevDoc = (globalThis as Record<string, unknown>).document;
    let minifiedEditorCalls = 0;
    let minifiedPortraitCalls = 0;
    let pickerCallbackCalls = 0;

    // Simulate minified CharacterEditorPage fetchGallery useCallback
    const minifiedFetchGallery = function () {
      const y = "char-1";
      const I = {
        list: (_id: string) => ({
          then: (cb: (items: Array<{ id: string; image_id: string }>) => void) => {
            cb([]);
            return { catch: (_fn?: () => void) => {} };
          },
        }),
      };
      const Fn = (_v: unknown) => {};
      const ee = (_id: string) => false;
      const b = (_c: string, _i: string) => false;
      y &&
        I.list(y)
          .then((e) => Fn(e.filter((e) => !ee(e.image_id) && !b(y, e.id))))
          .catch(() => {});
      minifiedEditorCalls++;
    };

    // Simulate minified ExpressionEditorTab gallery picker useCallback (must NOT be invoked)
    const minifiedOpenPicker = function () {
      const oe = (_v: boolean) => {};
      const I = {
        list: (_id: string) => ({
          then: (cb: (items: Array<{ id: string; image_id: string }>) => void) => {
            cb([]);
            return { catch: (_fn?: () => void) => {} };
          },
        }),
      };
      oe(!0);
      I.list("char-1").then((e) => e.filter((x) => Boolean(x.image_id)));
      pickerCallbackCalls++;
    };

    // Simulate minified PortraitPanel gallery useEffect
    const minifiedPortraitEffect = function () {
      const o = "char-1";
      const Ei = {
        list: (_id: string) => ({
          then: (cb: (items: Array<{ id: string; image_id: string }>) => void) => {
            cb([]);
            return { catch: (_fn?: () => void) => {} };
          },
        }),
      };
      const y = (_v: unknown) => {};
      const A = (_id: string) => false;
      const E = (_c: string, _i: string) => false;
      o &&
        Ei.list(o)
          .then((e) => y(e.filter((e) => !A(e.image_id) && !E(o, e.id))))
          .catch(() => y([]));
      minifiedPortraitCalls++;
    };

    const fakeFiber = {
      memoizedState: {
        memoizedState: [minifiedFetchGallery, ["char-1"]],
        next: {
          memoizedState: [minifiedOpenPicker, ["char-1"]],
          next: {
            memoizedState: {
              create: minifiedPortraitEffect,
              inst: { destroy: undefined },
            },
            next: null,
          },
        },
      },
      return: null,
    };

    const fakeEl = {
      __reactFiber$xyz: fakeFiber,
    };

    (globalThis as Record<string, unknown>).document = {
      querySelectorAll(selector: string) {
        if (selector.includes("galleryTab")) return [fakeEl];
        return [];
      },
    };

    try {
      triggerNativeGalleryAndPortraitReactRefresh();
      expect(minifiedEditorCalls).toBe(1);
      expect(minifiedPortraitCalls).toBe(1);
      expect(pickerCallbackCalls).toBe(0);
    } finally {
      (globalThis as Record<string, unknown>).document = prevDoc;
    }
  });

  test("compiled dist/backend.js triggers zero dangerous backend capability detectors", async () => {
    const file = Bun.file(new URL("../../dist/backend.js", import.meta.url));
    if (await file.exists()) {
      const code = await file.text();
      // Mirrors Lumiverse manager.service.ts detectDangerousBackendCapabilities patterns
      expect(/(?<![.\w$])fetch\s*(?:\?\.\s*)?\(/.test(code)).toBe(false);
      expect(/\bBun\s*\.\s*spawn(?:Sync)?\b/.test(code)).toBe(false);
      expect(/(?:from\s+["'](?:node:)?child_process["']|require\s*\(\s*["'](?:node:)?child_process["']\s*\))/.test(code)).toBe(false);
      expect(/(?<![.\w$])eval\s*\(/.test(code)).toBe(false);
      expect(/\bBuffer\s*\.\s*from\s*\([^)]*["'`]base64(?:url)?["'`]\s*\)/.test(code)).toBe(false);
    }
  });
});
