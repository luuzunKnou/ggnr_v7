'use client';

import { useEffect, type MutableRefObject } from 'react';
import type Map from 'ol/Map';
import type { EventsKey } from 'ol/events';
import GeoJSON from 'ol/format/GeoJSON';
import type Geometry from 'ol/geom/Geometry';
import type LineString from 'ol/geom/LineString';
import type Polygon from 'ol/geom/Polygon';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Draw, { createBox } from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import { fromCircle } from 'ol/geom/Polygon';
import { unByKey } from 'ol/Observable';
import WKT from 'ol/format/WKT';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import { fetchWfsGeoJsonByBbox } from '@/lib/geoserverWfs';

/** 그리기 중 꼭짓점 되돌리기 등 — 요청이 살아있는 동안만 유효 */
export type SpatialDrawSketchControl = {
  removeLastPoint: () => void;
  sketchPointCount: () => number;
};

export type SpatialDrawRequest = {
  type: 'rectangle' | 'polygon' | 'circle' | 'line';
  onComplete: (wkt5181: string) => void;
  /** WFS 스냅 대상 테이블(예: tl_sprd_rw). 없으면 스냅 없음 */
  snapLayerName?: string;
  /** 스케치 제어(선 되돌리기). effect cleanup 시 null */
  sketchControlRef?: MutableRefObject<SpatialDrawSketchControl | null>;
  /** 스케치 꼭짓점 수 변경(미완료 도형) */
  onSketchPointCount?: (count: number) => void;
} | null;

const SNAP_LAYER_Z = 850;
const SNAP_DEBOUNCE_MS = 350;
const WFS_MAX_FEATURES = 3000;
const BBOX_BUFFER_RATIO = 0.08;
const SNAP_PIXEL_TOLERANCE = 12;

function bufferedExtent(extent: number[]): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = extent;
  const dx = (maxX - minX) * BBOX_BUFFER_RATIO;
  const dy = (maxY - minY) * BBOX_BUFFER_RATIO;
  return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

/**
 * 공간 검색·도형 그리기 — 맵마다 독립 Interaction.
 * 좌·우 분할 지도 모두에서 동일 요청으로 그릴 수 있다.
 */
