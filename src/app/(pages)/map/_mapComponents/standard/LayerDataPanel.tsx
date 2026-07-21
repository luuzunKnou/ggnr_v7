'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { call } from '@/lib/api';
import {
  FileText,
  History,
  Paperclip,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronRight,
  X,
  Upload,
} from 'lucide-react';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import { formatDetailScalarValue } from '@/lib/formatDetailScalar';
import { cn, formatFileSize } from '@/lib/utils';
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  serviceFileDataZipDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from './useServiceFileData';
import { useMapContext } from '../MapContext';
import { getRowKey, getRowValueByField } from './defineLayerRowUtils';
import { ServiceFileAttachmentThumb } from './ServiceFileAttachmentThumb';
import { ServiceFilePdfThumb } from './ServiceFilePdfThumb';
import { ServiceFileImagePreview, type ServiceFilePreviewItem } from './ServiceFileImagePreview';
import type { IdentifyLayerResult, IdentifyFeatureItem } from '../hooks/useFeatureIdentify';
import { IdentifyHitListBlock } from './IdentifyHitListBlock';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQueryBulkListHighlightStyle,
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';
import { scheduleFitMapToExtent3857 } from '../config/mapAutoNavigation';
import { getAllRoadLedgerDocLayerIds } from '../../_mapContents/road/roadLedger/roadLedgerDocLayerMap';
import {
  formatRoadLedgerFacilityCellValue,
  getRoadLedgerFacilityColumnKeys,
} from '../../_mapContents/road/roadLedger/roadLedgerTableDisplayFields';

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
              <div
                key={field.fieldKey}
                className={cn('flex items-stretch', index !== fields.length - 1 && 'border-b border-slate-200')}
              >
                <div className="flex min-w-0 w-[100px] shrink-0 items-start bg-slate-100 px-2.5 py-1.5">
                  <span className="min-w-0 w-full whitespace-normal break-words text-[11px] leading-snug text-[#666]">
                    {field.label}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 items-start px-2.5 py-1.5">
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

type LayerDataPanelProps = {
  dataTable: string;
  onClose?: () => void;
  onDataKeyChange?: (keyValue: string | number | null) => void;
  initialDataKey?: string;
  /** true: 도로대장 시설 목록과 동일한 컬럼·표시(코드표 기반). 시설관리에서 연 경우에만 켬 */
  useRoadLedgerFacilityListColumns?: boolean;
};

