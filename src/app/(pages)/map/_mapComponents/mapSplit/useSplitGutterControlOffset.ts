'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSplitGutterControlOffsetRatio,
  saveSplitGutterControlOffsetRatio,
} from './splitGutterOffsetPrefs';

const DEFAULT_OFFSET_RATIO = 0.5;
const SAVE_DEBOUNCE_MS = 200;

/** 지도분할·거리뷰 거터 pill 위치 — 단일 React 상태 + 공용 localStorage */
export function useSplitGutterControlOffset(projectName?: string) {
  const [controlOffsetRatio, setControlOffsetRatioState] = useState(DEFAULT_OFFSET_RATIO);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  useEffect(() => {
    setControlOffsetRatioState(loadSplitGutterControlOffsetRatio(projectName));
  }, [projectName]);

  const setControlOffsetRatio = useCallback((ratio: number) => {
    setControlOffsetRatioState(ratio);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSplitGutterControlOffsetRatio(projectNameRef.current, ratio);
      saveTimerRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { controlOffsetRatio, setControlOffsetRatio };
}
