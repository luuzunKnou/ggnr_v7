'use client';

import { useEffect, useRef } from 'react';
import { Map as OlMap, Feature } from 'ol';
import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { LineString } from 'ol/geom';
import type Geometry from 'ol/geom/Geometry';
import { Style, Stroke, Circle as CircleStyle, Fill } from 'ol/style';
import Overlay from 'ol/Overlay';
import { call } from '@/lib/api';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import styles from '../measure/measureElevationTooltip.module.css';

/** 거리 측정(#3388ff)과 동일 굵기·점 크기, 색만 빨간 계열 */
const SLOPE_COLOR = '#f47378';

type PrevSlope = {
  coor: [number, number] | null;
  elevation: number | null;
};

function formatElevationM(elevation: number | null): string {
  if (elevation == null || !Number.isFinite(elevation)) return '0 m';
  return `${new Intl.NumberFormat('ko-KR').format(elevation)} m`;
}

function formatDiffM(diff: number): string {
  const rounded = Math.floor(diff * 100) / 100;
  return `${rounded} m`;
}

function createSlopeStyle() {
  return new Style({
    stroke: new Stroke({ color: SLOPE_COLOR, width: 2 }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: SLOPE_COLOR }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
  });
}

function createLabelElement(text: string, kind: 'point' | 'diff'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = kind === 'diff' ? styles.diffLabel : styles.label;
  const span = document.createElement('span');
  span.className = kind === 'diff' ? styles.diffValue : styles.value;
  span.textContent = text;
  el.appendChild(span);
  return el;
}

