'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate';
import type Map from 'ol/Map';
import type { ObjectEvent } from 'ol/Object';
import { transform } from 'ol/proj';
import { MAP_SPLIT_ANIM_MS } from '../../_mapComponents/mapSplit/mapSplitTypes';
import { OlMapWalker } from './OlMapWalker';
import { useMapContext } from '../../_mapComponents/MapContext';

type UseStreetViewMockArgs = {
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

export function useStreetViewMock({ active, mapSync }: UseStreetViewMockArgs) {
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
  const pendingPanRef = useRef<number | null>(null);
  const centerRafRef = useRef(0);
  const reactPosRafRef = useRef(0);
  const pendingReactPosRef = useRef<Coordinate | null>(null);

  const flushPanToReact = useCallback(() => {
    panRafRef.current = 0;
    const pan = pendingPanRef.current;
    if (pan == null) return;
    pendingPanRef.current = null;
    setPanDeg(pan);
  }, []);

  const schedulePanToReact = useCallback(
    (pan: number) => {
      pendingPanRef.current = pan;
      if (panRafRef.current) return;
      panRafRef.current = requestAnimationFrame(flushPanToReact);
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
    (opts?: { refreshSize?: boolean }) => {
      if (!map || !walkerRef.current) return;
      if (opts?.refreshSize) map.updateSize();
      const coord = OlMapWalker.positionAtVisualCenter(map);
      if (!coord) return;
      walkerRef.current.setPosition(coord);
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

    const onClick = (evt: { coordinate: Coordinate }) => {
      applyPosition(evt.coordinate, { fromMapClick: true });
    };

    const onCenterChange = (_evt: ObjectEvent) => {
      if (skipCenterFollowRef.current) return;
      if (centerRafRef.current) return;
      centerRafRef.current = requestAnimationFrame(() => {
        centerRafRef.current = 0;
        snapWalkerToVisualCenter();
      });
    };

    const onSizeChange = () => {
      snapWalkerToVisualCenter({ refreshSize: true });
    };

    map.on('singleclick', onClick);
    map.on('change:size', onSizeChange);
    map.getView().on('change:center', onCenterChange);

    let raf1 = 0;
    raf1 = requestAnimationFrame(() => {
      snapWalkerToVisualCenter({ refreshSize: true });
    });
    const animDone = window.setTimeout(() => {
      snapWalkerToVisualCenter({ refreshSize: true });
    }, MAP_SPLIT_ANIM_MS + 50);

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
      if (reactPosRafRef.current) {
        cancelAnimationFrame(reactPosRafRef.current);
        reactPosRafRef.current = 0;
      }
      pendingPanRef.current = null;
      pendingReactPosRef.current = null;
      window.clearTimeout(animDone);
      map.un('singleclick', onClick);
      map.un('change:size', onSizeChange);
      map.getView().un('change:center', onCenterChange);
      walker.destroy();
      if (walkerRef.current === walker) walkerRef.current = null;
    };
  }, [active, map, mapReady, applyPosition, snapWalkerToVisualCenter, schedulePanToReact]);

  const onPanChange = useCallback((pan: number) => {
    const next = ((pan % 360) + 360) % 360;
    walkerRef.current?.setAngle(next);
    schedulePanToReact(next);
  }, [schedulePanToReact]);

  const onTiltChange = useCallback((tilt: number) => {
    const next = Math.min(90, Math.max(-90, tilt));
    setTiltDeg(next);
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
    onPanChange,
    onTiltChange,
    onNudgePosition,
    onRoadviewPosition,
  };
}
