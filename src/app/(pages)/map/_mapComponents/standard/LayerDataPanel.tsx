'use client';

import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
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
import { recordDataViewLog } from '@/lib/recordDataViewLog';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay';
import { isLayerExtraFieldName } from '@/lib/layerExtraField';
import { useDefineLayerCodes } from './useDefineLayerCodes';
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
import { getDefineFieldDisplayLabel, getRowKey, getRowValueByField, isDefineFieldFlagTrue, isNumberColumnField, orderDefineFieldsWithKeyFirst } from './defineLayerRowUtils';
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
import { isFmsFacilityLayerTable } from '@/lib/fmsLinkage/fmsBinding';
import { getAllRoadLedgerDocLayerIds } from '../../_mapContents/road/roadLedger/roadLedgerDocLayerMap';
import {
  formatRoadLedgerFacilityCellValue,
  getRoadLedgerFacilityColumnKeys,
} from '../../_mapContents/road/roadLedger/roadLedgerTableDisplayFields';
import type { DataQueryHistoryType } from '@/lib/dataQueryHistoryTypes';
import {
  DataQueryHistoryAddDialog,
  type DataQueryHistoryAddFormData,
} from './DataQueryHistoryAddDialog';

type DefineFieldRow = {
  define_field_name?: string;
  define_field_kor_name?: string;
  define_field_idx?: string;
  define_field_show_list?: string;
  define_field_show_detail?: string;
  define_field_is_key?: string;
  define_field_read_only?: string | boolean;
  define_field_type?: string;
  [key: string]: unknown;
};

type DetailTab = 'basic' | 'history' | 'attach';

type TimelineEvent = {
  id: number;
  date: string;
  type: DataQueryHistoryType;
  title: string;
  description: string;
  author: string;
};

const HISTORY_TYPE_CONFIG: Record<
  DataQueryHistoryType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  점검: { icon: FileText, color: 'text-sky-600', bg: 'bg-sky-100' },
  보수: { icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-100' },
  이상발생: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
  준공: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
};

interface InfoField {
  /** 고유 키 (define_field_name 등). label은 한글명이라 중복 가능 */
  fieldKey: string;
  label: string;
  value: string | number;
  unit?: string;
  highlight?: boolean;
  /** 편집 모드에서도 인풋 대신 값을 고정 표시 (읽기전용 필드·키 필드) */
  readOnly?: boolean;
}

/** 목록·기본정보 라벨 폭 — CJK는 대략 2, 그 외 1 */
function estimateDisplayTextWeight(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  }
  return Math.max(w, 1);
}

/** 기본정보 좌측 속성명 열 너비(px) — 가장 긴 라벨 기준 (11px 폰트) */
const INFO_LABEL_COL_MIN_PX = 72;
const INFO_LABEL_COL_MAX_PX = 180;
/** px-2 좌우 패딩 합 */
const INFO_LABEL_COL_PAD_PX = 16;
/** 11px 기준 대략 글자 폭 — CJK·라틴 각각 */
const INFO_LABEL_CJK_CHAR_PX = 11;
const INFO_LABEL_LATIN_CHAR_PX = 7.5;

function estimateInfoLabelLineWidthPx(line: string): number {
  let px = 0;
  for (const ch of line) {
    px += ch.charCodeAt(0) > 0x2e80 ? INFO_LABEL_CJK_CHAR_PX : INFO_LABEL_LATIN_CHAR_PX;
  }
  return Math.max(px, 24);
}

function computeInfoLabelColWidthPx(labels: string[]): number {
  let maxPx = INFO_LABEL_COL_MIN_PX;
  for (const label of labels) {
    for (const line of label.split(/\r?\n/)) {
      maxPx = Math.max(maxPx, Math.round(estimateInfoLabelLineWidthPx(line) + INFO_LABEL_COL_PAD_PX));
    }
  }
  return Math.min(INFO_LABEL_COL_MAX_PX, maxPx);
}

/** 기본정보 행 높이(px) — h-7 */
const INFO_ROW_HEIGHT_PX = 28;

function infoFieldDisplayText(field: InfoField): string {
  const base = field.value === '' || field.value == null ? '—' : String(field.value);
  if (field.unit != null && field.unit !== '') return `${base} ${field.unit}`;
  return base;
}

