'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate';
import type Map from 'ol/Map';
import type { ObjectEvent } from 'ol/Object';
import { transform } from 'ol/proj';
import { MAP_SPLIT_ANIM_MS } from '../../_mapComponents/mapSplit/mapSplitTypes';
import { OlMapWalker, panoSearchRadiusMetersFromMap } from './OlMapWalker';
import { useMapContext } from '../../_mapComponents/MapContext';

type UseStreetViewArgs = {
  active: boolean;
  mapSync: boolean;
};

/** 지도 좌표 동일 판정(맵 단위) — React setState 스킵용 */
const COORD_EPS = 1e-4;

function toWgs84(map: Map, coord: Coordinate): Coordinate {
  const code = map.getView().getProjection()?.getCode() ?? 'EPSG:3857';
  if (code === 'EPSG:4326') return [...coord];
  return transform(coord, code, 'EPSG:4326');
}

function coordsNearlyEqual(a: Coordinate | null, b: Coordinate): boolean {
  if (!a) return false;
  return Math.abs(a[0] - b[0]) < COORD_EPS && Math.abs(a[1] - b[1]) < COORD_EPS;
}

export function useStreetView({ active, mapSync }: UseStreetViewArgs) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapReady = mapContext?.mapReady ?? false;
  const walkerRef = useRef<OlMapWalker | null>(null);
  const [panDeg, setPanDeg] = useState(0);
  const [tiltDeg, setTiltDeg] = useState(0);
  const [position, setPosition] = useState<Coordinate | null>(null);
  const positionRef = useRef<Coordinate | null>(null);
  const mapSyncRef = useRef(mapSync);
  mapSyncRef.current = mapSync;
  const skipCenterFollowRef = useRef(false);
  const tiltDegRef = useRef(tiltDeg);
  tiltDegRef.current = tiltDeg;

  const panRafRef = useRef(0);
  const panThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPanRef = useRef<number | null>(null);
  const lastPanFlushAtRef = useRef(0);
  const centerRafRef = useRef(0);
  const reactPosRafRef = useRef(0);
  const pendingReactPosRef = useRef<Coordinate | null>(null);

  const flushPanToReact = useCallback(() => {
    panRafRef.current = 0;
    if (panThrottleTimerRef.current) {
      clearTimeout(panThrottleTimerRef.current);
      panThrottleTimerRef.current = null;
    }
    const pan = pendingPanRef.current;
    if (pan == null) return;
    pendingPanRef.current = null;
    lastPanFlushAtRef.current = performance.now();
    setPanDeg(pan);
  }, []);

  /** 워커 드래그 → 로드뷰 동기화용. 프레임마다 setState 하지 않고 스로틀 */
  const schedulePanToReact = useCallback(
    (pan: number) => {
      pendingPanRef.current = pan;
      const elapsed = performance.now() - lastPanFlushAtRef.current;
      if (elapsed >= 80) {
        if (panRafRef.current) return;
        panRafRef.current = requestAnimationFrame(flushPanToReact);
        return;
      }
      if (panThrottleTimerRef.current) return;
      panThrottleTimerRef.current = setTimeout(() => {
        panThrottleTimerRef.current = null;
        flushPanToReact();
      }, 80 - elapsed);
    },
    [flushPanToReact]
  );

  const flushReactPosition = useCallback(() => {
    reactPosRafRef.current = 0;
    const coord = pendingReactPosRef.current;
    if (!coord) return;
    pendingReactPosRef.current = null;
    if (coordsNearlyEqual(positionRef.current, coord)) return;
    positionRef.current = coord;
    setPosition(coord);
  }, []);

  const scheduleReactPosition = useCallback(
    (coord: Coordinate) => {
      pendingReactPosRef.current = coord;
      if (reactPosRafRef.current) return;
      reactPosRafRef.current = requestAnimationFrame(flushReactPosition);
    },
    [flushReactPosition]
  );

  const snapWalkerToVisualCenter = useCallback(
    (opts?: { refreshSize?: boolean; syncRoadview?: boolean }) => {
      if (!map || !walkerRef.current) return;
      if (opts?.refreshSize) map.updateSize();
      // 맵 중심(A) = 센터마크/패딩된 뷰 정중앙에 그려지는 지점. 픽셀 재환산은 오차·점프 유발.
      const center = map.getView().getCenter();
      const coord = center ? [...center] : OlMapWalker.positionAtVisualCenter(map);
      if (!coord) return;
      walkerRef.current.setPosition(coord);
      // 팬·줌 중에는 워커만. 로드뷰 좌표 반영은 moveend / 줌 종료 후
      if (opts?.syncRoadview === false) return;
      const prev = positionRef.current;
      if (
        prev &&
        Math.abs(prev[0] - coord[0]) < 1e-4 &&
        Math.abs(prev[1] - coord[1]) < 1e-4
      ) {
        positionRef.current = coord;
        return;
      }
      scheduleReactPosition(coord);
    },
    [map, scheduleReactPosition]
  );

  const applyPosition = useCallback(
    (coord: Coordinate, opts?: { fromMapClick?: boolean }) => {
      walkerRef.current?.setPosition(coord);
      positionRef.current = coord;
      setPosition(coord);
      if (map && (mapSyncRef.current || opts?.fromMapClick)) {
        skipCenterFollowRef.current = true;
        map.getView().setCenter(coord);
        queueMicrotask(() => {
          skipCenterFollowRef.current = false;
        });
      }
    },
    [map]
  );

  useEffect(() => {
    if (!active || !map || !mapReady) {
      walkerRef.current?.destroy();
      walkerRef.current = null;
      return;
    }

    map.updateSize();
    const start =
      OlMapWalker.positionAtVisualCenter(map) ?? map.getView().getCenter();
    if (!start) return;

    const walker = new OlMapWalker(start);
    walker.setOnPanChange((pan) => schedulePanToReact(pan));
    walker.setTilt(tiltDegRef.current);
    walker.setMap(map);
    walkerRef.current = walker;
    positionRef.current = start;
    setPosition(start);
    setPanDeg(walker.getPan());
    setTiltDeg(walker.getTilt());

    /** 휠 줌은 movestart가 안 올 수 있어 resolution으로 줌 종료 디바운스 */
    let zoomEndTimer = 0;

    const onClick = (evt: { coordinate: Coordinate }) => {
      applyPosition(evt.coordinate, { fromMapClick: true });
    };

    const onCenterChange = (_evt: ObjectEvent) => {
      if (skipCenterFollowRef.current) return;
      if (centerRafRef.current) return;
      centerRafRef.current = requestAnimationFrame(() => {
        centerRafRef.current = 0;
        // 팬·휠 줌 중 중심이 매 프레임 바뀜 — 워커만 따라가고 로드뷰는 끝에서
        snapWalkerToVisualCenter({ syncRoadview: false });
      });
    };

    const onMoveEnd = () => {
      if (skipCenterFollowRef.current) return;
      snapWalkerToVisualCenter({ syncRoadview: true });
    };

    const onResolutionChange = () => {
      if (zoomEndTimer) window.clearTimeout(zoomEndTimer);
      zoomEndTimer = window.setTimeout(() => {
        zoomEndTimer = 0;
        if (skipCenterFollowRef.current) return;
        snapWalkerToVisualCenter({ syncRoadview: true });
      }, 140);
    };

    const onSizeChange = () => {
      // 줌 중 size는 안 바뀜. 분할·패딩 변경 시에만
      snapWalkerToVisualCenter({ refreshSize: false, syncRoadview: true });
    };

    map.on('singleclick', onClick);
    map.on('change:size', onSizeChange);
    map.on('moveend', onMoveEnd);
    map.getView().on('change:center', onCenterChange);
    map.getView().on('change:resolution', onResolutionChange);

    let raf1 = 0;
    raf1 = requestAnimationFrame(() => {
      snapWalkerToVisualCenter({ refreshSize: true, syncRoadview: true });
    });
    // 상하 분할 직후·애니메이션 중 맵 크기/패딩이 여러 번 바뀌므로 종료 후에도 재배치
    const animDone = window.setTimeout(() => {
      snapWalkerToVisualCenter({ refreshSize: true, syncRoadview: true });
    }, MAP_SPLIT_ANIM_MS + 50);
    const animDone2 = window.setTimeout(() => {
      snapWalkerToVisualCenter({ refreshSize: true, syncRoadview: true });
    }, MAP_SPLIT_ANIM_MS + 200);

    return () => {
      cancelAnimationFrame(raf1);
      if (centerRafRef.current) {
        cancelAnimationFrame(centerRafRef.current);
        centerRafRef.current = 0;
      }
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = 0;
      }
      if (panThrottleTimerRef.current) {
        clearTimeout(panThrottleTimerRef.current);
        panThrottleTimerRef.current = null;
      }
      if (reactPosRafRef.current) {
        cancelAnimationFrame(reactPosRafRef.current);
        reactPosRafRef.current = 0;
      }
      pendingPanRef.current = null;
      pendingReactPosRef.current = null;
      window.clearTimeout(animDone);
      window.clearTimeout(animDone2);
      if (zoomEndTimer) window.clearTimeout(zoomEndTimer);
      map.un('singleclick', onClick);
      map.un('change:size', onSizeChange);
      map.un('moveend', onMoveEnd);
      map.getView().un('change:center', onCenterChange);
      map.getView().un('change:resolution', onResolutionChange);
      walker.destroy();
      if (walkerRef.current === walker) walkerRef.current = null;
    };
  }, [active, map, mapReady, applyPosition, snapWalkerToVisualCenter, schedulePanToReact]);

  const onPanChange = useCallback((pan: number) => {
    const next = ((pan % 360) + 360) % 360;
    walkerRef.current?.setAngle(next);
    pendingPanRef.current = next;
    flushPanToReact();
  }, [flushPanToReact]);

  /** 로드뷰 드래그 → 워커만 (React panDeg 생략 — 패널 리렌더 방지) */
  const onPanFromRoadview = useCallback((pan: number) => {
    const next = ((pan % 360) + 360) % 360;
    walkerRef.current?.setAngle(next);
  }, []);

  const onTiltChange = useCallback((tilt: number) => {
    const next = Math.min(90, Math.max(-90, tilt));
    tiltDegRef.current = next;
    // React setState 생략 — 워커 DOM만 갱신(패널 HUD는 StreetViewPanel ref)
    walkerRef.current?.setTilt(next);
  }, []);

  const onNudgePosition = useCallback(
    (dx: number, dy: number) => {
      if (!map || !positionRef.current) return;
      const cur = positionRef.current;
      const next: Coordinate = [cur[0] + dx, cur[1] + dy];
      applyPosition(next);
    },
    [map, applyPosition]
  );

  /** 로드뷰 화살표 이동 → 워커·(동기화 시) 지도 */
  const onRoadviewPosition = useCallback(
    (lng: number, lat: number) => {
      if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
      try {
        const code = map.getView().getProjection()?.getCode() ?? 'EPSG:3857';
        const coord =
          code === 'EPSG:4326' ? ([lng, lat] as Coordinate) : transform([lng, lat], 'EPSG:4326', code);
        applyPosition(coord);
      } catch {
        /* ignore */
      }
    },
    [map, applyPosition]
  );

  const getPanoSearchRadiusM = useCallback(() => {
    if (!map) return 100;
    return panoSearchRadiusMetersFromMap(map);
  }, [map]);

  const wgs84 = useMemo(() => {
    if (!map || !position) return { lng: null as number | null, lat: null as number | null };
    try {
      const [lng, lat] = toWgs84(map, position);
      return { lng, lat };
    } catch {
      return { lng: null, lat: null };
    }
  }, [map, position]);

  return {
    panDeg,
    tiltDeg,
    lng: wgs84.lng,
    lat: wgs84.lat,
    getPanoSearchRadiusM,
    onPanChange,
    onPanFromRoadview,
    onTiltChange,
    onNudgePosition,
    onRoadviewPosition,
  };
}