function toPoint(coord: number[]): [number, number] | null {
  if (!coord || coord.length < 2) return null;
  const x = Number(coord[0]);
  const y = Number(coord[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

async function fetchElevationMeters(
  map: OlMap,
  coordinate: [number, number]
): Promise<number | null> {
  const code = map.getView().getProjection()?.getCode() ?? 'EPSG:3857';
  const m = code.match(/EPSG:(\d+)/i);
  const srid = m ? Number(m[1]) : 3857;
  try {
    // 지도 고도와 동일 API (getElevation 액션은 없음)
    const res = await call('', 'POST', {
      service: 'elevationService',
      action: 'getElevationAtPoint',
      params: { x: coordinate[0], y: coordinate[1], srid },
    });
    const data = (res?.data ?? res) as {
      success?: boolean;
      elevation?: number | null;
      error?: string;
    };
    if (data?.error || data?.success === false) return null;
    const elev = data?.elevation;
    return elev == null || !Number.isFinite(Number(elev)) ? null : Number(elev);
  } catch {
    return null;
  }
}

/**
 * 경사도(거리 고도) — 점 클릭 시 고도·구간 고도차 표시
 * 스케치 좌표 개수 증가로 꼭짓점을 확정(singleclick 경쟁 회피)
 */
export function useSlopeMeasure(map: OlMap | null, active: boolean) {
  const drawRef = useRef<Draw | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const overlaysRef = useRef<Overlay[]>([]);
  const isDrawingRef = useRef(false);
  const prevSlopeRef = useRef<PrevSlope>({ coor: null, elevation: null });
  const elevQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** 현재 스케치에서 이미 라벨 처리한 확정 꼭짓점 수 */
  const processedCountRef = useRef(0);
  const geomChangeHandlerRef = useRef<((e: { target: Geometry }) => void) | null>(null);
  const dblClickHandlerRef = useRef<((e: { preventDefault: () => void }) => void) | null>(null);

  const clearOverlays = () => {
    if (!map) return;
    for (const ov of overlaysRef.current) {
      try {
        map.removeOverlay(ov);
      } catch {
        /* ignore */
      }
    }
    overlaysRef.current = [];
  };

  const addOverlay = (overlay: Overlay) => {
    if (!map) return;
    map.addOverlay(overlay);
    overlaysRef.current.push(overlay);
  };

  const samePoint = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

  const createElevationTooltip = (
    coordinate: [number, number],
    elevation: number | null
  ) => {
    if (!map) return;

    const el = createLabelElement(formatElevationM(elevation), 'point');
    const overlay = new Overlay({
      element: el,
      position: coordinate,
      offset: [0, -10],
      positioning: 'bottom-center',
      stopEvent: false,
    });
    addOverlay(overlay);

    const prev = prevSlopeRef.current;
    if (prev.coor != null && prev.elevation != null && elevation != null) {
      const midpoint: [number, number] = [
        (prev.coor[0] + coordinate[0]) / 2,
        (prev.coor[1] + coordinate[1]) / 2,
      ];
      const diff = elevation - prev.elevation;
      const diffEl = createLabelElement(formatDiffM(diff), 'diff');

      const diffOverlay = new Overlay({
        element: diffEl,
        position: midpoint,
        positioning: 'bottom-center',
        stopEvent: false,
        offset: [0, -10],
      });
      addOverlay(diffOverlay);
    }

    prevSlopeRef.current = { coor: coordinate, elevation };
  };

  const enqueueElevationPoint = (point: [number, number]) => {
    if (!map) return;
    elevQueueRef.current = elevQueueRef.current
      .then(async () => {
        const prev = prevSlopeRef.current;
        if (prev.coor && samePoint(prev.coor, point)) return;
        const elevation = await fetchElevationMeters(map, point);
        createElevationTooltip(point, elevation);
      })
      .catch(() => {
        /* ignore */
      });
  };

  /** 스케치/완성 좌표에서 아직 처리 안 한 확정 꼭짓점만 큐에 넣음 */
  const processNewCommittedPoints = (coords: number[][], finalized: boolean) => {
    // 그리는 중: 마지막은 커서 위치 → 확정 꼭짓점은 length-1
    // 완료 후: 전부 확정
    const committed = finalized ? coords.length : Math.max(0, coords.length - 1);
    while (processedCountRef.current < committed) {
      const pt = toPoint(coords[processedCountRef.current]);
      processedCountRef.current += 1;
      if (pt) enqueueElevationPoint(pt);
    }
  };

  // 레이어 초기화
  useEffect(() => {
    if (!map) return;

    if (!sourceRef.current) {
      sourceRef.current = new VectorSource();
    }
    if (!layerRef.current) {
      const layer = new VectorLayer({
        source: sourceRef.current,
        renderOrder: compareFeaturesByGeometryStackOrder,
        style: (feature) => {
          if (feature.get('measureType') !== 'slope') return undefined;
          return createSlopeStyle();
        },
        zIndex: 999,
      });
      map.addLayer(layer);
      layerRef.current = layer;
    }

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  // Draw on/off
  useEffect(() => {
    if (!map || !sourceRef.current) return;

    const detachGeomListener = (geom: Geometry | null | undefined) => {
      if (geom && geomChangeHandlerRef.current) {
        geom.un('change', geomChangeHandlerRef.current as never);
      }
      geomChangeHandlerRef.current = null;
    };

    const removeDraw = () => {
      if (dblClickHandlerRef.current) {
        map.un('dblclick', dblClickHandlerRef.current as never);
        dblClickHandlerRef.current = null;
      }
      if (drawRef.current) {
        try {
          map.removeInteraction(drawRef.current);
        } catch {
          /* ignore */
        }
        drawRef.current = null;
      }
      isDrawingRef.current = false;
    };

    removeDraw();
    if (!active) return;

    const draw = new Draw({
      source: sourceRef.current,
      type: 'LineString',
      style: createSlopeStyle(),
    });

    // 더블클릭 종료 시 지도 확대 방지
    const onDblClick = (evt: { preventDefault: () => void }) => {
      if (isDrawingRef.current) evt.preventDefault();
    };
    dblClickHandlerRef.current = onDblClick;
    map.on('dblclick', onDblClick as never);

    draw.on('drawstart', (e) => {
      isDrawingRef.current = true;
      prevSlopeRef.current = { coor: null, elevation: null };
      elevQueueRef.current = Promise.resolve();
      processedCountRef.current = 0;

      const geom = e.feature.getGeometry();
      if (!(geom instanceof LineString)) return;

      const onGeomChange = () => {
        if (!isDrawingRef.current) return;
        processNewCommittedPoints(geom.getCoordinates(), false);
      };
      geomChangeHandlerRef.current = onGeomChange;
      geom.on('change', onGeomChange as never);
      // 첫 클릭 직후 좌표 반영
      processNewCommittedPoints(geom.getCoordinates(), false);
    });

    draw.on('drawabort', (e) => {
      isDrawingRef.current = false;
      detachGeomListener(e.feature?.getGeometry?.());
    });

    draw.on('drawend', (e) => {
      isDrawingRef.current = false;

      const feature = e.feature;
      feature.set('measureType', 'slope');
      feature.setStyle(createSlopeStyle());

      const geometry = feature.getGeometry();
      detachGeomListener(geometry);
      if (!(geometry instanceof LineString)) return;

      // 커서 점 제외된 최종 좌표로 남은 꼭짓점 처리
      processNewCommittedPoints(geometry.getCoordinates(), true);
    });

    map.addInteraction(draw);
    drawRef.current = draw;

    return () => {
      removeDraw();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active]);

  const clearSlopeMeasurements = () => {
    sourceRef.current?.clear();
    clearOverlays();
    prevSlopeRef.current = { coor: null, elevation: null };
    elevQueueRef.current = Promise.resolve();
    processedCountRef.current = 0;
  };

  useEffect(() => {
    return () => {
      clearOverlays();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return { clearSlopeMeasurements };
}