function InfoSection({
  title,
  fields,
  defaultOpen = true,
  editing = false,
  editValues,
  onFieldChange,
}: {
  title: string;
  fields: InfoField[];
  defaultOpen?: boolean;
  editing?: boolean;
  editValues?: Record<string, string>;
  onFieldChange?: (fieldKey: string, value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const labelColWidthPx = useMemo(
    () => computeInfoLabelColWidthPx(fields.map((f) => f.label)),
    [fields]
  );
  if (fields.length === 0) return null;
  return (
    <div className="border-b border-border">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left transition-colors hover:bg-muted/50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-[11px] font-semibold tracking-wide text-slate-600 dark:text-muted-foreground">{title}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-2">
          <div className="divide-y divide-border overflow-hidden rounded border border-border">
            {fields.map((field) => (
              <div
                key={field.fieldKey}
                className="grid"
                style={{
                  gridTemplateColumns: `${labelColWidthPx}px minmax(0, 1fr)`,
                  height: INFO_ROW_HEIGHT_PX,
                }}
              >
                <dt
                  className="flex h-full min-w-0 shrink-0 items-center bg-slate-100 px-2 text-[11px] font-medium leading-none text-slate-500 dark:bg-muted dark:text-muted-foreground"
                  title={field.label}
                >
                  <span className="block min-w-0 truncate">{field.label}</span>
                </dt>
                <dd className="flex h-full min-w-0 items-center bg-background px-2 text-[11px] leading-none text-slate-900 dark:text-foreground">
                  {editing && !field.readOnly ? (
                    <input
                      className="h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25"
                      value={editValues?.[field.fieldKey] ?? ''}
                      onChange={(e) => onFieldChange?.(field.fieldKey, e.target.value)}
                    />
                  ) : (
                    <span
                      className={cn('block min-w-0 truncate', field.highlight && 'font-medium text-primary')}
                      title={infoFieldDisplayText(field)}
                    >
                      {infoFieldDisplayText(field)}
                    </span>
                  )}
                </dd>
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

/** 헤더·셀 패딩(px-2·pl-4) + 말줄임 여유 (가중치 단위) */
const LIST_COL_TEXT_PAD_WEIGHT = 8;
/** ogc_fid·id 컬럼 — 고정 너비(px), min=max */
const LIST_COL_OGC_FID_FIXED_PX = 58;
/** ogc_fid·id 외 컬럼 최소 너비(px) */
const LIST_COL_DEFAULT_MIN_PX = 75;
const LIST_COL_WIDTH_REF_PX = 450;

function getListColMinPx(fieldName: string, korName?: string | null): number {
  if (isNumberColumnField(fieldName, korName)) {
    return LIST_COL_OGC_FID_FIXED_PX;
  }
  return LIST_COL_DEFAULT_MIN_PX;
}

function getListColMinPct(fieldName: string, korName?: string | null): number {
  return (getListColMinPx(fieldName, korName) / LIST_COL_WIDTH_REF_PX) * 100;
}

function getOgcFidColFixedPct(): number {
  return (LIST_COL_OGC_FID_FIXED_PX / LIST_COL_WIDTH_REF_PX) * 100;
}

/** ogc_fid 제외 컬럼만 totalPct(보통 100−고정합) 안에서 비율 분배 */
function distributeFlexColumnWidthsPct(
  weights: number[],
  columnMinPcts: number[],
  totalPct: number
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [totalPct];
  const equal = totalPct / n;
  const defaultMinPct = Math.max(equal * 0.72, (LIST_COL_DEFAULT_MIN_PX / LIST_COL_WIDTH_REF_PX) * 100);
  const maxPct = Math.min(totalPct * 0.5, equal * 2.5);
  const colMinPct = (i: number) => {
    const extra = columnMinPcts[i];
    if (extra != null && extra > 0) return Math.min(extra, totalPct);
    return Math.min(defaultMinPct, totalPct);
  };
  let ws = weights.map((w) => Math.max(1, w));
  for (let i = 0; i < 8; i++) {
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    ws = ws.map((w, idx) => {
      const pct = (w / sum) * totalPct;
      const minPct = colMinPct(idx);
      if (pct < minPct) return (minPct / totalPct) * sum;
      if (pct > maxPct) return (maxPct / totalPct) * sum;
      return w;
    });
  }
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  const pcts = ws.map((w) => (w / sum) * totalPct);
  const rounded = pcts.map((p) => Math.round(p * 10) / 10);
  const drift = totalPct - rounded.reduce((a, b) => a + b, 0);
  rounded[n - 1] = Math.round((rounded[n - 1] + drift) * 10) / 10;
  return rounded;
}

/** 글자 가중치 → 합 100% 컬럼 폭. 번호 컬럼(한글명 기준)은 고정%, 나머지는 잔여 비율 분배 */
function computeListColWidthsPct(
  weights: number[],
  cols: { name: string; kor?: string | null }[]
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) {
    return isNumberColumnField(cols[0].name, cols[0].kor) ? [getOgcFidColFixedPct()] : [100];
  }

  const result = new Array<number>(n).fill(0);
  const flexIndices: number[] = [];
  let fixedTotal = 0;

  for (let i = 0; i < n; i++) {
    if (isNumberColumnField(cols[i].name, cols[i].kor)) {
      result[i] = getOgcFidColFixedPct();
      fixedTotal += result[i];
    } else {
      flexIndices.push(i);
    }
  }

  const remaining = Math.max(0, 100 - fixedTotal);
  if (flexIndices.length === 0) {
    return result;
  }
  if (flexIndices.length === weights.length) {
    return distributeFlexColumnWidthsPct(
      weights,
      cols.map((c) => getListColMinPct(c.name, c.kor)),
      100
    );
  }

  const flexWeights = flexIndices.map((i) => weights[i]);
  const flexMinPcts = flexIndices.map((i) => getListColMinPct(cols[i].name, cols[i].kor));
  const flexPcts = distributeFlexColumnWidthsPct(flexWeights, flexMinPcts, remaining);
  flexIndices.forEach((idx, j) => {
    result[idx] = flexPcts[j];
  });
  return result;
}

function estimateListColWeight(header: string, cellTexts: string[]): number {
  const headerW = estimateDisplayTextWeight(header);
  let maxW = headerW;
  for (const t of cellTexts) {
    maxW = Math.max(maxW, estimateDisplayTextWeight(t));
  }
  const withPad = maxW + LIST_COL_TEXT_PAD_WEIGHT;
  // 헤더 전체(예: «번호»)가 말줄임되지 않도록 헤더 기준 하한
  const headerFloor = headerW + LIST_COL_TEXT_PAD_WEIGHT + 2;
  return Math.max(withPad, headerFloor);
}

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
  const codesByField = useDefineLayerCodes(
    activeLayer?.tableName ?? activeLayer?.physicalTableName,
    detailFields
  );
  const [keyFieldName, setKeyFieldName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null);
  const [selectedRowData, setSelectedRowData] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('basic');
  /**
   * 목록 그리드 칸 수 — 선택 여부와 분리.
   * 상세 닫기 직후 selectedRow=null 인데 rows는 아직 7건인 레이스에서
   * pageSize만 30으로 바뀌어 찌그러지는 것 방지.
   */
  const [listPageSize, setListPageSize] = useState(PAGE_SIZE_LIST);
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
  /** loadPage 응답 순서 보장 — 늦게 도착한 7건 응답이 30건 목록을 덮지 않게 */
  const loadPageSeqRef = useRef(0);
  /** 상세 닫기 후 URL dataKey 반영 전, 목록 재조회로 상세가 다시 열리는 것 방지 */
  const suppressDataKeySelectRef = useRef(false);
  /** 레이어 최초 목록 로드 시 첫 행 자동선택 1회. 상세 수동 닫기 후에는 false 유지 */
  const pendingAutoSelectFirstRef = useRef(false);
  /** 행 선택(클릭·자동·dataKey) 시에만 지도 fit. 페이지네이션으로 rows만 바뀌면 이동하지 않음 */
  const pendingMapFitFromSelectionRef = useRef(false);
  /** loadPage 후 하이라이트 복원용(키 필드 없거나 매칭 전) — 선택 전환 시에만 사용 */
  const pendingHighlightIndexRef = useRef<number | null>(null);
  /** 이전/다음 페이지 이동 직후 dataKey·pending 하이라이트 동기화 스킵 */
  const paginationOnlyLoadRef = useRef(false);
  /** 레이어 오픈 시 1회 계산한 목록 컬럼 폭(%). 페이지 이동 시 유지 */
  const listColWidthsLayerRef = useRef<string | null>(null);
  const [listColWidthsPct, setListColWidthsPct] = useState<number[] | null>(null);
  const selectedRowDataRef = useRef(selectedRowData);
  selectedRowDataRef.current = selectedRowData;
  const keyFieldNameRef = useRef(keyFieldName);
  keyFieldNameRef.current = keyFieldName;

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
  const [historyEvents, setHistoryEvents] = useState<TimelineEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAddOpen, setHistoryAddOpen] = useState(false);
  const [historyEditId, setHistoryEditId] = useState<number | null>(null);
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0);

  /** 기본정보 탭 — 수정 모드(제자리 인풋 편집) */
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraft, setBasicDraft] = useState<Record<string, string>>({});
  const [basicSaving, setBasicSaving] = useState(false);
  const [basicError, setBasicError] = useState<string | null>(null);

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
  const pageSize = listPageSize;

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

  const rowKeyForHistory =
    selectedRow != null ? getRowKey(selectedRow, keyFieldName) : null;

  /** 기본정보 수정에 쓰는 행 키 — 위 첨부·이력용과 동일 계산 */
  const currentRowKey = selectedRow != null ? getRowKey(selectedRow, keyFieldName) : null;

  /** 안전점검 시설물 3테이블 — 데이터조회에서 조회만 */
  const dataQueryReadOnly = useMemo(
    () =>
      isFmsFacilityLayerTable(
        activeLayer?.physicalTableName ?? activeLayer?.tableName ?? null
      ),
    [activeLayer?.physicalTableName, activeLayer?.tableName]
  );

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    if (currentRowKey == null || !keyFieldName) return;
    const tableName = String(
      activeLayer?.physicalTableName ?? activeLayer?.tableName ?? ''
    ).trim();
    if (!tableName) return;
    recordDataViewLog({
      tableName,
      keyField: keyFieldName,
      keyValue: currentRowKey,
      serviceName: '데이터조회',
    });
  }, [currentRowKey, keyFieldName, activeLayer?.physicalTableName, activeLayer?.tableName]);

  /** 선택된 행이 바뀌거나 탭을 벗어나면 기본정보 수정 모드 자동 해제 */
  useEffect(() => {
    setEditingBasic(false);
    setBasicDraft({});
    setBasicError(null);
  }, [selectedRowData, activeTab, dataQueryReadOnly]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!activeLayer?.physicalTableName || rowKeyForHistory == null) {
      setHistoryEvents([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void call('', 'POST', {
      service: 'dataQueryHistoryService',
      action: 'listByRow',
      params: {
        table: activeLayer.physicalTableName,
        rowKey: String(rowKeyForHistory),
      },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setHistoryError(String(data?.error ?? '이력을 불러오지 못했습니다.'));
          setHistoryEvents([]);
          return;
        }
        const list = Array.isArray(data?.data) ? data.data : [];
        setHistoryEvents(
          list.map((item: TimelineEvent) => ({
            id: Number(item.id),
            date: String(item.date ?? ''),
            type: item.type,
            title: String(item.title ?? ''),
            description: String(item.description ?? ''),
            author: String(item.author ?? ''),
          }))
        );
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryError('이력을 불러오지 못했습니다.');
          setHistoryEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    activeLayer?.physicalTableName,
    rowKeyForHistory,
    historyRefreshNonce,
  ]);

  const handleHistorySave = useCallback(
    async (form: DataQueryHistoryAddFormData, editId?: number) => {
      if (editId != null && editId > 0) {
        const res = await call('', 'POST', {
          service: 'dataQueryHistoryService',
          action: 'update',
          params: {
            id: editId,
            date: form.date,
            type: form.type,
            title: form.title,
            contents: form.contents,
            author: form.author,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          throw new Error(String(data?.error ?? '수정에 실패했습니다.'));
        }
        setHistoryRefreshNonce((n) => n + 1);
        return;
      }
      if (!activeLayer?.physicalTableName || rowKeyForHistory == null) {
        throw new Error('행 키를 확인할 수 없습니다.');
      }
      const res = await call('', 'POST', {
        service: 'dataQueryHistoryService',
        action: 'create',
        params: {
          table: activeLayer.physicalTableName,
          rowKey: String(rowKeyForHistory),
          date: form.date,
          type: form.type,
          title: form.title,
          contents: form.contents,
          author: form.author,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        throw new Error(String(data?.error ?? '등록에 실패했습니다.'));
      }
      setHistoryRefreshNonce((n) => n + 1);
    },
    [activeLayer?.physicalTableName, rowKeyForHistory]
  );

  const handleHistoryDelete = useCallback(async (editId: number) => {
    const res = await call('', 'POST', {
      service: 'dataQueryHistoryService',
      action: 'remove',
      params: { id: editId },
    });
    const data = res?.data ?? res;
    if (data?.error || data?.success === false) {
      throw new Error(String(data?.error ?? '삭제에 실패했습니다.'));
    }
    setHistoryRefreshNonce((n) => n + 1);
  }, []);

  const historyEditInitial = useMemo((): DataQueryHistoryAddFormData | null => {
    if (historyEditId == null) return null;
    const event = historyEvents.find((e) => e.id === historyEditId);
    if (!event) return null;
    return {
      date: event.date,
      type: event.type,
      title: event.title,
      contents: event.description,
      author: event.author,
    };
  }, [historyEditId, historyEvents]);

  const openHistoryCreate = useCallback(() => {
    setHistoryEditId(null);
    setHistoryAddOpen(true);
  }, []);

  const openHistoryEdit = useCallback((event: TimelineEvent) => {
    setHistoryEditId(event.id);
    setHistoryAddOpen(true);
  }, []);

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

  /** 지도 식별 항목 선택 시: 도형 강조 + 패널 padding 반영해 지도 이동·확대 (목록 행 선택과 동일) */
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
      const ext = source.getExtent();
      if (ext.every((v) => isFinite(v))) {
        scheduleFitMapToExtent3857(mapInstance, ext as [number, number, number, number], {
          maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      }
      setRadarActive(true);
    },
    [mapContext]
  );

  /** 상세 하단 「지도보기」 — 현재 선택된 행 도형으로 지도 이동·확대 (목록 클릭 자동이동과 별개로 수동 재이동) */
  const handleShowSelectedOnMap = useCallback(() => {
    const mapInstance = mapContext?.mapInstanceRef?.current;
    const source = selectionSourceRef.current;
    if (!mapInstance || !source || !selectedRowData) return;
    const g = (selectedRowData as Record<string, unknown>).geom;
    const geom = g == null ? null : typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
    if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) {
      window.alert('도형 정보가 없어 지도로 이동할 수 없습니다.');
      return;
    }
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
  }, [mapContext, selectedRowData]);

  useEffect(() => {
    if (highlightedRow == null) {
      if (!isIdentifyMode) {
        selectionSourceRef.current?.clear();
        setRadarActive(false);
      }
      return;
    }
    // 페이지 이동으로 rows만 갱신된 경우 첫 행(또는 이전 인덱스)으로 지도를 다시 맞추지 않음
    if (!pendingMapFitFromSelectionRef.current) return;
    const row = rows[highlightedRow] ?? selectedRowDataRef.current;
    if (!row) return;
    pendingMapFitFromSelectionRef.current = false;
    if (rows[highlightedRow]) {
      showHighlightedRowOnMap(highlightedRow);
    } else {
      showIdentifyFeatureOnMap(row);
    }
  }, [highlightedRow, rows, isIdentifyMode, showHighlightedRowOnMap, showIdentifyFeatureOnMap]);

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
      setListPageSize(PAGE_SIZE_LIST);
      suppressDataKeySelectRef.current = false;
      pendingAutoSelectFirstRef.current = true;
      pendingHighlightIndexRef.current = null;
      listColWidthsLayerRef.current = null;
      setListColWidthsPct(null);
      loadPageSeqRef.current += 1;
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
        const excludeGeomLike = (name: string) => {
          const n = name.trim().toLowerCase();
          return (
            isLayerExtraFieldName(n) ||
            n === 'gid' ||
            n === 'geom' ||
            n === 'geometry' ||
            n === 'the_geom' ||
            n === 'wkb_geometry' ||
            n === 'shape'
          );
        };
        // 목록 표시 설정이어도 geom류는 속성 목록에 넣지 않음 (값은 지도 하이라이트용으로만 사용)
        const fieldsList = sortedAll.filter(
          (f) =>
            isDefineFieldFlagTrue(f.define_field_show_list) &&
            !excludeGeomLike(String(f.define_field_name ?? ''))
        );
        setFields(fieldsList);
        setDetailFields(
          sortedAll.filter((f) => !excludeGeomLike(String(f.define_field_name ?? '')))
        );
        const keyField = Array.isArray(rawFields)
          ? rawFields.find((f) => isDefineFieldFlagTrue(f.define_field_is_key))
          : null;
        setKeyFieldName(keyField ? String(keyField.define_field_name ?? '').trim() || null : null);

        if (useKey) {
          const keyData = dataRes?.data ?? dataRes;
          const row = (keyData?.row ?? null) as Record<string, unknown> | null;
          if (row) {
            pendingAutoSelectFirstRef.current = false;
            pendingMapFitFromSelectionRef.current = true;
            pendingHighlightIndexRef.current = 0;
            setRows([row]);
            setTotal(1);
            setSelectedRowData(row);
            setHighlightedRow(0);
            setPage(1);
            showCurrentListOnMap([row]);
            showIdentifyFeatureOnMap(row);
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

  // 지도 식별 후 패널 열렸을 때 해당 행 상세 + 도형 강조·지도 이동
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
      pendingAutoSelectFirstRef.current = false;
      pendingHighlightIndexRef.current = null;
      listColWidthsLayerRef.current = null;
      setListColWidthsPct(null);
      highlightSourceRef.current?.clear();
      selectionSourceRef.current?.clear();
      setRadarActive(false);
    }
  }, [activeLayer]);

  const loadPage = useCallback(
    (newPage: number, size?: number, opts?: { paginationOnly?: boolean }) => {
      if (!activeLayer) return;
      const paginationOnly = opts?.paginationOnly === true;
      const ps = size ?? listPageSize;
      const savedScrollTop = listScrollRef.current?.scrollTop ?? 0;
      const seq = ++loadPageSeqRef.current;
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
          if (seq !== loadPageSeqRef.current) return;
          const data = res?.data ?? res;
          const dataRows: Record<string, unknown>[] = Array.isArray(data?.rows) ? data.rows : [];
          const dataTotal = typeof data?.total === 'number' ? data.total : total;
          // 행·칸 수를 같이 맞춰 한 렌더에 반영 (30칸+7행 / 7칸+30행 방지)
          setListPageSize(ps);
          setRows(dataRows);
          setTotal(dataTotal);
          setPage(newPage);
          if (paginationOnly) {
            // 페이지 이동만: 선택 상태는 유지하고, 현재 페이지에 선택 행이 있을 때만 목록 강조
            let nextHighlight: number | null = null;
            const selected = selectedRowDataRef.current;
            const keyField = keyFieldNameRef.current;
            if (selected != null && keyField) {
              const selectedKey = getRowKey(selected, keyField);
              if (selectedKey != null) {
                const idx = dataRows.findIndex((r) => {
                  const rowKey = getRowKey(r, keyField);
                  return rowKey != null && String(rowKey) === String(selectedKey);
                });
                if (idx >= 0) nextHighlight = idx;
              }
            }
            setHighlightedRow(nextHighlight);
          } else {
            // 선택 전환·상세 닫기 등: 키 매칭 → pending 인덱스로 하이라이트 복원
            const selected = selectedRowDataRef.current;
            const keyField = keyFieldNameRef.current;
            const pendingIdx = pendingHighlightIndexRef.current;
            pendingHighlightIndexRef.current = null;
            let nextHighlight: number | null = null;
            if (selected != null && keyField) {
              const selectedKey = getRowKey(selected, keyField);
              if (selectedKey != null) {
                const idx = dataRows.findIndex((r) => {
                  const rowKey = getRowKey(r, keyField);
                  return rowKey != null && String(rowKey) === String(selectedKey);
                });
                if (idx >= 0) nextHighlight = idx;
              }
            }
            if (nextHighlight == null && pendingIdx != null && pendingIdx < dataRows.length) {
              nextHighlight = pendingIdx;
            }
            setHighlightedRow(nextHighlight);
          }
          setLoading(false);
          setTimeout(() => { if (listScrollRef.current) listScrollRef.current.scrollTop = savedScrollTop; }, 0);
          showCurrentListOnMap(dataRows);
        })
        .catch((err) => {
          if (seq !== loadPageSeqRef.current) return;
          setError(err?.message ?? String(err));
          setLoading(false);
        });
    },
    [activeLayer, total, listPageSize, mapContext, showCurrentListOnMap]
  );

  // 앱 안에서 행 선택 시 URL의 dataKey만 반영 → 선택/하이라이트 동기화 (목록↔상세 칸 수 맞춤)
  useEffect(() => {
    if (paginationOnlyLoadRef.current) return;
    if (!activeLayer || isIdentifyMode || !keyFieldName || rows.length === 0) return;
    const key = initialDataKey != null ? String(initialDataKey).trim() : '';
    if (key === '') {
      suppressDataKeySelectRef.current = false;
      return;
    }
    if (suppressDataKeySelectRef.current) return;
    const idx = rows.findIndex((r) => {
      const rowKey = getRowKey(r, keyFieldName);
      return rowKey != null && String(rowKey) === key;
    });
    if (idx < 0) return;
    pendingAutoSelectFirstRef.current = false;
    pendingMapFitFromSelectionRef.current = true;
    if (listPageSize === PAGE_SIZE_LIST && selectedRowData == null) {
      const absoluteOffset = (page - 1) * PAGE_SIZE_LIST + idx;
      const newPage = Math.floor(absoluteOffset / PAGE_SIZE_DETAIL) + 1;
      const newRowIndex = absoluteOffset % PAGE_SIZE_DETAIL;
      pendingHighlightIndexRef.current = newRowIndex;
      setHighlightedRow(newRowIndex);
      setSelectedRowData(rows[idx] as Record<string, unknown>);
      showIdentifyFeatureOnMap(rows[idx] as Record<string, unknown>);
      setRows([]);
      setListPageSize(PAGE_SIZE_DETAIL);
      setActiveTab((tab) => (tab === 'attach' ? 'attach' : 'basic'));
      loadPage(newPage, PAGE_SIZE_DETAIL);
      return;
    }
    pendingHighlightIndexRef.current = idx;
    setSelectedRowData(rows[idx] as Record<string, unknown>);
    setHighlightedRow(idx);
    showIdentifyFeatureOnMap(rows[idx] as Record<string, unknown>);
    setActiveTab((tab) => (tab === 'attach' ? 'attach' : 'basic'));
  }, [
    activeLayer,
    isIdentifyMode,
    keyFieldName,
    initialDataKey,
    rows,
    listPageSize,
    selectedRowData,
    page,
    loadPage,
    showIdentifyFeatureOnMap,
  ]);

  // 페이지 이동 직후 dataKey 동기화 스킵 플래그 해제 (dataKey effect 다음 틱)
  useEffect(() => {
    if (paginationOnlyLoadRef.current) {
      paginationOnlyLoadRef.current = false;
    }
  }, [rows, page]);

  // 레이어 최초 목록 로드 시 첫 행 자동 상세·지도 이동 (URL/지도 dataKey·수동 닫기 우선)
  useEffect(() => {
    if (!pendingAutoSelectFirstRef.current) return;
    if (!activeLayer || isIdentifyMode || loading) return;
    if (rows.length === 0) return;
    if (selectedRowData != null) return;
    if (listPageSize !== PAGE_SIZE_LIST) return;
    if (suppressDataKeySelectRef.current) {
      pendingAutoSelectFirstRef.current = false;
      return;
    }

    const key = initialDataKey != null ? String(initialDataKey).trim() : '';
    if (key !== '' && keyFieldName) {
      const idx = rows.findIndex((r) => {
        const rowKey = getRowKey(r, keyFieldName);
        return rowKey != null && String(rowKey) === key;
      });
      if (idx >= 0) {
        // dataKey 동기화 effect가 해당 행을 선택
        pendingAutoSelectFirstRef.current = false;
        return;
      }
    }

    pendingAutoSelectFirstRef.current = false;
    const rowData = rows[0] as Record<string, unknown>;
    const keyVal = getRowKey(rowData, keyFieldName);
    const absoluteOffset = (page - 1) * PAGE_SIZE_LIST;
    const newPage = Math.floor(absoluteOffset / PAGE_SIZE_DETAIL) + 1;
    const newRowIndex = absoluteOffset % PAGE_SIZE_DETAIL;
    pendingMapFitFromSelectionRef.current = true;
    pendingHighlightIndexRef.current = newRowIndex;
    setHighlightedRow(newRowIndex);
    setSelectedRowData(rowData);
    showIdentifyFeatureOnMap(rowData);
    setRows([]);
    setListPageSize(PAGE_SIZE_DETAIL);
    setActiveTab('basic');
    onDataKeyChange?.(keyVal);
    loadPage(newPage, PAGE_SIZE_DETAIL);
  }, [
    activeLayer,
    isIdentifyMode,
    loading,
    rows,
    selectedRowData,
    listPageSize,
    initialDataKey,
    keyFieldName,
    page,
    loadPage,
    onDataKeyChange,
    showIdentifyFeatureOnMap,
  ]);

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
    suppressDataKeySelectRef.current = true;
    pendingAutoSelectFirstRef.current = false;
    pendingHighlightIndexRef.current = null;
    setHighlightedRow(null);
    setSelectedRowData(null);
    onDataKeyChange?.(null);
    setRows([]);
    // listPageSize는 loadPage 성공 시 30으로 맞춤(닫는 동안은 7 유지 → 찌그러짐 방지)
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
      suppressDataKeySelectRef.current = false;
      if (wasDetailOpen) {
        pendingMapFitFromSelectionRef.current = true;
        pendingHighlightIndexRef.current = rowIndex;
        setHighlightedRow(rowIndex);
        setSelectedRowData(rowData);
        showIdentifyFeatureOnMap(rowData);
        setActiveTab((tab) => (tab === 'attach' ? 'attach' : 'basic'));
        onDataKeyChange?.(keyVal);
      } else {
        const absoluteOffset = (page - 1) * PAGE_SIZE_LIST + rowIndex;
        const newPage = Math.floor(absoluteOffset / PAGE_SIZE_DETAIL) + 1;
        const newRowIndex = absoluteOffset % PAGE_SIZE_DETAIL;
        pendingMapFitFromSelectionRef.current = true;
        pendingHighlightIndexRef.current = newRowIndex;
        setHighlightedRow(newRowIndex);
        setSelectedRowData(rowData);
        showIdentifyFeatureOnMap(rowData);
        setRows([]);
        setListPageSize(PAGE_SIZE_DETAIL);
        setActiveTab('basic');
        onDataKeyChange?.(keyVal);
        loadPage(newPage, PAGE_SIZE_DETAIL);
      }
    }
  };

  /** 기본정보 인풋 초기값용 — 화면 표시 포맷이 아닌 원본 값 문자열 */
  const handleBeginBasicEdit = () => {
    if (dataQueryReadOnly || !selectedRow) return;
    const draft: Record<string, string> = {};
    for (const f of basicInfoFields) {
      if (f.readOnly) continue;
      const raw = getRowValueByField(selectedRow, f.fieldKey);
      draft[f.fieldKey] = raw == null ? '' : String(raw);
    }
    setBasicDraft(draft);
    setBasicError(null);
    setEditingBasic(true);
  };

  const handleCancelBasicEdit = () => {
    setEditingBasic(false);
    setBasicDraft({});
    setBasicError(null);
  };

  const handleSaveBasicEdit = async () => {
    if (
      dataQueryReadOnly ||
      !activeLayer ||
      keyFieldName == null ||
      currentRowKey == null ||
      selectedRow == null
    ) {
      return;
    }
    setBasicSaving(true);
    setBasicError(null);
    try {
      const res = await call('', 'POST', {
        service: 'layerRowService',
        action: 'updateTableRowByKey',
        params: {
          table: activeLayer.physicalTableName,
          schema: activeLayer.schema,
          keyValue: String(currentRowKey),
          keyField: keyFieldName,
          changes: basicDraft,
          includeHiddenDetail: false,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setBasicError(String(data?.error ?? '수정에 실패했습니다.'));
        return;
      }
      const updatedRow: Record<string, unknown> = { ...selectedRow, ...basicDraft };
      setSelectedRowData(updatedRow);
      setRows((prev) =>
        prev.map((r) => (getRowKey(r, keyFieldName) === currentRowKey ? updatedRow : r))
      );
      setEditingBasic(false);
      setBasicDraft({});
    } catch (e: unknown) {
      setBasicError(e instanceof Error ? e.message : '수정에 실패했습니다.');
    } finally {
      setBasicSaving(false);
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

  // 레이어 최초 목록(자동선택 전)에서 컬럼 폭 1회 산정 — 페이지 이동 시 유지
  useLayoutEffect(() => {
    if (!activeLayer || isIdentifyMode) return;
    if (listColWidthsLayerRef.current === activeLayer.tableName) return;
    if (rows.length === 0) return;

    const isGeomLikeFieldName = (name: string) => {
      const n = name.trim().toLowerCase();
      return (
        isLayerExtraFieldName(n) ||
        n === 'gid' ||
        n === 'geom' ||
        n === 'geometry' ||
        n === 'the_geom' ||
        n === 'wkb_geometry' ||
        n === 'shape'
      );
    };
    const useFacilityCols =
      Boolean(useRoadLedgerFacilityListColumns) && facilityColumnKeys.length > 0;
    const autoFields: DefineFieldRow[] =
      fields.length === 0 && detailFields.length === 0
        ? Object.keys(rows[0] as Record<string, unknown>)
            .filter((k) => !isGeomLikeFieldName(k))
            .map((k) => ({ define_field_name: k, define_field_kor_name: k }))
        : [];
    const listFieldsAll = (fields.length > 0 ? fields : detailFields.length > 0 ? detailFields : autoFields).filter(
      (f) => !isGeomLikeFieldName(String(f.define_field_name ?? ''))
    );
    const cols: DefineFieldRow[] = useFacilityCols
      ? facilityColumnKeys.slice(0, 5).map((k) => {
          const kl = String(k).trim().toLowerCase();
          const meta =
            detailFields.find(
              (f) => String(f.define_field_name ?? '').trim().toLowerCase() === kl
            ) ??
            fields.find((f) => String(f.define_field_name ?? '').trim().toLowerCase() === kl);
          const kor = String(meta?.define_field_kor_name ?? '').trim();
          return {
            define_field_name: k,
            define_field_kor_name: getDefineFieldDisplayLabel(k, kor),
            define_field_type: meta?.define_field_type,
          };
        })
      : listFieldsAll.slice(0, 5);
    if (cols.length === 0) return;

    const weights = cols.map((f) => {
      const header = getDefineFieldDisplayLabel(f.define_field_name, f.define_field_kor_name);
      const fieldName = String(f.define_field_name ?? '');
      const cellTexts: string[] = [];
      for (const row of rows) {
        const display = useFacilityCols
          ? formatRoadLedgerFacilityCellValue(fieldName, row as Record<string, unknown>)
          : (() => {
              const v = getRowValueByField(row as Record<string, unknown>, fieldName);
              const meta =
                detailFields.find(
                  (df) =>
                    String(df.define_field_name ?? '').trim().toLowerCase() ===
                    fieldName.trim().toLowerCase()
                ) ?? f;
              return formatDefineFieldDisplayValue(
                v,
                meta.define_field_type,
                codesByField[fieldName.trim().toLowerCase()]
              );
            })();
        cellTexts.push(String(display ?? ''));
      }
      return estimateListColWeight(header, cellTexts);
    });

    const listColRefs = cols.map((f) => ({
      name: String(f.define_field_name ?? ''),
      kor: f.define_field_kor_name,
    }));

    listColWidthsLayerRef.current = activeLayer.tableName;
    setListColWidthsPct(computeListColWidthsPct(weights, listColRefs));
  }, [
    activeLayer,
    isIdentifyMode,
    rows,
    fields,
    detailFields,
    facilityColumnKeys,
    useRoadLedgerFacilityListColumns,
    codesByField,
  ]);

  if (!activeLayer) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground px-4">
        좌측 패널에서 레이어를 선택하세요.
      </div>
    );
  }

  const hasDetail = selectedRow != null;

  const useFacilityCols =
    Boolean(useRoadLedgerFacilityListColumns) && facilityColumnKeys.length > 0;

  const isGeomLikeFieldName = (name: string) => {
    const n = name.trim().toLowerCase();
    return (
      isLayerExtraFieldName(n) ||
      n === 'gid' ||
      n === 'geom' ||
      n === 'geometry' ||
      n === 'the_geom' ||
      n === 'wkb_geometry' ||
      n === 'shape'
    );
  };
  /** 목록 컬럼: '목록 표시' 필드 > detailFields > rows의 키에서 gid/geom 제외한 자동 생성 */
  const autoFields: DefineFieldRow[] = (fields.length === 0 && detailFields.length === 0 && rows.length > 0)
    ? Object.keys(rows[0] as Record<string, unknown>)
        .filter((k) => !isGeomLikeFieldName(k))
        .map((k) => ({ define_field_name: k, define_field_kor_name: k }))
    : [];
  const listFieldsAll = (fields.length > 0 ? fields : detailFields.length > 0 ? detailFields : autoFields).filter(
    (f) => !isGeomLikeFieldName(String(f.define_field_name ?? ''))
  );
  /** 데이터 조회와 동일: 최대 5열. 시설관리 컬럼 순서는 도로대장 설정, 헤더는 defineLayer 한글명 */
  const listFields: DefineFieldRow[] = useFacilityCols
    ? facilityColumnKeys.slice(0, 5).map((k) => {
        const kl = String(k).trim().toLowerCase();
        const meta =
          detailFields.find(
            (f) => String(f.define_field_name ?? "").trim().toLowerCase() === kl
          ) ??
          fields.find((f) => String(f.define_field_name ?? "").trim().toLowerCase() === kl);
        const kor = String(meta?.define_field_kor_name ?? "").trim();
        return {
          define_field_name: k,
          define_field_kor_name: getDefineFieldDisplayLabel(k, kor),
          define_field_type: meta?.define_field_type,
        };
      })
    : listFieldsAll.slice(0, 5);

  const isKeyField = (name: string) =>
    keyFieldName != null && name.trim().toLowerCase() === keyFieldName.trim().toLowerCase();

  const basicVisibleFields = orderDefineFieldsWithKeyFirst(
    detailFields.filter((f) => isDefineFieldFlagTrue(f.define_field_show_detail)),
    keyFieldName
  );

  /** 기본정보 — 상세보기 켠 칸만. 키·읽기전용은 편집모드에서도 값만 표시 */
  const basicInfoFields: InfoField[] =
    selectedRow == null
      ? []
      : basicVisibleFields.length === 0 && detailFields.length === 0
      ? Object.entries(selectedRow)
          .filter(([k]) => !isGeomLikeFieldName(k))
          .sort(([a], [b]) => {
            if (!keyFieldName) return 0;
            const keyLower = keyFieldName.trim().toLowerCase();
            const al = a.trim().toLowerCase();
            const bl = b.trim().toLowerCase();
            if (al === keyLower) return -1;
            if (bl === keyLower) return 1;
            return 0;
          })
          .map(([k, v], i) => ({
            fieldKey: k || `auto-${i}`,
            label: getDefineFieldDisplayLabel(k),
            value: formatDefineFieldDisplayValue(v, undefined, undefined),
            highlight: isKeyField(k),
            readOnly: isKeyField(k),
          }))
      : basicVisibleFields.map((f, i) => {
          const key = String(f.define_field_name ?? '');
          const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name);
          const raw = getRowValueByField(selectedRow, key);
          const readOnly =
            isDefineFieldFlagTrue(f.define_field_read_only) || isKeyField(key);
          return {
            fieldKey: key || `basic-${i}`,
            label,
            value: formatDefineFieldDisplayValue(
              raw,
              f.define_field_type,
              codesByField[key.trim().toLowerCase()]
            ),
            highlight: isKeyField(key),
            readOnly,
          };
        });

  const detailTabs: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'basic', label: '기본정보', icon: FileText },
    { id: 'history', label: '이력관리', icon: History },
    { id: 'attach', label: '첨부파일', icon: Paperclip },
  ];

  /** 현재 페이지 끝이 전체 건수 미만일 때만 다음 페이지 가능 (7건·30건 꽉 찬 마지막 페이지 제외) */
  const hasNextListPage =
    rows.length > 0 &&
    total > 0 &&
    (page - 1) * pageSize + rows.length < total;

  return (
    <>
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 상세 열림 시 패널 닫기는 레이어 목록과 동일하게 헤더 우측 X */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 shrink-0 bg-background">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground truncate">{activeLayer.name}</h3>
          {!isIdentifyMode && (
            <span className="text-[11px] text-muted-foreground">{activeLayer.tableName}</span>
          )}
        </div>
        {hasDetail && (
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
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
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">로딩 중...</div>
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
            <table className="h-full w-full table-fixed border-collapse text-left text-[12px]">
              <colgroup>
                {listFields.map((f, colIndex) => {
                  const fieldName = String(f.define_field_name ?? '');
                  const korName = f.define_field_kor_name;
                  const isNumberCol = isNumberColumnField(fieldName, korName);
                  const colWidth = listColWidthsPct?.[colIndex];
                  const colMinPx = getListColMinPx(fieldName, korName);
                  return (
                    <col
                      key={fieldName}
                      style={{
                        ...(colWidth != null ? { width: `${colWidth}%` } : {}),
                        minWidth: colMinPx,
                        ...(isNumberCol ? { maxWidth: colMinPx } : {}),
                      }}
                    />
                  );
                })}
              </colgroup>
              <thead className="bg-slate-100 dark:bg-muted">
                <tr>
                  {listFields.map((f) => {
                    const fieldName = String(f.define_field_name ?? '');
                    const korName = f.define_field_kor_name;
                    const isNumberCol = isNumberColumnField(fieldName, korName);
                    const headerLabel = getDefineFieldDisplayLabel(fieldName, korName);
                    return (
                      <th
                        key={fieldName}
                        className={cn(
                          'min-w-0 truncate border-b border-border px-2 py-1.5 align-middle text-[12px] font-medium text-slate-500 dark:text-muted-foreground',
                          isNumberCol ? 'text-center' : 'text-left'
                        )}
                        title={headerLabel}
                      >
                        {headerLabel}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {rows.length === 0 ? (
                <tbody>
                  <tr>
                    <td
                      colSpan={listFields.length}
                      className="px-4 py-6 text-center text-[12px] text-muted-foreground"
                    >
                      데이터 없음
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="h-full">
                  {Array.from({ length: pageSize }, (_, rowIndex) => {
                    const row = rows[rowIndex] as Record<string, unknown> | undefined;
                    const rowHeightPct = 100 / pageSize;
                    if (!row) {
                      return (
                        <tr
                          key={`pad-${rowIndex}`}
                          className="border-b border-border"
                          style={{ height: `${rowHeightPct}%` }}
                          aria-hidden
                        >
                          {listFields.map((f) => (
                            <td
                              key={String(f.define_field_name)}
                              className="px-2 first:pl-4 last:pr-4"
                            />
                          ))}
                        </tr>
                      );
                    }
                    const isHighlighted = highlightedRow === rowIndex;
                    return (
                      <tr
                        key={rowIndex}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleRowClick(rowIndex)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleRowClick(rowIndex);
                          }
                        }}
                        style={{ height: `${rowHeightPct}%` }}
                        className={cn(
                          'cursor-pointer border-b border-border transition-colors hover:bg-primary/5',
                          isHighlighted && 'bg-primary/10'
                        )}
                      >
                        {listFields.map((f) => {
                          const fieldName = String(f.define_field_name ?? '');
                          const korName = f.define_field_kor_name;
                          const isNumberCol = isNumberColumnField(fieldName, korName);
                          const display = useFacilityCols
                            ? formatRoadLedgerFacilityCellValue(fieldName, row)
                            : (() => {
                                const v = getRowValueByField(row, fieldName);
                                const meta =
                                  detailFields.find(
                                    (df) =>
                                      String(df.define_field_name ?? '').trim().toLowerCase() ===
                                      fieldName.trim().toLowerCase()
                                  ) ?? f;
                                return formatDefineFieldDisplayValue(
                                  v,
                                  meta.define_field_type,
                                  codesByField[fieldName.trim().toLowerCase()]
                                );
                              })();
                          return (
                            <td
                              key={fieldName}
                              className={cn(
                                'min-w-0 truncate px-2 first:pl-4 last:pr-4 text-slate-900 dark:text-foreground',
                                isNumberCol && 'text-center'
                              )}
                              title={display}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          )}
          
        </div>

        {/* Pagination (다음 버튼 뒤에 닫기) */}
        {!isIdentifyMode && listFields.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-1.5 bg-muted/30 shrink-0">
            <span className="text-[11px] text-muted-foreground">
              {rows.length === 0
                ? '0건'
                : `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + rows.length} / ${total.toLocaleString()}건`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                aria-busy={loading}
                onClick={() => {
                  if (loading || page <= 1) return;
                  paginationOnlyLoadRef.current = true;
                  loadPage(page - 1, undefined, { paginationOnly: true });
                }}
                className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted/50"
              >
                이전
              </button>
              <span className="px-1.5 text-[11px] text-muted-foreground">{page}페이지</span>
              <button
                type="button"
                disabled={!hasNextListPage}
                aria-busy={loading}
                onClick={() => {
                  if (loading || !hasNextListPage) return;
                  paginationOnlyLoadRef.current = true;
                  loadPage(page + 1, undefined, { paginationOnly: true });
                }}
                className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted/50"
              >
                다음
              </button>
              {!hasDetail && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
                >
                  닫기
                </button>
              )}
            </div>
          </div>
        )}
        {!isIdentifyMode && listFields.length === 0 && rows.length === 0 && !loading && !hasDetail && (
          <div className="flex items-center justify-end border-t border-border px-4 py-1.5 bg-muted/30 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="rounded border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
            >
              닫기
            </button>
          </div>
        )}
      </div>

      {/* Detail section - 2/3 */}
      {hasDetail && selectedRow && (
        <div className="flex-[7] min-h-0 flex flex-col border-t-2 border-primary/30 bg-background overflow-hidden">
          {/* Detail tabs */}
          <div className="flex border-b border-border shrink-0">
            {detailTabs.map(({ id, label, icon: TabIcon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
                  activeTab === id
                    ? 'border-b-2 border-primary text-primary bg-primary/5'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
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
                <InfoSection
                  title="기본정보"
                  fields={basicInfoFields}
                  defaultOpen={true}
                  editing={editingBasic}
                  editValues={basicDraft}
                  onFieldChange={(fieldKey, value) =>
                    setBasicDraft((prev) => ({ ...prev, [fieldKey]: value }))
                  }
                />
                {editingBasic && basicError && (
                  <div className="px-4 py-2 text-[11px] text-red-600">{basicError}</div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="px-3 py-2">
                {keyFieldName == null ? (
                  <div className="py-6 text-[11px] text-muted-foreground text-center leading-relaxed px-1">
                    레이어 속성관리에서 키(행 식별 컬럼)를 지정해야 이력을 조회할 수 있습니다.
                  </div>
                ) : selectedRow == null ? (
                  <div className="py-6 text-[11px] text-muted-foreground text-center leading-relaxed px-1">
                    목록에서 행을 선택하세요.
                  </div>
                ) : rowKeyForHistory == null ? (
                  <div className="py-6 text-[11px] text-muted-foreground text-center leading-relaxed px-1">
                    키 컬럼({keyFieldName}) 값이 비어 있어 이력을 조회할 수 없습니다.
                  </div>
                ) : historyLoading ? (
                  <div className="py-4 text-[11px] text-muted-foreground text-center">로딩 중...</div>
                ) : historyError ? (
                  <div className="py-4 text-[11px] text-red-600 text-center">{historyError}</div>
                ) : historyEvents.length === 0 ? (
                  <div className="py-4 text-[11px] text-muted-foreground text-center">이력 없음</div>
                ) : (
                  <div className="relative space-y-0">
                    {historyEvents.map((event, index) => {
                      const config = HISTORY_TYPE_CONFIG[event.type];
                      if (!config) return null;
                      const EventIcon = config.icon;
                      const body = (
                          <>
                          {index < historyEvents.length - 1 && (
                            <div className="absolute left-[17px] top-7 h-[calc(100%-14px)] w-px bg-muted" aria-hidden />
                          )}
                          <div className={cn('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', config.bg)}>
                            <EventIcon className={cn('h-3.5 w-3.5', config.color)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn('text-[10px] font-medium rounded px-1 py-0.5', config.color, config.bg)}>{event.type}</span>
                              <span className="text-[10px] text-muted-foreground">{event.date}</span>
                            </div>
                            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{event.title}</p>
                            {event.description ? (
                              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{event.description}</p>
                            ) : null}
                            {event.author ? (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">담당: {event.author}</p>
                            ) : null}
                          </div>
                          </>
                      );
                      if (dataQueryReadOnly) {
                        return (
                          <div key={event.id} className="relative flex w-full gap-2.5 pb-4 -mx-1 px-1">
                            {body}
                          </div>
                        );
                      }
                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => openHistoryEdit(event)}
                          className="relative flex w-full gap-2.5 pb-4 text-left transition-colors hover:bg-muted/50 rounded-sm -mx-1 px-1"
                        >
                          {body}
                        </button>
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
                {keyFieldName == null ? (
                  <div className="py-6 text-[11px] text-muted-foreground text-center leading-relaxed px-1">
                    레이어 속성관리에서 키(행 식별 컬럼)를 지정해야 첨부폴더를 조회할 수 있습니다.
                  </div>
                ) : selectedRow == null ? (
                  <div className="py-6 text-[11px] text-muted-foreground text-center leading-relaxed px-1">
                    목록에서 행을 선택하세요.
                  </div>
                ) : rowKeyForAttachments == null ? (
                  <div className="py-6 text-[11px] text-muted-foreground text-center leading-relaxed px-1">
                    키 컬럼({keyFieldName}) 값이 비어 있어 첨부폴더를 조회할 수 없습니다.
                  </div>
                ) : (
                  <>
                    {attachChunkUpload.state.status === 'uploading' && (
                      <div className="mb-2 rounded border border-border bg-muted/30 px-2.5 py-2">
                        <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Upload className="h-3 w-3 shrink-0" aria-hidden />
                            업로드 중…
                          </span>
                          <span>{attachChunkUpload.state.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-[width] duration-150"
                            style={{ width: `${attachChunkUpload.state.progress}%` }}
                          />
                        </div>
                        {attachChunkUpload.state.totalChunks > 0 && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
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
                      <div className="py-6 text-[11px] text-muted-foreground text-center">불러오는 중…</div>
                    ) : attachmentQuery.error ? (
                      <div className="py-6 text-[11px] text-red-600 text-center">{attachmentQuery.error}</div>
                    ) : attachmentQuery.files.length === 0 ? (
                      <div className="py-6 text-[11px] text-muted-foreground text-center">첨부파일 없음</div>
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
                          className="flex cursor-pointer items-center gap-2.5 rounded border border-border bg-background p-2.5 pr-1 transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
                            <p className="truncate text-[11px] font-medium text-muted-foreground">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground">
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
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              title="다운로드"
                            >
                              <Download className="h-3 w-3" />
                              <span className="sr-only">다운로드</span>
                            </button>
                            {!dataQueryReadOnly && (
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
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-100 hover:text-red-700"
                              title="삭제"
                            >
                              <X className="h-3 w-3" />
                              <span className="sr-only">삭제</span>
                            </button>
                            )}
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
          <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-2">
            {activeTab === 'basic' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">기본정보</span>
                <div className="flex gap-1.5">
                  {editingBasic ? (
                    <>
                      <button
                        type="button"
                        disabled={basicSaving}
                        onClick={handleCancelBasicEdit}
                        className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={basicSaving}
                        onClick={() => void handleSaveBasicEdit()}
                        className="rounded border border-primary bg-primary px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                      >
                        {basicSaving ? '저장 중…' : '저장'}
                      </button>
                    </>
                  ) : (
                    <>
                      {!dataQueryReadOnly && (
                      <button
                        type="button"
                        disabled={keyFieldName == null || currentRowKey == null}
                        onClick={handleBeginBasicEdit}
                        className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                      >
                        수정
                      </button>
                      )}
                      <button
                        type="button"
                        onClick={handleShowSelectedOnMap}
                        className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
                      >
                        지도보기
                      </button>
                      <button type="button" onClick={closeDetail} className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">닫기</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {activeTab === 'history' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  이력{' '}
                  {keyFieldName != null && rowKeyForHistory != null ? `${historyEvents.length}건` : '—'}
                </span>
                <div className="flex gap-1.5">
                  {!dataQueryReadOnly && (
                  <button
                    type="button"
                    disabled={keyFieldName == null || rowKeyForHistory == null}
                    onClick={openHistoryCreate}
                    className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    이력 추가
                  </button>
                  )}
                  <button type="button" onClick={closeDetail} className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">닫기</button>
                </div>
              </div>
            )}
            {activeTab === 'attach' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  첨부파일{' '}
                  {keyFieldName != null && rowKeyForAttachments != null ? `${attachmentQuery.files.length}건` : '—'}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {!dataQueryReadOnly && (
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
                    className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    파일 추가
                  </button>
                  )}
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
                      className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
                    >
                      전체 다운로드
                    </a>
                  ) : (
                    <span className="rounded border border-border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground cursor-not-allowed">
                      전체 다운로드
                    </span>
                  )}
                  <button type="button" onClick={closeDetail} className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">닫기</button>
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
    <DataQueryHistoryAddDialog
      open={historyAddOpen}
      onOpenChange={(open) => {
        setHistoryAddOpen(open);
        if (!open) setHistoryEditId(null);
      }}
      onConfirm={handleHistorySave}
      onDelete={handleHistoryDelete}
      initialData={historyEditInitial}
      editId={historyEditId}
    />
    </>
  );
}
