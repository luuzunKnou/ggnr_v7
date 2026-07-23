'use client';

import { useEffect, useRef, useState } from 'react';
import '../config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { buffer as bufferExtent } from 'ol/extent';
import { useMapContext } from '../MapContext';
import { fitMapToExtent3857, prepareMapForPanelAwareNavigation } from '../config/mapAutoNavigation';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';

const GEOM_KEY_CANDIDATES = ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape'];

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  if (t === 'GeometryCollection') return 'geometries' in v;
  return 'coordinates' in v;
}

function getGeomJsonFromRow(row: Record<string, unknown>): unknown {
  const keys = Object.keys(row);
  const byName = keys.find((k) => GEOM_KEY_CANDIDATES.includes(k.toLowerCase()));
  const key = byName ?? keys.find((k) => looksLikeGeoJsonGeometry(row[k]));
  if (!key) return null;
  const g = row[key];
  if (g == null) return null;
  let geom: unknown = g;
  if (typeof g === 'string') {
    try {
      geom = JSON.parse(g) as unknown;
    } catch {
      return null;
    }
  }
  if (!looksLikeGeoJsonGeometry(geom)) return null;
  return geom;
}

/** 도로대장 식별 행 ogc_fid — 시설 모달 닫을 때 같은 도로면 줌 생략 판별용 */
function pickIdentifyOgcFromRow(row: Record<string, unknown> | null): number | null {
  if (!row) return null;
  const raw = row.ogc_fid ?? row.OGC_FID;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** 데이터조회(LayerDataPanel `showHighlightedRowOnMap`)과 동일 — 도로대장 총괄(식별) 노선 fit */
const DATA_QUERY_HIGHLIGHT_FIT_PADDING = [80, 80, 80, 80] as const;
const DATA_QUERY_HIGHLIGHT_MAX_ZOOM = Math.min(16, MAP_AUTO_NAV_MAX_ZOOM);

/** 시설 목록 클릭 — 도형 크기에 가깝게 확대(패딩·maxZoom 완화). 지도 클릭은 pickFromMap 으로 fit 생략 */
const FACILITY_LIST_FIT_PADDING = [40, 40, 40, 40] as const;
const FACILITY_LIST_MAX_ZOOM = MAP_AUTO_NAV_MAX_ZOOM;
/** fit 직전 extent 가 거의 점일 때(너비·높이 ~0) 최소 반경(m, 3857) */
const FACILITY_EXTENT_MIN_BUFFER_M = 28;

/**
 * 도로대장 상세(식별 행)·시설 모달 행 geom — 데이터조회와 동일한 벡터 강조(펄스·포인트 레이더).
 */
export function useRoadLedgerMapHighlight(mapReady: boolean) {
  const mapContext = useMapContext();
  const row =
    mapContext?.roadLedgerFacilityModal?.row ?? mapContext?.roadLedgerIdentifyRow ?? null;

  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);
  const prevHadFacilityModalRef = useRef(false);
  const prevIdentifyOgcRef = useRef<number | null>(null);

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
    layer.set('roadLedgerHighlight', true);
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

    const facilityModal = mapContext?.roadLedgerFacilityModal ?? null;
    const hasFacilityModal = Boolean(facilityModal);
    const closedFacilityModal = prevHadFacilityModalRef.current && !hasFacilityModal;
    prevHadFacilityModalRef.current = hasFacilityModal;

    const identifyRow = mapContext?.roadLedgerIdentifyRow ?? null;
    const identifyOgc = pickIdentifyOgcFromRow(identifyRow);
    const identifyOgcUnchanged =
      identifyOgc !== null && identifyOgc === prevIdentifyOgcRef.current;
    prevIdentifyOgcRef.current = identifyOgc;

    /** 시설 모달만 닫고 같은 도로 상세가 유지될 때 — 노선으로 다시 맞춤 줌하지 않음 */
    const skipFitAfterFacilityModalClose =
      closedFacilityModal && Boolean(identifyRow) && identifyOgcUnchanged;

    /** 지도에서 시설만 선택한 경우 — 확대·이동 없음 */
    const skipFitFacilityFromMap = Boolean(facilityModal?.pickFromMap);

    source.clear();
    setRadarActive(false);
    if (!row || typeof row !== 'object') return;

    const geomJson = getGeomJsonFromRow(row as Record<string, unknown>);
    if (!geomJson) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: geomJson as Record<string, unknown>,
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

    const geomType = features[0].getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') {
      features[0].set('isRadarPoint', true);
    }
    source.addFeatures(features);
    setRadarActive(true);

    const ext = source.getExtent();
    if (!ext.every((v) => Number.isFinite(v))) return;

    const shouldRunFit = !skipFitAfterFacilityModalClose && !skipFitFacilityFromMap;
    if (!shouldRunFit) return;

    const isFacilityFromList =
      facilityModal != null && facilityModal.pickFromMap !== true;

    let fitExt = ext;
    const dx = ext[2] - ext[0];
    const dy = ext[3] - ext[1];
    const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
    if (isFacilityFromList && maxDim < FACILITY_EXTENT_MIN_BUFFER_M * 2) {
      fitExt = bufferExtent(ext, FACILITY_EXTENT_MIN_BUFFER_M);
    }

    const runFit = () => {
      if (!map.getTargetElement()) return;
      prepareMapForPanelAwareNavigation(map, () => mapContext?.applyMapViewPaddingRef?.current?.());
      if (isFacilityFromList) {
        fitMapToExtent3857(map, fitExt as [number, number, number, number], {
          fitPadding: [...FACILITY_LIST_FIT_PADDING],
          maxZoom: FACILITY_LIST_MAX_ZOOM,
          duration: 450,
        });
      } else {
        fitMapToExtent3857(map, fitExt as [number, number, number, number], {
          fitPadding: [...DATA_QUERY_HIGHLIGHT_FIT_PADDING],
          maxZoom: DATA_QUERY_HIGHLIGHT_MAX_ZOOM,
        });
      }
    };

    /** layout 반영·패널 padding 적용 후 fit */
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(runFit);
      });
    });
  }, [row, mapReady, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, mapContext?.roadLedgerFacilityModal, mapContext?.roadLedgerIdentifyRow]);
}
