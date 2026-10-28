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
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess';
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
import type { IdentifyLayerResult, IdentifyFeatureItem, IdentifyPopupState } from '../hooks/useFeatureIdentify';
import { isOrthoDataQueryLayerId } from '../../_mapContents/aerialView/orthoDataQueryLayerId';
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
import { getAllRoadLedgerFacilityLayerIds } from '../../_mapContents/road/roadLedger/roadLedgerDocLayerMap';
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
        {isOpen ? <ChevronDown className="standard-detail-section-chevron text-foreground/90" /> : <ChevronRight className="standard-detail-section-chevron text-foreground/90" />}
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

/** 목록 12px — 글자 폭. 번호 칸은 이 값으로만 잡고 남는 폭은 주지 않음 */
const LIST_COL_LATIN_CHAR_PX = 7.2;
const LIST_COL_CJK_CHAR_PX = 12;
const LIST_COL_CELL_PAD_PX = 16;
const LIST_COL_EDGE_EXTRA_PX = 8;
const LIST_COL_SAFETY_PX = 4;
/** ogc_fid·id 외 컬럼 최소 너비(px) */
const LIST_COL_DEFAULT_MIN_PX = 75;
const LIST_COL_NUMBER_MIN_PX = 40;

function getListColMinPx(fieldName: string, korName?: string | null): number {
  if (isNumberColumnField(fieldName, korName)) {
    return LIST_COL_NUMBER_MIN_PX;
  }
  return LIST_COL_DEFAULT_MIN_PX;
}

function estimateListTextWidthPx(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? LIST_COL_CJK_CHAR_PX : LIST_COL_LATIN_CHAR_PX;
  }
  return w;
}

/** 헤더·셀 최장 문자열 기준 필요 너비(px). 첫·끝 열은 pl-4/pr-4 포함 */
function estimateListColNeededPx(
  header: string,
  cellTexts: string[],
  opts: { isFirst: boolean; isLast: boolean }
): number {
  let maxText = estimateListTextWidthPx(header);
  for (const t of cellTexts) {
    maxText = Math.max(maxText, estimateListTextWidthPx(t));
  }
  let pad = LIST_COL_CELL_PAD_PX;
  if (opts.isFirst) pad += LIST_COL_EDGE_EXTRA_PX;
  if (opts.isLast) pad += LIST_COL_EDGE_EXTRA_PX;
  return Math.ceil(maxText + pad + LIST_COL_SAFETY_PX);
}

type LayerDataPanelProps = {
  dataTable: string;
  onClose?: () => void;
  onDataKeyChange?: (keyValue: string | number | null) => void;
  /** 지도 식별 «이전»으로 돌아갈 때 dataTable URL 복원 */
  onDataTableChange?: (tableName: string) => void;
  initialDataKey?: string;
  /** true: 도로대장 시설 목록과 동일한 컬럼·표시(코드표 기반). 시설관리에서 연 경우에만 켬 */
  useRoadLedgerFacilityListColumns?: boolean;
};

type IdentifyHistoryEntry =
  | {
      kind: 'identify';
      identify: IdentifyPopupState;
      dataTable: string;
      selectedRow: Record<string, unknown> | null;
      selectedIdentifyIndex: number | null;
    }
  | {
      kind: 'list';
      dataTable: string;
      dataKey: string | null;
      selectedRow: Record<string, unknown> | null;
      /** 5번 클릭 직후와 동일한 목록(30/7)·페이지·하이라이트 */
      listPageSize: number;
      page: number;
      highlightedRow: number | null;
      total: number;
    };

type ListHistoryRestore = {
  dataTable: string;
  dataKey: string | null;
  selectedRow: Record<string, unknown> | null;
  listPageSize: number;
  page: number;
  highlightedRow: number | null;
  total: number;
};

