'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { call } from '@/lib/api';
import {
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Pentagon,
  RefreshCw,
  Database,
  Landmark,
  SlidersHorizontal,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from '../MapContext';
import { getLegendGraphicUrl } from '../layerFactory/serviceLayerFactory';
import { transformCoordinate } from '../services/coordinateService';

/** layer 스키마 테이블 목록 (DB 기준) */
type LayerSchemaTable = { schema: string; table: string };

interface LayerItemMeta {
  id: string;
  name: string;
  tableName: string;
  schema: string;
}

interface LayerGroupMeta {
  id: string;
  name: string;
  layers: LayerItemMeta[];
}

type SpatialSearchTool = 'rectangle' | 'circle' | 'polygon' | 'emdRi' | 'dataSelect';

const SPATIAL_TOOLS: { id: SpatialSearchTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: Circle, label: '원형' },
  { id: 'emdRi', icon: Landmark, label: '행정경계' },
  { id: 'dataSelect', icon: Database, label: '데이터 선택' },
];

const SPATIAL_SEARCH_FORM_STORAGE_KEY = 'ggnr_spatial_search_form';

type PersistedSearchForm = {
  emdSelected?: string;
  riSelected?: string;
  dataSelectTable?: string;
  dataSelectField?: string;
  dataSelectValue?: string;
};

