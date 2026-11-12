import {
  ALL_MEDIA_SECTIONS,
  type CharacterDownloadOverride,
  type CharacterMediaScanResult,
  type DiscoveredMediaItem,
  type DomainBreakdownItem,
  type DownloadFilterOptions,
  type FailedUrlRecord,
  type GreetingBreakdownItem,
  type LibraryExpressionItem,
  type LocalizedAssetEntry,
  type MediaKind,
  type MediaSourceRef,
  type MediaSourceSection,
  type SectionCountSummary,
  type WorldBookBreakdownItem,
} from "./types.ts";

const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v|ogv)$/i;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|apng)$/i;
const EXCLUDED_ASSET_EXT_RE = /\.(?:woff2?|ttf|otf|eot|css|js|mjs|json|xml|html?|txt|pdf|zip|rar|7z|mp3|wav|ogg|flac|m4a)$/i;
const EXCLUDED_DOMAIN_RE = /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.fontawesome\.com|cdnjs\.cloudflare\.com)$/i;

const MAX_MD_ALT_LEN = 2048;
const MAX_MD_REF_LEN = 512;
const MAX_MD_URL_LEN = 8192;
const MAX_HTML_TAG_LEN = 4096;

const BLOCKED_HOSTNAME_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.goog",
  "metadata.google.internal",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".arpa",
];

function stripTrailingChars(input: string, chars: string): string {
  let end = input.length;
  while (end > 0 && chars.includes(input[end - 1]!)) {
    end--;
  }
  return end === input.length ? input : input.slice(0, end);
}

function stripWrappingAngleBrackets(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && input[start] === "<") start++;
  while (end > start && input[end - 1] === ">") end--;
  return start === 0 && end === input.length ? input : input.slice(start, end);
}

function parseDottedIpv4Octets(
  host: string,
): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function isBlockedIpv4Octets(
  a: number,
  b: number,
  c: number,
  _d: number,
): boolean {
  if (a === 0) return true; // 0.0.0.0/8 ("this network" / unspecified)
  if (a === 10) return true; // 10.0.0.0/8 (RFC 1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT / Alibaba IMDS)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / cloud IMDS)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC 1918)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 (6to4 relay anycast)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC 1918)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false;
}

function isBlockedIpv4Words(hi: number, lo: number): boolean {
  return isBlockedIpv4Octets(
    (hi >> 8) & 0xff,
    hi & 0xff,
    (lo >> 8) & 0xff,
    lo & 0xff,
  );
}

function parseIpv6Groups(ip: string): number[] | null {
  const doubleColonIdx = ip.indexOf("::");
  if (doubleColonIdx !== -1 && ip.indexOf("::", doubleColonIdx + 2) !== -1) {
    return null;
  }

  const parseSide = (side: string, allowIpv4Tail: boolean): number[] | null => {
    if (!side) return [];
    const parts = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!part) return null;
      if (part.includes(".")) {
        if (!allowIpv4Tail || i !== parts.length - 1) return null;
        const octets = parseDottedIpv4Octets(part);
        if (!octets) return null;
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
        out.push(Number.parseInt(part, 16));
      }
    }
    return out;
  };

  if (doubleColonIdx === -1) {
    const groups = parseSide(ip, true);
    return groups && groups.length === 8 ? groups : null;
  }

  const leftStr = ip.slice(0, doubleColonIdx);
  const rightStr = ip.slice(doubleColonIdx + 2);
  const left = parseSide(leftStr, !rightStr);
  const right = parseSide(rightStr, true);
  if (!left || !right) return null;

  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;

  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isBlockedIpv6Address(ip: string): boolean {
  const g = parseIpv6Groups(ip);
  if (!g) return true; // Fail closed on malformed IPv6 literals

  const g0 = g[0]!;
  const g1 = g[1]!;
  const g2 = g[2]!;
  const g3 = g[3]!;
  const g4 = g[4]!;
  const g5 = g[5]!;
  const g6 = g[6]!;
  const g7 = g[7]!;

  // ::/128 (unspecified) and ::1/128 (loopback)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (g6 === 0 && (g7 === 0 || g7 === 1)) return true;
    // ::/96 IPv4-compatible IPv6
    return isBlockedIpv4Words(g6, g7);
  }
  // ::ffff:0:0/96 (IPv4-mapped IPv6)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedIpv4Words(g6, g7);
  }
  // ::ffff:0:0:0/96 (IPv4-translated SIIT)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return isBlockedIpv4Words(g6, g7);
  }
  // 64:ff9b::/96 (NAT64 well-known) and 64:ff9b:1::/48 (NAT64 local-use)
  if (g0 === 0x0064 && g1 === 0xff9b) {
    if (g2 === 0x0001) return true;
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return isBlockedIpv4Words(g6, g7);
    }
  }
  // 100::/64 (Discard-Only)
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // 2001::/32 (Teredo) and 2001:db8::/32 (Documentation)
  if (g0 === 0x2001 && (g1 === 0x0000 || g1 === 0x0db8)) return true;
  // 2002::/16 (6to4 embedding IPv4 in groups 1 and 2)
  if (g0 === 0x2002) {
    return isBlockedIpv4Words(g1, g2);
  }
  // fc00::/7 (Unique Local Addresses: fc00::/8, fd00::/8)
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (Link-Local) and fec0::/10 (deprecated Site-Local)
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true;
  // ff00::/8 (Multicast)
  if ((g0 & 0xff00) === 0xff00) return true;

  return false;
}

