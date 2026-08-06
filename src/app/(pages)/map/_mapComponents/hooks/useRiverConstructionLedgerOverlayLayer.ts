'use client';

import { useEffect, useRef } from 'react';
import '../config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { Style, Stroke, Fill } from 'ol/style';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { useMapContext } from '../MapContext';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';

export const RIVER_CONSTRUCTION_LEDGER_OVERLAY_LAYER_KEY = 'riverConstructionLedgerOverlay';
export const RIVER_CONSTRUCTION_LEDGER_FEATURE_ID_PROP = 'riverConstructionLedgerId';

const FILL = 'rgba(14, 165, 233, 0.22)';
const STROKE = '#0284c7';

function polygonStyle(): Style {
  return new Style({
    fill: new Fill({ color: FILL }),
    stroke: new Stroke({ color: STROKE, width: 2.5 }),
  });
}

/** 공사대장 패널 열림 시 필터 결과 폴리곤 표시 + 클릭 선택 */
export function useRiverConstructionLedgerOverlayLayer(mapReady: boolean) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const panelOpenRef = useRef(false);
  const skipPickRef = useRef(false);
  const setSelectedIdRef = useRef(mapContext?.setRiverConstructionLedgerSelectedId);

  const panelOpen = mapContext?.riverConstructionLedgerPanelOpen ?? false;
  const rows = mapContext?.riverConstructionLedgerOverlayRows ?? [];
  const geomEditingId = mapContext?.riverConstructionLedgerGeomEditingId ?? null;
  /** 도형 검색 그리기·행 도형 편집 중에는 오버레이 클릭 선택 금지 */
  const skipPick =
    Boolean(mapContext?.spatialDrawRequest) ||
    Boolean(mapContext?.layerRowGeomEdit) ||
    Boolean(geomEditingId);

  panelOpenRef.current = panelOpen;
  skipPickRef.current = skipPick;
  setSelectedIdRef.current = mapContext?.setRiverConstructionLedgerSelectedId;

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: polygonStyle,
      zIndex: 1088,
    });
    layer.set(RIVER_CONSTRUCTION_LEDGER_OVERLAY_LAYER_KEY, true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!panelOpenRef.current || skipPickRef.current) return;
      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const id = feature.get(RIVER_CONSTRUCTION_LEDGER_FEATURE_ID_PROP);
          return typeof id === 'string' && id ? id : undefined;
        },
        { hitTolerance: 6 }
      );
      if (hit) {
        evt.stopPropagation();
        setSelectedIdRef.current?.(hit);
      }
    };

    const key = map.on('singleclick', onClick as never);

    return () => {
      unByKey(key);
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const layer = layerRef.current;
    const source = sourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!layer || !source || !map) return;

    layer.setVisible(panelOpen);
    source.clear();
    if (!panelOpen || rows.length === 0) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const format = new GeoJSONFormat();
    const features = rows.flatMap((row) => {
      // 도형 편집 중인 행은 임시 레이어만 표시 (이전 구간 잔상 방지)
      if (!row.geom || row.id === geomEditingId) return [];
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: row.geom,
            properties: {
              [RIVER_CONSTRUCTION_LEDGER_FEATURE_ID_PROP]: row.id,
            },
          },
        ],
      };
      return format.readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      });
    });
    source.addFeatures(features);
  }, [panelOpen, rows, geomEditingId, mapContext?.mapInstanceRef]);
}
