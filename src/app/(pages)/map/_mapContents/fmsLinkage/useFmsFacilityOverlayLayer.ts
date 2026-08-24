'use client';

import { useEffect, useRef, useState } from 'react';
import '../../_mapComponents/config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import type { FeatureLike } from 'ol/Feature';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { useMapContext } from '../../_mapComponents/MapContext';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';

export const FMS_FACILITY_OVERLAY_LAYER_KEY = 'fmsFacilityOverlay';
export const FMS_FACILITY_FEATURE_ID_PROP = 'fmsFacilNo';
export const FMS_FACILITY_SELECTION_LAYER_KEY = 'fmsFacilitySelectionHighlight';

export type FmsLinkageOverlayRow = {
  facilNo: string;
  geom: Record<string, unknown>;
};

const FILL = 'rgba(234, 88, 12, 0.22)';
const STROKE = '#ea580c';
/** 이보다 작으면 선택 강조 선폭을 줄여 원 마커처럼 보이지 않게 함 (EPSG:3857 m) */
const SMALL_SELECTION_EXTENT_M = 80;

function styleForFeature(feature: FeatureLike): Style | Style[] {
  const geom = feature.getGeometry();
  if (!geom) return [];

  const type = geom.getType();
  if (type === 'Point' || type === 'MultiPoint') {
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: 'rgba(234, 88, 12, 0.55)' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
    });
  }

  return new Style({
    fill: new Fill({ color: FILL }),
    stroke: new Stroke({ color: STROKE, width: 2 }),
  });
}

/** 소면적 폴리곤은 굵은 펄스가 원처럼 보이므로 얇은 면 강조 사용 */
function createFmsSelectionStyle(getPulsePhase: () => number): StyleFunction {
  const base = createDataQuerySelectionRowHighlightStyle(getPulsePhase);
  return (feature, resolution) => {
    if (feature.get('isRadarPoint')) return base(feature, resolution);

    const geom = feature.getGeometry();
    const type = geom?.getType();
    if (type === 'Polygon' || type === 'MultiPolygon') {
      const extent = geom!.getExtent();
      const w = extent[2] - extent[0];
      const h = extent[3] - extent[1];
      if (
        Number.isFinite(w) &&
        Number.isFinite(h) &&
        w < SMALL_SELECTION_EXTENT_M &&
        h < SMALL_SELECTION_EXTENT_M
      ) {
        const phase = getPulsePhase();
        const t = Math.sin(phase);
        return [
          new Style({
            stroke: new Stroke({
              color: `rgba(255, 255, 255, ${0.65 + 0.3 * t})`,
              width: 2.5 + 0.5 * t,
            }),
            fill: new Fill({ color: `rgba(220, 38, 38, ${0.18 + 0.12 * t})` }),
          }),
          new Style({
            stroke: new Stroke({
              color: `rgba(220, 38, 38, ${0.55 + 0.3 * t})`,
              width: 1.5 + 0.4 * t,
            }),
          }),
        ];
      }
    }

    return base(feature, resolution);
  };
}

function parseOverlayGeom(geom: unknown): Record<string, unknown> | null {
  let next: unknown = geom;
  if (typeof next === 'string') {
    try {
      next = JSON.parse(next) as unknown;
    } catch {
      return null;
    }
  }
  if (!next || typeof next !== 'object') return null;
  const obj = { ...(next as Record<string, unknown>) };
  // PostGIS ST_AsGeoJSON 기본 crs — OL 표시용으로 제거
  delete obj.crs;
  return obj;
}