function normalizeHostCandidate(rawHostname: string): string | null {
  let host = rawHostname.trim().toLowerCase();
  if (!host) return null;
  if (/[\s/\\?#%@!]/.test(host)) return null;

  if (host.startsWith("[")) {
    const closeIdx = host.indexOf("]");
    if (closeIdx === -1) return null;
    const after = host.slice(closeIdx + 1);
    if (after && !/^:\d+$/.test(after)) return null;
    host = host.slice(1, closeIdx);
  } else {
    const firstColon = host.indexOf(":");
    const lastColon = host.lastIndexOf(":");
    if (firstColon !== -1 && firstColon === lastColon) {
      const port = host.slice(firstColon + 1);
      if (!/^\d+$/.test(port)) return null;
      host = host.slice(0, firstColon);
    }
  }

  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (!host) return null;

  // Canonicalize through WHATWG URL so octal/hex/decimal/short IPv4 and IPv6
  // representations collapse cleanly before checking ranges.
  try {
    const urlInput = host.includes(":") ? `http://[${host}]` : `http://${host}`;
    let canonical = new URL(urlInput).hostname.toLowerCase();
    if (canonical.startsWith("[") && canonical.endsWith("]")) {
      canonical = canonical.slice(1, -1);
    }
    while (canonical.endsWith(".")) {
      canonical = canonical.slice(0, -1);
    }
    return canonical || null;
  } catch {
    return null;
  }
}

/**
 * Returns `true` if `hostname` resolves to a loopback, private, link-local,
 * unspecified, multicast, or internal/local hostname (SSRF defense).
 */
export function isBlockedRemoteHostname(hostname: string): boolean {
  if (typeof hostname !== "string") return true;
  const host = normalizeHostCandidate(hostname);
  if (!host) return true;

  if (host.includes(":")) {
    return isBlockedIpv6Address(host);
  }

  if (BLOCKED_HOSTNAME_EXACT.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  // Single-label internal hostnames (e.g. `localhost`, `redis`, `metadata`)
  if (!host.includes(".")) return true;

  const ipv4 = parseDottedIpv4Octets(host);
  if (ipv4) {
    return isBlockedIpv4Octets(ipv4[0], ipv4[1], ipv4[2], ipv4[3]);
  }

  return false;
}

/**
 * Validates that `url` is a syntactically valid `http:` or `https:` URL
 * targeting a non-local, non-private remote host.
 */
export function isSafeRemoteMediaUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }
  return !isBlockedRemoteHostname(parsed.hostname);
}

export interface RawExtractedToken {
  rawUrl: string;
  normalizedUrl: string;
  domain: string;
  mediaKind: MediaKind;
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

export function normalizeRemoteMediaUrl(
  rawInput: string,
  contextHint: "img" | "video" | "css" | "markdown" | "bare",
): RawExtractedToken | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Reject local/internal/data schemes immediately
  const lower = trimmed.toLowerCase();
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("gallery://") ||
    lower.startsWith("embeded://") ||
    lower.startsWith("embedded://") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("mailto:")
  ) {
    return null;
  }

  const decoded = decodeHtmlEntities(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  const domain = parsed.hostname.toLowerCase();
  if (isBlockedRemoteHostname(domain)) {
    return null;
  }
  if (EXCLUDED_DOMAIN_RE.test(domain)) {
    return null;
  }

  // Strip URL fragments so `a.png#1` and `a.png#2` deduplicate to the same remote asset.
  parsed.hash = "";
  const normalizedUrl = parsed.href;
  const pathname = parsed.pathname;

  // Never treat fonts, stylesheets, scripts, or web pages as localized media
  if (EXCLUDED_ASSET_EXT_RE.test(pathname)) {
    return null;
  }

  // Already-localized Lumiverse image URL
  if (/\/api\/v1\/images\/[0-9a-f-]+/i.test(pathname)) {
    return null;
  }

  const isVideoExt = VIDEO_EXT_RE.test(pathname);
  const isImageExt = IMAGE_EXT_RE.test(pathname);

  if (contextHint === "bare") {
    if (!isVideoExt && !isImageExt) return null;
  }

  const mediaKind: MediaKind =
    contextHint === "video" || isVideoExt ? "video" : "image";

  return {
    rawUrl: trimmed,
    normalizedUrl,
    domain,
    mediaKind,
  };
}

const MAX_MD_BRACKET_DEPTH = 32;
const MAX_HTML_ATTR_VALUE_LEN = 4096;
const MAX_CSS_URL_LEN = 4096;

interface TextSpan {
  start: number;
  end: number;
}

function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isBlankLineAt(text: string, pos: number): boolean {
  const ch = text[pos];
  if (ch === "\n") {
    return text[pos + 1] === "\n" || (text[pos + 1] === "\r" && text[pos + 2] === "\n");
  }
  if (ch === "\r" && text[pos + 1] === "\n") {
    return (
      text[pos + 2] === "\n" ||
      (text[pos + 2] === "\r" && text[pos + 3] === "\n")
    );
  }
  return false;
}

function normalizeMdRefLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Bounded, linear-time Markdown image scanner for `![alt](url)`, `![alt][ref]`,
 * and collapsed `![alt][]` forms. Guards against unclosed `![` backtracking and
 * handles angle-bracketed URLs and balanced parentheses.
 */
function extractMarkdownImageCandidates(text: string): {
  inline: Array<{ raw: string; spanStart: number; spanEnd: number }>;
  refUses: Set<string>;
} {
  const inline: Array<{ raw: string; spanStart: number; spanEnd: number }> = [];
  const refUses = new Set<string>();
  let idx = 0;
  const len = text.length;

  while (idx < len) {
    const bangIdx = text.indexOf("![", idx);
    if (bangIdx === -1) break;

    // Fast-forward past regions with no `]` or where the next `]` is beyond MAX_MD_ALT_LEN
    const firstClose = text.indexOf("]", bangIdx + 2);
    if (firstClose === -1) break;
    if (firstClose - (bangIdx + 2) > MAX_MD_ALT_LEN) {
      idx = firstClose - MAX_MD_ALT_LEN;
      continue;
    }

    // Advance past `![...]` supporting nested brackets within bounded limits
    let bracketDepth = 0;
    let i = bangIdx + 1;
    const altLimit = Math.min(len, bangIdx + 2 + MAX_MD_ALT_LEN);
    let altAborted = false;
    while (i < altLimit) {
      const ch = text[i]!;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "[") {
        bracketDepth++;
        if (bracketDepth > MAX_MD_BRACKET_DEPTH) {
          altAborted = true;
          break;
        }
      } else if (ch === "]") {
        bracketDepth--;
        if (bracketDepth === 0) {
          i++;
          break;
        }
      } else if (isBlankLineAt(text, i)) {
        altAborted = true;
        break;
      }
      i++;
    }

    if (altAborted || bracketDepth !== 0 || i >= len) {
      idx = bangIdx + 2;
      continue;
    }

    const altText = text.slice(bangIdx + 2, i - 1);

    // Inline link: `![alt](url "title")`
    if (text[i] === "(") {
      i++; // skip `(`
      const urlLimit = Math.min(len, i + MAX_MD_URL_LEN);
      while (i < urlLimit && isAsciiWhitespace(text[i] ?? "")) i++;

      if (text[i] === "<") {
        let j = i + 1;
        let closeAngle = -1;
        while (j < urlLimit) {
          const ch = text[j]!;
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === "\n" || ch === "\r" || ch === "<") break;
          if (ch === ">") {
            closeAngle = j;
            break;
          }
          j++;
        }
        if (closeAngle !== -1) {
          const raw = text.slice(i + 1, closeAngle).trim();
          if (raw) {
            inline.push({ raw, spanStart: i + 1, spanEnd: closeAngle });
          }
          idx = closeAngle + 1;
          continue;
        }
      }

      const urlStart = i;
      let parenDepth = 0;
      let stoppedCleanly = false;
      while (i < urlLimit) {
        const ch = text[i]!;
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "(") {
          parenDepth++;
        } else if (ch === ")") {
          if (parenDepth === 0) {
            stoppedCleanly = true;
            break;
          }
          parenDepth--;
        } else if (parenDepth === 0 && isAsciiWhitespace(ch)) {
          stoppedCleanly = true;
          break;
        }
        i++;
      }

      if (!stoppedCleanly && i >= urlLimit) {
        idx = urlLimit;
        continue;
      }

      const raw = text.slice(urlStart, i).trim();
      if (raw) {
        inline.push({ raw, spanStart: urlStart, spanEnd: i });
      }
      idx = i + 1;
      continue;
    }

    // Reference link: `![alt][ref]` or collapsed `![alt][]`
    if (text[i] === "[") {
      const refStart = i + 1;
      const refLimit = Math.min(len, refStart + MAX_MD_REF_LEN);
      let j = refStart;
      let refClose = -1;
      while (j < refLimit) {
        const ch = text[j]!;
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "[" || isBlankLineAt(text, j)) break;
        if (ch === "]") {
          refClose = j;
          break;
        }
        j++;
      }
      if (refClose !== -1) {
        const explicitRef = normalizeMdRefLabel(text.slice(refStart, refClose));
        const resolvedRef = explicitRef || normalizeMdRefLabel(altText);
        if (resolvedRef) {
          refUses.add(resolvedRef);
        }
        idx = refClose + 1;
        continue;
      }
    }

    idx = bangIdx + 2;
  }

  return { inline, refUses };
}

