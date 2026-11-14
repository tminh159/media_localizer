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
import {
    CharacterMediaWidget,
    getDefaultCharacterPreferences,
    sanitizeCharacterPreferences,
} from "../ui/character-media-widget";
import { NonDestructiveDisplaySwapper } from "../ui/display-swapper";
import { MediaLocalizerDrawerPanel } from "../ui/drawer-panel";
import { NativeGalleryTabIntegrator } from "../ui/gallery-integrator";
import {
    getDefaultGalleryPreferences,
    LibraryGalleryView,
    sanitizeGalleryPreferences,
} from "../ui/library-gallery";
import { MEDIA_LOCALIZER_STYLES } from "../ui/styles";
import { PortraitPanelLocalizeController } from "../ui/portrait-button";
import {
    canOpenNativeCharacterEditor,
    cleanupUiHelpers,
    createIcon,
    createInfoTip,
    createLazyMediaElement,
    getThumbnailImageTier,
    getThumbnailSizeClass,
    openMediaLightbox,
    openNativeCharacterEditor,
    renderQueueBanner,
    safeOpenExternalUrl,
    sanitizeSafeMediaUrl,
    sanitizeThumbnailSize,
    toThumbnailMediaUrl,
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

    test("updates per-card URL limit (increase, decrease, unlimited, clamp) and Retry Failed state across re-renders and override saves", async () => {
        const root = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(root as any);

        const items: CharacterMediaScanResult["items"] = Array.from({ length: 65 }, (_, idx) => ({
            normalizedUrl: `https://cdn.example.com/item-${idx}.png`,
            rawUrls: [`https://cdn.example.com/item-${idx}.png`],
            domain: "cdn.example.com",
            mediaKind: "image" as const,
            sources: [{ section: "core_fields" as const, label: "Description" }],
            occurrenceCount: 1,
            status: "remote" as const,
        }));
        items.push({
            normalizedUrl: "https://cdn.example.com/item-fail.png",
            rawUrls: ["https://cdn.example.com/item-fail.png"],
            domain: "cdn.example.com",
            mediaKind: "image" as const,
            sources: [{ section: "core_fields" as const, label: "Description" }],
            occurrenceCount: 1,
            status: "failed" as const,
        });

        const largeScan = makeScan("c-limit", {
            totalOccurrences: items.length,
            items,
            sectionCounts: {
                creator_notes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
                first_mes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
                core_fields: { totalUnique: items.length, remoteCount: 65, localizedCount: 0, failedCount: 1 },
                alternate_greetings: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
                world_books: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
                regex_scripts: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
            },
            greetingBreakdown: [],
            worldBookBreakdown: [],
            domainBreakdown: [
                { domain: "cdn.example.com", totalUnique: items.length, remoteCount: 65, localizedCount: 0, failedCount: 1 },
            ],
        });

        const savedOverrides: Array<any> = [];
        const startedFilters: Array<any> = [];
        const ctxMock = createFrontendMockCtx({ confirmResult: true });

        const widget = new CharacterMediaWidget(
            root,
            ctxMock.ctx,
            "c-limit",
            { ...DEFAULT_SETTINGS, confirmThreshold: 500 },
            makeIdleQueue(),
            {
                onScanCharacter: async () => largeScan,
                onStartDownload: async (filter) => {
                    startedFilters.push(filter);
                },
                onSaveCharacterOverride: async (_charId, override) => {
                    savedOverrides.push(override);
                    return override;
                },
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
            { defaultExpandConfig: true },
        );

        await widget.refreshScan(false);

        const getLimitInput = () =>
            root.querySelector("input.ml-input-num") as HTMLInputElement;
        const getRetryFailedCheckbox = () => {
            const labels = Array.from(root.querySelectorAll("label.ml-checkbox-item"));
            const target = labels.find((lbl) =>
                (lbl.textContent ?? "").includes("Retry previously failed URLs"),
            );
            return target?.querySelector("input[type='checkbox']") as HTMLInputElement;
        };

        expect(getLimitInput().value).toBe("50");
        expect(widget.getPendingDownloadCount()).toBe(50);

        // Increase above 50
        const upInput = getLimitInput();
        upInput.value = "100";
        upInput.dispatchEvent(new MockEvent("change") as any);
        expect(getLimitInput().value).toBe("100");
        expect(widget.getPendingDownloadCount()).toBe(66);
        await widget.flushPendingOverrideSave();
        expect(savedOverrides.at(-1)).toEqual({ maxItems: 100 });

        // Decrease below 50
        const downInput = getLimitInput();
        downInput.value = "10";
        downInput.dispatchEvent(new MockEvent("change") as any);
        expect(getLimitInput().value).toBe("10");
        expect(widget.getPendingDownloadCount()).toBe(10);
        await widget.flushPendingOverrideSave();
        expect(savedOverrides.at(-1)).toEqual({ maxItems: 10 });

        // Set to 0 (unlimited)
        const zeroInput = getLimitInput();
        zeroInput.value = "0";
        zeroInput.dispatchEvent(new MockEvent("change") as any);
        expect(getLimitInput().value).toBe("0");
        expect(widget.getPendingDownloadCount()).toBe(66);
        await widget.flushPendingOverrideSave();
        expect(savedOverrides.at(-1)).toEqual({ maxItems: 0 });

        // Toggle Retry previously failed URLs
        const failedCb = getRetryFailedCheckbox();
        expect(failedCb.checked).toBe(true);
        failedCb.checked = false;
        failedCb.dispatchEvent(new MockEvent("change") as any);
        expect(getRetryFailedCheckbox().checked).toBe(false);
        expect(widget.getPendingDownloadCount()).toBe(65);
        await widget.flushPendingOverrideSave();
        expect(savedOverrides.at(-1)).toEqual({ includeFailed: false, maxItems: 0 });

        // Clamp above max (2000)
        const overMaxInput = getLimitInput();
        overMaxInput.value = "3000";
        overMaxInput.dispatchEvent(new MockEvent("change") as any);
        expect(getLimitInput().value).toBe("2000");

        // Trigger download with updated override values
        await widget.triggerOneClickLocalize();
        expect(startedFilters.length).toBe(1);
        expect(startedFilters[0].maxItems).toBe(2000);
        expect(startedFilters[0].includeFailed).toBe(false);

        widget.destroy();
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
        expect(MEDIA_LOCALIZER_STYLES).toContain("[data-spindle-drawer-tab]:has(> .ml-drawer-root)");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-check-card-left > span");
        expect(MEDIA_LOCALIZER_STYLES).toContain("overflow-wrap: anywhere;");
        expect(MEDIA_LOCALIZER_STYLES).toContain("flex-wrap: wrap;");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-setting-toggle-row .ml-tip-popover");
    });

    test("styles and drawer-panel expose compact layout hooks and responsive grid rules without dead classes", () => {
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-drawer-root .ml-gallery-host");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-drawer-root .ml-widget");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-section + .ml-section");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-combined-drawer");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-combined-bar");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-combined-trigger");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-combined-pane");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-media-toolbar");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-gallery-host.is-embedded .ml-widget");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-compact-row");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-url-list.is-tall");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-setting-toggle-grid");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-gallery-drilldown-header");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-section-box");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-collapse-btn");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-asset-actions");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-header-info");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-title-row");

        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-1" });
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 1, settings: { ...DEFAULT_SETTINGS } },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => [],
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 1, settings: { ...DEFAULT_SETTINGS } },
                }),
                onClearFailed: async () => ({
                    cleared: 1,
                    stats: { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                }),
            },
        );
        const unmount = panel.mount(container);
        panel.setActiveTab("settings");
        expect(container.querySelector(".ml-setting-toggle-grid")).not.toBeNull();
        expect(container.querySelectorAll(".ml-setting-toggle-grid .ml-setting-toggle-row").length).toBe(5);
        expect(container.querySelector(".ml-inline-stats")?.textContent).toContain("Localized Cache Summary");
        unmount();
    });

    test("styles align with Lumiverse tokens, lightbox z-index, and visual overhaul hooks, and UI helpers render icons and queue states", () => {
        expect(MEDIA_LOCALIZER_STYLES).toContain("--lumiverse-primary");
        expect(MEDIA_LOCALIZER_STYLES).toContain("--lumiverse-bg-elevated");
        expect(MEDIA_LOCALIZER_STYLES).toContain("var(--lumiverse-z-lightbox, 10005)");
        expect(MEDIA_LOCALIZER_STYLES).toContain("scrollbar-width: thin;");
        expect(MEDIA_LOCALIZER_STYLES).toContain(":focus-visible");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-segmented");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-input-wrap");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-char-card-scrim");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-tile-badge.is-video");
        expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-gallery-host.is-embedded");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain("--lumiverse-bg-surface");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-btn.is-ghost");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-check-card.is-empty");
        expect(MEDIA_LOCALIZER_STYLES).not.toContain(".ml-empty-hint");

        for (const name of [
            "search",
            "play",
            "smile",
            "user",
            "sliders",
            "layers",
            "folder",
            "database",
            "shield",
            "filter",
        ] as const) {
            const svg = createIcon(name, 13);
            expect(svg.classList.contains("ml-icon")).toBe(true);
            expect(svg.getAttribute("width")).toBe("13");
            expect(svg.innerHTML.length).toBeGreaterThan(0);
        }

        const runningBanner = renderQueueBanner(
            {
                ...makeIdleQueue(),
                status: "running",
                totalQueued: 10,
                completedCount: 4,
                succeededCount: 3,
                skippedCount: 1,
                failedCount: 0,
                activeUrls: [{ characterId: "c-1", characterName: "Char 1", url: "https://cdn.example.com/a.png", startedAt: 1000 }],
            },
            async () => {},
        );
        expect(runningBanner.classList.contains("is-running")).toBe(true);
        expect(runningBanner.querySelector(".ml-progress-fill.is-active")).not.toBeNull();
        expect(runningBanner.querySelectorAll(".ml-stat-strip .ml-stat-chip").length).toBe(3);

        const pausedBanner = renderQueueBanner(
            {
                ...makeIdleQueue(),
                status: "paused",
                totalQueued: 5,
                completedCount: 2,
                failedCount: 1,
            },
            async () => {},
        );
        expect(pausedBanner.classList.contains("is-paused")).toBe(true);
        expect(pausedBanner.querySelector(".ml-stat-chip.is-danger")?.textContent).toContain("1 failed");
    });

    test("batch QUEUE_PROGRESS coalesces gallery linking and defers native Gallery React refresh until queue completes", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-batch-1" });
        let reactRefreshCalls = 0;

        // Attach a mock React fiber with a gallery fetch hook matching `isGalleryFetchCallbackSrc`
        const galleryTab = domEnv.document.createElement("div") as any;
        galleryTab.className = "Editor_galleryTab_test";
        const fetchGalleryHook = () => {
            reactRefreshCalls++;
            const api = { list: (_id: string) => [{ image_id: "x" }] };
            return api.list("c-batch-1").filter((row) => Boolean(row.image_id));
        };
        galleryTab.__reactFiber$test = {
            memoizedState: {
                memoizedState: [fetchGalleryHook, []],
                next: null,
            },
            return: null,
        };
        domEnv.document.body.appendChild(galleryTab);

        const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
        const galleryRows: Array<{ id: string; character_id: string; image_id: string }> = [
            { id: "gal-existing", character_id: "c-batch-1", image_id: "img-existing" },
        ];

        globalThis.fetch = (async (url: string, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            const bodyText = typeof init?.body === "string" ? init.body : undefined;
            fetchCalls.push({ url: String(url), method, body: bodyText });
            if (method === "GET") {
                return new Response(JSON.stringify({ data: galleryRows }), { status: 200 });
            }
            if (method === "POST") {
                const parsed = bodyText ? JSON.parse(bodyText) : {};
                const created = {
                    id: `gal-${parsed.image_id}`,
                    character_id: "c-batch-1",
                    image_id: String(parsed.image_id),
                };
                galleryRows.push(created);
                return new Response(JSON.stringify(created), { status: 200 });
            }
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        const origSendToBackend = ctxMock.ctx.sendToBackend;
        ctxMock.ctx.sendToBackend = (...args: Parameters<typeof origSendToBackend>) => {
            const res = origSendToBackend(...args);
            const msg = args[0] as { type?: string; action?: string; requestId?: string } | undefined;
            if (msg?.type === "RPC_REQUEST" && typeof msg.requestId === "string") {
                const requestId = msg.requestId;
                if (msg.action === "scan_character") {
                    queueMicrotask(() => {
                        ctxMock.emitBackendMessage({
                            type: "RPC_RESPONSE",
                            requestId,
                            result: { scan: makeScan("c-batch-1"), urlMapPayload: null, pendingGalleryLinks: [] },
                        });
                    });
                } else if (msg.action === "record_gallery_links") {
                    queueMicrotask(() => {
                        ctxMock.emitBackendMessage({
                            type: "RPC_RESPONSE",
                            requestId,
                            result: { updated: 1 },
                        });
                    });
                }
            }
            return res;
        };

        const teardown = setup(ctxMock.ctx);
        const initReq = ctxMock.sentMessages.find((m) => m.action === "get_init_state");
        expect(initReq).toBeDefined();

        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: initReq.requestId,
            result: {
                stats: { totalAssets: 0, totalSizeBytes: 0, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                queueProgress: makeIdleQueue(),
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
            },
        });
        await new Promise((r) => setTimeout(r, 20));

        // 1. Syncing an already-present native gallery row must NOT trigger a native Gallery React refresh
        ctxMock.emitBackendMessage({
            type: "ENSURE_GALLERY_LINKS",
            characterId: "c-batch-1",
            links: [
                {
                    characterId: "c-batch-1",
                    imageId: "img-existing",
                    normalizedUrl: "https://cdn.example.com/existing.png",
                    caption: "existing.png",
                },
            ],
        });
        await new Promise((r) => setTimeout(r, 200));
        expect(reactRefreshCalls).toBe(0);

        // 2. Batch QUEUE_PROGRESS events while running link items without triggering React refresh mid-batch
        const getCallsBeforeBatch = fetchCalls.filter((c) => c.method === "GET").length;
        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "running", totalQueued: 3, completedCount: 1 },
            newAsset: {
                normalizedUrl: "https://cdn.example.com/b1.png",
                rawUrls: ["https://cdn.example.com/b1.png"],
                imageId: "img-new-1",
                localUrl: "/api/v1/images/img-new-1",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "b1.png",
                characterIds: ["c-batch-1"],
                galleryItemIds: {},
                localizedAt: 1000,
            } satisfies LocalizedAssetEntry,
        });
        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "running", totalQueued: 3, completedCount: 2 },
            newAsset: {
                normalizedUrl: "https://cdn.example.com/b2.png",
                rawUrls: ["https://cdn.example.com/b2.png"],
                imageId: "img-new-2",
                localUrl: "/api/v1/images/img-new-2",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "b2.png",
                characterIds: ["c-batch-1"],
                galleryItemIds: {},
                localizedAt: 1001,
            } satisfies LocalizedAssetEntry,
        });
        // Third asset already has galleryItemIds populated -> no link or refresh needed
        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "running", totalQueued: 3, completedCount: 3 },
            newAsset: {
                normalizedUrl: "https://cdn.example.com/b3.png",
                rawUrls: ["https://cdn.example.com/b3.png"],
                imageId: "img-reused",
                localUrl: "/api/v1/images/img-reused",
                mimeType: "image/png",
                sizeBytes: 100,
                filename: "b3.png",
                characterIds: ["c-batch-1"],
                galleryItemIds: { "c-batch-1": "gal-reused" },
                localizedAt: 1002,
            } satisfies LocalizedAssetEntry,
        });

        await new Promise((r) => setTimeout(r, 200));
        // Still running -> React gallery refresh must remain deferred
        expect(reactRefreshCalls).toBe(0);
        // Both new items were linked in native gallery with coalesced GET requests
        const postCount = fetchCalls.filter((c) => c.method === "POST").length;
        expect(postCount).toBe(2);
        const getCallsDuringBatch = fetchCalls.filter((c) => c.method === "GET").length - getCallsBeforeBatch;
        expect(getCallsDuringBatch).toBe(1);

        // Completing the queue flushes the deferred React gallery refresh once
        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "completed", totalQueued: 3, completedCount: 3, succeededCount: 3 },
        });
        await new Promise((r) => setTimeout(r, 200));
        expect(reactRefreshCalls).toBe(1);

        teardown();
    });

    test("NativeGalleryTabIntegrator ignores card DOM mutations while queue is active and coalesces rapid native additions", async () => {
        const galleryTab = domEnv.document.createElement("div") as any;
        galleryTab.className = "Editor_galleryTab_mut";
        domEnv.document.body.appendChild(galleryTab);

        const editorCtx = {
            ui: {
                characterEditor: {
                    getState: () => ({
                        open: true,
                        characterId: "c-mut-1",
                        activeTabId: "gallery",
                        extensions: {},
                    }),
                    onChange: () => () => {},
                },
                showConfirm: async () => ({ confirmed: true }),
            },
        } as unknown as SpindleFrontendContext;

        let scanCalls = 0;
        const integrator = new NativeGalleryTabIntegrator(
            editorCtx,
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => {
                    scanCalls++;
                    return makeScan("c-mut-1");
                },
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
        );

        integrator.start();
        await new Promise((r) => setTimeout(r, 20));
        expect(scanCalls).toBe(1);

        const observer = domEnv.mutationObservers.instances.find((inst) =>
            inst.observed.some((o) => o.target === galleryTab),
        );
        expect(observer).toBeDefined();

        // While queue is running, adding gallery cards must NOT trigger refreshScan(true)
        integrator.updateExternalState(DEFAULT_SETTINGS, {
            ...makeIdleQueue(),
            status: "running",
            totalQueued: 2,
        });
        for (let i = 0; i < 2; i++) {
            const card = domEnv.document.createElement("div") as any;
            card.className = "Editor_galleryCard_x";
            galleryTab.appendChild(card);
            observer!.trigger([{ target: galleryTab }]);
        }
        await new Promise((r) => setTimeout(r, 650));
        expect(scanCalls).toBe(1);

        // Transitioning queue to completed triggers a single scan via widget.updateExternalState
        integrator.updateExternalState(DEFAULT_SETTINGS, {
            ...makeIdleQueue(),
            status: "completed",
            totalQueued: 2,
            completedCount: 2,
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(scanCalls).toBe(2);

        // Rapid external native card additions while idle coalesce into ONE scan after 600ms debounce
        for (let i = 0; i < 3; i++) {
            const card = domEnv.document.createElement("div") as any;
            card.className = "Editor_galleryCard_x";
            galleryTab.appendChild(card);
            observer!.trigger([{ target: galleryTab }]);
            await new Promise((r) => setTimeout(r, 15));
        }
        expect(scanCalls).toBe(2);
        await new Promise((r) => setTimeout(r, 650));
        expect(scanCalls).toBe(3);

        integrator.stop();
    });

    test("LibraryGalleryView and CharacterMediaWidget update in place without loading flash and reuse unchanged card/tile DOM nodes", async () => {
        const drawerRoot = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(drawerRoot as any);
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-dom-1", confirmResult: true });

        const makeAsset = (id: string, filename: string, charId: string, localizedAt: number) => ({
            normalizedUrl: `https://cdn.example.com/${filename}`,
            rawUrls: [`https://cdn.example.com/${filename}`],
            imageId: id,
            localUrl: `/api/v1/images/${id}`,
            mediaKind: "image" as const,
            mimeType: "image/png",
            sizeBytes: 256,
            filename,
            localizedAt,
            characterIds: [charId],
            galleryItemIds: {},
        });

        let galleryChars = [
            {
                characterId: "char-a",
                characterName: "Alpha",
                tags: [],
                avatarImageId: null,
                avatarUrl: null,
                localizedAssets: [
                    makeAsset("img-a1", "a1.png", "char-a", 100),
                    makeAsset("img-a2", "a2.png", "char-a", 110),
                ],
                expressions: [],
                totalSizeBytes: 512,
                lastLocalizedAt: 110,
            },
        ];

        let stats: StorageStatsSummary = {
            totalAssets: 2,
            totalSizeBytes: 512,
            totalFailedUrls: 0,
            settings: { ...DEFAULT_SETTINGS },
        };

        let deferredResolve: ((chars: any[]) => void) | null = null;
        let delayNextGalleryLoad = false;

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            stats,
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId),
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => {
                    if (delayNextGalleryLoad) {
                        delayNextGalleryLoad = false;
                        return await new Promise<any[]>((res) => {
                            deferredResolve = res;
                        });
                    }
                    return galleryChars.map((c) => ({
                        ...c,
                        localizedAssets: [...c.localizedAssets],
                    }));
                },
                onStartDownload: async () => {},
                onClearFailedUrls: async () => {},
                onPurgeCharacterCache: async () => {},
                onBulkPurgeCharacters: async () => {},
                onSaveCharacterOverride: async (_cid, ov) => ov,
                onQueueControl: async () => {},
                onUpdateSettings: async (patch) => ({
                    settings: { ...DEFAULT_SETTINGS, ...patch },
                    stats,
                }),
                onClearFailed: async () => ({ cleared: 0, stats }),
            },
        );

        const dispatch = (el: Element, type: string) =>
            (el as any).dispatchEvent(new MockEvent(type, { bubbles: true }) as unknown as Event);

        const unmount = panel.mount(drawerRoot);
        const galleryTabBtn = Array.from(drawerRoot.querySelectorAll("button.ml-drawer-nav-btn")).find((b) =>
            (b.textContent ?? "").includes("Gallery"),
        ) as HTMLButtonElement;
        dispatch(galleryTabBtn, "click");
        await new Promise((r) => setTimeout(r, 20));

        const toolbarEl = drawerRoot.querySelector(".ml-gallery-toolbar");
        const alphaCardEl = drawerRoot.querySelector(".ml-char-card") as HTMLElement;
        const alphaImgEl = alphaCardEl.querySelector("img");
        expect(toolbarEl).not.toBeNull();
        expect(alphaCardEl).not.toBeNull();
        expect(alphaImgEl).not.toBeNull();

        // Add character Beta while async refresh is in-flight -> must NOT blank to "Loading..." and must reuse Alpha DOM card
        galleryChars = [
            galleryChars[0]!,
            {
                characterId: "char-b",
                characterName: "Beta",
                tags: [],
                avatarImageId: null,
                avatarUrl: null,
                localizedAssets: [makeAsset("img-b1", "b1.png", "char-b", 120)],
                expressions: [],
                totalSizeBytes: 256,
                lastLocalizedAt: 120,
            },
        ];
        delayNextGalleryLoad = true;
        stats = { ...stats, totalAssets: 3, totalSizeBytes: 768 };
        panel.updateExternalState(stats.settings, stats, makeIdleQueue());
        await new Promise((r) => setTimeout(r, 5));

        expect(drawerRoot.textContent).not.toContain("Loading library media gallery...");
        expect(drawerRoot.querySelector(".ml-gallery-toolbar")).toBe(toolbarEl);
        expect(drawerRoot.querySelector(".ml-char-card")).toBe(alphaCardEl);

        deferredResolve!(galleryChars);
        await new Promise((r) => setTimeout(r, 15));

        const updatedCards = drawerRoot.querySelectorAll(".ml-char-card");
        expect(updatedCards.length).toBe(2);
        expect(drawerRoot.querySelector(".ml-gallery-toolbar")).toBe(toolbarEl);
        expect(updatedCards[0]).toBe(alphaCardEl);
        expect(updatedCards[0]!.querySelector("img")).toBe(alphaImgEl);

        // Open Alpha drilldown -> capture asset card -> add a3.png -> existing asset card & img are reused
        dispatch(alphaCardEl, "click");
        const initialAssetCards = drawerRoot.querySelectorAll(".ml-asset-card");
        expect(initialAssetCards.length).toBe(2);
        const assetCard0 = initialAssetCards[0]!;
        const assetImg0 = assetCard0.querySelector("img");

        galleryChars[0]!.localizedAssets.push(makeAsset("img-a3", "a3.png", "char-a", 130));
        stats = { ...stats, totalAssets: 4, totalSizeBytes: 1024 };
        panel.updateExternalState(stats.settings, stats, makeIdleQueue());
        await new Promise((r) => setTimeout(r, 15));

        const nextAssetCards = drawerRoot.querySelectorAll(".ml-asset-card");
        expect(nextAssetCards.length).toBe(3);
        expect(nextAssetCards[0]).toBe(assetCard0);
        expect(nextAssetCards[0]!.querySelector("img")).toBe(assetImg0);
        unmount();

        // CharacterMediaWidget reuses existing media tile DOM nodes when new tiles are added
        const widgetRoot = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(widgetRoot as any);
        let tileCount = 1;
        const makeWidgetScan = (): CharacterMediaScanResult => {
            const items: CharacterMediaScanResult["items"] = Array.from({ length: tileCount }, (_, idx) => {
                const n = idx + 1;
                const entry = makeAsset(`wimg-${n}`, `w${n}.png`, "c-widget-1", 100 + n);
                return {
                    normalizedUrl: entry.normalizedUrl,
                    rawUrls: entry.rawUrls,
                    domain: "cdn.example.com",
                    mediaKind: "image",
                    sources: [{ section: "core_fields", label: "Description" }],
                    occurrenceCount: 1,
                    status: "localized",
                    localizedEntry: entry,
                };
            });
            return makeScan("c-widget-1", { items });
        };

        const widget = new CharacterMediaWidget(
            widgetRoot,
            ctxMock.ctx,
            "c-widget-1",
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => makeWidgetScan(),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
        );
        await widget.refreshScan(false);

        const initialWidgetTile = widgetRoot.querySelector(".ml-asset-card") as HTMLElement;
        const initialWidgetImg = initialWidgetTile.querySelector("img");
        expect(initialWidgetTile).not.toBeNull();
        expect(initialWidgetImg).not.toBeNull();

        tileCount = 2;
        await widget.refreshScan(true);
        const updatedWidgetTiles = widgetRoot.querySelectorAll(".ml-asset-card");
        expect(updatedWidgetTiles.length).toBe(2);
        expect(updatedWidgetTiles[0]).toBe(initialWidgetTile);
        expect(updatedWidgetTiles[0]!.querySelector("img")).toBe(initialWidgetImg);

        widget.destroy();
    });

    test("Character and Gallery tabs expose direct native Character Editor actions via host.surfaces", async () => {
        const ctxMock = createFrontendMockCtx();
        expect(canOpenNativeCharacterEditor(ctxMock.ctx)).toBe(false);

        const surfaceInvokes: Array<{ ref: { kind: string; id: string }; params?: Record<string, unknown> }> = [];
        (ctxMock.ctx as any).host = {
            surfaces: {
                invoke: (ref: { kind: string; id: string }, params?: Record<string, unknown>) => {
                    surfaceInvokes.push({ ref, params });
                },
            },
        };
        expect(canOpenNativeCharacterEditor(ctxMock.ctx)).toBe(true);
        ctxMock.setActiveCharacterId("c-edit-1");

        const makeAsset = (id: string, filename: string, charId: string, localizedAt: number) => ({
            normalizedUrl: `https://cdn.example.com/${filename}`,
            rawUrls: [`https://cdn.example.com/${filename}`],
            imageId: id,
            localUrl: `/api/v1/images/${id}`,
            mediaKind: "image" as const,
            mimeType: "image/png",
            sizeBytes: 256,
            filename,
            localizedAt,
            characterIds: [charId],
            galleryItemIds: {},
        });

        const drawerRoot = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(drawerRoot as any);
        const assetA = makeAsset("img-e1", "portrait.png", "c-edit-1", 100);
        const galleryChars = [
            {
                characterId: "c-edit-1",
                characterName: "Evelyn",
                avatarImageId: "av-e1",
                avatarUrl: "/api/v1/images/av-e1",
                localizedAssets: [assetA],
                expressions: [],
                totalSizeBytes: 512,
                lastLocalizedAt: 100,
            },
        ];

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            {
                totalAssets: 1,
                totalSizeBytes: 512,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId, { characterName: "Evelyn" }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => galleryChars,
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: {
                        totalAssets: 1,
                        totalSizeBytes: 512,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: {
                        totalAssets: 1,
                        totalSizeBytes: 512,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
            },
        );

        const unmount = panel.mount(drawerRoot);
        await new Promise((r) => setTimeout(r, 20));

        // 1. Character tab header Edit button invokes modal:character_editor
        const charEditBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.getAttribute("aria-label") === "Open native Character Editor for this character",
        ) as HTMLButtonElement | undefined;
        expect(charEditBtn).toBeDefined();
        charEditBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(surfaceInvokes).toEqual([
            { ref: { kind: "modal", id: "character_editor" }, params: { id: "c-edit-1" } },
        ]);

        // 2. Gallery tab grouped card quick-edit button invokes editor directly without drilling down
        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 20));

        const cardEditBtn = drawerRoot.querySelector(".ml-char-card-edit-btn") as HTMLButtonElement | null;
        expect(cardEditBtn).not.toBeNull();
        cardEditBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(surfaceInvokes.length).toBe(2);
        expect(surfaceInvokes[1]).toEqual({
            ref: { kind: "modal", id: "character_editor" },
            params: { id: "c-edit-1" },
        });
        // Still on grouped character grid (not drilled down)
        expect(drawerRoot.querySelector(".ml-char-card")).not.toBeNull();

        // 3. Gallery grouped list mode row also exposes inline edit button
        const listToggleBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.getAttribute("aria-label") === "List view",
        ) as HTMLButtonElement | undefined;
        expect(listToggleBtn).toBeDefined();
        listToggleBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        const rowEditBtn = drawerRoot.querySelector(".ml-media-list-row button[aria-label*='native Character Editor']") as HTMLButtonElement | null;
        expect(rowEditBtn).not.toBeNull();
        rowEditBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(surfaceInvokes.length).toBe(3);
        expect(drawerRoot.querySelector(".ml-media-list-row")).not.toBeNull();

        // 4. Drilling down shows Edit button in header bar and Edit Card inside Lightbox
        const rowEl = drawerRoot.querySelector(".ml-media-list-row") as HTMLElement;
        rowEl.click();
        await new Promise((r) => setTimeout(r, 10));

        const drilldownEditBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.textContent?.includes("Edit") && b.getAttribute("aria-label") === "Open native Character Editor for this character",
        ) as HTMLButtonElement | undefined;
        expect(drilldownEditBtn).toBeDefined();
        drilldownEditBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(surfaceInvokes.length).toBe(4);

        // Open lightbox from drilldown entry and click Edit Card
        const itemRow = drawerRoot.querySelector(".ml-media-list-row") as HTMLElement;
        itemRow.click();
        const lightboxEditBtn = Array.from(domEnv.document.body.querySelectorAll(".ml-lightbox-dialog button")).find(
            (b: any) => b.textContent?.includes("Edit Card"),
        ) as HTMLButtonElement | undefined;
        expect(lightboxEditBtn).toBeDefined();
        lightboxEditBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(surfaceInvokes.length).toBe(5);
        // Lightbox closes after launching editor
        expect(domEnv.document.body.querySelector(".ml-lightbox-backdrop")).toBeNull();

        unmount();

        // 5. Permission retry & route fallback in openNativeCharacterEditor
        let modalAttempts = 0;
        const permCtx = {
            permissions: {
                request: async (perms: string[]) => perms,
            },
            host: {
                surfaces: {
                    invoke: (ref: { kind: string; id: string }, params?: Record<string, unknown>) => {
                        surfaceInvokes.push({ ref, params });
                        if (ref.kind === "modal" && modalAttempts++ === 0) {
                            throw new Error("PERMISSION_DENIED:characters");
                        }
                    },
                },
            },
        };
        const retried = await openNativeCharacterEditor(permCtx, "c-perm");
        expect(retried).toBe(true);
        expect(modalAttempts).toBe(2);

        const routeFallbackCtx = {
            host: {
                surfaces: {
                    invoke: (ref: { kind: string; id: string }, params?: Record<string, unknown>) => {
                        surfaceInvokes.push({ ref, params });
                        if (ref.kind === "modal") {
                            throw new Error("HOST_ACTION_UNAVAILABLE:modal:character_editor");
                        }
                    },
                },
            },
        };
        const fellBack = await openNativeCharacterEditor(routeFallbackCtx, "c-route");
        expect(fellBack).toBe(true);
        expect(surfaceInvokes[surfaceInvokes.length - 1]).toEqual({
            ref: { kind: "route", id: "/characters/:id" },
            params: { id: "c-route" },
        });
    });

    test("preserves Gallery scroll position and page across drilldown, Manage/tab switches, refresh, and remount", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-scroll-01" });
        const drawerRoot = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(drawerRoot as any);

        const makeLocalAsset = (id: string, filename: string, charId: string, localizedAt: number) => ({
            normalizedUrl: `https://cdn.example.com/${filename}`,
            rawUrls: [`https://cdn.example.com/${filename}`],
            imageId: id,
            localUrl: `/api/v1/images/${id}`,
            mediaKind: "image" as const,
            mimeType: "image/png",
            sizeBytes: 256,
            filename,
            localizedAt,
            characterIds: [charId],
            galleryItemIds: {},
        });

        const galleryChars = Array.from({ length: 30 }, (_, idx) => {
            const num = String(idx + 1).padStart(2, "0");
            const id = `c-scroll-${num}`;
            return {
                characterId: id,
                characterName: `Char ${num}`,
                avatarImageId: `av-${num}`,
                avatarUrl: `/api/v1/images/av-${num}`,
                localizedAssets: [
                    makeLocalAsset(`img-${num}-1`, `p1-${num}.png`, id, 100 + idx),
                    makeLocalAsset(`img-${num}-2`, `p2-${num}.png`, id, 200 + idx),
                ],
                expressions: [],
                totalSizeBytes: 1024,
                lastLocalizedAt: 200 + idx,
            };
        });

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            {
                totalAssets: 60,
                totalSizeBytes: 30720,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId, { characterName: charId }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => galleryChars,
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: {
                        totalAssets: 60,
                        totalSizeBytes: 30720,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: {
                        totalAssets: 60,
                        totalSizeBytes: 30720,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
            },
        );

        let unmount = panel.mount(drawerRoot);
        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 20));

        // Switch page size to 24 and advance to page 2
        const pageSizeSelect = Array.from(
            drawerRoot.querySelectorAll("select") as unknown as Iterable<any>,
        ).find((s) =>
            Array.from((s.children ?? []) as Iterable<any>).some(
                (o) => o.getAttribute?.("value") === "24" || o.value === "24",
            ),
        ) as any;
        expect(pageSizeSelect).toBeDefined();
        pageSizeSelect.value = "24";
        pageSizeSelect.dispatchEvent(new MockEvent("change") as any);
        await new Promise((r) => setTimeout(r, 10));

        const nextBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.textContent?.includes("Next"),
        ) as HTMLButtonElement | undefined;
        expect(nextBtn).toBeDefined();
        nextBtn!.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(drawerRoot.textContent).toContain("Page 2 / 2");

        // Scroll Gallery grouped list down and drill down into a character on page 2
        const body = drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement;
        expect(body).not.toBeNull();
        body.scrollTop = 420;

        const page2Card = drawerRoot.querySelector(".ml-char-card") as unknown as HTMLElement;
        expect(page2Card).not.toBeNull();
        page2Card.click();
        await new Promise((r) => setTimeout(r, 10));

        // Drilldown resets scroll to top
        expect(body.scrollTop).toBe(0);

        // Scroll inside drilldown, click Manage (Character tab), then return to Gallery
        body.scrollTop = 160;
        const manageBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.textContent?.includes("Manage"),
        ) as HTMLButtonElement | undefined;
        expect(manageBtn).toBeDefined();
        manageBtn!.click();
        await new Promise((r) => setTimeout(r, 20));
        expect(body.scrollTop).toBe(0);

        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 20));
        const bodyBackInDrilldown = drawerRoot.querySelector(
            ".ml-drawer-body",
        ) as unknown as HTMLElement;
        expect(bodyBackInDrilldown.scrollTop).toBe(160);

        // Trigger background gallery refresh while still in drilldown
        panel.refreshActiveScan();
        await new Promise((r) => setTimeout(r, 20));
        expect(
            (drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement).scrollTop,
        ).toBe(160);

        // Return to grouped list via All Characters -> restores page 2 and scrollTop 420
        const backBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.textContent?.includes("All Characters"),
        ) as HTMLButtonElement | undefined;
        expect(backBtn).toBeDefined();
        backBtn!.click();
        await new Promise((r) => setTimeout(r, 10));

        expect(drawerRoot.textContent).toContain("Page 2 / 2");
        expect(
            (drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement).scrollTop,
        ).toBe(420);

        // Unmount & remount drawer while scrolled on Gallery -> preserves scrollTop
        (drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement).scrollTop = 315;
        unmount();
        const drawerRoot2 = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(drawerRoot2 as any);
        unmount = panel.mount(drawerRoot2);
        await new Promise((r) => setTimeout(r, 20));
        expect(
            (drawerRoot2.querySelector(".ml-drawer-body") as unknown as HTMLElement).scrollTop,
        ).toBe(315);
        unmount();
    });

    test("preserves Library Batch outer and inner scroll positions across Open in Character Tab, tab switches, and remount", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-lib-01" });
        const drawerRoot = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(drawerRoot as any);

        const libChars = Array.from({ length: 12 }, (_, idx) => ({
            characterId: `c-lib-${String(idx + 1).padStart(2, "0")}`,
            characterName: `LibChar ${idx + 1}`,
            totalUnique: 4,
            localizedCount: 1,
            remoteCount: 3,
            failedCount: 0,
            localizedBytes: 2048,
            remoteUrls: [`https://example.com/${idx + 1}.png`],
            sourceSections: ["gallery" as const],
            sectionRemoteCounts: {
                creator_notes: 0,
                first_mes: 0,
                core_fields: 0,
                alternate_greetings: 0,
                gallery: 3,
                character_book: 0,
                expressions: 0,
                world_books: 0,
                regex_scripts: 0,
            },
        }));

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            {
                totalAssets: 0,
                totalSizeBytes: 0,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId, { characterName: charId }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({
                    characters: libChars.map((c) => ({
                        ...c,
                        sourceSections: [...c.sourceSections],
                        sectionRemoteCounts: { ...c.sectionRemoteCounts },
                    })),
                    totalUniqueRemote: libChars.length * 3,
                }),
                onListLibraryMedia: async () => [],
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: {
                        totalAssets: 0,
                        totalSizeBytes: 0,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: {
                        totalAssets: 0,
                        totalSizeBytes: 0,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
            },
        );

        let unmount = panel.mount(drawerRoot);
        panel.setActiveTab("library");
        await new Promise((r) => setTimeout(r, 15));

        const scanBtn = Array.from(drawerRoot.querySelectorAll("button")).find(
            (b) => b.textContent?.includes("Scan Library"),
        ) as HTMLButtonElement | undefined;
        expect(scanBtn).toBeDefined();
        scanBtn!.click();
        await new Promise((r) => setTimeout(r, 20));

        const body = drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement;
        const charList = drawerRoot.querySelector(
            '[data-scroll-id="library-char-list"]',
        ) as unknown as HTMLElement;
        expect(body).not.toBeNull();
        expect(charList).not.toBeNull();

        body.scrollTop = 275;
        charList.scrollTop = 190;

        // Expand second row and click "Open in Character Tab ↗"
        const libRows = Array.from(
            drawerRoot.querySelectorAll(".ml-lib-row"),
        ) as unknown as HTMLElement[];
        expect(libRows.length).toBe(12);
        libRows[1]!.click();
        expect(body.scrollTop).toBe(275);
        expect(charList.scrollTop).toBe(190);

        const openCharTabBtn = Array.from(drawerRoot.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Open in Character Tab"),
        ) as HTMLButtonElement | undefined;
        expect(openCharTabBtn).toBeDefined();
        openCharTabBtn!.click();
        await new Promise((r) => setTimeout(r, 20));

        // Opening another character starts Character tab at scrollTop 0, then scroll down to 95
        const charBody = drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement;
        expect(charBody.scrollTop).toBe(0);
        charBody.scrollTop = 95;

        // Return to Library Batch -> both outer body and inner list scroll positions are restored
        panel.setActiveTab("library");
        await new Promise((r) => setTimeout(r, 15));
        const restoredBody = drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement;
        const restoredList = drawerRoot.querySelector(
            '[data-scroll-id="library-char-list"]',
        ) as unknown as HTMLElement;
        expect(restoredBody.scrollTop).toBe(275);
        expect(restoredList.scrollTop).toBe(190);

        // Switching back to Character tab without changing character keeps Character tab's scroll (95)
        panel.setActiveTab("character");
        await new Promise((r) => setTimeout(r, 15));
        expect(
            (drawerRoot.querySelector(".ml-drawer-body") as unknown as HTMLElement).scrollTop,
        ).toBe(95);

        // Return to Library Batch and test unmount + remount
        panel.setActiveTab("library");
        await new Promise((r) => setTimeout(r, 15));
        unmount();

        const drawerRoot2 = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(drawerRoot2 as any);
        unmount = panel.mount(drawerRoot2);
        await new Promise((r) => setTimeout(r, 15));
        expect(
            (drawerRoot2.querySelector(".ml-drawer-body") as unknown as HTMLElement).scrollTop,
        ).toBe(275);
        expect(
            (
                drawerRoot2.querySelector(
                    '[data-scroll-id="library-char-list"]',
                ) as unknown as HTMLElement
            ).scrollTop,
        ).toBe(190);
        unmount();
    });

    test("preserves Gallery scroll when scrolling occurs on a host ancestor container above tab.root and guards pre-layout rAF clamping", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-anc-01" });

        // Simulate Lumiverse ViewportDrawer DOM: .panelContent -> TabPanelContent wrapper -> tab.root
        const hostPanelContent = domEnv.document.createElement("div") as any;
        hostPanelContent.style.overflowY = "auto";
        hostPanelContent.scrollHeight = 1600;
        hostPanelContent.clientHeight = 500;
        domEnv.document.body.appendChild(hostPanelContent);

        const tabPanelWrapper = domEnv.document.createElement("div") as any;
        tabPanelWrapper.style.width = "100%";
        tabPanelWrapper.style.height = "100%";
        hostPanelContent.appendChild(tabPanelWrapper);

        const drawerRoot = domEnv.document.createElement("div") as any;
        tabPanelWrapper.appendChild(drawerRoot);

        const galleryChars = Array.from({ length: 10 }, (_, idx) => {
            const num = String(idx + 1).padStart(2, "0");
            const id = `c-anc-${num}`;
            return {
                characterId: id,
                characterName: `AncChar ${num}`,
                avatarImageId: `av-${num}`,
                avatarUrl: `/api/v1/images/av-${num}`,
                localizedAssets: [
                    {
                        normalizedUrl: `https://cdn.example.com/anc-${num}.png`,
                        rawUrls: [`https://cdn.example.com/anc-${num}.png`],
                        imageId: `img-anc-${num}`,
                        localUrl: `/api/v1/images/img-anc-${num}`,
                        mediaKind: "image" as const,
                        mimeType: "image/png",
                        sizeBytes: 512,
                        filename: `anc-${num}.png`,
                        localizedAt: 100 + idx,
                        characterIds: [id],
                        galleryItemIds: {},
                    },
                ],
                expressions: [],
                totalSizeBytes: 512,
                lastLocalizedAt: 100 + idx,
            };
        });

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            {
                totalAssets: 10,
                totalSizeBytes: 5120,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId, { characterName: charId }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => galleryChars,
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: {
                        totalAssets: 10,
                        totalSizeBytes: 5120,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: {
                        totalAssets: 10,
                        totalSizeBytes: 5120,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
            },
        );

        const unmount = panel.mount(drawerRoot as unknown as HTMLElement);
        // mount() constrains tab.root height to 100% so .ml-drawer-body can scroll when host allows
        expect(drawerRoot.style.width).toBe("100%");
        expect(drawerRoot.style.height).toBe("100%");
        expect(drawerRoot.style.minHeight).toBe("0");

        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 20));

        // Simulate browser layout where .ml-drawer-body expands to full content (scrollHeight === clientHeight)
        // and the host ancestor .panelContent is the real scrollable container.
        const body = drawerRoot.querySelector(".ml-drawer-body") as any;
        expect(body).not.toBeNull();
        body.scrollHeight = 1600;
        body.clientHeight = 1600;
        body.scrollTop = 0;

        // User scrolls host ancestor down to 580 and a capture-phase scroll event fires
        hostPanelContent.scrollTop = 580;
        const scrollEv = new MockEvent("scroll");
        scrollEv.target = hostPanelContent;
        domEnv.document.dispatchEvent(scrollEv as any);

        // User clicks a character card -> drilldown resets hostPanelContent.scrollTop to 0
        const card = drawerRoot.querySelector(".ml-char-card") as any;
        expect(card).not.toBeNull();
        card.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(hostPanelContent.scrollTop).toBe(0);
        expect(body.scrollTop).toBe(0);

        // Simulate hostPanelContent shrinking during drilldown, then growing back on All Characters,
        // and also simulate pre-layout sync clamping on the first write before rAF settles.
        const prevRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
        const prevCancelRaf = (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
        const rafQueue: Array<{ id: number; cb: () => void }> = [];
        let nextRafId = 1;
        (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: () => void) => {
            const id = nextRafId++;
            rafQueue.push({ id, cb });
            return id;
        };
        (globalThis as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => {
            const idx = rafQueue.findIndex((entry) => entry.id === id);
            if (idx >= 0) rafQueue.splice(idx, 1);
        };

        try {
            let clampNextWrite = true;
            let rawScrollTop = 0;
            Object.defineProperty(hostPanelContent, "scrollTop", {
                configurable: true,
                get: () => rawScrollTop,
                set: (v: number) => {
                    if (clampNextWrite && v > 0) {
                        clampNextWrite = false;
                        rawScrollTop = 0; // Pre-layout clamp to 0
                    } else {
                        rawScrollTop = v;
                    }
                },
            });

            const backBtn = Array.from(drawerRoot.querySelectorAll("button") as Iterable<any>).find(
                (b) => b.textContent?.includes("All Characters"),
            ) as any;
            expect(backBtn).toBeDefined();
            backBtn.click();

            // Sync write was clamped to 0, then rAF restores 580 once layout settles
            expect(hostPanelContent.scrollTop).toBe(0);
            expect(rafQueue.length).toBeGreaterThan(0);
            const firstFrame = rafQueue.shift()!;
            firstFrame.cb();
            expect(hostPanelContent.scrollTop).toBe(580);

            // Simulate host detaching/reattaching tab.root across drawer tabs resetting scrollTop to 0
            rawScrollTop = 0;
            panel.restoreScrollIfReset();
            expect(hostPanelContent.scrollTop).toBe(580);

            // Switching to Character tab captures 580 for Gallery and resets hostPanelContent to 0
            panel.setActiveTab("character");
            await new Promise((r) => setTimeout(r, 15));
            expect(hostPanelContent.scrollTop).toBe(0);

            // Switching back to Gallery restores 580 on hostPanelContent
            panel.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 15));
            expect(hostPanelContent.scrollTop).toBe(580);

            // If user manually scrolls to a non-zero position before rAF fires after a non-clamped restore,
            // rAF must NOT overwrite the user's manual scroll.
            const backToChar = drawerRoot.querySelector(".ml-char-card") as any;
            backToChar.click();
            await new Promise((r) => setTimeout(r, 10));
            const backBtn2 = Array.from(drawerRoot.querySelectorAll("button") as Iterable<any>).find(
                (b) => b.textContent?.includes("All Characters"),
            ) as any;
            backBtn2.click();
            expect(hostPanelContent.scrollTop).toBe(580);
            rawScrollTop = 240; // User manually scrolled up before rAF
            while (rafQueue.length > 0) {
                rafQueue.shift()!.cb();
            }
            expect(hostPanelContent.scrollTop).toBe(240);
        } finally {
            if (prevRaf === undefined) {
                delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
            } else {
                (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = prevRaf;
            }
            if (prevCancelRaf === undefined) {
                delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
            } else {
                (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = prevCancelRaf;
            }
        }

        unmount();
        expect(drawerRoot.style.width).toBe("");
        expect(drawerRoot.style.height).toBe("");
        expect(drawerRoot.style.minHeight).toBe("");
    });

    test("createLazyMediaElement uses eager decoding/loading, ?size=sm local image thumbs, and 600px observer rootMargin", () => {
        expect(toThumbnailMediaUrl("/api/v1/images/img-abc", "image")).toBe("/api/v1/images/img-abc?size=sm");
        expect(toThumbnailMediaUrl("/api/v1/images/img-abc?size=sm", "image")).toBe("/api/v1/images/img-abc?size=sm");
        expect(toThumbnailMediaUrl("/api/v1/images/remote?url=x", "image")).toBe("/api/v1/images/remote?url=x");
        expect(toThumbnailMediaUrl("/api/v1/images/wallpapers", "image")).toBe("/api/v1/images/wallpapers");
        expect(toThumbnailMediaUrl("/api/v1/images/vid-1", "video")).toBe("/api/v1/images/vid-1");

        const eagerImg = createLazyMediaElement({
            src: "/api/v1/images/img-eager-1",
            mediaKind: "image",
            alt: "eager",
            className: "ml-char-card-thumb",
            eager: true,
        }) as unknown as HTMLImageElement;
        expect(eagerImg.loading).toBe("eager");
        expect(eagerImg.decoding).toBe("async");
        expect(eagerImg.src).toBe("/api/v1/images/img-eager-1?size=sm");
        expect(domEnv.intersectionObservers.instances.length).toBe(0);

        let capturedOptions: IntersectionObserverInit | undefined;
        const BaseIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
        (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class extends (BaseIO as any) {
            constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
                super(cb);
                capturedOptions = options;
            }
        };
        try {
            const lazyImg = createLazyMediaElement({
                src: "/api/v1/images/img-lazy-1",
                mediaKind: "image",
                alt: "lazy",
                className: "ml-char-card-thumb",
            }) as unknown as HTMLImageElement;
            expect(lazyImg.loading).toBe("eager");
            expect(lazyImg.decoding).toBe("async");
            expect(lazyImg.src).toBe("");
            expect(domEnv.intersectionObservers.instances.length).toBe(1);
            expect(capturedOptions?.rootMargin).toBe("600px");

            domEnv.intersectionObservers.instances[0]!.trigger([
                { target: lazyImg as any, isIntersecting: true },
            ]);
            expect(lazyImg.src).toBe("/api/v1/images/img-lazy-1?size=sm");
        } finally {
            (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = BaseIO;
        }

        const lazyVid = createLazyMediaElement({
            src: "/api/v1/images/vid-lazy-1",
            mediaKind: "video",
            alt: "video",
            className: "ml-asset-preview",
            eager: true,
        }) as unknown as HTMLVideoElement;
        expect(lazyVid.src).toBe("/api/v1/images/vid-lazy-1");
    });

    test("scroll listeners use passive mode and avoid getComputedStyle / querySelector on repeated scroll ticks", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-fast-01" });
        const hostPanelContent = domEnv.document.createElement("div") as any;
        const drawerRoot = domEnv.document.createElement("div") as unknown as HTMLElement;
        hostPanelContent.appendChild(drawerRoot as any);
        domEnv.document.body.appendChild(hostPanelContent);

        let rawScrollTop = 0;
        Object.defineProperty(hostPanelContent, "scrollHeight", { get: () => 2400, configurable: true });
        Object.defineProperty(hostPanelContent, "clientHeight", { get: () => 600, configurable: true });
        Object.defineProperty(hostPanelContent, "scrollTop", {
            get: () => rawScrollTop,
            set: (v: number) => {
                rawScrollTop = v;
            },
            configurable: true,
        });

        let computedStyleCalls = 0;
        const prevGetComputedStyle = (domEnv.window as any).getComputedStyle;
        (domEnv.window as any).getComputedStyle = (el: unknown) => {
            computedStyleCalls += 1;
            if (el === hostPanelContent) return { overflowY: "auto", overflow: "auto" };
            return { overflowY: "visible", overflow: "visible" };
        };

        const addListenerOptions: Array<{ type: string; options: unknown }> = [];
        const origDocAdd = domEnv.document.addEventListener.bind(domEnv.document);
        (domEnv.document as any).addEventListener = (type: string, fn: any, options?: unknown) => {
            if (type === "scroll") addListenerOptions.push({ type, options });
            return origDocAdd(type, fn, options as any);
        };

        const galleryChars = Array.from({ length: 12 }, (_, idx) => {
            const id = `c-fast-${idx + 1}`;
            return {
                characterId: id,
                characterName: `Fast ${idx + 1}`,
                avatarImageId: `av-f-${idx + 1}`,
                avatarUrl: `/api/v1/images/av-f-${idx + 1}`,
                localizedAssets: [],
                expressions: [],
                totalSizeBytes: 0,
                lastLocalizedAt: 100 + idx,
            };
        });

        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            {
                totalAssets: 0,
                totalSizeBytes: 0,
                totalFailedUrls: 0,
                settings: { ...DEFAULT_SETTINGS },
            },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId, { characterName: charId }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => galleryChars,
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: {
                        totalAssets: 0,
                        totalSizeBytes: 0,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: {
                        totalAssets: 0,
                        totalSizeBytes: 0,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
            },
        );

        try {
            const unmount = panel.mount(drawerRoot);
            panel.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 20));

            const bodyEl = (drawerRoot as any).querySelector(".ml-drawer-body");
            expect(bodyEl).toBeTruthy();

            expect(addListenerOptions.some((entry) => {
                const opts = entry.options as AddEventListenerOptions | undefined;
                return Boolean(opts && opts.capture === true && opts.passive === true);
            })).toBe(true);

            let bodyQueryCalls = 0;
            const origBodyQuerySelector = bodyEl.querySelector.bind(bodyEl);
            bodyEl.querySelector = (selector: string) => {
                bodyQueryCalls += 1;
                return origBodyQuerySelector(selector);
            };

            const computedBeforeScroll = computedStyleCalls;
            for (let step = 1; step <= 20; step++) {
                rawScrollTop = step * 35;
                hostPanelContent.dispatchEvent(new MockEvent("scroll"));
            }

            expect(bodyQueryCalls).toBe(0);
            expect(computedStyleCalls - computedBeforeScroll).toBeLessThanOrEqual(1);
            expect(rawScrollTop).toBe(700);

            panel.setActiveTab("character");
            await new Promise((r) => setTimeout(r, 10));
            expect(hostPanelContent.scrollTop).toBe(0);

            panel.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 15));
            expect(hostPanelContent.scrollTop).toBe(700);

            unmount();
        } finally {
            (domEnv.window as any).getComputedStyle = prevGetComputedStyle;
        }
    });

    test("styles avoid backdrop-filter on scrolling grid badges/buttons, transition:all, and content-visibility:auto", () => {
        const getBlock = (selector: string): string => {
            const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return Array.from(
                MEDIA_LOCALIZER_STYLES.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")),
                (m) => m[1] ?? "",
            ).join("\n");
        };

        const tileBadgeBlock = getBlock(".ml-tile-badge");
        const editBtnBlock = getBlock(".ml-char-card-edit-btn");
        const charCardBlock = getBlock(".ml-char-card");
        const assetCardBlock = getBlock(".ml-asset-card");
        const thumbWrapBlock = getBlock(".ml-char-card-thumb-wrap");

        expect(tileBadgeBlock).not.toContain("backdrop-filter");
        expect(editBtnBlock).not.toContain("backdrop-filter");

        expect(charCardBlock).toContain("contain: layout paint style");
        expect(assetCardBlock).toContain("contain: layout paint style");
        expect(thumbWrapBlock).toContain("contain: layout paint style");
        expect(charCardBlock).not.toContain("box-shadow 0.16s");
        expect(assetCardBlock).not.toContain("box-shadow var");

        expect(MEDIA_LOCALIZER_STYLES).not.toMatch(/transition:\s*all\b/);
        expect(MEDIA_LOCALIZER_STYLES).not.toContain("content-visibility: auto");
    });

    test("thumbnail size helpers and preference sanitizers default to md and reject invalid values", () => {
        expect(sanitizeThumbnailSize(undefined)).toBe("md");
        expect(sanitizeThumbnailSize("xl")).toBe("md");
        expect(sanitizeThumbnailSize(42)).toBe("md");
        expect(sanitizeThumbnailSize("sm")).toBe("sm");
        expect(sanitizeThumbnailSize("md")).toBe("md");
        expect(sanitizeThumbnailSize("lg")).toBe("lg");

        expect(getThumbnailImageTier("sm")).toBe("sm");
        expect(getThumbnailImageTier("md")).toBe("sm");
        expect(getThumbnailImageTier("lg")).toBe("lg");

        expect(getThumbnailSizeClass("sm")).toBe("is-thumb-sm");
        expect(getThumbnailSizeClass("md")).toBe("is-thumb-md");
        expect(getThumbnailSizeClass("lg")).toBe("is-thumb-lg");

        expect(getDefaultGalleryPreferences().thumbnailSize).toBe("md");
        expect(getDefaultCharacterPreferences(true).thumbnailSize).toBe("md");

        expect(sanitizeGalleryPreferences(null).thumbnailSize).toBe("md");
        expect(sanitizeGalleryPreferences({ thumbnailSize: "giant" }).thumbnailSize).toBe("md");
        expect(sanitizeGalleryPreferences({ thumbnailSize: "lg" }).thumbnailSize).toBe("lg");
        expect(sanitizeGalleryPreferences({ thumbnailSize: "sm" }).thumbnailSize).toBe("sm");

        expect(sanitizeCharacterPreferences(null, true).thumbnailSize).toBe("md");
        expect(sanitizeCharacterPreferences({ thumbnailSize: "tiny" }, true).thumbnailSize).toBe("md");
        expect(sanitizeCharacterPreferences({ thumbnailSize: "lg" }, true).thumbnailSize).toBe("lg");
        expect(sanitizeCharacterPreferences({ thumbnailSize: "sm" }, false).thumbnailSize).toBe("sm");
    });

    test("LibraryGalleryView thumbnail size control updates wrapper class, reuses sm/md DOM cards, upgrades lg to ?size=lg, and preserves scroll/page", async () => {
        const container = document.createElement("div") as any as HTMLElement;
        document.body.appendChild(container);
        let scrollTop = 240;
        const reportedSizes: string[] = [];

        const makeThumbAsset = (id: string, filename: string, charId: string, localizedAt: number) => ({
            normalizedUrl: `https://example.com/${filename}`,
            rawUrls: [`https://example.com/${filename}`],
            imageId: id,
            localUrl: `/api/v1/images/${id}`,
            mediaKind: "image" as const,
            mimeType: "image/png",
            sizeBytes: 2048,
            filename,
            localizedAt,
            characterIds: [charId],
            galleryItemIds: {},
        });

        const makeGalleryChar = (index: number) => ({
            characterId: `c-thumb-${index}`,
            characterName: `Thumb Hero ${String(index).padStart(2, "0")}`,
            avatarImageId: `avatar-${index}`,
            avatarUrl: `/api/v1/images/avatar-${index}`,
            totalSizeBytes: 2048,
            lastLocalizedAt: 1000 + index,
            tags: ["fantasy"],
            expressions: [],
            localizedAssets: [
                makeThumbAsset(`hero-${index}`, `hero-${index}.png`, `c-thumb-${index}`, 1000 + index),
            ],
        });

        // 55 characters -> 2 pages (50/page) so we can verify currentPage survives resize
        const chars = Array.from({ length: 55 }, (_, i) => makeGalleryChar(i + 1));

        const gallery = new LibraryGalleryView(
            container,
            {
                onLoadLibraryMedia: async () => chars,
                onPurgeAsset: async () => {},
                onOpenCharacterTab: () => {},
                onStateChange: (next) => {
                    reportedSizes.push(next.thumbnailSize);
                },
                onGetScrollTop: () => scrollTop,
                onSetScrollTop: (val) => {
                    scrollTop = val;
                },
            },
            {
                cache: { characters: chars, loadedIncludeEmpty: false },
                state: {
                    ...getDefaultGalleryPreferences(),
                    currentPage: 2,
                },
            },
        );

        gallery.render();
        await new Promise((r) => setTimeout(r, 10));

        const widget = container.querySelector(".ml-widget") as HTMLElement | null;
        expect(widget).not.toBeNull();
        expect(widget!.classList.contains("is-thumb-md")).toBe(true);
        expect(gallery.getState().currentPage).toBe(2);

        const sizeGroup = container.querySelector(".ml-thumb-size-segmented") as HTMLElement | null;
        expect(sizeGroup).not.toBeNull();
        const sizeButtons = Array.from(sizeGroup!.querySelectorAll("button")) as HTMLButtonElement[];
        expect(sizeButtons.map((b) => b.textContent)).toEqual(["S", "M", "L"]);
        expect(sizeButtons[1]!.classList.contains("is-active")).toBe(true);

        const initialCard = container.querySelector(".ml-char-card") as HTMLElement | null;
        const initialImg = initialCard?.querySelector("img.ml-char-card-thumb") as HTMLImageElement | null;
        expect(initialImg?.src).toContain("?size=sm");

        // M -> S keeps "sm" image tier: node is reused and scrollTop & page stay preserved
        sizeButtons[0]!.click();
        await new Promise((r) => setTimeout(r, 15));

        expect(widget!.classList.contains("is-thumb-sm")).toBe(true);
        expect(widget!.classList.contains("is-thumb-md")).toBe(false);
        expect(sizeButtons[0]!.classList.contains("is-active")).toBe(true);
        expect(reportedSizes.at(-1)).toBe("sm");
        expect(gallery.getState().currentPage).toBe(2);
        expect(scrollTop).toBe(240);
        const cardAfterSm = container.querySelector(".ml-char-card") as HTMLElement | null;
        expect(cardAfterSm).toBe(initialCard);

        // S -> L upgrades local image URLs to ?size=lg while preserving page and scrollTop
        sizeButtons[2]!.click();
        await new Promise((r) => setTimeout(r, 15));

        expect(widget!.classList.contains("is-thumb-lg")).toBe(true);
        expect(sizeButtons[2]!.classList.contains("is-active")).toBe(true);
        expect(reportedSizes.at(-1)).toBe("lg");
        expect(gallery.getState().currentPage).toBe(2);
        expect(scrollTop).toBe(240);
        const imgAfterLg = container.querySelector("img.ml-char-card-thumb") as HTMLImageElement | null;
        expect(imgAfterLg?.src).toContain("?size=lg");

        // Drill into character -> flat asset card uses ?size=lg, then downgrade L -> M -> ?size=sm
        const cardBeforeDrill = container.querySelector(".ml-char-card") as HTMLElement;
        cardBeforeDrill.click();
        await new Promise((r) => setTimeout(r, 15));

        const assetImgLg = container.querySelector("img.ml-asset-preview") as HTMLImageElement | null;
        expect(assetImgLg?.src).toContain("?size=lg");

        const drillSizeButtons = Array.from(
            container.querySelectorAll(".ml-thumb-size-segmented button"),
        ) as HTMLButtonElement[];
        expect(drillSizeButtons.length).toBe(3);
        drillSizeButtons[1]!.click();
        await new Promise((r) => setTimeout(r, 15));
        expect(container.querySelector(".ml-widget")?.classList.contains("is-thumb-md")).toBe(true);
        const assetCardMd = container.querySelector(".ml-asset-card") as HTMLElement | null;
        const assetImgMd = assetCardMd?.querySelector("img.ml-asset-preview") as HTMLImageElement | null;
        expect(assetImgMd?.src).toContain("?size=sm");

        // Flat asset card also reuses DOM node between md <-> sm
        drillSizeButtons[0]!.click();
        await new Promise((r) => setTimeout(r, 15));
        expect(container.querySelector(".ml-asset-card")).toBe(assetCardMd);
    });

    test("CharacterMediaWidget thumbnail size control updates wrapper class, reuses sm/md tiles, upgrades lg to ?size=lg, and preserves grid scroll", async () => {
        const container = document.createElement("div") as any as HTMLElement;
        document.body.appendChild(container);
        const { ctx } = createFrontendMockCtx({ activeCharacterId: "c-char-thumb" });
        const reportedSizes: string[] = [];

        const localizedEntry = {
            normalizedUrl: "https://example.com/a1.png",
            rawUrls: ["https://example.com/a1.png"],
            imageId: "char-a1",
            localUrl: "/api/v1/images/char-a1",
            mediaKind: "image" as const,
            mimeType: "image/png",
            sizeBytes: 1024,
            filename: "a1.png",
            localizedAt: 1000,
            characterIds: ["c-char-thumb"],
            galleryItemIds: {},
        };

        const scan = makeScan("c-char-thumb", {
            characterName: "Lumina",
            items: [
                {
                    normalizedUrl: "https://example.com/a1.png",
                    rawUrls: ["https://example.com/a1.png"],
                    domain: "example.com",
                    mediaKind: "image",
                    sources: [{ section: "core_fields", label: "Description" }],
                    occurrenceCount: 1,
                    status: "localized",
                    localizedEntry,
                },
            ],
        });

        const widgetView = new CharacterMediaWidget(
            container,
            ctx,
            "c-char-thumb",
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scan,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
            {
                inDrawer: true,
                initialScan: scan,
                onUiStateChange: (next) => {
                    reportedSizes.push(next.thumbnailSize);
                },
            },
        );

        widgetView.render();

        const wrap = container.querySelector(".ml-widget") as HTMLElement | null;
        expect(wrap).not.toBeNull();
        expect(wrap!.classList.contains("is-thumb-md")).toBe(true);

        const triggerLazyImg = (img: HTMLImageElement | null) => {
            if (!img) return;
            for (const io of domEnv.intersectionObservers.instances) {
                io.trigger([{ target: img as any, isIntersecting: true }]);
            }
        };

        const initialTile = container.querySelector(".ml-asset-card") as HTMLElement | null;
        const initialImg = initialTile?.querySelector("img.ml-asset-preview") as HTMLImageElement | null;
        triggerLazyImg(initialImg);
        expect(initialImg?.src).toContain("?size=sm");

        const gridBefore = container.querySelector('[data-scroll-id="localized-asset-grid"]') as HTMLElement | null;
        expect(gridBefore).not.toBeNull();
        gridBefore!.scrollTop = 165;

        const buttons = Array.from(
            container.querySelectorAll(".ml-thumb-size-segmented button"),
        ) as HTMLButtonElement[];
        expect(buttons.map((b) => b.textContent)).toEqual(["S", "M", "L"]);

        // M -> S reuses cached tile element and keeps scrollTop
        buttons[0]!.click();
        const wrapAfterSm = container.querySelector(".ml-widget") as HTMLElement;
        expect(wrapAfterSm.classList.contains("is-thumb-sm")).toBe(true);
        expect(reportedSizes.at(-1)).toBe("sm");
        expect(container.querySelector(".ml-asset-card")).toBe(initialTile);
        expect((container.querySelector('[data-scroll-id="localized-asset-grid"]') as HTMLElement).scrollTop).toBe(165);

        // S -> L upgrades local tile image URL to ?size=lg and keeps scrollTop
        const buttonsAfterSm = Array.from(
            container.querySelectorAll(".ml-thumb-size-segmented button"),
        ) as HTMLButtonElement[];
        buttonsAfterSm[2]!.click();
        const wrapAfterLg = container.querySelector(".ml-widget") as HTMLElement;
        expect(wrapAfterLg.classList.contains("is-thumb-lg")).toBe(true);
        expect(reportedSizes.at(-1)).toBe("lg");
        const imgAfterLg = container.querySelector("img.ml-asset-preview") as HTMLImageElement | null;
        triggerLazyImg(imgAfterLg);
        expect(imgAfterLg?.src).toContain("?size=lg");
        expect((container.querySelector('[data-scroll-id="localized-asset-grid"]') as HTMLElement).scrollTop).toBe(165);
    });

    test("MediaLocalizerDrawerPanel Settings Display & Thumbnails controls persist across tab switches and drawer remount", async () => {
        const storageBacking = new Map<string, string>();
        const prevLocalStorage = (globalThis as any).localStorage;
        (globalThis as any).localStorage = {
            getItem: (key: string) => storageBacking.get(key) ?? null,
            setItem: (key: string, value: string) => {
                storageBacking.set(key, String(value));
            },
            removeItem: (key: string) => {
                storageBacking.delete(key);
            },
        };

        try {
            const localizedPersistEntry = {
                normalizedUrl: "https://example.com/s1.png",
                rawUrls: ["https://example.com/s1.png"],
                imageId: "seraphina-1",
                localUrl: "/api/v1/images/seraphina-1",
                mediaKind: "image" as const,
                mimeType: "image/png",
                sizeBytes: 1024,
                filename: "s1.png",
                localizedAt: 1200,
                characterIds: ["c-persist-1"],
                galleryItemIds: {},
            };
            const galleryChars = [
                {
                    characterId: "c-persist-1",
                    characterName: "Seraphina",
                    avatarImageId: "seraphina-avatar",
                    avatarUrl: "/api/v1/images/seraphina-avatar",
                    totalSizeBytes: 1024,
                    lastLocalizedAt: 1200,
                    tags: [],
                    expressions: [],
                    localizedAssets: [localizedPersistEntry],
                },
            ];
            const { ctx } = createFrontendMockCtx({ activeCharacterId: "c-persist-1" });

            const callbacks = {
                onScanCharacter: async (charId: string) =>
                    makeScan(charId, {
                        characterName: "Seraphina",
                        items: [
                            {
                                normalizedUrl: "https://example.com/s1.png",
                                rawUrls: ["https://example.com/s1.png"],
                                domain: "example.com",
                                mediaKind: "image",
                                sources: [{ section: "core_fields", label: "Description" }],
                                occurrenceCount: 1,
                                status: "localized",
                                localizedEntry: localizedPersistEntry,
                            },
                        ],
                    }),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => galleryChars,
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: {
                        totalAssets: 1,
                        totalSizeBytes: 1024,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: {
                        totalAssets: 1,
                        totalSizeBytes: 1024,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                }),
            };

            const createPanel = () =>
                new MediaLocalizerDrawerPanel(
                    ctx,
                    { ...DEFAULT_SETTINGS },
                    {
                        totalAssets: 1,
                        totalSizeBytes: 1024,
                        totalFailedUrls: 0,
                        settings: { ...DEFAULT_SETTINGS },
                    },
                    makeIdleQueue(),
                    callbacks,
                );

            const container1 = document.createElement("div") as any as HTMLElement;
            document.body.appendChild(container1);
            const panel1 = createPanel();
            const unmount1 = panel1.mount(container1);
            await new Promise((r) => setTimeout(r, 20));

            // Adjust in Settings tab: Gallery -> L, Character -> S
            panel1.setActiveTab("settings");
            expect(container1.querySelectorAll(".ml-setting-toggle-grid .ml-setting-toggle-row").length).toBe(5);

            const displayGroups = Array.from(
                container1.querySelectorAll(".ml-thumb-size-segmented"),
            ) as HTMLElement[];
            expect(displayGroups.length).toBe(2);

            const gallerySizeBtns = Array.from(displayGroups[0]!.querySelectorAll("button")) as HTMLButtonElement[];
            const charSizeBtns = Array.from(displayGroups[1]!.querySelectorAll("button")) as HTMLButtonElement[];
            gallerySizeBtns[2]!.click(); // L
            charSizeBtns[0]!.click(); // S

            const savedGallery = JSON.parse(
                storageBacking.get("lumiverse.media_localizer.gallery_prefs.v1") ?? "{}",
            );
            const savedChar = JSON.parse(
                storageBacking.get("lumiverse.media_localizer.character_prefs.v1") ?? "{}",
            );
            expect(savedGallery.thumbnailSize).toBe("lg");
            expect(savedChar.thumbnailSize).toBe("sm");

            // Tab switches pick up the updated sizes immediately
            panel1.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 20));
            expect(container1.querySelector(".ml-widget")?.classList.contains("is-thumb-lg")).toBe(true);
            expect((container1.querySelector("img.ml-char-card-thumb") as HTMLImageElement | null)?.src).toContain(
                "?size=lg",
            );

            panel1.setActiveTab("character");
            await new Promise((r) => setTimeout(r, 20));
            expect(container1.querySelector(".ml-widget")?.classList.contains("is-thumb-sm")).toBe(true);

            unmount1();

            // Fresh drawer mount loads persisted sizes from localStorage
            const container2 = document.createElement("div") as any as HTMLElement;
            document.body.appendChild(container2);
            const panel2 = createPanel();
            const unmount2 = panel2.mount(container2);
            await new Promise((r) => setTimeout(r, 20));

            expect(container2.querySelector(".ml-widget")?.classList.contains("is-thumb-sm")).toBe(true);

            panel2.setActiveTab("gallery");
            await new Promise((r) => setTimeout(r, 20));
            expect(container2.querySelector(".ml-widget")?.classList.contains("is-thumb-lg")).toBe(true);

            unmount2();
        } finally {
            (globalThis as any).localStorage = prevLocalStorage;
        }
    });
});

