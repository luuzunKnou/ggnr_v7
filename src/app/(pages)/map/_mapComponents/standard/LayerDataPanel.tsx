'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { call } from '@/lib/api';
import {
  FileText,
  FileImage,
  History,
  Paperclip,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from '../MapContext';
import { getRowValueByField } from './defineLayerRowUtils';
import { getLegendUrl, type IdentifyLayerResult, type IdentifyFeatureItem } from '../hooks/useFeatureIdentify';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill, Circle as CircleStyle, Icon } from 'ol/style';

type DefineFieldRow = {
  define_field_name?: string;
  define_field_kor_name?: string;
  define_field_idx?: string;
  define_field_show_list?: string;
  define_field_show_detail?: string;
  define_field_is_key?: string;
  [key: string]: unknown;
};

type DetailTab = 'basic' | 'history' | 'attach';
type HistoryEventType = '점검' | '보수' | '이상발생' | '준공';

interface TimelineEvent {
  id: number;
  date: string;
  type: HistoryEventType;
  title: string;
  description: string;
  author: string;
}

const HISTORY_TYPE_CONFIG: Record<
  HistoryEventType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  점검: { icon: FileText, color: 'text-sky-600', bg: 'bg-sky-100' },
  보수: { icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-100' },
  이상발생: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
  준공: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
};

const SAMPLE_HISTORY: TimelineEvent[] = [
  { id: 1, date: '2025-12-15', type: '점검', title: '정기 점검 완료', description: '외관 상태 양호, 누수 징후 없음', author: '김상수' },
  { id: 2, date: '2025-09-03', type: '보수', title: '밸브 교체 작업', description: '노후 밸브 2개소 교체 완료', author: '박정비' },
  { id: 3, date: '2025-06-20', type: '이상발생', title: '미세 누수 발견', description: '연결부 미세 누수 확인, 긴급 보수 필요', author: '이점검' },
  { id: 4, date: '2024-03-10', type: '준공', title: '시설물 설치 준공', description: '안동 광역상수도 1구간 관로 설치 완료', author: '최공사' },
];

interface AttachmentItem {
  id: number;
  name: string;
  type: 'image' | 'document';
  size: string;
  date: string;
}

const SAMPLE_ATTACHMENTS: AttachmentItem[] = [
  { id: 1, name: '관로_현황사진_001.jpg', type: 'image', size: '2.4 MB', date: '2025-12-15' },
  { id: 2, name: '관로_현황사진_002.jpg', type: 'image', size: '1.8 MB', date: '2025-12-15' },
  { id: 3, name: '점검보고서_202512.pdf', type: 'document', size: '540 KB', date: '2025-12-15' },
  { id: 4, name: '준공도면_1구간.pdf', type: 'document', size: '12.3 MB', date: '2024-03-10' },
];

interface InfoField {
  /** 고유 키 (define_field_name 등). label은 한글명이라 중복 가능 */
  fieldKey: string;
  label: string;
  value: string | number;
  unit?: string;
  highlight?: boolean;
}

