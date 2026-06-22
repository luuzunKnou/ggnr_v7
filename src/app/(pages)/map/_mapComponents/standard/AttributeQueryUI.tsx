'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { call } from '@/lib/api';
import {
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Pentagon,
  Plus,
  RefreshCw,
  Search,
  Database,
  SlidersHorizontal,
  Palette,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from '../MapContext';
import { scheduleAnimateMapToCenter3857 } from '../config/mapAutoNavigation';
import { canStartMapDrawInteraction } from '../mapDrawInteraction';
import { getLegendGraphicUrl } from '../layerFactory/serviceLayerFactory';
import { transformCoordinate } from '../services/coordinateService';
import type { IdentifyLayerResult } from '../hooks/useFeatureIdentify';

/** layer 스키마 테이블 목록 (DB 기준) */
type LayerSchemaTable = { schema: string; table: string };

interface LayerItemMeta {
  id: string;
  name: string;
  /** URL·WMS·표시 키 (분할 레이어는 define_table_name) */
  tableName: string;
  schema: string;
  /** PostGIS 조회용 테이블 (분할 시 부모) */
  physicalTableName: string;
  /** define_table_div_query → standardService에서 SQL 검증 */
  rowFilterSql: string | null;
}

interface LayerGroupMeta {
  id: string;
  name: string;
  layers: LayerItemMeta[];
}

type SpatialSearchTool = 'rectangle' | 'circle' | 'polygon' | 'emdRi' | 'dataSelect';

type AttributeQuerySearchTab = 'keyword' | 'shape' | 'boundary';

/** 도형검색 탭 — 읍면동·리는 행정경계 검색 탭 */
const SPATIAL_SHAPE_TOOLS: { id: SpatialSearchTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: Circle, label: '원형' },
  { id: 'dataSelect', icon: Database, label: '데이터 선택' },
];

const SPATIAL_SEARCH_FORM_STORAGE_KEY = 'ggnr_spatial_search_form';

/** 도형 그리기·데이터선택 — 동일 WKT로 `searchDefineLayersByGeometry` (시설관리 도형검색과 동일 헤더) */
const SPATIAL_SHAPE_SEARCH_HEADER = '도형검색 결과';

const KEYWORD_SEARCH_HEADER = '통합검색 결과';
const BOUNDARY_SEARCH_HEADER = '행정경계 검색 결과';

type BoundaryBadgeItem = { key: string; kind: 'emd' | 'ri'; code: string; label: string };

type PersistedSearchForm = {
  emdSelected?: string;
  riSelected?: string;
  boundaryBadges?: { kind: 'emd' | 'ri'; code: string; label: string }[];
  dataSelectTable?: string;
  dataSelectField?: string;
  dataSelectValue?: string;
};

function normalizeBoundaryBadgesFromPersist(p: PersistedSearchForm): BoundaryBadgeItem[] {
  const raw = p.boundaryBadges;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((x) => x && typeof x === 'object')
      .map((x): BoundaryBadgeItem => {
        const kind: 'emd' | 'ri' = x.kind === 'ri' ? 'ri' : 'emd';
        const code = String(x.code ?? '').trim();
        const label = String(x.label ?? code).trim() || code;
        return { key: `${kind}:${code}`, kind, code, label };
      })
      .filter((x) => x.code);
  }
  const legacyRi = String(p.riSelected ?? '').trim();
  if (legacyRi) return [{ key: `ri:${legacyRi}`, kind: 'ri', code: legacyRi, label: legacyRi }];
  const legacyEmd = String(p.emdSelected ?? '').trim();
  if (legacyEmd) return [{ key: `emd:${legacyEmd}`, kind: 'emd', code: legacyEmd, label: legacyEmd }];
  return [];
}

function loadPersistedSearchForm(): PersistedSearchForm {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SPATIAL_SEARCH_FORM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSearchForm;
    const boundaryBadges = Array.isArray(parsed.boundaryBadges)
      ? parsed.boundaryBadges.filter(
          (b): b is { kind: 'emd' | 'ri'; code: string; label: string } =>
            !!b &&
            typeof b === 'object' &&
            (b.kind === 'emd' || b.kind === 'ri') &&
            typeof b.code === 'string'
        )
      : undefined;
    return {
      emdSelected: typeof parsed.emdSelected === 'string' ? parsed.emdSelected : '',
      riSelected: typeof parsed.riSelected === 'string' ? parsed.riSelected : '',
      boundaryBadges,
      dataSelectTable: typeof parsed.dataSelectTable === 'string' ? parsed.dataSelectTable : '',
      dataSelectField: typeof parsed.dataSelectField === 'string' ? parsed.dataSelectField : '',
      dataSelectValue: typeof parsed.dataSelectValue === 'string' ? parsed.dataSelectValue : '',
    };
  } catch {
    return {};
  }
}

function savePersistedSearchForm(state: PersistedSearchForm) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SPATIAL_SEARCH_FORM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

type AttributeQueryUIProps = {
  activeTableName?: string;
  onOpenDataPanel?: (tableName: string) => void;
  onClearDataSelection?: () => void;
};

function totalFeatureHits(results: IdentifyLayerResult[]): number {
  return results.reduce((sum, r) => sum + r.features.length, 0);
}

function firstDefineTableFromResults(results: IdentifyLayerResult[]): string | null {
  for (const layer of results) {
    const t = String(layer.tableName ?? '').trim();
    if (t && layer.features.length > 0) return t;
  }
  return null;
}

