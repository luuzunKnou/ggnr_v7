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
  /^Maximum update depth exceeded/,
  /^Warning: Maximum update depth exceeded/,
];

function isNoise(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== 'string') return false;
  return NOISE_PATTERNS.some((re) => re.test(first));
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a, null, 0);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/**
 * 브라우저 console.log / warn / error를 가로채서 로그 라인 배열로 관리.
 * 마운트 시 원본 console 메서드를 래핑하고, 언마운트 시 복원.
 * setState는 마이크로태스크로 미뤄 React 렌더/effect 중 동기 setState 루프를 막는다.
 */
export function useConsoleCapture() {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const originalsRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  } | null>(null);
  const pendingRef = useRef<ConsoleLine[]>([]);
  const flushScheduledRef = useRef(false);
  const capturingRef = useRef(false);

  const flush = useCallback(() => {
    flushScheduledRef.current = false;
    const batch = pendingRef.current;
    if (batch.length === 0) return;
    pendingRef.current = [];
    setLines((prev) => {
      const next = [...prev, ...batch];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  const push = useCallback(
    (level: ConsoleLine['level'], args: unknown[]) => {
      if (capturingRef.current) return;
      const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      pendingRef.current.push({ timestamp: ts, level, message: formatArgs(args) });
      if (flushScheduledRef.current) return;
      flushScheduledRef.current = true;
      queueMicrotask(flush);
    },
    [flush]
  );

  useEffect(() => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    originalsRef.current = { log: origLog, warn: origWarn, error: origError };

    console.log = (...args: unknown[]) => {
      if (isNoise(args)) return;
      capturingRef.current = true;
      try {
        origLog.apply(console, args);
      } finally {
        capturingRef.current = false;
      }
      push('log', args);
    };
    console.warn = (...args: unknown[]) => {
      if (isNoise(args)) return;
      capturingRef.current = true;
      try {
        origWarn.apply(console, args);
      } finally {
        capturingRef.current = false;
      }
      push('warn', args);
    };
    console.error = (...args: unknown[]) => {
      if (isNoise(args)) {
        capturingRef.current = true;
        try {
          origError.apply(console, args);
        } finally {
          capturingRef.current = false;
        }
        return;
      }
      capturingRef.current = true;
      try {
        origError.apply(console, args);
      } finally {
        capturingRef.current = false;
      }
      push('error', args);
    };

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      originalsRef.current = null;
      pendingRef.current = [];
      flushScheduledRef.current = false;
    };
  }, [push]);

  const clear = useCallback(() => {
    pendingRef.current = [];
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
