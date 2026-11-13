import { afterAll, describe, expect, test } from "bun:test";
import { createMemoryStorage, type MemoryStorage } from "./helpers/mock-dom";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

interface MockController {
    spindle: any;
    rpcPoolHandlers: Map<string, { handler: (ctx: unknown) => Promise<unknown>; opts: unknown }>;
    eventHandlers: Map<string, Array<(ev: unknown, userId?: string) => unknown>>;
    frontendMessageHandler: ((msg: unknown, rawUserId: string) => Promise<void>) | null;
    registeredCommands: Array<{ id: string; label: string; scope?: string }>;
    commandInvokeHandler: ((commandId: string, context: any, origin: any) => Promise<void>) | null;
    sentToFrontend: Array<{ msg: any; userId?: string }>;
    openDrawerCalls: Array<{ tabId: string; opts?: unknown }>;
    toastCalls: { info: Array<{ msg: string; opts?: unknown }>; error: Array<{ msg: string; opts?: unknown }> };
    deletedImageBatches: Array<{ ids: string[]; opts?: unknown }>;
    characters: Map<string, any>;
    worldBooks: Map<string, { id: string; name: string; entries: Array<{ id: string; comment?: string; content?: string }> }>;
    regexScriptsByChar: Map<string, Array<{ id: string; name: string; replace_string?: string }>>;
    activeChatByUser: Map<string, { character_id?: string } | null>;
    getStore: (userId?: string) => MemoryStorage;
    allowUndefinedUser: boolean;
    failCharactersGetFor: Set<string>;
    failWorldBookIds: Set<string>;
    failRegexForChars: Set<string>;
    worldBookFetchCounts: Map<string, number>;
    regexFetchCounts: Map<string, number>;
    characterListMaxPageSize: number | null;
    corsHandler: ((url: string) => Promise<any>) | null;
    resetCallLogs: () => void;
    emitEvent: (eventName: string, ev: unknown, userId?: string) => Promise<void>;
}