export function AttributeQueryUI({ activeTableName, onOpenDataPanel, onClearDataSelection }: AttributeQueryUIProps) {
  const [searchTab, setSearchTab] = useState<AttributeQuerySearchTab>(() => {
    const p = loadPersistedSearchForm();
    if (p.dataSelectTable?.trim()) return 'shape';
    if (normalizeBoundaryBadgesFromPersist(p).length > 0) return 'boundary';
    return 'keyword';
  });
  const [keywordInput, setKeywordInput] = useState('');
  const [activeTool, setActiveTool] = useState<SpatialSearchTool>(() => {
    const p = loadPersistedSearchForm();
    if (p.dataSelectTable?.trim()) return 'dataSelect';
    if (normalizeBoundaryBadgesFromPersist(p).length > 0) return 'emdRi';
    return 'rectangle';
  });
  const [boundaryBadges, setBoundaryBadges] = useState<BoundaryBadgeItem[]>(() =>
    normalizeBoundaryBadgesFromPersist(loadPersistedSearchForm())
  );
  const [emdSelected, setEmdSelected] = useState('');
  const [riSelected, setRiSelected] = useState('');
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([]);
  const [dataSelectTable, setDataSelectTable] = useState('');
  const [dataSelectField, setDataSelectField] = useState('');
  const [dataSelectValue, setDataSelectValue] = useState('');
  const [dataSelectTableOptions, setDataSelectTableOptions] = useState<string[]>([]);
  const [dataSelectFieldOptions, setDataSelectFieldOptions] = useState<string[]>([]);
  const [dataSelectValueOptions, setDataSelectValueOptions] = useState<string[]>([]);
  /** 필드명 → 한글명 (config defineLayer/fields) */
  const [dataSelectFieldLabels, setDataSelectFieldLabels] = useState<Record<string, string>>({});
  /** 값(코드) → 한글명 (config defineLayer/codes, CODE 타입 필드용) */
  const [dataSelectValueLabels, setDataSelectValueLabels] = useState<Record<string, string>>({});
  /** layer 스키마 테이블 목록 (DB geometry_columns 기준) */
  const [layerSchemaTables, setLayerSchemaTables] = useState<LayerSchemaTable[]>([]);
  const [layerGroups, setLayerGroups] = useState<LayerGroupMeta[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [layerTotals, setLayerTotals] = useState<Record<string, number>>({});
  const [failedLegendLayers, setFailedLegendLayers] = useState<Set<string>>(new Set());
  /** 도형검색 API(searchDefineLayersByGeometry) 진행 중 — 시설관리 도형검색과 동일 UX */
  const [geometrySearchLoading, setGeometrySearchLoading] = useState(false);
  const onLegendError = useCallback((tableName: string) => {
    setFailedLegendLayers((prev) => new Set(prev).add(tableName));
  }, []);
  const mapContext = useMapContext();

  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt;
  const setSpatialFilteredLayerNames = mapContext?.setSpatialFilteredLayerNames;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const spatialFilteredLayerNames = mapContext?.spatialFilteredLayerNames ?? null;
  const spatialFilterWkt = mapContext?.spatialFilterWkt ?? null;
  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;
  /** Provider value 객체는 매 렌더 새 참조 → useCallback deps에 mapContext 전체 넣으면 무한 effect 유발 */
  const setIdentifyResultList = mapContext?.setIdentifyResultList;
  const setDataQueryMapPickEnabled = mapContext?.setDataQueryMapPickEnabled;
  /** 부모가 매 렌더 새 함수를 넘기는 경우(map-layout handleOpenDataPanel 등) → 검색 콜백 체인이 흔들려 읍면동 effect 무한루프 */
  const onOpenDataPanelRef = useRef(onOpenDataPanel);
  useLayoutEffect(() => {
    onOpenDataPanelRef.current = onOpenDataPanel;
  }, [onOpenDataPanel]);
  /** 도형 검색 중(그리기 대기/진행)이거나 검색결과가 표시된 상태일 때만 도형 버튼 on */
  const isSpatialSearchActive = !!(spatialFilterWkt || spatialDrawRequest);

  /** 통합검색(키워드) 탭에서만 지도 클릭 → 데이터 선택 패널 허용 */
  useEffect(() => {
    const enabled =
      searchTab === 'keyword' &&
      !spatialFilterWkt &&
      !spatialDrawRequest &&
      activeTool !== 'dataSelect' &&
      !geometrySearchLoading;
    setDataQueryMapPickEnabled?.(enabled);
    return () => setDataQueryMapPickEnabled?.(true);
  }, [
    searchTab,
    spatialFilterWkt,
    spatialDrawRequest,
    activeTool,
    geometrySearchLoading,
    setDataQueryMapPickEnabled,
  ]);

  // 마운트 시 로컬스토리지에서 읍면동/리, 테이블/필드/값 검색 조건 복원
  useEffect(() => {
    const persisted = loadPersistedSearchForm();
    if (persisted.emdSelected) setEmdSelected(persisted.emdSelected);
    if (persisted.riSelected) setRiSelected(persisted.riSelected);
    if (persisted.dataSelectTable) setDataSelectTable(persisted.dataSelectTable);
    if (persisted.dataSelectField) setDataSelectField(persisted.dataSelectField);
    if (persisted.dataSelectValue) setDataSelectValue(persisted.dataSelectValue);
  }, []);

  // 읍면동/리, 테이블/필드/값 변경 시 로컬스토리지에 저장
  useEffect(() => {
    savePersistedSearchForm({
      emdSelected,
      riSelected,
      boundaryBadges: boundaryBadges.map(({ kind, code, label }) => ({ kind, code, label })),
      dataSelectTable,
      dataSelectField,
      dataSelectValue,
    });
  }, [emdSelected, riSelected, boundaryBadges, dataSelectTable, dataSelectField, dataSelectValue]);

  /** 행정경계 검색 탭에서 다른 탭으로 이동하면 검색 결과·뱃지·읍면동·리 선택 초기화 */
  useEffect(() => {
    if (searchTab !== 'boundary') return;
    return () => {
      setIdentifyResultList?.(null);
      setGeometrySearchLoading(false);
      setBoundaryBadges([]);
      setEmdSelected('');
      setRiSelected('');
    };
  }, [searchTab, setIdentifyResultList]);

  // 데이터 조회 레이어 목록: DB 테이블 목록 + tables.json 메타(그룹, 한글명) 병합
  useEffect(() => {
    let cancelled = false;
    const dbPromise = call('', 'POST', { service: 'devTestService', action: 'getLayerTableList', params: {} });
    const metaPromise = fetch('/api/config/defineLayer').then((r) => r.json());
    Promise.all([dbPromise, metaPromise])
      .then(([dbRes, metaRes]) => {
        if (cancelled) return;
        const dbData = dbRes?.data ?? dbRes;
        const tables: LayerSchemaTable[] = Array.isArray(dbData?.tables) ? dbData.tables : [];
        setLayerSchemaTables(tables);

        const dbSet = new Set(
          tables
            .filter((t) => (t.schema || 'layer').toLowerCase() === 'layer')
            .map((t) => t.table.toLowerCase())
        );

        type TableMeta = {
          define_table_name?: string;
          define_table_kor_name?: string;
          define_table_group?: string;
          define_table_schema?: string;
          define_table_idx?: string | number;
          define_table_parents_layer?: string;
          define_table_div_query?: string;
        };
        const metaArr: TableMeta[] = Array.isArray(metaRes?.data) ? metaRes.data : [];

        const metaMap = new Map<string, TableMeta>();
        for (const m of metaArr) {
          const name = String(m.define_table_name ?? '').trim().toLowerCase();
          if (name && (m.define_table_schema || 'layer').toLowerCase() === 'layer') {
            metaMap.set(name, m);
          }
        }

        const groupMap = new Map<string, LayerItemMeta[]>();
        const groupOrder: string[] = [];

        const parentTablesWithSplitDefs = new Set<string>();
        for (const m of metaArr) {
          if ((m.define_table_schema || 'layer').toLowerCase() !== 'layer') continue;
          const p = String(m.define_table_parents_layer ?? '').trim().toLowerCase();
          const divQ = String(m.define_table_div_query ?? '').trim();
          if (p && divQ) parentTablesWithSplitDefs.add(p);
        }

        for (const tblName of dbSet) {
          if (parentTablesWithSplitDefs.has(tblName)) continue;
          const meta = metaMap.get(tblName);
          const groupName = meta?.define_table_group?.trim() || '기타';
          const korName = meta?.define_table_kor_name?.trim() || tblName;
          if (!groupMap.has(groupName)) {
            groupMap.set(groupName, []);
            groupOrder.push(groupName);
          }
          groupMap.get(groupName)!.push({
            id: tblName,
            name: korName,
            tableName: tblName,
            schema: 'layer',
            physicalTableName: tblName,
            rowFilterSql: null,
          });
        }

        for (const m of metaArr) {
          const schemaM = (m.define_table_schema || 'layer').toLowerCase();
          if (schemaM !== 'layer') continue;
          const eng = String(m.define_table_name ?? '').trim();
          if (!eng) continue;
          const engLower = eng.toLowerCase();
          const parent = String(m.define_table_parents_layer ?? '').trim();
          const divQ = String(m.define_table_div_query ?? '').trim();
          if (!parent || !divQ) continue;
          const parentLower = parent.toLowerCase();
          if (!dbSet.has(parentLower)) continue;
          if (dbSet.has(engLower)) continue;
          const groupName = String(m.define_table_group ?? '').trim() || '기타';
          const korName = String(m.define_table_kor_name ?? '').trim() || eng;
          if (!groupMap.has(groupName)) {
            groupMap.set(groupName, []);
            groupOrder.push(groupName);
          }
          groupMap.get(groupName)!.push({
            id: engLower,
            name: korName,
            tableName: engLower,
            schema: 'layer',
            physicalTableName: parentLower,
            rowFilterSql: divQ,
          });
        }

        // DB에는 있지만 tables.json에 없는 레이어도 '기타' 그룹에 포함
        const groups: LayerGroupMeta[] = groupOrder.map((gName) => ({
          id: gName,
          name: gName,
          layers: groupMap.get(gName)!.sort((a, b) => a.name.localeCompare(b.name)),
        }));
        setLayerGroups(groups);
      })
      .catch(() => {
        if (!cancelled) {
          setLayerSchemaTables([]);
          setLayerGroups([]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (layerGroups.length === 0) return;
    setExpandedGroups([]);
  }, [layerGroups]);

  const layerSchemaMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of layerGroups) {
      for (const l of g.layers) m.set(l.tableName, l.schema);
    }
    return m;
  }, [layerGroups]);

  const allTableNames = useMemo(
    () => layerGroups.flatMap((g) => g.layers.map((l) => l.tableName)),
    [layerGroups]
  );

  /** 통합·도형·행정경계 검색 — 체크된(지도에 켜진) 레이어만 */
  const visibleSearchTableNames = useMemo(
    () => allTableNames.filter((t) => visibleLayerNames.has(t)),
    [allTableNames, visibleLayerNames]
  );
  const visibleSearchTableNamesRef = useRef(visibleSearchTableNames);
  visibleSearchTableNamesRef.current = visibleSearchTableNames;

  const visibleLayerTargets = useMemo(
    () =>
      layerGroups.flatMap((g) =>
        g.layers
          .filter((l) => visibleLayerNames.has(l.tableName))
          .map((l) => ({
            name: l.tableName,
            table: l.physicalTableName,
            rowFilter: l.rowFilterSql,
          }))
      ),
    [layerGroups, visibleLayerNames]
  );
  const visibleLayerTargetsRef = useRef(visibleLayerTargets);
  visibleLayerTargetsRef.current = visibleLayerTargets;

  /** 레이어 목록 로드 전에 WKT가 먼저 오면 `searchDefineLayersByGeometry`만 잠시 보류 */
  type PendingGeometrySearchAttr = { wkt: string; listHeader?: string };
  const pendingGeometrySearchRef = useRef<PendingGeometrySearchAttr | null>(null);

  const applySearchToRightPanel = useCallback(
    (results: IdentifyLayerResult[], listHeaderLabel: string) => {
      const hits = totalFeatureHits(results);
      const firstFromHits = firstDefineTableFromResults(results);
      const tables = visibleSearchTableNamesRef.current;
      const fallbackTable =
        firstFromHits ?? (tables.length > 0 ? tables[0] : null);
      if (hits === 0) {
        if (fallbackTable) {
          setIdentifyResultList?.({
            coordinate: [0, 0],
            results: [],
            listHeaderLabel,
          });
          onOpenDataPanelRef.current?.(fallbackTable);
        } else {
          setIdentifyResultList?.(null);
        }
        return;
      }
      const firstTable = firstFromHits;
      if (!firstTable) {
        if (fallbackTable) {
          setIdentifyResultList?.({
            coordinate: [0, 0],
            results: [],
            listHeaderLabel,
          });
          onOpenDataPanelRef.current?.(fallbackTable);
        } else {
          setIdentifyResultList?.(null);
        }
        return;
      }
      setIdentifyResultList?.({
        coordinate: [0, 0],
        results,
        listHeaderLabel,
      });
      onOpenDataPanelRef.current?.(firstTable);
    },
    [setIdentifyResultList]
  );

  const runKeywordSearch = useCallback(() => {
    const kw = keywordInput.trim();
    if (!kw) {
      if (typeof window !== 'undefined') {
        window.alert('검색어를 입력하세요.');
      }
      return;
    }
    const tables = visibleSearchTableNamesRef.current;
    if (tables.length === 0) return;
    setGeometrySearchLoading(true);
    setSearchTab('keyword');
    void call('', 'POST', {
      service: 'standardService',
      action: 'searchDefineLayersByKeyword',
      params: { keyword: kw, tables, schema: 'layer' },
    })
      .then((res) => {
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? (data.results as IdentifyLayerResult[]) : [];
        applySearchToRightPanel(results, KEYWORD_SEARCH_HEADER);
      })
      .catch(() => setIdentifyResultList?.(null))
      .finally(() => setGeometrySearchLoading(false));
  }, [keywordInput, applySearchToRightPanel, setIdentifyResultList]);

  const runGeometrySearchToPanel = useCallback(
    (wkt: string, listHeader?: string) => {
      const header = listHeader ?? SPATIAL_SHAPE_SEARCH_HEADER;
      const tables = visibleSearchTableNamesRef.current;
      if (!wkt.trim() || tables.length === 0) return;
      setGeometrySearchLoading(true);
      void call('', 'POST', {
        service: 'standardService',
        action: 'searchDefineLayersByGeometry',
        params: { wkt, srid: 5181, tables, schema: 'layer' },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const results = Array.isArray(data?.results) ? (data.results as IdentifyLayerResult[]) : [];
          applySearchToRightPanel(results, header);
        })
        .catch(() => setIdentifyResultList?.(null))
        .finally(() => setGeometrySearchLoading(false));
    },
    [applySearchToRightPanel, setIdentifyResultList]
  );

  const queueOrRunGeometrySearchToPanel = useCallback(
    (wkt: string, listHeader?: string) => {
      if (!wkt.trim()) return;
      const tables = visibleSearchTableNamesRef.current;
      if (tables.length === 0) {
        pendingGeometrySearchRef.current = { wkt, listHeader };
        setGeometrySearchLoading(true);
        return;
      }
      pendingGeometrySearchRef.current = null;
      runGeometrySearchToPanel(wkt, listHeader);
    },
    [runGeometrySearchToPanel]
  );

  useEffect(() => {
    const p = pendingGeometrySearchRef.current;
    if (!p?.wkt || visibleSearchTableNames.length === 0) return;
    pendingGeometrySearchRef.current = null;
    runGeometrySearchToPanel(p.wkt, p.listHeader);
  }, [visibleSearchTableNames, runGeometrySearchToPanel]);

  /**
   * 도형 그리기 완료·데이터선택: WKT → 지도 도형 + 오른쪽 패널 `searchDefineLayersByGeometry` + (기본) 왼쪽 레이어 목록 공간필터(`getLayersInGeometry`).
   * 읍면동·리: 도형 그리기와 동일하게 지도·오른쪽 패널만 쓰고, 레이어 목록을 도형으로 걸러 쓰지 않을 때 `skipLayerListFilter: true`.
   */
  const applySpatialSearchFromWkt5181 = useCallback(
    (wkt: string, options?: { skipLayerListFilter?: boolean; listHeader?: string }) => {
      if (!setSpatialFilterWkt) return;
      setSpatialFilterWkt(wkt);
      queueOrRunGeometrySearchToPanel(wkt, options?.listHeader);
      if (options?.skipLayerListFilter) {
        setSpatialFilteredLayerNames?.(null);
        return;
      }
      if (!setSpatialFilteredLayerNames) return;
      const targets = visibleLayerTargetsRef.current;
      if (targets.length === 0) return;
      void call('', 'POST', {
        service: 'standardService',
        action: 'getLayersInGeometry',
        params: { wkt, srid: 5181, layerTargets: targets, schema: 'layer' },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const layers = Array.isArray(data?.layers) ? (data.layers as { tableName: string; count: number }[]) : [];
          const names = new Set(layers.map((l) => l.tableName));
          setSpatialFilteredLayerNames(names);
          setLayerTotals((prev) => {
            const next = { ...prev };
            layers.forEach((l) => {
              next[l.tableName] = l.count;
            });
            return next;
          });
        })
        .catch(() => {});
    },
    [setSpatialFilterWkt, setSpatialFilteredLayerNames, queueOrRunGeometrySearchToPanel]
  );

  const clearEmdRiMapSearch = useCallback(() => {
    pendingGeometrySearchRef.current = null;
    setGeometrySearchLoading(false);
    setSpatialFilterWkt?.(null);
    setSpatialFilteredLayerNames?.(null);
    setIdentifyResultList?.(null);
  }, [setIdentifyResultList, setSpatialFilterWkt, setSpatialFilteredLayerNames]);

  const moveMapToCenter = useCallback(
    (center: { x: number; y: number } | null) => {
      if (!center) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const center3857 = transformCoordinate([center.x, center.y], 'EPSG:5181', 'EPSG:3857');
      if (!center3857) return;
      scheduleAnimateMapToCenter3857(map, center3857 as [number, number], map.getView().getZoom() ?? 14, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  );

  const addBoundaryBadgeFromDraft = useCallback(() => {
    if (riSelected) {
      const label = riOptions.find((o) => o.code === riSelected)?.name ?? riSelected;
      const item: BoundaryBadgeItem = { key: `ri:${riSelected}`, kind: 'ri', code: riSelected, label };
      setBoundaryBadges((prev) => {
        if (prev.some((p) => p.key === item.key)) return prev;
        return [...prev, item];
      });
      return;
    }
    if (emdSelected) {
      const label = emdOptions.find((o) => o.code === emdSelected)?.name ?? emdSelected;
      const item: BoundaryBadgeItem = { key: `emd:${emdSelected}`, kind: 'emd', code: emdSelected, label };
      setBoundaryBadges((prev) => {
        if (prev.some((p) => p.key === item.key)) return prev;
        return [...prev, item];
      });
      return;
    }
    if (typeof window !== 'undefined') {
      window.alert('읍면동 또는 리를 선택한 뒤 + 를 눌러 주세요.');
    }
  }, [riSelected, emdSelected, riOptions, emdOptions]);

  const clearBoundaryTab = useCallback(() => {
    setBoundaryBadges([]);
    setEmdSelected('');
    setRiSelected('');
    pendingGeometrySearchRef.current = null;
    setSpatialFilterWkt?.(null);
    setSpatialFilteredLayerNames?.(null);
    setIdentifyResultList?.(null);
    setGeometrySearchLoading(false);
  }, [setIdentifyResultList, setSpatialFilterWkt, setSpatialFilteredLayerNames]);

  /** 레이어 목록(데이터조회) 패널을 닫거나 다른 사이드 메뉴로 전환 시 — 시설관리와 동일 storage 정리 */
  useEffect(() => {
    return () => {
      const p = loadPersistedSearchForm();
      savePersistedSearchForm({
        ...p,
        emdSelected: '',
        riSelected: '',
        boundaryBadges: [],
      });
      pendingGeometrySearchRef.current = null;
      setSpatialFilterWkt?.(null);
      setSpatialFilteredLayerNames?.(null);
      setSpatialDrawRequest?.(null);
      setIdentifyResultList?.(null);
      setGeometrySearchLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 언마운트 시에만 정리
  }, []);

  const runBoundaryBadgeSearch = useCallback(async () => {
    if (boundaryBadges.length === 0) {
      if (typeof window !== 'undefined') {
        window.alert('추가된 읍면동·리가 없습니다. 선택 후 + 를 눌러 추가하세요.');
      }
      return;
    }
    if (!setSpatialFilterWkt) return;
    setGeometrySearchLoading(true);
    setSearchTab('boundary');
    try {
      const wktParts: string[] = [];
      let lastCenter: { x: number; y: number } | null = null;
      for (const b of boundaryBadges) {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: b.kind === 'emd' ? 'getEmdGeometry' : 'getRiGeometry',
          params: b.kind === 'emd' ? { emdCode: b.code } : { riCode: b.code },
        });
        const data = res?.data ?? res;
        const w = data?.wkt != null ? String(data.wkt).trim() : '';
        if (w) {
          wktParts.push(w);
          const c = data?.center as { x?: number; y?: number } | null | undefined;
          if (c?.x != null && c?.y != null) lastCenter = { x: Number(c.x), y: Number(c.y) };
        }
      }
      if (wktParts.length === 0) {
        clearEmdRiMapSearch();
        setGeometrySearchLoading(false);
        return;
      }
      let unionWkt: string | null = wktParts[0] ?? null;
      let center: { x: number; y: number } | null = lastCenter;
      if (wktParts.length > 1) {
        const ures = await call('', 'POST', {
          service: 'devTestService',
          action: 'unionWkts5181',
          params: { wkts: wktParts },
        });
        const udata = ures?.data ?? ures;
        unionWkt = udata?.wkt != null ? String(udata.wkt).trim() : null;
        const uc = udata?.center as { x?: number; y?: number } | null | undefined;
        if (uc?.x != null && uc?.y != null) center = { x: Number(uc.x), y: Number(uc.y) };
      }
      if (!unionWkt) {
        clearEmdRiMapSearch();
        setGeometrySearchLoading(false);
        return;
      }
      setSpatialFilterWkt(unionWkt);
      moveMapToCenter(center);
      applySpatialSearchFromWkt5181(unionWkt, {
        skipLayerListFilter: true,
        listHeader: BOUNDARY_SEARCH_HEADER,
      });
    } catch {
      clearEmdRiMapSearch();
      setGeometrySearchLoading(false);
    }
  }, [
    boundaryBadges,
    setSpatialFilterWkt,
    applySpatialSearchFromWkt5181,
    moveMapToCenter,
    clearEmdRiMapSearch,
  ]);

  const startSpatialDraw = useCallback(
    (type: 'rectangle' | 'polygon' | 'circle') => {
      if (!setSpatialDrawRequest || !setSpatialFilterWkt || !setSpatialFilteredLayerNames) return;
      if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return;
      const targets = visibleLayerTargetsRef.current;
      if (targets.length === 0) return;
      setSearchTab('shape');
      setActiveTool(type);
      setSpatialDrawRequest({
        type,
        onComplete: (wkt5181: string) => {
          applySpatialSearchFromWkt5181(wkt5181);
        },
      });
    },
    [setSpatialDrawRequest, mapContext, applySpatialSearchFromWkt5181]
  );

  const clearSpatialFilter = useCallback(() => {
    pendingGeometrySearchRef.current = null;
    setGeometrySearchLoading(false);
    setIdentifyResultList?.(null);
    setSearchTab('shape');
    setActiveTool('rectangle');
    setSpatialFilterWkt?.(null);
    setSpatialFilteredLayerNames?.(null);
    setEmdSelected('');
    setRiSelected('');
    setBoundaryBadges([]);
  }, [setIdentifyResultList, setSpatialFilterWkt, setSpatialFilteredLayerNames]);

  useEffect(() => {
    const flat = layerGroups.flatMap((g) => g.layers);
    const toFetch = flat.filter((l) => l.tableName && layerTotals[l.tableName] === undefined);
    if (toFetch.length === 0) return;
    toFetch.forEach((l) => {
      const tableName = l.tableName;
      call('', 'POST', {
        service: 'standardService',
        action: 'getTableCount',
        params: {
          table: l.physicalTableName,
          schema: l.schema,
          ...(l.rowFilterSql ? { rowFilter: l.rowFilterSql } : {}),
        },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const total = typeof data?.total === 'number' ? data.total : 0;
          setLayerTotals((prev) => (prev[tableName] === undefined ? { ...prev, [tableName]: total } : prev));
        })
        .catch(() => {});
    });
  }, [layerGroups, layerSchemaMap]);

  /** 읍면동 코드 목록 — 행정경계 도구 전환 시마다 호출하지 않고 마운트 시 1회 */
  useEffect(() => {
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getEmdRiOptions', params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : []);
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchTab !== 'boundary' || !emdSelected) {
      setRiOptions([]);
      setRiSelected('');
      return;
    }
    let cancelled = false;
    call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRiOptions(Array.isArray(data?.ri) ? data.ri : []);
        setRiSelected('');
      })
      .catch(() => {
        if (!cancelled) setRiOptions([]);
      });
    return () => { cancelled = true; };
  }, [searchTab, emdSelected]);

  useEffect(() => {
    if (activeTool !== 'dataSelect') return;
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getDataSelectTableList', params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectTableOptions(Array.isArray(data?.tables) ? data.tables : []);
        // 선택값은 로컬스토리지 복원/유지용으로 초기화하지 않음
      })
      .catch(() => {
        if (!cancelled) setDataSelectTableOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'dataSelect' || !dataSelectTable) {
      setDataSelectFieldOptions([]);
      setDataSelectFieldLabels({});
      return;
    }
    let cancelled = false;
    Promise.all([
      call('', 'POST', {
        service: 'devTestService',
        action: 'getDataSelectFieldList',
        params: { table: dataSelectTable },
      }),
      fetch(`/api/config/defineLayer/fields/${encodeURIComponent(dataSelectTable)}`).then((r) => r.json()),
    ])
      .then(([res, fieldsRes]) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const fields = Array.isArray(data?.fields) ? data.fields : [];
        setDataSelectFieldOptions(fields);
        const fieldDefs = Array.isArray(fieldsRes?.data) ? fieldsRes.data : [];
        const labels: Record<string, string> = {};
        for (const row of fieldDefs as { define_field_name?: string; define_field_kor_name?: string }[]) {
          const name = String(row?.define_field_name ?? '').trim();
          const kor = String(row?.define_field_kor_name ?? '').trim();
          if (name) labels[name] = kor || name;
        }
        setDataSelectFieldLabels(labels);
        // 필드/값 선택은 로컬스토리지 복원/유지용으로 초기화하지 않음
      })
      .catch(() => {
        if (!cancelled) setDataSelectFieldOptions([]);
        if (!cancelled) setDataSelectFieldLabels({});
      });
    return () => { cancelled = true; };
  }, [activeTool, dataSelectTable]);

  useEffect(() => {
    if (activeTool !== 'dataSelect' || !dataSelectTable || !dataSelectField) {
      setDataSelectValueOptions([]);
      setDataSelectValueLabels({});
      return;
    }
    let cancelled = false;
    const tableFieldKey = `${dataSelectTable}__${dataSelectField}`;
    Promise.all([
      call('', 'POST', {
        service: 'devTestService',
        action: 'getDataSelectValueList',
        params: { table: dataSelectTable, field: dataSelectField },
      }),
      fetch(`/api/config/defineLayer/codes/${encodeURIComponent(tableFieldKey)}`).then((r) => r.json()),
    ])
      .then(([res, codesRes]) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const values = Array.isArray(data?.values) ? data.values : [];
        setDataSelectValueOptions(values);
        const codeList = Array.isArray(codesRes?.data) ? codesRes.data : [];
        const labels: Record<string, string> = {};
        for (const row of codeList as { define_code_name?: string; define_code_kor_name?: string }[]) {
          const name = String(row?.define_code_name ?? '').trim();
          const kor = String(row?.define_code_kor_name ?? '').trim();
          if (name) labels[name] = kor || name;
        }
        setDataSelectValueLabels(labels);
        // 값 선택은 로컬스토리지 복원/유지용으로 초기화하지 않음
      })
      .catch(() => {
        if (!cancelled) setDataSelectValueOptions([]);
        if (!cancelled) setDataSelectValueLabels({});
      });
    return () => { cancelled = true; };
  }, [activeTool, dataSelectTable, dataSelectField]);

  // 테이블/필드/값 선택 시 해당 조건에 맞는 도형 조회 → 지도에 표시 후 겹치는 레이어 공간 검색 (읍면동 선택과 동일)
  useEffect(() => {
    if (activeTool !== 'dataSelect') return;
    if (!setSpatialFilterWkt || !setSpatialFilteredLayerNames) return;

    const applyWkt = (wkt: string | null) => {
      if (!wkt) {
        pendingGeometrySearchRef.current = null;
        setGeometrySearchLoading(false);
        setSpatialFilterWkt(null);
        setSpatialFilteredLayerNames(null);
        setIdentifyResultList?.(null);
        return;
      }
      applySpatialSearchFromWkt5181(wkt);
    };

    const moveMapToCenter = (center: { x: number; y: number } | null) => {
      if (!center) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const center3857 = transformCoordinate([center.x, center.y], 'EPSG:5181', 'EPSG:3857');
      if (!center3857) return;
      scheduleAnimateMapToCenter3857(map, center3857 as [number, number], map.getView().getZoom() ?? 14, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    };

    if (dataSelectTable && dataSelectField && dataSelectValue) {
      call('', 'POST', {
        service: 'devTestService',
        action: 'getGeometryByFieldValue',
        params: {
          table: dataSelectTable,
          field: dataSelectField,
          value: dataSelectValue,
          schema: 'layer',
        },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const wkt = data?.wkt ?? null;
          applyWkt(wkt);
          moveMapToCenter(data?.center ?? null);
        })
        .catch(() => applyWkt(null));
    } else {
      applyWkt(null);
    }
  // visibleSearchTableNamesRef는 렌더마다 갱신. mapContext 대신 setIdentifyResultList만 deps (Provider value 참조 변경 방지).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, dataSelectTable, dataSelectField, dataSelectValue, applySpatialSearchFromWkt5181, setIdentifyResultList]);

  const handleLayerClick = (layer: LayerItemMeta) => {
    if (activeTableName === layer.tableName) {
      setIdentifyResultList?.(null);
      onClearDataSelection?.();
    } else {
      setIdentifyResultList?.(null);
      onOpenDataPanelRef.current?.(layer.tableName);
      if (setVisibleLayerNames && !visibleLayerNames.has(layer.tableName)) {
        setVisibleLayerNames((prev) => new Set(prev).add(layer.tableName));
      }
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden opacity-[0.95]">
      {/* 공간검색 */}
      <div className="border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="mb-2 flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => setSearchTab('keyword')}
            className={cn(
              'flex-1 rounded py-1.5 text-[11px] font-medium transition-colors',
              searchTab === 'keyword' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            통합검색
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchTab('shape');
              setActiveTool((prev) => (prev === 'emdRi' ? 'rectangle' : prev));
            }}
            className={cn(
              'flex-1 rounded py-1.5 text-[11px] font-medium transition-colors',
              searchTab === 'shape' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            도형검색
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchTab('boundary');
              setActiveTool('emdRi');
            }}
            className={cn(
              'flex-1 rounded px-0.5 py-1.5 text-[10px] font-medium leading-tight transition-colors',
              searchTab === 'boundary' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            행정경계 검색
          </button>
        </div>
        {searchTab === 'keyword' && (
          <div className="flex items-stretch gap-2">
            <input
              type="search"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runKeywordSearch();
              }}
              placeholder="레이어 속성 검색"
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
            />
            <button
              type="button"
              onClick={runKeywordSearch}
              disabled={geometrySearchLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Search className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              검색
            </button>
          </div>
        )}
        {searchTab === 'shape' && (
          <>
            <div className="flex items-stretch w-full gap-2">
              {SPATIAL_SHAPE_TOOLS.map((tool) => {
                const ToolIcon = tool.icon;
                const isShapeTool = tool.id === 'rectangle' || tool.id === 'polygon' || tool.id === 'circle';
                const isActive = isShapeTool
                  ? isSpatialSearchActive && activeTool === tool.id
                  : activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      setSearchTab('shape');
                      if (
                        (tool.id === 'rectangle' || tool.id === 'polygon' || tool.id === 'circle') &&
                        setSpatialDrawRequest
                      ) {
                        startSpatialDraw(tool.id);
                      } else {
                        setActiveTool(tool.id);
                      }
                    }}
                    disabled={geometrySearchLoading}
                    className={cn(
                      'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded border bg-white py-2 transition-colors disabled:opacity-50',
                      isActive
                        ? 'border-primary text-primary'
                        : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                    )}
                    title={
                      tool.id === 'rectangle' || tool.id === 'polygon' || tool.id === 'circle'
                        ? `지도에 ${tool.label} 그리기`
                        : tool.label
                    }
                  >
                    <ToolIcon className="h-5 w-5 shrink-0" strokeWidth={2} />
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  if (spatialFilterWkt) clearSpatialFilter();
                  else setActiveTool('rectangle');
                }}
                className={cn(
                  'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded border bg-white py-2 transition-colors',
                  spatialFilterWkt
                    ? 'border-amber-300 text-amber-600 hover:border-amber-400'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-primary'
                )}
                title={spatialFilterWkt ? '공간 필터 해제' : '초기화'}
              >
                <RefreshCw className="h-5 w-5 shrink-0" strokeWidth={2} />
              </button>
            </div>
            {activeTool === 'dataSelect' && (
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <select
                    value={dataSelectTable}
                    onChange={(e) => setDataSelectTable(e.target.value)}
                    disabled={geometrySearchLoading}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-0 py-1.5 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                  >
                    <option value="">테이블 선택</option>
                    {dataSelectTableOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-0">
                  <select
                    value={dataSelectField}
                    onChange={(e) => setDataSelectField(e.target.value)}
                    disabled={!dataSelectTable || geometrySearchLoading}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-0 py-1.5 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">필드 선택</option>
                    {dataSelectFieldOptions.map((name) => (
                      <option key={name} value={name}>
                        {dataSelectFieldLabels[name] ?? name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-0">
                  <select
                    value={dataSelectValue}
                    onChange={(e) => setDataSelectValue(e.target.value)}
                    disabled={!dataSelectField || geometrySearchLoading}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-0 py-1.5 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">값 선택</option>
                    {dataSelectValueOptions.map((val) => (
                      <option key={val} value={val}>
                        {dataSelectValueLabels[val] ?? val}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </>
        )}
        {searchTab === 'boundary' && (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <select
                  value={emdSelected}
                  onChange={(e) => {
                    setEmdSelected(e.target.value);
                    setRiSelected('');
                  }}
                  disabled={geometrySearchLoading}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">읍면동 선택</option>
                  {emdOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <select
                  value={riSelected}
                  onChange={(e) => setRiSelected(e.target.value)}
                  disabled={!emdSelected || geometrySearchLoading}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">리 선택</option>
                  {riOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                title="선택 항목을 목록에 추가"
                onClick={addBoundaryBadgeFromDraft}
                disabled={geometrySearchLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </div>
            {boundaryBadges.length > 0 && (
              <div className="grid grid-cols-4 gap-x-1 gap-y-1.5">
                {boundaryBadges.map((b) => (
                  <span
                    key={b.key}
                    className="flex min-h-[1.375rem] min-w-0 w-full max-w-full items-center justify-center gap-0.5 rounded-full border border-primary/25 bg-primary/8 py-0.5 pl-1 pr-0.5 text-[11px] leading-none text-slate-800"
                  >
                    <span className="min-w-0 max-w-[3em] flex-1 truncate text-center" title={b.label}>
                      {b.label}
                    </span>
                    <button
                      type="button"
                      title="목록에서 제거"
                      onClick={() => setBoundaryBadges((prev) => prev.filter((x) => x.key !== b.key))}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-primary/15 hover:text-primary"
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runBoundaryBadgeSearch()}
                disabled={geometrySearchLoading || boundaryBadges.length === 0}
                className="min-h-9 flex-1 rounded-md border border-primary bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                검색
              </button>
              <button
                type="button"
                title="선택·목록·지도 필터 초기화"
                onClick={clearBoundaryTab}
                disabled={geometrySearchLoading}
                className="min-h-9 flex-1 rounded-md border border-slate-200 bg-white py-2 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:text-primary disabled:opacity-50"
              >
                초기화
              </button>
            </div>
          </div>
        )}
        {geometrySearchLoading && (
          <div className="mt-2 shrink-0 border-t border-slate-100 bg-slate-50/80 px-1 py-1.5 text-center text-[11px] text-slate-500">
            검색 중…
          </div>
        )}
      </div>

      {/* Layer groups (scrollable). 공간 필터 시 도형 내에 데이터 있는 레이어만 표시 */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {(layerGroups.length === 0 || layerGroups.every((g) => g.layers.length === 0)) && (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            등록된 레이어가 없습니다.
          </div>
        )}
        {spatialFilteredLayerNames && spatialFilteredLayerNames.size === 0 && (
          <div className="px-4 py-6 text-center text-sm text-amber-600">
            선택한 도형 안에 포함된 데이터가 없습니다.
          </div>
        )}
        {layerGroups.map((group) => {
          const filteredLayers =
            spatialFilteredLayerNames != null
              ? group.layers.filter((l) => spatialFilteredLayerNames!.has(l.tableName))
              : group.layers;
          if (filteredLayers.length === 0) return null;
          const isGroupOpen = expandedGroups.includes(group.id);
          const hasActiveLayer = filteredLayers.some((l) => activeTableName === l.tableName);
          const groupCount = filteredLayers.length;
          const groupVisibleCount = filteredLayers.filter((l) => visibleLayerNames.has(l.tableName)).length;

          return (
            <div
              key={group.id}
              className={cn(
                'border-b border-slate-200 border-l-4',
                hasActiveLayer ? 'border-l-primary' : 'border-l-slate-200'
              )}
            >
              <div
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-[0.35rem] transition-colors hover:bg-slate-100',
                  hasActiveLayer && 'bg-primary/8'
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="flex items-center gap-1 min-w-0 flex-1 text-left"
                >
                  {isGroupOpen ? (
                    <ChevronDown className={cn('h-3.5 w-3.5 shrink-0', hasActiveLayer ? 'text-primary' : 'text-slate-500')} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <span className={cn('text-[12px] font-normal', hasActiveLayer ? 'text-primary' : 'text-slate-800')}>
                    {group.name}
                  </span>
                  <span className={cn('text-[11px]', hasActiveLayer ? 'text-primary/70' : 'text-slate-400')}>
                    ({groupCount}개)
                  </span>
                </button>
                <input
                  type="checkbox"
                  checked={groupCount > 0 && groupVisibleCount === groupCount}
                  ref={(el) => { if (el) el.indeterminate = groupVisibleCount > 0 && groupVisibleCount < groupCount; }}
                  onChange={(e) => {
                    if (!setVisibleLayerNames) return;
                    const checked = e.target.checked;
                    setVisibleLayerNames((prev) => {
                      const next = new Set(prev);
                      filteredLayers.forEach((l) => { if (checked) next.add(l.tableName); else next.delete(l.tableName); });
                      return next;
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-primary focus:ring-primary/30 shrink-0 cursor-pointer"
                  title="그룹 전체 켜기/끄기"
                />
              </div>

              {isGroupOpen && (
                <div className={cn(hasActiveLayer ? 'bg-primary/[0.03]' : 'bg-slate-50/80')}>
                  {filteredLayers.map((layer) => {
                    const isActive = activeTableName === layer.tableName;
                    const isVisible = visibleLayerNames.has(layer.tableName);
                    const totalCount = layerTotals[layer.tableName];

                    return (
                      <div
                        key={layer.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleLayerClick(layer)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleLayerClick(layer);
                          }
                        }}
                        className={cn(
                          'flex w-full items-center gap-1 py-1 pl-4 pr-2 transition-colors hover:bg-slate-100 cursor-pointer',
                          isActive && 'bg-primary/5'
                        )}
                      >
                        {failedLegendLayers.has(layer.tableName) ? (
                          <span
                            className="shrink-0 w-5 h-5 rounded border border-slate-300 bg-slate-200"
                            aria-hidden
                          />
                        ) : (
                          <img
                            src={getLegendGraphicUrl(layer.tableName, layer.tableName)}
                            alt=""
                            className="shrink-0 w-5 h-5 object-contain border border-slate-200 rounded"
                            onError={() => onLegendError(layer.tableName)}
                          />
                        )}
                        <div className="flex items-center gap-1 min-w-0 flex-1 text-left min-h-[1.0rem]">
                          <span className={cn('text-[11px] truncate', isActive ? 'font-normal text-primary' : 'font-normal text-slate-700')}>
                            {layer.name}
                          </span>
                          <span className={cn('text-[11px] shrink-0', isActive ? 'text-primary/60' : 'text-slate-400')}>
                            ({totalCount != null ? `${totalCount.toLocaleString()}건` : '...'})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="p-0.5 rounded text-slate-400 hover:text-primary hover:bg-slate-200/60 transition-colors"
                            title="필터 추가"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            className="p-0.5 rounded text-slate-400 hover:text-primary hover:bg-slate-200/60 transition-colors"
                            title="스타일 설정"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Palette className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={(e) => {
                              e.stopPropagation();
                              if (!setVisibleLayerNames) return;
                              const checked = e.target.checked;
                              setVisibleLayerNames((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(layer.tableName);
                                else next.delete(layer.tableName);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-primary focus:ring-primary/30 shrink-0 cursor-pointer"
                            title="레이어 켜기/끄기"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