/**
 * Extracts `[label]: url` reference definitions matching `refUses` in a single linear pass.
 */
function extractReferenceDefinitionTargets(
  text: string,
  refUses: Set<string>,
): Array<{ raw: string; spanStart: number; spanEnd: number }> {
  if (refUses.size === 0) return [];
  const results: Array<{ raw: string; spanStart: number; spanEnd: number }> = [];
  const len = text.length;
  let pos = 0;

  while (pos < len) {
    const lineStart = pos;
    const nlIdx = text.indexOf("\n", pos);
    const rawLineEnd = nlIdx === -1 ? len : nlIdx;
    const lineEnd =
      rawLineEnd > lineStart && text[rawLineEnd - 1] === "\r"
        ? rawLineEnd - 1
        : rawLineEnd;
    pos = nlIdx === -1 ? len : nlIdx + 1;

    // Optional 0..3 leading spaces/tabs before `[label]:`
    let i = lineStart;
    let indent = 0;
    while (i < lineEnd && indent < 3 && (text[i] === " " || text[i] === "\t")) {
      i++;
      indent++;
    }
    if (i >= lineEnd || text[i] !== "[") continue;
    i++; // skip `[`

    const labelStart = i;
    const labelLimit = Math.min(lineEnd, labelStart + MAX_MD_REF_LEN);
    let labelClose = -1;
    while (i < labelLimit) {
      const ch = text[i]!;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "[") break;
      if (ch === "]") {
        labelClose = i;
        break;
      }
      i++;
    }
    if (
      labelClose === -1 ||
      labelClose + 1 >= lineEnd ||
      text[labelClose + 1] !== ":"
    ) {
      continue;
    }

    const label = normalizeMdRefLabel(text.slice(labelStart, labelClose));
    if (!label || !refUses.has(label)) continue;

    let u = labelClose + 2; // skip `]:`
    while (u < lineEnd && (text[u] === " " || text[u] === "\t")) u++;
    if (u >= lineEnd) continue;

    if (text[u] === "<") {
      const urlStart = u + 1;
      let j = urlStart;
      let closeGt = -1;
      while (j < lineEnd) {
        const ch = text[j]!;
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "<") break;
        if (ch === ">") {
          closeGt = j;
          break;
        }
        j++;
      }
      if (closeGt !== -1) {
        const raw = text.slice(urlStart, closeGt).trim();
        if (raw) {
          results.push({ raw, spanStart: urlStart, spanEnd: closeGt });
        }
      }
      continue;
    }

    const urlStart = u;
    while (u < lineEnd) {
      const ch = text[u]!;
      if (ch === " " || ch === "\t" || ch === ">" || ch === '"' || ch === "'") {
        break;
      }
      u++;
    }
    const raw = text.slice(urlStart, u).trim();
    if (raw) {
      results.push({ raw, spanStart: urlStart, spanEnd: u });
    }
  }

  return results;
}

const HTML_MEDIA_TAGS = new Set(["img", "image", "video", "source"]);

function isHtmlTagNameStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function isHtmlAttrNameStart(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    ch === ":"
  );
}

function isHtmlAttrNameChar(ch: string): boolean {
  return (
    isHtmlAttrNameStart(ch) ||
    (ch >= "0" && ch <= "9") ||
    ch === "." ||
    ch === "-"
  );
}

interface ParsedHtmlAttr {
  name: string;
  value: string;
  valStart: number;
  valEnd: number;
}

/**
 * Linear, quote-aware HTML attribute parser for `<img>`, `<image>`, `<video>`,
 * and `<source>`. Handles `>` inside quoted attribute values and matches exact
 * attribute names (avoiding `foo-src` false positives).
 */
