import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import {
    DEFAULT_SETTINGS,
    type CharacterMediaScanResult,
    type LocalizedAssetEntry,
    type MediaLocalizerSettings,
    type QueueJobProgress,
    type StorageStatsSummary,
} from "../shared/types";
import { CharacterMediaWidget } from "../ui/character-media-widget";
import { NonDestructiveDisplaySwapper } from "../ui/display-swapper";
import { MediaLocalizerDrawerPanel } from "../ui/drawer-panel";
import { NativeGalleryTabIntegrator } from "../ui/gallery-integrator";
import { LibraryGalleryView } from "../ui/library-gallery";
import { MEDIA_LOCALIZER_STYLES } from "../ui/styles";
import { PortraitPanelLocalizeController } from "../ui/portrait-button";
import {
    cleanupUiHelpers,
    createInfoTip,
    createLazyMediaElement,
    openMediaLightbox,
    safeOpenExternalUrl,
    sanitizeSafeMediaUrl,
} from "../ui/ui-helpers";
import { setup, triggerNativeGalleryAndPortraitReactRefresh } from "../frontend";
import {
    installMockDom,
    MockEvent,
    MockKeyboardEvent,
    type MockDomEnv,
    type MockHTMLIFrameElement,
} from "./helpers/mock-dom";

function makeIdleQueue(): QueueJobProgress {
    return {
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
    };
}

