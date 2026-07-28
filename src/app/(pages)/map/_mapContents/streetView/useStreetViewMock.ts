'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate';
import type { ObjectEvent } from 'ol/Object';
import { MAP_SPLIT_ANIM_MS } from '../../_mapComponents/mapSplit/mapSplitTypes';
import { OlMapWalker, type WalkerScaleInfo } from './OlMapWalker';
import { useMapContext } from '../../_mapComponents/MapContext';

type UseStreetViewMockArgs = {
  active: boolean;
  mapSync: boolean;
};

const RELOCATING_MS = 450;

export function useStreetViewMock({ active, mapSync }: UseStreetViewMockArgs) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapReady = mapContext?.mapReady ?? false;
  const walkerRef = useRef<OlMapWalker | null>(null);
  const [panDeg, setPanDeg] = useState(0);
  const [mapScale, setMapScale] = useState<WalkerScaleInfo | null>(null);
  const [position, setPosition] = useState<Coordinate | null>(null);
  const [relocating, setRelocating] = useState(false);
  const mapSyncRef = useRef(mapSync);
  mapSyncRef.current = mapSync;
  const skipCenterFollowRef = useRef(false);
  const relocateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPosKeyRef = useRef<string>('');
  const lastScaleKeyRef = useRef('');

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

  const applyScaleInfo = useCallback((info: WalkerScaleInfo) => {
    const zoomLabel =
      info.zoom != null && Number.isFinite(info.zoom) ? info.zoom.toFixed(2) : 'x';
    const resolutionLabel = Number.isFinite(info.resolution) ? info.resolution.toFixed(2) : 'x';
    const nextKey = `${zoomLabel}|${resolutionLabel}`;
    if (nextKey === lastScaleKeyRef.current) return;
    lastScaleKeyRef.current = nextKey;
    setMapScale(info);
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
      setMapScale(null);
      return;
    }

    map.updateSize();
    const start =
      OlMapWalker.positionAtVisualCenter(map) ?? map.getView().getCenter();
    if (!start) return;

    const walker = new OlMapWalker(start);
    walker.setOnPanChange((pan) => setPanDeg(pan));
    walker.setOnScaleChange((info) => applyScaleInfo(info));
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

    // 분할 flex 애니메이션·첫 프레임 전 좌표 변환 실패 대비
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
  }, [active, map, mapReady, applyPosition, snapWalkerToVisualCenter, applyScaleInfo]);

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

  return {
    panDeg,
    mapScale,
    relocating,
    onPanChange,
    onNudgePosition,
  };
}
