'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import {
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Pentagon,
  RefreshCw,
  GripVertical,
  Database,
  Landmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from './MapContext';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill, Circle as CircleStyle, Icon } from 'ol/style';

const SIDEBAR_WIDTH = 65;

/* ------------------------------------------------------------------ */
/*  defineLayer 기반 레이어 그룹/목록 (켜진 레이어 기준)                */
/* ------------------------------------------------------------------ */

type DefineLayerRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_idx?: string;
  [key: string]: unknown;
};

type DefineFieldRow = {
  define_field_name?: string;
  define_field_kor_name?: string;
  define_field_idx?: string;
  define_field_show_list?: string;
  [key: string]: unknown;
};

interface LayerItemMeta {
  id: string;
  name: string;
  tableName: string;
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

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type StandardListProps = {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
};

export default function StandardList({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: StandardListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const panelRef = useRef<HTMLDivElement>(null);
  const openedKey = 'dataQuery';

  const handleResize = useCallback(
    (e: MouseEvent) => {
      const next = Math.min(maxWidth, Math.max(minWidth, e.clientX - SIDEBAR_WIDTH));
      onWidthChange(next);
    },
    [minWidth, maxWidth, onWidthChange]
  );

  const handleResizeEnd = useCallback(() => {
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', handleResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleResize]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', handleResizeEnd);
    },
    [handleResize, handleResizeEnd]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [handleResize, handleResizeEnd]);

  const handleClose = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
    const filtered = opened.filter((w) => w !== openedKey);
    if (filtered.length > 0) {
      current.set('opened', filtered.join(','));
    } else {
      current.delete('opened');
    }
    router.push(`/map?${current.toString()}`);
  };

  const panelClassName =
    'h-full shrink-0 flex flex-col bg-white border-r border-slate-200 shadow-lg overflow-hidden relative';
  const resizeHandle = (
    <div
      role="separator"
      aria-label="패널 너비 조절"
      onMouseDown={handleResizeStart}
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize flex items-center justify-center z-10 group hover:bg-slate-100/80"
    >
      <span className="opacity-0 group-hover:opacity-100 text-slate-400 transition-opacity">
        <GripVertical className="w-4 h-4" />
      </span>
    </div>
  );