function makeScan(charId: string, overrides: Partial<CharacterMediaScanResult> = {}): CharacterMediaScanResult {
    return {
        characterId: charId,
        characterName: `Char ${charId}`,
        scannedAt: 1000,
        totalOccurrences: 2,
        items: [
            {
                normalizedUrl: `https://cdn.example.com/${charId}-ok.png`,
                rawUrls: [`https://cdn.example.com/${charId}-ok.png`],
                domain: "cdn.example.com",
                mediaKind: "image",
                sources: [{ section: "core_fields", label: "Description" }],
                occurrenceCount: 1,
                status: "remote",
            },
            {
                normalizedUrl: `https://cdn.example.com/${charId}-fail.png`,
                rawUrls: [`https://cdn.example.com/${charId}-fail.png`],
                domain: "fail.example.com",
                mediaKind: "image",
                sources: [
                    { section: "alternate_greetings", greetingIndex: 1, label: "Greeting 1" },
                    { section: "world_books", worldBookId: "wb-1", worldBookName: "Lore", label: "Entry" },
                ],
                occurrenceCount: 1,
                status: "failed",
                failureInfo: { error: "HTTP 404", lastAttemptAt: 500 },
            },
        ],
        sectionCounts: {
            creator_notes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
            first_mes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
            core_fields: { totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
            alternate_greetings: { totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
            world_books: { totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
            regex_scripts: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
        },
        greetingBreakdown: [
            { greetingIndex: 1, label: "Greeting 1", totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
        ],
        worldBookBreakdown: [
            { worldBookId: "wb-1", worldBookName: "Lore", totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
        ],
        domainBreakdown: [
            { domain: "cdn.example.com", totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
            { domain: "fail.example.com", totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
        ],
        ...overrides,
    };
}

function createFrontendMockCtx(overrides: Partial<{
    activeCharacterId: string | null;
    confirmResult: boolean;
}> = {}) {
    let activeCharacterId: string | null =
        overrides.activeCharacterId !== undefined ? overrides.activeCharacterId : "char-1";
    const confirmResult = overrides.confirmResult ?? true;
    const sentMessages: any[] = [];
    const drawerTabs: Array<{
        id: string;
        render: (container: HTMLElement) => void | (() => void);
        setBadge?: (count?: number | string | null) => void;
    }> = [];
    const confirmCalls: any[] = [];
    const backendMessageListeners = new Set<(msg: unknown) => void>();
    const stateListeners = new Map<string, Set<() => void>>();
    const eventListeners = new Map<string, Set<(ev?: any) => void>>();
    let cleanupDomCalled = 0;

    const ctx = {
        dom: {
            addStyle: () => () => {},
            cleanup: () => {
                cleanupDomCalled++;
            },
        },
        sendToBackend: (msg: unknown) => {
            sentMessages.push(msg);
        },
        onBackendMessage: (fn: (msg: unknown) => void) => {
            backendMessageListeners.add(fn);
            return () => backendMessageListeners.delete(fn);
        },
        getActiveChat: () => (activeCharacterId ? { id: "chat-1", characterId: activeCharacterId, character_id: activeCharacterId } : null),
        state: {
            get: (key: string) => {
                if (key === "chat.active") return activeCharacterId ? { characterId: activeCharacterId } : null;
                return null;
            },
            subscribe: (key: string, fn: () => void) => {
                let set = stateListeners.get(key);
                if (!set) {
                    set = new Set();
                    stateListeners.set(key, set);
                }
                set.add(fn);
                return () => set!.delete(fn);
            },
        },
        ui: {
            registerDrawerTab: (def: any) => {
                const badgeCalls: Array<unknown> = [];
                const root = domEnv.document.createElement("div");
                domEnv.document.body.appendChild(root);
                const handle = {
                    ...def,
                    root,
                    activate: () => {},
                    setBadge: (val: unknown) => badgeCalls.push(val),
                    badgeCalls,
                };
                drawerTabs.push(handle);
                return handle;
            },
            showConfirm: async (opts: any) => {
                confirmCalls.push(opts);
                return { confirmed: confirmResult };
            },
            events: {
                onDrawerChange: () => () => {},
            },
            characterEditor: {
                getState: () => null,
                onChange: () => () => {},
            },
        },
        characters: {
            get: async (id: string) => ({ id, name: `Name-${id}` }),
        },
        events: {
            on: (name: string, fn: (ev?: any) => void) => {
                let set = eventListeners.get(name);
                if (!set) {
                    set = new Set();
                    eventListeners.set(name, set);
                }
                set.add(fn);
                return () => set!.delete(fn);
            },
        },
        permissions: {
            getGranted: async () => [],
            request: async () => [],
        },
        ready: () => {},
    };

    return {
        ctx: ctx as unknown as SpindleFrontendContext,
        sentMessages,
        drawerTabs,
        confirmCalls,
        getCleanupDomCalls: () => cleanupDomCalled,
        setActiveCharacterId: (id: string | null) => {
            activeCharacterId = id;
        },
        emitBackendMessage: (msg: unknown) => {
            for (const fn of backendMessageListeners) fn(msg);
        },
        emitEvent: (name: string, ev?: any) => {
            for (const fn of eventListeners.get(name) ?? []) fn(ev);
        },
    };
}

let domEnv: MockDomEnv;
const originalFetch = globalThis.fetch;

beforeEach(() => {
    domEnv = installMockDom();
});

afterEach(() => {
    cleanupUiHelpers();
    globalThis.fetch = originalFetch;
    domEnv.restore();
});

describe("ui/character-media-widget race safety, destroy(), failedCount breakdown, & confirm batch", () => {
    test("ignores stale refreshScan results/errors after setCharacterId or destroy and cancels overrideSaveTimer on destroy", async () => {
        const root = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(root as any);

        let resolveSlow!: (res: CharacterMediaScanResult) => void;
        let rejectSlow!: (err: Error) => void;
        const slowPromise = new Promise<CharacterMediaScanResult>((res, rej) => {
            resolveSlow = res;
            rejectSlow = rej;
        });

        let saveCalls = 0;
        let downloadCalls = 0;
        const ctxMock = createFrontendMockCtx({ confirmResult: false });

        const widget = new CharacterMediaWidget(
            root,
            ctxMock.ctx,
            "c-slow",
            { ...DEFAULT_SETTINGS, confirmThreshold: 0 },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => {
                    if (charId === "c-slow") return slowPromise;
                    return makeScan(charId);
                },
                onStartDownload: async () => {
                    downloadCalls++;
                },
                onSaveCharacterOverride: async () => {
                    saveCalls++;
                    return null;
                },
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
            { defaultExpandConfig: true },
        );

        // Start slow scan #1 for c-slow
        const p1 = widget.refreshScan(false);
        // Switch immediately to fast c-fast before c-slow resolves
        widget.setCharacterId("c-fast");
        await new Promise((r) => setTimeout(r, 15));
        expect(widget.getScan()?.characterId).toBe("c-fast");

        // Now resolve (stale) slow scan for c-slow -> must NOT overwrite c-fast scan or UI
        resolveSlow(makeScan("c-slow"));
        await p1;
        expect(widget.getScan()?.characterId).toBe("c-fast");
        expect(widget.getPendingDownloadCount()).toBe(2);

        // triggerOneClickLocalize respects confirmResult: false (threshold=0)
        await widget.triggerOneClickLocalize();
        expect(ctxMock.confirmCalls.length).toBe(1);
        expect(downloadCalls).toBe(0);

        // Start another scan, then destroy before it finishes -> must not render or leave override timer
        let resolveAfterDestroy!: (res: CharacterMediaScanResult) => void;
        const destroyWidget = new CharacterMediaWidget(
            root,
            ctxMock.ctx,
            "c-dest",
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: () =>
                    new Promise<CharacterMediaScanResult>((r) => {
                        resolveAfterDestroy = r;
                    }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => {
                    saveCalls++;
                    return null;
                },
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
        );
        const pDest = destroyWidget.refreshScan(false);
        root.innerHTML = `<div class="sentinel">kept</div>`;
        destroyWidget.destroy();
        resolveAfterDestroy(makeScan("c-dest"));
        await pDest;
        expect(root.querySelector(".sentinel")?.textContent).toBe("kept");
        expect(saveCalls).toBe(0);

        // Silence unused helper
        void rejectSlow;
    });
});

describe("ui/library-gallery concurrent queue & error retry guard", () => {
    test("coalesces concurrent refresh calls sequentially, ensureLoaded awaits active refresh, and error does not loop", async () => {
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        let calls = 0;
        let activeCalls = 0;
        let maxConcurrent = 0;
        let resolvers: Array<(val: any[]) => void> = [];

        const view = new LibraryGalleryView(container, {
            onLoadLibraryMedia: () => {
                calls++;
                activeCalls++;
                maxConcurrent = Math.max(maxConcurrent, activeCalls);
                return new Promise((resolve) => {
                    resolvers.push((val) => {
                        activeCalls--;
                        resolve(val);
                    });
                });
            },
            onPurgeAsset: async () => {},
        });

        // Trigger overlapping refreshes + ensureLoaded concurrently
        const p1 = view.refresh(true);
        const p2 = view.refresh(false);
        const pEnsure = view.ensureLoaded();

        await new Promise((r) => setTimeout(r, 10));
        expect(calls).toBe(1);
        expect(resolvers.length).toBe(1);

        // Resolve first load -> queues the coalesced follow-up refresh
        resolvers.shift()!([
            {
                characterId: "c1",
                characterName: "C1",
                avatarImageId: null,
                avatarUrl: null,
                localizedAssets: [],
                expressions: [],
                totalSizeBytes: 0,
                lastLocalizedAt: 10,
            },
        ]);
        await new Promise((r) => setTimeout(r, 10));
        expect(calls).toBe(2);
        expect(maxConcurrent).toBe(1);

        resolvers.shift()!([]);
        await Promise.all([p1, p2, pEnsure]);
        expect(calls).toBe(2);

        // Failing refresh does not spin into an infinite loop even with includeEmptyCharacters
        let errCalls = 0;
        const errView = new LibraryGalleryView(container, {
            onLoadLibraryMedia: async () => {
                errCalls++;
                throw new Error("load failed");
            },
            onPurgeAsset: async () => {},
        });
        (errView as any).includeEmptyCharacters = true;
        await errView.refresh(true);
        expect(errCalls).toBe(1);
    });
});

describe("ui/drawer-panel tab guards, destroy lifecycle, & bulk purge", () => {
    test("protects activeTab during async scanBtn/clearFailedBtn and invalidates gallery cache on bulk purge", async () => {
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-tab", confirmResult: true });

        let resolveScanLibrary!: (res: any) => void;
        let resolveClearFailed!: (res: any) => void;
        let scanLibCalls = 0;
        let listMediaCalls = 0;
        let purgedIds: string[] = [];

        const stats: StorageStatsSummary = {
            totalAssets: 1,
            totalSizeBytes: 100,
            totalFailedUrls: 3,
            settings: { ...DEFAULT_SETTINGS },
        };

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            stats,
            makeIdleQueue(),
            {
                onScanCharacter: async (id) => makeScan(id),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: () => {
                    scanLibCalls++;
                    if (scanLibCalls === 1) {
                        return new Promise((res) => {
                            resolveScanLibrary = res;
                        });
                    }
                    return Promise.resolve({ characters: [], totalUniqueRemote: 0 });
                },
                onListLibraryMedia: async () => {
                    listMediaCalls++;
                    return [];
                },
                onBulkPurgeCharacters: async (ids) => {
                    purgedIds = ids;
                },
                onUpdateSettings: async (patch) => ({
                    settings: { ...DEFAULT_SETTINGS, ...patch },
                    stats,
                }),
                onClearFailed: () =>
                    new Promise((res) => {
                        resolveClearFailed = res;
                    }),
            },
        );

        const unmount = panel.mount(container);

        // Switch to Library tab and start async Scan All
        panel.setActiveTab("library");
        const scanBtn = container.querySelector('button[title*="Scan all characters"]') as any;
        expect(scanBtn).not.toBeNull();
        scanBtn.click();

        // User switches to Settings tab before scan resolves -> resolve scanLibrary must NOT clobber settings DOM
        panel.setActiveTab("settings");
        expect(container.textContent).toContain("Clear Failed (3)");
        resolveScanLibrary({
            characters: [
                {
                    characterId: "c-purge-1",
                    characterName: "PurgeMe",
                    totalUnique: 1,
                    localizedCount: 1,
                    localizedBytes: 512,
                    remoteCount: 1,
                    failedCount: 0,
                    sectionRemoteCounts: {
                        creator_notes: 0,
                        first_mes: 0,
                        core_fields: 1,
                        alternate_greetings: 0,
                        world_books: 0,
                        regex_scripts: 0,
                    },
                },
            ],
            totalUniqueRemote: 1,
        });
        await new Promise((r) => setTimeout(r, 10));
        expect(container.textContent).toContain("Clear Failed (3)");

        // Click Clear Failed on Settings tab, then switch to Gallery tab before it resolves -> must NOT clobber Gallery DOM
        const clearBtn = Array.from(container.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
            (b.textContent ?? "").includes("Clear Failed"),
        );
        expect(clearBtn).toBeDefined();
        clearBtn.click();
        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 10));
        expect(listMediaCalls).toBe(1);

        resolveClearFailed({ cleared: 3, stats: { ...stats, totalFailedUrls: 0 } });
        await new Promise((r) => setTimeout(r, 10));
        // Gallery tab remained mounted rather than overwritten by Settings re-render
        expect(container.textContent).not.toContain("Clear Failed");
        expect(container.querySelector(".ml-empty, .ml-gallery-toolbar")).not.toBeNull();

        // Bulk purge in Library tab invalidates galleryView cache -> switching back to Gallery reloads media
        panel.setActiveTab("library");
        const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]') as unknown as Iterable<any>);
        for (const cb of checkboxes) {
            cb.checked = true;
            cb.dispatchEvent(new MockEvent("change", { bubbles: true }));
        }
        const purgeBtn = Array.from(container.querySelectorAll("button.ml-btn.is-danger") as unknown as Iterable<any>).find((b) =>
            (b.textContent ?? "").includes("Remove"),
        );
        expect(purgeBtn).toBeDefined();
        purgeBtn.click();
        await new Promise((r) => setTimeout(r, 15));
        expect(purgedIds).toContain("c-purge-1");

        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 15));
        expect(listMediaCalls).toBe(2);

        unmount();
    });

    test("Gallery tab preserves options across tab switches and localStorage across panel reloads", async () => {
        const g = globalThis as { localStorage?: Storage };
        const hadLocalStorage = Object.prototype.hasOwnProperty.call(g, "localStorage");
        const prevLocalStorage = g.localStorage;
        const backing = new Map<string, string>();
        g.localStorage = {
            get length() {
                return backing.size;
            },
            clear: () => backing.clear(),
            getItem: (k: string) => backing.get(k) ?? null,
            key: (i: number) => Array.from(backing.keys())[i] ?? null,
            removeItem: (k: string) => {
                backing.delete(k);
            },
            setItem: (k: string, v: string) => {
                backing.set(k, v);
            },
        };

        try {
            const ctxMock = createFrontendMockCtx({ activeCharacterId: null });
            const stats: StorageStatsSummary = {
                totalAssets: 0,
                totalSizeBytes: 0,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            };
            let listMediaCalls = 0;

            const makePanel = (container: HTMLElement) => {
                const panel = new MediaLocalizerDrawerPanel(
                    ctxMock.ctx,
                    { ...DEFAULT_SETTINGS },
                    stats,
                    makeIdleQueue(),
                    {
                        onScanCharacter: async (charId) => makeScan(charId),
                        onStartDownload: async () => {},
                        onSaveCharacterOverride: async () => null,
                        onClearFailedUrls: async () => {},
                        onQueueControl: async () => {},
                        onPurgeCharacterCache: async () => {},
                        onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                        onListLibraryMedia: async (opts) => {
                            listMediaCalls++;
                            return [
                                {
                                    characterId: "c-pref-1",
                                    characterName: "Tagged Char",
                                    tags: ["Fantasy", "Helper"],
                                    avatarImageId: "av-1",
                                    avatarUrl: "/api/v1/images/av-1",
                                    localizedAssets: [],
                                    expressions: [],
                                    totalSizeBytes: 0,
                                    lastLocalizedAt: 0,
                                },
                            ].filter((c) => opts?.includeEmpty || c.localizedAssets.length > 0);
                        },
                        onBulkPurgeCharacters: async () => {},
                        onUpdateSettings: async (patch) => ({
                            settings: { ...DEFAULT_SETTINGS, ...patch },
                            stats,
                        }),
                        onClearFailed: async () => ({ cleared: 0, stats }),
                    },
                );
                const unmount = panel.mount(container);
                return { panel, unmount };
            };

            const container1 = domEnv.document.createElement("div") as unknown as HTMLElement;
            domEnv.document.body.appendChild(container1 as any);
            const { panel: panel1, unmount: unmount1 } = makePanel(container1);

            panel1.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 15));

            // Enable All Cards, switch to List view, change Sort to recent, type search query
            const allCardsBtn = Array.from(container1.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
                (b.textContent ?? "").includes("All Cards"),
            );
            expect(allCardsBtn).toBeDefined();
            allCardsBtn.click();
            await new Promise((r) => setTimeout(r, 15));

            const listBtn = container1.querySelector('button[title="List view"]') as any;
            expect(listBtn).toBeDefined();
            listBtn.click();

            const sortSelect = container1.querySelector('select[title="Sort order"]') as any;
            sortSelect.value = "recent";
            sortSelect.dispatchEvent(new MockEvent("change", { bubbles: true }));

            const searchInput = container1.querySelector('input[type="search"]') as any;
            searchInput.value = "tag:fantasy";
            searchInput.dispatchEvent(new MockEvent("input", { bubbles: true }));

            // Switch to Character tab and back to Gallery -> options, search, and cached cards remain intact without extra RPC
            const callsBeforeSwitch = listMediaCalls;
            panel1.setActiveTab("character");
            panel1.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 15));
            expect(listMediaCalls).toBe(callsBeforeSwitch);

            const restoredAllCards = Array.from(container1.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
                (b.textContent ?? "").includes("All Cards"),
            );
            expect(restoredAllCards.className).toContain("is-active");
            expect((container1.querySelector('button[title="List view"]') as any).className).toContain("is-active");
            expect((container1.querySelector('select[title="Sort order"]') as any).value).toBe("recent");
            expect((container1.querySelector('input[type="search"]') as any).value).toBe("tag:fantasy");
            expect(container1.textContent).toContain("Tagged Char");
            unmount1();

            // Fresh panel instance restores persisted Gallery preferences from localStorage
            const container2 = domEnv.document.createElement("div") as unknown as HTMLElement;
            domEnv.document.body.appendChild(container2 as any);
            const { panel: panel2, unmount: unmount2 } = makePanel(container2);
            panel2.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 15));

            const reloadedAllCards = Array.from(container2.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
                (b.textContent ?? "").includes("All Cards"),
            );
            expect(reloadedAllCards.className).toContain("is-active");
            expect((container2.querySelector('button[title="List view"]') as any).className).toContain("is-active");
            expect((container2.querySelector('select[title="Sort order"]') as any).value).toBe("recent");
            expect(container2.textContent).toContain("Tagged Char");
            unmount2();
        } finally {
            if (hadLocalStorage) {
                g.localStorage = prevLocalStorage;
            } else {
                delete g.localStorage;
            }
        }
    });

    test("Character tab preserves options, override edits, and scan cache across tab switches and localStorage reloads", async () => {
        const g = globalThis as { localStorage?: Storage };
        const hadLocalStorage = Object.prototype.hasOwnProperty.call(g, "localStorage");
        const prevLocalStorage = g.localStorage;
        const backing = new Map<string, string>();
        g.localStorage = {
            get length() {
                return backing.size;
            },
            clear: () => backing.clear(),
            getItem: (k: string) => backing.get(k) ?? null,
            key: (i: number) => Array.from(backing.keys())[i] ?? null,
            removeItem: (k: string) => {
                backing.delete(k);
            },
            setItem: (k: string, v: string) => {
                backing.set(k, v);
            },
        };

        try {
            const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-char-pref" });
            const stats: StorageStatsSummary = {
                totalAssets: 1,
                totalSizeBytes: 512,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            };
            let scanCalls = 0;
            let savedOverride: any = null;
            let saveOverrideCalls = 0;

            const makeCharacterScan = (charId: string): CharacterMediaScanResult =>
                makeScan(charId, {
                    items: [
                        {
                            normalizedUrl: "https://cdn.example.com/loc.png",
                            rawUrls: ["https://cdn.example.com/loc.png"],
                            domain: "cdn.example.com",
                            mediaKind: "image",
                            sources: [{ section: "core_fields", label: "Description" }],
                            occurrenceCount: 1,
                            status: "localized",
                            localizedEntry: {
                                normalizedUrl: "https://cdn.example.com/loc.png",
                                rawUrls: ["https://cdn.example.com/loc.png"],
                                imageId: "img-loc-1",
                                localUrl: "/api/v1/images/img-loc-1",
                                filename: "loc.png",
                                mimeType: "image/png",
                                sizeBytes: 512,
                                localizedAt: 1000,
                                characterIds: [charId],
                                galleryItemIds: {},
                            },
                        },
                        {
                            normalizedUrl: "https://cdn.example.com/rem.png",
                            rawUrls: ["https://cdn.example.com/rem.png"],
                            domain: "cdn.example.com",
                            mediaKind: "image",
                            sources: [{ section: "first_mes", label: "First Message" }],
                            occurrenceCount: 1,
                            status: "remote",
                        },
                    ],
                    override: savedOverride,
                });

            const makePanel = (container: HTMLElement) => {
                const panel = new MediaLocalizerDrawerPanel(
                    ctxMock.ctx,
                    { ...DEFAULT_SETTINGS },
                    stats,
                    makeIdleQueue(),
                    {
                        onScanCharacter: async (charId) => {
                            scanCalls++;
                            return makeCharacterScan(charId);
                        },
                        onStartDownload: async () => {},
                        onSaveCharacterOverride: async (_charId, override) => {
                            saveOverrideCalls++;
                            savedOverride = override;
                            return override;
                        },
                        onClearFailedUrls: async () => {},
                        onQueueControl: async () => {},
                        onPurgeCharacterCache: async () => {},
                        onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                        onListLibraryMedia: async () => [],
                        onBulkPurgeCharacters: async () => {},
                        onUpdateSettings: async (patch) => ({
                            settings: { ...DEFAULT_SETTINGS, ...patch },
                            stats,
                        }),
                        onClearFailed: async () => ({ cleared: 0, stats }),
                    },
                );
                const unmount = panel.mount(container);
                return { panel, unmount };
            };

            const container1 = domEnv.document.createElement("div") as unknown as HTMLElement;
            domEnv.document.body.appendChild(container1 as any);
            const { panel: panel1, unmount: unmount1 } = makePanel(container1);

            await new Promise((r) => setTimeout(r, 15));
            expect(scanCalls).toBe(1);

            // Expand Per-Card Download Options, inspect URLs, switch Downloaded Media to List + "localized" filter
            const gearBtn = container1.querySelector('button[title*="Customize per-card download options"]') as any;
            expect(gearBtn).not.toBeNull();
            gearBtn.click();

            expect(container1.textContent).toContain("Per-Card Download Options");

            const urlPickerBtn = Array.from(container1.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
                (b.textContent ?? "").includes("Inspect & Pick URLs"),
            );
            expect(urlPickerBtn).toBeDefined();
            urlPickerBtn.click();

            const listBtn = container1.querySelector('button[title="List view"]') as any;
            listBtn.click();

            const filterSelect = container1.querySelector('select[title="Filter shown media tiles"]') as any;
            filterSelect.value = "localized";
            filterSelect.dispatchEvent(new MockEvent("change", { bubbles: true }));

            // Uncheck a section checkbox to trigger debounced override save, then immediately switch tabs before 150ms
            const firstCb = container1.querySelector('.ml-options-panel input[type="checkbox"]') as any;
            expect(firstCb).not.toBeNull();
            firstCb.checked = false;
            firstCb.dispatchEvent(new MockEvent("change", { bubbles: true }));

            panel1.setActiveTab("gallery");
            expect(saveOverrideCalls).toBe(1);
            expect(savedOverride).not.toBeNull();

            // Switch back to Character tab -> options, URL picker, filter, override, and scan cache remain intact without extra scan RPC
            const scansBeforeReturn = scanCalls;
            panel1.setActiveTab("character");
            expect(scanCalls).toBe(scansBeforeReturn);
            expect(container1.textContent).toContain("Per-Card Download Options");
            expect(container1.textContent).toContain("Hide URL List");
            expect((container1.querySelector('button[title="List view"]') as any).className).toContain("is-active");
            expect((container1.querySelector('select[title="Filter shown media tiles"]') as any).value).toBe("localized");
            expect((container1.querySelector('.ml-options-panel input[type="checkbox"]') as any).checked).toBe(false);

            // Collapse Downloaded Media and ensure it unmounts tile list
            const collapseBtn = container1.querySelector('button[title="Collapse Downloaded Media"]') as any;
            expect(collapseBtn).not.toBeNull();
            collapseBtn.click();
            expect(container1.querySelector(".ml-media-list")).toBeNull();
            unmount1();

            // Fresh panel instance restores persisted Character UI preferences from localStorage across reload
            const container2 = domEnv.document.createElement("div") as unknown as HTMLElement;
            domEnv.document.body.appendChild(container2 as any);
            const { unmount: unmount2 } = makePanel(container2);
            await new Promise((r) => setTimeout(r, 15));

            expect(container2.textContent).toContain("Per-Card Download Options");
            expect(container2.textContent).toContain("Hide URL List");
            expect(container2.querySelector('button[title="Expand Downloaded Media"]')).not.toBeNull();
            expect(container2.querySelector(".ml-media-list, .ml-asset-grid")).toBeNull();

            // Expand back -> List view and "localized" filter were preserved too
            (container2.querySelector('button[title="Expand Downloaded Media"]') as any).click();
            expect((container2.querySelector('button[title="List view"]') as any).className).toContain("is-active");
            expect((container2.querySelector('select[title="Filter shown media tiles"]') as any).value).toBe("localized");
            unmount2();
        } finally {
            if (hadLocalStorage) {
                g.localStorage = prevLocalStorage;
            } else {
                delete g.localStorage;
            }
        }
    });
});

