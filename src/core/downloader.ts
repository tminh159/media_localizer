import type { SpindleAPI } from "lumiverse-spindle-types";
import type { LocalizedAssetEntry } from "../shared/types.ts";
import { isBlockedRemoteHostname } from "../shared/url-scanner.ts";

export interface UnmatchedGalleryCandidate {
  imageId: string;
  galleryItemId?: string;
  byteSize?: number;
  mimeType?: string;
}

export interface DownloadStoreResult extends LocalizedAssetEntry {
  /** Internal flag indicating an existing gallery/host image was reused (never delete on cancel/race). */
  reusedExistingImage?: boolean;
}

export interface DownloadMediaOptions {
  userId: string;
  characterId: string;
  normalizedUrl: string;
  rawUrls: string[];
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  unmatchedGalleryCandidates?: UnmatchedGalleryCandidate[];
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  apng: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
};

/**
 * Validates that a remote media URL uses http(s) without embedded credentials
 * and does not target private, loopback, link-local, or local network hosts.
 */
export function validateRemoteMediaUrl(rawUrl: string): URL {
  let parsed: URL;
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

const TEXT_PREFIX_SCAN_BYTES = 16 * 1024;

function isAsciiPrintableOrSpaceByte(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
}

function decodeTextPrefix(bytes: Uint8Array): string {
  const prefix = bytes.subarray(0, Math.min(bytes.byteLength, TEXT_PREFIX_SCAN_BYTES));
  if (prefix.byteLength === 0) return "";

  // UTF-32 LE / BE BOM
  if (prefix.byteLength >= 4) {
    const isUtf32Le =
      prefix[0] === 0xff && prefix[1] === 0xfe && prefix[2] === 0x00 && prefix[3] === 0x00;
    const isUtf32Be =
      prefix[0] === 0x00 && prefix[1] === 0x00 && prefix[2] === 0xfe && prefix[3] === 0xff;
    if (isUtf32Le || isUtf32Be) {
      let out = "";
      for (let i = 4; i + 3 < prefix.byteLength; i += 4) {
        const cp = isUtf32Le
          ? (prefix[i]! | (prefix[i + 1]! << 8) | (prefix[i + 2]! << 16) | (prefix[i + 3]! << 24)) >>> 0
          : ((prefix[i]! << 24) | (prefix[i + 1]! << 16) | (prefix[i + 2]! << 8) | prefix[i + 3]!) >>> 0;
        if (cp >= 0x01 && cp <= 0x10ffff) {
          out += String.fromCodePoint(cp);
        }
      }
      return out;
    }
  }

  // UTF-8 BOM
  if (prefix.byteLength >= 3 && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) {
    return new TextDecoder().decode(prefix.subarray(3));
  }

  // UTF-16 LE / BE BOM
  if (prefix.byteLength >= 2 && prefix[0] === 0xff && prefix[1] === 0xfe) {
    const body = prefix.subarray(2);
    return new TextDecoder("utf-16le").decode(body.subarray(0, body.byteLength - (body.byteLength % 2)));
  }
  if (prefix.byteLength >= 2 && prefix[0] === 0xfe && prefix[1] === 0xff) {
    const body = prefix.subarray(2);
    return new TextDecoder("utf-16be").decode(body.subarray(0, body.byteLength - (body.byteLength % 2)));
  }

  // Heuristic BOM-less UTF-16 LE / BE detection for ASCII markup/JSON
  if (prefix.byteLength >= 6) {
    const samplePairs = Math.min(Math.floor(prefix.byteLength / 2), 32);
    let leZeros = 0;
    let leChars = 0;
    let beZeros = 0;
    let beChars = 0;
    for (let p = 0; p < samplePairs; p++) {
      const b0 = prefix[p * 2]!;
      const b1 = prefix[p * 2 + 1]!;
      if (b1 === 0 && isAsciiPrintableOrSpaceByte(b0)) leChars++;
      if (b1 === 0) leZeros++;
      if (b0 === 0 && isAsciiPrintableOrSpaceByte(b1)) beChars++;
      if (b0 === 0) beZeros++;
    }
    if (leZeros === samplePairs && leChars === samplePairs) {
      return new TextDecoder("utf-16le").decode(
        prefix.subarray(0, prefix.byteLength - (prefix.byteLength % 2)),
      );
    }
    if (beZeros === samplePairs && beChars === samplePairs) {
      return new TextDecoder("utf-16be").decode(
        prefix.subarray(0, prefix.byteLength - (prefix.byteLength % 2)),
      );
    }
  }

  return new TextDecoder().decode(prefix);
}

function stripLeadingMarkupNoise(text: string): { stripped: string; sawXmlDecl: boolean } {
  let current = text.replace(/^\uFEFF/, "");
  let sawXmlDecl = false;
  while (true) {
    current = current.trimStart();
    if (current.startsWith("<!--")) {
      const end = current.indexOf("-->", 4);
      if (end === -1) break;
      current = current.slice(end + 3);
      continue;
    }
    if (current.startsWith("<?")) {
      if (/^<\?xml\b/i.test(current)) {
        sawXmlDecl = true;
      }
      const end = current.indexOf("?>", 2);
      if (end === -1) break;
      current = current.slice(end + 2);
      continue;
    }
    break;
  }
  return { stripped: current.trimStart(), sawXmlDecl };
}

function isPrintableTextPrefix(text: string): boolean {
  if (!text) return false;
  let hasVisibleChar = false;
  const limit = Math.min(text.length, 4096);
  for (let i = 0; i < limit; i++) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd) return false;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return false;
    }
    if (code > 0x20 && code !== 0x7f) {
      hasVisibleChar = true;
    }
  }
  return hasVisibleChar;
}