function InfoSection({ title, fields, defaultOpen = true }: { title: string; fields: InfoField[]; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left transition-colors hover:bg-slate-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
        <span className="text-[12px] font-semibold text-[#666]">{title}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-2">
          <div className="overflow-hidden rounded border border-slate-200">
            {fields.map((field, index) => (
              <div key={field.fieldKey} className={cn('flex', index !== fields.length - 1 && 'border-b border-slate-200')}>
                <div className="flex w-[100px] shrink-0 items-center bg-slate-100 px-2.5 py-1.5">
                  <span className="text-[11px] text-[#666]">{field.label}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center px-2.5 py-1.5">
                  <span className={cn('text-[11px]', field.highlight ? 'font-medium text-primary' : 'text-[#666]')}>
                    {field.value}
                    {field.unit != null && field.unit !== '' && <span className="ml-0.5 text-slate-500">{field.unit}</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE_LIST = 30;
const PAGE_SIZE_DETAIL = 7;

/** 데이터 설정(define_field_is_key)에 지정된 키 필드명으로 행에서 키값 추출 */
function getRowKey(row: Record<string, unknown>, keyFieldName: string | null): string | number | null {
  if (!keyFieldName) return null;
  const v = row[keyFieldName];
  if (v == null || v === '') return null;
  return typeof v === 'number' ? v : String(v);
}

type LayerDataPanelProps = {
  dataTable: string;
  onClose?: () => void;
  onDataKeyChange?: (keyValue: string | number | null) => void;
  initialDataKey?: string;
};

function flattenIdentifyResults(
  results: { tableName: string; korName: string; features: { titleValue: string; data: Record<string, unknown> }[] }[]
): { layer: IdentifyLayerResult; feature: IdentifyFeatureItem; index: number }[] {
  const out: { layer: IdentifyLayerResult; feature: IdentifyFeatureItem; index: number }[] = [];
  let index = 0;
  for (const layer of results) {
    for (const feature of layer.features) {
      out.push({ layer: layer as IdentifyLayerResult, feature, index });
      index += 1;
    }
  }
  return out;
}

type ActiveLayerInfo = { tableName: string; name: string; schema: string };

export function LayerDataPanel({ dataTable, onClose, onDataKeyChange, initialDataKey }: LayerDataPanelProps) {
  const mapContext = useMapContext();
  const mapInstanceRef = mapContext?.mapInstanceRef;
  const spatialFilterWkt = mapContext?.spatialFilterWkt ?? null;
  const [activeLayer, setActiveLayer] = useState<ActiveLayerInfo | null>(null);
  const identifyResultList = mapContext?.identifyResultList ?? null;
  const identifySelectedRow = mapContext?.identifySelectedRow ?? null;
  const setIdentifySelectedRow = mapContext?.setIdentifySelectedRow;
  const isIdentifyMode = identifyResultList != null && identifyResultList.results.length > 0;
  const identifyFlat = isIdentifyMode ? flattenIdentifyResults(identifyResultList.results) : [];

  const [fields, setFields] = useState<DefineFieldRow[]>([]);
  /** 상세보기 기본정보/상세정보에 쓸 전체 필드(목록 노출 여부와 무관) */
  const [detailFields, setDetailFields] = useState<DefineFieldRow[]>([]);
  const [keyFieldName, setKeyFieldName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null);
  const [selectedRowData, setSelectedRowData] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('basic');
  const listScrollRef = useRef<HTMLDivElement>(null);
  const selectedIdentifyRowRef = useRef<HTMLButtonElement | null>(null);
  const highlightSourceRef = useRef<VectorSource | null>(null);
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectionSourceRef = useRef<VectorSource | null>(null);
  const selectionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);
  const prevLayerRef = useRef<string | null>(null);
  const [selectedIdentifyIndex, setSelectedIdentifyIndex] = useState<number | null>(null);
  const [identifyPage, setIdentifyPage] = useState(1);
  const prevIdentifyListSizeRef = useRef<number>(PAGE_SIZE_LIST);
  const prevIdentifyPageRef = useRef<number>(1);

  useEffect(() => {
    if (!isIdentifyMode || identifyFlat.length <= 1) return;
    setIdentifyPage(1);
    prevIdentifyListSizeRef.current = PAGE_SIZE_LIST;
    prevIdentifyPageRef.current = 1;
  }, [isIdentifyMode, identifyFlat.length]);

  // identifyPage가 바뀔 때마다 ref 동기화 (이전/다음 클릭 등). prevIdentifyListSizeRef는 상세 토글 effect에서만 갱신
  useEffect(() => {
    if (isIdentifyMode && identifyFlat.length > 1) prevIdentifyPageRef.current = identifyPage;
  }, [identifyPage, isIdentifyMode, identifyFlat.length]);

  // 상세 열림/닫힘 시 7↔30 전환: 선택된 항목이 있으면 그 페이지로, 없으면 이전에 보던 첫 항목이 포함된 페이지로 이동
  useEffect(() => {
    if (!isIdentifyMode || identifyFlat.length <= 1) return;
    const listSize = selectedRowData != null ? PAGE_SIZE_DETAIL : PAGE_SIZE_LIST;
    const total = identifyFlat.length;
    const maxPage = Math.max(1, Math.ceil(total / listSize));

    let targetPage: number;
    if (selectedIdentifyIndex != null) {
      targetPage = Math.min(maxPage, Math.floor(selectedIdentifyIndex / listSize) + 1);
      setIdentifyPage(targetPage);
    } else {
      const prevSize = prevIdentifyListSizeRef.current;
      const prevPage = prevIdentifyPageRef.current;
      const firstVisibleIndex = (prevPage - 1) * prevSize;
      targetPage = Math.min(maxPage, Math.max(1, Math.floor(firstVisibleIndex / listSize) + 1));
      setIdentifyPage(targetPage);
    }
    prevIdentifyListSizeRef.current = listSize;
    prevIdentifyPageRef.current = targetPage;
  }, [selectedRowData, isIdentifyMode, identifyFlat.length, selectedIdentifyIndex]);

  useEffect(() => {
    if (!dataTable) { setActiveLayer(null); return; }
    let cancelled = false;
    fetch('/api/config/defineLayer')
      .then((r) => r.json())
      .then((res: { data?: { define_table_name?: string; define_table_kor_name?: string; define_table_schema?: string }[] }) => {
        if (cancelled) return;
        const tables = Array.isArray(res?.data) ? res.data : [];
        const row = tables.find((t) => String(t?.define_table_name ?? '').trim() === dataTable.trim());
        if (row) {
          setActiveLayer({
            tableName: dataTable.trim(),
            name: String(row.define_table_kor_name ?? row.define_table_name ?? dataTable).trim() || dataTable,
            schema: String(row.define_table_schema ?? 'layer').trim() || 'layer',
          });
        } else {
          setActiveLayer({ tableName: dataTable.trim(), name: dataTable.trim(), schema: 'layer' });
        }
      })
      .catch(() => {
        if (!cancelled) setActiveLayer({ tableName: dataTable.trim(), name: dataTable.trim(), schema: 'layer' });
      });
    return () => { cancelled = true; };
  }, [dataTable]);

  const selectedRow = selectedRowData;
  const pageSize = selectedRow != null ? PAGE_SIZE_DETAIL : PAGE_SIZE_LIST;

  const map = mapContext?.mapInstanceRef?.current;

  useEffect(() => {
    if (!map || highlightLayerRef.current) return;
    const source = new VectorSource();
    highlightSourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const geom = feature.getGeometry();
        if (!geom) return undefined;
        const type = geom.getType();
        if (type === 'Point' || type === 'MultiPoint') {
          return new Style({
            image: new CircleStyle({ radius: 6, fill: new Fill({ color: 'rgba(220, 00, 00, 0.55)' }), stroke: new Stroke({ color: '#ffffff', width: 2 }) }),
          });
        }
        if (type === 'LineString' || type === 'MultiLineString') {
          return [
            new Style({ stroke: new Stroke({ color: '#ffffff', width: 7 }) }),
            new Style({ stroke: new Stroke({ color: 'rgba(220, 00, 00, 0.55)', width: 5 }) }),
          ];
        }
        return new Style({ stroke: new Stroke({ color: '#ffffff', width: 3 }), fill: new Fill({ color: 'rgba(220, 00, 00, 0.55)' }) });
      },
      properties: { listHighlightLayer: true },
    });
    layer.set('listHighlightLayer', true);
    map.getLayers().push(layer);
    highlightLayerRef.current = layer;

    const RADAR_CANVAS_SIZE = 120;
    const RADAR_RADIUS = 52;
    const selSource = new VectorSource();
    selectionSourceRef.current = selSource;
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
          return new Style({ image: new Icon({ img: canvas, width: RADAR_CANVAS_SIZE, height: RADAR_CANVAS_SIZE, anchor: [0.5, 0.5] }) });
        }
        const geomType = feature.getGeometry()?.getType();
        const isLineOrPolygon = geomType === 'LineString' || geomType === 'MultiLineString' || geomType === 'Polygon' || geomType === 'MultiPolygon';
        if (isLineOrPolygon) {
          const whiteGlow = 0.6 + 0.4 * Math.sin(phase);
          return new Style({ stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteGlow})`, width: 6 }), fill: new Fill({ color: 'rgba(255, 255, 255, 0.08)' }) });
        }
        const strokeOpacity = 0.5 + 0.4 * Math.sin(phase);
        return new Style({ stroke: new Stroke({ color: `rgba(220, 38, 38, ${strokeOpacity})`, width: 6 }), fill: new Fill({ color: 'rgba(220, 38, 38, 0.15)' }) });
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

  /** 목록 데이터를 지도에 표시만 함. 레이어 on/off 시 지도 이동·줌은 하지 않음 */
  const showCurrentListOnMap = useCallback(
    (dataRows: Record<string, unknown>[]) => {
      const source = highlightSourceRef.current;
      const mapInstance = mapInstanceRef?.current;
      if (!source || !mapInstance) return;
      const geoms: unknown[] = [];
      for (const row of dataRows) {
        if (!row || typeof row !== 'object') continue;
        const g = (row as Record<string, unknown>).geom;
        if (g == null) continue;
        const geom = typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
        if (geom && typeof geom === 'object' && 'type' in geom && 'coordinates' in geom) geoms.push(geom);
      }
      source.clear();
      if (geoms.length === 0) return;
      const geojson = { type: 'FeatureCollection' as const, features: geoms.map((geometry) => ({ type: 'Feature' as const, geometry, properties: {} })) };
      const format = new GeoJSON();
      const viewProj = mapInstance.getView().getProjection()?.getCode() || 'EPSG:3857';
      const features = format.readFeatures(geojson, { dataProjection: 'EPSG:4326', featureProjection: viewProj });
      source.addFeatures(features);
      // 지도 이동/줌 없음 (레이어 목록에서 껐다 켰다 할 때 뷰 유지)
    },
    [mapInstanceRef]
  );

  const showHighlightedRowOnMap = useCallback(
    (rowIndex: number) => {
      const mapInstance = mapContext?.mapInstanceRef?.current;
      const source = selectionSourceRef.current;
      if (!mapInstance || !source) return;
      const row = rows[rowIndex];
      if (!row || typeof row !== 'object') return;
      const g = (row as Record<string, unknown>).geom;
      if (g == null) return;
      const geom = typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
      if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return;
      const geojson = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: geom, properties: {} }] };
      const format = new GeoJSON();
      const viewProj = mapInstance.getView().getProjection()?.getCode() || 'EPSG:3857';
      const features = format.readFeatures(geojson, { dataProjection: 'EPSG:4326', featureProjection: viewProj });
      source.clear();
      if (features.length === 0) return;
      const geomType = features[0].getGeometry()?.getType();
      if (geomType === 'Point' || geomType === 'MultiPoint') features[0].set('isRadarPoint', true);
      source.addFeatures(features);
      const ext = source.getExtent();
      if (ext.every((v) => isFinite(v))) mapInstance.getView().fit(ext, { padding: [80, 80, 80, 80], maxZoom: 16 });
      setRadarActive(true);
    },
    [mapContext, rows]
  );

  /** 지도에서 선택된 항목 리스트 클릭 시: 해당 도형 강조만 (지도 이동/확대 없음) */
  const showIdentifyFeatureOnMap = useCallback(
    (record: Record<string, unknown>) => {
      const mapInstance = mapContext?.mapInstanceRef?.current;
      const source = selectionSourceRef.current;
      if (!mapInstance || !source) return;
      const g = record?.geom;
      if (g == null) return;
      const geom = typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
      if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return;
      const geojson = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: geom, properties: {} }] };
      const format = new GeoJSON();
      const viewProj = mapInstance.getView().getProjection()?.getCode() || 'EPSG:3857';
      const features = format.readFeatures(geojson, { dataProjection: 'EPSG:4326', featureProjection: viewProj });
      source.clear();
      if (features.length === 0) return;
      const geomType = features[0].getGeometry()?.getType();
      if (geomType === 'Point' || geomType === 'MultiPoint') features[0].set('isRadarPoint', true);
      source.addFeatures(features);
      setRadarActive(true);
    },
    [mapContext]
  );

  useEffect(() => {
    if (highlightedRow == null) {
      if (!isIdentifyMode) {
        selectionSourceRef.current?.clear();
        setRadarActive(false);
      }
    } else {
      showHighlightedRowOnMap(highlightedRow);
    }
  }, [highlightedRow, isIdentifyMode, showHighlightedRowOnMap]);

  useEffect(() => {
    if (selectedIdentifyIndex == null) return;
    const listSize = selectedRowData != null ? PAGE_SIZE_DETAIL : PAGE_SIZE_LIST;
    const targetPage = Math.floor(selectedIdentifyIndex / listSize) + 1;
    setIdentifyPage((p) => (p !== targetPage ? targetPage : p));
    selectedIdentifyRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdentifyIndex, selectedRowData]);

  useEffect(() => {
    if (!activeLayer) return;
    const isIdentify = identifyResultList != null && identifyResultList.results.length > 0;
    // 같은 테이블이면 재조회하지 않음 (앱 안에서 행 선택 시 전체 목록 유지)
    if (prevLayerRef.current === activeLayer.tableName && !isIdentify) return;
    prevLayerRef.current = activeLayer.tableName;

    setFields([]);
    setDetailFields([]);
    setKeyFieldName(null);
    if (!isIdentify) {
      setRows([]);
      setHighlightedRow(null);
      setSelectedRowData(null);
      setSelectedIdentifyIndex(null);
    }
    setLoading(true);
    setError(null);
    setPage(1);
    setTotal(0);
    if (!isIdentify) setActiveTab('basic');
    if (!isIdentify) {
      highlightSourceRef.current?.clear();
      selectionSourceRef.current?.clear();
      setRadarActive(false);
    }

    const tableDataParams = {
      table: activeLayer.tableName,
      schema: activeLayer.schema,
      limit: PAGE_SIZE_LIST,
      offset: 0,
      ...(spatialFilterWkt ? { spatialWkt: spatialFilterWkt, spatialSrid: 5181 } : {}),
    };
    const fieldsPromise = fetch(`/api/config/defineLayer/fields/${encodeURIComponent(activeLayer.tableName)}`).then((r) => r.json());
    const useKey = !isIdentify && initialDataKey != null && String(initialDataKey).trim() !== '';
    const dataPromise = isIdentify
      ? Promise.resolve({ rows: [] as Record<string, unknown>[], total: 0 })
      : useKey
      ? call('', 'POST', {
          service: 'standardService',
          action: 'getTableRowByKey',
          params: {
            table: activeLayer.tableName,
            schema: activeLayer.schema,
            keyValue: initialDataKey!.trim(),
          },
        })
      : call('', 'POST', {
          service: 'standardService',
          action: 'getTableData',
          params: tableDataParams,
        });

    Promise.all([fieldsPromise, dataPromise])
      .then(([fieldsRes, dataRes]) => {
        const rawFields = (fieldsRes?.data ?? fieldsRes) as DefineFieldRow[] | undefined;
        const sortedAll = Array.isArray(rawFields)
          ? [...rawFields].sort((a, b) => parseInt(String(a.define_field_idx ?? '999999'), 10) - parseInt(String(b.define_field_idx ?? '999999'), 10))
          : [];
        const fieldsList = sortedAll.filter((f) => String(f.define_field_show_list ?? '').toLowerCase() === 'true');
        setFields(fieldsList);
        const excludeFromDetail = (name: string) => {
          const n = name.trim().toLowerCase();
          return n === 'gid' || n === 'geom';
        };
        setDetailFields(sortedAll.filter((f) => !excludeFromDetail(String(f.define_field_name ?? ''))));
        const keyField = Array.isArray(rawFields) ? rawFields.find((f) => String(f.define_field_is_key ?? '').toLowerCase() === 'true') : null;
        setKeyFieldName(keyField ? String(keyField.define_field_name ?? '').trim() || null : null);

        if (useKey) {
          const keyData = dataRes?.data ?? dataRes;
          const row = (keyData?.row ?? null) as Record<string, unknown> | null;
          if (row) {
            setRows([row]);
            setTotal(1);
            setSelectedRowData(row);
            setHighlightedRow(0);
            setPage(1);
            showCurrentListOnMap([row]);
          } else {
            call('', 'POST', {
              service: 'standardService',
              action: 'getTableData',
              params: tableDataParams,
            }).then((res) => {
              const d = res?.data ?? res;
              const dataRows = Array.isArray(d?.rows) ? d.rows : [];
              const dataTotal = typeof d?.total === 'number' ? d.total : 0;
              setRows(dataRows);
              setTotal(dataTotal);
              showCurrentListOnMap(dataRows);
            });
          }
        } else if (!isIdentify) {
          const data = dataRes?.data ?? dataRes;
          const dataRows = Array.isArray(data?.rows) ? data.rows : [];
          const dataTotal = typeof data?.total === 'number' ? data.total : 0;
          setRows(dataRows);
          setTotal(dataTotal);
          showCurrentListOnMap(dataRows);
        } else {
          setRows([]);
          setTotal(identifyResultList?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.message ?? String(err));
        setLoading(false);
      });
  }, [activeLayer, spatialFilterWkt, showCurrentListOnMap, initialDataKey, identifyResultList]);

  // 앱 안에서 행 선택 시 URL의 dataKey만 반영 → 기존 목록 유지, 선택/하이라이트만 동기화
  useEffect(() => {
    if (!activeLayer || isIdentifyMode || !keyFieldName || rows.length === 0) return;
    const key = initialDataKey != null ? String(initialDataKey).trim() : '';
    if (key === '') return;
    const idx = rows.findIndex((r) => {
      const rowKey = getRowKey(r, keyFieldName);
      return rowKey != null && String(rowKey) === key;
    });
    if (idx >= 0) {
      setSelectedRowData(rows[idx] as Record<string, unknown>);
      setHighlightedRow(idx);
      setActiveTab('basic');
    }
  }, [activeLayer, isIdentifyMode, keyFieldName, initialDataKey, rows]);

  // 팝업에서 항목 클릭 후 패널 열렸을 때 해당 행 선택 및 상세 표시 + 지도에서 도형 강조만 (확대/이동 없음)
  useEffect(() => {
    if (!isIdentifyMode || identifySelectedRow == null || !setIdentifySelectedRow) return;
    const idx = identifyFlat.findIndex((item) => item.feature.data === identifySelectedRow);
    setSelectedRowData(identifySelectedRow);
    setSelectedIdentifyIndex(idx >= 0 ? idx : null);
    setActiveTab('basic');
    showIdentifyFeatureOnMap(identifySelectedRow);
    setIdentifySelectedRow(null);
  }, [isIdentifyMode, identifySelectedRow, identifyFlat, setIdentifySelectedRow, showIdentifyFeatureOnMap]);

  useEffect(() => {
    if (!activeLayer) {
      prevLayerRef.current = null;
      highlightSourceRef.current?.clear();
      selectionSourceRef.current?.clear();
      setRadarActive(false);
    }
  }, [activeLayer]);

  const loadPage = useCallback(
    (newPage: number, size?: number) => {
      if (!activeLayer) return;
      const ps = size ?? pageSize;
      const savedScrollTop = listScrollRef.current?.scrollTop ?? 0;
      setLoading(true);
      setError(null);

      call('', 'POST', {
        service: 'standardService',
        action: 'getTableData',
        params: {
          table: activeLayer.tableName,
          schema: activeLayer.schema,
          limit: ps,
          offset: (newPage - 1) * ps,
          ...(mapContext?.spatialFilterWkt ? { spatialWkt: mapContext.spatialFilterWkt, spatialSrid: 5181 } : {}),
        },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const dataRows = Array.isArray(data?.rows) ? data.rows : [];
          const dataTotal = typeof data?.total === 'number' ? data.total : total;
          setRows(dataRows);
          setTotal(dataTotal);
          setPage(newPage);
          setLoading(false);
          setTimeout(() => { if (listScrollRef.current) listScrollRef.current.scrollTop = savedScrollTop; }, 0);
          showCurrentListOnMap(dataRows);
        })
        .catch((err) => {
          setError(err?.message ?? String(err));
          setLoading(false);
        });
    },
    [activeLayer, total, pageSize, mapContext, showCurrentListOnMap]
  );

  const handleClose = () => {
    mapContext?.setIdentifyResultList?.(null);
    onClose?.();
  };

  const handleIdentifyItemClick = (item: { layer: IdentifyLayerResult; feature: IdentifyFeatureItem; index: number }) => {
    const { feature, index } = item;
    if (selectedIdentifyIndex === index && selectedRowData != null) {
      setSelectedRowData(null);
      setSelectedIdentifyIndex(null);
      selectionSourceRef.current?.clear();
      setRadarActive(false);
      return;
    }
    setSelectedRowData(feature.data);
    setSelectedIdentifyIndex(index);
    setActiveTab('basic');
    showIdentifyFeatureOnMap(feature.data);
  };

  const closeDetail = () => {
    if (selectedRowData == null) return;
    if (isIdentifyMode) {
      setSelectedRowData(null);
      setSelectedIdentifyIndex(null);
      return;
    }
    const firstItemOffset = (page - 1) * PAGE_SIZE_DETAIL;
    const newPage = Math.floor(firstItemOffset / PAGE_SIZE_LIST) + 1;
    setHighlightedRow(null);
    setSelectedRowData(null);
    onDataKeyChange?.(null);
    setRows([]);
    loadPage(newPage, PAGE_SIZE_LIST);
  };

  const handleRowClick = (rowIndex: number) => {
    if (highlightedRow === rowIndex && selectedRowData != null) {
      closeDetail();
    } else {
      const rowData = rows[rowIndex] as Record<string, unknown> | undefined;
      if (!rowData) return;
      const keyVal = getRowKey(rowData, keyFieldName);
      const wasDetailOpen = selectedRowData != null;
      if (wasDetailOpen) {
        setHighlightedRow(rowIndex);
        setSelectedRowData(rowData);
        setActiveTab('basic');
        onDataKeyChange?.(keyVal);
      } else {
        const absoluteOffset = (page - 1) * PAGE_SIZE_LIST + rowIndex;
        const newPage = Math.floor(absoluteOffset / PAGE_SIZE_DETAIL) + 1;
        const newRowIndex = absoluteOffset % PAGE_SIZE_DETAIL;
        setHighlightedRow(newRowIndex);
        setSelectedRowData(rowData);
        setRows([]);
        setActiveTab('basic');
        onDataKeyChange?.(keyVal);
        loadPage(newPage, PAGE_SIZE_DETAIL);
      }
    }
  };

  if (!activeLayer) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-400 px-4">
        좌측 패널에서 레이어를 선택하세요.
      </div>
    );
  }

  const hasDetail = selectedRow != null;

  /** 목록 컬럼: '목록 표시' 필드 > detailFields > rows의 키에서 gid/geom 제외한 자동 생성 */
  const autoFields: DefineFieldRow[] = (fields.length === 0 && detailFields.length === 0 && rows.length > 0)
    ? Object.keys(rows[0] as Record<string, unknown>)
        .filter((k) => { const n = k.toLowerCase(); return n !== 'gid' && n !== 'geom'; })
        .map((k) => ({ define_field_name: k, define_field_kor_name: k }))
    : [];
  const listFieldsAll = fields.length > 0 ? fields : detailFields.length > 0 ? detailFields : autoFields;
  const listFields = listFieldsAll.slice(0, 5);

  const detailTabs: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'basic', label: '기본정보', icon: FileText },
    { id: 'history', label: '이력관리', icon: History },
    { id: 'attach', label: '첨부파일', icon: Paperclip },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header (닫기 버튼은 페이징 영역 다음 버튼 뒤로 이동) */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 shrink-0 bg-white">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{activeLayer.name}</h3>
          <span className="text-[11px] text-slate-500">{activeLayer.tableName}</span>
        </div>
      </div>

      {/* List section (1건 선택 시 목록 숨기고 상세만 표시) */}
      <div
        className={cn(
          'flex flex-col overflow-hidden',
          isIdentifyMode && identifyFlat.length === 1 ? 'flex-0 min-h-0' : hasDetail ? 'flex-[3] min-h-0' : 'flex-1 min-h-0'
        )}
      >
        <div ref={listScrollRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loading && !isIdentifyMode && rows.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-slate-500">로딩 중...</div>
          )}
          {error && (
            <div className="px-4 py-6 text-center text-[12px] text-red-600">{error}</div>
          )}
          {isIdentifyMode && identifyFlat.length > 1 && (() => {
            const identifyListSize = selectedRowData != null ? PAGE_SIZE_DETAIL : PAGE_SIZE_LIST;
            const identifyTotal = identifyFlat.length;
            const offset = (identifyPage - 1) * identifyListSize;
            const visibleItems = identifyFlat.slice(offset, offset + identifyListSize);
            const maxIdentifyPage = Math.max(1, Math.ceil(identifyTotal / identifyListSize));
            return (
            <>
              <div className="flex items-center border-b border-slate-200 bg-slate-100/60 px-4 py-1.5 text-[12px] text-[#666] shrink-0">
                지도에서 선택된 항목
                <span className="ml-1.5 text-[11px] text-slate-500">
                  ({identifyResultList?.results?.length ?? 0}개 레이어, {identifyFlat.length}개 데이터)
                </span>
              </div>
              <div
                className="flex-1 min-h-0 overflow-y-auto"
                style={{ display: 'grid', gridTemplateRows: `repeat(${identifyListSize}, 1fr)` }}
              >
                {Array.from({ length: identifyListSize }, (_, i) => {
                  const item = visibleItems[i];
                  if (item == null) {
                    return <div key={`empty-${i}`} className="min-h-0" />;
                  }
                  const { layer, feature, index: idx } = item;
                  const isHighlighted = selectedIdentifyIndex === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      ref={isHighlighted ? selectedIdentifyRowRef : undefined}
                      onClick={() => handleIdentifyItemClick({ layer, feature, index: idx })}
                      className={cn(
                        'flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-[12px] transition-colors hover:bg-primary/5 min-h-0 overflow-hidden',
                        isHighlighted && 'bg-primary/10'
                      )}
                    >
                      <img
                        src={getLegendUrl(layer.tableName)}
                        alt=""
                        className="w-5 h-5 shrink-0 object-contain"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      <span className="min-w-0 truncate text-[#666]">
                        <span className="text-slate-700">{layer.korName}</span>
                        {feature.titleValue && (
                          <>
                            <span className="mx-1 text-slate-400">|</span>
                            <span>{feature.titleValue}</span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-1.5 bg-slate-50/80 shrink-0">
                <span className="text-[11px] text-[#666]">
                  {identifyTotal === 0
                    ? '0건'
                    : `${offset + 1}–${offset + visibleItems.length} / ${identifyTotal.toLocaleString()}건`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={identifyPage <= 1}
                    onClick={() => setIdentifyPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-[#666] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                  >
                    이전
                  </button>
                  <span className="px-1.5 text-[11px] text-[#666]">{identifyPage}페이지</span>
                  <button
                    type="button"
                    disabled={identifyPage >= maxIdentifyPage}
                    onClick={() => setIdentifyPage((p) => Math.min(maxIdentifyPage, p + 1))}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-[#666] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                  >
                    다음
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-[#666] transition-colors hover:bg-slate-100"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </>
            );
          })()}
          {!isIdentifyMode && !error && listFields.length > 0 && (rows.length > 0 || !loading) && (
            <>
              <div className="flex items-center border-b border-slate-200 bg-slate-100/60 px-4 py-1.5 text-[12px] font-semibold text-[#666] shrink-0">
                {listFields.map((f) => (
                  <span
                    key={String(f.define_field_name)}
                    className="flex-1 min-w-0 truncate pl-2 first:pl-0"
                    title={String(f.define_field_kor_name ?? f.define_field_name)}
                  >
                    {String(f.define_field_kor_name ?? f.define_field_name)}
                  </span>
                ))}
              </div>
              {rows.length === 0 && (
                <div className="px-4 py-6 text-center text-[12px] text-slate-500">데이터 없음</div>
              )}
              <div
                className="flex-1 min-h-0"
                style={{ display: 'grid', gridTemplateRows: `repeat(${pageSize}, 1fr)` }}
              >
                {rows.map((row, rowIndex) => {
                  const isHighlighted = highlightedRow === rowIndex;
                  return (
                    <button
                      key={rowIndex}
                      type="button"
                      onClick={() => handleRowClick(rowIndex)}
                      className={cn(
                        'flex w-full items-center border-b border-slate-100 px-4 text-left text-[12px] transition-colors hover:bg-primary/5 min-h-0 overflow-hidden',
                        isHighlighted && 'bg-primary/10'
                      )}
                    >
                      {listFields.map((f) => {
                        const value = getRowValueByField(row, String(f.define_field_name));
                        return (
                          <span key={String(f.define_field_name)} className="flex-1 min-w-0 truncate pl-2 first:pl-0 text-[#666]">
                            {value != null ? String(value) : '-'}
                          </span>
                        );
                      })}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          
        </div>

        {/* Pagination (다음 버튼 뒤에 닫기) */}
        {!isIdentifyMode && listFields.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-1.5 bg-slate-50/80 shrink-0">
            <span className="text-[11px] text-[#666]">
              {rows.length === 0
                ? '0건'
                : `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + rows.length} / ${total.toLocaleString()}건`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => loadPage(page - 1)}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-[#666] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
              >
                이전
              </button>
              <span className="px-1.5 text-[11px] text-[#666]">{page}페이지</span>
              <button
                type="button"
                disabled={rows.length < pageSize || loading}
                onClick={() => loadPage(page + 1)}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-[#666] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
              >
                다음
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-[#666] transition-colors hover:bg-slate-100"
              >
                닫기
              </button>
            </div>
          </div>
        )}
        {!isIdentifyMode && listFields.length === 0 && rows.length === 0 && !loading && (
          <div className="flex items-center justify-end border-t border-slate-200 px-4 py-1.5 bg-slate-50/80 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-[#666] transition-colors hover:bg-slate-100"
            >
              닫기
            </button>
          </div>
        )}
      </div>

      {/* Detail section - 2/3 */}
      {hasDetail && selectedRow && (
        <div className="flex-[7] min-h-0 flex flex-col border-t-2 border-primary/30 bg-white overflow-hidden">
          {/* Detail tabs */}
          <div className="flex border-b border-slate-200 shrink-0">
            {detailTabs.map(({ id, label, icon: TabIcon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
                  activeTab === id
                    ? 'border-b-2 border-primary text-primary bg-primary/5'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                )}
              >
                <TabIcon className="h-3 w-3 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Detail content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeTab === 'basic' && (
              <div>
                {detailFields.length === 0 ? (
                  <InfoSection
                    title="기본정보"
                    fields={Object.entries((selectedRow ?? {}) as Record<string, unknown>)
                      .filter(([k]) => { const n = k.toLowerCase(); return n !== 'gid' && n !== 'geom'; })
                      .map(([k, v], i) => ({
                        fieldKey: k || `auto-${i}`,
                        label: k,
                        value: v != null ? String(v) : '-',
                        highlight: i === 0,
                      }))}
                    defaultOpen={true}
                  />
                ) : (
                  <>
                    <InfoSection
                      title="기본정보"
                      fields={detailFields
                        .filter((f) => String(f.define_field_show_detail ?? '').toLowerCase() !== 'true')
                        .map((f, i) => {
                          const key = String(f.define_field_name ?? '');
                          const label = String(f.define_field_kor_name ?? f.define_field_name ?? '');
                          const raw = getRowValueByField(selectedRow, key);
                          const value = raw != null ? String(raw) : '-';
                          return { fieldKey: key || `basic-${i}`, label, value, highlight: i === 0 };
                        })}
                      defaultOpen={true}
                    />
                    <InfoSection
                      title="상세정보"
                      fields={detailFields
                        .filter((f) => String(f.define_field_show_detail ?? '').toLowerCase() === 'true')
                        .map((f, i) => {
                          const key = String(f.define_field_name ?? '');
                          const label = String(f.define_field_kor_name ?? f.define_field_name ?? '');
                          const raw = getRowValueByField(selectedRow, key);
                          const value = raw != null ? String(raw) : '-';
                          return { fieldKey: key || `detail-${i}`, label, value };
                        })}
                      defaultOpen={true}
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="px-3 py-2">
                {SAMPLE_HISTORY.length === 0 ? (
                  <div className="py-4 text-[11px] text-slate-500 text-center">이력 없음</div>
                ) : (
                  <div className="relative space-y-0">
                    {SAMPLE_HISTORY.map((event, index) => {
                      const config = HISTORY_TYPE_CONFIG[event.type];
                      const EventIcon = config.icon;
                      return (
                        <div key={event.id} className="relative flex gap-2.5 pb-4">
                          {index < SAMPLE_HISTORY.length - 1 && (
                            <div className="absolute left-[13px] top-7 h-[calc(100%-14px)] w-px bg-slate-200" aria-hidden />
                          )}
                          <div className={cn('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', config.bg)}>
                            <EventIcon className={cn('h-3.5 w-3.5', config.color)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn('text-[10px] font-medium rounded px-1 py-0.5', config.color, config.bg)}>{event.type}</span>
                              <span className="text-[10px] text-[#666]">{event.date}</span>
                            </div>
                            <p className="mt-0.5 text-[11px] font-medium text-[#666]">{event.title}</p>
                            <p className="mt-0.5 text-[10px] leading-relaxed text-[#666]">{event.description}</p>
                            <p className="mt-0.5 text-[10px] text-[#666]">담당: {event.author}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'attach' && (
              <div className="px-3 py-2">
                {SAMPLE_ATTACHMENTS.length === 0 ? (
                  <div className="py-6 text-[11px] text-slate-500 text-center">첨부파일 없음</div>
                ) : (
                  <div className="space-y-1.5">
                    {SAMPLE_ATTACHMENTS.map((file) => (
                      <div key={file.id} className="flex items-center gap-2.5 rounded border border-slate-200 bg-white p-2.5 transition-colors hover:bg-slate-50">
                        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded', file.type === 'image' ? 'bg-sky-100' : 'bg-amber-100')}>
                          {file.type === 'image' ? <FileImage className="h-3.5 w-3.5 text-sky-600" /> : <FileText className="h-3.5 w-3.5 text-amber-600" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-medium text-[#666]">{file.name}</p>
                          <p className="text-[10px] text-[#666]">{file.size} | {file.date}</p>
                        </div>
                        <button type="button" className="h-6 w-6 shrink-0 rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" title="다운로드">
                          <Download className="h-3 w-3 mx-auto" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Detail footer */}
          <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-3 py-2">
            {activeTab === 'basic' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#666]">기본정보</span>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">수정</button>
                  <button type="button" className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">지도보기</button>
                  <button type="button" onClick={closeDetail} className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">닫기</button>
                </div>
              </div>
            )}
            {activeTab === 'history' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#666]">이력 {SAMPLE_HISTORY.length}건</span>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">이력 추가</button>
                  <button type="button" onClick={closeDetail} className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">닫기</button>
                </div>
              </div>
            )}
            {activeTab === 'attach' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#666]">첨부파일 {SAMPLE_ATTACHMENTS.length}건</span>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">파일 추가</button>
                  <button type="button" onClick={closeDetail} className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
