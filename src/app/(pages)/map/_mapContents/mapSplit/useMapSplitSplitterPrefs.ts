'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadMapSplitSplitterPrefs,
  MAP_SPLIT_SPLITTER_PREFS_DEFAULT,
  saveMapSplitSplitterPrefs,
  type MapSplitSplitterPrefs,
} from './mapSplitSplitterPrefs';

const SAVE_DEBOUNCE_MS = 200;

export function useMapSplitSplitterPrefs(projectName?: string) {
  const [prefs, setPrefs] = useState<MapSplitSplitterPrefs>(MAP_SPLIT_SPLITTER_PREFS_DEFAULT);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  useEffect(() => {
    setPrefs(loadMapSplitSplitterPrefs(projectName));
  }, [projectName]);

  const scheduleSave = useCallback((next: MapSplitSplitterPrefs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMapSplitSplitterPrefs(projectNameRef.current, next);
      saveTimerRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const setControlOffsetRatio = useCallback(
    (controlOffsetRatio: number) => {
      setPrefs((prev) => {
        const next = { ...prev, controlOffsetRatio };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  const setExpanded = useCallback(
    (expanded: boolean) => {
      setPrefs((prev) => {
        const next = { ...prev, expanded };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return {
    controlOffsetRatio: prefs.controlOffsetRatio,
    controlsExpanded: prefs.expanded,
    setControlOffsetRatio,
    setControlsExpanded: setExpanded,
  };
}
