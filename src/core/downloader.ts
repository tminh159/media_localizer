import type { SpindleAPI } from "lumiverse-spindle-types";
import type { LocalizedAssetEntry } from "../shared/types.ts";
import { isBlockedRemoteHostname } from "../shared/url-scanner.ts";

export interface UnmatchedGalleryCandidate {
  imageId: string;
  galleryItemId?: string;
  byteSize?: number;
  mimeType?: string;
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

/**
 * Inspects magic bytes of the downloaded binary to detect the true MIME type
 * and reject HTML error pages returned by CDNs with HTTP 200.
 */
export function detectMediaMimeType(
  bytes: Uint8Array,
  headerMimeType?: string | null,
  urlPath?: string,
): { mimeType: string; ext: string } {
  if (bytes.byteLength >= 12) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return { mimeType: "image/png", ext: "png" };
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mimeType: "image/jpeg", ext: "jpg" };
    }
    // GIF: GIF87a / GIF89a
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return { mimeType: "image/gif", ext: "gif" };
    }
    // WEBP: RIFF....WEBP
    if (
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
    // BMP: "BM" + plausible header (file size field must not exceed actual length by much)
    if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0) {
      return { mimeType: "image/bmp", ext: "bmp" };
    }
    // ICO: 00 00 01 00
    if (
      bytes[0] === 0x00 &&
      bytes[1] === 0x00 &&
      bytes[2] === 0x01 &&
      bytes[3] === 0x00
    ) {
      return { mimeType: "image/x-icon", ext: "ico" };
    }
    // WEBM / MKV: 1A 45 DF A3
    if (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    ) {
      return { mimeType: "video/webm", ext: "webm" };
    }
    // ISO Base Media (MP4 / AVIF): ....ftyp
    if (
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
  }

  // Check text prefix for HTML error pages, SVGs, or active scripts
  const headText = new TextDecoder()
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 1024)))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (/^<!doctype\s+html/i.test(headText) || /^<html\b/i.test(headText)) {
    throw new Error("Remote server returned an HTML page instead of media");
  }
  if (
    /^<svg\b/i.test(headText) ||
    /^<!doctype\s+svg\b/i.test(headText) ||
    (headText.startsWith("<?xml") && /<svg\b/i.test(headText))
  ) {
    throw new Error("SVG media is disallowed for security reasons");
  }
  if (/^<script\b/i.test(headText)) {
    throw new Error("Remote server returned script content instead of media");
  }

  // Fallback to Content-Type header if recognized
  const cleanHeader = (headerMimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (cleanHeader === "image/svg+xml" || cleanHeader === "image/svg") {
    throw new Error("SVG media (image/svg+xml) is disallowed for security reasons");
  }
  if (cleanHeader && MIME_TO_EXT[cleanHeader]) {
    return { mimeType: cleanHeader, ext: MIME_TO_EXT[cleanHeader]! };
  }

  // Text/JSON/XML/script bodies are never media, even if the URL path ends in `.png`
  if (
    cleanHeader.startsWith("text/") ||
    cleanHeader === "application/json" ||
    cleanHeader === "application/xml" ||
    cleanHeader === "application/xhtml+xml" ||
    cleanHeader === "application/javascript" ||
    cleanHeader === "text/javascript"
  ) {
    throw new Error(`Unsupported response content-type: ${cleanHeader}`);
  }

  // Fallback to URL extension (e.g. CDNs serving `application/octet-stream`)
  if (urlPath) {
    const extMatch = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(urlPath);
    const ext = extMatch?.[1]?.toLowerCase() ?? "";
    if (ext === "svg") {
      throw new Error("SVG media is disallowed for security reasons");
    }
    if (ext && EXT_TO_MIME[ext]) {
      const mime = EXT_TO_MIME[ext]!;
      return { mimeType: mime, ext: MIME_TO_EXT[mime] ?? ext };
    }
  }

  throw new Error(
    `Unrecognized media format${cleanHeader ? ` (content-type: ${cleanHeader})` : ""}`,
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
): Promise<LocalizedAssetEntry> {
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
            localUrl: `/api/v1/images/${cand.imageId}`,
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
    localUrl: uploaded.url || `/api/v1/images/${uploaded.id}`,
    mimeType: uploaded.mime_type || mimeType,
    sizeBytes: bytes.byteLength,
    filename,
    characterIds: [characterId],
    localizedAt: Date.now(),
  };
}