export function useSpatialDrawOnMap(
  map: Map | null,
  enabled: boolean,
  spatialDrawRequest: SpatialDrawRequest,
  setSpatialDrawRequest: ((next: SpatialDrawRequest) => void) | null | undefined,
  blocked: boolean
) {
  useEffect(() => {
    if (!enabled || !map || !spatialDrawRequest || !setSpatialDrawRequest) return;
    if (blocked) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      visible: true,
      renderOrder: compareFeaturesByGeometryStackOrder,
    });
    layer.set('spatialDrawLayer', true);
    layer.set('mapSplitNoMirror', true);

    const { type, onComplete, snapLayerName, sketchControlRef, onSketchPointCount } =
      spatialDrawRequest;
    // line: 두 점 직선(시작·끝). 다각형·다점 폴리라인 아님.
    const draw =
      type === 'rectangle'
        ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), stopClick: true })
        : type === 'polygon'
          ? new Draw({ source, type: 'Polygon', stopClick: true })
          : type === 'line'
            ? new Draw({
                source,
                type: 'LineString',
                maxPoints: 2,
                stopClick: true,
              })
            : new Draw({ source, type: 'Circle', stopClick: true });

    let sketchGeom: Geometry | null = null;
    let sketchChangeKey: EventsKey | null = null;
    const reportSketchCount = () => {
      if (!onSketchPointCount) return;
      if (!sketchGeom) {
        onSketchPointCount(0);
        return;
      }
      const gType = sketchGeom.getType();
      if (gType === 'LineString') {
        onSketchPointCount(
          Math.max(0, (sketchGeom as LineString).getCoordinates().length)
        );
        return;
      }
      if (gType === 'Polygon') {
        const ring = (sketchGeom as Polygon).getCoordinates()?.[0];
        onSketchPointCount(Math.max(0, (ring?.length ?? 0) - 1));
        return;
      }
      onSketchPointCount(0);
    };
    const clearSketchTracking = () => {
      if (sketchChangeKey) {
        unByKey(sketchChangeKey);
        sketchChangeKey = null;
      }
      sketchGeom = null;
      onSketchPointCount?.(0);
    };
    if (sketchControlRef || onSketchPointCount) {
      draw.on('drawstart', (evt) => {
        clearSketchTracking();
        sketchGeom = evt.feature.getGeometry() ?? null;
        if (sketchGeom) {
          sketchChangeKey = sketchGeom.on('change', reportSketchCount) as EventsKey;
          reportSketchCount();
        }
      });
      if (sketchControlRef) {
        sketchControlRef.current = {
          removeLastPoint: () => {
            draw.removeLastPoint();
            reportSketchCount();
          },
          sketchPointCount: () => {
            if (!sketchGeom) return 0;
            if (sketchGeom.getType() === 'LineString') {
              return (sketchGeom as LineString).getCoordinates().length;
            }
            if (sketchGeom.getType() === 'Polygon') {
              const ring = (sketchGeom as Polygon).getCoordinates()?.[0];
              return Math.max(0, (ring?.length ?? 0) - 1);
            }
            return 0;
          },
        };
      }
    }

    let snap: Snap | null = null;
    let snapSource: VectorSource | null = null;
    let snapLayer: VectorLayer<VectorSource> | null = null;
    let moveKey: EventsKey | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let fetchSeq = 0;

    const clearSnapLoad = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      fetchSeq += 1;
    };

    if (snapLayerName) {
      snapSource = new VectorSource();
      snapLayer = new VectorLayer({
        source: snapSource,
        opacity: 0,
        visible: true,
        zIndex: SNAP_LAYER_Z,
      });
      snapLayer.set('spatialDrawSnapLayer', true);
      snapLayer.set('mapSplitNoMirror', true);
      map.addLayer(snapLayer);

      const loadSnapFeatures = async () => {
        if (!snapSource || !snapLayerName) return;
        const seq = ++fetchSeq;
        const extent = map.getView().calculateExtent(map.getSize());
        const json = await fetchWfsGeoJsonByBbox({
          layerName: snapLayerName,
          bbox: bufferedExtent(extent),
          srsName: 'EPSG:3857',
          maxFeatures: WFS_MAX_FEATURES,
        });
        if (seq !== fetchSeq || !snapSource) return;
        snapSource.clear();
        if (!json?.features?.length) return;
        const format = new GeoJSON();
        const features = format.readFeatures(json, {
          dataProjection: 'EPSG:3857',
          featureProjection: 'EPSG:3857',
        });
        snapSource.addFeatures(features);
      };

      const scheduleLoad = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void loadSnapFeatures();
        }, SNAP_DEBOUNCE_MS);
      };

      scheduleLoad();
      moveKey = map.on('moveend', scheduleLoad) as EventsKey;
    }

    const onDrawEnd = (e: unknown) => {
      const evt = e as { feature: { getGeometry(): import('ol/geom').Geometry } };
      const rawGeom = evt.feature.getGeometry();
      clearSketchTracking();
      if (sketchControlRef) sketchControlRef.current = null;
      if (!rawGeom) return;
      try {
        const geom =
          rawGeom.getType() === 'Circle'
            ? fromCircle(rawGeom as import('ol/geom/Circle').default)
            : rawGeom;
        const cloned = geom.clone();
        cloned.transform('EPSG:3857', 'EPSG:5181');
        const wkt = new WKT().writeGeometry(cloned);
        onComplete(wkt);
      } catch (err) {
        console.error('[SpatialDraw] WKT write failed', err);
      }
      setSpatialDrawRequest(null);
      map.removeInteraction(draw);
      map.removeLayer(layer);
    };

    draw.on('drawend', onDrawEnd);
    map.addLayer(layer);
    map.addInteraction(draw);
    // Snap은 Draw 뒤에 추가 — 포인터 좌표를 먼저 보정
    if (snapSource) {
      snap = new Snap({
        source: snapSource,
        pixelTolerance: SNAP_PIXEL_TOLERANCE,
        vertex: true,
        edge: true,
      });
      map.addInteraction(snap);
    }

    return () => {
      clearSnapLoad();
      clearSketchTracking();
      if (sketchControlRef) sketchControlRef.current = null;
      if (moveKey) unByKey(moveKey);
      if (snap) {
        map.removeInteraction(snap);
        snap.dispose();
      }
      if (snapLayer) map.removeLayer(snapLayer);
      if (snapSource) snapSource.clear();
      map.removeInteraction(draw);
      map.removeLayer(layer);
    };
  }, [enabled, map, spatialDrawRequest, setSpatialDrawRequest, blocked]);
}