/** 이력용 행 키 — is_key 없으면 ogc_fid/gid/id 사용(하천구역 번호 등) */
function resolveHistoryRowKey(
  row: Record<string, unknown> | null | undefined,
  keyFieldName: string | null
): string | null {
  if (!row) return null;
  const fromKey = getRowKey(row, keyFieldName);
  if (fromKey != null && String(fromKey).trim() !== '') return String(fromKey);
  for (const f of ['ogc_fid', 'gid', 'id']) {
    const v = getRowValueByField(row, f);
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
}

function findRowIndexByHistoryKey(
  rows: Record<string, unknown>[],
  key: string,
  keyFieldName: string | null
): number {
  if (!key) return -1;
  const tryFields = [
    keyFieldName,
    'ogc_fid',
    'gid',
    'id',
  ].filter((f, i, arr): f is string => !!f && arr.indexOf(f) === i);
  for (const field of tryFields) {
    const idx = rows.findIndex((r) => {
      const rowKey = getRowKey(r, field) ?? getRowValueByField(r, field);
      return rowKey != null && String(rowKey) === key;
    });
    if (idx >= 0) return idx;
  }
  return -1;
}

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
  onDataTableChange,
  initialDataKey,
  useRoadLedgerFacilityListColumns = false,
}: LayerDataPanelProps) {
  const mapContext = useMapContext();
  const canWriteDataQuery = useSerWriteAccess('dataQuery');
  const mapInstanceRef = mapContext?.mapInstanceRef;
  const spatialFilterWkt = mapContext?.spatialFilterWkt ?? null;
  const [activeLayer, setActiveLayer] = useState<ActiveLayerInfo | null>(null);
  const identifyResultList = mapContext?.identifyResultList ?? null;
  const identifySelectedRow = mapContext?.identifySelectedRow ?? null;
  const setIdentifySelectedRow = mapContext?.setIdentifySelectedRow;
  const dataQueryMapPick = mapContext?.dataQueryMapPick ?? null;
  const setDataQueryMapPick = mapContext?.setDataQueryMapPick;
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
    detailFields,
    { fallbackTableName: activeLayer?.physicalTableName }
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
  /** 목록 초기 로드 키(테이블|공간필터|식별여부). 중단된 로드는 cleanup에서 null로 되돌려 재시도 */
  const prevListLoadKeyRef = useRef<string | null>(null);
  const [selectedIdentifyIndex, setSelectedIdentifyIndex] = useState<number | null>(null);
  /** loadPage 응답 순서 보장 — 늦게 도착한 7건 응답이 30건 목록을 덮지 않게 */
  const loadPageSeqRef = useRef(0);
  /** 지도에서 고른 항목의 목록 위치 조회 순서 */
  const mapPickSeqRef = useRef(0);
  /** 지도에서 고른 뒤에는 해당 도형만 강조 — 같은 페이지 다른 건은 색을 넣지 않음 */
  const highlightOnlySelectedRef = useRef(false);
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
  /** 레이어별 목록 컬럼 폭(px). 페이지가 바뀌면 더 긴 값만 반영해 늘림 */
  const listColWidthsLayerRef = useRef<string | null>(null);
  const [listColWidthsPx, setListColWidthsPx] = useState<number[] | null>(null);
  const selectedRowDataRef = useRef(selectedRowData);
  selectedRowDataRef.current = selectedRowData;
  const keyFieldNameRef = useRef(keyFieldName);
  keyFieldNameRef.current = keyFieldName;

  const prevHadIdentifyRef = useRef(false);
  /** 지도·검색 식별 결과 히스토리(브라우저 뒤로가기처럼 «이전»으로 한 단계씩) */
  const identifyHistoryRef = useRef<IdentifyHistoryEntry[]>([]);
  /** 라벨·동작용 — 스택 깊이(0이면 «닫기») */
  const [identifyHistoryDepth, setIdentifyHistoryDepth] = useState(0);
  const identifyHistorySkipRef = useRef(false);
  const identifyHistorySkipClearRef = useRef(false);
  /** 목록→식별 직전 화면으로 «이전»할 때, 식별 종료 effect가 선택을 지우지 않도록 */
  const restoreListSelectionRef = useRef<ListHistoryRestore | null>(null);
  /** 목록 복원 중 — 초기 로드가 선택·목록 상태를 덮어쓰지 않게 */
  const restoringListFromHistoryRef = useRef<ListHistoryRestore | null>(null);
  const identifySnapshotRef = useRef<{
    identify: IdentifyPopupState | null;
    dataTable: string;
    selectedRow: Record<string, unknown> | null;
    selectedIdentifyIndex: number | null;
    listPageSize: number;
    page: number;
    highlightedRow: number | null;
    total: number;
  }>({
    identify: null,
    dataTable: '',
    selectedRow: null,
    selectedIdentifyIndex: null,
    listPageSize: PAGE_SIZE_LIST,
    page: 1,
    highlightedRow: null,
    total: 0,
  });

  /** 새 식별·검색이 들어오면 직전 화면(목록 또는 이전 식별)을 스택에 push */
  useEffect(() => {
    const skipping = identifyHistorySkipRef.current;
    if (skipping) {
      identifyHistorySkipRef.current = false;
    }

    const prev = identifySnapshotRef.current;
    const identifyChanged = prev.identify !== identifyResultList;
    if (!skipping && identifyChanged) {
      if (identifyResultList != null && prev.identify != null) {
        identifyHistoryRef.current.push({
          kind: 'identify',
          identify: prev.identify,
          dataTable: prev.dataTable,
          selectedRow: prev.selectedRow,
          selectedIdentifyIndex: prev.selectedIdentifyIndex,
        });
        setIdentifyHistoryDepth(identifyHistoryRef.current.length);
      } else if (identifyResultList != null && prev.identify == null) {
        // 패널이 닫힌 채 지도만 클릭해 연 경우는 복원할 목록이 없음 → push 안 함(«닫기»)
        const hasListToRestore =
          prev.selectedRow != null ||
          prev.total > 0 ||
          (prev.highlightedRow != null && prev.highlightedRow >= 0);
        if (hasListToRestore) {
          const row = prev.selectedRow;
          const keyVal = resolveHistoryRowKey(row, keyFieldNameRef.current);
          identifyHistoryRef.current.push({
            kind: 'list',
            dataTable: prev.dataTable,
            dataKey: keyVal,
            selectedRow: row,
            listPageSize: prev.listPageSize,
            page: prev.page,
            highlightedRow: prev.highlightedRow,
            total: prev.total,
          });
          setIdentifyHistoryDepth(identifyHistoryRef.current.length);
        }
      } else if (identifyResultList == null) {
        identifyHistoryRef.current = [];
        setIdentifyHistoryDepth(0);
      }
    }

    identifySnapshotRef.current = {
      identify: identifyResultList,
      dataTable: dataTable.trim(),
      selectedRow: selectedRowDataRef.current,
      selectedIdentifyIndex: selectedIdentifyIndex,
      listPageSize,
      page,
      highlightedRow,
      total,
    };
  }, [
    identifyResultList,
    dataTable,
    selectedIdentifyIndex,
    selectedRowData,
    listPageSize,
    page,
    highlightedRow,
    total,
  ]);

  /** 새 식별·검색 결과 시 목록 선택 초기화. 식별 종료 시에만 상세 상태 정리(일반 목록 조회와 충돌 방지). */
  useEffect(() => {
    const total =
      identifyResultList?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0;
    const hasIdentify =
      identifyResultList != null &&
      (total > 0 || (Boolean(identifyResultList.listHeaderLabel?.trim()) && total === 0));
    if (hasIdentify) {
      if (identifyHistorySkipClearRef.current) {
        identifyHistorySkipClearRef.current = false;
      } else {
        setSelectedIdentifyIndex(null);
        setSelectedRowData(null);
      }
    } else if (prevHadIdentifyRef.current) {
      const restore = restoreListSelectionRef.current;
      if (restore) {
        restoreListSelectionRef.current = null;
        pendingAutoSelectFirstRef.current = false;
        suppressDataKeySelectRef.current = false;
        setSelectedIdentifyIndex(null);
        setSelectedRowData(restore.selectedRow);
      } else {
        setSelectedIdentifyIndex(null);
        setSelectedRowData(null);
        selectionSourceRef.current?.clear();
        setRadarActive(false);
      }
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

  /** 안전점검 시설물 3테이블 — 데이터조회에서 조회만. 또는 서비스 읽기 권한만 */
  const dataQueryReadOnly = useMemo(
    () =>
      isFmsFacilityLayerTable(
        activeLayer?.physicalTableName ?? activeLayer?.tableName ?? null
      ) || !canWriteDataQuery,
    [activeLayer?.physicalTableName, activeLayer?.tableName, canWriteDataQuery]
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

  const mapReady = mapContext?.mapReady ?? false;

  useEffect(() => {
    const mapInstance = mapInstanceRef?.current;
    if (!mapReady || !mapInstance) return;
    const source = new VectorSource();
    highlightSourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQueryBulkListHighlightStyle(),
      properties: { listHighlightLayer: true },
    });
    layer.set('listHighlightLayer', true);
    insertLayerBelowServiceLayer(mapInstance, layer);
    highlightLayerRef.current = layer;

    const selSource = new VectorSource();
    selectionSourceRef.current = selSource;
    const selectionLayer = new VectorLayer({
      source: selSource,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    });
    selectionLayer.set('listSelectionLayer', true);
    insertLayerBelowServiceLayer(mapInstance, selectionLayer);
    selectionLayerRef.current = selectionLayer;

    return () => {
      mapInstance.removeLayer(selectionLayer);
      mapInstance.removeLayer(layer);
      if (selectionSourceRef.current === selSource) selectionSourceRef.current = null;
      if (selectionLayerRef.current === selectionLayer) selectionLayerRef.current = null;
      if (highlightSourceRef.current === source) highlightSourceRef.current = null;
      if (highlightLayerRef.current === layer) highlightLayerRef.current = null;
    };
  }, [mapReady, mapInstanceRef]);

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

  const ensureListMapLayers = useCallback(() => {
    const mapInstance = mapInstanceRef?.current;
    if (!mapInstance) return null;
    const onMap = mapInstance.getLayers().getArray();
    const bulk = highlightLayerRef.current;
    const sel = selectionLayerRef.current;
    if (bulk && !onMap.includes(bulk)) insertLayerBelowServiceLayer(mapInstance, bulk);
    if (sel && !onMap.includes(sel)) insertLayerBelowServiceLayer(mapInstance, sel);
    return mapInstance;
  }, [mapInstanceRef]);

  /** 목록 데이터를 지도에 표시만 함. 레이어 on/off 시 지도 이동·줌은 하지 않음 */
  const showCurrentListOnMap = useCallback(
    (dataRows: Record<string, unknown>[]) => {
      const mapInstance = ensureListMapLayers();
      const source = highlightSourceRef.current;
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
    [ensureListMapLayers]
  );

  /**
   * 식별·행 선택 시 도형 강조.
   * fit 기본 true(목록·URL 선택). 지도 객체 클릭은 fit:false — 강조만.
   */
  const showIdentifyFeatureOnMap = useCallback(
    (record: Record<string, unknown>, opts?: { fit?: boolean }) => {
      const doFit = opts?.fit !== false;
      const mapInstance = ensureListMapLayers() ?? mapContext?.mapInstanceRef?.current;
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
      if (doFit) {
        const ext = source.getExtent();
        if (ext.every((v) => isFinite(v))) {
          scheduleFitMapToExtent3857(mapInstance, ext as [number, number, number, number], {
            maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
            applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
          });
        }
      }
      setRadarActive(true);
    },
    [mapContext, ensureListMapLayers]
  );

  /** 상세 하단 「지도보기」 — 현재 선택된 행 도형으로 지도 이동·확대 (목록 클릭 자동이동과 별개로 수동 재이동) */
  const handleShowSelectedOnMap = useCallback(() => {
    const mapInstance = ensureListMapLayers() ?? mapContext?.mapInstanceRef?.current;
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
  }, [mapContext, selectedRowData, ensureListMapLayers]);

  useEffect(() => {
    if (isIdentifyMode) return;
    if (!mapReady) return;
    if (selectedRowData == null) {
      selectionSourceRef.current?.clear();
      setRadarActive(false);
      return;
    }
    const doFit = pendingMapFitFromSelectionRef.current;
    pendingMapFitFromSelectionRef.current = false;
    showIdentifyFeatureOnMap(selectedRowData, { fit: doFit });
  }, [isIdentifyMode, mapReady, selectedRowData, showIdentifyFeatureOnMap]);

  useEffect(() => {
    if (selectedIdentifyIndex == null) return;
    selectedIdentifyRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdentifyIndex, selectedRowData]);

  /**
   * 목록 초기 로드.
   * - 로드 키: 테이블 + 공간필터 + 식별모드 (행 선택 dataKey·identify 결과 객체 변경은 재조회하지 않음)
   * - cleanup에서 미완료 로드 키를 비워, Strict Mode 재마운트·의존성 재실행 시 조기 return으로
   *   loading이 영구 true로 남는 레이스를 방지한다.
   */
  useEffect(() => {
    if (!activeLayer) return;
    const isIdentify = isIdentifyMode;
    const restorePending = restoringListFromHistoryRef.current;
    // 지도 클릭으로 dataTable이 바뀐 뒤 «이전» 시: URL 테이블이 맞을 때까지 복원 플래그 유지
    if (
      !isIdentify &&
      restorePending != null &&
      restorePending.dataTable.trim().toLowerCase() !==
        activeLayer.tableName.trim().toLowerCase()
    ) {
      pendingAutoSelectFirstRef.current = false;
      return;
    }

    const loadKey = [
      activeLayer.tableName,
      activeLayer.physicalTableName,
      activeLayer.schema,
      activeLayer.rowFilterSql ?? '',
      spatialFilterWkt ?? '',
      isIdentify ? 'id' : 'list',
    ].join('|');
    if (prevListLoadKeyRef.current === loadKey) return;

    let cancelled = false;
    let settled = false;
    prevListLoadKeyRef.current = loadKey;

    setFields([]);
    setDetailFields([]);
    setKeyFieldName(null);
    const restoreState = restoringListFromHistoryRef.current;
    const isListRestore = !isIdentify && restoreState != null;
    const keyAtOpen =
      !isListRestore && initialDataKey != null ? String(initialDataKey).trim() : '';
    const useKey = !isIdentify && keyAtOpen !== '';
    const restorePs = isListRestore
      ? Math.max(1, restoreState.listPageSize || PAGE_SIZE_DETAIL)
      : useKey
        ? PAGE_SIZE_DETAIL
        : PAGE_SIZE_LIST;
    const restorePage = isListRestore ? Math.max(1, restoreState.page || 1) : 1;
    if (!isIdentify) {
      setRows([]);
      setHighlightedRow(null);
      if (!isListRestore) {
        setSelectedRowData(null);
      }
      setSelectedIdentifyIndex(null);
      setListPageSize(restorePs);
      suppressDataKeySelectRef.current = false;
      pendingAutoSelectFirstRef.current = !isListRestore && mapContext?.dataQueryMapPick == null;
      pendingHighlightIndexRef.current = null;
      listColWidthsLayerRef.current = null;
      setListColWidthsPx(null);
      loadPageSeqRef.current += 1;
    }
    const initSeq = loadPageSeqRef.current;
    setLoading(true);
    setError(null);
    setPage(isListRestore ? restorePage : 1);
    setTotal(0);
    if (!isIdentify) setActiveTab('basic');
    if (!isIdentify) {
      highlightSourceRef.current?.clear();
      if (!isListRestore) {
        selectionSourceRef.current?.clear();
        setRadarActive(false);
      }
    }

    const tableDataParams = {
      table: activeLayer.physicalTableName,
      schema: activeLayer.schema,
      limit: restorePs,
      offset: isListRestore ? (restorePage - 1) * restorePs : 0,
      ...(spatialFilterWkt ? { spatialWkt: spatialFilterWkt, spatialSrid: 5181 } : {}),
      ...(activeLayer.rowFilterSql ? { rowFilter: activeLayer.rowFilterSql } : {}),
    };
    const fieldsPromise = fetch(
      `/api/config/defineLayer/fields/${encodeURIComponent(activeLayer.physicalTableName)}`
    ).then((r) => r.json());
    // 목록 복원: 클릭 당시와 같은 페이지·건수로 getTableData (1건 key 조회 금지)
    // 새로고침(dataKey): 1건만 넣지 않고 상세 목록과 같은 칸 수로 해당 페이지를 연다
    const dataPromise = isIdentify
      ? Promise.resolve({ rows: [] as Record<string, unknown>[], total: 0 })
      : useKey
      ? call('', 'POST', {
          service: 'standardService',
          action: 'getTableRowOffset',
          params: {
            table: activeLayer.physicalTableName,
            schema: activeLayer.schema,
            keyValue: keyAtOpen,
            ...(spatialFilterWkt ? { spatialWkt: spatialFilterWkt, spatialSrid: 5181 } : {}),
            ...(activeLayer.rowFilterSql ? { rowFilter: activeLayer.rowFilterSql } : {}),
          },
        }).then((offsetRes) => {
          const d = offsetRes?.data ?? offsetRes;
          const offset = typeof d?.offset === 'number' ? d.offset : -1;
          const totalHint = typeof d?.total === 'number' ? d.total : 0;
          const safeOffset = offset >= 0 ? offset : 0;
          const keyPage = Math.floor(safeOffset / PAGE_SIZE_DETAIL) + 1;
          const rowIndex = offset >= 0 ? safeOffset % PAGE_SIZE_DETAIL : 0;
          return call('', 'POST', {
            service: 'standardService',
            action: 'getTableData',
            params: {
              ...tableDataParams,
              limit: PAGE_SIZE_DETAIL,
              offset: (keyPage - 1) * PAGE_SIZE_DETAIL,
            },
          }).then((listRes) => ({
            __keyOpen: true as const,
            dataRes: listRes,
            page: keyPage,
            rowIndex,
            totalHint,
          }));
        })
      : call('', 'POST', {
          service: 'standardService',
          action: 'getTableData',
          params: tableDataParams,
        });

    Promise.all([fieldsPromise, dataPromise])
      .then(([fieldsRes, dataRes]) => {
        if (cancelled || initSeq !== loadPageSeqRef.current) return;
        // 복원 페이로드는 이 로드가 대상 테이블일 때만 소비
        const restoreDone = isListRestore ? restoreState : null;
        if (isListRestore) {
          restoringListFromHistoryRef.current = null;
        }
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
        const resolvedKeyFieldName = keyField
          ? String(keyField.define_field_name ?? '').trim() || null
          : null;
        setKeyFieldName(resolvedKeyFieldName);

        if (isListRestore && restoreDone) {
          const data = dataRes?.data ?? dataRes;
          const dataRows: Record<string, unknown>[] = Array.isArray(data?.rows) ? data.rows : [];
          const dataTotal =
            typeof data?.total === 'number'
              ? data.total
              : restoreDone.total > 0
                ? restoreDone.total
                : 0;
          pendingAutoSelectFirstRef.current = false;
          setListPageSize(restorePs);
          setPage(restorePage);
          setRows(dataRows);
          setTotal(dataTotal);

          const key = restoreDone.dataKey != null ? String(restoreDone.dataKey).trim() : '';
          let idx = key
            ? findRowIndexByHistoryKey(dataRows, key, resolvedKeyFieldName)
            : -1;
          if (
            idx < 0 &&
            restoreDone.highlightedRow != null &&
            restoreDone.highlightedRow >= 0 &&
            restoreDone.highlightedRow < dataRows.length
          ) {
            idx = restoreDone.highlightedRow;
          }
          if (idx >= 0 && dataRows[idx]) {
            pendingMapFitFromSelectionRef.current = false;
            pendingHighlightIndexRef.current = idx;
            setHighlightedRow(idx);
            setSelectedRowData(dataRows[idx]);
            highlightSourceRef.current?.clear();
            showIdentifyFeatureOnMap(dataRows[idx]);
          } else if (restoreDone.selectedRow) {
            setSelectedRowData(restoreDone.selectedRow);
            highlightSourceRef.current?.clear();
            showIdentifyFeatureOnMap(restoreDone.selectedRow);
          } else {
            showCurrentListOnMap(dataRows);
          }
          settled = true;
          setLoading(false);
          return;
        }

        if (useKey) {
          const packed = dataRes as {
            __keyOpen?: boolean;
            dataRes?: { data?: unknown } | Record<string, unknown>;
            page?: number;
            rowIndex?: number;
            totalHint?: number;
          };
          const inner = packed?.__keyOpen ? packed.dataRes : dataRes;
          const data = (inner as { data?: unknown } | undefined)?.data ?? inner;
          const dataRows: Record<string, unknown>[] = Array.isArray(
            (data as { rows?: unknown } | undefined)?.rows
          )
            ? ((data as { rows: Record<string, unknown>[] }).rows)
            : [];
          const dataTotal =
            typeof (data as { total?: unknown } | undefined)?.total === 'number'
              ? (data as { total: number }).total
              : typeof packed?.totalHint === 'number'
                ? packed.totalHint
                : 0;
          const keyPage = packed?.page ?? 1;
          const rowIndex = packed?.rowIndex ?? 0;
          pendingAutoSelectFirstRef.current = false;
          pendingMapFitFromSelectionRef.current = false;
          setListPageSize(PAGE_SIZE_DETAIL);
          setPage(keyPage);
          setRows(dataRows);
          setTotal(dataTotal);
          highlightSourceRef.current?.clear();
          const row = dataRows[rowIndex];
          if (row) {
            pendingHighlightIndexRef.current = rowIndex;
            setSelectedRowData(row);
            setHighlightedRow(rowIndex);
            showIdentifyFeatureOnMap(row);
          }
        } else if (!isIdentify) {
          const data = dataRes?.data ?? dataRes;
          const dataRows = Array.isArray(data?.rows) ? data.rows : [];
          const dataTotal = typeof data?.total === 'number' ? data.total : 0;
          setRows(dataRows);
          setTotal(dataTotal);
          if (pendingAutoSelectFirstRef.current) {
            highlightSourceRef.current?.clear();
          } else {
            showCurrentListOnMap(dataRows);
          }
        } else {
          setRows([]);
          setTotal(identifyResultList?.results?.reduce((s, r) => s + r.features.length, 0) ?? 0);
        }
        settled = true;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || initSeq !== loadPageSeqRef.current) return;
        if (isListRestore) {
          restoringListFromHistoryRef.current = null;
        }
        settled = true;
        setError(err?.message ?? String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadPageSeqRef.current += 1;
      // 미완료 로드만 키를 비움 → 재실행 시 조기 return으로 loading 고정되는 것 방지
      if (!settled && prevListLoadKeyRef.current === loadKey) {
        prevListLoadKeyRef.current = null;
      }
    };
    // initialDataKey·identifyResultList·콜백은 로드 키에 넣지 않음(행 선택·식별 결과 갱신 시 전체 재조회로 loading 레이스 유발)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showCurrentListOnMap/showIdentifyFeatureOnMap/identifyResultList/initialDataKey 의도적 제외
  }, [
    activeLayer,
    spatialFilterWkt,
    isIdentifyMode,
  ]);

  // 지도 객체 클릭(식별) → 상세·강조만 (맵 무브 없음)
  useEffect(() => {
    if (!isIdentifyMode || identifySelectedRow == null || !setIdentifySelectedRow) return;
    const row = identifySelectedRow;
    const idx = identifyFlat.findIndex((item) => item.feature.data === row);
    setSelectedRowData(row);
    setSelectedIdentifyIndex(idx >= 0 ? idx : null);
    setActiveTab('basic');
    setIdentifySelectedRow(null);
    // 레이어 생성·activeLayer null 클리어 이후 강조 (첫 패널 오픈 레이스 방지)
    let cancelled = false;
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        showIdentifyFeatureOnMap(row, { fit: false });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isIdentifyMode, identifySelectedRow, identifyFlat, setIdentifySelectedRow, showIdentifyFeatureOnMap]);

  useEffect(() => {
    if (!activeLayer) {
      prevListLoadKeyRef.current = null;
      pendingAutoSelectFirstRef.current = false;
      pendingHighlightIndexRef.current = null;
      listColWidthsLayerRef.current = null;
      setListColWidthsPx(null);
      // 식별으로 패널이 열릴 때 activeLayer 로드 전에 강조를 지우면 첫 선택이 비어 보임
      if (!isIdentifyMode) {
        highlightSourceRef.current?.clear();
        selectionSourceRef.current?.clear();
        setRadarActive(false);
      }
    }
  }, [activeLayer, isIdentifyMode]);

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
          if (
            highlightOnlySelectedRef.current ||
            selectedRowDataRef.current != null
          ) {
            highlightOnlySelectedRef.current = false;
            highlightSourceRef.current?.clear();
          } else {
            showCurrentListOnMap(dataRows);
          }
        })
        .catch((err) => {
          if (seq !== loadPageSeqRef.current) return;
          highlightOnlySelectedRef.current = false;
          setError(err?.message ?? String(err));
          setLoading(false);
        });
    },
    [activeLayer, total, listPageSize, mapContext, showCurrentListOnMap]
  );

  // 앱 안에서 행 선택 시 URL의 dataKey만 반영 → 선택/하이라이트 동기화 (목록↔상세 칸 수 맞춤)
  useEffect(() => {
    if (paginationOnlyLoadRef.current) return;
    if (dataQueryMapPick) return;
    if (!activeLayer || isIdentifyMode || !keyFieldName || rows.length === 0) return;
    const key = initialDataKey != null ? String(initialDataKey).trim() : '';
    if (key === '') {
      suppressDataKeySelectRef.current = false;
      return;
    }
    if (suppressDataKeySelectRef.current) {
      const alreadyKey = resolveHistoryRowKey(selectedRowData, keyFieldName);
      if (alreadyKey != null && String(alreadyKey) === key) {
        suppressDataKeySelectRef.current = false;
      }
      return;
    }
    const idx = rows.findIndex((r) => {
      const rowKey = getRowKey(r, keyFieldName);
      return rowKey != null && String(rowKey) === key;
    });
    if (idx < 0) return;
    pendingAutoSelectFirstRef.current = false;
    pendingMapFitFromSelectionRef.current = false;
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
    dataQueryMapPick,
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
    if (dataQueryMapPick) return;
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
    pendingMapFitFromSelectionRef.current = false;
    highlightOnlySelectedRef.current = true;
    pendingHighlightIndexRef.current = newRowIndex;
    setHighlightedRow(newRowIndex);
    setSelectedRowData(rowData);
    highlightSourceRef.current?.clear();
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
    dataQueryMapPick,
  ]);

  /** 지도에서 고른 1건 → 기존 목록의 해당 페이지·상세 */
  useEffect(() => {
    if (!dataQueryMapPick || !setDataQueryMapPick) return;
    pendingAutoSelectFirstRef.current = false;
    const pickTable = String(dataQueryMapPick.tableName ?? '').trim();
    if (!pickTable || pickTable !== dataTable.trim()) return;
    if (!activeLayer || activeLayer.tableName !== pickTable) return;
    if (isIdentifyMode) return;
    if (keyFieldName == null && loading) return;

    const row = dataQueryMapPick.row;
    const keyVal = resolveHistoryRowKey(row, keyFieldName);
    const seq = ++mapPickSeqRef.current;
    let cancelled = false;

    const applyAtOffset = (offset: number, totalHint: number) => {
      if (cancelled || seq !== mapPickSeqRef.current) return;
      pendingAutoSelectFirstRef.current = false;
      suppressDataKeySelectRef.current = true;
      highlightOnlySelectedRef.current = true;
      /** 지도에서 이미 보고 있는 도형 — 목록·URL 동기화가 다시 맞추지 않게 */
      pendingMapFitFromSelectionRef.current = false;
      if (offset < 0) {
        pendingHighlightIndexRef.current = 0;
        setRows([row]);
        setTotal(Math.max(1, totalHint));
        setSelectedRowData(row);
        setHighlightedRow(0);
        setPage(1);
        setListPageSize(PAGE_SIZE_DETAIL);
        setActiveTab('basic');
        onDataKeyChange?.(keyVal);
        showIdentifyFeatureOnMap(row, { fit: false });
        setDataQueryMapPick(null);
        return;
      }
      const newPage = Math.floor(offset / PAGE_SIZE_DETAIL) + 1;
      const newRowIndex = offset % PAGE_SIZE_DETAIL;
      pendingHighlightIndexRef.current = newRowIndex;
      setSelectedRowData(row);
      setHighlightedRow(newRowIndex);
      setListPageSize(PAGE_SIZE_DETAIL);
      setActiveTab('basic');
      onDataKeyChange?.(keyVal);
      showIdentifyFeatureOnMap(row, { fit: false });
      setDataQueryMapPick(null);
      loadPage(newPage, PAGE_SIZE_DETAIL);
    };

    if (keyVal == null) {
      applyAtOffset(-1, 1);
      return () => {
        cancelled = true;
      };
    }

    call('', 'POST', {
      service: 'standardService',
      action: 'getTableRowOffset',
      params: {
        table: activeLayer.physicalTableName,
        schema: activeLayer.schema,
        keyValue: keyVal,
        ...(keyFieldName ? { keyField: keyFieldName } : {}),
        ...(spatialFilterWkt ? { spatialWkt: spatialFilterWkt, spatialSrid: 5181 } : {}),
        ...(activeLayer.rowFilterSql ? { rowFilter: activeLayer.rowFilterSql } : {}),
      },
    })
      .then((res) => {
        if (cancelled || seq !== mapPickSeqRef.current) return;
        const d = res?.data ?? res;
        const offset = typeof d?.offset === 'number' ? d.offset : -1;
        const totalHint = typeof d?.total === 'number' ? d.total : 0;
        applyAtOffset(offset, totalHint);
      })
      .catch(() => {
        if (cancelled || seq !== mapPickSeqRef.current) return;
        applyAtOffset(-1, 1);
      });

    return () => {
      cancelled = true;
    };
  }, [
    dataQueryMapPick,
    setDataQueryMapPick,
    dataTable,
    activeLayer,
    isIdentifyMode,
    keyFieldName,
    loading,
    spatialFilterWkt,
    loadPage,
    onDataKeyChange,
    showIdentifyFeatureOnMap,
  ]);

  const handleClose = () => {
    if (mapContext?.suppressMapIdentifyUntilRef) {
      mapContext.suppressMapIdentifyUntilRef.current = Date.now() + 400;
    }
    identifyHistoryRef.current = [];
    setIdentifyHistoryDepth(0);
    mapContext?.setIdentifyResultList?.(null);
    setDataQueryMapPick?.(null);
    onClose?.();
  };

  /**
   * 식별 화면 하단·헤더 동작.
   * - 스택이 있으면 «이전»(직전 목록·식별으로 복귀)
   * - 스택이 없으면 «닫기»(패널이 닫힌 채 지도만 클릭한 경우 등)
   */
  const handleBackFromIdentify = () => {
    const prev = identifyHistoryRef.current.pop();
    setIdentifyHistoryDepth(identifyHistoryRef.current.length);
    if (prev?.kind === 'identify') {
      identifyHistorySkipRef.current = true;
      identifyHistorySkipClearRef.current = true;
      mapContext?.setIdentifyResultList?.(prev.identify);
      mapContext?.setIdentifySelectedRow?.(null);
      setSelectedRowData(prev.selectedRow);
      setSelectedIdentifyIndex(prev.selectedIdentifyIndex);
      setActiveTab('basic');
      if (prev.selectedRow) {
        showIdentifyFeatureOnMap(prev.selectedRow);
      } else {
        selectionSourceRef.current?.clear();
        setRadarActive(false);
      }
      if (prev.dataTable && prev.dataTable !== dataTable.trim()) {
        onDataTableChange?.(prev.dataTable);
      }
      onDataKeyChange?.(null);
      return;
    }

    if (prev?.kind === 'list') {
      const restorePayload: ListHistoryRestore = {
        dataTable: prev.dataTable,
        dataKey: prev.dataKey,
        selectedRow: prev.selectedRow,
        listPageSize: prev.listPageSize,
        page: prev.page,
        highlightedRow: prev.highlightedRow,
        total: prev.total,
      };
      identifyHistorySkipRef.current = true;
      restoreListSelectionRef.current = restorePayload;
      restoringListFromHistoryRef.current = restorePayload;
      pendingAutoSelectFirstRef.current = false;
      suppressDataKeySelectRef.current = false;
      mapContext?.setIdentifyResultList?.(null);
      mapContext?.setIdentifySelectedRow?.(null);
      setSelectedIdentifyIndex(null);
      if (prev.dataTable && prev.dataTable !== dataTable.trim()) {
        onDataTableChange?.(prev.dataTable);
      }
      onDataKeyChange?.(prev.dataKey);
      return;
    }

    handleClose();
  };

  const identifyNavLabel = identifyHistoryDepth > 0 ? '이전' : '닫기';
  const handleIdentifyNav = identifyHistoryDepth > 0 ? handleBackFromIdentify : handleClose;

  const handleIdentifyItemClick = (item: { layer: IdentifyLayerResult; feature: IdentifyFeatureItem; index: number }) => {
    const { feature, index, layer } = item;

    // 드론영상 범위(가상): 우측 목록에서 고르면 해당 영상만 지도에 표시
    if (isOrthoDataQueryLayerId(layer.tableName) || feature.data?.__orthoExtent === true) {
      const tu = Number(feature.data?.tuKey);
      if (Number.isFinite(tu)) {
        mapContext?.setOrthoDataQueryTuKeys?.([tu]);
      }
      setSelectedRowData(feature.data);
      setSelectedIdentifyIndex(index);
      setActiveTab('basic');
      const ext = feature.data?.extent3857;
      const map = mapInstanceRef?.current;
      if (
        map &&
        Array.isArray(ext) &&
        ext.length === 4 &&
        ext.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        map.getView().fit(ext as [number, number, number, number], {
          padding: [80, 80, 80, 80],
          maxZoom: 18,
          duration: 400,
        });
      }
      return;
    }

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
    showIdentifyFeatureOnMap(feature.data, { fit: false });
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
        pendingMapFitFromSelectionRef.current = false;
        highlightOnlySelectedRef.current = true;
        pendingHighlightIndexRef.current = rowIndex;
        setHighlightedRow(rowIndex);
        setSelectedRowData(rowData);
        highlightSourceRef.current?.clear();
        showIdentifyFeatureOnMap(rowData);
        setActiveTab((tab) => (tab === 'attach' ? 'attach' : 'basic'));
        onDataKeyChange?.(keyVal);
      } else {
        const absoluteOffset = (page - 1) * PAGE_SIZE_LIST + rowIndex;
        const newPage = Math.floor(absoluteOffset / PAGE_SIZE_DETAIL) + 1;
        const newRowIndex = absoluteOffset % PAGE_SIZE_DETAIL;
        pendingMapFitFromSelectionRef.current = false;
        highlightOnlySelectedRef.current = true;
        pendingHighlightIndexRef.current = newRowIndex;
        setHighlightedRow(newRowIndex);
        setSelectedRowData(rowData);
        highlightSourceRef.current?.clear();
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
    () => new Set(getAllRoadLedgerFacilityLayerIds()),
    []
  );

  const facilityColumnKeys = useMemo(() => {
    if (!activeLayer || !useRoadLedgerFacilityListColumns) return [];
    const tn = activeLayer.physicalTableName.trim().toLowerCase();
    if (!roadLedgerFacilityTableSet.has(tn)) return [];
    const sample = (rows[0] as Record<string, unknown> | undefined) ?? {};
    return getRoadLedgerFacilityColumnKeys(tn, sample);
  }, [activeLayer, useRoadLedgerFacilityListColumns, rows, roadLedgerFacilityTableSet]);

  // 헤더·현재 페이지 셀 최장 길이로 컬럼 폭(px) 산정. 이후 페이지는 더 긴 값만 반영
  useLayoutEffect(() => {
    if (!activeLayer || isIdentifyMode) return;
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

    const needed = cols.map((f, colIndex) => {
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
      const fromText = estimateListColNeededPx(header, cellTexts, {
        isFirst: colIndex === 0,
        isLast: colIndex === cols.length - 1,
      });
      return Math.max(fromText, getListColMinPx(fieldName, f.define_field_kor_name));
    });

    const tableName = activeLayer.tableName;
    setListColWidthsPx((prev) => {
      const sameLayer = listColWidthsLayerRef.current === tableName;
      listColWidthsLayerRef.current = tableName;
      if (!sameLayer || prev == null || prev.length !== needed.length) {
        return needed;
      }
      return needed.map((n, i) => Math.max(n, prev[i] ?? 0));
    });
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
      {/* 상세 열림 시: 일반 목록은 패널 닫기(X), 지도 식별은 이력 있으면 이전·없으면 닫기 */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 shrink-0 bg-background">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground truncate">{activeLayer.name}</h3>
          {!isIdentifyMode && (
            <span className="text-[11px] text-muted-foreground">{activeLayer.tableName}</span>
          )}
        </div>
        {(hasDetail || isIdentifyMode) && (
          <button
            type="button"
            onClick={isIdentifyMode ? handleIdentifyNav : handleClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title={isIdentifyMode ? identifyNavLabel : '닫기'}
            aria-label={isIdentifyMode ? identifyNavLabel : '닫기'}
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
              onClose={handleIdentifyNav}
              showFooterClose={!hasDetail}
              footerActionLabel={identifyNavLabel}
            />
          )}
          {!isIdentifyMode && !error && listFields.length > 0 && (rows.length > 0 || !loading) && (
            <table className="h-full w-full table-fixed border-collapse text-left text-[12px]">
              <colgroup>
                {listFields.map((f, colIndex) => {
                  const fieldName = String(f.define_field_name ?? '');
                  const korName = f.define_field_kor_name;
                  const isNumberCol = isNumberColumnField(fieldName, korName);
                  const colPx = listColWidthsPx?.[colIndex] ?? getListColMinPx(fieldName, korName);
                  return (
                    <col
                      key={fieldName}
                      style={
                        isNumberCol
                          ? { width: colPx, minWidth: colPx, maxWidth: colPx }
                          : { minWidth: colPx }
                      }
                    />
                  );
                })}
              </colgroup>
              <thead className="bg-slate-100 dark:bg-muted">
                <tr>
                  {listFields.map((f, colIndex) => {
                    const fieldName = String(f.define_field_name ?? '');
                    const korName = f.define_field_kor_name;
                    const isNumberCol = isNumberColumnField(fieldName, korName);
                    const headerLabel = getDefineFieldDisplayLabel(fieldName, korName);
                    const colPx = listColWidthsPx?.[colIndex] ?? getListColMinPx(fieldName, korName);
                    return (
                      <th
                        key={fieldName}
                        className={cn(
                          'whitespace-nowrap border-b border-border px-2 py-1.5 first:pl-4 last:pr-4 align-middle text-[12px] font-medium text-slate-500 dark:text-muted-foreground',
                          isNumberCol ? 'text-center' : 'text-left'
                        )}
                        style={
                          isNumberCol
                            ? { width: colPx, maxWidth: colPx }
                            : { minWidth: colPx }
                        }
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
                        {listFields.map((f, colIndex) => {
                          const fieldName = String(f.define_field_name ?? '');
                          const korName = f.define_field_kor_name;
                          const isNumberCol = isNumberColumnField(fieldName, korName);
                          const colPx = listColWidthsPx?.[colIndex] ?? getListColMinPx(fieldName, korName);
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
                                'whitespace-nowrap px-2 first:pl-4 last:pr-4 text-slate-900 dark:text-foreground',
                                isNumberCol && 'text-center'
                              )}
                              style={
                                isNumberCol
                                  ? { width: colPx, maxWidth: colPx }
                                  : { minWidth: colPx }
                              }
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
                      <button type="button" onClick={handleClose} className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">닫기</button>
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
                  <button type="button" onClick={handleClose} className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">닫기</button>
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
                  <button type="button" onClick={handleClose} className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">닫기</button>
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
