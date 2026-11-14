import { describe, expect, test } from "bun:test";
import {
    decodeHtmlEntities,
    deriveUrlFilenameParts,
    extractCharacterExpressions,
    extractChubExpressionUrlMapFromExtensions,
    extractMediaTokensFromText,
    extractNativeGalleryUrlsFromCharacter,
    filterScanItemsForDownload,
    isBlockedRemoteHostname,
    isSafeRemoteMediaUrl,
    normalizeRemoteMediaUrl,
    scanCharacterMedia,
} from "../shared/url-scanner";
import {
    buildEffectiveFilter,
    isOverrideEmpty,
    sanitizeOverride,
} from "../shared/download-config";
import { buildLibraryMedia } from "../shared/library-media";
import {
    DEFAULT_SETTINGS,
    type CharacterMediaScanResult,
    type FailedUrlRecord,
    type LocalizedAssetEntry,
    type QueueJobProgress,
    type SectionCountSummary,
} from "../shared/types";
import { installMockDom, MockEvent, MockKeyboardEvent } from "./helpers/mock-dom";
import {
    CHARACTER_PREFS_STORAGE_KEY,
    cleanupUiHelpers,
    createInfoTip,
    createLazyMediaElement,
    GALLERY_PREFS_STORAGE_KEY,
    loadPrefsFromStorage,
    openMediaLightbox,
    reobserveLazyMedia,
    sanitizeSafeMediaUrl,
    savePrefsToStorage,
} from "../ui/ui-helpers";
import { MEDIA_LOCALIZER_STYLES } from "../ui/styles";
import { NonDestructiveDisplaySwapper } from "../ui/display-swapper";
import { NativeGalleryTabIntegrator } from "../ui/gallery-integrator";
import { PortraitPanelLocalizeController } from "../ui/portrait-button";
import { setup } from "../frontend";

describe("shared/url-scanner SSRF & URL safety", () => {
    test("isBlockedRemoteHostname blocks loopback, private, link-local, CGNAT, special IPv4 and alternate encodings", () => {
        const blocked = [
            "localhost",
            "sub.localhost",
            "printer.local",
            "service.internal",
            "box.localdomain",
            "nas.home.arpa",
            "host.arpa",
            "metadata.google.internal",
            "metadata.goog",
            "redis",
            "metadata",
            "0.0.0.0",
            "0.1.2.3",
            "10.0.0.1",
            "10.255.255.254",
            "100.64.0.1",
            "100.127.255.254",
            "127.0.0.1",
            "127.0.1.1",
            "169.254.169.254",
            "172.16.0.1",
            "172.31.255.254",
            "192.0.0.1",
            "192.0.2.1",
            "192.88.99.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.19.255.254",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "0x7f000001",
            "0177.0.0.1",
            "2130706433",
            "127.1",
        ];

        for (const host of blocked) {
            expect(isBlockedRemoteHostname(host)).toBe(true);
        }

        const allowed = [
            "cdn.example.com",
            "8.8.8.8",
            "1.1.1.1",
            "172.15.255.254",
            "172.32.0.1",
            "100.63.255.254",
            "100.128.0.1",
            "192.167.1.1",
            "198.20.0.1",
        ];

        for (const host of allowed) {
            expect(isBlockedRemoteHostname(host)).toBe(false);
        }
    });

    test("isBlockedRemoteHostname blocks loopback, ULA, link-local, mapped IPv4, NAT64, 6to4, and malformed IPv6", () => {
        const blockedV6 = [
            "::",
            "[::]",
            "::1",
            "[::1]",
            "::127.0.0.1",
            "::ffff:127.0.0.1",
            "[::ffff:7f00:1]",
            "::ffff:0:10.0.0.1",
            "64:ff9b::10.0.0.1",
            "64:ff9b:1::1",
            "100::1",
            "2001::1",
            "2001:db8::1",
            "2002:7f00:0001::1",
            "2002:0a00:0001::1",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "fe80::1%eth0",
            "fec0::1",
            "ff02::1",
            "[2001:::1]",
        ];

        for (const host of blockedV6) {
            expect(isBlockedRemoteHostname(host)).toBe(true);
        }

        expect(isBlockedRemoteHostname("2606:4700:4700::1111")).toBe(false);
        expect(isBlockedRemoteHostname("[2606:4700:4700::1111]")).toBe(false);
    });

    test("isSafeRemoteMediaUrl rejects non-HTTP schemes, userinfo, and SSRF URLs while accepting public URLs", () => {
        expect(isSafeRemoteMediaUrl("https://cdn.example.com/a.png")).toBe(true);
        expect(isSafeRemoteMediaUrl("http://cdn.example.com/a.png")).toBe(true);
        expect(isSafeRemoteMediaUrl("https://[2606:4700:4700::1111]/img.webp")).toBe(true);

        expect(isSafeRemoteMediaUrl("file:///etc/passwd")).toBe(false);
        expect(isSafeRemoteMediaUrl("ftp://cdn.example.com/a.png")).toBe(false);
        expect(isSafeRemoteMediaUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeRemoteMediaUrl("data:image/png;base64,AAAA")).toBe(false);
        expect(isSafeRemoteMediaUrl("https://user:pass@cdn.example.com/a.png")).toBe(false);
        expect(isSafeRemoteMediaUrl("https://user@cdn.example.com/a.png")).toBe(false);
        expect(isSafeRemoteMediaUrl("http://127.0.0.1/a.png")).toBe(false);
        expect(isSafeRemoteMediaUrl("http://0x7f000001/a.png")).toBe(false);
        expect(isSafeRemoteMediaUrl("http://[::ffff:169.254.169.254]/latest")).toBe(false);
        expect(isSafeRemoteMediaUrl("https://internal/a.png")).toBe(false);
    });
});

describe("shared/url-scanner bounded ReDoS safety & token extraction", () => {
    test("handles pathological Markdown/HTML/CSS inputs in linear bounded time (< 80ms)", () => {
        const unclosedMd = "![".repeat(25_000) + "unclosed_alt";
        const deepBrackets = "![" + "[".repeat(120) + "text" + "]".repeat(120) + "(https://cdn.example.com/ok.png)";
        const giantHtml = `<img alt="${"a".repeat(30_000)} src="https://cdn.example.com/x.png">`;
        const giantCss = `background: url(${"x".repeat(30_000)}`;

        const start = performance.now();
        expect(Array.isArray(extractMediaTokensFromText(unclosedMd))).toBe(true);
        expect(Array.isArray(extractMediaTokensFromText(deepBrackets))).toBe(true);
        expect(Array.isArray(extractMediaTokensFromText(giantHtml))).toBe(true);
        expect(Array.isArray(extractMediaTokensFromText(giantCss))).toBe(true);
        const elapsedMs = performance.now() - start;

        expect(elapsedMs).toBeLessThan(80);
    });

    test("extracts span-deduplicated tokens for occurrence counting, #fragment stripping, multi-word/collapsed ref Markdown, quote-aware HTML, <source srcset>, and .m4v/.ogv", () => {
        const text = [
            "![Banner](https://cdn.example.com/shared.png#top)",
            "And again bare: https://cdn.example.com/shared.png#bottom",
            "![My   Cool Banner][My   Ref]",
            "![Collapsed Label][]",
            '<img alt="a > b" src="https://cdn.example.com/quoted.webp">',
            '<picture><source srcset="https://cdn.example.com/1x.avif 1x, https://cdn.example.com/2x.webp 2x"></picture>',
            '<video><source type="video/mp4" srcset="https://cdn.example.com/clip.bin 1x"></video>',
            "Bare m4v: https://cdn.example.com/movie.m4v and ogv: https://cdn.example.com/clip.ogv",
            "Query decoy: https://cdn.example.com/page.html?preview=fake.png",
            "Valid with query: https://cdn.example.com/photo.png?download=archive.zip",
            "",
            "[my ref]: https://cdn.example.com/ref-target.png",
            "[collapsed label]: https://cdn.example.com/collapsed-target.jpg",
        ].join("\n");

        const tokens = extractMediaTokensFromText(text, { scanBareUrls: true });
        const urls = tokens.map((t) => t.normalizedUrl);

        // Span-based: markdown + bare occurrence of shared.png produce two separate tokens
        const sharedOccurrences = tokens.filter((t) => t.normalizedUrl === "https://cdn.example.com/shared.png");
        expect(sharedOccurrences.length).toBe(2);

        expect(urls).toContain("https://cdn.example.com/ref-target.png");
        expect(urls).toContain("https://cdn.example.com/collapsed-target.jpg");
        expect(urls).toContain("https://cdn.example.com/quoted.webp");
        expect(urls).toContain("https://cdn.example.com/1x.avif");
        expect(urls).toContain("https://cdn.example.com/2x.webp");

        const videoSource = tokens.find((t) => t.normalizedUrl === "https://cdn.example.com/clip.bin");
        expect(videoSource?.mediaKind).toBe("video");

        const m4vToken = tokens.find((t) => t.normalizedUrl === "https://cdn.example.com/movie.m4v");
        const ogvToken = tokens.find((t) => t.normalizedUrl === "https://cdn.example.com/clip.ogv");
        expect(m4vToken?.mediaKind).toBe("video");
        expect(ogvToken?.mediaKind).toBe("video");

        // Pathname-only extension matching
        expect(urls).not.toContain("https://cdn.example.com/page.html?preview=fake.png");
        expect(urls).toContain("https://cdn.example.com/photo.png?download=archive.zip");
    });

    test("scanBareUrls: false omits bare URLs and non-matching HTML attrs while preserving Markdown/HTML/CSS tokens", () => {
        const text = [
            "![](https://cdn.example.com/md.png)",
            "https://cdn.example.com/bare.png",
            `<img alt="x > y" foo-src="https://cdn.example.com/ignored-attr.png" src="https://cdn.example.com/real-attr.png">`,
            `<div style="background-image: url('https://cdn.example.com/css.jpg')"></div>`,
        ].join("\n");

        const tokens = extractMediaTokensFromText(text, { scanBareUrls: false });
        const urls = tokens.map((t) => t.normalizedUrl);
        expect(urls).toContain("https://cdn.example.com/md.png");
        expect(urls).toContain("https://cdn.example.com/real-attr.png");
        expect(urls).toContain("https://cdn.example.com/css.jpg");
        expect(urls).not.toContain("https://cdn.example.com/ignored-attr.png");
        expect(urls).not.toContain("https://cdn.example.com/bare.png");
    });

    test("decodeHtmlEntities, normalizeRemoteMediaUrl (#fragment stripping), and deriveUrlFilenameParts (.ogv)", () => {
        expect(decodeHtmlEntities("a=1&amp;b=2&#38;c=3&#x26;d=4&quot;x&#39;&apos;")).toBe(`a=1&b=2&c=3&d=4"x''`);

        const normalized = normalizeRemoteMediaUrl("https://cdn.example.com/img.png?a=1&amp;b=2#frag", "img");
        expect(normalized?.normalizedUrl).toBe("https://cdn.example.com/img.png?a=1&b=2");

        const parts = deriveUrlFilenameParts("https://cdn.example.com/videos/scene.ogv?v=2");
        expect(parts.ext).toBe("ogv");

        const queryFormatParts = deriveUrlFilenameParts("https://cdn.example.com/media?format=ogv");
        expect(queryFormatParts.ext).toBe("ogv");
        expect(queryFormatParts.basename).toBe("media.ogv");
    });
});

