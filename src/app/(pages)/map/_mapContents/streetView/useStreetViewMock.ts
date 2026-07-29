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

const RELOCATING_MS = 450;

function toWgs84(map: Map, coord: Coordinate): Coordinate {
  const code = map.getView().getProjection()?.getCode() ?? 'EPSG:3857';
  if (code === 'EPSG:4326') return [...coord];
  return transform(coord, code, 'EPSG:4326');
}

export function useStreetViewMock({ active, mapSync }: UseStreetViewMockArgs) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapReady = mapContext?.mapReady ?? false;
  const walkerRef = useRef<OlMapWalker | null>(null);
  const [panDeg, setPanDeg] = useState(0);
  const [position, setPosition] = useState<Coordinate | null>(null);
  const [relocating, setRelocating] = useState(false);
  const mapSyncRef = useRef(mapSync);
  mapSyncRef.current = mapSync;
  const skipCenterFollowRef = useRef(false);
  const relocateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPosKeyRef = useRef<string>('');

  const flashRelocating = useCallback((coord: Coordinate) => {
    const key = `${coord[0].toFixed(2)},${coord[1].toFixed(2)}`;
    if (key === lastPosKeyRef.current) return;
    lastPosKeyRef.current = key;
    setRelocating(true);
    if (relocateTimerRef.current) clearTimeout(relocateTimerRef.current);
    relocateTimerRef.current = setTimeout(() => {
      setRelocating(false);
      relocateTimerRef.current = null;
    }, RELOCATING_MS);
  }, []);

  /** silent: 분할 리사이즈 중 재배치 — «이동중» 플래시 생략 */
  const snapWalkerToVisualCenter = useCallback(
    (opts?: { silent?: boolean; refreshSize?: boolean }) => {
      if (!map || !walkerRef.current) return;
      if (opts?.refreshSize) map.updateSize();
      const coord = OlMapWalker.positionAtVisualCenter(map);
      if (!coord) return;
      setPosition(coord);
      walkerRef.current.setPosition(coord);
      if (!opts?.silent) flashRelocating(coord);
      else lastPosKeyRef.current = `${coord[0].toFixed(2)},${coord[1].toFixed(2)}`;
    },
    [map, flashRelocating]
  );

  const applyPosition = useCallback(
    (coord: Coordinate, opts?: { fromMapClick?: boolean }) => {
      setPosition(coord);
      walkerRef.current?.setPosition(coord);
      flashRelocating(coord);
      if (map && (mapSyncRef.current || opts?.fromMapClick)) {
        skipCenterFollowRef.current = true;
        map.getView().setCenter(coord);
        queueMicrotask(() => {
          skipCenterFollowRef.current = false;
        });
      }
    },
    [map, flashRelocating]
  );

  useEffect(() => {
    if (!active || !map || !mapReady) {
      walkerRef.current?.destroy();
      walkerRef.current = null;
      setRelocating(false);
      return;
    }

    map.updateSize();
    const start =
      OlMapWalker.positionAtVisualCenter(map) ?? map.getView().getCenter();
    if (!start) return;

    const walker = new OlMapWalker(start);
    walker.setOnPanChange((pan) => setPanDeg(pan));
    walker.setMap(map);
    walkerRef.current = walker;
    setPosition(start);
    lastPosKeyRef.current = `${start[0].toFixed(2)},${start[1].toFixed(2)}`;
    setPanDeg(walker.getPan());

    const onClick = (evt: { coordinate: Coordinate }) => {
      applyPosition(evt.coordinate, { fromMapClick: true });
    };

    const onCenterChange = (_evt: ObjectEvent) => {
      if (skipCenterFollowRef.current) return;
      snapWalkerToVisualCenter({ silent: true });
    };

    const onSizeChange = () => {
      snapWalkerToVisualCenter({ silent: true, refreshSize: true });
    };

    map.on('singleclick', onClick);
    map.on('change:size', onSizeChange);
    map.getView().on('change:center', onCenterChange);

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      snapWalkerToVisualCenter({ silent: true, refreshSize: true });
      raf2 = requestAnimationFrame(() =>
        snapWalkerToVisualCenter({ silent: true, refreshSize: true })
      );
    });
    const animDone = window.setTimeout(() => {
      snapWalkerToVisualCenter({ silent: true, refreshSize: true });
    }, MAP_SPLIT_ANIM_MS + 50);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(animDone);
      map.un('singleclick', onClick);
      map.un('change:size', onSizeChange);
      map.getView().un('change:center', onCenterChange);
      walker.destroy();
      if (walkerRef.current === walker) walkerRef.current = null;
      if (relocateTimerRef.current) {
        clearTimeout(relocateTimerRef.current);
        relocateTimerRef.current = null;
      }
    };
  }, [active, map, mapReady, applyPosition, snapWalkerToVisualCenter]);

  const onPanChange = useCallback((pan: number) => {
    setPanDeg(pan);
    walkerRef.current?.setAngle(pan);
  }, []);

  const onNudgePosition = useCallback(
    (dx: number, dy: number) => {
      if (!map || !position) return;
      const next: Coordinate = [position[0] + dx, position[1] + dy];
      applyPosition(next);
    },
    [map, position, applyPosition]
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
    lng: wgs84.lng,
    lat: wgs84.lat,
    relocating,
    onPanChange,
    onNudgePosition,
  };
}