describe("box-free drawer tabs and combined Character Options + Downloaded Media bar", () => {
    test("Drawer Character tab and Native Gallery share one combined trigger bar and toggle panes independently", async () => {
        const scan = makeScan("c-comb-1", {
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
                        sizeBytes: 2048,
                        localizedAt: 1000,
                        characterIds: ["c-comb-1"],
                        galleryItemIds: {},
                    },
                },
            ],
        });

        // 1. Native Gallery (both collapsed by default -> single compact bar, zero panes)
        const galleryTab = domEnv.document.createElement("div") as any;
        galleryTab.className = "Editor_galleryTab_comb";
        domEnv.document.body.appendChild(galleryTab);

        const editorCtx = {
            ui: {
                characterEditor: {
                    getState: () => ({
                        open: true,
                        characterId: "c-comb-1",
                        activeTabId: "gallery",
                        extensions: {},
                    }),
                    onChange: () => () => {},
                },
                showConfirm: async () => ({ confirmed: true }),
            },
        } as unknown as SpindleFrontendContext;

        const integrator = new NativeGalleryTabIntegrator(
            editorCtx,
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scan,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
        );
        integrator.start();
        await new Promise((r) => setTimeout(r, 15));

        const host = galleryTab.querySelector(".ml-gallery-host") as HTMLElement;
        expect(host.querySelectorAll(".ml-section-box").length).toBe(0);
        const nativeBar = host.querySelector(".ml-combined-drawer > .ml-combined-bar");
        expect(nativeBar).not.toBeNull();
        expect(nativeBar!.querySelectorAll("button.ml-combined-trigger").length).toBe(2);
        expect(host.querySelector(".ml-combined-pane")).toBeNull();

        // Expand Options only
        (host.querySelector('button[title*="Customize per-card"]') as any).click();
        expect(host.querySelectorAll(".ml-combined-pane").length).toBe(1);
        expect(host.querySelector(".ml-options-panel")).not.toBeNull();
        expect(host.querySelector(".ml-media-pane")).toBeNull();

        // Expand Downloaded Media while Options is open -> both panes inside one combined drawer
        (host.querySelector('button[title="Expand Downloaded Media"]') as any).click();
        expect(host.querySelectorAll(".ml-combined-pane").length).toBe(2);
        expect(host.querySelector(".ml-options-panel")).not.toBeNull();
        expect(host.querySelector(".ml-media-pane .ml-media-toolbar")).not.toBeNull();
        expect(host.querySelector(".ml-asset-grid")).not.toBeNull();
        expect(host.querySelectorAll(".ml-section-box").length).toBe(0);

        integrator.stop();

        // 2. Drawer Character tab uses the same combined bar and supports collapsing both
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-comb-1" });
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            { totalAssets: 1, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scan,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => [],
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: { totalAssets: 1, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: { totalAssets: 1, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                }),
            },
        );
        const unmount = panel.mount(container);
        await new Promise((r) => setTimeout(r, 15));

        const drawerBar = container.querySelector(".ml-combined-drawer > .ml-combined-bar");
        expect(drawerBar).not.toBeNull();
        expect(drawerBar!.querySelectorAll("button.ml-combined-trigger").length).toBe(2);
        expect(container.querySelector(".ml-media-pane")).not.toBeNull();
        expect(container.querySelector(".ml-options-panel")).toBeNull();

        (container.querySelector('button[title="Collapse Downloaded Media"]') as any).click();
        expect(container.querySelector(".ml-combined-pane")).toBeNull();
        expect(container.querySelectorAll(".ml-section-box").length).toBe(0);

        unmount();
    });

    test("all drawer tabs render boxless .ml-section flows with zero .ml-section-box containers", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: null });
        const container = domEnv.document.createElement("div") as unknown as HTMLElement;
        domEnv.document.body.appendChild(container as any);
        const panel = new MediaLocalizerDrawerPanel(
            ctxMock.ctx,
            { ...DEFAULT_SETTINGS },
            { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 1, settings: { ...DEFAULT_SETTINGS } },
            makeIdleQueue(),
            {
                onScanCharacter: async (charId) => makeScan(charId),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({
                    characters: [
                        {
                            characterId: "c-1",
                            characterName: "Alpha",
                            totalUnique: 2,
                            remoteCount: 1,
                            localizedCount: 1,
                            failedCount: 0,
                            localizedBytes: 1024,
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
                }),
                onListLibraryMedia: async () => [
                    {
                        characterId: "c-1",
                        characterName: "Alpha",
                        tags: [],
                        avatarUrl: "/api/v1/images/av-1",
                        avatarImageId: "av-1",
                        localizedAssets: [
                            {
                                normalizedUrl: "https://cdn.example.com/a.png",
                                rawUrls: ["https://cdn.example.com/a.png"],
                                imageId: "img-a1",
                                localUrl: "/api/v1/images/img-a1",
                                filename: "a.png",
                                mimeType: "image/png",
                                sizeBytes: 1024,
                                localizedAt: 1000,
                                characterIds: ["c-1"],
                                galleryItemIds: {},
                            },
                        ],
                        expressions: [],
                        totalSizeBytes: 1024,
                        lastLocalizedAt: 1000,
                    },
                ],
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async () => ({
                    settings: { ...DEFAULT_SETTINGS },
                    stats: { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 1, settings: { ...DEFAULT_SETTINGS } },
                }),
                onClearFailed: async () => ({
                    cleared: 1,
                    stats: { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                }),
            },
        );

        const unmount = panel.mount(container);

        // Character empty state
        expect(container.querySelectorAll(".ml-section-box").length).toBe(0);
        expect(container.querySelector(".ml-section.ml-empty")).not.toBeNull();

        // Gallery tab
        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 15));
        expect(container.querySelectorAll(".ml-section-box").length).toBe(0);
        expect(container.querySelector(".ml-section.ml-gallery-toolbar")).not.toBeNull();
        expect(container.querySelector(".ml-section.ml-gallery-content-slot")).not.toBeNull();

        // Library Batch tab (unscanned -> scanned)
        panel.setActiveTab("library");
        expect(container.querySelectorAll(".ml-section-box").length).toBe(0);
        expect(container.querySelectorAll(".ml-section").length).toBe(1);
        const scanBtn = Array.from(container.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
            (b.textContent ?? "").includes("Scan Library"),
        );
        expect(scanBtn).toBeDefined();
        scanBtn.click();
        await new Promise((r) => setTimeout(r, 15));
        expect(container.querySelectorAll(".ml-section-box").length).toBe(0);
        expect(container.querySelectorAll(".ml-section").length).toBe(3);
        expect(container.querySelector('[data-scroll-id="library-char-list"].ml-url-list.is-tall')).not.toBeNull();

        // Settings tab
        panel.setActiveTab("settings");
        expect(container.querySelectorAll(".ml-section-box").length).toBe(0);
        expect(container.querySelectorAll(".ml-section").length).toBe(4);
        expect(container.querySelectorAll(".ml-setting-toggle-grid .ml-setting-toggle-row").length).toBe(5);

        unmount();
    });

    test("native Gallery Downloaded Media grid prevents card/thumb squishing at 50+ items across sm/md/lg", async () => {
        const getBlock = (selector: string): string => {
            const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return Array.from(
                MEDIA_LOCALIZER_STYLES.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")),
                (m) => m[1] ?? "",
            ).join("\n");
        };

        const galleryHostBlock = getBlock(".ml-gallery-host");
        const assetGridBlock = getBlock(".ml-asset-grid");
        const assetCardBlock = getBlock(".ml-asset-card");
        const thumbWrapBlock = getBlock(".ml-asset-thumb-wrap");
        const assetFooterBlock = getBlock(".ml-asset-footer");
        const mediaListBlock = getBlock(".ml-media-list");
        const mediaListRowBlock = getBlock(".ml-media-list-row");

        expect(galleryHostBlock).toContain("width: 100%");
        expect(galleryHostBlock).toContain("min-width: 0");
        expect(galleryHostBlock).toContain("flex-shrink: 0");

        expect(assetGridBlock).toContain("grid-auto-rows: max-content");
        expect(assetGridBlock).toContain("align-content: start");
        expect(assetGridBlock).toContain("flex-shrink: 0");
        expect(assetGridBlock).toContain("min-width: 0");

        expect(assetCardBlock).toContain("min-width: 0");
        expect(assetCardBlock).toContain("min-height: max-content");

        expect(thumbWrapBlock).toContain("height: var(--ml-asset-thumb-height, 78px)");
        expect(thumbWrapBlock).toContain("min-height: var(--ml-asset-thumb-height, 78px)");
        expect(thumbWrapBlock).toContain("flex-shrink: 0");

        expect(assetFooterBlock).toContain("flex-shrink: 0");
        expect(mediaListBlock).toContain("flex-shrink: 0");
        expect(mediaListRowBlock).toContain("flex-shrink: 0");

        const items = Array.from({ length: 50 }, (_, idx) => ({
            normalizedUrl: `https://cdn.example.com/item-${idx}.png`,
            rawUrls: [`https://cdn.example.com/item-${idx}.png`],
            domain: "cdn.example.com",
            mediaKind: "image" as const,
            sources: [{ section: "core_fields" as const, label: "Description" }],
            occurrenceCount: 1,
            status: "localized" as const,
            localizedEntry: {
                normalizedUrl: `https://cdn.example.com/item-${idx}.png`,
                rawUrls: [`https://cdn.example.com/item-${idx}.png`],
                imageId: `img-many-${idx}`,
                localUrl: `/api/v1/images/img-many-${idx}`,
                filename: `item-${idx}.png`,
                mimeType: "image/png",
                sizeBytes: 2048 + idx,
                localizedAt: 1000 + idx,
                characterIds: ["c-many-1"],
                galleryItemIds: {},
            },
        }));
        const scan = makeScan("c-many-1", { items });

        const galleryTab = domEnv.document.createElement("div") as any;
        galleryTab.className = "Editor_galleryTab_many";
        domEnv.document.body.appendChild(galleryTab);

        const editorCtx = {
            ui: {
                characterEditor: {
                    getState: () => ({
                        open: true,
                        characterId: "c-many-1",
                        activeTabId: "gallery",
                        extensions: {},
                    }),
                    onChange: () => () => {},
                },
                showConfirm: async () => ({ confirmed: true }),
            },
        } as unknown as SpindleFrontendContext;

        const integrator = new NativeGalleryTabIntegrator(
            editorCtx,
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scan,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
        );
        integrator.start();
        await new Promise((r) => setTimeout(r, 15));

        const host = galleryTab.querySelector(".ml-gallery-host.is-embedded") as HTMLElement;
        expect(host).not.toBeNull();
        expect(galleryTab.classList.contains("ml-gallery-tab-active")).toBe(true);

        (host.querySelector('button[title="Expand Downloaded Media"]') as any).click();

        const grid = host.querySelector(".ml-asset-grid") as HTMLElement;
        expect(grid).not.toBeNull();
        expect(grid.querySelectorAll(".ml-asset-card").length).toBe(50);
        expect(grid.querySelectorAll(".ml-asset-thumb-wrap").length).toBe(50);

        for (const [idx, expectedClass] of [
            [0, "is-thumb-sm"],
            [1, "is-thumb-md"],
            [2, "is-thumb-lg"],
        ] as const) {
            const sizeBtns = Array.from(
                host.querySelectorAll(".ml-thumb-size-segmented button"),
            ) as HTMLButtonElement[];
            sizeBtns[idx]!.click();
            expect(host.querySelector(".ml-widget")?.classList.contains(expectedClass)).toBe(true);
            expect(host.querySelectorAll(".ml-asset-grid .ml-asset-card").length).toBe(50);
            expect(host.querySelectorAll(".ml-asset-grid .ml-asset-thumb-wrap").length).toBe(50);
        }

        (host.querySelector('button[title="List view"]') as any).click();
        expect(host.querySelectorAll(".ml-media-list .ml-media-list-row").length).toBe(50);

        integrator.stop();
    });
});