function createBackendController(): MockController {
    const userStores = new Map<string, MemoryStorage>();
    const uploadedImages = new Map<string, { id: string; url: string; mime_type: string; original_filename: string; byte_size: number }>();
    let imgSeq = 0;

    const controller: MockController = {
        spindle: null,
        rpcPoolHandlers: new Map(),
        eventHandlers: new Map(),
        frontendMessageHandler: null,
        registeredCommands: [],
        commandInvokeHandler: null,
        sentToFrontend: [],
        openDrawerCalls: [],
        toastCalls: { info: [], error: [] },
        deletedImageBatches: [],
        characters: new Map(),
        worldBooks: new Map(),
        regexScriptsByChar: new Map(),
        activeChatByUser: new Map(),
        allowUndefinedUser: false,
        failCharactersGetFor: new Set(),
        failWorldBookIds: new Set(),
        failRegexForChars: new Set(),
        worldBookFetchCounts: new Map(),
        regexFetchCounts: new Map(),
        characterListMaxPageSize: null,
        corsHandler: null,
        getStore(userId?: string): MemoryStorage {
            if (userId === undefined && !controller.allowUndefinedUser) {
                throw new Error("No userId supplied");
            }
            const key = userId ?? "__default__";
            let store = userStores.get(key);
            if (!store) {
                store = createMemoryStorage();
                userStores.set(key, store);
            }
            return store;
        },
        resetCallLogs() {
            controller.sentToFrontend.length = 0;
            controller.openDrawerCalls.length = 0;
            controller.toastCalls.info.length = 0;
            controller.toastCalls.error.length = 0;
            controller.deletedImageBatches.length = 0;
        },
        async emitEvent(eventName: string, ev: unknown, userId?: string) {
            const list = controller.eventHandlers.get(eventName) ?? [];
            for (const fn of list) {
                await fn(ev, userId);
            }
        },
    };

    controller.spindle = {
        userStorage: {
            exists: (path: string, userId?: string) => controller.getStore(userId).exists(path),
            read: (path: string, userId?: string) => controller.getStore(userId).read(path),
            write: (path: string, content: string, userId?: string) => controller.getStore(userId).write(path, content),
            delete: (path: string, userId?: string) => controller.getStore(userId).delete(path),
            move: (from: string, to: string, userId?: string) => controller.getStore(userId).move(from, to),
            list: (prefix?: string, userId?: string) => controller.getStore(userId).list(prefix),
        },
        rpcPool: {
            handle: (name: string, handler: (ctx: unknown) => Promise<unknown>, opts: unknown) => {
                controller.rpcPoolHandlers.set(name, { handler, opts });
                return () => controller.rpcPoolHandlers.delete(name);
            },
        },
        onFrontendMessage: (handler: (msg: unknown, rawUserId: string) => Promise<void>) => {
            controller.frontendMessageHandler = handler;
            return () => {
                controller.frontendMessageHandler = null;
            };
        },
        sendToFrontend: (msg: unknown, userId?: string) => {
            controller.sentToFrontend.push({ msg, userId });
        },
        on: (eventName: string, handler: (ev: unknown, userId?: string) => unknown) => {
            const list = controller.eventHandlers.get(eventName) ?? [];
            list.push(handler);
            controller.eventHandlers.set(eventName, list);
            return () => {
                const cur = controller.eventHandlers.get(eventName) ?? [];
                controller.eventHandlers.set(
                    eventName,
                    cur.filter((h) => h !== handler),
                );
            };
        },
        commands: {
            register: (defs: Array<{ id: string; label: string; scope?: string }>) => {
                controller.registeredCommands.push(...defs);
            },
            onInvoked: (handler: (commandId: string, context: any, origin: any) => Promise<void>) => {
                controller.commandInvokeHandler = handler;
            },
        },
        ui: {
            openDrawerTab: async (tabId: string, opts?: unknown) => {
                controller.openDrawerCalls.push({ tabId, opts });
            },
        },
        toast: {
            info: (msg: string, opts?: unknown) => {
                controller.toastCalls.info.push({ msg, opts });
            },
            error: (msg: string, opts?: unknown) => {
                controller.toastCalls.error.push({ msg, opts });
            },
        },
        characters: {
            get: async (id: string) => {
                if (controller.failCharactersGetFor.has(id)) {
                    throw new Error(`Character load failure for ${id}`);
                }
                return controller.characters.get(id) ?? null;
            },
            list: async (opts?: { limit?: number; offset?: number }) => {
                const all = Array.from(controller.characters.values());
                const offset = opts?.offset ?? 0;
                const requestedLimit = opts?.limit ?? all.length;
                const limit =
                    controller.characterListMaxPageSize !== null
                        ? Math.min(requestedLimit, controller.characterListMaxPageSize)
                        : requestedLimit;
                return {
                    data: all.slice(offset, offset + limit),
                    total: all.length,
                };
            },
            getGallery: async () => [],
        },
        world_books: {
            get: async (wbId: string) => {
                controller.worldBookFetchCounts.set(wbId, (controller.worldBookFetchCounts.get(wbId) ?? 0) + 1);
                if (controller.failWorldBookIds.has(wbId)) {
                    throw new Error(`WB failure: ${wbId}`);
                }
                const wb = controller.worldBooks.get(wbId);
                return wb ? { id: wb.id, name: wb.name } : null;
            },
            entries: {
                list: async (wbId: string) => {
                    const wb = controller.worldBooks.get(wbId);
                    const rows = wb?.entries ?? [];
                    return { data: rows, total: rows.length };
                },
            },
        },
        regex_scripts: {
            list: async (opts?: { scopeId?: string }) => {
                const charId = opts?.scopeId ?? "";
                controller.regexFetchCounts.set(charId, (controller.regexFetchCounts.get(charId) ?? 0) + 1);
                if (controller.failRegexForChars.has(charId)) {
                    throw new Error(`Regex failure for ${charId}`);
                }
                const rows = controller.regexScriptsByChar.get(charId) ?? [];
                return { data: rows, total: rows.length };
            },
        },
        chats: {
            getActive: async (userId?: string) => controller.activeChatByUser.get(userId ?? "") ?? null,
        },
        images: {
            upload: async (dto: { data: Uint8Array; filename: string; mime_type: string }) => {
                imgSeq++;
                const id = `bk-img-${imgSeq}`;
                const meta = {
                    id,
                    url: `/api/v1/images/${id}`,
                    mime_type: dto.mime_type,
                    original_filename: dto.filename,
                    byte_size: dto.data.byteLength,
                };
                uploadedImages.set(id, meta);
                return meta;
            },
            deleteMany: async (ids: string[], opts?: unknown) => {
                controller.deletedImageBatches.push({ ids: [...ids], opts });
                for (const id of ids) uploadedImages.delete(id);
                return { deletedCount: ids.length };
            },
            list: async () => ({ data: Array.from(uploadedImages.values()), total: uploadedImages.size }),
            get: async (id: string) => uploadedImages.get(id) ?? null,
            readBinary: async () => null,
        },
        cors: async (url: string) => {
            if (controller.corsHandler) return controller.corsHandler(url);
            return {
                status: 200,
                headers: { "content-type": "image/png" },
                body: PNG_MAGIC.slice(),
            };
        },
    };

    return controller;
}