function scanHtmlMediaTags(
  text: string,
  allowedTags: ReadonlySet<string>,
  onTag: (tagName: string, attrs: ParsedHtmlAttr[]) => void,
): void {
  const len = text.length;
  let pos = 0;

  while (pos < len) {
    const lt = text.indexOf("<", pos);
    if (lt === -1) break;

    if (text.startsWith("<!--", lt)) {
      const endComment = text.indexOf("-->", lt + 4);
      if (endComment === -1) break;
      pos = endComment + 3;
      continue;
    }

    if (lt + 1 >= len || !isHtmlTagNameStart(text[lt + 1]!)) {
      pos = lt + 1;
      continue;
    }

    let i = lt + 1;
    while (i < len) {
      const ch = text[i]!;
      if (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "-"
      ) {
        i++;
      } else {
        break;
      }
    }
    const tagNameEnd = i;
    const tagName = text.slice(lt + 1, tagNameEnd).toLowerCase();

    if (
      !allowedTags.has(tagName) ||
      i >= len ||
      (!isAsciiWhitespace(text[i]!) && text[i] !== "/" && text[i] !== ">")
    ) {
      pos = tagNameEnd;
      continue;
    }

    const nextGt = text.indexOf(">", i);
    if (nextGt === -1) break;
    if (nextGt - lt > MAX_HTML_TAG_LEN) {
      pos = Math.max(tagNameEnd, nextGt - MAX_HTML_TAG_LEN);
      continue;
    }

    const tagLimit = Math.min(len, lt + MAX_HTML_TAG_LEN);
    const attrs: ParsedHtmlAttr[] = [];
    let closed = false;
    let tagEnd = i;
    let hitLtAt = -1;

    while (i < tagLimit) {
      while (i < tagLimit && (isAsciiWhitespace(text[i]!) || text[i] === "/")) {
        i++;
      }
      if (i >= tagLimit) break;

      const ch = text[i]!;
      if (ch === ">") {
        closed = true;
        tagEnd = i + 1;
        break;
      }
      if (ch === "<") {
        hitLtAt = i;
        break;
      }

      if (!isHtmlAttrNameStart(ch)) {
        i++;
        continue;
      }

      const nameStart = i;
      i++;
      while (i < tagLimit && isHtmlAttrNameChar(text[i]!)) {
        i++;
      }
      const attrName = text.slice(nameStart, i).toLowerCase();

      while (i < tagLimit && isAsciiWhitespace(text[i]!)) i++;
      if (i >= tagLimit || text[i] !== "=") {
        continue;
      }
      i++; // skip `=`
      while (i < tagLimit && isAsciiWhitespace(text[i]!)) i++;
      if (i >= tagLimit) break;

      const valChar = text[i]!;
      if (valChar === '"' || valChar === "'") {
        const valStart = i + 1;
        const attrLimit = Math.min(tagLimit, valStart + MAX_HTML_ATTR_VALUE_LEN);
        let j = valStart;
        let closeQ = -1;
        while (j < attrLimit) {
          if (text[j] === valChar) {
            closeQ = j;
            break;
          }
          j++;
        }
        if (closeQ === -1) {
          break;
        }
        attrs.push({
          name: attrName,
          value: text.slice(valStart, closeQ),
          valStart,
          valEnd: closeQ,
        });
        i = closeQ + 1;
      } else {
        const valStart = i;
        while (i < tagLimit) {
          const c = text[i]!;
          if (
            isAsciiWhitespace(c) ||
            c === '"' ||
            c === "'" ||
            c === "=" ||
            c === "<" ||
            c === ">" ||
            c === "`"
          ) {
            break;
          }
          i++;
        }
        if (i > valStart) {
          attrs.push({
            name: attrName,
            value: text.slice(valStart, i),
            valStart,
            valEnd: i,
          });
        }
      }
    }

    if (closed) {
      onTag(tagName, attrs);
      pos = tagEnd;
    } else if (hitLtAt !== -1) {
      pos = hitLtAt;
    } else {
      pos = tagNameEnd;
    }
  }
}

function emitSrcsetCandidates(
  srcsetVal: string,
  valStart: number,
  hint: "img" | "video",
  pushCandidate: (
    raw: string,
    hint: "img" | "video" | "css" | "markdown" | "bare",
    spanStart: number,
    spanEnd: number,
  ) => void,
): void {
  let cursor = 0;
  for (const candidate of srcsetVal.split(",")) {
    const leadingWs = candidate.length - candidate.trimStart().length;
    const trimmed = candidate.trim();
    if (trimmed) {
      const wsIdx = trimmed.search(/\s/);
      const firstToken = wsIdx === -1 ? trimmed : trimmed.slice(0, wsIdx);
      if (firstToken) {
        const absStart = valStart + cursor + leadingWs;
        pushCandidate(firstToken, hint, absStart, absStart + firstToken.length);
      }
    }
    cursor += candidate.length + 1;
  }
}

function extractCssUrlCandidates(
  text: string,
): Array<{ raw: string; spanStart: number; spanEnd: number }> {
  const results: Array<{ raw: string; spanStart: number; spanEnd: number }> = [];
  const cssStartRe = /\burl\(/gi;
  const len = text.length;
  let match: RegExpExecArray | null;

  while ((match = cssStartRe.exec(text)) !== null) {
    let i = match.index + match[0].length;
    const limit = Math.min(len, i + MAX_CSS_URL_LEN);
    while (i < limit && isAsciiWhitespace(text[i] ?? "")) i++;
    if (i >= limit) continue;

    const first = text[i]!;
    if (first === '"' || first === "'") {
      const valStart = i + 1;
      let j = valStart;
      let closeQ = -1;
      while (j < limit) {
        if (text[j] === first) {
          closeQ = j;
          break;
        }
        j++;
      }
      if (closeQ === -1) continue;
      let k = closeQ + 1;
      while (k < limit && isAsciiWhitespace(text[k] ?? "")) k++;
      if (k < limit && text[k] === ")") {
        const raw = text.slice(valStart, closeQ);
        if (raw) {
          results.push({ raw, spanStart: valStart, spanEnd: closeQ });
        }
      }
    } else {
      const valStart = i;
      while (i < limit) {
        const ch = text[i]!;
        if (ch === ")" || ch === '"' || ch === "'" || isAsciiWhitespace(ch)) {
          break;
        }
        i++;
      }
      const valEnd = i;
      while (i < limit && isAsciiWhitespace(text[i] ?? "")) i++;
      if (i < limit && text[i] === ")" && valEnd > valStart) {
        const raw = text.slice(valStart, valEnd);
        results.push({ raw, spanStart: valStart, spanEnd: valEnd });
      }
    }
  }

  return results;
}

/**
 * Extracts media URLs from a single text string.
 */
export function extractMediaTokensFromText(
  text: string,
  options?: { scanBareUrls?: boolean },
): RawExtractedToken[] {
  if (!text || typeof text !== "string") return [];
  const scanBareUrls = options?.scanBareUrls ?? true;
  const tokens: RawExtractedToken[] = [];
  const consumedSpans: TextSpan[] = [];

  const pushCandidate = (
    raw: string,
    hint: "img" | "video" | "css" | "markdown" | "bare",
    spanStart: number,
    spanEnd: number,
  ) => {
    const token = normalizeRemoteMediaUrl(raw, hint);
    if (!token) return;
    tokens.push(token);
    if (spanEnd > spanStart) {
      consumedSpans.push({ start: spanStart, end: spanEnd });
    }
  };

  // 1. Markdown images: ![alt](url) and reference usages `![alt][ref]` / `![alt][]`
  const md = extractMarkdownImageCandidates(text);
  for (const item of md.inline) {
    pushCandidate(item.raw, "markdown", item.spanStart, item.spanEnd);
  }

  // 1b. Reference-style Markdown definitions `[ref]: url` referenced by images
  for (const def of extractReferenceDefinitionTargets(text, md.refUses)) {
    pushCandidate(def.raw, "markdown", def.spanStart, def.spanEnd);
  }

  // 2-4. HTML <img>, <image>, <video>, <source> tags (supporting quoted `>` and <source srcset>)
  scanHtmlMediaTags(text, HTML_MEDIA_TAGS, (tagName, attrs) => {
    if (tagName === "img" || tagName === "image") {
      for (const attr of attrs) {
        if (
          attr.name === "src" ||
          attr.name === "data-src" ||
          attr.name === "href" ||
          attr.name === "xlink:href"
        ) {
          pushCandidate(attr.value, "img", attr.valStart, attr.valEnd);
        } else if (attr.name === "srcset") {
          emitSrcsetCandidates(attr.value, attr.valStart, "img", pushCandidate);
        }
      }
    } else if (tagName === "video") {
      for (const attr of attrs) {
        if (attr.name === "src") {
          pushCandidate(attr.value, "video", attr.valStart, attr.valEnd);
        } else if (attr.name === "poster") {
          pushCandidate(attr.value, "img", attr.valStart, attr.valEnd);
        }
      }
    } else if (tagName === "source") {
      const isVideoType = attrs.some(
        (attr) =>
          attr.name === "type" &&
          attr.value.trim().toLowerCase().startsWith("video/"),
      );
      const hint: "img" | "video" = isVideoType ? "video" : "img";
      for (const attr of attrs) {
        if (attr.name === "src") {
          pushCandidate(attr.value, hint, attr.valStart, attr.valEnd);
        } else if (attr.name === "srcset") {
          emitSrcsetCandidates(attr.value, attr.valStart, hint, pushCandidate);
        }
      }
    }
  });

  // 5. CSS url(...)
  for (const css of extractCssUrlCandidates(text)) {
    pushCandidate(css.raw, "css", css.spanStart, css.spanEnd);
  }

  // 6. Bare media URLs — merge already-consumed spans so we only suppress overlapping ranges,
  // preserving repeated occurrences of the same URL in other parts of the text.
  if (scanBareUrls) {
    const mergedSpans: TextSpan[] = [];
    if (consumedSpans.length > 0) {
      consumedSpans.sort((a, b) => a.start - b.start || a.end - b.end);
      for (const span of consumedSpans) {
        const prev = mergedSpans[mergedSpans.length - 1];
        if (prev && span.start <= prev.end) {
          if (span.end > prev.end) prev.end = span.end;
        } else {
          mergedSpans.push({ start: span.start, end: span.end });
        }
      }
    }

    const bareUrlRe = /https?:\/\/[^\s"'<>)\]]+/gi;
    let spanIdx = 0;
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bareUrlRe.exec(text)) !== null) {
      const candidate = stripTrailingChars(bareMatch[0], ".,;!?");
      const bareStart = bareMatch.index;
      const bareEnd = bareStart + candidate.length;
      while (
        spanIdx < mergedSpans.length &&
        mergedSpans[spanIdx]!.end <= bareStart
      ) {
        spanIdx++;
      }
      const activeSpan = mergedSpans[spanIdx];
      if (
        activeSpan &&
        activeSpan.start < bareEnd &&
        bareStart < activeSpan.end
      ) {
        continue;
      }
      pushCandidate(candidate, "bare", bareStart, bareEnd);
    }
  }

  return tokens;
}

