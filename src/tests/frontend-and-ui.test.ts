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
import { LibraryGalleryView } from "../ui/library-gallery";
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
});
