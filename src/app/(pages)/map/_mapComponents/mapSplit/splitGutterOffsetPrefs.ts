import {
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
} from './mapSplitTypes';

/** 지도분할·거리뷰 거터 pill 위치 — 기능 공용 */
const STORAGE_PREFIX = 'ggnr:map:splitGutterOffset';

const LEGACY_MAP_SPLIT_PREFIX = 'ggnr:map:mapSplitSplitter';
const LEGACY_STREET_VIEW_PREFIX = 'ggnr:map:streetViewSplitter';

function legacyStorageKeys(projectName?: string): string[] {
  const name = String(projectName ?? '').trim();
  const suffix = name ? `:${name}` : '';
  return [`${LEGACY_MAP_SPLIT_PREFIX}${suffix}`, `${LEGACY_STREET_VIEW_PREFIX}${suffix}`];
}

export function getSplitGutterOffsetStorageKey(projectName?: string): string {
  const name = String(projectName ?? '').trim();
  return name ? `${STORAGE_PREFIX}:${name}` : STORAGE_PREFIX;
}

function clampOffsetRatio(r: number): number {
  return Math.min(MAP_SPLIT_CONTROL_OFFSET_MAX, Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, r));
}

function readRatioFromLegacyPrefs(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { controlOffsetRatio?: unknown };
    if (typeof parsed.controlOffsetRatio === 'number') {
      return clampOffsetRatio(parsed.controlOffsetRatio);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 공용 offset 로드 — 없으면 구 mapSplit/streetView 키에서 1회 이전 */
export function loadSplitGutterControlOffsetRatio(projectName?: string): number {
  if (typeof window === 'undefined') return 0.5;
  try {
    const raw = localStorage.getItem(getSplitGutterOffsetStorageKey(projectName));
    if (raw) {
      const parsed = JSON.parse(raw) as number | { controlOffsetRatio?: unknown };
      if (typeof parsed === 'number') return clampOffsetRatio(parsed);
      if (typeof parsed.controlOffsetRatio === 'number') {
        return clampOffsetRatio(parsed.controlOffsetRatio);
      }
    }
  } catch {
    /* ignore */
  }

  for (const key of legacyStorageKeys(projectName)) {
    const legacy = readRatioFromLegacyPrefs(localStorage.getItem(key));
    if (legacy != null) {
      saveSplitGutterControlOffsetRatio(projectName, legacy);
      return legacy;
    }
  }
  return 0.5;
}

export function saveSplitGutterControlOffsetRatio(
  projectName: string | undefined,
  controlOffsetRatio: number
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      getSplitGutterOffsetStorageKey(projectName),
      JSON.stringify(clampOffsetRatio(controlOffsetRatio))
    );
  } catch {
    /* quota 등 — 무시 */
  }
}