export interface ScannableCharacterInput {
  id: string;
  name: string;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  first_mes?: string | null;
  alternate_greetings?: string[] | null;
  mes_example?: string | null;
  system_prompt?: string | null;
  post_history_instructions?: string | null;
  creator_notes?: string | null;
  extensions?: Record<string, unknown> | null;
}

/**
 * Extracts normalized filename parts (`basename`, `stem`, `ext`) from a URL so
 * that native Gallery items can be matched back to their source URLs.
 */
export function deriveUrlFilenameParts(normalizedUrl: string): {
  basename: string;
  cleanedStem: string;
  ext: string;
} {
  try {
    const parsed = new URL(normalizedUrl);
    const rawSeg = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).pop() ?? "media",
    );
    const extMatch = /\.([a-z0-9]{2,5})$/i.exec(rawSeg);
    const queryFormat = parsed.searchParams.get("format")?.trim().toLowerCase() ?? "";
    const validQueryExt = /^(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|apng|mp4|webm|mov|m4v|ogv)$/i.test(queryFormat)
      ? queryFormat
      : "";
    const ext = extMatch?.[1]?.toLowerCase() || validQueryExt;
    const basename = !extMatch && validQueryExt ? `${rawSeg}.${validQueryExt}` : rawSeg;
    const cleanedStem = rawSeg
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .slice(0, 48);
    return {
      basename,
      cleanedStem: cleanedStem || "media",
      ext,
    };
  } catch {
    return {
      basename: "media",
      cleanedStem: "media",
      ext: "",
    };
  }
}

const NATIVE_IMG_TAGS = new Set(["img"]);
const NATIVE_BARE_URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const NATIVE_IMAGE_PATH_RE =
  /\.(?:apng|avif|bmp|gif|heic|heif|ico|jpe?g|jfif|pjp|pjpeg|png|svg|webp)$/i;
const NATIVE_TRAILING_PUNCTUATION_CHARS = "),.;!?'\"`]}";