/** 안전점검 패널 열림 시 시설 geom 폴리곤 표시 + 클릭 시 상세 선택 + 선택 행 펄스 강조 */
export function useFmsFacilityOverlayLayer(mapReady: boolean) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const selectionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectionSourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const panelOpenRef = useRef(false);
  const skipPickRef = useRef(false);
  const setSelectedIdRef = useRef(mapContext?.setFmsLinkageSelectedId);
  const [radarActive, setRadarActive] = useState(false);

  const panelOpen = mapContext?.fmsLinkagePanelOpen ?? false;
  const rows = mapContext?.fmsLinkageOverlayRows ?? [];
  const selectedId = mapContext?.fmsLinkageSelectedId ?? null;
  const skipPick =
    Boolean(mapContext?.spatialDrawRequest) || Boolean(mapContext?.layerRowGeomEdit);

  panelOpenRef.current = panelOpen;
  skipPickRef.current = skipPick;
  setSelectedIdRef.current = mapContext?.setFmsLinkageSelectedId;

  useEffect(() => {
    if (!radarActive) return;
    let rafId: number;
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP;
      selectionSourceRef.current?.changed();
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
      style: (feature) => styleForFeature(feature),
      zIndex: 1089,
    });
    layer.set(FMS_FACILITY_OVERLAY_LAYER_KEY, true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    const selectionSource = new VectorSource();
    selectionSourceRef.current = selectionSource;
    const selectionLayer = new VectorLayer({
      source: selectionSource,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createFmsSelectionStyle(() => pulsePhaseRef.current),
      zIndex: 1090,
    });
    selectionLayer.set(FMS_FACILITY_SELECTION_LAYER_KEY, true);
    map.getLayers().push(selectionLayer);
    selectionLayerRef.current = selectionLayer;

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!panelOpenRef.current || skipPickRef.current) return;
      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const id = feature.get(FMS_FACILITY_FEATURE_ID_PROP);
          return typeof id === 'string' && id ? id : undefined;
        },
        { hitTolerance: 6, layerFilter: (l) => l === layer }
      );
      if (hit) {
        evt.stopPropagation();
        setSelectedIdRef.current?.(hit);
      }
    };

    const key = map.on('singleclick', onClick as never);

    return () => {
      unByKey(key);
      map.removeLayer(selectionLayer);
      map.removeLayer(layer);
      selectionLayerRef.current = null;
      selectionSourceRef.current = null;
      layerRef.current = null;
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const layer = layerRef.current;
    const source = sourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !layer || !source || !map) return;

    layer.setVisible(panelOpen);
    source.clear();
    if (!panelOpen || rows.length === 0) {
      layer.changed();
      return;
    }

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const format = new GeoJSONFormat();
    const features = rows.flatMap((row) => {
      if (!row.facilNo) return [];
      const geom = parseOverlayGeom(row.geom);
      if (!geom) return [];
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: geom,
            properties: {
              [FMS_FACILITY_FEATURE_ID_PROP]: row.facilNo,
            },
          },
        ],
      };
      try {
        return format.readFeatures(geojson, {
          dataProjection: 'EPSG:3857',
          featureProjection: viewProj,
        });
      } catch {
        return [];
      }
    });
    source.addFeatures(features);
    layer.changed();
  }, [mapReady, panelOpen, rows, mapContext?.mapInstanceRef]);

  /** 목록·지도에서 선택한 시설 — 데이터조회와 동일한 펄스 강조 (지도 이동은 목록 fit에 맡김) */
  useEffect(() => {
    const selectionLayer = selectionLayerRef.current;
    const selectionSource = selectionSourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !selectionLayer || !selectionSource || !map) return;

    selectionSource.clear();
    setRadarActive(false);

    const key = String(selectedId ?? '').trim();
    if (!panelOpen || !key) {
      selectionLayer.setVisible(false);
      return;
    }

    const row = rows.find((r) => r.facilNo === key);
    const geom = row ? parseOverlayGeom(row.geom) : null;
    if (!geom) {
      selectionLayer.setVisible(false);
      return;
    }

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const format = new GeoJSONFormat();
    let features;
    try {
      features = format.readFeatures(
        {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: geom,
              properties: {},
            },
          ],
        },
        {
          dataProjection: 'EPSG:3857',
          featureProjection: viewProj,
        }
      );
    } catch {
      selectionLayer.setVisible(false);
      return;
    }

    if (features.length === 0) {
      selectionLayer.setVisible(false);
      return;
    }

    const geomType = features[0].getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') {
      features[0].set('isRadarPoint', true);
    }
    selectionSource.addFeatures(features);
    selectionLayer.setVisible(true);
    setRadarActive(true);
  }, [mapReady, panelOpen, rows, selectedId, mapContext?.mapInstanceRef]);
}