const g = globalThis as Record<string, unknown>;
const hadPrevSpindle = Object.prototype.hasOwnProperty.call(g, "spindle");
const prevSpindle = g.spindle;

const controller = createBackendController();
g.spindle = controller.spindle;

const backend = await import("../backend");

afterAll(async () => {
    // Allow debounced scheduleUrlMapSync (200ms) timers scheduled by tests to flush cleanly
    await new Promise((r) => setTimeout(r, 250));
    if (hadPrevSpindle) g.spindle = prevSpindle;
    else delete g.spindle;
});

describe("backend url_map RPC pool & knownUsers disambiguation", () => {
    test("handles knownUsers size 0 (throw/success), size 1, and size > 1 ambiguity", async () => {
        const reg = controller.rpcPoolHandlers.get("media_localizer.url_map");
        expect(reg).toBeDefined();
        expect(reg?.opts).toEqual({ requires: [] });

        // size === 0 and default owner cannot be resolved -> gracefully returns null
        controller.allowUndefinedUser = false;
        expect(await reg!.handler({})).toBeNull();

        // size === 0 but host resolves default user -> returns payload without stale undefined cache
        controller.allowUndefinedUser = true;
        const defaultRes = await reg!.handler({});
        expect(defaultRes).toBeDefined();
        expect((defaultRes as any).characterUrlMaps).toBeDefined();
        expect((defaultRes as any).allUrlsMap).toBeDefined();

        // Updating default user storage while knownUsers.size === 0 must be reflected immediately (no stale undefined cache)
        await controller.getStore(undefined).write(
            "media_index.json",
            JSON.stringify({
                version: 1,
                assets: {
                    "https://cdn.example.com/fresh-default.png": {
                        normalizedUrl: "https://cdn.example.com/fresh-default.png",
                        rawUrls: ["https://cdn.example.com/fresh-default.png"],
                        imageId: "def-img-1",
                        localUrl: "/api/v1/images/def-img-1",
                        mimeType: "image/png",
                        sizeBytes: 12,
                        filename: "fresh.png",
                        characterIds: ["c-def"],
                        localizedAt: 1,
                    },
                },
            }),
        );
        const refreshedDefaultRes = (await reg!.handler({})) as any;
        expect(refreshedDefaultRes.allUrlsMap["https://cdn.example.com/fresh-default.png"]).toBe(
            "/api/v1/images/def-img-1",
        );

        // Connect sole user (knownUsers size === 1)
        await controller.emitEvent("CONNECTED", {}, "rpc-sole-user");
        const soleRes = await reg!.handler({});
        expect((soleRes as any)?.characterUrlMaps).toBeDefined();

        // Connect second user (knownUsers size === 2) -> ambiguous, returns null
        await controller.emitEvent("CONNECTED", {}, "rpc-second-user");
        expect(await reg!.handler({})).toBeNull();
    });
});