function normalizeNativeExtractedCandidateUrl(raw: string): string | null {
  const cleaned = stripTrailingChars(
    stripWrappingAngleBrackets(
      stripTrailingChars(raw.trim(), NATIVE_TRAILING_PUNCTUATION_CHARS),
    ),
    NATIVE_TRAILING_PUNCTUATION_CHARS,
  );
  const lower = cleaned.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    return null;
  }
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (isBlockedRemoteHostname(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractNativeImageUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  const addCandidate = (raw: string | undefined, requireImagePath: boolean) => {
    if (!raw) return;
    const normalized = normalizeNativeExtractedCandidateUrl(raw);
    if (!normalized) return;
    if (requireImagePath) {
      try {
        const parsed = new URL(normalized);
        if (!NATIVE_IMAGE_PATH_RE.test(parsed.pathname)) {
          return;
        }
      } catch {
        return;
      }
    }
    urls.add(normalized);
  };

  const md = extractMarkdownImageCandidates(text);
  for (const item of md.inline) {
    const rawTarget = item.raw.trim().split(/\s+/)[0];
    addCandidate(rawTarget, false);
  }
  scanHtmlMediaTags(text, NATIVE_IMG_TAGS, (_tagName, attrs) => {
    for (const attr of attrs) {
      if (attr.name === "src") {
        addCandidate(attr.value, false);
      }
    }
  });
  for (const match of text.matchAll(NATIVE_BARE_URL_RE)) {
    addCandidate(match[0], true);
  }

  return [...urls];
}

/**
 * Replicates Lumiverse's native `extractImagesFromCharacter` URL scan order
 * (`src/services/character-gallery.service.ts`) so that images imported via the
 * native Gallery's "Embedded Images -> Import All" button while Media Localizer
 * was disabled (`original_filename === "extracted.<ext>"`) can be matched back
 * to their remote URLs without re-downloading.
 */
export function extractNativeGalleryUrlsFromCharacter(
  character: ScannableCharacterInput,
): string[] {
  const fieldsToScan: Array<string | null | undefined> = [
    character.first_mes,
    character.description,
    character.personality,
    character.scenario,
    character.mes_example,
    character.system_prompt,
    character.post_history_instructions,
    character.creator_notes,
    ...(character.alternate_greetings ?? []),
  ];

  if (character.extensions && Object.keys(character.extensions).length > 0) {
    try {
      fieldsToScan.push(JSON.stringify(character.extensions));
    } catch {
      // ignore
    }
  }

  const allUrls = new Set<string>();
  for (const field of fieldsToScan) {
    if (!field || typeof field !== "string") continue;
    for (const url of extractNativeImageUrlsFromText(field)) {
      const normalized = normalizeRemoteMediaUrl(url, "img")?.normalizedUrl;
      if (normalized) {
        allUrls.add(normalized);
      }
    }
  }

  return [...allUrls];
}

/**
 * Extracts `{ label -> { normalizedUrl, rawUrl } }` from `character.extensions.chub.expressions`
 * (mirroring Lumiverse's `extractChubExpressionAssets` in `src/services/chub-api.service.ts`)
 * so that if a card also references one of its expression URLs inline in text/greetings,
 * Media Localizer can pair it directly with the character's already-downloaded native expression
 * `imageId` without re-downloading.
 */
export function extractChubExpressionUrlMapFromExtensions(
  extensions: Record<string, unknown> | null | undefined,
): Map<string, { normalizedUrl: string; rawUrl: string }> {
  const result = new Map<string, { normalizedUrl: string; rawUrl: string }>();
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) {
    return result;
  }
  const chub = extensions.chub;
  if (!chub || typeof chub !== "object" || Array.isArray(chub)) {
    return result;
  }
  const outerExpr = (chub as Record<string, unknown>).expressions;
  if (!outerExpr || typeof outerExpr !== "object" || Array.isArray(outerExpr)) {
    return result;
  }
  const innerExpr = (outerExpr as Record<string, unknown>).expressions;
  const mappings =
    innerExpr && typeof innerExpr === "object" && !Array.isArray(innerExpr)
      ? (innerExpr as Record<string, unknown>)
      : (outerExpr as Record<string, unknown>);

  for (const [label, value] of Object.entries(mappings)) {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || typeof value !== "string") continue;
    const rawUrl = value.trim();
    if (!rawUrl.toLowerCase().startsWith("https://") && !rawUrl.toLowerCase().startsWith("http://")) {
      continue;
    }
    const normalized = normalizeRemoteMediaUrl(rawUrl, "img")?.normalizedUrl;
    if (!normalized) continue;
    if (!result.has(trimmedLabel)) {
      result.set(trimmedLabel, { normalizedUrl: normalized, rawUrl });
    }
  }
  return result;
}

/**
 * Extracts labeled native Lumiverse Expression entries (`imageId` + label + optional group)
 * from `character.extensions.expressions.mappings` and `character.extensions.expression_groups`.
 */
export function extractCharacterExpressions(
  extensions: Record<string, unknown> | null | undefined,
): LibraryExpressionItem[] {
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) {
    return [];
  }

  const results: LibraryExpressionItem[] = [];
  const seenKeys = new Set<string>();

  const pushEntry = (label: string, imageId: string, groupName?: string) => {
    const cleanId = imageId.trim();
    if (!cleanId) return;
    const cleanLabel = label.trim() || cleanId;
    const cleanGroup = groupName?.trim() || undefined;
    const dedupKey = `${cleanGroup ?? ""}::${cleanLabel.toLowerCase()}::${cleanId}`;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);
    results.push({
      label: cleanLabel,
      ...(cleanGroup ? { groupName: cleanGroup } : {}),
      imageId: cleanId,
      localUrl: `/api/v1/images/${encodeURIComponent(cleanId)}`,
    });
  };

  const expr = extensions.expressions;
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const mappings = (expr as Record<string, unknown>).mappings;
    if (mappings && typeof mappings === "object" && !Array.isArray(mappings)) {
      for (const [label, imgId] of Object.entries(mappings as Record<string, unknown>)) {
        if (typeof imgId !== "string" || !label.trim()) continue;
        pushEntry(label, imgId);
      }
    }
  }

  const groups = extensions.expression_groups;
  if (groups && typeof groups === "object" && !Array.isArray(groups)) {
    for (const [groupName, groupVal] of Object.entries(groups as Record<string, unknown>)) {
      if (!groupVal || typeof groupVal !== "object" || Array.isArray(groupVal)) continue;
      for (const [label, imgId] of Object.entries(groupVal as Record<string, unknown>)) {
        if (typeof imgId !== "string") continue;
        pushEntry(label, imgId, groupName);
      }
    }
  }

  return results;
}

/**
 * Collects all local `imageId`s currently assigned to the character's native Lumiverse
 * Expressions (`character.extensions.expressions.mappings` and `character.extensions.expression_groups`).
 */
export function collectCharacterExpressionImageIds(
  extensions: Record<string, unknown> | null | undefined,
): {
  byLabel: Map<string, string>;
  allImageIds: Set<string>;
} {
  const byLabel = new Map<string, string>();
  const allImageIds = new Set<string>();
  for (const item of extractCharacterExpressions(extensions)) {
    allImageIds.add(item.imageId);
    if (!item.groupName) {
      byLabel.set(item.label, item.imageId);
      byLabel.set(item.label.toLowerCase(), item.imageId);
    } else if (!byLabel.has(item.label)) {
      byLabel.set(item.label, item.imageId);
      byLabel.set(item.label.toLowerCase(), item.imageId);
    }
  }
  return { byLabel, allImageIds };
}

export interface ScannableWorldBookInput {
  id: string;
  name: string;
  entries: Array<{
    id?: string;
    comment?: string | null;
    content?: string | null;
  }>;
}

export interface ScannableRegexScriptInput {
  id: string;
  script_name: string;
  replace_string?: string | null;
}

export interface ScanLookupContext {
  override?: CharacterDownloadOverride | null;
  localizedByNormalizedUrl: ReadonlyMap<string, LocalizedAssetEntry>;
  failedByNormalizedUrl: ReadonlyMap<string, FailedUrlRecord>;
  scanBareUrls?: boolean;
}