function flattenIdentifyResults(
  results: IdentifyLayerResult[]
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

type ActiveLayerInfo = {
  tableName: string;
  name: string;
  schema: string;
  physicalTableName: string;
  rowFilterSql: string | null;
};

export function LayerDataPanel({
  dataTable,
  onClose,
  onDataKeyChange,
  initialDataKey,
  useRoadLedgerFacilityListColumns = false,
}: LayerDataPanelProps) {
  const mapContext = useMapContext();
  const mapInstanceRef = mapContext?.mapInstanceRef;
  const spatialFilterWkt = mapContext?.spatialFilterWkt ?? null;
  const [activeLayer, setActiveLayer] = useState<ActiveLayerInfo | null>(null);
  const identifyResultList = mapContext?.identifyResultList ?? null;
  const identifySelectedRow = mapContext?.identifySelectedRow ?? null;
  const setIdentifySelectedRow = mapContext?.setIdentifySelectedRow;
  const identifyFeatureTotal =
    identifyResultList?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0;
  /** 지도 식별·검색: 행이 있거나, 검색 완료 후 0건이어도 listHeaderLabel 이 있으면 결과 패널(빈 목록) 표시 */
  const isIdentifyMode =
    identifyResultList != null &&
    (identifyFeatureTotal > 0 ||
      (Boolean(identifyResultList.listHeaderLabel?.trim()) && identifyFeatureTotal === 0));
  const identifyFlat = isIdentifyMode && identifyResultList
    ? flattenIdentifyResults(identifyResultList.results)
    : [];

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
  const attachUploadInputRef = useRef<HTMLInputElement>(null);
  const selectedIdentifyRowRef = useRef<HTMLButtonElement | null>(null);
  const highlightSourceRef = useRef<VectorSource | null>(null);
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectionSourceRef = useRef<VectorSource | null>(null);
  const selectionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);
  const prevLayerRef = useRef<string | null>(null);
  const [selectedIdentifyIndex, setSelectedIdentifyIndex] = useState<number | null>(null);

  const prevHadIdentifyRef = useRef(false);
  /** 새 식별·검색 결과 시 목록 선택 초기화. 식별 종료 시에만 상세 상태 정리(일반 목록 조회와 충돌 방지). */
  useEffect(() => {
    const total =
      identifyResultList?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0;
    const hasIdentify =
      identifyResultList != null &&
      (total > 0 || (Boolean(identifyResultList.listHeaderLabel?.trim()) && total === 0));
    if (hasIdentify) {
      setSelectedIdentifyIndex(null);
      setSelectedRowData(null);
    } else if (prevHadIdentifyRef.current) {
      setSelectedIdentifyIndex(null);
      setSelectedRowData(null);
      selectionSourceRef.current?.clear();
      setRadarActive(false);
    }
    prevHadIdentifyRef.current = hasIdentify;
  }, [identifyResultList]);

  const [attachListRefreshNonce, setAttachListRefreshNonce] = useState(0);
  const [attachmentImagePreview, setAttachmentImagePreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);

  /** 식별 목록에서 다른 레이어를 선택하면 URL의 dataTable은 그대로일 수 있음 → 필드/헤더는 선택 항목의 테이블 기준 */
  const tableForLayerConfig =
    isIdentifyMode && selectedIdentifyIndex != null && identifyFlat[selectedIdentifyIndex]
      ? String(identifyFlat[selectedIdentifyIndex].layer.tableName ?? '').trim()
      : dataTable.trim();

  useEffect(() => {
    if (!tableForLayerConfig) { setActiveLayer(null); return; }
    let cancelled = false;
    fetch('/api/config/defineLayer')
      .then((r) => r.json())
      .then(
        (res: {
          data?: {
            define_table_name?: string;
            define_table_kor_name?: string;
            define_table_schema?: string;
            define_table_parents_layer?: string;
            define_table_div_query?: string;
          }[];
        }) => {
        if (cancelled) return;
        const tables = Array.isArray(res?.data) ? res.data : [];
        const row = tables.find((t) => String(t?.define_table_name ?? '').trim() === tableForLayerConfig);
        if (row) {
          const schema = String(row.define_table_schema ?? 'layer').trim() || 'layer';
          const parent = String(row.define_table_parents_layer ?? '').trim();
          const divQ = String(row.define_table_div_query ?? '').trim();
          const isSplit = !!parent && !!divQ;
          const physical = (isSplit ? parent : tableForLayerConfig).trim().toLowerCase();
          setActiveLayer({
            tableName: tableForLayerConfig,
            name: String(row.define_table_kor_name ?? row.define_table_name ?? tableForLayerConfig).trim() || tableForLayerConfig,
            schema,
            physicalTableName: physical,
            rowFilterSql: isSplit ? divQ : null,
          });
        } else {
          const tn = tableForLayerConfig.toLowerCase();
          setActiveLayer({
            tableName: tableForLayerConfig,
            name: tableForLayerConfig,
            schema: 'layer',
            physicalTableName: tn,
            rowFilterSql: null,
          });
        }
      }
      )
      .catch(() => {
        if (!cancelled) {
          const tn = tableForLayerConfig.toLowerCase();
          setActiveLayer({
            tableName: tableForLayerConfig,
            name: tableForLayerConfig,
            schema: 'layer',
            physicalTableName: tn,
            rowFilterSql: null,
          });
        }
      });
    return () => { cancelled = true; };
  }, [tableForLayerConfig]);

  const selectedRow = selectedRowData;
  const pageSize = selectedRow != null ? PAGE_SIZE_DETAIL : PAGE_SIZE_LIST;

  const rowKeyForAttachments =
    selectedRow != null ? getRowKey(selectedRow, keyFieldName) : null;
  const attachmentQuery = useServiceFileData({
    serEng: SER_FILE_ENG.dataQuery,
    enabled: activeTab === 'attach' && selectedRow != null && activeLayer != null,
    layerSegment: activeLayer?.physicalTableName ?? null,
    keyValue: rowKeyForAttachments,
    refreshNonce: attachListRefreshNonce,
  });
  const attachmentPreviewGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (activeLayer == null || rowKeyForAttachments == null) return [];
    return attachmentQuery.files
      .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(
          SER_FILE_ENG.dataQuery,
          activeLayer.physicalTableName,
          rowKeyForAttachments,
          f.name
        ),
        fileName: f.name,
        kind: isPdfServiceFileName(f.name) ? ('pdf' as const) : ('image' as const),
      }));
  }, [attachmentQuery.files, activeLayer, rowKeyForAttachments]);
  const attachChunkUpload = useServiceFileChunkedUpload();

  const map = mapContext?.mapInstanceRef?.current;

  useEffect(() => {
    if (!map || highlightLayerRef.current) return;
    const source = new VectorSource();
    highlightSourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQueryBulkListHighlightStyle(),
      properties: { listHighlightLayer: true },
    });
    layer.set('listHighlightLayer', true);
    insertLayerBelowServiceLayer(map, layer);
    highlightLayerRef.current = layer;

    const selSource = new VectorSource();
    selectionSourceRef.current = selSource;
    const selectionLayer = new VectorLayer({
      source: selSource,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    });
    selectionLayer.set('listSelectionLayer', true);
    insertLayerBelowServiceLayer(map, selectionLayer);
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
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP;
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
      if (ext.every((v) => isFinite(v))) {
        scheduleFitMapToExtent3857(mapInstance, ext as [number, number, number, number], {
          maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      }
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
    selectedIdentifyRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdentifyIndex, selectedRowData]);

  useEffect(() => {
    if (!activeLayer) return;
    const isIdentify = isIdentifyMode;
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
      table: activeLayer.physicalTableName,
      schema: activeLayer.schema,
      limit: PAGE_SIZE_LIST,
      offset: 0,
      ...(spatialFilterWkt ? { spatialWkt: spatialFilterWkt, spatialSrid: 5181 } : {}),
      ...(activeLayer.rowFilterSql ? { rowFilter: activeLayer.rowFilterSql } : {}),
    };
    const fieldsPromise = fetch(
      `/api/config/defineLayer/fields/${encodeURIComponent(activeLayer.physicalTableName)}`
    ).then((r) => r.json());
    const useKey = !isIdentify && initialDataKey != null && String(initialDataKey).trim() !== '';
    const dataPromise = isIdentify
      ? Promise.resolve({ rows: [] as Record<string, unknown>[], total: 0 })
      : useKey
      ? call('', 'POST', {
          service: 'standardService',
          action: 'getTableRowByKey',
          params: {
            table: activeLayer.physicalTableName,
            schema: activeLayer.schema,
            keyValue: initialDataKey!.trim(),
            ...(activeLayer.rowFilterSql ? { rowFilter: activeLayer.rowFilterSql } : {}),
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
      // 첨부파일 탭을 보던 중 다른 행(URL dataKey)으로 바뀌어도 탭 유지
      setActiveTab((tab) => (tab === 'attach' ? 'attach' : 'basic'));
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
          table: activeLayer.physicalTableName,
          schema: activeLayer.schema,
          limit: ps,
          offset: (newPage - 1) * ps,
          ...(mapContext?.spatialFilterWkt ? { spatialWkt: mapContext.spatialFilterWkt, spatialSrid: 5181 } : {}),
          ...(activeLayer.rowFilterSql ? { rowFilter: activeLayer.rowFilterSql } : {}),
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
        setActiveTab((tab) => (tab === 'attach' ? 'attach' : 'basic'));
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

  const roadLedgerFacilityTableSet = useMemo(
    () => new Set(getAllRoadLedgerDocLayerIds().map((x) => String(x).trim().toLowerCase())),
    []
  );

  const facilityColumnKeys = useMemo(() => {
    if (!activeLayer || !useRoadLedgerFacilityListColumns) return [];
    const tn = activeLayer.physicalTableName.trim().toLowerCase();
    if (!roadLedgerFacilityTableSet.has(tn)) return [];
    const sample = (rows[0] as Record<string, unknown> | undefined) ?? {};
    return getRoadLedgerFacilityColumnKeys(tn, sample);
  }, [activeLayer, useRoadLedgerFacilityListColumns, rows, roadLedgerFacilityTableSet]);

  if (!activeLayer) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-400 px-4">
        좌측 패널에서 레이어를 선택하세요.
      </div>
    );
  }

  const hasDetail = selectedRow != null;

  const useFacilityCols =
    Boolean(useRoadLedgerFacilityListColumns) && facilityColumnKeys.length > 0;

  /** 목록 컬럼: '목록 표시' 필드 > detailFields > rows의 키에서 gid/geom 제외한 자동 생성 */
  const autoFields: DefineFieldRow[] = (fields.length === 0 && detailFields.length === 0 && rows.length > 0)
    ? Object.keys(rows[0] as Record<string, unknown>)
        .filter((k) => { const n = k.toLowerCase(); return n !== 'gid' && n !== 'geom'; })
        .map((k) => ({ define_field_name: k, define_field_kor_name: k }))
    : [];
  const listFieldsAll = fields.length > 0 ? fields : detailFields.length > 0 ? detailFields : autoFields;
  /** 데이터 조회와 동일: 최대 5열. 시설관리(도로대장 시설 컬럼)도 같은 레이아웃·클래스만 사용 */
  const listFields = useFacilityCols
    ? facilityColumnKeys.slice(0, 5).map((k) => ({
        define_field_name: k,
        define_field_kor_name: k,
      }))
    : listFieldsAll.slice(0, 5);

  const detailTabs: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'basic', label: '기본정보', icon: FileText },
    { id: 'history', label: '이력관리', icon: History },
    { id: 'attach', label: '첨부파일', icon: Paperclip },
  ];

  return (
    <>
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 상세 열림 시 패널 닫기는 레이어 목록과 동일하게 헤더 우측 X */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 shrink-0 bg-white">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{activeLayer.name}</h3>
          {!isIdentifyMode && (
            <span className="text-[11px] text-slate-500">{activeLayer.tableName}</span>
          )}
        </div>
        {hasDetail && (
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* List section (1건 선택 시 목록 숨기고 상세만 표시) */}
      <div
        className={cn(
          'flex flex-col overflow-hidden',
          isIdentifyMode
            ? hasDetail
              ? 'flex-[3] min-h-0'
              : 'flex-1 min-h-0'
            : hasDetail
              ? 'flex-[3] min-h-0'
              : 'flex-1 min-h-0'
        )}
      >
        <div ref={listScrollRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loading && !isIdentifyMode && rows.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-slate-500">로딩 중...</div>
          )}
          {error && (
            <div className="px-4 py-6 text-center text-[12px] text-red-600">{error}</div>
          )}
          {isIdentifyMode && identifyResultList && (
            <IdentifyHitListBlock
              results={identifyResultList.results}
              headerLabel={identifyResultList.listHeaderLabel ?? '지도에서 선택된 항목'}
              selectedIndex={selectedIdentifyIndex}
              selectedRowRef={selectedIdentifyRowRef}
              onItemClick={handleIdentifyItemClick}
              onClose={handleClose}
              showFooterClose={!hasDetail}
            />
          )}
          {!isIdentifyMode && !error && listFields.length > 0 && (rows.length > 0 || !loading) && (
            <>
              <div className="flex items-start border-b border-slate-200 bg-slate-100/60 px-4 py-2 text-[12px] font-semibold text-[#666] shrink-0">
                {listFields.map((f) => (
                  <span
                    key={String(f.define_field_name)}
                    className="flex-1 min-w-0 whitespace-normal break-words pl-2 text-left leading-tight first:pl-0"
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
                        const display = useFacilityCols
                          ? formatRoadLedgerFacilityCellValue(
                              String(f.define_field_name),
                              row as Record<string, unknown>
                            )
                          : (() => {
                              const v = getRowValueByField(row, String(f.define_field_name));
                              return formatDetailScalarValue(v);
                            })();
                        return (
                          <span key={String(f.define_field_name)} className="flex-1 min-w-0 truncate pl-2 first:pl-0 text-[#666]">
                            {display}
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
              {!hasDetail && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-[#666] transition-colors hover:bg-slate-100"
                >
                  닫기
                </button>
              )}
            </div>
          </div>
        )}
        {!isIdentifyMode && listFields.length === 0 && rows.length === 0 && !loading && !hasDetail && (
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
                        value: formatDetailScalarValue(v),
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
                          const value = formatDetailScalarValue(raw);
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
                          const value = formatDetailScalarValue(raw);
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
                <input
                  ref={attachUploadInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file || !activeLayer || rowKeyForAttachments == null) return;
                    void attachChunkUpload
                      .upload({
                        file,
                        serEng: SER_FILE_ENG.dataQuery,
                        layerSegment: activeLayer.physicalTableName,
                        keyValue: rowKeyForAttachments,
                      })
                      .then((res) => {
                        if (res && 'error' in res && res.error) return;
                        setAttachListRefreshNonce((n) => n + 1);
                        attachChunkUpload.reset();
                      });
                  }}
                />
                {keyFieldName == null || rowKeyForAttachments == null ? (
                  <div className="py-6 text-[11px] text-slate-500 text-center leading-relaxed px-1">
                    레이어 데이터 설정에서 키 필드(define_field_is_key)가 지정되어 있어야 첨부폴더를 조회할 수 있습니다.
                  </div>
                ) : (
                  <>
                    {attachChunkUpload.state.status === 'uploading' && (
                      <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <div className="mb-1 flex justify-between text-[10px] text-[#666]">
                          <span className="flex items-center gap-1">
                            <Upload className="h-3 w-3 shrink-0" aria-hidden />
                            업로드 중…
                          </span>
                          <span>{attachChunkUpload.state.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full bg-primary transition-[width] duration-150"
                            style={{ width: `${attachChunkUpload.state.progress}%` }}
                          />
                        </div>
                        {attachChunkUpload.state.totalChunks > 0 && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            청크 {attachChunkUpload.state.currentChunk} / {attachChunkUpload.state.totalChunks}
                          </p>
                        )}
                      </div>
                    )}
                    {attachChunkUpload.state.status === 'error' && attachChunkUpload.state.error && (
                      <div className="mb-2 rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] text-red-700">
                        {attachChunkUpload.state.error}
                      </div>
                    )}
                    {attachmentQuery.loading ? (
                      <div className="py-6 text-[11px] text-slate-500 text-center">불러오는 중…</div>
                    ) : attachmentQuery.error ? (
                      <div className="py-6 text-[11px] text-red-600 text-center">{attachmentQuery.error}</div>
                    ) : attachmentQuery.files.length === 0 ? (
                      <div className="py-6 text-[11px] text-slate-500 text-center">첨부파일 없음</div>
                    ) : (
                  <div className="space-y-1.5">
                    {attachmentQuery.files.map((file) => {
                      const isImg = isImageServiceFileName(file.name);
                      const isPdf = isPdfServiceFileName(file.name);
                      const dateStr =
                        file.modified != null
                          ? (() => {
                              const d = new Date(file.modified);
                              return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ko-KR');
                            })()
                          : '—';
                      const downloadUrl = serviceFileDataDownloadUrl(
                        SER_FILE_ENG.dataQuery,
                        activeLayer!.physicalTableName,
                        rowKeyForAttachments,
                        file.name
                      );
                      const activateRow = () => {
                        if (isImg || isPdf) {
                          const idx = attachmentPreviewGalleryItems.findIndex((i) => i.fileName === file.name);
                          setAttachmentImagePreview({
                            items: attachmentPreviewGalleryItems,
                            initialIndex: idx >= 0 ? idx : 0,
                          });
                        } else {
                          triggerServiceFileDownload(downloadUrl, file.name);
                        }
                      };
                      return (
                        <div
                          key={file.name}
                          tabIndex={0}
                          role="group"
                          aria-label={
                            isImg || isPdf ? `${file.name} 크게 보기` : `${file.name} 다운로드`
                          }
                          className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 bg-white p-2.5 pr-1 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          onClick={activateRow}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              activateRow();
                            }
                          }}
                        >
                          {isImg ? (
                            <ServiceFileAttachmentThumb
                              serEng={SER_FILE_ENG.dataQuery}
                              layerSegment={activeLayer!.physicalTableName}
                              keyValue={rowKeyForAttachments}
                              fileName={file.name}
                              size="sm"
                            />
                          ) : isPdf ? (
                            <ServiceFilePdfThumb
                              serEng={SER_FILE_ENG.dataQuery}
                              layerSegment={activeLayer!.physicalTableName}
                              keyValue={rowKeyForAttachments}
                              fileName={file.name}
                              size="sm"
                            />
                          ) : (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-100">
                              <FileText className="h-3.5 w-3.5 text-amber-600" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-medium text-[#666]">{file.name}</p>
                            <p className="text-[10px] text-[#666]">
                              {formatFileSize(file.size)} | {dateStr}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerServiceFileDownload(downloadUrl, file.name);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                              title="다운로드"
                            >
                              <Download className="h-3 w-3" />
                              <span className="sr-only">다운로드</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  !window.confirm(
                                    `「${file.name}」을(를) 삭제할까요?\n`
                                  )
                                ) {
                                  return;
                                }
                                void requestServiceFileDataDelete({
                                  serEng: SER_FILE_ENG.dataQuery,
                                  layerSegment: activeLayer!.physicalTableName,
                                  keyValue: rowKeyForAttachments,
                                  fileName: file.name,
                                }).then((r) => {
                                  if (r.ok) setAttachListRefreshNonce((n) => n + 1);
                                  else window.alert(r.error);
                                });
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-red-100 hover:text-red-700"
                              title="삭제"
                            >
                              <X className="h-3 w-3" />
                              <span className="sr-only">삭제</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                    )}
                  </>
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
                <span className="text-[10px] text-[#666]">
                  첨부파일{' '}
                  {keyFieldName != null && rowKeyForAttachments != null ? `${attachmentQuery.files.length}건` : '—'}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={
                      keyFieldName == null ||
                      rowKeyForAttachments == null ||
                      attachChunkUpload.state.status === 'uploading'
                    }
                    onClick={() => {
                      attachChunkUpload.reset();
                      attachUploadInputRef.current?.click();
                    }}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    파일 추가
                  </button>
                  {keyFieldName != null &&
                  rowKeyForAttachments != null &&
                  activeLayer != null &&
                  attachmentQuery.files.length > 0 ? (
                    <a
                      href={serviceFileDataZipDownloadUrl(
                        SER_FILE_ENG.dataQuery,
                        activeLayer.physicalTableName,
                        rowKeyForAttachments,
                        { layerDisplayName: activeLayer.name }
                      )}
                      download
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50"
                    >
                      전체 다운로드
                    </a>
                  ) : (
                    <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-400 cursor-not-allowed">
                      전체 다운로드
                    </span>
                  )}
                  <button type="button" onClick={closeDetail} className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    {attachmentImagePreview != null && (
      <ServiceFileImagePreview
        items={attachmentImagePreview.items}
        initialIndex={attachmentImagePreview.initialIndex}
        onClose={() => setAttachmentImagePreview(null)}
      />
    )}
    </>
  );
}
