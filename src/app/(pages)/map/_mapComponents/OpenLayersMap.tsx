'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import 'ol/ol.css';
import { fromLonLat } from 'ol/proj';
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
import { ThematicMapLayerSelector } from './mapControlPanel/ThematicMapLayerSelector';
import { JIMOK_LAYERS } from './layerFactory/jimokLayerFactory';
import {
  OWNERSHIP_LAYERS,
  useOwnershipLayerSync,
} from './layerFactory/ownershipLayerFactory';
import {
  THEMATIC_MAP_LAYERS,
  useThematicMapLayerSync,
} from './layerFactory/thematicMapLayerFactory';
import { useThematicMapCatalog } from './hooks/useThematicMapCatalog';
import { useOwnershipCatalog } from './hooks/useOwnershipCatalog';
import { useBuildingRoadCatalog } from './hooks/useBuildingRoadCatalog';
import { useCadastralCatalog } from './hooks/useCadastralCatalog';
import { useJimokCatalog } from './hooks/useJimokCatalog';
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
import {
  getVisibleSafetyMapGeoTables,
  useSafetydataMapLayerSync,
} from './layerFactory/safetydataMapLayerFactory';
import { useMapInteractions } from './hooks/useMapInteractions';
import { useFeatureIdentify } from './hooks/useFeatureIdentify';
import { useMapContextMenu } from './hooks/useMapContextMenu';
import { findRoadAddressByJibun, getAddressFromCoord } from './addressSearch/vworldAddressSearch';
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
import { useAltitudeMeasure } from './hooks/useAltitudeMeasure';
import { useForwardOverlayPointerMoveToMap } from './hooks/useForwardOverlayPointerMoveToMap';
import { useSlopeMeasure } from './hooks/useSlopeMeasure';
import { useSpatialDrawOnMap } from './hooks/useSpatialDrawOnMap';
import { MapPrintModal } from '../_mapContents/mapPrint/MapPrintModal';
import type { MapPrintSnapshot } from '../_mapContents/mapPrint/mapPrintTypes';
import { MapSplitResetMeasurementsPanel } from '../_mapContents/mapSplit/MapSplitResetMeasurementsPanel';
import { MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX } from './mapSplit/mapSplitTypes';
import {
  MAP_MEASUREMENTS_RESET_EVENT,
  parseMapMeasurementsResetTarget,
} from '../_mapContents/mapSplit/mapMeasurementsReset';
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
import {
  USAGE_DATA_AS_WMS_LAYER_ID,
  USAGE_DATA_AS_WMS_LAYER_IDS,
  isUsageDataAsWmsLayerId,
} from '../_mapContents/river/usageDataAs/usageDataAsLayerId';
import {
  findOpenedOccupationLedgerSerEng,
  getOccupationLedgerBinding,
  getOccupationLedgerWmsLayerIds,
} from '@/lib/occupationLedgerBinding';
import { getAllUseFeeWmsLayerIds, getUseFeeWmsLayerId } from '../_mapContents/useFee/useFeeLayerId';
import {
  USE_FEE_PUBLIC_OCCUPATION_WMS_LAYER_ID,
  USE_FEE_ROAD_OCCUPATION_WMS_LAYER_ID,
  USE_FEE_WATER_OCCUPATION_WMS_LAYER_ID,
} from '../_mapContents/useFee/useFeeMapSync';
import { Crosshair } from 'lucide-react';
import './config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import WKT from 'ol/format/WKT';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import { Style, Stroke, Fill } from 'ol/style';
import { isEmpty as isEmptyExtent } from 'ol/extent';
import { AerialViewLayerPanel } from '../_mapContents/aerialView/AerialViewLayerPanel';
import { useAerialViewCheckedMarkers } from '../_mapContents/aerialView/useAerialViewCheckedMarkers';
import { useAerialOrthoCheckedTiles } from '../_mapContents/aerialView/useAerialOrthoCheckedTiles';
import type { MapControlGroup } from './mapControlPanel/mapControlPanel';

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

function pickIdentifyConsCode(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase() === 'cons_code') {
      const s = String(v ?? '').trim();
      return s || null;
    }
  }
  return null;
}

function pickIdentifyField(
  data: Record<string, unknown> | undefined,
  fieldName: string
): string | null {
  if (!data) return null;
  const want = fieldName.toLowerCase();
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase() === want) {
      const s = String(v ?? '').trim();
      return s || null;
    }
  }
  return null;
}

const IDENTIFY_GEOM_KEYS = ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape'];

/** identify 행의 WGS84 GeoJSON → EPSG:3857 extent (클릭 도형 중앙 맞춤용) */
function pickIdentifyExtent3857(
  data: Record<string, unknown> | undefined
): [number, number, number, number] | null {
  if (!data) return null;
  const keys = Object.keys(data);
  const byName = keys.find((k) => IDENTIFY_GEOM_KEYS.includes(k.toLowerCase()));
  const key =
    byName ??
    keys.find((k) => {
      const v = data[k];
      return v && typeof v === 'object' && 'type' in (v as object) && 'coordinates' in (v as object);
    });
  if (!key) return null;
  let geom: unknown = data[key];
  if (typeof geom === 'string') {
    try {
      geom = JSON.parse(geom) as unknown;
    } catch {
      return null;
    }
  }
  if (!geom || typeof geom !== 'object') return null;
  try {
    const features = new GeoJSON().readFeatures(
      { type: 'Feature', geometry: geom, properties: {} },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
    );
    const ext = features[0]?.getGeometry()?.getExtent();
    if (!ext || ext.length !== 4 || !ext.every((v) => Number.isFinite(v))) return null;
    return [ext[0]!, ext[1]!, ext[2]!, ext[3]!];
  } catch {
    return null;
  }
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
  'map-split',
  'official-land-price',
];

/** 서로 배타 — 지도 분할 보조 칸은 한 종류만 */
const MAP_SPLIT_EXCLUSIVE_IDS = ['street-view', 'map-split'] as const;

/** 좌클릭으로 목록 패널을 여는 레이어 그룹 (체크는 패널에서만) */
const PANEL_LAYER_IDS = [
  'land-category',
  'ownership',
  'cadastral',
  'building-road',
  'thematic-map',
] as const;
type PanelLayerId = (typeof PANEL_LAYER_IDS)[number];

