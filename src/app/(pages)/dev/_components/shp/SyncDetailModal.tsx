'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { X, RotateCcw, Check, Loader2, Plus, AlertTriangle, Trash2, ShieldCheck, Play, RefreshCw, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Filter } from 'lucide-react';
import { GeoJsonMiniMap } from './GeoJsonMiniMap';
import {
  SHP_SYNC_DETAIL_MODAL_ATTR,
  SHP_SYNC_DETAIL_MODAL_Z,
  SHP_SYNC_DETAIL_NESTED_Z,
} from './shpModalLayers';

type SyncLogRow = {
  sl_key: number;
  sl_table_name: string;
  sl_key_field: string;
  sl_key_value: string;
  sl_operation: string | null;
  sl_old_data: Record<string, unknown> | null;
  sl_new_data: Record<string, unknown> | null;
  sl_applied_at: string | null;
  sl_rolled_back: boolean;
  sl_rolled_back_at: string | null;
  sl_created_at: string | null;
};

type Props = {
  /** 이력 상세 키. 없으면 tableName만으로 sync_log 조회·의도 기록 */
  dhKey?: number;
  /** Excel 업로드 이력 키 (source=excel) */
  ehKey?: number;
  /** 기본 shp. excel이면 excelHistoryService + excel_sync_log */
  source?: 'shp' | 'excel';
  tableName: string;
  shpPath?: string | null;
  /** 비교 시 사용한 소스 좌표계 (예: EPSG:5181). .prj 없는 SHP 상세 지도용 */
  sourceSrsOverride?: string | null;
  pendingOnly?: boolean;
  /** 이력 탭 등 — 적용·유지·롤백·재적용 UI 숨김 */
  readOnly?: boolean;
  /**
   * 위저드 3단계: 반영·유지는 sync_log 의도만 기록하고 레이어 DB는 바꾸지 않음.
   * 실제 반영은 위저드 4단계 완료에서 수행.
   */
  deferDbWrite?: boolean;
  onClose: () => void;
  onRollbackDone?: () => void;
};

type TabId = 'all' | 'pending' | 'update' | 'kept' | 'append' | 'remove';

function hasSyncData(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string') return raw.trim() !== '' && raw.trim() !== '{}';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.keys(raw as Record<string, unknown>).length > 0;
  }
  return false;
}

function opCategory(row: SyncLogRow): string {
  if (!row.sl_operation) {
    const hasOld = hasSyncData(row.sl_old_data);
    const hasNew = hasSyncData(row.sl_new_data);
    if (!hasOld && hasNew) return 'new';
    if (hasOld && hasNew) return 'conflict';
    if (hasOld && !hasNew) return 'delete';
    return 'unknown';
  }
  return row.sl_operation;
}

type OpLabelInfo = { label: string; color: string; icon: typeof AlertTriangle; badge?: string; hoverBg: string };
type KeptOrigin = 'new' | 'conflict' | 'delete';

