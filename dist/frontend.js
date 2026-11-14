// src/shared/types.ts
var ALL_MEDIA_SECTIONS = [
  "creator_notes",
  "first_mes",
  "core_fields",
  "alternate_greetings",
  "world_books",
  "regex_scripts"
];
var SECTION_LABELS = {
  creator_notes: "Creator's Notes",
  first_mes: "First Message",
  core_fields: "Description & Core Fields",
  alternate_greetings: "Alternate Greetings",
  world_books: "Attached World Books",
  regex_scripts: "Character Regex Scripts"
};
var ALL_MEDIA_KINDS = ["image", "video"];
var DEFAULT_SETTINGS = {
  defaultSections: [
    "creator_notes",
    "first_mes",
    "core_fields",
    "alternate_greetings"
  ],
  defaultMediaKinds: ["image", "video"],
  defaultIncludeFailed: true,
  defaultBatchCap: 50,
  confirmThreshold: 25,
  maxFileSizeMb: 25,
  timeoutSeconds: 20,
  concurrency: 2,
  scanBareUrls: true,
  autoLocalizeOnOpen: false,
  deleteImagesOnPurge: true,
  autoLinkGallery: true,
  adoptNativeGalleryImages: true
};
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return "0 B";
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// src/shared/download-config.ts
var MAX_FILTER_ARRAY_ITEMS = 5000;
var MAX_FILTER_STRING_LEN = 2048;
function uniqueStrings(values) {
  if (!Array.isArray(values))
    return;
  const out = [];
  const seen = new Set;
  for (const item of values) {
    if (out.length >= MAX_FILTER_ARRAY_ITEMS)
      break;
    if (typeof item !== "string")
      continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_FILTER_STRING_LEN || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
function uniqueNumbers(values) {
  if (!Array.isArray(values))
    return;
  const out = [];
  const seen = new Set;
  for (const item of values) {
    if (out.length >= MAX_FILTER_ARRAY_ITEMS)
      break;
    if (typeof item !== "number" || !Number.isFinite(item))
      continue;
    const n = Math.floor(item);
    if (n < 0 || seen.has(n))
      continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
var MAX_BATCH_ITEMS = 2000;
function clampBoundedInt(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
function sanitizeNonNegativeInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return;
  }
  return Math.floor(value);
}
function sanitizeOverride(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = raw;
  const out = {};
  if (Array.isArray(obj.sections)) {
    const valid = Array.from(new Set(obj.sections.filter((s) => typeof s === "string" && ALL_MEDIA_SECTIONS.includes(s))));
    if (valid.length > 0) {
      out.sections = valid;
    }
  }
  const greetingIndices = uniqueNumbers(obj.greetingIndices);
  if (greetingIndices && greetingIndices.length > 0) {
    out.greetingIndices = greetingIndices;
  }
  const worldBookIds = uniqueStrings(obj.worldBookIds);
  if (worldBookIds && worldBookIds.length > 0) {
    out.worldBookIds = worldBookIds;
  }
  const rawDomains = uniqueStrings(obj.domains);
  if (rawDomains && rawDomains.length > 0) {
    const domains = Array.from(new Set(rawDomains.map((d) => d.toLowerCase())));
    if (domains.length > 0) {
      out.domains = domains;
    }
  }
  if (Array.isArray(obj.mediaKinds)) {
    const validKinds = Array.from(new Set(obj.mediaKinds.filter((k) => typeof k === "string" && ALL_MEDIA_KINDS.includes(k))));
    if (validKinds.length > 0) {
      out.mediaKinds = validKinds;
    }
  }
  if (typeof obj.includeFailed === "boolean") {
    out.includeFailed = obj.includeFailed;
  }
  const maxItems = sanitizeNonNegativeInt(obj.maxItems);
  if (maxItems !== undefined) {
    out.maxItems = Math.min(MAX_BATCH_ITEMS, maxItems);
  }
  const excludedUrls = uniqueStrings(obj.excludedUrls);
  if (excludedUrls && excludedUrls.length > 0) {
    out.excludedUrls = excludedUrls;
  }
  return out;
}
function isOverrideEmpty(override) {
  if (!override)
    return true;
  const clean = sanitizeOverride(override);
  return Object.keys(clean).length === 0;
}
function buildEffectiveFilter(settings, scan, override) {
  const rawOverride = override !== undefined ? override : scan?.override ?? null;
  const effOverride = rawOverride ? sanitizeOverride(rawOverride) : null;
  const settingsSections = Array.isArray(settings.defaultSections) ? Array.from(new Set(settings.defaultSections.filter((s) => ALL_MEDIA_SECTIONS.includes(s)))) : [];
  const sections = effOverride?.sections && effOverride.sections.length > 0 ? [...effOverride.sections] : settingsSections.length > 0 ? settingsSections : [...ALL_MEDIA_SECTIONS];
  const settingsKinds = Array.isArray(settings.defaultMediaKinds) ? Array.from(new Set(settings.defaultMediaKinds.filter((k) => ALL_MEDIA_KINDS.includes(k)))) : [];
  const mediaKinds = effOverride?.mediaKinds && effOverride.mediaKinds.length > 0 ? [...effOverride.mediaKinds] : settingsKinds.length > 0 ? settingsKinds : [...ALL_MEDIA_KINDS];
  const includeFailed = typeof effOverride?.includeFailed === "boolean" ? effOverride.includeFailed : typeof settings.defaultIncludeFailed === "boolean" ? settings.defaultIncludeFailed : DEFAULT_SETTINGS.defaultIncludeFailed;
  const defaultBatchCap = Math.min(MAX_BATCH_ITEMS, sanitizeNonNegativeInt(settings.defaultBatchCap) ?? DEFAULT_SETTINGS.defaultBatchCap);
  const maxItems = effOverride?.maxItems !== undefined ? effOverride.maxItems : defaultBatchCap;
  const maxFileSizeMb = clampBoundedInt(settings.maxFileSizeMb, 1, 200, DEFAULT_SETTINGS.maxFileSizeMb);
  const timeoutSeconds = clampBoundedInt(settings.timeoutSeconds, 5, 120, DEFAULT_SETTINGS.timeoutSeconds);
  const concurrency = clampBoundedInt(settings.concurrency, 1, 5, DEFAULT_SETTINGS.concurrency);
  const filter = {
    sections,
    mediaKinds,
    includeFailed,
    maxItems,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    timeoutMs: timeoutSeconds * 1000,
    concurrency
  };
  if (effOverride?.greetingIndices && effOverride.greetingIndices.length > 0) {
    filter.greetingIndices = [...effOverride.greetingIndices];
  }
  if (effOverride?.worldBookIds && effOverride.worldBookIds.length > 0) {
    filter.worldBookIds = [...effOverride.worldBookIds];
  }
  if (effOverride?.domains && effOverride.domains.length > 0) {
    filter.domains = [...effOverride.domains];
  }
  if (effOverride?.excludedUrls && effOverride.excludedUrls.length > 0) {
    filter.excludedUrls = [...effOverride.excludedUrls];
  }
  return filter;
}

// src/shared/url-scanner.ts
var VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v|ogv)$/i;
var IMAGE_EXT_RE = /\.(?:png|jpe?g|jfif|pjp|pjpeg|gif|webp|avif|bmp|ico|apng)$/i;
var EXCLUDED_ASSET_EXT_RE = /\.(?:svg|woff2?|ttf|otf|eot|css|js|mjs|json|xml|html?|txt|pdf|zip|rar|7z|mp3|wav|ogg|flac|m4a)$/i;
var EXCLUDED_DOMAIN_RE = /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.fontawesome\.com|cdnjs\.cloudflare\.com)$/i;
var BLOCKED_HOSTNAME_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.goog",
  "metadata.google.internal"
]);
var BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".arpa"
];
function parseDottedIpv4Octets(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m)
    return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255)
    return null;
  return [a, b, c, d];
}
function isBlockedIpv4Octets(a, b, c, _d) {
  if (a === 0)
    return true;
  if (a === 10)
    return true;
  if (a === 100 && b >= 64 && b <= 127)
    return true;
  if (a === 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  if (a === 192 && b === 0 && c === 0)
    return true;
  if (a === 192 && b === 0 && c === 2)
    return true;
  if (a === 192 && b === 88 && c === 99)
    return true;
  if (a === 192 && b === 168)
    return true;
  if (a === 198 && (b === 18 || b === 19))
    return true;
  if (a === 198 && b === 51 && c === 100)
    return true;
  if (a === 203 && b === 0 && c === 113)
    return true;
  if (a >= 224)
    return true;
  return false;
}
function isBlockedIpv4Words(hi, lo) {
  return isBlockedIpv4Octets(hi >> 8 & 255, hi & 255, lo >> 8 & 255, lo & 255);
}
function parseIpv6Groups(ip) {
  const doubleColonIdx = ip.indexOf("::");
  if (doubleColonIdx !== -1 && ip.indexOf("::", doubleColonIdx + 2) !== -1) {
    return null;
  }
  const parseSide = (side, allowIpv4Tail) => {
    if (!side)
      return [];
    const parts = side.split(":");
    const out = [];
    for (let i = 0;i < parts.length; i++) {
      const part = parts[i];
      if (!part)
        return null;
      if (part.includes(".")) {
        if (!allowIpv4Tail || i !== parts.length - 1)
          return null;
        const octets = parseDottedIpv4Octets(part);
        if (!octets)
          return null;
        out.push(octets[0] << 8 | octets[1], octets[2] << 8 | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part))
          return null;
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
  if (!left || !right)
    return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1)
    return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}
function isBlockedIpv6Address(ip) {
  const g = parseIpv6Groups(ip);
  if (!g)
    return true;
  const g0 = g[0];
  const g1 = g[1];
  const g2 = g[2];
  const g3 = g[3];
  const g4 = g[4];
  const g5 = g[5];
  const g6 = g[6];
  const g7 = g[7];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (g6 === 0 && (g7 === 0 || g7 === 1))
      return true;
    return isBlockedIpv4Words(g6, g7);
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 65535) {
    return isBlockedIpv4Words(g6, g7);
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 65535 && g5 === 0) {
    return isBlockedIpv4Words(g6, g7);
  }
  if (g0 === 100 && g1 === 65435) {
    if (g2 === 1)
      return true;
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return isBlockedIpv4Words(g6, g7);
    }
  }
  if (g0 === 256 && g1 === 0 && g2 === 0 && g3 === 0)
    return true;
  if (g0 === 8193 && (g1 === 0 || g1 === 3512))
    return true;
  if (g0 === 8194) {
    return isBlockedIpv4Words(g1, g2);
  }
  if ((g0 & 65024) === 64512)
    return true;
  if ((g0 & 65472) === 65152 || (g0 & 65472) === 65216)
    return true;
  if ((g0 & 65280) === 65280)
    return true;
  return false;
}
function normalizeHostCandidate(rawHostname) {
  let host = rawHostname.trim().toLowerCase();
  if (!host)
    return null;
  if (/[\s/\\?#%@!]/.test(host))
    return null;
  if (host.startsWith("[")) {
    const closeIdx = host.indexOf("]");
    if (closeIdx === -1)
      return null;
    const after = host.slice(closeIdx + 1);
    if (after && !/^:\d+$/.test(after))
      return null;
    host = host.slice(1, closeIdx);
  } else {
    const firstColon = host.indexOf(":");
    const lastColon = host.lastIndexOf(":");
    if (firstColon !== -1 && firstColon === lastColon) {
      const port = host.slice(firstColon + 1);
      if (!/^\d+$/.test(port))
        return null;
      host = host.slice(0, firstColon);
    }
  }
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (!host)
    return null;
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
function isBlockedRemoteHostname(hostname) {
  if (typeof hostname !== "string")
    return true;
  const host = normalizeHostCandidate(hostname);
  if (!host)
    return true;
  if (host.includes(":")) {
    return isBlockedIpv6Address(host);
  }
  if (BLOCKED_HOSTNAME_EXACT.has(host))
    return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  if (!host.includes("."))
    return true;
  const ipv4 = parseDottedIpv4Octets(host);
  if (ipv4) {
    return isBlockedIpv4Octets(ipv4[0], ipv4[1], ipv4[2], ipv4[3]);
  }
  return false;
}
function decodeHtmlEntities(input) {
  return input.replace(/&amp;/gi, "&").replace(/&#38;/g, "&").replace(/&#x26;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'");
}
function normalizeRemoteMediaUrl(rawInput, contextHint) {
  const trimmed = rawInput.trim();
  if (!trimmed)
    return null;
  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || lower.startsWith("data:") || lower.startsWith("blob:") || lower.startsWith("gallery://") || lower.startsWith("embeded://") || lower.startsWith("embedded://") || lower.startsWith("javascript:") || lower.startsWith("mailto:")) {
    return null;
  }
  const decoded = decodeHtmlEntities(trimmed);
  let parsed;
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
  parsed.hash = "";
  const normalizedUrl = parsed.href;
  const pathname = parsed.pathname;
  if (EXCLUDED_ASSET_EXT_RE.test(pathname)) {
    return null;
  }
  if (/\/api\/v1\/images\/[0-9a-f-]+/i.test(pathname)) {
    return null;
  }
  const isVideoExt = VIDEO_EXT_RE.test(pathname);
  const isImageExt = IMAGE_EXT_RE.test(pathname);
  if (contextHint === "bare") {
    if (!isVideoExt && !isImageExt)
      return null;
  }
  const mediaKind = contextHint === "video" || isVideoExt ? "video" : "image";
  return {
    rawUrl: trimmed,
    normalizedUrl,
    domain,
    mediaKind
  };
}
function isAsciiWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === `
` || ch === "\r" || ch === "\f";
}
var HTML_MEDIA_TAGS = new Set(["img", "image", "video", "source"]);
function parseSrcsetCandidates(srcsetVal) {
  const candidates = [];
  const len = srcsetVal.length;
  let i = 0;
  while (i < len) {
    while (i < len && (isAsciiWhitespace(srcsetVal[i]) || srcsetVal[i] === ",")) {
      i++;
    }
    if (i >= len)
      break;
    const urlStart = i;
    while (i < len && !isAsciiWhitespace(srcsetVal[i])) {
      i++;
    }
    let urlEnd = i;
    let hadTrailingComma = false;
    while (urlEnd > urlStart && srcsetVal[urlEnd - 1] === ",") {
      urlEnd--;
      hadTrailingComma = true;
    }
    const url = srcsetVal.slice(urlStart, urlEnd);
    let descriptors = "";
    if (!hadTrailingComma) {
      while (i < len && isAsciiWhitespace(srcsetVal[i])) {
        i++;
      }
      const descStart = i;
      let parenDepth = 0;
      while (i < len) {
        const ch = srcsetVal[i];
        if (ch === "(") {
          parenDepth++;
        } else if (ch === ")" && parenDepth > 0) {
          parenDepth--;
        } else if (ch === "," && parenDepth === 0) {
          break;
        }
        i++;
      }
      descriptors = srcsetVal.slice(descStart, i).trim();
      if (i < len && srcsetVal[i] === ",") {
        i++;
      }
    }
    if (url) {
      candidates.push({ url, urlStart, urlEnd, descriptors });
    }
  }
  return candidates;
}
var NATIVE_IMG_TAGS = new Set(["img"]);
function normalizeUrlFilterSet(urls) {
  if (!urls || urls.length === 0)
    return null;
  const set = new Set;
  for (const raw of urls) {
    if (typeof raw !== "string")
      continue;
    const trimmed = raw.trim();
    if (!trimmed)
      continue;
    const normalized = normalizeRemoteMediaUrl(trimmed, "img")?.normalizedUrl;
    set.add(normalized ?? trimmed);
  }
  return set;
}
function filterScanItemsForDownload(scan, filter) {
  const allowedSections = new Set(filter.sections && filter.sections.length > 0 ? filter.sections : ALL_MEDIA_SECTIONS);
  const allowedGreetings = filter.greetingIndices && filter.greetingIndices.length > 0 ? new Set(filter.greetingIndices) : null;
  const allowedWorldBooks = filter.worldBookIds && filter.worldBookIds.length > 0 ? new Set(filter.worldBookIds) : null;
  const allowedDomains = filter.domains && filter.domains.length > 0 ? new Set(filter.domains.map((d) => d.trim().toLowerCase()).filter(Boolean)) : null;
  const allowedKinds = filter.mediaKinds && filter.mediaKinds.length > 0 ? new Set(filter.mediaKinds) : null;
  const explicitSet = normalizeUrlFilterSet(filter.explicitUrls);
  const excludedSet = normalizeUrlFilterSet(filter.excludedUrls);
  const includeFailed = filter.includeFailed ?? true;
  return scan.items.filter((item) => {
    if (item.status === "localized")
      return false;
    if (item.status === "failed" && !includeFailed)
      return false;
    if (excludedSet?.has(item.normalizedUrl))
      return false;
    if (explicitSet && !explicitSet.has(item.normalizedUrl))
      return false;
    if (allowedDomains && !allowedDomains.has(item.domain.toLowerCase())) {
      return false;
    }
    if (allowedKinds && !allowedKinds.has(item.mediaKind)) {
      return false;
    }
    return item.sources.some((src) => {
      if (!allowedSections.has(src.section))
        return false;
      if (src.section === "alternate_greetings" && allowedGreetings !== null && (typeof src.greetingIndex !== "number" || !allowedGreetings.has(src.greetingIndex))) {
        return false;
      }
      if (src.section === "world_books" && allowedWorldBooks !== null && (!src.worldBookId || !allowedWorldBooks.has(src.worldBookId))) {
        return false;
      }
      return true;
    });
  });
}

// src/ui/ui-helpers.ts
function hasBalancedParens(value) {
  let depth = 0;
  for (let i = 0;i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth < 0)
        return false;
    }
  }
  return depth === 0;
}
function sanitizeSafeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string")
    return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed))
    return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) {
    if (/[\s"'\\<>()`]/.test(trimmed))
      return null;
    return trimmed;
  }
  if (/[\s"'\\<>`]/.test(trimmed) || !hasBalancedParens(trimmed))
    return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}
function safeOpenExternalUrl(rawUrl) {
  const safeUrl = sanitizeSafeMediaUrl(rawUrl);
  if (!safeUrl || typeof window === "undefined")
    return false;
  window.open(safeUrl, "_blank", "noopener,noreferrer");
  return true;
}
function canOpenNativeCharacterEditor(ctx) {
  const invoke = ctx?.host?.surfaces?.invoke;
  return typeof invoke === "function";
}
async function openNativeCharacterEditor(ctx, characterId) {
  const trimmedId = typeof characterId === "string" ? characterId.trim() : "";
  if (!trimmedId)
    return false;
  const capCtx = ctx;
  const invoke = capCtx?.host?.surfaces?.invoke;
  if (typeof invoke !== "function")
    return false;
  try {
    await invoke({ kind: "modal", id: "character_editor" }, { id: trimmedId });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("PERMISSION_DENIED") && typeof capCtx?.permissions?.request === "function") {
      try {
        const granted = await capCtx.permissions.request(["characters"], {
          reason: "Allow Media Localizer to open Lumiverse's native Character Editor for this card."
        });
        if (Array.isArray(granted) && granted.includes("characters")) {
          await invoke({ kind: "modal", id: "character_editor" }, { id: trimmedId });
          return true;
        }
      } catch {}
    }
    try {
      await invoke({ kind: "route", id: "/characters/:id" }, { id: trimmedId });
      return true;
    } catch {
      console.warn("[media_localizer] Failed to open native Character Editor:", err);
      return false;
    }
  }
}
var ICON_PATHS = {
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  group: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  "chevron-left": '<polyline points="15 18 9 12 15 6"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  "external-link": '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  "rotate-ccw": '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  "arrow-up": '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  "arrow-down": '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'
};
function createIcon(name, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ml-icon");
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}
function createIconButton(options) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = options.className ?? "ml-btn ml-icon-btn";
  btn.title = options.title;
  btn.setAttribute("aria-label", options.title);
  if (options.disabled)
    btn.disabled = true;
  btn.appendChild(createIcon(options.icon, options.size ?? 14));
  if (options.label) {
    const span = document.createElement("span");
    span.textContent = options.label;
    btn.appendChild(span);
  }
  btn.addEventListener("click", options.onClick);
  return btn;
}
var activeTipCloseFn = null;
var activeTipTrigger = null;
var tipDocListenersAttached = false;
function onTipDocumentClick(ev) {
  if (!activeTipCloseFn)
    return;
  if (activeTipTrigger && activeTipTrigger.isConnected === false) {
    activeTipCloseFn();
    return;
  }
  const target = ev.target;
  if (target && target.closest?.(".ml-tip-wrap.is-open")) {
    return;
  }
  activeTipCloseFn();
}
function onTipDocumentKeyDown(ev) {
  if (!activeTipCloseFn)
    return;
  if (activeTipTrigger && activeTipTrigger.isConnected === false) {
    activeTipCloseFn();
    return;
  }
  if (ev.key === "Escape") {
    activeTipCloseFn();
  }
}
function ensureTipDocListeners() {
  if (tipDocListenersAttached || typeof document === "undefined")
    return;
  if (typeof document.addEventListener !== "function")
    return;
  document.addEventListener("click", onTipDocumentClick);
  document.addEventListener("keydown", onTipDocumentKeyDown);
  tipDocListenersAttached = true;
}
function detachTipDocListeners() {
  if (!tipDocListenersAttached || typeof document === "undefined")
    return;
  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("click", onTipDocumentClick);
    document.removeEventListener("keydown", onTipDocumentKeyDown);
  }
  tipDocListenersAttached = false;
}
function createInfoTip(text) {
  const wrap = document.createElement("span");
  wrap.className = "ml-tip-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ml-tip-btn";
  btn.setAttribute("aria-label", text);
  btn.title = text;
  btn.appendChild(createIcon("info", 12));
  const popover = document.createElement("div");
  popover.className = "ml-tip-popover";
  popover.setAttribute("role", "tooltip");
  popover.textContent = text;
  const updateTipAlignment = () => {
    wrap.classList.remove("is-align-right");
    popover.style.left = "";
    popover.style.right = "";
    popover.style.maxWidth = "";
    if (typeof wrap.getBoundingClientRect !== "function")
      return;
    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect || wrapRect.width <= 0)
      return;
    const container = wrap.closest?.(".ml-drawer-body, .ml-gallery-host, .ml-widget");
    const boundsRect = typeof container?.getBoundingClientRect === "function" ? container.getBoundingClientRect() : null;
    const winWidth = typeof window !== "undefined" && typeof window.innerWidth === "number" ? window.innerWidth : 0;
    const leftBound = boundsRect && boundsRect.width > 0 ? boundsRect.left + 8 : 8;
    const rightBound = boundsRect && boundsRect.width > 0 ? boundsRect.right - 8 : winWidth > 0 ? winWidth - 8 : 0;
    if (rightBound <= leftBound)
      return;
    const popRect = typeof popover.getBoundingClientRect === "function" ? popover.getBoundingClientRect() : null;
    const clampedMaxWidth = Math.max(120, Math.floor(rightBound - leftBound));
    const tipWidth = popRect && popRect.width > 0 ? popRect.width : Math.min(240, clampedMaxWidth);
    if (wrapRect.left + tipWidth > rightBound) {
      if (wrapRect.right - tipWidth >= leftBound) {
        wrap.classList.add("is-align-right");
      } else {
        const targetLeft = Math.max(leftBound, Math.min(wrapRect.left, rightBound - Math.min(tipWidth, clampedMaxWidth)));
        popover.style.left = `${Math.round(targetLeft - wrapRect.left)}px`;
        popover.style.right = "auto";
        popover.style.maxWidth = `${clampedMaxWidth}px`;
      }
    } else if (popRect && popRect.width > 0 && popRect.left < leftBound) {
      const targetLeft = Math.max(leftBound, wrapRect.left);
      popover.style.left = `${Math.round(targetLeft - wrapRect.left)}px`;
      popover.style.right = "auto";
      popover.style.maxWidth = `${clampedMaxWidth}px`;
    }
  };
  const close = () => {
    wrap.classList.remove("is-open", "is-align-right");
    popover.style.left = "";
    popover.style.right = "";
    popover.style.maxWidth = "";
    if (activeTipCloseFn === close) {
      activeTipCloseFn = null;
      activeTipTrigger = null;
      detachTipDocListeners();
    }
  };
  wrap.addEventListener("pointerenter", updateTipAlignment);
  btn.addEventListener("focus", updateTipAlignment);
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    const wasOpen = wrap.classList.contains("is-open");
    if (activeTipCloseFn && activeTipCloseFn !== close) {
      activeTipCloseFn();
    }
    if (wasOpen) {
      close();
    } else {
      wrap.classList.add("is-open");
      activeTipCloseFn = close;
      activeTipTrigger = wrap;
      ensureTipDocListeners();
      updateTipAlignment();
    }
  });
  wrap.append(btn, popover);
  return wrap;
}
function isQueueActiveStatus(status) {
  return status === "running" || status === "paused" || status === "cancelling";
}
function renderQueueBanner(q, onQueueControl) {
  const banner = document.createElement("div");
  const stateClass = q.status === "paused" ? "is-paused" : q.status === "cancelling" ? "is-cancelling" : "is-running";
  banner.className = `ml-queue-banner ${stateClass}`;
  const topRow = document.createElement("div");
  topRow.className = "ml-header-bar";
  const statusWrap = document.createElement("div");
  statusWrap.className = "ml-inline-title";
  const statusIcon = createIcon(q.status === "paused" ? "pause" : q.status === "cancelling" ? "rotate-ccw" : "download", 13);
  const statusText = document.createElement("span");
  statusText.className = "ml-queue-status-text";
  const pct = q.totalQueued > 0 ? Math.min(100, Math.round(q.completedCount / q.totalQueued * 100)) : 0;
  const stateLabel = q.status === "paused" ? "Paused" : q.status === "cancelling" ? "Stopping..." : "Downloading";
  statusText.textContent = `${stateLabel}: ${q.completedCount} / ${q.totalQueued} (${pct}%)`;
  statusWrap.append(statusIcon, statusText);
  const controls = document.createElement("div");
  controls.className = "ml-header-actions";
  if (q.status === "running") {
    controls.appendChild(createIconButton({
      icon: "pause",
      label: "Pause",
      title: "Pause active downloads",
      className: "ml-btn is-sm",
      size: 12,
      onClick: () => void onQueueControl("pause")
    }));
  } else if (q.status === "paused") {
    controls.appendChild(createIconButton({
      icon: "download",
      label: "Resume",
      title: "Resume paused downloads",
      className: "ml-btn is-primary is-sm",
      size: 12,
      onClick: () => void onQueueControl("resume")
    }));
  }
  if (q.activeUrls.length > 0) {
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "ml-btn is-sm";
    skipBtn.textContent = "Skip File";
    skipBtn.title = "Abort only the currently downloading file and move to the next";
    skipBtn.addEventListener("click", () => void onQueueControl("skip_current"));
    controls.appendChild(skipBtn);
  }
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ml-btn is-danger is-sm";
  cancelBtn.textContent = "Cancel All";
  cancelBtn.title = "Immediately stop all active downloads and clear the queue";
  cancelBtn.addEventListener("click", () => void onQueueControl("cancel_all"));
  controls.appendChild(cancelBtn);
  topRow.append(statusWrap, controls);
  const track = document.createElement("div");
  track.className = "ml-progress-track";
  const fill = document.createElement("div");
  fill.className = q.status === "running" ? "ml-progress-fill is-active" : "ml-progress-fill";
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  const statStrip = document.createElement("div");
  statStrip.className = "ml-stat-strip";
  const savedChip = document.createElement("span");
  savedChip.className = "ml-stat-chip is-success";
  savedChip.textContent = `${q.succeededCount} saved`;
  const skippedChip = document.createElement("span");
  skippedChip.className = "ml-stat-chip is-muted";
  skippedChip.textContent = `${q.skippedCount} skipped`;
  const failedChip = document.createElement("span");
  failedChip.className = q.failedCount > 0 ? "ml-stat-chip is-danger" : "ml-stat-chip is-muted";
  failedChip.textContent = `${q.failedCount} failed`;
  statStrip.append(savedChip, skippedChip, failedChip);
  banner.append(topRow, track, statStrip);
  if (q.activeUrls.length > 0) {
    const activeLine = document.createElement("div");
    activeLine.className = "ml-url-sources";
    activeLine.textContent = `Active: ${q.activeUrls.map((a) => a.url).join(" | ")}`;
    banner.appendChild(activeLine);
  }
  return banner;
}
function renderSharedDownloadConfigControls(options) {
  const wrap = document.createElement("div");
  wrap.className = "ml-stack";
  const secHeader = document.createElement("div");
  secHeader.className = "ml-config-label-row";
  const secTitle = document.createElement("span");
  secTitle.className = "ml-config-label";
  secTitle.textContent = "Filter by Card Section";
  secHeader.appendChild(secTitle);
  if (options.sectionTip) {
    secHeader.appendChild(createInfoTip(options.sectionTip));
  }
  wrap.appendChild(secHeader);
  const secGrid = document.createElement("div");
  secGrid.className = "ml-checkbox-grid";
  for (const section of ALL_MEDIA_SECTIONS) {
    const countInfo = options.sectionCounts?.[section];
    const lbl = document.createElement("label");
    lbl.className = "ml-checkbox-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = options.state.sections.has(section);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        options.state.sections.add(section);
      } else if (options.state.sections.size > 1) {
        options.state.sections.delete(section);
      } else {
        cb.checked = true;
        return;
      }
      options.onChange(options.state);
    });
    const text = document.createElement("span");
    if (countInfo) {
      const pending = countInfo.remoteCount + countInfo.failedCount;
      text.textContent = `${SECTION_LABELS[section]} (${pending} pending / ${countInfo.totalUnique})`;
    } else {
      text.textContent = SECTION_LABELS[section];
    }
    lbl.append(cb, text);
    secGrid.appendChild(lbl);
  }
  wrap.appendChild(secGrid);
  const row = document.createElement("div");
  row.className = "ml-checkbox-grid";
  for (const kind of ALL_MEDIA_KINDS) {
    const lbl = document.createElement("label");
    lbl.className = "ml-checkbox-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = options.state.mediaKinds.has(kind);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        options.state.mediaKinds.add(kind);
      } else if (options.state.mediaKinds.size > 1) {
        options.state.mediaKinds.delete(kind);
      } else {
        cb.checked = true;
        return;
      }
      options.onChange(options.state);
    });
    const span = document.createElement("span");
    span.textContent = kind === "image" ? "Images" : "Videos";
    lbl.append(cb, span);
    row.appendChild(lbl);
  }
  const failedLbl = document.createElement("label");
  failedLbl.className = "ml-checkbox-item";
  const failedCb = document.createElement("input");
  failedCb.type = "checkbox";
  failedCb.checked = options.state.includeFailed;
  failedCb.addEventListener("change", () => {
    options.state.includeFailed = failedCb.checked;
    options.onChange(options.state);
  });
  const failedSpan = document.createElement("span");
  failedSpan.textContent = "Retry previously failed URLs";
  failedLbl.append(failedCb, failedSpan);
  row.appendChild(failedLbl);
  const capLbl = document.createElement("label");
  capLbl.className = "ml-checkbox-item";
  capLbl.title = options.batchCapHint ?? "0 = unlimited";
  const capSpan = document.createElement("span");
  capSpan.textContent = "Limit:";
  const capInput = document.createElement("input");
  capInput.type = "number";
  capInput.className = "ml-input-num";
  capInput.min = "0";
  capInput.max = "2000";
  capInput.value = String(options.state.batchCap);
  capInput.addEventListener("change", () => {
    const rawNum = Number(capInput.value);
    const parsed = Number.isFinite(rawNum) ? Math.min(2000, Math.max(0, Math.floor(rawNum))) : options.state.batchCap;
    capInput.value = String(parsed);
    options.state.batchCap = parsed;
    options.onChange(options.state);
  });
  capLbl.append(capSpan, capInput, createInfoTip("Maximum URLs queued per batch (0 = unlimited)."));
  row.appendChild(capLbl);
  wrap.appendChild(row);
  return wrap;
}
function categorizeFailureReason(errorMessage) {
  const lower = errorMessage.toLowerCase();
  if (/timeout|timed out|abort/i.test(lower))
    return "Timeout";
  if (/too large|exceed|size limit|max size/i.test(lower))
    return "File Too Large";
  if (/\b404\b|\b403\b|\b401\b|\b410\b|http 4\d\d/i.test(lower))
    return "HTTP 4xx / Not Found";
  if (/\b50\d\b|http 5\d\d/i.test(lower))
    return "Server Error (5xx)";
  if (/cors|network|failed to fetch|econn|enotfound|dns/i.test(lower))
    return "Network / CORS";
  if (/mime|content-type|ssrf|blocked|redirect/i.test(lower))
    return "Blocked / Unsupported";
  return "Other Error";
}
function renderFailedItemsPanel(options) {
  if (options.items.length === 0)
    return null;
  const box = document.createElement("div");
  box.className = "ml-section ml-failed-panel";
  const top = document.createElement("div");
  top.className = "ml-section-title";
  const left = document.createElement("span");
  left.className = "ml-inline-title";
  left.appendChild(createIcon("alert", 14));
  const titleText = document.createElement("span");
  titleText.textContent = `Failed URLs (${options.items.length})`;
  left.append(titleText, createInfoTip("URLs that failed to download, grouped by error reason. Retry or Ignore permanently broken links."));
  const actions = document.createElement("div");
  actions.className = "ml-header-actions";
  const allUrls = options.items.map((i) => i.normalizedUrl);
  const retryAllBtn = createIconButton({
    icon: "refresh",
    label: "Retry All",
    title: "Re-queue all failed URLs now",
    className: "ml-btn is-primary is-sm",
    size: 12,
    onClick: () => options.onRetryUrls(allUrls)
  });
  const ignoreAllBtn = document.createElement("button");
  ignoreAllBtn.type = "button";
  ignoreAllBtn.className = "ml-btn is-sm";
  ignoreAllBtn.textContent = "Ignore All";
  ignoreAllBtn.title = "Clear these failed markers and exclude them on this character";
  ignoreAllBtn.addEventListener("click", () => options.onIgnoreUrls(allUrls));
  actions.append(retryAllBtn, ignoreAllBtn);
  top.append(left, actions);
  box.appendChild(top);
  const groups = new Map;
  for (const item of options.items) {
    const reason = categorizeFailureReason(item.error);
    const list = groups.get(reason) ?? [];
    list.push(item);
    groups.set(reason, list);
  }
  const groupList = document.createElement("div");
  groupList.className = "ml-stack";
  for (const [reason, entries] of groups.entries()) {
    const groupEl = document.createElement("div");
    groupEl.className = "ml-failed-group";
    const gh = document.createElement("div");
    gh.className = "ml-failed-group-title";
    gh.textContent = `${reason} (${entries.length})`;
    groupEl.appendChild(gh);
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "ml-failed-row";
      const urlWrap = document.createElement("div");
      urlWrap.className = "ml-failed-url-col";
      const urlSpan = document.createElement("div");
      urlSpan.className = "ml-url-text";
      urlSpan.textContent = entry.normalizedUrl;
      urlSpan.title = `${entry.normalizedUrl}
${entry.error}`;
      const errSpan = document.createElement("div");
      errSpan.className = "ml-url-sources";
      errSpan.textContent = entry.error;
      urlWrap.append(urlSpan, errSpan);
      const rowActions = document.createElement("div");
      rowActions.className = "ml-header-actions";
      rowActions.appendChild(createIconButton({
        icon: "refresh",
        title: "Retry this URL",
        className: "ml-btn ml-icon-btn is-sm",
        size: 12,
        onClick: () => options.onRetryUrls([entry.normalizedUrl])
      }));
      rowActions.appendChild(createIconButton({
        icon: "x",
        title: "Ignore and exclude this failed URL",
        className: "ml-btn ml-icon-btn is-sm",
        size: 12,
        onClick: () => options.onIgnoreUrls([entry.normalizedUrl])
      }));
      row.append(urlWrap, rowActions);
      groupEl.appendChild(row);
    }
    groupList.appendChild(groupEl);
  }
  box.appendChild(groupList);
  return box;
}
var activeLightboxCloseFn = null;
function openMediaLightbox(items, startIndex, onAfterRemove) {
  if (items.length === 0 || typeof document === "undefined" || !document.body) {
    return;
  }
  activeLightboxCloseFn?.();
  const workingItems = [...items];
  const removingItems = new WeakSet;
  let idx = Math.max(0, Math.min(workingItems.length - 1, startIndex));
  let closed = false;
  const backdrop = document.createElement("div");
  backdrop.className = "ml-lightbox-backdrop";
  backdrop.tabIndex = -1;
  const dialog = document.createElement("div");
  dialog.className = "ml-lightbox-dialog";
  const topBar = document.createElement("div");
  topBar.className = "ml-lightbox-topbar";
  const counterEl = document.createElement("span");
  counterEl.className = "ml-lightbox-counter";
  const closeBtn = createIconButton({
    icon: "x",
    title: "Close preview (Esc)",
    className: "ml-btn ml-icon-btn",
    size: 16,
    onClick: () => close()
  });
  topBar.append(counterEl, closeBtn);
  const stage = document.createElement("div");
  stage.className = "ml-lightbox-stage";
  const prevBtn = createIconButton({
    icon: "chevron-left",
    title: "Previous (Left Arrow)",
    className: "ml-btn ml-icon-btn ml-lightbox-nav",
    size: 20,
    onClick: (ev) => {
      ev.stopPropagation();
      step(-1);
    }
  });
  const mediaSlot = document.createElement("div");
  mediaSlot.className = "ml-lightbox-media-slot";
  const nextBtn = createIconButton({
    icon: "chevron-right",
    title: "Next (Right Arrow)",
    className: "ml-btn ml-icon-btn ml-lightbox-nav",
    size: 20,
    onClick: (ev) => {
      ev.stopPropagation();
      step(1);
    }
  });
  stage.append(prevBtn, mediaSlot, nextBtn);
  const footer = document.createElement("div");
  footer.className = "ml-lightbox-footer";
  const metaCol = document.createElement("div");
  metaCol.className = "ml-lightbox-meta";
  const actionsCol = document.createElement("div");
  actionsCol.className = "ml-header-actions";
  footer.append(metaCol, actionsCol);
  dialog.append(topBar, stage, footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  const onKeyDown = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      ev.stopPropagation();
      step(-1);
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      ev.stopPropagation();
      step(1);
    }
  };
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("keydown", onKeyDown, true);
  }
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop)
      close();
  });
  function close() {
    if (closed)
      return;
    closed = true;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("keydown", onKeyDown, true);
    }
    backdrop.remove();
    if (activeLightboxCloseFn === close) {
      activeLightboxCloseFn = null;
    }
  }
  activeLightboxCloseFn = close;
  function step(delta) {
    if (workingItems.length <= 1)
      return;
    idx = (idx + delta + workingItems.length) % workingItems.length;
    renderCurrent();
  }
  function updateNavChrome() {
    counterEl.textContent = `${idx + 1} / ${workingItems.length}`;
    prevBtn.style.visibility = workingItems.length > 1 ? "visible" : "hidden";
    nextBtn.style.visibility = workingItems.length > 1 ? "visible" : "hidden";
  }
  function renderCurrent() {
    if (closed)
      return;
    const item = workingItems[idx];
    if (!item) {
      close();
      return;
    }
    updateNavChrome();
    const safeLocalUrl = sanitizeSafeMediaUrl(item.localUrl);
    mediaSlot.innerHTML = "";
    if (!safeLocalUrl) {
      const blocked = document.createElement("div");
      blocked.className = "ml-empty";
      blocked.textContent = "Blocked unsafe media URL.";
      mediaSlot.appendChild(blocked);
    } else if (item.mediaKind === "video") {
      const video = document.createElement("video");
      video.className = "ml-lightbox-media";
      video.src = safeLocalUrl;
      video.controls = true;
      video.autoplay = true;
      video.loop = true;
      mediaSlot.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.className = "ml-lightbox-media";
      img.src = safeLocalUrl;
      img.alt = item.title;
      mediaSlot.appendChild(img);
    }
    metaCol.innerHTML = "";
    const titleRow = document.createElement("div");
    titleRow.className = "ml-lightbox-title";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = item.title;
    titleRow.appendChild(titleSpan);
    if (item.badgeText) {
      const badge = document.createElement("span");
      badge.className = "ml-badge is-info";
      badge.textContent = item.badgeText;
      titleRow.appendChild(badge);
    }
    metaCol.appendChild(titleRow);
    if (item.subtitle) {
      const sub = document.createElement("div");
      sub.className = "ml-url-sources";
      sub.textContent = item.subtitle;
      metaCol.appendChild(sub);
    }
    actionsCol.innerHTML = "";
    const openBtn = createIconButton({
      icon: "external-link",
      label: "Open",
      title: safeLocalUrl ? "Open local asset in a new tab" : "Cannot open unsafe media URL",
      className: "ml-btn is-sm",
      size: 13,
      disabled: !safeLocalUrl,
      onClick: () => safeOpenExternalUrl(item.localUrl)
    });
    actionsCol.appendChild(openBtn);
    if (item.originalUrl) {
      const copyBtn = createIconButton({
        icon: "copy",
        label: "Copy URL",
        title: `Copy original remote URL: ${item.originalUrl}`,
        className: "ml-btn is-sm",
        size: 13,
        onClick: () => {
          navigator.clipboard?.writeText?.(item.originalUrl);
          const labelSpan = copyBtn.querySelector("span");
          if (labelSpan)
            labelSpan.textContent = "Copied";
        }
      });
      actionsCol.appendChild(copyBtn);
    }
    if (item.onEditCharacter) {
      const editBtn = createIconButton({
        icon: "edit",
        label: "Edit Card",
        title: "Open native Character Editor for this character",
        className: "ml-btn is-sm",
        size: 13,
        onClick: () => {
          const onEdit = item.onEditCharacter;
          close();
          onEdit?.();
        }
      });
      actionsCol.appendChild(editBtn);
    }
    if (!item.readOnly && item.onRemove) {
      const removeBtn = createIconButton({
        icon: "trash",
        label: "Remove",
        title: "Remove this localized asset from cache & Character Gallery",
        className: "ml-btn is-danger is-sm",
        size: 13,
        disabled: removingItems.has(item),
        onClick: async () => {
          if (closed || removingItems.has(item))
            return;
          removingItems.add(item);
          removeBtn.disabled = true;
          try {
            await item.onRemove();
            let removeAt = workingItems.indexOf(item);
            if (removeAt === -1) {
              removeAt = workingItems.findIndex((entry) => entry.id === item.id);
            }
            const removedCurrentSlide = removeAt !== -1 && removeAt === idx;
            if (removeAt !== -1) {
              workingItems.splice(removeAt, 1);
              if (removeAt < idx) {
                idx = Math.max(0, idx - 1);
              } else if (removeAt === idx) {
                idx = Math.min(idx, Math.max(0, workingItems.length - 1));
              }
            }
            onAfterRemove?.();
            if (closed)
              return;
            if (workingItems.length === 0) {
              close();
            } else {
              idx = Math.max(0, Math.min(idx, workingItems.length - 1));
              if (removedCurrentSlide) {
                renderCurrent();
              } else {
                updateNavChrome();
              }
            }
          } catch (err) {
            console.warn("[media_localizer] Failed removing lightbox item:", err);
          } finally {
            removingItems.delete(item);
            if (!closed && removeBtn.isConnected !== false) {
              removeBtn.disabled = false;
            }
          }
        }
      });
      actionsCol.appendChild(removeBtn);
    }
  }
  renderCurrent();
  backdrop.focus();
}
var sharedThumbObserver = null;
var thumbCallbacks = new WeakMap;
var observedThumbElements = new Set;
var thumbPruneTimer = null;
function pruneDetachedThumbTargets() {
  if (!sharedThumbObserver) {
    observedThumbElements.clear();
    return;
  }
  for (const el of observedThumbElements) {
    if (el.isConnected === false) {
      sharedThumbObserver.unobserve(el);
      observedThumbElements.delete(el);
    }
  }
}
function scheduleThumbPrune(delayMs = 50) {
  if (thumbPruneTimer !== null || observedThumbElements.size === 0)
    return;
  thumbPruneTimer = setTimeout(() => {
    thumbPruneTimer = null;
    pruneDetachedThumbTargets();
    if (observedThumbElements.size > 0 && sharedThumbObserver) {
      scheduleThumbPrune(2000);
    }
  }, delayMs);
  thumbPruneTimer.unref?.();
}
function observeThumbElement(observer, el, cb) {
  thumbCallbacks.set(el, cb);
  observedThumbElements.add(el);
  observer.observe(el);
  scheduleThumbPrune(50);
}
function getThumbObserver() {
  if (typeof IntersectionObserver === "undefined")
    return null;
  if (!sharedThumbObserver) {
    sharedThumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          if (entry.target.isConnected === false) {
            sharedThumbObserver?.unobserve(entry.target);
            observedThumbElements.delete(entry.target);
          }
          continue;
        }
        const cb = thumbCallbacks.get(entry.target);
        sharedThumbObserver?.unobserve(entry.target);
        thumbCallbacks.delete(entry.target);
        observedThumbElements.delete(entry.target);
        cb?.();
      }
      pruneDetachedThumbTargets();
    }, { rootMargin: "600px" });
  }
  return sharedThumbObserver;
}
function reobserveLazyMedia(root) {
  if (!root)
    return;
  const candidates = [];
  const rootTag = root.tagName;
  if (typeof rootTag === "string") {
    const lower = rootTag.toLowerCase();
    if (lower === "img" || lower === "video") {
      candidates.push(root);
    }
  }
  const queried = root.querySelectorAll?.("img, video");
  if (queried) {
    for (const el of Array.from(queried)) {
      candidates.push(el);
    }
  }
  if (candidates.length === 0)
    return;
  const observer = getThumbObserver();
  for (const el of candidates) {
    const cb = thumbCallbacks.get(el);
    if (!cb)
      continue;
    const currentSrc = typeof el.getAttribute === "function" ? el.getAttribute("src") : el.src;
    if (currentSrc) {
      thumbCallbacks.delete(el);
      continue;
    }
    if (observer) {
      if (!observedThumbElements.has(el)) {
        observeThumbElement(observer, el, cb);
      }
    } else {
      thumbCallbacks.delete(el);
      cb();
    }
  }
}
function cleanupUiHelpers() {
  activeTipCloseFn?.();
  activeTipCloseFn = null;
  activeTipTrigger = null;
  detachTipDocListeners();
  activeLightboxCloseFn?.();
  activeLightboxCloseFn = null;
  if (thumbPruneTimer !== null) {
    clearTimeout(thumbPruneTimer);
    thumbPruneTimer = null;
  }
  if (sharedThumbObserver) {
    sharedThumbObserver.disconnect();
    sharedThumbObserver = null;
  }
  observedThumbElements.clear();
  thumbCallbacks = new WeakMap;
}
var LOCAL_IMAGE_THUMB_PATH_RE = /^\/api\/v1\/images\/(?!remote$|wallpapers$)[^/?#]+$/;
var THUMBNAIL_SIZE_OPTIONS = [
  "sm",
  "md",
  "lg"
];
var DEFAULT_THUMBNAIL_SIZE = "md";
function sanitizeThumbnailSize(raw) {
  return raw === "sm" || raw === "md" || raw === "lg" ? raw : DEFAULT_THUMBNAIL_SIZE;
}
function getThumbnailImageTier(size) {
  return size === "lg" ? "lg" : "sm";
}
function getThumbnailSizeClass(size) {
  return `is-thumb-${size}`;
}
var THUMBNAIL_SIZE_LABELS = {
  sm: { short: "S", title: "Small thumbnails" },
  md: { short: "M", title: "Medium thumbnails" },
  lg: { short: "L", title: "Large thumbnails" }
};
function createThumbnailSizeSegmented(currentSize, onChange) {
  let activeSize = currentSize;
  const wrap = document.createElement("div");
  wrap.className = "ml-segmented ml-thumb-size-segmented";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Thumbnail size");
  const buttons = new Map;
  const syncActive = () => {
    for (const [sz, button] of buttons) {
      const isAct = sz === activeSize;
      button.className = `ml-btn is-xs${isAct ? " is-active" : ""}`;
      button.setAttribute("aria-pressed", isAct ? "true" : "false");
    }
  };
  for (const size of THUMBNAIL_SIZE_OPTIONS) {
    const meta = THUMBNAIL_SIZE_LABELS[size];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = meta.short;
    btn.title = meta.title;
    btn.setAttribute("aria-label", meta.title);
    btn.addEventListener("click", () => {
      if (size === activeSize)
        return;
      activeSize = size;
      syncActive();
      onChange(size);
    });
    buttons.set(size, btn);
    wrap.appendChild(btn);
  }
  syncActive();
  return wrap;
}
function toThumbnailMediaUrl(safeSrc, mediaKind = "image", tier = "sm") {
  if (!safeSrc || mediaKind !== "image")
    return safeSrc;
  return LOCAL_IMAGE_THUMB_PATH_RE.test(safeSrc) ? `${safeSrc}?size=${tier}` : safeSrc;
}
function createLazyMediaElement(options) {
  const safeSrc = sanitizeSafeMediaUrl(options.src);
  const observer = safeSrc && !options.eager ? getThumbObserver() : null;
  if (options.mediaKind === "video") {
    const vid = document.createElement("video");
    vid.className = options.className;
    vid.muted = true;
    vid.preload = "metadata";
    vid.controls = false;
    if (options.title)
      vid.title = options.title;
    if (safeSrc) {
      if (observer) {
        observeThumbElement(observer, vid, () => {
          thumbCallbacks.delete(vid);
          vid.src = safeSrc;
        });
      } else {
        vid.src = safeSrc;
      }
    }
    return vid;
  }
  const thumbSrc = toThumbnailMediaUrl(safeSrc, "image", options.thumbTier ?? "sm");
  const img = document.createElement("img");
  img.className = options.className;
  img.loading = "eager";
  img.decoding = "async";
  img.alt = options.alt;
  if (options.title)
    img.title = options.title;
  if (thumbSrc) {
    if (observer) {
      observeThumbElement(observer, img, () => {
        thumbCallbacks.delete(img);
        img.src = thumbSrc;
      });
    } else {
      img.src = thumbSrc;
    }
  }
  return img;
}
var SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);
function isAncestorOrSelf(ancestor, node) {
  let cur = node;
  while (cur) {
    if (cur === ancestor)
      return true;
    cur = cur.parentElement;
  }
  return false;
}
function isElementScrollable(el) {
  if (!el || typeof el.scrollTop !== "number" || !Number.isFinite(el.scrollTop)) {
    return false;
  }
  if (el.scrollTop > 0) {
    return true;
  }
  const hasOverflow = typeof el.scrollHeight === "number" && typeof el.clientHeight === "number" && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
  if (!hasOverflow) {
    return false;
  }
  const doc = typeof document !== "undefined" ? document : undefined;
  if (doc && (el === doc.scrollingElement || el === doc.documentElement)) {
    return true;
  }
  if (typeof getComputedStyle === "function") {
    try {
      const computedOverflowY = getComputedStyle(el).overflowY;
      if (computedOverflowY) {
        return SCROLLABLE_OVERFLOW_VALUES.has(computedOverflowY);
      }
    } catch {}
  }
  const inlineOverflowY = el.style?.overflowY;
  if (inlineOverflowY) {
    return SCROLLABLE_OVERFLOW_VALUES.has(inlineOverflowY);
  }
  return true;
}
function resolveScrollContainer(startEl, rememberedEl, fallbackEl) {
  let cur = startEl;
  while (cur) {
    if (isElementScrollable(cur)) {
      return cur;
    }
    cur = cur.parentElement;
  }
  const docScrollEl = typeof document !== "undefined" ? document.scrollingElement : null;
  if (docScrollEl && isElementScrollable(docScrollEl)) {
    return docScrollEl;
  }
  if (rememberedEl && startEl && isAncestorOrSelf(rememberedEl, startEl) && typeof rememberedEl.scrollTop === "number") {
    return rememberedEl;
  }
  return fallbackEl ?? startEl;
}
function applyScrollTopWithSettlement(getContainer, scrollTop, prevPending, shouldAbort) {
  prevPending?.cancel();
  const next = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
  const host = getContainer();
  if (!host || typeof host.scrollTop !== "number") {
    return null;
  }
  host.scrollTop = next;
  if (next <= 0 || typeof requestAnimationFrame !== "function") {
    return null;
  }
  const afterSync = Number.isFinite(host.scrollTop) ? host.scrollTop : 0;
  let cancelled = false;
  let rafId = 0;
  let followUpRafId = 0;
  const cancel = () => {
    if (cancelled)
      return;
    cancelled = true;
    if (typeof cancelAnimationFrame === "function") {
      if (rafId)
        cancelAnimationFrame(rafId);
      if (followUpRafId)
        cancelAnimationFrame(followUpRafId);
    }
  };
  const reapplyIfClamped = () => {
    if (cancelled || shouldAbort?.())
      return next;
    const target = getContainer();
    if (!target || typeof target.scrollTop !== "number")
      return next;
    const current = Number.isFinite(target.scrollTop) ? target.scrollTop : 0;
    if (current < next && (afterSync < next || current === 0)) {
      target.scrollTop = next;
      return Number.isFinite(target.scrollTop) ? target.scrollTop : 0;
    }
    return current;
  };
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const current = reapplyIfClamped();
    if (!cancelled && !shouldAbort?.() && current < next && (afterSync < next || current === 0)) {
      followUpRafId = requestAnimationFrame(() => {
        followUpRafId = 0;
        reapplyIfClamped();
      });
    }
  });
  return { cancel };
}
var GALLERY_PREFS_STORAGE_KEY = "lumiverse.media_localizer.gallery_prefs.v1";
var CHARACTER_PREFS_STORAGE_KEY = "lumiverse.media_localizer.character_prefs.v1";
function loadPrefsFromStorage(key, sanitize, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem?.(key);
    if (!raw)
      return fallback();
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback();
  }
}
function savePrefsToStorage(key, prefs) {
  try {
    globalThis.localStorage?.setItem?.(key, JSON.stringify(prefs));
  } catch {}
}

// src/ui/display-swapper.ts
var CSS_URL_RE = /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/gi;
var SWAPPABLE_MEDIA_TAGS = new Set([
  "img",
  "video",
  "audio",
  "source",
  "image"
]);
function isElementNode(node) {
  return Boolean(node && node.nodeType === 1);
}
function isSwappableMediaElement(target) {
  if (!isElementNode(target))
    return false;
  const tag = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  return SWAPPABLE_MEDIA_TAGS.has(tag);
}

class NonDestructiveDisplaySwapper {
  ctx;
  payload = {
    characterUrlMaps: {},
    allUrlsMap: {},
    updatedAt: 0
  };
  observer = null;
  errorListener = null;
  rafScheduled = false;
  rafId = null;
  timeoutId = null;
  stopped = false;
  iframeLoadListeners = new Map;
  iframeDocTrackers = new Map;
  constructor(ctx) {
    this.ctx = ctx;
  }
  start() {
    this.stopped = false;
    this.schedulePass();
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      this.observer = new MutationObserver((records) => {
        if (records.some((r) => this.isRelevantMutation(r))) {
          this.schedulePass();
        }
      });
      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src", "data-src", "srcset", "href", "xlink:href", "poster", "style", "srcdoc"]
        });
      }
    }
    if (typeof document !== "undefined") {
      this.errorListener = (event) => {
        if (isSwappableMediaElement(event.target)) {
          this.decorateMediaElement(event.target, this.getActiveCharacterIds());
        }
      };
      document.addEventListener("error", this.errorListener, true);
    }
  }
  isRelevantMutation(r) {
    const target = r.target;
    const targetEl = isElementNode(target) ? target : target?.parentElement ?? null;
    if (targetEl?.closest?.(".ml-gallery-host, .ml-drawer-root"))
      return false;
    if (r.type === "attributes" && isElementNode(target)) {
      const name = r.attributeName ?? "";
      if (name === "style") {
        const style = target.getAttribute("style") ?? "";
        return style.toLowerCase().includes("url(") || target.hasAttribute("data-ml-original-style");
      }
      if (name === "src" || name === "data-src" || name === "srcset" || name === "href" || name === "xlink:href" || name === "poster") {
        const safeKey = name.replace(":", "-");
        const value = target.getAttribute(name);
        return value !== target.getAttribute(`data-ml-applied-${safeKey}`);
      }
      return true;
    }
    if (r.type === "childList") {
      for (const n of Array.from(r.addedNodes)) {
        if (n.nodeType === 1)
          return true;
      }
      return targetEl?.tagName?.toLowerCase() === "style";
    }
    return true;
  }
  stop() {
    this.stopped = true;
    this.rafScheduled = false;
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.errorListener && typeof document !== "undefined") {
      document.removeEventListener("error", this.errorListener, true);
      this.errorListener = null;
    }
    for (const [iframe, listener] of this.iframeLoadListeners) {
      iframe.removeEventListener("load", listener);
    }
    this.iframeLoadListeners.clear();
    for (const iframe of Array.from(this.iframeDocTrackers.keys())) {
      this.cleanupIframeDocTracker(iframe);
    }
    if (typeof document !== "undefined" && document.body) {
      this.revertContainer(document.body);
      this.processSameOriginIframes([], true);
    }
  }
  updateMap(next) {
    if (!next || typeof next !== "object")
      return;
    const nextUpdatedAt = typeof next.updatedAt === "number" && Number.isFinite(next.updatedAt) ? next.updatedAt : 0;
    if (nextUpdatedAt < this.payload.updatedAt) {
      return;
    }
    this.payload = {
      characterUrlMaps: next.characterUrlMaps ?? {},
      allUrlsMap: next.allUrlsMap ?? {},
      updatedAt: nextUpdatedAt
    };
    if (this.stopped)
      return;
    this.runPassNow();
  }
  schedulePass() {
    if (this.stopped || this.rafScheduled)
      return;
    this.rafScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.rafScheduled = false;
        if (!this.stopped) {
          this.runPassNow();
        }
      });
    } else {
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null;
        this.rafScheduled = false;
        if (!this.stopped) {
          this.runPassNow();
        }
      }, 16);
    }
  }
  getActiveCharacterIds() {
    const ids = new Set;
    try {
      const activeChat = this.ctx.getActiveChat?.();
      if (activeChat?.characterId)
        ids.add(activeChat.characterId);
    } catch {}
    try {
      const editorState = this.ctx.ui?.characterEditor?.getState?.();
      if (editorState?.open && editorState.characterId) {
        ids.add(editorState.characterId);
      }
    } catch {}
    return Array.from(ids);
  }
  resolveLocalUrl(rawUrl, activeCharacterIds) {
    if (!rawUrl || rawUrl.startsWith("/api/v1/images/") || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
      return null;
    }
    const candidates = [rawUrl.trim()];
    const decoded = decodeHtmlEntities(rawUrl.trim());
    if (decoded !== rawUrl.trim())
      candidates.push(decoded);
    try {
      const href = new URL(decoded).href;
      if (!candidates.includes(href))
        candidates.push(href);
    } catch {}
    for (const charId of activeCharacterIds) {
      const charMap = this.payload.characterUrlMaps[charId];
      if (!charMap)
        continue;
      for (const c of candidates) {
        const hit = sanitizeSafeMediaUrl(charMap[c]);
        if (hit)
          return hit;
      }
    }
    for (const c of candidates) {
      const globalHit = sanitizeSafeMediaUrl(this.payload.allUrlsMap[c]);
      if (globalHit)
        return globalHit;
    }
    return null;
  }
  runPassNow() {
    if (this.stopped || typeof document === "undefined" || !document.body)
      return;
    const activeCharIds = this.getActiveCharacterIds();
    this.decorateContainer(document.body, activeCharIds);
    this.processSameOriginIframes(activeCharIds, false);
  }
  cleanupIframeDocTracker(iframe) {
    const tracked = this.iframeDocTrackers.get(iframe);
    if (!tracked)
      return;
    tracked.observer?.disconnect();
    if (tracked.errorListener) {
      try {
        tracked.doc.removeEventListener?.("error", tracked.errorListener, true);
      } catch {}
    }
    this.iframeDocTrackers.delete(iframe);
  }
  ensureIframeDocListeners(iframe, doc) {
    const existing = this.iframeDocTrackers.get(iframe);
    if (existing && existing.doc === doc) {
      return;
    }
    if (existing) {
      this.cleanupIframeDocTracker(iframe);
    }
    let observer = null;
    const observeRoot = doc.documentElement ?? doc.body;
    if (typeof MutationObserver !== "undefined" && observeRoot) {
      observer = new MutationObserver((records) => {
        if (!this.stopped && records.some((r) => this.isRelevantMutation(r))) {
          this.schedulePass();
        }
      });
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "src",
          "data-src",
          "srcset",
          "href",
          "xlink:href",
          "poster",
          "style",
          "srcdoc"
        ]
      });
    }
    let errorListener = null;
    if (typeof doc.addEventListener === "function") {
      errorListener = (event) => {
        if (this.stopped)
          return;
        if (isSwappableMediaElement(event.target)) {
          this.decorateMediaElement(event.target, this.getActiveCharacterIds());
        }
      };
      doc.addEventListener("error", errorListener, true);
    }
    this.iframeDocTrackers.set(iframe, { doc, observer, errorListener });
  }
  processSameOriginIframes(activeCharIds, revertOnly) {
    if (typeof document === "undefined")
      return;
    if (!revertOnly) {
      for (const [trackedIframe, listener] of this.iframeLoadListeners) {
        if (trackedIframe.isConnected === false) {
          trackedIframe.removeEventListener("load", listener);
          this.iframeLoadListeners.delete(trackedIframe);
        }
      }
      for (const trackedIframe of Array.from(this.iframeDocTrackers.keys())) {
        if (trackedIframe.isConnected === false) {
          this.cleanupIframeDocTracker(trackedIframe);
        }
      }
    }
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of Array.from(iframes)) {
      if (iframe.closest(".ml-gallery-host, .ml-drawer-root"))
        continue;
      if (!revertOnly && !this.iframeLoadListeners.has(iframe)) {
        const onLoad = () => {
          if (!this.stopped) {
            this.schedulePass();
          }
        };
        this.iframeLoadListeners.set(iframe, onLoad);
        iframe.addEventListener("load", onLoad);
      }
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) {
          this.cleanupIframeDocTracker(iframe);
          continue;
        }
        const root = doc.documentElement ?? doc.body;
        if (revertOnly) {
          this.revertContainer(root);
        } else {
          this.ensureIframeDocListeners(iframe, doc);
          this.decorateContainer(root, activeCharIds);
        }
      } catch {
        this.cleanupIframeDocTracker(iframe);
      }
    }
  }
  resolveBase(el, name, current) {
    const orig = el.getAttribute(`data-ml-original-${name}`);
    const applied = el.getAttribute(`data-ml-applied-${name}`);
    if (orig !== null && applied !== null && current === applied) {
      return orig;
    }
    if (orig !== null) {
      el.removeAttribute(`data-ml-original-${name}`);
    }
    if (applied !== null) {
      el.removeAttribute(`data-ml-applied-${name}`);
    }
    return current;
  }
  markApplied(el, name, original, applied) {
    if (el.getAttribute(`data-ml-original-${name}`) !== original) {
      el.setAttribute(`data-ml-original-${name}`, original);
    }
    if (el.getAttribute(`data-ml-applied-${name}`) !== applied) {
      el.setAttribute(`data-ml-applied-${name}`, applied);
    }
  }
  clearManaged(el, name) {
    el.removeAttribute(`data-ml-original-${name}`);
    el.removeAttribute(`data-ml-applied-${name}`);
  }
  decorateUrlAttribute(el, attrName, activeCharIds) {
    const safeKey = attrName.replace(":", "-");
    const currentVal = el.getAttribute(attrName) ?? "";
    const baseVal = this.resolveBase(el, safeKey, currentVal);
    if (!baseVal)
      return false;
    const localUrl = this.resolveLocalUrl(baseVal, activeCharIds);
    if (localUrl) {
      let changed = false;
      if (currentVal !== localUrl) {
        el.setAttribute(attrName, localUrl);
        changed = true;
      }
      this.markApplied(el, safeKey, baseVal, localUrl);
      return changed;
    } else if (currentVal !== baseVal) {
      el.setAttribute(attrName, baseVal);
      this.clearManaged(el, safeKey);
      return true;
    }
    return false;
  }
  rewriteSrcset(srcsetText, activeCharIds) {
    const candidates = parseSrcsetCandidates(srcsetText);
    if (candidates.length === 0) {
      return { replaced: srcsetText, changed: false };
    }
    let changed = false;
    const parts = candidates.map((candidate) => {
      const localUrl = this.resolveLocalUrl(candidate.url, activeCharIds);
      const effectiveUrl = localUrl ?? candidate.url;
      if (localUrl && localUrl !== candidate.url) {
        changed = true;
      }
      return candidate.descriptors ? `${effectiveUrl} ${candidate.descriptors}` : effectiveUrl;
    });
    return { replaced: changed ? parts.join(", ") : srcsetText, changed };
  }
  decorateMediaElement(el, activeCharIds) {
    const srcChanged = this.decorateUrlAttribute(el, "src", activeCharIds);
    const elTag = el.tagName?.toLowerCase() ?? "";
    const parentTag = el.parentElement?.tagName?.toLowerCase() ?? "";
    if (srcChanged && elTag === "source" && (parentTag === "video" || parentTag === "audio")) {
      try {
        el.parentElement.load?.();
      } catch {}
    }
    if (el.hasAttribute("data-src") || el.hasAttribute("data-ml-original-data-src")) {
      this.decorateUrlAttribute(el, "data-src", activeCharIds);
    }
    if (el.hasAttribute("srcset") || el.hasAttribute("data-ml-original-srcset")) {
      const currentSrcset = el.getAttribute("srcset") ?? "";
      const baseSrcset = this.resolveBase(el, "srcset", currentSrcset);
      if (baseSrcset) {
        const { replaced, changed } = this.rewriteSrcset(baseSrcset, activeCharIds);
        if (changed) {
          if (currentSrcset !== replaced) {
            el.setAttribute("srcset", replaced);
          }
          this.markApplied(el, "srcset", baseSrcset, replaced);
        } else if (currentSrcset !== baseSrcset) {
          el.setAttribute("srcset", baseSrcset);
          this.clearManaged(el, "srcset");
        }
      }
    }
    if (elTag === "image") {
      if (el.hasAttribute("href") || el.hasAttribute("data-ml-original-href")) {
        this.decorateUrlAttribute(el, "href", activeCharIds);
      }
      if (el.hasAttribute("xlink:href") || el.hasAttribute("data-ml-original-xlink-href")) {
        this.decorateUrlAttribute(el, "xlink:href", activeCharIds);
      }
    }
    if (elTag === "video") {
      this.decorateUrlAttribute(el, "poster", activeCharIds);
    }
  }
  rewriteCssUrls(cssText, activeCharIds) {
    let changed = false;
    const replaced = cssText.replace(CSS_URL_RE, (fullMatch, dQuoted, sQuoted, unquoted) => {
      const raw = dQuoted ?? sQuoted ?? unquoted ?? "";
      if (!raw)
        return fullMatch;
      const localUrl = this.resolveLocalUrl(raw, activeCharIds);
      if (!localUrl || /[\s"'\\<>()\u0000-\u001f\u007f]/.test(localUrl)) {
        return fullMatch;
      }
      changed = true;
      return `url("${localUrl}")`;
    });
    return { replaced, changed };
  }
  decorateContainer(root, activeCharIds) {
    const mediaEls = root.querySelectorAll("img[src], img[data-src], img[srcset], image[href], image[*|href], video[src], video[data-src], video[poster], audio[src], audio[data-src], source[src], source[data-src], source[srcset], [data-ml-original-src], [data-ml-original-data-src], [data-ml-original-srcset], [data-ml-original-href], [data-ml-original-xlink-href], [data-ml-original-poster]");
    for (const el of Array.from(mediaEls)) {
      if (el.closest(".ml-gallery-host, .ml-drawer-root"))
        continue;
      this.decorateMediaElement(el, activeCharIds);
    }
    const styledEls = root.querySelectorAll("[style], [data-ml-original-style]");
    for (const el of Array.from(styledEls)) {
      if (el.closest(".ml-gallery-host, .ml-drawer-root"))
        continue;
      const currentStyle = el.getAttribute("style") ?? "";
      if (!currentStyle.toLowerCase().includes("url(") && !el.hasAttribute("data-ml-original-style")) {
        continue;
      }
      const baseStyle = this.resolveBase(el, "style", currentStyle);
      if (!baseStyle)
        continue;
      const { replaced, changed } = this.rewriteCssUrls(baseStyle, activeCharIds);
      if (changed) {
        if (currentStyle !== replaced) {
          el.setAttribute("style", replaced);
        }
        this.markApplied(el, "style", baseStyle, el.getAttribute("style") ?? replaced);
      } else if (currentStyle !== baseStyle) {
        el.setAttribute("style", baseStyle);
        this.clearManaged(el, "style");
      }
    }
    const styleTags = root.querySelectorAll("style");
    for (const styleEl of Array.from(styleTags)) {
      if (styleEl.closest(".ml-gallery-host, .ml-drawer-root"))
        continue;
      const currentCss = styleEl.textContent ?? "";
      if (!currentCss.toLowerCase().includes("url(") && !styleEl.hasAttribute("data-ml-original-css")) {
        continue;
      }
      const baseCss = this.resolveBase(styleEl, "css", currentCss);
      if (!baseCss || !baseCss.toLowerCase().includes("url("))
        continue;
      const { replaced, changed } = this.rewriteCssUrls(baseCss, activeCharIds);
      if (changed) {
        if (currentCss !== replaced) {
          styleEl.textContent = replaced;
        }
        this.markApplied(styleEl, "css", baseCss, replaced);
      } else if (currentCss !== baseCss) {
        styleEl.textContent = baseCss;
        this.clearManaged(styleEl, "css");
      }
    }
  }
  revertContainer(root) {
    const revertAttr = (attrName) => {
      const safeKey = attrName.replace(":", "-");
      const els = root.querySelectorAll(`[data-ml-original-${safeKey}]`);
      for (const el of Array.from(els)) {
        const orig = el.getAttribute(`data-ml-original-${safeKey}`);
        const applied = el.getAttribute(`data-ml-applied-${safeKey}`);
        if (orig !== null && (applied === null || el.getAttribute(attrName) === applied)) {
          el.setAttribute(attrName, orig);
        }
        this.clearManaged(el, safeKey);
      }
    };
    revertAttr("src");
    revertAttr("data-src");
    revertAttr("srcset");
    revertAttr("href");
    revertAttr("xlink:href");
    revertAttr("poster");
    revertAttr("style");
    const cssTags = root.querySelectorAll("[data-ml-original-css]");
    for (const el of Array.from(cssTags)) {
      const orig = el.getAttribute("data-ml-original-css");
      const applied = el.getAttribute("data-ml-applied-css");
      if (orig !== null && (applied === null || el.textContent === applied)) {
        el.textContent = orig;
      }
      this.clearManaged(el, "css");
    }
  }
}

// src/ui/character-media-widget.ts
var VALID_MEDIA_FILTERS = new Set([
  "all",
  "localized",
  "expressions",
  "video"
]);
function getDefaultCharacterPreferences(defaultExpandDownloadedMedia = true) {
  return {
    showDownloadConfig: false,
    showGreetingSubfilter: false,
    showWorldBookSubfilter: false,
    showUrlPicker: false,
    showRemoteThumbnails: false,
    mediaViewMode: "grid",
    mediaFilter: "all",
    showDownloadedMedia: defaultExpandDownloadedMedia,
    thumbnailSize: DEFAULT_THUMBNAIL_SIZE
  };
}
function sanitizeCharacterPreferences(raw, defaultExpandDownloadedMedia = true) {
  const defaults = getDefaultCharacterPreferences(defaultExpandDownloadedMedia);
  if (!raw || typeof raw !== "object")
    return defaults;
  const obj = raw;
  const mediaFilter = typeof obj.mediaFilter === "string" && VALID_MEDIA_FILTERS.has(obj.mediaFilter) ? obj.mediaFilter : defaults.mediaFilter;
  return {
    showDownloadConfig: typeof obj.showDownloadConfig === "boolean" ? obj.showDownloadConfig : defaults.showDownloadConfig,
    showGreetingSubfilter: typeof obj.showGreetingSubfilter === "boolean" ? obj.showGreetingSubfilter : defaults.showGreetingSubfilter,
    showWorldBookSubfilter: typeof obj.showWorldBookSubfilter === "boolean" ? obj.showWorldBookSubfilter : defaults.showWorldBookSubfilter,
    showUrlPicker: typeof obj.showUrlPicker === "boolean" ? obj.showUrlPicker : defaults.showUrlPicker,
    showRemoteThumbnails: typeof obj.showRemoteThumbnails === "boolean" ? obj.showRemoteThumbnails : defaults.showRemoteThumbnails,
    mediaViewMode: obj.mediaViewMode === "list" ? "list" : "grid",
    mediaFilter,
    showDownloadedMedia: typeof obj.showDownloadedMedia === "boolean" ? obj.showDownloadedMedia : defaults.showDownloadedMedia,
    thumbnailSize: sanitizeThumbnailSize(obj.thumbnailSize)
  };
}
function sameSetAsList(set, list) {
  const target = new Set(list);
  if (set.size !== target.size)
    return false;
  for (const item of set) {
    if (!target.has(item))
      return false;
  }
  return true;
}

class CharacterMediaWidget {
  root;
  ctx;
  settings;
  queueProgress;
  callbacks;
  options;
  characterId;
  scan = null;
  loading = false;
  error = null;
  showDownloadConfig = false;
  showGreetingSubfilter = false;
  showWorldBookSubfilter = false;
  showUrlPicker = false;
  showRemoteThumbnails = false;
  mediaViewMode = "grid";
  mediaFilter = "all";
  showDownloadedMedia = true;
  thumbnailSize = DEFAULT_THUMBNAIL_SIZE;
  queueBannerEl = null;
  selectedSections = new Set;
  selectedGreetings = null;
  selectedWorldBooks = null;
  selectedDomains = null;
  selectedKinds = new Set(["image", "video"]);
  includeFailed = true;
  excludedUrls = new Set;
  expandedUrls = new Set;
  batchCap = 50;
  hasCustomOverride = false;
  filtersInitializedForChar = null;
  overrideSaveTimer = null;
  pendingOverrideSave = null;
  inFlightOverrideSaves = new Map;
  refreshBtnEl = null;
  mediaTileCache = new Map;
  tileClickHandlers = new WeakMap;
  scanGeneration = 0;
  destroyed = false;
  constructor(root, ctx, characterId, settings, queueProgress, callbacks, options = {}) {
    this.root = root;
    this.ctx = ctx;
    this.settings = settings;
    this.queueProgress = queueProgress;
    this.callbacks = callbacks;
    this.options = options;
    this.characterId = characterId;
    this.batchCap = settings.defaultBatchCap;
    const defaultExpandDownloaded = options.defaultExpandDownloadedMedia ?? options.inDrawer !== false;
    const prefs = sanitizeCharacterPreferences(options.initialUiState, defaultExpandDownloaded);
    this.showDownloadConfig = options.defaultExpandConfig === true ? true : prefs.showDownloadConfig;
    this.showGreetingSubfilter = prefs.showGreetingSubfilter;
    this.showWorldBookSubfilter = prefs.showWorldBookSubfilter;
    this.showUrlPicker = prefs.showUrlPicker;
    this.showRemoteThumbnails = prefs.showRemoteThumbnails;
    this.mediaViewMode = prefs.mediaViewMode;
    this.mediaFilter = prefs.mediaFilter;
    this.showDownloadedMedia = options.initialUiState?.showDownloadedMedia !== undefined ? prefs.showDownloadedMedia : defaultExpandDownloaded;
    this.thumbnailSize = prefs.thumbnailSize;
    if (Array.isArray(options.initialUiState?.expandedUrls)) {
      this.expandedUrls = new Set(options.initialUiState.expandedUrls);
    }
    if (options.initialScan && options.initialScan.characterId === characterId) {
      this.scan = options.initialScan;
      this.initFiltersFromScan(options.initialScan, true);
    }
  }
  emitUiStateChange() {
    this.options.onUiStateChange?.({
      showDownloadConfig: this.showDownloadConfig,
      showGreetingSubfilter: this.showGreetingSubfilter,
      showWorldBookSubfilter: this.showWorldBookSubfilter,
      showUrlPicker: this.showUrlPicker,
      showRemoteThumbnails: this.showRemoteThumbnails,
      mediaViewMode: this.mediaViewMode,
      mediaFilter: this.mediaFilter,
      showDownloadedMedia: this.showDownloadedMedia,
      thumbnailSize: this.thumbnailSize,
      expandedUrls: Array.from(this.expandedUrls)
    });
  }
  persistOverrideNow(charId, override) {
    const prev = this.inFlightOverrideSaves.get(charId);
    const runSave = () => this.callbacks.onSaveCharacterOverride(charId, override);
    const next = (prev ? prev.catch(() => {
      return;
    }).then(runSave) : runSave()).then(() => {
      return;
    }).catch((err) => {
      console.warn("[media_localizer] Failed saving character override:", err);
    }).finally(() => {
      if (this.inFlightOverrideSaves.get(charId) === next) {
        this.inFlightOverrideSaves.delete(charId);
      }
    });
    this.inFlightOverrideSaves.set(charId, next);
    return next;
  }
  hasPendingOverrideFor(charId) {
    return this.pendingOverrideSave !== null && this.pendingOverrideSave.charId === charId || this.inFlightOverrideSaves.has(charId);
  }
  flushPendingOverrideSave() {
    if (this.overrideSaveTimer !== null) {
      clearTimeout(this.overrideSaveTimer);
      this.overrideSaveTimer = null;
    }
    const pending = this.pendingOverrideSave;
    this.pendingOverrideSave = null;
    if (!pending) {
      return this.inFlightOverrideSaves.get(this.characterId) ?? Promise.resolve();
    }
    return this.persistOverrideNow(pending.charId, pending.override);
  }
  destroy() {
    this.destroyed = true;
    this.scanGeneration++;
    this.refreshBtnEl = null;
    this.mediaTileCache.clear();
    this.flushPendingOverrideSave();
  }
  getCharacterId() {
    return this.characterId;
  }
  getScan() {
    return this.scan;
  }
  getPendingDownloadCount() {
    if (!this.scan)
      return 0;
    const matched = filterScanItemsForDownload(this.scan, this.buildCurrentFilter(true));
    return this.batchCap > 0 ? Math.min(matched.length, this.batchCap) : matched.length;
  }
  setCharacterId(nextId) {
    if (this.destroyed)
      return;
    if (this.characterId === nextId && (this.scan || this.loading))
      return;
    if (this.characterId !== nextId) {
      this.flushPendingOverrideSave();
      this.mediaTileCache.clear();
      for (const el of this.root.querySelectorAll("[data-scroll-id]")) {
        el.scrollTop = 0;
      }
      if (this.expandedUrls.size > 0) {
        this.expandedUrls.clear();
        this.emitUiStateChange();
      }
    }
    this.characterId = nextId;
    this.scan = null;
    this.error = null;
    this.filtersInitializedForChar = null;
    this.refreshScan(false);
  }
  applySharedPreferences(prefs) {
    if (this.destroyed || !prefs || typeof prefs !== "object")
      return;
    const sanitized = sanitizeCharacterPreferences({
      showDownloadConfig: this.showDownloadConfig,
      showGreetingSubfilter: this.showGreetingSubfilter,
      showWorldBookSubfilter: this.showWorldBookSubfilter,
      showUrlPicker: this.showUrlPicker,
      showRemoteThumbnails: this.showRemoteThumbnails,
      mediaViewMode: this.mediaViewMode,
      mediaFilter: this.mediaFilter,
      showDownloadedMedia: this.showDownloadedMedia,
      thumbnailSize: this.thumbnailSize,
      ...prefs
    });
    let changed = false;
    if (prefs.showGreetingSubfilter !== undefined && sanitized.showGreetingSubfilter !== this.showGreetingSubfilter) {
      this.showGreetingSubfilter = sanitized.showGreetingSubfilter;
      changed = true;
    }
    if (prefs.showWorldBookSubfilter !== undefined && sanitized.showWorldBookSubfilter !== this.showWorldBookSubfilter) {
      this.showWorldBookSubfilter = sanitized.showWorldBookSubfilter;
      changed = true;
    }
    if (prefs.showUrlPicker !== undefined && sanitized.showUrlPicker !== this.showUrlPicker) {
      this.showUrlPicker = sanitized.showUrlPicker;
      changed = true;
    }
    if (prefs.showRemoteThumbnails !== undefined && sanitized.showRemoteThumbnails !== this.showRemoteThumbnails) {
      this.showRemoteThumbnails = sanitized.showRemoteThumbnails;
      changed = true;
    }
    if (prefs.mediaViewMode !== undefined && sanitized.mediaViewMode !== this.mediaViewMode) {
      this.mediaViewMode = sanitized.mediaViewMode;
      this.mediaTileCache.clear();
      changed = true;
    }
    if (prefs.mediaFilter !== undefined && sanitized.mediaFilter !== this.mediaFilter) {
      this.mediaFilter = sanitized.mediaFilter;
      changed = true;
    }
    if (prefs.thumbnailSize !== undefined && sanitized.thumbnailSize !== this.thumbnailSize) {
      this.thumbnailSize = sanitized.thumbnailSize;
      this.mediaTileCache.clear();
      changed = true;
    }
    if (changed) {
      this.render();
    }
  }
  updateExternalState(settings, queueProgress, forceRefresh = false) {
    if (this.destroyed)
      return;
    const prevSettings = this.settings;
    const prevStatus = this.queueProgress.status;
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(this.settings);
    const scanSettingsChanged = settings.scanBareUrls !== prevSettings.scanBareUrls || settings.adoptNativeGalleryImages !== prevSettings.adoptNativeGalleryImages;
    this.settings = settings;
    this.queueProgress = queueProgress;
    if (settingsChanged && this.scan && !this.hasCustomOverride && !this.hasPendingOverrideFor(this.scan.characterId)) {
      this.filtersInitializedForChar = null;
      this.initFiltersFromScan(this.scan);
    }
    const wasActive = isQueueActiveStatus(prevStatus);
    const nowActive = isQueueActiveStatus(queueProgress.status);
    if (wasActive && !nowActive || scanSettingsChanged && this.scan || forceRefresh) {
      this.refreshScan(scanSettingsChanged || forceRefresh);
      return;
    }
    if (!this.options.inDrawer && this.queueBannerEl && nowActive) {
      const next = renderQueueBanner(this.queueProgress, this.callbacks.onQueueControl);
      this.queueBannerEl.replaceWith(next);
      this.queueBannerEl = next;
      return;
    }
    if (settingsChanged || wasActive !== nowActive) {
      this.render();
    }
  }
  async refreshScan(forceRefresh = false) {
    if (this.destroyed)
      return;
    const targetId = this.characterId;
    const gen = ++this.scanGeneration;
    if (!targetId) {
      this.scan = null;
      this.loading = false;
      this.error = null;
      this.render();
      return;
    }
    this.loading = true;
    this.error = null;
    if (!this.scan) {
      this.render();
    } else if (this.refreshBtnEl) {
      this.refreshBtnEl.disabled = true;
      this.refreshBtnEl.classList.add("is-busy");
    }
    try {
      if (this.hasPendingOverrideFor(targetId)) {
        await this.flushPendingOverrideSave();
        await this.inFlightOverrideSaves.get(targetId);
        if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
          return;
        }
      }
      const result = await this.callbacks.onScanCharacter(targetId, forceRefresh);
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      if (this.hasPendingOverrideFor(result.characterId)) {
        const localOverride = this.buildOverrideFromState();
        result.override = localOverride;
        this.hasCustomOverride = localOverride !== null;
        this.scan = result;
      } else {
        this.scan = result;
        this.initFiltersFromScan(result, forceRefresh);
      }
      this.options.onScanChange?.(result);
    } catch (err) {
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (this.destroyed || gen !== this.scanGeneration || this.characterId !== targetId) {
        return;
      }
      this.loading = false;
      this.render();
    }
  }
  async runAction(fn) {
    try {
      await fn();
    } catch (err) {
      if (this.destroyed)
        return;
      this.error = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }
  initFiltersFromScan(scan, reinitExisting = false) {
    if (!reinitExisting && this.filtersInitializedForChar === scan.characterId) {
      this.hasCustomOverride = Boolean(scan.override && !isOverrideEmpty(scan.override));
      return;
    }
    this.filtersInitializedForChar = scan.characterId;
    const override = scan.override ?? null;
    this.hasCustomOverride = Boolean(override && !isOverrideEmpty(override));
    const effective = buildEffectiveFilter(this.settings, scan, override);
    this.selectedSections = new Set(effective.sections ?? this.settings.defaultSections);
    this.selectedKinds = new Set(effective.mediaKinds ?? this.settings.defaultMediaKinds);
    this.includeFailed = effective.includeFailed ?? this.settings.defaultIncludeFailed;
    this.batchCap = effective.maxItems ?? this.settings.defaultBatchCap;
    this.selectedGreetings = override?.greetingIndices && override.greetingIndices.length > 0 ? new Set(override.greetingIndices) : null;
    this.selectedWorldBooks = override?.worldBookIds && override.worldBookIds.length > 0 ? new Set(override.worldBookIds) : null;
    this.selectedDomains = override?.domains && override.domains.length > 0 ? new Set(override.domains) : null;
    this.excludedUrls = new Set(override?.excludedUrls ?? []);
  }
  buildOverrideFromState() {
    const matchesSections = sameSetAsList(this.selectedSections, this.settings.defaultSections);
    const matchesKinds = sameSetAsList(this.selectedKinds, this.settings.defaultMediaKinds);
    const matchesFailed = this.includeFailed === this.settings.defaultIncludeFailed;
    const matchesCap = this.batchCap === this.settings.defaultBatchCap;
    if (matchesSections && matchesKinds && matchesFailed && matchesCap && this.selectedGreetings === null && this.selectedWorldBooks === null && this.selectedDomains === null && this.excludedUrls.size === 0) {
      return null;
    }
    const override = {};
    if (!matchesSections)
      override.sections = Array.from(this.selectedSections);
    if (!matchesKinds)
      override.mediaKinds = Array.from(this.selectedKinds);
    if (!matchesFailed)
      override.includeFailed = this.includeFailed;
    if (!matchesCap)
      override.maxItems = this.batchCap;
    if (this.selectedGreetings !== null) {
      override.greetingIndices = Array.from(this.selectedGreetings);
    }
    if (this.selectedWorldBooks !== null) {
      override.worldBookIds = Array.from(this.selectedWorldBooks);
    }
    if (this.selectedDomains !== null) {
      override.domains = Array.from(this.selectedDomains);
    }
    if (this.excludedUrls.size > 0) {
      override.excludedUrls = Array.from(this.excludedUrls);
    }
    return isOverrideEmpty(override) ? null : override;
  }
  scheduleSaveOverride() {
    if (this.destroyed)
      return;
    const targetCharId = this.characterId;
    if (!targetCharId)
      return;
    const nextOverride = this.buildOverrideFromState();
    this.hasCustomOverride = nextOverride !== null;
    if (this.scan && this.scan.characterId === targetCharId) {
      this.scan.override = nextOverride;
      this.options.onScanChange?.(this.scan);
    }
    if (this.overrideSaveTimer)
      clearTimeout(this.overrideSaveTimer);
    this.pendingOverrideSave = { charId: targetCharId, override: nextOverride };
    this.overrideSaveTimer = setTimeout(() => {
      this.overrideSaveTimer = null;
      this.pendingOverrideSave = null;
      if (this.destroyed)
        return;
      this.persistOverrideNow(targetCharId, nextOverride);
    }, 150);
  }
  async resetToGlobalDefaults() {
    if (!this.scan)
      return;
    const targetCharId = this.scan.characterId;
    if (this.overrideSaveTimer) {
      clearTimeout(this.overrideSaveTimer);
      this.overrideSaveTimer = null;
    }
    this.pendingOverrideSave = null;
    this.scan.override = null;
    this.hasCustomOverride = false;
    this.filtersInitializedForChar = null;
    this.initFiltersFromScan(this.scan);
    this.options.onScanChange?.(this.scan);
    await this.persistOverrideNow(targetCharId, null);
    if (this.destroyed || this.characterId !== targetCharId)
      return;
    this.render();
  }
  captureScrollState() {
    const internal = new Map;
    for (const el of this.root.querySelectorAll("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (id && el.scrollTop > 0) {
        internal.set(id, el.scrollTop);
      }
    }
    const ancestors = [];
    let parent = this.root.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (parent.scrollTop > 0) {
        ancestors.push({ el: parent, top: parent.scrollTop });
      }
      parent = parent.parentElement;
    }
    return { internal, ancestors };
  }
  restoreScrollState(state) {
    for (const [id, top] of state.internal.entries()) {
      const el = this.root.querySelector(`[data-scroll-id="${id}"]`);
      if (el)
        el.scrollTop = top;
    }
    for (const { el, top } of state.ancestors) {
      el.scrollTop = top;
    }
  }
  buildCurrentFilter(includeExcluded = true) {
    return {
      sections: Array.from(this.selectedSections),
      greetingIndices: this.selectedGreetings !== null ? Array.from(this.selectedGreetings) : undefined,
      worldBookIds: this.selectedWorldBooks !== null ? Array.from(this.selectedWorldBooks) : undefined,
      domains: this.selectedDomains !== null ? Array.from(this.selectedDomains) : undefined,
      mediaKinds: Array.from(this.selectedKinds),
      includeFailed: this.includeFailed,
      excludedUrls: includeExcluded ? Array.from(this.excludedUrls) : undefined,
      maxItems: this.batchCap
    };
  }
  async triggerOneClickLocalize() {
    if (this.destroyed)
      return;
    const scan = this.scan;
    if (!scan)
      return;
    const targetCharId = scan.characterId;
    const filter = this.buildCurrentFilter(true);
    const matched = filterScanItemsForDownload(scan, filter);
    const effectiveCount = this.batchCap > 0 ? Math.min(matched.length, this.batchCap) : matched.length;
    if (effectiveCount === 0)
      return;
    if (effectiveCount > this.settings.confirmThreshold) {
      const res = await this.ctx.ui.showConfirm({
        title: "Confirm Media Localization Batch",
        message: `Download ${effectiveCount} remote media file(s) for "${scan.characterName}"?`,
        confirmLabel: `Localize ${effectiveCount}`,
        cancelLabel: "Cancel"
      });
      if (this.destroyed || this.characterId !== targetCharId || !res?.confirmed) {
        return;
      }
    }
    await this.runAction(() => this.callbacks.onStartDownload({
      characterIds: [targetCharId],
      ...filter
    }));
  }
  render() {
    if (this.destroyed)
      return;
    const scrollState = this.captureScrollState();
    this.root.innerHTML = "";
    this.queueBannerEl = null;
    this.refreshBtnEl = null;
    const wrap = document.createElement("div");
    const thumbClass = getThumbnailSizeClass(this.thumbnailSize);
    wrap.className = this.options.inDrawer === true ? `ml-widget is-drawer ${thumbClass}` : this.options.inDrawer === false ? `ml-widget is-embedded ${thumbClass}` : `ml-widget ${thumbClass}`;
    if (!this.characterId) {
      const empty = document.createElement("div");
      empty.className = "ml-section ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("image", 20));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent = "Open a character chat or editor to manage its media.";
      empty.append(iconWrap, textEl);
      wrap.appendChild(empty);
      this.root.appendChild(wrap);
      return;
    }
    if (this.error) {
      const err = document.createElement("div");
      err.className = "ml-error-banner";
      const errText = document.createElement("span");
      errText.textContent = this.error;
      err.append(createIcon("alert", 14), errText);
      wrap.appendChild(err);
    }
    if (!this.options.inDrawer && isQueueActiveStatus(this.queueProgress.status)) {
      this.queueBannerEl = renderQueueBanner(this.queueProgress, this.callbacks.onQueueControl);
      wrap.appendChild(this.queueBannerEl);
    }
    if (this.loading && !this.scan) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "ml-section ml-empty ml-loading-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("refresh", 18));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent = "Scanning character media...";
      loadingEl.append(iconWrap, textEl);
      wrap.appendChild(loadingEl);
      this.root.appendChild(wrap);
      return;
    }
    if (!this.scan) {
      const retryCard = document.createElement("div");
      retryCard.className = "ml-section ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("search", 18));
      const retry = createIconButton({
        icon: "refresh",
        label: "Scan Character Media",
        title: "Scan character fields, linked World Books, and Regex scripts",
        className: "ml-btn is-primary",
        size: 13,
        onClick: () => void this.refreshScan(true)
      });
      retryCard.append(iconWrap, retry);
      wrap.appendChild(retryCard);
      this.root.appendChild(wrap);
      return;
    }
    const scan = this.scan;
    const candidateItems = filterScanItemsForDownload(scan, this.buildCurrentFilter(false));
    const selectedPending = candidateItems.filter((i) => !this.excludedUrls.has(i.normalizedUrl));
    const effectivePendingCount = this.batchCap > 0 ? Math.min(selectedPending.length, this.batchCap) : selectedPending.length;
    wrap.appendChild(this.renderHeaderSection(scan, effectivePendingCount, selectedPending.length));
    const failedEntries = scan.items.filter((i) => i.status === "failed" && !this.excludedUrls.has(i.normalizedUrl)).map((i) => ({
      normalizedUrl: i.normalizedUrl,
      error: i.failureInfo?.error || "Download failed",
      lastAttemptAt: i.failureInfo?.lastAttemptAt,
      domain: i.domain
    }));
    const failedPanel = renderFailedItemsPanel({
      items: failedEntries,
      onRetryUrls: (urls) => {
        this.runAction(() => this.callbacks.onStartDownload({
          characterIds: [scan.characterId],
          explicitUrls: urls,
          includeFailed: true,
          maxItems: urls.length
        }));
      },
      onIgnoreUrls: (urls) => {
        for (const u of urls)
          this.excludedUrls.add(u);
        this.scheduleSaveOverride();
        this.runAction(async () => {
          await this.flushPendingOverrideSave();
          await this.callbacks.onClearFailedUrls(urls);
          await this.refreshScan(false);
        });
      }
    });
    if (failedPanel) {
      wrap.appendChild(failedPanel);
    }
    wrap.appendChild(this.renderCombinedOptionsAndMediaSection(scan, candidateItems, selectedPending, effectivePendingCount));
    this.root.appendChild(wrap);
    this.restoreScrollState(scrollState);
  }
  renderHeaderSection(scan, effectivePendingCount, totalMatchedCount) {
    const localizedItems = scan.items.filter((i) => i.status === "localized");
    const remoteCount = scan.items.filter((i) => i.status === "remote").length;
    const failedCount = scan.items.filter((i) => i.status === "failed").length;
    const exprCount = scan.media?.expressions.length ?? 0;
    const totalBytes = scan.media?.totalSizeBytes ?? 0;
    const header = document.createElement("div");
    header.className = "ml-section ml-char-header";
    const identityRow = document.createElement("div");
    identityRow.className = "ml-char-identity";
    const safeAvatarUrl = this.options.inDrawer !== false ? sanitizeSafeMediaUrl(scan.media?.avatarUrl) : null;
    if (safeAvatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "ml-char-avatar";
      avatar.src = safeAvatarUrl;
      avatar.alt = scan.characterName;
      identityRow.appendChild(avatar);
    } else if (this.options.inDrawer !== false) {
      const avatarFallback = document.createElement("div");
      avatarFallback.className = "ml-char-avatar-fallback";
      avatarFallback.setAttribute("aria-hidden", "true");
      avatarFallback.appendChild(createIcon("user", 18));
      identityRow.appendChild(avatarFallback);
    }
    const titleCol = document.createElement("div");
    titleCol.className = "ml-char-meta";
    const titleLine = document.createElement("div");
    titleLine.className = "ml-header-bar";
    const titleGroup = document.createElement("div");
    titleGroup.className = "ml-inline-title";
    const nameEl = document.createElement("span");
    nameEl.className = "ml-title ml-char-name";
    nameEl.textContent = scan.characterName;
    nameEl.title = scan.characterName;
    titleGroup.append(nameEl, createInfoTip("Localized media is automatically displayed instead of remote URLs while keeping your character card untouched."));
    if (this.hasCustomOverride) {
      const customBadge = document.createElement("span");
      customBadge.className = "ml-badge is-info";
      customBadge.textContent = "Custom";
      customBadge.title = "Using custom per-card download options instead of global defaults";
      titleGroup.appendChild(customBadge);
    }
    const actions = document.createElement("div");
    actions.className = "ml-header-actions";
    const localizeBtn = createIconButton({
      icon: "download",
      label: effectivePendingCount > 0 ? effectivePendingCount < totalMatchedCount ? `Localize (${effectivePendingCount}/${totalMatchedCount})` : `Localize (${effectivePendingCount})` : "Localized",
      title: effectivePendingCount > 0 ? `Download ${effectivePendingCount} remote media file(s) using ${this.hasCustomOverride ? "custom card options" : "global download defaults"}` : "No pending remote media matches the current filter options",
      className: `ml-btn is-sm ${effectivePendingCount > 0 ? "is-primary" : ""}`,
      size: 13,
      disabled: effectivePendingCount === 0,
      onClick: () => void this.triggerOneClickLocalize()
    });
    const refreshBtn = createIconButton({
      icon: "refresh",
      title: "Rescan character fields, linked World Books, and Regex scripts",
      className: `ml-btn ml-icon-btn is-sm ${this.loading ? "is-busy" : ""}`,
      size: 13,
      disabled: this.loading,
      onClick: () => {
        if (this.loading)
          return;
        this.refreshScan(true);
      }
    });
    this.refreshBtnEl = refreshBtn;
    actions.appendChild(localizeBtn);
    if (this.callbacks.onOpenCharacterEditor) {
      const editBtn = createIconButton({
        icon: "edit",
        label: "Edit",
        title: "Open native Character Editor for this character",
        className: "ml-btn is-sm",
        size: 13,
        onClick: () => this.callbacks.onOpenCharacterEditor?.(scan.characterId)
      });
      actions.appendChild(editBtn);
    }
    actions.appendChild(refreshBtn);
    titleLine.append(titleGroup, actions);
    const statusLine = document.createElement("div");
    statusLine.className = "ml-status-row";
    const addBadge = (text, variant = "", icon) => {
      const b = document.createElement("span");
      b.className = `ml-badge ${variant}`.trim();
      const textSpan = document.createElement("span");
      textSpan.textContent = text;
      if (icon) {
        b.append(createIcon(icon, 11), textSpan);
      } else {
        b.appendChild(textSpan);
      }
      statusLine.appendChild(b);
    };
    addBadge(`${localizedItems.length} localized${totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}`, localizedItems.length > 0 ? "is-local" : "is-muted", localizedItems.length > 0 ? "check" : undefined);
    if (remoteCount > 0 || localizedItems.length === 0 && failedCount === 0) {
      addBadge(`${remoteCount} remote`, remoteCount > 0 ? "is-remote" : "is-muted", remoteCount > 0 ? "download" : undefined);
    }
    if (failedCount > 0)
      addBadge(`${failedCount} failed`, "is-failed", "alert");
    if (exprCount > 0)
      addBadge(`${exprCount} expr`, "is-info", "sparkles");
    titleCol.append(titleLine, statusLine);
    if (scan.items.length > 0) {
      const pct = Math.min(100, Math.round(localizedItems.length / scan.items.length * 100));
      const progress = document.createElement("div");
      progress.className = "ml-mini-progress";
      progress.title = `${localizedItems.length} of ${scan.items.length} scanned URLs localized (${pct}%)`;
      const fill = document.createElement("div");
      fill.className = "ml-mini-progress-fill";
      fill.style.width = `${pct}%`;
      progress.appendChild(fill);
      titleCol.appendChild(progress);
    }
    identityRow.appendChild(titleCol);
    header.appendChild(identityRow);
    return header;
  }
  renderOptionsSection(scan, candidateItems, selectedPending, effectivePendingCount) {
    const container = document.createElement("div");
    container.className = "ml-combined-pane ml-options-panel";
    const top = document.createElement("div");
    top.className = "ml-section-title";
    const titleGroup = document.createElement("div");
    titleGroup.className = "ml-inline-title";
    const heading = document.createElement("span");
    heading.textContent = "Per-Card Download Options";
    const statusPill = document.createElement("span");
    statusPill.className = `ml-badge ${this.hasCustomOverride ? "is-info" : ""}`;
    statusPill.textContent = this.hasCustomOverride ? "Custom" : "Global defaults";
    titleGroup.append(createIcon("sliders", 13), heading, statusPill, createInfoTip("Customize which sections, greetings, World Books, domains, or specific URLs are included when clicking Localize for this character."));
    const resetBtn = createIconButton({
      icon: "rotate-ccw",
      label: "Reset",
      title: "Clear per-card customizations and use Settings global defaults",
      className: "ml-btn is-xs",
      size: 11,
      disabled: !this.hasCustomOverride,
      onClick: () => void this.runAction(() => this.resetToGlobalDefaults())
    });
    top.append(titleGroup, resetBtn);
    container.appendChild(top);
    container.appendChild(renderSharedDownloadConfigControls({
      state: {
        sections: this.selectedSections,
        mediaKinds: this.selectedKinds,
        includeFailed: this.includeFailed,
        batchCap: this.batchCap
      },
      sectionCounts: scan.sectionCounts,
      sectionTip: "Unchecking sections skips them for one-click localization on this character.",
      onChange: (nextState) => {
        this.selectedSections = nextState.sections;
        this.selectedKinds = nextState.mediaKinds;
        this.includeFailed = nextState.includeFailed;
        this.batchCap = nextState.batchCap;
        this.scheduleSaveOverride();
        this.render();
      }
    }));
    const remoteDomains = scan.domainBreakdown.filter((d) => {
      const failed = d.failedCount ?? 0;
      return d.remoteCount + failed > 0;
    });
    if (remoteDomains.length > 1) {
      const pillRow = document.createElement("div");
      pillRow.className = "ml-pill-row";
      pillRow.style.alignItems = "center";
      const domLabel = document.createElement("span");
      domLabel.className = "ml-config-label";
      domLabel.textContent = "Domains";
      pillRow.appendChild(domLabel);
      for (const dom of remoteDomains) {
        const isSelected = this.selectedDomains === null || this.selectedDomains.has(dom.domain);
        const domFailed = dom.failedCount ?? 0;
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `ml-pill ${isSelected ? "is-selected" : ""}`;
        pill.textContent = `${dom.domain} (${dom.remoteCount + domFailed})`;
        pill.addEventListener("click", () => {
          if (this.selectedDomains === null) {
            this.selectedDomains = new Set(remoteDomains.map((d) => d.domain));
          }
          if (this.selectedDomains.has(dom.domain)) {
            const remaining = remoteDomains.filter((d) => d.domain !== dom.domain && this.selectedDomains.has(d.domain));
            if (remaining.length === 0) {
              return;
            }
            this.selectedDomains.delete(dom.domain);
          } else {
            this.selectedDomains.add(dom.domain);
          }
          if (remoteDomains.every((d) => this.selectedDomains.has(d.domain))) {
            this.selectedDomains = null;
          }
          this.scheduleSaveOverride();
          this.render();
        });
        pillRow.appendChild(pill);
      }
      container.appendChild(pillRow);
    }
    const hasGreetingSubfilter = this.selectedSections.has("alternate_greetings") && scan.greetingBreakdown.length > 1;
    const hasWorldBookSubfilter = this.selectedSections.has("world_books") && scan.worldBookBreakdown.length > 1;
    const triggerRow = document.createElement("div");
    triggerRow.className = "ml-compact-row";
    if (hasGreetingSubfilter) {
      triggerRow.appendChild(createIconButton({
        icon: "filter",
        label: this.showGreetingSubfilter ? `Hide Greetings (${scan.greetingBreakdown.length})` : `Filter Greetings (${scan.greetingBreakdown.length})`,
        title: "Toggle per-greeting filter",
        className: `ml-btn is-xs ${this.showGreetingSubfilter ? "is-active" : ""}`,
        size: 11,
        onClick: () => {
          this.showGreetingSubfilter = !this.showGreetingSubfilter;
          this.emitUiStateChange();
          this.render();
        }
      }));
    }
    if (hasWorldBookSubfilter) {
      triggerRow.appendChild(createIconButton({
        icon: "filter",
        label: this.showWorldBookSubfilter ? `Hide World Books (${scan.worldBookBreakdown.length})` : `Filter World Books (${scan.worldBookBreakdown.length})`,
        title: "Toggle per-World Book filter",
        className: `ml-btn is-xs ${this.showWorldBookSubfilter ? "is-active" : ""}`,
        size: 11,
        onClick: () => {
          this.showWorldBookSubfilter = !this.showWorldBookSubfilter;
          this.emitUiStateChange();
          this.render();
        }
      }));
    }
    triggerRow.appendChild(createIconButton({
      icon: "list",
      label: this.showUrlPicker ? `Hide URL List (${selectedPending.length}/${candidateItems.length})` : `Inspect & Pick URLs (${selectedPending.length}/${candidateItems.length})`,
      title: "Inspect individual candidate URLs and toggle them",
      className: `ml-btn is-xs ${this.showUrlPicker ? "is-active" : ""}`,
      size: 11,
      onClick: () => {
        this.showUrlPicker = !this.showUrlPicker;
        this.emitUiStateChange();
        this.render();
      }
    }));
    if (this.showUrlPicker && candidateItems.length > 0) {
      const thumbToggle = document.createElement("label");
      thumbToggle.className = "ml-toggle-label";
      const thumbCb = document.createElement("input");
      thumbCb.type = "checkbox";
      thumbCb.checked = this.showRemoteThumbnails;
      thumbCb.addEventListener("change", () => {
        this.showRemoteThumbnails = thumbCb.checked;
        this.emitUiStateChange();
        this.render();
      });
      thumbToggle.append(thumbCb, document.createTextNode("Previews"));
      triggerRow.appendChild(thumbToggle);
    }
    container.appendChild(triggerRow);
    if (hasGreetingSubfilter && this.showGreetingSubfilter) {
      container.appendChild(this.renderSubfilterBox({
        title: hasWorldBookSubfilter && this.showWorldBookSubfilter ? "Greetings" : undefined,
        scrollId: "greetings-subfilter",
        entries: scan.greetingBreakdown.map((g) => ({
          key: g.greetingIndex,
          label: g.label,
          remoteCount: g.remoteCount,
          failedCount: g.failedCount ?? 0
        })),
        getSelected: () => this.selectedGreetings,
        setSelected: (next) => {
          this.selectedGreetings = next;
        }
      }));
    }
    if (hasWorldBookSubfilter && this.showWorldBookSubfilter) {
      container.appendChild(this.renderSubfilterBox({
        title: hasGreetingSubfilter && this.showGreetingSubfilter ? "World Books" : undefined,
        scrollId: "worldbooks-subfilter",
        entries: scan.worldBookBreakdown.map((wb) => ({
          key: wb.worldBookId,
          label: wb.worldBookName,
          remoteCount: wb.remoteCount,
          failedCount: wb.failedCount ?? 0
        })),
        getSelected: () => this.selectedWorldBooks,
        setSelected: (next) => {
          this.selectedWorldBooks = next;
        }
      }));
    }
    if (this.showUrlPicker && candidateItems.length > 0) {
      container.appendChild(this.renderUrlPicker(scan, candidateItems));
    }
    const summaryBar = document.createElement("div");
    summaryBar.className = "ml-download-bar";
    const countNote = document.createElement("span");
    countNote.className = "ml-subtitle";
    countNote.textContent = effectivePendingCount < selectedPending.length ? `${effectivePendingCount} of ${selectedPending.length} selected (limit ${this.batchCap})` : `${selectedPending.length} selected`;
    const applyBtn = createIconButton({
      icon: "download",
      label: `Localize (${effectivePendingCount})`,
      title: "Start downloading selected items now",
      className: "ml-btn is-primary is-xs",
      size: 12,
      disabled: effectivePendingCount === 0,
      onClick: () => void this.triggerOneClickLocalize()
    });
    summaryBar.append(countNote, applyBtn);
    container.appendChild(summaryBar);
    return container;
  }
  renderSubfilterBox(opts) {
    const box = document.createElement("div");
    box.className = "ml-subfilter-box";
    if (opts.title) {
      const titleEl = document.createElement("div");
      titleEl.className = "ml-config-label";
      titleEl.textContent = opts.title;
      box.appendChild(titleEl);
    }
    const list = document.createElement("div");
    list.className = "ml-subfilter-list";
    list.dataset.scrollId = opts.scrollId;
    for (const entry of opts.entries) {
      const lbl = document.createElement("label");
      lbl.className = "ml-checkbox-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const current = opts.getSelected();
      cb.checked = current === null || current.has(entry.key);
      cb.addEventListener("change", () => {
        let next = opts.getSelected();
        if (next === null) {
          next = new Set(opts.entries.map((item) => item.key));
        }
        if (cb.checked) {
          next.add(entry.key);
        } else {
          const remaining = opts.entries.filter((item) => item.key !== entry.key && next.has(item.key));
          if (remaining.length === 0) {
            cb.checked = true;
            return;
          }
          next.delete(entry.key);
        }
        if (opts.entries.every((item) => next.has(item.key))) {
          next = null;
        }
        opts.setSelected(next);
        this.scheduleSaveOverride();
        this.render();
      });
      const summary = entry.failedCount > 0 ? `${entry.remoteCount} rem, ${entry.failedCount} err` : `${entry.remoteCount}`;
      lbl.append(cb, document.createTextNode(`${entry.label} (${summary})`));
      list.appendChild(lbl);
    }
    box.appendChild(list);
    return box;
  }
  renderUrlPicker(scan, candidateItems) {
    const urlBox = document.createElement("div");
    urlBox.className = "ml-subfilter-box";
    const urlTopBar = document.createElement("div");
    urlTopBar.className = "ml-header-bar";
    const urlTopBtns = document.createElement("div");
    urlTopBtns.className = "ml-header-actions";
    const checkAllBtn = document.createElement("button");
    checkAllBtn.type = "button";
    checkAllBtn.className = "ml-btn is-xs";
    checkAllBtn.textContent = "Check All";
    checkAllBtn.addEventListener("click", () => {
      for (const item of candidateItems)
        this.excludedUrls.delete(item.normalizedUrl);
      this.scheduleSaveOverride();
      this.render();
    });
    const uncheckAllBtn = document.createElement("button");
    uncheckAllBtn.type = "button";
    uncheckAllBtn.className = "ml-btn is-xs";
    uncheckAllBtn.textContent = "Uncheck All";
    uncheckAllBtn.addEventListener("click", () => {
      for (const item of candidateItems)
        this.excludedUrls.add(item.normalizedUrl);
      this.scheduleSaveOverride();
      this.render();
    });
    urlTopBtns.append(checkAllBtn, uncheckAllBtn);
    if (this.expandedUrls.size > 0) {
      const collapseAllBtn = document.createElement("button");
      collapseAllBtn.type = "button";
      collapseAllBtn.className = "ml-btn is-xs";
      collapseAllBtn.textContent = `Collapse (${this.expandedUrls.size})`;
      collapseAllBtn.addEventListener("click", () => {
        this.expandedUrls.clear();
        this.emitUiStateChange();
        this.render();
      });
      urlTopBtns.appendChild(collapseAllBtn);
    }
    urlTopBar.append(urlTopBtns, createInfoTip("Check or uncheck URLs to remember exclusions on this card. Click a row to inspect preview and sources."));
    urlBox.appendChild(urlTopBar);
    const urlList = document.createElement("div");
    urlList.className = "ml-url-list";
    urlList.dataset.scrollId = "url-picker-list";
    for (const item of candidateItems) {
      const isExpanded = this.expandedUrls.has(item.normalizedUrl);
      const card = document.createElement("div");
      card.className = `ml-url-item-card ${isExpanded ? "is-expanded" : ""}`;
      const row = document.createElement("div");
      row.className = "ml-url-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ml-row-checkbox";
      cb.checked = !this.excludedUrls.has(item.normalizedUrl);
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked)
          this.excludedUrls.delete(item.normalizedUrl);
        else
          this.excludedUrls.add(item.normalizedUrl);
        this.scheduleSaveOverride();
        this.render();
      });
      row.appendChild(cb);
      const safeThumbUrl = sanitizeSafeMediaUrl(item.normalizedUrl);
      if (this.showRemoteThumbnails && item.mediaKind === "image" && safeThumbUrl) {
        const thumb = document.createElement("img");
        thumb.className = "ml-url-thumb";
        thumb.loading = "lazy";
        thumb.src = safeThumbUrl;
        row.appendChild(thumb);
      }
      const meta = document.createElement("div");
      meta.className = "ml-url-meta";
      const urlText = document.createElement("div");
      urlText.className = "ml-url-text";
      urlText.textContent = item.normalizedUrl;
      const sourcesText = document.createElement("div");
      sourcesText.className = "ml-url-sources";
      const kindChip = document.createElement("span");
      const kindClass = item.status === "failed" ? "is-failed" : item.mediaKind === "video" ? "is-video" : "is-image";
      kindChip.className = `ml-kind-chip ${kindClass}`;
      kindChip.textContent = item.status === "failed" ? "FAILED" : item.mediaKind === "video" ? "VID" : "IMG";
      const refTag = item.occurrenceCount > 1 ? ` ×${item.occurrenceCount}` : "";
      const srcLabel = item.sources[0]?.label ?? "";
      sourcesText.append(kindChip, document.createTextNode(` · ${item.domain}${refTag}${srcLabel ? ` · ${srcLabel}` : ""}`));
      meta.append(urlText, sourcesText);
      const expandHint = document.createElement("span");
      expandHint.className = "ml-expand-hint";
      expandHint.textContent = isExpanded ? "▴" : "▾";
      expandHint.title = isExpanded ? "Hide URL details" : "Inspect preview & sources";
      const singleBtn = createIconButton({
        icon: item.status === "failed" ? "refresh" : "download",
        title: item.status === "failed" ? "Retry this URL" : "Localize this URL",
        className: "ml-btn ml-icon-btn is-xs",
        size: 11,
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          singleBtn.disabled = true;
          this.runAction(() => this.callbacks.onStartDownload({
            characterIds: [scan.characterId],
            explicitUrls: [item.normalizedUrl],
            includeFailed: true,
            maxItems: 1
          }));
        }
      });
      row.append(meta, expandHint, singleBtn);
      row.addEventListener("click", () => {
        if (this.expandedUrls.has(item.normalizedUrl)) {
          this.expandedUrls.delete(item.normalizedUrl);
        } else {
          this.expandedUrls.add(item.normalizedUrl);
        }
        this.emitUiStateChange();
        this.render();
      });
      card.appendChild(row);
      if (isExpanded) {
        card.appendChild(this.renderUrlItemDetails(scan, item));
      }
      urlList.appendChild(card);
    }
    urlBox.appendChild(urlList);
    return urlBox;
  }
  renderUrlItemDetails(scan, item) {
    const details = document.createElement("div");
    details.className = "ml-item-details";
    const top = document.createElement("div");
    top.className = "ml-detail-top";
    const previewBox = document.createElement("div");
    previewBox.className = "ml-detail-preview-box";
    const previewCaption = document.createElement("div");
    previewCaption.className = "ml-detail-preview-caption";
    const safeUrl = sanitizeSafeMediaUrl(item.normalizedUrl);
    if (!safeUrl) {
      previewCaption.textContent = "Blocked unsafe media URL";
      previewBox.appendChild(previewCaption);
    } else if (item.mediaKind === "video") {
      const vid = document.createElement("video");
      vid.className = "ml-detail-preview-media";
      vid.controls = true;
      vid.preload = "metadata";
      vid.src = safeUrl;
      previewCaption.textContent = "Video preview";
      vid.addEventListener("loadedmetadata", () => {
        if (vid.videoWidth && vid.videoHeight) {
          previewCaption.textContent = `${vid.videoWidth} × ${vid.videoHeight}`;
        }
      });
      vid.addEventListener("error", () => {
        previewCaption.textContent = "Preview failed";
      });
      previewBox.append(vid, previewCaption);
    } else {
      const img = document.createElement("img");
      img.className = "ml-detail-preview-media";
      img.src = safeUrl;
      img.alt = "Remote preview";
      previewCaption.textContent = "Loading preview...";
      img.addEventListener("load", () => {
        previewCaption.textContent = img.naturalWidth && img.naturalHeight ? `${img.naturalWidth} × ${img.naturalHeight} px` : "Image loaded";
      });
      img.addEventListener("error", () => {
        previewCaption.textContent = "Preview unavailable";
      });
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        safeOpenExternalUrl(safeUrl);
      });
      previewBox.append(img, previewCaption);
    }
    const infoCol = document.createElement("div");
    infoCol.className = "ml-detail-info-col";
    const urlBox = document.createElement("div");
    urlBox.className = "ml-detail-url-box";
    urlBox.textContent = item.normalizedUrl;
    const actionsRow = document.createElement("div");
    actionsRow.className = "ml-detail-kv-row";
    const copyBtn = createIconButton({
      icon: "copy",
      label: "Copy",
      title: "Copy URL",
      className: "ml-btn is-xs",
      size: 11,
      onClick: (e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText?.(item.normalizedUrl);
        const span = copyBtn.querySelector("span");
        if (span)
          span.textContent = "Copied";
      }
    });
    const openBtn = createIconButton({
      icon: "external-link",
      label: "Open",
      title: safeUrl ? "Open original URL in new tab" : "Blocked unsafe media URL",
      className: "ml-btn is-xs",
      size: 11,
      disabled: !safeUrl,
      onClick: (e) => {
        e.stopPropagation();
        safeOpenExternalUrl(item.normalizedUrl);
      }
    });
    const dlBtn = createIconButton({
      icon: "download",
      label: item.status === "failed" ? "Retry" : "Localize",
      title: "Queue this single media item",
      className: "ml-btn is-primary is-xs",
      size: 11,
      onClick: (e) => {
        e.stopPropagation();
        this.runAction(() => this.callbacks.onStartDownload({
          characterIds: [scan.characterId],
          explicitUrls: [item.normalizedUrl],
          includeFailed: true,
          maxItems: 1
        }));
      }
    });
    actionsRow.append(copyBtn, openBtn, dlBtn);
    infoCol.append(urlBox, actionsRow);
    const sourcesList = document.createElement("div");
    sourcesList.className = "ml-detail-source-list";
    for (const src of item.sources) {
      const chip = document.createElement("span");
      chip.className = "ml-detail-source-chip";
      chip.textContent = src.label;
      sourcesList.appendChild(chip);
    }
    infoCol.appendChild(sourcesList);
    if (item.failureInfo) {
      const errBox = document.createElement("div");
      errBox.className = "ml-detail-error-box";
      errBox.textContent = item.failureInfo.error;
      infoCol.appendChild(errBox);
    }
    top.append(previewBox, infoCol);
    details.appendChild(top);
    return details;
  }
  renderCombinedOptionsAndMediaSection(scan, candidateItems, selectedPending, effectivePendingCount) {
    const section = document.createElement("div");
    section.className = "ml-section ml-combined-drawer";
    const expressions = scan.media?.expressions ?? [];
    const exprImageIds = new Set(expressions.map((e) => e.imageId));
    const localizedItems = scan.items.filter((item) => item.status === "localized" && Boolean(item.localizedEntry) && !exprImageIds.has(item.localizedEntry.imageId));
    const hasAvatar = Boolean(scan.media?.avatarUrl);
    const bar = document.createElement("div");
    bar.className = "ml-combined-bar";
    const mediaBtn = document.createElement("button");
    mediaBtn.type = "button";
    mediaBtn.className = `ml-combined-trigger ${this.showDownloadedMedia ? "is-active" : ""}`.trim();
    const mediaTitle = this.showDownloadedMedia ? "Collapse Downloaded Media" : "Expand Downloaded Media";
    mediaBtn.title = mediaTitle;
    mediaBtn.setAttribute("aria-label", mediaTitle);
    mediaBtn.setAttribute("aria-expanded", String(this.showDownloadedMedia));
    mediaBtn.appendChild(createIcon("image", 13));
    const mediaLabel = document.createElement("span");
    mediaLabel.textContent = `Downloaded Media (${localizedItems.length}${expressions.length > 0 ? ` + ${expressions.length} expr` : ""})`;
    mediaBtn.append(mediaLabel, createIcon(this.showDownloadedMedia ? "chevron-down" : "chevron-right", 12));
    mediaBtn.addEventListener("click", () => {
      this.showDownloadedMedia = !this.showDownloadedMedia;
      this.emitUiStateChange();
      this.render();
    });
    const mediaTip = createInfoTip("Click any tile to open the lightbox. Character Avatar and native Expressions are read-only; localized assets can be removed individually or in bulk.");
    const optionsBtn = document.createElement("button");
    optionsBtn.type = "button";
    optionsBtn.className = `ml-combined-trigger ${this.showDownloadConfig ? "is-active" : ""}`.trim();
    const optionsTitle = this.showDownloadConfig ? "Hide download options & URL inspector" : "Customize per-card download options & inspect individual URLs";
    optionsBtn.title = optionsTitle;
    optionsBtn.setAttribute("aria-label", optionsTitle);
    optionsBtn.setAttribute("aria-expanded", String(this.showDownloadConfig));
    optionsBtn.appendChild(createIcon("sliders", 13));
    const optionsLabel = document.createElement("span");
    optionsLabel.textContent = "Options";
    optionsBtn.appendChild(optionsLabel);
    if (this.hasCustomOverride) {
      const customBadge = document.createElement("span");
      customBadge.className = "ml-badge is-info";
      customBadge.textContent = "Custom";
      optionsBtn.appendChild(customBadge);
    }
    optionsBtn.appendChild(createIcon(this.showDownloadConfig ? "chevron-down" : "chevron-right", 12));
    optionsBtn.addEventListener("click", () => {
      this.showDownloadConfig = !this.showDownloadConfig;
      this.emitUiStateChange();
      this.render();
    });
    bar.append(mediaBtn, mediaTip, optionsBtn);
    section.appendChild(bar);
    if (this.showDownloadConfig) {
      section.appendChild(this.renderOptionsSection(scan, candidateItems, selectedPending, effectivePendingCount));
    }
    if (!this.showDownloadedMedia) {
      this.mediaTileCache.clear();
      return section;
    }
    const allTiles = [];
    const onEditCharacter = this.callbacks.onOpenCharacterEditor ? () => this.callbacks.onOpenCharacterEditor(scan.characterId) : undefined;
    if (hasAvatar && scan.media?.avatarUrl) {
      allTiles.push({
        cacheKey: `avatar:${scan.characterId}`,
        lightbox: {
          id: `avatar:${scan.characterId}`,
          localUrl: scan.media.avatarUrl,
          mediaKind: "image",
          title: `${scan.characterName} — Avatar`,
          subtitle: "Character card avatar",
          readOnly: true,
          badgeText: "Avatar",
          onEditCharacter
        },
        badge: "Avatar",
        badgeVariant: "is-info",
        caption: "Character Avatar",
        subcaption: scan.characterName,
        isExpression: false,
        mediaKind: "image"
      });
    }
    for (const item of localizedItems) {
      const entry = item.localizedEntry;
      allTiles.push({
        cacheKey: `loc:${entry.imageId}:${item.normalizedUrl}`,
        lightbox: {
          id: entry.imageId,
          localUrl: entry.localUrl,
          mediaKind: item.mediaKind,
          title: entry.filename,
          subtitle: `${formatBytes(entry.sizeBytes)} · ${item.sources.map((s) => s.label).join(", ")}`,
          originalUrl: item.normalizedUrl,
          readOnly: false,
          badgeText: item.mediaKind === "video" ? "Video" : "Localized",
          onEditCharacter,
          onRemove: async () => {
            await this.callbacks.onPurgeCharacterCache(scan.characterId, [item.normalizedUrl]);
          }
        },
        badge: item.mediaKind === "video" ? "Vid" : "Local",
        caption: entry.filename,
        subcaption: `${formatBytes(entry.sizeBytes)} · ${item.sources[0]?.label ?? item.domain}`,
        isExpression: false,
        mediaKind: item.mediaKind,
        urlToRemove: item.normalizedUrl
      });
    }
    for (const expr of expressions) {
      allTiles.push({
        cacheKey: `expr:${expr.imageId}:${expr.label}`,
        lightbox: {
          id: `expr:${expr.imageId}:${expr.label}`,
          localUrl: expr.localUrl,
          mediaKind: "image",
          title: expr.label,
          subtitle: expr.groupName ? `Native expression (${expr.groupName}) · read-only` : "Native expression · read-only",
          readOnly: true,
          badgeText: "Expression",
          onEditCharacter
        },
        badge: "Expr",
        badgeVariant: "is-info",
        caption: expr.label,
        subcaption: expr.groupName ? `Group: ${expr.groupName}` : "Native Expression",
        isExpression: true,
        mediaKind: "image"
      });
    }
    const filteredTiles = allTiles.filter((t) => {
      if (this.mediaFilter === "localized")
        return !t.isExpression && !t.badge.includes("Avatar");
      if (this.mediaFilter === "expressions")
        return t.isExpression;
      if (this.mediaFilter === "video")
        return t.mediaKind === "video";
      return true;
    });
    const mediaPane = document.createElement("div");
    mediaPane.className = "ml-combined-pane ml-media-pane";
    const mediaToolbar = document.createElement("div");
    mediaToolbar.className = "ml-header-bar ml-media-toolbar";
    const filterSelect = document.createElement("select");
    filterSelect.className = "ml-select is-sm";
    filterSelect.title = "Filter shown media tiles";
    const filterChoices = [
      { val: "all", label: `All (${allTiles.length})` },
      { val: "localized", label: `Local (${localizedItems.length})` },
      { val: "expressions", label: `Expr (${expressions.length})` },
      { val: "video", label: "Videos" }
    ];
    for (const c of filterChoices) {
      const opt = document.createElement("option");
      opt.value = c.val;
      opt.textContent = c.label;
      if (c.val === this.mediaFilter)
        opt.selected = true;
      filterSelect.appendChild(opt);
    }
    filterSelect.value = this.mediaFilter;
    filterSelect.addEventListener("change", () => {
      this.mediaFilter = filterSelect.value;
      this.emitUiStateChange();
      this.render();
    });
    const toolbar = document.createElement("div");
    toolbar.className = "ml-header-actions";
    const seg = document.createElement("div");
    seg.className = "ml-segmented";
    seg.appendChild(createIconButton({
      icon: "grid",
      title: "Grid view",
      className: `ml-btn ml-icon-btn is-sm ${this.mediaViewMode === "grid" ? "is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.mediaViewMode = "grid";
        this.emitUiStateChange();
        this.render();
      }
    }));
    seg.appendChild(createIconButton({
      icon: "list",
      title: "List view",
      className: `ml-btn ml-icon-btn is-sm ${this.mediaViewMode === "list" ? "is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.mediaViewMode = "list";
        this.emitUiStateChange();
        this.render();
      }
    }));
    toolbar.appendChild(seg);
    toolbar.appendChild(createThumbnailSizeSegmented(this.thumbnailSize, (nextSize) => {
      if (nextSize === this.thumbnailSize)
        return;
      this.thumbnailSize = nextSize;
      this.emitUiStateChange();
      this.render();
    }));
    if (localizedItems.length > 0) {
      toolbar.appendChild(createIconButton({
        icon: "trash",
        title: `Remove all ${localizedItems.length} localized assets for this character`,
        className: "ml-btn ml-icon-btn is-danger is-sm",
        size: 13,
        onClick: async () => {
          const targetCharId = scan.characterId;
          const msg = this.settings.deleteImagesOnPurge ? `Remove all ${localizedItems.length} localized media assets for "${scan.characterName}" from the Gallery & local cache? Original card URLs and native expressions remain untouched.` : `Remove all ${localizedItems.length} localized index entries for "${scan.characterName}"? Stored Gallery images will be kept.`;
          const res = await this.ctx.ui.showConfirm({
            title: "Remove Localized Media",
            message: msg,
            confirmLabel: "Remove All",
            cancelLabel: "Cancel",
            variant: "danger"
          });
          if (this.destroyed || this.characterId !== targetCharId || !res?.confirmed) {
            return;
          }
          await this.runAction(async () => {
            await this.callbacks.onPurgeCharacterCache(targetCharId);
            if (this.destroyed || this.characterId !== targetCharId)
              return;
            await this.refreshScan(false);
          });
        }
      }));
    }
    mediaToolbar.append(filterSelect, toolbar);
    mediaPane.appendChild(mediaToolbar);
    if (filteredTiles.length === 0) {
      this.mediaTileCache.clear();
      const empty = document.createElement("div");
      empty.className = "ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon(allTiles.length === 0 ? "image" : "filter", 18));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent = allTiles.length === 0 ? "No downloaded media or expressions yet." : "No items match this filter.";
      empty.append(iconWrap, textEl);
      mediaPane.appendChild(empty);
      section.appendChild(mediaPane);
      return section;
    }
    const lightboxItems = filteredTiles.map((t) => t.lightbox);
    const seenKeys = new Map;
    const usedKeys = new Set;
    const nextTileCacheKey = (tile) => {
      const base = `${this.mediaViewMode}:${tile.cacheKey}`;
      const occ = seenKeys.get(base) ?? 0;
      seenKeys.set(base, occ + 1);
      return occ === 0 ? base : `${base}#${occ}`;
    };
    const thumbTier = getThumbnailImageTier(this.thumbnailSize);
    const computeTileSig = (tile) => {
      const thumbSrc = toThumbnailMediaUrl(sanitizeSafeMediaUrl(tile.lightbox.localUrl), tile.mediaKind, thumbTier) ?? tile.lightbox.localUrl;
      return [
        scan.characterId,
        thumbSrc,
        tile.mediaKind,
        tile.caption,
        tile.subcaption,
        tile.badge,
        tile.badgeVariant ?? "",
        tile.isExpression ? "1" : "0",
        tile.urlToRemove ?? ""
      ].join("\x01");
    };
    if (this.mediaViewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      list.dataset.scrollId = "localized-asset-grid";
      filteredTiles.forEach((tile, index) => {
        const key = nextTileCacheKey(tile);
        const sig = computeTileSig(tile);
        usedKeys.add(key);
        const cached = this.mediaTileCache.get(key);
        let row;
        if (cached && cached.sig === sig) {
          row = cached.el;
          reobserveLazyMedia(row);
          const rmBtn = row.querySelector("button.is-danger");
          if (rmBtn)
            rmBtn.disabled = false;
        } else {
          row = document.createElement("div");
          row.className = "ml-media-list-row";
          row.addEventListener("click", () => this.tileClickHandlers.get(row)?.());
          const thumbWrap = document.createElement("div");
          thumbWrap.className = "ml-media-list-thumb-wrap";
          const thumb = createLazyMediaElement({
            src: tile.lightbox.localUrl,
            mediaKind: tile.mediaKind,
            alt: tile.caption,
            className: "ml-media-list-thumb",
            thumbTier
          });
          thumbWrap.appendChild(thumb);
          if (tile.mediaKind === "video") {
            const kindIndicator = document.createElement("span");
            kindIndicator.className = "ml-media-list-kind-badge";
            kindIndicator.setAttribute("aria-hidden", "true");
            kindIndicator.appendChild(createIcon("play", 9));
            thumbWrap.appendChild(kindIndicator);
          }
          const info = document.createElement("div");
          info.className = "ml-url-meta";
          const cap = document.createElement("div");
          cap.className = "ml-url-text";
          cap.textContent = tile.caption;
          const sub = document.createElement("div");
          sub.className = "ml-url-sources";
          sub.textContent = tile.subcaption;
          info.append(cap, sub);
          const badgeVariant = tile.badgeVariant ?? (tile.mediaKind === "video" ? "is-info" : "is-success");
          const badge = document.createElement("span");
          badge.className = `ml-badge ${badgeVariant}`.trim();
          badge.textContent = tile.badge;
          row.append(thumbWrap, info, badge);
          if (tile.urlToRemove) {
            const urlToRemove = tile.urlToRemove;
            const rmBtn = createIconButton({
              icon: "trash",
              title: "Remove localized asset",
              className: "ml-btn ml-icon-btn is-danger is-sm",
              size: 12,
              onClick: async (ev) => {
                ev.stopPropagation();
                rmBtn.disabled = true;
                try {
                  await this.runAction(async () => {
                    await this.callbacks.onPurgeCharacterCache(scan.characterId, [
                      urlToRemove
                    ]);
                    await this.refreshScan(false);
                  });
                } finally {
                  if (!this.destroyed) {
                    rmBtn.disabled = false;
                  }
                }
              }
            });
            row.appendChild(rmBtn);
          }
          this.mediaTileCache.set(key, { sig, el: row });
        }
        this.tileClickHandlers.set(row, () => openMediaLightbox(lightboxItems, index, () => void this.refreshScan(false)));
        list.appendChild(row);
      });
      for (const key of this.mediaTileCache.keys()) {
        if (!usedKeys.has(key))
          this.mediaTileCache.delete(key);
      }
      mediaPane.appendChild(list);
      section.appendChild(mediaPane);
      return section;
    }
    const grid = document.createElement("div");
    grid.className = "ml-asset-grid";
    grid.dataset.scrollId = "localized-asset-grid";
    filteredTiles.forEach((tile, index) => {
      const key = nextTileCacheKey(tile);
      const sig = computeTileSig(tile);
      usedKeys.add(key);
      const cached = this.mediaTileCache.get(key);
      let card;
      if (cached && cached.sig === sig) {
        card = cached.el;
        reobserveLazyMedia(card);
        const rmBtn = card.querySelector("button.is-danger");
        if (rmBtn)
          rmBtn.disabled = false;
      } else {
        card = document.createElement("div");
        card.className = "ml-asset-card";
        const mediaWrap = document.createElement("div");
        mediaWrap.className = "ml-asset-thumb-wrap";
        const thumb = createLazyMediaElement({
          src: tile.lightbox.localUrl,
          mediaKind: tile.mediaKind,
          alt: tile.caption,
          className: "ml-asset-preview",
          title: `${tile.caption} — Click to preview`,
          thumbTier
        });
        mediaWrap.addEventListener("click", () => this.tileClickHandlers.get(card)?.());
        const tileBadgeVariant = tile.badge === "Avatar" ? "is-avatar" : tile.isExpression ? "is-expression" : tile.mediaKind === "video" ? "is-video" : "is-local";
        const cornerBadge = document.createElement("span");
        cornerBadge.className = `ml-tile-badge ${tileBadgeVariant}`;
        cornerBadge.textContent = tile.badge;
        mediaWrap.append(thumb, cornerBadge);
        const footer = document.createElement("div");
        footer.className = "ml-asset-footer";
        const capRow = document.createElement("div");
        capRow.className = "ml-asset-cap-row";
        const metaLine = document.createElement("div");
        metaLine.className = "ml-url-sources";
        metaLine.textContent = tile.isExpression ? tile.caption : tile.subcaption;
        metaLine.title = `${tile.caption}
${tile.subcaption}`;
        capRow.appendChild(metaLine);
        if (tile.urlToRemove) {
          const urlToRemove = tile.urlToRemove;
          const rmBtn = createIconButton({
            icon: "trash",
            title: "Remove from cache & Character Gallery",
            className: "ml-btn ml-icon-btn is-danger is-xs",
            size: 11,
            onClick: async (ev) => {
              ev.stopPropagation();
              rmBtn.disabled = true;
              try {
                await this.runAction(async () => {
                  await this.callbacks.onPurgeCharacterCache(scan.characterId, [
                    urlToRemove
                  ]);
                  await this.refreshScan(false);
                });
              } finally {
                if (!this.destroyed) {
                  rmBtn.disabled = false;
                }
              }
            }
          });
          capRow.appendChild(rmBtn);
        }
        footer.appendChild(capRow);
        card.append(mediaWrap, footer);
        this.mediaTileCache.set(key, { sig, el: card });
      }
      this.tileClickHandlers.set(card, () => openMediaLightbox(lightboxItems, index, () => void this.refreshScan(false)));
      grid.appendChild(card);
    });
    for (const key of this.mediaTileCache.keys()) {
      if (!usedKeys.has(key))
        this.mediaTileCache.delete(key);
    }
    mediaPane.appendChild(grid);
    section.appendChild(mediaPane);
    return section;
  }
}

// src/ui/library-gallery.ts
var ALL_GALLERY_MEDIA_TYPES = [
  "image",
  "video",
  "expression",
  "avatar"
];
var GALLERY_PAGE_SIZE_OPTIONS = [24, 48, 96, 192, 0];
var DEFAULT_GALLERY_PAGE_SIZE = 48;
var VALID_SORT_MODES = new Set([
  "recent",
  "name",
  "count",
  "size",
  "random"
]);
function getDefaultGalleryPreferences() {
  return {
    grouped: true,
    viewMode: "grid",
    sortMode: "name",
    sortDirection: "asc",
    selectedMediaTypes: [...ALL_GALLERY_MEDIA_TYPES],
    includeEmptyCharacters: false,
    pageSize: DEFAULT_GALLERY_PAGE_SIZE,
    thumbnailSize: DEFAULT_THUMBNAIL_SIZE
  };
}
function sanitizeGalleryPreferences(raw) {
  const defaults = getDefaultGalleryPreferences();
  if (!raw || typeof raw !== "object")
    return defaults;
  const obj = raw;
  const grouped = typeof obj.grouped === "boolean" ? obj.grouped : defaults.grouped;
  const viewMode = obj.viewMode === "grid" || obj.viewMode === "list" ? obj.viewMode : defaults.viewMode;
  let sortMode = typeof obj.sortMode === "string" && VALID_SORT_MODES.has(obj.sortMode) ? obj.sortMode : defaults.sortMode;
  if (!grouped && sortMode === "count") {
    sortMode = "recent";
  }
  const sortDirection = obj.sortDirection === "asc" || obj.sortDirection === "desc" ? obj.sortDirection : defaults.sortDirection;
  const selectedMediaTypes = Array.isArray(obj.selectedMediaTypes) ? Array.from(new Set(obj.selectedMediaTypes.filter((t) => ALL_GALLERY_MEDIA_TYPES.includes(String(t))))) : [...defaults.selectedMediaTypes];
  const includeEmptyCharacters = typeof obj.includeEmptyCharacters === "boolean" ? obj.includeEmptyCharacters : defaults.includeEmptyCharacters;
  const rawPageSize = Number(obj.pageSize);
  const pageSize = GALLERY_PAGE_SIZE_OPTIONS.includes(rawPageSize) ? rawPageSize : defaults.pageSize;
  const thumbnailSize = sanitizeThumbnailSize(obj.thumbnailSize);
  return {
    grouped,
    viewMode,
    sortMode,
    sortDirection,
    selectedMediaTypes,
    includeEmptyCharacters,
    pageSize,
    thumbnailSize
  };
}
function parseGallerySearchQuery(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      hasQuery: false,
      tagFilters: [],
      hashOrTextFilters: [],
      textTerms: []
    };
  }
  const tagFilters = [];
  const hashOrTextFilters = [];
  const textTerms = [];
  const tokenRe = /(?:tag:|#)("[^"]*"|\S+)|"([^"]*)"|(\S+)/gi;
  let match;
  while ((match = tokenRe.exec(trimmed)) !== null) {
    const full = match[0];
    if (match[1] !== undefined) {
      const rawInner = match[1];
      const inner = (rawInner.startsWith('"') ? rawInner.slice(1, rawInner.endsWith('"') && rawInner.length > 1 ? -1 : undefined) : rawInner).trim().toLowerCase();
      if (!inner)
        continue;
      if (full.toLowerCase().startsWith("tag:")) {
        tagFilters.push(inner);
      } else {
        hashOrTextFilters.push(inner);
      }
      continue;
    }
    const plain = (match[2] ?? match[3] ?? "").trim().toLowerCase();
    if (!plain || plain === "tag:" || plain === "#")
      continue;
    textTerms.push(plain);
  }
  return {
    hasQuery: tagFilters.length > 0 || hashOrTextFilters.length > 0 || textTerms.length > 0,
    tagFilters,
    hashOrTextFilters,
    textTerms
  };
}
function matchesTagFilters(lowerTags, parsed) {
  for (const tagFilter of parsed.tagFilters) {
    if (!lowerTags.some((t) => t.includes(tagFilter))) {
      return false;
    }
  }
  return true;
}
function matchesSearchText(haystacks, lowerTags, parsed) {
  if (!parsed.hasQuery)
    return true;
  if (!matchesTagFilters(lowerTags, parsed))
    return false;
  for (const hashTerm of parsed.hashOrTextFilters) {
    const tagHit = lowerTags.some((t) => t.includes(hashTerm));
    const literalHit = haystacks.some((h) => h.includes(`#${hashTerm}`));
    if (!tagHit && !literalHit)
      return false;
  }
  for (const term of parsed.textTerms) {
    const tagHit = lowerTags.some((t) => t.includes(term));
    const textHit = haystacks.some((h) => h.includes(term));
    if (!tagHit && !textHit)
      return false;
  }
  return true;
}
var GALLERY_COLLATOR = new Intl.Collator;
var MAX_WARM_THUMB_CACHE = 240;
var MAX_DOM_NODE_CACHE = 192;
var EAGER_PAGE_ITEM_LIMIT = 96;
var EAGER_LEADING_WINDOW = 48;
var warmThumbCache = new Map;
function warmGalleryThumb(url) {
  if (!url || typeof Image !== "function")
    return;
  const existing = warmThumbCache.get(url);
  if (existing) {
    warmThumbCache.delete(url);
    warmThumbCache.set(url, existing);
    return;
  }
  try {
    const preloader = new Image;
    preloader.decoding = "async";
    preloader.src = url;
    warmThumbCache.set(url, preloader);
    if (warmThumbCache.size > MAX_WARM_THUMB_CACHE) {
      const oldestKey = warmThumbCache.keys().next().value;
      if (oldestKey !== undefined) {
        warmThumbCache.delete(oldestKey);
      }
    }
  } catch {}
}
function clearWarmGalleryThumbs(url) {
  if (url !== undefined) {
    warmThumbCache.delete(url);
    return;
  }
  warmThumbCache.clear();
}
function createGalleryMediaElement(options) {
  const thumbTier = options.thumbTier ?? "sm";
  if (options.mediaKind === "image" && options.eager) {
    const safeSrc = sanitizeSafeMediaUrl(options.src);
    const thumbSrc = toThumbnailMediaUrl(safeSrc, "image", thumbTier);
    const img = document.createElement("img");
    img.className = options.className;
    img.loading = "eager";
    img.decoding = "async";
    img.alt = options.alt;
    if (options.title)
      img.title = options.title;
    if (thumbSrc) {
      img.src = thumbSrc;
      warmGalleryThumb(thumbSrc);
    }
    return img;
  }
  const el = createLazyMediaElement({
    src: options.src,
    mediaKind: options.mediaKind,
    alt: options.alt,
    className: options.className,
    title: options.title,
    eager: options.eager,
    thumbTier
  });
  if (options.mediaKind === "image") {
    const img = el;
    img.loading = "eager";
    const safeSrc = sanitizeSafeMediaUrl(options.src);
    const thumbSrc = toThumbnailMediaUrl(safeSrc, "image", thumbTier);
    if (thumbSrc) {
      if (img.complete && img.src) {
        warmGalleryThumb(thumbSrc);
      } else if (typeof img.addEventListener === "function") {
        img.addEventListener("load", () => warmGalleryThumb(thumbSrc), { once: true });
      }
    }
  }
  return el;
}
function isGalleryMediaContainer(el) {
  const cls = el.className ?? "";
  return cls.includes("ml-char-card-grid") || cls.includes("ml-asset-grid") || cls.includes("ml-media-list");
}
function reconcileContainerChildren(container, nextChildren) {
  const current = Array.from(container.children);
  if (current.length === nextChildren.length && nextChildren.every((el, idx) => current[idx] === el)) {
    return;
  }
  if (typeof container.insertBefore !== "function") {
    container.innerHTML = "";
    for (const child of nextChildren) {
      container.appendChild(child);
    }
    return;
  }
  const keepSet = new Set(nextChildren);
  for (const child of current) {
    if (!keepSet.has(child)) {
      child.remove();
    }
  }
  let cursor = container.firstElementChild;
  for (const target of nextChildren) {
    while (cursor && !keepSet.has(cursor)) {
      const nextSib = cursor.nextElementSibling;
      cursor.remove();
      cursor = nextSib;
    }
    if (cursor === target) {
      cursor = cursor.nextElementSibling;
    } else {
      container.insertBefore(target, cursor);
    }
  }
}
function updateContentSlotInPlace(bodyOnly, nextContent) {
  if (typeof bodyOnly.insertBefore !== "function") {
    bodyOnly.replaceWith(nextContent);
    return;
  }
  const oldChildren = Array.from(bodyOnly.children);
  const newChildren = Array.from(nextContent.children);
  const oldGrid = oldChildren.find(isGalleryMediaContainer);
  const newGrid = newChildren.find(isGalleryMediaContainer);
  if (!oldGrid || !newGrid || oldGrid.className !== newGrid.className) {
    bodyOnly.replaceWith(nextContent);
    return;
  }
  const nextCards = Array.from(newGrid.children);
  reconcileContainerChildren(oldGrid, nextCards);
  const newGridIdx = newChildren.indexOf(newGrid);
  for (const child of oldChildren) {
    if (child !== oldGrid) {
      child.remove();
    }
  }
  for (let i = 0;i < newChildren.length; i++) {
    if (i === newGridIdx)
      continue;
    const child = newChildren[i];
    if (i < newGridIdx) {
      bodyOnly.insertBefore(child, oldGrid);
    } else {
      bodyOnly.appendChild(child);
    }
  }
}
function inferKind(mimeType, filename) {
  if (mimeType.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(filename)) {
    return "video";
  }
  return "image";
}
function hasCharacterMedia(char) {
  return char.localizedAssets.length > 0 || char.expressions.length > 0;
}
function formatCharacterSummary(char) {
  const parts = [];
  if (char.localizedAssets.length > 0) {
    parts.push(`${char.localizedAssets.length} media`);
  }
  if (char.expressions.length > 0) {
    parts.push(`${char.expressions.length} expr`);
  }
  if (char.totalSizeBytes > 0) {
    parts.push(formatBytes(char.totalSizeBytes));
  }
  return parts.length > 0 ? parts.join(" · ") : "No media";
}
function defaultDirectionForSort(mode) {
  return mode === "name" ? "asc" : "desc";
}
function buildGalleryEmptyState(options) {
  const el = document.createElement("div");
  el.className = options.className ?? "ml-empty ml-empty-card";
  const iconWrap = document.createElement("span");
  iconWrap.className = "ml-empty-icon";
  iconWrap.appendChild(createIcon(options.icon, 15));
  const text = document.createElement("div");
  text.className = "ml-empty-text";
  text.textContent = options.message;
  el.append(iconWrap, text);
  return el;
}
function buildTileKindBadge(options) {
  const badge = document.createElement("span");
  badge.className = options.modifier ? `ml-tile-badge ${options.modifier}` : "ml-tile-badge";
  if (options.title)
    badge.title = options.title;
  if (options.icon) {
    badge.appendChild(createIcon(options.icon, 9));
  }
  const span = document.createElement("span");
  span.textContent = options.label;
  badge.appendChild(span);
  return badge;
}

class LibraryGalleryView {
  root;
  callbacks;
  characters = null;
  precomputedCharCache = new WeakMap;
  loading = false;
  error = null;
  destroyed = false;
  activeRefreshPromise = null;
  pendingRefresh = null;
  grouped = true;
  viewMode = "grid";
  sortMode = "name";
  sortDirection = "asc";
  selectedMediaTypes = new Set(ALL_GALLERY_MEDIA_TYPES);
  includeEmptyCharacters = false;
  loadedIncludeEmpty = false;
  pageSize = DEFAULT_GALLERY_PAGE_SIZE;
  thumbnailSize = DEFAULT_THUMBNAIL_SIZE;
  currentPage = 1;
  randomWeights = new Map;
  randomWeightsDirty = false;
  searchQuery = "";
  activeCharacterId = null;
  listScrollTop = 0;
  listPageBeforeDrilldown = 1;
  widgetWrapEl = null;
  refreshBtnEl = null;
  charCardCache = new Map;
  assetCardCache = new Map;
  listRowCache = new Map;
  cardClickHandlers = new WeakMap;
  cardEditHandlers = new WeakMap;
  rememberedScrollContainer = null;
  pendingScrollRestore = null;
  constructor(root, callbacks, initial) {
    this.root = root;
    this.callbacks = callbacks;
    if (initial?.state) {
      const prefs = sanitizeGalleryPreferences(initial.state);
      this.grouped = prefs.grouped;
      this.viewMode = prefs.viewMode;
      this.sortMode = prefs.sortMode;
      this.sortDirection = prefs.sortDirection;
      this.selectedMediaTypes = new Set(prefs.selectedMediaTypes);
      this.includeEmptyCharacters = prefs.includeEmptyCharacters;
      this.pageSize = prefs.pageSize;
      this.thumbnailSize = prefs.thumbnailSize;
      if (typeof initial.state.searchQuery === "string") {
        this.searchQuery = initial.state.searchQuery;
      }
      if (typeof initial.state.currentPage === "number" && Number.isFinite(initial.state.currentPage) && initial.state.currentPage >= 1) {
        this.currentPage = Math.floor(initial.state.currentPage);
      }
      if (typeof initial.state.activeCharacterId === "string" || initial.state.activeCharacterId === null) {
        this.activeCharacterId = initial.state.activeCharacterId;
      }
      if (typeof initial.state.listScrollTop === "number" && Number.isFinite(initial.state.listScrollTop) && initial.state.listScrollTop >= 0) {
        this.listScrollTop = initial.state.listScrollTop;
      }
      if (typeof initial.state.listPageBeforeDrilldown === "number" && Number.isFinite(initial.state.listPageBeforeDrilldown) && initial.state.listPageBeforeDrilldown >= 1) {
        this.listPageBeforeDrilldown = Math.floor(initial.state.listPageBeforeDrilldown);
      }
    }
    if (initial?.cache) {
      this.characters = initial.cache.characters;
      this.loadedIncludeEmpty = Boolean(initial.cache.loadedIncludeEmpty);
      if (initial.cache.randomWeights) {
        this.randomWeights = new Map(initial.cache.randomWeights);
      }
    }
  }
  getState() {
    return {
      grouped: this.grouped,
      viewMode: this.viewMode,
      sortMode: this.sortMode,
      sortDirection: this.sortDirection,
      selectedMediaTypes: Array.from(this.selectedMediaTypes),
      includeEmptyCharacters: this.includeEmptyCharacters,
      pageSize: this.pageSize,
      thumbnailSize: this.thumbnailSize,
      searchQuery: this.searchQuery,
      currentPage: this.currentPage,
      activeCharacterId: this.activeCharacterId,
      listScrollTop: this.listScrollTop,
      listPageBeforeDrilldown: this.listPageBeforeDrilldown
    };
  }
  getScrollContainer() {
    return resolveScrollContainer(this.root.parentElement, this.rememberedScrollContainer, this.root.parentElement);
  }
  readScrollTop() {
    if (this.callbacks.onGetScrollTop) {
      const value = this.callbacks.onGetScrollTop();
      return Number.isFinite(value) && value >= 0 ? value : 0;
    }
    const host = this.getScrollContainer();
    if (host && typeof host.scrollTop === "number" && Number.isFinite(host.scrollTop)) {
      this.rememberedScrollContainer = host;
      return Math.max(0, host.scrollTop);
    }
    return 0;
  }
  applyScrollTop(scrollTop) {
    const next = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
    if (this.callbacks.onSetScrollTop) {
      this.callbacks.onSetScrollTop(next);
      return;
    }
    this.pendingScrollRestore = applyScrollTopWithSettlement(() => this.getScrollContainer(), next, this.pendingScrollRestore, () => this.destroyed);
  }
  destroy() {
    this.destroyed = true;
    this.pendingScrollRestore?.cancel();
    this.pendingScrollRestore = null;
    this.rememberedScrollContainer = null;
    this.pendingRefresh = null;
    this.widgetWrapEl = null;
    this.refreshBtnEl = null;
    this.clearRenderCaches();
  }
  syncWrapperThumbnailClass() {
    if (this.widgetWrapEl) {
      this.widgetWrapEl.className = `ml-widget ${getThumbnailSizeClass(this.thumbnailSize)}`;
    }
  }
  clearRenderCaches() {
    this.charCardCache.clear();
    this.assetCardCache.clear();
    this.listRowCache.clear();
  }
  pruneRenderCache(cache, usedKeys, maxSize = MAX_DOM_NODE_CACHE) {
    const limit = Math.max(maxSize, usedKeys.size);
    if (cache.size <= limit)
      return;
    for (const key of cache.keys()) {
      if (cache.size <= limit)
        break;
      if (!usedKeys.has(key)) {
        cache.delete(key);
      }
    }
  }
  syncToolbarControls() {
    if (this.refreshBtnEl) {
      this.refreshBtnEl.disabled = this.loading;
      this.refreshBtnEl.className = `ml-btn ml-icon-btn is-sm${this.loading ? " is-busy" : ""}`;
    }
  }
  emitStateChange() {
    if (this.destroyed)
      return;
    this.callbacks.onStateChange?.(this.getState());
  }
  emitCacheChange() {
    if (this.destroyed)
      return;
    this.callbacks.onCacheChange?.({
      characters: this.characters,
      loadedIncludeEmpty: this.loadedIncludeEmpty,
      randomWeights: new Map(this.randomWeights)
    });
  }
  flushRandomWeightsCache() {
    if (!this.randomWeightsDirty)
      return;
    this.randomWeightsDirty = false;
    this.emitCacheChange();
  }
  async refresh(options = true) {
    if (this.destroyed)
      return;
    const preserveActive = typeof options === "boolean" ? options : options.preserveActive ?? true;
    const reshuffleRandom = typeof options === "boolean" ? true : options.reshuffleRandom ?? true;
    if (this.activeRefreshPromise) {
      this.pendingRefresh = {
        preserveActive: this.pendingRefresh ? this.pendingRefresh.preserveActive && preserveActive : preserveActive,
        reshuffleRandom: this.pendingRefresh ? this.pendingRefresh.reshuffleRandom || reshuffleRandom : reshuffleRandom
      };
      return this.activeRefreshPromise;
    }
    const run = (async () => {
      const prevActiveCharId = this.activeCharacterId;
      const prevHadError = Boolean(this.error) || Boolean(this.root.querySelector(".ml-error-banner"));
      let drilldownExited = false;
      let nextRefresh = {
        preserveActive,
        reshuffleRandom
      };
      while (nextRefresh !== null && !this.destroyed) {
        const current = nextRefresh;
        nextRefresh = null;
        this.loading = true;
        this.error = null;
        const requestedIncludeEmpty = this.includeEmptyCharacters;
        if (this.sortMode === "random" && current.reshuffleRandom) {
          this.reshuffleRandomOrder();
        }
        if (!this.characters) {
          this.render();
        } else if (this.root.querySelector(".ml-gallery-toolbar")) {
          this.syncToolbarControls();
        }
        try {
          const loaded = await this.callbacks.onLoadLibraryMedia({
            includeEmpty: requestedIncludeEmpty
          });
          if (this.destroyed)
            return;
          this.characters = loaded;
          this.precomputedCharCache = new WeakMap;
          this.loadedIncludeEmpty = requestedIncludeEmpty;
          const activeCharMissing = Boolean(this.activeCharacterId) && !this.characters.some((c) => c.characterId === this.activeCharacterId);
          if (!current.preserveActive || activeCharMissing) {
            this.activeCharacterId = null;
            if (activeCharMissing && current.preserveActive) {
              this.currentPage = this.listPageBeforeDrilldown >= 1 ? this.listPageBeforeDrilldown : 1;
              drilldownExited = true;
            }
          }
          this.emitCacheChange();
          this.emitStateChange();
        } catch (err) {
          if (this.destroyed)
            return;
          this.error = err instanceof Error ? err.message : String(err);
        } finally {
          this.loading = false;
        }
        if (this.destroyed)
          return;
        if (this.pendingRefresh !== null) {
          nextRefresh = this.pendingRefresh;
          this.pendingRefresh = null;
        } else if (!this.error && this.includeEmptyCharacters && !this.loadedIncludeEmpty) {
          nextRefresh = current;
        }
      }
      if (!this.destroyed) {
        drilldownExited = drilldownExited && prevActiveCharId !== null && this.activeCharacterId === null;
        const canUpdateInPlace = Boolean(this.characters && this.characters.length > 0) && !this.error && !prevHadError && this.activeCharacterId === prevActiveCharId && Boolean(this.root.querySelector(".ml-gallery-toolbar")) && Boolean(this.root.querySelector(".ml-gallery-content-slot"));
        if (canUpdateInPlace) {
          this.syncToolbarControls();
          this.rerenderContentSlot();
        } else {
          this.render(drilldownExited ? { scrollTop: this.listScrollTop } : undefined);
        }
      }
    })().finally(() => {
      this.activeRefreshPromise = null;
    });
    this.activeRefreshPromise = run;
    return run;
  }
  async ensureLoaded() {
    if (this.destroyed)
      return;
    if (this.activeRefreshPromise) {
      await this.activeRefreshPromise;
      return;
    }
    if (this.characters === null || this.includeEmptyCharacters && !this.loadedIncludeEmpty) {
      await this.refresh();
    }
  }
  invalidateCache() {
    if (this.destroyed)
      return;
    this.characters = null;
    this.precomputedCharCache = new WeakMap;
    this.loadedIncludeEmpty = false;
    this.emitCacheChange();
  }
  reshuffleRandomOrder() {
    if (this.destroyed)
      return;
    this.randomWeights.clear();
    this.randomWeightsDirty = false;
    this.emitCacheChange();
  }
  getRandomWeight(key) {
    let w = this.randomWeights.get(key);
    if (w === undefined) {
      w = Math.random();
      this.randomWeights.set(key, w);
      this.randomWeightsDirty = true;
    }
    return w;
  }
  render(options) {
    if (this.destroyed)
      return;
    const isPlaceholder = !this.characters && (this.loading || !this.error);
    const targetScrollTop = options?.scrollTop !== undefined ? options.scrollTop : isPlaceholder ? undefined : this.readScrollTop();
    this.root.innerHTML = "";
    this.widgetWrapEl = null;
    this.refreshBtnEl = null;
    const wrap = document.createElement("div");
    wrap.className = `ml-widget ${getThumbnailSizeClass(this.thumbnailSize)}`;
    this.widgetWrapEl = wrap;
    if (this.error) {
      const err = document.createElement("div");
      err.className = "ml-error-banner";
      err.appendChild(createIcon("alert", 13));
      const errText = document.createElement("span");
      errText.textContent = this.error;
      err.appendChild(errText);
      wrap.appendChild(err);
    }
    const toolbar = this.renderToolbar();
    wrap.appendChild(toolbar);
    if (isPlaceholder) {
      this.clearRenderCaches();
      wrap.appendChild(buildGalleryEmptyState({
        icon: "refresh",
        message: "Loading library media gallery...",
        className: "ml-section ml-empty ml-loading-card ml-placeholder"
      }));
      this.root.appendChild(wrap);
      return;
    }
    const chars = this.characters ?? [];
    if (chars.length === 0) {
      this.clearRenderCaches();
      wrap.appendChild(buildGalleryEmptyState({
        icon: "image",
        message: this.includeEmptyCharacters ? "No character cards found in your library." : "No localized media or native expressions found yet. Enable All Cards to browse every character.",
        className: "ml-section ml-empty ml-empty-card"
      }));
      this.root.appendChild(wrap);
      if (targetScrollTop !== undefined) {
        this.applyScrollTop(targetScrollTop);
      }
      return;
    }
    if (this.grouped) {
      if (this.activeCharacterId) {
        const selected = chars.find((c) => c.characterId === this.activeCharacterId);
        if (selected) {
          wrap.appendChild(this.renderCharacterDrilldown(selected));
          this.root.appendChild(wrap);
          if (targetScrollTop !== undefined) {
            this.applyScrollTop(targetScrollTop);
          }
          return;
        }
        this.activeCharacterId = null;
        this.currentPage = this.listPageBeforeDrilldown >= 1 ? this.listPageBeforeDrilldown : 1;
      }
      wrap.appendChild(this.renderGroupedCharacters(chars));
    } else {
      wrap.appendChild(this.renderFlatMedia(chars));
    }
    this.root.appendChild(wrap);
    if (targetScrollTop !== undefined) {
      this.applyScrollTop(targetScrollTop);
    }
  }
  renderToolbar() {
    const box = document.createElement("div");
    box.className = "ml-section ml-gallery-toolbar";
    const row1 = document.createElement("div");
    row1.className = "ml-gallery-controls";
    const infoTip = createInfoTip("Browse localized media and character expressions across your entire library. Search by character name, tag (e.g. tag:fantasy or #fantasy), filename, or expression.");
    const searchWrap = document.createElement("div");
    searchWrap.className = "ml-input-wrap";
    const searchIcon = document.createElement("span");
    searchIcon.className = "ml-input-icon";
    searchIcon.appendChild(createIcon("search", 13));
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "ml-input-text has-icon";
    searchInput.placeholder = "Search name, tag, tag:name, file...";
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.currentPage = 1;
      this.emitStateChange();
      this.rerenderContentSlot();
    });
    searchWrap.append(searchIcon, searchInput);
    const gridBtn = createIconButton({
      icon: "grid",
      title: "Grid view",
      className: `ml-btn ml-icon-btn is-sm${this.viewMode === "grid" ? " is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.viewMode = "grid";
        this.emitStateChange();
        this.render();
      }
    });
    const listBtn = createIconButton({
      icon: "list",
      title: "List view",
      className: `ml-btn ml-icon-btn is-sm${this.viewMode === "list" ? " is-active" : ""}`,
      size: 13,
      onClick: () => {
        this.viewMode = "list";
        this.emitStateChange();
        this.render();
      }
    });
    const viewSegmented = document.createElement("div");
    viewSegmented.className = "ml-segmented";
    viewSegmented.append(gridBtn, listBtn);
    const refreshBtn = createIconButton({
      icon: "refresh",
      title: "Refresh library media list",
      className: `ml-btn ml-icon-btn is-sm${this.loading ? " is-busy" : ""}`,
      size: 13,
      disabled: this.loading,
      onClick: () => void this.refresh()
    });
    this.refreshBtnEl = refreshBtn;
    const viewActions = document.createElement("div");
    viewActions.className = "ml-header-actions";
    viewActions.append(viewSegmented, refreshBtn);
    row1.append(infoTip, searchWrap, viewActions);
    const row2 = document.createElement("div");
    row2.className = "ml-header-bar";
    const sortGroup = document.createElement("div");
    sortGroup.className = "ml-sort-group";
    const sortSelect = document.createElement("select");
    sortSelect.className = "ml-select is-sm";
    sortSelect.title = "Sort order";
    const isGroupedCards = this.grouped && !this.activeCharacterId;
    const sortOpts = [
      ...isGroupedCards ? [
        { value: "name", label: "Sort: Name" },
        { value: "count", label: "Sort: Count" },
        { value: "size", label: "Sort: Size" },
        { value: "recent", label: "Sort: Recent" }
      ] : [
        { value: "recent", label: "Sort: Recent" },
        { value: "name", label: "Sort: Name" },
        { value: "size", label: "Sort: Size" }
      ],
      { value: "random", label: "Sort: Random" }
    ];
    for (const sOpt of sortOpts) {
      const opt = document.createElement("option");
      opt.value = sOpt.value;
      opt.textContent = sOpt.label;
      if (sOpt.value === this.sortMode)
        opt.selected = true;
      sortSelect.appendChild(opt);
    }
    sortSelect.value = sortOpts.some((o) => o.value === this.sortMode) ? this.sortMode : sortOpts[0]?.value ?? "name";
    sortSelect.addEventListener("change", () => {
      this.sortMode = sortSelect.value;
      this.currentPage = 1;
      if (this.sortMode === "random") {
        this.reshuffleRandomOrder();
      } else {
        this.sortDirection = defaultDirectionForSort(this.sortMode);
      }
      this.emitStateChange();
      this.render();
    });
    const sortDirBtn = this.sortMode === "random" ? createIconButton({
      icon: "shuffle",
      title: "Randomize list again",
      className: "ml-btn ml-icon-btn is-sm is-active",
      size: 13,
      onClick: () => {
        this.reshuffleRandomOrder();
        this.currentPage = 1;
        this.emitStateChange();
        this.render();
      }
    }) : createIconButton({
      icon: this.sortDirection === "asc" ? "arrow-up" : "arrow-down",
      title: this.sortDirection === "asc" ? "Ascending order (click for descending)" : "Descending order (click for ascending)",
      className: "ml-btn ml-icon-btn is-sm",
      size: 13,
      onClick: () => {
        this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        this.currentPage = 1;
        this.emitStateChange();
        this.render();
      }
    });
    sortGroup.append(sortSelect, sortDirBtn);
    const modeBtns = document.createElement("div");
    modeBtns.className = "ml-header-actions";
    const groupBtn = createIconButton({
      icon: "group",
      label: "Group",
      title: this.grouped ? "Grouped by character card (click for flat media view)" : "Flat media view (click to group by character card)",
      className: `ml-btn is-sm ${this.grouped ? "is-active" : ""}`,
      size: 12,
      onClick: () => {
        this.grouped = !this.grouped;
        this.currentPage = 1;
        if (!this.grouped) {
          this.activeCharacterId = null;
          if (this.sortMode === "count") {
            this.sortMode = "recent";
            this.sortDirection = defaultDirectionForSort("recent");
          }
        }
        if (this.sortMode === "random")
          this.reshuffleRandomOrder();
        this.emitStateChange();
        this.render();
      }
    });
    const allCardsBtn = createIconButton({
      icon: "users",
      label: "All Cards",
      title: "Show all character cards in the library, even those without localized media yet",
      className: `ml-btn is-sm ${this.includeEmptyCharacters ? "is-active" : ""}`,
      size: 12,
      onClick: () => {
        this.includeEmptyCharacters = !this.includeEmptyCharacters;
        this.currentPage = 1;
        if (this.sortMode === "random")
          this.reshuffleRandomOrder();
        this.emitStateChange();
        if (this.includeEmptyCharacters && !this.loadedIncludeEmpty) {
          this.render();
          this.refresh();
        } else {
          this.render();
        }
      }
    });
    const thumbSizeToggle = createThumbnailSizeSegmented(this.thumbnailSize, (nextSize) => {
      this.thumbnailSize = nextSize;
      this.syncWrapperThumbnailClass();
      this.emitStateChange();
      this.rerenderContentSlot();
    });
    modeBtns.append(thumbSizeToggle, groupBtn, allCardsBtn);
    row2.append(sortGroup, modeBtns);
    const row3 = document.createElement("div");
    row3.className = "ml-pill-row ml-gallery-type-pills";
    const allOn = this.selectedMediaTypes.size === ALL_GALLERY_MEDIA_TYPES.length;
    const allPill = document.createElement("button");
    allPill.type = "button";
    allPill.className = `ml-pill ${allOn ? "is-selected" : ""}`;
    allPill.title = "Turn on all media types";
    allPill.appendChild(createIcon("layers", 11));
    const allPillLabel = document.createElement("span");
    allPillLabel.textContent = "All Media";
    allPill.appendChild(allPillLabel);
    allPill.addEventListener("click", () => {
      this.selectedMediaTypes = new Set(ALL_GALLERY_MEDIA_TYPES);
      this.currentPage = 1;
      this.emitStateChange();
      this.render();
    });
    row3.appendChild(allPill);
    const typeToggles = [
      { type: "image", label: "Images", title: "Toggle localized images", icon: "image", pillClass: "is-image" },
      { type: "video", label: "Videos", title: "Toggle localized videos", icon: "video", pillClass: "is-video" },
      { type: "expression", label: "Expressions", title: "Toggle character expressions", icon: "smile", pillClass: "is-expression" },
      { type: "avatar", label: "Avatars", title: "Toggle character card avatars", icon: "user", pillClass: "is-avatar" }
    ];
    for (const def of typeToggles) {
      const isSelected = this.selectedMediaTypes.has(def.type);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `ml-pill ${def.pillClass}${isSelected ? " is-selected" : ""}`;
      pill.title = def.title;
      pill.appendChild(createIcon(def.icon, 11));
      const pillLabel = document.createElement("span");
      pillLabel.textContent = def.label;
      pill.appendChild(pillLabel);
      pill.addEventListener("click", () => {
        if (this.selectedMediaTypes.has(def.type)) {
          this.selectedMediaTypes.delete(def.type);
        } else {
          this.selectedMediaTypes.add(def.type);
        }
        this.currentPage = 1;
        this.emitStateChange();
        this.render();
      });
      row3.appendChild(pill);
    }
    box.append(row1, row2, row3);
    return box;
  }
  rerenderContentSlot() {
    if (this.destroyed)
      return;
    if (!this.characters) {
      this.render();
      return;
    }
    const bodyOnly = this.root.querySelector(".ml-gallery-content-slot");
    if (bodyOnly) {
      const savedScrollTop = this.readScrollTop();
      const selectedChar = this.activeCharacterId ? this.characters.find((c) => c.characterId === this.activeCharacterId) : undefined;
      const nextContent = this.grouped ? selectedChar ? this.renderCharacterDrilldown(selectedChar) : this.renderGroupedCharacters(this.characters) : this.renderFlatMedia(this.characters);
      updateContentSlotInPlace(bodyOnly, nextContent);
      this.applyScrollTop(savedScrollTop);
    } else {
      this.render();
    }
  }
  getPrecomputedChar(char) {
    let cached = this.precomputedCharCache.get(char);
    if (cached)
      return cached;
    const lowerTags = Array.isArray(char.tags) ? char.tags.map((t) => t.toLowerCase()).filter(Boolean) : [];
    const lowerName = char.characterName.toLowerCase();
    const avatarEntry = char.avatarUrl ? {
      characterId: char.characterId,
      characterName: char.characterName,
      lowerTags,
      title: `${char.characterName} — Avatar`,
      subtitle: "Character card avatar",
      localUrl: char.avatarUrl,
      mediaKind: "image",
      sizeBytes: 0,
      localizedAt: char.lastLocalizedAt,
      isExpression: false,
      isAvatar: true,
      badgeText: "Avatar",
      searchBlob: `${lowerName} avatar`
    } : null;
    let hasImage = false;
    let videoCount = 0;
    const localizedEntries = char.localizedAssets.map((asset) => {
      const kind = inferKind(asset.mimeType, asset.filename);
      if (kind === "video") {
        videoCount++;
      } else {
        hasImage = true;
      }
      return {
        kind,
        entry: {
          characterId: char.characterId,
          characterName: char.characterName,
          lowerTags,
          title: asset.filename,
          subtitle: `${char.characterName} · ${formatBytes(asset.sizeBytes)}`,
          localUrl: asset.localUrl,
          mediaKind: kind,
          sizeBytes: asset.sizeBytes,
          localizedAt: asset.localizedAt,
          isExpression: false,
          isAvatar: false,
          badgeText: kind === "video" ? "Video" : "Localized",
          originalUrl: asset.normalizedUrl,
          searchBlob: `${lowerName} ${asset.filename} ${asset.normalizedUrl}`.toLowerCase()
        }
      };
    });
    const expressionEntries = char.expressions.map((expr) => ({
      characterId: char.characterId,
      characterName: char.characterName,
      lowerTags,
      title: expr.label,
      subtitle: `${char.characterName} · Expression${expr.groupName ? ` (${expr.groupName})` : ""}`,
      localUrl: expr.localUrl,
      mediaKind: "image",
      sizeBytes: 0,
      localizedAt: char.lastLocalizedAt,
      isExpression: true,
      isAvatar: false,
      badgeText: "Expr",
      searchBlob: `${lowerName} ${expr.label} ${expr.groupName ?? ""} expression`.toLowerCase()
    }));
    const fallbackAsset = !char.avatarUrl ? char.localizedAssets[0] : undefined;
    const thumbUrl = char.avatarUrl ?? fallbackAsset?.localUrl ?? char.expressions[0]?.localUrl ?? "";
    const thumbKind = fallbackAsset ? inferKind(fallbackAsset.mimeType, fallbackAsset.filename) : "image";
    cached = {
      lowerName,
      lowerTags,
      tagsSig: (char.tags ?? []).join("\x00"),
      summaryText: formatCharacterSummary(char),
      hasMedia: hasCharacterMedia(char),
      hasAvatar: avatarEntry !== null,
      hasImage,
      hasVideo: videoCount > 0,
      hasExpression: expressionEntries.length > 0,
      videoCount,
      thumbUrl,
      thumbKind,
      avatarEntry,
      localizedEntries,
      expressionEntries
    };
    this.precomputedCharCache.set(char, cached);
    return cached;
  }
  hasAnySelectedEntry(pre) {
    return pre.hasAvatar && this.selectedMediaTypes.has("avatar") || pre.hasImage && this.selectedMediaTypes.has("image") || pre.hasVideo && this.selectedMediaTypes.has("video") || pre.hasExpression && this.selectedMediaTypes.has("expression");
  }
  getCharEntries(char, includeAvatar) {
    const pre = this.getPrecomputedChar(char);
    const out = [];
    if (includeAvatar && pre.avatarEntry && this.selectedMediaTypes.has("avatar")) {
      out.push(pre.avatarEntry);
    }
    for (const item of pre.localizedEntries) {
      if (this.selectedMediaTypes.has(item.kind)) {
        out.push(item.entry);
      }
    }
    if (this.selectedMediaTypes.has("expression")) {
      for (const exprEntry of pre.expressionEntries) {
        out.push(exprEntry);
      }
    }
    return out;
  }
  sortFlatEntries(entries, options) {
    const entryKey = (e) => `item:${e.characterId}:${e.badgeText}:${e.localUrl}:${e.title}`;
    if (this.sortMode === "random") {
      entries.sort((a, b) => this.getRandomWeight(entryKey(a)) - this.getRandomWeight(entryKey(b)));
      this.flushRandomWeightsCache();
      return entries;
    }
    const dir = this.sortDirection === "asc" ? 1 : -1;
    const pinAvatar = Boolean(options?.pinAvatarFirst);
    return entries.sort((a, b) => {
      if (pinAvatar && a.isAvatar !== b.isAvatar) {
        return a.isAvatar ? -1 : 1;
      }
      if (this.sortMode === "name") {
        return (GALLERY_COLLATOR.compare(a.characterName, b.characterName) || GALLERY_COLLATOR.compare(a.title, b.title)) * dir;
      }
      if (this.sortMode === "size") {
        return (a.sizeBytes - b.sizeBytes) * dir || (a.localizedAt - b.localizedAt) * dir || GALLERY_COLLATOR.compare(a.title, b.title);
      }
      return (a.localizedAt - b.localizedAt) * dir || GALLERY_COLLATOR.compare(a.characterName, b.characterName) || GALLERY_COLLATOR.compare(a.title, b.title);
    });
  }
  buildPaginationBar(options) {
    const bar = document.createElement("div");
    bar.className = "ml-gallery-pagination";
    const info = document.createElement("div");
    info.className = "ml-gallery-pagination-info";
    const summary = document.createElement("span");
    summary.textContent = options.totalPages > 1 ? `${options.startIndex + 1}–${options.endIndex} / ${options.totalItems} ${options.unitLabel}` : `${options.totalItems} ${options.unitLabel}`;
    info.appendChild(summary);
    if (options.includePageSizeSelect) {
      const sizeSelect = document.createElement("select");
      sizeSelect.className = "ml-select is-sm";
      sizeSelect.title = "Items per page";
      for (const size of GALLERY_PAGE_SIZE_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = String(size);
        opt.textContent = size === 0 ? "All" : `${size} / pg`;
        if (size === this.pageSize)
          opt.selected = true;
        sizeSelect.appendChild(opt);
      }
      sizeSelect.value = String(this.pageSize);
      sizeSelect.addEventListener("change", () => {
        this.pageSize = Number(sizeSelect.value);
        this.currentPage = 1;
        this.emitStateChange();
        this.rerenderContentSlot();
      });
      info.appendChild(sizeSelect);
    }
    bar.appendChild(info);
    if (options.totalPages > 1) {
      const actions = document.createElement("div");
      actions.className = "ml-gallery-pagination-actions";
      const goToPage = (nextPage) => {
        this.currentPage = Math.max(1, Math.min(options.totalPages, nextPage));
        this.emitStateChange();
        this.rerenderContentSlot();
        if (options.scrollToTopOnFlip) {
          this.callbacks.onScrollToTop?.();
        }
      };
      const prevBtn = createIconButton({
        icon: "chevron-left",
        label: "Prev",
        title: "Previous page",
        className: "ml-btn is-sm",
        size: 12,
        disabled: options.page <= 1,
        onClick: () => goToPage(options.page - 1)
      });
      const pageLabel = document.createElement("span");
      pageLabel.className = "ml-url-sources";
      pageLabel.textContent = `Page ${options.page} / ${options.totalPages}`;
      const nextBtn = createIconButton({
        icon: "chevron-right",
        label: "Next",
        title: "Next page",
        className: "ml-btn is-sm",
        size: 12,
        disabled: options.page >= options.totalPages,
        onClick: () => goToPage(options.page + 1)
      });
      actions.append(prevBtn, pageLabel, nextBtn);
      bar.appendChild(actions);
    }
    return bar;
  }
  appendPaginatedContent(slot, items, unitLabel, renderPageItems) {
    const totalItems = items.length;
    const effectiveSize = this.pageSize > 0 ? this.pageSize : totalItems;
    const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, effectiveSize)));
    const page = Math.max(1, Math.min(totalPages, this.currentPage));
    this.currentPage = page;
    const startIndex = (page - 1) * effectiveSize;
    const endIndex = Math.min(totalItems, startIndex + effectiveSize);
    const pageItems = this.pageSize > 0 ? items.slice(startIndex, endIndex) : items;
    const showPageSizeSelect = totalItems > GALLERY_PAGE_SIZE_OPTIONS[0] || totalPages > 1 || this.pageSize !== DEFAULT_GALLERY_PAGE_SIZE;
    slot.appendChild(this.buildPaginationBar({
      totalItems,
      startIndex,
      endIndex,
      page,
      totalPages,
      unitLabel,
      includePageSizeSelect: showPageSizeSelect
    }));
    slot.appendChild(renderPageItems(pageItems));
    if (totalPages > 1 && pageItems.length >= 12) {
      slot.appendChild(this.buildPaginationBar({
        totalItems,
        startIndex,
        endIndex,
        page,
        totalPages,
        unitLabel,
        includePageSizeSelect: false,
        scrollToTopOnFlip: true
      }));
    }
  }
  renderGroupedCharacters(chars) {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";
    const parsedQuery = parseGallerySearchQuery(this.searchQuery);
    const filtered = chars.filter((char) => {
      const pre = this.getPrecomputedChar(char);
      if (!this.includeEmptyCharacters && !pre.hasMedia) {
        return false;
      }
      if (!this.includeEmptyCharacters && !this.hasAnySelectedEntry(pre)) {
        return false;
      }
      if (!parsedQuery.hasQuery)
        return true;
      const entries = this.getCharEntries(char, true);
      const haystacks = [pre.lowerName, ...entries.map((e) => e.searchBlob)];
      return matchesSearchText(haystacks, pre.lowerTags, parsedQuery);
    });
    if (this.sortMode === "random") {
      filtered.sort((a, b) => this.getRandomWeight(`char:${a.characterId}`) - this.getRandomWeight(`char:${b.characterId}`));
      this.flushRandomWeightsCache();
    } else {
      const dir = this.sortDirection === "asc" ? 1 : -1;
      filtered.sort((a, b) => {
        const countA = a.localizedAssets.length + a.expressions.length;
        const countB = b.localizedAssets.length + b.expressions.length;
        if (this.sortMode === "count") {
          return (countA - countB) * dir || GALLERY_COLLATOR.compare(a.characterName, b.characterName);
        }
        if (this.sortMode === "size") {
          return (a.totalSizeBytes - b.totalSizeBytes) * dir || GALLERY_COLLATOR.compare(a.characterName, b.characterName);
        }
        if (this.sortMode === "recent") {
          return (a.lastLocalizedAt - b.lastLocalizedAt) * dir || GALLERY_COLLATOR.compare(a.characterName, b.characterName);
        }
        return GALLERY_COLLATOR.compare(a.characterName, b.characterName) * dir;
      });
    }
    if (filtered.length === 0) {
      slot.appendChild(buildGalleryEmptyState({
        icon: this.selectedMediaTypes.size === 0 && !this.includeEmptyCharacters ? "filter" : "search",
        message: this.selectedMediaTypes.size === 0 && !this.includeEmptyCharacters ? "No media types selected. Click All Media or enable a media type." : "No character cards match the current search/filter."
      }));
      return slot;
    }
    const openDrilldown = (characterId) => {
      this.listScrollTop = this.readScrollTop();
      this.listPageBeforeDrilldown = this.currentPage >= 1 ? this.currentPage : 1;
      this.activeCharacterId = characterId;
      this.currentPage = 1;
      if (this.sortMode === "random")
        this.reshuffleRandomOrder();
      this.emitStateChange();
      this.render({ scrollTop: 0 });
    };
    const thumbTier = getThumbnailImageTier(this.thumbnailSize);
    const computeCharSig = (char, pre) => {
      const thumbSrc = pre.thumbUrl ? toThumbnailMediaUrl(sanitizeSafeMediaUrl(pre.thumbUrl), pre.thumbKind, thumbTier) ?? pre.thumbUrl : "";
      return [
        char.characterName,
        thumbSrc,
        pre.thumbKind,
        pre.videoCount,
        char.localizedAssets.length,
        char.expressions.length,
        char.totalSizeBytes,
        char.lastLocalizedAt,
        pre.tagsSig
      ].join("\x01");
    };
    this.appendPaginatedContent(slot, filtered, "cards", (pageChars) => {
      const usedKeys = new Set;
      const eagerAllOnPage = pageChars.length <= EAGER_PAGE_ITEM_LIMIT;
      if (this.viewMode === "list") {
        const list = document.createElement("div");
        list.className = "ml-media-list";
        pageChars.forEach((char, idx) => {
          const pre = this.getPrecomputedChar(char);
          const sig = computeCharSig(char, pre);
          const cacheKey = `char:${char.characterId}`;
          usedKeys.add(cacheKey);
          const cached = this.listRowCache.get(cacheKey);
          let row;
          if (cached && cached.sig === sig) {
            row = cached.el;
            reobserveLazyMedia(row);
            this.listRowCache.delete(cacheKey);
            this.listRowCache.set(cacheKey, cached);
          } else {
            row = document.createElement("div");
            row.className = "ml-media-list-row";
            row.addEventListener("click", () => this.cardClickHandlers.get(row)?.());
            const thumbWrap = document.createElement("div");
            thumbWrap.className = "ml-media-list-thumb-wrap";
            if (pre.thumbUrl) {
              thumbWrap.appendChild(createGalleryMediaElement({
                src: pre.thumbUrl,
                mediaKind: pre.thumbKind,
                alt: char.characterName,
                className: "ml-media-list-thumb",
                eager: eagerAllOnPage || idx < EAGER_LEADING_WINDOW,
                thumbTier
              }));
              if (pre.thumbKind === "video" || pre.videoCount > 0) {
                const kindBadge = document.createElement("span");
                kindBadge.className = "ml-media-list-kind-badge";
                kindBadge.appendChild(createIcon("video", 9));
                thumbWrap.appendChild(kindBadge);
              }
            } else {
              const placeholder = document.createElement("div");
              placeholder.className = "ml-media-list-placeholder";
              placeholder.appendChild(createIcon("user", 15));
              thumbWrap.appendChild(placeholder);
            }
            row.appendChild(thumbWrap);
            const meta = document.createElement("div");
            meta.className = "ml-url-meta";
            const name = document.createElement("div");
            name.className = "ml-url-text";
            name.textContent = char.characterName;
            const sub = document.createElement("div");
            sub.className = "ml-url-sources";
            sub.textContent = pre.summaryText;
            if (char.tags && char.tags.length > 0) {
              row.title = `Tags: ${char.tags.join(", ")}`;
            }
            meta.append(name, sub);
            const chevron = createIcon("chevron-right", 13);
            row.appendChild(meta);
            if (this.callbacks.onOpenCharacterEditor) {
              const editBtn = createIconButton({
                icon: "edit",
                title: `Edit "${char.characterName}" in native Character Editor`,
                className: "ml-btn ml-icon-btn is-sm",
                size: 12,
                onClick: (ev) => {
                  ev.stopPropagation();
                  this.cardEditHandlers.get(row)?.();
                }
              });
              row.appendChild(editBtn);
            }
            row.appendChild(chevron);
            this.listRowCache.set(cacheKey, { sig, el: row });
          }
          this.cardClickHandlers.set(row, () => openDrilldown(char.characterId));
          if (this.callbacks.onOpenCharacterEditor) {
            const onOpenEdit = this.callbacks.onOpenCharacterEditor;
            this.cardEditHandlers.set(row, () => onOpenEdit(char.characterId));
          }
          list.appendChild(row);
        });
        this.pruneRenderCache(this.listRowCache, usedKeys);
        return list;
      }
      const grid = document.createElement("div");
      grid.className = "ml-char-card-grid";
      pageChars.forEach((char, idx) => {
        const pre = this.getPrecomputedChar(char);
        const sig = computeCharSig(char, pre);
        const cacheKey = char.characterId;
        usedKeys.add(cacheKey);
        const cached = this.charCardCache.get(cacheKey);
        let card;
        if (cached && cached.sig === sig) {
          card = cached.el;
          reobserveLazyMedia(card);
          this.charCardCache.delete(cacheKey);
          this.charCardCache.set(cacheKey, cached);
        } else {
          const cardEl = document.createElement("div");
          cardEl.className = "ml-char-card";
          cardEl.setAttribute("role", "button");
          cardEl.tabIndex = 0;
          cardEl.addEventListener("click", () => this.cardClickHandlers.get(cardEl)?.());
          cardEl.addEventListener("keydown", (ev) => {
            if (ev.target === cardEl && (ev.key === "Enter" || ev.key === " ")) {
              ev.preventDefault();
              this.cardClickHandlers.get(cardEl)?.();
            }
          });
          if (char.tags && char.tags.length > 0) {
            cardEl.title = `${char.characterName}
Tags: ${char.tags.join(", ")}`;
          }
          const mediaWrap = document.createElement("div");
          mediaWrap.className = "ml-char-card-thumb-wrap";
          if (pre.thumbUrl) {
            mediaWrap.appendChild(createGalleryMediaElement({
              src: pre.thumbUrl,
              mediaKind: pre.thumbKind,
              alt: char.characterName,
              className: "ml-char-card-thumb",
              eager: eagerAllOnPage || idx < EAGER_LEADING_WINDOW,
              thumbTier
            }));
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "ml-char-card-placeholder";
            placeholder.appendChild(createIcon("user", 24));
            mediaWrap.appendChild(placeholder);
          }
          const scrim = document.createElement("div");
          scrim.className = "ml-char-card-scrim";
          mediaWrap.appendChild(scrim);
          const badgesWrap = document.createElement("div");
          badgesWrap.className = "ml-char-card-badges";
          const total = char.localizedAssets.length + char.expressions.length;
          badgesWrap.appendChild(buildTileKindBadge({
            label: `${total}`,
            title: `${total} total item(s)`
          }));
          if (pre.videoCount > 0) {
            badgesWrap.appendChild(buildTileKindBadge({
              icon: "video",
              label: `${pre.videoCount}`,
              modifier: "is-video",
              title: `${pre.videoCount} localized video(s)`
            }));
          }
          if (char.expressions.length > 0) {
            badgesWrap.appendChild(buildTileKindBadge({
              icon: "smile",
              label: `${char.expressions.length}`,
              modifier: "is-expression",
              title: `${char.expressions.length} character expression(s)`
            }));
          }
          mediaWrap.appendChild(badgesWrap);
          if (this.callbacks.onOpenCharacterEditor) {
            const editBtn = createIconButton({
              icon: "edit",
              title: `Edit "${char.characterName}" in native Character Editor`,
              className: "ml-char-card-edit-btn",
              size: 11,
              onClick: (ev) => {
                ev.stopPropagation();
                this.cardEditHandlers.get(cardEl)?.();
              }
            });
            editBtn.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.stopPropagation();
              }
            });
            mediaWrap.appendChild(editBtn);
          }
          const footer = document.createElement("div");
          footer.className = "ml-char-card-footer";
          const nameEl = document.createElement("div");
          nameEl.className = "ml-char-card-name";
          nameEl.textContent = char.characterName;
          nameEl.title = char.characterName;
          const statLine = document.createElement("div");
          statLine.className = "ml-url-sources";
          statLine.textContent = pre.summaryText;
          statLine.title = pre.summaryText;
          footer.append(nameEl, statLine);
          cardEl.append(mediaWrap, footer);
          card = cardEl;
          this.charCardCache.set(cacheKey, { sig, el: card });
        }
        this.cardClickHandlers.set(card, () => openDrilldown(char.characterId));
        if (this.callbacks.onOpenCharacterEditor) {
          const onOpenEdit = this.callbacks.onOpenCharacterEditor;
          this.cardEditHandlers.set(card, () => onOpenEdit(char.characterId));
        }
        grid.appendChild(card);
      });
      this.pruneRenderCache(this.charCardCache, usedKeys);
      return grid;
    });
    return slot;
  }
  renderCharacterDrilldown(char) {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";
    const top = document.createElement("div");
    top.className = "ml-gallery-drilldown-header";
    const backBtn = createIconButton({
      icon: "chevron-left",
      label: "All Characters",
      title: "Return to character library grid",
      className: "ml-btn is-sm",
      size: 12,
      onClick: () => {
        this.activeCharacterId = null;
        this.currentPage = this.listPageBeforeDrilldown >= 1 ? this.listPageBeforeDrilldown : 1;
        const restoredScrollTop = this.listScrollTop;
        this.emitStateChange();
        this.render({ scrollTop: restoredScrollTop });
      }
    });
    const charLabel = document.createElement("div");
    charLabel.className = "ml-gallery-drilldown-title";
    if (char.avatarUrl) {
      charLabel.appendChild(createGalleryMediaElement({
        src: char.avatarUrl,
        mediaKind: "image",
        alt: char.characterName,
        className: "ml-gallery-drilldown-avatar",
        eager: true
      }));
    }
    const nameEl = document.createElement("span");
    nameEl.className = "ml-gallery-drilldown-name";
    nameEl.textContent = char.characterName;
    nameEl.title = char.characterName;
    charLabel.appendChild(nameEl);
    if (char.totalSizeBytes > 0) {
      const sizeBadge = document.createElement("span");
      sizeBadge.className = "ml-badge is-muted";
      sizeBadge.textContent = formatBytes(char.totalSizeBytes);
      charLabel.appendChild(sizeBadge);
    }
    const actions = document.createElement("div");
    actions.className = "ml-header-actions";
    if (this.callbacks.onOpenCharacterTab) {
      const manageBtn = createIconButton({
        icon: "settings",
        label: "Manage",
        title: "Open this character in the Character tab",
        className: "ml-btn is-sm",
        size: 12,
        onClick: () => this.callbacks.onOpenCharacterTab(char.characterId)
      });
      actions.appendChild(manageBtn);
    }
    if (this.callbacks.onOpenCharacterEditor) {
      const editBtn = createIconButton({
        icon: "edit",
        label: "Edit",
        title: "Open native Character Editor for this character",
        className: "ml-btn is-sm",
        size: 12,
        onClick: () => this.callbacks.onOpenCharacterEditor(char.characterId)
      });
      actions.appendChild(editBtn);
    }
    top.append(backBtn, charLabel, actions);
    slot.appendChild(top);
    const parsedQuery = parseGallerySearchQuery(this.searchQuery);
    const entries = this.sortFlatEntries(this.getCharEntries(char, true).filter((e) => matchesSearchText([e.searchBlob], e.lowerTags, parsedQuery)), { pinAvatarFirst: this.sortMode !== "random" });
    if (entries.length === 0) {
      slot.appendChild(buildGalleryEmptyState({
        icon: this.selectedMediaTypes.size === 0 ? "filter" : !hasCharacterMedia(char) && !parsedQuery.hasQuery ? "image" : "search",
        message: this.selectedMediaTypes.size === 0 ? "No media types selected. Click All Media or enable a media type." : !hasCharacterMedia(char) && !parsedQuery.hasQuery ? "No localized media yet. Click Manage to scan and localize this character." : "No items match the current filter."
      }));
      return slot;
    }
    this.appendPaginatedContent(slot, entries, "items", (pageEntries) => this.renderMediaEntries(pageEntries));
    return slot;
  }
  renderFlatMedia(chars) {
    const slot = document.createElement("div");
    slot.className = "ml-section ml-gallery-content-slot";
    const parsedQuery = parseGallerySearchQuery(this.searchQuery);
    const entries = [];
    for (const char of chars) {
      if (!this.includeEmptyCharacters && !hasCharacterMedia(char)) {
        continue;
      }
      for (const entry of this.getCharEntries(char, true)) {
        if (matchesSearchText([entry.searchBlob], entry.lowerTags, parsedQuery)) {
          entries.push(entry);
        }
      }
    }
    this.sortFlatEntries(entries);
    if (entries.length === 0) {
      slot.appendChild(buildGalleryEmptyState({
        icon: this.selectedMediaTypes.size === 0 ? "filter" : "search",
        message: this.selectedMediaTypes.size === 0 ? "No media types selected. Click All Media or enable a media type." : "No media items match the current search/filter."
      }));
      return slot;
    }
    this.appendPaginatedContent(slot, entries, "items", (pageEntries) => this.renderMediaEntries(pageEntries));
    return slot;
  }
  renderMediaEntries(entries) {
    if (entries.length === 0) {
      return buildGalleryEmptyState({
        icon: "search",
        message: "No items match the current filter."
      });
    }
    const lightboxItems = entries.map((e) => ({
      id: `${e.characterId}:${e.localUrl}:${e.title}`,
      localUrl: e.localUrl,
      mediaKind: e.mediaKind,
      title: e.title,
      subtitle: e.subtitle,
      originalUrl: e.originalUrl,
      readOnly: e.isAvatar || e.isExpression,
      badgeText: e.badgeText,
      onEditCharacter: this.callbacks.onOpenCharacterEditor ? () => this.callbacks.onOpenCharacterEditor(e.characterId) : undefined,
      onRemove: !e.isAvatar && !e.isExpression && e.originalUrl ? async () => {
        const safeSrc = sanitizeSafeMediaUrl(e.localUrl);
        for (const tier of ["sm", "lg"]) {
          const thumbSrc = toThumbnailMediaUrl(safeSrc, e.mediaKind, tier);
          if (thumbSrc)
            clearWarmGalleryThumbs(thumbSrc);
        }
        await this.callbacks.onPurgeAsset(e.characterId, e.originalUrl);
      } : undefined
    }));
    const onAfterRemove = () => void this.refresh({ reshuffleRandom: false });
    const seenBaseKeys = new Map;
    const usedKeys = new Set;
    const eagerAllOnPage = entries.length <= EAGER_PAGE_ITEM_LIMIT;
    const nextUniqueKey = (entry) => {
      const kindPrefix = entry.isAvatar ? "avatar" : entry.isExpression ? "expr" : "loc";
      const baseKey = `${entry.characterId}:${kindPrefix}:${entry.localUrl}:${entry.title}`;
      const occ = seenBaseKeys.get(baseKey) ?? 0;
      seenBaseKeys.set(baseKey, occ + 1);
      return occ === 0 ? baseKey : `${baseKey}#${occ}`;
    };
    const thumbTier = getThumbnailImageTier(this.thumbnailSize);
    const computeEntrySig = (entry) => {
      const thumbSrc = toThumbnailMediaUrl(sanitizeSafeMediaUrl(entry.localUrl), entry.mediaKind, thumbTier) ?? entry.localUrl;
      return [
        thumbSrc,
        entry.mediaKind,
        entry.title,
        entry.subtitle,
        entry.badgeText,
        entry.isExpression ? "1" : "0",
        entry.isAvatar ? "1" : "0",
        entry.originalUrl ?? "",
        entry.sizeBytes
      ].join("\x01");
    };
    const getEntryTileBadgeSpec = (entry) => {
      if (entry.mediaKind === "video") {
        return { icon: "play", modifier: "is-video" };
      }
      if (entry.isExpression) {
        return { icon: "smile", modifier: "is-expression" };
      }
      if (entry.isAvatar) {
        return { icon: "user", modifier: "is-avatar" };
      }
      return { modifier: "is-local" };
    };
    if (this.viewMode === "list") {
      const list = document.createElement("div");
      list.className = "ml-media-list";
      entries.forEach((entry, index) => {
        const cacheKey = `media:${nextUniqueKey(entry)}`;
        const sig = computeEntrySig(entry);
        usedKeys.add(cacheKey);
        const cached = this.listRowCache.get(cacheKey);
        let row;
        if (cached && cached.sig === sig) {
          row = cached.el;
          reobserveLazyMedia(row);
          this.listRowCache.delete(cacheKey);
          this.listRowCache.set(cacheKey, cached);
        } else {
          row = document.createElement("div");
          row.className = "ml-media-list-row";
          row.addEventListener("click", () => this.cardClickHandlers.get(row)?.());
          const thumbWrap = document.createElement("div");
          thumbWrap.className = "ml-media-list-thumb-wrap";
          thumbWrap.appendChild(createGalleryMediaElement({
            src: entry.localUrl,
            mediaKind: entry.mediaKind,
            alt: entry.title,
            className: "ml-media-list-thumb",
            eager: eagerAllOnPage || index < EAGER_LEADING_WINDOW,
            thumbTier
          }));
          if (entry.mediaKind === "video") {
            const kindBadge = document.createElement("span");
            kindBadge.className = "ml-media-list-kind-badge";
            kindBadge.appendChild(createIcon("play", 8));
            thumbWrap.appendChild(kindBadge);
          }
          const info = document.createElement("div");
          info.className = "ml-url-meta";
          const t = document.createElement("div");
          t.className = "ml-url-text";
          t.textContent = entry.title;
          const s = document.createElement("div");
          s.className = "ml-url-sources";
          s.textContent = entry.subtitle;
          info.append(t, s);
          const badge = document.createElement("span");
          const listBadgeClass = entry.isExpression || entry.isAvatar ? "is-info" : entry.mediaKind === "video" ? "is-type" : "is-local";
          badge.className = `ml-badge ${listBadgeClass}`;
          badge.textContent = entry.badgeText;
          row.append(thumbWrap, info, badge);
          this.listRowCache.set(cacheKey, { sig, el: row });
        }
        this.cardClickHandlers.set(row, () => openMediaLightbox(lightboxItems, index, onAfterRemove));
        list.appendChild(row);
      });
      this.pruneRenderCache(this.listRowCache, usedKeys);
      return list;
    }
    const grid = document.createElement("div");
    grid.className = "ml-asset-grid ml-gallery-grid";
    entries.forEach((entry, index) => {
      const cacheKey = nextUniqueKey(entry);
      const sig = computeEntrySig(entry);
      usedKeys.add(cacheKey);
      const cached = this.assetCardCache.get(cacheKey);
      let card;
      if (cached && cached.sig === sig) {
        card = cached.el;
        reobserveLazyMedia(card);
        this.assetCardCache.delete(cacheKey);
        this.assetCardCache.set(cacheKey, cached);
      } else {
        card = document.createElement("div");
        card.className = "ml-asset-card";
        const wrap = document.createElement("div");
        wrap.className = "ml-asset-thumb-wrap";
        wrap.addEventListener("click", () => this.cardClickHandlers.get(card)?.());
        wrap.appendChild(createGalleryMediaElement({
          src: entry.localUrl,
          mediaKind: entry.mediaKind,
          alt: entry.title,
          className: "ml-asset-preview",
          title: `${entry.title}
${entry.subtitle}`,
          eager: eagerAllOnPage || index < EAGER_LEADING_WINDOW,
          thumbTier
        }));
        const badgeSpec = getEntryTileBadgeSpec(entry);
        wrap.appendChild(buildTileKindBadge({
          icon: badgeSpec.icon,
          label: entry.badgeText,
          modifier: badgeSpec.modifier
        }));
        const footer = document.createElement("div");
        footer.className = "ml-asset-footer";
        const cap = document.createElement("div");
        cap.className = "ml-url-sources";
        cap.textContent = entry.isExpression || entry.isAvatar ? entry.title : entry.subtitle;
        cap.title = `${entry.title}
${entry.subtitle}`;
        footer.appendChild(cap);
        card.append(wrap, footer);
        this.assetCardCache.set(cacheKey, { sig, el: card });
      }
      this.cardClickHandlers.set(card, () => openMediaLightbox(lightboxItems, index, onAfterRemove));
      grid.appendChild(card);
    });
    this.pruneRenderCache(this.assetCardCache, usedKeys);
    return grid;
  }
}

// src/ui/drawer-panel.ts
var LIBRARY_BATCH_PAGE_SIZE = 50;

class MediaLocalizerDrawerPanel {
  ctx;
  settings;
  stats;
  queueProgress;
  callbacks;
  options;
  activeTab = "character";
  bodyEl = null;
  stickyBannerHost = null;
  navButtons = new Map;
  characterWidget = null;
  characterUiState = {
    ...loadPrefsFromStorage(CHARACTER_PREFS_STORAGE_KEY, sanitizeCharacterPreferences, () => getDefaultCharacterPreferences(true)),
    expandedUrls: []
  };
  characterScanCache = new Map;
  galleryView = null;
  galleryState = {
    ...loadPrefsFromStorage(GALLERY_PREFS_STORAGE_KEY, sanitizeGalleryPreferences, getDefaultGalleryPreferences),
    searchQuery: "",
    currentPage: 1,
    activeCharacterId: null
  };
  galleryCache = {
    characters: null,
    loadedIncludeEmpty: false
  };
  actionError = null;
  mountGen = 0;
  libraryScanning = false;
  librarySummaries = null;
  librarySummariesStale = false;
  libraryTotalRemote = 0;
  libraryPage = 1;
  librarySelectedCharIds = new Set;
  libraryExpandedCharIds = new Set;
  librarySelectedSections = new Set;
  libraryBatchCap = 50;
  libraryOnlyWithRemote = true;
  inspectedCharacterId = null;
  expandNextCharacterConfig = false;
  renderedTab = null;
  isRenderingBody = false;
  rememberedScrollContainer = null;
  cachedScrollContainer = null;
  galleryHostEl = null;
  pendingScrollRestore = null;
  isSettlingScrollRestore = false;
  scrollSettleRafIds = [];
  tabScrollTops = {
    character: 0,
    gallery: 0,
    library: 0,
    settings: 0
  };
  innerScrollTops = new Map;
  constructor(ctx, settings, stats, queueProgress, callbacks, options) {
    this.ctx = ctx;
    this.settings = settings;
    this.stats = stats;
    this.queueProgress = queueProgress;
    this.callbacks = callbacks;
    this.options = options;
    this.librarySelectedSections = new Set(settings.defaultSections);
    this.libraryBatchCap = settings.defaultBatchCap;
  }
  mount(container) {
    const mountGen = ++this.mountGen;
    const prevContainerWidth = container.style?.width ?? "";
    const prevContainerHeight = container.style?.height ?? "";
    const prevContainerMinHeight = container.style?.minHeight ?? "";
    if (container.style) {
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.minHeight = "0";
    }
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "ml-drawer-root";
    const nav = document.createElement("div");
    nav.className = "ml-drawer-nav";
    const tabs = [
      { id: "character", label: "Character", icon: "user" },
      { id: "gallery", label: "Gallery", icon: "image" },
      { id: "library", label: "Library Batch", icon: "layers" },
      { id: "settings", label: "Settings", icon: "settings" }
    ];
    this.navButtons.clear();
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ml-drawer-nav-btn ${this.activeTab === t.id ? "is-active" : ""}`;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = t.label;
      btn.append(createIcon(t.icon, 13), labelSpan);
      btn.addEventListener("click", () => {
        this.setActiveTab(t.id);
      });
      this.navButtons.set(t.id, btn);
      nav.appendChild(btn);
    }
    const bannerHost = document.createElement("div");
    bannerHost.className = "ml-drawer-sticky-banner";
    this.stickyBannerHost = bannerHost;
    const body = document.createElement("div");
    body.className = "ml-drawer-body";
    const recordScrollFromTarget = (targetEl) => {
      if (!targetEl || targetEl.clientHeight === 0 || this.isRenderingBody || !this.renderedTab || this.renderedTab !== this.activeTab || this.isShowingPlaceholder(body) || body.isConnected === false) {
        return;
      }
      if (targetEl !== this.cachedScrollContainer) {
        this.cachedScrollContainer = null;
        const activeScroller = this.getActiveScrollContainer();
        if (activeScroller && targetEl !== activeScroller) {
          return;
        }
      }
      if (typeof targetEl.scrollTop === "number" && Number.isFinite(targetEl.scrollTop)) {
        const nextTop = Math.max(0, targetEl.scrollTop);
        if (this.isSettlingScrollRestore && nextTop === 0 && this.tabScrollTops[this.renderedTab] > 0) {
          return;
        }
        this.rememberedScrollContainer = targetEl;
        this.tabScrollTops[this.renderedTab] = nextTop;
      }
    };
    body.addEventListener("scroll", () => {
      recordScrollFromTarget(body);
    }, { passive: true });
    let offDocScroll = null;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const onCaptureScroll = (ev) => {
        if (this.isRenderingBody || !this.renderedTab || this.renderedTab !== this.activeTab || body.isConnected === false) {
          return;
        }
        const rawTarget = ev.target;
        if (!rawTarget || rawTarget === body)
          return;
        const targetEl = rawTarget === document ? document.scrollingElement : rawTarget;
        if (!targetEl || typeof targetEl.contains !== "function")
          return;
        if (targetEl === this.cachedScrollContainer || targetEl.contains(body)) {
          recordScrollFromTarget(targetEl);
        }
      };
      document.addEventListener("scroll", onCaptureScroll, {
        capture: true,
        passive: true
      });
      offDocScroll = () => {
        document.removeEventListener("scroll", onCaptureScroll, {
          capture: true
        });
      };
    }
    let offWinResize = null;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      const onResize = () => {
        this.cachedScrollContainer = null;
      };
      window.addEventListener("resize", onResize, { passive: true });
      offWinResize = () => {
        window.removeEventListener("resize", onResize);
      };
    }
    this.bodyEl = body;
    this.cachedScrollContainer = null;
    root.append(nav, bannerHost, body);
    container.appendChild(root);
    this.renderStickyQueueBanner();
    this.renderBody();
    return () => {
      if (this.mountGen === mountGen) {
        this.mountGen++;
      }
      this.captureScrollPositions();
      this.cancelScrollSettleTracker();
      this.pendingScrollRestore?.cancel();
      this.pendingScrollRestore = null;
      offDocScroll?.();
      offDocScroll = null;
      offWinResize?.();
      offWinResize = null;
      this.rememberedScrollContainer = null;
      this.cachedScrollContainer = null;
      this.galleryHostEl = null;
      if (container.style) {
        container.style.width = prevContainerWidth;
        container.style.height = prevContainerHeight;
        container.style.minHeight = prevContainerMinHeight;
      }
      this.renderedTab = null;
      this.characterWidget?.flushPendingOverrideSave();
      this.characterWidget?.destroy();
      this.characterWidget = null;
      this.bodyEl = null;
      this.stickyBannerHost = null;
      this.galleryView?.destroy();
      this.galleryView = null;
      this.navButtons.clear();
    };
  }
  setActiveTab(tab, characterId, options) {
    const prevCharId = this.resolveCurrentCharacterId();
    this.activeTab = tab;
    this.actionError = null;
    if (characterId !== undefined) {
      this.inspectedCharacterId = characterId;
    }
    const nextCharId = this.resolveCurrentCharacterId();
    const characterChanged = tab === "character" && characterId !== undefined && nextCharId !== prevCharId;
    if (characterChanged) {
      this.tabScrollTops.character = 0;
      this.clearCharacterInnerScrollTops();
    }
    this.expandNextCharacterConfig = Boolean(options?.expandOptions);
    for (const [id, b] of this.navButtons.entries()) {
      b.classList.toggle("is-active", id === this.activeTab);
    }
    this.renderBody(characterChanged && this.renderedTab === "character");
  }
  syncPreferencesFromStorage() {
    const loaded = loadPrefsFromStorage(CHARACTER_PREFS_STORAGE_KEY, sanitizeCharacterPreferences, () => getDefaultCharacterPreferences(true));
    const prevThumbnailSize = this.characterUiState.thumbnailSize;
    this.characterUiState = {
      ...this.characterUiState,
      showGreetingSubfilter: loaded.showGreetingSubfilter,
      showWorldBookSubfilter: loaded.showWorldBookSubfilter,
      showUrlPicker: loaded.showUrlPicker,
      showRemoteThumbnails: loaded.showRemoteThumbnails,
      mediaViewMode: loaded.mediaViewMode,
      mediaFilter: loaded.mediaFilter,
      thumbnailSize: loaded.thumbnailSize
    };
    if (this.characterWidget) {
      this.characterWidget.applySharedPreferences({
        showGreetingSubfilter: loaded.showGreetingSubfilter,
        showWorldBookSubfilter: loaded.showWorldBookSubfilter,
        showUrlPicker: loaded.showUrlPicker,
        showRemoteThumbnails: loaded.showRemoteThumbnails,
        mediaViewMode: loaded.mediaViewMode,
        mediaFilter: loaded.mediaFilter,
        thumbnailSize: loaded.thumbnailSize
      });
    } else if (this.activeTab === "settings" && this.bodyEl && loaded.thumbnailSize !== prevThumbnailSize) {
      this.renderBody();
    }
  }
  renderStickyQueueBanner() {
    if (!this.stickyBannerHost)
      return;
    this.stickyBannerHost.innerHTML = "";
    if (!isQueueActiveStatus(this.queueProgress.status))
      return;
    this.stickyBannerHost.appendChild(renderQueueBanner(this.queueProgress, this.callbacks.onQueueControl));
  }
  updateExternalState(settings, stats, queueProgress) {
    const prevSettings = this.settings;
    const prevStatus = this.queueProgress.status;
    const prevStatsAssets = this.stats.totalAssets;
    const prevStatsFailed = this.stats.totalFailedUrls;
    const scanSettingsChanged = settings.scanBareUrls !== prevSettings.scanBareUrls || settings.adoptNativeGalleryImages !== prevSettings.adoptNativeGalleryImages;
    const dataChanged = JSON.stringify(settings) !== JSON.stringify(this.settings) || JSON.stringify(stats) !== JSON.stringify(this.stats);
    this.settings = settings;
    this.stats = stats;
    this.queueProgress = queueProgress;
    this.renderStickyQueueBanner();
    const wasActive = isQueueActiveStatus(prevStatus);
    const nowActive = isQueueActiveStatus(queueProgress.status);
    const queueCompleted = wasActive && !nowActive;
    const galleryInvalidated = stats.totalAssets !== prevStatsAssets || queueCompleted;
    if (galleryInvalidated) {
      this.invalidateGalleryCache();
    }
    if (galleryInvalidated || stats.totalFailedUrls !== prevStatsFailed || queueCompleted || scanSettingsChanged) {
      this.invalidateCharacterCache();
      this.invalidateLibrarySummaries();
    }
    if (this.activeTab === "character") {
      const nextId = this.resolveCurrentCharacterId();
      const currentId = this.characterWidget?.getCharacterId() ?? null;
      if (nextId !== currentId) {
        if (this.bodyEl)
          this.renderBody();
        return;
      }
      if (this.characterWidget) {
        this.characterWidget.updateExternalState(settings, queueProgress);
        return;
      }
    }
    if (!this.bodyEl)
      return;
    if (this.activeTab === "gallery") {
      if (queueCompleted || galleryInvalidated) {
        this.galleryView?.refresh({ reshuffleRandom: false });
      }
      return;
    }
    if (!dataChanged && !queueCompleted && (prevStatus === queueProgress.status || wasActive && nowActive)) {
      return;
    }
    if (this.activeTab === "settings" && !dataChanged && !queueCompleted)
      return;
    if (this.activeTab === "library" && !dataChanged && !queueCompleted)
      return;
    this.renderBody();
  }
  async guard(fn, expectedTab = this.activeTab) {
    const mountGen = this.mountGen;
    try {
      this.actionError = null;
      await fn();
      return true;
    } catch (err) {
      if (!this.bodyEl || this.mountGen !== mountGen || this.activeTab !== expectedTab) {
        return false;
      }
      this.actionError = err instanceof Error ? err.message : String(err);
      this.renderBody();
      return false;
    }
  }
  notifyActiveChatChanged() {
    if (this.activeTab === "character" && this.bodyEl) {
      const currentId = this.characterWidget?.getCharacterId() ?? null;
      const prevInspected = this.inspectedCharacterId;
      this.inspectedCharacterId = null;
      const nextId = this.resolveCurrentCharacterId();
      if (this.characterWidget && nextId && currentId === nextId) {
        this.inspectedCharacterId = prevInspected;
        return;
      }
      this.tabScrollTops.character = 0;
      this.clearCharacterInnerScrollTops();
      if (this.characterWidget && nextId) {
        this.applyTabScrollTop(0);
        this.characterWidget.setCharacterId(nextId);
        return;
      }
      this.renderBody(true);
      return;
    }
    this.inspectedCharacterId = null;
    this.tabScrollTops.character = 0;
    this.clearCharacterInnerScrollTops();
  }
  invalidateCharacterCache(characterId) {
    if (characterId) {
      this.characterScanCache.delete(characterId);
    } else {
      this.characterScanCache.clear();
    }
  }
  invalidateGalleryCache() {
    this.galleryCache = {
      characters: null,
      loadedIncludeEmpty: false,
      randomWeights: this.galleryCache.randomWeights
    };
    const isGalleryActiveInOpenDrawer = Boolean(this.bodyEl) && this.activeTab === "gallery" && Boolean(this.galleryView);
    if (!isGalleryActiveInOpenDrawer) {
      this.galleryView?.invalidateCache();
    }
  }
  invalidateLibrarySummaries() {
    this.librarySummaries = null;
    this.librarySummariesStale = false;
    this.librarySelectedCharIds.clear();
    this.libraryExpandedCharIds.clear();
    this.libraryPage = 1;
  }
  refreshActiveScan(characterId) {
    this.invalidateGalleryCache();
    this.invalidateCharacterCache(characterId);
    this.invalidateLibrarySummaries();
    if (this.activeTab === "gallery" && this.bodyEl && this.galleryView) {
      this.galleryView.refresh({ reshuffleRandom: false });
    }
    if (!this.characterWidget) {
      if (this.activeTab === "character" && this.bodyEl && this.resolveCurrentCharacterId()) {
        this.renderBody();
      }
      return;
    }
    if (characterId && this.characterWidget.getCharacterId() !== characterId) {
      return;
    }
    this.characterWidget.refreshScan(true);
  }
  resolveCurrentCharacterId() {
    if (this.inspectedCharacterId)
      return this.inspectedCharacterId;
    try {
      const editorState = this.ctx.ui?.characterEditor?.getState?.();
      if (editorState?.open && editorState.characterId) {
        return editorState.characterId;
      }
    } catch {}
    try {
      const editingId = this.ctx.state?.get?.("characters.editingId");
      if (typeof editingId === "string" && editingId) {
        return editingId;
      }
    } catch {}
    try {
      const activeChat = this.ctx.getActiveChat?.();
      if (activeChat?.characterId)
        return activeChat.characterId;
    } catch {}
    try {
      const activeState = this.ctx.state?.get?.("chat.active");
      if (activeState?.characterId)
        return activeState.characterId;
    } catch {}
    return null;
  }
  isShowingPlaceholder(body) {
    if (this.renderedTab !== "gallery")
      return false;
    const host = this.galleryHostEl;
    const wrap = host?.firstElementChild ?? host?.children?.[0];
    if (wrap && wrap.children) {
      for (let i = 0;i < wrap.children.length; i++) {
        if (wrap.children[i]?.classList?.contains("ml-placeholder")) {
          return true;
        }
      }
      return false;
    }
    return Boolean(body.querySelector(".ml-placeholder"));
  }
  getActiveScrollContainer() {
    const body = this.bodyEl;
    if (!body)
      return null;
    const cached = this.cachedScrollContainer;
    if (cached && cached.isConnected !== false && (cached === body || typeof cached.contains === "function" && cached.contains(body))) {
      return cached;
    }
    const resolved = resolveScrollContainer(body, this.rememberedScrollContainer, body);
    if (resolved && isElementScrollable(resolved)) {
      this.cachedScrollContainer = resolved;
    } else {
      this.cachedScrollContainer = null;
    }
    return resolved;
  }
  readTabScrollTop() {
    const scroller = this.getActiveScrollContainer();
    if (scroller && typeof scroller.scrollTop === "number" && Number.isFinite(scroller.scrollTop)) {
      this.rememberedScrollContainer = scroller;
      return Math.max(0, scroller.scrollTop);
    }
    return this.tabScrollTops[this.activeTab] ?? 0;
  }
  clearCharacterInnerScrollTops() {
    for (const key of [
      "localized-asset-grid",
      "url-picker-list",
      "greetings-subfilter",
      "worldbooks-subfilter"
    ]) {
      this.innerScrollTops.delete(key);
    }
  }
  cancelScrollSettleTracker() {
    if (typeof cancelAnimationFrame === "function") {
      for (const id of this.scrollSettleRafIds) {
        cancelAnimationFrame(id);
      }
    }
    this.scrollSettleRafIds = [];
    this.isSettlingScrollRestore = false;
  }
  applyTabScrollTop(scrollTop) {
    const mountGen = this.mountGen;
    this.cancelScrollSettleTracker();
    this.pendingScrollRestore = applyScrollTopWithSettlement(() => this.getActiveScrollContainer(), scrollTop, this.pendingScrollRestore, () => !this.bodyEl || this.mountGen !== mountGen);
    this.isSettlingScrollRestore = Boolean(this.pendingScrollRestore);
    if (this.pendingScrollRestore && typeof requestAnimationFrame === "function") {
      const raf1 = requestAnimationFrame(() => {
        if (this.mountGen !== mountGen)
          return;
        const raf2 = requestAnimationFrame(() => {
          if (this.mountGen !== mountGen)
            return;
          this.isSettlingScrollRestore = false;
          this.scrollSettleRafIds = [];
        });
        this.scrollSettleRafIds = [raf2];
      });
      this.scrollSettleRafIds = [raf1];
    }
  }
  restoreScrollIfReset() {
    const body = this.bodyEl;
    if (!body || this.isRenderingBody || this.isShowingPlaceholder(body))
      return;
    const saved = this.tabScrollTops[this.activeTab] ?? 0;
    if (saved > 0 && this.readTabScrollTop() === 0) {
      this.applyTabScrollTop(saved);
    }
  }
  captureScrollPositions() {
    const body = this.bodyEl;
    if (!body || !this.renderedTab)
      return;
    if (!this.isShowingPlaceholder(body) && body.isConnected !== false && body.clientHeight !== 0) {
      const scroller = this.getActiveScrollContainer();
      if (scroller && scroller.clientHeight !== 0 && typeof scroller.scrollTop === "number" && Number.isFinite(scroller.scrollTop)) {
        const nextTop = Math.max(0, scroller.scrollTop);
        if (!(this.isSettlingScrollRestore && nextTop === 0 && this.tabScrollTops[this.renderedTab] > 0)) {
          this.rememberedScrollContainer = scroller;
          this.tabScrollTops[this.renderedTab] = nextTop;
        }
      }
    }
    for (const el of body.querySelectorAll("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (id && typeof el.scrollTop === "number" && Number.isFinite(el.scrollTop)) {
        this.innerScrollTops.set(id, Math.max(0, el.scrollTop));
      }
    }
  }
  restoreScrollPositions() {
    const body = this.bodyEl;
    if (!body)
      return;
    for (const el of body.querySelectorAll("[data-scroll-id]")) {
      const id = el.dataset.scrollId;
      if (!id)
        continue;
      const saved = this.innerScrollTops.get(id);
      if (saved !== undefined) {
        el.scrollTop = saved;
      }
    }
    this.applyTabScrollTop(this.tabScrollTops[this.activeTab] ?? 0);
  }
  renderBody(skipCaptureScroll = false) {
    const body = this.bodyEl;
    if (!body)
      return;
    if (!skipCaptureScroll) {
      this.captureScrollPositions();
    }
    this.isRenderingBody = true;
    this.cachedScrollContainer = null;
    this.galleryHostEl = null;
    try {
      this.characterWidget?.flushPendingOverrideSave();
      this.characterWidget?.destroy();
      this.characterWidget = null;
      this.galleryView?.destroy();
      this.galleryView = null;
      body.innerHTML = "";
      this.renderedTab = this.activeTab;
      if (this.actionError) {
        const errBox = document.createElement("div");
        errBox.className = "ml-error-banner";
        const errText = document.createElement("span");
        errText.textContent = `Error: ${this.actionError}`;
        errBox.append(createIcon("alert", 14), errText);
        body.appendChild(errBox);
      }
      if (this.activeTab === "character") {
        this.renderCharacterTab(body);
      } else if (this.activeTab === "gallery") {
        this.renderGalleryTab(body);
      } else if (this.activeTab === "library") {
        this.renderLibraryTab(body);
      } else {
        this.renderSettingsTab(body);
      }
      this.restoreScrollPositions();
    } finally {
      this.isRenderingBody = false;
    }
  }
  renderCharacterTab(body) {
    const charId = this.resolveCurrentCharacterId();
    if (!charId) {
      const empty = document.createElement("div");
      empty.className = "ml-section ml-empty ml-empty-card";
      const iconWrap = document.createElement("div");
      iconWrap.className = "ml-empty-icon";
      iconWrap.appendChild(createIcon("image", 20));
      const textEl = document.createElement("div");
      textEl.className = "ml-empty-text";
      textEl.textContent = "Open a character chat or Character Editor to inspect and localize its media.";
      empty.append(iconWrap, textEl);
      body.appendChild(empty);
      return;
    }
    const forceExpandConfig = this.expandNextCharacterConfig;
    this.expandNextCharacterConfig = false;
    if (forceExpandConfig && !this.characterUiState.showDownloadConfig) {
      this.characterUiState = {
        ...this.characterUiState,
        showDownloadConfig: true
      };
      savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, sanitizeCharacterPreferences(this.characterUiState, true));
    }
    const cachedScan = this.characterScanCache.get(charId) ?? null;
    const host = document.createElement("div");
    host.className = "ml-gallery-host";
    host.style.marginTop = "0";
    body.appendChild(host);
    const onOpenCharacterEditor = this.callbacks.onOpenCharacterEditor ?? (canOpenNativeCharacterEditor(this.ctx) ? (targetCharId) => {
      openNativeCharacterEditor(this.ctx, targetCharId);
    } : undefined);
    const widgetCallbacks = {
      ...this.callbacks,
      onOpenCharacterEditor,
      onPurgeCharacterCache: async (targetCharId, urls) => {
        await this.callbacks.onPurgeCharacterCache(targetCharId, urls);
        clearWarmGalleryThumbs();
        this.invalidateGalleryCache();
        this.invalidateLibrarySummaries();
      }
    };
    const widget = new CharacterMediaWidget(host, this.ctx, charId, this.settings, this.queueProgress, widgetCallbacks, {
      inDrawer: true,
      defaultExpandConfig: this.characterUiState.showDownloadConfig,
      defaultExpandDownloadedMedia: this.characterUiState.showDownloadedMedia,
      initialUiState: this.characterUiState,
      initialScan: cachedScan,
      onUiStateChange: (nextState) => {
        this.characterUiState = {
          ...nextState,
          expandedUrls: [...nextState.expandedUrls]
        };
        savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, sanitizeCharacterPreferences(this.characterUiState, true));
        this.options?.onCharacterPrefsUpdated?.();
      },
      onScanChange: (nextScan) => {
        if (nextScan) {
          this.characterScanCache.set(nextScan.characterId, nextScan);
        }
      }
    });
    this.characterWidget = widget;
    if (cachedScan) {
      widget.render();
    } else {
      widget.refreshScan(false);
    }
  }
  renderGalleryTab(body) {
    const host = document.createElement("div");
    this.galleryHostEl = host;
    body.appendChild(host);
    const onOpenCharacterEditor = this.callbacks.onOpenCharacterEditor ?? (canOpenNativeCharacterEditor(this.ctx) ? (characterId) => {
      openNativeCharacterEditor(this.ctx, characterId);
    } : undefined);
    const gallery = new LibraryGalleryView(host, {
      onLoadLibraryMedia: this.callbacks.onListLibraryMedia,
      onPurgeAsset: async (characterId, normalizedUrl) => {
        await this.callbacks.onPurgeCharacterCache(characterId, [normalizedUrl]);
        clearWarmGalleryThumbs();
        this.invalidateCharacterCache(characterId);
        this.invalidateLibrarySummaries();
      },
      onOpenCharacterTab: (characterId) => {
        this.setActiveTab("character", characterId);
      },
      onOpenCharacterEditor,
      onStateChange: (nextState) => {
        this.galleryState = {
          ...nextState,
          selectedMediaTypes: [...nextState.selectedMediaTypes]
        };
        savePrefsToStorage(GALLERY_PREFS_STORAGE_KEY, sanitizeGalleryPreferences(this.galleryState));
      },
      onCacheChange: (nextCache) => {
        this.galleryCache = nextCache;
      },
      onScrollToTop: () => {
        this.tabScrollTops.gallery = 0;
        this.cachedScrollContainer = null;
        if (this.bodyEl && this.renderedTab === "gallery") {
          this.applyTabScrollTop(0);
        }
      },
      onGetScrollTop: () => {
        const bodyEl = this.bodyEl;
        if (bodyEl && this.renderedTab === "gallery" && !this.isRenderingBody && !this.isShowingPlaceholder(bodyEl)) {
          return this.readTabScrollTop();
        }
        return this.tabScrollTops.gallery;
      },
      onSetScrollTop: (scrollTop) => {
        const next = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
        this.tabScrollTops.gallery = next;
        this.cachedScrollContainer = null;
        if (this.bodyEl && this.renderedTab === "gallery") {
          this.applyTabScrollTop(next);
        }
      }
    }, {
      state: this.galleryState,
      cache: this.galleryCache
    });
    this.galleryView = gallery;
    gallery.render();
    gallery.ensureLoaded();
  }
  renderLibraryTab(body) {
    const topBar = document.createElement("div");
    topBar.className = "ml-header-bar";
    const info = document.createElement("div");
    info.className = "ml-inline-title";
    const title = document.createElement("span");
    title.className = "ml-title";
    title.textContent = "Library Scanner & Batch";
    info.append(createIcon("layers", 14), title, createInfoTip("Scans characters, World Books, and Regex scripts locally with zero network traffic so you can batch-download or clear storage."));
    const scanBtn = createIconButton({
      icon: "refresh",
      label: this.libraryScanning ? "Scanning..." : this.librarySummaries ? "Rescan Library" : "Scan Library",
      title: "Scan all characters, linked World Books, and Regex scripts locally",
      className: `ml-btn is-primary is-sm ${this.libraryScanning ? "is-busy" : ""}`,
      size: 13,
      disabled: this.libraryScanning,
      onClick: async () => {
        const mountGen = this.mountGen;
        this.actionError = null;
        this.libraryScanning = true;
        if (this.activeTab === "library" && this.bodyEl) {
          this.renderBody();
        }
        try {
          const res = await this.callbacks.onScanLibrary(Boolean(this.librarySummaries));
          if (!this.bodyEl || this.mountGen !== mountGen)
            return;
          this.librarySummaries = res.characters;
          this.librarySummariesStale = false;
          this.libraryTotalRemote = res.totalUniqueRemote;
          this.libraryPage = 1;
          this.tabScrollTops.library = 0;
          this.innerScrollTops.set("library-char-list", 0);
          this.librarySelectedCharIds = new Set(res.characters.filter((c) => c.remoteCount + c.failedCount > 0).map((c) => c.characterId));
        } catch (err) {
          if (this.bodyEl && this.mountGen === mountGen && this.activeTab === "library") {
            this.actionError = err instanceof Error ? err.message : String(err);
          }
        } finally {
          this.libraryScanning = false;
          if (this.activeTab === "library" && this.bodyEl && this.mountGen === mountGen) {
            this.renderBody();
          }
        }
      }
    });
    topBar.append(info, scanBtn);
    if (!this.librarySummaries) {
      const scanSection = document.createElement("div");
      scanSection.className = "ml-section";
      const intro = document.createElement("div");
      intro.className = "ml-lib-intro";
      intro.textContent = "Scan your character cards, linked World Books, and Regex scripts locally with zero network traffic to filter by section, batch-download, or purge cached media.";
      scanSection.append(topBar, intro);
      body.appendChild(scanSection);
      return;
    }
    const scanSection = document.createElement("div");
    scanSection.className = "ml-section";
    scanSection.appendChild(topBar);
    const summaryStrip = document.createElement("div");
    summaryStrip.className = "ml-stat-strip";
    const totalLocal = this.librarySummaries.reduce((sum, c) => sum + c.localizedCount, 0);
    const totalFailed = this.librarySummaries.reduce((sum, c) => sum + c.failedCount, 0);
    const totalBytes = this.librarySummaries.reduce((sum, c) => sum + c.localizedBytes, 0);
    const addLibChip = (label, variant) => {
      const chip = document.createElement("span");
      chip.className = `ml-stat-chip ${variant}`;
      chip.textContent = label;
      summaryStrip.appendChild(chip);
    };
    addLibChip(`${this.librarySummaries.length} chars`, "is-muted");
    addLibChip(`${this.libraryTotalRemote} remote`, this.libraryTotalRemote > 0 ? "is-warn" : "is-muted");
    addLibChip(`${totalLocal} local${totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}`, totalLocal > 0 ? "is-success" : "is-muted");
    if (totalFailed > 0) {
      addLibChip(`${totalFailed} failed`, "is-danger");
    }
    scanSection.appendChild(summaryStrip);
    if (this.librarySummariesStale) {
      const staleNote = document.createElement("div");
      staleNote.className = "ml-warn-banner";
      const staleText = document.createElement("span");
      staleText.textContent = "Library media changed since last scan. Click Rescan Library to refresh counts.";
      staleNote.append(createIcon("alert", 14), staleText);
      scanSection.appendChild(staleNote);
    }
    body.appendChild(scanSection);
    const filterSection = document.createElement("div");
    filterSection.className = "ml-section";
    const secHeader = document.createElement("div");
    secHeader.className = "ml-section-title";
    const secLeft = document.createElement("div");
    secLeft.className = "ml-inline-title";
    const secStep = document.createElement("span");
    secStep.className = "ml-step-num";
    secStep.textContent = "1";
    const secText = document.createElement("span");
    secText.textContent = "Sections to Download";
    secLeft.append(secStep, secText, createInfoTip("Only remote items found inside checked sections are queued across selected characters."));
    secHeader.appendChild(secLeft);
    filterSection.appendChild(secHeader);
    let charHeaderTitle;
    let charHeaderText;
    let listSlotEl;
    let footerSlotEl;
    const cardCheckboxes = new Map;
    const cardElements = new Map;
    const updateHeaderSummary = () => {
      const text = `Characters (${this.librarySelectedCharIds.size} sel · ${this.libraryTotalRemote} remote)`;
      if (charHeaderText) {
        charHeaderText.textContent = text;
      } else {
        charHeaderTitle.textContent = `2. ${text}`;
      }
    };
    const buildCharDetails = (c) => {
      const details = document.createElement("div");
      details.className = "ml-item-details";
      const statRow = document.createElement("div");
      statRow.className = "ml-detail-kv-row";
      const addMiniBadge = (label, variant = "") => {
        const b = document.createElement("span");
        b.className = `ml-badge ${variant}`.trim();
        b.textContent = label;
        statRow.appendChild(b);
      };
      addMiniBadge(`${c.totalUnique} Unique URLs`);
      addMiniBadge(`${c.localizedCount} Localized`, "is-success");
      addMiniBadge(`${c.remoteCount} Remote`, c.remoteCount > 0 ? "is-warn" : "");
      if (c.failedCount > 0)
        addMiniBadge(`${c.failedCount} Failed`, "is-danger");
      if (c.localizedBytes > 0)
        addMiniBadge(`Size: ${formatBytes(c.localizedBytes)}`);
      details.appendChild(statRow);
      const secList = document.createElement("div");
      secList.className = "ml-detail-source-list";
      for (const sec of ALL_MEDIA_SECTIONS) {
        const count = c.sectionRemoteCounts[sec] || 0;
        if (count === 0)
          continue;
        const chip = document.createElement("span");
        chip.className = "ml-detail-source-chip";
        chip.textContent = `${SECTION_LABELS[sec]}: ${count} remote`;
        secList.appendChild(chip);
      }
      if (secList.childElementCount > 0) {
        details.appendChild(secList);
      }
      const actionsRow = document.createElement("div");
      actionsRow.className = "ml-detail-kv-row";
      const inspectBtn = document.createElement("button");
      inspectBtn.type = "button";
      inspectBtn.className = "ml-btn is-sm is-primary";
      inspectBtn.textContent = "Open in Character Tab ↗";
      inspectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setActiveTab("character", c.characterId);
      });
      actionsRow.appendChild(inspectBtn);
      details.appendChild(actionsRow);
      return details;
    };
    const buildFooter = () => {
      let estimatedMatching = 0;
      let selectedLocalizedChars = 0;
      for (const c of this.librarySummaries ?? []) {
        if (!this.librarySelectedCharIds.has(c.characterId))
          continue;
        if (c.localizedCount > 0)
          selectedLocalizedChars++;
        let charSum = 0;
        for (const sec of this.librarySelectedSections) {
          charSum += c.sectionRemoteCounts[sec] || 0;
        }
        estimatedMatching += Math.min(c.remoteCount + c.failedCount, charSum);
      }
      const footer = document.createElement("div");
      footer.className = "ml-download-bar";
      const capLabel = document.createElement("label");
      capLabel.className = "ml-toggle-label";
      capLabel.textContent = "Limit:";
      const capSelect = document.createElement("select");
      capSelect.className = "ml-select is-sm";
      for (const v of [10, 25, 50, 100, 250, 0]) {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = v === 0 ? "Unlimited" : `Max ${v}`;
        if (v === this.libraryBatchCap)
          opt.selected = true;
        capSelect.appendChild(opt);
      }
      capSelect.addEventListener("change", () => {
        this.libraryBatchCap = Number(capSelect.value);
        updateSummaryAndFooter();
      });
      capLabel.appendChild(capSelect);
      const footerBtns = document.createElement("div");
      footerBtns.className = "ml-header-actions";
      if (selectedLocalizedChars > 0) {
        footerBtns.appendChild(createIconButton({
          icon: "trash",
          label: `Remove (${selectedLocalizedChars})`,
          title: `Remove all localized cache assets for ${selectedLocalizedChars} selected character(s)`,
          className: "ml-btn is-danger is-sm",
          size: 13,
          onClick: async () => {
            const mountGen = this.mountGen;
            const targetIds = Array.from(this.librarySelectedCharIds);
            if (targetIds.length === 0)
              return;
            const res = await this.ctx.ui.showConfirm({
              title: "Remove Localized Cache for Selected Characters",
              message: `Remove localized media for ${targetIds.length} selected character(s)? Original card URLs and native expressions are untouched.`,
              confirmLabel: "Remove Localized",
              cancelLabel: "Cancel",
              variant: "danger"
            });
            if (!this.bodyEl || this.mountGen !== mountGen || this.activeTab !== "library" || !res?.confirmed) {
              return;
            }
            const purgeSucceeded = await this.guard(async () => {
              await this.callbacks.onBulkPurgeCharacters(targetIds);
              if (!this.bodyEl || this.mountGen !== mountGen)
                return;
              const rescanned = await this.callbacks.onScanLibrary(false);
              if (!this.bodyEl || this.mountGen !== mountGen)
                return;
              this.librarySummaries = rescanned.characters;
              this.librarySummariesStale = false;
              this.libraryTotalRemote = rescanned.totalUniqueRemote;
              this.libraryPage = 1;
              this.librarySelectedCharIds = new Set(Array.from(this.librarySelectedCharIds).filter((id) => rescanned.characters.some((c) => c.characterId === id)));
              for (const id of targetIds) {
                this.invalidateCharacterCache(id);
              }
              clearWarmGalleryThumbs();
              this.invalidateGalleryCache();
            }, "library");
            if (purgeSucceeded && this.activeTab === "library" && this.bodyEl && this.mountGen === mountGen) {
              this.renderBody();
            }
          }
        }));
      }
      const effectiveBatchCount = this.libraryBatchCap > 0 ? Math.min(estimatedMatching, this.libraryBatchCap) : estimatedMatching;
      const batchStartBtn = createIconButton({
        icon: "download",
        label: `Download (~${effectiveBatchCount})`,
        title: `Queue up to ${effectiveBatchCount} files across ${this.librarySelectedCharIds.size} selected cards`,
        className: "ml-btn is-primary is-sm",
        size: 13,
        disabled: this.librarySelectedCharIds.size === 0 || this.librarySelectedSections.size === 0 || effectiveBatchCount === 0,
        onClick: async () => {
          const mountGen = this.mountGen;
          const charIds = Array.from(this.librarySelectedCharIds);
          const sections = Array.from(this.librarySelectedSections);
          const maxItems = this.libraryBatchCap;
          if (effectiveBatchCount > this.settings.confirmThreshold) {
            const res = await this.ctx.ui.showConfirm({
              title: "Confirm Library Batch Download",
              message: `Start downloading up to ${effectiveBatchCount} remote media files across ${charIds.length} selected characters?`,
              confirmLabel: `Start Batch (${effectiveBatchCount})`,
              cancelLabel: "Cancel"
            });
            if (!this.bodyEl || this.mountGen !== mountGen || this.activeTab !== "library" || !res?.confirmed) {
              return;
            }
          }
          batchStartBtn.disabled = true;
          try {
            await this.guard(() => this.callbacks.onStartDownload({
              characterIds: charIds,
              sections,
              mediaKinds: this.settings.defaultMediaKinds,
              includeFailed: this.settings.defaultIncludeFailed,
              maxItems
            }), "library");
          } finally {
            batchStartBtn.disabled = this.librarySelectedCharIds.size === 0 || this.librarySelectedSections.size === 0 || effectiveBatchCount === 0;
          }
        }
      });
      footerBtns.appendChild(batchStartBtn);
      footer.append(capLabel, footerBtns);
      return footer;
    };
    const updateSummaryAndFooter = () => {
      updateHeaderSummary();
      const nextFooter = buildFooter();
      footerSlotEl.replaceWith(nextFooter);
      footerSlotEl = nextFooter;
    };
    const buildCharListSlot = () => {
      const slot = document.createElement("div");
      slot.className = "ml-stack";
      cardCheckboxes.clear();
      cardElements.clear();
      const visibleChars = (this.librarySummaries ?? []).filter((c) => !this.libraryOnlyWithRemote || c.remoteCount + c.failedCount > 0);
      const totalItems = visibleChars.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / LIBRARY_BATCH_PAGE_SIZE));
      const page = Math.max(1, Math.min(totalPages, this.libraryPage));
      this.libraryPage = page;
      const startIndex = (page - 1) * LIBRARY_BATCH_PAGE_SIZE;
      const endIndex = Math.min(totalItems, startIndex + LIBRARY_BATCH_PAGE_SIZE);
      const pageChars = visibleChars.slice(startIndex, endIndex);
      if (totalPages > 1) {
        const pagBar = document.createElement("div");
        pagBar.className = "ml-gallery-pagination";
        const pagInfo = document.createElement("div");
        pagInfo.className = "ml-gallery-pagination-info";
        const pagText = document.createElement("span");
        pagText.textContent = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} characters`;
        pagInfo.appendChild(pagText);
        pagBar.appendChild(pagInfo);
        const pagActions = document.createElement("div");
        pagActions.className = "ml-gallery-pagination-actions";
        const prevBtn = createIconButton({
          icon: "chevron-left",
          label: "Prev",
          title: "Previous page",
          className: "ml-btn is-sm",
          size: 12,
          disabled: page <= 1,
          onClick: () => {
            this.libraryPage = Math.max(1, page - 1);
            rerenderCharList({ resetListScroll: true });
          }
        });
        const pageLabel = document.createElement("span");
        pageLabel.className = "ml-url-sources";
        pageLabel.textContent = `Page ${page} / ${totalPages}`;
        const nextBtn = createIconButton({
          icon: "chevron-right",
          label: "Next",
          title: "Next page",
          className: "ml-btn is-sm",
          size: 12,
          disabled: page >= totalPages,
          onClick: () => {
            this.libraryPage = Math.min(totalPages, page + 1);
            rerenderCharList({ resetListScroll: true });
          }
        });
        pagActions.append(prevBtn, pageLabel, nextBtn);
        pagBar.appendChild(pagActions);
        slot.appendChild(pagBar);
      }
      const charList = document.createElement("div");
      charList.className = "ml-url-list is-tall";
      charList.dataset.scrollId = "library-char-list";
      charList.addEventListener("scroll", () => {
        if (!this.isRenderingBody && typeof charList.scrollTop === "number" && Number.isFinite(charList.scrollTop)) {
          this.innerScrollTops.set("library-char-list", Math.max(0, charList.scrollTop));
        }
      }, { passive: true });
      if (pageChars.length === 0) {
        const emptyList = document.createElement("div");
        emptyList.className = "ml-empty";
        emptyList.textContent = (this.librarySummaries?.length ?? 0) === 0 ? "No character cards found in your library." : 'All scanned characters are localized. Uncheck "Remote only" to view them.';
        charList.appendChild(emptyList);
      }
      for (const c of pageChars) {
        const isExpanded = this.libraryExpandedCharIds.has(c.characterId);
        const isSelected = this.librarySelectedCharIds.has(c.characterId);
        const card = document.createElement("div");
        card.className = `ml-lib-item-card ${isExpanded ? "is-expanded" : ""} ${isSelected ? "is-selected" : ""}`.trim();
        cardElements.set(c.characterId, card);
        const row = document.createElement("div");
        row.className = "ml-lib-row";
        const left = document.createElement("div");
        left.className = "ml-check-card-left";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "ml-row-checkbox";
        cb.checked = isSelected;
        cb.addEventListener("click", (e) => e.stopPropagation());
        cb.addEventListener("change", () => {
          if (cb.checked) {
            this.librarySelectedCharIds.add(c.characterId);
            card.classList.add("is-selected");
          } else {
            this.librarySelectedCharIds.delete(c.characterId);
            card.classList.remove("is-selected");
          }
          updateSummaryAndFooter();
        });
        cardCheckboxes.set(c.characterId, cb);
        const dot = document.createElement("span");
        const dotVariant = c.failedCount > 0 ? "is-danger" : c.remoteCount > 0 ? "is-warn" : c.localizedCount > 0 ? "is-success" : "is-muted";
        dot.className = `ml-status-dot ${dotVariant}`;
        dot.setAttribute("aria-hidden", "true");
        const nameSpan = document.createElement("span");
        nameSpan.className = "ml-lib-char-name";
        nameSpan.textContent = c.characterName;
        nameSpan.title = c.characterName;
        left.append(cb, dot, nameSpan);
        const right = document.createElement("div");
        right.className = "ml-header-actions";
        const badge = document.createElement("span");
        const pending = c.remoteCount + c.failedCount;
        badge.className = `ml-badge ${pending > 0 ? "is-warn" : "is-success"}`;
        badge.textContent = pending > 0 ? `${pending} rem · ${c.localizedCount}/${c.totalUnique}` : `${c.localizedCount}/${c.totalUnique} local`;
        badge.title = pending > 0 ? `${pending} remote/failed, ${c.localizedCount} of ${c.totalUnique} localized` : `${c.localizedCount} of ${c.totalUnique} localized`;
        right.appendChild(badge);
        if (c.localizedBytes > 0) {
          const sizeBadge = document.createElement("span");
          sizeBadge.className = "ml-badge is-muted";
          sizeBadge.textContent = formatBytes(c.localizedBytes);
          right.appendChild(sizeBadge);
        }
        const expandHint = document.createElement("span");
        expandHint.className = "ml-expand-hint";
        expandHint.textContent = isExpanded ? "Hide ▴" : "Info ▾";
        right.appendChild(expandHint);
        row.append(left, right);
        let detailsEl = isExpanded ? buildCharDetails(c) : null;
        row.addEventListener("click", () => {
          const nowExpanded = !this.libraryExpandedCharIds.has(c.characterId);
          if (nowExpanded) {
            this.libraryExpandedCharIds.add(c.characterId);
            card.classList.add("is-expanded");
            expandHint.textContent = "Hide ▴";
            if (!detailsEl) {
              detailsEl = buildCharDetails(c);
            }
            card.appendChild(detailsEl);
          } else {
            this.libraryExpandedCharIds.delete(c.characterId);
            card.classList.remove("is-expanded");
            expandHint.textContent = "Info ▾";
            detailsEl?.remove();
            detailsEl = null;
          }
        });
        card.appendChild(row);
        if (detailsEl) {
          card.appendChild(detailsEl);
        }
        charList.appendChild(card);
      }
      slot.appendChild(charList);
      return slot;
    };
    const rerenderCharList = (options) => {
      const prevBodyScroll = this.readTabScrollTop();
      const prevCharList = listSlotEl.querySelector('[data-scroll-id="library-char-list"]');
      const prevListScroll = options?.resetListScroll ? 0 : prevCharList && typeof prevCharList.scrollTop === "number" ? Math.max(0, prevCharList.scrollTop) : this.innerScrollTops.get("library-char-list") ?? 0;
      const nextSlot = buildCharListSlot();
      listSlotEl.replaceWith(nextSlot);
      listSlotEl = nextSlot;
      this.innerScrollTops.set("library-char-list", prevListScroll);
      const nextCharList = nextSlot.querySelector('[data-scroll-id="library-char-list"]');
      if (nextCharList) {
        nextCharList.scrollTop = prevListScroll;
      }
      this.applyTabScrollTop(prevBodyScroll);
    };
    const secRow = document.createElement("div");
    secRow.className = "ml-pill-row";
    for (const sec of ALL_MEDIA_SECTIONS) {
      const selected = this.librarySelectedSections.has(sec);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `ml-pill ${selected ? "is-selected" : ""}`;
      pill.textContent = SECTION_LABELS[sec];
      pill.addEventListener("click", () => {
        if (this.librarySelectedSections.has(sec)) {
          this.librarySelectedSections.delete(sec);
          pill.classList.remove("is-selected");
        } else {
          this.librarySelectedSections.add(sec);
          pill.classList.add("is-selected");
        }
        updateSummaryAndFooter();
      });
      secRow.appendChild(pill);
    }
    filterSection.appendChild(secRow);
    body.appendChild(filterSection);
    const charsSection = document.createElement("div");
    charsSection.className = "ml-section";
    const charHeader = document.createElement("div");
    charHeader.className = "ml-batch-char-header";
    charHeaderTitle = document.createElement("span");
    charHeaderTitle.className = "ml-section-title";
    const charStep = document.createElement("span");
    charStep.className = "ml-step-num";
    charStep.textContent = "2";
    charHeaderText = document.createElement("span");
    charHeaderTitle.append(charStep, charHeaderText);
    updateHeaderSummary();
    const charHeaderBtns = document.createElement("div");
    charHeaderBtns.className = "ml-header-actions";
    const onlyRemoteLabel = document.createElement("label");
    onlyRemoteLabel.className = "ml-toggle-label";
    onlyRemoteLabel.style.textTransform = "none";
    const onlyRemoteCb = document.createElement("input");
    onlyRemoteCb.type = "checkbox";
    onlyRemoteCb.checked = this.libraryOnlyWithRemote;
    onlyRemoteCb.addEventListener("change", () => {
      if (onlyRemoteCb.checked === this.libraryOnlyWithRemote)
        return;
      this.libraryOnlyWithRemote = onlyRemoteCb.checked;
      this.libraryPage = 1;
      rerenderCharList({ resetListScroll: true });
      updateSummaryAndFooter();
    });
    onlyRemoteLabel.append(onlyRemoteCb, document.createTextNode("Remote only"));
    const selAllBtn = document.createElement("button");
    selAllBtn.type = "button";
    selAllBtn.className = "ml-btn is-sm";
    selAllBtn.textContent = "Select All";
    selAllBtn.addEventListener("click", () => {
      for (const c of this.librarySummaries ?? []) {
        if (!this.libraryOnlyWithRemote || c.remoteCount + c.failedCount > 0) {
          this.librarySelectedCharIds.add(c.characterId);
          const cb = cardCheckboxes.get(c.characterId);
          if (cb)
            cb.checked = true;
          cardElements.get(c.characterId)?.classList.add("is-selected");
        }
      }
      updateSummaryAndFooter();
    });
    const clearAllBtn = document.createElement("button");
    clearAllBtn.type = "button";
    clearAllBtn.className = "ml-btn is-sm";
    clearAllBtn.textContent = "Clear";
    clearAllBtn.addEventListener("click", () => {
      this.librarySelectedCharIds.clear();
      for (const cb of cardCheckboxes.values()) {
        cb.checked = false;
      }
      for (const card of cardElements.values()) {
        card.classList.remove("is-selected");
      }
      updateSummaryAndFooter();
    });
    charHeaderBtns.append(onlyRemoteLabel, selAllBtn, clearAllBtn);
    charHeader.append(charHeaderTitle, charHeaderBtns);
    charsSection.appendChild(charHeader);
    listSlotEl = buildCharListSlot();
    charsSection.appendChild(listSlotEl);
    footerSlotEl = buildFooter();
    charsSection.appendChild(footerSlotEl);
    body.appendChild(charsSection);
  }
  renderSettingsTab(body) {
    const statsSection = document.createElement("div");
    statsSection.className = "ml-section";
    const statsRow = document.createElement("div");
    statsRow.className = "ml-header-bar";
    const statsLeft = document.createElement("div");
    statsLeft.className = "ml-inline-stats";
    const statsTitle = document.createElement("span");
    statsTitle.className = "ml-section-title";
    const statsTitleText = document.createElement("span");
    statsTitleText.textContent = "Localized Cache Summary";
    statsTitle.append(createIcon("database", 14), statsTitleText);
    const statsStrip = document.createElement("div");
    statsStrip.className = "ml-stat-strip";
    const addStatChip = (label, variant) => {
      const chip = document.createElement("span");
      chip.className = `ml-stat-chip ${variant}`;
      chip.textContent = label;
      statsStrip.appendChild(chip);
    };
    addStatChip(`${this.stats.totalAssets} URLs`, "is-info");
    addStatChip(formatBytes(this.stats.totalSizeBytes), "is-muted");
    addStatChip(`${this.stats.totalFailedUrls} failed`, this.stats.totalFailedUrls > 0 ? "is-danger" : "is-muted");
    statsLeft.append(statsTitle, statsStrip);
    const clearFailedBtn = createIconButton({
      icon: "trash",
      label: `Clear Failed (${this.stats.totalFailedUrls})`,
      title: "Clear all recorded failed download URLs",
      className: "ml-btn is-sm",
      size: 12,
      disabled: this.stats.totalFailedUrls === 0,
      onClick: async () => {
        const mountGen = this.mountGen;
        await this.guard(async () => {
          await this.callbacks.onClearFailed();
          this.invalidateCharacterCache();
          if (this.librarySummaries !== null) {
            this.librarySummariesStale = true;
          }
        }, "settings");
        if (this.activeTab === "settings" && this.bodyEl && this.mountGen === mountGen) {
          this.renderBody();
        }
      }
    });
    statsRow.append(statsLeft, clearFailedBtn);
    statsSection.appendChild(statsRow);
    body.appendChild(statsSection);
    const displaySection = document.createElement("div");
    displaySection.className = "ml-section";
    const displayTitleRow = document.createElement("div");
    displayTitleRow.className = "ml-section-title";
    const displayTitleLeft = document.createElement("div");
    displayTitleLeft.className = "ml-inline-title";
    const displayTitleText = document.createElement("span");
    displayTitleText.textContent = "Display & Thumbnails";
    displayTitleLeft.append(createIcon("image", 14), displayTitleText, createInfoTip("Choose Small (S), Medium (M), or Large (L) thumbnail presets independently for Gallery and Character Media views. Large also loads higher-resolution thumbnails for local images."));
    displayTitleRow.appendChild(displayTitleLeft);
    displaySection.appendChild(displayTitleRow);
    const displayGrid = document.createElement("div");
    displayGrid.className = "ml-check-grid";
    const addThumbSizeCard = (label, control) => {
      const card = document.createElement("div");
      card.className = "ml-check-card";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      card.append(lbl, control);
      displayGrid.appendChild(card);
    };
    addThumbSizeCard("Gallery Thumbnails", createThumbnailSizeSegmented(this.galleryState.thumbnailSize, (nextSize) => {
      this.galleryState = {
        ...this.galleryState,
        thumbnailSize: nextSize
      };
      savePrefsToStorage(GALLERY_PREFS_STORAGE_KEY, sanitizeGalleryPreferences(this.galleryState));
    }));
    addThumbSizeCard("Character Media Thumbnails", createThumbnailSizeSegmented(this.characterUiState.thumbnailSize, (nextSize) => {
      this.characterUiState = {
        ...this.characterUiState,
        thumbnailSize: nextSize
      };
      savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, sanitizeCharacterPreferences(this.characterUiState, true));
      this.characterWidget?.applySharedPreferences({ thumbnailSize: nextSize });
      this.options?.onCharacterPrefsUpdated?.();
    }));
    displaySection.appendChild(displayGrid);
    body.appendChild(displaySection);
    const defaultsSection = document.createElement("div");
    defaultsSection.className = "ml-section";
    const defTitleRow = document.createElement("div");
    defTitleRow.className = "ml-section-title";
    const defTitleLeft = document.createElement("div");
    defTitleLeft.className = "ml-inline-title";
    const defTitleText = document.createElement("span");
    defTitleText.textContent = "Global Download Defaults";
    defTitleLeft.append(createIcon("sliders", 14), defTitleText, createInfoTip("Used by the one-click Localize button across Character tabs and Portrait Panel unless a card defines Custom overrides."));
    defTitleRow.appendChild(defTitleLeft);
    defaultsSection.appendChild(defTitleRow);
    const sharedState = {
      sections: new Set(this.settings.defaultSections),
      mediaKinds: new Set(this.settings.defaultMediaKinds),
      includeFailed: this.settings.defaultIncludeFailed,
      batchCap: this.settings.defaultBatchCap
    };
    defaultsSection.appendChild(renderSharedDownloadConfigControls({
      state: sharedState,
      sectionTip: "Default card sections included for one-click media localization.",
      onChange: () => {
        this.guard(() => this.callbacks.onUpdateSettings({
          defaultSections: Array.from(sharedState.sections),
          defaultMediaKinds: Array.from(sharedState.mediaKinds),
          defaultIncludeFailed: sharedState.includeFailed,
          defaultBatchCap: sharedState.batchCap
        }), "settings");
      }
    }));
    body.appendChild(defaultsSection);
    const formSection = document.createElement("div");
    formSection.className = "ml-section";
    const formTitle = document.createElement("div");
    formTitle.className = "ml-section-title";
    const formTitleText = document.createElement("span");
    formTitleText.textContent = "Automation & Guardrails";
    formTitle.append(createIcon("shield", 14), formTitleText);
    formSection.appendChild(formTitle);
    const toggleGrid = document.createElement("div");
    toggleGrid.className = "ml-setting-toggle-grid";
    const addToggleSetting = (label, tip, key, isCaution = false) => {
      const row = document.createElement("div");
      row.className = isCaution ? "ml-setting-toggle-row is-caution" : "ml-setting-toggle-row";
      const lbl = document.createElement("label");
      lbl.className = "ml-toggle-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.settings[key];
      cb.addEventListener("change", () => {
        this.guard(() => this.callbacks.onUpdateSettings({ [key]: cb.checked }), "settings");
      });
      lbl.append(cb, document.createTextNode(label));
      row.append(lbl, createInfoTip(tip));
      toggleGrid.appendChild(row);
    };
    addToggleSetting("Auto-localize on character open", "Automatically runs one-click localization once per character when opening a chat, obeying global or custom defaults.", "autoLocalizeOnOpen");
    addToggleSetting("Detect bare media URLs", "Also scan bare http/https image & video URLs in addition to Markdown, HTML, and CSS tags.", "scanBareUrls");
    addToggleSetting("Sync localized assets to native Gallery & Portrait Panel", "Automatically adds downloaded images into Lumiverse's Character Gallery and Portrait Panel.", "autoLinkGallery");
    addToggleSetting("Adopt matching images already in native Gallery", "Reuses existing Character Gallery images that match a card URL instead of re-downloading.", "adoptNativeGalleryImages");
    addToggleSetting("Delete images from native Gallery & storage when purging", "When off, removing localized media only unlinks it from Media Localizer while keeping Gallery items.", "deleteImagesOnPurge", true);
    formSection.appendChild(toggleGrid);
    const limitsLabel = document.createElement("div");
    limitsLabel.className = "ml-subsection-label";
    limitsLabel.textContent = "Queue & Safety Limits";
    formSection.appendChild(limitsLabel);
    const numGrid = document.createElement("div");
    numGrid.className = "ml-check-grid";
    const addNumberSetting = (label, value, min, max, onChange) => {
      const card = document.createElement("div");
      card.className = "ml-check-card";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "ml-input-num";
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
      input.addEventListener("change", () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed)) {
          onChange(Math.min(max, Math.max(min, Math.floor(parsed))));
        }
      });
      card.append(lbl, input);
      numGrid.appendChild(card);
    };
    addNumberSetting("Confirm Above Count", this.settings.confirmThreshold, 1, 500, (v) => void this.guard(() => this.callbacks.onUpdateSettings({ confirmThreshold: v }), "settings"));
    addNumberSetting("Max File Size (MB)", this.settings.maxFileSizeMb, 1, 200, (v) => void this.guard(() => this.callbacks.onUpdateSettings({ maxFileSizeMb: v }), "settings"));
    addNumberSetting("Timeout per File (s)", this.settings.timeoutSeconds, 5, 120, (v) => void this.guard(() => this.callbacks.onUpdateSettings({ timeoutSeconds: v }), "settings"));
    addNumberSetting("Concurrent Downloads", this.settings.concurrency, 1, 5, (v) => void this.guard(() => this.callbacks.onUpdateSettings({ concurrency: v }), "settings"));
    formSection.appendChild(numGrid);
    body.appendChild(formSection);
  }
}

// src/ui/gallery-integrator.ts
var DOM_WAIT_TIMEOUT_MS = 1e4;

class NativeGalleryTabIntegrator {
  ctx;
  settings;
  queueProgress;
  callbacks;
  options;
  unsubscribeEditor = null;
  domWaitObserver = null;
  domWaitTimer = null;
  galleryContentObserver = null;
  galleryRefreshTimer = null;
  lastKnownGalleryCardCount = -1;
  pendingExternalRefreshWhileQueueActive = false;
  hostEl = null;
  mountedTabEl = null;
  widget = null;
  stopped = false;
  currentState = {
    open: false,
    characterId: null,
    activeTabId: null,
    extensions: {}
  };
  constructor(ctx, settings, queueProgress, callbacks, options = {}) {
    this.ctx = ctx;
    this.settings = settings;
    this.queueProgress = queueProgress;
    this.callbacks = callbacks;
    this.options = options;
  }
  start() {
    this.stopped = false;
    if (this.unsubscribeEditor)
      return;
    const editorApi = this.ctx.ui?.characterEditor;
    if (!editorApi)
      return;
    try {
      this.currentState = editorApi.getState();
      this.handleEditorState(this.currentState);
      this.unsubscribeEditor = editorApi.onChange((state) => {
        if (this.stopped)
          return;
        this.currentState = state;
        this.handleEditorState(state);
      });
    } catch {}
  }
  stop() {
    this.stopped = true;
    if (this.unsubscribeEditor) {
      this.unsubscribeEditor();
      this.unsubscribeEditor = null;
    }
    this.disconnectDomWaitObserver();
    this.disconnectGalleryContentObserver();
    this.unmountHost();
  }
  updateExternalState(settings, queueProgress) {
    const wasActive = isQueueActiveStatus(this.queueProgress.status);
    const nowActive = isQueueActiveStatus(queueProgress.status);
    const shouldForceRefresh = wasActive && !nowActive && this.pendingExternalRefreshWhileQueueActive;
    this.settings = settings;
    this.queueProgress = queueProgress;
    if (wasActive && !nowActive) {
      this.pendingExternalRefreshWhileQueueActive = false;
    }
    if (this.stopped)
      return;
    this.widget?.updateExternalState(settings, queueProgress, shouldForceRefresh);
  }
  syncPreferencesFromStorage() {
    if (this.stopped || !this.widget)
      return;
    const prefs = loadPrefsFromStorage(CHARACTER_PREFS_STORAGE_KEY, (raw) => sanitizeCharacterPreferences(raw, false), () => getDefaultCharacterPreferences(false));
    this.widget.applySharedPreferences({
      thumbnailSize: prefs.thumbnailSize,
      mediaViewMode: prefs.mediaViewMode,
      mediaFilter: prefs.mediaFilter,
      showGreetingSubfilter: prefs.showGreetingSubfilter,
      showWorldBookSubfilter: prefs.showWorldBookSubfilter,
      showUrlPicker: prefs.showUrlPicker,
      showRemoteThumbnails: prefs.showRemoteThumbnails
    });
  }
  refreshActiveScan(characterId) {
    if (this.stopped || !this.widget)
      return;
    if (characterId && this.widget.getCharacterId() !== characterId)
      return;
    this.widget.refreshScan(true);
  }
  disconnectDomWaitObserver() {
    if (this.domWaitTimer !== null) {
      clearTimeout(this.domWaitTimer);
      this.domWaitTimer = null;
    }
    if (this.domWaitObserver) {
      this.domWaitObserver.disconnect();
      this.domWaitObserver = null;
    }
  }
  disconnectGalleryContentObserver() {
    if (this.galleryContentObserver) {
      this.galleryContentObserver.disconnect();
      this.galleryContentObserver = null;
    }
    if (this.galleryRefreshTimer !== null) {
      clearTimeout(this.galleryRefreshTimer);
      this.galleryRefreshTimer = null;
    }
    this.lastKnownGalleryCardCount = -1;
    this.pendingExternalRefreshWhileQueueActive = false;
  }
  unmountHost() {
    this.disconnectGalleryContentObserver();
    this.widget?.flushPendingOverrideSave();
    this.widget?.destroy();
    this.widget = null;
    if (this.mountedTabEl) {
      this.mountedTabEl.classList.remove("ml-gallery-tab-active");
      this.mountedTabEl = null;
    }
    if (this.hostEl && this.hostEl.parentElement) {
      this.hostEl.parentElement.removeChild(this.hostEl);
    }
    this.hostEl = null;
  }
  handleEditorState(state) {
    this.disconnectDomWaitObserver();
    if (this.stopped)
      return;
    if (!state.open || state.activeTabId !== "gallery" || !state.characterId) {
      this.unmountHost();
      return;
    }
    const characterId = state.characterId;
    if (this.tryMountIntoGalleryTab(characterId)) {
      return;
    }
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      this.domWaitObserver = new MutationObserver(() => {
        if (this.stopped) {
          this.disconnectDomWaitObserver();
          return;
        }
        if (this.currentState.open && this.currentState.activeTabId === "gallery" && this.currentState.characterId === characterId) {
          if (this.tryMountIntoGalleryTab(characterId)) {
            this.disconnectDomWaitObserver();
          }
        } else {
          this.disconnectDomWaitObserver();
        }
      });
      this.domWaitObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      this.domWaitTimer = setTimeout(() => {
        this.domWaitTimer = null;
        this.disconnectDomWaitObserver();
      }, DOM_WAIT_TIMEOUT_MS);
    }
  }
  tryMountIntoGalleryTab(characterId) {
    if (this.stopped || typeof document === "undefined")
      return false;
    const galleryTab = document.querySelector('[class*="galleryTab"]');
    if (!galleryTab)
      return false;
    if (this.hostEl && galleryTab.contains(this.hostEl) && this.widget) {
      this.widget.setCharacterId(characterId);
      return true;
    }
    this.unmountHost();
    const host = document.createElement("div");
    host.className = "ml-gallery-host is-embedded";
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Media Localizer");
    galleryTab.classList.add("ml-gallery-tab-active");
    galleryTab.appendChild(host);
    const storedPrefs = loadPrefsFromStorage(CHARACTER_PREFS_STORAGE_KEY, (raw) => sanitizeCharacterPreferences(raw, false), () => getDefaultCharacterPreferences(false));
    const widget = new CharacterMediaWidget(host, this.ctx, characterId, this.settings, this.queueProgress, this.callbacks, {
      inDrawer: false,
      defaultExpandConfig: false,
      defaultExpandDownloadedMedia: false,
      initialUiState: {
        ...storedPrefs,
        showDownloadConfig: false,
        showDownloadedMedia: false,
        expandedUrls: []
      },
      onUiStateChange: (state) => {
        const existing = loadPrefsFromStorage(CHARACTER_PREFS_STORAGE_KEY, (raw) => sanitizeCharacterPreferences(raw, true), () => getDefaultCharacterPreferences(true));
        const changed = existing.thumbnailSize !== state.thumbnailSize || existing.mediaViewMode !== state.mediaViewMode || existing.mediaFilter !== state.mediaFilter || existing.showGreetingSubfilter !== state.showGreetingSubfilter || existing.showWorldBookSubfilter !== state.showWorldBookSubfilter || existing.showUrlPicker !== state.showUrlPicker || existing.showRemoteThumbnails !== state.showRemoteThumbnails;
        if (!changed)
          return;
        savePrefsToStorage(CHARACTER_PREFS_STORAGE_KEY, {
          ...existing,
          thumbnailSize: state.thumbnailSize,
          mediaViewMode: state.mediaViewMode,
          mediaFilter: state.mediaFilter,
          showGreetingSubfilter: state.showGreetingSubfilter,
          showWorldBookSubfilter: state.showWorldBookSubfilter,
          showUrlPicker: state.showUrlPicker,
          showRemoteThumbnails: state.showRemoteThumbnails
        });
        this.options.onCharacterPrefsUpdated?.();
      }
    });
    this.mountedTabEl = galleryTab;
    this.hostEl = host;
    this.widget = widget;
    this.observeNativeGalleryChanges(galleryTab);
    widget.refreshScan();
    return true;
  }
  observeNativeGalleryChanges(galleryTab) {
    this.disconnectGalleryContentObserver();
    if (typeof MutationObserver === "undefined")
      return;
    const countCards = () => galleryTab.querySelectorAll('[class*="galleryItem"], [class*="galleryCard"]').length;
    this.lastKnownGalleryCardCount = countCards();
    this.galleryContentObserver = new MutationObserver((mutations) => {
      if (this.stopped)
        return;
      const hasExternalMutation = mutations.some((m) => !this.hostEl || !this.hostEl.contains(m.target));
      if (!hasExternalMutation)
        return;
      const nextCount = countCards();
      if (nextCount === this.lastKnownGalleryCardCount)
        return;
      this.lastKnownGalleryCardCount = nextCount;
      if (this.galleryRefreshTimer !== null) {
        clearTimeout(this.galleryRefreshTimer);
      }
      this.galleryRefreshTimer = setTimeout(() => {
        this.galleryRefreshTimer = null;
        if (this.stopped || !this.widget)
          return;
        if (isQueueActiveStatus(this.queueProgress.status)) {
          this.pendingExternalRefreshWhileQueueActive = true;
          return;
        }
        this.pendingExternalRefreshWhileQueueActive = false;
        this.widget.refreshScan(true);
      }, 600);
    });
    this.galleryContentObserver.observe(galleryTab, {
      childList: true,
      subtree: true
    });
  }
}

// src/ui/portrait-button.ts
var WRAP_CLASS = "ml-portrait-localize-wrap";
var BTN_CLASS = "ml-portrait-localize-btn";

class PortraitPanelLocalizeController {
  callbacks;
  observer = null;
  syncTimer = null;
  wrapEl = null;
  btnEl = null;
  busyStarting = false;
  lastQueueStatus = "idle";
  justCompleted = false;
  completedTimer = null;
  longPressTimer = null;
  longPressResetTimer = null;
  lastRenderKey = "";
  stopped = false;
  constructor(callbacks) {
    this.callbacks = callbacks;
  }
  start() {
    this.stopped = false;
    if (this.observer || typeof document === "undefined" || !document.body) {
      this.sync();
      return;
    }
    this.observer = new MutationObserver((mutations) => {
      if (this.stopped)
        return;
      if (mutations.some((m) => this.isRelevantMutation(m))) {
        this.scheduleSync();
      }
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    this.sync();
  }
  isRelevantMutation(m) {
    const target = m.target;
    if (this.wrapEl && this.wrapEl.contains(target)) {
      return false;
    }
    const targetEl = target && target.nodeType === 1 ? target : target?.parentElement ?? null;
    if (targetEl?.closest?.(".ml-gallery-host, .ml-drawer-root, .ml-lightbox-backdrop, .ml-portrait-localize-wrap")) {
      return false;
    }
    const mountedPanel = this.wrapEl?.parentElement ?? null;
    const isMountedConnected = Boolean(mountedPanel && mountedPanel.isConnected !== false);
    if (isMountedConnected && mountedPanel && (mountedPanel.contains(target) || target.contains?.(mountedPanel))) {
      return true;
    }
    if (targetEl?.closest?.('[class*="panelOuter"] [class*="panel"]')) {
      return true;
    }
    const nodeMayBePanel = (node) => {
      if (node.nodeType !== 1)
        return false;
      const el = node;
      if (el.classList?.contains(WRAP_CLASS))
        return true;
      if (el.matches?.('[class*="panelOuter"], [class*="panel"]'))
        return true;
      if (isMountedConnected)
        return false;
      return el.querySelector?.('[class*="panelOuter"] [class*="panel"]') !== null;
    };
    for (const node of Array.from(m.addedNodes)) {
      if (nodeMayBePanel(node))
        return true;
    }
    for (const node of Array.from(m.removedNodes)) {
      if (nodeMayBePanel(node))
        return true;
    }
    return false;
  }
  clearLongPress() {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (this.longPressResetTimer !== null) {
      clearTimeout(this.longPressResetTimer);
      this.longPressResetTimer = null;
    }
  }
  stop() {
    this.stopped = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.completedTimer !== null) {
      clearTimeout(this.completedTimer);
      this.completedTimer = null;
    }
    this.clearLongPress();
    this.wrapEl?.remove();
    this.wrapEl = null;
    this.btnEl = null;
    this.lastRenderKey = "";
  }
  update() {
    if (this.stopped)
      return;
    const q = this.callbacks.getQueueProgress();
    const wasActive = isQueueActiveStatus(this.lastQueueStatus);
    const nowActive = isQueueActiveStatus(q.status);
    this.lastQueueStatus = q.status;
    if (wasActive && !nowActive && q.succeededCount > 0) {
      this.justCompleted = true;
      if (this.completedTimer)
        clearTimeout(this.completedTimer);
      this.completedTimer = setTimeout(() => {
        this.completedTimer = null;
        if (this.stopped)
          return;
        this.justCompleted = false;
        this.renderButtonState();
      }, 2600);
    }
    this.sync();
  }
  scheduleSync() {
    if (this.stopped || this.syncTimer !== null)
      return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (!this.stopped) {
        this.sync();
      }
    }, 60);
  }
  ensureElements() {
    if (this.wrapEl && this.btnEl) {
      return this.btnEl;
    }
    this.lastRenderKey = "";
    const wrap = document.createElement("div");
    wrap.className = WRAP_CLASS;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    let longPressTriggered = false;
    btn.addEventListener("pointerdown", (ev) => {
      if (this.stopped)
        return;
      this.clearLongPress();
      longPressTriggered = false;
      if (ev.pointerType === "mouse" && ev.button !== 0)
        return;
      const charId = this.callbacks.getActiveCharacterId();
      if (!charId)
        return;
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        if (this.stopped)
          return;
        longPressTriggered = true;
        this.callbacks.onOpenCharacterTab(charId);
      }, 520);
    });
    const onPointerUp = () => {
      if (this.longPressTimer !== null) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (longPressTriggered) {
        if (this.longPressResetTimer !== null) {
          clearTimeout(this.longPressResetTimer);
        }
        this.longPressResetTimer = setTimeout(() => {
          this.longPressResetTimer = null;
          longPressTriggered = false;
        }, 0);
      }
    };
    const onAbortLongPress = () => {
      this.clearLongPress();
      longPressTriggered = false;
    };
    btn.addEventListener("pointerup", onPointerUp);
    btn.addEventListener("pointercancel", onAbortLongPress);
    btn.addEventListener("pointerleave", onAbortLongPress);
    btn.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.clearLongPress();
      longPressTriggered = false;
      if (this.stopped)
        return;
      const charId = this.callbacks.getActiveCharacterId();
      if (charId)
        this.callbacks.onOpenCharacterTab(charId);
    });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.longPressResetTimer !== null) {
        clearTimeout(this.longPressResetTimer);
        this.longPressResetTimer = null;
      }
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      if (this.stopped)
        return;
      const charId = this.callbacks.getActiveCharacterId();
      if (!charId || this.busyStarting)
        return;
      const q = this.callbacks.getQueueProgress();
      if (isQueueActiveStatus(q.status)) {
        this.callbacks.onOpenCharacterTab(charId);
        return;
      }
      if (this.callbacks.getPendingCount() <= 0)
        return;
      this.busyStarting = true;
      this.renderButtonState();
      this.callbacks.onLocalizeActiveCharacter(charId).finally(() => {
        this.busyStarting = false;
        if (!this.stopped) {
          this.renderButtonState();
        }
      });
    });
    wrap.appendChild(btn);
    this.wrapEl = wrap;
    this.btnEl = btn;
    return btn;
  }
  findTargetPortraitPanel() {
    const panels = Array.from(document.querySelectorAll('[class*="panelOuter"] [class*="panel"]'));
    if (panels.length === 0)
      return null;
    return panels.find((el) => el.offsetParent !== null || typeof el.getClientRects === "function" && el.getClientRects().length > 0) ?? panels[0] ?? null;
  }
  sync() {
    if (this.stopped || typeof document === "undefined")
      return;
    const panel = this.findTargetPortraitPanel();
    if (!panel) {
      return;
    }
    this.ensureElements();
    const wrap = this.wrapEl;
    const nameEl = panel.querySelector('[class*="name"]');
    if (nameEl && nameEl.parentElement === panel) {
      if (wrap.parentElement !== panel || nameEl.nextElementSibling !== wrap) {
        nameEl.after(wrap);
      }
    } else if (wrap.parentElement !== panel) {
      panel.appendChild(wrap);
    }
    this.renderButtonState();
  }
  renderButtonState() {
    const wrap = this.wrapEl;
    const btn = this.btnEl;
    if (!wrap || !btn || this.stopped)
      return;
    const charId = this.callbacks.getActiveCharacterId();
    const q = this.callbacks.getQueueProgress();
    const pending = this.callbacks.getPendingCount();
    const queueActive = isQueueActiveStatus(q.status);
    let nextKey = "hidden";
    if (charId) {
      if (queueActive) {
        nextKey = `running:${q.completedCount}:${q.totalQueued}`;
      } else if (this.busyStarting) {
        nextKey = "starting";
      } else if (pending > 0) {
        nextKey = `pending:${pending}`;
      } else if (this.justCompleted) {
        nextKey = "done";
      }
    }
    if (nextKey === this.lastRenderKey) {
      return;
    }
    this.lastRenderKey = nextKey;
    btn.innerHTML = "";
    btn.classList.remove("is-running", "is-done");
    if (!charId) {
      wrap.style.display = "none";
      return;
    }
    if (queueActive) {
      wrap.style.display = "flex";
      btn.classList.add("is-running");
      btn.appendChild(createIcon("download", 12));
      const label = document.createElement("span");
      label.textContent = `${q.completedCount}/${q.totalQueued}`;
      btn.appendChild(label);
      btn.title = "Localizing media... Click to open Media Localizer";
      return;
    }
    if (this.busyStarting) {
      wrap.style.display = "flex";
      btn.classList.add("is-running");
      btn.appendChild(createIcon("refresh", 12));
      const label = document.createElement("span");
      label.textContent = "Starting...";
      btn.appendChild(label);
      btn.title = "Starting localization queue...";
      return;
    }
    if (pending > 0) {
      wrap.style.display = "flex";
      btn.appendChild(createIcon("download", 12));
      const label = document.createElement("span");
      label.textContent = `Localize (${pending})`;
      btn.appendChild(label);
      btn.title = `Download ${pending} remote media file(s) · Right-click for options`;
      return;
    }
    if (this.justCompleted) {
      wrap.style.display = "flex";
      btn.classList.add("is-done");
      btn.appendChild(createIcon("check", 12));
      const label = document.createElement("span");
      label.textContent = "Localized";
      btn.appendChild(label);
      btn.title = "Media localization complete";
      return;
    }
    wrap.style.display = "none";
  }
}

// src/ui/styles.ts
var MEDIA_LOCALIZER_STYLES = `
/* Hide the rudimentary native 1-click "Import All" extract bar inside the Character Editor Gallery tab when Media Localizer is mounted */
.ml-gallery-tab-active > [class*="galleryExtract"] {
  display: none;
}

/* Allow the native galleryTab to scroll smoothly when the Media Localizer panel is expanded */
[class*="galleryTab"].ml-gallery-tab-active {
  overflow-y: auto;
}

/* Prevent the native gallery viewport from being squashed to 0px when Downloaded Media expands */
[class*="galleryTab"].ml-gallery-tab-active > [class*="galleryScrollArea"] {
  min-height: 180px;
}

.ml-gallery-host {
  margin-top: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
  line-height: 1.4;
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  overflow: visible;
  box-shadow: none;
}

.ml-gallery-host.is-embedded {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: transparent;
  box-shadow: none;
}

.ml-gallery-host.is-embedded .ml-widget,
.ml-widget.is-embedded {
  padding: 0;
}

.ml-drawer-root .ml-gallery-host {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

[data-spindle-drawer-tab]:has(> .ml-drawer-root) {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.ml-drawer-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
  line-height: 1.4;
  overflow: visible;
}

/* Focus & Native Control Accents */
.ml-drawer-root :focus-visible,
.ml-gallery-host :focus-visible,
.ml-lightbox-backdrop :focus-visible,
.ml-portrait-localize-wrap :focus-visible {
  outline: 1.5px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  outline-offset: 1px;
}

.ml-drawer-root input[type="checkbox"],
.ml-gallery-host input[type="checkbox"] {
  accent-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
}

/* Custom Thin Scrollbars */
.ml-drawer-body,
.ml-url-list,
.ml-subfilter-list,
.ml-asset-grid,
.ml-media-list {
  scrollbar-width: thin;
  scrollbar-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22)) transparent;
}

.ml-drawer-body::-webkit-scrollbar,
.ml-url-list::-webkit-scrollbar,
.ml-subfilter-list::-webkit-scrollbar,
.ml-asset-grid::-webkit-scrollbar,
.ml-media-list::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

.ml-drawer-body::-webkit-scrollbar-track,
.ml-url-list::-webkit-scrollbar-track,
.ml-subfilter-list::-webkit-scrollbar-track,
.ml-asset-grid::-webkit-scrollbar-track,
.ml-media-list::-webkit-scrollbar-track {
  background: transparent;
}

.ml-drawer-body::-webkit-scrollbar-thumb,
.ml-url-list::-webkit-scrollbar-thumb,
.ml-subfilter-list::-webkit-scrollbar-thumb,
.ml-asset-grid::-webkit-scrollbar-thumb,
.ml-media-list::-webkit-scrollbar-thumb {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-radius: 999px;
}

.ml-drawer-body::-webkit-scrollbar-thumb:hover,
.ml-url-list::-webkit-scrollbar-thumb:hover,
.ml-subfilter-list::-webkit-scrollbar-thumb:hover,
.ml-asset-grid::-webkit-scrollbar-thumb:hover,
.ml-media-list::-webkit-scrollbar-thumb:hover {
  background: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.5));
}

/* Segmented Drawer Navigation */
.ml-drawer-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.18));
  flex-shrink: 0;
}

.ml-drawer-nav-btn {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-drawer-nav-btn:hover {
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
}

.ml-drawer-nav-btn.is-active {
  color: var(--lumiverse-text, #ffffff);
  font-weight: 600;
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 1px 4px rgba(0, 0, 0, 0.2);
}

.ml-drawer-nav-btn.is-active .ml-icon {
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.95));
}

.ml-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ml-widget {
  --ml-char-card-min: 104px;
  --ml-asset-tile-min: 98px;
  --ml-gallery-tile-min: 96px;
  --ml-asset-thumb-height: 78px;
  --ml-asset-grid-max-height: 260px;
  --ml-list-thumb-size: 34px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 8px;
}

.ml-widget.is-thumb-sm {
  --ml-char-card-min: 76px;
  --ml-asset-tile-min: 74px;
  --ml-gallery-tile-min: 72px;
  --ml-asset-thumb-height: 58px;
  --ml-asset-grid-max-height: 240px;
  --ml-list-thumb-size: 26px;
}

.ml-widget.is-thumb-md {
  --ml-char-card-min: 104px;
  --ml-asset-tile-min: 98px;
  --ml-gallery-tile-min: 96px;
  --ml-asset-thumb-height: 78px;
  --ml-asset-grid-max-height: 260px;
  --ml-list-thumb-size: 34px;
}

.ml-widget.is-thumb-lg {
  --ml-char-card-min: 148px;
  --ml-asset-tile-min: 142px;
  --ml-gallery-tile-min: 140px;
  --ml-asset-thumb-height: 116px;
  --ml-asset-grid-max-height: 320px;
  --ml-list-thumb-size: 48px;
}

.ml-drawer-root .ml-widget,
.ml-widget.is-drawer {
  padding: 0;
  gap: 8px;
}

.ml-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
  flex-wrap: wrap;
}

.ml-compact-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.ml-inline-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 11.5px;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
}

.ml-subtitle {
  font-size: 11px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

/* Badges & Status Indicators */
.ml-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.35;
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  font-variant-numeric: tabular-nums;
}

.ml-badge.is-success,
.ml-badge.is-local {
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.16));
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.35));
  color: #4ade80;
}

.ml-badge.is-warn,
.ml-badge.is-remote {
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.16));
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.35));
  color: #fbbf24;
}

.ml-badge.is-danger,
.ml-badge.is-failed {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.16));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.38));
  color: #f87171;
}

.ml-badge.is-info {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.18));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.38));
  color: var(--lumiverse-primary-text, #c4b5fd);
}

.ml-badge.is-muted {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  border-color: var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-badge.is-type {
  background: var(--lumiverse-fill-medium, rgba(0, 0, 0, 0.25));
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.78));
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 9.5px;
}

.ml-stat-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.ml-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-fill, rgba(0, 0, 0, 0.18));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  font-size: 10.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.ml-stat-chip.is-success {
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.14));
  border-color: rgba(34, 197, 94, 0.28);
  color: #4ade80;
}

.ml-stat-chip.is-warn {
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.14));
  border-color: rgba(245, 158, 11, 0.28);
  color: #fbbf24;
}

.ml-stat-chip.is-danger {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14));
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.ml-stat-chip.is-info {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.15));
  border-color: rgba(147, 112, 219, 0.32);
  color: var(--lumiverse-primary-text, #c4b5fd);
}

.ml-stat-chip.is-muted {
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.62));
}

.ml-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
  display: inline-block;
  background: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.4));
}

.ml-status-dot.is-success {
  background: var(--lumiverse-success, #22c55e);
  box-shadow: 0 0 6px var(--lumiverse-success-050, rgba(34, 197, 94, 0.5));
}

.ml-status-dot.is-warn {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 6px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.5));
}

.ml-status-dot.is-danger {
  background: var(--lumiverse-danger, #ef4444);
  box-shadow: 0 0 6px var(--lumiverse-danger-050, rgba(239, 68, 68, 0.5));
}

.ml-status-dot.is-muted {
  background: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.35));
}

/* Button Hierarchy */
.ml-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    transform 100ms ease,
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-btn:hover:not(:disabled) {
  background: var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.12));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.32));
}

.ml-btn:active:not(:disabled) {
  transform: translateY(0.5px);
}

.ml-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ml-btn.is-primary {
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  color: #ffffff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 1px 4px rgba(0, 0, 0, 0.25);
}

.ml-btn.is-primary:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, rgba(167, 132, 239, 0.95));
  border-color: var(--lumiverse-primary-hover, rgba(167, 132, 239, 0.95));
}

.ml-btn.is-danger {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.15));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.4));
  color: #fca5a5;
}

.ml-btn.is-danger:hover:not(:disabled) {
  background: var(--lumiverse-danger-020, rgba(239, 68, 68, 0.26));
  border-color: var(--lumiverse-danger, #ef4444);
  color: #fecaca;
}

.ml-btn.is-active {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.24));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  color: var(--lumiverse-text, #ffffff);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ml-btn.is-sm {
  padding: 2.5px 6.5px;
  font-size: 11px;
}

.ml-btn.is-xs {
  padding: 1.5px 5px;
  font-size: 10px;
}

.ml-icon-btn {
  padding: 3px 5px;
}

.ml-icon-btn.is-sm {
  padding: 2px 4px;
}

.ml-icon {
  display: block;
  flex-shrink: 0;
}

@keyframes ml-spin {
  to {
    transform: rotate(360deg);
  }
}

.ml-btn.is-busy .ml-icon {
  animation: ml-spin 0.9s linear infinite;
}

/* Segmented Control Wrapper */
.ml-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.28));
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-segmented .ml-btn {
  border-color: transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  box-shadow: none;
}

.ml-segmented .ml-btn:hover:not(:disabled) {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
}

.ml-segmented .ml-btn.is-active {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.24));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  color: var(--lumiverse-text, #ffffff);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ml-thumb-size-segmented {
  flex-shrink: 0;
}

.ml-thumb-size-segmented .ml-btn {
  min-width: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.ml-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
}

/* Flat Borderless Flow Sections */
.ml-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.ml-section + .ml-section {
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-subsection-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.45));
  padding-top: 4px;
  margin-top: 2px;
  border-top: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
}

.ml-batch-char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  flex-wrap: wrap;
}

.ml-check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 155px), 1fr));
  gap: 5px;
}

.ml-check-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  font-size: 11.5px;
  min-width: 0;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-check-card:hover {
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.22));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
}

.ml-check-card-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-check-card-left > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-subfilter-box {
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ml-subfilter-list {
  max-height: 130px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 145px), 1fr));
  gap: 3px 6px;
}

/* Filter Pills */
.ml-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ml-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2.5px 8px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.78));
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-pill:hover {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.09));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-text, #ffffff);
}

.ml-pill.is-selected {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  color: var(--lumiverse-text, #ffffff);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ml-pill.is-video.is-selected {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.48);
  color: #bae6fd;
}

.ml-pill.is-expression.is-selected {
  background: rgba(244, 114, 182, 0.18);
  border-color: rgba(244, 114, 182, 0.48);
  color: #fbcfe8;
}

.ml-pill.is-avatar.is-selected {
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.18));
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.48));
  color: #bbf7d0;
}

.ml-pill.is-image.is-selected {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  color: var(--lumiverse-primary-text, #e9d5ff);
}

/* URL & Batch Lists */
.ml-url-list {
  max-height: clamp(210px, 42vh, 420px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}

.ml-url-list.is-tall {
  max-height: clamp(240px, 56vh, 600px);
}

.ml-url-item-card,
.ml-lib-item-card {
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-url-item-card:hover,
.ml-lib-item-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.25));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
}

.ml-url-item-card.is-expanded,
.ml-lib-item-card.is-expanded {
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.07));
}

.ml-lib-item-card.is-selected {
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.08));
}

.ml-url-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
}

.ml-row-checkbox {
  cursor: pointer;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin: 0;
}

.ml-url-thumb {
  width: 28px;
  height: 28px;
  border-radius: 5px;
  object-fit: cover;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.4));
  flex-shrink: 0;
}

.ml-url-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ml-url-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: var(--lumiverse-font-mono, monospace);
  font-size: 11px;
}

.ml-url-sources {
  font-size: 10.5px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.75));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
}

.ml-kind-chip.is-image {
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.14));
  border-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-primary-text, #d8b4fe);
}

.ml-kind-chip.is-video {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.3);
  color: #7dd3fc;
}

.ml-kind-chip.is-failed {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.16));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.38));
  color: #fca5a5;
}

.ml-expand-hint {
  font-size: 10.5px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  flex-shrink: 0;
}

.ml-item-details {
  padding: 6px 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.28));
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}

.ml-detail-top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.ml-detail-preview-box {
  width: 88px;
  min-height: 58px;
  max-height: 104px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: var(--lumiverse-bg-deep, rgba(10, 8, 18, 0.8));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
}

.ml-detail-preview-media {
  max-width: 88px;
  max-height: 88px;
  object-fit: contain;
  display: block;
  cursor: pointer;
}

.ml-detail-preview-caption {
  font-size: 10px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  padding: 2px 4px;
  text-align: center;
  width: 100%;
  background: rgba(0, 0, 0, 0.55);
}

.ml-detail-info-col {
  flex: 1;
  min-width: min(100%, 140px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ml-detail-url-box {
  font-family: var(--lumiverse-font-mono, monospace);
  font-size: 10.5px;
  word-break: break-all;
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--lumiverse-bg-deep, rgba(10, 8, 18, 0.65));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text, #f8fafc);
  user-select: text;
}

.ml-detail-kv-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.ml-detail-source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.ml-detail-source-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.88));
}

.ml-detail-error-box {
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14));
  border: 1px solid var(--lumiverse-danger-050, rgba(239, 68, 68, 0.35));
  color: #fca5a5;
  font-size: 10.5px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ml-download-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 5px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
}

/* Inputs & Selects */
.ml-select {
  padding: 3.5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-bg-deep, rgba(10, 8, 18, 0.85));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-select:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.35));
}

.ml-select:focus {
  outline: none;
  border-color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-010, rgba(147, 112, 219, 0.12));
}

.ml-input-num {
  width: 58px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill, rgba(0, 0, 0, 0.2)));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: inherit;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-input-num:focus {
  outline: none;
  border-color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-010, rgba(147, 112, 219, 0.12));
}

.ml-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 120px;
  min-width: 100px;
}

.ml-input-icon {
  position: absolute;
  left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.45));
  pointer-events: none;
}

.ml-input-text {
  flex: 1;
  min-width: min(100%, 100px);
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill, rgba(0, 0, 0, 0.2)));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: inherit;
  font-size: 11.5px;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-input-text.has-icon {
  padding-left: 26px;
}

.ml-input-text::placeholder {
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.4));
}

.ml-input-text:focus {
  outline: none;
  border-color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-010, rgba(147, 112, 219, 0.14));
}

/* Active Queue Banner & Progress */
@keyframes ml-progress-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.ml-queue-banner {
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  background: linear-gradient(
    180deg,
    var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16)) 0%,
    var(--lumiverse-primary-010, rgba(147, 112, 219, 0.08)) 100%
  );
  border-radius: var(--lumiverse-radius, 8px);
  padding: 7px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  box-shadow: var(--lumiverse-highlight-inset, inset 0 1px 0 rgba(255, 255, 255, 0.08));
}

.ml-queue-banner.is-paused {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.45));
  background: linear-gradient(
    180deg,
    var(--lumiverse-warning-015, rgba(245, 158, 11, 0.14)) 0%,
    rgba(245, 158, 11, 0.06) 100%
  );
}

.ml-queue-banner.is-cancelling {
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.45));
  background: linear-gradient(
    180deg,
    var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14)) 0%,
    rgba(239, 68, 68, 0.06) 100%
  );
}

.ml-queue-status-text {
  font-weight: 600;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--lumiverse-text, #ffffff);
}

.ml-progress-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.35));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  overflow: hidden;
}

.ml-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  transition: width 0.25s ease;
}

.ml-progress-fill.is-active {
  background: linear-gradient(
    90deg,
    var(--lumiverse-primary, rgba(147, 112, 219, 0.9)) 0%,
    var(--lumiverse-primary-hover, rgba(186, 135, 255, 0.98)) 50%,
    var(--lumiverse-primary, rgba(147, 112, 219, 0.9)) 100%
  );
  background-size: 200% 100%;
  animation: ml-progress-shimmer 2.2s linear infinite;
}

.ml-queue-banner.is-paused .ml-progress-fill {
  background: var(--lumiverse-warning, #f59e0b);
}

.ml-queue-banner.is-cancelling .ml-progress-fill {
  background: var(--lumiverse-danger, #ef4444);
}

.ml-mini-progress {
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.32));
  overflow: hidden;
}

.ml-mini-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--lumiverse-success, #22c55e) 0%,
    #4ade80 100%
  );
  transition: width 0.25s ease;
}

/* Asset Grid & Cards */
.ml-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ml-asset-tile-min, 98px)), 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  gap: 6px;
  max-height: var(--ml-asset-grid-max-height, 260px);
  overflow-y: auto;
  flex-shrink: 0;
  min-width: 0;
  padding: 1px;
}

.ml-asset-card {
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  border-radius: 7px;
  background: var(--lumiverse-bg-dark, rgba(0, 0, 0, 0.25));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: max-content;
  contain: layout paint style;
  transition:
    transform var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-asset-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.35));
  box-shadow: var(--lumiverse-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.25));
}

.ml-asset-preview {
  display: block;
  width: 100%;
  height: var(--ml-asset-thumb-height, 78px);
  object-fit: cover;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.4));
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-asset-card:hover .ml-asset-preview {
  transform: scale(1.04);
}

.ml-asset-footer {
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  min-width: 0;
  font-size: 10px;
  border-top: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.06));
}

.ml-lib-intro {
  font-size: 11px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.68));
  line-height: 1.4;
}

.ml-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.4));
  color: var(--lumiverse-primary-text, #e9d5ff);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.ml-lib-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 5px 7px;
  cursor: pointer;
  user-select: none;
}

.ml-lib-char-name {
  font-weight: 600;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-lib-row .ml-header-actions {
  flex-shrink: 0;
}

.ml-drawer-sticky-banner {
  padding: 6px 10px 0;
  flex-shrink: 0;
}

.ml-drawer-sticky-banner:empty {
  display: none;
}

.ml-inline-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ml-title {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
}

.ml-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml-config-label-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ml-config-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-checkbox-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
}

.ml-checkbox-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  cursor: pointer;
  user-select: none;
}

.ml-setting-toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 4px 8px;
}

.ml-setting-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.025));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.07));
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-setting-toggle-row:hover {
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.04));
}

.ml-setting-toggle-row.is-caution {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.06);
}

.ml-setting-toggle-row.is-caution:hover {
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.42));
}

.ml-select.is-sm {
  padding: 2px 5px;
  font-size: 11px;
}

/* Banners & Empty States */
.ml-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14));
  border: 1px solid var(--lumiverse-danger-050, rgba(239, 68, 68, 0.35));
  color: #fca5a5;
  font-size: 11.5px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ml-warn-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.12));
  border: 1px solid var(--lumiverse-warning-050, rgba(245, 158, 11, 0.3));
  color: #fcd34d;
  font-size: 11px;
}

.ml-error-banner .ml-icon,
.ml-warn-banner .ml-icon {
  margin-top: 1px;
}

.ml-empty {
  text-align: center;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.62));
  padding: 12px 10px;
  font-size: 11.5px;
}

.ml-empty-card,
.ml-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px 12px;
  border: none;
  background: transparent;
}

.ml-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.12));
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.85));
}

.ml-loading-card .ml-empty-icon .ml-icon {
  animation: ml-spin 1.2s linear infinite;
}

.ml-empty-text {
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  max-width: 280px;
  line-height: 1.4;
}

/* Info tooltips (hover + click popover for mobile) */
.ml-tip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.ml-tip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.6));
  cursor: pointer;
  opacity: 0.8;
  transition: opacity var(--lumiverse-transition-fast, 150ms ease), color var(--lumiverse-transition-fast, 150ms ease), background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-tip-btn:hover,
.ml-tip-wrap.is-open .ml-tip-btn {
  opacity: 1;
  color: var(--lumiverse-text, #f8fafc);
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.1));
}

.ml-tip-popover {
  display: none;
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  width: max-content;
  max-width: min(240px, 65vw);
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--lumiverse-bg-elevated, rgba(24, 20, 34, 0.97));
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.28));
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 11px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  line-height: 1.4;
  white-space: normal;
  box-shadow: var(--lumiverse-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(8px);
  z-index: 40;
  pointer-events: none;
}

.ml-tip-wrap:hover .ml-tip-popover,
.ml-tip-wrap.is-open .ml-tip-popover {
  display: block;
}

.ml-tip-wrap.is-open .ml-tip-popover {
  pointer-events: auto;
}

.ml-setting-toggle-row .ml-tip-popover,
.ml-header-bar > .ml-tip-wrap:last-child .ml-tip-popover,
.ml-combined-bar .ml-tip-popover,
.ml-checkbox-item:last-child .ml-tip-popover,
.ml-tip-wrap.is-align-right .ml-tip-popover {
  left: auto;
  right: 0;
}

/* Active Character Header */
.ml-char-header {
  gap: 6px;
}

.ml-char-identity {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ml-char-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.26));
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
}

.ml-char-avatar-fallback {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.22));
  background: var(--lumiverse-card-image-bg, linear-gradient(135deg, rgba(20, 17, 28, 1) 0%, rgba(36, 26, 54, 1) 100%));
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.9));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
  user-select: none;
}

.ml-char-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ml-char-name {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* Combined Character Options & Downloaded Media Bar */
.ml-combined-drawer {
  gap: 6px;
}

.ml-combined-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ml-combined-trigger {
  flex: 1 1 110px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.78));
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-combined-trigger:hover {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.94));
}

.ml-combined-trigger.is-active {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  color: var(--lumiverse-text, #ffffff);
  font-weight: 600;
}

.ml-combined-trigger > span:not(.ml-badge) {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.ml-combined-pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-top: 2px;
}

.ml-combined-pane + .ml-combined-pane {
  padding-top: 8px;
  margin-top: 2px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-options-panel {
  gap: 6px;
}

.ml-media-pane {
  gap: 6px;
}

.ml-media-toolbar {
  gap: 5px;
}

/* Failed Items Recovery Panel */
.ml-failed-panel {
  border-top-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.32));
}

.ml-failed-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ml-failed-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #fca5a5;
}

.ml-failed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.28));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.07));
}

.ml-failed-url-col {
  flex: 1;
  min-width: 0;
}

/* Media Tiles & List View */
.ml-asset-thumb-wrap {
  position: relative;
  width: 100%;
  height: var(--ml-asset-thumb-height, 78px);
  min-height: var(--ml-asset-thumb-height, 78px);
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.42));
  cursor: pointer;
  overflow: hidden;
  contain: layout paint style;
}

.ml-asset-thumb-wrap .ml-asset-preview {
  height: 100%;
}

.ml-tile-badge {
  position: absolute;
  bottom: 4px;
  left: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  background: rgba(12, 10, 20, 0.88);
  color: #f1f5f9;
  border: 1px solid rgba(255, 255, 255, 0.16);
  pointer-events: none;
  z-index: 2;
}

.ml-tile-badge.is-info {
  background: rgba(124, 58, 237, 0.84);
  border-color: rgba(196, 181, 253, 0.35);
  color: #ffffff;
}

.ml-tile-badge.is-video {
  background: rgba(14, 116, 144, 0.86);
  border-color: rgba(125, 211, 252, 0.35);
  color: #e0f2fe;
}

.ml-tile-badge.is-expression {
  background: rgba(157, 23, 77, 0.84);
  border-color: rgba(249, 168, 212, 0.35);
  color: #fce7f3;
}

.ml-tile-badge.is-avatar {
  background: rgba(21, 128, 61, 0.84);
  border-color: rgba(134, 239, 172, 0.35);
  color: #dcfce7;
}

.ml-tile-badge.is-local {
  background: rgba(21, 128, 61, 0.84);
  border-color: rgba(134, 239, 172, 0.35);
  color: #dcfce7;
}

.ml-asset-cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.ml-asset-cap-row .ml-url-sources {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-media-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 460px;
  overflow-y: auto;
  flex-shrink: 0;
  min-width: 0;
}

.ml-media-list-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  min-width: 0;
  padding: 5px 7px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  cursor: pointer;
  contain: layout paint style;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-media-list-row:hover {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.28));
}

.ml-media-list-thumb-wrap {
  position: relative;
  width: var(--ml-list-thumb-size, 34px);
  height: var(--ml-list-thumb-size, 34px);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
}

.ml-media-list-thumb {
  width: var(--ml-list-thumb-size, 34px);
  height: var(--ml-list-thumb-size, 34px);
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
  display: block;
}

.ml-media-list-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lumiverse-card-image-bg, linear-gradient(135deg, rgba(20, 17, 28, 1) 0%, rgba(36, 26, 54, 1) 100%));
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.8));
  font-size: 12px;
  font-weight: 600;
}

.ml-media-list-kind-badge {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: rgba(10, 8, 18, 0.82);
  color: #e0f2fe;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* Whole-Library Gallery */
.ml-gallery-toolbar {
  padding: 0;
  gap: 5px;
}

.ml-gallery-content-slot {
  padding-left: 0;
  padding-right: 0;
  padding-bottom: 0;
  gap: 6px;
}

.ml-gallery-controls {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ml-gallery-controls .ml-input-text {
  min-width: 100px;
  flex: 1 1 120px;
}

.ml-sort-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ml-gallery-type-pills {
  margin-top: 0;
  gap: 4px;
}

.ml-gallery-drilldown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 6px;
  flex-wrap: wrap;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-gallery-drilldown-title {
  flex: 1 1 110px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ml-gallery-drilldown-avatar {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.28));
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
}

.ml-gallery-drilldown-name {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-drawer-root .ml-asset-grid,
.ml-drawer-root .ml-media-list,
.ml-gallery-grid {
  max-height: none;
  overflow-y: visible;
}

.ml-gallery-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ml-gallery-tile-min, 96px)), 1fr));
  gap: 6px;
}

.ml-gallery-grid .ml-asset-footer {
  padding: 3.5px 5px;
}

.ml-gallery-grid .ml-url-sources {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ml-char-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ml-char-card-min, 104px)), 1fr));
  gap: 6px;
}

.ml-char-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  border-radius: 9px;
  background: var(--lumiverse-card-bg, rgba(24, 20, 34, 0.92));
  color: inherit;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  contain: layout paint style;
  box-shadow: var(--lumiverse-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.22));
  transition:
    transform 0.16s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.16s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-char-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.45));
  transform: translateY(-2px);
  box-shadow:
    var(--lumiverse-shadow-md, 0 8px 20px rgba(0, 0, 0, 0.36)),
    0 0 0 1px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.2));
}

.ml-char-card-thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  background: var(--lumiverse-card-image-bg, linear-gradient(135deg, rgba(20, 17, 28, 1) 0%, rgba(28, 22, 40, 1) 100%));
  overflow: hidden;
  contain: layout paint style;
}

.ml-char-card-scrim {
  position: absolute;
  inset: auto 0 0 0;
  height: 52%;
  pointer-events: none;
  background: linear-gradient(
    to top,
    rgba(10, 8, 18, 0.94) 0%,
    rgba(10, 8, 18, 0.72) 45%,
    transparent 100%
  );
  z-index: 1;
}

.ml-char-card-badges {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  max-width: calc(100% - 30px);
  pointer-events: none;
}

.ml-char-card-badges .ml-tile-badge {
  position: static;
}

.ml-char-card-edit-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(10, 8, 18, 0.84);
  color: #f1f5f9;
  cursor: pointer;
  opacity: 0.72;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.ml-char-card:hover .ml-char-card-edit-btn,
.ml-char-card:focus-within .ml-char-card-edit-btn {
  opacity: 1;
}

.ml-char-card-edit-btn:hover {
  opacity: 1;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.92));
  border-color: rgba(255, 255, 255, 0.45);
  color: #ffffff;
}

.ml-char-card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-char-card:hover .ml-char-card-thumb {
  transform: scale(1.05);
}

.ml-char-card-placeholder {
  width: 100%;
  height: 100%;
  padding-bottom: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.65));
}

.ml-char-card-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
}

.ml-char-card-footer .ml-url-sources {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.76);
  font-size: 10px;
}

.ml-char-card-name {
  font-weight: 600;
  font-size: 11px;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-widget.is-thumb-sm .ml-char-card-badges {
  top: 3px;
  left: 3px;
  gap: 2px;
  max-width: calc(100% - 24px);
}

.ml-widget.is-thumb-sm .ml-tile-badge {
  bottom: 3px;
  left: 3px;
  padding: 1px 4px;
  font-size: 9px;
}

.ml-widget.is-thumb-sm .ml-char-card-edit-btn {
  top: 3px;
  right: 3px;
  width: 19px;
  height: 19px;
}

.ml-widget.is-thumb-sm .ml-char-card-footer {
  padding: 4px 5px;
}

.ml-widget.is-thumb-sm .ml-char-card-name {
  font-size: 10.5px;
}

.ml-widget.is-thumb-sm .ml-char-card-footer .ml-url-sources {
  font-size: 9.5px;
}

.ml-widget.is-thumb-sm .ml-media-list-kind-badge {
  width: 12px;
  height: 12px;
}

.ml-widget.is-thumb-lg .ml-char-card-footer {
  padding: 6px 8px;
  gap: 2px;
}

.ml-widget.is-thumb-lg .ml-char-card-name {
  font-size: 12px;
}

.ml-gallery-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 6px;
  flex-wrap: wrap;
  padding: 2px 0 0;
}

.ml-gallery-pagination-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  font-variant-numeric: tabular-nums;
}

.ml-gallery-pagination-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Shared Lightbox */
.ml-lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--lumiverse-z-lightbox, 10005);
  background: var(--lumiverse-modal-backdrop, rgba(5, 4, 12, 0.86));
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.ml-lightbox-dialog {
  width: min(92vw, 920px);
  max-height: 92vh;
  background: var(--lumiverse-gradient-modal, linear-gradient(135deg, rgba(35, 30, 48, 0.98), rgba(20, 17, 28, 0.98)));
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.25));
  border-radius: var(--lumiverse-radius-lg, 12px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--lumiverse-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.6));
}

.ml-lightbox-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-dark, rgba(0, 0, 0, 0.2));
}

.ml-lightbox-counter {
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.7));
}

.ml-lightbox-stage {
  flex: 1;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  background: radial-gradient(circle at center, rgba(24, 20, 36, 0.9) 0%, rgba(8, 6, 14, 0.95) 100%);
  overflow: hidden;
}

.ml-lightbox-media-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ml-lightbox-media {
  max-width: 100%;
  max-height: 68vh;
  object-fit: contain;
  border-radius: var(--lumiverse-radius, 8px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.ml-lightbox-nav {
  flex-shrink: 0;
  padding: 7px;
  border-radius: 999px;
  background: rgba(15, 12, 24, 0.72);
  border-color: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(4px);
}

.ml-lightbox-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-dark, rgba(0, 0, 0, 0.22));
}

.ml-lightbox-meta {
  flex: 1;
  min-width: min(100%, 150px);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ml-lightbox-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
}

/* Portrait Panel Quick Localize Pill */
.ml-portrait-localize-wrap {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 4px 0 2px;
}

.ml-portrait-localize-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 3.5px 11px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.48));
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.18));
  color: var(--lumiverse-primary-text, #e9d5ff);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition:
    background-color var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.ml-portrait-localize-btn:hover {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.3));
  border-color: var(--lumiverse-primary-hover, rgba(167, 132, 239, 0.8));
  color: #ffffff;
}

.ml-portrait-localize-btn.is-running {
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.7));
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.25));
}

.ml-portrait-localize-btn.is-done {
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.55));
  background: var(--lumiverse-success-020, rgba(34, 197, 94, 0.2));
  color: #86efac;
}
`;

// src/frontend.ts
var REQUIRED_PERMISSIONS = [
  "characters",
  "chats",
  "world_books",
  "regex_scripts",
  "images",
  "cors_proxy",
  "ui_panels"
];
function isGalleryFetchCallbackSrc(src) {
  if (src.includes("isGalleryItemRemoved")) {
    return !src.includes("setShowGalleryPicker") && !src.includes("(!0)");
  }
  return src.includes(".list(") && src.includes(".image_id") && src.includes(".filter(") && !src.includes("(!0)") && !src.includes("(true)");
}
function isGalleryFetchEffectSrc(src) {
  if (src.includes("isGalleryItemRemoved")) {
    return !src.includes("onGalleryItemRemoved") && !src.includes(".finally(");
  }
  return src.includes(".list(") && src.includes(".image_id") && src.includes(".filter(") && !src.includes("onGalleryItemRemoved") && !src.includes(".finally(");
}
function invokeHookSafely(fn) {
  try {
    const res = fn();
    if (res && typeof res.then === "function") {
      Promise.resolve(res).catch((err) => {
        console.warn("[media_localizer] Native gallery refresh hook rejected:", err);
      });
    }
    return res;
  } catch (err) {
    console.warn("[media_localizer] Native gallery refresh hook failed:", err);
    return;
  }
}
function triggerNativeGalleryAndPortraitReactRefresh() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return;
  }
  const targetSelectors = [
    '[class*="galleryTab"]',
    '[class*="avatarZone"]',
    '[class*="tabBar"]',
    '[class*="panelOuter"]',
    '[class*="mosaic"]'
  ];
  const visitedFibers = new Set;
  for (const selector of targetSelectors) {
    let elements;
    try {
      elements = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of Array.from(elements)) {
      if (!el || typeof el !== "object")
        continue;
      let fiberKey;
      try {
        fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      } catch {
        continue;
      }
      if (!fiberKey)
        continue;
      let fiber = el[fiberKey];
      let depth = 0;
      while (fiber && typeof fiber === "object" && depth < 35) {
        depth++;
        if (!visitedFibers.has(fiber)) {
          visitedFibers.add(fiber);
          let hook = fiber.memoizedState;
          let hookDepth = 0;
          const visitedHooks = new Set;
          while (hook && typeof hook === "object" && hookDepth < 60) {
            if (visitedHooks.has(hook))
              break;
            visitedHooks.add(hook);
            hookDepth++;
            const memo = hook.memoizedState;
            if (Array.isArray(memo) && typeof memo[0] === "function") {
              try {
                const src = Function.prototype.toString.call(memo[0]);
                if (typeof src === "string" && isGalleryFetchCallbackSrc(src)) {
                  invokeHookSafely(memo[0]);
                }
              } catch {}
            }
            if (memo && typeof memo === "object" && typeof memo.create === "function") {
              try {
                const src = Function.prototype.toString.call(memo.create);
                if (typeof src === "string" && isGalleryFetchEffectSrc(src)) {
                  if (typeof memo.destroy === "function") {
                    invokeHookSafely(() => memo.destroy());
                    memo.destroy = undefined;
                  } else if (memo.inst && typeof memo.inst === "object" && typeof memo.inst.destroy === "function") {
                    invokeHookSafely(() => memo.inst.destroy());
                    memo.inst.destroy = undefined;
                  }
                  const cleanup = invokeHookSafely(() => memo.create());
                  if (typeof cleanup === "function") {
                    if (memo.inst && typeof memo.inst === "object") {
                      memo.inst.destroy = cleanup;
                    } else {
                      memo.destroy = cleanup;
                    }
                  }
                }
              } catch {}
            }
            hook = hook.next;
          }
        }
        fiber = fiber.return;
      }
    }
  }
}
function setup(ctx) {
  const cleanups = [() => cleanupUiHelpers()];
  let unloaded = false;
  try {
    const removeStyle = ctx.dom.addStyle(MEDIA_LOCALIZER_STYLES);
    if (typeof removeStyle === "function")
      cleanups.push(removeStyle);
  } catch {}
  let currentSettings = {
    ...DEFAULT_SETTINGS,
    defaultSections: [...DEFAULT_SETTINGS.defaultSections],
    defaultMediaKinds: [...DEFAULT_SETTINGS.defaultMediaKinds]
  };
  let currentStats = {
    totalAssets: 0,
    totalSizeBytes: 0,
    totalFailedUrls: 0,
    settings: currentSettings
  };
  let currentQueueProgress = {
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
    skippedByCapCount: 0
  };
  let hasLiveStatsUpdate = false;
  let hasLiveQueueUpdate = false;
  let reqSeq = 0;
  const pendingRpc = new Map;
  function callBackend(action, payload = {}, timeoutMs = 60000) {
    if (unloaded) {
      return Promise.reject(new Error("Media Localizer was unloaded"));
    }
    const requestId = `ml_rpc_${Date.now()}_${++reqSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpc.delete(requestId);
        reject(new Error(`RPC timeout for ${action}`));
      }, timeoutMs);
      pendingRpc.set(requestId, { resolve, reject, timer });
      ctx.sendToBackend({
        type: "RPC_REQUEST",
        requestId,
        action,
        payload
      });
    });
  }
  let uiRefreshTimer = null;
  let pendingNativeGalleryRefreshWhenQueueIdle = false;
  function scheduleNativeGalleryUiRefresh(delayMs = 150) {
    if (unloaded)
      return;
    if (isQueueActiveStatus(currentQueueProgress.status)) {
      pendingNativeGalleryRefreshWhenQueueIdle = true;
      return;
    }
    pendingNativeGalleryRefreshWhenQueueIdle = false;
    if (uiRefreshTimer !== null) {
      clearTimeout(uiRefreshTimer);
    }
    uiRefreshTimer = setTimeout(() => {
      uiRefreshTimer = null;
      if (unloaded)
        return;
      if (isQueueActiveStatus(currentQueueProgress.status)) {
        pendingNativeGalleryRefreshWhenQueueIdle = true;
        return;
      }
      try {
        triggerNativeGalleryAndPortraitReactRefresh();
      } catch {}
    }, delayMs);
  }
  const pendingGalleryLinkItemsByCharacter = new Map;
  const inFlightGalleryLinkDrainByCharacter = new Map;
  const knownLinkedGalleryRowByCharacter = new Map;
  cleanups.push(() => {
    if (uiRefreshTimer !== null) {
      clearTimeout(uiRefreshTimer);
      uiRefreshTimer = null;
    }
    pendingNativeGalleryRefreshWhenQueueIdle = false;
    pendingGalleryLinkItemsByCharacter.clear();
    inFlightGalleryLinkDrainByCharacter.clear();
    knownLinkedGalleryRowByCharacter.clear();
  });
  const activeFetchControllers = new Set;
  const NATIVE_GALLERY_FETCH_TIMEOUT_MS = 15000;
  async function fetchWithTimeout(input, init, timeoutMs = NATIVE_GALLERY_FETCH_TIMEOUT_MS) {
    if (unloaded) {
      throw new Error("Media Localizer was unloaded");
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController : null;
    let timer = null;
    if (controller) {
      activeFetchControllers.add(controller);
      timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }
    try {
      return await fetch(input, {
        ...init,
        ...controller ? { signal: controller.signal } : {}
      });
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (controller) {
        activeFetchControllers.delete(controller);
      }
    }
  }
  cleanups.push(() => {
    for (const controller of activeFetchControllers) {
      try {
        controller.abort();
      } catch {}
    }
    activeFetchControllers.clear();
  });
  async function fetchNativeCharacterGallery(characterId) {
    if (typeof fetch !== "function" || !characterId || unloaded)
      return null;
    try {
      const response = await fetchWithTimeout(`/api/v1/characters/${encodeURIComponent(characterId)}/gallery`, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        console.warn(`[media_localizer] Failed fetching native gallery (${response.status} ${response.statusText})`);
        return null;
      }
      const body = await response.json();
      const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      return list.filter((item) => Boolean(item) && typeof item === "object" && typeof item.id === "string" && typeof item.image_id === "string");
    } catch (err) {
      if (!unloaded) {
        console.warn("[media_localizer] Failed fetching native gallery:", err);
      }
      return null;
    }
  }
  async function ensureGalleryLinksForCharacter(characterId, items) {
    if (typeof fetch !== "function" || !characterId || items.length === 0 || unloaded) {
      return;
    }
    let pendingMap = pendingGalleryLinkItemsByCharacter.get(characterId);
    if (!pendingMap) {
      pendingMap = new Map;
      pendingGalleryLinkItemsByCharacter.set(characterId, pendingMap);
    }
    let addedAny = false;
    for (const item of items) {
      if (!item.imageId)
        continue;
      pendingMap.set(`${item.imageId}\x00${item.normalizedUrl}`, item);
      addedAny = true;
    }
    const existingDrain = inFlightGalleryLinkDrainByCharacter.get(characterId);
    if (existingDrain) {
      return existingDrain;
    }
    if (!addedAny) {
      if (pendingMap.size === 0) {
        pendingGalleryLinkItemsByCharacter.delete(characterId);
      }
      return;
    }
    const drainPromise = (async () => {
      while (!unloaded) {
        await Promise.resolve();
        if (unloaded)
          break;
        const charPending = pendingGalleryLinkItemsByCharacter.get(characterId);
        if (!charPending || charPending.size === 0) {
          break;
        }
        let batchAddedNewGalleryRow = false;
        const batch = Array.from(charPending.values());
        charPending.clear();
        let knownRows = knownLinkedGalleryRowByCharacter.get(characterId);
        if (!knownRows) {
          knownRows = new Map;
          knownLinkedGalleryRowByCharacter.set(characterId, knownRows);
        }
        const recordedLinks = [];
        const unlinkedItems = [];
        for (const item of batch) {
          const known = knownRows.get(item.imageId);
          if (known) {
            if (!item.normalizedUrl || !known.recordedUrls.has(item.normalizedUrl)) {
              recordedLinks.push({
                characterId,
                normalizedUrl: item.normalizedUrl,
                imageId: item.imageId,
                galleryItemId: known.galleryItemId
              });
              if (item.normalizedUrl) {
                known.recordedUrls.add(item.normalizedUrl);
              }
            }
          } else {
            unlinkedItems.push(item);
          }
        }
        if (unlinkedItems.length > 0 && !unloaded) {
          const existingGallery = await fetchNativeCharacterGallery(characterId) ?? [];
          const existingByImageId = new Map;
          for (const gItem of existingGallery) {
            existingByImageId.set(gItem.image_id, gItem);
            if (!knownRows.has(gItem.image_id)) {
              knownRows.set(gItem.image_id, {
                galleryItemId: gItem.id,
                recordedUrls: new Set
              });
            }
          }
          for (const item of unlinkedItems) {
            if (unloaded)
              break;
            const already = existingByImageId.get(item.imageId);
            if (already) {
              const known = knownRows.get(item.imageId);
              if (known && item.normalizedUrl) {
                known.recordedUrls.add(item.normalizedUrl);
              }
              recordedLinks.push({
                characterId,
                normalizedUrl: item.normalizedUrl,
                imageId: item.imageId,
                galleryItemId: already.id
              });
              continue;
            }
            try {
              const response = await fetchWithTimeout(`/api/v1/characters/${encodeURIComponent(characterId)}/gallery/link`, {
                method: "POST",
                credentials: "include",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  image_id: item.imageId,
                  ...item.caption ? { caption: item.caption } : {}
                })
              });
              if (!response.ok) {
                console.warn(`[media_localizer] Failed linking gallery image (${response.status} ${response.statusText})`);
                continue;
              }
              const body = await response.json();
              const created = body && typeof body.id === "string" ? body : body?.data;
              if (created?.id) {
                existingByImageId.set(item.imageId, created);
                const recordedUrls = new Set;
                if (item.normalizedUrl) {
                  recordedUrls.add(item.normalizedUrl);
                }
                knownRows.set(item.imageId, {
                  galleryItemId: created.id,
                  recordedUrls
                });
                recordedLinks.push({
                  characterId,
                  normalizedUrl: item.normalizedUrl,
                  imageId: item.imageId,
                  galleryItemId: created.id
                });
                batchAddedNewGalleryRow = true;
              }
            } catch (err) {
              if (!unloaded) {
                console.warn("[media_localizer] Network error linking gallery image:", err);
              }
            }
          }
        }
        if (unloaded)
          break;
        if (batchAddedNewGalleryRow && !unloaded) {
          scheduleNativeGalleryUiRefresh();
        }
        if (recordedLinks.length > 0) {
          try {
            await callBackend("record_gallery_links", { links: recordedLinks });
          } catch (err) {
            console.warn("[media_localizer] Failed recording gallery links:", err);
          }
        }
      }
    })().finally(() => {
      if (inFlightGalleryLinkDrainByCharacter.get(characterId) === drainPromise) {
        inFlightGalleryLinkDrainByCharacter.delete(characterId);
      }
      if (pendingGalleryLinkItemsByCharacter.get(characterId)?.size === 0) {
        pendingGalleryLinkItemsByCharacter.delete(characterId);
      }
    });
    inFlightGalleryLinkDrainByCharacter.set(characterId, drainPromise);
    await drainPromise;
  }
  async function removeItemsFromNativeGallery(characterId, galleryItemIds, imageIds, options) {
    if (typeof fetch !== "function" || !characterId || unloaded || galleryItemIds.length === 0 && imageIds.length === 0) {
      return;
    }
    const targetGalleryIds = new Set(galleryItemIds.filter(Boolean));
    const targetImageIds = new Set(imageIds.filter(Boolean));
    if (targetGalleryIds.size === 0 && targetImageIds.size === 0) {
      return;
    }
    const idsToDelete = new Set;
    const existingGallery = await fetchNativeCharacterGallery(characterId);
    if (existingGallery !== null) {
      for (const gItem of existingGallery) {
        if (!gItem.id)
          continue;
        if (targetGalleryIds.has(gItem.id) || targetImageIds.has(gItem.image_id)) {
          idsToDelete.add(gItem.id);
        }
      }
    } else if (options?.trustGalleryItemIdsWithoutLookup) {
      for (const id of targetGalleryIds) {
        idsToDelete.add(id);
      }
    }
    if (idsToDelete.size === 0 || unloaded)
      return;
    let deletedAny = false;
    for (const itemId of idsToDelete) {
      if (unloaded)
        break;
      try {
        const res = await fetchWithTimeout(`/api/v1/characters/${encodeURIComponent(characterId)}/gallery/${encodeURIComponent(itemId)}`, {
          method: "DELETE",
          credentials: "include",
          headers: {
            Accept: "application/json"
          }
        });
        if (res.ok || res.status === 204) {
          deletedAny = true;
        } else if (res.status !== 404) {
          console.warn(`[media_localizer] Failed deleting gallery item (${res.status} ${res.statusText})`);
        }
      } catch (err) {
        if (!unloaded) {
          console.warn("[media_localizer] Network error deleting gallery item:", err);
        }
      }
    }
    if (deletedAny && !unloaded) {
      knownLinkedGalleryRowByCharacter.delete(characterId);
      scheduleNativeGalleryUiRefresh();
    }
  }
  const inFlightScans = new Map;
  let scanSeq = 0;
  const latestScanSeqByChar = new Map;
  const displaySwapper = new NonDestructiveDisplaySwapper(ctx);
  displaySwapper.start();
  cleanups.push(() => displaySwapper.stop());
  let lastActiveCharacterScan = null;
  let lastActiveCharacterRemoteCount = 0;
  let drawerTabSetBadge = null;
  let activateDrawerTab = null;
  let portraitButton = null;
  function computeEffectivePendingCount(scan) {
    if (!scan)
      return 0;
    const filter = buildEffectiveFilter(currentSettings, scan);
    const matched = filterScanItemsForDownload(scan, filter);
    return filter.maxItems && filter.maxItems > 0 ? Math.min(matched.length, filter.maxItems) : matched.length;
  }
  function refreshPendingCountsFromActiveScan() {
    const activeCharId = resolveActiveContextCharacterId();
    if (!activeCharId || !lastActiveCharacterScan || lastActiveCharacterScan.characterId !== activeCharId) {
      lastActiveCharacterRemoteCount = 0;
    } else {
      lastActiveCharacterRemoteCount = computeEffectivePendingCount(lastActiveCharacterScan);
    }
    updateDrawerTabBadge();
    portraitButton?.update();
  }
  function resolveActiveContextCharacterId() {
    try {
      const editorState = ctx.ui?.characterEditor?.getState?.();
      if (editorState?.open && editorState.characterId) {
        return editorState.characterId;
      }
    } catch {}
    try {
      const editingId = ctx.state?.get?.("characters.editingId");
      if (typeof editingId === "string" && editingId) {
        return editingId;
      }
    } catch {}
    try {
      const activeChat = ctx.getActiveChat?.();
      if (activeChat?.characterId)
        return activeChat.characterId;
    } catch {}
    try {
      const activeState = ctx.state?.get?.("chat.active");
      if (activeState?.characterId)
        return activeState.characterId;
    } catch {}
    return null;
  }
  function updateDrawerTabBadge() {
    if (!drawerTabSetBadge)
      return;
    try {
      if (currentQueueProgress.status === "running" || currentQueueProgress.status === "paused") {
        drawerTabSetBadge(`${currentQueueProgress.completedCount}/${currentQueueProgress.totalQueued}`);
      } else if (lastActiveCharacterRemoteCount > 0) {
        drawerTabSetBadge(String(lastActiveCharacterRemoteCount));
      } else {
        drawerTabSetBadge(null);
      }
    } catch {}
  }
  const callbacks = {
    async onScanCharacter(characterId, forceRefresh = false) {
      const forcedKey = `${characterId}:1`;
      const scanKey = `${characterId}:${forceRefresh ? "1" : "0"}`;
      const inflight = (!forceRefresh ? inFlightScans.get(forcedKey) : undefined) ?? inFlightScans.get(scanKey);
      if (inflight)
        return inflight;
      const mySeq = ++scanSeq;
      latestScanSeqByChar.set(characterId, mySeq);
      const run = (async () => {
        const res = await callBackend("scan_character", { characterId, forceRefresh });
        if (unloaded)
          return res.scan;
        const isLatestForChar = latestScanSeqByChar.get(characterId) === mySeq;
        if (isLatestForChar && res.urlMapPayload) {
          displaySwapper.updateMap(res.urlMapPayload);
        }
        const activeCharId = resolveActiveContextCharacterId();
        if (isLatestForChar && activeCharId && activeCharId === characterId && res.scan) {
          lastActiveCharacterScan = res.scan;
          refreshPendingCountsFromActiveScan();
        }
        if (isLatestForChar && currentSettings.autoLinkGallery && Array.isArray(res.pendingGalleryLinks) && res.pendingGalleryLinks.length > 0) {
          ensureGalleryLinksForCharacter(characterId, res.pendingGalleryLinks);
        }
        return res.scan;
      })();
      inFlightScans.set(scanKey, run);
      try {
        return await run;
      } finally {
        if (inFlightScans.get(scanKey) === run) {
          inFlightScans.delete(scanKey);
        }
      }
    },
    async onSaveCharacterOverride(characterId, override) {
      const res = await callBackend("save_character_override", { characterId, override });
      if (lastActiveCharacterScan && lastActiveCharacterScan.characterId === characterId) {
        lastActiveCharacterScan.override = res.override ?? null;
        refreshPendingCountsFromActiveScan();
      }
      return res.override ?? null;
    },
    async onClearFailedUrls(urls) {
      const res = await callBackend("clear_failed", { urls });
      if (res.stats) {
        hasLiveStatsUpdate = true;
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      notifyUiStateChanged();
    },
    async onStartDownload(filter) {
      const res = await callBackend("enqueue_download", { filter });
      if (res.queueProgress) {
        hasLiveQueueUpdate = true;
        currentQueueProgress = res.queueProgress;
        notifyUiStateChanged();
      }
    },
    async onQueueControl(control, targetUrl) {
      const res = await callBackend("queue_control", { control, targetUrl });
      if (res.queueProgress) {
        hasLiveQueueUpdate = true;
        currentQueueProgress = res.queueProgress;
        notifyUiStateChanged();
      }
    },
    async onPurgeCharacterCache(characterId, urls) {
      const res = await callBackend("purge_character_cache", { characterId, urls });
      await removeItemsFromNativeGallery(characterId, res.removedGalleryItemIds ?? [], res.removedImageIds ?? [], { trustGalleryItemIdsWithoutLookup: true });
      if (res.stats) {
        hasLiveStatsUpdate = true;
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      latestScanSeqByChar.set(characterId, ++scanSeq);
      inFlightScans.delete(`${characterId}:0`);
      inFlightScans.delete(`${characterId}:1`);
      knownLinkedGalleryRowByCharacter.delete(characterId);
      if (urls && urls.length > 0) {
        const urlSet = new Set(urls);
        const pendingForChar = pendingGalleryLinkItemsByCharacter.get(characterId);
        if (pendingForChar) {
          for (const [k, item] of pendingForChar.entries()) {
            if (urlSet.has(item.normalizedUrl)) {
              pendingForChar.delete(k);
            }
          }
          if (pendingForChar.size === 0) {
            pendingGalleryLinkItemsByCharacter.delete(characterId);
          }
        }
      } else {
        pendingGalleryLinkItemsByCharacter.delete(characterId);
      }
      drawerPanel.invalidateCharacterCache(characterId);
      clearWarmGalleryThumbs();
      if (lastActiveCharacterScan?.characterId === characterId) {
        lastActiveCharacterScan = null;
      }
      notifyUiStateChanged();
      const activeCharId = resolveActiveContextCharacterId() ?? lastObservedContextCharId;
      if (!unloaded && activeCharId && activeCharId === characterId) {
        callbacks.onScanCharacter(activeCharId, true).catch(() => {});
      }
      if (!unloaded) {
        galleryIntegrator.refreshActiveScan(characterId);
      }
    },
    async onBulkPurgeCharacters(characterIds) {
      const uniqueCharIds = Array.from(new Set(characterIds.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean)));
      if (uniqueCharIds.length === 0)
        return;
      const res = await callBackend("purge_characters", { characterIds: uniqueCharIds });
      const removedGalleryIds = res.removedGalleryItemIds ?? [];
      const removedImageIds = res.removedImageIds ?? [];
      if (removedGalleryIds.length > 0 || removedImageIds.length > 0) {
        for (const charId of uniqueCharIds) {
          if (unloaded)
            break;
          await removeItemsFromNativeGallery(charId, removedGalleryIds, removedImageIds, { trustGalleryItemIdsWithoutLookup: uniqueCharIds.length === 1 });
        }
      }
      if (res.stats) {
        hasLiveStatsUpdate = true;
        currentStats = res.stats;
        currentSettings = res.stats.settings;
      }
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      for (const charId of uniqueCharIds) {
        latestScanSeqByChar.set(charId, ++scanSeq);
        inFlightScans.delete(`${charId}:0`);
        inFlightScans.delete(`${charId}:1`);
        knownLinkedGalleryRowByCharacter.delete(charId);
        pendingGalleryLinkItemsByCharacter.delete(charId);
        drawerPanel.invalidateCharacterCache(charId);
      }
      clearWarmGalleryThumbs();
      if (lastActiveCharacterScan && uniqueCharIds.includes(lastActiveCharacterScan.characterId)) {
        lastActiveCharacterScan = null;
      }
      notifyUiStateChanged();
      const activeCharId = resolveActiveContextCharacterId() ?? lastObservedContextCharId;
      if (!unloaded && activeCharId && uniqueCharIds.includes(activeCharId)) {
        callbacks.onScanCharacter(activeCharId, true).catch(() => {});
      }
      if (!unloaded) {
        for (const charId of uniqueCharIds) {
          galleryIntegrator.refreshActiveScan(charId);
        }
      }
    },
    async onScanLibrary(forceRefresh = false) {
      const res = await callBackend("scan_library", { forceRefresh }, 180000);
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      return {
        characters: res.characters,
        totalUniqueRemote: res.totalUniqueRemote
      };
    },
    async onListLibraryMedia(options) {
      const res = await callBackend("list_library_media", { includeEmpty: Boolean(options?.includeEmpty) }, 120000);
      return Array.isArray(res?.characters) ? res.characters : [];
    },
    async onUpdateSettings(patch) {
      const res = await callBackend("update_settings", { patch });
      hasLiveStatsUpdate = true;
      currentSettings = res.settings;
      currentStats = res.stats;
      if (res.urlMapPayload) {
        displaySwapper.updateMap(res.urlMapPayload);
      }
      notifyUiStateChanged();
      return { settings: res.settings, stats: res.stats };
    },
    async onClearFailed() {
      const res = await callBackend("clear_failed", {});
      hasLiveStatsUpdate = true;
      currentStats = res.stats;
      currentSettings = res.stats.settings;
      notifyUiStateChanged();
      return res;
    }
  };
  const galleryIntegrator = new NativeGalleryTabIntegrator(ctx, currentSettings, currentQueueProgress, callbacks, {
    onCharacterPrefsUpdated: () => drawerPanel.syncPreferencesFromStorage()
  });
  cleanups.push(() => galleryIntegrator.stop());
  cleanups.push(() => clearWarmGalleryThumbs());
  const drawerPanel = new MediaLocalizerDrawerPanel(ctx, currentSettings, currentStats, currentQueueProgress, callbacks, {
    onCharacterPrefsUpdated: () => galleryIntegrator.syncPreferencesFromStorage()
  });
  let drawerTabRegistered = false;
  function tryRegisterDrawerTab() {
    if (unloaded || drawerTabRegistered || !ctx.ui?.registerDrawerTab)
      return;
    try {
      const tab = ctx.ui.registerDrawerTab({
        id: "media_localizer",
        title: "Media Localizer",
        shortName: "Media",
        description: "Non-destructively localizes external media embedded in character cards into the Character Gallery & Portrait Panel with granular filters and display-time swapping.",
        keywords: ["media", "localize", "images", "gallery", "cache", "offline"],
        headerTitle: "Media Localizer",
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        guide: {
          title: "Media Localizer Guide",
          markdown: [
            "### Non-Destructive Media Localization",
            "Media Localizer scans character cards, linked World Books, and Regex Scripts for external image, video, and audio URLs.",
            "",
            "- **Zero Card Mutation**: Original character card JSON and text fields are never overwritten.",
            "- **Live Display Swapping**: Localized URLs are transparently swapped in the DOM at display time (`<img>`, `<video>`, `<audio>`, `<source>`, `srcset`, inline SVG `<image>`, CSS `background-image`, and same-origin iframes).",
            "- **Native Gallery Sync**: Downloaded images are automatically linked into the character's native Lumiverse Gallery & Portrait Panel, and existing Gallery images are adopted automatically.",
            "- **Granular Controls**: Filter by card section, individual alternate greetings, domain, or explicit URLs."
          ].join(`
`)
        }
      });
      drawerTabRegistered = true;
      drawerTabSetBadge = (text) => tab.setBadge(text);
      activateDrawerTab = () => tab.activate();
      updateDrawerTabBadge();
      const unmountDrawer = drawerPanel.mount(tab.root);
      cleanups.push(unmountDrawer);
    } catch (err) {
      console.warn("[media_localizer] Failed to register drawer tab:", err);
    }
  }
  portraitButton = new PortraitPanelLocalizeController({
    getActiveCharacterId: () => resolveActiveContextCharacterId(),
    getPendingCount: () => lastActiveCharacterRemoteCount,
    getQueueProgress: () => currentQueueProgress,
    async onLocalizeActiveCharacter(characterId) {
      const scan = lastActiveCharacterScan && lastActiveCharacterScan.characterId === characterId ? lastActiveCharacterScan : await callbacks.onScanCharacter(characterId, false);
      const effective = buildEffectiveFilter(currentSettings, scan);
      const matched = filterScanItemsForDownload(scan, effective);
      const count = effective.maxItems && effective.maxItems > 0 ? Math.min(matched.length, effective.maxItems) : matched.length;
      if (count === 0)
        return;
      if (count > currentSettings.confirmThreshold) {
        const res = await ctx.ui.showConfirm({
          title: "Confirm Media Localization Batch",
          message: `Download ${count} remote media file(s) for "${scan.characterName}"?`,
          confirmLabel: `Localize ${count}`,
          cancelLabel: "Cancel"
        });
        if (!res?.confirmed)
          return;
      }
      const enqueueRes = await callBackend("enqueue_download", {
        filter: { ...effective, characterIds: [characterId] },
        useCharacterOverrides: true
      });
      if (enqueueRes.queueProgress) {
        hasLiveQueueUpdate = true;
        currentQueueProgress = enqueueRes.queueProgress;
        notifyUiStateChanged();
      }
    },
    onOpenCharacterTab(characterId) {
      drawerPanel.setActiveTab("character", characterId, {
        expandOptions: true
      });
      try {
        activateDrawerTab?.();
      } catch {}
    }
  });
  portraitButton.start();
  cleanups.push(() => portraitButton?.stop());
  function notifyUiStateChanged() {
    galleryIntegrator.updateExternalState(currentSettings, currentQueueProgress);
    drawerPanel.updateExternalState(currentSettings, currentStats, currentQueueProgress);
    refreshPendingCountsFromActiveScan();
  }
  const offBackend = ctx.onBackendMessage((rawMsg) => {
    if (!rawMsg || typeof rawMsg !== "object")
      return;
    const msg = rawMsg;
    if (msg.type === "RPC_RESPONSE") {
      const requestId = String(msg.requestId ?? "");
      const pending = pendingRpc.get(requestId);
      if (!pending)
        return;
      clearTimeout(pending.timer);
      pendingRpc.delete(requestId);
      if (typeof msg.error === "string" && msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (msg.type === "URL_MAP_UPDATED" && msg.urlMapPayload) {
      displaySwapper.updateMap(msg.urlMapPayload);
      if (msg.stats) {
        hasLiveStatsUpdate = true;
        currentStats = msg.stats;
        currentSettings = currentStats.settings;
        notifyUiStateChanged();
      }
      return;
    }
    if (msg.type === "ENSURE_GALLERY_LINKS" && Array.isArray(msg.links) && currentSettings.autoLinkGallery) {
      const characterId = String(msg.characterId ?? "");
      if (characterId) {
        ensureGalleryLinksForCharacter(characterId, msg.links);
      }
      return;
    }
    if (msg.type === "GALLERY_SYNC_CHANGED") {
      const characterId = typeof msg.characterId === "string" ? msg.characterId : undefined;
      if (characterId) {
        knownLinkedGalleryRowByCharacter.delete(characterId);
      } else {
        knownLinkedGalleryRowByCharacter.clear();
      }
      galleryIntegrator.refreshActiveScan(characterId);
      drawerPanel.refreshActiveScan(characterId);
      return;
    }
    if (msg.type === "QUEUE_PROGRESS" && msg.progress) {
      const wasActive = isQueueActiveStatus(currentQueueProgress.status);
      hasLiveQueueUpdate = true;
      currentQueueProgress = msg.progress;
      if (msg.stats) {
        hasLiveStatsUpdate = true;
        currentStats = msg.stats;
        currentSettings = currentStats.settings;
      }
      const nowActive = isQueueActiveStatus(currentQueueProgress.status);
      notifyUiStateChanged();
      if (wasActive && !nowActive) {
        if (pendingNativeGalleryRefreshWhenQueueIdle) {
          pendingNativeGalleryRefreshWhenQueueIdle = false;
          scheduleNativeGalleryUiRefresh(150);
        }
        if (lastObservedContextCharId) {
          callbacks.onScanCharacter(lastObservedContextCharId, false).catch(() => {});
        }
      }
      if (msg.newAsset && currentSettings.autoLinkGallery) {
        const asset = msg.newAsset;
        if (asset.imageId && asset.mimeType.startsWith("image/")) {
          for (const charId of asset.characterIds) {
            if (!charId)
              continue;
            if (asset.galleryItemIds?.[charId]) {
              continue;
            }
            ensureGalleryLinksForCharacter(charId, [
              {
                characterId: charId,
                imageId: asset.imageId,
                normalizedUrl: asset.normalizedUrl,
                caption: asset.filename
              }
            ]);
          }
        }
      }
    }
  });
  if (typeof offBackend === "function")
    cleanups.push(offBackend);
  let lastObservedContextCharId = resolveActiveContextCharacterId();
  function handleActiveCharacterContextChanged(force = false) {
    if (unloaded)
      return;
    const nextCharId = resolveActiveContextCharacterId();
    const changed = force || nextCharId !== lastObservedContextCharId;
    lastObservedContextCharId = nextCharId;
    displaySwapper.schedulePass();
    if (changed) {
      drawerPanel.notifyActiveChatChanged();
    }
    if (nextCharId) {
      if (changed) {
        callbacks.onScanCharacter(nextCharId, false).catch(() => {});
        if (currentSettings.autoLocalizeOnOpen) {
          callBackend("auto_localize_character", { characterId: nextCharId }).then((res) => {
            if (res?.started && res.queueProgress) {
              hasLiveQueueUpdate = true;
              currentQueueProgress = res.queueProgress;
              notifyUiStateChanged();
            }
          }).catch(() => {});
        }
      }
    } else if (changed) {
      lastActiveCharacterScan = null;
      lastActiveCharacterRemoteCount = 0;
      updateDrawerTabBadge();
      portraitButton?.update();
    }
  }
  const refreshEvents = [
    "CHAT_SWITCHED",
    "CHARACTER_MESSAGE_RENDERED",
    "USER_MESSAGE_RENDERED",
    "MESSAGE_EDITED",
    "MESSAGE_SWIPED",
    "CHARACTER_EDITED"
  ];
  let hasChatActiveSub = false;
  let hasDrawerChangeSub = false;
  let hasEditorStateSub = false;
  let hasEditingIdSub = false;
  const boundRefreshEvents = new Set;
  function bindPermissionGatedSubscriptions() {
    if (unloaded)
      return;
    tryRegisterDrawerTab();
    galleryIntegrator.start();
    if (!hasChatActiveSub) {
      try {
        const offChatActive = ctx.state?.subscribe?.("chat.active", () => {
          handleActiveCharacterContextChanged();
        });
        if (typeof offChatActive === "function") {
          hasChatActiveSub = true;
          cleanups.push(offChatActive);
        }
      } catch {}
    }
    if (!hasDrawerChangeSub) {
      try {
        const offDrawerChange = ctx.ui?.events?.onDrawerChange?.((state) => {
          if (state.open && state.tabId === "media_localizer") {
            handleActiveCharacterContextChanged();
            drawerPanel.restoreScrollIfReset();
          }
        });
        if (typeof offDrawerChange === "function") {
          hasDrawerChangeSub = true;
          cleanups.push(offDrawerChange);
        }
      } catch {}
    }
    if (!hasEditorStateSub) {
      try {
        const offEditor = ctx.ui?.characterEditor?.onChange?.(() => {
          handleActiveCharacterContextChanged();
        });
        if (typeof offEditor === "function") {
          hasEditorStateSub = true;
          cleanups.push(offEditor);
        }
      } catch {}
    }
    if (!hasEditingIdSub) {
      try {
        const offEditingId = ctx.state?.subscribe?.("characters.editingId", () => {
          handleActiveCharacterContextChanged();
        });
        if (typeof offEditingId === "function") {
          hasEditingIdSub = true;
          cleanups.push(offEditingId);
        }
      } catch {}
    }
    for (const evName of refreshEvents) {
      if (boundRefreshEvents.has(evName))
        continue;
      try {
        const off = ctx.events?.on?.(evName, () => {
          displaySwapper.schedulePass();
          if (evName === "CHARACTER_EDITED") {
            drawerPanel.refreshActiveScan(resolveActiveContextCharacterId() ?? undefined);
          }
          if (evName === "CHAT_SWITCHED" || evName === "CHARACTER_EDITED") {
            handleActiveCharacterContextChanged(true);
          }
        });
        if (typeof off === "function") {
          boundRefreshEvents.add(evName);
          cleanups.push(off);
        }
      } catch {}
    }
  }
  bindPermissionGatedSubscriptions();
  try {
    if (ctx.permissions?.getGranted) {
      ctx.permissions.getGranted().then(async (granted) => {
        if (unloaded)
          return;
        const grantedSet = new Set(Array.isArray(granted) ? granted : []);
        const missing = REQUIRED_PERMISSIONS.filter((p) => !grantedSet.has(p));
        if (missing.length > 0 && ctx.permissions?.request) {
          try {
            const updated = await ctx.permissions.request([...missing]);
            const updatedSet = new Set(Array.isArray(updated) ? updated : []);
            const stillMissing = REQUIRED_PERMISSIONS.filter((p) => !updatedSet.has(p) && !grantedSet.has(p));
            if (stillMissing.length > 0) {
              console.warn(`[media_localizer] Some permissions were not granted (${stillMissing.join(", ")}); continuing with available permissions.`);
            }
          } catch (err) {
            console.warn("[media_localizer] Permission request was denied or failed; continuing with available permissions:", err);
          }
        }
        if (unloaded)
          return;
        bindPermissionGatedSubscriptions();
        handleActiveCharacterContextChanged(true);
      }).catch((err) => {
        if (unloaded)
          return;
        console.warn("[media_localizer] Failed checking granted permissions:", err);
        bindPermissionGatedSubscriptions();
        handleActiveCharacterContextChanged(true);
      });
    }
  } catch {}
  callBackend("get_init_state").then((init) => {
    if (unloaded)
      return;
    if (init.stats && !hasLiveStatsUpdate) {
      currentStats = init.stats;
      currentSettings = init.stats.settings;
    }
    if (init.queueProgress && !hasLiveQueueUpdate) {
      currentQueueProgress = init.queueProgress;
    }
    if (init.urlMapPayload) {
      displaySwapper.updateMap(init.urlMapPayload);
    }
    notifyUiStateChanged();
    handleActiveCharacterContextChanged(true);
  }).catch(() => {});
  try {
    ctx.ready();
  } catch {}
  return () => {
    unloaded = true;
    for (const [, p] of pendingRpc) {
      clearTimeout(p.timer);
      p.reject(new Error("Media Localizer was unloaded"));
    }
    pendingRpc.clear();
    for (const fn of cleanups) {
      try {
        fn();
      } catch {}
    }
    try {
      ctx.dom.cleanup();
    } catch {}
  };
}
export {
  setup,
  triggerNativeGalleryAndPortraitReactRefresh
};
