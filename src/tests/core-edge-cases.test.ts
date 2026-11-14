import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import {
    detectMediaMimeType,
    downloadAndStoreMedia,
    validateRemoteMediaUrl,
} from "../core/downloader";
import {
    reconcileCharacterGalleryWithIndex,
    refreshScanResultWithIndexState,
} from "../core/gallery-reconciler";
import { isSafeRecordKey, MediaIndexStore } from "../core/index-store";
import { MediaQueueManager, UserDownloadQueue } from "../core/queue";
import {
    NATIVE_EXPRESSION_SENTINEL,
    type CharacterMediaScanResult,
    type DiscoveredMediaItem,
    type LocalizedAssetEntry,
} from "../shared/types";
import { createMemoryStorage, type MemoryStorage } from "./helpers/mock-dom";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function wrapMemoryUserStorage(mem: MemoryStorage): SpindleAPI["userStorage"] {
    return {
        exists: (path: string) => mem.exists(path),
        read: (path: string) => mem.read(path),
        write: (path: string, content: string) => mem.write(path, content),
        delete: (path: string) => mem.delete(path),
        move: (from: string, to: string) => mem.move(from, to),
        list: (prefix?: string) => mem.list(prefix),
    } as unknown as SpindleAPI["userStorage"];
}

function createUserStorageAdapter(storeMap?: Map<string, MemoryStorage>) {
    const perUser = storeMap ?? new Map<string, MemoryStorage>();
    const getStore = (userId = "default"): MemoryStorage => {
        let s = perUser.get(userId);
        if (!s) {
            s = createMemoryStorage();
            perUser.set(userId, s);
        }
        return s;
    };

    const api = {
        exists: (path: string, userId?: string) => getStore(userId).exists(path),
        read: (path: string, userId?: string) => getStore(userId).read(path),
        write: (path: string, content: string, userId?: string) => getStore(userId).write(path, content),
        delete: (path: string, userId?: string) => getStore(userId).delete(path),
        move: (from: string, to: string, userId?: string) => getStore(userId).move(from, to),
        list: (prefix?: string, userId?: string) => getStore(userId).list(prefix),
    } as unknown as SpindleAPI["userStorage"];

    return { api, getStore };
}

async function waitForQueueTerminal(q: UserDownloadQueue, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const st = q.getProgress().status;
        if (st === "idle" || st === "completed" || st === "cancelled") return;
        await new Promise((r) => setTimeout(r, 8));
    }
    throw new Error(`Queue did not finish in ${timeoutMs}ms (status=${q.getProgress().status})`);
}

function createCoreMockSpindle(overrides: Record<string, unknown> = {}) {
    const { api: userStorage, getStore } = createUserStorageAdapter();
    let uploadCounter = 0;
    const deletedImageBatches: string[][] = [];
    const uploadedImages = new Map<string, { id: string; url: string; mime_type: string; original_filename: string; byte_size: number }>();

    const mock = {
        userStorage,
        images: {
            upload: async (dto: { data: Uint8Array; filename: string; mime_type: string }) => {
                uploadCounter++;
                const id = `img-${uploadCounter}`;
                const meta = {
                    id,
                    url: `/api/v1/images/${id}`,
                    size: dto.data.byteLength,
                    mime_type: dto.mime_type,
                    original_filename: dto.filename,
                    byte_size: dto.data.byteLength,
                };
                uploadedImages.set(id, meta);
                return meta;
            },
            deleteMany: async (ids: string[]) => {
                deletedImageBatches.push([...ids]);
                for (const id of ids) uploadedImages.delete(id);
                return { deletedCount: ids.length };
            },
            list: async () => ({ data: Array.from(uploadedImages.values()), total: uploadedImages.size }),
            get: async (id: string) => uploadedImages.get(id) ?? null,
            readBinary: async () => null,
        },
        characters: {
            getGallery: async () => [],
        },
        cors: async () => ({
            status: 200,
            headers: { "content-type": "image/png" },
            body: PNG_MAGIC.slice(),
        }),
        ...overrides,
    };

    return {
        spindle: mock as unknown as SpindleAPI,
        getStore,
        deletedImageBatches,
        getUploadCount: () => uploadCounter,
    };
}