function readGreetingTitle(
  extensions: Record<string, unknown> | null | undefined,
  greetingIndex: number,
): string | null {
  if (!extensions || typeof extensions !== "object") return null;
  const titles =
    (extensions.greeting_titles as Record<string, unknown> | undefined) ??
    (extensions.alternate_greeting_titles as Record<string, unknown> | undefined);
  if (titles && typeof titles === "object") {
    const val = titles[String(greetingIndex)];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

function createEmptySectionSummary(): SectionCountSummary {
  return {
    totalUnique: 0,
    remoteCount: 0,
    localizedCount: 0,
    failedCount: 0,
  };
}

export function scanCharacterMedia(
  character: ScannableCharacterInput,
  worldBooks: ScannableWorldBookInput[],
  regexScripts: ScannableRegexScriptInput[],
  lookup: ScanLookupContext,
): CharacterMediaScanResult {
  const itemMap = new Map<string, DiscoveredMediaItem>();
  let totalOccurrences = 0;

  const recordText = (text: string | null | undefined, source: MediaSourceRef) => {
    if (!text) return;
    const tokens = extractMediaTokensFromText(text, {
      scanBareUrls: lookup.scanBareUrls ?? true,
    });
    for (const token of tokens) {
      totalOccurrences++;
      let item = itemMap.get(token.normalizedUrl);
      if (!item) {
        const localized = lookup.localizedByNormalizedUrl.get(token.normalizedUrl);
        const failure = lookup.failedByNormalizedUrl.get(token.normalizedUrl);
        const status: DiscoveredMediaItem["status"] = localized
          ? "localized"
          : failure
            ? "failed"
            : "remote";

        item = {
          normalizedUrl: token.normalizedUrl,
          rawUrls: [token.rawUrl],
          domain: token.domain,
          mediaKind: token.mediaKind,
          sources: [source],
          occurrenceCount: 1,
          status,
          ...(localized ? { localizedEntry: localized } : {}),
          ...(failure && !localized ? { failureInfo: failure } : {}),
        };
        itemMap.set(token.normalizedUrl, item);
      } else {
        item.occurrenceCount++;
        if (!item.rawUrls.includes(token.rawUrl)) {
          item.rawUrls.push(token.rawUrl);
        }
        if (token.mediaKind === "video") {
          item.mediaKind = "video";
        }
        const alreadyHasSource = item.sources.some(
          (s) =>
            s.section === source.section &&
            s.label === source.label &&
            s.greetingIndex === source.greetingIndex &&
            s.worldBookId === source.worldBookId &&
            s.regexScriptId === source.regexScriptId,
        );
        if (!alreadyHasSource) {
          item.sources.push(source);
        }
      }
    }
  };

  // 1. Creator's Notes
  recordText(character.creator_notes, {
    section: "creator_notes",
    label: "Creator's Notes",
  });

  // 2. First Message
  recordText(character.first_mes, {
    section: "first_mes",
    label: "First Message",
  });

  // 3. Core Fields
  recordText(character.description, {
    section: "core_fields",
    label: "Description",
  });
  recordText(character.personality, {
    section: "core_fields",
    label: "Personality",
  });
  recordText(character.scenario, {
    section: "core_fields",
    label: "Scenario",
  });
  recordText(character.mes_example, {
    section: "core_fields",
    label: "Message Examples",
  });
  recordText(character.system_prompt, {
    section: "core_fields",
    label: "System Prompt",
  });
  recordText(character.post_history_instructions, {
    section: "core_fields",
    label: "Post-History Instructions",
  });

  // Also scan alternate_fields and other non-lorebook metadata inside character.extensions
  const altFields = character.extensions?.alternate_fields;
  if (altFields && typeof altFields === "object") {
    for (const [fieldName, variants] of Object.entries(altFields as Record<string, unknown>)) {
      if (!Array.isArray(variants)) continue;
      for (const variant of variants) {
        if (variant && typeof variant === "object" && typeof (variant as { content?: unknown }).content === "string") {
          const vLabel = typeof (variant as { label?: unknown }).label === "string"
            ? (variant as { label: string }).label
            : fieldName;
          recordText((variant as { content: string }).content, {
            section: "core_fields",
            label: `Alt ${fieldName}: ${vLabel}`,
          });
        }
      }
    }
  }

  if (character.extensions && typeof character.extensions === "object") {
    const ignoredExtKeys = new Set([
      "character_book",
      "alternate_fields",
      "risu_asset_map",
      "gallery_reference_names",
      "gallery_reference_sequence",
      "regex_scripts",
      "lumiverse_regex_scripts",
      "expressions",
      "expression_groups",
    ]);
    // Nested keys under `extensions.chub` (or similar extension blocks) that belong to
    // Lumiverse's native expression system rather than inline card/gallery media.
    const ignoredNestedKeys = new Set(["expressions", "alt_expressions"]);
    const walkExtValue = (val: unknown, label: string, depth: number): void => {
      if (depth > 5 || val == null) return;
      if (typeof val === "string") {
        if (val.includes("http://") || val.includes("https://")) {
          recordText(val, {
            section: "core_fields",
            label,
          });
        }
        return;
      }
      if (Array.isArray(val)) {
        for (const item of val) {
          walkExtValue(item, label, depth + 1);
        }
        return;
      }
      if (typeof val === "object") {
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          if (ignoredNestedKeys.has(k)) continue;
          walkExtValue(v, `${label}.${k}`, depth + 1);
        }
      }
    };
    for (const [extKey, extVal] of Object.entries(character.extensions)) {
      if (ignoredExtKeys.has(extKey)) continue;
      walkExtValue(extVal, `Extensions (${extKey})`, 0);
    }
  }

  // 4. Alternate Greetings
  const greetings = Array.isArray(character.alternate_greetings)
    ? character.alternate_greetings
    : [];
  for (let i = 0; i < greetings.length; i++) {
    const greetingIndex = i + 1;
    const customTitle = readGreetingTitle(character.extensions, greetingIndex);
    const label = customTitle
      ? `Greeting #${greetingIndex} (${customTitle})`
      : `Greeting #${greetingIndex}`;
    recordText(greetings[i], {
      section: "alternate_greetings",
      label,
      greetingIndex,
    });
  }

  // 5. Attached World Books
  for (const wb of worldBooks) {
    for (const entry of wb.entries || []) {
      const entryLabel = entry.comment?.trim()
        ? `${wb.name} (${entry.comment.trim()})`
        : wb.name;
      recordText(entry.content, {
        section: "world_books",
        label: entryLabel,
        worldBookId: wb.id,
        worldBookName: wb.name,
      });
    }
  }

  // 6. Character-scoped Regex Scripts
  for (const script of regexScripts) {
    recordText(script.replace_string, {
      section: "regex_scripts",
      label: script.script_name || "Regex Script",
      regexScriptId: script.id,
      regexScriptName: script.script_name || "Regex Script",
    });
  }

  const items = Array.from(itemMap.values());

  // Build section summaries
  const sectionCounts: Record<MediaSourceSection, SectionCountSummary> = {
    creator_notes: createEmptySectionSummary(),
    first_mes: createEmptySectionSummary(),
    core_fields: createEmptySectionSummary(),
    alternate_greetings: createEmptySectionSummary(),
    world_books: createEmptySectionSummary(),
    regex_scripts: createEmptySectionSummary(),
  };

  const greetingMap = new Map<number, GreetingBreakdownItem>();
  const worldBookMap = new Map<string, WorldBookBreakdownItem>();
  const domainMap = new Map<string, DomainBreakdownItem>();

  for (const item of items) {
    const seenSections = new Set<MediaSourceSection>();
    const seenGreetings = new Set<number>();
    const seenWorldBooks = new Set<string>();

    for (const src of item.sources) {
      if (!seenSections.has(src.section)) {
        seenSections.add(src.section);
        const summary = sectionCounts[src.section];
        summary.totalUnique++;
        if (item.status === "localized") summary.localizedCount++;
        else if (item.status === "failed") summary.failedCount++;
        else summary.remoteCount++;
      }

      if (src.section === "alternate_greetings" && typeof src.greetingIndex === "number") {
        if (!seenGreetings.has(src.greetingIndex)) {
          seenGreetings.add(src.greetingIndex);
          let gItem = greetingMap.get(src.greetingIndex);
          if (!gItem) {
            gItem = {
              greetingIndex: src.greetingIndex,
              label: src.label,
              totalUnique: 0,
              remoteCount: 0,
              localizedCount: 0,
              failedCount: 0,
            };
            greetingMap.set(src.greetingIndex, gItem);
          }
          gItem.totalUnique++;
          if (item.status === "localized") gItem.localizedCount++;
          else if (item.status === "failed") gItem.failedCount++;
          else gItem.remoteCount++;
        }
      }

      if (src.section === "world_books" && src.worldBookId) {
        if (!seenWorldBooks.has(src.worldBookId)) {
          seenWorldBooks.add(src.worldBookId);
          let wbItem = worldBookMap.get(src.worldBookId);
          if (!wbItem) {
            wbItem = {
              worldBookId: src.worldBookId,
              worldBookName: src.worldBookName || src.worldBookId,
              totalUnique: 0,
              remoteCount: 0,
              localizedCount: 0,
              failedCount: 0,
            };
            worldBookMap.set(src.worldBookId, wbItem);
          }
          wbItem.totalUnique++;
          if (item.status === "localized") wbItem.localizedCount++;
          else if (item.status === "failed") wbItem.failedCount++;
          else wbItem.remoteCount++;
        }
      }
    }

    let dItem = domainMap.get(item.domain);
    if (!dItem) {
      dItem = {
        domain: item.domain,
        totalUnique: 0,
        remoteCount: 0,
        localizedCount: 0,
        failedCount: 0,
      };
      domainMap.set(item.domain, dItem);
    }
    dItem.totalUnique++;
    if (item.status === "localized") dItem.localizedCount++;
    else if (item.status === "failed") dItem.failedCount++;
    else dItem.remoteCount++;
  }

  return {
    characterId: character.id,
    characterName: character.name,
    scannedAt: Date.now(),
    override: lookup.override ?? null,
    totalOccurrences,
    items,
    sectionCounts,
    greetingBreakdown: Array.from(greetingMap.values()).sort(
      (a, b) => a.greetingIndex - b.greetingIndex,
    ),
    worldBookBreakdown: Array.from(worldBookMap.values()).sort((a, b) =>
      a.worldBookName.localeCompare(b.worldBookName),
    ),
    domainBreakdown: Array.from(domainMap.values()).sort(
      (a, b) => b.totalUnique - a.totalUnique || a.domain.localeCompare(b.domain),
    ),
  };
}

function normalizeUrlFilterSet(urls?: string[]): Set<string> | null {
  if (!urls || urls.length === 0) return null;
  const set = new Set<string>();
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = normalizeRemoteMediaUrl(trimmed, "img")?.normalizedUrl;
    set.add(normalized ?? trimmed);
  }
  return set;
}