describe("audit regression tests (H-01..L-04)", () => {
    let domEnv: MockDomEnv;

    beforeEach(() => {
        domEnv = installMockDom();
    });

    afterEach(() => {
        cleanupUiHelpers();
        domEnv.restore();
    });

    test("H-01: eager flag loads leading videos immediately and cached DOM reuse re-observes detached lazy media", async () => {
        const localizedAssets = Array.from({ length: 100 }, (_, idx) => ({
            normalizedUrl: `https://cdn.example.com/h01-${idx}`,
            rawUrls: [`https://cdn.example.com/h01-${idx}`],
            imageId: `img-h01-${idx}`,
            localUrl: `/api/v1/images/img-h01-${idx}`,
            mediaKind: (idx === 0 || idx === 99 ? "video" : "image") as "video" | "image",
            filename: idx === 0 || idx === 99 ? `clip-${idx}.mp4` : `pic-${idx}.png`,
            mimeType: idx === 0 || idx === 99 ? "video/mp4" : "image/png",
            sizeBytes: 1024 + idx,
            localizedAt: 5000 - idx,
            characterIds: ["c-h01"],
            galleryItemIds: {},
        }));

        const listData = [
            {
                characterId: "c-h01",
                characterName: "H01 Char",
                tags: [],
                avatarImageId: null,
                avatarUrl: null,
                localizedAssets,
                expressions: [],
                totalSizeBytes: 20000,
                lastLocalizedAt: 5000,
            },
        ];

        const root = domEnv.document.createElement("div") as any;
        domEnv.document.body.appendChild(root);

        const gallery = new LibraryGalleryView(
            root,
            {
                onLoadLibraryMedia: async () => listData,
                onPurgeAsset: async () => {},
            },
            {
                state: {
                    grouped: false,
                    viewMode: "grid",
                    sortMode: "recent",
                    sortDirection: "desc",
                    pageSize: 192,
                },
            },
        );
        await gallery.refresh(false);

        const videos = Array.from(root.querySelectorAll("video")) as any[];
        expect(videos.length).toBe(2);
        // Leading video (idx 0) receives eager: true -> immediate src without waiting on IntersectionObserver
        expect(videos[0]!.getAttribute("src")).toBe("/api/v1/images/img-h01-0");
        // Trailing video (idx 99) stays lazy until intersected
        expect(videos[1]!.preload).toBe("metadata");
        expect(videos[1]!.getAttribute("src")).toBeFalsy();

        // Simulate a DOM re-render (e.g. search/reset or update in place) reusing cached cards
        // while trailing video was unmounted/unobserved before entering viewport
        const io = domEnv.intersectionObservers.instances[0]!;
        io.unobserve(videos[1]!);
        await gallery.refresh(true);

        const reusedVideos = Array.from(root.querySelectorAll("video")) as any[];
        expect(reusedVideos[1]).toBe(videos[1]);
        io.trigger([{ target: reusedVideos[1]!, isIntersecting: true }]);
        expect(reusedVideos[1]!.getAttribute("src")).toBe("/api/v1/images/img-h01-99");

        gallery.destroy();

        // CharacterMediaWidget mediaTileCache reuse also re-observes lazy thumbnails
        const widgetRoot = domEnv.document.createElement("div") as any;
        domEnv.document.body.appendChild(widgetRoot);
        const widgetItems = Array.from({ length: 16 }, (_, idx) => ({
            normalizedUrl: `https://cdn.example.com/w-${idx}.mp4`,
            rawUrls: [`https://cdn.example.com/w-${idx}.mp4`],
            domain: "cdn.example.com",
            mediaKind: "video" as const,
            sources: [{ section: "core_fields" as const, label: "Description" }],
            occurrenceCount: 1,
            status: "localized" as const,
            localizedEntry: {
                normalizedUrl: `https://cdn.example.com/w-${idx}.mp4`,
                rawUrls: [`https://cdn.example.com/w-${idx}.mp4`],
                imageId: `w-vid-${idx}`,
                localUrl: `/api/v1/images/w-vid-${idx}`,
                filename: `w-${idx}.mp4`,
                mimeType: "video/mp4",
                sizeBytes: 1000 + idx,
                localizedAt: 1000 + idx,
                characterIds: ["c-w-h01"],
                galleryItemIds: {},
            },
        }));
        const scan1 = makeScan("c-w-h01", { items: widgetItems });
        const widget = new CharacterMediaWidget(
            widgetRoot,
            { ui: { showConfirm: async () => ({ confirmed: true }) } } as unknown as SpindleFrontendContext,
            "c-w-h01",
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => scan1,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
            { initialScan: scan1 },
        );
        widget.render();
        const wVideos = Array.from(widgetRoot.querySelectorAll("video")) as any[];
        expect(wVideos.length).toBe(16);
        const trailingWidgetVideo = wVideos[15]!;
        expect(trailingWidgetVideo.getAttribute("src")).toBeFalsy();
        io.unobserve(trailingWidgetVideo);
        widget.render(); // reuses cached tile via mediaTileCache
        const reusedWidgetVideos = Array.from(widgetRoot.querySelectorAll("video")) as any[];
        expect(reusedWidgetVideos[15]).toBe(trailingWidgetVideo);
        io.trigger([{ target: trailingWidgetVideo, isIntersecting: true }]);
        expect(trailingWidgetVideo.getAttribute("src")).toBe("/api/v1/images/w-vid-15");
        widget.destroy();
    });

    test("H-02: URL_MAP_UPDATED & QUEUE_PROGRESS apply msg.stats, and drawer re-renders library/settings on queue finish even without totalAssets change", async () => {
        const statsA: StorageStatsSummary = {
            totalAssets: 2,
            totalSizeBytes: 2048,
            totalFailedUrls: 1,
            settings: { ...DEFAULT_SETTINGS },
        };
        const runningQueue: QueueJobProgress = {
            ...makeIdleQueue(),
            status: "running",
            jobId: "job-h02",
            totalQueued: 2,
            completedCount: 1,
            succeededCount: 1,
        };
        let listMediaLoads = 0;
        const panelRoot = domEnv.document.createElement("div") as any;
        domEnv.document.body.appendChild(panelRoot);
        const panel = new MediaLocalizerDrawerPanel(
            {
                state: { get: (k: string) => (k === "chat.active" ? { characterId: "c-h02" } : null) },
                ui: { showConfirm: async () => ({ confirmed: true }) },
            } as unknown as SpindleFrontendContext,
            { ...DEFAULT_SETTINGS },
            statsA,
            makeIdleQueue(),
            {
                onScanCharacter: async () => makeScan("c-h02"),
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({
                    characters: [
                        {
                            characterId: "c-h02",
                            characterName: "H02 Library Hero",
                            remoteCount: 3,
                            localizedCount: 1,
                            failedCount: 0,
                            totalUnique: 4,
                            totalOccurrences: 4,
                            localizedBytes: 1024,
                            sectionRemoteCounts: {
                                creator_notes: 0,
                                first_mes: 0,
                                core_fields: 3,
                                alternate_greetings: 0,
                                world_books: 0,
                                regex_scripts: 0,
                            },
                        },
                    ],
                    totalUniqueRemote: 3,
                }),
                onListLibraryMedia: async () => {
                    listMediaLoads++;
                    return [];
                },
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async (patch) => ({
                    settings: { ...DEFAULT_SETTINGS, ...patch },
                    stats: statsA,
                }),
                onClearFailed: async () => ({ cleared: 0, stats: statsA }),
            },
        );
        const unmount = panel.mount(panelRoot);
        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 10));
        expect(listMediaLoads).toBe(1);

        // Scan library so librarySummaries is populated while active on library tab
        panel.setActiveTab("library");
        const scanLibBtn = Array.from(panelRoot.querySelectorAll("button")).find((b: any) =>
            b.textContent?.includes("Scan Library"),
        ) as any;
        scanLibBtn.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(panelRoot.textContent).toContain("H02 Library Hero");

        // Transition queue running -> completed with identical statsA (no totalAssets delta)
        panel.updateExternalState({ ...DEFAULT_SETTINGS }, statsA, runningQueue);
        panel.updateExternalState({ ...DEFAULT_SETTINGS }, statsA, {
            ...makeIdleQueue(),
            status: "completed",
            jobId: "job-h02",
        });
        // Library tab re-rendered and cleared stale summaries
        expect(panelRoot.textContent).not.toContain("H02 Library Hero");

        // Gallery cache was also invalidated by wasActive && !nowActive even without totalAssets delta
        panel.setActiveTab("gallery");
        await new Promise((r) => setTimeout(r, 10));
        expect(listMediaLoads).toBe(2);

        // Settings tab also re-renders when queue finishes without totalAssets delta
        panel.updateExternalState({ ...DEFAULT_SETTINGS }, statsA, runningQueue);
        panel.setActiveTab("settings");
        const settingsChildBefore = panelRoot.querySelector(".ml-drawer-body")?.firstChild;
        panel.updateExternalState({ ...DEFAULT_SETTINGS }, statsA, {
            ...makeIdleQueue(),
            status: "completed",
            jobId: "job-h02",
        });
        const settingsChildAfter = panelRoot.querySelector(".ml-drawer-body")?.firstChild;
        expect(settingsChildAfter).not.toBe(settingsChildBefore);
        unmount();

        // Live setup(ctx): URL_MAP_UPDATED & QUEUE_PROGRESS carrying msg.stats update Settings UI stats
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-h02-live" });
        const teardown = setup(ctxMock.ctx);
        const initReq = ctxMock.sentMessages.find((m) => m.action === "get_init_state");
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: initReq.requestId,
            result: {
                stats: { totalAssets: 1, totalSizeBytes: 1024, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                queueProgress: makeIdleQueue(),
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
            },
        });
        await new Promise((r) => setTimeout(r, 10));

        const drawerContainer = (ctxMock.drawerTabs[0] as any).root;
        (Array.from(drawerContainer.querySelectorAll("button")).find((b: any) =>
            b.textContent?.includes("Settings"),
        ) as any).click();
        expect(drawerContainer.textContent).toContain("1 URLs");

        ctxMock.emitBackendMessage({
            type: "URL_MAP_UPDATED",
            urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 2 },
            stats: { totalAssets: 7, totalSizeBytes: 7168, totalFailedUrls: 2, settings: { ...DEFAULT_SETTINGS } },
        });
        expect(drawerContainer.textContent).toContain("7 URLs");

        ctxMock.emitBackendMessage({
            type: "QUEUE_PROGRESS",
            progress: { ...makeIdleQueue(), status: "completed", jobId: "j-live" },
            stats: { totalAssets: 11, totalSizeBytes: 11264, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
        });
        expect(drawerContainer.textContent).toContain("11 URLs");

        teardown();
    });

    test("H-03: syncs Character preferences bidirectionally between Drawer/Settings and NativeGalleryTabIntegrator without overriding collapsed state", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-h03" });
        const galleryTab = domEnv.document.createElement("div") as any;
        galleryTab.className = "Editor_galleryTab_h03";
        domEnv.document.body.appendChild(galleryTab);

        const editorListeners = new Set<(state: any) => void>();
        (ctxMock.ctx.ui as any).characterEditor = {
            getState: () => ({
                open: true,
                characterId: "c-h03",
                activeTabId: "gallery",
                extensions: {},
            }),
            onChange: (cb: (state: any) => void) => {
                editorListeners.add(cb);
                return () => editorListeners.delete(cb);
            },
        };

        const teardown = setup(ctxMock.ctx);
        const initReq = ctxMock.sentMessages.find((m) => m.action === "get_init_state");
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: initReq.requestId,
            result: {
                stats: { totalAssets: 0, totalSizeBytes: 0, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                queueProgress: makeIdleQueue(),
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
            },
        });
        for (const msg of ctxMock.sentMessages.filter((m) => m.action === "scan_character")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: msg.requestId,
                result: { scan: makeScan("c-h03"), urlMapPayload: null, pendingGalleryLinks: [] },
            });
        }
        await new Promise((r) => setTimeout(r, 20));
        // Reply to any scan initiated by integrator mount
        for (const msg of ctxMock.sentMessages.filter((m) => m.action === "scan_character")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: msg.requestId,
                result: { scan: makeScan("c-h03"), urlMapPayload: null, pendingGalleryLinks: [] },
            });
        }
        await new Promise((r) => setTimeout(r, 10));

        const nativeHost = galleryTab.querySelector(".ml-gallery-host.is-embedded") as HTMLElement;
        expect(nativeHost).not.toBeNull();
        // Downloaded Media is collapsed by default in native Gallery
        expect(nativeHost.querySelector('button[title="Expand Downloaded Media"]')).not.toBeNull();

        const drawerContainer = (ctxMock.drawerTabs[0] as any).root;

        // Change thumbnailSize in Drawer Settings -> native widget gets is-thumb-lg AND keeps Downloaded Media collapsed
        (Array.from(drawerContainer.querySelectorAll("button")).find((b: any) =>
            b.textContent?.includes("Settings"),
        ) as any).click();
        const thumbCards = Array.from(drawerContainer.querySelectorAll(".ml-thumb-size-segmented")) as any[];
        expect(thumbCards.length).toBeGreaterThanOrEqual(2);
        const charThumbSegmented = thumbCards[1]!;
        const lgBtn = Array.from(charThumbSegmented.querySelectorAll("button")).find((b: any) =>
            b.textContent?.trim() === "L" || b.title?.includes("Large"),
        ) as any;
        lgBtn.click();

        expect(nativeHost.querySelector(".ml-widget")?.classList.contains("is-thumb-lg")).toBe(true);
        expect(nativeHost.querySelector('button[title="Expand Downloaded Media"]')).not.toBeNull();

        // Switch Drawer back to Character tab, then change thumbnailSize to Small inside native gallery -> Drawer widget updates too
        (Array.from(drawerContainer.querySelectorAll("button")).find((b: any) =>
            b.textContent?.includes("Character"),
        ) as any).click();
        expect(drawerContainer.querySelector(".ml-widget")?.classList.contains("is-thumb-lg")).toBe(true);

        (nativeHost.querySelector('button[title="Expand Downloaded Media"]') as any).click();
        const nativeSmBtn = Array.from(
            nativeHost.querySelectorAll(".ml-thumb-size-segmented button"),
        ).find((b: any) => b.textContent?.trim() === "S" || b.title?.includes("Small")) as any;
        nativeSmBtn.click();

        expect(drawerContainer.querySelector(".ml-widget")?.classList.contains("is-thumb-sm")).toBe(true);

        teardown();
    });

    test("M-05 (frontend): ignores stale pre-purge scan results for URL map & gallery links and avoids post-purge scan coalescing", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-m05" });
        const linkPosts: string[] = [];
        globalThis.fetch = (async (url: string, init?: RequestInit) => {
            if ((init?.method ?? "GET") === "POST" && String(url).includes("/gallery/link")) {
                linkPosts.push(String(url));
                return new Response(JSON.stringify({ id: "gal-m05-1" }), { status: 200 });
            }
            if ((init?.method ?? "GET") === "GET") {
                return new Response(JSON.stringify({ data: [] }), { status: 200 });
            }
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        const imgEl = domEnv.document.createElement("img") as any;
        imgEl.setAttribute("src", "https://cdn.example.com/stale-m05.png");
        domEnv.document.body.appendChild(imgEl);

        const teardown = setup(ctxMock.ctx);
        const initReq = ctxMock.sentMessages.find((m) => m.action === "get_init_state");
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: initReq.requestId,
            result: {
                stats: { totalAssets: 0, totalSizeBytes: 0, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                queueProgress: makeIdleQueue(),
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
            },
        });
        await new Promise((r) => setTimeout(r, 10));

        // Answer initial bootstrap scan with a localized item so Character tab renders Remove All (purge) button
        const m05LocalizedScan = makeScan("c-m05", {
            items: [
                {
                    normalizedUrl: "https://cdn.example.com/stale-m05.png",
                    rawUrls: ["https://cdn.example.com/stale-m05.png"],
                    domain: "cdn.example.com",
                    mediaKind: "image",
                    sources: [{ section: "core_fields", label: "Description" }],
                    occurrenceCount: 1,
                    status: "localized",
                    localizedEntry: {
                        normalizedUrl: "https://cdn.example.com/stale-m05.png",
                        rawUrls: ["https://cdn.example.com/stale-m05.png"],
                        imageId: "img-stale-m05",
                        localUrl: "/api/v1/images/img-stale-m05",
                        filename: "stale-m05.png",
                        mimeType: "image/png",
                        sizeBytes: 1024,
                        localizedAt: 1000,
                        characterIds: ["c-m05"],
                        galleryItemIds: {},
                    },
                },
            ],
        });
        for (const msg of ctxMock.sentMessages.filter((m) => m.action === "scan_character")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: msg.requestId,
                result: { scan: m05LocalizedScan, urlMapPayload: null, pendingGalleryLinks: [] },
            });
        }
        await new Promise((r) => setTimeout(r, 10));

        // Trigger a fresh in-flight scan (via GALLERY_SYNC_CHANGED) and leave it pending
        const seenReqIds = new Set(ctxMock.sentMessages.map((m) => m.requestId));
        ctxMock.emitBackendMessage({ type: "GALLERY_SYNC_CHANGED", characterId: "c-m05" });
        await new Promise((r) => setTimeout(r, 10));
        const prePurgeScans = ctxMock.sentMessages.filter(
            (m) => m.action === "scan_character" && !seenReqIds.has(m.requestId),
        );
        expect(prePurgeScans.length).toBeGreaterThanOrEqual(1);
        const staleScanReq = prePurgeScans[0]!;

        // Trigger Purge Cache from drawer UI
        const drawerContainer = (ctxMock.drawerTabs[0] as any).root;
        const purgeBtn = drawerContainer.querySelector('button[title*="Remove all"]') as any;
        expect(purgeBtn).not.toBeNull();
        purgeBtn.click();
        await new Promise((r) => setTimeout(r, 10));

        const purgeReq = ctxMock.sentMessages.find((m) => m.action === "purge_character_cache");
        expect(purgeReq).toBeDefined();
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: purgeReq.requestId,
            result: {
                removedGalleryItemIds: [],
                removedImageIds: [],
                stats: { totalAssets: 0, totalSizeBytes: 0, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 2 },
            },
        });
        await new Promise((r) => setTimeout(r, 10));

        // Now resolve the STALE pre-purge scan with old URL map & pendingGalleryLinks
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: staleScanReq.requestId,
            result: {
                scan: makeScan("c-m05"),
                urlMapPayload: {
                    characterUrlMaps: {
                        "c-m05": { "https://cdn.example.com/stale-m05.png": "/api/v1/images/stale-local" },
                    },
                    allUrlsMap: {},
                    updatedAt: 1,
                },
                pendingGalleryLinks: [
                    {
                        characterId: "c-m05",
                        normalizedUrl: "https://cdn.example.com/stale-m05.png",
                        imageId: "img-stale-m05",
                    },
                ],
            },
        });
        await new Promise((r) => setTimeout(r, 20));
        domEnv.window.flushAnimationFrames();

        // Stale scan must NOT restore URL swap or re-link native gallery
        expect(imgEl.getAttribute("src")).toBe("https://cdn.example.com/stale-m05.png");
        expect(linkPosts.length).toBe(0);

        // Post-purge scan issued by purge handler did NOT coalesce onto staleScanReq
        const postPurgeScans = ctxMock.sentMessages.filter(
            (m) => m.action === "scan_character" && m.requestId !== staleScanReq.requestId,
        );
        expect(postPurgeScans.length).toBeGreaterThanOrEqual(1);

        teardown();
    });

    test("M-06 & M-07: resets scroll on character switch, preserves on same-char chat notification, and guards clientHeight===0 & settling rAFs", async () => {
        let activeId = "char-a";
        const scans: Record<string, CharacterMediaScanResult> = {
            "char-a": makeScan("char-a", {
                items: [
                    {
                        normalizedUrl: "https://cdn.example.com/a-1.png",
                        rawUrls: ["https://cdn.example.com/a-1.png"],
                        domain: "cdn.example.com",
                        mediaKind: "image",
                        sources: [{ section: "core_fields", label: "Description" }],
                        occurrenceCount: 1,
                        status: "localized",
                        localizedEntry: {
                            normalizedUrl: "https://cdn.example.com/a-1.png",
                            rawUrls: ["https://cdn.example.com/a-1.png"],
                            imageId: "img-a-1",
                            localUrl: "/api/v1/images/img-a-1",
                            filename: "a-1.png",
                            mimeType: "image/png",
                            sizeBytes: 1024,
                            localizedAt: 1000,
                            characterIds: ["char-a"],
                            galleryItemIds: {},
                        },
                    },
                ],
            }),
            "char-b": makeScan("char-b", {
                items: [
                    {
                        normalizedUrl: "https://cdn.example.com/b-1.png",
                        rawUrls: ["https://cdn.example.com/b-1.png"],
                        domain: "cdn.example.com",
                        mediaKind: "image",
                        sources: [{ section: "core_fields", label: "Description" }],
                        occurrenceCount: 1,
                        status: "localized",
                        localizedEntry: {
                            normalizedUrl: "https://cdn.example.com/b-1.png",
                            rawUrls: ["https://cdn.example.com/b-1.png"],
                            imageId: "img-b-1",
                            localUrl: "/api/v1/images/img-b-1",
                            filename: "b-1.png",
                            mimeType: "image/png",
                            sizeBytes: 1024,
                            localizedAt: 1000,
                            characterIds: ["char-b"],
                            galleryItemIds: {},
                        },
                    },
                ],
            }),
        };

        const host = domEnv.document.createElement("div") as any;
        host.style.overflowY = "auto";
        domEnv.document.body.appendChild(host);
        const origGetComputedStyle = domEnv.window.getComputedStyle;
        (domEnv.window as any).getComputedStyle = (el: any) => ({
            ...(origGetComputedStyle ? origGetComputedStyle(el) : {}),
            overflowY: el === host ? "auto" : "visible",
        });

        const panel = new MediaLocalizerDrawerPanel(
            {
                state: { get: (k: string) => (k === "chat.active" ? { characterId: activeId } : null) },
                ui: { showConfirm: async () => ({ confirmed: true }) },
            } as unknown as SpindleFrontendContext,
            { ...DEFAULT_SETTINGS },
            { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
            makeIdleQueue(),
            {
                onScanCharacter: async (id) => scans[id]!,
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
                onScanLibrary: async () => ({ characters: [], totalUniqueRemote: 0 }),
                onListLibraryMedia: async () => [],
                onBulkPurgeCharacters: async () => {},
                onUpdateSettings: async (p) => ({
                    settings: { ...DEFAULT_SETTINGS, ...p },
                    stats: { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                }),
                onClearFailed: async () => ({
                    cleared: 0,
                    stats: { totalAssets: 2, totalSizeBytes: 2048, totalFailedUrls: 0, settings: { ...DEFAULT_SETTINGS } },
                }),
            },
        );
        const unmount = panel.mount(host);
        await new Promise((r) => setTimeout(r, 15));

        const body = host.querySelector(".ml-drawer-body") as any;
        const gridA = host.querySelector('[data-scroll-id="localized-asset-grid"]') as any;
        expect(gridA).not.toBeNull();
        gridA.scrollTop = 90;
        body.scrollTop = 240;
        body.dispatchEvent(new MockEvent("scroll"));

        // M-07: collapsed drawer (clientHeight === 0) emitting scrollTop = 0 must NOT zero saved scroll
        body.clientHeight = 0;
        body.scrollTop = 0;
        body.dispatchEvent(new MockEvent("scroll"));
        delete body.clientHeight;
        panel.restoreScrollIfReset();
        expect(body.scrollTop).toBe(240);

        // M-07: while pending rAF settlement is active, transient scrollTop=0 does not clobber 240
        body.scrollTop = 0;
        body.dispatchEvent(new MockEvent("scroll"));
        expect(body.scrollTop).toBe(0);
        domEnv.window.flushAnimationFrames();
        expect(body.scrollTop).toBe(240);

        // M-06: same-char notifyActiveChatChanged preserves scroll
        panel.notifyActiveChatChanged();
        expect(body.scrollTop).toBe(240);

        // M-06: setActiveTab("character", "char-b") while on character resets outer & inner scroll
        panel.setActiveTab("character", "char-b");
        await new Promise((r) => setTimeout(r, 15));
        expect(body.scrollTop).toBe(0);
        const gridB = host.querySelector('[data-scroll-id="localized-asset-grid"]') as any;
        expect(gridB?.scrollTop ?? 0).toBe(0);

        // Scroll char-b, then switch active chat back to char-a -> resets char-b scroll too
        gridB.scrollTop = 75;
        body.scrollTop = 180;
        body.dispatchEvent(new MockEvent("scroll"));
        activeId = "char-a";
        panel.notifyActiveChatChanged();
        await new Promise((r) => setTimeout(r, 15));
        expect(body.scrollTop).toBe(0);
        const gridAAgain = host.querySelector('[data-scroll-id="localized-asset-grid"]') as any;
        expect(gridAAgain?.scrollTop ?? 0).toBe(0);

        unmount();
    });

    test("L-03, L-04 & polish: non-destructive purge resets link cache, duplicate-hash URLs both link, deferred lightbox rescan, and drilldown auto-exit", async () => {
        const ctxMock = createFrontendMockCtx({ activeCharacterId: "c-l03" });
        const linkBodies: string[] = [];
        let galleryRows: Array<{ id: string; character_id: string; image_id: string }> = [];

        globalThis.fetch = (async (url: string, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            if (method === "GET" && String(url).includes("/gallery")) {
                return new Response(JSON.stringify({ data: galleryRows }), { status: 200 });
            }
            if (method === "POST" && String(url).includes("/gallery/link")) {
                const body = String(init?.body ?? "");
                linkBodies.push(body);
                const parsed = JSON.parse(body);
                const row = { id: `gal-row-${linkBodies.length}`, character_id: "c-l03", image_id: parsed.image_id };
                galleryRows.push(row);
                return new Response(JSON.stringify(row), { status: 200 });
            }
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        const teardown = setup(ctxMock.ctx);
        const initReq = ctxMock.sentMessages.find((m) => m.action === "get_init_state");
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: initReq.requestId,
            result: {
                stats: {
                    totalAssets: 2,
                    totalSizeBytes: 2048,
                    totalFailedUrls: 0,
                    settings: { ...DEFAULT_SETTINGS, deleteImagesOnPurge: false },
                },
                queueProgress: makeIdleQueue(),
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
            },
        });
        await new Promise((r) => setTimeout(r, 10));

        // Two distinct normalizedUrls sharing one imageId both trigger record_gallery_links (L-04)
        ctxMock.emitBackendMessage({
            type: "ENSURE_GALLERY_LINKS",
            characterId: "c-l03",
            links: [
                { characterId: "c-l03", normalizedUrl: "https://cdn.example.com/dup-1.png", imageId: "img-shared" },
                { characterId: "c-l03", normalizedUrl: "https://cdn.example.com/dup-2.png", imageId: "img-shared" },
            ],
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(linkBodies.length).toBe(1);
        const recordMsgs = ctxMock.sentMessages.filter((m) => m.action === "record_gallery_links");
        const recordedUrls = recordMsgs.flatMap((m) => (m.payload?.links ?? []).map((l: any) => l.normalizedUrl));
        expect(recordedUrls).toContain("https://cdn.example.com/dup-1.png");
        expect(recordedUrls).toContain("https://cdn.example.com/dup-2.png");
        for (const rm of recordMsgs) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: rm.requestId,
                result: { ok: true },
            });
        }
        await new Promise((r) => setTimeout(r, 10));

        // Non-destructive purge (0 removed rows/images) clears knownLinkedGalleryRowByCharacter (L-03)
        // First respond to initial scan_character with localized item so Remove All (purge) button renders
        const l03LocalizedScan = makeScan("c-l03", {
            items: [
                {
                    normalizedUrl: "https://cdn.example.com/dup-1.png",
                    rawUrls: ["https://cdn.example.com/dup-1.png"],
                    domain: "cdn.example.com",
                    mediaKind: "image",
                    sources: [{ section: "core_fields", label: "Description" }],
                    occurrenceCount: 1,
                    status: "localized",
                    localizedEntry: {
                        normalizedUrl: "https://cdn.example.com/dup-1.png",
                        rawUrls: ["https://cdn.example.com/dup-1.png"],
                        imageId: "img-shared",
                        localUrl: "/api/v1/images/img-shared",
                        filename: "dup-1.png",
                        mimeType: "image/png",
                        sizeBytes: 1024,
                        localizedAt: 1000,
                        characterIds: ["c-l03"],
                        galleryItemIds: {},
                    },
                },
            ],
        });
        for (const msg of ctxMock.sentMessages.filter((m) => m.action === "scan_character")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: msg.requestId,
                result: { scan: l03LocalizedScan, urlMapPayload: null, pendingGalleryLinks: [] },
            });
        }
        await new Promise((r) => setTimeout(r, 10));

        const drawerContainer = (ctxMock.drawerTabs[0] as any).root;
        const l03PurgeBtn = drawerContainer.querySelector('button[title*="Remove all"]') as any;
        expect(l03PurgeBtn).not.toBeNull();
        l03PurgeBtn.click();
        await new Promise((r) => setTimeout(r, 10));
        const purgeReq = ctxMock.sentMessages.find((m) => m.action === "purge_character_cache");
        ctxMock.emitBackendMessage({
            type: "RPC_RESPONSE",
            requestId: purgeReq.requestId,
            result: {
                removedGalleryItemIds: [],
                removedImageIds: [],
                stats: {
                    totalAssets: 0,
                    totalSizeBytes: 0,
                    totalFailedUrls: 0,
                    settings: { ...DEFAULT_SETTINGS, deleteImagesOnPurge: false },
                },
                urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 2 },
            },
        });
        await new Promise((r) => setTimeout(r, 10));

        // Simulate native gallery row gone externally; because cache was cleared, ENSURE_GALLERY_LINKS re-POSTs
        galleryRows = [];
        ctxMock.emitBackendMessage({
            type: "ENSURE_GALLERY_LINKS",
            characterId: "c-l03",
            links: [
                { characterId: "c-l03", normalizedUrl: "https://cdn.example.com/dup-1.png", imageId: "img-shared" },
            ],
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(linkBodies.length).toBe(2);
        for (const rm of ctxMock.sentMessages.filter((m) => m.action === "record_gallery_links")) {
            ctxMock.emitBackendMessage({
                type: "RPC_RESPONSE",
                requestId: rm.requestId,
                result: { ok: true },
            });
        }
        await new Promise((r) => setTimeout(r, 10));

        teardown();

        // CharacterMediaWidget lightbox defers refreshScan(false) to onAfterRemove instead of blocking Remove
        const wRoot = domEnv.document.createElement("div") as any;
        domEnv.document.body.appendChild(wRoot);
        let resolveScanAfterRemove!: (scan: CharacterMediaScanResult) => void;
        let scanCalls = 0;
        const localizedScan = makeScan("c-lb", {
            items: [
                {
                    normalizedUrl: "https://cdn.example.com/lb.png",
                    rawUrls: ["https://cdn.example.com/lb.png"],
                    domain: "cdn.example.com",
                    mediaKind: "image",
                    sources: [{ section: "core_fields", label: "Description" }],
                    occurrenceCount: 1,
                    status: "localized",
                    localizedEntry: {
                        normalizedUrl: "https://cdn.example.com/lb.png",
                        rawUrls: ["https://cdn.example.com/lb.png"],
                        imageId: "img-lb",
                        localUrl: "/api/v1/images/img-lb",
                        filename: "lb.png",
                        mimeType: "image/png",
                        sizeBytes: 1024,
                        localizedAt: 1000,
                        characterIds: ["c-lb"],
                        galleryItemIds: {},
                    },
                },
            ],
        });
        const lbWidget = new CharacterMediaWidget(
            wRoot,
            { ui: { showConfirm: async () => ({ confirmed: true }) } } as unknown as SpindleFrontendContext,
            "c-lb",
            { ...DEFAULT_SETTINGS },
            makeIdleQueue(),
            {
                onScanCharacter: async () => {
                    scanCalls++;
                    return new Promise<CharacterMediaScanResult>((resolve) => {
                        resolveScanAfterRemove = resolve;
                    });
                },
                onStartDownload: async () => {},
                onSaveCharacterOverride: async () => null,
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
                onPurgeCharacterCache: async () => {},
            },
            { initialScan: localizedScan },
        );
        lbWidget.render();
        const thumbWrap = wRoot.querySelector(".ml-asset-thumb-wrap") as HTMLElement;
        thumbWrap.click();
        const removeBtn = Array.from(domEnv.document.body.querySelectorAll("button")).find((b: any) =>
            b.textContent?.includes("Remove"),
        ) as any;
        expect(removeBtn).toBeDefined();
        removeBtn.click();
        await new Promise((r) => setTimeout(r, 15));
        // Lightbox closed without waiting for onScanCharacter to resolve
        expect(domEnv.document.body.querySelector(".ml-lightbox-backdrop")).toBeNull();
        expect(scanCalls).toBe(1);
        resolveScanAfterRemove(makeScan("c-lb", { items: [] }));
        await new Promise((r) => setTimeout(r, 10));
        lbWidget.destroy();

        // LibraryGalleryView drilldown auto-exit when active character disappears restores page & scroll
        let galleryChars = Array.from({ length: 30 }, (_, idx) => ({
            characterId: `c-page-${idx}`,
            characterName: `Char ${String(idx).padStart(2, "0")}`,
            tags: [],
            avatarImageId: null,
            avatarUrl: null,
            localizedAssets: [
                {
                    normalizedUrl: `https://cdn.example.com/p-${idx}.png`,
                    rawUrls: [`https://cdn.example.com/p-${idx}.png`],
                    imageId: `img-p-${idx}`,
                    localUrl: `/api/v1/images/img-p-${idx}`,
                    mediaKind: "image" as const,
                    filename: `p-${idx}.png`,
                    mimeType: "image/png",
                    sizeBytes: 1024,
                    localizedAt: 1000 + idx,
                    characterIds: [`c-page-${idx}`],
                    galleryItemIds: {},
                },
            ],
            expressions: [],
            totalSizeBytes: 1024,
            lastLocalizedAt: 1000 + idx,
        }));
        let currentScroll = 310;
        let restoredScroll = -1;
        const gRoot = domEnv.document.createElement("div") as any;
        domEnv.document.body.appendChild(gRoot);
        const galleryView = new LibraryGalleryView(
            gRoot,
            {
                onLoadLibraryMedia: async () => galleryChars,
                onPurgeAsset: async () => {},
                onGetScrollTop: () => currentScroll,
                onSetScrollTop: (top) => {
                    restoredScroll = top;
                },
            },
            { state: { grouped: true, sortMode: "name", sortDirection: "asc", pageSize: 24, currentPage: 2 } },
        );
        await galleryView.refresh(false);
        expect(galleryView.getState().currentPage).toBe(2);
        const page2Card = gRoot.querySelector(".ml-char-card") as HTMLElement;
        page2Card.click();
        const drilledCharId = galleryView.getState().activeCharacterId;
        expect(drilledCharId).not.toBeNull();

        // Disappear the drilled-in character while preserving active state on refresh
        galleryChars = galleryChars.filter((c) => c.characterId !== drilledCharId);
        await galleryView.refresh(true);
        expect(galleryView.getState().activeCharacterId).toBeNull();
        expect(galleryView.getState().currentPage).toBe(2);
        expect(restoredScroll).toBe(310);

        galleryView.destroy();
    });
});