function looksLikeJsonBody(bytes: Uint8Array, strippedText: string): boolean {
  if (!strippedText.startsWith("{") && !strippedText.startsWith("[")) {
    return false;
  }
  if (bytes.byteLength <= 64 * 1024) {
    try {
      JSON.parse(strippedText);
      return true;
    } catch {
      // Fall through to prefix heuristic if truncated or slightly over prefix scan
    }
  }
  return /^(?:\{\s*(?:"(?:[^"\\]|\\.)*"\s*:|\})|\[\s*(?:\{|"|-?\d|true\b|false\b|null\b|\]))/.test(
    strippedText,
  );
}

/**
 * Inspects magic bytes of the downloaded binary to detect the true MIME type
 * and reject HTML error pages returned by CDNs with HTTP 200.
 */
export function detectMediaMimeType(
  bytes: Uint8Array,
  headerMimeType?: string | null,
  urlPath?: string,
): { mimeType: string; ext: string } {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: "png" };
  }
  // JPEG / JFIF / PJP / PJPEG: FF D8 FF
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }
  // GIF: GIF87a / GIF89a
  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mimeType: "image/gif", ext: "gif" };
  }
  // WEBP: RIFF....WEBP
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", ext: "webp" };
  }
  // BMP: "BM" + reserved 00 00 00 00 at bytes 6..9
  if (
    bytes.byteLength >= 10 &&
    bytes[0] === 0x42 &&
    bytes[1] === 0x4d &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0
  ) {
    return { mimeType: "image/bmp", ext: "bmp" };
  }
  // ICO: 00 00 01 00
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return { mimeType: "image/x-icon", ext: "ico" };
  }
  // WEBM / MKV: 1A 45 DF A3
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { mimeType: "video/webm", ext: "webm" };
  }
  // ISO Base Media (MP4 / AVIF): ....ftyp
  if (
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0,
    ).toLowerCase();
    if (brand === "avif" || brand === "avis" || brand === "mif1") {
      return { mimeType: "image/avif", ext: "avif" };
    }
    return { mimeType: "video/mp4", ext: "mp4" };
  }

  // Check text prefix (UTF-8/UTF-16/UTF-32 with BOM & comment/PI stripping) for HTML/SVG/XML/script
  const headText = decodeTextPrefix(bytes);
  const { stripped: strippedHead, sawXmlDecl } = stripLeadingMarkupNoise(headText);
  const printableText = isPrintableTextPrefix(headText);

  if (
    /^<svg\b/i.test(strippedHead) ||
    /^<!doctype\s+svg\b/i.test(strippedHead) ||
    ((sawXmlDecl || printableText) &&
      (/<svg[\s>/]/i.test(headText) ||
        /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(headText)))
  ) {
    throw new Error("SVG media is disallowed for security reasons");
  }
  if (/^<script\b/i.test(strippedHead) || (printableText && /<script[\s>/]/i.test(headText))) {
    throw new Error("Remote server returned script content instead of media");
  }
  if (
    /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b|<title\b|<meta\b|<iframe\b|<object\b|<embed\b|<style\b)/i.test(
      strippedHead,
    ) ||
    (printableText &&
      /<(?:!doctype\s+html|html|head|body|iframe|object|embed)\b/i.test(headText))
  ) {
    throw new Error("Remote server returned an HTML page instead of media");
  }
  if (
    sawXmlDecl ||
    (printableText &&
      (/^<!--/.test(strippedHead) ||
        /^<[a-zA-Z_][\w:-]*(?:\s[^>]*)?>/.test(strippedHead)))
  ) {
    throw new Error("Remote server returned XML/markup content instead of media");
  }

  // Reject disallowed or non-media Content-Type headers before body/extension checks
  const cleanHeader = (headerMimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (cleanHeader === "image/svg+xml" || cleanHeader === "image/svg") {
    throw new Error("SVG media (image/svg+xml) is disallowed for security reasons");
  }
  if (
    cleanHeader.startsWith("text/") ||
    cleanHeader === "application/json" ||
    cleanHeader.endsWith("+json") ||
    cleanHeader === "application/xml" ||
    cleanHeader.endsWith("+xml") ||
    cleanHeader === "application/xhtml+xml" ||
    cleanHeader === "application/javascript" ||
    cleanHeader === "application/ecmascript"
  ) {
    throw new Error(`Unsupported response content-type: ${cleanHeader}`);
  }

  // Defense-in-depth SVG rejection by URL extension
  const urlExtMatch = urlPath ? /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(urlPath) : null;
  const urlExt = urlExtMatch?.[1]?.toLowerCase() ?? "";
  if (urlExt === "svg") {
    throw new Error("SVG media is disallowed for security reasons");
  }

  // Reject JSON or plain-text error bodies of any length before binary container checks
  if (printableText) {
    if (looksLikeJsonBody(bytes, strippedHead)) {
      throw new Error("Unrecognized media format: remote server returned JSON instead of media");
    }
    if (bytes.byteLength >= 1) {
      throw new Error("Unrecognized media format: remote server returned plain text instead of media");
    }
  }

  // QuickTime .mov container without leading ftyp atom: moov / mdat / wide / free at offset 4
  if (bytes.byteLength >= 8) {
    const atom = String.fromCharCode(
      bytes[4]!,
      bytes[5]!,
      bytes[6]!,
      bytes[7]!,
    );
    if (atom === "moov" || atom === "mdat" || atom === "wide" || atom === "free") {
      const boxSize =
        ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
      if (boxSize === 0 || boxSize === 1 || (boxSize >= 8 && boxSize <= 0x7fffffff)) {
        return { mimeType: "video/mp4", ext: "mp4" };
      }
    }
  }

  // Never trust bare image Content-Type or URL extension headers when magic bytes fail to match.
  const expectedMime =
    (urlExt && EXT_TO_MIME[urlExt]) ||
    (cleanHeader && MIME_TO_EXT[cleanHeader] ? cleanHeader : "");
  throw new Error(
    `Unrecognized media format${cleanHeader ? ` (content-type: ${cleanHeader})` : ""}${expectedMime && expectedMime !== cleanHeader ? ` (expected ${expectedMime})` : ""}`,
  );
}