describe("ui/gallery-integrator native Character Editor Gallery tab", () => {
    test("Downloaded Media collapses by default in native Gallery tab and toggles via unobtrusive button", async () => {
        const galleryTab = domEnv.document.createElement("div") as any;
        galleryTab.className = "Editor_galleryTab_abc";
        const nativeScroll = domEnv.document.createElement("div") as any;
        nativeScroll.className = "Editor_galleryScrollArea_abc";
        galleryTab.appendChild(nativeScroll);
        domEnv.document.body.appendChild(galleryTab);

        const editorCtx = {
            ui: {
                characterEditor: {
                    getState: () => ({
                        open: true,
                        characterId: "c-native-1",
                        activeTabId: "gallery",
                        extensions: {},
                    }),
                    onChange: () => () => {},
                },
                showConfirm: async () => ({ confirmed: true }),
            },
        } as unknown as SpindleFrontendContext;

        const scanWithLocalized = makeScan("c-native-1", {
            items: [
                {
                    normalizedUrl: "https://cdn.example.com/nat.png",
                    rawUrls: ["https://cdn.example.com/nat.png"],
                    domain: "cdn.example.com",
                    mediaKind: "image",
                    sources: [{ section: "core_fields", label: "Description" }],
                    occurrenceCount: 1,
                    status: "localized",
                    localizedEntry: {
                        normalizedUrl: "https://cdn.example.com/nat.png",
                        rawUrls: ["https://cdn.example.com/nat.png"],
                        imageId: "img-nat-1",
                        localUrl: "/api/v1/images/img-nat-1",
                        filename: "nat.png",
                        mimeType: "image/png",
                        sizeBytes: 1024,
                        localizedAt: 1000,
                        characterIds: ["c-native-1"],
                        galleryItemIds: {},
                    },
                },
            ],
        });

        const integrator = new NativeGalleryTabIntegrator(
            editorCtx,
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scanWithLocalized,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
        );

        integrator.start();
        await new Promise((r) => setTimeout(r, 15));

        const host = galleryTab.querySelector(".ml-gallery-host") as any;
        expect(host).not.toBeNull();
        expect(host.textContent).toContain("Downloaded Media (1)");

        // Collapsed by default: tile grid hidden, expand button present with aria-expanded="false"
        const expandBtn = host.querySelector('button[title="Expand Downloaded Media"]') as any;
        expect(expandBtn).not.toBeNull();
        expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
        expect(host.querySelector(".ml-asset-grid")).toBeNull();

        // Click unobtrusive toggle -> expands Downloaded Media grid
        expandBtn.click();
        const collapseBtn = host.querySelector('button[title="Collapse Downloaded Media"]') as any;
        expect(collapseBtn).not.toBeNull();
        expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");
        expect(host.querySelector(".ml-asset-grid")).not.toBeNull();

        // Click again -> collapses back
        collapseBtn.click();
        expect(host.querySelector(".ml-asset-grid")).toBeNull();
        expect(host.querySelector('button[title="Expand Downloaded Media"]')).not.toBeNull();

        integrator.stop();
    });
});