describe("shared/url-scanner character scanning, native gallery safety, & filtering", () => {
    test("extractNativeGalleryUrlsFromCharacter excludes SSRF/userinfo URLs without fallback", () => {
        const urls = extractNativeGalleryUrlsFromCharacter({
            id: "char-1",
            name: "Tester",
            extensions: {
                lumiverse: {
                    gallery: [
                        { id: "g1", url: "https://cdn.example.com/safe.png", title: "Safe" },
                        { id: "g2", url: "http://127.0.0.1/private.png", title: "Loopback" },
                        { id: "g3", url: "https://user:pass@cdn.example.com/auth.png", title: "Creds" },
                        { id: "g4", url: "file:///etc/passwd", title: "Local" },
                    ],
                },
            },
        });

        expect(urls).toEqual(["https://cdn.example.com/safe.png"]);
    });

    test("extractChubExpressionUrlMapFromExtensions & extractCharacterExpressions extract safe labeled expressions", () => {
        const chubMap = extractChubExpressionUrlMapFromExtensions({
            chub: {
                expressions: {
                    happy: "https://cdn.example.com/happy.png#frag",
                    bad: "http://169.254.169.254/secret.png",
                },
            },
        });

        expect(chubMap.get("happy")?.normalizedUrl).toBe("https://cdn.example.com/happy.png");
        expect(chubMap.has("bad")).toBe(false);

        const exprs = extractCharacterExpressions({
            expressions: {
                mappings: {
                    joy: "img-joy-1",
                    anger: "img-anger-1",
                },
            },
            expression_groups: {
                Outfits: {
                    casual: "img-casual-1",
                },
            },
        });

        expect(exprs.some((e) => e.label === "joy" && e.imageId === "img-joy-1")).toBe(true);
        expect(exprs.some((e) => e.label === "casual" && e.groupName === "Outfits")).toBe(true);
    });

    test("scanCharacterMedia tracks failedCount across sectionCounts, greetingBreakdown, worldBookBreakdown, domainBreakdown", () => {
        const failed = new Map<string, FailedUrlRecord>([
            [
                "https://fail.example.com/a.png",
                {
                    error: "HTTP 404",
                    lastAttemptAt: 1000,
                },
            ],
            [
                "https://fail.example.com/wb.png",
                {
                    error: "Timeout",
                    lastAttemptAt: 1000,
                },
            ],
        ]);

        const scan = scanCharacterMedia(
            {
                id: "c1",
                name: "Alice",
                description:
                    "![ok](https://ok.example.com/pic.png) https://ok.example.com/pic.png ![fail](https://fail.example.com/a.png)",
                first_mes: "Greeting fail ![](https://fail.example.com/a.png)",
                alternate_greetings: ["Alt greeting fail ![](https://fail.example.com/a.png)"],
            },
            [
                {
                    id: "wb-1",
                    name: "Lore",
                    entries: [{ id: "e1", content: "![wb](https://fail.example.com/wb.png)" }],
                },
            ],
            [],
            {
                localizedByNormalizedUrl: new Map(),
                failedByNormalizedUrl: failed,
                scanBareUrls: true,
            },
        );

        const pic = scan.items.find((i) => i.normalizedUrl === "https://ok.example.com/pic.png");
        expect(pic?.occurrenceCount).toBe(2);

        expect(scan.sectionCounts.first_mes.failedCount).toBe(1);
        expect(scan.sectionCounts.core_fields.failedCount).toBe(1);
        expect(scan.sectionCounts.world_books.failedCount).toBe(1);

        const g1 = scan.greetingBreakdown.find((g) => g.greetingIndex === 1) ?? scan.greetingBreakdown[0];
        expect(g1?.failedCount).toBe(1);

        const wb1 = scan.worldBookBreakdown.find((w) => w.worldBookId === "wb-1");
        expect(wb1?.failedCount).toBe(1);

        const failDomain = scan.domainBreakdown.find((d) => d.domain === "fail.example.com");
        expect(failDomain?.failedCount).toBe(2);
    });

    test("filterScanItemsForDownload normalizes explicitUrls/excludedUrls, trims domains, and filters worldBookIds", () => {
        const scan = scanCharacterMedia(
            {
                id: "c2",
                name: "Bob",
                description: "![](https://CDN.Example.COM/keep.png#v1) ![](https://cdn.example.com/skip.png)",
            },
            [
                { id: "wb-a", name: "A", entries: [{ id: "1", content: "![](https://cdn.example.com/wba.png)" }] },
                { id: "wb-b", name: "B", entries: [{ id: "2", content: "![](https://cdn.example.com/wbb.png)" }] },
            ],
            [],
            {
                localizedByNormalizedUrl: new Map(),
                failedByNormalizedUrl: new Map(),
                scanBareUrls: true,
            },
        );

        const filteredByExplicitAndExclude = filterScanItemsForDownload(scan, {
            explicitUrls: ["https://cdn.example.com/keep.png#other", "https://cdn.example.com/skip.png"],
            excludedUrls: ["https://cdn.example.com/skip.png#frag"],
            domains: ["  cdn.example.com  "],
        });
        expect(filteredByExplicitAndExclude.map((i) => i.normalizedUrl)).toEqual(["https://cdn.example.com/keep.png"]);

        const filteredByWb = filterScanItemsForDownload(scan, {
            sections: ["world_books"],
            worldBookIds: ["wb-b"],
        });
        expect(filteredByWb.map((i) => i.normalizedUrl)).toEqual(["https://cdn.example.com/wbb.png"]);
    });
});

