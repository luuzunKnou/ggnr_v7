'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import 'ol/ol.css';
import { call } from '@/lib/api';
import {
  MapControlPanel,
  defaultMapControlGroups,
} from './mapControlPanel/mapControlPanel';
import {
  BackgroundMapSelector,
  defaultBackgroundMapGroups,
  buildCustomAerialBackgroundOptions,
  FALLBACK_BACKGROUND_MAP_ID,
  pickLatestCustomAerialBackgroundId,
  type BackgroundMapGroup,
} from './mapControlPanel/backgroundMapSelector';
import { JimokLandownLayerSelector } from './mapControlPanel/JimokLandownLayerSelector';
import { JIMOK_LAYERS } from './layerFactory/jimokLayerFactory';
import { LANDOWN_LAYERS } from './layerFactory/landownLayerFactory';
import { useMapInstance } from './hooks/useMapInstance';
import { useMapContext } from './MapContext';
import { useBackgroundLayer } from './hooks/useBackgroundLayer';
import { useMapStatePersist, loadPersistedMapState } from './hooks/useMapStatePersist';
import { useServiceLayerSync } from './layerFactory/serviceLayerFactory';
import {
  useCadastralLayerSync,
  useBuildingRoadLayerSync,
  CADASTRAL_LAYERS,
  BUILDING_ROAD_LAYERS,
} from './layerFactory/boundaryLayerFactory';
import { useBasicSectionLayerSync } from './layerFactory/basicSectionLayerFactory';
import { useJimokLayerSync } from './layerFactory/jimokLayerFactory';
import { useLandownLayerSync } from './layerFactory/landownLayerFactory';
import {
  getVisibleSafetyMapGeoTables,
  useSafetydataMapLayerSync,
} from './layerFactory/safetydataMapLayerFactory';
import { useMapInteractions } from './hooks/useMapInteractions';
import { useFeatureIdentify } from './hooks/useFeatureIdentify';
import { useMapContextMenu } from './hooks/useMapContextMenu';
import { getAddressFromCoord } from './addressSearch/vworldAddressSearch';
import { transformCoordinate } from './services/coordinateService';
import { collectOpenScanLayerTableNames } from '@/lib/mapServiceOpened';
import {
  isRiverBasicPlanIndexDefineTable,
  isRiverBasicPlanMapAttachmentDefineTable,
  riverBasicPlanIdentifyGeometryRank,
} from '@/lib/riverBasicPlanMapAttachmentLayers';
import {
  compareFeaturesByGeometryStackOrder,
  mergeDefineLayerShpTypesIntoGeometryMap,
  type LayerDbGeometryKind,
} from '@/lib/mapLayerGeometryOrder';
import { useConsoleCapture, useMapViewInfo } from './hooks/useConsoleCapture';
import { useMapVisualCenterPixel } from './hooks/useMapVisualCenterPixel';
import { useMeasure, MeasureType } from './hooks/useMeasure';
import { useOfficialLandPriceMapLayer } from './hooks/useOfficialLandPriceMapLayer';
import { useAddressParcelHighlight } from './hooks/useAddressParcelHighlight';
import { useRoadLedgerMapHighlight } from './hooks/useRoadLedgerMapHighlight';
import { useRoadNetworkMapHighlight } from './hooks/useRoadNetworkMapHighlight';
import { useRoadNetworkOverlayLayer } from './hooks/useRoadNetworkOverlayLayer';
import { useRiverConstructionLedgerMapHighlight } from './hooks/useRiverConstructionLedgerMapHighlight';
import { useRiverConstructionLedgerOverlayLayer } from './hooks/useRiverConstructionLedgerOverlayLayer';
import { useRoadCctvMapLayer } from '../_mapContents/road/roadCCTV/useRoadCctvMapLayer';
import { useItsTrafficTileLayer } from '../_mapContents/road/roadCCTV/useItsTrafficTileLayer';
import { LayerRowGeomEditHandler } from './layerRowEdit/LayerRowGeomEditHandler';
import { canStartMapDrawInteraction, type MapDrawInteractionKind } from './mapDrawInteraction';
import {
  getAllRoadLedgerDocLayerIds,
  ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN,
} from '../_mapContents/road/roadLedger/roadLedgerDocLayerMap';
import { pickRoadLedgerField } from '../_mapContents/road/roadLedger/roadLedgerFormat';
import { Crosshair } from 'lucide-react';
import './config/projections';
import Draw, { createBox } from 'ol/interaction/Draw';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import WKT from 'ol/format/WKT';
import { fromCircle } from 'ol/geom/Polygon';
import Feature from 'ol/Feature';
import { Style, Stroke, Fill } from 'ol/style';
import { isEmpty as isEmptyExtent } from 'ol/extent';

/** EWKT(SRID=…;)·3D 키워드(Z/M) 제거 후 ol/format/WKT 파싱용 문자열로 맞춤 */
function normalizeSpatialFilterWktForOl(wkt: string): string {
  let s = wkt.trim();
  s = s.replace(/^SRID=\d+;/i, '');
  s = s.replace(
    /\b(POLYGON|MULTIPOLYGON|POINT|MULTIPOINT|LINESTRING|MULTILINESTRING)(\s+Z(?:M)?|\s+M)\b/gi,
    '$1'
  );
  return s.trim();
}

