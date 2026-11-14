import {
  ALL_MEDIA_KINDS,
  ALL_MEDIA_SECTIONS,
  DEFAULT_SETTINGS,
  type CharacterDownloadOverride,
  type CharacterMediaScanResult,
  type DownloadFilterOptions,
  type MediaKind,
  type MediaLocalizerSettings,
  type MediaSourceSection,
} from "./types.ts";

const MAX_FILTER_ARRAY_ITEMS = 5000;
const MAX_FILTER_STRING_LEN = 2048;

function uniqueStrings(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    if (out.length >= MAX_FILTER_ARRAY_ITEMS) break;
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_FILTER_STRING_LEN || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function uniqueNumbers(values: unknown): number[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of values) {
    if (out.length >= MAX_FILTER_ARRAY_ITEMS) break;
    if (typeof item !== "number" || !Number.isFinite(item)) continue;
    const n = Math.floor(item);
    if (n < 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

const MAX_BATCH_ITEMS = 2000;

function clampBoundedInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function sanitizeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * Normalizes untrusted persisted or RPC override input into a clean `CharacterDownloadOverride`.
 * Empty arrays are omitted so `sanitizeOverride`, `isOverrideEmpty`, and `buildEffectiveFilter`
 * agree that empty filter lists inherit defaults rather than persisting dead overrides.
 */
export function sanitizeOverride(raw: unknown): CharacterDownloadOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const out: CharacterDownloadOverride = {};

  if (Array.isArray(obj.sections)) {
    const valid = Array.from(
      new Set(
        obj.sections.filter(
          (s): s is MediaSourceSection =>
            typeof s === "string" &&
            (ALL_MEDIA_SECTIONS as readonly string[]).includes(s),
        ),
      ),
    );
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
    const validKinds = Array.from(
      new Set(
        obj.mediaKinds.filter(
          (k): k is MediaKind =>
            typeof k === "string" &&
            (ALL_MEDIA_KINDS as readonly string[]).includes(k),
        ),
      ),
    );
    if (validKinds.length > 0) {
      out.mediaKinds = validKinds;
    }
  }

  if (typeof obj.includeFailed === "boolean") {
    out.includeFailed = obj.includeFailed;
  }

  const maxItems = sanitizeNonNegativeInt(obj.maxItems);
  if (maxItems !== undefined) {
    // 0 explicitly represents "unlimited" in both overrides and queue batch caps.
    out.maxItems = Math.min(MAX_BATCH_ITEMS, maxItems);
  }

  const excludedUrls = uniqueStrings(obj.excludedUrls);
  if (excludedUrls && excludedUrls.length > 0) {
    out.excludedUrls = excludedUrls;
  }

  return out;
}

export function isOverrideEmpty(
  override: CharacterDownloadOverride | null | undefined,
): boolean {
  if (!override) return true;
  const clean = sanitizeOverride(override);
  return Object.keys(clean).length === 0;
}

/**
 * Resolves the effective download filter for a character by overlaying any
 * per-character `override` onto the user's global `settings`.
 */
export function buildEffectiveFilter(
  settings: MediaLocalizerSettings,
  scan?: CharacterMediaScanResult,
  override?: CharacterDownloadOverride | null,
): Omit<DownloadFilterOptions, "characterIds"> {
  const rawOverride = override !== undefined ? override : scan?.override ?? null;
  const effOverride = rawOverride ? sanitizeOverride(rawOverride) : null;

  const settingsSections = Array.isArray(settings.defaultSections)
    ? Array.from(
        new Set(
          settings.defaultSections.filter((s): s is MediaSourceSection =>
            (ALL_MEDIA_SECTIONS as readonly string[]).includes(s),
          ),
        ),
      )
    : [];
  const sections =
    effOverride?.sections && effOverride.sections.length > 0
      ? [...effOverride.sections]
      : settingsSections.length > 0
        ? settingsSections
        : [...ALL_MEDIA_SECTIONS];

  const settingsKinds = Array.isArray(settings.defaultMediaKinds)
    ? Array.from(
        new Set(
          settings.defaultMediaKinds.filter((k): k is MediaKind =>
            (ALL_MEDIA_KINDS as readonly string[]).includes(k),
          ),
        ),
      )
    : [];
  const mediaKinds =
    effOverride?.mediaKinds && effOverride.mediaKinds.length > 0
      ? [...effOverride.mediaKinds]
      : settingsKinds.length > 0
        ? settingsKinds
        : [...ALL_MEDIA_KINDS];

  const includeFailed =
    typeof effOverride?.includeFailed === "boolean"
      ? effOverride.includeFailed
      : typeof settings.defaultIncludeFailed === "boolean"
        ? settings.defaultIncludeFailed
        : DEFAULT_SETTINGS.defaultIncludeFailed;

  const defaultBatchCap = Math.min(
    MAX_BATCH_ITEMS,
    sanitizeNonNegativeInt(settings.defaultBatchCap) ??
      DEFAULT_SETTINGS.defaultBatchCap,
  );
  const maxItems =
    effOverride?.maxItems !== undefined ? effOverride.maxItems : defaultBatchCap;

  const maxFileSizeMb = clampBoundedInt(
    settings.maxFileSizeMb,
    1,
    200,
    DEFAULT_SETTINGS.maxFileSizeMb,
  );
  const timeoutSeconds = clampBoundedInt(
    settings.timeoutSeconds,
    5,
    120,
    DEFAULT_SETTINGS.timeoutSeconds,
  );
  const concurrency = clampBoundedInt(
    settings.concurrency,
    1,
    5,
    DEFAULT_SETTINGS.concurrency,
  );

  const filter: Omit<DownloadFilterOptions, "characterIds"> = {
    sections,
    mediaKinds,
    includeFailed,
    maxItems,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    timeoutMs: timeoutSeconds * 1000,
    concurrency,
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

