import {
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
} from '../../_mapComponents/mapSplit/mapSplitTypes';

export type StreetViewSplitterPrefs = {
  controlOffsetRatio: number;
  expanded: boolean;
};

export const STREET_VIEW_SPLITTER_PREFS_DEFAULT: StreetViewSplitterPrefs = {
  controlOffsetRatio: 0.5,
  expanded: true,
};

const STORAGE_PREFIX = 'ggnr:map:streetViewSplitter';

export function getStreetViewSplitterStorageKey(projectName?: string): string {
  const name = String(projectName ?? '').trim();
  return name ? `${STORAGE_PREFIX}:${name}` : STORAGE_PREFIX;
}

function clampOffsetRatio(r: number): number {
  return Math.min(MAP_SPLIT_CONTROL_OFFSET_MAX, Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, r));
}

export function loadStreetViewSplitterPrefs(
  projectName?: string
): StreetViewSplitterPrefs {
  if (typeof window === 'undefined') return { ...STREET_VIEW_SPLITTER_PREFS_DEFAULT };
  try {
    const raw = localStorage.getItem(getStreetViewSplitterStorageKey(projectName));
    if (!raw) return { ...STREET_VIEW_SPLITTER_PREFS_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<StreetViewSplitterPrefs>;
    return {
      controlOffsetRatio:
        typeof parsed.controlOffsetRatio === 'number'
          ? clampOffsetRatio(parsed.controlOffsetRatio)
          : STREET_VIEW_SPLITTER_PREFS_DEFAULT.controlOffsetRatio,
      expanded:
        typeof parsed.expanded === 'boolean'
          ? parsed.expanded
          : STREET_VIEW_SPLITTER_PREFS_DEFAULT.expanded,
    };
  } catch {
    return { ...STREET_VIEW_SPLITTER_PREFS_DEFAULT };
  }
}

export function saveStreetViewSplitterPrefs(
  projectName: string | undefined,
  prefs: StreetViewSplitterPrefs
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      getStreetViewSplitterStorageKey(projectName),
      JSON.stringify({
        controlOffsetRatio: clampOffsetRatio(prefs.controlOffsetRatio),
        expanded: prefs.expanded,
      })
    );
  } catch {
    /* quota 등 — 무시 */
  }
}