describe("backend performCharacterScan caching, failure non-caching, and performLibraryScan isolation", () => {
    test("caches complete scans with cloned output, skips caching on WB/regex failure, and evicts on resource events", async () => {
        const userId = "u-scan-cache";
        controller.characters.set("char-scan-1", {
            id: "char-scan-1",
            name: "ScanChar",
            updated_at: 1000,
            description: "![](https://cdn.example.com/desc.png)",
            world_book_ids: ["wb-cache-1"],
        });
        controller.worldBooks.set("wb-cache-1", {
            id: "wb-cache-1",
            name: "CacheWB",
            entries: [{ id: "e1", content: "![](https://cdn.example.com/wb.png)" }],
        });
        controller.regexScriptsByChar.set("char-scan-1", [
            { id: "r1", name: "R1", replace_string: "![](https://cdn.example.com/regex.png)" },
        ]);

        // 1. Failing world book prevents caching so subsequent scan retries WB fetch
        controller.failWorldBookIds.add("wb-cache-1");
        const partial = await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(partial.items.some((i) => i.normalizedUrl.includes("wb.png"))).toBe(false);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(1);

        controller.failWorldBookIds.delete("wb-cache-1");
        // 2. Failing regex scripts also prevents caching
        controller.failRegexForChars.add("char-scan-1");
        await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(2);
        expect(controller.regexFetchCounts.get("char-scan-1")).toBe(2);

        // 3. Full healthy scan gets cached
        controller.failRegexForChars.delete("char-scan-1");
        const firstFull = await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(firstFull.items.some((i) => i.normalizedUrl.includes("wb.png"))).toBe(true);
        expect(firstFull.items.some((i) => i.normalizedUrl.includes("regex.png"))).toBe(true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(3);

        // Cache hits return cloned items/arrays so mutating a cache hit does not corrupt subsequent cache hits
        const hit1 = await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(3);
        const origOccurrence = hit1.items[0]!.occurrenceCount;
        const origLen = hit1.items.length;
        hit1.items[0]!.occurrenceCount = 999;
        hit1.items.push({ ...hit1.items[0]!, normalizedUrl: "https://cdn.example.com/mutated.png" });

        const hit2 = await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(3);
        expect(hit2.items.length).toBe(origLen);
        expect(hit2.items[0]!.occurrenceCount).toBe(origOccurrence);

        // WORLD_BOOK_CHANGED evicts character cache
        await controller.emitEvent("WORLD_BOOK_CHANGED", { worldBookId: "wb-cache-1" }, userId);
        await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(4);

        // REGEX_SCRIPT_CHANGED for character scope evicts character cache
        await controller.emitEvent("REGEX_SCRIPT_CHANGED", { scope: "character", scopeId: "char-scan-1" }, userId);
        await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(5);

        // CHARACTER_EDITED evicts character cache
        await controller.emitEvent("CHARACTER_EDITED", { characterId: "char-scan-1" }, userId);
        await backend.performCharacterScan(userId, "char-scan-1", true);
        expect(controller.worldBookFetchCounts.get("wb-cache-1")).toBe(6);
    });

    test("performLibraryScan isolates per-character failures and returns healthy summaries", async () => {
        const userId = "u-lib-scan";
        controller.characters.set("good-char", {
            id: "good-char",
            name: "Healthy",
            updated_at: 10,
            description: "![](https://cdn.example.com/lib-ok.png)",
        });
        // Poison description getter so scanCharacterMedia throws when scanning this character
        const badChar: Record<string, unknown> = { id: "bad-char", name: "Broken", updated_at: 10 };
        Object.defineProperty(badChar, "description", {
            enumerable: true,
            get() {
                throw new Error("corrupt character payload");
            },
        });
        controller.characters.set("bad-char", badChar);

        const libRes = await backend.performLibraryScan(userId, { forceRefresh: true });
        controller.characters.delete("bad-char");

        expect(libRes.characters.some((c) => c.characterId === "good-char")).toBe(true);
        expect(libRes.characters.some((c) => c.characterId === "bad-char")).toBe(false);
        expect(libRes.totalUniqueRemote).toBeGreaterThanOrEqual(1);
    });

    test("list_library_media and performLibraryScan paginate all characters even when host clamps page limit", async () => {
        const userId = "u-paginated-lib";
        const createdIds: string[] = [];
        for (let i = 0; i < 7; i++) {
            const id = `paged-char-${i}`;
            createdIds.push(id);
            controller.characters.set(id, {
                id,
                name: `Paged ${i}`,
                updated_at: 2000 + i,
                description: `![](https://cdn.example.com/paged-${i}.png)`,
            });
        }

        controller.characterListMaxPageSize = 2;
        try {
            const mediaRes = (await backend.handleFrontendRpcAction(userId, "list_library_media", {
                includeEmpty: true,
            })) as { characters: Array<{ characterId: string }> };
            const returnedMediaIds = new Set(mediaRes.characters.map((c) => c.characterId));
            for (const id of createdIds) {
                expect(returnedMediaIds.has(id)).toBe(true);
            }

            const scanRes = await backend.performLibraryScan(userId, { forceRefresh: true });
            const scannedIds = new Set(scanRes.characters.map((c) => c.characterId));
            for (const id of createdIds) {
                expect(scannedIds.has(id)).toBe(true);
            }
        } finally {
            controller.characterListMaxPageSize = null;
            for (const id of createdIds) {
                controller.characters.delete(id);
            }
        }
    });
});

describe("backend handleFrontendRpcAction & onFrontendMessage", () => {
    test("handles get_init_state, settings, overrides, bounded enqueue_download, queue_control, gallery links, clear_failed, and purge", async () => {
        const userId = "u-rpc-actions";
        controller.resetCallLogs();

        controller.characters.set("c-rpc-1", {
            id: "c-rpc-1",
            name: "RpcChar",
            updated_at: 42,
            description: "![](https://cdn.example.com/r1.png) ![](https://cdn.example.com/r2.png)",
        });

        const init = (await backend.handleFrontendRpcAction(userId, "get_init_state", {})) as any;
        expect(init.stats?.settings).toBeDefined();
        expect(init.queueProgress).toBeDefined();
        expect(init.urlMapPayload).toBeDefined();

        const savedOverride = (await backend.handleFrontendRpcAction(userId, "save_character_override", {
            characterId: "c-rpc-1",
            override: { maxItems: 1 },
        })) as any;
        expect(savedOverride.override.maxItems).toBe(1);

        // Empty characterIds throws validation error
        await expect(
            backend.handleFrontendRpcAction(userId, "enqueue_download", { filter: { characterIds: [] } }),
        ).rejects.toThrow(/Select at least one character/);

        // useCharacterOverrides picks up maxItems: 1 and queues bounded task
        const queued = (await backend.handleFrontendRpcAction(userId, "enqueue_download", {
            useCharacterOverrides: true,
            filter: {
                characterIds: ["c-rpc-1"],
                maxFileSizeBytes: 1024 * 1024 * 999,
                timeoutMs: 1,
                concurrency: 99,
            },
        })) as any;
        expect(queued.queueProgress.totalQueued).toBe(1);

        // Wait briefly for download to complete
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const p = (await backend.handleFrontendRpcAction(userId, "queue_control", { control: "status" })) as any;
            if (p.queueProgress.status === "completed" || p.queueProgress.status === "idle") break;
            await new Promise((r) => setTimeout(r, 15));
        }

        const libMedia = (await backend.handleFrontendRpcAction(userId, "list_library_media", { includeEmpty: true })) as any;
        expect(libMedia.characters.some((c: any) => c.characterId === "c-rpc-1")).toBe(true);

        const asset = libMedia.characters.find((c: any) => c.characterId === "c-rpc-1")?.localizedAssets?.[0];
        expect(asset).toBeDefined();

        const linked = (await backend.handleFrontendRpcAction(userId, "record_gallery_links", {
            links: [
                {
                    characterId: "c-rpc-1",
                    normalizedUrl: asset.normalizedUrl,
                    imageId: asset.imageId,
                    galleryItemId: "native-gal-99",
                },
            ],
        })) as any;
        expect(linked.updated).toBe(1);

        const updatedSettings = (await backend.handleFrontendRpcAction(userId, "update_settings", {
            patch: { deleteImagesOnPurge: true, concurrency: 50 },
        })) as any;
        expect(updatedSettings.settings.concurrency).toBe(5);
        expect(updatedSettings.settings.deleteImagesOnPurge).toBe(true);

        await backend.handleFrontendRpcAction(userId, "clear_failed", {});

        // Bulk purge deletes orphaned images when deleteImagesOnPurge is true
        const purged = (await backend.handleFrontendRpcAction(userId, "purge_characters", {
            characterIds: ["c-rpc-1"],
        })) as any;
        expect(purged.removedCount).toBe(1);
        expect(purged.deletedImagesCount).toBe(1);
        expect(controller.deletedImageBatches.some((b) => b.ids.includes(asset.imageId))).toBe(true);

        await expect(backend.handleFrontendRpcAction(userId, "unknown_action_xyz", {})).rejects.toThrow(/Unknown RPC action/);
    });

    test("auto_localize_character enforces autoLocalizeOnOpen, inFlight concurrency guard, and markAutoLocalized", async () => {
        const userId = "u-auto-loc";
        controller.characters.set("c-auto-1", {
            id: "c-auto-1",
            name: "AutoChar",
            updated_at: 77,
            description: "![](https://cdn.example.com/auto-1.png)",
        });

        // Disabled setting -> started: false
        await backend.handleFrontendRpcAction(userId, "update_settings", { patch: { autoLocalizeOnOpen: false } });
        const offRes = (await backend.handleFrontendRpcAction(userId, "auto_localize_character", {
            characterId: "c-auto-1",
        })) as any;
        expect(offRes.started).toBe(false);

        // Enable setting, slow down world_books or character get slightly to overlap two calls
        await backend.handleFrontendRpcAction(userId, "update_settings", { patch: { autoLocalizeOnOpen: true } });
        controller.characters.set("c-auto-1", {
            id: "c-auto-1",
            name: "AutoChar",
            updated_at: 78,
            description: "![](https://cdn.example.com/auto-1.png)",
            world_book_ids: ["wb-slow-auto"],
        });
        controller.worldBooks.set("wb-slow-auto", { id: "wb-slow-auto", name: "Slow", entries: [] });

        // Race two concurrent calls for the same (userId, characterId) -> inFlightAutoLocalize allows only one
        const [r1, r2] = (await Promise.all([
            backend.handleFrontendRpcAction(userId, "auto_localize_character", { characterId: "c-auto-1" }),
            backend.handleFrontendRpcAction(userId, "auto_localize_character", { characterId: "c-auto-1" }),
        ])) as Array<{ started: boolean }>;

        expect([r1?.started, r2?.started].filter(Boolean).length).toBe(1);

        // Subsequent call after markAutoLocalized -> started: false
        const r3 = (await backend.handleFrontendRpcAction(userId, "auto_localize_character", {
            characterId: "c-auto-1",
        })) as any;
        expect(r3.started).toBe(false);
    });

    test("onFrontendMessage sends RPC_RESPONSE on success, action errors, and unresolvable user sessions", async () => {
        expect(controller.frontendMessageHandler).not.toBeNull();
        controller.resetCallLogs();

        await controller.frontendMessageHandler!(
            { type: "RPC_REQUEST", requestId: "req-no-user", action: "get_init_state", payload: {} },
            "",
        );
        // Must NOT broadcast an RPC_RESPONSE with empty userId `""`
        expect(
            controller.sentToFrontend.some(
                (m) => m.msg.requestId === "req-no-user" || m.userId === "",
            ),
        ).toBe(false);

        await controller.frontendMessageHandler!(
            { type: "RPC_REQUEST", requestId: "req-ok", action: "get_init_state", payload: {} },
            "u-msg-1",
        );
        expect(
            controller.sentToFrontend.some(
                (m) => m.msg.requestId === "req-ok" && m.msg.result?.stats?.settings && !m.msg.error,
            ),
        ).toBe(true);

        await controller.frontendMessageHandler!(
            { type: "RPC_REQUEST", requestId: "req-bad", action: "bad_action", payload: {} },
            "u-msg-1",
        );
        expect(
            controller.sentToFrontend.some(
                (m) => m.msg.requestId === "req-bad" && /Unknown RPC action/.test(m.msg.error),
            ),
        ).toBe(true);
    });
});