describe("ui/display-swapper URL sanitization, full revert, host-edit guard, & stop() cleanup", () => {
    test("swaps safe URLs across img/style/iframe, rejects unsafe mapped URLs, reverts originals on stop(), and becomes no-op", () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c1" });
        const swapper = new NonDestructiveDisplaySwapper(ctxMock.ctx);

        const img = domEnv.document.createElement("img") as any;
        img.setAttribute("src", "https://cdn.example.com/a.png");

        const unsafeImg = domEnv.document.createElement("img") as any;
        unsafeImg.setAttribute("src", "https://cdn.example.com/unsafe.png");

        const hostModifiedImg = domEnv.document.createElement("img") as any;
        hostModifiedImg.setAttribute("src", "https://cdn.example.com/host.png");

        const styledDiv = domEnv.document.createElement("div") as any;
        styledDiv.setAttribute("style", `background-image: url("https://cdn.example.com/bg.png")`);

        const iframe = domEnv.document.createElement("iframe") as unknown as MockHTMLIFrameElement;
        const innerDoc = new (domEnv.document.constructor as any)();
        const innerImg = innerDoc.createElement("img");
        innerImg.setAttribute("src", "https://cdn.example.com/a.png");
        innerDoc.body.appendChild(innerImg);
        iframe.contentDocument = innerDoc;

        domEnv.document.body.append(img, unsafeImg, hostModifiedImg, styledDiv, iframe as any);

        swapper.start();
        expect(domEnv.document.getListenerCount("error")).toBe(1);
        expect(domEnv.mutationObservers.instances.length).toBe(1);

        swapper.updateMap({
            characterUrlMaps: {
                c1: {
                    "https://cdn.example.com/a.png": "/api/v1/images/local-a",
                    "https://cdn.example.com/host.png": "/api/v1/images/local-host",
                    "https://cdn.example.com/bg.png": "/api/v1/images/local-bg",
                    "https://cdn.example.com/unsafe.png": "javascript:alert(1)",
                },
            },
            allUrlsMap: {
                "https://cdn.example.com/unsafe.png": "//evil.example.com/bad.png",
            },
            updatedAt: 1,
        });

        domEnv.window.flushAnimationFrames();

        expect(img.getAttribute("src")).toBe("/api/v1/images/local-a");
        expect(styledDiv.getAttribute("style")).toContain("/api/v1/images/local-bg");
        expect(innerImg.getAttribute("src")).toBe("/api/v1/images/local-a");
        // Unsafe javascript: / //evil URLs are rejected
        expect(unsafeImg.getAttribute("src")).toBe("https://cdn.example.com/unsafe.png");

        // Host mutates hostModifiedImg externally after swap
        hostModifiedImg.setAttribute("src", "https://host.example.com/replaced-by-user.png");

        // Stop cancels observer, error listener, and reverts only non-host-modified elements
        swapper.stop();

        expect(domEnv.mutationObservers.instances[0]?.disconnected).toBe(true);
        expect(domEnv.document.getListenerCount("error")).toBe(0);
        expect(img.getAttribute("src")).toBe("https://cdn.example.com/a.png");
        expect(styledDiv.getAttribute("style")).toBe(`background-image: url("https://cdn.example.com/bg.png")`);
        expect(innerImg.getAttribute("src")).toBe("https://cdn.example.com/a.png");
        expect(hostModifiedImg.getAttribute("src")).toBe("https://host.example.com/replaced-by-user.png");

        // Post-stop calls are strict no-ops
        swapper.runPassNow();
        expect(img.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    });
});

