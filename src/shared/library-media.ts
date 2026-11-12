import type {
  LibraryMediaCharacter,
  LocalizedAssetEntry,
} from "./types.ts";
import { extractCharacterExpressions } from "./url-scanner.ts";

export interface LibraryMediaCharacterInput {
  id: string;
  name: string;
  image_id?: string | null;
  extensions?: Record<string, unknown> | null;
}

export function buildLibraryMedia(
  characters: LibraryMediaCharacterInput[],
  assets: Record<string, LocalizedAssetEntry>,
  options?: { includeEmpty?: boolean },
): LibraryMediaCharacter[] {
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

  const result: LibraryMediaCharacter[] = [];
  for (const char of characters) {
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
      if (entry.localizedAt > lastLocalizedAt) {
        lastLocalizedAt = entry.localizedAt;
      }
      if (seenAssetIds.has(entry.imageId)) {
        continue;
      }
      seenAssetIds.add(entry.imageId);
      totalSizeBytes += entry.sizeBytes || 0;
      // Native expression images already appear in `expressions` with their sprite label.
      if (exprImageIds.has(entry.imageId)) {
        continue;
      }
      localizedAssets.push(entry);
    }

    localizedAssets.sort(
      (a, b) => b.localizedAt - a.localizedAt || a.filename.localeCompare(b.filename),
    );

    if (
      !options?.includeEmpty &&
      localizedAssets.length === 0 &&
      expressions.length === 0
    ) {
      continue;
    }

    result.push({
      characterId: char.id,
      characterName: char.name,
      avatarImageId,
      avatarUrl,
      localizedAssets,
      expressions,
      totalSizeBytes,
      lastLocalizedAt,
    });
  }

  return result;
}

