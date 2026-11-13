import type {
  CharacterDTO,
  CharacterGalleryItemDTO,
  ImageDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import {
  NATIVE_EXPRESSION_SENTINEL,
  type CharacterMediaScanResult,
  type DiscoveredMediaItem,
  type LocalizedAssetEntry,
  type PendingGalleryLinkItem,
} from "../shared/types.ts";
import {
  collectCharacterExpressionImageIds,
  deriveUrlFilenameParts,
  extractChubExpressionUrlMapFromExtensions,
  extractNativeGalleryUrlsFromCharacter,
} from "../shared/url-scanner.ts";
import {
  deriveBaseFilename,
  type UnmatchedGalleryCandidate,
} from "./downloader.ts";
import type { MediaIndexStore } from "./index-store.ts";

const GENERIC_PLACEHOLDER_FILENAME_RE =
  /^(?:extracted|image|img|media|download|file|unnamed|untitled|photo|pic|picture|thumb|thumbnail|avatar|portrait|banner|background|bg)(?:_[0-9]+)?(?:\.[a-z0-9]{2,5})?$/i;
const REMOTE_GALLERY_AUTONAME_RE =
  /^(?:remote_gallery_|gallery_)[0-9a-f_-]+(?:\.[a-z0-9]{2,5})?$/i;
const EXTRACTED_FILENAME_RE = /^extracted\.([a-z0-9]{2,5})$/i;

function isGenericPlaceholderFilename(filename: string): boolean {
  const trimmed = filename.trim();
  if (!trimmed) return true;
  if (GENERIC_PLACEHOLDER_FILENAME_RE.test(trimmed)) return true;
  if (REMOTE_GALLERY_AUTONAME_RE.test(trimmed)) return true;
  return false;
}

function normalizeExt(extOrMime: string): string {
  const lower = extOrMime.trim().toLowerCase().replace(/^\./, "");
  if (lower === "jpeg" || lower === "jfif" || lower === "pjp" || lower === "pjpeg" || lower === "image/jpeg") {
    return "jpg";
  }
  if (lower === "image/png" || lower === "apng") return "png";
  if (lower === "image/webp") return "webp";
  if (lower === "image/gif") return "gif";
  if (lower === "image/avif") return "avif";
  if (lower === "image/svg+xml") return "svg";
  if (lower === "image/bmp") return "bmp";
  if (lower === "image/x-icon" || lower === "ico") return "ico";
  return lower;
}

function areExtensionsCompatible(urlExt: string, candidateExt: string): boolean {
  if (!urlExt || !candidateExt) return true;
  return normalizeExt(urlExt) === normalizeExt(candidateExt);
}

interface CandidateGalleryAsset {
  imageId: string;
  galleryItemId?: string;
  caption: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
  createdAt: string;
}

export interface GalleryReconciliationResult {
  indexChanged: boolean;
  adoptedCount: number;
  prunedCount: number;
  pendingGalleryLinks: PendingGalleryLinkItem[];
  unmatchedGalleryCandidates: UnmatchedGalleryCandidate[];
}

const IMAGE_METADATA_FETCH_CONCURRENCY = 6;

async function fetchMissingImageMetadata(
  spindle: SpindleAPI,
  userId: string,
  imageIds: Iterable<string>,
  imageMetaById: Map<string, ImageDTO>,
): Promise<Set<string>> {
  const confirmedMissingIds = new Set<string>();
  const imagesApi = spindle.images;
  if (!imagesApi || typeof imagesApi.get !== "function") {
    return confirmedMissingIds;
  }

  const pendingIds: string[] = [];
  const seen = new Set<string>();
  for (const id of imageIds) {
    if (!id || seen.has(id) || imageMetaById.has(id)) continue;
    seen.add(id);
    pendingIds.push(id);
  }
  if (pendingIds.length === 0) {
    return confirmedMissingIds;
  }

  let cursor = 0;
  const workerCount = Math.min(IMAGE_METADATA_FETCH_CONCURRENCY, pendingIds.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < pendingIds.length) {
        const imageId = pendingIds[cursor++];
        if (!imageId) continue;
        try {
          const img = await imagesApi.get(imageId, userId);
          if (img) {
            imageMetaById.set(img.id, img);
          } else {
            confirmedMissingIds.add(imageId);
          }
        } catch {
          // Transient lookup errors should not treat the image as deleted.
        }
      }
    }),
  );

  return confirmedMissingIds;
}