describe("ui/portrait-button memoization & stop() cleanup", () => {
    test("memoizes button DOM via lastRenderKey and cleans up observer/timers/DOM on stop()", () => {
        const panelOuter = domEnv.document.createElement("div");
        panelOuter.className = "PortraitPanel_panelOuter_xyz";
        const panel = domEnv.document.createElement("div");
        panel.className = "PortraitPanel_panel_abc";
        const nameEl = domEnv.document.createElement("div");
        nameEl.className = "PortraitPanel_name_123";
        nameEl.textContent = "Alice";
        panel.appendChild(nameEl);
        panelOuter.appendChild(panel);
        domEnv.document.body.appendChild(panelOuter);

        let pending = 3;
        const progress = makeIdleQueue();

        const ctrl = new PortraitPanelLocalizeController({
            getActiveCharacterId: () => "c1",
            getPendingCount: () => pending,
            getQueueProgress: () => progress,
            onLocalizeActiveCharacter: async () => {},
            onOpenCharacterTab: () => {},
        });

        ctrl.start();
        const btn = domEnv.document.querySelector(".ml-portrait-localize-btn") as any;
        expect(btn).not.toBeNull();
        expect(btn.textContent).toContain("3");

        // Stamp a custom marker child to verify unchanged state does NOT clobber btn.innerHTML
        const marker = domEnv.document.createElement("span");
        marker.className = "memo-marker";
        btn.appendChild(marker);

        ctrl.sync();
        expect(btn.querySelector(".memo-marker")).not.toBeNull();

        // Changing pending count invalidates render key and rebuilds button
        pending = 5;
        ctrl.sync();
        expect(btn.querySelector(".memo-marker")).toBeNull();
        expect(btn.textContent).toContain("5");

        ctrl.stop();
        expect(domEnv.mutationObservers.instances[0]?.disconnected).toBe(true);
        expect(domEnv.document.querySelector(".ml-portrait-localize-wrap")).toBeNull();

        // Post-stop sync is a no-op
        ctrl.sync();
        expect(domEnv.document.querySelector(".ml-portrait-localize-wrap")).toBeNull();
    });
});

