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
  /\[Fast Refresh\]/i,
  /\[HMR\]/i,
  /Download the React DevTools/i,
  /Maximum update depth exceeded/i,
  /You are calling ReactDOMClient\.createRoot/i,
  /Cannot update a component \(/i,
  /Warning: Cannot update a component/i,
];

function argsToText(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message || String(a);
      try {
        return JSON.stringify(a, null, 0);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function isNoise(args: unknown[]): boolean {
  if (args.length === 0) return false;
  return NOISE_PATTERNS.some((re) => re.test(argsToText(args)));
}

function formatArgs(args: unknown[]): string {
  return argsToText(args);
}

/**
 * 브라우저 console.log / warn / error를 가로채서 로그 라인 배열로 관리.
 * 마운트 시 원본 console 메서드를 래핑하고, 언마운트 시 복원.
 * setState는 macrotask(setTimeout)로 미뤄 React 연쇄 업데이트·console.error 재진입 루프를 막는다.
 */
export function useConsoleCapture() {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const originalsRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  } | null>(null);
  const pendingRef = useRef<ConsoleLine[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturingRef = useRef(false);
  const mountedRef = useRef(false);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    if (!mountedRef.current) {
      pendingRef.current = [];
      return;
    }
    const batch = pendingRef.current;
    if (batch.length === 0) return;
    pendingRef.current = [];
    setLines((prev) => {
      const next = [...prev, ...batch];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    // queueMicrotask는 React effect/commit 연쇄에 묶일 수 있음 → macrotask로 분리
    flushTimerRef.current = setTimeout(flush, 0);
  }, [flush]);

  const push = useCallback(
    (level: ConsoleLine['level'], args: unknown[]) => {
      if (capturingRef.current || !mountedRef.current) return;
      if (isNoise(args)) return;
      const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      pendingRef.current.push({ timestamp: ts, level, message: formatArgs(args) });
      scheduleFlush();
    },
    [scheduleFlush]
  );

  useEffect(() => {
    mountedRef.current = true;
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    originalsRef.current = { log: origLog, warn: origWarn, error: origError };

    const wrap =
      (level: ConsoleLine['level'], orig: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        const noise = isNoise(args);
        capturingRef.current = true;
        try {
          orig.apply(console, args);
        } finally {
          capturingRef.current = false;
        }
        if (!noise) push(level, args);
      };

    console.log = wrap('log', origLog);
    console.warn = wrap('warn', origWarn);
    console.error = wrap('error', origError);

    return () => {
      mountedRef.current = false;
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      originalsRef.current = null;
      pendingRef.current = [];
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [push]);

  const clear = useCallback(() => {
    pendingRef.current = [];
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setLines([]);
  }, []);

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
      const next: MapViewInfo = {
        zoomLevel: z !== undefined ? z : null,
        projectionCode: proj ? proj.getCode() : null,
        centerX: center ? center[0] : null,
        centerY: center ? center[1] : null,
      };
      setInfo((prev) =>
        prev.zoomLevel === next.zoomLevel &&
        prev.projectionCode === next.projectionCode &&
        prev.centerX === next.centerX &&
        prev.centerY === next.centerY
          ? prev
          : next
      );
    };
    update();
    view.on('change', update);
    return () => view.un('change', update);
  }, [map, mapReady]);

  return info;
}
