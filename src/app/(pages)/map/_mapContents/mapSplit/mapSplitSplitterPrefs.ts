export type MapSplitSplitterPrefs = {
  expanded: boolean;
};

export const MAP_SPLIT_SPLITTER_PREFS_DEFAULT: MapSplitSplitterPrefs = {
  expanded: true,
};

const STORAGE_PREFIX = 'ggnr:map:mapSplitSplitter';

export function getMapSplitSplitterStorageKey(projectName?: string): string {
  const name = String(projectName ?? '').trim();
  return name ? `${STORAGE_PREFIX}:${name}` : STORAGE_PREFIX;
}

export function loadMapSplitSplitterPrefs(projectName?: string): MapSplitSplitterPrefs {
  if (typeof window === 'undefined') return { ...MAP_SPLIT_SPLITTER_PREFS_DEFAULT };
  try {
    const raw = localStorage.getItem(getMapSplitSplitterStorageKey(projectName));
    if (!raw) return { ...MAP_SPLIT_SPLITTER_PREFS_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<MapSplitSplitterPrefs>;
    return {
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
      JSON.stringify({ expanded: prefs.expanded })
    );
  } catch {
    /* quota 등 — 무시 */
  }
}
