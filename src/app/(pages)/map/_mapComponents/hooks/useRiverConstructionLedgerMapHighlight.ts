'use client';

import { useEffect, useRef, useState } from 'react';
import '../config/projections';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { useMapContext } from '../MapContext';
import { fitMapToExtent3857, prepareMapForPanelAwareNavigation } from '../config/mapAutoNavigation';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';

const FIT_PADDING = [80, 80, 80, 80] as const;
const FIT_MAX_ZOOM = Math.min(16, MAP_AUTO_NAV_MAX_ZOOM);

function extentToPolygonFeature(extent3857: [number, number, number, number]): Feature {
  const [minX, minY, maxX, maxY] = extent3857;
  return new Feature({
    geometry: new Polygon([
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ]),
  });
}

/**
 * 공사대장 선택 행 폴리곤 / 대상 하천 focus extent — 데이터조회와 동일한 벡터 강조(펄스).
 * 하천 focus가 있으면 하천 위치를 우선 표시·이동한다.
 */
export function useRiverConstructionLedgerMapHighlight(mapReady: boolean) {
  const mapContext = useMapContext();
  const selectedId = mapContext?.riverConstructionLedgerSelectedId ?? null;
  const geomEditingId = mapContext?.riverConstructionLedgerGeomEditingId ?? null;
  const row =
    mapContext?.riverConstructionLedgerRows?.find((r) => r.id === selectedId) ?? null;
  const riverFocus = mapContext?.riverConstructionLedgerRiverFocus ?? null;
  /** 도형 편집 중에는 선택 강조를 숨기고 편집 레이어만 둔다 */
  const highlightRow = geomEditingId && row?.id === geomEditingId ? null : row;

  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);

  useEffect(() => {
    if (!radarActive) return;
    let rafId: number;
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP;
      sourceRef.current?.changed();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [radarActive]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
      zIndex: 1102,
    });
    layer.set('riverConstructionLedgerHighlight', true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source) return;

    source.clear();
    setRadarActive(false);

    let fitExtent: [number, number, number, number] | null = null;

    if (riverFocus?.extent3857?.length === 4) {
      const f = extentToPolygonFeature(riverFocus.extent3857);
      source.addFeature(f);
      fitExtent = riverFocus.extent3857;
      setRadarActive(true);
    } else if (highlightRow?.geom) {
      const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: highlightRow.geom,
            properties: {},
          },
        ],
      };
      const format = new GeoJSONFormat();
      const features = format.readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      });
      if (features.length === 0) return;
      source.addFeatures(features);
      setRadarActive(true);
      const ext = source.getExtent();
      if (ext.every((v) => Number.isFinite(v))) {
        fitExtent = ext as [number, number, number, number];
      }
    }

    // 도형 편집 중 fit은 편집 세션이 담당 — 강조 재진입 시만 이동
    if (!fitExtent || geomEditingId) return;

    const runFit = () => {
      if (!map.getTargetElement()) return;
      prepareMapForPanelAwareNavigation(map, () => mapContext?.applyMapViewPaddingRef?.current?.());
      fitMapToExtent3857(map, fitExtent!, {
        fitPadding: [...FIT_PADDING],
        maxZoom: FIT_MAX_ZOOM,
      });
    };

    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(runFit);
      });
    });
  }, [
    highlightRow,
    riverFocus,
    geomEditingId,
    mapReady,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
    selectedId,
    mapContext?.riverConstructionLedgerRows,
  ]);
}