/**
 * Filters a character's discovered media items according to user-selected
 * granular download filter options. Only returns items that still need downloading
 * (`remote`, or `failed` when `includeFailed !== false`).
 */
export function filterScanItemsForDownload(
  scan: CharacterMediaScanResult,
  filter: Omit<DownloadFilterOptions, "characterIds">,
): DiscoveredMediaItem[] {
  const allowedSections = new Set<MediaSourceSection>(
    filter.sections && filter.sections.length > 0
      ? filter.sections
      : ALL_MEDIA_SECTIONS,
  );
  const allowedGreetings =
    filter.greetingIndices && filter.greetingIndices.length > 0
      ? new Set<number>(filter.greetingIndices)
      : null;
  const allowedWorldBooks =
    filter.worldBookIds && filter.worldBookIds.length > 0
      ? new Set<string>(filter.worldBookIds)
      : null;
  const allowedDomains =
    filter.domains && filter.domains.length > 0
      ? new Set<string>(
          filter.domains.map((d) => d.trim().toLowerCase()).filter(Boolean),
        )
      : null;
  const allowedKinds =
    filter.mediaKinds && filter.mediaKinds.length > 0
      ? new Set<MediaKind>(filter.mediaKinds)
      : null;
  const explicitSet = normalizeUrlFilterSet(filter.explicitUrls);
  const excludedSet = normalizeUrlFilterSet(filter.excludedUrls);
  const includeFailed = filter.includeFailed ?? true;

  return scan.items.filter((item) => {
    if (item.status === "localized") return false;
    if (item.status === "failed" && !includeFailed) return false;
    if (excludedSet?.has(item.normalizedUrl)) return false;
    if (explicitSet && !explicitSet.has(item.normalizedUrl)) return false;
    if (allowedDomains && !allowedDomains.has(item.domain.toLowerCase())) {
      return false;
    }
    if (allowedKinds && !allowedKinds.has(item.mediaKind)) {
      return false;
    }

    // Check if at least one source of this item matches the selected sections & sub-filters
    return item.sources.some((src) => {
      if (!allowedSections.has(src.section)) return false;
      if (
        src.section === "alternate_greetings" &&
        allowedGreetings !== null &&
        (typeof src.greetingIndex !== "number" || !allowedGreetings.has(src.greetingIndex))
      ) {
        return false;
      }
      if (
        src.section === "world_books" &&
        allowedWorldBooks !== null &&
        (!src.worldBookId || !allowedWorldBooks.has(src.worldBookId))
      ) {
        return false;
      }
      return true;
    });
  });
}