describe("ui/ui-helpers safety, lightbox immutability, & cleanupUiHelpers", () => {
    test("sanitizes unsafe URLs, enforces single InfoTip, keeps lightbox items array immutable, and detaches listeners on cleanup", () => {
        expect(sanitizeSafeMediaUrl("javascript:alert(1)")).toBeNull();
        expect(sanitizeSafeMediaUrl("data:text/html,<script>1</script>")).toBeNull();
        expect(sanitizeSafeMediaUrl("//evil.example.com/a.png")).toBeNull();
        expect(sanitizeSafeMediaUrl("/api/v1/images/img-1")).toBe("/api/v1/images/img-1");
        expect(sanitizeSafeMediaUrl("https://cdn.example.com/ok.png")).toBe("https://cdn.example.com/ok.png");

        safeOpenExternalUrl("javascript:alert(1)");
        expect(domEnv.window.openedUrls.length).toBe(0);
        safeOpenExternalUrl("https://cdn.example.com/ok.png");
        expect(domEnv.window.openedUrls.length).toBe(1);

        // InfoTip attaches lazy click/keydown listeners cleanly and cleanup detaches them
        const tip = createInfoTip("Helpful tip");
        domEnv.document.body.appendChild(tip as any);
        (tip.querySelector("button") as any).click();
        expect(domEnv.document.getListenerCount("click")).toBeGreaterThanOrEqual(1);
        expect(domEnv.document.getListenerCount("keydown")).toBeGreaterThanOrEqual(1);

        // Lazy media element attaches sharedThumbObserver
        createLazyMediaElement({
            src: "https://cdn.example.com/lazy.png",
            mediaKind: "image",
            alt: "lazy",
            className: "lazy-cls",
        });
        expect(domEnv.intersectionObservers.instances.length).toBe(1);

        // openMediaLightbox does NOT mutate caller's items array on delete
        const items = [
            {
                id: "item-1",
                localUrl: "/api/v1/images/img-1",
                mediaKind: "image" as const,
                title: "First",
                onRemove: async () => {},
            },
            {
                id: "item-2",
                localUrl: "/api/v1/images/img-2",
                mediaKind: "image" as const,
                title: "Second",
                onRemove: async () => {},
            },
        ];
        openMediaLightbox(items, 0);
        const delBtn = Array.from(domEnv.document.querySelectorAll(".ml-lightbox-backdrop button") as any[]).find((b) =>
            (b.getAttribute("title") ?? b.textContent ?? "").toLowerCase().includes("delete") ||
            (b.getAttribute("title") ?? "").toLowerCase().includes("remove"),
        );
        expect(delBtn).toBeDefined();
        delBtn.click();
        expect(items.length).toBe(2);

        // Escape closes lightbox; cleanupUiHelpers disconnects observer and listeners
        domEnv.document.dispatchEvent(new MockKeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(domEnv.document.querySelector(".ml-lightbox-backdrop")).toBeNull();

        cleanupUiHelpers();
        expect(domEnv.intersectionObservers.instances[0]?.disconnected).toBe(true);
        expect(domEnv.document.getListenerCount("click")).toBe(0);
        expect(domEnv.document.getListenerCount("keydown")).toBe(0);
    });
});

describe("frontend setup(ctx) lifecycle & React refresh safety", () => {
    test("triggerNativeGalleryAndPortraitReactRefresh tolerates circular fibers and throwing state updaters", () => {
        const panel = domEnv.document.createElement("div") as any;
        panel.className = "PortraitPanel_panel_x";
        const fiberA: any = { memoizedState: { queue: { dispatch: () => { throw new Error("boom"); } } } };
        const fiberB: any = { return: fiberA };
        fiberA.return = fiberB; // cycle!
        panel.__reactFiber$test = fiberB;
        domEnv.document.body.appendChild(panel);

        expect(() => triggerNativeGalleryAndPortraitReactRefresh()).not.toThrow();
    });

    test("setup(ctx) completes RPC bootstrap, handles URL_MAP_UPDATED / ENSURE_GALLERY_LINKS / purge invalidation, and cleans up on teardown", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-setup-1" });
        const fetchCalls: Array<{ url: string; method: string }> = [];

        globalThis.fetch = (async (url: string, init?: RequestInit) => {
            fetchCalls.push({ url: String(url), method: init?.method ?? "GET" });
            if ((init?.method ?? "GET") === "GET") {
                return new Response(JSON.stringify({ data: [] }), { status: 200 });
            }
            if ((init?.method ?? "GET") === "POST") {
                return new Response(JSON.stringify({ id: "gal-new-1" }), { status: 200 });
            }
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        const imgEl = domEnv.document.createElement("img") as any;
        imgEl.setAttribute("src", "https://cdn.example.com/setup.png");
        domEnv.document.body.appendChild(imgEl);

        const teardown = setup(ctxMock.ctx);

        // Initial RPC sent for get_init_state
        const initReq = ctxMock.sentMessages.find((m) => m.action === "get_init_state");
        expect(initReq).toBeDefined();

        // Respond to get_init_state & scan_character
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: initReq.requestId,
            result: {
                stats: { totalAssets: 0, totalSizeBytes: 0, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                queueProgress: makeIdleQueue(),
                urlMapPayload: {
                    characterUrlMaps: { "c-setup-1": { "https://cdn.example.com/setup.png": "/api/v1/images/local-setup" } },
                    allUrlsMap: {},
                    updatedAt: 1,
                },
            },
        });

        await new Promise((r) => setTimeout(r, 10));
        domEnv.window.flushAnimationFrames();
        expect(imgEl.getAttribute("src")).toBe("/api/v1/images/local-setup");

        // Answer background scan_character requests and keep one RPC intentionally unresolved to verify teardown rejection
        for (const msg of ctxMock.sentMessages.filter((m) => m.action === "scan_character")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: msg.requestId,
                result: { scan: makeScan("c-setup-1"), urlMapPayload: null, pendingGalleryLinks: [] },
            });
        }
        await new Promise((r) => setTimeout(r, 10));

        // Mounted drawer tab exists cleanly inside tab.root
        expect(ctxMock.drawerTabs[0]).toBeDefined();

        // Simulate ENSURE_GALLERY_LINKS -> fetches native gallery & posts link & emits record_gallery_links
        ctxMock.emitBackendMessage({
            type: "ENSURE_GALLERY_LINKS",
            characterId: "c-setup-1",
            links: [
                {
                    characterId: "c-setup-1",
                    imageId: "img-link-1",
                    normalizedUrl: "https://cdn.example.com/link.png",
                    caption: "link.png",
                },
            ],
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(fetchCalls.some((c) => c.method === "POST" && c.url.includes("/api/v1/characters/c-setup-1/gallery"))).toBe(true);
        expect(ctxMock.sentMessages.some((m) => m.action === "record_gallery_links")).toBe(true);

        const recReq = ctxMock.sentMessages.find((m) => m.action === "record_gallery_links");
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: recReq.requestId,
            result: { updated: 1 },
        });

        // Trigger a force refresh scan via QUEUE_PROGRESS active -> completed and verify pending RPC rejects cleanly on teardown
        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "running", totalQueued: 1 },
        });
        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "completed", totalQueued: 1, completedCount: 1, succeededCount: 1 },
        });
        await new Promise((r) => setTimeout(r, 10));

        // Reply to any completed-triggered scan_character requests
        for (const msg of ctxMock.sentMessages.filter((m) => m.action === "scan_character")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: msg.requestId,
                result: { scan: makeScan("c-setup-1"), urlMapPayload: null, pendingGalleryLinks: [] },
            });
        }

        // Teardown cleans UI helpers, cancels timers, and calls ctx.dom.cleanup()
        teardown();
        expect(ctxMock.getCleanupDomCalls()).toBe(1);
    });

    test("#7.1: CharacterMediaWidget prevents unchecking last greeting, World Book, or domain pill", async () => {
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const scan = makeScan("char-empty-pill", {
            greetingBreakdown: [
                { greetingIndex: 1, label: "Greeting 1", totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
                { greetingIndex: 2, label: "Greeting 2", totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
            ],
            worldBookBreakdown: [
                { worldBookId: "wb-1", worldBookName: "Lore 1", totalUnique: 1, remoteCount: 1, localizedCount: 0, failedCount: 0 },
                { worldBookId: "wb-2", worldBookName: "Lore 2", totalUnique: 1, remoteCount: 0, localizedCount: 0, failedCount: 1 },
            ],
        });
        const ctxMock = createFrontendMockCtx({ confirmResult: true });
        const widget = new CharacterMediaWidget(
            container,
            ctxMock.ctx,
            "char-empty-pill",
            {
                ...DEFAULT_SETTINGS,
                defaultSections: ["core_fields", "alternate_greetings", "world_books"],
            },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scan,
                onStartDownload: async () => {},
                onClearFailedUrls: async () => {},
                onPurgeCharacterCache: async () => {},
                onSaveCharacterOverride: async (_cid, ov) => ov,
                onQueueControl: async () => {},
            },
            {
                initialUiState: {
                    showDownloadConfig: true,
                    showGreetingSubfilter: true,
                    showWorldBookSubfilter: true,
                },
            },
        );
        await widget.refreshScan(false);

        const dispatch = (el: Element, type: string) =>
            (el as any).dispatchEvent(new MockEvent(type, { bubbles: true }) as unknown as Event);

        // Greetings subfilter: 2 checkboxes. Uncheck 1st -> allowed; uncheck 2nd -> blocked (stays checked)
        const getGreetCbs = () =>
            Array.from(
                container
                    .querySelector('[data-scroll-id="greetings-subfilter"]')!
                    .querySelectorAll("input[type='checkbox']"),
            ) as HTMLInputElement[];
        expect(getGreetCbs().length).toBe(2);
        getGreetCbs()[0]!.checked = false;
        dispatch(getGreetCbs()[0]!, "change");
        expect(getGreetCbs()[0]!.checked).toBe(false);
        getGreetCbs()[1]!.checked = false;
        dispatch(getGreetCbs()[1]!, "change");
        expect(getGreetCbs()[1]!.checked).toBe(true);

        // World Books subfilter: 2 checkboxes. Uncheck 1st -> allowed; uncheck 2nd -> blocked (stays checked)
        const getWbCbs = () =>
            Array.from(
                container
                    .querySelector('[data-scroll-id="worldbooks-subfilter"]')!
                    .querySelectorAll("input[type='checkbox']"),
            ) as HTMLInputElement[];
        expect(getWbCbs().length).toBe(2);
        getWbCbs()[0]!.checked = false;
        dispatch(getWbCbs()[0]!, "change");
        expect(getWbCbs()[0]!.checked).toBe(false);
        getWbCbs()[1]!.checked = false;
        dispatch(getWbCbs()[1]!, "change");
        expect(getWbCbs()[1]!.checked).toBe(true);

        // Domain pills: cdn.example.com and fail.example.com. Uncheck first -> allowed; uncheck second -> blocked
        const getDomainPills = () =>
            Array.from(container.querySelectorAll("button.ml-pill")).filter((b) =>
                (b.textContent ?? "").includes(".example.com"),
            ) as HTMLButtonElement[];
        expect(getDomainPills().length).toBe(2);
        dispatch(getDomainPills()[0]!, "click");
        expect(getDomainPills()[0]!.classList.contains("is-selected")).toBe(false);
        dispatch(getDomainPills()[1]!, "click");
        expect(getDomainPills()[1]!.classList.contains("is-selected")).toBe(true);

        widget.destroy();
    });

    test("#7.2 & #7.6: onIgnoreUrls flushes pending override save, overlapping scan preserves edits, refresh button locks while busy, and post-confirm destroy aborts", async () => {
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const scan = makeScan("char-race");
        let savedOverride: any = null;
        let saveCount = 0;
        let resolveSecondScan!: (res: CharacterMediaScanResult) => void;
        let scanCall = 0;
        let downloadCalls = 0;
        let resolveConfirm!: (res: { confirmed: boolean }) => void;

        const ctxMock = createFrontendMockCtx({ confirmResult: true });
        (ctxMock.ctx.ui as any).showConfirm = () =>
            new Promise<{ confirmed: boolean }>((resolve) => {
                resolveConfirm = resolve;
            });

        const widget = new CharacterMediaWidget(
            container,
            ctxMock.ctx,
            "char-race",
            { ...DEFAULT_SETTINGS, confirmThreshold: 0 },
            makeIdleQueue(),
            {
                onScanCharacter: async () => {
                    scanCall++;
                    if (scanCall === 1) return scan;
                    if (scanCall === 2) {
                        return await new Promise<CharacterMediaScanResult>((resolve) => {
                            resolveSecondScan = resolve;
                        });
                    }
                    return scan;
                },
                onStartDownload: async () => {
                    downloadCalls++;
                },
                onClearFailedUrls: async () => {},
                onPurgeCharacterCache: async () => {},
                onSaveCharacterOverride: async (_cid, ov) => {
                    saveCount++;
                    savedOverride = ov;
                    return ov;
                },
                onQueueControl: async () => {},
            },
            { defaultExpandConfig: true },
        );
        await widget.refreshScan(false);

        const clickEl = (el: Element) =>
            (el as any).dispatchEvent(new MockEvent("click", { bubbles: true }) as unknown as Event);
        const changeEl = (el: Element) =>
            (el as any).dispatchEvent(new MockEvent("change", { bubbles: true }) as unknown as Event);

        const refreshBtn = Array.from(container.querySelectorAll("button")).find(
            (b) => b.title.includes("Rescan character fields"),
        ) as HTMLButtonElement;
        clickEl(refreshBtn);
        expect(refreshBtn.disabled).toBe(true);

        // Toggle Alternate Greetings section off while second scan is in-flight
        const getAltGreetCb = () => {
            const label = Array.from(container.querySelectorAll(".ml-options-panel label")).find((c) =>
                (c.textContent ?? "").includes("Alternate Greetings"),
            )!;
            return label.querySelector("input[type='checkbox']") as HTMLInputElement;
        };
        const altGreetCb = getAltGreetCb();
        altGreetCb.checked = false;
        changeEl(altGreetCb);
        expect(getAltGreetCb().checked).toBe(false);

        // Finish second scan while debounce is still pending -> local filter selection remains unchecked
        resolveSecondScan(scan);
        await new Promise((r) => setTimeout(r, 20));
        expect(getAltGreetCb().checked).toBe(false);
        // Wait for 150ms debounce timer to fire and persist the override
        await new Promise((r) => setTimeout(r, 165));
        expect(saveCount).toBeGreaterThanOrEqual(1);
        expect(savedOverride?.sections).not.toContain("alternate_greetings");
        expect(getAltGreetCb().checked).toBe(false);

        // Trigger ignore failure while another debounced edit is pending -> must flush first
        const domainPills = Array.from(container.querySelectorAll("button.ml-pill")).filter((b) =>
            (b.textContent ?? "").includes(".example.com"),
        ) as HTMLButtonElement[];
        clickEl(domainPills[0]!);
        const prevSaves = saveCount;
        const ignoreBtn = Array.from(container.querySelectorAll("button")).find(
            (b) => (b.textContent ?? "") === "Ignore All",
        ) as HTMLButtonElement;
        clickEl(ignoreBtn);
        await new Promise((r) => setTimeout(r, 20));
        expect(saveCount).toBeGreaterThan(prevSaves);
        expect(savedOverride?.excludedUrls).toContain("https://cdn.example.com/char-race-fail.png");

        // Re-enable domain pill 0 so 1 remote item matches, then start one-click localize above confirmThreshold -> destroy before confirm resolves -> no download
        const reDomainPills = Array.from(container.querySelectorAll("button.ml-pill")).filter((b) =>
            (b.textContent ?? "").includes(".example.com"),
        ) as HTMLButtonElement[];
        clickEl(reDomainPills[0]!);
        const localizeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            (b.textContent ?? "").includes("Localize"),
        ) as HTMLButtonElement;
        clickEl(localizeBtn);
        widget.destroy();
        resolveConfirm({ confirmed: true });
        await new Promise((r) => setTimeout(r, 20));
        expect(downloadCalls).toBe(0);
    });

    test("#7.3, #7.4, #7.5, #7.6: Drawer panel Gallery destroy/refresh, scan setting invalidation, 50/page Library pagination, lightbox single-refresh without Random reshuffle, and tab-scoped errors", async () => {
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "char-1", confirmResult: true });
        let currentSettings: MediaLocalizerSettings = { ...DEFAULT_SETTINGS };
        const stats: StorageStatsSummary = {
            totalAssets: 2,
            totalSizeBytes: 240,
            totalFailedUrls: 0,
            settings: currentSettings,
        };
        let scanCalls = 0;
        let galleryLoads = 0;
        const purgedUrls: string[] = [];
        let rejectSettingsSave!: (err: Error) => void;

        const libChars = Array.from({ length: 120 }, (_, i) => ({
            characterId: `lib-${i + 1}`,
            characterName: `Library Char ${String(i + 1).padStart(3, "0")}`,
            totalUnique: 1,
            localizedCount: 1,
            localizedBytes: 512,
            remoteCount: 1,
            failedCount: 0,
            sectionRemoteCounts: {
                creator_notes: 0,
                first_mes: 0,
                core_fields: 1,
                alternate_greetings: 0,
                world_books: 0,
                regex_scripts: 0,
            },
        }));

        const galleryChars = [
            {
                characterId: "g-1",
                characterName: "Alpha",
                tags: [],
                avatarImageId: null,
                avatarUrl: null,
                localizedAssets: [
                    {
                        normalizedUrl: "https://cdn.example.com/a1.png",
                        rawUrls: ["https://cdn.example.com/a1.png"],
                        imageId: "img-a1",
                        localUrl: "/api/v1/images/img-a1",
                        mediaKind: "image" as const,
                        mimeType: "image/png",
                        sizeBytes: 120,
                        filename: "a1.png",
                        localizedAt: 100,
                        characterIds: ["g-1"],
                        galleryItemIds: {},
                    },
                    {
                        normalizedUrl: "https://cdn.example.com/a2.png",
                        rawUrls: ["https://cdn.example.com/a2.png"],
                        imageId: "img-a2",
                        localUrl: "/api/v1/images/img-a2",
                        mediaKind: "image" as const,
                        mimeType: "image/png",
                        sizeBytes: 120,
                        filename: "a2.png",
                        localizedAt: 150,
                        characterIds: ["g-1"],
                        galleryItemIds: {},
                    },
                ],
                expressions: [],
                totalSizeBytes: 120,
                lastLocalizedAt: 100,
            },
            {
                characterId: "g-2",
                characterName: "Zeta",
                tags: [],
                avatarImageId: null,
                avatarUrl: null,
                localizedAssets: [
                    {
                        normalizedUrl: "https://cdn.example.com/z1.png",
                        rawUrls: ["https://cdn.example.com/z1.png"],
                        imageId: "img-z1",
                        localUrl: "/api/v1/images/img-z1",
                        mediaKind: "image" as const,
                        mimeType: "image/png",
                        sizeBytes: 120,
                        filename: "z1.png",
                        localizedAt: 200,
                        characterIds: ["g-2"],
                        galleryItemIds: {},
                    },
                ],
                expressions: [],
                totalSizeBytes: 120,
                lastLocalizedAt: 200,
            },
        ];

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            currentSettings,
            stats,
            makeIdleQueue(),
            {
                onScanCharacter: async () => {
                    scanCalls++;
                    return makeScan("char-1");
                },
                onScanLibrary: async () => ({
                    characters: libChars,
                    totalUniqueRemote: 120,
                }),
                onListLibraryMedia: async () => {
                    galleryLoads++;
                    return galleryChars.map((c) => ({
                        ...c,
                        localizedAssets: c.localizedAssets.filter(
                            (a) => !purgedUrls.includes(a.normalizedUrl),
                        ),
                    }));
                },
                onStartDownload: async () => {},
                onClearFailedUrls: async () => {},
                onPurgeCharacterCache: async (_cid, urls) => {
                    if (urls) purgedUrls.push(...urls);
                },
                onBulkPurgeCharacters: async () => {},
                onSaveCharacterOverride: async (_cid, ov) => ov,
                onQueueControl: async () => {},
                onUpdateSettings: (patch) => {
                    if ("maxFileSizeMb" in patch) {
                        return new Promise<any>((_, reject) => {
                            rejectSettingsSave = reject;
                        });
                    }
                    currentSettings = { ...currentSettings, ...patch };
                    return Promise.resolve({
                        settings: currentSettings,
                        stats: { ...stats, settings: currentSettings },
                    });
                },
                onClearFailed: async () => ({ cleared: 0, stats }),
            },
        );

        const dispatch = (el: Element, type: string) =>
            (el as any).dispatchEvent(new MockEvent(type, { bubbles: true }) as unknown as Event);

        const unmount = panel.mount(container);
        await new Promise((r) => setTimeout(r, 15));
        expect(scanCalls).toBe(1);

        // Changing scanBareUrls invalidates character scan cache -> re-scans even when scan is already cached
        const updatedSettings = { ...currentSettings, scanBareUrls: false };
        panel.updateExternalState(updatedSettings, stats, makeIdleQueue());
        await new Promise((r) => setTimeout(r, 15));
        expect(scanCalls).toBe(2);

        // Switch to Settings, reject an in-flight save AFTER switching away -> must not show error on active tab
        const settingsBtn = Array.from(container.querySelectorAll("button.ml-drawer-nav-btn")).find((b) =>
            (b.textContent ?? "").includes("Settings"),
        ) as HTMLButtonElement;
        dispatch(settingsBtn, "click");
        const maxSizeCard = Array.from(container.querySelectorAll(".ml-check-card")).find((c) =>
            (c.textContent ?? "").includes("Max File Size (MB)"),
        )!;
        const maxSizeInput = maxSizeCard.querySelector("input[type='number']") as HTMLInputElement;
        maxSizeInput.value = "42";
        dispatch(maxSizeInput, "change");

        // Switch to Library before save rejects -> scan library, check 50/page pagination & isolated checkbox DOM update
        const libraryBtn = Array.from(container.querySelectorAll("button.ml-drawer-nav-btn")).find((b) =>
            (b.textContent ?? "").includes("Library"),
        ) as HTMLButtonElement;
        dispatch(libraryBtn, "click");
        rejectSettingsSave(new Error("settings boom"));
        await new Promise((r) => setTimeout(r, 20));
        expect(container.querySelector(".ml-error-banner")).toBeNull();

        const scanLibBtn = container.querySelector('button[title*="Scan all characters"]') as HTMLButtonElement;
        dispatch(scanLibBtn, "click");
        await new Promise((r) => setTimeout(r, 20));

        const rowsPage1 = container.querySelectorAll(".ml-lib-row");
        expect(rowsPage1.length).toBe(50);
        const firstCheckbox = rowsPage1[0]!.querySelector("input[type='checkbox']") as HTMLInputElement;
        const sentinelRow = rowsPage1[0]!;
        firstCheckbox.checked = true;
        dispatch(firstCheckbox, "change");
        // Targeted DOM update preserves row nodes rather than rebuilding the full list
        expect(container.querySelectorAll(".ml-lib-row")[0]).toBe(sentinelRow);

        const getNextPageBtn = () =>
            Array.from(container.querySelectorAll("button")).find(
                (b) => (b.textContent ?? "") === "Next",
            ) as HTMLButtonElement;
        dispatch(getNextPageBtn(), "click");
        expect(container.querySelectorAll(".ml-lib-row").length).toBe(50);
        dispatch(getNextPageBtn(), "click");
        expect(container.querySelectorAll(".ml-lib-row").length).toBe(20);

        // Switch to Gallery tab, sort Random, open lightbox & delete 1 item -> single refresh and no Random reshuffle
        const galleryBtn = Array.from(container.querySelectorAll("button.ml-drawer-nav-btn")).find((b) =>
            (b.textContent ?? "").includes("Gallery"),
        ) as HTMLButtonElement;
        dispatch(galleryBtn, "click");
        await new Promise((r) => setTimeout(r, 20));
        expect(galleryLoads).toBe(1);

        const sortSelect = container.querySelector("select.ml-select") as HTMLSelectElement;
        sortSelect.value = "random";
        dispatch(sortSelect, "change");

        // Open Alpha drilldown and open lightbox on its asset
        const alphaName = Array.from(container.querySelectorAll(".ml-char-card-name")).find(
            (el) => el.textContent === "Alpha",
        )!;
        const alphaCard = alphaName.closest(".ml-char-card") as HTMLElement;
        dispatch(alphaCard, "click");
        const weightsBeforeDelete = new Map((panel as any).galleryCache.randomWeights);
        const thumb = container.querySelector(".ml-asset-thumb-wrap") as HTMLElement;
        dispatch(thumb, "click");
        const removeBtn = Array.from(domEnv.document.body.querySelectorAll("button")).find(
            (b) => (b.textContent ?? "") === "Remove",
        ) as unknown as HTMLButtonElement;
        const loadsBeforeDelete = galleryLoads;
        dispatch(removeBtn, "click");
        await new Promise((r) => setTimeout(r, 25));

        expect(purgedUrls.length).toBe(1);
        expect(["https://cdn.example.com/a1.png", "https://cdn.example.com/a2.png"]).toContain(
            purgedUrls[0]!,
        );
        expect(galleryLoads).toBe(loadsBeforeDelete + 1); // single refresh, not double
        expect(new Map((panel as any).galleryCache.randomWeights)).toEqual(weightsBeforeDelete);

        // Return from drilldown and verify external totalAssets change while on Gallery refreshes rather than blanking to empty state
        const backBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            (b.textContent ?? "").includes("All Characters"),
        ) as HTMLButtonElement;
        dispatch(backBtn, "click");
        panel.updateExternalState(
            updatedSettings,
            { totalAssets: 3, totalSizeBytes: 360, totalFailedUrls: 0, settings: updatedSettings },
            makeIdleQueue(),
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(galleryLoads).toBe(loadsBeforeDelete + 2);
        expect(container.querySelector(".ml-char-card-name")).not.toBeNull();

        // Switching away destroys active GalleryView so subsequent external invalidation won't call onLoadLibraryMedia
        const charBtn = Array.from(container.querySelectorAll("button.ml-drawer-nav-btn")).find((b) =>
            (b.textContent ?? "").includes("Character"),
        ) as HTMLButtonElement;
        dispatch(charBtn, "click");
        const loadsAfterLeave = galleryLoads;
        panel.updateExternalState(
            updatedSettings,
            { totalAssets: 4, totalSizeBytes: 480, totalFailedUrls: 0, settings: updatedSettings },
            makeIdleQueue(),
        );
        await new Promise((r) => setTimeout(r, 15));
        expect(galleryLoads).toBe(loadsAfterLeave);

        unmount();
    });

    test("#7.7: styles include drawer media list uncap, truncation, error wrapping, nav wrapping, and tooltip edge alignment", () => {
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-drawer-root .ml-media-list");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-check-card-left > span");
        expect(MEDIA_LOCALIZER_STYLES).toContain("overflow-wrap: anywhere;");
        expect(MEDIA_LOCALIZER_STYLES).toContain("flex-wrap: wrap;");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-setting-toggle-row .ml-tip-popover");
    });
});