describe("core/downloader SSRF, SVG rejection, staged chunks, and CORS guards", () => {
    test("validateRemoteMediaUrl rejects SSRF hosts, non-HTTP schemes, and userinfo before any network call", async () => {
        expect(() => validateRemoteMediaUrl("http://127.0.0.1/secret.png")).toThrow();
        expect(() => validateRemoteMediaUrl("http://0x7f000001/secret.png")).toThrow();
        expect(() => validateRemoteMediaUrl("http://[::ffff:169.254.169.254]/meta")).toThrow();
        expect(() => validateRemoteMediaUrl("https://user:pass@cdn.example.com/a.png")).toThrow();
        expect(() => validateRemoteMediaUrl("file:///etc/passwd")).toThrow();
        expect(validateRemoteMediaUrl("https://cdn.example.com/ok.png").hostname).toBe("cdn.example.com");

        let corsCalled = false;
        let filesCalled = false;
        const { spindle } = createCoreMockSpindle({
            files: {
                fetch: async () => {
                    filesCalled = true;
                    return { fileId: "f1", size: 10 };
                },
            },
            cors: async () => {
                corsCalled = true;
                return { status: 200, body: PNG_MAGIC };
            },
        });

        await expect(
            downloadAndStoreMedia(spindle, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "http://169.254.169.254/latest/meta-data",
                rawUrls: ["http://169.254.169.254/latest/meta-data"],
                maxBytes: 1024 * 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow();

        expect(corsCalled).toBe(false);
        expect(filesCalled).toBe(false);
    });

    test("detectMediaMimeType blocks SVG and script payloads across magic bytes, headers, and extensions while preserving octet-stream binary media", () => {
        const enc = new TextEncoder();
        const neutralBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

        expect(() => detectMediaMimeType(enc.encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png", "https://a.com/x.png")).toThrow(/SVG/i);
        expect(() => detectMediaMimeType(enc.encode("<!DOCTYPE svg><svg/>"), undefined, "https://a.com/x")).toThrow(/SVG/i);
        expect(() => detectMediaMimeType(enc.encode("<?xml version='1.0'?><svg/>"), "text/xml", "https://a.com/x.xml")).toThrow(/SVG/i);
        expect(() => detectMediaMimeType(enc.encode("<script>alert(1)</script>"), "text/plain", "https://a.com/x.png")).toThrow(/script/i);
        expect(() => detectMediaMimeType(neutralBytes, "image/svg+xml", "https://a.com/x.png")).toThrow(/SVG/i);
        expect(() => detectMediaMimeType(neutralBytes, "image/svg", "https://a.com/x")).toThrow(/SVG/i);
        expect(() => detectMediaMimeType(neutralBytes, "application/xhtml+xml", "https://a.com/x")).toThrow(/content-type/i);
        expect(() => detectMediaMimeType(neutralBytes, "application/javascript", "https://a.com/x")).toThrow(/content-type/i);
        expect(() => detectMediaMimeType(neutralBytes, "text/javascript", "https://a.com/x")).toThrow(/content-type/i);
        expect(() => detectMediaMimeType(neutralBytes, "application/octet-stream", "https://a.com/evil.svg")).toThrow(/SVG/i);

        // Binary asset with generic octet-stream works via magic-byte sniffing, while
        // non-media binary blobs cannot bypass validation via bare image headers/extensions
        const safePng = detectMediaMimeType(PNG_MAGIC, "application/octet-stream", "https://a.com/pic.bin");
        expect(safePng.mimeType).toBe("image/png");

        const webpMagic = new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
        ]);
        const safeWebp = detectMediaMimeType(webpMagic, "application/octet-stream", "https://a.com/pic.webp");
        expect(safeWebp.mimeType).toBe("image/webp");

        expect(() => detectMediaMimeType(neutralBytes, "image/png", "https://a.com/pic.png")).toThrow(/Unrecognized media format/i);
        expect(() => detectMediaMimeType(neutralBytes, "application/octet-stream", "https://a.com/pic.webp")).toThrow(/Unrecognized media format/i);
        expect(() => detectMediaMimeType(neutralBytes, "application/octet-stream", "https://a.com/pic.jfif")).toThrow(/Unrecognized media format/i);

        // [M-01 & L-07] Short plain-text bodies (< 8 bytes), short valid image magic bytes, and QuickTime .mov atoms
        expect(() => detectMediaMimeType(enc.encode("404"), "image/png", "https://a.com/err.png")).toThrow(/plain text/i);
        expect(() => detectMediaMimeType(enc.encode("X"), "application/octet-stream", "https://a.com/err.jpg")).toThrow(/plain text/i);
        expect(() => detectMediaMimeType(enc.encode("1234moov"), "video/quicktime", "https://a.com/fake.mov")).toThrow(/plain text/i);

        expect(detectMediaMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), undefined, "https://a.com/a.jfif")).toEqual({ mimeType: "image/jpeg", ext: "jpg" });
        expect(detectMediaMimeType(enc.encode("GIF89a"), undefined, "https://a.com/a.gif")).toEqual({ mimeType: "image/gif", ext: "gif" });
        expect(detectMediaMimeType(new Uint8Array([0x00, 0x00, 0x01, 0x00]), undefined, "https://a.com/a.ico")).toEqual({ mimeType: "image/x-icon", ext: "ico" });

        for (const atom of ["moov", "mdat", "wide", "free"]) {
            const movBytes = new Uint8Array([0x00, 0x00, 0x00, 0x10, ...enc.encode(atom), 0x00, 0x00]);
            expect(detectMediaMimeType(movBytes, "video/quicktime", "https://a.com/clip.mov")).toEqual({
                mimeType: "video/mp4",
                ext: "mp4",
            });
        }
    });

    test("staged spindle.files downloads assemble chunks cleanly and always delete staged files on error or overflow", async () => {
        const deletedFiles: string[] = [];
        const chunk1 = PNG_MAGIC.slice(0, 6);
        const chunk2 = PNG_MAGIC.slice(6);

        const { spindle } = createCoreMockSpindle({
            files: {
                fetch: async () => ({ fileId: "staged-1", size: PNG_MAGIC.byteLength, mimeType: "image/png" }),
                readChunk: async (_ref: { fileId: string }, offset: number) => {
                    if (offset === 0) return { data: chunk1, eof: false };
                    return { data: chunk2, eof: true };
                },
                delete: async (fileId: string) => {
                    deletedFiles.push(fileId);
                },
            },
        });

        const asset = await downloadAndStoreMedia(spindle, {
            userId: "u1",
            characterId: "c1",
            normalizedUrl: "https://cdn.example.com/multi.png",
            rawUrls: ["https://cdn.example.com/multi.png"],
            maxBytes: 1024 * 1024,
            timeoutMs: 5000,
        });
        expect(asset.sizeBytes).toBe(PNG_MAGIC.byteLength);
        expect(deletedFiles).toEqual(["staged-1"]);

        // 0-byte staged file -> error + delete
        const { spindle: emptySpindle } = createCoreMockSpindle({
            files: {
                fetch: async () => ({ fileId: "staged-empty", size: 0 }),
                readChunk: async () => ({ data: new Uint8Array(0), eof: true }),
                delete: async (id: string) => { deletedFiles.push(id); },
            },
        });
        await expect(
            downloadAndStoreMedia(emptySpindle, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/empty.png",
                rawUrls: ["https://cdn.example.com/empty.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/empty/i);
        expect(deletedFiles).toContain("staged-empty");

        // staged size > maxBytes -> error + delete
        const { spindle: hugeSpindle } = createCoreMockSpindle({
            files: {
                fetch: async () => ({ fileId: "staged-huge", size: 5000 }),
                readChunk: async () => ({ data: PNG_MAGIC, eof: true }),
                delete: async (id: string) => { deletedFiles.push(id); },
            },
        });
        await expect(
            downloadAndStoreMedia(hugeSpindle, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/huge.png",
                rawUrls: ["https://cdn.example.com/huge.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/exceeds limit/i);
        expect(deletedFiles).toContain("staged-huge");

        // Chunk overflow -> error + delete even when upload shouldn't run
        const { spindle: overflowSpindle, getUploadCount } = createCoreMockSpindle({
            files: {
                fetch: async () => ({ fileId: "staged-overflow", size: 4 }),
                readChunk: async () => ({ data: new Uint8Array(10), eof: true }),
                delete: async (id: string) => { deletedFiles.push(id); },
            },
        });
        await expect(
            downloadAndStoreMedia(overflowSpindle, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/overflow.png",
                rawUrls: ["https://cdn.example.com/overflow.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/exceeds declared or allowed size/i);
        expect(deletedFiles).toContain("staged-overflow");
        expect(getUploadCount()).toBe(0);

        // SVG staged payload -> blocked before images.upload
        const { spindle: svgSpindle, getUploadCount: svgUploads } = createCoreMockSpindle({
            files: {
                fetch: async () => ({ fileId: "staged-svg", size: 11, mimeType: "image/png" }),
                readChunk: async () => ({ data: new TextEncoder().encode("<svg><g/></svg>".slice(0, 11)), eof: true }),
                delete: async (id: string) => { deletedFiles.push(id); },
            },
        });
        await expect(
            downloadAndStoreMedia(svgSpindle, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/trick.png",
                rawUrls: ["https://cdn.example.com/trick.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/SVG/i);
        expect(svgUploads()).toBe(0);
    });

    test("CORS fallback enforces HTTP status, case-insensitive Content-Type, body types/caps, base64 limits, timeout, and AbortSignal cleanup", async () => {
        // 1. Non-2xx status
        const { spindle: s404 } = createCoreMockSpindle({
            cors: async () => ({ status: 404, headers: {}, body: PNG_MAGIC }),
        });
        await expect(
            downloadAndStoreMedia(s404, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/missing.png",
                rawUrls: ["https://cdn.example.com/missing.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/HTTP 404/);

        // 2. Case-insensitive Content-Type & ArrayBuffer body & ArrayBuffer > maxBytes
        const ab = PNG_MAGIC.slice().buffer;
        const { spindle: sAb } = createCoreMockSpindle({
            cors: async () => ({ status: 200, headers: { "CONTENT-TYPE": "IMAGE/PNG" }, body: ab }),
        });
        const okAb = await downloadAndStoreMedia(sAb, {
            userId: "u1",
            characterId: "c1",
            normalizedUrl: "https://cdn.example.com/ab.png",
            rawUrls: ["https://cdn.example.com/ab.png"],
            maxBytes: 1024,
            timeoutMs: 5000,
        });
        expect(okAb.mimeType).toBe("image/png");

        await expect(
            downloadAndStoreMedia(sAb, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/ab-small-cap.png",
                rawUrls: ["https://cdn.example.com/ab-small-cap.png"],
                maxBytes: 4,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/exceeds limit/);

        // 3. Unexpected body format
        const { spindle: sWeird } = createCoreMockSpindle({
            cors: async () => ({ status: 200, headers: {}, body: { weird: true } }),
        });
        await expect(
            downloadAndStoreMedia(sWeird, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/weird.png",
                rawUrls: ["https://cdn.example.com/weird.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/Unexpected response body format/);

        // 4. Base64 data URI prefix, oversized base64 string, and invalid base64
        const b64 = `data:image/png;base64,${Buffer.from(PNG_MAGIC).toString("base64")}`;
        const { spindle: sB64 } = createCoreMockSpindle({
            cors: async () => ({ status: 200, headers: { "Content-Type": "image/png" }, body: b64 }),
        });
        const okB64 = await downloadAndStoreMedia(sB64, {
            userId: "u1",
            characterId: "c1",
            normalizedUrl: "https://cdn.example.com/b64.png",
            rawUrls: ["https://cdn.example.com/b64.png"],
            maxBytes: 1024,
            timeoutMs: 5000,
        });
        expect(okB64.sizeBytes).toBe(PNG_MAGIC.byteLength);

        const oversizedB64 = "A".repeat(400);
        const { spindle: sHugeB64 } = createCoreMockSpindle({
            cors: async () => ({ status: 200, headers: {}, body: oversizedB64 }),
        });
        await expect(
            downloadAndStoreMedia(sHugeB64, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/b64-huge.png",
                rawUrls: ["https://cdn.example.com/b64-huge.png"],
                maxBytes: 64,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/exceeds limit/);

        const { spindle: sBadB64 } = createCoreMockSpindle({
            cors: async () => ({ status: 200, headers: {}, body: "%%%not_valid_base64%%%" }),
        });
        await expect(
            downloadAndStoreMedia(sBadB64, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/bad-b64.png",
                rawUrls: ["https://cdn.example.com/bad-b64.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/invalid base64/i);

        // 5. Timeout rejection
        const { spindle: sSlow } = createCoreMockSpindle({
            cors: () => new Promise(() => {}),
        });
        await expect(
            downloadAndStoreMedia(sSlow, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/slow.png",
                rawUrls: ["https://cdn.example.com/slow.png"],
                maxBytes: 1024,
                timeoutMs: 30,
            }),
        ).rejects.toThrow(/timed out/i);

        // 6. AbortSignal pre-aborted & mid-flight abort + removeEventListener verification
        const preCtrl = new AbortController();
        preCtrl.abort(new Error("already aborted"));
        await expect(
            downloadAndStoreMedia(sAb, {
                userId: "u1",
                characterId: "c1",
                normalizedUrl: "https://cdn.example.com/pre.png",
                rawUrls: ["https://cdn.example.com/pre.png"],
                maxBytes: 1024,
                timeoutMs: 5000,
                signal: preCtrl.signal,
            }),
        ).rejects.toThrow();

        const midCtrl = new AbortController();
        let removeCalls = 0;
        const origRemove = midCtrl.signal.removeEventListener.bind(midCtrl.signal);
        midCtrl.signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
            removeCalls++;
            return origRemove(...args);
        }) as AbortSignal["removeEventListener"];

        const midPromise = downloadAndStoreMedia(sSlow, {
            userId: "u1",
            characterId: "c1",
            normalizedUrl: "https://cdn.example.com/mid.png",
            rawUrls: ["https://cdn.example.com/mid.png"],
            maxBytes: 1024,
            timeoutMs: 5000,
            signal: midCtrl.signal,
        });
        setTimeout(() => midCtrl.abort(new Error("user cancelled")), 10);
        await expect(midPromise).rejects.toThrow(/user cancelled/);
        expect(removeCalls).toBeGreaterThanOrEqual(1);
    });

    test("reuses byte-identical unmatchedGalleryCandidates instead of uploading duplicate image", async () => {
        const { spindle, getUploadCount } = createCoreMockSpindle({
            images: {
                upload: async () => {
                    throw new Error("should not upload duplicate");
                },
                readBinary: async (id: string) => (id === "existing-gal-img" ? PNG_MAGIC.slice() : null),
            },
        });

        const asset = await downloadAndStoreMedia(spindle, {
            userId: "u1",
            characterId: "c1",
            normalizedUrl: "https://cdn.example.com/dup.png",
            rawUrls: ["https://cdn.example.com/dup.png"],
            maxBytes: 1024,
            timeoutMs: 5000,
            unmatchedGalleryCandidates: [
                {
                    imageId: "existing-gal-img",
                    galleryItemId: "g-item-9",
                    byteSize: PNG_MAGIC.byteLength,
                    mimeType: "image/png",
                },
            ],
        });

        expect(asset.imageId).toBe("existing-gal-img");
        expect(asset.galleryItemIds?.["c1"]).toBe("g-item-9");
        expect(getUploadCount()).toBe(0);
    });
});

describe("core/queue lifecycle, deduplication, cancellation, failure handling, and manager", () => {
    test("pause/resume stalls queued tasks and skipCurrent aborts active & drops pending shared URLs", async () => {
        const { spindle } = createCoreMockSpindle({
            cors: async (url: string) => {
                if (url.includes("slow-skip")) {
                    await new Promise((r) => setTimeout(r, 120));
                } else {
                    await new Promise((r) => setTimeout(r, 5));
                }
                return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const updates: Array<{ status: string; skipped: number; succeeded: number; completed: number }> = [];
        const q = new UserDownloadQueue("u1", spindle, store, (_uid, p) => {
            updates.push({
                status: p.status,
                skipped: p.skippedCount,
                succeeded: p.succeededCount,
                completed: p.completedCount,
            });
        });

        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                {
                    characterId: "c1",
                    characterName: "C1",
                    normalizedUrl: "https://cdn.example.com/slow-skip.png",
                    rawUrls: ["https://cdn.example.com/slow-skip.png"],
                },
                {
                    characterId: "c2",
                    characterName: "C2",
                    normalizedUrl: "https://cdn.example.com/slow-skip.png",
                    rawUrls: ["https://cdn.example.com/slow-skip.png"],
                },
                {
                    characterId: "c3",
                    characterName: "C3",
                    normalizedUrl: "https://cdn.example.com/after-resume.png",
                    rawUrls: ["https://cdn.example.com/after-resume.png"],
                },
            ],
        });

        await new Promise((r) => setTimeout(r, 10));
        expect(q.getProgress().status).toBe("running");

        // Pause before skipping; third task must wait until resume
        q.pause();
        expect(q.getProgress().status).toBe("paused");
        q.skipCurrent("https://cdn.example.com/slow-skip.png");

        await new Promise((r) => setTimeout(r, 30));
        expect(q.getProgress().succeededCount).toBe(0);
        expect(q.getProgress().skippedCount).toBe(2);

        q.resume();
        await waitForQueueTerminal(q);

        const final = q.getProgress();
        expect(final.status).toBe("completed");
        expect(final.skippedCount).toBe(2);
        expect(final.succeededCount).toBe(1);
        expect(final.completedCount).toBe(3);
    });

    test("standalone cancelAll wakes paused worker, sets cancelled status, cleans orphaned uploads, and preserves gallery-linked uploads", async () => {
        let uploadIdx = 0;
        let allowSecondFinish!: () => void;
        const firstUploadedPromise = new Promise<void>((resolve) => {
            allowSecondFinish = resolve;
        });

        const { spindle, deletedImageBatches } = createCoreMockSpindle({
            cors: async (url: string) => {
                if (url.includes("paused-block")) {
                    await new Promise((r) => setTimeout(r, 15));
                }
                return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
            },
            images: {
                upload: async () => {
                    uploadIdx++;
                    if (uploadIdx === 1) {
                        // Signal that upload happened right before cancelAll runs
                        setTimeout(() => allowSecondFinish(), 15);
                        await new Promise((r) => setTimeout(r, 30));
                    }
                    return { id: `orphan-${uploadIdx}`, url: `/api/v1/images/orphan-${uploadIdx}` };
                },
                deleteMany: async (ids: string[]) => {
                    deletedImageBatches.push([...ids]);
                    return { deletedCount: ids.length };
                },
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const q = new UserDownloadQueue("u1", spindle, store, () => {});

        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                {
                    characterId: "c1",
                    characterName: "C1",
                    normalizedUrl: "https://cdn.example.com/paused-block.png",
                    rawUrls: ["https://cdn.example.com/paused-block.png"],
                },
                {
                    characterId: "c2",
                    characterName: "C2",
                    normalizedUrl: "https://cdn.example.com/second.png",
                    rawUrls: ["https://cdn.example.com/second.png"],
                },
            ],
        });

        await firstUploadedPromise;
        const cancelled = q.cancelAll();
        expect(cancelled.status).toBe("cancelling");

        await waitForQueueTerminal(q);
        expect(q.getProgress().status).toBe("cancelled");
        expect(deletedImageBatches.flat()).toContain("orphan-1");

        // Verify reused unmatchedGalleryCandidates is NOT deleted on generation-stale cancel
        const { spindle: galSpindle, deletedImageBatches: galDeleted } = createCoreMockSpindle({
            images: {
                readBinary: async () => PNG_MAGIC.slice(),
                upload: async () => { throw new Error("unexpected upload"); },
                deleteMany: async (ids: string[]) => {
                    galDeleted.push([...ids]);
                    return { deletedCount: ids.length };
                },
            },
        });
        const galStore = new MediaIndexStore(galSpindle.userStorage);
        const q2 = new UserDownloadQueue("u1", galSpindle, galStore, () => {});
        await q2.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                {
                    characterId: "c1",
                    characterName: "C1",
                    normalizedUrl: "https://cdn.example.com/gal.png",
                    rawUrls: ["https://cdn.example.com/gal.png"],
                    unmatchedGalleryCandidates: [{ imageId: "keep-gal-id", galleryItemId: "gal-1", byteSize: PNG_MAGIC.byteLength }],
                },
            ],
        });
        q2.cancelAll();
        await waitForQueueTerminal(q2);
        expect(galDeleted.flat()).not.toContain("keep-gal-id");
    });

    test("deduplicates concurrent inFlight same-URL tasks, propagates failures without re-downloading, clamps limits, and isolates users in MediaQueueManager", async () => {
        let corsCalls = 0;
        const { spindle } = createCoreMockSpindle({
            cors: async (url: string) => {
                corsCalls++;
                await new Promise((r) => setTimeout(r, 15));
                if (url.includes("fail-shared")) {
                    return { status: 502, headers: {}, body: PNG_MAGIC };
                }
                return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const mgr = new MediaQueueManager(spindle, store, () => {});

        const q1 = mgr.getQueue("u1");
        const q2 = mgr.getQueue("u2");
        expect(q1).not.toBe(q2);

        await q1.startOrAppendBatch({
            userId: "u1",
            concurrency: 99,
            maxFileSizeBytes: 500 * 1024 * 1024,
            timeoutMs: 999_999,
            maxItems: 0,
            tasks: [
                {
                    characterId: "c1",
                    characterName: "C1",
                    normalizedUrl: "https://cdn.example.com/shared-ok.png",
                    rawUrls: ["https://cdn.example.com/shared-ok.png"],
                },
                {
                    characterId: "c2",
                    characterName: "C2",
                    normalizedUrl: "https://cdn.example.com/shared-ok.png",
                    rawUrls: ["https://cdn.example.com/shared-ok.png"],
                },
                {
                    characterId: "c3",
                    characterName: "C3",
                    normalizedUrl: "https://cdn.example.com/fail-shared.png",
                    rawUrls: ["https://cdn.example.com/fail-shared.png"],
                },
                {
                    characterId: "c4",
                    characterName: "C4",
                    normalizedUrl: "https://cdn.example.com/fail-shared.png",
                    rawUrls: ["https://cdn.example.com/fail-shared.png"],
                },
            ],
        });

        await waitForQueueTerminal(q1);

        // Exactly 1 fetch per unique normalizedUrl across concurrent workers
        expect(corsCalls).toBe(2);
        const p = q1.getProgress();
        expect(p.succeededCount).toBe(2);
        expect(p.failedCount).toBe(2);
        expect(p.completedCount).toBe(4);
        expect(p.recentErrors.some((e) => e.url.includes("fail-shared"))).toBe(true);

        const state = await store.getState("u1");
        expect(state.assets["https://cdn.example.com/shared-ok.png"]?.characterIds.sort()).toEqual(["c1", "c2"]);
        expect(state.failedUrls["https://cdn.example.com/fail-shared.png"]?.error).toContain("HTTP 502");

        // MediaQueueManager cancelAllUsers cancels all queues cleanly
        await q2.startOrAppendBatch({
            userId: "u2",
            concurrency: 1,
            maxFileSizeBytes: 1024, // below 1MB -> clamped up to 1MB
            timeoutMs: 10, // below 5000ms -> clamped up to 5000ms
            maxItems: 0,
            tasks: [
                {
                    characterId: "c5",
                    characterName: "C5",
                    normalizedUrl: "https://cdn.example.com/u2-only.png",
                    rawUrls: ["https://cdn.example.com/u2-only.png"],
                },
            ],
        });
        mgr.cancelAllUsers();
        await Promise.all([waitForQueueTerminal(q1), waitForQueueTerminal(q2)]);
        expect(q2.getProgress().status).toBe("cancelled");
    });
});

describe("core/index-store durability, .tmp cleanup, prototype safety, and mutations", () => {
    test("transient read/exists errors reject without overwriting or backing up media_index.json, while corrupt JSON is backed up and reset", async () => {
        const mem = createMemoryStorage({
            "media_index.json": JSON.stringify({
                version: 1,
                assets: {
                    "https://cdn.example.com/keep.png": {
                        normalizedUrl: "https://cdn.example.com/keep.png",
                        rawUrls: ["https://cdn.example.com/keep.png"],
                        imageId: "img-keep",
                        localUrl: "/api/v1/images/img-keep",
                        mimeType: "image/png",
                        sizeBytes: 100,
                        filename: "keep.png",
                        characterIds: ["c1"],
                        localizedAt: 10,
                    },
                },
            }),
        });
        const store = new MediaIndexStore(wrapMemoryUserStorage(mem));

        mem.failNextExists = new Error("transient io exists error");
        await expect(store.getState("u1")).rejects.toThrow(/transient io exists/);

        mem.failNextRead = new Error("transient io read error");
        await expect(store.getState("u1")).rejects.toThrow(/transient io read/);

        mem.nullNextRead = true;
        await expect(store.getState("u1")).rejects.toThrow(/returned null/);

        // No writes/backups should have occurred
        expect(mem.calls.write.length).toBe(0);
        expect(Array.from(mem.files.keys())).toEqual(["media_index.json"]);

        // Recovery succeeds and loads intact state
        const state = await store.getState("u1");
        expect(state.assets["https://cdn.example.com/keep.png"]?.imageId).toBe("img-keep");

        // Now test corrupt JSON -> backed up + reset
        const corruptMem = createMemoryStorage({ "media_index.json": "{not valid json" });
        const corruptStore = new MediaIndexStore(wrapMemoryUserStorage(corruptMem));
        const recovered = await corruptStore.getState("u1");
        expect(Object.keys(recovered.assets)).toEqual([]);
        const backupKeys = Array.from(corruptMem.files.keys()).filter((k) => k.includes(".corrupt-"));
        expect(backupKeys.length).toBe(1);
    });

    test("cleans up .tmp files in finally and keeps cache immutable when persistence fails", async () => {
        const mem = createMemoryStorage();
        const store = new MediaIndexStore(wrapMemoryUserStorage(mem));

        await store.getState("u1");

        // Fail move AND fail fallback write to media_index.json -> must throw, clean .tmp, and not mutate cache
        mem.failMoveOnPath = () => new Error("rename EPERM");
        mem.failWriteOnPath = (p) => (p === "media_index.json" ? new Error("disk full") : null);

        await expect(store.updateSettings("u1", { concurrency: 4 })).rejects.toThrow(/disk full/);

        const leftoverTmp = Array.from(mem.files.keys()).filter((k) => k.includes(".tmp-"));
        expect(leftoverTmp).toEqual([]);
        expect((await store.getState("u1")).settings.concurrency).toBe(2);

        // If move fails but fallback write succeeds, .tmp must still be cleaned up
        mem.failWriteOnPath = null;
        await store.updateSettings("u1", { concurrency: 4 });
        expect(Array.from(mem.files.keys()).filter((k) => k.includes(".tmp-"))).toEqual([]);
        expect((await store.getState("u1")).settings.concurrency).toBe(4);
    });

    test("blocks prototype-pollution keys and supports batchUpdate, clearFailedUrls, removeByImageId, unlinkByCharacterImageId, and getStorageStats", async () => {
        const mem = createMemoryStorage({
            "media_index.json": JSON.stringify({
                version: 1,
                characterOverrides: { __proto__: { maxItems: 99 }, "safe-char": { maxItems: 5 } },
                assets: { constructor: { imageId: "bad" } },
                failedUrls: { prototype: { error: "bad", lastAttemptAt: 1 } },
            }),
        });
        const store = new MediaIndexStore(wrapMemoryUserStorage(mem));

        expect(isSafeRecordKey("__proto__")).toBe(false);
        expect(isSafeRecordKey("constructor")).toBe(false);
        expect(isSafeRecordKey("prototype")).toBe(false);
        expect(isSafeRecordKey("https://cdn.example.com/a.png")).toBe(true);

        const loaded = await store.getState("u1");
        expect(({} as any).maxItems).toBeUndefined();
        expect(Object.hasOwn(loaded.characterOverrides, "__proto__")).toBe(false);
        expect(loaded.characterOverrides["safe-char"]?.maxItems).toBe(5);
        expect(Object.hasOwn(loaded.assets, "constructor")).toBe(false);

        const writesBeforeBatch = mem.calls.write.length;
        // No-op batchUpdate writes nothing
        await store.batchUpdate("u1", () => {});
        expect(mem.calls.write.length).toBe(writesBeforeBatch);

        // Multi-mutation batchUpdate persists in a single write
        await store.batchUpdate("u1", (tx) => {
            tx.recordLocalizedAsset({
                normalizedUrl: "https://cdn.example.com/a.png",
                rawUrls: ["https://cdn.example.com/a.png"],
                imageId: "img-shared",
                localUrl: "/api/v1/images/img-shared",
                mimeType: "image/png",
                sizeBytes: 2048,
                filename: "a.png",
                characterIds: ["c1", "c2"],
                localizedAt: 100,
            });
            tx.recordLocalizedAsset({
                normalizedUrl: "https://mirror.example.com/a.png",
                rawUrls: ["https://mirror.example.com/a.png"],
                imageId: "img-shared",
                localUrl: "/api/v1/images/img-shared",
                mimeType: "image/png",
                sizeBytes: 2048,
                filename: "a.png",
                characterIds: ["c1"],
                localizedAt: 120,
            });
        });
        // Single batch write (temp write + rename)
        expect(mem.calls.write.length).toBe(writesBeforeBatch + 1);

        await store.recordFailure("u1", "https://cdn.example.com/fail1.png", "404");
        await store.recordFailure("u1", "https://cdn.example.com/fail2.png", "500");

        const stats = await store.getStorageStats("u1");
        expect(stats.totalAssets).toBe(2);
        expect(stats.totalSizeBytes).toBe(2048); // shared imageId counted once
        expect(stats.totalFailedUrls).toBe(2);

        await store.clearFailedUrls("u1", ["https://cdn.example.com/fail1.png"]);
        expect(Object.keys((await store.getState("u1")).failedUrls)).toEqual(["https://cdn.example.com/fail2.png"]);

        await store.clearFailedUrls("u1");
        expect(Object.keys((await store.getState("u1")).failedUrls)).toEqual([]);

        const unlinked = await store.unlinkByCharacterImageId("u1", "c1", "img-shared");
        expect(unlinked).toBe(2);

        await store.removeByImageId("u1", "img-shared");
        expect(Object.keys((await store.getState("u1")).assets)).toEqual([]);
    });
});

describe("core/gallery-reconciler batched writes, bounded fetch, expression unlink, & failedCount refresh", () => {
    test("batches prune + Tier 0 adoption into a single batchUpdate write and preserves entries on transient images.get errors", async () => {
        const metaConcurrency: number[] = [];
        let activeGets = 0;

        const { spindle, getStore } = createCoreMockSpindle({
            characters: {
                getGallery: async () => [
                    { id: "gal-1", image_id: "img-adopted", caption: "My Caption", sort_order: 0 },
                    // Missing-metadata checks (> 12 images to test concurrency bound <= 6)
                    ...Array.from({ length: 14 }, (_, i) => ({
                        id: `gal-extra-${i}`,
                        image_id: `extra-img-${i}`,
                        caption: `Extra ${i}`,
                        sort_order: i + 1,
                    })),
                ],
            },
            images: {
                list: async () => ({ data: [], total: 0 }),
                get: async (id: string) => {
                    activeGets++;
                    metaConcurrency.push(activeGets);
                    await new Promise((r) => setTimeout(r, 8));
                    activeGets--;
                    if (id === "extra-img-0") {
                        // Transient lookup error -> should NOT treat as missing!
                        throw new Error("DB busy");
                    }
                    if (id === "missing-img-gone") {
                        // Confirmed deleted -> falsy -> pruned!
                        return null;
                    }
                    if (id === "img-adopted") {
                        return {
                            id: "img-adopted",
                            original_filename: "adopted.png",
                            mime_type: "image/png",
                            byte_size: 400,
                        };
                    }
                    return { id, original_filename: `${id}.png`, mime_type: "image/png", byte_size: 100 };
                },
            },
        });

        const store = new MediaIndexStore(spindle.userStorage);
        await store.batchUpdate("u1", (tx) => {
            // Entry pointing to deleted image -> pruned
            tx.recordLocalizedAsset({
                normalizedUrl: "https://cdn.example.com/gone.png",
                rawUrls: ["https://cdn.example.com/gone.png"],
                imageId: "missing-img-gone",
                localUrl: "/api/v1/images/missing-img-gone",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "gone.png",
                characterIds: ["c1"],
                localizedAt: 50,
            });
            // Expression sentinel entry still active vs removed expression sentinel
            tx.recordLocalizedAsset({
                normalizedUrl: "https://cdn.example.com/expr-keep.png",
                rawUrls: ["https://cdn.example.com/expr-keep.png"],
                imageId: "img-expr-keep",
                localUrl: "/api/v1/images/img-expr-keep",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "keep.png",
                characterIds: ["c1"],
                galleryItemIds: { c1: NATIVE_EXPRESSION_SENTINEL },
                localizedAt: 50,
            });
            tx.recordLocalizedAsset({
                normalizedUrl: "https://cdn.example.com/expr-removed.png",
                rawUrls: ["https://cdn.example.com/expr-removed.png"],
                imageId: "img-expr-removed",
                localUrl: "/api/v1/images/img-expr-removed",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "removed.png",
                characterIds: ["c1"],
                galleryItemIds: { c1: NATIVE_EXPRESSION_SENTINEL },
                localizedAt: 50,
            });
            // Entry whose images.get throws transient error -> preserved
            tx.recordLocalizedAsset({
                normalizedUrl: "https://cdn.example.com/transient.png",
                rawUrls: ["https://cdn.example.com/transient.png"],
                imageId: "extra-img-0",
                localUrl: "/api/v1/images/extra-img-0",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "t.png",
                characterIds: ["c1"],
                localizedAt: 50,
            });
        });

        const memStore = getStore("u1");
        const writesBeforeReconcile = memStore.calls.write.length;

        const scanItems: DiscoveredMediaItem[] = [
            {
                normalizedUrl: "https://cdn.example.com/adopted.png",
                rawUrls: ["https://cdn.example.com/adopted.png"],
                domain: "cdn.example.com",
                mediaKind: "image",
                sources: [{ section: "core_fields", label: "desc" }],
                occurrenceCount: 1,
                status: "remote",
            },
        ];

        const result = await reconcileCharacterGalleryWithIndex(
            spindle,
            store,
            "u1",
            {
                id: "c1",
                name: "ReconcileChar",
                description: "![](https://cdn.example.com/adopted.png)",
                extensions: {
                    expressions: {
                        mappings: {
                            happy: "img-expr-keep",
                        },
                    },
                },
            } as any,
            scanItems,
        );

        // Single batched write during reconcile
        expect(memStore.calls.write.length).toBe(writesBeforeReconcile + 1);
        expect(Math.max(...metaConcurrency)).toBeLessThanOrEqual(6);
        expect(result.adoptedCount).toBe(1);

        const afterState = await store.getState("u1");
        expect(afterState.assets["https://cdn.example.com/gone.png"]).toBeUndefined();
        expect(afterState.assets["https://cdn.example.com/transient.png"]?.characterIds).toContain("c1");
        expect(afterState.assets["https://cdn.example.com/expr-keep.png"]?.characterIds).toContain("c1");
        expect(afterState.assets["https://cdn.example.com/expr-removed.png"]?.characterIds ?? []).not.toContain("c1");
    });

    test("refreshScanResultWithIndexState recomputes failedCount and uses Object.hasOwn for URL lookups", () => {
        const scan: CharacterMediaScanResult = {
            characterId: "c1",
            characterName: "Char",
            scannedAt: 1,
            totalOccurrences: 2,
            items: [
                {
                    normalizedUrl: "https://cdn.example.com/a.png",
                    rawUrls: ["https://cdn.example.com/a.png"],
                    domain: "cdn.example.com",
                    mediaKind: "image",
                    sources: [
                        { section: "first_mes", label: "First" },
                        { section: "alternate_greetings", greetingIndex: 1, label: "Alt 1" },
                        { section: "world_books", worldBookId: "wb1", worldBookName: "WB 1", label: "Entry 1" },
                    ],
                    occurrenceCount: 3,
                    status: "remote",
                },
            ],
            sectionCounts: {
                creator_notes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
                first_mes: { totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
                core_fields: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
                alternate_greetings: { totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
                world_books: { totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
                regex_scripts: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
            },
            greetingBreakdown: [],
            worldBookBreakdown: [],
            domainBreakdown: [],
        };

        const refreshed = refreshScanResultWithIndexState(
            scan,
            {} as Record<string, LocalizedAssetEntry>,
            {
                "https://cdn.example.com/a.png": { error: "404", lastAttemptAt: 50 },
            },
        );

        expect(refreshed.items[0]?.status).toBe("failed");
        expect(refreshed.sectionCounts.first_mes.failedCount).toBe(1);
        expect(refreshed.sectionCounts.alternate_greetings.failedCount).toBe(1);
        expect(refreshed.sectionCounts.world_books.failedCount).toBe(1);
        expect(refreshed.greetingBreakdown[0]?.failedCount).toBe(1);
        expect(refreshed.worldBookBreakdown[0]?.failedCount).toBe(1);
        expect(refreshed.domainBreakdown[0]?.failedCount).toBe(1);
    });
});

describe("audit fixes #8.1, #8.2, #8.3, #8.5, and character queue cancellation", () => {
    test("#8.1 heals dead imageId on re-download without deleting new upload while respecting concurrent newer uploads", async () => {
        const { spindle, deletedImageBatches } = createCoreMockSpindle();
        const store = new MediaIndexStore(spindle.userStorage);
        const urlMissing = "https://cdn.example.com/dead-null.png";
        const urlError = "https://cdn.example.com/dead-throw.png";

        await store.batchUpdate("u1", (tx) => {
            tx.recordLocalizedAsset({
                normalizedUrl: urlMissing,
                rawUrls: [urlMissing],
                imageId: "dead-img-1",
                localUrl: "/api/v1/images/dead-img-1",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "dead.png",
                characterIds: ["c-old"],
                galleryItemIds: { "c-old": "dead-gal-1" },
                localizedAt: 10,
            });
            tx.recordLocalizedAsset({
                normalizedUrl: urlError,
                rawUrls: [urlError],
                imageId: "dead-img-throw",
                localUrl: "/api/v1/images/dead-img-throw",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "dead2.png",
                characterIds: ["c-old"],
                localizedAt: 10,
            });
        });

        const origGet = spindle.images.get;
        spindle.images.get = (async (id: string, uid?: string) => {
            if (id === "dead-img-throw") throw new Error("image read failed");
            return origGet(id, uid);
        }) as typeof spindle.images.get;

        const q = new UserDownloadQueue("u1", spindle, store, () => {});
        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 2,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "c1", characterName: "C1", normalizedUrl: urlMissing, rawUrls: [urlMissing] },
                { characterId: "c1", characterName: "C1", normalizedUrl: urlError, rawUrls: [urlError] },
            ],
        });
        await waitForQueueTerminal(q);

        expect(q.getProgress().succeededCount).toBe(2);
        expect(deletedImageBatches.flat()).toEqual([]);

        const st = await store.getState("u1");
        expect(st.assets[urlMissing]?.imageId).not.toBe("dead-img-1");
        expect(st.assets[urlMissing]?.characterIds.sort()).toEqual(["c-old", "c1"]);
        // Stale galleryItemIds from the dead image must not survive healing
        expect(st.assets[urlMissing]?.galleryItemIds).toBeUndefined();
        expect(st.assets[urlError]?.imageId).not.toBe("dead-img-throw");

        // Concurrent upload race: if a newer healthy image already replaced the dead one,
        // `replaceIfImageId: "dead-img-1"` must preserve the newer imageId instead of overwriting it.
        const currentImgId = st.assets[urlMissing]!.imageId;
        const raced = await store.recordLocalizedAsset(
            "u1",
            {
                normalizedUrl: urlMissing,
                rawUrls: [urlMissing],
                imageId: "stale-competitor-img",
                localUrl: "/api/v1/images/stale-competitor-img",
                mimeType: "image/png",
                sizeBytes: 12,
                filename: "stale.png",
                characterIds: ["c2"],
                localizedAt: 999,
            },
            { replaceIfImageId: "dead-img-1" },
        );
        expect(raced.imageId).toBe(currentImgId);
    });

    test("#8.2 detects polyglot SVG/HTML/XML/script/JSON/plain-text across comments, >1KB prefixes, BOMs, and UTF-16", () => {
        const enc = new TextEncoder();
        const encodeUtf16Le = (str: string, withBom = false): Uint8Array => {
            const out = new Uint8Array(str.length * 2 + (withBom ? 2 : 0));
            let offset = 0;
            if (withBom) {
                out[0] = 0xff;
                out[1] = 0xfe;
                offset = 2;
            }
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                out[offset + i * 2] = code & 0xff;
                out[offset + i * 2 + 1] = (code >> 8) & 0xff;
            }
            return out;
        };
        const encodeUtf16Be = (str: string, withBom = false): Uint8Array => {
            const out = new Uint8Array(str.length * 2 + (withBom ? 2 : 0));
            let offset = 0;
            if (withBom) {
                out[0] = 0xfe;
                out[1] = 0xff;
                offset = 2;
            }
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                out[offset + i * 2] = (code >> 8) & 0xff;
                out[offset + i * 2 + 1] = code & 0xff;
            }
            return out;
        };

        // Comment-prefixed SVG & >1KB XML header before <svg>
        expect(() =>
            detectMediaMimeType(enc.encode("<!-- comment --><svg onload='alert(1)'/>"), "image/png", "https://a.com/x.png"),
        ).toThrow(/SVG/i);
        const paddedXmlSvg = `<?xml version="1.0"?><!-- ${"x".repeat(2048)} --><svg xmlns="http://www.w3.org/2000/svg"/>`;
        expect(() =>
            detectMediaMimeType(enc.encode(paddedXmlSvg), "image/png", "https://a.com/x.png"),
        ).toThrow(/SVG/i);

        // UTF-8 BOM + UTF-16LE/BE (with and without BOM) HTML/SVG/script
        expect(() =>
            detectMediaMimeType(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode("<svg/>")]), "image/png", "https://a.com/x.png"),
        ).toThrow(/SVG/i);
        expect(() =>
            detectMediaMimeType(encodeUtf16Le("<svg xmlns='http://www.w3.org/2000/svg'/>", true), "image/png", "https://a.com/x.png"),
        ).toThrow(/SVG/i);
        expect(() =>
            detectMediaMimeType(encodeUtf16Le("<html lang='en'><body>hi</body></html>", false), "image/png", "https://a.com/x.png"),
        ).toThrow(/HTML/i);
        expect(() =>
            detectMediaMimeType(encodeUtf16Be("<script>alert(1)</script>", true), "application/octet-stream", "https://a.com/x.png"),
        ).toThrow(/script/i);
        expect(() =>
            detectMediaMimeType(encodeUtf16Be("<svg/>", false), "image/png", "https://a.com/x.png"),
        ).toThrow(/SVG/i);

        // HTML fragments, S3 XML error, JSON error, plain text error served as image/png or octet-stream + .png
        expect(() =>
            detectMediaMimeType(enc.encode("<body onload='alert(1)'>oops</body>"), "image/png", "https://a.com/x.png"),
        ).toThrow(/HTML/i);
        expect(() =>
            detectMediaMimeType(enc.encode("<Error><Code>AccessDenied</Code></Error>"), "application/octet-stream", "https://a.com/x.png"),
        ).toThrow(/XML|markup/i);
        expect(() =>
            detectMediaMimeType(enc.encode('{"error":"not found"}'), "image/png", "https://a.com/x.png"),
        ).toThrow(/JSON/i);
        expect(() =>
            detectMediaMimeType(enc.encode("404 Not Found from CDN"), "image/png", "https://a.com/x.png"),
        ).toThrow(/plain text/i);
    });

    test("#8.3 runTask catches indexStore.getState and linkExistingAssetToCharacter rejections and records failedCount", async () => {
        // 1. indexStore.getState fails
        const { spindle: s1 } = createCoreMockSpindle();
        const store1 = new MediaIndexStore(s1.userStorage);
        store1.getState = async () => {
            throw new Error("storage offline");
        };
        const q1 = new UserDownloadQueue("u1", s1, store1, () => {});
        await q1.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "c1", characterName: "C1", normalizedUrl: "https://cdn.example.com/1.png", rawUrls: ["https://cdn.example.com/1.png"] },
                { characterId: "c2", characterName: "C2", normalizedUrl: "https://cdn.example.com/1.png", rawUrls: ["https://cdn.example.com/1.png"] },
            ],
        });
        await waitForQueueTerminal(q1);
        const p1 = q1.getProgress();
        expect(p1.status).toBe("completed");
        expect(p1.completedCount).toBe(2);
        expect(p1.failedCount).toBe(2);
        expect(p1.recentErrors[0]?.error).toContain("storage offline");

        // 2. linkExistingAssetToCharacter fails after images.get succeeds -> must fail without re-uploading
        const { spindle: s2, getUploadCount } = createCoreMockSpindle();
        const store2 = new MediaIndexStore(s2.userStorage);
        const uploaded = await s2.images.upload({ data: PNG_MAGIC, filename: "ok.png", mime_type: "image/png", owner_character_id: "c0" }, "u1");
        await store2.recordLocalizedAsset("u1", {
            normalizedUrl: "https://cdn.example.com/existing.png",
            rawUrls: ["https://cdn.example.com/existing.png"],
            imageId: uploaded.id,
            localUrl: uploaded.url,
            mimeType: "image/png",
            sizeBytes: PNG_MAGIC.byteLength,
            filename: "ok.png",
            characterIds: ["c0"],
            localizedAt: 1,
        });
        const uploadsBefore = getUploadCount();
        store2.linkExistingAssetToCharacter = async () => {
            throw new Error("link write failed");
        };
        const q2 = new UserDownloadQueue("u1", s2, store2, () => {});
        await q2.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "c1", characterName: "C1", normalizedUrl: "https://cdn.example.com/existing.png", rawUrls: ["https://cdn.example.com/existing.png"] },
            ],
        });
        await waitForQueueTerminal(q2);
        expect(getUploadCount()).toBe(uploadsBefore);
        expect(q2.getProgress().completedCount).toBe(1);
        expect(q2.getProgress().failedCount).toBe(1);
    });

    test("#8.5 never deletes reused fallback unmatchedGalleryCandidates (without galleryItemId) on cancel or race-loss", async () => {
        // 1. Cancel/skip right as downloadAndStoreMedia finishes reusing fallback candidate
        let releaseReadBinary!: () => void;
        const readBinaryGate = new Promise<void>((r) => {
            releaseReadBinary = r;
        });
        const { spindle, deletedImageBatches } = createCoreMockSpindle({
            images: {
                readBinary: async () => {
                    await readBinaryGate;
                    return PNG_MAGIC.slice();
                },
                upload: async () => {
                    throw new Error("should not upload");
                },
                deleteMany: async (ids: string[]) => {
                    deletedImageBatches.push([...ids]);
                    return { deletedCount: ids.length };
                },
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const q = new UserDownloadQueue("u1", spindle, store, () => {});
        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                {
                    characterId: "c1",
                    characterName: "C1",
                    normalizedUrl: "https://cdn.example.com/fallback.png",
                    rawUrls: ["https://cdn.example.com/fallback.png"],
                    // galleryItemId intentionally undefined (getGallery unavailable fallback)
                    unmatchedGalleryCandidates: [{ imageId: "fallback-keep-id", byteSize: PNG_MAGIC.byteLength }],
                },
            ],
        });
        await new Promise((r) => setTimeout(r, 15));
        q.cancelAll();
        releaseReadBinary();
        await waitForQueueTerminal(q);
        expect(deletedImageBatches.flat()).not.toContain("fallback-keep-id");

        // 2. Race-loss: recordLocalizedAsset returns a different winning imageId
        const { spindle: sRace, deletedImageBatches: raceDeleted } = createCoreMockSpindle({
            images: {
                readBinary: async () => PNG_MAGIC.slice(),
                upload: async () => {
                    throw new Error("should not upload");
                },
                deleteMany: async (ids: string[]) => {
                    raceDeleted.push([...ids]);
                    return { deletedCount: ids.length };
                },
            },
        });
        const raceStore = new MediaIndexStore(sRace.userStorage);
        const origRecord = raceStore.recordLocalizedAsset.bind(raceStore);
        raceStore.recordLocalizedAsset = async (uid, entry, opts) => {
            // Ensure reusedExistingImage internal flag is stripped before storage
            expect((entry as unknown as { reusedExistingImage?: unknown }).reusedExistingImage).toBeUndefined();
            await origRecord(uid, { ...entry, imageId: "winner-img", localUrl: "/api/v1/images/winner-img" }, opts);
            return (await raceStore.getState(uid)).assets[entry.normalizedUrl]!;
        };
        const qRace = new UserDownloadQueue("u1", sRace, raceStore, () => {});
        await qRace.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                {
                    characterId: "c1",
                    characterName: "C1",
                    normalizedUrl: "https://cdn.example.com/fallback-race.png",
                    rawUrls: ["https://cdn.example.com/fallback-race.png"],
                    unmatchedGalleryCandidates: [{ imageId: "fallback-race-keep", byteSize: PNG_MAGIC.byteLength }],
                },
            ],
        });
        await waitForQueueTerminal(qRace);
        expect(raceDeleted.flat()).not.toContain("fallback-race-keep");
    });

    test("#8.8 cancelCharacterTasks aborts active/pending tasks for deleted character without stopping other characters", async () => {
        const { spindle } = createCoreMockSpindle({
            cors: async (url: string) => {
                if (url.includes("del-")) {
                    await new Promise((r) => setTimeout(r, 80));
                }
                return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const q = new UserDownloadQueue("u1", spindle, store, () => {});

        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "char-del", characterName: "Del", normalizedUrl: "https://cdn.example.com/del-1.png", rawUrls: ["https://cdn.example.com/del-1.png"] },
                { characterId: "char-del", characterName: "Del", normalizedUrl: "https://cdn.example.com/del-2.png", rawUrls: ["https://cdn.example.com/del-2.png"] },
                { characterId: "char-keep", characterName: "Keep", normalizedUrl: "https://cdn.example.com/keep-1.png", rawUrls: ["https://cdn.example.com/keep-1.png"] },
            ],
        });

        await new Promise((r) => setTimeout(r, 15));
        const affected = q.cancelCharacterTasks("char-del");
        expect(affected).toBe(2);

        await waitForQueueTerminal(q);
        const st = await store.getState("u1");
        expect(st.assets["https://cdn.example.com/del-1.png"]).toBeUndefined();
        expect(st.assets["https://cdn.example.com/del-2.png"]).toBeUndefined();
        expect(st.assets["https://cdn.example.com/keep-1.png"]?.characterIds).toEqual(["char-keep"]);
        expect(q.getProgress().skippedCount).toBe(2);
        expect(q.getProgress().succeededCount).toBe(1);
    });

    test("[M-03] cancelCharacterTasks for char A does not skip shared-URL download for waiting char B", async () => {
        let downloadCount = 0;
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((r) => {
            releaseFirst = r;
        });

        const { spindle } = createCoreMockSpindle({
            cors: async () => {
                downloadCount++;
                if (downloadCount === 1) {
                    await firstGate;
                }
                return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const q = new UserDownloadQueue("u1", spindle, store, () => {});
        const sharedUrl = "https://cdn.example.com/shared-banner.png";

        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 2,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "char-a", characterName: "A", normalizedUrl: sharedUrl, rawUrls: [sharedUrl] },
                { characterId: "char-b", characterName: "B", normalizedUrl: sharedUrl, rawUrls: [sharedUrl] },
            ],
        });

        await new Promise((r) => setTimeout(r, 20));
        q.cancelCharacterTasks("char-a");
        releaseFirst();

        await waitForQueueTerminal(q);
        const progress = q.getProgress();
        expect(progress.status).toBe("completed");
        expect(progress.skippedCount).toBe(1);
        expect(progress.succeededCount).toBe(1);

        const st = await store.getState("u1");
        expect(st.assets[sharedUrl]?.characterIds).toEqual(["char-b"]);
    });

    test("[L-06] startOrAppendBatch dynamically spawns additional worker loops when concurrency increases", async () => {
        let activeFetches = 0;
        let maxConcurrentFetches = 0;
        let releaseBatch!: () => void;
        const gate = new Promise<void>((r) => {
            releaseBatch = r;
        });
        let firstEntered!: () => void;
        const firstEnteredPromise = new Promise<void>((r) => {
            firstEntered = r;
        });

        const { spindle } = createCoreMockSpindle({
            cors: async () => {
                activeFetches++;
                if (activeFetches > maxConcurrentFetches) {
                    maxConcurrentFetches = activeFetches;
                }
                if (activeFetches === 1) {
                    firstEntered();
                }
                await gate;
                activeFetches--;
                return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
            },
        });
        const store = new MediaIndexStore(spindle.userStorage);
        const q = new UserDownloadQueue("u1", spindle, store, () => {});

        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 1,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "c1", characterName: "C1", normalizedUrl: "https://cdn.example.com/dyn-1.png", rawUrls: ["https://cdn.example.com/dyn-1.png"] },
                { characterId: "c1", characterName: "C1", normalizedUrl: "https://cdn.example.com/dyn-2.png", rawUrls: ["https://cdn.example.com/dyn-2.png"] },
            ],
        });

        await firstEnteredPromise;
        // Append more tasks with higher concurrency = 3 while first batch is active at concurrency = 1
        await q.startOrAppendBatch({
            userId: "u1",
            concurrency: 3,
            maxFileSizeBytes: 5 * 1024 * 1024,
            timeoutMs: 5000,
            maxItems: 0,
            tasks: [
                { characterId: "c1", characterName: "C1", normalizedUrl: "https://cdn.example.com/dyn-3.png", rawUrls: ["https://cdn.example.com/dyn-3.png"] },
                { characterId: "c1", characterName: "C1", normalizedUrl: "https://cdn.example.com/dyn-4.png", rawUrls: ["https://cdn.example.com/dyn-4.png"] },
            ],
        });

        await new Promise((r) => setTimeout(r, 25));
        expect(maxConcurrentFetches).toBe(3);

        releaseBatch();
        await waitForQueueTerminal(q);
        expect(q.getProgress().succeededCount).toBe(4);
    });
});
