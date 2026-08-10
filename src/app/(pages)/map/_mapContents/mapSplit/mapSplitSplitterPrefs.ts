import {
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
} from '../../_mapComponents/mapSplit/mapSplitTypes';

export type MapSplitSplitterPrefs = {
  controlOffsetRatio: number;
  expanded: boolean;
};

export const MAP_SPLIT_SPLITTER_PREFS_DEFAULT: MapSplitSplitterPrefs = {
  controlOffsetRatio: 0.5,
  expanded: true,
};

const STORAGE_PREFIX = 'ggnr:map:mapSplitSplitter';

export function getMapSplitSplitterStorageKey(projectName?: string): string {
  const name = String(projectName ?? '').trim();
  return name ? `${STORAGE_PREFIX}:${name}` : STORAGE_PREFIX;
}

function clampOffsetRatio(r: number): number {
  return Math.min(MAP_SPLIT_CONTROL_OFFSET_MAX, Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, r));
}

export function loadMapSplitSplitterPrefs(projectName?: string): MapSplitSplitterPrefs {
  if (typeof window === 'undefined') return { ...MAP_SPLIT_SPLITTER_PREFS_DEFAULT };
  try {
    const raw = localStorage.getItem(getMapSplitSplitterStorageKey(projectName));
    if (!raw) return { ...MAP_SPLIT_SPLITTER_PREFS_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<MapSplitSplitterPrefs>;
    return {
      controlOffsetRatio:
        typeof parsed.controlOffsetRatio === 'number'
          ? clampOffsetRatio(parsed.controlOffsetRatio)
          : MAP_SPLIT_SPLITTER_PREFS_DEFAULT.controlOffsetRatio,
      expanded:
        typeof parsed.expanded === 'boolean'
          ? parsed.expanded
          : MAP_SPLIT_SPLITTER_PREFS_DEFAULT.expanded,
    };
  } catch {
    return { ...MAP_SPLIT_SPLITTER_PREFS_DEFAULT };
  }
}

export function saveMapSplitSplitterPrefs(
  projectName: string | undefined,
  prefs: MapSplitSplitterPrefs
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      getMapSplitSplitterStorageKey(projectName),
      JSON.stringify({
        controlOffsetRatio: clampOffsetRatio(prefs.controlOffsetRatio),
        expanded: prefs.expanded,
      })
    );
  } catch {
    /* quota 등 — 무시 */
  }
}
