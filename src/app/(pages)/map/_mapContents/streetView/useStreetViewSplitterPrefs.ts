'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadStreetViewSplitterPrefs,
  saveStreetViewSplitterPrefs,
  STREET_VIEW_SPLITTER_PREFS_DEFAULT,
  type StreetViewSplitterPrefs,
} from './streetViewSplitterPrefs';

const SAVE_DEBOUNCE_MS = 200;

export function useStreetViewSplitterPrefs(projectName?: string) {
  const [prefs, setPrefs] = useState<StreetViewSplitterPrefs>(
    STREET_VIEW_SPLITTER_PREFS_DEFAULT
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  useEffect(() => {
    setPrefs(loadStreetViewSplitterPrefs(projectName));
  }, [projectName]);

  const scheduleSave = useCallback((next: StreetViewSplitterPrefs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveStreetViewSplitterPrefs(projectNameRef.current, next);
      saveTimerRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  }, []);

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
    controlsExpanded: prefs.expanded,
    setControlsExpanded: setExpanded,
  };
}