function isPanelLayerId(id: string): id is PanelLayerId {
  return (PANEL_LAYER_IDS as readonly string[]).includes(id);
}

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
const ACTION_ONLY_IDS = ['print', 'reset-measurements', 'shooting-request'];

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
  /** Provider value는 매 렌더 새 객체 — identify effect deps에 mapContext 넣지 않기 위해 ref 유지 */
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const sharedMapRef = mapContext?.mapInstanceRef ?? null;
  const { mapInstanceRef, mapReady } = useMapInstance(
    mapRef,
    sharedMapRef,
    defaultCenter,
    projectName
  );
  const applyMapViewPaddingRef = mapContext?.applyMapViewPaddingRef;

  useEffect(() => {
    mapContext?.setMapReady?.(mapReady);
    return () => {
      mapContext?.setMapReady?.(false);
    };
  }, [mapReady, mapContext]);

  useEffect(() => {
    if (!mapReady) return;
    applyMapViewPaddingRef?.current?.();
  }, [applyMapViewPaddingRef, mapReady]);

  // 배경지도 등 오버레이 위에서도 Draw/측정 고무줄이 pointermove를 받도록
  useForwardOverlayPointerMoveToMap(mapReady ? mapInstanceRef.current : null, mapReady);

  const showDebugUi = mapContext?.showDebugUi ?? false;
  const [activeControls, setActiveControls] = useState<string[]>([]);
  const [isResetPanelExiting, setIsResetPanelExiting] = useState(false);
  /** 초기화 패널이 실제로 열려 입력·측정을 막는 상태 (퇴장 애니메이션 제외) */
  const resetMeasurementsPanelOpen = activeControls.includes('reset-measurements');
  /** 퇴장 애니메이션용 표시 여부 */
  const resetMeasurementsPanelVisible =
    resetMeasurementsPanelOpen || isResetPanelExiting;
  const [selectedBackgroundMap, setSelectedBackgroundMap] = useState(FALLBACK_BACKGROUND_MAP_ID);
  const [backgroundMapGroups, setBackgroundMapGroups] = useState<BackgroundMapGroup[]>(defaultBackgroundMapGroups);
  const [activeInteractions, setActiveInteractions] = useState<string[]>([]);
  const [isBackgroundPanelExiting, setIsBackgroundPanelExiting] = useState(false);
  const [isAerialViewPanelExiting, setIsAerialViewPanelExiting] = useState(false);
  const [aerialViewCheckedIds, setAerialViewCheckedIds] = useState<Set<string>>(() => new Set());
  const [openSubPanel, setOpenSubPanel] = useState<
    | 'land-category'
    | 'ownership'
    | 'cadastral'
    | 'building-road'
    | 'thematic-map'
    | null
  >(null);

  // 거리뷰·지도분할(보조 칸) ↔ 우측 토글 (상호 배타)
  useEffect(() => {
    const setKind = mapContext?.setMapSplitSecondaryKind;
    if (!setKind) return;
    if (activeControls.includes('map-split')) {
      setKind('map');
    } else if (activeControls.includes('street-view')) {
      setKind('streetView');
    } else {
      setKind(null);
    }
  }, [activeControls, mapContext?.setMapSplitSecondaryKind]);

  // 거터 «분할 종료» 등 Context kind가 먼저 꺼진 경우 activeControls 정리
  useEffect(() => {
    const kind = mapContext?.mapSplitSecondaryKind ?? null;
    if (kind === 'map') return;
    setActiveControls((prev) =>
      prev.includes('map-split') ? prev.filter((id) => id !== 'map-split') : prev
    );
  }, [mapContext?.mapSplitSecondaryKind]);

  useEffect(() => {
    const kind = mapContext?.mapSplitSecondaryKind ?? null;
    if (kind === 'streetView') return;
    setActiveControls((prev) =>
      prev.includes('street-view') ? prev.filter((id) => id !== 'street-view') : prev
    );
  }, [mapContext?.mapSplitSecondaryKind]);

  /** null = 전체 표시, 빈 Set = 전체 숨김 */
  const [visibleJimokLayerNames, setVisibleJimokLayerNames] = useState<Set<string> | null>(null);
  const [visibleLandownLayerNames, setVisibleLandownLayerNames] = useState<Set<string> | null>(null);
  const [visibleCadastralLayerNames, setVisibleCadastralLayerNames] = useState<Set<string> | null>(
    null
  );
  const [visibleBuildingRoadLayerNames, setVisibleBuildingRoadLayerNames] = useState<
    Set<string> | null
  >(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printSnapshot, setPrintSnapshot] = useState<MapPrintSnapshot | null>(null);
  const [visibleThematicLayerNames, setVisibleThematicLayerNames] = useState<Set<string> | null>(
    null
  );
  const {
    groups: thematicGroups,
    availableLayerTableNames: thematicAvailableTableNames,
    loading: thematicCatalogLoading,
  } = useThematicMapCatalog();
  const {
    groups: ownershipGroups,
    availableLayerTableNames: ownershipAvailableTableNames,
    loading: ownershipCatalogLoading,
  } = useOwnershipCatalog();
  const {
    layers: buildingRoadPanelLayers,
    availableLayerTableNames: buildingRoadAvailableTableNames,
    loading: buildingRoadCatalogLoading,
  } = useBuildingRoadCatalog();
  const {
    layers: cadastralPanelLayers,
    availableLayerTableNames: cadastralAvailableTableNames,
    loading: cadastralCatalogLoading,
  } = useCadastralCatalog();
  const {
    layers: jimokPanelLayers,
    availableLayerTableNames: jimokAvailableTableNames,
    loading: jimokCatalogLoading,
  } = useJimokCatalog();

  /** 우클릭 패널용 — 가용 레이어만 (주제도는 그룹 유지) */
  const thematicPanelGroups = useMemo(
    () =>
      thematicGroups
        .map((g) => ({
          ...g,
          layers: g.layers.filter((l) => thematicAvailableTableNames.has(l.tableName)),
        }))
        .filter((g) => g.layers.length > 0),
    [thematicGroups, thematicAvailableTableNames]
  );
  const thematicPanelLayers = useMemo(
    () => thematicPanelGroups.flatMap((g) => g.layers),
    [thematicPanelGroups]
  );
  const ownershipPanelLayers = useMemo(
    () =>
      ownershipGroups
        .flatMap((g) => g.layers)
        .filter((l) => ownershipAvailableTableNames.has(l.tableName))
        .map((l) => ({ tableName: l.tableName, layerName: l.layerName })),
    [ownershipGroups, ownershipAvailableTableNames]
  );

  const [geoserverLogLines, setGeoserverLogLines] = useState<string[]>([]);
  const { lines: consoleLines } = useConsoleCapture();
  const consoleLogRef = useRef<HTMLDivElement>(null);
  const backgroundPanelRef = useRef<HTMLDivElement>(null);
  const mapControlFixedRef = useRef<HTMLDivElement>(null);
  const mapControlOverlayRowRef = useRef<HTMLDivElement>(null);
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

  /** 우측 메뉴(버튼 열) 폭만 — 상하 분할 거터·방향 전환용.
   * 배경지도·레이어 선택 등 우측에서 뜨는 패널은 전부 오버레이 모달로 보고
   * 지도 가용폭·좌우/상하 전환에 넣지 않음. */
  useEffect(() => {
    const setPaddingRight = mapContext?.setMapPaddingRight;
    const fixed = mapControlFixedRef.current;
    if (!setPaddingRight || !fixed) return;

    const syncPaddingRight = () => {
      const menu = fixed.querySelector('[data-map-control-menu]');
      const leftEdge = menu
        ? menu.getBoundingClientRect().left
        : window.innerWidth - MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX;
      const next = Math.max(
        MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
        Math.ceil(window.innerWidth - leftEdge)
      );
      setPaddingRight((prev) => (prev === next ? prev : next));
    };

    syncPaddingRight();
    const ro = new ResizeObserver(syncPaddingRight);
    const menu = fixed.querySelector('[data-map-control-menu]');
    if (menu) ro.observe(menu);
    else ro.observe(fixed);
    window.addEventListener('resize', syncPaddingRight);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncPaddingRight);
    };
  }, [mapContext?.setMapPaddingRight, activeControls, extraControls]);

  // 마운트 시 저장된 맵 상태 복원 (버튼 활성화 + 배경지도 + 레이어 목록 + 상세 패널 체크박스)
  useEffect(() => {
    const state = loadPersistedMapState(projectName);
    if (state) {
      if (state.activeControls?.length) setActiveControls(state.activeControls);
      if (state.backgroundMap) setSelectedBackgroundMap(state.backgroundMap);
      if (state.visibleLayerNames?.length && mapContext?.setVisibleLayerNames) {
        // 하천점용 패널 전용 레이어는 복원하지 않음 (패널 없이 켜져 클릭 무반응 방지)
        mapContext.setVisibleLayerNames(
          new Set(state.visibleLayerNames.filter((n) => !isUsageDataAsWmsLayerId(n)))
        );
      }
      const jimokValid = (state.visibleJimokLayerNames ?? []).filter((t) =>
        JIMOK_LAYERS.some((l) => l.tableName === t)
      );
      if (state.visibleJimokLayerNames != null)
        setVisibleJimokLayerNames(jimokValid.length ? new Set(jimokValid) : new Set());
      const landownValid = (state.visibleLandownLayerNames ?? []).filter((t) =>
        OWNERSHIP_LAYERS.some((l) => l.tableName === t)
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
      const thematicValid = (state.visibleThematicLayerNames ?? []).filter((t) =>
        THEMATIC_MAP_LAYERS.some((l) => l.tableName === t)
      );
      if (state.visibleThematicLayerNames != null)
        setVisibleThematicLayerNames(
          thematicValid.length ? new Set(thematicValid) : new Set()
        );
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, [projectName]);

  // DB 부모 테이블 기준으로 가용한 주제도 자식만 선택·표시 유지
  useEffect(() => {
    if (thematicCatalogLoading) return;
    setVisibleThematicLayerNames((prev) => {
      if (prev == null) return prev;
      const next = new Set(
        [...prev].filter((t) => thematicAvailableTableNames.has(t))
      );
      if (next.size === prev.size && [...next].every((t) => prev.has(t))) return prev;
      return next;
    });
  }, [thematicCatalogLoading, thematicAvailableTableNames]);

  // 소유구분 가용 목록으로 선택 정리
  useEffect(() => {
    if (ownershipCatalogLoading) return;
    setVisibleLandownLayerNames((prev) => {
      if (prev == null) return prev;
      const next = new Set(
        [...prev].filter((t) => ownershipAvailableTableNames.has(t))
      );
      if (next.size === prev.size && [...next].every((t) => prev.has(t))) return prev;
      return next;
    });
  }, [ownershipCatalogLoading, ownershipAvailableTableNames]);

  // 건물·도로: tables.json·DB 미등록/무데이터 선택 제거
  useEffect(() => {
    if (buildingRoadCatalogLoading) return;
    setVisibleBuildingRoadLayerNames((prev) => {
      if (prev == null) return prev;
      const next = new Set(
        [...prev].filter((t) => buildingRoadAvailableTableNames.has(t))
      );
      if (next.size === prev.size && [...next].every((t) => prev.has(t))) return prev;
      return next;
    });
  }, [buildingRoadCatalogLoading, buildingRoadAvailableTableNames]);

  // 지적도: DB 무데이터 선택 제거
  useEffect(() => {
    if (cadastralCatalogLoading) return;
    setVisibleCadastralLayerNames((prev) => {
      if (prev == null) return prev;
      const next = new Set(
        [...prev].filter((t) => cadastralAvailableTableNames.has(t))
      );
      if (next.size === prev.size && [...next].every((t) => prev.has(t))) return prev;
      return next;
    });
  }, [cadastralCatalogLoading, cadastralAvailableTableNames]);

  // 지목: tables.json·DB 미등록/무데이터 선택 제거
  useEffect(() => {
    if (jimokCatalogLoading) return;
    setVisibleJimokLayerNames((prev) => {
      if (prev == null) return prev;
      const next = new Set(
        [...prev].filter((t) => jimokAvailableTableNames.has(t))
      );
      if (next.size === prev.size && [...next].every((t) => prev.has(t))) return prev;
      return next;
    });
  }, [jimokCatalogLoading, jimokAvailableTableNames]);

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

  // 지도분할 ON: 좌측 맵 클릭 시 배경 포커스 = primary
  useEffect(() => {
    const map = mapReady ? mapInstanceRef.current : null;
    if (!map || mapContext?.mapSplitSecondaryKind !== 'map') return;
    const onPointer = () => {
      mapContext?.setMapSplitBasemapFocus?.('primary');
    };
    map.getViewport().addEventListener('pointerdown', onPointer);
    return () => map.getViewport().removeEventListener('pointerdown', onPointer);
  }, [
    mapReady,
    mapInstanceRef,
    mapContext?.mapSplitSecondaryKind,
    mapContext?.setMapSplitBasemapFocus,
  ]);

  const handleBackgroundMapChange = (id: string) => {
    setSelectedBackgroundMap(id);
    if (mapContext?.mapSplitSecondaryKind === 'map') {
      mapContext?.setMapSplitSecondaryBackgroundId?.(id);
    }
  };

  const handleBackgroundMapLeftChange = (id: string) => {
    setSelectedBackgroundMap(id);
  };

  const handleBackgroundMapRightChange = (id: string) => {
    mapContext?.setMapSplitSecondaryBackgroundId?.(id);
  };

  // 배경 싱크를 다시 켜면 좌 배경을 우에 맞춤
  useEffect(() => {
    if (mapContext?.mapSplitSecondaryKind !== 'map') return;
    if (!(mapContext?.mapSplitBasemapSync ?? true)) return;
    mapContext?.setMapSplitSecondaryBackgroundId?.(selectedBackgroundMap);
  }, [
    mapContext?.mapSplitSecondaryKind,
    mapContext?.mapSplitBasemapSync,
    selectedBackgroundMap,
    mapContext?.setMapSplitSecondaryBackgroundId,
  ]);

  /** 지도분할 — 배경 동기화 OFF 전환 시 배경지도 패널 자동 열기 */
  const prevMapSplitBasemapSyncRef = useRef(mapContext?.mapSplitBasemapSync ?? true);
  useEffect(() => {
    const kind = mapContext?.mapSplitSecondaryKind;
    const sync = mapContext?.mapSplitBasemapSync ?? true;
    const wasSync = prevMapSplitBasemapSyncRef.current;
    prevMapSplitBasemapSyncRef.current = sync;

    if (kind !== 'map' || wasSync === sync || sync) return;

    setIsBackgroundPanelExiting(false);
    setIsAerialViewPanelExiting(false);
    setActiveControls((prev) => {
      const next = prev.filter((item) => item !== 'aerial-view');
      return next.includes('background-map') ? next : [...next, 'background-map'];
    });
  }, [mapContext?.mapSplitSecondaryKind, mapContext?.mapSplitBasemapSync]);

  const backgroundSplitSelect =
    mapContext?.mapSplitSecondaryKind === 'map' &&
    !(mapContext?.mapSplitBasemapSync ?? true)
      ? {
          leftValue: selectedBackgroundMap,
          rightValue:
            mapContext?.mapSplitSecondaryBackgroundId ?? selectedBackgroundMap,
          onLeftChange: handleBackgroundMapLeftChange,
          onRightChange: handleBackgroundMapRightChange,
        }
      : undefined;

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

  /** 부서업무 본표는 위, 패널에서 켠 보조 레이어(점사용료·타 점용 등)는 아래 */
  const wmsForceBottomLayerNames = useMemo(() => {
    const useFeeOpen = mapContext?.useFeePanelOpen === true;
    const usageOpen = mapContext?.usageDataAsPanelOpen === true;
    const occupationOpen = mapContext?.occupationLedgerPanelOpen === true;
    if (useFeeOpen) {
      return [
        USAGE_DATA_AS_WMS_LAYER_ID,
        USE_FEE_WATER_OCCUPATION_WMS_LAYER_ID,
        USE_FEE_ROAD_OCCUPATION_WMS_LAYER_ID,
        USE_FEE_PUBLIC_OCCUPATION_WMS_LAYER_ID,
      ];
    }
    if (usageOpen || occupationOpen) {
      return getAllUseFeeWmsLayerIds();
    }
    return [];
  }, [
    mapContext?.useFeePanelOpen,
    mapContext?.usageDataAsPanelOpen,
    mapContext?.occupationLedgerPanelOpen,
  ]);

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
      visibleThematicLayerNames:
        visibleThematicLayerNames != null ? Array.from(visibleThematicLayerNames) : null,
    }),
    [
      visibleJimokLayerNames,
      visibleLandownLayerNames,
      visibleCadastralLayerNames,
      visibleBuildingRoadLayerNames,
      visibleThematicLayerNames,
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
    layerGeometryTypes,
    undefined,
    mapContext?.occupationLedgerPanelOpen === true,
    wmsForceBottomLayerNames
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
    const tool =
      (MEASUREMENT_IDS.find((id) => activeControls.includes(id)) as
        | 'distance'
        | 'area'
        | 'altitude'
        | 'slope'
        | undefined) ?? null;
    mapContext?.setMapMeasureTool?.(tool);
    mapContext?.setMeasurementActive?.(tool != null && !resetMeasurementsPanelOpen);
  }, [
    activeControls,
    resetMeasurementsPanelOpen,
    mapContext?.setMeasurementActive,
    mapContext?.setMapMeasureTool,
  ]);

  useEffect(() => {
    mapContext?.setMapDrawInputSuspended?.(resetMeasurementsPanelOpen);
  }, [resetMeasurementsPanelOpen, mapContext?.setMapDrawInputSuspended]);

  // 레이어 목록 도형(사각형/다각형/원형) 그리기 — 좌측 맵 (우측은 MapSplitSecondaryMapInputs)
  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const layerRowGeomEdit = mapContext?.layerRowGeomEdit ?? null;
  useSpatialDrawOnMap(
    mapReady ? mapInstanceRef.current : null,
    mapReady,
    spatialDrawRequest,
    setSpatialDrawRequest,
    Boolean(layerRowGeomEdit) || resetMeasurementsPanelOpen
  );
  // 지적도 레이어 동기화 (activeControls + 선택 + DB 가용분만)
  useCadastralLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleCadastralLayerNames,
    cadastralCatalogLoading ? null : cadastralAvailableTableNames
  );
  // 건물·도로 레이어 동기화 (activeControls + 선택 + tables.json·DB 가용분만)
  useBuildingRoadLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleBuildingRoadLayerNames,
    buildingRoadCatalogLoading ? null : buildingRoadAvailableTableNames
  );
  // 기초구간 레이어 동기화 (activeControls → basic-section 레이어 visibility)
  useBasicSectionLayerSync(mapInstanceRef.current, mapReady, activeControls);
  // 지목 레이어 동기화 (activeControls + 선택 + tables.json·DB 가용분만)
  useJimokLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleJimokLayerNames,
    jimokCatalogLoading ? null : jimokAvailableTableNames
  );
  // 소유구분 레이어 동기화 (activeControls + 선택 + DB 가용 목록)
  useOwnershipLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleLandownLayerNames,
    ownershipCatalogLoading ? null : ownershipAvailableTableNames
  );
  // 주제도 레이어 동기화 (activeControls + 선택 + DB 부모 존재 가용 목록)
  useThematicMapLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleThematicLayerNames,
    thematicCatalogLoading ? null : thematicAvailableTableNames
  );

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
      const items = roadCctvOverlay?.items ?? [];
      const it = items.find((x) => x.key === key);
      setRoadCctvOverlay?.((prev) => (prev ? { ...prev, selectedKey: key } : null));
      const map = mapInstanceRef.current;
      if (map && it) {
        const c = fromLonLat([it.coordx, it.coordy]);
        map.getView().animate({
          center: c,
          zoom: Math.max(map.getView().getZoom() ?? 14, 14),
          duration: 350,
        });
      }
    },
    [setRoadCctvOverlay, roadCctvOverlay?.items]
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

  // 지도 클릭 → 도형 검색. 측정·도형 그리기·도형편집·CCTV·도로망 오버레이 픽 중에는 식별 비활성
  const { popupState, popupElRef, closePopup } = useFeatureIdentify(
    mapInstanceRef.current,
    mapReady,
    visibleLayerNames,
    roadCctvPanelOpen ||
      !!layerRowGeomEdit ||
      !!spatialDrawRequest ||
      roadNetworkOverlayPickActive ||
      activeControls.some((id) => MEASUREMENT_IDS.includes(id))
  );

  // 좌측 새 식별이 오면 우측 대기분 제거(좌측 우선)
  useEffect(() => {
    if (popupState != null) {
      mapContext?.setMapSplitIdentifyPopup?.(null);
    }
  }, [popupState, mapContext]);

  // 우측 분할지도 식별 → 좌측과 동일 파이프라인
  const mapSplitIdentifyPopup = mapContext?.mapSplitIdentifyPopup ?? null;
  const identifyIntakePopup = mapSplitIdentifyPopup ?? popupState;

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
            // 지적 jibun은 「1-3」「1-3잡」처럼 짧은 경우가 많음 — 전체 주소는 브이월드 역지오코딩 결과를 우선
            const parcelJibunLooksFull =
              parcelJibun.length >= 8 &&
              /(도|특별|광역|자치)/u.test(parcelJibun) &&
              /(읍|면|동|리)/u.test(parcelJibun);
            setAddressInfoDetail((prev) =>
              prev
                ? {
                    ...prev,
                    pnu: prev.pnu ?? (pnu || null),
                    jibun: prev.jibun ?? (parcelJibunLooksFull ? parcelJibun : null),
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
      getAddressFromCoord(lon, lat, { apiKey })
        .then(async (result) => {
          let roadText = result?.road?.trim() || '';
          if (!roadText) {
            const roadOnly = await getAddressFromCoord(lon, lat, { apiKey, type: 'ROAD' });
            roadText = roadOnly?.road?.trim() || '';
          }
          // 역지오코딩 ROAD=NOT_FOUND 인 경우 — 지번으로 검색 API에서 road 보강
          if (!roadText) {
            const jibunHint = result?.jibun?.trim() || '';
            if (jibunHint) {
              roadText =
                (await findRoadAddressByJibun(jibunHint, { apiKey, lon, lat }))?.trim() || '';
            }
          }
          setAddressInfoDetail((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  pnu: prev.pnu ?? (result?.pnu?.trim() || null),
                  // 브이월드 법정동 전체 주소를 지적 짧은 지번보다 우선
                  jibun: result?.jibun?.trim() || prev.jibun || null,
                  road: roadText || prev.road || null,
                  buildingName: result?.buildingName?.trim() || prev.buildingName || null,
                }
              : null
          );
        })
        .catch(() => {
          setAddressInfoDetail((prev) => (prev ? { ...prev, loading: false } : null));
        });
    },
    [mapContext?.setAddressInfoDetail, mapContext?.vworldApiKey, addressInfoDetail]
  );
  useMapContextMenu(mapInstanceRef.current, mapReady, handleContextMenu);

  const router = useRouter();
  const searchParams = useSearchParams();
  const systemKey = searchParams.get('system') ?? '';
  const mapControlGroups = useMemo((): MapControlGroup[] => {
    if (systemKey === 'uav') return defaultMapControlGroups;
    return defaultMapControlGroups.map((g) =>
      g.id === 'base-maps'
        ? { ...g, items: g.items.filter((item) => item.id !== 'aerial-view') }
        : g
    );
  }, [systemKey]);

  const aerialViewPanelOpen =
    activeControls.includes('aerial-view') || isAerialViewPanelExiting;
  useAerialViewCheckedMarkers({
    enabled: aerialViewCheckedIds.size > 0,
    checkedUnitIds: aerialViewCheckedIds,
  });
  useAerialOrthoCheckedTiles({
    enabled: aerialViewCheckedIds.size > 0,
    checkedUnitIds: aerialViewCheckedIds,
  });

  const totalIdentifyCount = identifyIntakePopup?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0;

  // 지도 클릭 시 목록창(팝업) 없이 바로 '지도에서 선택된 항목' 데이터 패널로 열기
  // (좌측 popupState · 우측 mapSplitIdentifyPopup 공통)
  // mapContext는 ref로만 읽음 — options/visibleLayer 갱신으로 effect가 재실행·cancel 되지 않게
  useEffect(() => {
    if (totalIdentifyCount === 0 || !identifyIntakePopup?.results?.length) return;
    if (!mapContextRef.current) return;
    let cancelled = false;

    const run = async () => {
      const withFeat = identifyIntakePopup.results.filter((r) => r.features.length > 0);
      if (withFeat.length === 0) return;

      const clearIdentifyIntake = () => {
        closePopup();
        mapContextRef.current?.setMapSplitIdentifyPopup?.(null);
      };

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

      // await 이후 최신 panelOpen / setters
      const mapContext = mapContextRef.current;
      if (!mapContext || cancelled) return;

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
              clearIdentifyIntake();
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
                clearIdentifyIntake();
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
            clearIdentifyIntake();
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
              clearIdentifyIntake();
              return;
            }
            mapContext.setRiverBasicPlanDrawingFromMap({ fileLayer, fileKey });
          } catch (e) {
            if (cancelled) return;
            window.alert(e instanceof Error ? e.message : '도면 첨부 정보를 불러오지 못했습니다.');
          }
          clearIdentifyIntake();
          return;
        }
      }

      /** 하천점용: usage_data_as / solo / mgj → 목록·상세 선택 */
      if (
        mapContext?.usageDataAsPanelOpen &&
        mapContext.applyUsageDataAsMapPickRef
      ) {
        const usageLayerSet = new Set(
          USAGE_DATA_AS_WMS_LAYER_IDS.map((id) => id.toLowerCase())
        );
        const parentTable = USAGE_DATA_AS_WMS_LAYER_ID.toLowerCase();
        const ranked = withFeat
          .map((r, wi) => {
            const tn = String(r.tableName ?? '')
              .trim()
              .toLowerCase();
            if (!usageLayerSet.has(tn) || r.features.length === 0) return null;
            // 클릭 도형 중앙 맞춤: 필지·물건지(작은 도형)를 부모보다 우선
            const rank = tn === 'usage_data_as_solo' ? 0 : tn === 'usage_data_as_mgj' ? 1 : 2;
            return { wi, rank, layer: r, tn };
          })
          .filter((x): x is NonNullable<typeof x> => x != null)
          .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.wi - b.wi));
        if (ranked.length > 0) {
          const pushOverlap = (
            overlapOptions: {
              value: string;
              label: string;
              extent3857?: [number, number, number, number] | null;
            }[],
            seen: Set<string>,
            layer: (typeof ranked)[number]['layer']
          ) => {
            for (const feat of layer.features) {
              const consCode = pickIdentifyConsCode(feat?.data);
              if (!consCode || seen.has(consCode)) continue;
              seen.add(consCode);
              const permit =
                pickIdentifyField(feat?.data, 'perm_num') ||
                pickIdentifyField(feat?.data, 'permit_no') ||
                pickIdentifyField(feat?.data, 'usage_name') ||
                consCode;
              overlapOptions.push({
                value: consCode,
                label: permit,
                extent3857: pickIdentifyExtent3857(feat?.data),
              });
            }
          };

          // select 후보: 본표(겹친 점용) 우선 — 자식만 있으면 전체 ranked
          const overlapOptions: {
            value: string;
            label: string;
            extent3857?: [number, number, number, number] | null;
          }[] = [];
          const seen = new Set<string>();
          const parentRanked = ranked.filter((x) => x.tn === parentTable);
          for (const { layer } of parentRanked.length > 0 ? parentRanked : ranked) {
            pushOverlap(overlapOptions, seen, layer);
          }

          // 상세 오픈·줌: 필지/물건지 우선(작은 도형)
          let primary: (typeof overlapOptions)[number] | null = null;
          const primarySeen = new Set<string>();
          const primaryOpts: typeof overlapOptions = [];
          for (const { layer } of ranked) {
            pushOverlap(primaryOpts, primarySeen, layer);
          }
          primary = primaryOpts[0] ?? overlapOptions[0] ?? null;

          if (!primary) {
            if (!cancelled) {
              window.alert('클릭한 점용 도형의 대장번호(cons_code)를 읽을 수 없습니다.');
            }
            clearIdentifyIntake();
            return;
          }
          // 목록 pick 핸들러보다 먼저 옵션 확정 (핸들러가 opts 누락 시 덮어쓰지 않도록)
          mapContext.setUsageDataAsMapHitOptions?.(
            overlapOptions.length > 1 ? overlapOptions : []
          );
          mapContext.applyUsageDataAsMapPickRef.current?.({
            consCode: primary.value,
            extent3857: primary.extent3857,
            overlapOptions,
          });
          clearIdentifyIntake();
          return;
        }
      }

      /** 공통 점용대장: occupationLedger* ser_eng → 목록·상세 선택 */
      if (
        mapContext?.occupationLedgerPanelOpen &&
        mapContext.applyOccupationLedgerMapPickRef
      ) {
        const openedRaw = searchParams.get('opened')?.split(',').filter(Boolean) || [];
        const serEng = findOpenedOccupationLedgerSerEng(openedRaw);
        const binding = getOccupationLedgerBinding({ serEng });
        if (binding) {
          const layerIds = getOccupationLedgerWmsLayerIds(binding);
          const layerSet = new Set(layerIds);
          const jijuk = binding.jijukTable.toLowerCase();
          const mgj = binding.mgjTable.toLowerCase();
          const ranked = withFeat
            .map((r, wi) => {
              const tn = String(r.tableName ?? '')
                .trim()
                .toLowerCase();
              if (!layerSet.has(tn) || r.features.length === 0) return null;
              const rank = tn === jijuk ? 0 : tn === mgj ? 1 : 2;
              return { wi, rank, layer: r };
            })
            .filter((x): x is NonNullable<typeof x> => x != null)
            .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.wi - b.wi));
          if (ranked.length > 0) {
            const keyField = binding.fields.keyField;
            const overlapOptions: {
              value: string;
              label: string;
              extent3857?: [number, number, number, number] | null;
            }[] = [];
            const seen = new Set<string>();
            for (const { layer } of ranked) {
              for (const feat of layer.features) {
                const rowKey = pickIdentifyField(feat?.data, keyField);
                if (!rowKey || seen.has(rowKey)) continue;
                seen.add(rowKey);
                const permit =
                  pickIdentifyField(feat?.data, 'permit_no') ||
                  pickIdentifyField(feat?.data, 'work_name') ||
                  rowKey;
                overlapOptions.push({
                  value: rowKey,
                  label: permit,
                  extent3857: pickIdentifyExtent3857(feat?.data),
                });
              }
            }
            const first = overlapOptions[0];
            if (!first) {
              if (!cancelled) {
                window.alert('클릭한 점용 도형의 대장번호를 읽을 수 없습니다.');
              }
              clearIdentifyIntake();
              return;
            }
            mapContext.applyOccupationLedgerMapPickRef.current?.({
              rowKey: first.value,
              extent3857: first.extent3857,
              overlapOptions,
            });
            clearIdentifyIntake();
            return;
          }
        }
      }

      /** 점사용료: water|road|public_ngl_fee_list → 목록·상세 선택 */
      if (mapContext?.useFeePanelOpen && mapContext.applyUseFeeMapPickRef) {
        const system = String(searchParams.get('system') ?? '').trim();
        const feeLid = getUseFeeWmsLayerId(system || 'river').toLowerCase();
        const feeHit = withFeat.find((r) => {
          const tn = String(r.tableName ?? '')
            .trim()
            .toLowerCase();
          return tn === feeLid && r.features.length > 0;
        });
        if (feeHit) {
          const overlapOptions: {
            value: string;
            label: string;
            extent3857?: [number, number, number, number] | null;
          }[] = [];
          const seen = new Set<string>();
          for (const feat of feeHit.features) {
            const feeId = pickIdentifyField(feat?.data, 'id');
            if (!feeId || seen.has(feeId)) continue;
            seen.add(feeId);
            const ledger =
              pickIdentifyField(feat?.data, 'ledger_no') ||
              pickIdentifyField(feat?.data, 'ledgerNo') ||
              feeId;
            overlapOptions.push({
              value: feeId,
              label: ledger,
              extent3857: pickIdentifyExtent3857(feat?.data),
            });
          }
          const first = overlapOptions[0];
          if (!first) {
            if (!cancelled) {
              window.alert('클릭한 점사용료 도형의 번호를 읽을 수 없습니다.');
            }
            clearIdentifyIntake();
            return;
          }
          mapContext.applyUseFeeMapPickRef.current?.({
            id: first.value,
            extent3857: first.extent3857,
            overlapOptions,
          });
          clearIdentifyIntake();
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
            clearIdentifyIntake();
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
          clearIdentifyIntake();
          return;
        }
      }

      if (hitOpenScan) {
        if (cancelled) return;
        window.alert('하천 기본계획 패널이 열린 상태입니다. 스캔 보기는 추후 구현 예정입니다.');
        clearIdentifyIntake();
        return;
      }

      const isDataQueryMenu = openedTokens.includes('standardList');
      if (!isDataQueryMenu || mapContext.dataQueryMapPickEnabled === false) {
        clearIdentifyIntake();
        return;
      }

      const layer = withFeat.find((r) => r.isSplitLayer) ?? withFeat[0];
      if (!layer) return;
      const feature = totalIdentifyCount === 1 ? layer.features[0].data : null;
      mapContext.setIdentifyResultList(identifyIntakePopup);
      mapContext.setIdentifySelectedRow(feature);
      const nextOpened = rawOpened.includes('listView') ? rawOpened : [...rawOpened, 'listView'];
      const next = new URLSearchParams(Array.from(searchParams.entries()));
      next.set('opened', nextOpened.join(','));
      next.set('dataTable', layer.tableName);
      next.delete('dataKey');
      router.push(`/map?${next.toString()}`);
      clearIdentifyIntake();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [totalIdentifyCount, identifyIntakePopup, searchParams, router, closePopup]);

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

  useEffect(() => {
    if (!isAerialViewPanelExiting) return;
    const t = setTimeout(() => setIsAerialViewPanelExiting(false), 400);
    return () => clearTimeout(t);
  }, [isAerialViewPanelExiting]);

  useEffect(() => {
    if (!isResetPanelExiting) return;
    const t = setTimeout(() => setIsResetPanelExiting(false), 400);
    return () => clearTimeout(t);
  }, [isResetPanelExiting]);

  const closeResetMeasurementsPanel = useCallback(() => {
    setIsResetPanelExiting(true);
    setActiveControls((prev) => prev.filter((item) => item !== 'reset-measurements'));
  }, []);

  useEffect(() => {
    if (mapContext?.mapSplitSecondaryKind === 'map') return;
    setActiveControls((prev) => prev.filter((item) => item !== 'reset-measurements'));
    setIsResetPanelExiting(false);
  }, [mapContext?.mapSplitSecondaryKind]);

  // 도형 그리기 시작 시 초기화 패널 닫기 (측정·도형 입력과 배타)
  useEffect(() => {
    if (!spatialDrawRequest && !layerRowGeomEdit) return;
    if (!resetMeasurementsPanelOpen) return;
    closeResetMeasurementsPanel();
  }, [
    spatialDrawRequest,
    layerRowGeomEdit,
    resetMeasurementsPanelOpen,
    closeResetMeasurementsPanel,
  ]);

  // 인터랙션 관리 (draw, snap 등)
  useMapInteractions(mapInstanceRef.current, activeInteractions);

  // 측정 기능
  const { clearMeasurements } = useMeasure(
    mapInstanceRef.current,
    resetMeasurementsPanelOpen ? null : measureType,
    (result) => {
      console.log('측정 완료:', result);
    }
  );

  const altitudeActive =
    !resetMeasurementsPanelOpen && activeControls.includes('altitude');
  const stopAltitudeMeasure = useCallback(() => {
    setActiveControls((prev) => prev.filter((id) => id !== 'altitude'));
  }, []);
  const { clearAltitudeMarkers } = useAltitudeMeasure(
    mapInstanceRef.current,
    altitudeActive,
    stopAltitudeMeasure
  );

  const { clearSlopeMeasurements } = useSlopeMeasure(
    mapInstanceRef.current,
    !resetMeasurementsPanelOpen && activeControls.includes('slope')
  );

  const clearAllMeasurements = useCallback(() => {
    clearMeasurements();
    clearAltitudeMarkers();
    clearSlopeMeasurements();
  }, [clearMeasurements, clearAltitudeMarkers, clearSlopeMeasurements]);

  useEffect(() => {
    const onReset = (e: Event) => {
      const target = parseMapMeasurementsResetTarget(e);
      if (!target || target === 'secondary') return;
      if (target === 'both') {
        setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
      }
      clearAllMeasurements();
    };
    window.addEventListener(MAP_MEASUREMENTS_RESET_EVENT, onReset);
    return () => window.removeEventListener(MAP_MEASUREMENTS_RESET_EVENT, onReset);
  }, [clearAllMeasurements]);

  const clearMapDrawInteractions = useCallback(
    (except?: MapDrawInteractionKind) => {
      if (except !== 'measure') {
        setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
        clearAllMeasurements();
      }
      if (except !== 'spatialSearch') {
        setSpatialDrawRequest?.(null);
      }
    },
    [clearAllMeasurements, setSpatialDrawRequest]
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

  /** 패널 등에서 지도 컨트롤 ON/OFF (예: 점사용료 이력 → 공시지가, 점용(프) → 지적도) */
  useEffect(() => {
    const onSet = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string; active?: boolean }>).detail;
      const id = detail?.id?.trim();
      if (!id) return;
      const active = detail.active === true;
      if (active && id === 'cadastral') {
        setVisibleCadastralLayerNames((prev) => {
          if (prev != null && prev.size > 0) return prev;
          return new Set(
            CADASTRAL_LAYERS.map((l) => l.tableName).filter((t) =>
              cadastralAvailableTableNames.has(t)
            )
          );
        });
      }
      setActiveControls((prev) => {
        const has = prev.includes(id);
        if (active) return has ? prev : [...prev, id];
        return has ? prev.filter((item) => item !== id) : prev;
      });
    };
    window.addEventListener('ggnr-map-control-set', onSet);
    return () => window.removeEventListener('ggnr-map-control-set', onSet);
  }, [cadastralAvailableTableNames]);

  /** 목록 패널 열기/닫기. 최초(null)면 빈 선택으로 열고, 기존 선택은 유지한다. */
  const togglePanelLayer = (id: PanelLayerId) => {
    const opening = openSubPanel !== id;
    if (opening) {
      // 배경지도·드론영상과 배타. 퇴장 애니와 목록 slide-in이 겹치면 두 번 깜빡이므로 즉시 닫음
      setIsBackgroundPanelExiting(false);
      setIsAerialViewPanelExiting(false);
      setActiveControls((prev) =>
        prev.filter((x) => x !== 'background-map' && x !== 'aerial-view')
      );
    }
    setOpenSubPanel((prev) => (prev === id ? null : id));
    if (id === 'land-category') {
      if (visibleJimokLayerNames == null) {
        setVisibleJimokLayerNames(new Set());
        setActiveControls((prev) => prev.filter((x) => x !== 'land-category'));
      }
    } else if (id === 'ownership') {
      if (visibleLandownLayerNames == null) {
        setVisibleLandownLayerNames(new Set());
        setActiveControls((prev) => prev.filter((x) => x !== 'ownership'));
      }
    } else if (id === 'cadastral') {
      if (visibleCadastralLayerNames == null) {
        setVisibleCadastralLayerNames(new Set());
        setActiveControls((prev) => prev.filter((x) => x !== 'cadastral'));
      }
    } else if (id === 'building-road') {
      if (visibleBuildingRoadLayerNames == null) {
        setVisibleBuildingRoadLayerNames(new Set());
        setActiveControls((prev) => prev.filter((x) => x !== 'building-road'));
      }
    } else if (id === 'thematic-map') {
      if (visibleThematicLayerNames == null) {
        setVisibleThematicLayerNames(new Set());
        setActiveControls((prev) => prev.filter((x) => x !== 'thematic-map'));
      }
    }
  };

  const handleItemRightClick = (id: string) => {
    // 지적도: 우클릭 비활성 (좌클릭으로만 목록 패널)
    if (id === 'cadastral') return;
    if (isPanelLayerId(id)) {
      togglePanelLayer(id);
      return;
    }
    if (id === 'background-map') {
      if (activeControls.includes('background-map')) {
        setIsBackgroundPanelExiting(true);
        setActiveControls((prev) => prev.filter((item) => item !== 'background-map'));
      } else {
        setOpenSubPanel(null);
        setIsAerialViewPanelExiting(false);
        setActiveControls((prev) => {
          const next = prev.filter((item) => item !== 'aerial-view');
          return next.includes('background-map') ? next : [...next, 'background-map'];
        });
      }
      return;
    }
    if (id === 'aerial-view') {
      if (activeControls.includes('aerial-view')) {
        setIsAerialViewPanelExiting(true);
        setActiveControls((prev) => prev.filter((item) => item !== 'aerial-view'));
      } else {
        setOpenSubPanel(null);
        setIsBackgroundPanelExiting(false);
        setActiveControls((prev) => {
          const next = prev.filter((item) => item !== 'background-map');
          return next.includes('aerial-view') ? next : [...next, 'aerial-view'];
        });
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

    // 초기화: 지도분할 시 우측 확장 패널, 아니면 즉시 좌측 측정 초기화
    if (id === 'reset-measurements') {
      if (mapContext?.mapSplitSecondaryKind === 'map') {
        if (isActive) {
          closeResetMeasurementsPanel();
        } else {
          // 측정·도형 입력과 배타 — 패널 열 때 직접 입력 모드 해제
          setSpatialDrawRequest?.(null);
          setIsResetPanelExiting(false);
          setActiveControls((prev) => {
            const withoutMeasure = prev.filter((item) => !MEASUREMENT_IDS.includes(item));
            return withoutMeasure.includes('reset-measurements')
              ? withoutMeasure
              : [...withoutMeasure, 'reset-measurements'];
          });
        }
        return;
      }
      setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
      clearAllMeasurements();
      return;
    }

    // 액션 전용 버튼은 상태 변경 없이 액션만 실행
    if (ACTION_ONLY_IDS.includes(id)) {
      if (id === 'shooting-request') {
        // 신청서 모달만 — 왼쪽 촬영요청 목록 패널은 열지 않음
        const current = new URLSearchParams(Array.from(searchParams.entries()));
        current.set('shotForm', 'new');
        router.push(`/map?${current.toString()}`);
        return;
      }
      if (id === 'print') {
        const map = mapInstanceRef.current;
        const view = map?.getView();
        const center = view?.getCenter();
        const zoom = view?.getZoom();
        if (!map || !center || zoom == null) return;
        const layerControls = [
          'cadastral',
          'building-road',
          'basic-section',
          'land-category',
          'ownership',
          'thematic-map',
        ];
        setPrintSnapshot({
          center: [center[0], center[1]],
          zoom,
          backgroundMapId: selectedBackgroundMap,
          visibleLayerNames: Array.from(visibleLayerNames),
          activeLayerControls: activeControls.filter((c) => layerControls.includes(c)),
          visibleCadastralLayerNames: visibleCadastralLayerNames
            ? Array.from(visibleCadastralLayerNames)
            : null,
          visibleBuildingRoadLayerNames: visibleBuildingRoadLayerNames
            ? Array.from(visibleBuildingRoadLayerNames)
            : null,
          visibleJimokLayerNames: visibleJimokLayerNames
            ? Array.from(visibleJimokLayerNames)
            : null,
          visibleLandownLayerNames: visibleLandownLayerNames
            ? Array.from(visibleLandownLayerNames)
            : null,
          visibleThematicLayerNames: visibleThematicLayerNames
            ? Array.from(visibleThematicLayerNames)
            : null,
        });
        setPrintOpen(true);
      }
      return;
    }

    // 지목·소유구분·지적도·건물도로·주제도: 좌클릭 = 빈/유지 목록 패널
    if (isPanelLayerId(id)) {
      togglePanelLayer(id);
      return;
    }

    setOpenSubPanel(null);

    if (MULTI_SELECT_IDS.includes(id)) {
      setActiveControls((prev) => {
        if (isActive) return prev.filter((item) => item !== id);
        const exclusivePeer = (MAP_SPLIT_EXCLUSIVE_IDS as readonly string[]).includes(id)
          ? MAP_SPLIT_EXCLUSIVE_IDS.filter((x) => x !== id)
          : [];
        const withoutPeer =
          exclusivePeer.length > 0
            ? prev.filter((item) => !exclusivePeer.includes(item as (typeof MAP_SPLIT_EXCLUSIVE_IDS)[number]))
            : prev;
        return withoutPeer.includes(id) ? withoutPeer : [...withoutPeer, id];
      });
    } else if (id === 'background-map' || id === 'aerial-view') {
      // 배경지도·드론영상: 서로 배타 + 지적도 등 목록 패널과도 배타
      const peer = id === 'background-map' ? 'aerial-view' : 'background-map';
      if (isActive) {
        if (id === 'background-map') setIsBackgroundPanelExiting(true);
        else setIsAerialViewPanelExiting(true);
        setActiveControls((prev) => prev.filter((item) => item !== id));
      } else {
        if (id === 'background-map') setIsAerialViewPanelExiting(false);
        else setIsBackgroundPanelExiting(false);
        setActiveControls((prev) => {
          const withoutPeer = prev.filter((item) => item !== peer);
          return withoutPeer.includes(id) ? withoutPeer : [...withoutPeer, id];
        });
      }
    } else {
      // 단일 선택 항목: 배타적 토글
      // 측정 도구는 서로 배타적 (거리/면적 동시 선택 불가) · 초기화 패널과도 배타
      if (MEASUREMENT_IDS.includes(id)) {
        if (!isActive && activeControls.includes('reset-measurements')) {
          setIsResetPanelExiting(true);
        }
        setActiveControls((prev) => {
          const withoutMeasurements = prev.filter((item) => !MEASUREMENT_IDS.includes(item));
          if (isActive) return withoutMeasurements;
          return [
            ...withoutMeasurements.filter((item) => item !== 'reset-measurements'),
            id,
          ];
        });
      } else {
        setActiveControls((prev) => {
          const withoutSingle = prev.filter(
            (item) => MULTI_SELECT_IDS.includes(item) || item === 'reset-measurements'
          );
          return isActive ? withoutSingle : [...withoutSingle, id];
        });
      }
    }
  };

  /** 측정·도형 그리기 중에는 우측 목록 패널 호버/클릭 끄기 (지도 입력 우선) */
  const overlayListPointerClass =
    mapContext?.measurementActive || spatialDrawRequest || layerRowGeomEdit
      ? 'pointer-events-none'
      : 'pointer-events-auto';

  const renderMapControlItemPanel = useCallback(
    (itemId: string) => {
      if (itemId !== 'reset-measurements' || !resetMeasurementsPanelVisible) return null;
      return (
        <div
          data-map-control-expand-panel
          className={
            isResetPanelExiting
              ? 'pointer-events-auto animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]'
              : 'pointer-events-auto animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]'
          }
        >
          <MapSplitResetMeasurementsPanel onClose={closeResetMeasurementsPanel} />
        </div>
      );
    },
    [resetMeasurementsPanelVisible, isResetPanelExiting, closeResetMeasurementsPanel]
  );

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full bg-black [&_.ol-viewport]:bg-black" />

      <LayerRowGeomEditHandler centerPixel={centerPixel} />

      {/* 지도 중심점 마크 — 거리뷰(로드뷰) ON 시 숨김 */}
      {!activeControls.includes('street-view') && (
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
      )}

      {/* 오른쪽 맵 컨트롤 패널 — 분할 시에도 화면 오른쪽 고정
          래퍼는 pointer-events-none: 배경지도 등 하위 패널이 버튼열보다 짧을 때
          flex 행의 빈 영역이 지도 클릭·측정·그리기를 가로채지 않도록 함 */}
      <div
        ref={mapControlFixedRef}
        className="pointer-events-none fixed right-4 z-10 flex flex-col items-end gap-3"
        style={{ top: '60px' }}
      >
        <div ref={mapControlOverlayRowRef} className="pointer-events-none flex items-start gap-3">
          {/* 배경지도 선택 패널 (등장/퇴장 애니메이션, duration 400ms) */}
          {(activeControls.includes('background-map') || isBackgroundPanelExiting) && (
            <div
              ref={backgroundPanelRef}
              data-map-control-expand-panel
              className={
                isBackgroundPanelExiting
                  ? `${overlayListPointerClass} animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]`
                  : `${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]`
              }
            >
              <BackgroundMapSelector
                groups={backgroundMapGroups}
                value={selectedBackgroundMap}
                onValueChange={handleBackgroundMapChange}
                splitSelect={backgroundSplitSelect}
              />
            </div>
          )}

          {aerialViewPanelOpen && (
            <div
              data-map-control-expand-panel
              className={
                isAerialViewPanelExiting
                  ? `${overlayListPointerClass} animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]`
                  : `${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]`
              }
            >
              <AerialViewLayerPanel
                checkedUnitIds={aerialViewCheckedIds}
                onCheckedChange={setAerialViewCheckedIds}
                onClose={() => {
                  setIsAerialViewPanelExiting(true);
                  setActiveControls((prev) => prev.filter((x) => x !== 'aerial-view'));
                }}
              />
            </div>
          )}

          {openSubPanel === 'land-category' && (
            <div data-map-control-expand-panel className={`${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto`}>
              <JimokLandownLayerSelector
                title="지목"
                layers={jimokPanelLayers}
                selectedTableNames={visibleJimokLayerNames ?? new Set()}
                onSelectionChange={(next) => {
                  const filtered = new Set(
                    [...next].filter((t) => jimokAvailableTableNames.has(t))
                  );
                  setVisibleJimokLayerNames(filtered);
                  setActiveControls((prev) =>
                    filtered.size === 0
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
            <div data-map-control-expand-panel className={`${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto`}>
              <JimokLandownLayerSelector
                title="소유구분"
                layers={ownershipPanelLayers}
                selectedTableNames={visibleLandownLayerNames ?? new Set()}
                onSelectionChange={(next) => {
                  const filtered = new Set(
                    [...next].filter((t) => ownershipAvailableTableNames.has(t))
                  );
                  setVisibleLandownLayerNames(filtered);
                  setActiveControls((prev) =>
                    filtered.size === 0
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
            <div data-map-control-expand-panel className={`${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto`}>
              <JimokLandownLayerSelector
                title="지적도"
                layers={cadastralPanelLayers}
                selectedTableNames={visibleCadastralLayerNames ?? new Set()}
                onSelectionChange={(next: Set<string>) => {
                  const filtered = new Set(
                    [...next].filter((t) => cadastralAvailableTableNames.has(t))
                  );
                  setVisibleCadastralLayerNames(filtered);
                  setActiveControls((prev) =>
                    filtered.size === 0
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
            <div data-map-control-expand-panel className={`${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto`}>
              <JimokLandownLayerSelector
                title="건물·도로"
                layers={buildingRoadPanelLayers}
                selectedTableNames={visibleBuildingRoadLayerNames ?? new Set()}
                onSelectionChange={(next: Set<string>) => {
                  const filtered = new Set(
                    [...next].filter((t) => buildingRoadAvailableTableNames.has(t))
                  );
                  setVisibleBuildingRoadLayerNames(filtered);
                  setActiveControls((prev) =>
                    filtered.size === 0
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
            <div data-map-control-expand-panel className={`${overlayListPointerClass} animate-in fade-in-0 slide-in-from-right-4 duration-[400ms] h-fit max-h-[calc(100vh-30px)] overflow-y-auto`}>
              <ThematicMapLayerSelector
                title="주제도"
                groups={thematicPanelGroups}
                selectedTableNames={visibleThematicLayerNames ?? new Set()}
                onSelectionChange={(next) => {
                  const filtered = new Set(
                    [...next].filter((t) => thematicAvailableTableNames.has(t))
                  );
                  setVisibleThematicLayerNames(filtered);
                  setActiveControls((prev) =>
                    filtered.size === 0
                      ? prev.filter((x) => x !== 'thematic-map')
                      : prev.includes('thematic-map')
                        ? prev
                        : [...prev, 'thematic-map']
                  );
                }}
                onClose={() => setOpenSubPanel(null)}
              />
            </div>
          )}

          <div className="pointer-events-auto" data-map-control-menu>
            <MapControlPanel
              groups={mapControlGroups}
              activeIds={
                openSubPanel && !activeControls.includes(openSubPanel)
                  ? [...activeControls, openSubPanel]
                  : activeControls
              }
              onItemClick={handleControlClick}
              onItemRightClick={handleItemRightClick}
              extraAfterFirstGroup={extraControls}
              renderItemPanel={renderMapControlItemPanel}
            />
          </div>
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

      <MapPrintModal
        open={printOpen}
        onClose={() => {
          setPrintOpen(false);
          setPrintSnapshot(null);
        }}
        snapshot={printSnapshot}
        backgroundMapGroups={backgroundMapGroups}
      />
    </div>
  );
}
