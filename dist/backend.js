// @bun
// src/shared/types.ts
var ALL_MEDIA_SECTIONS = [
  "creator_notes",
  "first_mes",
  "core_fields",
  "alternate_greetings",
  "world_books",
  "regex_scripts"
];
var ALL_MEDIA_KINDS = ["image", "video"];
var NATIVE_EXPRESSION_SENTINEL = "__native_expression__";
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

// src/shared/url-scanner.ts
var VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v|ogv)$/i;
var IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|apng)$/i;
var EXCLUDED_ASSET_EXT_RE = /\.(?:woff2?|ttf|otf|eot|css|js|mjs|json|xml|html?|txt|pdf|zip|rar|7z|mp3|wav|ogg|flac|m4a)$/i;
var EXCLUDED_DOMAIN_RE = /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.fontawesome\.com|cdnjs\.cloudflare\.com)$/i;
var MAX_MD_ALT_LEN = 2048;
var MAX_MD_REF_LEN = 512;
var MAX_MD_URL_LEN = 8192;
var MAX_HTML_TAG_LEN = 4096;
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
function stripTrailingChars(input, chars) {
  let end = input.length;
  while (end > 0 && chars.includes(input[end - 1])) {
    end--;
  }
  return end === input.length ? input : input.slice(0, end);
}
function stripWrappingAngleBrackets(input) {
  let start = 0;
  let end = input.length;
  while (start < end && input[start] === "<")
    start++;
  while (end > start && input[end - 1] === ">")
    end--;
  return start === 0 && end === input.length ? input : input.slice(start, end);
}
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
var MAX_MD_BRACKET_DEPTH = 32;
var MAX_HTML_ATTR_VALUE_LEN = 4096;
var MAX_CSS_URL_LEN = 4096;
function isAsciiWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === `
` || ch === "\r" || ch === "\f";
}
function isBlankLineAt(text, pos) {
  const ch = text[pos];
  if (ch === `
`) {
    return text[pos + 1] === `
` || text[pos + 1] === "\r" && text[pos + 2] === `
`;
  }
  if (ch === "\r" && text[pos + 1] === `
`) {
    return text[pos + 2] === `
` || text[pos + 2] === "\r" && text[pos + 3] === `
`;
  }
  return false;
}
function normalizeMdRefLabel(raw) {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}
function extractMarkdownImageCandidates(text) {
  const inline = [];
  const refUses = new Set;
  let idx = 0;
  const len = text.length;
  while (idx < len) {
    const bangIdx = text.indexOf("![", idx);
    if (bangIdx === -1)
      break;
    const firstClose = text.indexOf("]", bangIdx + 2);
    if (firstClose === -1)
      break;
    if (firstClose - (bangIdx + 2) > MAX_MD_ALT_LEN) {
      idx = firstClose - MAX_MD_ALT_LEN;
      continue;
    }
    let bracketDepth = 0;
    let i = bangIdx + 1;
    const altLimit = Math.min(len, bangIdx + 2 + MAX_MD_ALT_LEN);
    let altAborted = false;
    while (i < altLimit) {
      const ch = text[i];
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
    if (text[i] === "(") {
      i++;
      const urlLimit = Math.min(len, i + MAX_MD_URL_LEN);
      while (i < urlLimit && isAsciiWhitespace(text[i] ?? ""))
        i++;
      if (text[i] === "<") {
        let j = i + 1;
        let closeAngle = -1;
        while (j < urlLimit) {
          const ch = text[j];
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === `
` || ch === "\r" || ch === "<")
            break;
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
      const nextParen = text.indexOf(")", i);
      if (nextParen === -1 || nextParen >= urlLimit) {
        idx = bangIdx + 2;
        continue;
      }
      const urlStart = i;
      let parenDepth = 0;
      let stoppedCleanly = false;
      while (i < urlLimit) {
        const ch = text[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "(") {
          parenDepth++;
          if (parenDepth > MAX_MD_BRACKET_DEPTH) {
            break;
          }
        } else if (ch === ")") {
          if (parenDepth === 0) {
            stoppedCleanly = true;
            break;
          }
          parenDepth--;
        } else if (isAsciiWhitespace(ch)) {
          stoppedCleanly = parenDepth === 0;
          break;
        }
        i++;
      }
      if (!stoppedCleanly) {
        idx = bangIdx + 2;
        continue;
      }
      const raw = text.slice(urlStart, i).trim();
      if (raw) {
        inline.push({ raw, spanStart: urlStart, spanEnd: i });
      }
      idx = i + 1;
      continue;
    }
    if (text[i] === "[") {
      const refStart = i + 1;
      const refLimit = Math.min(len, refStart + MAX_MD_REF_LEN);
      let j = refStart;
      let refClose = -1;
      while (j < refLimit) {
        const ch = text[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "[" || isBlankLineAt(text, j))
          break;
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
function extractReferenceDefinitionTargets(text, refUses) {
  if (refUses.size === 0)
    return [];
  const results = [];
  const len = text.length;
  let pos = 0;
  while (pos < len) {
    const lineStart = pos;
    const nlIdx = text.indexOf(`
`, pos);
    const rawLineEnd = nlIdx === -1 ? len : nlIdx;
    const lineEnd = rawLineEnd > lineStart && text[rawLineEnd - 1] === "\r" ? rawLineEnd - 1 : rawLineEnd;
    pos = nlIdx === -1 ? len : nlIdx + 1;
    let i = lineStart;
    let indent = 0;
    while (i < lineEnd && indent < 3 && (text[i] === " " || text[i] === "\t")) {
      i++;
      indent++;
    }
    if (i >= lineEnd || text[i] !== "[")
      continue;
    i++;
    const labelStart = i;
    const labelLimit = Math.min(lineEnd, labelStart + MAX_MD_REF_LEN);
    let labelClose = -1;
    while (i < labelLimit) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "[")
        break;
      if (ch === "]") {
        labelClose = i;
        break;
      }
      i++;
    }
    if (labelClose === -1 || labelClose + 1 >= lineEnd || text[labelClose + 1] !== ":") {
      continue;
    }
    const label = normalizeMdRefLabel(text.slice(labelStart, labelClose));
    if (!label || !refUses.has(label))
      continue;
    let u = labelClose + 2;
    while (u < lineEnd && (text[u] === " " || text[u] === "\t"))
      u++;
    if (u >= lineEnd)
      continue;
    if (text[u] === "<") {
      const urlStart = u + 1;
      let j = urlStart;
      let closeGt = -1;
      while (j < lineEnd) {
        const ch = text[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "<")
          break;
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
      const ch = text[u];
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
var HTML_MEDIA_TAGS = new Set(["img", "image", "video", "source"]);
function isHtmlTagNameStart(ch) {
  return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z";
}
function isHtmlAttrNameStart(ch) {
  return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_" || ch === ":";
}
function isHtmlAttrNameChar(ch) {
  return isHtmlAttrNameStart(ch) || ch >= "0" && ch <= "9" || ch === "." || ch === "-";
}
function scanHtmlMediaTags(text, allowedTags, onTag) {
  const len = text.length;
  let pos = 0;
  while (pos < len) {
    const lt = text.indexOf("<", pos);
    if (lt === -1)
      break;
    if (text.startsWith("<!--", lt)) {
      const endComment = text.indexOf("-->", lt + 4);
      if (endComment === -1)
        break;
      pos = endComment + 3;
      continue;
    }
    if (lt + 1 >= len || !isHtmlTagNameStart(text[lt + 1])) {
      pos = lt + 1;
      continue;
    }
    let i = lt + 1;
    while (i < len) {
      const ch = text[i];
      if (ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch >= "0" && ch <= "9" || ch === "-") {
        i++;
      } else {
        break;
      }
    }
    const tagNameEnd = i;
    const tagName = text.slice(lt + 1, tagNameEnd).toLowerCase();
    if (!allowedTags.has(tagName) || i >= len || !isAsciiWhitespace(text[i]) && text[i] !== "/" && text[i] !== ">") {
      pos = tagNameEnd;
      continue;
    }
    const nextGt = text.indexOf(">", i);
    if (nextGt === -1)
      break;
    if (nextGt - lt > MAX_HTML_TAG_LEN) {
      pos = Math.max(tagNameEnd, nextGt - MAX_HTML_TAG_LEN);
      continue;
    }
    const tagLimit = Math.min(len, lt + MAX_HTML_TAG_LEN);
    const attrs = [];
    let closed = false;
    let tagEnd = i;
    let hitLtAt = -1;
    while (i < tagLimit) {
      while (i < tagLimit && (isAsciiWhitespace(text[i]) || text[i] === "/")) {
        i++;
      }
      if (i >= tagLimit)
        break;
      const ch = text[i];
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
      while (i < tagLimit && isHtmlAttrNameChar(text[i])) {
        i++;
      }
      const attrName = text.slice(nameStart, i).toLowerCase();
      while (i < tagLimit && isAsciiWhitespace(text[i]))
        i++;
      if (i >= tagLimit || text[i] !== "=") {
        continue;
      }
      i++;
      while (i < tagLimit && isAsciiWhitespace(text[i]))
        i++;
      if (i >= tagLimit)
        break;
      const valChar = text[i];
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
          valEnd: closeQ
        });
        i = closeQ + 1;
      } else {
        const valStart = i;
        while (i < tagLimit) {
          const c = text[i];
          if (isAsciiWhitespace(c) || c === '"' || c === "'" || c === "=" || c === "<" || c === ">" || c === "`") {
            break;
          }
          i++;
        }
        if (i > valStart) {
          attrs.push({
            name: attrName,
            value: text.slice(valStart, i),
            valStart,
            valEnd: i
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
function emitSrcsetCandidates(srcsetVal, valStart, hint, pushCandidate) {
  for (const candidate of parseSrcsetCandidates(srcsetVal)) {
    pushCandidate(candidate.url, hint, valStart + candidate.urlStart, valStart + candidate.urlEnd);
  }
}
function extractCssUrlCandidates(text) {
  const results = [];
  const cssStartRe = /\burl\(/gi;
  const len = text.length;
  let match;
  while ((match = cssStartRe.exec(text)) !== null) {
    let i = match.index + match[0].length;
    const limit = Math.min(len, i + MAX_CSS_URL_LEN);
    while (i < limit && isAsciiWhitespace(text[i] ?? ""))
      i++;
    if (i >= limit)
      continue;
    const first = text[i];
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
      if (closeQ === -1)
        continue;
      let k = closeQ + 1;
      while (k < limit && isAsciiWhitespace(text[k] ?? ""))
        k++;
      if (k < limit && text[k] === ")") {
        const raw = text.slice(valStart, closeQ);
        if (raw) {
          results.push({ raw, spanStart: valStart, spanEnd: closeQ });
        }
      }
    } else {
      const valStart = i;
      while (i < limit) {
        const ch = text[i];
        if (ch === ")" || ch === '"' || ch === "'" || isAsciiWhitespace(ch)) {
          break;
        }
        i++;
      }
      const valEnd = i;
      while (i < limit && isAsciiWhitespace(text[i] ?? ""))
        i++;
      if (i < limit && text[i] === ")" && valEnd > valStart) {
        const raw = text.slice(valStart, valEnd);
        results.push({ raw, spanStart: valStart, spanEnd: valEnd });
      }
    }
  }
  return results;
}
function extractMediaTokensFromText(text, options) {
  if (!text || typeof text !== "string")
    return [];
  const scanBareUrls = options?.scanBareUrls ?? true;
  const tokens = [];
  const consumedSpans = [];
  const pushCandidate = (raw, hint, spanStart, spanEnd) => {
    const token = normalizeRemoteMediaUrl(raw, hint);
    if (!token)
      return;
    tokens.push(token);
    if (spanEnd > spanStart) {
      consumedSpans.push({ start: spanStart, end: spanEnd });
    }
  };
  const md = extractMarkdownImageCandidates(text);
  for (const item of md.inline) {
    pushCandidate(item.raw, "markdown", item.spanStart, item.spanEnd);
  }
  for (const def of extractReferenceDefinitionTargets(text, md.refUses)) {
    pushCandidate(def.raw, "markdown", def.spanStart, def.spanEnd);
  }
  scanHtmlMediaTags(text, HTML_MEDIA_TAGS, (tagName, attrs) => {
    if (tagName === "img" || tagName === "image") {
      for (const attr of attrs) {
        if (attr.name === "src" || attr.name === "data-src" || attr.name === "href" || attr.name === "xlink:href") {
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
      const isVideoType = attrs.some((attr) => attr.name === "type" && attr.value.trim().toLowerCase().startsWith("video/"));
      const hint = isVideoType ? "video" : "img";
      for (const attr of attrs) {
        if (attr.name === "src") {
          pushCandidate(attr.value, hint, attr.valStart, attr.valEnd);
        } else if (attr.name === "srcset") {
          emitSrcsetCandidates(attr.value, attr.valStart, hint, pushCandidate);
        }
      }
    }
  });
  for (const css of extractCssUrlCandidates(text)) {
    pushCandidate(css.raw, "css", css.spanStart, css.spanEnd);
  }
  if (scanBareUrls) {
    const mergedSpans = [];
    if (consumedSpans.length > 0) {
      consumedSpans.sort((a, b) => a.start - b.start || a.end - b.end);
      for (const span of consumedSpans) {
        const prev = mergedSpans[mergedSpans.length - 1];
        if (prev && span.start <= prev.end) {
          if (span.end > prev.end)
            prev.end = span.end;
        } else {
          mergedSpans.push({ start: span.start, end: span.end });
        }
      }
    }
    const bareUrlRe = /https?:\/\/[^\s"'<>)\]]+/gi;
    let spanIdx = 0;
    let bareMatch;
    while ((bareMatch = bareUrlRe.exec(text)) !== null) {
      const candidate = stripTrailingChars(bareMatch[0], ".,;!?");
      const bareStart = bareMatch.index;
      const bareEnd = bareStart + candidate.length;
      while (spanIdx < mergedSpans.length && mergedSpans[spanIdx].end <= bareStart) {
        spanIdx++;
      }
      const activeSpan = mergedSpans[spanIdx];
      if (activeSpan && activeSpan.start < bareEnd && bareStart < activeSpan.end) {
        continue;
      }
      pushCandidate(candidate, "bare", bareStart, bareEnd);
    }
  }
  return tokens;
}
function deriveUrlFilenameParts(normalizedUrl) {
  try {
    const parsed = new URL(normalizedUrl);
    const rawSeg = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "media");
    const extMatch = /\.([a-z0-9]{2,5})$/i.exec(rawSeg);
    const queryFormat = parsed.searchParams.get("format")?.trim().toLowerCase() ?? "";
    const validQueryExt = /^(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|apng|mp4|webm|mov|m4v|ogv)$/i.test(queryFormat) ? queryFormat : "";
    const ext = extMatch?.[1]?.toLowerCase() || validQueryExt;
    const basename = !extMatch && validQueryExt ? `${rawSeg}.${validQueryExt}` : rawSeg;
    const cleanedStem = rawSeg.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 48);
    return {
      basename,
      cleanedStem: cleanedStem || "media",
      ext
    };
  } catch {
    return {
      basename: "media",
      cleanedStem: "media",
      ext: ""
    };
  }
}
var NATIVE_IMG_TAGS = new Set(["img"]);
var NATIVE_BARE_URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
var NATIVE_IMAGE_PATH_RE = /\.(?:apng|avif|bmp|gif|heic|heif|ico|jpe?g|jfif|pjp|pjpeg|png|svg|webp)$/i;
var NATIVE_TRAILING_PUNCTUATION_CHARS = "),.;!?'\"`]}\\";
function normalizeNativeExtractedCandidateUrl(raw) {
  let candidate = raw.trim();
  if (candidate.startsWith("\\\"") || candidate.startsWith("\\'")) {
    candidate = candidate.slice(2);
  }
  if (candidate.endsWith("\\\"") || candidate.endsWith("\\'")) {
    candidate = candidate.slice(0, -2);
  }
  const cleaned = stripTrailingChars(stripWrappingAngleBrackets(stripTrailingChars(candidate, NATIVE_TRAILING_PUNCTUATION_CHARS)), NATIVE_TRAILING_PUNCTUATION_CHARS);
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
function extractNativeImageUrlsFromText(text) {
  const urls = new Set;
  const addCandidate = (raw, requireImagePath) => {
    if (!raw)
      return;
    const normalized = normalizeNativeExtractedCandidateUrl(raw);
    if (!normalized)
      return;
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
function extractNativeGalleryUrlsFromCharacter(character) {
  const fieldsToScan = [
    character.first_mes,
    character.description,
    character.personality,
    character.scenario,
    character.mes_example,
    character.system_prompt,
    character.post_history_instructions,
    character.creator_notes,
    ...character.alternate_greetings ?? []
  ];
  if (character.extensions && Object.keys(character.extensions).length > 0) {
    const visited = new Set;
    const collectExtStrings = (val, depth) => {
      if (depth > 32 || val == null)
        return;
      if (typeof val === "string") {
        if (val)
          fieldsToScan.push(val);
        return;
      }
      if (typeof val !== "object")
        return;
      if (visited.has(val))
        return;
      visited.add(val);
      if (Array.isArray(val)) {
        for (const item of val) {
          collectExtStrings(item, depth + 1);
        }
        return;
      }
      for (const v of Object.values(val)) {
        collectExtStrings(v, depth + 1);
      }
    };
    collectExtStrings(character.extensions, 0);
  }
  const allUrls = new Set;
  for (const field of fieldsToScan) {
    if (!field || typeof field !== "string")
      continue;
    for (const url of extractNativeImageUrlsFromText(field)) {
      const normalized = normalizeRemoteMediaUrl(url, "img")?.normalizedUrl;
      if (normalized) {
        allUrls.add(normalized);
      }
    }
  }
  return [...allUrls];
}
function extractChubExpressionUrlMapFromExtensions(extensions) {
  const result = new Map;
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) {
    return result;
  }
  const chub = extensions.chub;
  if (!chub || typeof chub !== "object" || Array.isArray(chub)) {
    return result;
  }
  const outerExpr = chub.expressions;
  if (!outerExpr || typeof outerExpr !== "object" || Array.isArray(outerExpr)) {
    return result;
  }
  const innerExpr = outerExpr.expressions;
  const mappings = innerExpr && typeof innerExpr === "object" && !Array.isArray(innerExpr) ? innerExpr : outerExpr;
  for (const [label, value] of Object.entries(mappings)) {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || typeof value !== "string")
      continue;
    const rawUrl = value.trim();
    if (!rawUrl.toLowerCase().startsWith("https://") && !rawUrl.toLowerCase().startsWith("http://")) {
      continue;
    }
    const normalized = normalizeRemoteMediaUrl(rawUrl, "img")?.normalizedUrl;
    if (!normalized)
      continue;
    if (!result.has(trimmedLabel)) {
      result.set(trimmedLabel, { normalizedUrl: normalized, rawUrl });
    }
  }
  return result;
}
function extractCharacterExpressions(extensions) {
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) {
    return [];
  }
  const results = [];
  const seenKeys = new Set;
  const pushEntry = (label, imageId, groupName) => {
    const cleanId = imageId.trim();
    if (!cleanId)
      return;
    const cleanLabel = label.trim() || cleanId;
    const cleanGroup = groupName?.trim() || undefined;
    const dedupKey = `${cleanGroup ?? ""}::${cleanLabel.toLowerCase()}::${cleanId}`;
    if (seenKeys.has(dedupKey))
      return;
    seenKeys.add(dedupKey);
    results.push({
      label: cleanLabel,
      ...cleanGroup ? { groupName: cleanGroup } : {},
      imageId: cleanId,
      localUrl: `/api/v1/images/${encodeURIComponent(cleanId)}`
    });
  };
  const expr = extensions.expressions;
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const mappings = expr.mappings;
    if (mappings && typeof mappings === "object" && !Array.isArray(mappings)) {
      for (const [label, imgId] of Object.entries(mappings)) {
        if (typeof imgId !== "string" || !label.trim())
          continue;
        pushEntry(label, imgId);
      }
    }
  }
  const groups = extensions.expression_groups;
  if (groups && typeof groups === "object" && !Array.isArray(groups)) {
    for (const [groupName, groupVal] of Object.entries(groups)) {
      if (!groupVal || typeof groupVal !== "object" || Array.isArray(groupVal))
        continue;
      for (const [label, imgId] of Object.entries(groupVal)) {
        if (typeof imgId !== "string")
          continue;
        pushEntry(label, imgId, groupName);
      }
    }
  }
  return results;
}
function collectCharacterExpressionImageIds(extensions) {
  const byLabel = new Map;
  const allImageIds = new Set;
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
function readGreetingTitle(extensions, greetingIndex) {
  if (!extensions || typeof extensions !== "object")
    return null;
  const titles = extensions.greeting_titles ?? extensions.alternate_greeting_titles;
  if (titles && typeof titles === "object") {
    const val = titles[String(greetingIndex)];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}
function createEmptySectionSummary() {
  return {
    totalUnique: 0,
    remoteCount: 0,
    localizedCount: 0,
    failedCount: 0
  };
}
function scanCharacterMedia(character, worldBooks, regexScripts, lookup) {
  const itemMap = new Map;
  let totalOccurrences = 0;
  const recordText = (text, source) => {
    if (!text)
      return;
    const tokens = extractMediaTokensFromText(text, {
      scanBareUrls: lookup.scanBareUrls ?? true
    });
    for (const token of tokens) {
      totalOccurrences++;
      let item = itemMap.get(token.normalizedUrl);
      if (!item) {
        const localized = lookup.localizedByNormalizedUrl.get(token.normalizedUrl);
        const failure = lookup.failedByNormalizedUrl.get(token.normalizedUrl);
        const status = localized ? "localized" : failure ? "failed" : "remote";
        item = {
          normalizedUrl: token.normalizedUrl,
          rawUrls: [token.rawUrl],
          domain: token.domain,
          mediaKind: token.mediaKind,
          sources: [source],
          occurrenceCount: 1,
          status,
          ...localized ? { localizedEntry: localized } : {},
          ...failure && !localized ? { failureInfo: failure } : {}
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
        const alreadyHasSource = item.sources.some((s) => s.section === source.section && s.label === source.label && s.greetingIndex === source.greetingIndex && s.worldBookId === source.worldBookId && s.regexScriptId === source.regexScriptId);
        if (!alreadyHasSource) {
          item.sources.push(source);
        }
      }
    }
  };
  recordText(character.creator_notes, {
    section: "creator_notes",
    label: "Creator's Notes"
  });
  recordText(character.first_mes, {
    section: "first_mes",
    label: "First Message"
  });
  recordText(character.description, {
    section: "core_fields",
    label: "Description"
  });
  recordText(character.personality, {
    section: "core_fields",
    label: "Personality"
  });
  recordText(character.scenario, {
    section: "core_fields",
    label: "Scenario"
  });
  recordText(character.mes_example, {
    section: "core_fields",
    label: "Message Examples"
  });
  recordText(character.system_prompt, {
    section: "core_fields",
    label: "System Prompt"
  });
  recordText(character.post_history_instructions, {
    section: "core_fields",
    label: "Post-History Instructions"
  });
  const altFields = character.extensions?.alternate_fields;
  if (altFields && typeof altFields === "object") {
    for (const [fieldName, variants] of Object.entries(altFields)) {
      if (!Array.isArray(variants))
        continue;
      for (const variant of variants) {
        if (variant && typeof variant === "object" && typeof variant.content === "string") {
          const vLabel = typeof variant.label === "string" ? variant.label : fieldName;
          recordText(variant.content, {
            section: "core_fields",
            label: `Alt ${fieldName}: ${vLabel}`
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
      "expression_groups"
    ]);
    const ignoredNestedKeys = new Set(["expressions", "alt_expressions"]);
    const walkExtValue = (val, label, depth) => {
      if (depth > 5 || val == null)
        return;
      if (typeof val === "string") {
        const lowerVal = val.toLowerCase();
        if (lowerVal.includes("http://") || lowerVal.includes("https://")) {
          recordText(val, {
            section: "core_fields",
            label
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
        for (const [k, v] of Object.entries(val)) {
          if (ignoredNestedKeys.has(k))
            continue;
          walkExtValue(v, `${label}.${k}`, depth + 1);
        }
      }
    };
    for (const [extKey, extVal] of Object.entries(character.extensions)) {
      if (ignoredExtKeys.has(extKey))
        continue;
      walkExtValue(extVal, `Extensions (${extKey})`, 0);
    }
  }
  const greetings = Array.isArray(character.alternate_greetings) ? character.alternate_greetings : [];
  for (let i = 0;i < greetings.length; i++) {
    const greetingIndex = i + 1;
    const customTitle = readGreetingTitle(character.extensions, greetingIndex);
    const label = customTitle ? `Greeting #${greetingIndex} (${customTitle})` : `Greeting #${greetingIndex}`;
    recordText(greetings[i], {
      section: "alternate_greetings",
      label,
      greetingIndex
    });
  }
  for (const wb of worldBooks) {
    for (const entry of wb.entries || []) {
      const entryLabel = entry.comment?.trim() ? `${wb.name} (${entry.comment.trim()})` : wb.name;
      recordText(entry.content, {
        section: "world_books",
        label: entryLabel,
        worldBookId: wb.id,
        worldBookName: wb.name
      });
    }
  }
  for (const script of regexScripts) {
    recordText(script.replace_string, {
      section: "regex_scripts",
      label: script.script_name || "Regex Script",
      regexScriptId: script.id,
      regexScriptName: script.script_name || "Regex Script"
    });
  }
  const items = Array.from(itemMap.values());
  const sectionCounts = {
    creator_notes: createEmptySectionSummary(),
    first_mes: createEmptySectionSummary(),
    core_fields: createEmptySectionSummary(),
    alternate_greetings: createEmptySectionSummary(),
    world_books: createEmptySectionSummary(),
    regex_scripts: createEmptySectionSummary()
  };
  const greetingMap = new Map;
  const worldBookMap = new Map;
  const domainMap = new Map;
  for (const item of items) {
    const seenSections = new Set;
    const seenGreetings = new Set;
    const seenWorldBooks = new Set;
    for (const src of item.sources) {
      if (!seenSections.has(src.section)) {
        seenSections.add(src.section);
        const summary = sectionCounts[src.section];
        summary.totalUnique++;
        if (item.status === "localized")
          summary.localizedCount++;
        else if (item.status === "failed")
          summary.failedCount++;
        else
          summary.remoteCount++;
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
              failedCount: 0
            };
            greetingMap.set(src.greetingIndex, gItem);
          }
          gItem.totalUnique++;
          if (item.status === "localized")
            gItem.localizedCount++;
          else if (item.status === "failed")
            gItem.failedCount++;
          else
            gItem.remoteCount++;
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
              failedCount: 0
            };
            worldBookMap.set(src.worldBookId, wbItem);
          }
          wbItem.totalUnique++;
          if (item.status === "localized")
            wbItem.localizedCount++;
          else if (item.status === "failed")
            wbItem.failedCount++;
          else
            wbItem.remoteCount++;
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
        failedCount: 0
      };
      domainMap.set(item.domain, dItem);
    }
    dItem.totalUnique++;
    if (item.status === "localized")
      dItem.localizedCount++;
    else if (item.status === "failed")
      dItem.failedCount++;
    else
      dItem.remoteCount++;
  }
  return {
    characterId: character.id,
    characterName: character.name,
    scannedAt: Date.now(),
    override: lookup.override ?? null,
    totalOccurrences,
    items,
    sectionCounts,
    greetingBreakdown: Array.from(greetingMap.values()).sort((a, b) => a.greetingIndex - b.greetingIndex),
    worldBookBreakdown: Array.from(worldBookMap.values()).sort((a, b) => a.worldBookName.localeCompare(b.worldBookName)),
    domainBreakdown: Array.from(domainMap.values()).sort((a, b) => b.totalUnique - a.totalUnique || a.domain.localeCompare(b.domain))
  };
}
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

// src/core/downloader.ts
var MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm"
};
var EXT_TO_MIME = {
  png: "image/png",
  apng: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm"
};
function validateRemoteMediaUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid media URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Disallowed media URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Media URLs must not contain embedded credentials");
  }
  if (isBlockedRemoteHostname(parsed.hostname)) {
    throw new Error(`Blocked private or local media host: ${parsed.hostname}`);
  }
  return parsed;
}
var TEXT_PREFIX_SCAN_BYTES = 16 * 1024;
function isAsciiPrintableOrSpaceByte(b) {
  return b === 9 || b === 10 || b === 13 || b >= 32 && b <= 126;
}
function decodeTextPrefix(bytes) {
  const prefix = bytes.subarray(0, Math.min(bytes.byteLength, TEXT_PREFIX_SCAN_BYTES));
  if (prefix.byteLength === 0)
    return "";
  if (prefix.byteLength >= 4) {
    const isUtf32Le = prefix[0] === 255 && prefix[1] === 254 && prefix[2] === 0 && prefix[3] === 0;
    const isUtf32Be = prefix[0] === 0 && prefix[1] === 0 && prefix[2] === 254 && prefix[3] === 255;
    if (isUtf32Le || isUtf32Be) {
      let out = "";
      for (let i = 4;i + 3 < prefix.byteLength; i += 4) {
        const cp = isUtf32Le ? (prefix[i] | prefix[i + 1] << 8 | prefix[i + 2] << 16 | prefix[i + 3] << 24) >>> 0 : (prefix[i] << 24 | prefix[i + 1] << 16 | prefix[i + 2] << 8 | prefix[i + 3]) >>> 0;
        if (cp >= 1 && cp <= 1114111) {
          out += String.fromCodePoint(cp);
        }
      }
      return out;
    }
  }
  if (prefix.byteLength >= 3 && prefix[0] === 239 && prefix[1] === 187 && prefix[2] === 191) {
    return new TextDecoder().decode(prefix.subarray(3));
  }
  if (prefix.byteLength >= 2 && prefix[0] === 255 && prefix[1] === 254) {
    const body = prefix.subarray(2);
    return new TextDecoder("utf-16le").decode(body.subarray(0, body.byteLength - body.byteLength % 2));
  }
  if (prefix.byteLength >= 2 && prefix[0] === 254 && prefix[1] === 255) {
    const body = prefix.subarray(2);
    return new TextDecoder("utf-16be").decode(body.subarray(0, body.byteLength - body.byteLength % 2));
  }
  if (prefix.byteLength >= 6) {
    const samplePairs = Math.min(Math.floor(prefix.byteLength / 2), 32);
    let leZeros = 0;
    let leChars = 0;
    let beZeros = 0;
    let beChars = 0;
    for (let p = 0;p < samplePairs; p++) {
      const b0 = prefix[p * 2];
      const b1 = prefix[p * 2 + 1];
      if (b1 === 0 && isAsciiPrintableOrSpaceByte(b0))
        leChars++;
      if (b1 === 0)
        leZeros++;
      if (b0 === 0 && isAsciiPrintableOrSpaceByte(b1))
        beChars++;
      if (b0 === 0)
        beZeros++;
    }
    if (leZeros === samplePairs && leChars === samplePairs) {
      return new TextDecoder("utf-16le").decode(prefix.subarray(0, prefix.byteLength - prefix.byteLength % 2));
    }
    if (beZeros === samplePairs && beChars === samplePairs) {
      return new TextDecoder("utf-16be").decode(prefix.subarray(0, prefix.byteLength - prefix.byteLength % 2));
    }
  }
  return new TextDecoder().decode(prefix);
}
function stripLeadingMarkupNoise(text) {
  let current = text.replace(/^\uFEFF/, "");
  let sawXmlDecl = false;
  while (true) {
    current = current.trimStart();
    if (current.startsWith("<!--")) {
      const end = current.indexOf("-->", 4);
      if (end === -1)
        break;
      current = current.slice(end + 3);
      continue;
    }
    if (current.startsWith("<?")) {
      if (/^<\?xml\b/i.test(current)) {
        sawXmlDecl = true;
      }
      const end = current.indexOf("?>", 2);
      if (end === -1)
        break;
      current = current.slice(end + 2);
      continue;
    }
    break;
  }
  return { stripped: current.trimStart(), sawXmlDecl };
}
function isPrintableTextPrefix(text) {
  if (!text)
    return false;
  let hasVisibleChar = false;
  const limit = Math.min(text.length, 4096);
  for (let i = 0;i < limit; i++) {
    const code = text.charCodeAt(i);
    if (code === 65533)
      return false;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      return false;
    }
    if (code > 32 && code !== 127) {
      hasVisibleChar = true;
    }
  }
  return hasVisibleChar;
}
function looksLikeJsonBody(bytes, strippedText) {
  if (!strippedText.startsWith("{") && !strippedText.startsWith("[")) {
    return false;
  }
  if (bytes.byteLength <= 64 * 1024) {
    try {
      JSON.parse(strippedText);
      return true;
    } catch {}
  }
  return /^(?:\{\s*(?:"(?:[^"\\]|\\.)*"\s*:|\})|\[\s*(?:\{|"|-?\d|true\b|false\b|null\b|\]))/.test(strippedText);
}
function detectMediaMimeType(bytes, headerMimeType, urlPath) {
  if (bytes.byteLength >= 12) {
    if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
      return { mimeType: "image/png", ext: "png" };
    }
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      return { mimeType: "image/jpeg", ext: "jpg" };
    }
    if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) {
      return { mimeType: "image/gif", ext: "gif" };
    }
    if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
      return { mimeType: "image/webp", ext: "webp" };
    }
    if (bytes[0] === 66 && bytes[1] === 77 && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0) {
      return { mimeType: "image/bmp", ext: "bmp" };
    }
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
      return { mimeType: "image/x-icon", ext: "ico" };
    }
    if (bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163) {
      return { mimeType: "video/webm", ext: "webm" };
    }
    if (bytes[4] === 102 && bytes[5] === 116 && bytes[6] === 121 && bytes[7] === 112) {
      const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0).toLowerCase();
      if (brand === "avif" || brand === "avis" || brand === "mif1") {
        return { mimeType: "image/avif", ext: "avif" };
      }
      return { mimeType: "video/mp4", ext: "mp4" };
    }
  }
  const headText = decodeTextPrefix(bytes);
  const { stripped: strippedHead, sawXmlDecl } = stripLeadingMarkupNoise(headText);
  const printableText = isPrintableTextPrefix(headText);
  if (/^<svg\b/i.test(strippedHead) || /^<!doctype\s+svg\b/i.test(strippedHead) || (sawXmlDecl || printableText) && (/<svg[\s>/]/i.test(headText) || /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(headText))) {
    throw new Error("SVG media is disallowed for security reasons");
  }
  if (/^<script\b/i.test(strippedHead) || printableText && /<script[\s>/]/i.test(headText)) {
    throw new Error("Remote server returned script content instead of media");
  }
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b|<title\b|<meta\b|<iframe\b|<object\b|<embed\b|<style\b)/i.test(strippedHead) || printableText && /<(?:!doctype\s+html|html|head|body|iframe|object|embed)\b/i.test(headText)) {
    throw new Error("Remote server returned an HTML page instead of media");
  }
  if (sawXmlDecl || printableText && (/^<!--/.test(strippedHead) || /^<[a-zA-Z_][\w:-]*(?:\s[^>]*)?>/.test(strippedHead))) {
    throw new Error("Remote server returned XML/markup content instead of media");
  }
  const cleanHeader = (headerMimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (cleanHeader === "image/svg+xml" || cleanHeader === "image/svg") {
    throw new Error("SVG media (image/svg+xml) is disallowed for security reasons");
  }
  if (cleanHeader.startsWith("text/") || cleanHeader === "application/json" || cleanHeader.endsWith("+json") || cleanHeader === "application/xml" || cleanHeader.endsWith("+xml") || cleanHeader === "application/xhtml+xml" || cleanHeader === "application/javascript" || cleanHeader === "application/ecmascript") {
    throw new Error(`Unsupported response content-type: ${cleanHeader}`);
  }
  if (printableText) {
    if (looksLikeJsonBody(bytes, strippedHead)) {
      throw new Error("Unrecognized media format: remote server returned JSON instead of media");
    }
    if (bytes.byteLength >= 8) {
      throw new Error("Unrecognized media format: remote server returned plain text instead of media");
    }
  }
  if (cleanHeader && MIME_TO_EXT[cleanHeader]) {
    return { mimeType: cleanHeader, ext: MIME_TO_EXT[cleanHeader] };
  }
  if (urlPath) {
    const extMatch = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(urlPath);
    const ext = extMatch?.[1]?.toLowerCase() ?? "";
    if (ext === "svg") {
      throw new Error("SVG media is disallowed for security reasons");
    }
    if (ext && EXT_TO_MIME[ext]) {
      const mime = EXT_TO_MIME[ext];
      return { mimeType: mime, ext: MIME_TO_EXT[mime] ?? ext };
    }
  }
  throw new Error(`Unrecognized media format${cleanHeader ? ` (content-type: ${cleanHeader})` : ""}`);
}
function deriveBaseFilename(normalizedUrl, ext) {
  try {
    const parsed = new URL(normalizedUrl);
    const lastSeg = parsed.pathname.split("/").filter(Boolean).pop() ?? "media";
    const cleaned = lastSeg.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 48);
    return `${cleaned || "media"}.${ext}`;
  } catch {
    return `media.${ext}`;
  }
}
function areUint8ArraysEqual(a, b) {
  if (a.byteLength !== b.byteLength)
    return false;
  for (let i = 0;i < a.byteLength; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
function getHeaderCaseInsensitive(headers, targetName) {
  if (!headers || typeof headers !== "object")
    return;
  const lowerTarget = targetName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lowerTarget && typeof v === "string") {
      return v;
    }
  }
  return;
}
async function raceWithSignalAndTimeout(promise, timeoutMs, signal) {
  signal?.throwIfAborted();
  promise.catch(() => {});
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const onAbort = () => {
      if (settled)
        return;
      settled = true;
      cleanup();
      const reason = signal?.reason;
      reject(reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled)
          return;
        settled = true;
        cleanup();
        reject(new Error(`Download timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    promise.then((val) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      resolve(val);
    }, (err) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(err);
    });
  });
}
function decodeCorsBase64Body(body, maxBytes) {
  const prefixMatch = /^\s*data:[^;]{1,64};base64,/i.exec(body.slice(0, 128));
  const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
  const maxRawChars = Math.ceil(maxBytes / 3) * 4 + 4096;
  if (body.length - prefixLen > maxRawChars * 1.1) {
    throw new Error(`File size exceeds limit (${maxBytes} bytes)`);
  }
  const stripped = (prefixLen > 0 ? body.slice(prefixLen) : body).replace(/\s+/g, "");
  if (stripped.length === 0) {
    throw new Error("Downloaded file is empty (0 bytes)");
  }
  let padCount = 0;
  if (stripped.endsWith("=="))
    padCount = 2;
  else if (stripped.endsWith("="))
    padCount = 1;
  const estimatedBytes = Math.floor(stripped.length * 3 / 4) - padCount;
  if (estimatedBytes > maxBytes) {
    throw new Error(`File size (~${estimatedBytes} bytes) exceeds limit (${maxBytes} bytes)`);
  }
  let binaryStr;
  try {
    binaryStr = atob(stripped);
  } catch {
    throw new Error("CORS proxy returned invalid base64 response body");
  }
  if (binaryStr.length === 0) {
    throw new Error("Downloaded file is empty (0 bytes)");
  }
  if (binaryStr.length > maxBytes) {
    throw new Error(`File size (${binaryStr.length} bytes) exceeds limit (${maxBytes} bytes)`);
  }
  const decoded = new Uint8Array(binaryStr.length);
  for (let i = 0;i < binaryStr.length; i++) {
    decoded[i] = binaryStr.charCodeAt(i);
  }
  return decoded;
}
async function downloadAndStoreMedia(spindle2, options) {
  const {
    userId,
    characterId,
    normalizedUrl,
    rawUrls,
    maxBytes,
    timeoutMs,
    signal,
    unmatchedGalleryCandidates
  } = options;
  signal?.throwIfAborted();
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("Invalid maxBytes limit");
  }
  const validatedUrl = validateRemoteMediaUrl(normalizedUrl);
  const fetchUrl = validatedUrl.href;
  let bytes;
  let headerMime;
  if (spindle2.files && typeof spindle2.files.fetch === "function") {
    const staged = await spindle2.files.fetch(fetchUrl, {
      userId,
      fileName: "remote_media.bin",
      maxBytes,
      timeoutMs,
      signal
    });
    headerMime = staged.mimeType;
    try {
      signal?.throwIfAborted();
      if (!Number.isFinite(staged.size) || staged.size <= 0) {
        throw new Error("Downloaded file is empty (0 bytes)");
      }
      if (staged.size > maxBytes) {
        throw new Error(`File size (${staged.size} bytes) exceeds limit (${maxBytes} bytes)`);
      }
      const chunks = [];
      let offset = 0;
      while (offset < staged.size) {
        signal?.throwIfAborted();
        const chunk = await spindle2.files.readChunk({ fileId: staged.fileId }, offset, userId);
        if (!chunk || !chunk.data || chunk.data.byteLength === 0)
          break;
        if (offset + chunk.data.byteLength > staged.size || offset + chunk.data.byteLength > maxBytes) {
          throw new Error(`Downloaded chunk exceeds declared or allowed size (${offset + chunk.data.byteLength} bytes)`);
        }
        chunks.push(chunk.data);
        offset += chunk.data.byteLength;
        if (chunk.eof)
          break;
      }
      if (offset !== staged.size) {
        throw new Error(`Download incomplete (${offset} of ${staged.size} bytes read)`);
      }
      const merged = new Uint8Array(offset);
      let cursor = 0;
      for (const c of chunks) {
        merged.set(c, cursor);
        cursor += c.byteLength;
      }
      bytes = merged;
    } finally {
      try {
        await spindle2.files.delete(staged.fileId, userId);
      } catch {}
    }
  } else {
    const rawResponse = await raceWithSignalAndTimeout(spindle2.cors(fetchUrl, {
      method: "GET",
      responseType: "arraybuffer",
      mediaType: "image"
    }), timeoutMs, signal);
    signal?.throwIfAborted();
    const response = rawResponse ?? {};
    const status = typeof response.status === "number" ? response.status : 0;
    if (status < 200 || status >= 300) {
      throw new Error(`Download failed: HTTP ${status}`);
    }
    headerMime = getHeaderCaseInsensitive(response.headers, "content-type");
    const body = response.body;
    if (body instanceof Uint8Array) {
      bytes = body;
    } else if (body instanceof ArrayBuffer) {
      if (body.byteLength > maxBytes) {
        throw new Error(`File size (${body.byteLength} bytes) exceeds limit (${maxBytes} bytes)`);
      }
      bytes = new Uint8Array(body);
    } else if (typeof body === "string") {
      bytes = decodeCorsBase64Body(body, maxBytes);
    } else {
      throw new Error("Unexpected response body format from CORS proxy");
    }
    if (bytes.byteLength === 0) {
      throw new Error("Downloaded file is empty (0 bytes)");
    }
    if (bytes.byteLength > maxBytes) {
      throw new Error(`File size (${bytes.byteLength} bytes) exceeds limit (${maxBytes} bytes)`);
    }
  }
  signal?.throwIfAborted();
  const { mimeType, ext } = detectMediaMimeType(bytes, headerMime, fetchUrl);
  if (mimeType === "image/svg+xml") {
    throw new Error("SVG media is disallowed for security reasons");
  }
  const filename = deriveBaseFilename(fetchUrl, ext);
  if (unmatchedGalleryCandidates && unmatchedGalleryCandidates.length > 0 && typeof spindle2.images?.readBinary === "function") {
    for (const cand of unmatchedGalleryCandidates) {
      signal?.throwIfAborted();
      if (cand.byteSize !== undefined && cand.byteSize > 0 && cand.byteSize !== bytes.byteLength) {
        continue;
      }
      try {
        const existingBytes = await spindle2.images.readBinary(cand.imageId, userId);
        if (existingBytes && areUint8ArraysEqual(bytes, existingBytes)) {
          return {
            normalizedUrl,
            rawUrls: Array.from(new Set([...rawUrls, normalizedUrl])),
            imageId: cand.imageId,
            localUrl: `/api/v1/images/${cand.imageId}`,
            mimeType: cand.mimeType && cand.mimeType !== "image/svg+xml" ? cand.mimeType : mimeType,
            sizeBytes: bytes.byteLength,
            filename,
            characterIds: [characterId],
            ...cand.galleryItemId ? { galleryItemIds: { [characterId]: cand.galleryItemId } } : {},
            localizedAt: Date.now(),
            reusedExistingImage: true
          };
        }
      } catch {}
    }
  }
  signal?.throwIfAborted();
  const uploaded = await spindle2.images.upload({
    data: bytes,
    filename,
    mime_type: mimeType,
    owner_character_id: characterId
  }, userId);
  return {
    normalizedUrl,
    rawUrls: Array.from(new Set([...rawUrls, normalizedUrl])),
    imageId: uploaded.id,
    localUrl: uploaded.url || `/api/v1/images/${uploaded.id}`,
    mimeType: uploaded.mime_type || mimeType,
    sizeBytes: bytes.byteLength,
    filename,
    characterIds: [characterId],
    localizedAt: Date.now()
  };
}

// src/core/gallery-reconciler.ts
var GENERIC_PLACEHOLDER_FILENAME_RE = /^(?:extracted|image|img|media|download|file|unnamed|untitled|photo|pic|picture|thumb|thumbnail|avatar|portrait|banner|background|bg)(?:_[0-9]+)?(?:\.[a-z0-9]{2,5})?$/i;
var REMOTE_GALLERY_AUTONAME_RE = /^(?:remote_gallery_|gallery_)[0-9a-f_-]+(?:\.[a-z0-9]{2,5})?$/i;
var EXTRACTED_FILENAME_RE = /^extracted\.([a-z0-9]{2,5})$/i;
function isGenericPlaceholderFilename(filename) {
  const trimmed = filename.trim();
  if (!trimmed)
    return true;
  if (GENERIC_PLACEHOLDER_FILENAME_RE.test(trimmed))
    return true;
  if (REMOTE_GALLERY_AUTONAME_RE.test(trimmed))
    return true;
  return false;
}
function normalizeExt(extOrMime) {
  const lower = extOrMime.trim().toLowerCase().replace(/^\./, "");
  if (lower === "jpeg" || lower === "jfif" || lower === "pjp" || lower === "pjpeg" || lower === "image/jpeg") {
    return "jpg";
  }
  if (lower === "image/png" || lower === "apng")
    return "png";
  if (lower === "image/webp")
    return "webp";
  if (lower === "image/gif")
    return "gif";
  if (lower === "image/avif")
    return "avif";
  if (lower === "image/svg+xml")
    return "svg";
  if (lower === "image/bmp")
    return "bmp";
  if (lower === "image/x-icon" || lower === "ico")
    return "ico";
  return lower;
}
function areExtensionsCompatible(urlExt, candidateExt) {
  if (!urlExt || !candidateExt)
    return true;
  return normalizeExt(urlExt) === normalizeExt(candidateExt);
}
var IMAGE_METADATA_FETCH_CONCURRENCY = 6;
async function fetchMissingImageMetadata(spindle2, userId, imageIds, imageMetaById) {
  const confirmedMissingIds = new Set;
  const imagesApi = spindle2.images;
  if (!imagesApi || typeof imagesApi.get !== "function") {
    return confirmedMissingIds;
  }
  const pendingIds = [];
  const seen = new Set;
  for (const id of imageIds) {
    if (!id || seen.has(id) || imageMetaById.has(id))
      continue;
    seen.add(id);
    pendingIds.push(id);
  }
  if (pendingIds.length === 0) {
    return confirmedMissingIds;
  }
  let cursor = 0;
  const workerCount = Math.min(IMAGE_METADATA_FETCH_CONCURRENCY, pendingIds.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < pendingIds.length) {
      const imageId = pendingIds[cursor++];
      if (!imageId)
        continue;
      try {
        const img = await imagesApi.get(imageId, userId);
        if (img) {
          imageMetaById.set(img.id, img);
        } else {
          confirmedMissingIds.add(imageId);
        }
      } catch {}
    }
  }));
  return confirmedMissingIds;
}
async function reconcileCharacterGalleryWithIndex(spindle2, indexStore, userId, character, scanItems) {
  let galleryItems = null;
  if (typeof spindle2.characters?.getGallery === "function") {
    try {
      const res = await spindle2.characters.getGallery(character.id, userId);
      if (Array.isArray(res)) {
        galleryItems = res;
      }
    } catch {
      galleryItems = null;
    }
  }
  const imageMetaById = new Map;
  if (typeof spindle2.images?.list === "function") {
    try {
      let offset = 0;
      const pageLimit = 200;
      for (let page = 0;page < 25; page++) {
        const listRes = await spindle2.images.list({
          characterId: character.id,
          limit: pageLimit,
          offset,
          userId
        });
        const rows = Array.isArray(listRes?.data) ? listRes.data : [];
        if (rows.length === 0)
          break;
        for (const img of rows) {
          if (img && typeof img.id === "string") {
            imageMetaById.set(img.id, img);
          }
        }
        offset += rows.length;
        const total = typeof listRes?.total === "number" ? listRes.total : undefined;
        if (total !== undefined ? offset >= total : rows.length < pageLimit)
          break;
      }
    } catch {}
  }
  const expressionInfo = collectCharacterExpressionImageIds(character.extensions);
  const chubExprUrlMap = extractChubExpressionUrlMapFromExtensions(character.extensions);
  const galleryByImageId = new Map;
  if (galleryItems) {
    for (const item of galleryItems) {
      if (!item || typeof item.image_id !== "string")
        continue;
      if (!galleryByImageId.has(item.image_id)) {
        galleryByImageId.set(item.image_id, item);
      }
    }
  }
  await fetchMissingImageMetadata(spindle2, userId, [...galleryByImageId.keys(), ...expressionInfo.allImageIds], imageMetaById);
  const candidates = [];
  if (galleryItems) {
    for (const gItem of galleryItems) {
      const meta = imageMetaById.get(gItem.image_id);
      candidates.push({
        imageId: gItem.image_id,
        galleryItemId: gItem.id,
        caption: gItem.caption ?? "",
        originalFilename: meta?.original_filename ?? "",
        mimeType: meta?.mime_type || gItem.mime_type || "image/png",
        byteSize: meta?.byte_size ?? meta?.size ?? 0,
        sortOrder: typeof gItem.sort_order === "number" ? gItem.sort_order : 0,
        createdAt: String(gItem.created_at ?? meta?.created_at ?? "")
      });
    }
  } else {
    let idx = 0;
    for (const rawMeta of imageMetaById.values()) {
      const meta = rawMeta;
      candidates.push({
        imageId: meta.id,
        caption: "",
        originalFilename: meta.original_filename ?? "",
        mimeType: meta.mime_type || "image/png",
        byteSize: meta?.byte_size ?? meta?.size ?? 0,
        sortOrder: idx++,
        createdAt: String(meta.created_at ?? "")
      });
    }
  }
  const initialState = await indexStore.getState(userId);
  const verifyMissingIds = [];
  for (const entry of Object.values(initialState.assets)) {
    if (!entry.characterIds.includes(character.id))
      continue;
    const knownGalleryItemId = entry.galleryItemIds && Object.hasOwn(entry.galleryItemIds, character.id) ? entry.galleryItemIds[character.id] : undefined;
    const inNativeGallery = galleryByImageId.has(entry.imageId);
    const inNativeExpressions = expressionInfo.allImageIds.has(entry.imageId);
    if (knownGalleryItemId === NATIVE_EXPRESSION_SENTINEL) {
      if (!inNativeExpressions && !inNativeGallery)
        continue;
    } else if (galleryItems !== null && knownGalleryItemId && !inNativeGallery) {
      continue;
    }
    if (!inNativeGallery && !imageMetaById.has(entry.imageId)) {
      verifyMissingIds.push(entry.imageId);
    }
  }
  const confirmedMissingIds = await fetchMissingImageMetadata(spindle2, userId, verifyMissingIds, new Map);
  const {
    result: { indexChanged, prunedCount, adoptedCount, claimedImageIds }
  } = await indexStore.batchUpdate(userId, (tx) => {
    const state = tx.state;
    const adoptEnabled = state.settings.adoptNativeGalleryImages;
    let localIndexChanged = false;
    let localPrunedCount = 0;
    let localAdoptedCount = 0;
    const pendingSyncLinks = [];
    for (const entry of Object.values(state.assets)) {
      if (!entry.characterIds.includes(character.id))
        continue;
      const knownGalleryItemId = entry.galleryItemIds && Object.hasOwn(entry.galleryItemIds, character.id) ? entry.galleryItemIds[character.id] : undefined;
      const inNativeGallery = galleryByImageId.has(entry.imageId);
      const inNativeExpressions = expressionInfo.allImageIds.has(entry.imageId);
      if (knownGalleryItemId === NATIVE_EXPRESSION_SENTINEL) {
        if (!inNativeExpressions && !inNativeGallery) {
          const removed = tx.unlinkByCharacterImageId(character.id, entry.imageId, undefined);
          if (removed > 0) {
            localPrunedCount += removed;
            localIndexChanged = true;
          }
          continue;
        }
      } else if (galleryItems !== null && knownGalleryItemId && !inNativeGallery) {
        const removed = tx.unlinkByCharacterImageId(character.id, entry.imageId, knownGalleryItemId);
        if (removed > 0) {
          localPrunedCount += removed;
          localIndexChanged = true;
        }
        continue;
      }
      if (inNativeGallery) {
        const gItem = galleryByImageId.get(entry.imageId);
        if (knownGalleryItemId !== gItem.id) {
          pendingSyncLinks.push({
            characterId: character.id,
            normalizedUrl: entry.normalizedUrl,
            imageId: entry.imageId,
            galleryItemId: gItem.id
          });
        }
        continue;
      }
      if (!imageMetaById.has(entry.imageId) && confirmedMissingIds.has(entry.imageId)) {
        const removed = tx.removeByImageId(entry.imageId);
        if (removed > 0) {
          localPrunedCount += removed;
          localIndexChanged = true;
        }
      }
    }
    if (pendingSyncLinks.length > 0) {
      const synced = tx.recordGalleryLinks(pendingSyncLinks);
      if (synced > 0) {
        localIndexChanged = true;
      }
    }
    const localClaimedImageIds = new Set;
    const existingAssetByImageId = new Map;
    for (const entry of Object.values(state.assets)) {
      existingAssetByImageId.set(entry.imageId, entry);
      if (entry.characterIds.includes(character.id)) {
        localClaimedImageIds.add(entry.imageId);
      }
    }
    const unlocalizedByUrl = new Map;
    for (const item of scanItems) {
      if (item.mediaKind !== "image")
        continue;
      const existing = Object.hasOwn(state.assets, item.normalizedUrl) ? state.assets[item.normalizedUrl] : undefined;
      if (!existing || !existing.characterIds.includes(character.id)) {
        unlocalizedByUrl.set(item.normalizedUrl, item);
      }
    }
    const adoptCandidateForScanItem = (cand, item) => {
      const ext = normalizeExt(cand.mimeType);
      const filename = cand.originalFilename && !isGenericPlaceholderFilename(cand.originalFilename) ? cand.originalFilename : deriveBaseFilename(item.normalizedUrl, ext || "png");
      tx.recordLocalizedAsset({
        normalizedUrl: item.normalizedUrl,
        rawUrls: item.rawUrls,
        imageId: cand.imageId,
        localUrl: `/api/v1/images/${cand.imageId}`,
        mimeType: cand.mimeType || "image/png",
        sizeBytes: cand.byteSize || 0,
        filename,
        characterIds: [character.id],
        ...cand.galleryItemId ? { galleryItemIds: { [character.id]: cand.galleryItemId } } : {},
        localizedAt: Date.now()
      });
      localClaimedImageIds.add(cand.imageId);
      unlocalizedByUrl.delete(item.normalizedUrl);
      localAdoptedCount++;
      localIndexChanged = true;
    };
    if (adoptEnabled && chubExprUrlMap.size > 0 && expressionInfo.byLabel.size > 0 && unlocalizedByUrl.size > 0) {
      for (const [label, exprUrlInfo] of chubExprUrlMap.entries()) {
        const scanItem = unlocalizedByUrl.get(exprUrlInfo.normalizedUrl);
        if (!scanItem)
          continue;
        const exprImageId = expressionInfo.byLabel.get(label) ?? expressionInfo.byLabel.get(label.toLowerCase());
        if (!exprImageId)
          continue;
        const meta = imageMetaById.get(exprImageId);
        if (imageMetaById.size > 0 && !meta)
          continue;
        adoptCandidateForScanItem({
          imageId: exprImageId,
          galleryItemId: NATIVE_EXPRESSION_SENTINEL,
          caption: `Expression: ${label}`,
          originalFilename: meta?.original_filename ?? "",
          mimeType: meta?.mime_type || "image/png",
          byteSize: meta?.byte_size ?? meta?.size ?? 0,
          sortOrder: 0,
          createdAt: String(meta?.created_at ?? "")
        }, scanItem);
      }
    }
    for (const cand of candidates) {
      if (localClaimedImageIds.has(cand.imageId))
        continue;
      const knownEntry = existingAssetByImageId.get(cand.imageId);
      if (knownEntry) {
        const scanItem = unlocalizedByUrl.get(knownEntry.normalizedUrl);
        if (scanItem) {
          const linked = tx.linkExistingAssetToCharacter(knownEntry.normalizedUrl, scanItem.rawUrls, character.id, cand.galleryItemId);
          if (linked) {
            localClaimedImageIds.add(cand.imageId);
            unlocalizedByUrl.delete(knownEntry.normalizedUrl);
            localAdoptedCount++;
            localIndexChanged = true;
          }
          continue;
        }
      }
      const captionTrimmed = cand.caption.trim();
      if (adoptEnabled && captionTrimmed) {
        let matchedItem;
        for (const item of unlocalizedByUrl.values()) {
          if (captionTrimmed === item.normalizedUrl || captionTrimmed.includes(item.normalizedUrl) || item.rawUrls.some((r) => captionTrimmed === r || captionTrimmed.includes(r))) {
            matchedItem = item;
            break;
          }
        }
        if (matchedItem) {
          adoptCandidateForScanItem(cand, matchedItem);
        }
      }
    }
    for (const cand of candidates) {
      if (!adoptEnabled)
        break;
      if (localClaimedImageIds.has(cand.imageId))
        continue;
      if (unlocalizedByUrl.size === 0)
        break;
      const nameCandidates = [cand.originalFilename, cand.caption].map((s) => s.trim()).filter((s) => s.length > 0 && !isGenericPlaceholderFilename(s));
      if (nameCandidates.length === 0)
        continue;
      let matchedItem;
      for (const rawName of nameCandidates) {
        const lowerName = rawName.toLowerCase();
        const stemName = lowerName.replace(/\.[a-z0-9]{2,5}$/i, "");
        const candExt = normalizeExt(/\.([a-z0-9]{2,5})$/i.exec(lowerName)?.[1] || cand.mimeType);
        for (const item of unlocalizedByUrl.values()) {
          const parts = deriveUrlFilenameParts(item.normalizedUrl);
          const itemBaseLower = parts.basename.toLowerCase();
          const itemCleanBaseLower = parts.ext ? `${parts.cleanedStem.toLowerCase()}.${parts.ext.toLowerCase()}` : parts.cleanedStem.toLowerCase();
          const itemStemLower = parts.cleanedStem.toLowerCase();
          if (itemBaseLower === lowerName || itemCleanBaseLower === lowerName) {
            matchedItem = item;
            break;
          }
          if (stemName.length >= 3 && itemStemLower === stemName && areExtensionsCompatible(parts.ext, candExt)) {
            matchedItem = item;
            break;
          }
        }
        if (matchedItem)
          break;
      }
      if (matchedItem) {
        adoptCandidateForScanItem(cand, matchedItem);
      }
    }
    const extractedCandidates = candidates.filter((c) => !localClaimedImageIds.has(c.imageId) && EXTRACTED_FILENAME_RE.test(c.originalFilename.trim())).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    if (adoptEnabled && extractedCandidates.length > 0 && unlocalizedByUrl.size > 0) {
      const nativeExtractUrls = extractNativeGalleryUrlsFromCharacter(character);
      const availableExtractItems = [];
      for (const url of nativeExtractUrls) {
        const item = unlocalizedByUrl.get(url);
        if (item && !availableExtractItems.includes(item)) {
          availableExtractItems.push(item);
        }
      }
      for (const cand of extractedCandidates) {
        if (availableExtractItems.length === 0)
          break;
        const extFromName = EXTRACTED_FILENAME_RE.exec(cand.originalFilename.trim())?.[1] ?? "";
        const candExt = normalizeExt(extFromName || cand.mimeType);
        const matchIdx = availableExtractItems.findIndex((item) => {
          const parts = deriveUrlFilenameParts(item.normalizedUrl);
          return areExtensionsCompatible(parts.ext, candExt);
        });
        if (matchIdx === -1)
          continue;
        const [matchedItem] = availableExtractItems.splice(matchIdx, 1);
        if (matchedItem) {
          adoptCandidateForScanItem(cand, matchedItem);
        }
      }
    }
    return {
      indexChanged: localIndexChanged,
      prunedCount: localPrunedCount,
      adoptedCount: localAdoptedCount,
      claimedImageIds: localClaimedImageIds
    };
  });
  const finalState = await indexStore.getState(userId);
  const pendingGalleryLinks = [];
  const seenPendingImageIds = new Set;
  for (const item of scanItems) {
    if (item.mediaKind !== "image")
      continue;
    const entry = Object.hasOwn(finalState.assets, item.normalizedUrl) ? finalState.assets[item.normalizedUrl] : undefined;
    if (!entry || !entry.characterIds.includes(character.id))
      continue;
    if (!entry.mimeType.startsWith("image/"))
      continue;
    const alreadyInGallery = galleryByImageId.has(entry.imageId) || Boolean(entry.galleryItemIds && Object.hasOwn(entry.galleryItemIds, character.id) && entry.galleryItemIds[character.id]) || expressionInfo.allImageIds.has(entry.imageId);
    if (!alreadyInGallery && !seenPendingImageIds.has(entry.imageId)) {
      seenPendingImageIds.add(entry.imageId);
      pendingGalleryLinks.push({
        characterId: character.id,
        imageId: entry.imageId,
        normalizedUrl: item.normalizedUrl,
        caption: entry.filename || item.sources[0]?.label || ""
      });
    }
  }
  const unmatchedGalleryCandidates = candidates.filter((c) => !claimedImageIds.has(c.imageId)).map((c) => ({
    imageId: c.imageId,
    galleryItemId: expressionInfo.allImageIds.has(c.imageId) ? c.galleryItemId ?? NATIVE_EXPRESSION_SENTINEL : c.galleryItemId,
    byteSize: c.byteSize,
    mimeType: c.mimeType
  }));
  const seenCandidateImageIds = new Set(unmatchedGalleryCandidates.map((c) => c.imageId));
  for (const exprImageId of expressionInfo.allImageIds) {
    if (claimedImageIds.has(exprImageId) || seenCandidateImageIds.has(exprImageId)) {
      continue;
    }
    const meta = imageMetaById.get(exprImageId);
    unmatchedGalleryCandidates.push({
      imageId: exprImageId,
      galleryItemId: NATIVE_EXPRESSION_SENTINEL,
      byteSize: meta?.byte_size ?? meta?.size ?? 0,
      mimeType: meta?.mime_type || "image/png"
    });
    seenCandidateImageIds.add(exprImageId);
  }
  return {
    indexChanged,
    adoptedCount,
    prunedCount,
    pendingGalleryLinks,
    unmatchedGalleryCandidates
  };
}
function refreshScanResultWithIndexState(scan, assets, failedUrls) {
  for (const sec of Object.keys(scan.sectionCounts)) {
    scan.sectionCounts[sec] = {
      totalUnique: 0,
      remoteCount: 0,
      localizedCount: 0,
      failedCount: 0
    };
  }
  const greetingMap = new Map;
  const worldBookMap = new Map;
  const domainMap = new Map;
  for (const item of scan.items) {
    const localized = Object.hasOwn(assets, item.normalizedUrl) ? assets[item.normalizedUrl] : undefined;
    const failure = Object.hasOwn(failedUrls, item.normalizedUrl) ? failedUrls[item.normalizedUrl] : undefined;
    if (localized) {
      item.status = "localized";
      item.localizedEntry = localized;
      delete item.failureInfo;
    } else if (failure) {
      item.status = "failed";
      item.failureInfo = failure;
      delete item.localizedEntry;
    } else {
      item.status = "remote";
      delete item.localizedEntry;
      delete item.failureInfo;
    }
    const seenSections = new Set;
    const seenGreetings = new Set;
    const seenWorldBooks = new Set;
    for (const src of item.sources) {
      if (!seenSections.has(src.section)) {
        seenSections.add(src.section);
        const summary = scan.sectionCounts[src.section];
        summary.totalUnique++;
        if (item.status === "localized")
          summary.localizedCount++;
        else if (item.status === "failed")
          summary.failedCount++;
        else
          summary.remoteCount++;
      }
      if (src.section === "alternate_greetings" && typeof src.greetingIndex === "number" && !seenGreetings.has(src.greetingIndex)) {
        seenGreetings.add(src.greetingIndex);
        let g = greetingMap.get(src.greetingIndex);
        if (!g) {
          g = {
            greetingIndex: src.greetingIndex,
            label: src.label,
            totalUnique: 0,
            remoteCount: 0,
            localizedCount: 0,
            failedCount: 0
          };
          greetingMap.set(src.greetingIndex, g);
        }
        g.totalUnique++;
        if (item.status === "localized")
          g.localizedCount++;
        else if (item.status === "failed")
          g.failedCount++;
        else
          g.remoteCount++;
      }
      if (src.section === "world_books" && src.worldBookId && !seenWorldBooks.has(src.worldBookId)) {
        seenWorldBooks.add(src.worldBookId);
        let wb = worldBookMap.get(src.worldBookId);
        if (!wb) {
          wb = {
            worldBookId: src.worldBookId,
            worldBookName: src.worldBookName || src.worldBookId,
            totalUnique: 0,
            remoteCount: 0,
            localizedCount: 0,
            failedCount: 0
          };
          worldBookMap.set(src.worldBookId, wb);
        }
        wb.totalUnique++;
        if (item.status === "localized")
          wb.localizedCount++;
        else if (item.status === "failed")
          wb.failedCount++;
        else
          wb.remoteCount++;
      }
    }
    let d = domainMap.get(item.domain);
    if (!d) {
      d = {
        domain: item.domain,
        totalUnique: 0,
        remoteCount: 0,
        localizedCount: 0,
        failedCount: 0
      };
      domainMap.set(item.domain, d);
    }
    d.totalUnique++;
    if (item.status === "localized")
      d.localizedCount++;
    else if (item.status === "failed")
      d.failedCount++;
    else
      d.remoteCount++;
  }
  scan.greetingBreakdown = Array.from(greetingMap.values()).sort((a, b) => a.greetingIndex - b.greetingIndex);
  scan.worldBookBreakdown = Array.from(worldBookMap.values()).sort((a, b) => a.worldBookName.localeCompare(b.worldBookName));
  scan.domainBreakdown = Array.from(domainMap.values()).sort((a, b) => b.totalUnique - a.totalUnique || a.domain.localeCompare(b.domain));
  return scan;
}

// src/shared/download-config.ts
function uniqueStrings(values) {
  if (!Array.isArray(values))
    return;
  const out = [];
  const seen = new Set;
  for (const item of values) {
    if (typeof item !== "string")
      continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed))
      continue;
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

// src/core/index-store.ts
var INDEX_FILE = "media_index.json";
var UNSAFE_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isSafeRecordKey(key) {
  return typeof key === "string" && key.length > 0 && !UNSAFE_RECORD_KEYS.has(key);
}
function createNullProtoRecord() {
  return Object.create(null);
}
function getOwnRecordValue(record, key) {
  if (!record || !isSafeRecordKey(key))
    return;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
function setOwnRecordValue(record, key, value) {
  if (!isSafeRecordKey(key))
    return false;
  record[key] = value;
  return true;
}
function deleteOwnRecordValue(record, key) {
  if (!isSafeRecordKey(key) || !Object.hasOwn(record, key))
    return false;
  delete record[key];
  return true;
}
function createDefaultUserState() {
  return {
    version: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      defaultSections: [...DEFAULT_SETTINGS.defaultSections],
      defaultMediaKinds: [...DEFAULT_SETTINGS.defaultMediaKinds]
    },
    characterOverrides: createNullProtoRecord(),
    autoLocalizedCharacterIds: [],
    assets: createNullProtoRecord(),
    failedUrls: createNullProtoRecord()
  };
}
function cloneOverride(o) {
  const copy = {};
  if (o.sections)
    copy.sections = [...o.sections];
  if (o.greetingIndices)
    copy.greetingIndices = [...o.greetingIndices];
  if (o.worldBookIds)
    copy.worldBookIds = [...o.worldBookIds];
  if (o.domains)
    copy.domains = [...o.domains];
  if (o.mediaKinds)
    copy.mediaKinds = [...o.mediaKinds];
  if (o.includeFailed !== undefined)
    copy.includeFailed = o.includeFailed;
  if (o.maxItems !== undefined)
    copy.maxItems = o.maxItems;
  if (o.excludedUrls)
    copy.excludedUrls = [...o.excludedUrls];
  return copy;
}
function cloneUserState(state) {
  const characterOverrides = createNullProtoRecord();
  for (const [k, v] of Object.entries(state.characterOverrides)) {
    if (isSafeRecordKey(k)) {
      characterOverrides[k] = cloneOverride(v);
    }
  }
  const assets = createNullProtoRecord();
  for (const [k, entry] of Object.entries(state.assets)) {
    if (!isSafeRecordKey(k))
      continue;
    let galleryItemIds;
    if (entry.galleryItemIds) {
      galleryItemIds = createNullProtoRecord();
      for (const [cid, gid] of Object.entries(entry.galleryItemIds)) {
        if (isSafeRecordKey(cid) && typeof gid === "string") {
          galleryItemIds[cid] = gid;
        }
      }
    }
    assets[k] = {
      ...entry,
      rawUrls: [...entry.rawUrls],
      characterIds: [...entry.characterIds],
      ...galleryItemIds ? { galleryItemIds } : {}
    };
  }
  const failedUrls = createNullProtoRecord();
  for (const [k, rec] of Object.entries(state.failedUrls)) {
    if (isSafeRecordKey(k)) {
      failedUrls[k] = { ...rec };
    }
  }
  return {
    version: 1,
    settings: {
      ...state.settings,
      defaultSections: [...state.settings.defaultSections],
      defaultMediaKinds: [...state.settings.defaultMediaKinds]
    },
    characterOverrides,
    autoLocalizedCharacterIds: [...state.autoLocalizedCharacterIds],
    assets,
    failedUrls
  };
}
function sanitizeSettings(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_SETTINGS,
      defaultSections: [...DEFAULT_SETTINGS.defaultSections],
      defaultMediaKinds: [...DEFAULT_SETTINGS.defaultMediaKinds]
    };
  }
  const obj = raw;
  const validSections = Array.isArray(obj.defaultSections) ? obj.defaultSections.filter((s) => typeof s === "string" && ALL_MEDIA_SECTIONS.includes(s)) : [...DEFAULT_SETTINGS.defaultSections];
  const validKinds = Array.isArray(obj.defaultMediaKinds) ? obj.defaultMediaKinds.filter((k) => typeof k === "string" && ALL_MEDIA_KINDS.includes(k)) : [...DEFAULT_SETTINGS.defaultMediaKinds];
  return {
    defaultSections: validSections.length > 0 ? Array.from(new Set(validSections)) : [...DEFAULT_SETTINGS.defaultSections],
    defaultMediaKinds: validKinds.length > 0 ? Array.from(new Set(validKinds)) : [...DEFAULT_SETTINGS.defaultMediaKinds],
    defaultIncludeFailed: typeof obj.defaultIncludeFailed === "boolean" ? obj.defaultIncludeFailed : DEFAULT_SETTINGS.defaultIncludeFailed,
    defaultBatchCap: typeof obj.defaultBatchCap === "number" && Number.isFinite(obj.defaultBatchCap) && obj.defaultBatchCap >= 0 ? Math.floor(obj.defaultBatchCap) : DEFAULT_SETTINGS.defaultBatchCap,
    confirmThreshold: typeof obj.confirmThreshold === "number" && Number.isFinite(obj.confirmThreshold) && obj.confirmThreshold >= 1 ? Math.floor(obj.confirmThreshold) : DEFAULT_SETTINGS.confirmThreshold,
    maxFileSizeMb: typeof obj.maxFileSizeMb === "number" && Number.isFinite(obj.maxFileSizeMb) && obj.maxFileSizeMb >= 1 ? Math.min(200, Math.max(1, Math.floor(obj.maxFileSizeMb))) : DEFAULT_SETTINGS.maxFileSizeMb,
    timeoutSeconds: typeof obj.timeoutSeconds === "number" && Number.isFinite(obj.timeoutSeconds) && obj.timeoutSeconds >= 5 ? Math.min(120, Math.max(5, Math.floor(obj.timeoutSeconds))) : DEFAULT_SETTINGS.timeoutSeconds,
    concurrency: typeof obj.concurrency === "number" && Number.isFinite(obj.concurrency) && obj.concurrency >= 1 ? Math.min(5, Math.max(1, Math.floor(obj.concurrency))) : DEFAULT_SETTINGS.concurrency,
    scanBareUrls: typeof obj.scanBareUrls === "boolean" ? obj.scanBareUrls : DEFAULT_SETTINGS.scanBareUrls,
    autoLocalizeOnOpen: typeof obj.autoLocalizeOnOpen === "boolean" ? obj.autoLocalizeOnOpen : DEFAULT_SETTINGS.autoLocalizeOnOpen,
    deleteImagesOnPurge: typeof obj.deleteImagesOnPurge === "boolean" ? obj.deleteImagesOnPurge : DEFAULT_SETTINGS.deleteImagesOnPurge,
    autoLinkGallery: typeof obj.autoLinkGallery === "boolean" ? obj.autoLinkGallery : DEFAULT_SETTINGS.autoLinkGallery,
    adoptNativeGalleryImages: typeof obj.adoptNativeGalleryImages === "boolean" ? obj.adoptNativeGalleryImages : DEFAULT_SETTINGS.adoptNativeGalleryImages
  };
}
function sanitizeAssetEntry(key, raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const e = raw;
  if (typeof e.imageId !== "string" || !e.imageId)
    return null;
  const normalizedUrl = typeof e.normalizedUrl === "string" && e.normalizedUrl ? e.normalizedUrl : key;
  if (!isSafeRecordKey(normalizedUrl))
    return null;
  const strArr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  const galleryItemIds = createNullProtoRecord();
  if (e.galleryItemIds && typeof e.galleryItemIds === "object") {
    for (const [k, v] of Object.entries(e.galleryItemIds)) {
      if (isSafeRecordKey(k) && typeof v === "string") {
        galleryItemIds[k] = v;
      }
    }
  }
  return {
    normalizedUrl,
    rawUrls: strArr(e.rawUrls),
    imageId: e.imageId,
    localUrl: typeof e.localUrl === "string" && e.localUrl ? e.localUrl : `/api/v1/images/${e.imageId}`,
    mimeType: typeof e.mimeType === "string" ? e.mimeType : "image/png",
    sizeBytes: typeof e.sizeBytes === "number" ? e.sizeBytes : 0,
    filename: typeof e.filename === "string" ? e.filename : "media",
    characterIds: strArr(e.characterIds),
    ...Object.keys(galleryItemIds).length > 0 ? { galleryItemIds } : {},
    localizedAt: typeof e.localizedAt === "number" ? e.localizedAt : 0
  };
}
function sanitizeFailedRecord(raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const r = raw;
  return {
    error: typeof r.error === "string" ? r.error : "Unknown error",
    lastAttemptAt: typeof r.lastAttemptAt === "number" ? r.lastAttemptAt : 0
  };
}
function applyRecordLocalizedAsset(state, entry, options) {
  if (!isSafeRecordKey(entry.normalizedUrl)) {
    throw new Error("Invalid normalizedUrl key");
  }
  const existing = getOwnRecordValue(state.assets, entry.normalizedUrl);
  const isReplacingDeadImage = Boolean(existing && options?.replaceIfImageId && existing.imageId === options.replaceIfImageId);
  const mergedRawUrls = Array.from(new Set([...existing?.rawUrls ?? [], ...entry.rawUrls, entry.normalizedUrl]));
  const mergedCharIds = Array.from(new Set([...existing?.characterIds ?? [], ...entry.characterIds]));
  const mergedGalleryItemIds = createNullProtoRecord();
  if (!isReplacingDeadImage && existing?.galleryItemIds) {
    for (const [k, v] of Object.entries(existing.galleryItemIds)) {
      if (isSafeRecordKey(k) && typeof v === "string") {
        mergedGalleryItemIds[k] = v;
      }
    }
  }
  if (entry.galleryItemIds) {
    for (const [k, v] of Object.entries(entry.galleryItemIds)) {
      if (isSafeRecordKey(k) && typeof v === "string") {
        mergedGalleryItemIds[k] = v;
      }
    }
  }
  const base = existing && !isReplacingDeadImage ? existing : entry;
  const saved = {
    normalizedUrl: entry.normalizedUrl,
    rawUrls: mergedRawUrls,
    imageId: base.imageId,
    localUrl: base.localUrl,
    mimeType: base.mimeType,
    sizeBytes: base.sizeBytes,
    filename: base.filename,
    characterIds: mergedCharIds,
    ...Object.keys(mergedGalleryItemIds).length > 0 ? { galleryItemIds: mergedGalleryItemIds } : {},
    localizedAt: base.localizedAt
  };
  setOwnRecordValue(state.assets, entry.normalizedUrl, saved);
  deleteOwnRecordValue(state.failedUrls, entry.normalizedUrl);
  return { changed: true, result: saved };
}
function applyLinkExistingAssetToCharacter(state, normalizedUrl, rawUrls, characterId, galleryItemId) {
  if (!isSafeRecordKey(normalizedUrl) || !isSafeRecordKey(characterId)) {
    return { changed: false, result: null };
  }
  const existing = getOwnRecordValue(state.assets, normalizedUrl);
  if (!existing)
    return { changed: false, result: null };
  let changed = false;
  if (!existing.characterIds.includes(characterId)) {
    existing.characterIds.push(characterId);
    changed = true;
  }
  if (galleryItemId) {
    if (!existing.galleryItemIds) {
      existing.galleryItemIds = createNullProtoRecord();
    }
    if (getOwnRecordValue(existing.galleryItemIds, characterId) !== galleryItemId) {
      setOwnRecordValue(existing.galleryItemIds, characterId, galleryItemId);
      changed = true;
    }
  }
  for (const raw of rawUrls) {
    if (!existing.rawUrls.includes(raw)) {
      existing.rawUrls.push(raw);
      changed = true;
    }
  }
  if (deleteOwnRecordValue(state.failedUrls, normalizedUrl)) {
    changed = true;
  }
  return { changed, result: existing };
}
function applyRecordGalleryLinks(state, links) {
  if (!Array.isArray(links) || links.length === 0) {
    return { changed: false, result: 0 };
  }
  let updated = 0;
  for (const link of links) {
    if (!link.characterId || !isSafeRecordKey(link.characterId) || !link.galleryItemId) {
      continue;
    }
    for (const entry of Object.values(state.assets)) {
      const matchesUrl = link.normalizedUrl && entry.normalizedUrl === link.normalizedUrl;
      const matchesImage = link.imageId && entry.imageId === link.imageId;
      if (!matchesUrl && !matchesImage)
        continue;
      if (!entry.characterIds.includes(link.characterId)) {
        entry.characterIds.push(link.characterId);
        updated++;
      }
      if (!entry.galleryItemIds) {
        entry.galleryItemIds = createNullProtoRecord();
      }
      if (getOwnRecordValue(entry.galleryItemIds, link.characterId) !== link.galleryItemId) {
        setOwnRecordValue(entry.galleryItemIds, link.characterId, link.galleryItemId);
        updated++;
      }
    }
  }
  return { changed: updated > 0, result: updated };
}
function applyUnlinkByCharacterImageId(state, characterId, imageId, galleryItemId) {
  if (!characterId || !isSafeRecordKey(characterId) || !imageId && !galleryItemId) {
    return { changed: false, result: 0 };
  }
  let removed = 0;
  for (const [normUrl, entry] of Object.entries(state.assets)) {
    if (!entry.characterIds.includes(characterId))
      continue;
    const matchesImage = Boolean(imageId && entry.imageId === imageId);
    const currentGalleryId = getOwnRecordValue(entry.galleryItemIds, characterId);
    const matchesGalleryItem = Boolean(galleryItemId && currentGalleryId === galleryItemId);
    if (!matchesImage && !matchesGalleryItem)
      continue;
    entry.characterIds = entry.characterIds.filter((id) => id !== characterId);
    if (entry.galleryItemIds) {
      deleteOwnRecordValue(entry.galleryItemIds, characterId);
    }
    removed++;
    if (entry.characterIds.length === 0) {
      deleteOwnRecordValue(state.assets, normUrl);
    }
  }
  return { changed: removed > 0, result: removed };
}
function applyRemoveByImageId(state, imageId) {
  let removed = 0;
  for (const [normUrl, entry] of Object.entries(state.assets)) {
    if (entry.imageId === imageId) {
      if (deleteOwnRecordValue(state.assets, normUrl)) {
        removed++;
      }
    }
  }
  return { changed: removed > 0, result: removed };
}
var MAX_CACHED_USERS = 500;

class MediaIndexStore {
  userStorage;
  cache = new Map;
  loading = new Map;
  writeLocks = new Map;
  tmpSeq = 0;
  constructor(userStorage) {
    this.userStorage = userStorage;
  }
  setCachedState(userId, state) {
    if (this.cache.has(userId)) {
      this.cache.delete(userId);
    }
    this.cache.set(userId, state);
    if (this.cache.size <= MAX_CACHED_USERS)
      return;
    for (const candidateKey of this.cache.keys()) {
      if (this.cache.size <= MAX_CACHED_USERS)
        break;
      if (candidateKey === userId)
        continue;
      if (this.writeLocks.has(candidateKey) || this.loading.has(candidateKey)) {
        continue;
      }
      this.cache.delete(candidateKey);
    }
  }
  getState(userId) {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return this.loadState(userId);
    }
    const cached = this.cache.get(userId);
    if (cached) {
      this.cache.delete(userId);
      this.cache.set(userId, cached);
      return Promise.resolve(cached);
    }
    let pending = this.loading.get(userId);
    if (!pending) {
      pending = this.loadState(userId).then((loaded) => {
        this.setCachedState(userId, loaded);
        return loaded;
      }).finally(() => {
        if (this.loading.get(userId) === pending) {
          this.loading.delete(userId);
        }
      });
      this.loading.set(userId, pending);
    }
    return pending;
  }
  async loadState(userId) {
    const exists = await this.userStorage.exists(INDEX_FILE, userId);
    if (!exists)
      return createDefaultUserState();
    const rawData = await this.userStorage.read(INDEX_FILE, userId);
    if (rawData == null) {
      throw new Error("Failed to read media_index.json: storage returned null");
    }
    const text = typeof rawData === "string" ? rawData : rawData instanceof Uint8Array ? new TextDecoder().decode(rawData) : String(rawData);
    let parsed;
    try {
      const candidate = JSON.parse(text);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("media_index.json is not an object");
      }
      parsed = candidate;
    } catch (err) {
      console.warn("[media_localizer] Corrupt media_index.json; preserving a backup and starting fresh:", err);
      if (text) {
        try {
          await this.userStorage.write(`media_index.corrupt-${Date.now()}.json`, text, userId);
        } catch {}
      }
      return createDefaultUserState();
    }
    const assets = createNullProtoRecord();
    if (parsed.assets && typeof parsed.assets === "object") {
      for (const [key, raw] of Object.entries(parsed.assets)) {
        if (!isSafeRecordKey(key))
          continue;
        const entry = sanitizeAssetEntry(key, raw);
        if (entry && isSafeRecordKey(entry.normalizedUrl)) {
          assets[entry.normalizedUrl] = entry;
        }
      }
    }
    const failedUrls = createNullProtoRecord();
    if (parsed.failedUrls && typeof parsed.failedUrls === "object") {
      for (const [key, raw] of Object.entries(parsed.failedUrls)) {
        if (!isSafeRecordKey(key))
          continue;
        const rec = sanitizeFailedRecord(raw);
        if (rec)
          failedUrls[key] = rec;
      }
    }
    const characterOverrides = createNullProtoRecord();
    if (parsed.characterOverrides && typeof parsed.characterOverrides === "object") {
      for (const [k, v] of Object.entries(parsed.characterOverrides)) {
        if (!isSafeRecordKey(k))
          continue;
        const sanitized = sanitizeOverride(v);
        if (!isOverrideEmpty(sanitized)) {
          characterOverrides[k] = sanitized;
        }
      }
    }
    const autoLocalizedCharacterIds = Array.isArray(parsed.autoLocalizedCharacterIds) ? Array.from(new Set(parsed.autoLocalizedCharacterIds.filter((id) => typeof id === "string" && id.trim().length > 0))) : [];
    return {
      version: 1,
      settings: sanitizeSettings(parsed.settings),
      characterOverrides,
      autoLocalizedCharacterIds,
      assets,
      failedUrls
    };
  }
  async writeStateToStorage(userId, state) {
    const tmpPath = `${INDEX_FILE}.${Date.now()}.${++this.tmpSeq}.tmp`;
    const jsonText = JSON.stringify(state, null, 2);
    let moved = false;
    try {
      await this.userStorage.write(tmpPath, jsonText, userId);
      try {
        await this.userStorage.move(tmpPath, INDEX_FILE, userId);
        moved = true;
      } catch {
        await this.userStorage.write(INDEX_FILE, jsonText, userId);
      }
    } finally {
      if (!moved) {
        try {
          await this.userStorage.delete(tmpPath, userId);
        } catch {}
      }
    }
  }
  async mutateState(userId, fn) {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("userId is required");
    }
    const prevLock = this.writeLocks.get(userId) ?? Promise.resolve();
    const task = prevLock.catch(() => {}).then(async () => {
      const current = await this.getState(userId);
      const draft = cloneUserState(current);
      const outcome = fn(draft);
      if (outcome.changed) {
        await this.writeStateToStorage(userId, draft);
        this.setCachedState(userId, draft);
      }
      return outcome.result;
    });
    const cleanup = task.then(() => {
      return;
    }, () => {
      return;
    }).finally(() => {
      if (this.writeLocks.get(userId) === cleanup) {
        this.writeLocks.delete(userId);
      }
    });
    this.writeLocks.set(userId, cleanup);
    return await task;
  }
  async batchUpdate(userId, fn) {
    return this.mutateState(userId, (draft) => {
      let changed = false;
      const tx = {
        state: draft,
        recordLocalizedAsset(entry, options) {
          const res = applyRecordLocalizedAsset(draft, entry, options);
          if (res.changed)
            changed = true;
          return res.result;
        },
        linkExistingAssetToCharacter(normalizedUrl, rawUrls, characterId, galleryItemId) {
          const res = applyLinkExistingAssetToCharacter(draft, normalizedUrl, rawUrls, characterId, galleryItemId);
          if (res.changed)
            changed = true;
          return res.result;
        },
        recordGalleryLinks(links) {
          const res = applyRecordGalleryLinks(draft, links);
          if (res.changed)
            changed = true;
          return res.result;
        },
        unlinkByCharacterImageId(characterId, imageId, galleryItemId) {
          const res = applyUnlinkByCharacterImageId(draft, characterId, imageId, galleryItemId);
          if (res.changed)
            changed = true;
          return res.result;
        },
        removeByImageId(imageId) {
          const res = applyRemoveByImageId(draft, imageId);
          if (res.changed)
            changed = true;
          return res.result;
        }
      };
      const result = fn(tx);
      return { changed, result: { changed, result } };
    });
  }
  async setCharacterOverride(userId, characterId, override) {
    if (!isSafeRecordKey(characterId)) {
      throw new Error("Invalid characterId");
    }
    return this.mutateState(userId, (draft) => {
      const sanitized = override ? sanitizeOverride(override) : null;
      if (!sanitized || isOverrideEmpty(sanitized)) {
        const deleted = deleteOwnRecordValue(draft.characterOverrides, characterId);
        return { changed: deleted, result: null };
      }
      setOwnRecordValue(draft.characterOverrides, characterId, sanitized);
      return { changed: true, result: sanitized };
    });
  }
  async markAutoLocalized(userId, characterId) {
    return this.mutateState(userId, (draft) => {
      if (draft.autoLocalizedCharacterIds.includes(characterId)) {
        return { changed: false, result: false };
      }
      draft.autoLocalizedCharacterIds.push(characterId);
      return { changed: true, result: true };
    });
  }
  async updateSettings(userId, patch) {
    return this.mutateState(userId, (draft) => {
      draft.settings = sanitizeSettings({
        ...draft.settings,
        ...patch
      });
      return { changed: true, result: draft.settings };
    });
  }
  async recordLocalizedAsset(userId, entry, options) {
    return this.mutateState(userId, (draft) => applyRecordLocalizedAsset(draft, entry, options));
  }
  async linkExistingAssetToCharacter(userId, normalizedUrl, rawUrls, characterId, galleryItemId) {
    return this.mutateState(userId, (draft) => applyLinkExistingAssetToCharacter(draft, normalizedUrl, rawUrls, characterId, galleryItemId));
  }
  async recordGalleryLinks(userId, links) {
    if (!Array.isArray(links) || links.length === 0)
      return 0;
    return this.mutateState(userId, (draft) => applyRecordGalleryLinks(draft, links));
  }
  async unlinkByCharacterImageId(userId, characterId, imageId, galleryItemId) {
    if (!characterId || !isSafeRecordKey(characterId) || !imageId && !galleryItemId) {
      return 0;
    }
    return this.mutateState(userId, (draft) => applyUnlinkByCharacterImageId(draft, characterId, imageId, galleryItemId));
  }
  async recordFailure(userId, normalizedUrl, error) {
    if (!isSafeRecordKey(normalizedUrl))
      return;
    await this.mutateState(userId, (draft) => {
      setOwnRecordValue(draft.failedUrls, normalizedUrl, {
        error,
        lastAttemptAt: Date.now()
      });
      return { changed: true, result: undefined };
    });
  }
  async clearFailedUrls(userId, urls) {
    return this.mutateState(userId, (draft) => {
      let cleared = 0;
      if (urls && urls.length > 0) {
        for (const u of urls) {
          if (deleteOwnRecordValue(draft.failedUrls, u)) {
            cleared++;
          }
        }
      } else {
        cleared = Object.keys(draft.failedUrls).length;
        draft.failedUrls = createNullProtoRecord();
      }
      return { changed: cleared > 0, result: cleared };
    });
  }
  async removeCharacterAssets(userId, characterId, onlyNormalizedUrls) {
    if (!isSafeRecordKey(characterId)) {
      return {
        orphanedImageIds: [],
        removedCount: 0,
        removedGalleryItemIds: [],
        removedImageIds: []
      };
    }
    return this.mutateState(userId, (draft) => {
      const targetFilter = onlyNormalizedUrls && onlyNormalizedUrls.length > 0 ? new Set(onlyNormalizedUrls) : null;
      const candidateOrphanImageIds = new Set;
      const removedGalleryItemIds = new Set;
      const removedImageIds = new Set;
      let removedCount = 0;
      for (const [normUrl, entry] of Object.entries(draft.assets)) {
        if (targetFilter && !targetFilter.has(normUrl))
          continue;
        if (!entry.characterIds.includes(characterId))
          continue;
        const galleryLinkId = getOwnRecordValue(entry.galleryItemIds, characterId);
        const isNativeExpression = galleryLinkId === NATIVE_EXPRESSION_SENTINEL;
        if (galleryLinkId) {
          if (!isNativeExpression) {
            removedGalleryItemIds.add(galleryLinkId);
          }
          if (entry.galleryItemIds) {
            deleteOwnRecordValue(entry.galleryItemIds, characterId);
          }
        }
        if (!isNativeExpression) {
          removedImageIds.add(entry.imageId);
        }
        entry.characterIds = entry.characterIds.filter((id) => id !== characterId);
        removedCount++;
        if (entry.characterIds.length === 0) {
          if (!isNativeExpression) {
            candidateOrphanImageIds.add(entry.imageId);
          }
          deleteOwnRecordValue(draft.assets, normUrl);
        }
      }
      const stillUsedImageIds = new Set;
      for (const entry of Object.values(draft.assets)) {
        stillUsedImageIds.add(entry.imageId);
      }
      const orphanedImageIds = Array.from(candidateOrphanImageIds).filter((id) => !stillUsedImageIds.has(id));
      let metadataChanged = false;
      if (!targetFilter) {
        const prevLen = draft.autoLocalizedCharacterIds.length;
        if (prevLen > 0) {
          draft.autoLocalizedCharacterIds = draft.autoLocalizedCharacterIds.filter((id) => id !== characterId);
          if (draft.autoLocalizedCharacterIds.length !== prevLen) {
            metadataChanged = true;
          }
        }
        if (deleteOwnRecordValue(draft.characterOverrides, characterId)) {
          metadataChanged = true;
        }
      }
      return {
        changed: removedCount > 0 || metadataChanged,
        result: {
          orphanedImageIds,
          removedCount,
          removedGalleryItemIds: Array.from(removedGalleryItemIds),
          removedImageIds: Array.from(removedImageIds)
        }
      };
    });
  }
  async removeByImageId(userId, imageId) {
    return this.mutateState(userId, (draft) => applyRemoveByImageId(draft, imageId));
  }
  async getStorageStats(userId) {
    const state = await this.getState(userId);
    const entries = Object.values(state.assets);
    const seenImageIds = new Set;
    let totalSizeBytes = 0;
    for (const entry of entries) {
      if (!seenImageIds.has(entry.imageId)) {
        seenImageIds.add(entry.imageId);
        totalSizeBytes += entry.sizeBytes || 0;
      }
    }
    return {
      totalAssets: entries.length,
      totalSizeBytes,
      totalFailedUrls: Object.keys(state.failedUrls).length,
      settings: state.settings
    };
  }
  async buildActiveDisplayUrlMap(userId) {
    const state = typeof userId === "string" && userId.trim().length > 0 ? await this.getState(userId) : await this.loadState(undefined);
    const characterUrlMaps = createNullProtoRecord();
    const allUrlsMap = createNullProtoRecord();
    const addUrlVariants = (target, url, localUrl) => {
      setOwnRecordValue(target, url, localUrl);
      const ampEncoded = url.replace(/&/g, "&amp;");
      if (ampEncoded !== url) {
        setOwnRecordValue(target, ampEncoded, localUrl);
      }
    };
    for (const entry of Object.values(state.assets)) {
      addUrlVariants(allUrlsMap, entry.normalizedUrl, entry.localUrl);
      for (const raw of entry.rawUrls) {
        addUrlVariants(allUrlsMap, raw, entry.localUrl);
      }
      for (const charId of entry.characterIds) {
        if (!isSafeRecordKey(charId))
          continue;
        let charMap = getOwnRecordValue(characterUrlMaps, charId);
        if (!charMap) {
          charMap = createNullProtoRecord();
          setOwnRecordValue(characterUrlMaps, charId, charMap);
        }
        addUrlVariants(charMap, entry.normalizedUrl, entry.localUrl);
        for (const raw of entry.rawUrls) {
          addUrlVariants(charMap, raw, entry.localUrl);
        }
      }
    }
    return {
      characterUrlMaps,
      allUrlsMap,
      updatedAt: Date.now()
    };
  }
}

// src/core/queue.ts
function createIdleProgress() {
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
    skippedByCapCount: 0
  };
}
var MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
var MIN_FILE_SIZE_BYTES = 1024 * 1024;
var MAX_TIMEOUT_MS = 120000;
var MIN_TIMEOUT_MS = 5000;

class UserDownloadQueue {
  userId;
  spindle;
  indexStore;
  onUpdate;
  progress = createIdleProgress();
  pendingTasks = [];
  activeControls = new Map;
  activeTaskCount = 0;
  pauseGate = null;
  resumeResolver = null;
  cancelRequested = false;
  currentOptions = {
    maxFileSizeBytes: 25 * 1024 * 1024,
    timeoutMs: 20000,
    concurrency: 2
  };
  seq = 0;
  generation = 0;
  runPromise = null;
  enqueueLock = Promise.resolve();
  inFlight = new Map;
  cancelledCharacterUrls = new Map;
  constructor(userId, spindle2, indexStore, onUpdate) {
    this.userId = userId;
    this.spindle = spindle2;
    this.indexStore = indexStore;
    this.onUpdate = onUpdate;
  }
  getProgress() {
    return {
      ...this.progress,
      activeUrls: Array.from(this.activeControls.values()).map((a) => ({
        url: a.url,
        characterId: a.characterId,
        characterName: a.characterName,
        startedAt: a.startedAt
      })),
      recentErrors: [...this.progress.recentErrors]
    };
  }
  emit(newAsset) {
    this.onUpdate(this.userId, this.getProgress(), newAsset);
  }
  async withEnqueueLock(fn) {
    const prev = this.enqueueLock;
    let release;
    this.enqueueLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }
  async startOrAppendBatch(options) {
    return this.withEnqueueLock(async () => {
      while (this.runPromise && this.progress.status !== "running" && this.progress.status !== "paused") {
        await this.runPromise.catch(() => {});
      }
      const maxItems = typeof options.maxItems === "number" && Number.isFinite(options.maxItems) && options.maxItems > 0 ? Math.floor(options.maxItems) : 0;
      const seenKeys = new Set;
      let incoming = options.tasks.filter((t) => {
        const key = `${t.characterId}|${t.normalizedUrl}`;
        if (seenKeys.has(key))
          return false;
        seenKeys.add(key);
        return true;
      });
      let cappedByLimit = false;
      let skippedByCapCount = 0;
      const isAlreadyActive = this.progress.status === "running" || this.progress.status === "paused";
      if (isAlreadyActive) {
        const pendingKeys = new Set(this.pendingTasks.map((t) => `${t.characterId}|${t.normalizedUrl}`));
        for (const a of this.activeControls.values()) {
          pendingKeys.add(`${a.characterId}|${a.url}`);
        }
        incoming = incoming.filter((t) => !pendingKeys.has(`${t.characterId}|${t.normalizedUrl}`));
      }
      if (maxItems > 0 && incoming.length > maxItems) {
        cappedByLimit = true;
        skippedByCapCount = incoming.length - maxItems;
        incoming = incoming.slice(0, maxItems);
      }
      const rawMaxBytes = typeof options.maxFileSizeBytes === "number" && Number.isFinite(options.maxFileSizeBytes) && options.maxFileSizeBytes > 0 ? options.maxFileSizeBytes : 25 * 1024 * 1024;
      const rawTimeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 20000;
      const rawConcurrency = typeof options.concurrency === "number" && Number.isFinite(options.concurrency) && options.concurrency > 0 ? Math.floor(options.concurrency) : 2;
      this.currentOptions = {
        maxFileSizeBytes: Math.min(MAX_FILE_SIZE_BYTES, Math.max(MIN_FILE_SIZE_BYTES, rawMaxBytes)),
        timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, rawTimeoutMs)),
        concurrency: Math.min(5, Math.max(1, rawConcurrency))
      };
      if (!isAlreadyActive) {
        this.cancelRequested = false;
        this.pauseGate = null;
        this.resumeResolver = null;
        this.pendingTasks = [...incoming];
        this.inFlight.clear();
        this.cancelledCharacterUrls.clear();
        const gen = ++this.generation;
        this.progress = {
          status: incoming.length > 0 ? "running" : "completed",
          jobId: `job_${Date.now()}_${++this.seq}`,
          totalQueued: incoming.length,
          completedCount: 0,
          succeededCount: 0,
          skippedCount: 0,
          failedCount: 0,
          activeUrls: [],
          recentErrors: [],
          cappedByLimit,
          skippedByCapCount
        };
        this.emit();
        if (incoming.length > 0) {
          const run = this.runWorkers(this.currentOptions.concurrency, gen).finally(() => {
            if (this.runPromise === run) {
              this.runPromise = null;
            }
          });
          this.runPromise = run;
        }
      } else {
        for (const t of incoming) {
          const cancelled = this.cancelledCharacterUrls.get(t.characterId);
          if (cancelled === null) {
            this.cancelledCharacterUrls.delete(t.characterId);
          } else if (cancelled) {
            cancelled.delete(t.normalizedUrl);
            if (cancelled.size === 0) {
              this.cancelledCharacterUrls.delete(t.characterId);
            }
          }
        }
        this.pendingTasks.push(...incoming);
        this.progress.totalQueued += incoming.length;
        if (cappedByLimit) {
          this.progress.cappedByLimit = true;
          this.progress.skippedByCapCount += skippedByCapCount;
        }
        this.emit();
      }
      return this.getProgress();
    });
  }
  pause() {
    if (this.progress.status !== "running")
      return this.getProgress();
    this.progress.status = "paused";
    this.pauseGate = new Promise((resolve) => {
      this.resumeResolver = resolve;
    });
    this.emit();
    return this.getProgress();
  }
  resume() {
    if (this.progress.status !== "paused")
      return this.getProgress();
    this.progress.status = "running";
    const resolve = this.resumeResolver;
    this.pauseGate = null;
    this.resumeResolver = null;
    resolve?.();
    this.emit();
    return this.getProgress();
  }
  skipCurrent(targetUrl) {
    const controls = Array.from(this.activeControls.values());
    if (controls.length === 0)
      return this.getProgress();
    const target = targetUrl ? controls.find((c) => c.url === targetUrl) ?? controls[0] : controls.sort((a, b) => a.startedAt - b.startedAt)[0];
    if (target) {
      for (const ctrl of controls) {
        if (ctrl.url === target.url) {
          ctrl.skipped = true;
          ctrl.controller.abort(new DOMException("Skipped by user", "AbortError"));
        }
      }
      if (this.pendingTasks.length > 0) {
        let skippedPending = 0;
        const remaining = [];
        for (const t of this.pendingTasks) {
          if (t.normalizedUrl === target.url) {
            skippedPending++;
          } else {
            remaining.push(t);
          }
        }
        if (skippedPending > 0) {
          this.pendingTasks = remaining;
          this.progress.skippedCount += skippedPending;
          this.progress.completedCount += skippedPending;
        }
      }
    }
    this.emit();
    return this.getProgress();
  }
  isTaskCancelledForCharacter(characterId, normalizedUrl) {
    const entry = this.cancelledCharacterUrls.get(characterId);
    if (entry === undefined)
      return false;
    return entry === null || entry.has(normalizedUrl);
  }
  cancelCharacterTasks(characterId, onlyUrls) {
    if (!characterId)
      return 0;
    const isActive = this.progress.status === "running" || this.progress.status === "paused" || this.progress.status === "cancelling";
    if (!isActive)
      return 0;
    const urlSet = onlyUrls && onlyUrls.length > 0 ? new Set(onlyUrls) : null;
    if (!urlSet) {
      this.cancelledCharacterUrls.set(characterId, null);
    } else {
      const existing = this.cancelledCharacterUrls.get(characterId);
      if (existing !== null) {
        const next = existing ?? new Set;
        for (const u of urlSet)
          next.add(u);
        this.cancelledCharacterUrls.set(characterId, next);
      }
    }
    let affected = 0;
    if (this.pendingTasks.length > 0) {
      const remaining = [];
      let droppedPending = 0;
      for (const t of this.pendingTasks) {
        if (t.characterId === characterId && (!urlSet || urlSet.has(t.normalizedUrl))) {
          droppedPending++;
        } else {
          remaining.push(t);
        }
      }
      if (droppedPending > 0) {
        this.pendingTasks = remaining;
        this.progress.skippedCount += droppedPending;
        this.progress.completedCount += droppedPending;
        affected += droppedPending;
      }
    }
    for (const active of this.activeControls.values()) {
      if (active.characterId === characterId && (!urlSet || urlSet.has(active.url))) {
        if (!active.skipped) {
          active.skipped = true;
          active.controller.abort(new DOMException("Cancelled by character purge", "AbortError"));
          affected++;
        }
      }
    }
    if (affected > 0) {
      this.emit();
    }
    return affected;
  }
  cancelAll() {
    if (this.progress.status !== "running" && this.progress.status !== "paused") {
      return this.getProgress();
    }
    this.cancelRequested = true;
    const droppedCount = this.pendingTasks.length;
    this.pendingTasks = [];
    this.progress.skippedCount += droppedCount;
    this.progress.completedCount += droppedCount;
    this.progress.status = "cancelling";
    const resolve = this.resumeResolver;
    this.pauseGate = null;
    this.resumeResolver = null;
    resolve?.();
    for (const active of this.activeControls.values()) {
      active.skipped = true;
      active.controller.abort(new DOMException("Cancelled by user", "AbortError"));
    }
    if (this.activeTaskCount === 0 && this.activeControls.size === 0) {
      this.progress.status = "cancelled";
    }
    this.emit();
    return this.getProgress();
  }
  async runWorkers(concurrency, gen) {
    while (!this.cancelRequested && gen === this.generation) {
      if (this.pauseGate) {
        await this.pauseGate;
      }
      if (this.cancelRequested || gen !== this.generation)
        break;
      if (this.pendingTasks.length === 0)
        break;
      const workers = [];
      for (let i = 0;i < concurrency; i++) {
        workers.push(this.workerLoop(gen));
      }
      await Promise.allSettled(workers);
    }
    if (gen !== this.generation)
      return;
    const alreadyCancelled = this.progress.status === "cancelled";
    this.progress.status = this.cancelRequested ? "cancelled" : "completed";
    if (!alreadyCancelled) {
      this.emit();
    }
  }
  async workerLoop(gen) {
    while (!this.cancelRequested && gen === this.generation) {
      if (this.pauseGate) {
        await this.pauseGate;
      }
      if (this.cancelRequested || gen !== this.generation)
        break;
      const task = this.pendingTasks.shift();
      if (!task)
        break;
      await this.processSingleTask(task, gen);
    }
  }
  async processSingleTask(task, gen) {
    this.activeTaskCount++;
    try {
      const key = task.normalizedUrl;
      while (true) {
        if (gen !== this.generation)
          return;
        if (this.cancelRequested || this.isTaskCancelledForCharacter(task.characterId, key)) {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
          return;
        }
        const prior = this.inFlight.get(key);
        if (!prior)
          break;
        const outcome = await prior.catch(() => "failed");
        if (gen !== this.generation)
          return;
        if (this.cancelRequested || outcome === "aborted" || this.isTaskCancelledForCharacter(task.characterId, key)) {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
          return;
        }
        if (outcome === "failed") {
          let failureError = "Download failed";
          try {
            const state = await this.indexStore.getState(this.userId);
            if (gen !== this.generation)
              return;
            const failure = Object.hasOwn(state.failedUrls, key) ? state.failedUrls[key] : undefined;
            if (failure?.error)
              failureError = failure.error;
          } catch {}
          if (gen !== this.generation)
            return;
          if (this.cancelRequested || this.isTaskCancelledForCharacter(task.characterId, key)) {
            this.progress.completedCount++;
            this.progress.skippedCount++;
            this.emit();
            return;
          }
          this.progress.completedCount++;
          this.progress.failedCount++;
          this.progress.recentErrors.unshift({
            url: key,
            characterName: task.characterName,
            error: failureError
          });
          if (this.progress.recentErrors.length > 25) {
            this.progress.recentErrors.length = 25;
          }
          this.emit();
          return;
        }
      }
      if (gen !== this.generation)
        return;
      if (this.cancelRequested || this.isTaskCancelledForCharacter(task.characterId, key)) {
        this.progress.completedCount++;
        this.progress.skippedCount++;
        this.emit();
        return;
      }
      const run = this.runTask(task, gen).finally(() => {
        if (this.inFlight.get(key) === run) {
          this.inFlight.delete(key);
        }
      });
      this.inFlight.set(key, run);
      await run;
    } finally {
      this.activeTaskCount--;
    }
  }
  async runTask(task, gen) {
    const checkAbortedOrStale = () => {
      if (gen !== this.generation)
        return "aborted";
      if (this.cancelRequested || this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)) {
        this.progress.completedCount++;
        this.progress.skippedCount++;
        this.emit();
        return "aborted";
      }
      return null;
    };
    let controlId = null;
    let control = null;
    try {
      const preStateAborted = checkAbortedOrStale();
      if (preStateAborted)
        return preStateAborted;
      const state = await this.indexStore.getState(this.userId);
      const postStateAborted = checkAbortedOrStale();
      if (postStateAborted)
        return postStateAborted;
      const existing = Object.hasOwn(state.assets, task.normalizedUrl) ? state.assets[task.normalizedUrl] : undefined;
      let deadImageId;
      if (existing) {
        let existingImg = null;
        try {
          existingImg = await this.spindle.images.get(existing.imageId, this.userId);
        } catch {
          existingImg = null;
        }
        const postGetAborted = checkAbortedOrStale();
        if (postGetAborted)
          return postGetAborted;
        if (existingImg) {
          const linked = await this.indexStore.linkExistingAssetToCharacter(this.userId, task.normalizedUrl, task.rawUrls, task.characterId);
          const postLinkAborted = checkAbortedOrStale();
          if (postLinkAborted)
            return postLinkAborted;
          this.progress.completedCount++;
          this.progress.succeededCount++;
          this.emit(linked ?? existing);
          return "ok";
        }
        deadImageId = existing.imageId;
      }
      const preControlAborted = checkAbortedOrStale();
      if (preControlAborted)
        return preControlAborted;
      controlId = `ctrl_${Date.now()}_${++this.seq}`;
      const controller = new AbortController;
      control = {
        id: controlId,
        url: task.normalizedUrl,
        characterId: task.characterId,
        characterName: task.characterName,
        startedAt: Date.now(),
        controller,
        skipped: false
      };
      this.activeControls.set(controlId, control);
      if (this.cancelRequested || gen !== this.generation || this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)) {
        this.activeControls.delete(controlId);
        controlId = null;
        return checkAbortedOrStale() ?? "aborted";
      }
      this.emit();
      const downloadResult = await downloadAndStoreMedia(this.spindle, {
        userId: this.userId,
        characterId: task.characterId,
        normalizedUrl: task.normalizedUrl,
        rawUrls: task.rawUrls,
        maxBytes: this.currentOptions.maxFileSizeBytes,
        timeoutMs: this.currentOptions.timeoutMs,
        signal: controller.signal,
        unmatchedGalleryCandidates: task.unmatchedGalleryCandidates
      });
      const { reusedExistingImage, ...entry } = downloadResult;
      if (gen !== this.generation || this.cancelRequested || control.skipped || this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl)) {
        if (!reusedExistingImage && !entry.galleryItemIds && typeof this.spindle.images?.deleteMany === "function") {
          try {
            await this.spindle.images.deleteMany([entry.imageId], {
              userId: this.userId
            });
          } catch {}
        }
        this.activeControls.delete(controlId);
        controlId = null;
        if (gen === this.generation) {
          this.progress.completedCount++;
          this.progress.skippedCount++;
          this.emit();
        }
        return "aborted";
      }
      const saved = await this.indexStore.recordLocalizedAsset(this.userId, entry, deadImageId ? { replaceIfImageId: deadImageId } : undefined);
      if (saved.imageId !== entry.imageId && !reusedExistingImage && !entry.galleryItemIds && typeof this.spindle.images?.deleteMany === "function") {
        try {
          await this.spindle.images.deleteMany([entry.imageId], {
            userId: this.userId
          });
        } catch {}
      }
      this.activeControls.delete(controlId);
      controlId = null;
      if (gen !== this.generation)
        return "aborted";
      this.progress.completedCount++;
      this.progress.succeededCount++;
      this.emit(saved);
      return "ok";
    } catch (err) {
      if (controlId) {
        this.activeControls.delete(controlId);
        controlId = null;
      }
      if (gen !== this.generation)
        return "aborted";
      this.progress.completedCount++;
      const isAborted = Boolean(control?.skipped) || this.cancelRequested || Boolean(control?.controller.signal.aborted) || this.isTaskCancelledForCharacter(task.characterId, task.normalizedUrl) || err instanceof Error && err.name === "AbortError" || err instanceof Error && /AbortError|cancelled|Skipped/i.test(err.message);
      if (isAborted) {
        this.progress.skippedCount++;
        this.emit();
        return "aborted";
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.progress.failedCount++;
      this.progress.recentErrors.unshift({
        url: task.normalizedUrl,
        characterName: task.characterName,
        error: errorMessage
      });
      if (this.progress.recentErrors.length > 25) {
        this.progress.recentErrors.length = 25;
      }
      try {
        await this.indexStore.recordFailure(this.userId, task.normalizedUrl, errorMessage);
      } catch {}
      if (gen !== this.generation)
        return "aborted";
      this.emit();
      return "failed";
    } finally {
      if (controlId) {
        this.activeControls.delete(controlId);
      }
    }
  }
}
var MAX_QUEUED_USERS = 500;

class MediaQueueManager {
  spindle;
  indexStore;
  onUpdate;
  queues = new Map;
  constructor(spindle2, indexStore, onUpdate) {
    this.spindle = spindle2;
    this.indexStore = indexStore;
    this.onUpdate = onUpdate;
  }
  getQueue(userId) {
    let q = this.queues.get(userId);
    if (q) {
      this.queues.delete(userId);
      this.queues.set(userId, q);
      return q;
    }
    q = new UserDownloadQueue(userId, this.spindle, this.indexStore, this.onUpdate);
    this.queues.set(userId, q);
    if (this.queues.size > MAX_QUEUED_USERS) {
      for (const [uid, candidate] of this.queues.entries()) {
        if (this.queues.size <= MAX_QUEUED_USERS)
          break;
        if (uid === userId)
          continue;
        const st = candidate.getProgress().status;
        if (st === "idle" || st === "completed" || st === "cancelled") {
          this.queues.delete(uid);
        }
      }
    }
    return q;
  }
  cancelAllUsers() {
    for (const q of this.queues.values()) {
      q.cancelAll();
    }
  }
}

// src/shared/library-media.ts
function groupLibraryAssetsByCharacter(assets) {
  const byCharacter = new Map;
  for (const entry of Object.values(assets)) {
    if (!Array.isArray(entry.characterIds))
      continue;
    for (const charId of new Set(entry.characterIds)) {
      if (typeof charId !== "string" || !charId)
        continue;
      let list = byCharacter.get(charId);
      if (!list) {
        list = [];
        byCharacter.set(charId, list);
      }
      list.push(entry);
    }
  }
  return byCharacter;
}
function buildLibraryMediaCharacter(char, byCharacter, options) {
  const avatarImageId = typeof char.image_id === "string" && char.image_id.trim() ? char.image_id.trim() : null;
  const avatarUrl = avatarImageId ? `/api/v1/images/${encodeURIComponent(avatarImageId)}` : null;
  const expressions = extractCharacterExpressions(char.extensions);
  const exprImageIds = new Set(expressions.map((e) => e.imageId));
  const rawAssets = byCharacter.get(char.id) ?? [];
  let totalSizeBytes = 0;
  let lastLocalizedAt = 0;
  const seenAssetIds = new Set;
  const localizedAssets = [];
  for (const entry of rawAssets) {
    const localizedAt = typeof entry.localizedAt === "number" && Number.isFinite(entry.localizedAt) ? entry.localizedAt : 0;
    if (localizedAt > lastLocalizedAt) {
      lastLocalizedAt = localizedAt;
    }
    if (seenAssetIds.has(entry.imageId)) {
      continue;
    }
    seenAssetIds.add(entry.imageId);
    const sizeBytes = typeof entry.sizeBytes === "number" && Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0 ? entry.sizeBytes : 0;
    totalSizeBytes += sizeBytes;
    if (exprImageIds.has(entry.imageId)) {
      continue;
    }
    localizedAssets.push(entry);
  }
  localizedAssets.sort((a, b) => (Number.isFinite(b.localizedAt) ? b.localizedAt : 0) - (Number.isFinite(a.localizedAt) ? a.localizedAt : 0) || String(a.filename ?? "").localeCompare(String(b.filename ?? "")));
  if (!options?.includeEmpty && localizedAssets.length === 0 && expressions.length === 0) {
    return null;
  }
  const tags = Array.isArray(char.tags) ? Array.from(new Set(char.tags.filter((t) => typeof t === "string").map((t) => t.trim()).filter(Boolean))) : [];
  return {
    characterId: char.id,
    characterName: char.name,
    ...tags.length > 0 ? { tags } : {},
    avatarImageId,
    avatarUrl,
    localizedAssets,
    expressions,
    totalSizeBytes,
    lastLocalizedAt
  };
}
function buildLibraryMedia(characters, assets, options) {
  const byCharacter = groupLibraryAssetsByCharacter(assets);
  const result = [];
  for (const char of characters) {
    const item = buildLibraryMediaCharacter(char, byCharacter, options);
    if (item) {
      result.push(item);
    }
  }
  return result;
}

// src/backend.ts
var MAX_KNOWN_USERS = 500;
var MAX_CHARACTER_CACHE_ENTRIES = 2000;
var CHARACTER_SCAN_CACHE_TTL_MS = 60000;
var CHARACTER_LIST_PAGE_LIMIT = 200;
var MAX_CHARACTER_LIST_PAGES = 1000;
var MIN_FILE_SIZE_BYTES2 = 1 * 1024 * 1024;
var MAX_FILE_SIZE_BYTES2 = 200 * 1024 * 1024;
var MIN_TIMEOUT_MS2 = 5000;
var MAX_TIMEOUT_MS2 = 120000;
var MIN_CONCURRENCY = 1;
var MAX_CONCURRENCY = 5;
function formatErrorMessage(err) {
  if (err instanceof Error)
    return err.message || err.name;
  return String(err);
}
function logWarn(message, err) {
  const full = err !== undefined ? `[media_localizer] ${message} ${formatErrorMessage(err)}` : `[media_localizer] ${message}`;
  try {
    if (typeof spindle?.log?.warn === "function") {
      spindle.log.warn(full);
      return;
    }
  } catch {}
  console.warn(full);
}
function setBoundedMapEntry(map, key, value, maxEntries) {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined)
      break;
    map.delete(oldestKey);
  }
}
function getLruMapEntry(map, key) {
  if (!map.has(key))
    return;
  const value = map.get(key);
  map.delete(key);
  map.set(key, value);
  return value;
}
var indexStore = new MediaIndexStore(spindle.userStorage);
var knownUsers = new Set;
var unmatchedGalleryCache = new Map;
var pendingGalleryLinksCache = new Map;
var characterScanCache = new Map;
var inFlightAutoLocalize = new Set;
var failedWorldBookPromises = new WeakSet;
function recordKnownUser(userId) {
  if (knownUsers.has(userId)) {
    knownUsers.delete(userId);
  }
  knownUsers.add(userId);
  while (knownUsers.size > MAX_KNOWN_USERS) {
    const oldest = knownUsers.values().next().value;
    if (oldest === undefined)
      break;
    knownUsers.delete(oldest);
  }
}
function readCharUpdatedAtKey(character) {
  const raw = character.updated_at;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}
function resolveActingUser(userId) {
  if (typeof userId === "string" && userId.trim().length > 0) {
    recordKnownUser(userId);
    return userId;
  }
  return knownUsers.size === 1 ? knownUsers.values().next().value : undefined;
}
function evictCharacterCaches(characterId, targetUsers, options) {
  if (targetUsers && targetUsers.length > 0) {
    for (const userId of targetUsers) {
      const key = `${userId}:${characterId}`;
      characterScanCache.delete(key);
      if (!options?.scanOnly) {
        unmatchedGalleryCache.delete(key);
        pendingGalleryLinksCache.delete(key);
      }
    }
    return;
  }
  for (const [key, entry] of characterScanCache.entries()) {
    if (entry.characterId === characterId) {
      characterScanCache.delete(key);
    }
  }
  if (!options?.scanOnly) {
    for (const [key, entry] of unmatchedGalleryCache.entries()) {
      if (entry.characterId === characterId) {
        unmatchedGalleryCache.delete(key);
      }
    }
    for (const [key, entry] of pendingGalleryLinksCache.entries()) {
      if (entry.characterId === characterId) {
        pendingGalleryLinksCache.delete(key);
      }
    }
  }
}
function invalidateUserScanCaches(targetUsers) {
  if (!targetUsers) {
    characterScanCache.clear();
    return;
  }
  const userSet = new Set(targetUsers);
  for (const [key, entry] of characterScanCache.entries()) {
    if (userSet.has(entry.userId)) {
      characterScanCache.delete(key);
    }
  }
}
function invalidateWorldBookScanCaches(worldBookId, targetUsers) {
  const userSet = targetUsers ? new Set(targetUsers) : null;
  for (const [key, entry] of characterScanCache.entries()) {
    if (userSet && !userSet.has(entry.userId))
      continue;
    if (!entry.includeResources)
      continue;
    if (worldBookId ? entry.wbIds.includes(worldBookId) : entry.wbIds.length > 0) {
      characterScanCache.delete(key);
    }
  }
}
function invalidateRegexScanCaches(scope, scopeId, targetUsers) {
  if (scope === "character" && scopeId) {
    evictCharacterCaches(scopeId, targetUsers, { scanOnly: true });
    return;
  }
  if (scope === "global" || scope === "chat") {
    return;
  }
  const userSet = targetUsers ? new Set(targetUsers) : null;
  for (const [key, entry] of characterScanCache.entries()) {
    if (userSet && !userSet.has(entry.userId))
      continue;
    if (entry.includeResources) {
      characterScanCache.delete(key);
    }
  }
}
async function syncUrlMapToFrontend(userId) {
  try {
    const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
    spindle.sendToFrontend({
      type: "URL_MAP_UPDATED",
      urlMapPayload
    }, userId);
  } catch (err) {
    logWarn("Failed to sync URL map:", err);
  }
}
try {
  spindle.rpcPool?.handle?.("media_localizer.url_map", async (_ctx) => {
    if (knownUsers.size === 1) {
      const soleUserId = knownUsers.values().next().value;
      if (soleUserId) {
        return indexStore.buildActiveDisplayUrlMap(soleUserId);
      }
    }
    if (knownUsers.size === 0) {
      try {
        return await indexStore.buildActiveDisplayUrlMap();
      } catch (err) {
        logWarn("media_localizer.url_map could not resolve default user storage before any user session:", err);
        return null;
      }
    }
    logWarn(`media_localizer.url_map cannot disambiguate across ${knownUsers.size} known users because SharedRpcRequestContextDTO carries no userId.`);
    return null;
  }, { requires: [] });
} catch (err) {
  logWarn("Failed to register media_localizer.url_map RPC handler:", err);
}
var urlMapSyncTimers = new Map;
function scheduleUrlMapSync(userId) {
  if (urlMapSyncTimers.has(userId))
    return;
  urlMapSyncTimers.set(userId, setTimeout(() => {
    urlMapSyncTimers.delete(userId);
    syncUrlMapToFrontend(userId);
  }, 200));
}
var queueManager = new MediaQueueManager(spindle, indexStore, (userId, progress, newAsset) => {
  try {
    spindle.sendToFrontend({
      type: "QUEUE_PROGRESS",
      progress,
      ...newAsset ? { newAsset } : {}
    }, userId);
  } catch (err) {
    logWarn("Failed to send QUEUE_PROGRESS to frontend:", err);
  }
  if (newAsset || progress.status === "completed" || progress.status === "cancelled") {
    scheduleUrlMapSync(userId);
  }
  if (progress.status === "completed" && progress.totalQueued > 0) {
    try {
      if (progress.failedCount > 0) {
        spindle.toast?.warning?.(`Localized ${progress.succeededCount} of ${progress.totalQueued} media files (${progress.failedCount} failed).`, { title: "Media Localizer", userId });
      } else if (progress.succeededCount > 0) {
        spindle.toast?.success?.(`Successfully localized ${progress.succeededCount} media file${progress.succeededCount === 1 ? "" : "s"}.`, { title: "Media Localizer", userId });
      }
    } catch (err) {
      logWarn("Failed to show queue completion toast:", err);
    }
  }
});
function extractCharacterWorldBookIds(character) {
  const ids = new Set;
  if (Array.isArray(character.world_book_ids)) {
    for (const id of character.world_book_ids) {
      if (typeof id === "string" && id.trim())
        ids.add(id.trim());
    }
  }
  const ext = character.extensions;
  if (ext && typeof ext === "object") {
    const extIds = ext.world_book_ids ?? ext.world_books;
    if (Array.isArray(extIds)) {
      for (const id of extIds) {
        if (typeof id === "string" && id.trim())
          ids.add(id.trim());
      }
    }
  }
  return Array.from(ids);
}
function extractEmbeddedCharacterBook(character) {
  const ext = character.extensions;
  if (!ext || typeof ext !== "object")
    return null;
  const charBook = ext.character_book;
  if (!charBook || typeof charBook !== "object")
    return null;
  const rawEntries = charBook.entries;
  const entriesList = [];
  if (Array.isArray(rawEntries)) {
    for (const entry of rawEntries) {
      if (entry && typeof entry === "object") {
        const e = entry;
        if (typeof e.content === "string" && e.content.trim()) {
          entriesList.push({
            id: typeof e.id === "string" || typeof e.id === "number" ? String(e.id) : undefined,
            comment: typeof e.comment === "string" ? e.comment : typeof e.name === "string" ? e.name : null,
            content: e.content
          });
        }
      }
    }
  } else if (rawEntries && typeof rawEntries === "object") {
    for (const entry of Object.values(rawEntries)) {
      if (entry && typeof entry === "object") {
        const e = entry;
        if (typeof e.content === "string" && e.content.trim()) {
          entriesList.push({
            id: typeof e.id === "string" || typeof e.id === "number" ? String(e.id) : undefined,
            comment: typeof e.comment === "string" ? e.comment : typeof e.name === "string" ? e.name : null,
            content: e.content
          });
        }
      }
    }
  }
  if (entriesList.length === 0)
    return null;
  const bookName = typeof charBook.name === "string" && charBook.name.trim() ? charBook.name.trim() : "Embedded Lorebook";
  return {
    id: "__embedded_character_book__",
    name: bookName,
    entries: entriesList
  };
}
async function fetchWorldBookWithEntries(wbId, userId, onError) {
  try {
    const wb = await spindle.world_books.get(wbId, userId);
    if (!wb)
      return null;
    const entries = [];
    let offset = 0;
    const pageLimit = 200;
    for (let page = 0;page < 100; page++) {
      const entriesRes = await spindle.world_books.entries.list(wbId, {
        limit: pageLimit,
        offset,
        userId
      });
      const rows = Array.isArray(entriesRes?.data) ? entriesRes.data : [];
      if (rows.length === 0)
        break;
      for (const e of rows) {
        entries.push({
          id: e.id,
          comment: e.comment,
          content: e.content
        });
      }
      offset += rows.length;
      const total = typeof entriesRes?.total === "number" ? entriesRes.total : undefined;
      if (total !== undefined ? offset >= total : rows.length < pageLimit)
        break;
    }
    return {
      id: wb.id,
      name: wb.name || wb.id,
      entries
    };
  } catch (err) {
    logWarn(`Failed to fetch world book ${wbId}:`, err);
    onError?.();
    return null;
  }
}
async function fetchCharacterRegexScripts(characterId, userId) {
  const regexScripts = [];
  let failed = false;
  try {
    let offset = 0;
    const pageLimit = 200;
    for (let page = 0;page < 50; page++) {
      const scriptsRes = await spindle.regex_scripts.list({
        scope: "character",
        scopeId: characterId,
        limit: pageLimit,
        offset,
        userId
      });
      const scripts = Array.isArray(scriptsRes?.data) ? scriptsRes.data : [];
      if (scripts.length === 0)
        break;
      for (const s of scripts) {
        regexScripts.push({
          id: s.id,
          script_name: s.name,
          replace_string: s.replace_string
        });
      }
      offset += scripts.length;
      const total = typeof scriptsRes?.total === "number" ? scriptsRes.total : undefined;
      if (total !== undefined ? offset >= total : scripts.length < pageLimit)
        break;
    }
  } catch (err) {
    failed = true;
    logWarn(`Failed to fetch regex scripts for character ${characterId}:`, err);
  }
  return { scripts: regexScripts, failed };
}
async function performCharacterScan(userId, characterId, includeResources = true, worldBookCache, options) {
  const character = options?.preloadedCharacter ?? await spindle.characters.get(characterId, userId);
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }
  const state = await indexStore.getState(userId);
  const override = state.characterOverrides[characterId] ?? null;
  const cacheKey = `${userId}:${characterId}`;
  const wbIds = includeResources ? extractCharacterWorldBookIds(character) : [];
  const wbIdsKey = `${includeResources ? "1" : "0"}:${wbIds.join(",")}`;
  const updatedAtKey = readCharUpdatedAtKey(character);
  const cachedRaw = !options?.forceRefresh ? characterScanCache.get(cacheKey) : undefined;
  const now = Date.now();
  const isCacheValid = Boolean(cachedRaw && updatedAtKey !== "" && cachedRaw.updatedAt === updatedAtKey && cachedRaw.scanBareUrls === state.settings.scanBareUrls && cachedRaw.wbIdsKey === wbIdsKey && now - cachedRaw.cachedAt < CHARACTER_SCAN_CACHE_TTL_MS);
  if (cachedRaw && !isCacheValid) {
    characterScanCache.delete(cacheKey);
  }
  let scan;
  if (isCacheValid && cachedRaw) {
    const cached = getLruMapEntry(characterScanCache, cacheKey) ?? cachedRaw;
    scan = {
      ...cached.scan,
      sectionCounts: { ...cached.scan.sectionCounts },
      override,
      scannedAt: now,
      items: cached.scan.items.map((item) => ({ ...item }))
    };
    refreshScanResultWithIndexState(scan, state.assets, state.failedUrls);
  } else {
    const worldBooks = [];
    let regexScripts = [];
    let resourceFetchFailed = false;
    if (includeResources) {
      for (const wbId of wbIds) {
        let wbPromise = worldBookCache?.get(wbId);
        if (!wbPromise) {
          let wbFailed = false;
          let created;
          created = fetchWorldBookWithEntries(wbId, userId, () => {
            wbFailed = true;
          }).then((res) => {
            if (wbFailed) {
              failedWorldBookPromises.add(created);
            }
            return res;
          });
          wbPromise = created;
          worldBookCache?.set(wbId, wbPromise);
        }
        const loadedWb = await wbPromise;
        if (failedWorldBookPromises.has(wbPromise)) {
          resourceFetchFailed = true;
        }
        if (loadedWb) {
          worldBooks.push(loadedWb);
        }
      }
      if (worldBooks.length === 0) {
        const embeddedBook = extractEmbeddedCharacterBook(character);
        if (embeddedBook) {
          worldBooks.push(embeddedBook);
        }
      }
      const regexRes = await fetchCharacterRegexScripts(characterId, userId);
      regexScripts = regexRes.scripts;
      if (regexRes.failed) {
        resourceFetchFailed = true;
      }
    }
    const localizedMap = new Map(Object.entries(state.assets));
    const failedMap = new Map(Object.entries(state.failedUrls));
    scan = scanCharacterMedia(character, worldBooks, regexScripts, {
      override,
      localizedByNormalizedUrl: localizedMap,
      failedByNormalizedUrl: failedMap,
      scanBareUrls: state.settings.scanBareUrls
    });
    if (updatedAtKey !== "" && !resourceFetchFailed) {
      setBoundedMapEntry(characterScanCache, cacheKey, {
        userId,
        characterId,
        includeResources,
        wbIds,
        updatedAt: updatedAtKey,
        scanBareUrls: state.settings.scanBareUrls,
        wbIdsKey,
        cachedAt: Date.now(),
        scan
      }, MAX_CHARACTER_CACHE_ENTRIES);
    }
  }
  const itemsToLink = scan.items.filter((item) => item.status === "localized" && item.localizedEntry && !item.localizedEntry.characterIds.includes(characterId));
  let linkedAny = false;
  if (itemsToLink.length > 0) {
    const linkBatch = await indexStore.batchUpdate(userId, (tx) => {
      for (const item of itemsToLink) {
        tx.linkExistingAssetToCharacter(item.normalizedUrl, item.rawUrls, characterId);
      }
    });
    linkedAny = linkBatch.changed;
  }
  const reconciliation = await reconcileCharacterGalleryWithIndex(spindle, indexStore, userId, character, scan.items);
  if (reconciliation.unmatchedGalleryCandidates.length > 0) {
    setBoundedMapEntry(unmatchedGalleryCache, cacheKey, {
      userId,
      characterId,
      items: reconciliation.unmatchedGalleryCandidates
    }, MAX_CHARACTER_CACHE_ENTRIES);
  } else {
    unmatchedGalleryCache.delete(cacheKey);
  }
  if (reconciliation.pendingGalleryLinks.length > 0) {
    setBoundedMapEntry(pendingGalleryLinksCache, cacheKey, {
      userId,
      characterId,
      items: reconciliation.pendingGalleryLinks
    }, MAX_CHARACTER_CACHE_ENTRIES);
  } else {
    pendingGalleryLinksCache.delete(cacheKey);
  }
  if (reconciliation.indexChanged || linkedAny) {
    const updatedState = await indexStore.getState(userId);
    refreshScanResultWithIndexState(scan, updatedState.assets, updatedState.failedUrls);
    scheduleUrlMapSync(userId);
  }
  if (!options?.skipMedia) {
    const mediaState = await indexStore.getState(userId);
    scan.media = buildLibraryMedia([
      {
        id: character.id,
        name: character.name,
        image_id: character.image_id ?? null,
        tags: Array.isArray(character.tags) ? character.tags : [],
        extensions: character.extensions ?? null
      }
    ], mediaState.assets, { includeEmpty: true })[0] ?? null;
  }
  if (!options?.skipGalleryLinkBroadcast && state.settings.autoLinkGallery && reconciliation.pendingGalleryLinks.length > 0) {
    try {
      spindle.sendToFrontend({
        type: "ENSURE_GALLERY_LINKS",
        characterId,
        links: reconciliation.pendingGalleryLinks
      }, userId);
    } catch (err) {
      logWarn(`Failed to send ENSURE_GALLERY_LINKS for character ${characterId}:`, err);
    }
  }
  return scan;
}
async function forEachCharacterPage(userId, onPage) {
  let offset = 0;
  const seenIds = new Set;
  for (let page = 0;page < MAX_CHARACTER_LIST_PAGES; page++) {
    const res = await spindle.characters.list({
      limit: CHARACTER_LIST_PAGE_LIMIT,
      offset,
      userId
    });
    const rows = Array.isArray(res?.data) ? res.data : [];
    if (rows.length === 0)
      break;
    const freshRows = [];
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || seenIds.has(row.id))
        continue;
      seenIds.add(row.id);
      freshRows.push(row);
    }
    if (freshRows.length > 0) {
      await onPage(freshRows);
    }
    offset += rows.length;
    const total = typeof res?.total === "number" ? res.total : undefined;
    if (total !== undefined ? offset >= total : rows.length < CHARACTER_LIST_PAGE_LIMIT) {
      break;
    }
  }
}
async function performLibraryScan(userId, options) {
  const summaries = [];
  const globalRemoteUrls = new Set;
  const worldBookCache = new Map;
  const scanOneCharacter = async (char) => {
    const scan = await performCharacterScan(userId, char.id, true, worldBookCache, {
      preloadedCharacter: char,
      forceRefresh: Boolean(options?.forceRefresh),
      skipMedia: true,
      skipGalleryLinkBroadcast: true
    });
    let localizedCount = 0;
    let remoteCount = 0;
    let failedCount = 0;
    let localizedBytes = 0;
    for (const item of scan.items) {
      if (item.status === "localized") {
        localizedCount++;
        localizedBytes += item.localizedEntry?.sizeBytes ?? 0;
      } else if (item.status === "failed") {
        failedCount++;
        globalRemoteUrls.add(item.normalizedUrl);
      } else {
        remoteCount++;
        globalRemoteUrls.add(item.normalizedUrl);
      }
    }
    const sectionRemoteCounts = {
      creator_notes: scan.sectionCounts.creator_notes.remoteCount + scan.sectionCounts.creator_notes.failedCount,
      first_mes: scan.sectionCounts.first_mes.remoteCount + scan.sectionCounts.first_mes.failedCount,
      core_fields: scan.sectionCounts.core_fields.remoteCount + scan.sectionCounts.core_fields.failedCount,
      alternate_greetings: scan.sectionCounts.alternate_greetings.remoteCount + scan.sectionCounts.alternate_greetings.failedCount,
      world_books: scan.sectionCounts.world_books.remoteCount + scan.sectionCounts.world_books.failedCount,
      regex_scripts: scan.sectionCounts.regex_scripts.remoteCount + scan.sectionCounts.regex_scripts.failedCount
    };
    return {
      characterId: char.id,
      characterName: char.name,
      totalUnique: scan.items.length,
      localizedCount,
      localizedBytes,
      remoteCount,
      failedCount,
      sectionRemoteCounts
    };
  };
  const concurrency = 6;
  await forEachCharacterPage(userId, async (pageRows) => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, pageRows.length) }, async () => {
      while (cursor < pageRows.length) {
        const idx = cursor++;
        const char = pageRows[idx];
        if (!char)
          continue;
        try {
          const summary = await scanOneCharacter(char);
          summaries.push(summary);
        } catch (err) {
          logWarn(`Failed to scan character ${char.id} (${char.name}) during library scan:`, err);
        }
      }
    });
    await Promise.all(workers);
  });
  summaries.sort((a, b) => b.remoteCount + b.failedCount - (a.remoteCount + a.failedCount) || b.totalUnique - a.totalUnique || a.characterName.localeCompare(b.characterName));
  return {
    characters: summaries,
    totalUniqueRemote: globalRemoteUrls.size
  };
}
function sanitizeDownloadFilter(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { characterIds: [] };
  }
  const obj = raw;
  const baseOverride = sanitizeOverride(obj);
  const characterIds = Array.isArray(obj.characterIds) ? Array.from(new Set(obj.characterIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))) : [];
  const explicitUrls = Array.isArray(obj.explicitUrls) ? Array.from(new Set(obj.explicitUrls.filter((u) => typeof u === "string" && u.trim().length > 0).map((u) => u.trim()))) : undefined;
  const result = {
    characterIds,
    ...baseOverride
  };
  if (explicitUrls && explicitUrls.length > 0) {
    result.explicitUrls = explicitUrls;
  }
  if (typeof obj.maxFileSizeBytes === "number" && Number.isFinite(obj.maxFileSizeBytes) && obj.maxFileSizeBytes > 0) {
    result.maxFileSizeBytes = obj.maxFileSizeBytes;
  }
  if (typeof obj.timeoutMs === "number" && Number.isFinite(obj.timeoutMs) && obj.timeoutMs > 0) {
    result.timeoutMs = obj.timeoutMs;
  }
  if (typeof obj.concurrency === "number" && Number.isFinite(obj.concurrency) && obj.concurrency > 0) {
    result.concurrency = obj.concurrency;
  }
  return result;
}
async function enqueueDownloadInternal(userId, rawFilter, useCharacterOverrides, preloadedScans) {
  const filter = sanitizeDownloadFilter(rawFilter);
  const charIds = filter.characterIds;
  if (charIds.length === 0) {
    throw new Error("Select at least one character to localize");
  }
  const state = await indexStore.getState(userId);
  const settings = state.settings;
  const tasks = [];
  const worldBookCache = new Map;
  const { characterIds: _ignoredCharIds, ...definedFilter } = filter;
  const hasValidFilterMaxItems = typeof filter.maxItems === "number" && Number.isFinite(filter.maxItems) && filter.maxItems >= 0;
  let resolvedMaxItems = hasValidFilterMaxItems ? Math.floor(filter.maxItems) : settings.defaultBatchCap;
  for (const charId of charIds) {
    const scan = preloadedScans?.get(charId) ?? await performCharacterScan(userId, charId, true, worldBookCache);
    const unmatchedCandidates = getLruMapEntry(unmatchedGalleryCache, `${userId}:${scan.characterId}`)?.items;
    const effective = useCharacterOverrides ? buildEffectiveFilter(settings, scan) : null;
    if (effective && charIds.length === 1 && !hasValidFilterMaxItems && typeof effective.maxItems === "number" && Number.isFinite(effective.maxItems) && effective.maxItems >= 0) {
      resolvedMaxItems = Math.floor(effective.maxItems);
    }
    const charFilter = effective ? { ...effective, ...definedFilter } : definedFilter;
    const matchingItems = filterScanItemsForDownload(scan, charFilter);
    for (const item of matchingItems) {
      tasks.push({
        characterId: scan.characterId,
        characterName: scan.characterName,
        normalizedUrl: item.normalizedUrl,
        rawUrls: item.rawUrls,
        ...unmatchedCandidates && unmatchedCandidates.length > 0 ? { unmatchedGalleryCandidates: unmatchedCandidates } : {}
      });
    }
  }
  const clampPositiveInt = (raw, fallback, min, max) => {
    const value = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
    return Math.min(max, Math.max(min, value));
  };
  const maxItems = resolvedMaxItems;
  const maxFileSizeBytes = clampPositiveInt(filter.maxFileSizeBytes, settings.maxFileSizeMb * 1024 * 1024, MIN_FILE_SIZE_BYTES2, MAX_FILE_SIZE_BYTES2);
  const timeoutMs = clampPositiveInt(filter.timeoutMs, settings.timeoutSeconds * 1000, MIN_TIMEOUT_MS2, MAX_TIMEOUT_MS2);
  const concurrency = clampPositiveInt(filter.concurrency, settings.concurrency, MIN_CONCURRENCY, MAX_CONCURRENCY);
  const queueProgress = await queueManager.getQueue(userId).startOrAppendBatch({
    userId,
    tasks,
    maxItems,
    maxFileSizeBytes,
    timeoutMs,
    concurrency
  });
  return { queueProgress };
}
async function handleFrontendRpcAction(userId, action, payload = {}) {
  switch (action) {
    case "get_init_state": {
      const [urlMapPayload, stats] = await Promise.all([
        indexStore.buildActiveDisplayUrlMap(userId),
        indexStore.getStorageStats(userId)
      ]);
      const queueProgress = queueManager.getQueue(userId).getProgress();
      return { urlMapPayload, stats, queueProgress };
    }
    case "scan_character": {
      const characterId = String(payload.characterId ?? "").trim();
      if (!characterId)
        throw new Error("characterId is required");
      const forceRefresh = Boolean(payload.forceRefresh);
      const scan = await performCharacterScan(userId, characterId, true, undefined, {
        forceRefresh
      });
      const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
      const { settings } = await indexStore.getState(userId);
      const pendingGalleryLinks = settings.autoLinkGallery ? getLruMapEntry(pendingGalleryLinksCache, `${userId}:${characterId}`)?.items ?? [] : [];
      return { scan, urlMapPayload, pendingGalleryLinks };
    }
    case "scan_library": {
      const forceRefresh = payload.forceRefresh === true;
      const result = await performLibraryScan(userId, { forceRefresh });
      const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
      return { ...result, urlMapPayload };
    }
    case "enqueue_download": {
      return await enqueueDownloadInternal(userId, payload.filter, Boolean(payload.useCharacterOverrides));
    }
    case "queue_control": {
      const control = String(payload.control ?? "");
      const targetUrl = typeof payload.targetUrl === "string" ? payload.targetUrl : undefined;
      const q = queueManager.getQueue(userId);
      let queueProgress;
      if (control === "pause")
        queueProgress = q.pause();
      else if (control === "resume")
        queueProgress = q.resume();
      else if (control === "skip_current")
        queueProgress = q.skipCurrent(targetUrl);
      else if (control === "cancel_all")
        queueProgress = q.cancelAll();
      else
        queueProgress = q.getProgress();
      return { queueProgress };
    }
    case "save_character_override": {
      const characterId = String(payload.characterId ?? "").trim();
      if (!characterId)
        throw new Error("characterId is required");
      const override = payload.override === null ? null : sanitizeOverride(payload.override);
      await indexStore.setCharacterOverride(userId, characterId, override);
      return { override };
    }
    case "list_library_media": {
      const includeEmpty = Boolean(payload?.includeEmpty);
      const { assets } = await indexStore.getState(userId);
      const byCharacter = groupLibraryAssetsByCharacter(assets);
      const characters = [];
      await forEachCharacterPage(userId, (rows) => {
        for (const c of rows) {
          const item = buildLibraryMediaCharacter({
            id: c.id,
            name: c.name,
            image_id: c.image_id ?? null,
            tags: Array.isArray(c.tags) ? c.tags : [],
            extensions: c.extensions ?? null
          }, byCharacter, { includeEmpty });
          if (item) {
            characters.push(item);
          }
        }
      });
      return { characters };
    }
    case "auto_localize_character": {
      const characterId = String(payload.characterId ?? "").trim();
      if (!characterId)
        throw new Error("characterId is required");
      const lockKey = `${userId}:${characterId}`;
      if (inFlightAutoLocalize.has(lockKey))
        return { started: false };
      inFlightAutoLocalize.add(lockKey);
      try {
        const state = await indexStore.getState(userId);
        if (!state.settings.autoLocalizeOnOpen)
          return { started: false };
        if (state.autoLocalizedCharacterIds.includes(characterId)) {
          return { started: false };
        }
        const scan = await performCharacterScan(userId, characterId, true);
        const filter = buildEffectiveFilter(state.settings, scan);
        const matching = filterScanItemsForDownload(scan, filter);
        if (matching.length === 0) {
          await indexStore.markAutoLocalized(userId, characterId);
          return { started: false };
        }
        const preloadedScans = new Map([
          [characterId, scan]
        ]);
        const result = await enqueueDownloadInternal(userId, { ...filter, characterIds: [characterId] }, false, preloadedScans);
        await indexStore.markAutoLocalized(userId, characterId);
        return { started: true, queueProgress: result.queueProgress };
      } finally {
        inFlightAutoLocalize.delete(lockKey);
      }
    }
    case "update_settings": {
      const patch = payload.patch ?? {};
      const settings = await indexStore.updateSettings(userId, patch);
      const stats = await indexStore.getStorageStats(userId);
      const urlMapPayload = await indexStore.buildActiveDisplayUrlMap(userId);
      scheduleUrlMapSync(userId);
      return { settings, stats, urlMapPayload };
    }
    case "clear_failed": {
      const urls = Array.isArray(payload.urls) ? payload.urls.filter((u) => typeof u === "string") : undefined;
      const cleared = await indexStore.clearFailedUrls(userId, urls);
      const stats = await indexStore.getStorageStats(userId);
      return { cleared, stats };
    }
    case "record_gallery_links": {
      const rawLinks = Array.isArray(payload.links) ? payload.links : [];
      const links = [];
      for (const item of rawLinks) {
        if (!item || typeof item !== "object")
          continue;
        const obj = item;
        const characterId = String(obj.characterId ?? "").trim();
        const imageId = String(obj.imageId ?? "").trim();
        const galleryItemId = String(obj.galleryItemId ?? "").trim();
        const normalizedUrl = typeof obj.normalizedUrl === "string" && obj.normalizedUrl.trim() ? obj.normalizedUrl.trim() : undefined;
        if (characterId && imageId && galleryItemId) {
          links.push({
            characterId,
            imageId,
            galleryItemId,
            ...normalizedUrl ? { normalizedUrl } : {}
          });
        }
      }
      const updated = await indexStore.recordGalleryLinks(userId, links);
      return { updated };
    }
    case "purge_character_cache":
    case "purge_characters": {
      const targetCharacterIds = action === "purge_characters" && Array.isArray(payload.characterIds) ? payload.characterIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()) : [String(payload.characterId ?? "").trim()].filter(Boolean);
      if (targetCharacterIds.length === 0) {
        throw new Error("characterId is required");
      }
      const urls = action === "purge_character_cache" && Array.isArray(payload.urls) ? payload.urls.filter((u) => typeof u === "string") : undefined;
      const state = await indexStore.getState(userId);
      const deleteImages = state.settings.deleteImagesOnPurge;
      const allOrphanedImageIds = new Set;
      const allRemovedGalleryItemIds = new Set;
      const allRemovedImageIds = new Set;
      let removedCount = 0;
      const userQueue = queueManager.getQueue(userId);
      for (const characterId of targetCharacterIds) {
        userQueue.cancelCharacterTasks(characterId, urls);
        evictCharacterCaches(characterId, [userId]);
        const res = await indexStore.removeCharacterAssets(userId, characterId, urls);
        removedCount += res.removedCount;
        for (const id of res.orphanedImageIds)
          allOrphanedImageIds.add(id);
        for (const id of res.removedGalleryItemIds)
          allRemovedGalleryItemIds.add(id);
        for (const id of res.removedImageIds)
          allRemovedImageIds.add(id);
      }
      const orphanedImageIds = Array.from(allOrphanedImageIds);
      let deletedImagesCount = 0;
      if (deleteImages && orphanedImageIds.length > 0) {
        try {
          await spindle.images.deleteMany(orphanedImageIds, { userId });
          deletedImagesCount = orphanedImageIds.length;
        } catch (err) {
          logWarn("Failed to delete orphaned images:", err);
        }
      }
      const [stats, urlMapPayload] = await Promise.all([
        indexStore.getStorageStats(userId),
        indexStore.buildActiveDisplayUrlMap(userId)
      ]);
      scheduleUrlMapSync(userId);
      return {
        removedCount,
        deletedImagesCount,
        removedGalleryItemIds: deleteImages ? Array.from(allRemovedGalleryItemIds) : [],
        removedImageIds: deleteImages ? Array.from(allRemovedImageIds) : [],
        stats,
        urlMapPayload
      };
    }
    default:
      throw new Error(`Unknown RPC action: ${action}`);
  }
}
spindle.onFrontendMessage(async (msg, rawUserId) => {
  if (!msg || typeof msg !== "object")
    return;
  const envelope = msg;
  if (envelope.type !== "RPC_REQUEST")
    return;
  const requestId = String(envelope.requestId ?? "");
  const action = String(envelope.action ?? "");
  const payload = envelope.payload && typeof envelope.payload === "object" ? envelope.payload : {};
  const userId = resolveActingUser(rawUserId);
  if (!userId) {
    const trimmedRawUserId = typeof rawUserId === "string" ? rawUserId.trim() : "";
    if (requestId && trimmedRawUserId) {
      spindle.sendToFrontend({
        type: "RPC_RESPONSE",
        requestId,
        error: "Could not resolve active user session"
      }, trimmedRawUserId);
    } else if (requestId) {
      logWarn(`Dropping RPC_RESPONSE for ${action || "unknown"} (${requestId}) because active user session could not be resolved`);
    }
    return;
  }
  try {
    const result = await handleFrontendRpcAction(userId, action, payload);
    if (requestId) {
      spindle.sendToFrontend({
        type: "RPC_RESPONSE",
        requestId,
        result
      }, userId);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (requestId) {
      spindle.sendToFrontend({
        type: "RPC_RESPONSE",
        requestId,
        error: errorMsg
      }, userId);
    }
  }
});
function extractStringField(obj, ...keys) {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return "";
}
function resolveEventUsers(event, rawUserId) {
  const ev = event && typeof event === "object" ? event : null;
  const fromRaw = typeof rawUserId === "string" && rawUserId.trim().length > 0 ? rawUserId.trim() : "";
  const fromEvent = ev ? extractStringField(ev, "userId", "user_id") : "";
  const explicitUserId = fromRaw || fromEvent || resolveActingUser(undefined);
  if (explicitUserId) {
    recordKnownUser(explicitUserId);
    return { ev, explicitUserId, targetUsers: [explicitUserId] };
  }
  return {
    ev,
    explicitUserId: undefined,
    targetUsers: Array.from(knownUsers.values())
  };
}
spindle.on("CONNECTED", (event, rawUserId) => {
  resolveEventUsers(event, rawUserId);
});
spindle.on("CHARACTER_EDITED", (event, rawUserId) => {
  const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
  if (!ev)
    return;
  const nestedChar = ev.character && typeof ev.character === "object" ? ev.character : null;
  const characterId = extractStringField(ev, "characterId", "character_id", "id") || (nestedChar ? extractStringField(nestedChar, "id", "characterId", "character_id") : "");
  const scopeUsers = explicitUserId ? [explicitUserId] : null;
  if (characterId) {
    evictCharacterCaches(characterId, scopeUsers);
  } else {
    invalidateUserScanCaches(scopeUsers);
  }
});
for (const wbEvent of ["WORLD_BOOK_CHANGED", "WORLD_BOOK_DELETED"]) {
  spindle.on(wbEvent, (event, rawUserId) => {
    const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
    const worldBookId = ev ? extractStringField(ev, "worldBookId", "world_book_id", "bookId", "id") : "";
    invalidateWorldBookScanCaches(worldBookId || undefined, explicitUserId ? [explicitUserId] : null);
  });
}
for (const wbEntryEvent of [
  "WORLD_BOOK_ENTRY_CHANGED",
  "WORLD_BOOK_ENTRY_DELETED"
]) {
  spindle.on(wbEntryEvent, (event, rawUserId) => {
    const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
    const entryObj = ev?.entry && typeof ev.entry === "object" ? ev.entry : null;
    const worldBookId = (ev ? extractStringField(ev, "worldBookId", "world_book_id", "bookId") : "") || (entryObj ? extractStringField(entryObj, "worldBookId", "world_book_id", "bookId") : "");
    invalidateWorldBookScanCaches(worldBookId || undefined, explicitUserId ? [explicitUserId] : null);
  });
}
for (const regexEvent of ["REGEX_SCRIPT_CHANGED", "REGEX_SCRIPT_DELETED"]) {
  spindle.on(regexEvent, (event, rawUserId) => {
    const { ev, explicitUserId } = resolveEventUsers(event, rawUserId);
    const scriptObj = ev?.script && typeof ev.script === "object" ? ev.script : null;
    const scope = (ev ? extractStringField(ev, "scope") : "") || (scriptObj ? extractStringField(scriptObj, "scope") : "");
    const scopeId = (ev ? extractStringField(ev, "scopeId", "scope_id", "characterId", "character_id") : "") || (scriptObj ? extractStringField(scriptObj, "scopeId", "scope_id", "characterId", "character_id") : "");
    invalidateRegexScanCaches(scope, scopeId, explicitUserId ? [explicitUserId] : null);
  });
}
spindle.on("CHARACTER_DELETED", async (event, rawUserId) => {
  const { ev, explicitUserId, targetUsers } = resolveEventUsers(event, rawUserId);
  if (!ev)
    return;
  const characterId = extractStringField(ev, "characterId", "character_id", "id");
  if (!characterId)
    return;
  evictCharacterCaches(characterId, explicitUserId ? [explicitUserId] : null);
  for (const userId of targetUsers) {
    try {
      queueManager.getQueue(userId).cancelCharacterTasks(characterId);
      const { orphanedImageIds, removedCount } = await indexStore.removeCharacterAssets(userId, characterId);
      const { settings } = await indexStore.getState(userId);
      if (settings.deleteImagesOnPurge && orphanedImageIds.length > 0) {
        await spindle.images.deleteMany(orphanedImageIds, { userId });
      }
      if (removedCount > 0) {
        scheduleUrlMapSync(userId);
      }
    } catch (err) {
      logWarn(`Failed to clean up deleted character ${characterId} for ${userId}:`, err);
    }
  }
});
spindle.on("CHARACTER_GALLERY_ITEM_REMOVED", async (event, rawUserId) => {
  const { ev, explicitUserId, targetUsers } = resolveEventUsers(event, rawUserId);
  if (!ev)
    return;
  const characterId = extractStringField(ev, "characterId", "character_id");
  const imageId = extractStringField(ev, "imageId", "image_id");
  const galleryItemId = extractStringField(ev, "id") || undefined;
  if (!characterId || !imageId && !galleryItemId)
    return;
  if (explicitUserId) {
    evictCharacterCaches(characterId, [explicitUserId]);
  }
  for (const userId of targetUsers) {
    try {
      const removed = await indexStore.unlinkByCharacterImageId(userId, characterId, imageId || undefined, galleryItemId);
      if (removed > 0) {
        evictCharacterCaches(characterId, [userId]);
        scheduleUrlMapSync(userId);
        spindle.sendToFrontend({
          type: "GALLERY_SYNC_CHANGED",
          characterId
        }, userId);
      }
    } catch (err) {
      logWarn(`Failed to unlink removed gallery item for character ${characterId} (${userId}):`, err);
    }
  }
});
spindle.on("IMAGE_DELETED", async (event, rawUserId) => {
  const { ev, targetUsers } = resolveEventUsers(event, rawUserId);
  if (!ev)
    return;
  const imageId = extractStringField(ev, "imageId", "image_id", "id");
  if (!imageId)
    return;
  for (const userId of targetUsers) {
    try {
      const removed = await indexStore.removeByImageId(userId, imageId);
      if (removed > 0) {
        scheduleUrlMapSync(userId);
        spindle.sendToFrontend({
          type: "GALLERY_SYNC_CHANGED"
        }, userId);
      }
    } catch (err) {
      logWarn(`Failed to remove deleted image ${imageId} from index (${userId}):`, err);
    }
  }
});
try {
  spindle.commands?.register?.([
    {
      id: "open-media-localizer",
      label: "Media Localizer: Open Drawer",
      description: "Inspect and localize embedded remote media for the active character or library",
      keywords: ["media", "localize", "gallery", "images", "cache", "download"],
      scope: "global"
    },
    {
      id: "localize-active-character-media",
      label: "Media Localizer: Localize Active Character Media",
      description: "Download embedded media for the current character using your global download defaults",
      keywords: ["media", "localize", "download", "character", "gallery"],
      scope: "chat"
    }
  ]);
  spindle.commands?.onInvoked?.(async (commandId, context, origin) => {
    const userId = resolveActingUser(origin?.userId);
    if (commandId === "open-media-localizer") {
      try {
        await spindle.ui?.openDrawerTab?.("media_localizer", userId ? { userId } : undefined);
      } catch (err) {
        logWarn("Failed to open media_localizer drawer tab:", err);
      }
      return;
    }
    if (commandId === "localize-active-character-media") {
      if (!userId)
        return;
      try {
        const charId = typeof context?.characterId === "string" && context.characterId.trim() ? context.characterId.trim() : (await spindle.chats?.getActive?.(userId))?.character_id ?? "";
        if (!charId) {
          spindle.toast?.info?.("Open a character chat first to localize its media.", {
            title: "Media Localizer",
            userId
          });
          return;
        }
        const state = await indexStore.getState(userId);
        const scan = await performCharacterScan(userId, charId, true);
        await handleFrontendRpcAction(userId, "enqueue_download", {
          filter: {
            ...buildEffectiveFilter(state.settings, scan),
            characterIds: [charId]
          }
        });
        try {
          await spindle.ui?.openDrawerTab?.("media_localizer", { userId });
        } catch (err) {
          logWarn("Failed to open media_localizer drawer tab:", err);
        }
      } catch (err) {
        logWarn("localize-active-character-media command failed:", err);
        try {
          spindle.toast?.error?.(`Failed to localize character media: ${err instanceof Error ? err.message : String(err)}`, { title: "Media Localizer", userId });
        } catch (toastErr) {
          logWarn("Failed to send error toast:", toastErr);
        }
      }
    }
  });
} catch (err) {
  logWarn("Command Palette registration skipped:", err);
}
export {
  handleFrontendRpcAction,
  performCharacterScan,
  performLibraryScan
};
