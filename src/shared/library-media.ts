import type {
  LibraryMediaCharacter,
  LocalizedAssetEntry,
} from "./types.ts";
import { extractCharacterExpressions } from "./url-scanner.ts";

export interface LibraryMediaCharacterInput {
  id: string;
  name: string;
  image_id?: string | null;
  tags?: string[] | null;
  extensions?: Record<string, unknown> | null;
}

export function groupLibraryAssetsByCharacter(
  assets: Record<string, LocalizedAssetEntry>,
): Map<string, LocalizedAssetEntry[]> {
  const byCharacter = new Map<string, LocalizedAssetEntry[]>();
  for (const entry of Object.values(assets)) {
    if (!Array.isArray(entry.characterIds)) continue;
    for (const charId of new Set(entry.characterIds)) {
      if (typeof charId !== "string" || !charId) continue;
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

export function buildLibraryMediaCharacter(
  char: LibraryMediaCharacterInput,
  byCharacter: Map<string, LocalizedAssetEntry[]>,
  options?: { includeEmpty?: boolean },
): LibraryMediaCharacter | null {
  const avatarImageId =
    typeof char.image_id === "string" && char.image_id.trim()
      ? char.image_id.trim()
      : null;
  const avatarUrl = avatarImageId
    ? `/api/v1/images/${encodeURIComponent(avatarImageId)}`
    : null;

  const expressions = extractCharacterExpressions(char.extensions);
  const exprImageIds = new Set(expressions.map((e) => e.imageId));

  const rawAssets = byCharacter.get(char.id) ?? [];
  let totalSizeBytes = 0;
  let lastLocalizedAt = 0;
  const seenAssetIds = new Set<string>();
  const localizedAssets: LocalizedAssetEntry[] = [];

  for (const entry of rawAssets) {
    const localizedAt =
      typeof entry.localizedAt === "number" && Number.isFinite(entry.localizedAt)
        ? entry.localizedAt
        : 0;
    if (localizedAt > lastLocalizedAt) {
      lastLocalizedAt = localizedAt;
    }
    if (seenAssetIds.has(entry.imageId)) {
      continue;
    }
    seenAssetIds.add(entry.imageId);
    const sizeBytes =
      typeof entry.sizeBytes === "number" &&
      Number.isFinite(entry.sizeBytes) &&
      entry.sizeBytes > 0
        ? entry.sizeBytes
        : 0;
    totalSizeBytes += sizeBytes;
    // Native expression images already appear in `expressions` with their sprite label.
    if (exprImageIds.has(entry.imageId)) {
      continue;
    }
    localizedAssets.push(entry);
  }

  localizedAssets.sort(
    (a, b) =>
      (Number.isFinite(b.localizedAt) ? b.localizedAt : 0) -
        (Number.isFinite(a.localizedAt) ? a.localizedAt : 0) ||
      String(a.filename ?? "").localeCompare(String(b.filename ?? "")),
  );

  if (
    !options?.includeEmpty &&
    localizedAssets.length === 0 &&
    expressions.length === 0
  ) {
    return null;
  }

  const tags = Array.isArray(char.tags)
    ? Array.from(
        new Set(
          char.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      )
    : [];

  return {
    characterId: char.id,
    characterName: char.name,
    ...(tags.length > 0 ? { tags } : {}),
    avatarImageId,
    avatarUrl,
    localizedAssets,
    expressions,
    totalSizeBytes,
    lastLocalizedAt,
  };
}

export function buildLibraryMedia(
  characters: LibraryMediaCharacterInput[],
  assets: Record<string, LocalizedAssetEntry>,
  options?: { includeEmpty?: boolean },
): LibraryMediaCharacter[] {
  const byCharacter = groupLibraryAssetsByCharacter(assets);
  const result: LibraryMediaCharacter[] = [];
  for (const char of characters) {
    const item = buildLibraryMediaCharacter(char, byCharacter, options);
    if (item) {
      result.push(item);
    }
  }
  return result;
}