describe("shared/download-config & shared/library-media", () => {
    test("sanitizeOverride omits empty arrays while preserving maxItems: 0, and isOverrideEmpty reflects true state", () => {
        const emptied = sanitizeOverride({
            sections: [],
            domains: ["   "],
            greetingIndices: [],
            worldBookIds: [],
            excludedUrls: ["   "],
        });
        expect(emptied).toEqual({});
        expect(isOverrideEmpty(emptied)).toBe(true);
        expect(isOverrideEmpty({ sections: [], domains: [] })).toBe(true);

        const withZeroCap = sanitizeOverride({
            sections: [],
            maxItems: 0,
        });
        expect(withZeroCap.maxItems).toBe(0);
        expect(isOverrideEmpty(withZeroCap)).toBe(false);
    });

    test("buildEffectiveFilter clamps maxFileSizeBytes, timeoutMs, and concurrency", () => {
        const clampedLow = buildEffectiveFilter({
            ...DEFAULT_SETTINGS,
            maxFileSizeMb: 0,
            timeoutSeconds: 1,
            concurrency: 0,
        });
        expect(clampedLow.maxFileSizeBytes).toBe(1 * 1024 * 1024);
        expect(clampedLow.timeoutMs).toBe(5 * 1000);
        expect(clampedLow.concurrency).toBe(1);

        const clampedHigh = buildEffectiveFilter(
            {
                ...DEFAULT_SETTINGS,
                maxFileSizeMb: 9999,
                timeoutSeconds: 9999,
                concurrency: 99,
            },
            undefined,
            { maxItems: 0 },
        );
        expect(clampedHigh.maxFileSizeBytes).toBe(200 * 1024 * 1024);
        expect(clampedHigh.timeoutMs).toBe(120 * 1000);
        expect(clampedHigh.concurrency).toBe(5);
        expect(clampedHigh.maxItems).toBe(0);
    });

    test("buildLibraryMedia deduplicates duplicate characterIds and shared imageIds in byte/asset totals", () => {
        const assets: Record<string, LocalizedAssetEntry> = {
            "https://cdn.example.com/one.png": {
                normalizedUrl: "https://cdn.example.com/one.png",
                rawUrls: ["https://cdn.example.com/one.png"],
                imageId: "img-shared",
                localUrl: "/images/img-shared.png",
                mimeType: "image/png",
                sizeBytes: 1024,
                filename: "one.png",
                characterIds: ["char-1", "char-1"],
                localizedAt: 200,
            },
            "https://mirror.example.com/one-copy.png": {
                normalizedUrl: "https://mirror.example.com/one-copy.png",
                rawUrls: ["https://mirror.example.com/one-copy.png"],
                imageId: "img-shared",
                localUrl: "/images/img-shared.png",
                mimeType: "image/png",
                sizeBytes: 1024,
                filename: "one-copy.png",
                characterIds: ["char-1"],
                localizedAt: 500,
            },
        };

        const library = buildLibraryMedia(
            [{ id: "char-1", name: "Alice" }],
            assets,
        );

        expect(library.length).toBe(1);
        const entry = library[0]!;
        expect(entry.localizedAssets.length).toBe(1);
        expect(entry.totalSizeBytes).toBe(1024);
        expect(entry.lastLocalizedAt).toBe(500);
    });

    test("handles missing filename and non-finite sizeBytes/localizedAt gracefully", () => {
        const assets: Record<string, LocalizedAssetEntry> = {
            "https://example.com/b.png": {
                normalizedUrl: "https://example.com/b.png",
                rawUrls: ["https://example.com/b.png"],
                imageId: "img-2",
                localUrl: "/api/v1/images/img-2",
                filename: undefined as unknown as string,
                mimeType: "image/png",
                sizeBytes: Number.NaN,
                localizedAt: -5,
                characterIds: ["char-1"],
            },
            "https://example.com/a.png": {
                normalizedUrl: "https://example.com/a.png",
                rawUrls: ["https://example.com/a.png"],
                imageId: "img-1",
                localUrl: "/api/v1/images/img-1",
                filename: "a.png",
                mimeType: "image/png",
                sizeBytes: 256,
                localizedAt: 900,
                characterIds: ["char-1"],
            },
        };

        const library = buildLibraryMedia([{ id: "char-1", name: "Alice" }], assets);
        expect(library.length).toBe(1);
        const entry = library[0]!;
        expect(entry.totalSizeBytes).toBe(256);
        expect(entry.lastLocalizedAt).toBe(900);
        expect(entry.localizedAssets.map((a) => a.imageId)).toEqual(["img-1", "img-2"]);
    });
});

function makeEmptySectionCounts(): Record<
    "creator_notes" | "first_mes" | "core_fields" | "alternate_greetings" | "world_books" | "regex_scripts",
    SectionCountSummary
> {
    return {
        creator_notes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
        first_mes: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
        core_fields: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
        alternate_greetings: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
        world_books: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
        regex_scripts: { totalUnique: 0, remoteCount: 0, localizedCount: 0, failedCount: 0 },
    };
}