describe("backend event cleanup hooks & Command Palette", () => {
    test("CHARACTER_GALLERY_ITEM_REMOVED, IMAGE_DELETED, and CHARACTER_DELETED clean index & images cleanly", async () => {
        const userId = "u-events-clean";
        controller.resetCallLogs();
        controller.characters.set("c-ev-1", {
            id: "c-ev-1",
            name: "EvChar",
            updated_at: 99,
            description: "![](https://cdn.example.com/ev-gal.png) ![](https://cdn.example.com/ev-img.png)",
        });

        await backend.handleFrontendRpcAction(userId, "update_settings", { patch: { deleteImagesOnPurge: true } });
        await backend.handleFrontendRpcAction(userId, "enqueue_download", {
            filter: { characterIds: ["c-ev-1"], maxItems: 0 },
        });

        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const p = (await backend.handleFrontendRpcAction(userId, "queue_control", { control: "status" })) as any;
            if (p.queueProgress.status === "completed") break;
            await new Promise((r) => setTimeout(r, 15));
        }

        const lib = (await backend.handleFrontendRpcAction(userId, "list_library_media", {})) as any;
        const assets = lib.characters.find((c: any) => c.characterId === "c-ev-1")?.localizedAssets ?? [];
        expect(assets.length).toBe(2);
        const firstAsset = assets[0]!;
        const secondAsset = assets[1]!;

        // 1. CHARACTER_GALLERY_ITEM_REMOVED unlinks first asset & emits GALLERY_SYNC_CHANGED
        await controller.emitEvent(
            "CHARACTER_GALLERY_ITEM_REMOVED",
            { characterId: "c-ev-1", imageId: firstAsset.imageId },
            userId,
        );
        expect(
            controller.sentToFrontend.some(
                (m) => m.userId === userId && m.msg.type === "GALLERY_SYNC_CHANGED" && m.msg.characterId === "c-ev-1",
            ),
        ).toBe(true);

        // 2. IMAGE_DELETED removes second asset & emits GALLERY_SYNC_CHANGED
        controller.resetCallLogs();
        await controller.emitEvent("IMAGE_DELETED", { imageId: secondAsset.imageId }, userId);
        expect(
            controller.sentToFrontend.some((m) => m.userId === userId && m.msg.type === "GALLERY_SYNC_CHANGED"),
        ).toBe(true);

        // 3. Seed another localized asset and verify CHARACTER_DELETED cleans orphan image
        controller.characters.set("c-ev-2", {
            id: "c-ev-2",
            name: "DelChar",
            updated_at: 100,
            description: "![](https://cdn.example.com/ev-del.png)",
        });
        await backend.handleFrontendRpcAction(userId, "enqueue_download", {
            filter: { characterIds: ["c-ev-2"], maxItems: 0 },
        });
        const deadline2 = Date.now() + 2000;
        while (Date.now() < deadline2) {
            const p = (await backend.handleFrontendRpcAction(userId, "queue_control", { control: "status" })) as any;
            if (p.queueProgress.status === "completed") break;
            await new Promise((r) => setTimeout(r, 15));
        }

        controller.resetCallLogs();
        await controller.emitEvent("CHARACTER_DELETED", { characterId: "c-ev-2" }, userId);
        expect(controller.deletedImageBatches.length).toBe(1);
    });

    test("registers commands and executes open-media-localizer & localize-active-character-media", async () => {
        expect(controller.registeredCommands.map((c) => c.id)).toEqual([
            "open-media-localizer",
            "localize-active-character-media",
        ]);
        expect(controller.commandInvokeHandler).not.toBeNull();

        const userId = "u-commands";
        controller.resetCallLogs();

        await controller.commandInvokeHandler!("open-media-localizer", {}, { userId });
        expect(controller.openDrawerCalls).toEqual([{ tabId: "media_localizer", opts: { userId } }]);

        // Missing active chat -> info toast
        controller.activeChatByUser.set(userId, null);
        await controller.commandInvokeHandler!("localize-active-character-media", {}, { userId });
        expect(controller.toastCalls.info.length).toBe(1);

        // Active chat character -> queues download & opens drawer
        controller.characters.set("c-cmd-1", {
            id: "c-cmd-1",
            name: "CmdChar",
            updated_at: 55,
            description: "![](https://cdn.example.com/cmd.png)",
        });
        controller.activeChatByUser.set(userId, { character_id: "c-cmd-1" });
        await controller.commandInvokeHandler!("localize-active-character-media", {}, { userId });
        expect(controller.openDrawerCalls.length).toBe(2);

        // Missing character context -> error toast
        await controller.commandInvokeHandler!(
            "localize-active-character-media",
            { characterId: "non-existent-char" },
            { userId },
        );
        expect(controller.toastCalls.error.length).toBe(1);
    });
});