function pickIdentifyOgcFid(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  const raw =
    data.ogc_fid ??
    data.OGC_FID ??
    data.ogc_Fid ??
    data.gid ??
    data.GID ??
    data.fid ??
    data.FID;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// 다중 선택 가능한 아이템 ID 목록
const MULTI_SELECT_IDS = [
  'cadastral',
  'building-road',
  'thematic-map',
  'basic-section',
  'land-category',
  'ownership',
  'street-view',
  'official-land-price',
];

// 전체 레이어 끄기 버튼에서 제거할 컨트롤 ID (지적도, 건물도로, 기초구간)
const LAYER_IDS_OFF_ON_ALL_OFF = [
  'cadastral',
  'building-road',
  'thematic-map',
  'basic-section',
  'land-category',
  'ownership',
];

// 액션 전용 버튼 (토글 없이 클릭만)
const ACTION_ONLY_IDS = ['print', 'reset-measurements'];

// 측정 관련 버튼 ID 목록
const MEASUREMENT_IDS = ['distance', 'area', 'altitude', 'slope'];

export type OpenLayersMapProps = {
  /** 배경지도 버튼과 지적도 버튼 사이에 렌더할 컨트롤 (예: 2D/3D 전환 버튼) */
  extraControls?: React.ReactNode;
  defaultCenter?: { lon: number; lat: number } | null;
  projectName?: string;
};

export default function OpenLayersMap({
  extraControls,
  defaultCenter = null,
  projectName,
}: OpenLayersMapProps = {}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapContext = useMapContext();
  const sharedMapRef = mapContext?.mapInstanceRef ?? null;
  const { mapInstanceRef, mapReady } = useMapInstance(
    mapRef,
    sharedMapRef,
    defaultCenter,
    projectName
  );
  const applyMapViewPaddingRef = mapContext?.applyMapViewPaddingRef;

  useEffect(() => {
    if (!mapReady) return;
    applyMapViewPaddingRef?.current?.();
  }, [applyMapViewPaddingRef, mapReady]);
  const showDebugUi = mapContext?.showDebugUi ?? false;
  const [activeControls, setActiveControls] = useState<string[]>([]);
  const [selectedBackgroundMap, setSelectedBackgroundMap] = useState(FALLBACK_BACKGROUND_MAP_ID);
  const [backgroundMapGroups, setBackgroundMapGroups] = useState<BackgroundMapGroup[]>(defaultBackgroundMapGroups);
  const [activeInteractions, setActiveInteractions] = useState<string[]>([]);
  const [isBackgroundPanelExiting, setIsBackgroundPanelExiting] = useState(false);
  const [openSubPanel, setOpenSubPanel] = useState<
    | 'land-category'
    | 'ownership'
    | 'cadastral'
    | 'building-road'
    | 'thematic-map'
    | null
  >(null);
  /** null = 전체 표시, 빈 Set = 전체 숨김 */
  const [visibleJimokLayerNames, setVisibleJimokLayerNames] = useState<Set<string> | null>(null);
  const [visibleLandownLayerNames, setVisibleLandownLayerNames] = useState<Set<string> | null>(null);
  const [visibleCadastralLayerNames, setVisibleCadastralLayerNames] = useState<Set<string> | null>(
    null
  );
  const [visibleBuildingRoadLayerNames, setVisibleBuildingRoadLayerNames] = useState<
    Set<string> | null
  >(null);
  const [geoserverLogLines, setGeoserverLogLines] = useState<string[]>([]);
  const { lines: consoleLines } = useConsoleCapture();
  const consoleLogRef = useRef<HTMLDivElement>(null);
  const backgroundPanelRef = useRef<HTMLDivElement>(null);
  const [backgroundPanelHeight, setBackgroundPanelHeight] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  /** PostGIS geometry_columns 기반 — WMS 다중 레이어 시 면→선→점 순으로 쌓기 */
  const [layerGeometryTypes, setLayerGeometryTypes] = useState<
    Record<string, LayerDbGeometryKind>
  >({});

  // 자체항공영상(배경지도) 패널 높이 측정 → 지목/소유구분 maxHeight 기준으로 사용
  const backgroundPanelVisible =
    activeControls.includes('background-map') || isBackgroundPanelExiting;
  useEffect(() => {
    if (!backgroundPanelVisible || !backgroundPanelRef.current) return;
    const el = backgroundPanelRef.current;
    const ro = new ResizeObserver(() => {
      setBackgroundPanelHeight(el.offsetHeight);
    });
    ro.observe(el);
    setBackgroundPanelHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [backgroundPanelVisible]);

  // 마운트 시 저장된 맵 상태 복원 (버튼 활성화 + 배경지도 + 레이어 목록 + 상세 패널 체크박스)
  useEffect(() => {
    const state = loadPersistedMapState(projectName);
    if (state) {
      if (state.activeControls?.length) setActiveControls(state.activeControls);
      if (state.backgroundMap) setSelectedBackgroundMap(state.backgroundMap);
      if (state.visibleLayerNames?.length && mapContext?.setVisibleLayerNames) {
        mapContext.setVisibleLayerNames(new Set(state.visibleLayerNames));
      }
      const jimokValid = (state.visibleJimokLayerNames ?? []).filter((t) =>
        JIMOK_LAYERS.some((l) => l.tableName === t)
      );
      if (state.visibleJimokLayerNames != null)
        setVisibleJimokLayerNames(jimokValid.length ? new Set(jimokValid) : new Set());
      const landownValid = (state.visibleLandownLayerNames ?? []).filter((t) =>
        LANDOWN_LAYERS.some((l) => l.tableName === t)
      );
      if (state.visibleLandownLayerNames != null)
        setVisibleLandownLayerNames(landownValid.length ? new Set(landownValid) : new Set());
      const cadastralValid = (state.visibleCadastralLayerNames ?? []).filter((t) =>
        CADASTRAL_LAYERS.some((l) => l.tableName === t)
      );
      if (state.visibleCadastralLayerNames != null)
        setVisibleCadastralLayerNames(
          cadastralValid.length ? new Set(cadastralValid) : new Set()
        );
      const buildingRoadValid = (state.visibleBuildingRoadLayerNames ?? []).filter((t) =>
        BUILDING_ROAD_LAYERS.some((l) => l.tableName === t)
      );
      if (state.visibleBuildingRoadLayerNames != null)
        setVisibleBuildingRoadLayerNames(
          buildingRoadValid.length ? new Set(buildingRoadValid) : new Set()
        );
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, [projectName]);

  const fetchGeoserverLog = useCallback(async () => {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getGeoServerLog',
        params: { maxLines: 500 },
      });
      const d = res?.data ?? res;
      setGeoserverLogLines(Array.isArray(d?.lines) ? d.lines : []);
    } catch {
      setGeoserverLogLines([]);
    }
  }, []);

  // 개발자용 로그화면(showDebugUi)이 켜져 있을 때만 GeoServer 로그 폴링
  useEffect(() => {
    if (!showDebugUi) {
      setGeoserverLogLines([]);
      return;
    }
    fetchGeoserverLog();
    const t = setInterval(fetchGeoserverLog, 2000);
    return () => clearInterval(t);
  }, [showDebugUi, fetchGeoserverLog]);

  // 측정 타입 결정
  const measureType: MeasureType | null = activeControls.includes('distance')
    ? 'distance'
    : activeControls.includes('area')
    ? 'area'
    : null;

  // 배경지도 관리
  useBackgroundLayer(mapInstanceRef.current, selectedBackgroundMap);

  useEffect(() => {
    const r = mapContext?.mapBackgroundMapIdRef;
    if (r) r.current = selectedBackgroundMap;
  }, [mapContext?.mapBackgroundMapIdRef, selectedBackgroundMap]);

  /** 변동이력 분석 타임라인 등에서 배경 강제 */
  useEffect(() => {
    const forced = mapContext?.dataFlowForcedBackgroundMapId;
    if (forced != null && String(forced).length > 0) {
      setSelectedBackgroundMap(forced);
    }
  }, [mapContext?.dataFlowForcedBackgroundMapId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await call('', 'POST', {
          service: 'orthophotoService',
          action: 'listOrthophotoTileOutputs',
          params: {},
        });
        if (cancelled) return;
        const d = (res?.data ?? res) as Parameters<typeof buildCustomAerialBackgroundOptions>[0];
        const opts = buildCustomAerialBackgroundOptions(d);
        setBackgroundMapGroups((prev) =>
          prev.map((g) => (g.id === 'custom-aerial' ? { ...g, options: opts } : g))
        );
        const state = loadPersistedMapState(projectName);
        if (!state?.backgroundMap && opts.length > 0) {
          const latest = pickLatestCustomAerialBackgroundId(d);
          if (latest) setSelectedBackgroundMap(latest);
        }
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  // 서비스 레이어 WMS 동기화 (visibleLayerNames → serviceLayer 파라미터)
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();

  // 맵 상태 자동 저장 (복원 완료 후에만 저장 시작 — 빈 상태 덮어쓰기 방지)
  const layerPanelSelections = useMemo(
    () => ({
      visibleJimokLayerNames:
        visibleJimokLayerNames != null ? Array.from(visibleJimokLayerNames) : null,
      visibleLandownLayerNames:
        visibleLandownLayerNames != null ? Array.from(visibleLandownLayerNames) : null,
      visibleCadastralLayerNames:
        visibleCadastralLayerNames != null
          ? Array.from(visibleCadastralLayerNames)
          : null,
      visibleBuildingRoadLayerNames:
        visibleBuildingRoadLayerNames != null
          ? Array.from(visibleBuildingRoadLayerNames)
          : null,
    }),
    [
      visibleJimokLayerNames,
      visibleLandownLayerNames,
      visibleCadastralLayerNames,
      visibleBuildingRoadLayerNames,
    ]
  );
  useMapStatePersist(
    mapInstanceRef.current,
    mapReady && restored,
    selectedBackgroundMap,
    activeControls,
    visibleLayerNames,
    layerPanelSelections,
    projectName
  );
  const spatialFilterWkt = mapContext?.spatialFilterWkt ?? null;

  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    Promise.all([
      call('', 'POST', {
        service: 'devTestService',
        action: 'getLayerTableGeometryTypes',
        params: { schema: 'public_layer' },
      }),
      call('', 'POST', {
        service: 'devTestService',
        action: 'getLayerTableGeometryTypes',
        params: {},
      }),
      fetch('/api/config/defineLayer').then((r) => r.json()),
    ])
      .then(([pubRes, layerRes, defineBody]) => {
        if (cancelled) return;
        const t0 =
          (pubRes?.data?.types as Record<string, LayerDbGeometryKind> | undefined) ??
          (pubRes?.types as Record<string, LayerDbGeometryKind> | undefined) ??
          {};
        const t1 =
          (layerRes?.data?.types as Record<string, LayerDbGeometryKind> | undefined) ??
          (layerRes?.types as Record<string, LayerDbGeometryKind> | undefined) ??
          {};
        const fromDb: Record<string, LayerDbGeometryKind> = { ...t0, ...t1 };
        const tables = Array.isArray(defineBody?.data) ? defineBody.data : [];
        setLayerGeometryTypes(mergeDefineLayerShpTypesIntoGeometryMap(fromDb, tables));
      })
      .catch(() => {
        if (!cancelled) setLayerGeometryTypes({});
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady]);

  useServiceLayerSync(
    mapInstanceRef.current,
    mapReady,
    visibleLayerNames,
    undefined,
    spatialFilterWkt,
    layerGeometryTypes
  );

  // 검색 조건 도형을 지도에 표시 (WKT 5181 → 3857 변환 후 벡터 레이어)
  const spatialFilterLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map) return;

    const existing = spatialFilterLayerRef.current;
    if (existing) {
      map.removeLayer(existing);
      spatialFilterLayerRef.current = null;
    }

    if (!spatialFilterWkt || !spatialFilterWkt.trim()) return;

    try {
      const normalized = normalizeSpatialFilterWktForOl(spatialFilterWkt);
      const format = new WKT();
      const geom = format.readGeometry(normalized, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:3857',
      });
      if (!geom) return;
      const source = new VectorSource({ features: [new Feature(geom)] });
      const layer = new VectorLayer({
        source,
        style: new Style({
          stroke: new Stroke({ color: 'rgba(59, 130, 246, 0.9)', width: 2.5 }),
          fill: new Fill({ color: 'rgba(59, 130, 246, 0.15)' }),
        }),
        zIndex: 500,
      });
      layer.set('spatialFilterLayer', true);
      map.addLayer(layer);
      spatialFilterLayerRef.current = layer;

      const extent = geom.getExtent();
      if (!isEmptyExtent(extent)) {
        map.getView().fit(extent, {
          padding: [48, 48, 48, 48],
          maxZoom: 17,
          duration: 350,
        });
      }
    } catch (err) {
      console.error('[SpatialFilter] WKT parse failed', err);
    }

    return () => {
      if (spatialFilterLayerRef.current) {
        map.removeLayer(spatialFilterLayerRef.current);
        spatialFilterLayerRef.current = null;
      }
    };
  }, [mapReady, spatialFilterWkt]);

  // 측정(거리/면적 등) 켜짐 여부를 MapContext에 동기화 (레이어 목록 도형 그리기와 배타 처리용)
  useEffect(() => {
    const active = activeControls.some((id) => MEASUREMENT_IDS.includes(id));
    mapContext?.setMeasurementActive?.(active);
  }, [activeControls, mapContext?.setMeasurementActive]);

  // 레이어 목록 도형(사각형/다각형/원형) 그리기: spatialDrawRequest 시 Draw 추가, 완료 시 WKT(5181)로 onComplete 호출
  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const layerRowGeomEdit = mapContext?.layerRowGeomEdit ?? null;
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !spatialDrawRequest || !setSpatialDrawRequest) return;
    if (layerRowGeomEdit) return;
    const map = mapInstanceRef.current;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      visible: true,
      renderOrder: compareFeaturesByGeometryStackOrder,
    });
    layer.set('spatialDrawLayer', true);
    const { type, onComplete } = spatialDrawRequest;
    const draw =
      type === 'rectangle'
        ? new Draw({ source, type: 'Circle', geometryFunction: createBox() })
        : type === 'polygon'
          ? new Draw({ source, type: 'Polygon' })
          : new Draw({ source, type: 'Circle' });
    const onDrawEnd = (e: unknown) => {
      const evt = e as { feature: { getGeometry(): import('ol/geom').Geometry } };
      const rawGeom = evt.feature.getGeometry();
      if (!rawGeom) return;
      try {
        // WKT는 Circle을 지원하지 않으므로 원형은 다각형으로 변환 후 저장
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
    return () => {
      map.removeInteraction(draw);
      map.removeLayer(layer);
    };
  }, [mapReady, spatialDrawRequest, setSpatialDrawRequest, layerRowGeomEdit]);

  // 지적도 레이어 동기화 (activeControls + visibleCadastralLayerNames)
  useCadastralLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleCadastralLayerNames
  );
  // 건물·도로 레이어 동기화 (activeControls + visibleBuildingRoadLayerNames)
  useBuildingRoadLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleBuildingRoadLayerNames
  );
  // 기초구간 레이어 동기화 (activeControls → basic-section 레이어 visibility)
  useBasicSectionLayerSync(mapInstanceRef.current, mapReady, activeControls);
  // 지목 레이어 동기화 (activeControls + visibleJimokLayerNames)
  useJimokLayerSync(mapInstanceRef.current, mapReady, activeControls, visibleJimokLayerNames);
  // 소유구분 레이어 동기화 (activeControls + visibleLandownLayerNames)
  useLandownLayerSync(mapInstanceRef.current, mapReady, activeControls, visibleLandownLayerNames);

  const safetyMapLayerVisibility = mapContext?.safetyMapLayerVisibility ?? {};
  const visibleSafetyMapGeoTables = useMemo(
    () => getVisibleSafetyMapGeoTables(safetyMapLayerVisibility),
    [safetyMapLayerVisibility]
  );
  useSafetydataMapLayerSync(mapInstanceRef.current, mapReady, visibleSafetyMapGeoTables);

  // 주소정보 패널이 열려 있을 때 해당 좌표 필지 하이라이트
  const addressInfoDetail = mapContext?.addressInfoDetail ?? null;
  useAddressParcelHighlight(mapInstanceRef.current, mapReady, addressInfoDetail);
  useRoadLedgerMapHighlight(mapReady);
  useRoadNetworkMapHighlight(mapReady);
  useRoadNetworkOverlayLayer(mapReady);
  useRiverConstructionLedgerMapHighlight(mapReady);
  useRiverConstructionLedgerOverlayLayer(mapReady);

  const roadCctvOverlay = mapContext?.roadCctvOverlay ?? null;
  const setRoadCctvOverlay = mapContext?.setRoadCctvOverlay;
  const roadCctvPanelOpen = mapContext?.roadCctvPanelOpen ?? false;
  const roadCctvUnderlayMode = mapContext?.roadCctvUnderlayMode ?? 'traffic';
  const onRoadCctvSelectKey = useCallback(
    (key: string) => {
      setRoadCctvOverlay?.((prev) => (prev ? { ...prev, selectedKey: key } : null));
    },
    [setRoadCctvOverlay]
  );
  useRoadCctvMapLayer(
    mapReady,
    mapInstanceRef.current,
    Boolean(roadCctvOverlay),
    roadCctvOverlay?.items ?? [],
    roadCctvOverlay?.selectedKey ?? null,
    onRoadCctvSelectKey
  );

  const roadCctvExtentWgs84 = mapContext?.roadCctvExtentWgs84 ?? null;
  useItsTrafficTileLayer(
    mapReady,
    mapInstanceRef.current,
    roadCctvPanelOpen && roadCctvUnderlayMode === 'traffic' && roadCctvExtentWgs84 != null,
    roadCctvExtentWgs84
  );

  // 전체 레이어 끄기 버튼(검색창 옆)용 콜백 등록: 지적도·건물도로·기초구간 + defineLayer 레이어 모두 끔
  useEffect(() => {
    if (!mapContext?.allLayersOffRef) return;
    mapContext.allLayersOffRef.current = () => {
      setActiveControls((prev) => prev.filter((id) => !LAYER_IDS_OFF_ON_ALL_OFF.includes(id)));
      mapContext?.setVisibleLayerNames?.(new Set());
    };
    return () => {
      if (mapContext?.allLayersOffRef) mapContext.allLayersOffRef.current = null;
    };
  }, [mapContext]);

  const roadNetworkOverlayPickActive =
    Boolean(mapContext?.roadNetworkPanelOpen) ||
    Boolean(mapContext?.roadNetworkPointPickActive);

  // 지도 클릭 → 도형 검색. 도로망도 패널 열림 시 오버레이 클릭 우선(식별 비활성)
  const { popupState, popupElRef, closePopup } = useFeatureIdentify(
    mapInstanceRef.current,
    mapReady,
    visibleLayerNames,
    roadCctvPanelOpen || !!layerRowGeomEdit || roadNetworkOverlayPickActive
  );

  // 지도 우클릭 → 주소정보 패널. 같은 필지(하이라이트 도형) 안을 다시 우클릭하면 패널만 닫기.
  const handleContextMenu = useCallback(
    (coordinate: [number, number], viewProjection: string) => {
      const setAddressInfoDetail = mapContext?.setAddressInfoDetail;
      if (!setAddressInfoDetail) return;

      if (addressInfoDetail !== null) {
        const coord3857 = transformCoordinate(coordinate, viewProjection, 'EPSG:3857');
        const geomRef = mapContext?.addressParcelGeometryRef?.current as
          | { intersectsCoordinate?(coord: number[]): boolean; containsXY?(x: number, y: number): boolean }
          | null;
        const inside =
          coord3857 &&
          geomRef &&
          (typeof geomRef.intersectsCoordinate === 'function'
            ? geomRef.intersectsCoordinate(coord3857)
            : typeof geomRef.containsXY === 'function'
              ? geomRef.containsXY(coord3857[0], coord3857[1])
              : false);
        if (inside) {
          setAddressInfoDetail(null);
          return;
        }
      }

      const wgs84 = transformCoordinate(coordinate, viewProjection, 'EPSG:4326');
      if (!wgs84) return;
      setAddressInfoDetail({
        coordinate,
        viewProjection,
        loading: true,
        pnu: null,
        jibun: null,
        road: null,
      });
      const coord3857 = transformCoordinate(coordinate, viewProjection, 'EPSG:3857');
      if (coord3857) {
        const [x, y] = coord3857;
        call('', 'POST', {
          service: 'standardService',
          action: 'getJijukParcelAtPoint',
          params: { x, y },
        })
          .then((res) => {
            const payload = (res?.data ?? res) as {
              results?: { tableName?: string; features?: { data?: Record<string, unknown> }[] }[];
            };
            const results = Array.isArray(payload?.results) ? payload.results : [];
            const jijukResult = results.find((r) => String(r?.tableName ?? '').trim() === 'jijuk');
            const row = jijukResult?.features?.[0]?.data;
            const pnu = row?.pnu != null ? String(row.pnu).trim() : '';
            const parcelJibun = row?.jibun != null ? String(row.jibun).trim() : '';
            setAddressInfoDetail((prev) =>
              prev
                ? {
                    ...prev,
                    pnu: prev.pnu ?? (pnu || null),
                    jibun: prev.jibun ?? (parcelJibun || null),
                  }
                : null
            );
          })
          .catch(() => undefined);
      }
      const [lon, lat] = wgs84;
      const apiKey = mapContext?.vworldApiKey?.trim();
      if (!apiKey) {
        setAddressInfoDetail((prev) => (prev ? { ...prev, loading: false, jibun: prev.jibun ?? null, road: null } : null));
        return;
      }
      getAddressFromCoord(lon, lat, { apiKey }).then((result) => {
        setAddressInfoDetail((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                pnu: prev.pnu ?? (result?.pnu?.trim() || null),
                jibun: result?.jibun ?? null,
                road: result?.road ?? null,
                buildingName: result?.buildingName ?? null,
              }
            : null
        );
      });
    },
    [mapContext?.setAddressInfoDetail, mapContext?.vworldApiKey, addressInfoDetail]
  );
  useMapContextMenu(mapInstanceRef.current, mapReady, handleContextMenu);

  const router = useRouter();
  const searchParams = useSearchParams();

  const totalIdentifyCount = popupState?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0;

  // 지도 클릭 시 목록창(팝업) 없이 바로 '지도에서 선택된 항목' 데이터 패널로 열기
  useEffect(() => {
    if (totalIdentifyCount === 0 || !popupState?.results?.length || !mapContext) return;
    let cancelled = false;

    const run = async () => {
      const withFeat = popupState.results.filter((r) => r.features.length > 0);
      if (withFeat.length === 0) return;

      const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
      const openedTokens = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));

      let openScanLayers = new Set<string>();
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'getServiceList',
          params: {},
        });
        if (cancelled) return;
        const body = res?.data ?? res;
        const ser = Array.isArray(body?.ser) ? body.ser : [];
        openScanLayers = collectOpenScanLayerTableNames(openedTokens, ser);
      } catch {
        if (cancelled) return;
        openScanLayers = new Set();
      }

      const hitOpenScan = withFeat.some((r) => openScanLayers.has(String(r.tableName ?? '').trim()));

      /** 패널 열림: 색인도 + 종·횡단 + 구조물 — 겹치면 포인트 → 라인 → 폴리곤. 구조물 분할은 open_scan 미등록이어도 식별되면 처리 */
      if (mapContext?.riverBasicPlanPanelOpen) {
        type RbpHit = (typeof withFeat)[number];
        const cands: { tableName: string; rank: number; wi: number; layer: RbpHit }[] = [];
        for (let wi = 0; wi < withFeat.length; wi++) {
          const r = withFeat[wi];
          const tn = String(r.tableName ?? '').trim();
          if (!tn) continue;
          if (isRiverBasicPlanIndexDefineTable(tn) && openScanLayers.has(tn)) {
            cands.push({
              tableName: tn,
              rank: riverBasicPlanIdentifyGeometryRank(tn),
              wi,
              layer: r,
            });
          } else if (isRiverBasicPlanMapAttachmentDefineTable(tn)) {
            cands.push({
              tableName: tn,
              rank: riverBasicPlanIdentifyGeometryRank(tn),
              wi,
              layer: r,
            });
          }
        }
        if (cands.length > 0) {
          cands.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.wi - b.wi;
          });
          const best = cands[0]!;
          const hitLayer = best.layer;

          if (isRiverBasicPlanIndexDefineTable(best.tableName)) {
            const fid = pickIdentifyOgcFid(hitLayer.features[0]?.data);
            if (fid == null) {
              if (cancelled) return;
              window.alert('식별된 색인도 도형의 고유 ID(ogc_fid)를 읽을 수 없습니다.');
              closePopup();
              return;
            }
            try {
              const pickRes = await call('', 'POST', {
                service: 'riverBasicPlanService',
                action: 'getRiverBasicPlanPickFromIndex',
                params: { indexOgcFid: fid, indexDefineTable: best.tableName },
              });
              if (cancelled) return;
              const pdata = pickRes?.data ?? pickRes;
              const riverName = String(pdata?.riverName ?? '').trim();
              if (!riverName) {
                window.alert(
                  '클릭한 색인도와 겹치는 기본계획(폴리곤)을 찾지 못했습니다. 하천·연도 데이터를 확인해 주세요.',
                );
                closePopup();
                return;
              }
              const tab = pdata?.tab === 'smallRiver' ? 'smallRiver' : 'river';
              mapContext.applyRiverBasicPlanMapPickRef.current?.({
                riverName,
                tab,
              });
              mapContext.setRiverBasicPlanIndexFromMap({
                indexOgcFid: fid,
                planYear: String(pdata?.planYear ?? '').trim(),
                planName: String(pdata?.planName ?? '').trim(),
              });
            } catch (e) {
              if (cancelled) return;
              window.alert(e instanceof Error ? e.message : '색인도 연계 정보를 불러오지 못했습니다.');
            }
            closePopup();
            return;
          }

          const tableName = String(hitLayer.tableName ?? '').trim();
          const row = hitLayer.features[0]?.data;
          const drawingOgcFid = pickIdentifyOgcFid(row);
          try {
            const pickRes = await call('', 'POST', {
              service: 'riverBasicPlanService',
              action: 'getRiverBasicPlanDrawingPickFromIdentify',
              params: {
                defineTableName: tableName,
                ogcFid: drawingOgcFid ?? undefined,
                row: row ?? null,
              },
            });
            if (cancelled) return;
            const pick = pickRes?.data ?? pickRes;
            const fileLayer = String(pick?.fileLayer ?? '').trim();
            const fileKey = String(pick?.fileKey ?? '').trim();
            if (!fileLayer || !fileKey) {
              window.alert('첨부 경로를 확인할 수 없습니다. 피처 속성·키 필드 설정을 확인해 주세요.');
              closePopup();
              return;
            }
            mapContext.setRiverBasicPlanDrawingFromMap({ fileLayer, fileKey });
          } catch (e) {
            if (cancelled) return;
            window.alert(e instanceof Error ? e.message : '도면 첨부 정보를 불러오지 못했습니다.');
          }
          closePopup();
          return;
        }
      }

      /** 도로대장: 시설 define 레이어 → 모달·줌 / a0020000 노선 → 상세 패널 */
      if (mapContext?.roadLedgerPanelOpen && mapContext.setRoadLedgerIdentifyRow) {
        const facilityIdSet = new Set(getAllRoadLedgerDocLayerIds());
        const facilityHit = withFeat.find((r) => {
          const tn = String(r.tableName ?? '')
            .trim()
            .toLowerCase();
          return facilityIdSet.has(tn) && r.features.length > 0;
        });
        if (facilityHit && mapContext.setRoadLedgerFacilityModal) {
          const shouldOpenRouteDetail = !mapContext.roadLedgerIdentifyRow;
          const tableName = String(facilityHit.tableName ?? '')
            .trim()
            .toLowerCase();
          const raw = facilityHit.features[0]?.data;
          const dataRow =
            raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
          const ogc = pickIdentifyOgcFid(dataRow ?? undefined);
          if (ogc != null) {
            try {
              const pickRes = await call('', 'POST', {
                service: 'roadLedgerService',
                action: 'getRoadLedgerFacilityFeatureByOgcFid',
                params: { defineTableName: tableName, ogcFid: ogc },
              });
              if (cancelled) return;
              const pdata = pickRes?.data ?? pickRes;
              const fullRow = pdata?.row as Record<string, unknown> | null | undefined;
              const kor = String(pdata?.defineTableKorName ?? '').trim();
              if (fullRow && typeof fullRow === 'object') {
                if (shouldOpenRouteDetail && mapContext.setRoadLedgerIdentifyRow) {
                  const facilityRdid = String(pickRoadLedgerField(fullRow, 'rdid') ?? '').trim();
                  if (facilityRdid.length >= ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN) {
                    try {
                      const masterRes = await call('', 'POST', {
                        service: 'roadLedgerService',
                        action: 'getRoadLedgerMasterRowForFacilityRdid',
                        params: { facilityRdid },
                      });
                      if (!cancelled) {
                        const mdata = masterRes?.data ?? masterRes;
                        const masterRow = mdata?.row as Record<string, unknown> | null | undefined;
                        if (masterRow && typeof masterRow === 'object') {
                          mapContext.setRoadLedgerIdentifyRow(masterRow);
                        }
                      }
                    } catch {
                      // 노선 상세 없이 시설 모달만
                    }
                  }
                }
                mapContext.setRoadLedgerFacilityModal({
                  row: fullRow,
                  defineTableName: tableName,
                  defineTableTitle: kor || tableName,
                  pickFromMap: true,
                });
              }
            } catch (e) {
              if (!cancelled) {
                window.alert(
                  e instanceof Error ? e.message : '시설 정보를 불러오지 못했습니다.',
                );
              }
            }
            closePopup();
            return;
          }
        }

        const roadHit = withFeat.find(
          (r) =>
            String(r.tableName ?? '')
              .trim()
              .toLowerCase() === 'a0020000' && r.features.length > 0
        );
        if (roadHit) {
          mapContext.setRoadLedgerFacilityModal?.(null);
          const row = roadHit.features[0]?.data;
          if (row && typeof row === 'object') {
            mapContext.setRoadLedgerIdentifyRow(row as Record<string, unknown>);
          }
          closePopup();
          return;
        }
      }

      if (hitOpenScan) {
        if (cancelled) return;
        window.alert('하천 기본계획 패널이 열린 상태입니다. 스캔 보기는 추후 구현 예정입니다.');
        closePopup();
        return;
      }

      const isDataQueryMenu = openedTokens.includes('standardList');
      if (!isDataQueryMenu || mapContext.dataQueryMapPickEnabled === false) {
        closePopup();
        return;
      }

      const layer = withFeat.find((r) => r.isSplitLayer) ?? withFeat[0];
      if (!layer) return;
      const feature = totalIdentifyCount === 1 ? layer.features[0].data : null;
      mapContext.setIdentifyResultList(popupState);
      mapContext.setIdentifySelectedRow(feature);
      const nextOpened = rawOpened.includes('listView') ? rawOpened : [...rawOpened, 'listView'];
      const next = new URLSearchParams(Array.from(searchParams.entries()));
      next.set('opened', nextOpened.join(','));
      next.set('dataTable', layer.tableName);
      next.delete('dataKey');
      router.push(`/map?${next.toString()}`);
      closePopup();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [totalIdentifyCount, popupState, mapContext, searchParams, router, closePopup]);

  // 맵 뷰 정보 (줌, 좌표계, 중심 좌표) 실시간 추적
  const viewInfo = useMapViewInfo(mapInstanceRef.current, mapReady);

  // view.padding 반영 "시각적 중심" 픽셀 (크로스헤어 등)
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const centerPixel = useMapVisualCenterPixel(mapInstanceRef.current, mapReady, mapPaddingLeft);

  // console 로그 auto-scroll
  useEffect(() => {
    const el = consoleLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  // 배경지도 패널: exit 애니메이션 끝난 뒤 상태 정리 (duration 400ms)
  useEffect(() => {
    if (!isBackgroundPanelExiting) return;
    const t = setTimeout(() => setIsBackgroundPanelExiting(false), 400);
    return () => clearTimeout(t);
  }, [isBackgroundPanelExiting]);

  // 인터랙션 관리 (draw, snap 등)
  useMapInteractions(mapInstanceRef.current, activeInteractions);

  // 측정 기능
  const { clearMeasurements } = useMeasure(
    mapInstanceRef.current,
    measureType,
    (result) => {
      console.log('측정 완료:', result);
    }
  );

  const clearMapDrawInteractions = useCallback(
    (except?: MapDrawInteractionKind) => {
      if (except !== 'measure') {
        setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
        clearMeasurements();
      }
      if (except !== 'spatialSearch') {
        setSpatialDrawRequest?.(null);
      }
    },
    [clearMeasurements, setSpatialDrawRequest]
  );

  useEffect(() => {
    const ref = mapContext?.clearMapDrawInteractionsRef;
    if (!ref) return;
    ref.current = clearMapDrawInteractions;
    return () => {
      ref.current = null;
    };
  }, [clearMapDrawInteractions, mapContext?.clearMapDrawInteractionsRef]);

  useOfficialLandPriceMapLayer(
    mapInstanceRef.current,
    mapReady,
    activeControls.includes('official-land-price')
  );

  const handleItemRightClick = (id: string) => {
    if (id === 'land-category') {
      setOpenSubPanel((prev) => (prev === 'land-category' ? null : 'land-category'));
      if (openSubPanel !== 'land-category') {
        setVisibleJimokLayerNames((prev) => {
          if (prev != null && prev.size > 0) return prev;
          return new Set(JIMOK_LAYERS.map((l) => l.tableName));
        });
      }
      return;
    }
    if (id === 'ownership') {
      setOpenSubPanel((prev) => (prev === 'ownership' ? null : 'ownership'));
      if (openSubPanel !== 'ownership') {
        setVisibleLandownLayerNames((prev) => {
          if (prev != null && prev.size > 0) return prev;
          return new Set(LANDOWN_LAYERS.map((l) => l.tableName));
        });
      }
      return;
    }
    if (id === 'cadastral') {
      setOpenSubPanel((prev) => (prev === 'cadastral' ? null : 'cadastral'));
      if (openSubPanel !== 'cadastral') {
        setVisibleCadastralLayerNames((prev) => {
          if (prev != null && prev.size > 0) return prev;
          return new Set(CADASTRAL_LAYERS.map((l) => l.tableName));
        });
      }
      return;
    }
    if (id === 'building-road') {
      setOpenSubPanel((prev) => (prev === 'building-road' ? null : 'building-road'));
      if (openSubPanel !== 'building-road') {
        setVisibleBuildingRoadLayerNames((prev) => {
          if (prev != null && prev.size > 0) return prev;
          return new Set(BUILDING_ROAD_LAYERS.map((l) => l.tableName));
        });
      }
      return;
    }
    if (id === 'thematic-map') {
      setOpenSubPanel((prev) => (prev === 'thematic-map' ? null : 'thematic-map'));
      return;
    }
    if (id === 'background-map') {
      if (activeControls.includes('background-map')) {
        setIsBackgroundPanelExiting(true);
        setActiveControls((prev) => prev.filter((item) => item !== 'background-map'));
      } else {
        setActiveControls((prev) =>
          prev.includes('background-map') ? prev : [...prev, 'background-map']
        );
      }
      return;
    }
    setOpenSubPanel(null);
    handleControlClick(id, activeControls.includes(id));
  };

  const handleControlClick = (id: string, isActive: boolean) => {
    if (MEASUREMENT_IDS.includes(id) && !isActive && !canStartMapDrawInteraction(mapContext, 'measure')) {
      return;
    }

    // 초기화 버튼: 측정 관련 버튼 모두 선택 해제 및 측정 결과 초기화
    if (id === 'reset-measurements') {
      setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
      clearMeasurements();
      console.log(`[v0] Reset measurements triggered`);
      return;
    }

    // 액션 전용 버튼은 상태 변경 없이 액션만 실행
    if (ACTION_ONLY_IDS.includes(id)) {
      console.log(`[v0] Action triggered: ${id}`);
      // 여기에 인쇄 등 실제 액션 로직 추가
      return;
    }

    if (MULTI_SELECT_IDS.includes(id)) {
      // 다중 선택 가능한 항목: 토글. 켤 때 선택이 비어 있으면 전체로 초기화
      if (!isActive) {
        if (id === 'land-category') {
          setVisibleJimokLayerNames((prev) =>
            prev != null && prev.size > 0 ? prev : new Set(JIMOK_LAYERS.map((l) => l.tableName))
          );
        } else if (id === 'ownership') {
          setVisibleLandownLayerNames((prev) =>
            prev != null && prev.size > 0 ? prev : new Set(LANDOWN_LAYERS.map((l) => l.tableName))
          );
        } else if (id === 'cadastral') {
          setVisibleCadastralLayerNames((prev) =>
            prev != null && prev.size > 0 ? prev : new Set(CADASTRAL_LAYERS.map((l) => l.tableName))
          );
        } else if (id === 'building-road') {
          setVisibleBuildingRoadLayerNames((prev) =>
            prev != null && prev.size > 0
              ? prev
              : new Set(BUILDING_ROAD_LAYERS.map((l) => l.tableName))
          );
        }
      }
      setActiveControls((prev) =>
        isActive ? prev.filter((item) => item !== id) : [...prev, id]
      );
    } else if (id === 'background-map' && isActive) {
      // 배경지도 패널 닫기: exit 애니메이션 먼저 시작한 뒤 activeControls에서 제거 (깜빡임 방지)
      setIsBackgroundPanelExiting(true);
      setActiveControls((prev) => {
        const withoutSingle = prev.filter((item) => MULTI_SELECT_IDS.includes(item));
        return withoutSingle;
      });
    } else {
      // 단일 선택 항목: 배타적 토글
      // 측정 도구는 서로 배타적 (거리/면적 동시 선택 불가)
      if (MEASUREMENT_IDS.includes(id)) {
        setActiveControls((prev) => {
          const withoutMeasurements = prev.filter((item) => !MEASUREMENT_IDS.includes(item));
          return isActive ? withoutMeasurements : [...withoutMeasurements, id];
        });
      } else {
        setActiveControls((prev) => {
          const withoutSingle = prev.filter((item) => MULTI_SELECT_IDS.includes(item));
          return isActive ? withoutSingle : [...withoutSingle, id];
        });
      }
    }
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full bg-black [&_.ol-viewport]:bg-black" />

      <LayerRowGeomEditHandler centerPixel={centerPixel} />

      {/* 지도 중심점 마크 (view 중심 = padding 반영된 보이는 영역 중심에 배치) */}
      <div
        className="absolute z-[5] -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
        style={
          centerPixel
            ? { left: centerPixel.x, top: centerPixel.y }
            : { left: '50%', top: '50%' }
        }
        aria-hidden
      >
        <Crosshair
          className="w-6 h-6 text-orange-600 opacity-80 drop-shadow-md"
          strokeWidth={2}
        />
      </div>

      {/* 오른쪽 맵 컨트롤 패널 */}
      <div className="absolute right-4 z-10 flex flex-col items-end gap-3" style={{ top: '60px' }}>
        <div className="flex items-start gap-3">
          {/* 배경지도 선택 패널 (등장/퇴장 애니메이션, duration 400ms) */}
          {(activeControls.includes('background-map') || isBackgroundPanelExiting) && (
            <div
              ref={backgroundPanelRef}
              className={
                isBackgroundPanelExiting
                  ? 'animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]'
                  : 'animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]'
              }
            >
              <BackgroundMapSelector
                groups={backgroundMapGroups}
                value={selectedBackgroundMap}
                onValueChange={setSelectedBackgroundMap}
              />
            </div>
          )}

          {openSubPanel === 'land-category' && (
            <div className="animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto">
              <JimokLandownLayerSelector
                title="지목"
                contentSized
                layers={JIMOK_LAYERS}
                selectedTableNames={
                  visibleJimokLayerNames ?? new Set(JIMOK_LAYERS.map((l) => l.tableName))
                }
                onSelectionChange={(next) => {
                  setVisibleJimokLayerNames(next);
                  setActiveControls((prev) =>
                    next.size === 0
                      ? prev.filter((x) => x !== 'land-category')
                      : prev.includes('land-category')
                        ? prev
                        : [...prev, 'land-category']
                  );
                }}
                onClose={() => setOpenSubPanel(null)}
              />
            </div>
          )}
          {openSubPanel === 'ownership' && (
            <div className="animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto">
              <JimokLandownLayerSelector
                title="소유구분"
                contentSized
                layers={LANDOWN_LAYERS}
                selectedTableNames={
                  visibleLandownLayerNames ?? new Set(LANDOWN_LAYERS.map((l) => l.tableName))
                }
                onSelectionChange={(next) => {
                  setVisibleLandownLayerNames(next);
                  setActiveControls((prev) =>
                    next.size === 0
                      ? prev.filter((x) => x !== 'ownership')
                      : prev.includes('ownership')
                        ? prev
                        : [...prev, 'ownership']
                  );
                }}
                onClose={() => setOpenSubPanel(null)}
              />
            </div>
          )}
          {openSubPanel === 'cadastral' && (
            <div className="animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto">
              <JimokLandownLayerSelector
                title="지적도"
                contentSized
                layers={CADASTRAL_LAYERS}
                selectedTableNames={
                  visibleCadastralLayerNames ??
                  new Set(CADASTRAL_LAYERS.map((l) => l.tableName))
                }
                onSelectionChange={(next: Set<string>) => {
                  setVisibleCadastralLayerNames(next);
                  setActiveControls((prev) =>
                    next.size === 0
                      ? prev.filter((x) => x !== 'cadastral')
                      : prev.includes('cadastral')
                        ? prev
                        : [...prev, 'cadastral']
                  );
                }}
                onClose={() => setOpenSubPanel(null)}
              />
            </div>
          )}
          {openSubPanel === 'building-road' && (
            <div className="animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto">
              <JimokLandownLayerSelector
                title="건물·도로"
                contentSized
                layers={BUILDING_ROAD_LAYERS}
                selectedTableNames={
                  visibleBuildingRoadLayerNames ??
                  new Set(BUILDING_ROAD_LAYERS.map((l) => l.tableName))
                }
                onSelectionChange={(next: Set<string>) => {
                  setVisibleBuildingRoadLayerNames(next);
                  setActiveControls((prev) =>
                    next.size === 0
                      ? prev.filter((x) => x !== 'building-road')
                      : prev.includes('building-road')
                        ? prev
                        : [...prev, 'building-road']
                  );
                }}
                onClose={() => setOpenSubPanel(null)}
              />
            </div>
          )}
          {openSubPanel === 'thematic-map' && (
            <div className="animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto">
              <div className="w-56 bg-white shadow-xl overflow-hidden flex flex-col rounded-[5px] opacity-90">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
                  <span className="text-[13px] font-medium">주제도</span>
                  <button
                    type="button"
                    onClick={() => setOpenSubPanel(null)}
                    className="text-slate-500 hover:text-slate-700 text-xs"
                    aria-label="닫기"
                  >
                    닫기
                  </button>
                </div>
                <div className="px-3 py-3 text-[11px] text-slate-600 leading-snug">
                  주제도 레이어 목록·표시는 곧 연결됩니다.
                </div>
              </div>
            </div>
          )}

          <MapControlPanel
            groups={defaultMapControlGroups}
            activeIds={activeControls}
            onItemClick={handleControlClick}
            onItemRightClick={handleItemRightClick}
            extraAfterFirstGroup={extraControls}
          />
        </div>
      </div>

      {/* 하단 디버그 패널 스택 — showDebugUi 시에만 표시 */}
      {showDebugUi && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-2xl px-2 flex flex-col gap-1">
          {/* GeoServer 로그 */}
          <div
            className="font-mono text-xs leading-tight bg-black/70 text-green-400 px-2 py-1 rounded shadow overflow-y-scroll overflow-x-hidden break-words scrollbar-hide"
            style={{ maxHeight: '7.5rem', minHeight: '2.5rem' }}
          >
            {geoserverLogLines.length === 0 ? (
              <span className="text-white/60">GeoServer 로그 없음</span>
            ) : (
              geoserverLogLines.map((line, i) => (
                <div key={i} className="break-words" title={line}>
                  {line}
                </div>
              ))
            )}
          </div>

          {/* Console 로그 */}
          <div
            ref={consoleLogRef}
            className="font-mono text-xs leading-tight bg-black/70 text-cyan-300 px-2 py-1 rounded shadow overflow-y-scroll overflow-x-hidden break-words scrollbar-hide"
            style={{ maxHeight: '7.5rem', minHeight: '2.5rem' }}
          >
            {consoleLines.length === 0 ? (
              <span className="text-white/60">Console 로그 없음</span>
            ) : (
              consoleLines.map((line, i) => (
                <div
                  key={i}
                  className={`break-words ${
                    line.level === 'error'
                      ? 'text-red-400'
                      : line.level === 'warn'
                      ? 'text-yellow-400'
                      : 'text-cyan-300'
                  }`}
                  title={line.message}
                >
                  <span className="text-white/50 mr-1">{line.timestamp}</span>
                  {line.message}
                </div>
              ))
            )}
          </div>

          {/* 줌 레벨, 좌표계, x, y */}
          {viewInfo.zoomLevel !== null && (
            <div className="w-full font-mono text-xs leading-tight bg-black/70 text-white/80 px-2 py-1 rounded shadow flex items-center gap-4">
              <span>zoom: {Number(viewInfo.zoomLevel).toFixed(1)}</span>
              {viewInfo.projectionCode && <span>{viewInfo.projectionCode}</span>}
              {viewInfo.centerX != null && viewInfo.centerY != null && (
                <span>
                  x: {viewInfo.centerX.toFixed(0)} y: {viewInfo.centerY.toFixed(0)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 목록창(팝업) 제거: 클릭 시 바로 '지도에서 선택된 항목' 데이터 패널로 열림 */}

    </div>
  );
}