function makeIdleQueueProgress(): QueueJobProgress {
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

function makeScanResult(
    characterId: string,
    totalOccurrences = 0,
): CharacterMediaScanResult {
    const counts = makeEmptySectionCounts();
    counts.creator_notes.totalUnique = totalOccurrences;
    counts.creator_notes.remoteCount = totalOccurrences;
    const items = Array.from({ length: totalOccurrences }, (_, i) => ({
        normalizedUrl: `https://cdn.example.com/${characterId}/pic-${i}.png`,
        rawUrls: [`https://cdn.example.com/${characterId}/pic-${i}.png`],
        domain: "cdn.example.com",
        mediaKind: "image" as const,
        sources: [{ section: "creator_notes" as const, label: "Creator Notes" }],
        occurrenceCount: 1,
        status: "remote" as const,
    }));
    return {
        characterId,
        characterName: `Char ${characterId}`,
        scannedAt: 1,
        totalOccurrences,
        sectionCounts: counts,
        greetingBreakdown: [],
        worldBookBreakdown: [],
        domainBreakdown: [],
        override: null,
        items,
    };
}

describe("shared/download-config sanitization & bounds", () => {
    test("isOverrideEmpty sanitizes invalid entries and sanitizeOverride/buildEffectiveFilter bound maxItems", () => {
        expect(
            isOverrideEmpty({
                sections: ["not_a_real_section" as any],
                mediaKinds: [],
                domains: ["   ", ""],
                excludedUrls: ["  "],
            }),
        ).toBe(true);

        const sanitized = sanitizeOverride({ maxItems: 999_999 });
        expect(sanitized.maxItems).toBe(2000);

        const effective = buildEffectiveFilter(
            { ...DEFAULT_SETTINGS, defaultBatchCap: 50_000 },
            makeScanResult("c1", 0),
            null,
        );
        expect(effective.maxItems).toBe(2000);
    });
});

describe("ui/ui-helpers safety, lightbox async remove & thumb observer pruning", () => {
    test("sanitizeSafeMediaUrl blocks CSS breakouts while allowing safe http(s) parentheses", () => {
        expect(sanitizeSafeMediaUrl('/api/v1/images/a"b.png')).toBeNull();
        expect(sanitizeSafeMediaUrl("/api/v1/images/a)b.png")).toBeNull();
        expect(sanitizeSafeMediaUrl("/api/v1/images/a\\b.png")).toBeNull();
        expect(sanitizeSafeMediaUrl('https://example.com/a"b.png')).toBeNull();
        expect(sanitizeSafeMediaUrl("https://example.com/a'b.png")).toBeNull();
        expect(sanitizeSafeMediaUrl("https://example.com/a`b.png")).toBeNull();
        expect(sanitizeSafeMediaUrl("https://example.com/char_(v2).webp")).toBe(
            "https://example.com/char_(v2).webp",
        );
    });

    test("openMediaLightbox tracks item identity across async onRemove and handles rejection & missing body", async () => {
        const domEnv = installMockDom();
        try {
            const origBody = domEnv.document.body;
            (domEnv.document as any).body = null;
            // Should not throw if document.body is missing
            openMediaLightbox(
                [{ id: "x", localUrl: "/api/v1/images/x", mediaKind: "image", title: "X" }],
                0,
            );
            (domEnv.document as any).body = origBody;

            let resolveRemove!: () => void;
            const removedIds: string[] = [];
            let afterRemoveCalls = 0;

            openMediaLightbox(
                [
                    {
                        id: "item-1",
                        localUrl: "/api/v1/images/1",
                        mediaKind: "image",
                        title: "One",
                        onRemove: async () => {
                            removedIds.push("item-1");
                            await new Promise<void>((r) => {
                                resolveRemove = r;
                            });
                        },
                    },
                    {
                        id: "item-2",
                        localUrl: "/api/v1/images/2",
                        mediaKind: "image",
                        title: "Two",
                        onRemove: async () => {
                            throw new Error("boom");
                        },
                    },
                ],
                0,
                () => {
                    afterRemoveCalls++;
                },
            );

            const removeBtn = domEnv.document.querySelector(
                'button[title*="Remove this localized asset"]',
            ) as any;
            const nextBtn = domEnv.document.querySelector('button[title="Next (Right Arrow)"]') as any;
            expect(removeBtn).not.toBeNull();
            expect(nextBtn).not.toBeNull();

            // Click remove on item-1, then step to item-2 while async remove is pending
            removeBtn.click();
            expect(removedIds).toEqual(["item-1"]);
            nextBtn.click();
            expect(domEnv.document.body.textContent).toContain("Two");

            resolveRemove();
            await new Promise((r) => setTimeout(r, 15));

            // item-1 was removed by identity, item-2 remains active, onAfterRemove fired once
            expect(afterRemoveCalls).toBe(1);
            expect(domEnv.document.body.textContent).toContain("Two");
            expect(domEnv.document.body.textContent).toContain("1 / 1");

            // Clicking remove on item-2 when onRemove rejects leaves item-2 intact cleanly
            const removeBtn2 = domEnv.document.querySelector(
                'button[title*="Remove this localized asset"]',
            ) as any;
            removeBtn2.click();
            await new Promise((r) => setTimeout(r, 15));
            expect(domEnv.document.body.textContent).toContain("Two");
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });

    test("sharedThumbObserver unobserves detached thumbnail elements", async () => {
        const domEnv = installMockDom();
        try {
            const attached = createLazyMediaElement({
                src: "/api/v1/images/a.png",
                alt: "A",
                mediaKind: "image",
                className: "ml-thumb",
            });
            const detached = createLazyMediaElement({
                src: "/api/v1/images/b.png",
                alt: "B",
                mediaKind: "image",
                className: "ml-thumb",
            });
            domEnv.document.body.appendChild(attached as any);
            domEnv.document.body.appendChild(detached as any);

            const observers = (globalThis as any).IntersectionObserver.instances as Array<{
                observedTargets: Set<any>;
                trigger: (entries: Array<{ target: any; isIntersecting: boolean }>) => void;
            }>;
            expect(observers.length).toBe(1);
            const obs = observers[0]!;
            expect(obs.observedTargets.has(detached)).toBe(true);

            detached.remove();
            // Triggering callback or waiting for scheduled prune cleans detached target
            obs.trigger([{ target: detached, isIntersecting: false }]);
            expect(obs.observedTargets.has(detached)).toBe(false);
            expect(obs.observedTargets.has(attached)).toBe(true);
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });
});

describe("ui/display-swapper CSS escaping, monotonic map & element selectors", () => {
    test("enforces monotonic updatedAt, hardens CSS urls, handles audio/video/source, skips ML styles, and rewrites CDN srcset", () => {
        const domEnv = installMockDom();
        try {
            const ctx = { getActiveChat: () => ({ characterId: "char-1" }) } as any;
            const swapper = new NonDestructiveDisplaySwapper(ctx);
            swapper.start();

            swapper.updateMap({
                characterUrlMaps: {
                    "char-1": {
                        "https://cdn.example.com/bg.png": "/api/v1/images/bg",
                        "https://cdn.example.com/unsafe.png": '/api/v1/images/bad"quote',
                        "https://cdn.example.com/song.mp3": "/api/v1/audio/song",
                        "https://cdn.example.com/vid.mp4": "/api/v1/video/vid",
                        "https://cdn.example.com/src.webm": "/api/v1/video/src",
                        "https://cdn.example.com/cdn-cgi/image/w_800,f_auto/pic.png":
                            "/api/v1/images/pic-800",
                    },
                },
                allUrlsMap: {},
                updatedAt: 100,
            });

            // Stale updateMap (lower updatedAt) must be ignored
            swapper.updateMap({
                characterUrlMaps: { "char-1": {} },
                allUrlsMap: {},
                updatedAt: 50,
            });

            const divUpper = domEnv.document.createElement("div");
            divUpper.setAttribute("style", 'background-image: URL("https://cdn.example.com/bg.png")');
            const divUnsafe = domEnv.document.createElement("div");
            divUnsafe.setAttribute("style", 'background-image: url("https://cdn.example.com/unsafe.png")');

            const audio = domEnv.document.createElement("audio");
            audio.setAttribute("src", "https://cdn.example.com/song.mp3");
            const video = domEnv.document.createElement("video");
            video.setAttribute("data-src", "https://cdn.example.com/vid.mp4");
            const source = domEnv.document.createElement("source");
            source.setAttribute("data-src", "https://cdn.example.com/src.webm");
            video.appendChild(source);

            const imgSrcset = domEnv.document.createElement("img");
            imgSrcset.setAttribute(
                "srcset",
                "https://cdn.example.com/cdn-cgi/image/w_800,f_auto/pic.png 800w",
            );

            const mlHost = domEnv.document.createElement("div");
            mlHost.className = "ml-drawer-root";
            const mlStyle = domEnv.document.createElement("style");
            mlStyle.textContent = `.x { background: url("https://cdn.example.com/bg.png"); }`;
            mlHost.appendChild(mlStyle);

            const extStyle = domEnv.document.createElement("style");
            extStyle.textContent = `.y { background: URL("https://cdn.example.com/bg.png"); }`;

            domEnv.document.body.append(
                divUpper,
                divUnsafe,
                audio,
                video,
                imgSrcset,
                mlHost,
                extStyle,
            );

            // Trigger pass via updateMap with newer updatedAt
            swapper.updateMap({
                characterUrlMaps: {
                    "char-1": {
                        "https://cdn.example.com/bg.png": "/api/v1/images/bg",
                        "https://cdn.example.com/unsafe.png": '/api/v1/images/bad"quote',
                        "https://cdn.example.com/song.mp3": "/api/v1/audio/song",
                        "https://cdn.example.com/vid.mp4": "/api/v1/video/vid",
                        "https://cdn.example.com/src.webm": "/api/v1/video/src",
                        "https://cdn.example.com/cdn-cgi/image/w_800,f_auto/pic.png":
                            "/api/v1/images/pic-800",
                    },
                },
                allUrlsMap: {},
                updatedAt: 101,
            });

            expect(divUpper.getAttribute("style")).toContain('url("/api/v1/images/bg")');
            expect(divUnsafe.getAttribute("style")).toContain("https://cdn.example.com/unsafe.png");
            expect(audio.getAttribute("src")).toBe("/api/v1/audio/song");
            expect(video.getAttribute("data-src")).toBe("/api/v1/video/vid");
            expect(source.getAttribute("data-src")).toBe("/api/v1/video/src");
            expect(imgSrcset.getAttribute("srcset")).toBe("/api/v1/images/pic-800 800w");
            expect(mlStyle.textContent).toContain("https://cdn.example.com/bg.png");
            expect(extStyle.textContent).toContain('url("/api/v1/images/bg")');

            swapper.stop();
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });
});

describe("ui/gallery-integrator & portrait-button lifecycle guards", () => {
    test("gallery-integrator flushes pending override save before destroy on stop and respects stopped guard", async () => {
        const domEnv = installMockDom();
        try {
            let editorListener: ((state: any) => void) | null = null;
            let savedCalls = 0;

            const tabPanel = domEnv.document.createElement("div");
            tabPanel.className = "galleryTab";
            const grid = domEnv.document.createElement("div");
            grid.className = "gallery-grid";
            tabPanel.appendChild(grid);
            domEnv.document.body.appendChild(tabPanel);

            const ctx = {
                ui: {
                    characterEditor: {
                        getState: () => ({
                            open: true,
                            characterId: "char-1",
                            activeTabId: "gallery",
                            extensions: {},
                        }),
                        onChange: (fn: (s: any) => void) => {
                            editorListener = fn;
                            return () => {};
                        },
                    },
                },
            } as any;

            const queueProgress = makeIdleQueueProgress();

            const integrator = new NativeGalleryTabIntegrator(ctx, DEFAULT_SETTINGS, queueProgress, {
                onScanCharacter: async () => makeScanResult("char-1", 1),
                onSaveCharacterOverride: async (_charId, override) => {
                    savedCalls++;
                    return override;
                },
                onStartDownload: async () => {},
                onPurgeCharacterCache: async () => {},
                onClearFailedUrls: async () => {},
                onQueueControl: async () => {},
            });

            integrator.start();
            await new Promise((r) => setTimeout(r, 10));

            const host = domEnv.document.querySelector(".ml-gallery-host");
            expect(host).not.toBeNull();
            const gearBtn = host!.querySelector('button[title*="Customize per-card"]') as any;
            gearBtn?.click();
            const firstCb = host!.querySelector('.ml-options-panel input[type="checkbox"]') as any;
            expect(firstCb).not.toBeNull();
            firstCb.checked = false;
            firstCb.dispatchEvent(new MockEvent("change", { bubbles: true }));

            integrator.stop();
            await new Promise((r) => setTimeout(r, 10));
            expect(savedCalls).toBe(1);
            expect(domEnv.document.querySelector(".ml-gallery-host")).toBeNull();

            // Stopped guard prevents re-mounting on late editor state events
            (editorListener as ((s: any) => void) | null)?.({
                open: true,
                characterId: "char-1",
                activeTabId: "gallery",
                extensions: {},
            });
            expect(domEnv.document.querySelector(".ml-gallery-host")).toBeNull();
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });

    test("portrait-button ignores unrelated DOM mutations when closed and resets longPressTriggered on pointerleave", async () => {
        const domEnv = installMockDom();
        try {
            let openTabCalls = 0;
            let localizeCalls = 0;

            const outer = domEnv.document.createElement("div");
            outer.className = "panelOuter";
            const panel = domEnv.document.createElement("div");
            panel.className = "panel";
            const header = domEnv.document.createElement("div");
            header.className = "header";
            const nameWrap = domEnv.document.createElement("div");
            const nameEl = domEnv.document.createElement("div");
            nameEl.className = "charName";
            nameEl.textContent = "Alice";
            nameWrap.appendChild(nameEl);
            header.appendChild(nameWrap);
            panel.appendChild(header);
            outer.appendChild(panel);
            domEnv.document.body.appendChild(outer);

            const controller = new PortraitPanelLocalizeController({
                getActiveCharacterId: () => "char-1",
                getPendingCount: () => 2,
                getQueueProgress: () => makeIdleQueueProgress(),
                onLocalizeActiveCharacter: async () => {
                    localizeCalls++;
                },
                onOpenCharacterTab: () => {
                    openTabCalls++;
                },
            });

            controller.start();
            const btn = domEnv.document.querySelector(".ml-portrait-localize-btn") as any;
            expect(btn).not.toBeNull();

            // Simulate long-press timeout firing, then pointerleave canceling without click
            btn.dispatchEvent(new MockEvent("pointerdown", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 560));
            expect(openTabCalls).toBe(1);
            btn.dispatchEvent(new MockEvent("pointerleave", { bubbles: true }));

            // Subsequent normal click must NOT be swallowed by sticky longPressTriggered
            btn.click();
            await new Promise((r) => setTimeout(r, 10));
            expect(localizeCalls).toBe(1);

            // When panel is removed/closed, unrelated mutations elsewhere in body must return false
            outer.remove();
            const unrelated = domEnv.document.createElement("div");
            const relevant = (controller as any).isRelevantMutation({
                type: "childList",
                target: domEnv.document.body,
                addedNodes: [unrelated],
                removedNodes: [],
                attributeName: null,
            });
            expect(relevant).toBe(false);

            controller.stop();
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });
});

describe("frontend lifecycle, ordering, bulk purge & permission retries", () => {
    function buildFrontendTestEnv() {
        const domEnv = installMockDom();
        const sentMessages: Array<any> = [];
        const backendListeners = new Set<(msg: unknown) => void>();
        const stateListeners = new Map<string, Set<() => void>>();
        const eventListeners = new Map<string, Set<(ev?: any) => void>>();
        const drawerChangeListeners = new Set<() => void>();
        const drawerTabs: Array<any> = [];
        let granted = new Set<string>(["ui", "characters", "events", "state", "chat"]);
        let registerTabAllowed = true;
        let stateSubscribeAllowed = true;
        let onDrawerAllowed = true;
        let eventsOnAllowed = true;
        let requestCalls = 0;

        const ctx: any = {
            dom: { addStyle: () => () => {}, cleanup: () => {} },
            sendToBackend: (msg: unknown) => sentMessages.push(msg),
            onBackendMessage: (fn: (msg: unknown) => void) => {
                backendListeners.add(fn);
                return () => backendListeners.delete(fn);
            },
            getActiveChat: () => ({ id: "chat-1", characterId: "char-1" }),
            state: {
                get: (key: string) => (key === "chat.active" ? { characterId: "char-1" } : null),
                subscribe: (key: string, fn: () => void) => {
                    if (!stateSubscribeAllowed) throw new Error("missing state permission");
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
                    if (!registerTabAllowed) throw new Error("missing ui permission");
                    const root = domEnv.document.createElement("div");
                    domEnv.document.body.appendChild(root);
                    const badgeCalls: Array<unknown> = [];
                    const handle = {
                        ...def,
                        root,
                        activate: () => {},
                        badgeCalls,
                        setBadge: (v: unknown) => badgeCalls.push(v),
                    };
                    drawerTabs.push(handle);
                    return handle;
                },
                showConfirm: async () => ({ confirmed: true }),
                events: {
                    onDrawerChange: (fn: () => void) => {
                        if (!onDrawerAllowed) throw new Error("missing ui.events permission");
                        drawerChangeListeners.add(fn);
                        return () => drawerChangeListeners.delete(fn);
                    },
                },
                characterEditor: {
                    getState: () => null,
                    onChange: () => () => {},
                },
            },
            characters: {
                get: async (id: string) => ({ id, name: `Char ${id}` }),
            },
            events: {
                on: (name: string, fn: (ev?: any) => void) => {
                    if (!eventsOnAllowed) throw new Error("missing events permission");
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
                getGranted: async () => Array.from(granted),
                request: async () => {
                    requestCalls++;
                    return Array.from(granted);
                },
            },
            ready: () => {},
        };

        return {
            domEnv,
            ctx,
            sentMessages,
            drawerTabs,
            emitBackend: (msg: unknown) => {
                for (const fn of backendListeners) fn(msg);
            },
            setPermissionGates: (gates: Partial<{
                registerTabAllowed: boolean;
                stateSubscribeAllowed: boolean;
                onDrawerAllowed: boolean;
                eventsOnAllowed: boolean;
            }>) => {
                if (gates.registerTabAllowed !== undefined) registerTabAllowed = gates.registerTabAllowed;
                if (gates.stateSubscribeAllowed !== undefined) stateSubscribeAllowed = gates.stateSubscribeAllowed;
                if (gates.onDrawerAllowed !== undefined) onDrawerAllowed = gates.onDrawerAllowed;
                if (gates.eventsOnAllowed !== undefined) eventsOnAllowed = gates.eventsOnAllowed;
            },
            getRequestCalls: () => requestCalls,
            getEventListenerCount: (name: string) => eventListeners.get(name)?.size ?? 0,
            getStateListenerCount: (key: string) => stateListeners.get(key)?.size ?? 0,
        };
    }

    test("guards stale get_init_state, stale non-forced scans, and unloaded callBackend", async () => {
        const env = buildFrontendTestEnv();
        try {
            const unload = setup(env.ctx);
            await new Promise((r) => setTimeout(r, 15));

            const initReq = env.sentMessages.find(
                (m) => m.type === "RPC_REQUEST" && m.action === "get_init_state",
            );
            expect(initReq).toBeDefined();

            // Newer live queue progress arrives BEFORE stale get_init_state responds
            env.emitBackend({
                type: "QUEUE_PROGRESS",
                progress: {
                    ...makeIdleQueueProgress(),
                    status: "running",
                    jobId: "job-live",
                    totalQueued: 5,
                    completedCount: 2,
                    succeededCount: 2,
                },
            });

            // Stale get_init_state arrives with old idle progress
            env.emitBackend({
                type: "RPC_RESPONSE",
                requestId: initReq.requestId,
                result: {
                    settings: DEFAULT_SETTINGS,
                    stats: {
                        totalAssets: 0,
                        totalBytes: 0,
                        totalCharacters: 0,
                        totalFailedUrls: 0,
                        settings: DEFAULT_SETTINGS,
                    },
                    queueProgress: makeIdleQueueProgress(),
                    urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
                },
            });
            await new Promise((r) => setTimeout(r, 15));

            // Drawer panel is already mounted on tab.root: sticky running queue banner must remain visible
            const tab = env.drawerTabs[0];
            expect(tab.root.querySelector(".ml-queue-banner")).not.toBeNull();

            // Trigger overlapping non-forced + forced scan (via GALLERY_SYNC_CHANGED)
            const scanMsgs = env.sentMessages.filter(
                (m) => m.type === "RPC_REQUEST" && m.action === "scan_character",
            );
            expect(scanMsgs.length).toBeGreaterThanOrEqual(1);
            const firstScanReq = scanMsgs[0];

            env.emitBackend({ type: "GALLERY_SYNC_CHANGED", characterId: "char-1" });
            await new Promise((r) => setTimeout(r, 5));

            const allScans = env.sentMessages.filter(
                (m) => m.type === "RPC_REQUEST" && m.action === "scan_character",
            );
            const forcedScanReq = allScans[allScans.length - 1];
            expect(forcedScanReq.requestId).not.toBe(firstScanReq.requestId);
            expect(forcedScanReq.payload.forceRefresh).toBe(true);

            // Forced scan finishes FIRST with 9 occurrences
            env.emitBackend({
                type: "RPC_RESPONSE",
                requestId: forcedScanReq.requestId,
                result: {
                    scan: makeScanResult("char-1", 9),
                    urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 2 },
                },
            });
            await new Promise((r) => setTimeout(r, 15));

            // Stale non-forced scan finishes AFTER with 1 occurrence — must NOT overwrite forced scan!
            env.emitBackend({
                type: "RPC_RESPONSE",
                requestId: firstScanReq.requestId,
                result: {
                    scan: makeScanResult("char-1", 1),
                    urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 3 },
                },
            });
            await new Promise((r) => setTimeout(r, 15));
            expect(tab.root.textContent).toContain("9");

            // End running queue so badge switches from queue progress to lastActiveCharacterRemoteCount
            env.emitBackend({
                type: "QUEUE_PROGRESS",
                progress: { ...makeIdleQueueProgress(), status: "completed" },
            });
            expect(tab.badgeCalls[tab.badgeCalls.length - 1]).toBe("9");

            // Unload must fail-fast in callBackend without sending extra RPCs
            const msgCountBeforeUnload = env.sentMessages.length;
            unload();
            expect(env.sentMessages.length).toBe(msgCountBeforeUnload);
        } finally {
            cleanupUiHelpers();
            env.domEnv.restore();
        }
    });

    test("bulk purge fetches each character native gallery once and only deletes owned gallery items", async () => {
        const env = buildFrontendTestEnv();
        const origFetch = globalThis.fetch;
        const fetchCalls: Array<{ url: string; method: string }> = [];
        (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
            const method = (init?.method ?? "GET").toUpperCase();
            fetchCalls.push({ url, method });
            if (method === "GET" && url === "/api/v1/characters/char-1/gallery") {
                return {
                    ok: true,
                    json: async () => [{ id: "g-owned-1", image_id: "img-1" }],
                } as any;
            }
            if (method === "GET" && url === "/api/v1/characters/char-2/gallery") {
                return {
                    ok: true,
                    json: async () => [{ id: "g-owned-2", image_id: "img-2" }],
                } as any;
            }
            return { ok: true, json: async () => ({}) } as any;
        };

        try {
            const unload = setup(env.ctx);
            await new Promise((r) => setTimeout(r, 15));

            const initReq = env.sentMessages.find(
                (m) => m.type === "RPC_REQUEST" && m.action === "get_init_state",
            );
            env.emitBackend({
                type: "RPC_RESPONSE",
                requestId: initReq.requestId,
                result: {
                    settings: DEFAULT_SETTINGS,
                    stats: {
                        totalAssets: 2,
                        totalBytes: 200,
                        totalCharacters: 2,
                        totalFailedUrls: 0,
                        settings: DEFAULT_SETTINGS,
                    },
                    queueProgress: makeIdleQueueProgress(),
                    urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 1 },
                },
            });

            const tab = env.drawerTabs[0];
            await new Promise((r) => setTimeout(r, 15));

            const libBtn = Array.from(tab.root.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
                (b.textContent ?? "").includes("Library"),
            );
            libBtn.click();
            await new Promise((r) => setTimeout(r, 15));

            const scanBtn = Array.from(tab.root.querySelectorAll("button") as unknown as Iterable<any>).find((b) =>
                (b.textContent ?? "").includes("Scan Library"),
            );
            scanBtn.click();
            await new Promise((r) => setTimeout(r, 15));

            const scanLibReq = env.sentMessages.find(
                (m) => m.type === "RPC_REQUEST" && m.action === "scan_library",
            );
            expect(scanLibReq).toBeDefined();
            const secCounts = {
                creator_notes: 1,
                first_mes: 0,
                core_fields: 0,
                alternate_greetings: 0,
                world_books: 0,
                regex_scripts: 0,
            };
            env.emitBackend({
                type: "RPC_RESPONSE",
                requestId: scanLibReq.requestId,
                result: {
                    characters: [
                        {
                            characterId: "char-1",
                            characterName: "Char 1",
                            totalUniqueRemote: 1,
                            remoteCount: 1,
                            localizedCount: 1,
                            failedCount: 0,
                            sectionRemoteCounts: secCounts,
                        },
                        {
                            characterId: "char-2",
                            characterName: "Char 2",
                            totalUniqueRemote: 1,
                            remoteCount: 1,
                            localizedCount: 1,
                            failedCount: 0,
                            sectionRemoteCounts: secCounts,
                        },
                    ],
                    totalUniqueRemote: 2,
                },
            });
            await new Promise((r) => setTimeout(r, 15));

            const removeSelectedBtn = tab.root.querySelector(
                'button[title*="Remove all localized cache assets"]',
            ) as any;
            expect(removeSelectedBtn).not.toBeNull();
            removeSelectedBtn.click();
            await new Promise((r) => setTimeout(r, 15));

            const bulkReq = env.sentMessages.find(
                (m) => m.type === "RPC_REQUEST" && m.action === "purge_characters",
            );
            expect(bulkReq).toBeDefined();
            // Backend returns both owned ids PLUS an extra unowned id "g-foreign-99"
            env.emitBackend({
                type: "RPC_RESPONSE",
                requestId: bulkReq.requestId,
                result: {
                    removedGalleryItemIds: ["g-owned-1", "g-owned-2", "g-foreign-99"],
                    removedImageIds: ["img-1", "img-2"],
                    stats: {
                        totalAssets: 0,
                        totalBytes: 0,
                        totalCharacters: 0,
                        totalFailedUrls: 0,
                        settings: DEFAULT_SETTINGS,
                    },
                    urlMapPayload: { characterUrlMaps: {}, allUrlsMap: {}, updatedAt: 2 },
                },
            });
            await new Promise((r) => setTimeout(r, 30));

            const getCalls = fetchCalls.filter((c) => c.method === "GET");
            const deleteCalls = fetchCalls.filter((c) => c.method === "DELETE");
            expect(getCalls.map((c) => c.url).sort()).toEqual([
                "/api/v1/characters/char-1/gallery",
                "/api/v1/characters/char-2/gallery",
            ]);
            // Must NOT delete g-foreign-99 and must only delete owned items for their owning character
            expect(deleteCalls.map((c) => c.url).sort()).toEqual([
                "/api/v1/characters/char-1/gallery/g-owned-1",
                "/api/v1/characters/char-2/gallery/g-owned-2",
            ]);

            unload();
        } finally {
            (globalThis as any).fetch = origFetch;
            cleanupUiHelpers();
            env.domEnv.restore();
        }
    });

    test("retries permission-gated registrations idempotently and handles denied permissions gracefully", async () => {
        const env = buildFrontendTestEnv();
        try {
            // Part A: Initially denied, then permissions.request() grants missing permissions
            env.setPermissionGates({
                registerTabAllowed: false,
                stateSubscribeAllowed: false,
                onDrawerAllowed: false,
                eventsOnAllowed: false,
            });
            env.ctx.permissions.getGranted = async () => [];
            env.ctx.permissions.request = async () => {
                env.setPermissionGates({
                    registerTabAllowed: true,
                    stateSubscribeAllowed: true,
                    onDrawerAllowed: true,
                    eventsOnAllowed: true,
                });
                return ["ui", "characters", "events", "state", "chat"];
            };

            const unloadA = setup(env.ctx);
            // Before async permission grant resolves, deferred bindings are absent
            expect(env.drawerTabs.length).toBe(0);
            expect(env.getStateListenerCount("chat.active")).toBe(0);

            await new Promise((r) => setTimeout(r, 25));

            // After permissions.request() resolves, deferred registrations succeed cleanly
            expect(env.drawerTabs.length).toBe(1);
            expect(env.getStateListenerCount("chat.active")).toBe(1);
            expect(env.getEventListenerCount("CHAT_SWITCHED")).toBe(1);
            unloadA();
        } finally {
            cleanupUiHelpers();
            env.domEnv.restore();
        }

        // Part B: permissions.request() throws/denies -> does not throw unhandled rejection and unloads cleanly
        const envDenied = buildFrontendTestEnv();
        try {
            envDenied.setPermissionGates({
                registerTabAllowed: false,
                stateSubscribeAllowed: false,
                onDrawerAllowed: false,
                eventsOnAllowed: false,
            });
            envDenied.ctx.permissions.getGranted = async () => [];
            envDenied.ctx.permissions.request = async () => {
                throw new Error("Permission request denied");
            };

            const unloadB = setup(envDenied.ctx);
            await new Promise((r) => setTimeout(r, 25));
            expect(envDenied.drawerTabs.length).toBe(0);
            unloadB();
        } finally {
            cleanupUiHelpers();
            envDenied.domEnv.restore();
        }
    });
});

describe("audit fixes regression tests (ui-helpers, styles, gallery-integrator, display-swapper, portrait-button)", () => {
    test("H-01: reobserveLazyMedia re-observes detached cached media elements and falls back when IntersectionObserver is absent", () => {
        const domEnv = installMockDom();
        try {
            const card = domEnv.document.createElement("div");
            const img = createLazyMediaElement({
                src: "/api/v1/images/cached-1",
                alt: "Cached",
                mediaKind: "image",
                className: "ml-thumb",
            }) as any;
            const vid = createLazyMediaElement({
                src: "https://cdn.example.com/clip.mp4",
                alt: "Clip",
                mediaKind: "video",
                className: "ml-thumb",
            }) as any;
            card.append(img, vid);
            domEnv.document.body.appendChild(card);

            const obs = (globalThis as any).IntersectionObserver.instances[0] as {
                observedTargets: Set<any>;
                trigger: (entries: Array<{ target: any; isIntersecting: boolean }>) => void;
            };
            expect(obs.observedTargets.has(img)).toBe(true);
            expect(obs.observedTargets.has(vid)).toBe(true);

            // Detach card and prune before viewport intersection
            card.remove();
            obs.trigger([
                { target: img, isIntersecting: false },
                { target: vid, isIntersecting: false },
            ]);
            expect(obs.observedTargets.has(img)).toBe(false);
            expect(obs.observedTargets.has(vid)).toBe(false);
            expect(img.getAttribute("src")).toBeNull();
            expect(vid.getAttribute("src")).toBeNull();

            // Re-attach cached card and call reobserveLazyMedia(card) + direct element call
            domEnv.document.body.appendChild(card);
            reobserveLazyMedia(card as unknown as Element);
            expect(obs.observedTargets.has(img)).toBe(true);
            expect(obs.observedTargets.has(vid)).toBe(true);

            // Intersect img only
            obs.trigger([{ target: img, isIntersecting: true }]);
            expect(img.getAttribute("src")).toBe("/api/v1/images/cached-1?size=sm");
            expect(obs.observedTargets.has(img)).toBe(false);

            // Calling reobserveLazyMedia again must not re-observe already-loaded img
            reobserveLazyMedia(img as unknown as Element);
            expect(obs.observedTargets.has(img)).toBe(false);

            // Detach vid, prune, then simulate IntersectionObserver unavailable -> immediate src assignment
            vid.remove();
            obs.trigger([{ target: vid, isIntersecting: false }]);
            expect(vid.getAttribute("src")).toBeNull();

            const savedIO = (globalThis as any).IntersectionObserver;
            (globalThis as any).IntersectionObserver = undefined;
            try {
                domEnv.document.body.appendChild(vid);
                reobserveLazyMedia(vid);
                expect(vid.getAttribute("src")).toBe("https://cdn.example.com/clip.mp4");
            } finally {
                (globalThis as any).IntersectionObserver = savedIO;
            }
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });

    test("H-03 & M-08: prefs storage helpers, NativeGalleryTabIntegrator sync, and pendingExternalRefreshWhileQueueActive", async () => {
        const domEnv = installMockDom();
        const origLocalStorage = globalThis.localStorage;
        const store = new Map<string, string>();
        (globalThis as any).localStorage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => {
                store.set(k, String(v));
            },
            removeItem: (k: string) => {
                store.delete(k);
            },
        };

        try {
            expect(GALLERY_PREFS_STORAGE_KEY).toBe("lumiverse.media_localizer.gallery_prefs.v1");
            expect(CHARACTER_PREFS_STORAGE_KEY).toBe("lumiverse.media_localizer.character_prefs.v1");

            savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, {
                thumbnailSize: "lg",
                mediaViewMode: "list",
                showDownloadConfig: true,
                showDownloadedMedia: true,
            });
            const loaded = loadPrefsFromStorage<Record<string, unknown>>(
                CHARACTER_PREFS_STORAGE_KEY,
                (raw) => raw as Record<string, unknown>,
                () => ({}),
            );
            expect(loaded.thumbnailSize).toBe("lg");

            store.set(GALLERY_PREFS_STORAGE_KEY, "{not-valid-json");
            expect(
                loadPrefsFromStorage(
                    GALLERY_PREFS_STORAGE_KEY,
                    () => ({ ok: true }),
                    () => ({ ok: false }),
                ),
            ).toEqual({ ok: false });

            const galleryTab = domEnv.document.createElement("div");
            galleryTab.className = "Editor_galleryTab_sync";
            domEnv.document.body.appendChild(galleryTab);

            const ctx = {
                ui: {
                    characterEditor: {
                        getState: () => ({
                            open: true,
                            characterId: "char-sync",
                            activeTabId: "gallery",
                            extensions: {},
                        }),
                        onChange: () => () => {},
                    },
                },
            } as any;

            const scanHistory: Array<{ charId: string; forceRefresh: boolean | undefined }> = [];
            let prefsUpdatedNotified = 0;

            const integrator = new NativeGalleryTabIntegrator(
                ctx,
                DEFAULT_SETTINGS,
                makeIdleQueueProgress(),
                {
                    onScanCharacter: async (charId, forceRefresh) => {
                        scanHistory.push({ charId, forceRefresh });
                        const scan = makeScanResult(charId, 1);
                        scan.items[0] = {
                            ...scan.items[0]!,
                            status: "localized",
                            localizedEntry: {
                                normalizedUrl: scan.items[0]!.normalizedUrl,
                                rawUrls: scan.items[0]!.rawUrls,
                                imageId: "img-sync-1",
                                localUrl: "/api/v1/images/img-sync-1",
                                mimeType: "image/png",
                                sizeBytes: 512,
                                filename: "pic-0.png",
                                localizedAt: 1000,
                                characterIds: [charId],
                                galleryItemIds: {},
                            },
                        };
                        return scan;
                    },
                    onSaveCharacterOverride: async () => null,
                    onStartDownload: async () => {},
                    onPurgeCharacterCache: async () => {},
                    onClearFailedUrls: async () => {},
                    onQueueControl: async () => {},
                },
                {
                    onCharacterPrefsUpdated: () => {
                        prefsUpdatedNotified++;
                    },
                },
            );

            integrator.start();
            await new Promise((r) => setTimeout(r, 15));

            const host = galleryTab.querySelector(".ml-gallery-host") as unknown as HTMLElement;
            expect(host).not.toBeNull();
            // Inherited lg size while staying collapsed in Native Gallery
            const widgetEl = host.querySelector(".ml-widget") as unknown as HTMLElement;
            expect(widgetEl.classList.contains("is-thumb-lg")).toBe(true);
            expect(host.querySelector(".ml-asset-grid")).toBeNull();
            expect(host.querySelector(".ml-options-panel")).toBeNull();

            // Expand Downloaded Media and click Small ("S") -> updates shared storage (preserving Drawer's showDownloadedMedia: true) and notifies
            (host.querySelector('button[title="Expand Downloaded Media"]') as any).click();
            const smBtn = host.querySelector('button[title="Small thumbnails"]') as any;
            expect(smBtn).not.toBeNull();
            smBtn.click();

            expect(prefsUpdatedNotified).toBe(1);
            const savedAfterClick = JSON.parse(store.get(CHARACTER_PREFS_STORAGE_KEY)!);
            expect(savedAfterClick.thumbnailSize).toBe("sm");
            expect(savedAfterClick.showDownloadedMedia).toBe(true);
            expect((host.querySelector(".ml-widget") as unknown as HTMLElement).classList.contains("is-thumb-sm")).toBe(true);

            // Drawer updates storage to md -> syncPreferencesFromStorage updates mounted embedded widget without collapsing it
            savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, {
                ...savedAfterClick,
                thumbnailSize: "md",
            });
            integrator.syncPreferencesFromStorage();
            expect((host.querySelector(".ml-widget") as unknown as HTMLElement).classList.contains("is-thumb-md")).toBe(true);
            expect(host.querySelector(".ml-media-list")).not.toBeNull();

            // M-08: queue running -> native gallery card added -> queue completes -> triggers forced refreshScan(true)
            const galleryObserver = domEnv.mutationObservers.instances.find((inst) =>
                inst.observed.some((o) => o.target === galleryTab),
            )!;
            integrator.updateExternalState(DEFAULT_SETTINGS, {
                ...makeIdleQueueProgress(),
                status: "running",
                totalQueued: 1,
            });
            const card = domEnv.document.createElement("div");
            card.className = "Editor_galleryCard_new";
            galleryTab.appendChild(card);
            galleryObserver.trigger([{ target: galleryTab }]);
            await new Promise((r) => setTimeout(r, 640));
            const countWhileRunning = scanHistory.length;

            integrator.updateExternalState(DEFAULT_SETTINGS, {
                ...makeIdleQueueProgress(),
                status: "completed",
                totalQueued: 1,
                completedCount: 1,
            });
            await new Promise((r) => setTimeout(r, 15));
            expect(scanHistory.length).toBe(countWhileRunning + 1);
            expect(scanHistory[scanHistory.length - 1]?.forceRefresh).toBe(true);

            integrator.stop();
        } finally {
            (globalThis as any).localStorage = origLocalStorage;
            cleanupUiHelpers();
            domEnv.restore();
        }
    });

    test("M-09 & L-08: DisplaySwapper observes same-origin iframe mutations/errors, fast-paths <style>, and PortraitPanel skips subtree scans when mounted", async () => {
        const domEnv = installMockDom();
        try {
            // 1. Same-origin iframe observation & style fast-path
            const iframe = domEnv.document.createElement("iframe") as any;
            const iframeDoc = new (domEnv.document.constructor as any)();
            const iframeImg = iframeDoc.createElement("img");
            iframeImg.setAttribute("src", "https://cdn.example.com/in-frame.png");
            iframeDoc.body.appendChild(iframeImg);
            iframe.contentDocument = iframeDoc;

            const plainStyle = domEnv.document.createElement("style");
            plainStyle.textContent = ".foo { color: red; }";
            let resolveBaseCalls = 0;

            domEnv.document.body.append(iframe, plainStyle);

            const ctx = { getActiveChat: () => ({ characterId: "char-1" }) } as any;
            const swapper = new NonDestructiveDisplaySwapper(ctx);
            const origResolveBase = (swapper as any).resolveBase.bind(swapper);
            (swapper as any).resolveBase = (el: Element, name: string, current: string) => {
                if (el === (plainStyle as any)) resolveBaseCalls++;
                return origResolveBase(el, name, current);
            };

            swapper.start();
            swapper.updateMap({
                characterUrlMaps: {
                    "char-1": {
                        "https://cdn.example.com/in-frame.png": "/api/v1/images/in-frame",
                        "https://cdn.example.com/dyn.png": "/api/v1/images/dyn",
                        "https://cdn.example.com/err.png": "/api/v1/images/err",
                    },
                },
                allUrlsMap: {},
                updatedAt: 10,
            });

            // <style> without url() and without data-ml-original-css skipped resolveBase
            expect(resolveBaseCalls).toBe(0);
            expect(iframeImg.getAttribute("src")).toBe("/api/v1/images/in-frame");

            // Dynamic DOM mutation inside iframe triggers schedulePass()
            const iframeObserver = domEnv.mutationObservers.instances.find((inst) =>
                inst.observed.some((o) => o.target === iframeDoc.documentElement),
            );
            expect(iframeObserver).toBeDefined();

            const dynImg = iframeDoc.createElement("img");
            dynImg.setAttribute("src", "https://cdn.example.com/dyn.png");
            iframeDoc.body.appendChild(dynImg);
            iframeObserver!.trigger([
                {
                    type: "childList",
                    target: iframeDoc.body,
                    addedNodes: [dynImg],
                    removedNodes: [],
                    attributeName: null,
                },
            ]);
            domEnv.window.flushAnimationFrames();
            expect(dynImg.getAttribute("src")).toBe("/api/v1/images/dyn");

            // Capture-phase error listener inside iframe swaps failed media immediately
            const errImg = iframeDoc.createElement("img");
            errImg.setAttribute("src", "https://cdn.example.com/err.png");
            iframeDoc.body.appendChild(errImg);
            const errEv = new MockEvent("error", { bubbles: false });
            errEv.target = errImg;
            iframeDoc.dispatchEvent(errEv);
            expect(errImg.getAttribute("src")).toBe("/api/v1/images/err");

            expect(iframeDoc.getListenerCount("error")).toBe(1);
            swapper.stop();
            expect(iframeDoc.getListenerCount("error")).toBe(0);
            expect(iframeImg.getAttribute("src")).toBe("https://cdn.example.com/in-frame.png");

            // 2. PortraitPanelLocalizeController skips querySelector on external addedNodes when mountedPanel is connected
            const outer = domEnv.document.createElement("div");
            outer.className = "panelOuter";
            const panel = domEnv.document.createElement("div");
            panel.className = "panel";
            const nameEl = domEnv.document.createElement("div");
            nameEl.className = "name";
            panel.appendChild(nameEl);
            outer.appendChild(panel);
            const chatFeed = domEnv.document.createElement("div");
            chatFeed.className = "chatFeed";
            domEnv.document.body.append(outer, chatFeed);

            const controller = new PortraitPanelLocalizeController({
                getActiveCharacterId: () => "char-1",
                getPendingCount: () => 1,
                getQueueProgress: () => makeIdleQueueProgress(),
                onLocalizeActiveCharacter: async () => {},
                onOpenCharacterTab: () => {},
            });
            controller.start();

            const msgNode = domEnv.document.createElement("div");
            let queryCalls = 0;
            const origQs = msgNode.querySelector.bind(msgNode);
            msgNode.querySelector = ((sel: string) => {
                queryCalls++;
                return origQs(sel);
            }) as any;

            const relevantWhileMounted = (controller as any).isRelevantMutation({
                type: "childList",
                target: chatFeed,
                addedNodes: [msgNode],
                removedNodes: [],
                attributeName: null,
            });
            expect(relevantWhileMounted).toBe(false);
            expect(queryCalls).toBe(0);

            controller.stop();
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });

    test("L-01, L-02 & styles: Lightbox Escape stopPropagation + video preservation, InfoTip cleanup/alignment, URL parens, and standalone widget rules", async () => {
        const domEnv = installMockDom();
        try {
            // 1. Balanced vs unbalanced parenthesis guard in sanitizeSafeMediaUrl
            expect(sanitizeSafeMediaUrl("https://example.com/char_(v2).webp")).toBe(
                "https://example.com/char_(v2).webp",
            );
            expect(sanitizeSafeMediaUrl("https://example.com/a)b.png")).toBeNull();
            expect(sanitizeSafeMediaUrl("https://example.com/a(b.png")).toBeNull();

            // 2. Styles verification
            expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-widget.is-drawer");
            expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-widget.is-embedded");
            expect(MEDIA_LOCALIZER_STYLES).toContain(".ml-combined-bar .ml-tip-popover");
            expect(MEDIA_LOCALIZER_STYLES).not.toContain("var(--ml-asset-thumb-height, 76px)");

            // 3. Lightbox Escape/Arrow stopPropagation + non-active async remove preserves video element
            let hostKeydowns = 0;
            const hostKeyListener = () => {
                hostKeydowns++;
            };
            domEnv.document.addEventListener("keydown", hostKeyListener);

            let resolveSlide1Remove!: () => void;
            openMediaLightbox(
                [
                    {
                        id: "slide-1",
                        localUrl: "/api/v1/images/slide-1",
                        mediaKind: "image",
                        title: "Slide 1",
                        onRemove: async () =>
                            new Promise<void>((r) => {
                                resolveSlide1Remove = r;
                            }),
                    },
                    {
                        id: "slide-2",
                        localUrl: "https://cdn.example.com/slide-2.mp4",
                        mediaKind: "video",
                        title: "Slide 2",
                    },
                ],
                0,
            );

            const removeBtn = domEnv.document.querySelector(
                'button[title*="Remove this localized asset"]',
            ) as any;
            removeBtn.click();

            // Step to slide-2 with ArrowRight
            const rightEv = new MockKeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
            domEnv.window.dispatchEvent(rightEv);
            expect(rightEv.propagationStopped).toBe(true);

            const videoBeforeResolve = domEnv.document.querySelector("video.ml-lightbox-media");
            expect(videoBeforeResolve).not.toBeNull();

            // Settle slide-1 removal: slide-2 video DOM element must remain untouched
            resolveSlide1Remove();
            await new Promise((r) => setTimeout(r, 15));
            const videoAfterResolve = domEnv.document.querySelector("video.ml-lightbox-media");
            expect(videoAfterResolve).toBe(videoBeforeResolve);
            expect(domEnv.document.body.textContent).toContain("1 / 1");

            // Escape closes lightbox and calls stopPropagation()
            const escEv = new MockKeyboardEvent("keydown", { key: "Escape", cancelable: true });
            domEnv.window.dispatchEvent(escEv);
            expect(escEv.propagationStopped).toBe(true);
            expect(domEnv.document.querySelector(".ml-lightbox-backdrop")).toBeNull();
            expect(hostKeydowns).toBe(0);
            domEnv.document.removeEventListener("keydown", hostKeyListener);

            // 4. InfoTip smart alignment + detached trigger cleanup
            const drawerBody = domEnv.document.createElement("div") as any;
            drawerBody.className = "ml-drawer-body";
            drawerBody.getBoundingClientRect = () => ({
                left: 0,
                right: 300,
                width: 300,
                top: 0,
                bottom: 500,
                height: 500,
            });
            const tip = createInfoTip("Right-edge help tip") as any;
            tip.getBoundingClientRect = () => ({
                left: 260,
                right: 276,
                width: 16,
                top: 10,
                bottom: 26,
                height: 16,
            });
            drawerBody.appendChild(tip);
            domEnv.document.body.appendChild(drawerBody);

            const tipBtn = tip.querySelector(".ml-tip-btn") as any;
            tipBtn.click();
            expect(tip.classList.contains("is-open")).toBe(true);
            expect(tip.classList.contains("is-align-right")).toBe(true);
            expect(domEnv.document.getListenerCount("click")).toBe(1);

            // Detach open tip and trigger document click -> closes and removes document listeners
            tip.remove();
            domEnv.document.dispatchEvent(new MockEvent("click", { bubbles: true }));
            expect(tip.classList.contains("is-open")).toBe(false);
            expect(domEnv.document.getListenerCount("click")).toBe(0);
            expect(domEnv.document.getListenerCount("keydown")).toBe(0);
        } finally {
            cleanupUiHelpers();
            domEnv.restore();
        }
    });
});