/**
 * Reconciles a character's native Lumiverse Gallery (`character_gallery` + `images`)
 * with `MediaIndexStore` so that:
 * 1. Images downloaded to the native Gallery while the extension was off are
 *    automatically recognized and linked as localized (zero redownload).
 * 2. Images removed from the native Gallery while the extension was off are
 *    unlinked from `MediaIndexStore` so their status reverts to remote.
 * 3. Any localized images not yet present in `character_gallery` are returned in
 *    `pendingGalleryLinks` so the frontend can auto-link them to the Gallery & Portrait panel.
 */
export async function reconcileCharacterGalleryWithIndex(
  spindle: SpindleAPI,
  indexStore: MediaIndexStore,
  userId: string,
  character: CharacterDTO,
  scanItems: DiscoveredMediaItem[],
): Promise<GalleryReconciliationResult> {
  let galleryItems: CharacterGalleryItemDTO[] | null = null;
  if (typeof spindle.characters?.getGallery === "function") {
    try {
      const res = await spindle.characters.getGallery(character.id, userId);
      if (Array.isArray(res)) {
        galleryItems = res;
      }
    } catch {
      galleryItems = null;
    }
  }

  const imageMetaById = new Map<string, ImageDTO>();
  if (typeof spindle.images?.list === "function") {
    try {
      let offset = 0;
      const pageLimit = 200;
      for (let page = 0; page < 25; page++) {
        const listRes = await spindle.images.list({
          characterId: character.id,
          limit: pageLimit,
          offset,
          userId,
        });
        const rows = Array.isArray(listRes?.data) ? listRes.data : [];
        if (rows.length === 0) break;
        for (const img of rows) {
          if (img && typeof img.id === "string") {
            imageMetaById.set(img.id, img);
          }
        }
        offset += rows.length;
        const total = typeof listRes?.total === "number" ? listRes.total : undefined;
        if (total !== undefined ? offset >= total : rows.length < pageLimit) break;
      }
    } catch {
      // ignore
    }
  }

  const expressionInfo = collectCharacterExpressionImageIds(character.extensions);
  const chubExprUrlMap = extractChubExpressionUrlMapFromExtensions(character.extensions);

  const galleryByImageId = new Map<string, CharacterGalleryItemDTO>();
  if (galleryItems) {
    for (const item of galleryItems) {
      if (!item || typeof item.image_id !== "string") continue;
      if (!galleryByImageId.has(item.image_id)) {
        galleryByImageId.set(item.image_id, item);
      }
    }
  }

  await fetchMissingImageMetadata(
    spindle,
    userId,
    [...galleryByImageId.keys(), ...expressionInfo.allImageIds],
    imageMetaById,
  );

  // Build candidate gallery assets list
  const candidates: CandidateGalleryAsset[] = [];
  if (galleryItems) {
    for (const gItem of galleryItems) {
      const meta = imageMetaById.get(gItem.image_id) as
        | (ImageDTO & { byte_size?: number; size?: number })
        | undefined;
      candidates.push({
        imageId: gItem.image_id,
        galleryItemId: gItem.id,
        caption: gItem.caption ?? "",
        originalFilename: meta?.original_filename ?? "",
        mimeType: meta?.mime_type || gItem.mime_type || "image/png",
        byteSize: meta?.byte_size ?? meta?.size ?? 0,
        sortOrder: typeof gItem.sort_order === "number" ? gItem.sort_order : 0,
        createdAt: String(gItem.created_at ?? meta?.created_at ?? ""),
      });
    }
  } else {
    // Fallback if getGallery is not available on this host version: use character-owned images
    let idx = 0;
    for (const rawMeta of imageMetaById.values()) {
      const meta = rawMeta as ImageDTO & { byte_size?: number; size?: number };
      candidates.push({
        imageId: meta.id,
        caption: "",
        originalFilename: meta.original_filename ?? "",
        mimeType: meta.mime_type || "image/png",
        byteSize: meta?.byte_size ?? meta?.size ?? 0,
        sortOrder: idx++,
        createdAt: String(meta.created_at ?? ""),
      });
    }
  }

  const initialState = await indexStore.getState(userId);
  const verifyMissingIds: string[] = [];
  for (const entry of Object.values(initialState.assets)) {
    if (!entry.characterIds.includes(character.id)) continue;
    const knownGalleryItemId =
      entry.galleryItemIds && Object.hasOwn(entry.galleryItemIds, character.id)
        ? entry.galleryItemIds[character.id]
        : undefined;
    const inNativeGallery = galleryByImageId.has(entry.imageId);
    const inNativeExpressions = expressionInfo.allImageIds.has(entry.imageId);

    if (knownGalleryItemId === NATIVE_EXPRESSION_SENTINEL) {
      if (!inNativeExpressions && !inNativeGallery) continue;
    } else if (galleryItems !== null && knownGalleryItemId && !inNativeGallery) {
      continue;
    }
    if (!inNativeGallery && !imageMetaById.has(entry.imageId)) {
      verifyMissingIds.push(entry.imageId);
    }
  }

  const confirmedMissingIds = await fetchMissingImageMetadata(
    spindle,
    userId,
    verifyMissingIds,
    new Map<string, ImageDTO>(),
  );

  const {
    result: { indexChanged, prunedCount, adoptedCount, claimedImageIds },
  } = await indexStore.batchUpdate(userId, (tx) => {
    const state = tx.state;
    const adoptEnabled = state.settings.adoptNativeGalleryImages;
    let localIndexChanged = false;
    let localPrunedCount = 0;
    let localAdoptedCount = 0;

    // 1. Prune entries that were deleted from the native Gallery (or whose underlying image was deleted)
    const pendingSyncLinks: Array<{
      characterId: string;
      normalizedUrl?: string;
      imageId: string;
      galleryItemId: string;
    }> = [];

    for (const entry of Object.values(state.assets)) {
      if (!entry.characterIds.includes(character.id)) continue;

      const knownGalleryItemId =
        entry.galleryItemIds && Object.hasOwn(entry.galleryItemIds, character.id)
          ? entry.galleryItemIds[character.id]
          : undefined;
      const inNativeGallery = galleryByImageId.has(entry.imageId);
      const inNativeExpressions = expressionInfo.allImageIds.has(entry.imageId);

      if (knownGalleryItemId === NATIVE_EXPRESSION_SENTINEL) {
        if (!inNativeExpressions && !inNativeGallery) {
          // Pass undefined for galleryItemId so other native expressions sharing the sentinel are not unlinked.
          const removed = tx.unlinkByCharacterImageId(
            character.id,
            entry.imageId,
            undefined,
          );
          if (removed > 0) {
            localPrunedCount += removed;
            localIndexChanged = true;
          }
          continue;
        }
      } else if (galleryItems !== null && knownGalleryItemId && !inNativeGallery) {
        // If this asset was previously linked in the character's native Gallery and is no longer there,
        // the user removed it from the Gallery while the extension was off (or in another tab).
        const removed = tx.unlinkByCharacterImageId(
          character.id,
          entry.imageId,
          knownGalleryItemId,
        );
        if (removed > 0) {
          localPrunedCount += removed;
          localIndexChanged = true;
        }
        continue;
      }

      // Sync galleryItemId if it is in the native Gallery
      if (inNativeGallery) {
        const gItem = galleryByImageId.get(entry.imageId)!;
        if (knownGalleryItemId !== gItem.id) {
          pendingSyncLinks.push({
            characterId: character.id,
            normalizedUrl: entry.normalizedUrl,
            imageId: entry.imageId,
            galleryItemId: gItem.id,
          });
        }
        continue;
      }

      // Remove entries whose underlying image was confirmed deleted from Lumiverse image store
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

    // Track which imageIds are already claimed by localized entries for this character
    const localClaimedImageIds = new Set<string>();
    const existingAssetByImageId = new Map<string, LocalizedAssetEntry>();
    for (const entry of Object.values(state.assets)) {
      existingAssetByImageId.set(entry.imageId, entry);
      if (entry.characterIds.includes(character.id)) {
        localClaimedImageIds.add(entry.imageId);
      }
    }

    // Track scan items that are not yet localized for this character
    const unlocalizedByUrl = new Map<string, DiscoveredMediaItem>();
    for (const item of scanItems) {
      if (item.mediaKind !== "image") continue;
      const existing = Object.hasOwn(state.assets, item.normalizedUrl)
        ? state.assets[item.normalizedUrl]
        : undefined;
      if (!existing || !existing.characterIds.includes(character.id)) {
        unlocalizedByUrl.set(item.normalizedUrl, item);
      }
    }

    const adoptCandidateForScanItem = (
      cand: CandidateGalleryAsset,
      item: DiscoveredMediaItem,
    ) => {
      const ext = normalizeExt(cand.mimeType);
      const filename =
        cand.originalFilename && !isGenericPlaceholderFilename(cand.originalFilename)
          ? cand.originalFilename
          : deriveBaseFilename(item.normalizedUrl, ext || "png");

      tx.recordLocalizedAsset({
        normalizedUrl: item.normalizedUrl,
        rawUrls: item.rawUrls,
        imageId: cand.imageId,
        localUrl: `/api/v1/images/${cand.imageId}`,
        mimeType: cand.mimeType || "image/png",
        sizeBytes: cand.byteSize || 0,
        filename,
        characterIds: [character.id],
        ...(cand.galleryItemId
          ? { galleryItemIds: { [character.id]: cand.galleryItemId } }
          : {}),
        localizedAt: Date.now(),
      });

      localClaimedImageIds.add(cand.imageId);
      unlocalizedByUrl.delete(item.normalizedUrl);
      localAdoptedCount++;
      localIndexChanged = true;
    };

    // 2. Tier 0: Adopt already-downloaded native expression images if a Chub expression URL is also used in card text
    if (
      adoptEnabled &&
      chubExprUrlMap.size > 0 &&
      expressionInfo.byLabel.size > 0 &&
      unlocalizedByUrl.size > 0
    ) {
      for (const [label, exprUrlInfo] of chubExprUrlMap.entries()) {
        const scanItem = unlocalizedByUrl.get(exprUrlInfo.normalizedUrl);
        if (!scanItem) continue;
        const exprImageId =
          expressionInfo.byLabel.get(label) ??
          expressionInfo.byLabel.get(label.toLowerCase());
        if (!exprImageId) continue;

        const meta = imageMetaById.get(exprImageId) as
          | (ImageDTO & { byte_size?: number; size?: number })
          | undefined;
        if (imageMetaById.size > 0 && !meta) continue;

        adoptCandidateForScanItem(
          {
            imageId: exprImageId,
            galleryItemId: NATIVE_EXPRESSION_SENTINEL,
            caption: `Expression: ${label}`,
            originalFilename: meta?.original_filename ?? "",
            mimeType: meta?.mime_type || "image/png",
            byteSize: meta?.byte_size ?? meta?.size ?? 0,
            sortOrder: 0,
            createdAt: String(meta?.created_at ?? ""),
          },
          scanItem,
        );
      }
    }

    // 3. Tier 1: Match unclaimed gallery items by existing imageId in index or URL in caption
    for (const cand of candidates) {
      if (localClaimedImageIds.has(cand.imageId)) continue;

      // 2a. Known imageId from another character or prior session
      const knownEntry = existingAssetByImageId.get(cand.imageId);
      if (knownEntry) {
        const scanItem = unlocalizedByUrl.get(knownEntry.normalizedUrl);
        if (scanItem) {
          const linked = tx.linkExistingAssetToCharacter(
            knownEntry.normalizedUrl,
            scanItem.rawUrls,
            character.id,
            cand.galleryItemId,
          );
          if (linked) {
            localClaimedImageIds.add(cand.imageId);
            unlocalizedByUrl.delete(knownEntry.normalizedUrl);
            localAdoptedCount++;
            localIndexChanged = true;
          }
          continue;
        }
      }

      // 2b. Caption contains or equals the remote URL
      const captionTrimmed = cand.caption.trim();
      if (adoptEnabled && captionTrimmed) {
        let matchedItem: DiscoveredMediaItem | undefined;
        for (const item of unlocalizedByUrl.values()) {
          if (
            captionTrimmed === item.normalizedUrl ||
            captionTrimmed.includes(item.normalizedUrl) ||
            item.rawUrls.some((r) => captionTrimmed === r || captionTrimmed.includes(r))
          ) {
            matchedItem = item;
            break;
          }
        }
        if (matchedItem) {
          adoptCandidateForScanItem(cand, matchedItem);
        }
      }
    }

    // 3. Tier 2: Match unclaimed gallery items by non-generic original_filename or caption filename
    for (const cand of candidates) {
      if (!adoptEnabled) break;
      if (localClaimedImageIds.has(cand.imageId)) continue;
      if (unlocalizedByUrl.size === 0) break;

      const nameCandidates = [cand.originalFilename, cand.caption]
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !isGenericPlaceholderFilename(s));

      if (nameCandidates.length === 0) continue;

      let matchedItem: DiscoveredMediaItem | undefined;
      for (const rawName of nameCandidates) {
        const lowerName = rawName.toLowerCase();
        const stemName = lowerName.replace(/\.[a-z0-9]{2,5}$/i, "");
        const candExt = normalizeExt(
          /\.([a-z0-9]{2,5})$/i.exec(lowerName)?.[1] || cand.mimeType,
        );

        for (const item of unlocalizedByUrl.values()) {
          const parts = deriveUrlFilenameParts(item.normalizedUrl);
          const itemBaseLower = parts.basename.toLowerCase();
          const itemCleanBaseLower = parts.ext
            ? `${parts.cleanedStem.toLowerCase()}.${parts.ext.toLowerCase()}`
            : parts.cleanedStem.toLowerCase();
          const itemStemLower = parts.cleanedStem.toLowerCase();

          if (itemBaseLower === lowerName || itemCleanBaseLower === lowerName) {
            matchedItem = item;
            break;
          }
          if (
            stemName.length >= 3 &&
            itemStemLower === stemName &&
            areExtensionsCompatible(parts.ext, candExt)
          ) {
            matchedItem = item;
            break;
          }
        }
        if (matchedItem) break;
      }

      if (matchedItem) {
        adoptCandidateForScanItem(cand, matchedItem);
      }
    }

    // 4. Tier 3: Match native `/gallery/extract` ("Embedded Images -> Import All") `extracted.<ext>` items
    const extractedCandidates = candidates
      .filter(
        (c) =>
          !localClaimedImageIds.has(c.imageId) &&
          EXTRACTED_FILENAME_RE.test(c.originalFilename.trim()),
      )
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
      );

    if (adoptEnabled && extractedCandidates.length > 0 && unlocalizedByUrl.size > 0) {
      const nativeExtractUrls = extractNativeGalleryUrlsFromCharacter(character);
      // Only URLs in the host's native extraction order are eligible. We deliberately do NOT
      // fall back to arbitrary remaining URLs or incompatible extensions: a wrong guess would
      // bind an unrelated image to a URL and show it in chat.
      const availableExtractItems: DiscoveredMediaItem[] = [];
      for (const url of nativeExtractUrls) {
        const item = unlocalizedByUrl.get(url);
        if (item && !availableExtractItems.includes(item)) {
          availableExtractItems.push(item);
        }
      }

      for (const cand of extractedCandidates) {
        if (availableExtractItems.length === 0) break;
        const extFromName =
          EXTRACTED_FILENAME_RE.exec(cand.originalFilename.trim())?.[1] ?? "";
        const candExt = normalizeExt(extFromName || cand.mimeType);

        // Find the first available item in extraction order with a compatible extension
        const matchIdx = availableExtractItems.findIndex((item) => {
          const parts = deriveUrlFilenameParts(item.normalizedUrl);
          return areExtensionsCompatible(parts.ext, candExt);
        });
        if (matchIdx === -1) continue;

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
      claimedImageIds: localClaimedImageIds,
    };
  });

  // 5. Build pendingGalleryLinks (for localized images not yet in character_gallery)
  //    and unmatchedGalleryCandidates (for byte-level deduplication during download queue)
  const finalState = await indexStore.getState(userId);
  const pendingGalleryLinks: PendingGalleryLinkItem[] = [];
  const seenPendingImageIds = new Set<string>();

  for (const item of scanItems) {
    if (item.mediaKind !== "image") continue;
    const entry = Object.hasOwn(finalState.assets, item.normalizedUrl)
      ? finalState.assets[item.normalizedUrl]
      : undefined;
    if (!entry || !entry.characterIds.includes(character.id)) continue;
    if (!entry.mimeType.startsWith("image/")) continue;

    const alreadyInGallery =
      galleryByImageId.has(entry.imageId) ||
      Boolean(
        entry.galleryItemIds &&
          Object.hasOwn(entry.galleryItemIds, character.id) &&
          entry.galleryItemIds[character.id],
      ) ||
      expressionInfo.allImageIds.has(entry.imageId);

    if (!alreadyInGallery && !seenPendingImageIds.has(entry.imageId)) {
      seenPendingImageIds.add(entry.imageId);
      pendingGalleryLinks.push({
        characterId: character.id,
        imageId: entry.imageId,
        normalizedUrl: item.normalizedUrl,
        caption: entry.filename || item.sources[0]?.label || "",
      });
    }
  }

  const unmatchedGalleryCandidates: UnmatchedGalleryCandidate[] = candidates
    .filter((c) => !claimedImageIds.has(c.imageId))
    .map((c) => ({
      imageId: c.imageId,
      galleryItemId: expressionInfo.allImageIds.has(c.imageId)
        ? (c.galleryItemId ?? NATIVE_EXPRESSION_SENTINEL)
        : c.galleryItemId,
      byteSize: c.byteSize,
      mimeType: c.mimeType,
    }));

  const seenCandidateImageIds = new Set(
    unmatchedGalleryCandidates.map((c) => c.imageId),
  );
  for (const exprImageId of expressionInfo.allImageIds) {
    if (claimedImageIds.has(exprImageId) || seenCandidateImageIds.has(exprImageId)) {
      continue;
    }
    const meta = imageMetaById.get(exprImageId) as
      | (ImageDTO & { byte_size?: number; size?: number })
      | undefined;
    unmatchedGalleryCandidates.push({
      imageId: exprImageId,
      galleryItemId: NATIVE_EXPRESSION_SENTINEL,
      byteSize: meta?.byte_size ?? meta?.size ?? 0,
      mimeType: meta?.mime_type || "image/png",
    });
    seenCandidateImageIds.add(exprImageId);
  }

  return {
    indexChanged,
    adoptedCount,
    prunedCount,
    pendingGalleryLinks,
    unmatchedGalleryCandidates,
  };
}