function loadPersistedSearchForm(): PersistedSearchForm {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SPATIAL_SEARCH_FORM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSearchForm;
    return {
      emdSelected: typeof parsed.emdSelected === 'string' ? parsed.emdSelected : '',
      riSelected: typeof parsed.riSelected === 'string' ? parsed.riSelected : '',
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

export function AttributeQueryUI({ activeTableName, onOpenDataPanel, onClearDataSelection }: AttributeQueryUIProps) {
  const [activeTool, setActiveTool] = useState<SpatialSearchTool>('rectangle');
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
  /** 도형 검색 중(그리기 대기/진행)이거나 검색결과가 표시된 상태일 때만 도형 버튼 on */
  const isSpatialSearchActive = !!(spatialFilterWkt || spatialDrawRequest);

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
      dataSelectTable,
      dataSelectField,
      dataSelectValue,
    });
  }, [emdSelected, riSelected, dataSelectTable, dataSelectField, dataSelectValue]);

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
        };
        const metaArr: TableMeta[] = Array.isArray(metaRes?.data) ? metaRes.data : [];

        const metaMap = new Map<string, TableMeta>();
        for (const m of metaArr) {
          const name = String(m.define_table_name ?? '').toLowerCase();
          if (name && (m.define_table_schema || 'layer').toLowerCase() === 'layer') {
            metaMap.set(name, m);
          }
        }

        const groupMap = new Map<string, LayerItemMeta[]>();
        const groupOrder: string[] = [];

        for (const tblName of dbSet) {
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
  const allTableNamesRef = useRef<string[]>(allTableNames);
  allTableNamesRef.current = allTableNames;

  const startSpatialDraw = useCallback(
    (type: 'rectangle' | 'polygon' | 'circle') => {
      if (!setSpatialDrawRequest || !setSpatialFilterWkt || !setSpatialFilteredLayerNames) return;
      // 거리/면적 측정이 켜져 있는 중에는 레이어 목록 검색용 도형 그리기 불가
      if (mapContext?.measurementActive) {
        if (typeof window !== 'undefined') {
          window.alert('거리·면적 측정이 진행 중입니다. 측정을 완료하거나 끈 후 레이어 검색 도형 그리기를 사용해 주세요.');
        }
        return;
      }
      const tables = allTableNamesRef.current;
      if (tables.length === 0) return;
      setActiveTool(type);
      setSpatialDrawRequest({
        type,
        onComplete: (wkt5181: string) => {
          call('', 'POST', {
            service: 'standardService',
            action: 'getLayersInGeometry',
            params: { wkt: wkt5181, srid: 5181, tables, schema: 'layer' },
          })
            .then((res) => {
              const data = res?.data ?? res;
              const layers = Array.isArray(data?.layers) ? (data.layers as { tableName: string; count: number }[]) : [];
              const names = new Set(layers.map((l) => l.tableName));
              setSpatialFilterWkt(wkt5181);
              setSpatialFilteredLayerNames(names);
              setLayerTotals((prev) => {
                const next = { ...prev };
                layers.forEach((l) => { next[l.tableName] = l.count; });
                return next;
              });
            })
            .catch(() => {});
        },
      });
    },
    [setSpatialDrawRequest, setSpatialFilterWkt, setSpatialFilteredLayerNames, mapContext?.measurementActive]
  );

  const clearSpatialFilter = useCallback(() => {
    setActiveTool('rectangle');
    setSpatialFilterWkt?.(null);
    setSpatialFilteredLayerNames?.(null);
    setEmdSelected('');
    setRiSelected('');
  }, [setSpatialFilterWkt, setSpatialFilteredLayerNames]);

  useEffect(() => {
    const tableNames = layerGroups.flatMap((g) => g.layers.map((l) => l.tableName));
    const toFetch = tableNames.filter((t) => t && layerTotals[t] === undefined);
    if (toFetch.length === 0) return;
    toFetch.forEach((tableName) => {
      call('', 'POST', {
        service: 'standardService',
        action: 'getTableCount',
        params: { table: tableName, schema: layerSchemaMap.get(tableName) ?? 'layer' },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const total = typeof data?.total === 'number' ? data.total : 0;
          setLayerTotals((prev) => (prev[tableName] === undefined ? { ...prev, [tableName]: total } : prev));
        })
        .catch(() => {});
    });
  }, [layerGroups, layerSchemaMap]);

  useEffect(() => {
    if (activeTool !== 'emdRi') return;
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getEmdRiOptions', params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : []);
        setRiOptions([]);
        setRiSelected('');
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'emdRi' || !emdSelected) {
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
  }, [activeTool, emdSelected]);

  // 읍면동/리 선택 시 해당 도형(emd 또는 ri 테이블) 조회 → 지도에 표시 후 동일하게 공간 검색. 리 선택 시 emd 대신 ri 도형만 표시
  useEffect(() => {
    if (activeTool !== 'emdRi') return;
    if (!setSpatialFilterWkt || !setSpatialFilteredLayerNames) return;

    const applyWkt = (wkt: string | null) => {
      if (!wkt) {
        setSpatialFilterWkt(null);
        setSpatialFilteredLayerNames(null);
        return;
      }
      setSpatialFilterWkt(wkt);
      const tables = allTableNamesRef.current;
      if (tables.length === 0) return;
      call('', 'POST', {
        service: 'standardService',
        action: 'getLayersInGeometry',
        params: { wkt, srid: 5181, tables, schema: 'layer' },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const layers = Array.isArray(data?.layers) ? (data.layers as { tableName: string; count: number }[]) : [];
          const names = new Set(layers.map((l) => l.tableName));
          setSpatialFilteredLayerNames(names);
          setLayerTotals((prev) => {
            const next = { ...prev };
            layers.forEach((l) => { next[l.tableName] = l.count; });
            return next;
          });
        })
        .catch(() => {});
    };

    const moveMapToCenter = (center: { x: number; y: number } | null) => {
      if (!center) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const center3857 = transformCoordinate([center.x, center.y], 'EPSG:5181', 'EPSG:3857');
      if (center3857) map.getView().setCenter(center3857);
    };

    if (riSelected) {
      call('', 'POST', {
        service: 'devTestService',
        action: 'getRiGeometry',
        params: { riCode: riSelected },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const wkt = data?.wkt ?? null;
          applyWkt(wkt);
          moveMapToCenter(data?.center ?? null);
        })
        .catch(() => applyWkt(null));
      return;
    }
    if (emdSelected) {
      call('', 'POST', {
        service: 'devTestService',
        action: 'getEmdGeometry',
        params: { emdCode: emdSelected },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const wkt = data?.wkt ?? null;
          applyWkt(wkt);
          moveMapToCenter(data?.center ?? null);
        })
        .catch(() => applyWkt(null));
      return;
    }
    applyWkt(null);
  }, [activeTool, emdSelected, riSelected, setSpatialFilterWkt, setSpatialFilteredLayerNames]);

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
        setSpatialFilterWkt(null);
        setSpatialFilteredLayerNames(null);
        return;
      }
      setSpatialFilterWkt(wkt);
      const tables = allTableNamesRef.current;
      if (tables.length === 0) return;
      call('', 'POST', {
        service: 'standardService',
        action: 'getLayersInGeometry',
        params: { wkt, srid: 5181, tables, schema: 'layer' },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const layers = Array.isArray(data?.layers) ? (data.layers as { tableName: string; count: number }[]) : [];
          const names = new Set(layers.map((l) => l.tableName));
          setSpatialFilteredLayerNames(names);
          setLayerTotals((prev) => {
            const next = { ...prev };
            layers.forEach((l) => { next[l.tableName] = l.count; });
            return next;
          });
        })
        .catch(() => {});
    };

    const moveMapToCenter = (center: { x: number; y: number } | null) => {
      if (!center) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const center3857 = transformCoordinate([center.x, center.y], 'EPSG:5181', 'EPSG:3857');
      if (center3857) map.getView().setCenter(center3857);
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
  // allTableNames는 allTableNamesRef.current로 참조. mapContext 제외 시 무한루프 방지.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, dataSelectTable, dataSelectField, dataSelectValue]);

  const handleLayerClick = (layer: LayerItemMeta) => {
    if (activeTableName === layer.tableName) {
      mapContext?.setIdentifyResultList?.(null);
      onClearDataSelection?.();
    } else {
      mapContext?.setIdentifyResultList?.(null);
      onOpenDataPanel?.(layer.tableName);
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
        <div className="flex items-stretch w-full gap-2">
          {SPATIAL_TOOLS.map((tool) => {
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
                  if ((tool.id === 'rectangle' || tool.id === 'polygon' || tool.id === 'circle') && setSpatialDrawRequest) {
                    startSpatialDraw(tool.id);
                  } else {
                    setActiveTool(tool.id);
                  }
                }}
                className={cn(
                  'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 py-2 rounded border transition-colors bg-white',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                )}
                title={tool.id === 'rectangle' || tool.id === 'polygon' || tool.id === 'circle' ? `지도에 ${tool.label} 그리기` : tool.label}
              >
                <ToolIcon className="h-5 w-5 shrink-0" strokeWidth={2} />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => (spatialFilterWkt ? clearSpatialFilter() : setActiveTool('rectangle'))}
            className={cn(
              'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 py-2 rounded border transition-colors bg-white',
              spatialFilterWkt ? 'border-amber-300 text-amber-600 hover:border-amber-400' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-primary'
            )}
            title={spatialFilterWkt ? '공간 필터 해제' : '초기화'}
          >
            <RefreshCw className="h-5 w-5 shrink-0" strokeWidth={2} />
          </button>
        </div>
        {activeTool === 'emdRi' && (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <select
                value={emdSelected}
                onChange={(e) => setEmdSelected(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary"
              >
                <option value="">읍면동 선택</option>
                {emdOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <select
                value={riSelected}
                onChange={(e) => setRiSelected(e.target.value)}
                disabled={!emdSelected}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">리 선택</option>
                {riOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {activeTool === 'dataSelect' && (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <select
                value={dataSelectTable}
                onChange={(e) => setDataSelectTable(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-0 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary"
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
                disabled={!dataSelectTable}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-0 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
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
                disabled={!dataSelectField}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-0 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
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
                              setVisibleLayerNames((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(layer.tableName);
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
