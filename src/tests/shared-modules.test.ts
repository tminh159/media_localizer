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
    type FailedUrlRecord,
    type LocalizedAssetEntry,
} from "../shared/types";

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
});
