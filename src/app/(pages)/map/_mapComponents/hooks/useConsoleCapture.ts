import { useState, useEffect, useRef, useCallback } from 'react';
import type { Map } from 'ol';

export type ConsoleLine = {
  timestamp: string;
  level: 'log' | 'warn' | 'error';
  message: string;
};

export type MapViewInfo = {
  zoomLevel: number | null;
  projectionCode: string | null;
  centerX: number | null;
  centerY: number | null;
};

const MAX_LINES = 300;

const NOISE_PATTERNS = [
  /^\[Fast Refresh\]/,
  /^\[HMR\]/,
  /^Download the React DevTools/,
  /^%cDownload the React DevTools/,
];

function isNoise(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== 'string') return false;
  return NOISE_PATTERNS.some((re) => re.test(first));
}

/**
 * 브라우저 console.log / warn / error를 가로채서 로그 라인 배열로 관리.
 * 마운트 시 원본 console 메서드를 래핑하고, 언마운트 시 복원.
 */
export function useConsoleCapture() {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const originalsRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  } | null>(null);

  const push = useCallback((level: ConsoleLine['level'], args: unknown[]) => {
    const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    const message = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 0)))
      .join(' ');
    setLines((prev) => {
      const next = [...prev, { timestamp: ts, level, message }];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    originalsRef.current = { log: origLog, warn: origWarn, error: origError };

    console.log = (...args: unknown[]) => {
      if (isNoise(args)) return;
      origLog.apply(console, args);
      push('log', args);
    };
    console.warn = (...args: unknown[]) => {
      if (isNoise(args)) return;
      origWarn.apply(console, args);
      push('warn', args);
    };
    console.error = (...args: unknown[]) => {
      if (isNoise(args)) return;
      origError.apply(console, args);
      push('error', args);
    };

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      originalsRef.current = null;
    };
  }, [push]);

  const clear = useCallback(() => setLines([]), []);

  return { lines, clear };
}

/**
 * 맵 뷰 정보(줌, 좌표계, 중심 좌표)를 실시간 추적.
 */
export function useMapViewInfo(map: Map | null, mapReady: boolean): MapViewInfo {
  const [info, setInfo] = useState<MapViewInfo>({
    zoomLevel: null,
    projectionCode: null,
    centerX: null,
    centerY: null,
  });

  useEffect(() => {
    if (!mapReady || !map) return;
    const view = map.getView();
    const proj = view.getProjection();
    const update = () => {
      const z = view.getZoom();
      const center = view.getCenter();
      setInfo({
        zoomLevel: z !== undefined ? z : null,
        projectionCode: proj ? proj.getCode() : null,
        centerX: center ? center[0] : null,
        centerY: center ? center[1] : null,
      });
    };
    update();
    view.on('change', update);
    return () => view.un('change', update);
  }, [map, mapReady]);

  return info;
}
