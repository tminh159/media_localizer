import { describe, expect, test } from "bun:test";
import { sanitizeOverride } from "../shared/download-config.ts";
import {
  deriveUrlFilenameParts,
  extractMediaTokensFromText,
  extractNativeGalleryUrlsFromCharacter,
  filterScanItemsForDownload,
  parseSrcsetCandidates,
  scanCharacterMedia,
} from "../shared/url-scanner.ts";

describe("url-scanner", () => {
  test("extracts Markdown (inline & reference), HTML img/srcset/video/source, CSS url(), and bare media URLs while ignoring local/font URLs", () => {
    const sample = `
      Here is a markdown image: ![Banner](https://files.catbox.moe/abc123.png "Title")
      And balanced parens: ![Wiki](https://example.com/char_(v2).webp)
      And reference markdown: ![RefBanner][hero-ref]
      [hero-ref]: https://cdn.example.org/hero_ref.png "Hero"
      And HTML img with entity and srcset: <img src="https://i.imgur.com/pic.jpg?foo=1&amp;bar=2" srcset="https://i.imgur.com/pic_1x.jpg 1x, https://i.imgur.com/pic_2x.jpg 2x" />
      And video with poster: <video src="https://cdn.example.org/intro.mp4" poster="https://cdn.example.org/poster.jpg"></video>
      And CSS background: <div style="background-image: url('https://assets.example.net/bg.gif')"></div>
      And bare URL: https://media.example.com/standalone.avif.
      Ignored local: ![Local](/api/v1/images/11111111-2222-3333-4444-555555555555)
      Ignored data: <img src="data:image/png;base64,iVBORw0KGgo=" />
      Ignored font: @import url('https://fonts.googleapis.com/css2?family=Inter');
      Ignored woff2: url("https://example.com/font.woff2")
    `;

    const tokens = extractMediaTokensFromText(sample, { scanBareUrls: true });
    const urls = tokens.map((t) => t.normalizedUrl);

    expect(urls).toContain("https://files.catbox.moe/abc123.png");
    expect(urls).toContain("https://example.com/char_(v2).webp");
    expect(urls).toContain("https://cdn.example.org/hero_ref.png");
    expect(urls).toContain("https://i.imgur.com/pic.jpg?foo=1&bar=2");
    expect(urls).toContain("https://i.imgur.com/pic_1x.jpg");
    expect(urls).toContain("https://i.imgur.com/pic_2x.jpg");
    expect(urls).toContain("https://cdn.example.org/intro.mp4");
    expect(urls).toContain("https://cdn.example.org/poster.jpg");
    expect(urls).toContain("https://assets.example.net/bg.gif");
    expect(urls).toContain("https://media.example.com/standalone.avif");
    expect(urls.length).toBe(10);

    const videoToken = tokens.find(
      (t) => t.normalizedUrl === "https://cdn.example.org/intro.mp4",
    );
    expect(videoToken?.mediaKind).toBe("video");
  });

  test("deriveUrlFilenameParts extracts extension from query format parameter when path lacks one", () => {
    const parts = deriveUrlFilenameParts(
      "https://pbs.twimg.com/media/GH12345abc?format=jpg&name=large",
    );
    expect(parts.cleanedStem).toBe("GH12345abc");
    expect(parts.ext).toBe("jpg");
    expect(parts.basename).toBe("GH12345abc.jpg");
  });

  test("scans character fields, deduplicates shared divider across greetings, and filters granularly", () => {
    const scan = scanCharacterMedia(
      {
        id: "char-1",
        name: "Aurelia",
        creator_notes: `<div style="background:url(https://files.catbox.moe/notes_bg.png)"><img src="https://files.catbox.moe/divider.png"></div>`,
        first_mes: `![Opening](https://files.catbox.moe/divider.png)\n![Scene1](https://i.imgur.com/scene1.jpg)`,
        description: `![Avatar](https://i.imgur.com/desc.png)`,
        alternate_greetings: [
          `![Divider](https://files.catbox.moe/divider.png)\n![G1](https://files.catbox.moe/g1.png)`,
          `![Divider](https://files.catbox.moe/divider.png)\n![G2](https://files.catbox.moe/g2.mp4)`,
          `![G3](https://cdn.other.org/g3.webp)`,
        ],
      },
      [
        {
          id: "wb-1",
          name: "World Lore",
          entries: [
            {
              id: "e-1",
              comment: "Map",
              content: `![Map](https://lore.example.com/map.png)`,
            },
          ],
        },
      ],
      [
        {
          id: "rx-1",
          script_name: "HUD",
          replace_string: `<img src="https://hud.example.com/frame.png">`,
        },
      ],
      {
        localizedByNormalizedUrl: new Map(),
        failedByNormalizedUrl: new Map(),
      },
    );

    // Total unique URLs: notes_bg, divider, scene1, desc, g1, g2, g3, map, frame = 9
    expect(scan.items.length).toBe(9);
    // divider appears 4 times, so totalOccurrences = 9 + 3 = 12
    expect(scan.totalOccurrences).toBe(12);
    expect(scan.greetingBreakdown.length).toBe(3);

    // Filter 1: Only Creator's Notes & First Message
    const notesAndFirst = filterScanItemsForDownload(scan, {
      sections: ["creator_notes", "first_mes"],
    });
    expect(notesAndFirst.map((i) => i.normalizedUrl).sort()).toEqual([
      "https://files.catbox.moe/divider.png",
      "https://files.catbox.moe/notes_bg.png",
      "https://i.imgur.com/scene1.jpg",
    ]);

    // Filter 2: Only Alternate Greeting #2
    const onlyGreeting2 = filterScanItemsForDownload(scan, {
      sections: ["alternate_greetings"],
      greetingIndices: [2],
    });
    expect(onlyGreeting2.map((i) => i.normalizedUrl).sort()).toEqual([
      "https://files.catbox.moe/divider.png",
      "https://files.catbox.moe/g2.mp4",
    ]);

    // Filter 3: Filter by domain `i.imgur.com` and exclude `desc.png`
    const imgurFiltered = filterScanItemsForDownload(scan, {
      domains: ["i.imgur.com"],
      excludedUrls: ["https://i.imgur.com/desc.png"],
    });
    expect(imgurFiltered.map((i) => i.normalizedUrl)).toEqual([
      "https://i.imgur.com/scene1.jpg",
    ]);
  });

  test("extractNativeGalleryUrlsFromCharacter matches native Lumiverse /gallery/extract order", () => {
    const urls = extractNativeGalleryUrlsFromCharacter({
      id: "char-native",
      name: "Native Extract Order",
      first_mes: "![First](https://files.catbox.moe/first.png)",
      description: "<img src='https://files.catbox.moe/desc.jpg'>",
      creator_notes: "https://files.catbox.moe/notes.webp",
      alternate_greetings: ["![Alt1](https://files.catbox.moe/alt1.gif)"],
    });

    expect(urls).toEqual([
      "https://files.catbox.moe/first.png",
      "https://files.catbox.moe/desc.jpg",
      "https://files.catbox.moe/notes.webp",
      "https://files.catbox.moe/alt1.gif",
    ]);
  });

  test("scanCharacterMedia skips chub.expressions and chub.alt_expressions while scanning chub.background_image", () => {
    const scan = scanCharacterMedia(
      {
        id: "char-chub-expr",
        name: "Chloe",
        first_mes: "Hello!",
        extensions: {
          chub: {
            id: 2225508,
            full_path: "Anonymous/chloe",
            background_image: "https://avatars.charhub.io/avatars/bg.png",
            expressions: {
              version: "default",
              expressions: {
                joy: "https://avatars.charhub.io/avatars/joy.png",
                anger: "https://avatars.charhub.io/avatars/anger.png",
              },
            },
            alt_expressions: {
              blush: "https://avatars.charhub.io/avatars/blush.png",
            },
          },
          expressions: {
            enabled: true,
            defaultExpression: "joy",
            mappings: {
              joy: "img-joy",
              anger: "img-anger",
            },
          },
        },
      },
      [],
      [],
      {
        localizedByNormalizedUrl: new Map(),
        failedByNormalizedUrl: new Map(),
      },
    );

    expect(scan.items.map((i) => i.normalizedUrl)).toEqual([
      "https://avatars.charhub.io/avatars/bg.png",
    ]);
  });

  test("does not skip subsequent markdown images after an unclosed ![alt]( prefix", () => {
    const junk = "![broken](" + "not-a-closing-paren ".repeat(100);
    const text = `${junk} ![Valid](https://cdn.example.com/valid.png) and ![Ref][r1]\n[r1]: https://cdn.example.com/ref.webp`;
    const tokens = extractMediaTokensFromText(text);
    const urls = tokens.map((t) => t.rawUrl);
    expect(urls).toContain("https://cdn.example.com/valid.png");
    expect(urls).toContain("https://cdn.example.com/ref.webp");

    // Repeated unclosed prefixes should not trigger quadratic scanning
    const manyBroken = "![unclosed](".repeat(200) + "![ok](https://cdn.example.com/final.png)";
    const start = Date.now();
    const fastTokens = extractMediaTokensFromText(manyBroken);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(fastTokens.map((t) => t.rawUrl)).toContain("https://cdn.example.com/final.png");
  });

  test("preserves comma-containing CDN transform URLs in srcset parsing and extraction", () => {
    const srcset =
      "https://cdn.example.com/cdn-cgi/image/w_800,f_auto/hero.png 800w, https://res.cloudinary.com/demo/image/upload/c_fill,w_1200,q_auto/card.webp 1200w";
    const parsed = parseSrcsetCandidates(srcset);
    expect(parsed.map((p) => p.url)).toEqual([
      "https://cdn.example.com/cdn-cgi/image/w_800,f_auto/hero.png",
      "https://res.cloudinary.com/demo/image/upload/c_fill,w_1200,q_auto/card.webp",
    ]);

    const html = `<img srcset="${srcset}" />`;
    const tokens = extractMediaTokensFromText(html, { scanBareUrls: false });
    expect(tokens.map((t) => t.rawUrl)).toEqual([
      "https://cdn.example.com/cdn-cgi/image/w_800,f_auto/hero.png",
      "https://res.cloudinary.com/demo/image/upload/c_fill,w_1200,q_auto/card.webp",
    ]);
  });

  test("extractNativeGalleryUrlsFromCharacter handles uppercase schemes and JSON-escaped quotes", () => {
    const char = {
      id: "char-gallery-edge",
      name: "Edge",
      extensions: {
        gallery: [
          "HTTPS://avatars.charhub.io/avatars/upper1.png",
          "HTTP://avatars.charhub.io/avatars/upper2.jpg",
          {
            html: '<img src="https://avatars.charhub.io/avatars/nested.webp">',
            escapedRaw: 'https://avatars.charhub.io/avatars/trailing.png\\"',
          },
        ],
      },
    };
    const urls = extractNativeGalleryUrlsFromCharacter(char as any);
    expect(urls).toContain("https://avatars.charhub.io/avatars/upper1.png");
    expect(urls).toContain("http://avatars.charhub.io/avatars/upper2.jpg");
    expect(urls).toContain("https://avatars.charhub.io/avatars/nested.webp");
    expect(urls).toContain("https://avatars.charhub.io/avatars/trailing.png");
  });

  test("[M-01 & L-07] excludes .svg URLs while supporting .jfif/.pjp/.pjpeg parity", () => {
    const sample = `
      ![Badge](https://img.shields.io/badge/build-passing.svg)
      <img src="https://cdn.example.com/divider.SVG?v=2" />
      <div style="background-image: url('https://cdn.example.com/pattern.svg')"></div>
      Bare svg: https://cdn.example.com/bare.svg
      ![Jfif](https://cdn.example.com/photo.jfif)
      <img src="https://cdn.example.com/photo2.pjp" />
      Bare pjpeg: https://cdn.example.com/photo3.pjpeg
    `;
    const tokens = extractMediaTokensFromText(sample, { scanBareUrls: true });
    const urls = tokens.map((t) => t.normalizedUrl);
    expect(urls).toEqual([
      "https://cdn.example.com/photo.jfif",
      "https://cdn.example.com/photo2.pjp",
      "https://cdn.example.com/photo3.pjpeg",
    ]);

    expect(deriveUrlFilenameParts("https://cdn.example.com/pic?format=jfif").ext).toBe("jfif");
    expect(deriveUrlFilenameParts("https://cdn.example.com/pic?format=pjp").ext).toBe("pjp");
    expect(deriveUrlFilenameParts("https://cdn.example.com/pic?format=pjpeg").ext).toBe("pjpeg");
    expect(deriveUrlFilenameParts("https://cdn.example.com/pic?format=svg").ext).toBe("");

    const nativeUrls = extractNativeGalleryUrlsFromCharacter({
      id: "char-svg-native",
      name: "SvgNative",
      first_mes: "Bare https://cdn.example.com/badge.svg and https://cdn.example.com/ok.jfif",
    });
    expect(nativeUrls).toEqual(["https://cdn.example.com/ok.jfif"]);
  });

  test("[L-09] sanitizeOverride caps filter array lengths and string lengths", () => {
    const manyDomains = Array.from({ length: 5050 }, (_, i) => `d${i}.example.com`);
    const manyIndices = Array.from({ length: 5050 }, (_, i) => i);
    const tooLongUrl = `https://cdn.example.com/${"a".repeat(2050)}.png`;

    const sanitized = sanitizeOverride({
      domains: [tooLongUrl, ...manyDomains],
      excludedUrls: [tooLongUrl, "https://cdn.example.com/ok.png"],
      greetingIndices: manyIndices,
    });

    expect(sanitized.domains?.length).toBe(5000);
    expect(sanitized.domains).not.toContain(tooLongUrl);
    expect(sanitized.excludedUrls).toEqual(["https://cdn.example.com/ok.png"]);
    expect(sanitized.greetingIndices?.length).toBe(5000);
  });
});