export function deriveBaseFilename(normalizedUrl: string, ext: string): string {
  try {
    const parsed = new URL(normalizedUrl);
    const lastSeg = parsed.pathname.split("/").filter(Boolean).pop() ?? "media";
    const cleaned = lastSeg
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .slice(0, 48);
    return `${cleaned || "media"}.${ext}`;
  } catch {
    return `media.${ext}`;
  }
}

function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getHeaderCaseInsensitive(
  headers: Record<string, string> | undefined,
  targetName: string,
): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const lowerTarget = targetName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lowerTarget && typeof v === "string") {
      return v;
    }
  }
  return undefined;
}

async function raceWithSignalAndTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  // Prevent unhandled rejection if race rejects before the underlying promise settles.
  void promise.catch(() => {});

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
      if (settled) return;
      settled = true;
      cleanup();
      const reason = signal?.reason;
      reject(
        reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"),
      );
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
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Download timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      },
    );
  });
}

function decodeCorsBase64Body(body: string, maxBytes: number): Uint8Array {
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
  if (stripped.endsWith("==")) padCount = 2;
  else if (stripped.endsWith("=")) padCount = 1;
  const estimatedBytes = Math.floor((stripped.length * 3) / 4) - padCount;
  if (estimatedBytes > maxBytes) {
    throw new Error(
      `File size (~${estimatedBytes} bytes) exceeds limit (${maxBytes} bytes)`,
    );
  }

  let binaryStr: string;
  try {
    binaryStr = atob(stripped);
  } catch {
    throw new Error("CORS proxy returned invalid base64 response body");
  }

  if (binaryStr.length === 0) {
    throw new Error("Downloaded file is empty (0 bytes)");
  }
  if (binaryStr.length > maxBytes) {
    throw new Error(
      `File size (${binaryStr.length} bytes) exceeds limit (${maxBytes} bytes)`,
    );
  }

  const decoded = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    decoded[i] = binaryStr.charCodeAt(i);
  }
  return decoded;
}

