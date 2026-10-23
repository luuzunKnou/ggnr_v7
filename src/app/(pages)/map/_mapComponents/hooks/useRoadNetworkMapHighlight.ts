'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import '../config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { useMapContext } from '../MapContext';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';
import { roadNetworkVisibleSiblingSegments } from '../../_mapContents/road/roadNetwork/roadNetworkGroup';

/**
 * 도로망도 선택 행 geom — 데이터조회와 동일한 벡터 강조(펄스).
 * 지도 이동은 목록 행 클릭에서만 수행한다(지도 객체 클릭은 강조만).
 */
export function useRoadNetworkMapHighlight(mapReady: boolean) {
  const mapContext = useMapContext();
  const allRows = mapContext?.roadNetworkRows;
  const visibleRows = mapContext?.roadNetworkOverlayRows;
  const wholeRoad = mapContext?.roadNetworkWholeRoad ?? false;
  const row = allRows?.find((r) => r.id === mapContext?.roadNetworkSelectedId) ?? null;
  /** 구간 미선택이면 같은 노선번호 구간 전체를 강조 */
  const highlightGeoms = useMemo(() => {
    if (!row) return [];
    const targets =
      wholeRoad && allRows ? roadNetworkVisibleSiblingSegments(allRows, visibleRows, row) : [row];
    return targets.map((r) => r.geom).filter((g): g is NonNullable<typeof g> => g != null);
  }, [row, wholeRoad, allRows, visibleRows]);

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
    });
    layer.set('roadNetworkHighlight', true);
    insertLayerBelowServiceLayer(map, layer);
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
    if (highlightGeoms.length === 0) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const geojson = {
      type: 'FeatureCollection' as const,
      features: highlightGeoms.map((geometry) => ({
        type: 'Feature' as const,
        geometry,
        properties: {},
      })),
    };
    const format = new GeoJSONFormat();
    const features = format.readFeatures(geojson, {
      dataProjection: 'EPSG:4326',
      featureProjection: viewProj,
    });
    if (features.length === 0) return;

    source.addFeatures(features);
    setRadarActive(true);
  }, [highlightGeoms, mapReady, mapContext?.mapInstanceRef]);
}