/**
 * Helper to apply updated `MediaIndexStore` state onto an existing `CharacterMediaScanResult`.
 */
export function refreshScanResultWithIndexState(
  scan: CharacterMediaScanResult,
  assets: Record<string, LocalizedAssetEntry>,
  failedUrls: Record<string, { error: string; lastAttemptAt: number }>,
): CharacterMediaScanResult {
  // Re-evaluate item statuses and recompute section/greeting/worldbook/domain counts
  for (const sec of Object.keys(scan.sectionCounts) as Array<
    keyof typeof scan.sectionCounts
  >) {
    scan.sectionCounts[sec] = {
      totalUnique: 0,
      remoteCount: 0,
      localizedCount: 0,
      failedCount: 0,
    };
  }

  const greetingMap = new Map<
    number,
    CharacterMediaScanResult["greetingBreakdown"][number]
  >();
  const worldBookMap = new Map<
    string,
    CharacterMediaScanResult["worldBookBreakdown"][number]
  >();
  const domainMap = new Map<
    string,
    CharacterMediaScanResult["domainBreakdown"][number]
  >();

  for (const item of scan.items) {
    const localized = Object.hasOwn(assets, item.normalizedUrl)
      ? assets[item.normalizedUrl]
      : undefined;
    const failure = Object.hasOwn(failedUrls, item.normalizedUrl)
      ? failedUrls[item.normalizedUrl]
      : undefined;
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

    const seenSections = new Set<keyof typeof scan.sectionCounts>();
    const seenGreetings = new Set<number>();
    const seenWorldBooks = new Set<string>();

    for (const src of item.sources) {
      if (!seenSections.has(src.section)) {
        seenSections.add(src.section);
        const summary = scan.sectionCounts[src.section];
        summary.totalUnique++;
        if (item.status === "localized") summary.localizedCount++;
        else if (item.status === "failed") summary.failedCount++;
        else summary.remoteCount++;
      }

      if (
        src.section === "alternate_greetings" &&
        typeof src.greetingIndex === "number" &&
        !seenGreetings.has(src.greetingIndex)
      ) {
        seenGreetings.add(src.greetingIndex);
        let g = greetingMap.get(src.greetingIndex);
        if (!g) {
          g = {
            greetingIndex: src.greetingIndex,
            label: src.label,
            totalUnique: 0,
            remoteCount: 0,
            localizedCount: 0,
            failedCount: 0,
          };
          greetingMap.set(src.greetingIndex, g);
        }
        g.totalUnique++;
        if (item.status === "localized") g.localizedCount++;
        else if (item.status === "failed") g.failedCount++;
        else g.remoteCount++;
      }

      if (
        src.section === "world_books" &&
        src.worldBookId &&
        !seenWorldBooks.has(src.worldBookId)
      ) {
        seenWorldBooks.add(src.worldBookId);
        let wb = worldBookMap.get(src.worldBookId);
        if (!wb) {
          wb = {
            worldBookId: src.worldBookId,
            worldBookName: src.worldBookName || src.worldBookId,
            totalUnique: 0,
            remoteCount: 0,
            localizedCount: 0,
            failedCount: 0,
          };
          worldBookMap.set(src.worldBookId, wb);
        }
        wb.totalUnique++;
        if (item.status === "localized") wb.localizedCount++;
        else if (item.status === "failed") wb.failedCount++;
        else wb.remoteCount++;
      }
    }

    let d = domainMap.get(item.domain);
    if (!d) {
      d = {
        domain: item.domain,
        totalUnique: 0,
        remoteCount: 0,
        localizedCount: 0,
        failedCount: 0,
      };
      domainMap.set(item.domain, d);
    }
    d.totalUnique++;
    if (item.status === "localized") d.localizedCount++;
    else if (item.status === "failed") d.failedCount++;
    else d.remoteCount++;
  }

  scan.greetingBreakdown = Array.from(greetingMap.values()).sort(
    (a, b) => a.greetingIndex - b.greetingIndex,
  );
  scan.worldBookBreakdown = Array.from(worldBookMap.values()).sort((a, b) =>
    a.worldBookName.localeCompare(b.worldBookName),
  );
  scan.domainBreakdown = Array.from(domainMap.values()).sort(
    (a, b) => b.totalUnique - a.totalUnique || a.domain.localeCompare(b.domain),
  );

  return scan;
}