  return (
    <AttributeQueryUI
      panelRef={panelRef}
      width={width}
      panelClassName={panelClassName}
      resizeHandle={resizeHandle}
      handleClose={handleClose}
      visibleLayerNames={visibleLayerNames}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Attribute Query UI (default)                                      */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 20;

type LayerTableData = {
  fields: DefineFieldRow[];
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  page: number;
  total: number;
};

function AttributeQueryUI({
  panelRef,
  width,
  panelClassName,
  resizeHandle,
  handleClose,
  visibleLayerNames,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  panelClassName: string;
  resizeHandle: React.ReactNode;
  handleClose: () => void;
  visibleLayerNames: Set<string>;
}) {
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
  const [defineLayerTables, setDefineLayerTables] = useState<DefineLayerRow[]>([]);
  const [layerGroups, setLayerGroups] = useState<LayerGroupMeta[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [expandedLayers, setExpandedLayers] = useState<string[]>([]);
  const [layerData, setLayerData] = useState<Record<string, LayerTableData>>({});
  const [layerTotals, setLayerTotals] = useState<Record<string, number>>({});
  const [highlightedRow, setHighlightedRow] = useState<{ layerId: string; rowIndex: number } | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const mapContext = useMapContext();
  const highlightSourceRef = useRef<VectorSource | null>(null);
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectionSourceRef = useRef<VectorSource | null>(null);
  const selectionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config/defineLayer')
      .then((r) => r.json())
      .then((body: { success?: boolean; data?: DefineLayerRow[] }) => {
        if (cancelled) return;
        setDefineLayerTables(Array.isArray(body?.data) ? body.data : []);
      })
      .catch(() => {
        if (!cancelled) setDefineLayerTables([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const visible = visibleLayerNames;
    const tables = defineLayerTables.filter(
      (row) => visible.has(String(row.define_table_name ?? '').trim())
    );
    const groupMap = new Map<string, DefineLayerRow[]>();
    for (const row of tables) {
      const groupKey = String(row.define_table_group ?? '').trim() || '(미분류)';
      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey)!.push(row);
    }
    const sortedGroups = [...groupMap.keys()].sort((a, b) => a.localeCompare(b));
    const groups: LayerGroupMeta[] = sortedGroups.map((groupKey) => {
      const rows = groupMap.get(groupKey) ?? [];
      rows.sort((a, b) => {
        const idxA = parseInt(String(a.define_table_idx ?? '999999'), 10);
        const idxB = parseInt(String(b.define_table_idx ?? '999999'), 10);
        if (idxA !== idxB) return idxA - idxB;
        return String(a.define_table_name ?? '').localeCompare(String(b.define_table_name ?? ''));
      });
      return {
        id: groupKey,
        name: groupKey,
        layers: rows.map((r) => {
          const tableName = String(r.define_table_name ?? '').trim();
          const name = String(r.define_table_kor_name ?? '').trim() || tableName;
          return { id: tableName, name, tableName };
        }),
      };
    });
    setLayerGroups(groups);
  }, [defineLayerTables, visibleLayerNames]);

  useEffect(() => {
    if (layerGroups.length === 0) return;
    setExpandedGroups((prev) => (prev.length === 0 ? layerGroups.map((g) => g.id) : prev));
  }, [layerGroups]);

  useEffect(() => {
    const tableNames = layerGroups.flatMap((g) => g.layers.map((l) => l.tableName));
    const toFetch = tableNames.filter((t) => t && layerTotals[t] === undefined);
    if (toFetch.length === 0) return;
    toFetch.forEach((tableName) => {
      call('', 'POST', {
        service: 'standardService',
        action: 'getTableCount',
        params: { table: tableName },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const total = typeof data?.total === 'number' ? data.total : 0;
          setLayerTotals((prev) => (prev[tableName] === undefined ? { ...prev, [tableName]: total } : prev));
        })
        .catch(() => {});
    });
  }, [layerGroups]);

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
    return () => {
      cancelled = true;
    };
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
    return () => {
      cancelled = true;
    };
  }, [activeTool, emdSelected]);

  useEffect(() => {
    if (activeTool !== 'dataSelect') return;
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getDataSelectTableList', params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectTableOptions(Array.isArray(data?.tables) ? data.tables : []);
        setDataSelectTable('');
        setDataSelectField('');
        setDataSelectValue('');
        setDataSelectFieldOptions([]);
        setDataSelectValueOptions([]);
      })
      .catch(() => {
        if (!cancelled) setDataSelectTableOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'dataSelect' || !dataSelectTable) {
      setDataSelectFieldOptions([]);
      setDataSelectField('');
      setDataSelectValueOptions([]);
      setDataSelectValue('');
      return;
    }
    let cancelled = false;
    call('', 'POST', {
      service: 'devTestService',
      action: 'getDataSelectFieldList',
      params: { table: dataSelectTable },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectFieldOptions(Array.isArray(data?.fields) ? data.fields : []);
        setDataSelectField('');
        setDataSelectValueOptions([]);
        setDataSelectValue('');
      })
      .catch(() => {
        if (!cancelled) setDataSelectFieldOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool, dataSelectTable]);

  useEffect(() => {
    if (activeTool !== 'dataSelect' || !dataSelectTable || !dataSelectField) {
      setDataSelectValueOptions([]);
      setDataSelectValue('');
      return;
    }
    let cancelled = false;
    call('', 'POST', {
      service: 'devTestService',
      action: 'getDataSelectValueList',
      params: { table: dataSelectTable, field: dataSelectField },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectValueOptions(Array.isArray(data?.values) ? data.values : []);
        setDataSelectValue('');
      })
      .catch(() => {
        if (!cancelled) setDataSelectValueOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool, dataSelectTable, dataSelectField]);

  const map = mapContext?.mapInstanceRef?.current;

  useEffect(() => {
    if (!map || highlightLayerRef.current) return;
    const source = new VectorSource();
    highlightSourceRef.current = source;
    const highlightStroke = '#ffffff';
    const highlightFill = 'rgba(220, 00, 00, 0.55)';
    const highlightLine = 'rgba(220, 00, 00, 0.55)';
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const geom = feature.getGeometry();
        if (!geom) return undefined;
        const type = geom.getType();
        if (type === 'Point' || type === 'MultiPoint') {
          return new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: highlightFill }),
              stroke: new Stroke({ color: highlightStroke, width: 2 }),
            }),
          });
        }
        if (type === 'LineString' || type === 'MultiLineString') {
          return [
            new Style({ stroke: new Stroke({ color: highlightStroke, width: 7 }) }),
            new Style({ stroke: new Stroke({ color: highlightLine, width: 5 }) }),
          ];
        }
        return new Style({
          stroke: new Stroke({ color: highlightStroke, width: 3 }),
          fill: new Fill({ color: highlightFill }),
        });
      },
      properties: { listHighlightLayer: true },
    });
    layer.set('listHighlightLayer', true);
    map.getLayers().push(layer);
    highlightLayerRef.current = layer;

    const selSource = new VectorSource();
    selectionSourceRef.current = selSource;
    const RADAR_RADIUS = 52;
    const RADAR_CANVAS_SIZE = 120;
    const selectionLayer = new VectorLayer({
      source: selSource,
      style: (feature) => {
        const phase = pulsePhaseRef.current;
        const pulse = 0.7 + 0.4 * Math.sin(phase);
        if (feature.get('isRadarPoint')) {
          const canvas = document.createElement('canvas');
          canvas.width = RADAR_CANVAS_SIZE;
          canvas.height = RADAR_CANVAS_SIZE;
          const ctx = canvas.getContext('2d');
          if (!ctx) return new Style({});
          const cx = RADAR_CANVAS_SIZE / 2;
          const cy = RADAR_CANVAS_SIZE / 2;
          const r = RADAR_RADIUS * pulse;
          const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          gradient.addColorStop(0, `rgba(220, 38, 38, ${0.5 + 0.3 * Math.sin(phase)})`);
          gradient.addColorStop(0.5, 'rgba(220, 38, 38, 0.2)');
          gradient.addColorStop(1, 'rgba(220, 38, 38, 0)');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          return new Style({
            image: new Icon({
              img: canvas,
              width: RADAR_CANVAS_SIZE,
              height: RADAR_CANVAS_SIZE,
              anchor: [0.5, 0.5],
            }),
          });
        }
        const geomType = feature.getGeometry()?.getType();
        const isLineOrPolygon =
          geomType === 'LineString' ||
          geomType === 'MultiLineString' ||
          geomType === 'Polygon' ||
          geomType === 'MultiPolygon';
        if (isLineOrPolygon) {
          const whiteGlow = 0.6 + 0.4 * Math.sin(phase);
          return new Style({
            stroke: new Stroke({
              color: `rgba(255, 255, 255, ${whiteGlow})`,
              width: 6,
            }),
            fill: new Fill({ color: 'rgba(255, 255, 255, 0.08)' }),
          });
        }
        const strokeOpacity = 0.5 + 0.4 * Math.sin(phase);
        return new Style({
          stroke: new Stroke({
            color: `rgba(220, 38, 38, ${strokeOpacity})`,
            width: 6,
          }),
          fill: new Fill({ color: 'rgba(220, 38, 38, 0.15)' }),
        });
      },
    });
    selectionLayer.set('listSelectionLayer', true);
    map.getLayers().push(selectionLayer);
    selectionLayerRef.current = selectionLayer;

    return () => {
      map.removeLayer(selectionLayer);
      map.removeLayer(layer);
      selectionSourceRef.current = null;
      selectionLayerRef.current = null;
      highlightSourceRef.current = null;
      highlightLayerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!radarActive) return;
    let rafId: number;
    const loop = () => {
      pulsePhaseRef.current += 0.08;
      selectionSourceRef.current?.changed();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [radarActive]);

  const showCurrentListOnMap = useCallback(
    (rows: Record<string, unknown>[]) => {
      const source = highlightSourceRef.current;
      const mapInstance = mapContext?.mapInstanceRef?.current;
      if (!source || !mapInstance) return;
      const geoms: unknown[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const g = (row as Record<string, unknown>).geom;
        if (g == null) continue;
        const geom = typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
        if (geom && typeof geom === 'object' && 'type' in geom && 'coordinates' in geom) {
          geoms.push(geom);
        }
      }
      source.clear();
      if (geoms.length === 0) return;
      const geojson = {
        type: 'FeatureCollection' as const,
        features: geoms.map((geometry) => ({ type: 'Feature' as const, geometry, properties: {} })),
      };
      const format = new GeoJSON();
      const viewProj = mapInstance.getView().getProjection()?.getCode() || 'EPSG:3857';
      const features = format.readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      });
      source.addFeatures(features);
      const ext = source.getExtent();
      if (ext.every((v) => isFinite(v))) {
        mapInstance.getView().fit(ext, { padding: [48, 48, 48, 48], maxZoom: 16 });
      }
    },
    [mapContext]
  );

  const clearHighlight = useCallback(() => {
    highlightSourceRef.current?.clear();
  }, []);

  const showHighlightedRowOnMap = useCallback(() => {
    const mapInstance = mapContext?.mapInstanceRef?.current;
    const source = selectionSourceRef.current;
    if (!highlightedRow || !mapInstance || !source) return;
    const data = layerData[highlightedRow.layerId];
    const row = data?.rows[highlightedRow.rowIndex];
    if (!row || typeof row !== 'object') return;
    const g = (row as Record<string, unknown>).geom;
    if (g == null) return;
    const geom = typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
    if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return;
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, geometry: geom, properties: {} }],
    };
    const format = new GeoJSON();
    const viewProj = mapInstance.getView().getProjection()?.getCode() || 'EPSG:3857';
    const features = format.readFeatures(geojson, {
      dataProjection: 'EPSG:4326',
      featureProjection: viewProj,
    });
    source.clear();
    if (features.length === 0) return;
    const geomType = features[0].getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') {
      features[0].set('isRadarPoint', true);
    }
    source.addFeatures(features);
    const ext = source.getExtent();
    if (ext.every((v) => isFinite(v))) {
      mapInstance.getView().fit(ext, { padding: [80, 80, 80, 80], maxZoom: 16 });
    }
    setRadarActive(true);
  }, [mapContext, highlightedRow, layerData]);

  useEffect(() => {
    if (!highlightedRow) {
      selectionSourceRef.current?.clear();
      setRadarActive(false);
    } else {
      showHighlightedRowOnMap();
    }
  }, [highlightedRow, showHighlightedRowOnMap]);

  useEffect(() => {
    const toLoad = expandedLayers.filter((tableName) => tableName && layerData[tableName] === undefined);
    if (toLoad.length === 0) return;
    setLayerData((prev) => {
      const next = { ...prev };
      toLoad.forEach((tableName) => {
        next[tableName] = { fields: [], rows: [], loading: true, error: null, page: 1, total: 0 };
      });
      return next;
    });
    toLoad.forEach((tableName) => {
      const fieldsPromise = fetch(`/api/config/defineLayer/fields/${encodeURIComponent(tableName)}`).then((r) =>
        r.json()
      );
      const dataPromise = call('', 'POST', {
        service: 'standardService',
        action: 'getTableData',
        params: { table: tableName, limit: PAGE_SIZE, offset: 0 },
      });
      Promise.all([fieldsPromise, dataPromise])
        .then(([fieldsRes, dataRes]) => {
          const rawFields = (fieldsRes?.data ?? fieldsRes) as DefineFieldRow[] | undefined;
          const fieldsList = Array.isArray(rawFields)
            ? rawFields
                .filter((f) => String(f.define_field_show_list ?? '').toLowerCase() === 'true')
                .sort((a, b) => {
                  const idxA = parseInt(String(a.define_field_idx ?? '999999'), 10);
                  const idxB = parseInt(String(b.define_field_idx ?? '999999'), 10);
                  return idxA - idxB;
                })
            : [];
          const data = dataRes?.data ?? dataRes;
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          const total = typeof data?.total === 'number' ? data.total : 0;
          setLayerData((prev) => ({
            ...prev,
            [tableName]: { fields: fieldsList, rows, loading: false, error: null, page: 1, total },
          }));
          showCurrentListOnMap(rows);
        })
        .catch((err) => {
          const msg = err?.message ?? String(err);
          setLayerData((prev) => ({
            ...prev,
            [tableName]: { fields: [], rows: [], loading: false, error: msg, page: 1, total: 0 },
          }));
        });
    });
  }, [expandedLayers, showCurrentListOnMap]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleLayer = (layerId: string) => {
    setExpandedLayers((prev) => {
      const isRemoving = prev.includes(layerId);
      const next = isRemoving ? prev.filter((id) => id !== layerId) : [...prev, layerId];
      if (isRemoving) clearHighlight();
      return next;
    });
  };

  const loadPage = (tableName: string, page: number) => {
    const current = layerData[tableName];
    if (!current?.fields.length) return;
    const savedScrollTop = listScrollRef.current?.scrollTop ?? 0;
    setLayerData((prev) => ({
      ...prev,
      [tableName]: { ...prev[tableName], loading: true, error: null },
    }));
    setHighlightedRow((prev) => (prev?.layerId === tableName ? null : prev));
    call('', 'POST', {
      service: 'standardService',
      action: 'getTableData',
      params: { table: tableName, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    })
      .then((res) => {
        const data = res?.data ?? res;
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const total = typeof data?.total === 'number' ? data.total : current.total;
        setLayerData((prev) => ({
          ...prev,
          [tableName]: {
            ...prev[tableName],
            fields: current.fields,
            rows,
            loading: false,
            error: null,
            page,
            total,
          },
        }));
        setTimeout(() => {
          if (listScrollRef.current) listScrollRef.current.scrollTop = savedScrollTop;
        }, 0);
        showCurrentListOnMap(rows);
      })
      .catch((err) => {
        const msg = err?.message ?? String(err);
        setLayerData((prev) => ({
          ...prev,
          [tableName]: {
            ...prev[tableName],
            loading: false,
            error: msg,
          },
        }));
      });
  };

  return (
    <div ref={panelRef} className={cn(panelClassName, 'opacity-[0.95]')} style={{ width: `${width}px` }}>
      {resizeHandle}

      {/* 공간검색 */}
      <div className="border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-sm font-bold text-primary">공간검색</h4>
          <span className="text-xs text-slate-500 text-right shrink-0">
            도형·행정경계·다른 테이블 속성으로 영역을 지정합니다.
          </span>
        </div>
        <div className="flex items-stretch w-full gap-2">
          {SPATIAL_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
                className={cn(
                  'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 py-2 rounded border transition-colors bg-white',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                )}
                title={tool.label}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setActiveTool('rectangle')}
            className="flex flex-1 min-w-0 flex-col items-center justify-center gap-1 py-2 rounded border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:text-primary"
            title="초기화"
          >
            <RefreshCw className="h-5 w-5 shrink-0" strokeWidth={2} />
          </button>
        </div>
        {activeTool === 'emdRi' && (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">읍면동</label>
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
              <label className="block text-xs font-medium text-slate-600 mb-1">리</label>
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
              <label className="block text-xs font-medium text-slate-600 mb-1">테이블</label>
              <select
                value={dataSelectTable}
                onChange={(e) => setDataSelectTable(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary"
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
              <label className="block text-xs font-medium text-slate-600 mb-1">필드</label>
              <select
                value={dataSelectField}
                onChange={(e) => setDataSelectField(e.target.value)}
                disabled={!dataSelectTable}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">필드 선택</option>
                {dataSelectFieldOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">값</label>
              <select
                value={dataSelectValue}
                onChange={(e) => setDataSelectValue(e.target.value)}
                disabled={!dataSelectField}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">값 선택</option>
                {dataSelectValueOptions.map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Layer groups (scrollable) - 켜진 레이어 기준, defineLayer 메타로 그룹화, 스크롤바 숨김 */}
      <div
        ref={listScrollRef}
        className="flex-1 overflow-y-auto min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {layerGroups.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            지도에서 레이어를 켜면 여기에 목록이 표시됩니다.
          </div>
        )}
        {layerGroups.map((group) => {
          const isGroupOpen = expandedGroups.includes(group.id);
          const groupCount = group.layers.length;

          return (
            <div
              key={group.id}
              className={cn(
                'border-b border-slate-200 border-l-4',
                isGroupOpen ? 'border-l-primary' : 'border-l-slate-200'
              )}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-primary/10',
                  isGroupOpen && 'bg-primary/15'
                )}
              >
                {isGroupOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                )}
                <span
                  className={cn(
                    'text-[14px] font-semibold',
                    isGroupOpen ? 'text-primary' : 'text-slate-800'
                  )}
                >
                  {group.name}
                </span>
                <span
                  className={cn(
                    'ml-auto rounded-full px-2 py-0.5 text-[12px] font-medium',
                    isGroupOpen ? 'bg-primary/25 text-primary' : 'bg-slate-200 text-slate-600'
                  )}
                >
                  {groupCount}개 레이어
                </span>
              </button>

              {isGroupOpen && (
                <div className="bg-primary/5">
                  {group.layers.map((layer) => {
                    const isLayerOpen = expandedLayers.includes(layer.id);
                    const data = layerData[layer.tableName];

                    return (
                      <div key={layer.id}>
                        <button
                          type="button"
                          onClick={() => toggleLayer(layer.id)}
                          className={cn(
                            'flex w-full items-center gap-1 py-1 pl-7 pr-2 text-left transition-colors hover:bg-slate-100',
                            isLayerOpen && 'bg-slate-100'
                          )}
                        >
                          {isLayerOpen ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-primary" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                          )}
                          <span
                            className={cn(
                              'text-[13px]',
                              isLayerOpen ? 'font-semibold text-primary' : 'font-medium text-slate-700'
                            )}
                          >
                            {layer.name}
                          </span>
                          <span
                            className={cn(
                              'ml-auto rounded-full px-1.5 py-px text-[12px] font-medium',
                              isLayerOpen ? 'bg-primary/10 text-primary' : 'text-slate-500'
                            )}
                          >
                            {(data?.total ?? layerTotals[layer.tableName]) != null
                              ? `${(data?.total ?? layerTotals[layer.tableName]).toLocaleString()}건`
                              : '...'}
                          </span>
                        </button>

                        {isLayerOpen && (
                          <div className="bg-white">
                            {!data && (
                              <div className="px-4 py-3 text-[12px] text-slate-500">로딩 중...</div>
                            )}
                            {data?.loading && data.rows.length === 0 && (
                              <div className="px-4 py-3 text-[12px] text-slate-500">로딩 중...</div>
                            )}
                            {data?.error && (
                              <div className="px-4 py-3 text-[12px] text-red-600">{data.error}</div>
                            )}
                            {data && !data.error && data.fields.length > 0 && (data.rows.length > 0 || !data.loading) && (
                              <>
                                <div className="flex items-center border-y border-slate-200 bg-slate-100/60 px-4 py-1.5 text-[12px] font-semibold text-slate-600">
                                  {data.fields.map((f) => (
                                    <span
                                      key={String(f.define_field_name)}
                                      className="flex-1 min-w-0 truncate pl-2 first:pl-0"
                                      title={String(f.define_field_kor_name ?? f.define_field_name)}
                                    >
                                      {String(f.define_field_kor_name ?? f.define_field_name)}
                                    </span>
                                  ))}
                                </div>
                                {data.rows.length === 0 && (
                                  <div className="px-4 py-3 text-[12px] text-slate-500">데이터 없음</div>
                                )}
                                {data.rows.map((row, rowIndex) => {
                                  const isHighlighted =
                                    highlightedRow?.layerId === layer.tableName && highlightedRow?.rowIndex === rowIndex;
                                  return (
                                  <button
                                    key={rowIndex}
                                    type="button"
                                    onClick={() =>
                                      setHighlightedRow(
                                        isHighlighted ? null : { layerId: layer.tableName, rowIndex }
                                      )
                                    }
                                    className={cn(
                                      'flex w-full items-center border-b border-slate-100 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-primary/5',
                                      isHighlighted && 'bg-primary/10'
                                    )}
                                  >
                                    {data.fields.map((f) => (
                                      <span
                                        key={String(f.define_field_name)}
                                        className="flex-1 min-w-0 truncate pl-2 first:pl-0 text-slate-800"
                                      >
                                        {row[String(f.define_field_name)] != null
                                          ? String(row[String(f.define_field_name)])
                                          : '-'}
                                      </span>
                                    ))}
                                  </button>
                                );
                                })}
                                <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 bg-slate-50/80">
                                  <span className="text-[11px] text-slate-500">
                                    {data.rows.length === 0
                                      ? '0건'
                                      : `${(data.page - 1) * PAGE_SIZE + 1}–${(data.page - 1) * PAGE_SIZE + data.rows.length}건`}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={data.page <= 1 || data.loading}
                                      onClick={() => loadPage(layer.tableName, data.page - 1)}
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                                    >
                                      이전
                                    </button>
                                    <span className="px-2 text-[11px] text-slate-600">
                                      {data.page}페이지
                                    </span>
                                    <button
                                      type="button"
                                      disabled={data.rows.length < PAGE_SIZE || data.loading}
                                      onClick={() => loadPage(layer.tableName, data.page + 1)}
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                                    >
                                      다음
                                    </button>
                                  </div>
                                </div>
                              </>
                            )}
                            {data && !data.loading && !data.error && data.fields.length === 0 && data.rows.length > 0 && (
                              <div className="px-4 py-3 text-[12px] text-slate-500">
                                레이어 속성이 정의되지 않아 데이터를 표시할 수 없습니다.
                              </div>
                            )}
                          </div>
                        )}
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
