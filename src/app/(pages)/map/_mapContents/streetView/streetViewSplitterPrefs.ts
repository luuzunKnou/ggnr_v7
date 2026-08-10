export type StreetViewSplitterPrefs = {
  expanded: boolean;
};

export const STREET_VIEW_SPLITTER_PREFS_DEFAULT: StreetViewSplitterPrefs = {
  expanded: true,
};

const STORAGE_PREFIX = 'ggnr:map:streetViewSplitter';

export function getStreetViewSplitterStorageKey(projectName?: string): string {
  const name = String(projectName ?? '').trim();
  return name ? `${STORAGE_PREFIX}:${name}` : STORAGE_PREFIX;
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
      JSON.stringify({ expanded: prefs.expanded })
    );
  } catch {
    /* quota 등 — 무시 */
  }
}