const OP_LABEL: Record<string, OpLabelInfo> = {
  new: { label: '신규', color: 'text-emerald-600', icon: Plus, badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', hoverBg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  conflict: { label: '충돌', color: 'text-amber-700', icon: AlertTriangle, badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', hoverBg: 'bg-amber-50 dark:bg-amber-900/20' },
  delete: { label: '삭제', color: 'text-rose-600', icon: Trash2, badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300', hoverBg: 'bg-rose-50 dark:bg-rose-900/20' },
  append: { label: '신규', color: 'text-green-600', icon: Plus, badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300', hoverBg: 'bg-green-50 dark:bg-green-900/20' },
  kept: { label: '유지', color: 'text-blue-600', icon: ShieldCheck, badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', hoverBg: 'bg-blue-50 dark:bg-blue-900/20' },
  remove: { label: '삭제', color: 'text-red-600', icon: Trash2, badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', hoverBg: 'bg-red-50 dark:bg-red-900/20' },
};

/** 유지(kept) 확정 행 — old/new 유무로 원래 구분 복원 */
const KEPT_ORIGIN_LABEL: Record<KeptOrigin, OpLabelInfo> = {
  new: {
    label: '미추가',
    color: 'text-blue-600',
    icon: ShieldCheck,
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    hoverBg: 'bg-blue-50 dark:bg-blue-900/20',
  },
  delete: {
    label: '미삭제',
    color: 'text-blue-600',
    icon: ShieldCheck,
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    hoverBg: 'bg-blue-50 dark:bg-blue-900/20',
  },
  conflict: OP_LABEL.kept,
};

const PENDING_HOVER_BG = 'bg-amber-100/60 dark:bg-amber-900/20';

function keptOriginFromData(oldData: unknown, newData: unknown): KeptOrigin | null {
  const hasOld = hasSyncData(oldData);
  const hasNew = hasSyncData(newData);
  if (!hasOld && hasNew) return 'new';
  if (hasOld && hasNew) return 'conflict';
  if (hasOld && !hasNew) return 'delete';
  return null;
}

function getOpLabelInfo(operation: string, isPending: boolean, keptOrigin?: KeptOrigin | null) {
  if (operation === 'conflict' && !isPending) {
    return { label: '변경', color: 'text-orange-600', icon: RefreshCw, hoverBg: 'bg-orange-50 dark:bg-orange-900/20' };
  }
  if (operation === 'kept' && keptOrigin) {
    return KEPT_ORIGIN_LABEL[keptOrigin];
  }
  return OP_LABEL[operation] ?? OP_LABEL['conflict'];
}

function parseGeomType(g: unknown): string | null {
  let obj: Record<string, unknown> | null = null;
  if (g == null) return null;
  if (typeof g === 'string') {
    try { obj = JSON.parse(g) as Record<string, unknown>; } catch { return null; }
  } else if (typeof g === 'object') {
    obj = g as Record<string, unknown>;
  }
  const t = obj?.type;
  return typeof t === 'string' ? t.toUpperCase() : null;
}

function normalizeGeomForDiff(g: unknown): unknown {
  if (g == null || typeof g !== 'object' || Array.isArray(g)) return g;
  const obj = { ...(g as Record<string, unknown>) };
  delete obj.srs;
  return obj;
}

/** sync_log JSONB가 문자열로 올 수 있어 객체로 정규화 */
function asDataRecord(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

type FlatRow = {
  slKey: number;
  operation: string;
  isPending: boolean;
  keptOrigin: KeptOrigin | null;
  keyValue: string;
  titleValue: string;
  isRolledBack: boolean;
  field: string;
  oldVal: unknown;
  newVal: unknown;
  isFirst: boolean;
  rowSpan: number;
};

function buildFlatRows(rows: SyncLogRow[], titleField: string | null = null): FlatRow[] {
  const result: FlatRow[] = [];
  for (const r of rows) {
    const op = opCategory(r);
    const isPending = !r.sl_operation;
    const old = asDataRecord(r.sl_old_data);
    const nw = asDataRecord(r.sl_new_data);
    const titleVal = titleField ? String(old[titleField] ?? nw[titleField] ?? '') : '';
    const keptOrigin = op === 'kept' ? keptOriginFromData(r.sl_old_data, r.sl_new_data) : null;
    const base = {
      slKey: r.sl_key,
      operation: op,
      isPending,
      keptOrigin,
      keyValue: r.sl_key_value ?? '',
      titleValue: titleVal,
      isRolledBack: r.sl_rolled_back,
    };

    if (op === 'conflict' || op === 'kept') {
      // 상세와 동일: old∪new 키 전부 비교 (old만 보면 new에만 있는 변경이 누락됨)
      const attrKeys = [...new Set([...Object.keys(old), ...Object.keys(nw)])].filter(
        (k) => k !== 'ogc_fid' && k !== 'geom' && k !== '__rollback_geom'
          && k !== '__match_ogc_fid' && k !== '__match_sync_ogc_fid',
      );
      const entries: { field: string; oldVal: unknown; newVal: unknown }[] = attrKeys
        .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(nw[k]))
        .map((f) => ({ field: f, oldVal: old[f], newVal: nw[f] }));
      if (JSON.stringify(normalizeGeomForDiff(old.geom)) !== JSON.stringify(normalizeGeomForDiff(nw.geom))) {
        const oldGeomType = parseGeomType(old.geom);
        const newGeomType = parseGeomType(nw.geom);
        if (oldGeomType && newGeomType && oldGeomType !== newGeomType) {
          entries.push({ field: 'geom', oldVal: oldGeomType, newVal: newGeomType });
        } else {
          entries.push({ field: 'geom', oldVal: '좌표 변경', newVal: '좌표 변경' });
        }
      }
      if (entries.length === 0) {
        result.push({ ...base, field: '—', oldVal: '—', newVal: '—', isFirst: true, rowSpan: 1 });
      } else {
        entries.forEach((entry, i) => {
          result.push({ ...base, field: entry.field, oldVal: entry.oldVal, newVal: entry.newVal, isFirst: i === 0, rowSpan: i === 0 ? entries.length : 0 });
        });
      }
    } else if (op === 'append' || op === 'new') {
      const fields = Object.keys(nw).filter((k) => k !== 'ogc_fid' && k !== 'geom' && k !== '__rollback_geom'
        && k !== '__match_ogc_fid' && k !== '__match_sync_ogc_fid');
      const entries: { field: string; oldVal: unknown; newVal: unknown }[] = fields.map((f) => ({
        field: f, oldVal: null, newVal: nw[f],
      }));
      if (nw.geom != null) {
        const newGeomType = parseGeomType(nw.geom);
        entries.push({
          field: 'geom',
          oldVal: null,
          newVal: newGeomType ?? (typeof nw.geom === 'string' ? nw.geom : '신규'),
        });
      }
      if (entries.length === 0) {
        result.push({ ...base, field: '(전체)', oldVal: null, newVal: '—', isFirst: true, rowSpan: 1 });
      } else {
        entries.forEach((entry, i) => {
          result.push({ ...base, field: entry.field, oldVal: entry.oldVal, newVal: entry.newVal, isFirst: i === 0, rowSpan: i === 0 ? entries.length : 0 });
        });
      }
    } else if (op === 'remove' || op === 'delete') {
      const keyVal = r.sl_key_value ?? '';
      const titleFromOld = titleField ? (old[titleField] ?? '') : '';
      const combined = titleField ? `${titleFromOld} (${keyVal})` : `(${keyVal})`;
      result.push({ ...base, field: '—', oldVal: combined, newVal: null, isFirst: true, rowSpan: 1 });
    }
  }
  return result;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;

type OpFilterId =
  | 'new'
  | 'pending_conflict'
  | 'changed'
  | 'delete'
  | 'kept_new'
  | 'kept_conflict'
  | 'kept_delete';

export function SyncDetailModal({
  dhKey,
  ehKey,
  source = 'shp',
  tableName,
  shpPath,
  sourceSrsOverride,
  pendingOnly,
  readOnly,
  deferDbWrite,
  onClose,
  onRollbackDone,
}: Props) {
  const isExcel = source === 'excel';
  const syncService = isExcel ? 'excelHistoryService' : 'shpUploadService';
  const historyKey = isExcel ? ehKey : dhKey;
  const changeValueLabel = isExcel ? '변경값 (Excel)' : '변경값 (SHP)';
  const mapProjection = 'EPSG:5181';

  const attachHistoryKey = useCallback(
    (p: Record<string, unknown>, opts?: { strict?: boolean }) => {
      if (historyKey == null) return p;
      if (isExcel) {
        p.ehKey = historyKey;
        if (opts?.strict) p.strictEhKey = true;
      } else {
        p.dhKey = historyKey;
        if (opts?.strict) p.strictDhKey = true;
      }
      return p;
    },
    [historyKey, isExcel]
  );
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [titleField, setTitleField] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(pendingOnly ? 'pending' : 'all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageInput, setPageInput] = useState('1');
  const [tabTotal, setTabTotal] = useState(0);
  const [counts, setCounts] = useState({
    all: 0, pending: 0, updated: 0, kept: 0, append: 0, remove: 0, rolledBack: 0,
  });
  const [busyKey, setBusyKey] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detailLog, setDetailLog] = useState<SyncLogRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<number | null>(null);
  const [fieldFilters, setFieldFilters] = useState<string[]>([]);
  const [opFilters, setOpFilters] = useState<OpFilterId[]>([]);
  const [fieldOptions, setFieldOptions] = useState<string[]>([]);
  const [fieldOptionsLoading, setFieldOptionsLoading] = useState(false);
  const [opOptions, setOpOptions] = useState<Array<{ id: OpFilterId; label: string }>>([]);
  const [opOptionsLoading, setOpOptionsLoading] = useState(false);
  const [fieldFilterOpen, setFieldFilterOpen] = useState(false);
  const [opFilterOpen, setOpFilterOpen] = useState(false);
  /** 구분·변경 필드 필터가 있을 때 «전체 반영/유지» 대상 미결 건수 (미결 탭이 아닐 때) */
  const [filterPendingTotal, setFilterPendingTotal] = useState<number | null>(null);
  const fieldFilterRef = useRef<HTMLDivElement | null>(null);
  const opFilterRef = useRef<HTMLDivElement | null>(null);
  const fetchSeqRef = useRef(0);
  const totalReadyRef = useRef(false);
  /** 탭 배지·상단 건수 — 최초 수신 전(Strict Mode 중복 effect 등)에는 includeCounts 유지 */
  const countsReadyRef = useRef(false);
  /** 필터 적용 시 page=1 리셋으로 effect 중복 조회 방지 */
  const skipNextPageEffectRef = useRef(false);

  const fetchLogs = useCallback(async (opts?: {
    page?: number;
    tab?: TabId;
    pageSize?: number;
    refreshCounts?: boolean;
    includeTotal?: boolean;
    fieldFilters?: string[];
    opFilters?: OpFilterId[];
  }) => {
    const pageNum = opts?.page ?? page;
    const tab = opts?.tab ?? activeTab;
    const size = opts?.pageSize ?? pageSize;
    const fields = opts?.fieldFilters ?? fieldFilters;
    const ops = opts?.opFilters ?? opFilters;
    const refreshCounts = opts?.refreshCounts ?? false;
    const includeTotal = opts?.includeTotal ?? refreshCounts;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p: Record<string, unknown> = {
        tableName,
        light: true,
        includeCounts: refreshCounts,
        includeTotal,
        tab,
        page: pageNum,
        limit: size,
      };
      if (historyKey != null) {
        attachHistoryKey(p, { strict: Boolean(historyKey && readOnly) });
      }
      // 이력 조회(readOnly): 해당 이력 키만. 위저드 중에는 미배정(NULL)도 포함
      if (fields.length > 0) p.fieldFilters = fields;
      if (ops.length > 0) p.opFilters = ops;
      const res = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogs',
        params: p,
      });
      if (seq !== fetchSeqRef.current) {
        return { rows: [] as SyncLogRow[], counts: undefined, stale: true as const };
      }
      const d = res?.data ?? res;
      const logRows: SyncLogRow[] = d?.success ? (d.rows ?? []) : [];
      setRows(logRows);
      if (d?.total != null && d.total !== '') {
        const parsedTotal = Number(d.total);
        if (Number.isFinite(parsedTotal)) {
          setTabTotal(parsedTotal);
          totalReadyRef.current = true;
          if (tab === 'pending' && (fields.length > 0 || ops.length > 0)) {
            setFilterPendingTotal(parsedTotal);
          }
        }
      } else if (includeTotal) {
        setTabTotal(logRows.length);
        totalReadyRef.current = true;
        if (tab === 'pending' && (fields.length > 0 || ops.length > 0)) {
          setFilterPendingTotal(logRows.length);
        }
      }
      if (d?.counts) {
        setCounts({
          all: d.counts.all ?? 0,
          pending: d.counts.pending ?? 0,
          updated: d.counts.updated ?? 0,
          kept: d.counts.kept ?? 0,
          append: d.counts.append ?? 0,
          remove: d.counts.remove ?? 0,
          rolledBack: d.counts.rolledBack ?? 0,
        });
        countsReadyRef.current = true;
      }
      if (!d?.success) setError(d?.error ?? '조회 실패');

      const hasRemoveOrDelete =
        (d?.counts?.remove ?? 0) > 0
        || logRows.some((r) => {
          const op = r.sl_operation ?? (r.sl_old_data && !r.sl_new_data ? 'delete' : null);
          return op === 'remove' || op === 'delete';
        });
      if (hasRemoveOrDelete) {
        try {
          const tr = await call('', 'POST', {
            service: syncService,
            action: 'getTitleFieldName',
            params: { tableName },
          });
          if (seq !== fetchSeqRef.current) {
            return { rows: logRows, counts: d?.counts as typeof counts | undefined };
          }
          const td = tr?.data ?? tr;
          if (td?.success && td.titleField) setTitleField(td.titleField);
          else setTitleField(null);
        } catch {
          if (seq === fetchSeqRef.current) setTitleField(null);
        }
      }
      return { rows: logRows, counts: d?.counts as typeof counts | undefined };
    } catch (e: unknown) {
      if (seq === fetchSeqRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return { rows: [] as SyncLogRow[], counts: undefined };
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [attachHistoryKey, historyKey, tableName, page, activeTab, pageSize, fieldFilters, opFilters, readOnly, syncService]);

  const loadFieldOptions = useCallback(async () => {
    setFieldOptionsLoading(true);
    try {
      const p: Record<string, unknown> = { tableName };
      attachHistoryKey(p);
      const res = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogFieldNames',
        params: p,
      });
      const d = res?.data ?? res;
      setFieldOptions(d?.success ? (d.fields ?? []) : []);
    } catch {
      setFieldOptions([]);
    } finally {
      setFieldOptionsLoading(false);
    }
  }, [attachHistoryKey, historyKey, tableName, syncService]);

  const loadOpOptions = useCallback(async () => {
    setOpOptionsLoading(true);
    try {
      const p: Record<string, unknown> = { tableName };
      attachHistoryKey(p, { strict: Boolean(historyKey && readOnly) });
      const res = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogOpOptions',
        params: p,
      });
      const d = res?.data ?? res;
      const next: Array<{ id: OpFilterId; label: string }> = d?.success
        ? ((d.options ?? []) as Array<{ id: OpFilterId; label: string }>)
        : [];
      setOpOptions(next);
      return next;
    } catch {
      setOpOptions([]);
      return [] as Array<{ id: OpFilterId; label: string }>;
    } finally {
      setOpOptionsLoading(false);
    }
  }, [attachHistoryKey, historyKey, tableName, readOnly, syncService]);

  // 초기·탭·페이지·크기 변경 (필터는 applyFieldFilters에서 단독 조회)
  const prevFetchRef = useRef({
    tab: activeTab,
    pageSize,
    mounted: false,
  });
  useEffect(() => {
    const prev = prevFetchRef.current;
    const isFirst = !prev.mounted;
    const tabChanged = prev.tab !== activeTab;
    const sizeChanged = prev.pageSize !== pageSize;
    prevFetchRef.current = {
      tab: activeTab,
      pageSize,
      mounted: true,
    };
    if (tabChanged) totalReadyRef.current = false;
    if (skipNextPageEffectRef.current) {
      skipNextPageEffectRef.current = false;
      return;
    }
    void fetchLogs({
      refreshCounts: isFirst || tabChanged || !countsReadyRef.current,
      includeTotal: isFirst || tabChanged || sizeChanged || !totalReadyRef.current,
    });
  }, [page, activeTab, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadFieldOptions();
    void loadOpOptions();
  }, [loadFieldOptions, loadOpOptions]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (!fieldFilterOpen && !opFilterOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (fieldFilterOpen && fieldFilterRef.current && !fieldFilterRef.current.contains(t)) {
        setFieldFilterOpen(false);
      }
      if (opFilterOpen && opFilterRef.current && !opFilterRef.current.contains(t)) {
        setOpFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [fieldFilterOpen, opFilterOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (fieldFilterOpen) {
        setFieldFilterOpen(false);
        return;
      }
      if (opFilterOpen) {
        setOpFilterOpen(false);
        return;
      }
      if (detailLog) {
        setDetailLog(null);
        return;
      }
      if (bulkBusy) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailLog, onClose, fieldFilterOpen, opFilterOpen, bulkBusy]);

  /** 필터 적용 시 «전체 반영/유지»용 미결 건수 (미결 탭이면 fetchLogs의 tabTotal로 충분) */
  const refreshFilterPendingTotal = useCallback(async (
    fields: string[] = fieldFilters,
    ops: OpFilterId[] = opFilters,
  ) => {
    if (fields.length === 0 && ops.length === 0) {
      setFilterPendingTotal(null);
      return;
    }
    if (activeTab === 'pending') return;
    try {
      const p: Record<string, unknown> = {
        tableName,
        light: true,
        includeTotal: true,
        tab: 'pending',
        page: 1,
        limit: 1,
        fieldFilters: fields,
        opFilters: ops,
      };
      if (historyKey != null) attachHistoryKey(p);
      const res = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogs',
        params: p,
      });
      const d = res?.data ?? res;
      const n = Number(d?.total);
      setFilterPendingTotal(Number.isFinite(n) ? n : 0);
    } catch {
      setFilterPendingTotal(null);
    }
  }, [activeTab, attachHistoryKey, historyKey, tableName, fieldFilters, opFilters, syncService]);

  /** 필드·구분 필터를 서버에 반영하고 1페이지·총 건수 재계산 */
  const applyListFilters = useCallback((next: {
    fieldFilters?: string[];
    opFilters?: OpFilterId[];
  }) => {
    const nextFields = next.fieldFilters ?? fieldFilters;
    const nextOps = next.opFilters ?? opFilters;
    if (page !== 1) skipNextPageEffectRef.current = true;
    totalReadyRef.current = false;
    setFieldFilters(nextFields);
    setOpFilters(nextOps);
    setPage(1);
    setPageInput('1');
    if (nextFields.length === 0 && nextOps.length === 0) {
      setFilterPendingTotal(null);
    }
    void fetchLogs({
      page: 1,
      fieldFilters: nextFields,
      opFilters: nextOps,
      refreshCounts: false,
      includeTotal: true,
    });
    void refreshFilterPendingTotal(nextFields, nextOps);
  }, [fetchLogs, page, fieldFilters, opFilters, refreshFilterPendingTotal]);

  const toggleFieldFilter = useCallback((field: string) => {
    const next = fieldFilters.includes(field)
      ? fieldFilters.filter((f) => f !== field)
      : [...fieldFilters, field];
    applyListFilters({ fieldFilters: next });
  }, [fieldFilters, applyListFilters]);

  const clearFieldFilters = useCallback(() => {
    applyListFilters({ fieldFilters: [] });
  }, [applyListFilters]);

  const toggleOpFilter = useCallback((op: OpFilterId) => {
    const next = opFilters.includes(op)
      ? opFilters.filter((o) => o !== op)
      : [...opFilters, op];
    applyListFilters({ opFilters: next });
  }, [opFilters, applyListFilters]);

  const clearOpFilters = useCallback(() => {
    applyListFilters({ opFilters: [] });
  }, [applyListFilters]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setPage(1);
    setPageInput('1');
  }, []);

  const totalPages = Math.max(1, Math.ceil(tabTotal / pageSize) || 1);

  const goToPage = useCallback((next: number) => {
    const clamped = Math.min(totalPages, Math.max(1, Math.floor(next) || 1));
    setPage(clamped);
    setPageInput(String(clamped));
  }, [totalPages]);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
    setPageInput('1');
  }, []);

  const submitPageJump = useCallback(() => {
    goToPage(Number(pageInput));
  }, [goToPage, pageInput]);

  const updateHistoryResult = useCallback(async (pendingCount: number, c: typeof counts) => {
    if (deferDbWrite) return;
    if (!dhKey) return;
    if (pendingCount > 0) return;
    const parts = [
      c.append > 0 ? `신규 ${c.append}` : '',
      c.updated > 0 ? `SHP 반영 ${c.updated}` : '',
      c.remove > 0 ? `삭제 ${c.remove}` : '',
      c.kept > 0 ? `DB 유지 ${c.kept}` : '',
    ].filter(Boolean).join(', ');
    try {
      await call('', 'POST', {
        service: 'layerHistoryService',
        action: 'updateDetailResult',
        params: {
          dhKey,
          result: '성공',
          contents: parts ? `정합성 검증 완료 (${parts})` : '변경 없음',
        },
      });
    } catch { /* ignore */ }
  }, [dhKey, deferDbWrite]);

  const flatRows = useMemo(
    () => buildFlatRows(rows, titleField),
    [rows, titleField],
  );

  const afterAction = useCallback(async (opts?: { clearFilters?: boolean }) => {
    const clearFilters = !!opts?.clearFilters;
    const nextFields = clearFilters ? [] : fieldFilters;
    let nextOps = clearFilters ? [] : opFilters;
    if (clearFilters) {
      setFieldFilters([]);
      setOpFilters([]);
      setFilterPendingTotal(null);
      setFieldFilterOpen(false);
      setOpFilterOpen(false);
    }
    const fresh = await fetchLogs({
      page,
      tab: activeTab,
      fieldFilters: nextFields,
      opFilters: nextOps,
      refreshCounts: true,
      includeTotal: true,
    });
    const available = await loadOpOptions();
    if (!clearFilters) {
      const allowed = new Set(available.map((o) => o.id));
      if (nextOps.some((id) => !allowed.has(id))) {
        nextOps = nextOps.filter((id) => allowed.has(id));
        applyListFilters({ opFilters: nextOps });
      }
    }
    const c = fresh.counts ?? counts;
    await updateHistoryResult(c.pending ?? 0, {
      all: c.all ?? 0,
      pending: c.pending ?? 0,
      updated: c.updated ?? 0,
      kept: c.kept ?? 0,
      append: c.append ?? 0,
      remove: c.remove ?? 0,
      rolledBack: c.rolledBack ?? 0,
    });
    if (!clearFilters && (nextFields.length > 0 || nextOps.length > 0)) {
      await refreshFilterPendingTotal(nextFields, nextOps);
    }
    onRollbackDone?.();
  }, [fetchLogs, page, activeTab, counts, updateHistoryResult, onRollbackDone, fieldFilters, opFilters, refreshFilterPendingTotal, loadOpOptions, applyListFilters]);

  const handleApplyOne = async (slKey: number) => {
    if (!confirm(
      deferDbWrite
        ? `${isExcel ? 'Excel' : 'SHP'} 값으로 반영하도록 선택합니다. 실제 DB 반영은 위저드 완료 시 이루어집니다. 계속할까요?`
        : `${isExcel ? 'Excel' : 'SHP'} 값으로 DB에 반영하시겠습니까?`
    )) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: syncService,
        action: 'applySyncEntries',
        params: {
          slKeys: [slKey],
          ...(isExcel
            ? { ehKey: ehKey || undefined }
            : {
                dhKey: dhKey || undefined,
                shpPath: shpPath || undefined,
                sourceSrsOverride: sourceSrsOverride || undefined,
              }),
          ...(deferDbWrite ? { intentOnly: true } : {}),
        },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
      } else {
        alert(d?.error ?? '적용 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleKeepOne = async (slKey: number) => {
    if (!confirm(
      deferDbWrite
        ? '기존 DB 값을 유지하도록 선택합니다. 완료 시 이력에 반영됩니다. 계속할까요?'
        : '기존 DB 값을 유지하시겠습니까?'
    )) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: syncService,
        action: 'keepSyncEntries',
        params: {
          slKeys: [slKey],
          ...(isExcel ? { ehKey: ehKey || undefined } : { dhKey: dhKey || undefined }),
          ...(deferDbWrite ? { intentOnly: true } : {}),
        },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
      } else {
        alert(d?.error ?? '유지 처리 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRollbackOne = async (slKey: number) => {
    const row = rows.find((r) => r.sl_key === slKey);
    const isIntentOnly = !!deferDbWrite || (!!row?.sl_operation && !row.sl_applied_at);
    if (!confirm(isIntentOnly ? '이 선택을 취소하고 미결로 되돌리시겠습니까?' : '이 항목을 롤백하시겠습니까?')) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: syncService,
        action: isIntentOnly ? 'clearSyncIntents' : 'rollbackSyncRows',
        params: { slKeys: [slKey] },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
      } else {
        alert(d?.error ?? (isIntentOnly ? '선택 취소 실패' : '롤백 실패'));
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleReapplyOne = async (slKey: number) => {
    if (deferDbWrite) return;
    if (!confirm('이 항목을 다시 적용하시겠습니까?')) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: syncService,
        action: 'reapplySyncRows',
        params: { slKeys: [slKey], shpPath: shpPath || undefined, sourceSrsOverride: sourceSrsOverride || undefined },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
      } else {
        alert(d?.error ?? '다시 적용 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const hasListFilters = fieldFilters.length > 0 || opFilters.length > 0;
  const bulkPendingCount = hasListFilters
    ? (activeTab === 'pending' ? tabTotal : (filterPendingTotal ?? counts.pending))
    : counts.pending;
  const bulkScopeLabel = hasListFilters
    ? `선택된 미결 ${bulkPendingCount}건`
    : `미결 ${bulkPendingCount}건`;

  const pendingKeysParams = useCallback(() => {
    const p: Record<string, unknown> = { tableName };
    if (isExcel) {
      if (ehKey) p.ehKey = ehKey;
    } else if (dhKey) {
      p.dhKey = dhKey;
    }
    if (fieldFilters.length > 0) p.fieldFilters = fieldFilters;
    if (opFilters.length > 0) p.opFilters = opFilters;
    return p;
  }, [tableName, dhKey, ehKey, isExcel, fieldFilters, opFilters]);

  const handleApplyAll = async () => {
    if (bulkPendingCount <= 0) {
      alert(hasListFilters ? '선택된 미결 항목이 없습니다.' : '미결 항목이 없습니다.');
      return;
    }
    if (!confirm(
      deferDbWrite
        ? `${bulkScopeLabel}을 모두 ${isExcel ? 'Excel' : 'SHP'} 반영으로 선택합니다. 실제 DB 반영은 위저드 완료 시 이루어집니다. 계속할까요?`
        : `${bulkScopeLabel}을 모두 ${isExcel ? 'Excel' : 'SHP'} 값으로 반영하시겠습니까?`
    )) return;
    setBulkBusy(true);
    try {
      const keysRes = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogPendingKeys',
        params: pendingKeysParams(),
      });
      const kd = keysRes?.data ?? keysRes;
      const keys: number[] = kd?.success ? (kd.keys ?? []) : [];
      if (keys.length === 0) {
        alert(kd?.error ?? (hasListFilters ? '선택된 미결 항목이 없습니다.' : '미결 항목이 없습니다.'));
        return;
      }
      const res = await call('', 'POST', {
        service: syncService,
        action: 'applySyncEntries',
        params: {
          slKeys: keys,
          ...(isExcel
            ? { ehKey: ehKey || undefined }
            : {
                dhKey: dhKey || undefined,
                shpPath: shpPath || undefined,
                sourceSrsOverride: sourceSrsOverride || undefined,
              }),
          ...(deferDbWrite ? { intentOnly: true } : {}),
        },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction({ clearFilters: true });
      } else {
        alert(d?.error ?? '전체 반영 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleKeepAll = async () => {
    if (bulkPendingCount <= 0) {
      alert(hasListFilters ? '선택된 미결 항목이 없습니다.' : '미결 항목이 없습니다.');
      return;
    }
    if (!confirm(
      deferDbWrite
        ? `${bulkScopeLabel}을 모두 기존값 유지로 선택합니다. 완료 시 이력에 반영됩니다. 계속할까요?`
        : `${bulkScopeLabel}을 모두 기존값으로 유지하시겠습니까?`
    )) return;
    setBulkBusy(true);
    try {
      const keysRes = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogPendingKeys',
        params: pendingKeysParams(),
      });
      const kd = keysRes?.data ?? keysRes;
      const keys: number[] = kd?.success ? (kd.keys ?? []) : [];
      if (keys.length === 0) {
        alert(kd?.error ?? (hasListFilters ? '선택된 미결 항목이 없습니다.' : '미결 항목이 없습니다.'));
        return;
      }
      const res = await call('', 'POST', {
        service: syncService,
        action: 'keepSyncEntries',
        params: {
          slKeys: keys,
          ...(isExcel ? { ehKey: ehKey || undefined } : { dhKey: dhKey || undefined }),
          ...(deferDbWrite ? { intentOnly: true } : {}),
        },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction({ clearFilters: true });
      } else {
        alert(d?.error ?? '전체 유지 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const fmtVal = (v: unknown) => {
    if (v === null || v === undefined) return <span className="text-muted-foreground italic text-xs">—</span>;
    if (typeof v === 'object') return <span className="font-mono text-xs">{JSON.stringify(v)}</span>;
    return String(v);
  };

  const isValEmpty = (v: unknown) => v === null || v === undefined || v === '';

  const openDetail = useCallback(async (slKey: number) => {
    setDetailLoading(true);
    try {
      const res = await call('', 'POST', {
        service: syncService,
        action: 'getSyncLogDetail',
        params: {
          slKey,
          shpPath: shpPath || undefined,
          dhKey: dhKey || undefined,
          sourceSrsOverride: sourceSrsOverride || undefined,
        },
      });
      const d = res?.data ?? res;
      if (d?.success && d.row) {
        setDetailLog(d.row as SyncLogRow);
      } else {
        alert(d?.error ?? '상세 조회 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, [shpPath, dhKey, sourceSrsOverride]);

  const closeDetail = useCallback(() => setDetailLog(null), []);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'all', label: `전체 (${counts.all})` },
    { id: 'pending', label: `미결 (${counts.pending})` },
    { id: 'update', label: `변경 (${counts.updated})` },
    { id: 'kept', label: `유지 (${counts.kept})` },
    { id: 'append', label: `신규 (${counts.append})` },
    { id: 'remove', label: `삭제 (${counts.remove})` },
  ];

  const canClose = !bulkBusy;

  return createPortal(
    <div
      {...{ [SHP_SYNC_DETAIL_MODAL_ATTR]: true }}
      className="fixed inset-0 isolate"
      style={{ zIndex: SHP_SYNC_DETAIL_MODAL_Z }}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        className="relative flex min-h-full items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && canClose) onClose();
        }}
      >
        <div
          className="bg-background flex max-h-[85vh] min-h-[85vh] w-[92vw] min-w-[92vw] max-w-[1100px] flex-col rounded-lg shadow-xl"
          role="dialog"
          aria-modal="true"
        >
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="text-sm font-semibold">{readOnly ? '이력 조회' : '정합성 검증 내역'} — {tableName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              전체 {counts.all}건
              {counts.pending > 0 && <> · 미결 <span className="text-amber-600 font-semibold">{counts.pending}</span>건</>}
              {counts.updated > 0 && <> · 변경 <span className="text-orange-600">{counts.updated}</span></>}
              {counts.kept > 0 && <> · 유지 <span className="text-blue-600">{counts.kept}</span></>}
              {counts.append > 0 && <> · 신규 <span className="text-green-600">{counts.append}</span></>}
              {counts.remove > 0 && <> · 삭제 <span className="text-red-500">{counts.remove}</span></>}
              {counts.rolledBack > 0 && <> · 롤백 <span className="text-muted-foreground">{counts.rolledBack}</span></>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title={bulkBusy ? '전체 처리가 끝날 때까지 닫을 수 없습니다' : '닫기'}
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="shrink-0 flex items-center border-b bg-muted/20 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* bulk actions for pending */}
        {!readOnly && counts.pending > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b bg-amber-50 dark:bg-amber-950/20">
            <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
              {bulkScopeLabel}
              {hasListFilters && counts.pending !== bulkPendingCount && (
                <span className="ml-1 font-normal text-amber-600/80 dark:text-amber-400/80">
                  (전체 미결 {counts.pending}건)
                </span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {hasListFilters && (
                <span className="text-[12px] text-amber-600/90 dark:text-amber-400/90 px-2">
                  해당 미결건에 대해서만 반영됩니다.
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={handleApplyAll}
                disabled={bulkBusy || bulkPendingCount <= 0}
              >
                {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                전체 반영
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={handleKeepAll}
                disabled={bulkBusy || bulkPendingCount <= 0}
              >
                {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                전체 유지
              </Button>
            </div>
          </div>
        )}

        {/* body */}
        <div className="flex-1 min-h-0 overflow-auto relative">
          {detailLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 text-xs text-muted-foreground gap-1">
              <Loader2 className="w-4 h-4 animate-spin" /> 상세 로딩 중…
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center h-40 text-xs text-muted-foreground gap-1">
              <Loader2 className="w-4 h-4 animate-spin" /> 로딩 중…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-40 text-xs text-red-500">{error}</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="text-left">
                  <th className="py-1 px-1 text-xs font-medium border-r border-b bg-muted w-12 text-center">상태</th>
                  <th className="py-1 px-1 text-xs font-medium border-r border-b bg-muted w-28 text-center">
                    <div className="relative flex w-full items-center justify-center gap-1" ref={opFilterRef}>
                      <span>구분</span>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center justify-center rounded hover:bg-muted-foreground/10',
                          opFilters.length > 0 && 'text-primary',
                        )}
                        style={{ width: 14, height: 14 }}
                        title="구분 필터"
                        aria-label="구분 필터"
                        aria-expanded={opFilterOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpFilterOpen((o) => !o);
                          setFieldFilterOpen(false);
                        }}
                      >
                        <Filter style={{ width: 14, height: 14 }} />
                      </button>
                      {opFilters.length > 0 && (
                        <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                          {opFilters.length}
                        </span>
                      )}
                      {opFilterOpen && (
                        <div
                          className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border bg-background p-2 text-left shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted-foreground">구분 선택</span>
                            <button
                              type="button"
                              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              disabled={opFilters.length === 0}
                              onClick={clearOpFilters}
                            >
                              초기화
                            </button>
                          </div>
                          <div className="space-y-0.5">
                            {opOptionsLoading ? (
                              <p className="px-1.5 py-2 text-[11px] text-muted-foreground">불러오는 중…</p>
                            ) : opOptions.length === 0 ? (
                              <p className="px-1.5 py-2 text-[11px] text-muted-foreground">선택 가능한 구분이 없습니다</p>
                            ) : (
                              opOptions.map((opt) => {
                                const checked = opFilters.includes(opt.id);
                                return (
                                  <label
                                    key={opt.id}
                                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60"
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5"
                                      checked={checked}
                                      onChange={() => toggleOpFilter(opt.id)}
                                    />
                                    <span className="text-[11px]">{opt.label}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  {!readOnly && (
                    <th className="py-1 px-1 text-xs font-medium border-r border-b bg-muted w-28 text-center">액션</th>
                  )}
                  <th className="py-1 px-1 text-xs font-medium border-r border-b bg-muted w-[50px]">Key</th>
                  <th className="py-1 px-1 text-xs font-medium border-r border-b bg-muted w-[100px]">제목</th>
                  <th className="py-1 px-1 text-xs font-medium border-r border-b bg-muted w-40">
                    <div className="relative flex items-center gap-1" ref={fieldFilterRef}>
                      <span>변경 필드</span>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center justify-center rounded hover:bg-muted-foreground/10',
                          fieldFilters.length > 0 && 'text-primary',
                        )}
                        style={{ width: 14, height: 14 }}
                        title="필드 필터"
                        aria-label="필드 필터" 
                        aria-expanded={fieldFilterOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFieldFilterOpen((o) => !o);
                          setOpFilterOpen(false);
                        }}
                      >
                        <Filter style={{ width: 14, height: 14 }} />
                      </button>
                      {fieldFilters.length > 0 && (
                        <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                          {fieldFilters.length}
                        </span>
                      )}
                      {fieldFilterOpen && (
                        <div
                          className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border bg-background p-2 shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted-foreground">필드 선택</span>
                            <button
                              type="button"
                              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              disabled={fieldFilters.length === 0}
                              onClick={clearFieldFilters}
                            >
                              초기화
                            </button>
                          </div>
                          <div className="max-h-56 overflow-auto space-y-0.5">
                            {fieldOptionsLoading ? (
                              <div className="flex items-center justify-center gap-1 py-4 text-[11px] text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" /> 불러오는 중…
                              </div>
                            ) : fieldOptions.length === 0 ? (
                              <div className="py-4 text-center text-[11px] text-muted-foreground">필드 없음</div>
                            ) : (
                              fieldOptions.map((field) => {
                                const checked = fieldFilters.includes(field);
                                return (
                                  <label
                                    key={field}
                                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60"
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5"
                                      checked={checked}
                                      onChange={() => toggleFieldFilter(field)}
                                    />
                                    <span className="font-mono text-[11px]">{field}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="py-1 px-1 text-xs font-medium border-b bg-muted">값</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.length === 0 ? (
                  <tr>
                    <td colSpan={readOnly ? 6 : 7} className="py-16 text-center text-xs text-muted-foreground">
                      {fieldFilters.length > 0 || opFilters.length > 0
                        ? '선택한 조건에 해당하는 내역이 없습니다.'
                        : '변경 내역이 없습니다.'}
                    </td>
                  </tr>
                ) : flatRows.map((fr, idx) => {
                  const opInfo = getOpLabelInfo(fr.operation, fr.isPending, fr.keptOrigin);
                  const Icon = opInfo?.icon ?? AlertTriangle;
                  const isBusy = busyKey === fr.slKey;

                  return (
                    <tr
                      key={`${fr.slKey}-${fr.field}-${idx}`}
                      className={cn(
                        fr.isFirst ? 'border-t' : '',
                        fr.isRolledBack && 'opacity-40',
                        fr.isPending && 'bg-amber-50/50 dark:bg-amber-950/10',
                        'cursor-pointer',
                        hoveredKey === fr.slKey && (fr.isPending ? PENDING_HOVER_BG : opInfo?.hoverBg),
                      )}
                      onMouseEnter={() => setHoveredKey(fr.slKey)}
                      onMouseLeave={() => setHoveredKey(null)}
                      onClick={() => { void openDetail(fr.slKey); }}
                    >
                      {fr.isFirst && (
                        <>
                          <td className="py-1.5 px-2 text-center align-top" rowSpan={fr.rowSpan}>
                            {fr.isRolledBack ? (
                              <span className="text-xs text-muted-foreground">롤백됨</span>
                            ) : fr.isPending ? (
                              <span className="text-xs text-amber-600 font-semibold">미결</span>
                            ) : fr.operation !== 'kept' ? (
                              <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />
                            ) : (
                              <span className="text-xs text-blue-500">유지</span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-center align-top" rowSpan={fr.rowSpan}>
                            {readOnly ? (
                              <span className="text-xs text-black dark:text-foreground whitespace-nowrap">
                                {opInfo?.label ?? fr.operation}
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  'inline-flex items-center justify-center gap-0.5 text-xs font-medium whitespace-nowrap',
                                  opInfo?.badge ? `rounded-full px-1.5 py-0.5 ${opInfo.badge}` : opInfo?.color ?? ''
                                )}
                              >
                                <Icon className="w-3 h-3 shrink-0" />
                                {opInfo?.label ?? fr.operation}
                              </span>
                            )}
                          </td>
                          {!readOnly && (
                          <td className="py-1.5 px-2 text-center align-top" rowSpan={fr.rowSpan} onClick={(e) => e.stopPropagation()}>
                            {fr.isRolledBack ? (
                              fr.operation !== 'kept' ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 text-xs text-green-600 hover:underline font-medium disabled:opacity-40"
                                  onClick={() => handleReapplyOne(fr.slKey)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                  다시 적용
                                </button>
                              ) : null
                            ) : fr.isPending ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 text-xs text-orange-600 hover:underline font-medium disabled:opacity-40"
                                  onClick={() => handleApplyOne(fr.slKey)}
                                  disabled={isBusy || bulkBusy}
                                >
                                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                  반영
                                </button>
                                <span className="text-muted-foreground">|</span>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline font-medium disabled:opacity-40"
                                  onClick={() => handleKeepOne(fr.slKey)}
                                  disabled={isBusy || bulkBusy}
                                >
                                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                                  유지
                                </button>
                              </div>
                            ) : (fr.operation !== 'kept' || deferDbWrite) ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-red-500 hover:underline font-medium disabled:opacity-40"
                                onClick={() => handleRollbackOne(fr.slKey)}
                                disabled={isBusy}
                              >
                                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                {deferDbWrite ? '선택 취소' : '롤백'}
                              </button>
                            ) : null}
                          </td>
                          )}
                          <td className="py-1.5 px-2 font-mono text-xs align-top truncate min-w-[200px] max-w-[200px]" rowSpan={fr.rowSpan} title={fr.keyValue}>
                            {fr.keyValue}
                          </td>
                          <td className="py-1.5 px-2 text-xs align-top truncate min-w-[200px] max-w-[200px]" rowSpan={fr.rowSpan} title={fr.titleValue}>
                            {fr.titleValue || '—'}
                          </td>
                        </>
                      )}
                      {(fr.operation === 'remove' || fr.operation === 'delete') ? (
                        <>
                          <td className="py-1 px-2" />
                          <td className="py-1 px-2" />
                        </>
                      ) : (
                        <>
                          <td className="py-1 px-2 font-mono text-xs text-black whitespace-nowrap">
                            {fr.field}
                          </td>
                          <td
                            className="py-1 px-2 text-xs max-w-[18rem] truncate"
                            title={[fr.oldVal, fr.newVal].filter((v) => v != null).map(String).join(' → ')}
                          >
                            {fr.newVal != null && isValEmpty(fr.oldVal) ? (
                              <span className="inline-flex items-center gap-1 flex-wrap">
                                <span className="text-muted-foreground text-xs">(데이터 없음)</span>
                                <span className="text-muted-foreground shrink-0">→</span>
                                <span className={opInfo?.color}>
                                  {fmtVal(fr.newVal)}
                                </span>
                              </span>
                            ) : fr.oldVal != null && fr.newVal != null && JSON.stringify(fr.oldVal) !== JSON.stringify(fr.newVal) ? (
                              <span className="inline-flex items-center gap-1 flex-wrap">
                                <span className="text-black">{fmtVal(fr.oldVal)}</span>
                                <span className="text-muted-foreground shrink-0">→</span>
                                <span className={opInfo?.color}>
                                  {fmtVal(fr.newVal)}
                                </span>
                              </span>
                            ) : fr.newVal != null ? (
                              <span className={opInfo?.color}>{fmtVal(fr.newVal)}</span>
                            ) : (
                              <span className="text-black">{fmtVal(fr.oldVal)}</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* footer: 좌(건수·페이지당) | 중(이동) | 우(닫기) */}
        <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3 border-t">
          {(tabTotal > 0 || fieldFilters.length > 0 || opFilters.length > 0) ? (() => {
            const from = tabTotal === 0 ? 0 : (page - 1) * pageSize + 1;
            const to = Math.min(page * pageSize, tabTotal);
            const pageDigits = Math.max(1, String(totalPages).length);
            return (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 justify-self-start text-xs text-muted-foreground">
                  <label className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                    <span>페이지 당</span>
                    <select
                      className="h-7 w-[4.5rem] rounded border border-input bg-background px-1.5 text-center text-xs tabular-nums text-foreground"
                      value={pageSize}
                      disabled={loading}
                      aria-label="페이지 당 건수"
                      onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span>건</span>
                  </label>
                  <span
                    className="inline-block whitespace-nowrap tabular-nums"
                    style={{ minWidth: '21ch' }}
                  >
                    {tabTotal === 0 ? '0 / 0건' : `${from}–${to} / ${tabTotal}건`}
                  </span>
                </div>
                <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 px-0 text-foreground disabled:opacity-30"
                    disabled={page <= 1 || loading}
                    onClick={() => goToPage(1)}
                    title="처음"
                    aria-label="처음"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 px-0 text-foreground disabled:opacity-30"
                    disabled={page <= 1 || loading}
                    onClick={() => goToPage(page - 1)}
                    title="이전"
                    aria-label="이전"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      className="h-7 rounded border border-input bg-background px-1 text-center text-xs tabular-nums text-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      style={{ width: `${pageDigits + 2.5}ch` }}
                      value={pageInput}
                      disabled={loading}
                      title="페이지 번호 입력 후 Enter"
                      aria-label="페이지 번호"
                      onChange={(e) => setPageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          submitPageJump();
                        }
                      }}
                    />
                    <span className="inline-flex items-center gap-0.5 tabular-nums">
                      <span>/</span>
                      <span
                        className="inline-block text-left"
                        style={{ minWidth: `${pageDigits}ch` }}
                      >
                        {totalPages}
                      </span>
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 px-0 text-foreground disabled:opacity-30"
                    disabled={page >= totalPages || loading}
                    onClick={() => goToPage(page + 1)}
                    title="다음"
                    aria-label="다음"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 px-0 text-foreground disabled:opacity-30"
                    disabled={page >= totalPages || loading}
                    onClick={() => goToPage(totalPages)}
                    title="마지막"
                    aria-label="마지막"
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            );
          })() : (
            <div />
          )}
          <div className="justify-self-end col-start-3 flex items-center gap-4">
            {bulkBusy && (
              <span className="text-base text-muted-foreground whitespace-nowrap">
                전체 처리 중…
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={!canClose}
              title={bulkBusy ? '전체 처리가 끝날 때까지 닫을 수 없습니다' : undefined}
            >
              닫기
            </Button>
          </div>
        </div>
        </div>
      </div>

      {/* 상세 정보 모달 */}
      {detailLog && (() => {
        const op = opCategory(detailLog);
        const isPending = !detailLog.sl_operation;
        const keptOrigin = op === 'kept' ? keptOriginFromData(detailLog.sl_old_data, detailLog.sl_new_data) : null;
        const opInfo = getOpLabelInfo(op, isPending, keptOrigin);
        const Icon = opInfo?.icon ?? AlertTriangle;
        const oldData = detailLog.sl_old_data ?? {};
        const newData = detailLog.sl_new_data ?? {};
        const allKeys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])].filter((k) => k !== 'ogc_fid' && k !== 'geom' && k !== '__rollback_geom'
          && k !== '__match_ogc_fid' && k !== '__match_sync_ogc_fid');
        const parseGeom = (g: unknown): Record<string, unknown> | null => {
          if (g == null) return null;
          if (typeof g === 'string') try { return JSON.parse(g) as Record<string, unknown>; } catch { return null; }
          return typeof g === 'object' && g !== null && 'type' in g && 'coordinates' in g ? (g as Record<string, unknown>) : null;
        };
        /** geom이 메타(type+hash)만일 때 롤백용 GeoJSON으로 미니맵 표시 */
        const resolveMapGeom = (data: Record<string, unknown>) =>
          parseGeom(data.geom) ?? parseGeom(data.__rollback_geom);
        const oldGeom = resolveMapGeom(oldData);
        const newGeom = resolveMapGeom(newData);
        const oldGeomType = parseGeomType(oldData.geom);
        const newGeomType = parseGeomType(newData.geom);
        const geomChanged =
          JSON.stringify(normalizeGeomForDiff(oldData.geom)) !==
          JSON.stringify(normalizeGeomForDiff(newData.geom));
        const bothGeomPresent = !!oldGeomType && !!newGeomType;
        const geomTypeChanged = geomChanged && bothGeomPresent && oldGeomType !== newGeomType;
        const oldGeomDisplay = oldGeomType ? (bothGeomPresent && geomChanged && !geomTypeChanged ? '좌표 변경' : oldGeomType) : null;
        const newGeomDisplay = newGeomType ? (bothGeomPresent && geomChanged && !geomTypeChanged ? '좌표 변경' : newGeomType) : null;
        const titleVal = titleField ? String(oldData[titleField] ?? newData[titleField] ?? '') : '';
        const isBusyDetail = busyKey === detailLog.sl_key;
        return (
          <div
            className="absolute inset-0 flex items-center justify-center p-4"
            style={{ zIndex: SHP_SYNC_DETAIL_NESTED_Z }}
          >
            <div className="absolute inset-0 bg-black/50" aria-hidden onClick={closeDetail} />
            <div
              className="relative flex max-h-[90vh] w-[90vw] max-w-[800px] flex-col overflow-hidden rounded-lg bg-background shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">상세 정보</h3>
                <button type="button" onClick={closeDetail} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">상태</span>
                    <span className="text-xs font-medium">
                      {detailLog.sl_rolled_back ? '롤백됨' : isPending ? '미결' : detailLog.sl_operation === 'kept' ? '유지' : '적용됨'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">구분</span>
                    {readOnly ? (
                      <span className="text-xs text-black dark:text-foreground">
                        {opInfo?.label ?? op}
                      </span>
                    ) : (
                      <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium', opInfo?.badge ?? opInfo?.color)}>
                        <Icon className="w-3 h-3" />
                        {opInfo?.label ?? op}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Key</span>
                    <span className="font-mono text-xs">{detailLog.sl_key_value}</span>
                  </div>
                  {titleField && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">제목</span>
                      <span className="text-xs">{titleVal || '—'}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">기존값 (DB)</h4>
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {allKeys.map((k) => {
                            const v = oldData[k];
                            const disp = v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                            const isChanged = JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]);
                            return (
                              <tr key={k} className="border-b last:border-b-0">
                                <td className="py-1 px-2 font-mono text-muted-foreground bg-muted/30 w-32">{k}</td>
                                <td className={cn('py-1 px-2 truncate max-w-[200px]', isChanged && 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-medium')} title={disp !== '—' ? disp : ''}>
                                  {disp}
                                </td>
                              </tr>
                            );
                          })}
                          {(oldGeomType || newGeomType) && (
                            <tr className="border-b last:border-b-0">
                              <td className="py-1 px-2 font-mono text-muted-foreground bg-muted/30 w-32">geom</td>
                              <td className={cn('py-1 px-2 truncate max-w-[200px]', geomChanged && 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-medium')}>
                                {oldGeomDisplay ?? '—'}
                              </td>
                            </tr>
                          )}
                          {allKeys.length === 0 && !oldGeomType && !newGeomType && (
                            <tr><td className="py-2 px-2 text-muted-foreground">—</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <GeoJsonMiniMap geometry={oldGeom} dataProjection={mapProjection} className="mt-2" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">{changeValueLabel}</h4>
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {allKeys.map((k) => {
                            const v = newData[k];
                            const disp = v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                            const isChanged = JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]);
                            return (
                              <tr key={k} className="border-b last:border-b-0">
                                <td className="py-1 px-2 font-mono text-muted-foreground bg-muted/30 w-32">{k}</td>
                                <td className={cn('py-1 px-2 truncate max-w-[200px]', isChanged && 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-medium')} title={disp !== '—' ? disp : ''}>
                                  {disp}
                                </td>
                              </tr>
                            );
                          })}
                          {(oldGeomType || newGeomType) && (
                            <tr className="border-b last:border-b-0">
                              <td className="py-1 px-2 font-mono text-muted-foreground bg-muted/30 w-32">geom</td>
                              <td className={cn('py-1 px-2 truncate max-w-[200px]', geomChanged && 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-medium')}>
                                {newGeomDisplay ?? '—'}
                              </td>
                            </tr>
                          )}
                          {allKeys.length === 0 && !oldGeomType && !newGeomType && (
                            <tr><td className="py-2 px-2 text-muted-foreground">—</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <GeoJsonMiniMap geometry={newGeom} dataProjection={mapProjection} className="mt-2" />
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t">
                <div className="flex items-center gap-2">
                  {!readOnly && (detailLog.sl_rolled_back ? (
                    op !== 'kept' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={async (e) => { e.stopPropagation(); await handleReapplyOne(detailLog.sl_key); closeDetail(); }}
                        disabled={isBusyDetail}
                      >
                        {isBusyDetail ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                        다시 적용
                      </Button>
                    ) : null
                  ) : isPending ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={async (e) => { e.stopPropagation(); await handleApplyOne(detailLog.sl_key); closeDetail(); }}
                        disabled={isBusyDetail || bulkBusy}
                      >
                        {isBusyDetail ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                        반영
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={async (e) => { e.stopPropagation(); await handleKeepOne(detailLog.sl_key); closeDetail(); }}
                        disabled={isBusyDetail || bulkBusy}
                      >
                        {isBusyDetail ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                        유지
                      </Button>
                    </>
                  ) : op !== 'kept' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={async (e) => { e.stopPropagation(); await handleRollbackOne(detailLog.sl_key); closeDetail(); }}
                      disabled={isBusyDetail}
                    >
                      {isBusyDetail ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                      롤백
                    </Button>
                  ) : null)}
                </div>
                <Button variant="outline" size="sm" onClick={closeDetail}>닫기</Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>,
    document.body
  );
}