/**
 * Downloads a single remote media URL via `spindle.files.fetch` (with `spindle.cors` fallback)
 * and stores it in Lumiverse's image store via `spindle.images.upload` (or reuses an
 * identical image already present in the character's native Gallery).
 */
export async function downloadAndStoreMedia(
  spindle: SpindleAPI,
  options: DownloadMediaOptions,
): Promise<DownloadStoreResult> {
  const {
    userId,
    characterId,
    normalizedUrl,
    rawUrls,
    maxBytes,
    timeoutMs,
    signal,
    unmatchedGalleryCandidates,
  } = options;

  signal?.throwIfAborted();
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("Invalid maxBytes limit");
  }
  const validatedUrl = validateRemoteMediaUrl(normalizedUrl);
  const fetchUrl = validatedUrl.href;

  let bytes: Uint8Array;
  let headerMime: string | undefined;

  if (spindle.files && typeof spindle.files.fetch === "function") {
    const staged = await spindle.files.fetch(fetchUrl, {
      userId,
      fileName: "remote_media.bin",
      maxBytes,
      timeoutMs,
      signal,
    });
    headerMime = staged.mimeType;

    try {
      signal?.throwIfAborted();
      if (!Number.isFinite(staged.size) || staged.size <= 0) {
        throw new Error("Downloaded file is empty (0 bytes)");
      }
      if (staged.size > maxBytes) {
        throw new Error(
          `File size (${staged.size} bytes) exceeds limit (${maxBytes} bytes)`,
        );
      }

      const chunks: Uint8Array[] = [];
      let offset = 0;
      while (offset < staged.size) {
        signal?.throwIfAborted();
        const chunk = await spindle.files.readChunk(
          { fileId: staged.fileId },
          offset,
          userId,
        );
        if (!chunk || !chunk.data || chunk.data.byteLength === 0) break;
        if (
          offset + chunk.data.byteLength > staged.size ||
          offset + chunk.data.byteLength > maxBytes
        ) {
          throw new Error(
            `Downloaded chunk exceeds declared or allowed size (${offset + chunk.data.byteLength} bytes)`,
          );
        }
        chunks.push(chunk.data);
        offset += chunk.data.byteLength;
        if (chunk.eof) break;
      }

      if (offset !== staged.size) {
        throw new Error(
          `Download incomplete (${offset} of ${staged.size} bytes read)`,
        );
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
        await spindle.files.delete(staged.fileId, userId);
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Fallback to spindle.cors with explicit timeout, abort signal, and size cap
    const rawResponse = await raceWithSignalAndTimeout(
      spindle.cors(fetchUrl, {
        method: "GET",
        responseType: "arraybuffer",
        mediaType: "image",
      }),
      timeoutMs,
      signal,
    );
    signal?.throwIfAborted();
    const response = (rawResponse ?? {}) as {
      status?: number;
      headers?: Record<string, string>;
      body?: unknown;
      encoding?: string;
    };
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
        throw new Error(
          `File size (${body.byteLength} bytes) exceeds limit (${maxBytes} bytes)`,
        );
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
      throw new Error(
        `File size (${bytes.byteLength} bytes) exceeds limit (${maxBytes} bytes)`,
      );
    }
  }

  signal?.throwIfAborted();

  const { mimeType, ext } = detectMediaMimeType(bytes, headerMime, fetchUrl);
  if (mimeType === "image/svg+xml") {
    throw new Error("SVG media is disallowed for security reasons");
  }
  const filename = deriveBaseFilename(fetchUrl, ext);

  // If the character already has unmatched native Gallery images, check if any of them
  // has identical bytes so we reuse the existing Gallery image instead of uploading a duplicate.
  if (
    unmatchedGalleryCandidates &&
    unmatchedGalleryCandidates.length > 0 &&
    typeof spindle.images?.readBinary === "function"
  ) {
    for (const cand of unmatchedGalleryCandidates) {
      signal?.throwIfAborted();
      if (
        cand.byteSize !== undefined &&
        cand.byteSize > 0 &&
        cand.byteSize !== bytes.byteLength
      ) {
        continue;
      }
      try {
        const existingBytes = await spindle.images.readBinary(cand.imageId, userId);
        if (existingBytes && areUint8ArraysEqual(bytes, existingBytes)) {
          return {
            normalizedUrl,
            rawUrls: Array.from(new Set([...rawUrls, normalizedUrl])),
            imageId: cand.imageId,
            localUrl: `/api/v1/images/${encodeURIComponent(cand.imageId)}`,
            mimeType: cand.mimeType && cand.mimeType !== "image/svg+xml"
              ? cand.mimeType
              : mimeType,
            sizeBytes: bytes.byteLength,
            filename,
            characterIds: [characterId],
            ...(cand.galleryItemId
              ? { galleryItemIds: { [characterId]: cand.galleryItemId } }
              : {}),
            localizedAt: Date.now(),
            reusedExistingImage: true,
          };
        }
      } catch {
        // Ignore readBinary failure and continue
      }
    }
  }

  signal?.throwIfAborted();
  const uploaded = await spindle.images.upload(
    {
      data: bytes,
      filename,
      mime_type: mimeType,
      owner_character_id: characterId,
    },
    userId,
  );

  return {
    normalizedUrl,
    rawUrls: Array.from(new Set([...rawUrls, normalizedUrl])),
    imageId: uploaded.id,
    localUrl: uploaded.url || `/api/v1/images/${encodeURIComponent(uploaded.id)}`,
    mimeType: uploaded.mime_type || mimeType,
    sizeBytes: bytes.byteLength,
    filename,
    characterIds: [characterId],
    localizedAt: Date.now(),
  };
}