describe("backend audit fixes #8.7 (perf & filter validation) and #8.8 (cleanup)", () => {
    test("#8.7 batches shared link writes in performCharacterScan, skips media/ENSURE_GALLERY_LINKS in performLibraryScan, and sanitizes malformed enqueue_download filters", async () => {
        const userId = "u-perf-batch";
        controller.resetCallLogs();

        // Seed two characters sharing 3 already-localized URLs
        controller.characters.set("char-seed-owner", {
            id: "char-seed-owner",
            name: "Owner",
            updated_at: 1,
            description: "![](https://cdn.example.com/sh1.png) ![](https://cdn.example.com/sh2.png) ![](https://cdn.example.com/sh3.png)",
        });
        await backend.handleFrontendRpcAction(userId, "enqueue_download", {
            filter: { characterIds: ["char-seed-owner"], maxItems: 0 },
        });
        const dlDeadline = Date.now() + 2000;
        while (Date.now() < dlDeadline) {
            const p = (await backend.handleFrontendRpcAction(userId, "queue_control", { control: "status" })) as any;
            if (p.queueProgress.status === "completed") break;
            await new Promise((r) => setTimeout(r, 10));
        }

        controller.characters.set("char-batch-linker", {
            id: "char-batch-linker",
            name: "BatchLinker",
            updated_at: 2,
            description: "![](https://cdn.example.com/sh1.png) ![](https://cdn.example.com/sh2.png) ![](https://cdn.example.com/sh3.png) ![](https://cdn.example.com/rem-only.png)",
        });

        const store = controller.getStore(userId);
        const writesBefore = store.calls.write.length;
        const scan = await backend.performCharacterScan(userId, "char-batch-linker", true);
        // All 3 shared URLs should be linked in a single batched write (1 temp write, not 3)
        expect(store.calls.write.length).toBe(writesBefore + 1);
        expect(scan.media).toBeDefined();

        // performLibraryScan must NOT emit ENSURE_GALLERY_LINKS for unlinked localized items
        controller.resetCallLogs();
        await backend.performLibraryScan(userId, { forceRefresh: true });
        expect(
            controller.sentToFrontend.some((m) => m.msg.type === "ENSURE_GALLERY_LINKS"),
        ).toBe(false);

        // Single-character scan_character still emits ENSURE_GALLERY_LINKS
        await backend.handleFrontendRpcAction(userId, "scan_character", {
            characterId: "char-batch-linker",
            forceRefresh: true,
        });
        expect(
            controller.sentToFrontend.some(
                (m) => m.msg.type === "ENSURE_GALLERY_LINKS" && m.msg.characterId === "char-batch-linker",
            ),
        ).toBe(true);

        // Malformed enqueue_download filter fields must be safely sanitized without throwing TypeError
        const queued = (await backend.handleFrontendRpcAction(userId, "enqueue_download", {
            filter: {
                characterIds: ["char-batch-linker", "char-batch-linker", "", 123 as any],
                domains: "cdn.example.com" as any,
                greetingIndices: 0 as any,
                worldBookIds: "wb1" as any,
                sections: ["invalid_sec", "core_fields"] as any,
                mediaKinds: "image" as any,
                explicitUrls: "https://cdn.example.com/rem-only.png" as any,
                excludedUrls: 42 as any,
                includeFailed: "false" as any,
                maxItems: -5,
            },
        })) as any;
        expect(queued.queueProgress.totalQueued).toBe(1);

        const qDeadline = Date.now() + 2000;
        while (Date.now() < qDeadline) {
            const p = (await backend.handleFrontendRpcAction(userId, "queue_control", { control: "status" })) as any;
            if (p.queueProgress.status === "completed") break;
            await new Promise((r) => setTimeout(r, 10));
        }

        controller.characters.delete("char-seed-owner");
        controller.characters.delete("char-batch-linker");
    });

    test("#8.8 purge_characters and CHARACTER_DELETED clear overrides, autoLocalized ids, scan cache, and active queue tasks", async () => {
        const userId = "u-cleanup-88";
        let releaseCors!: () => void;
        const slowCorsGate = new Promise<void>((r) => {
            releaseCors = r;
        });
        const prevCors = controller.corsHandler;
        controller.corsHandler = async (url: string) => {
            if (url.includes("slow-del")) {
                await slowCorsGate;
            }
            return { status: 200, headers: { "content-type": "image/png" }, body: PNG_MAGIC.slice() };
        };

        try {
            controller.characters.set("char-purge-me", {
                id: "char-purge-me",
                name: "PurgeMe",
                updated_at: 300,
                description: "![](https://cdn.example.com/slow-del-1.png) ![](https://cdn.example.com/slow-del-2.png)",
                world_book_ids: ["wb-clean-88"],
            });
            controller.worldBooks.set("wb-clean-88", {
                id: "wb-clean-88",
                name: "CleanWB",
                entries: [],
            });

            await backend.handleFrontendRpcAction(userId, "update_settings", {
                patch: { autoLocalizeOnOpen: true },
            });
            await backend.handleFrontendRpcAction(userId, "save_character_override", {
                characterId: "char-purge-me",
                override: { sections: ["core_fields"] },
            });

            const wbCountBefore = controller.worldBookFetchCounts.get("wb-clean-88") ?? 0;
            // auto_localize_character scans, starts slow download, and marks autoLocalizedCharacterIds
            const autoRes = (await backend.handleFrontendRpcAction(userId, "auto_localize_character", {
                characterId: "char-purge-me",
            })) as { started: boolean };
            expect(autoRes.started).toBe(true);
            expect(controller.worldBookFetchCounts.get("wb-clean-88")).toBe(wbCountBefore + 1);

            // Second scan hits cache while unpurged
            await backend.performCharacterScan(userId, "char-purge-me", true);
            expect(controller.worldBookFetchCounts.get("wb-clean-88")).toBe(wbCountBefore + 1);

            // Purge character while slow-del-1 is in flight and slow-del-2 is pending
            await backend.handleFrontendRpcAction(userId, "purge_characters", {
                characterIds: ["char-purge-me"],
            });
            releaseCors();

            const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
                const p = (await backend.handleFrontendRpcAction(userId, "queue_control", { control: "status" })) as any;
                if (p.queueProgress.status === "completed" || p.queueProgress.status === "idle") break;
                await new Promise((r) => setTimeout(r, 15));
            }

            // Cancelled tasks must not have written assets back into media_index.json,
            // and override + autoLocalizedCharacterIds must be removed.
            const rawJson = await controller.getStore(userId).read("media_index.json");
            const persisted = JSON.parse(rawJson);
            expect(Object.keys(persisted.assets)).toEqual([]);
            expect(persisted.characterOverrides["char-purge-me"]).toBeUndefined();
            expect(persisted.autoLocalizedCharacterIds).not.toContain("char-purge-me");

            // Scan cache was evicted on purge so next scan re-fetches WB
            await backend.performCharacterScan(userId, "char-purge-me", true);
            expect(controller.worldBookFetchCounts.get("wb-clean-88")).toBe(wbCountBefore + 2);

            // Also verify CHARACTER_DELETED clears override and autoLocalizedCharacterIds even with zero assets
            await backend.handleFrontendRpcAction(userId, "save_character_override", {
                characterId: "char-del-meta",
                override: { maxItems: 3 },
            });
            await controller.emitEvent("CHARACTER_DELETED", { characterId: "char-del-meta" }, userId);
            const rawAfterDel = await controller.getStore(userId).read("media_index.json");
            const persistedAfterDel = JSON.parse(rawAfterDel);
            expect(persistedAfterDel.characterOverrides["char-del-meta"]).toBeUndefined();
        } finally {
            releaseCors?.();
            controller.corsHandler = prevCors;
            controller.characters.delete("char-purge-me");
            controller.worldBooks.delete("wb-clean-88");
        }
    });
});
