'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { X, RotateCcw, Check, Loader2, Plus, AlertTriangle, Trash2, ShieldCheck, Play } from 'lucide-react';
import { GeoJsonMiniMap } from './GeoJsonMiniMap';

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
  dhKey: number;
  tableName: string;
  shpPath?: string | null;
  pendingOnly?: boolean;
  onClose: () => void;
  onRollbackDone?: () => void;
};

type TabId = 'all' | 'pending' | 'conflict' | 'kept' | 'append' | 'remove';

function opCategory(row: SyncLogRow): string {
  if (!row.sl_operation) {
    if (!row.sl_old_data && row.sl_new_data) return 'new';
    if (row.sl_old_data && row.sl_new_data) return 'conflict';
    if (row.sl_old_data && !row.sl_new_data) return 'delete';
    return 'unknown';
  }
  return row.sl_operation;
}

const OP_LABEL: Record<string, { label: string; color: string; icon: typeof AlertTriangle; badge?: string }> = {
  new: { label: '신규', color: 'text-emerald-600', icon: Plus },
  conflict: { label: '충돌', color: 'text-amber-700', icon: AlertTriangle, badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  delete: { label: '삭제', color: 'text-rose-600', icon: Trash2, badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
  append: { label: '신규', color: 'text-green-600', icon: Plus },
  kept: { label: '기존유지', color: 'text-blue-600', icon: ShieldCheck },
  remove: { label: '삭제', color: 'text-red-600', icon: Trash2, badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
};

type FlatRow = {
  slKey: number;
  operation: string;
  isPending: boolean;
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
    const old = r.sl_old_data ?? {};
    const nw = r.sl_new_data ?? {};
    const titleVal = titleField ? String(old[titleField] ?? nw[titleField] ?? '') : '';
    const base = { slKey: r.sl_key, operation: op, isPending, keyValue: r.sl_key_value ?? '', titleValue: titleVal, isRolledBack: r.sl_rolled_back };

    if (op === 'conflict' || op === 'kept') {
      const changed = Object.keys(old).filter(
        (k) => k !== 'ogc_fid' && k !== 'geom' && JSON.stringify(old[k]) !== JSON.stringify(nw[k]),
      );
      if (changed.length === 0) {
        result.push({ ...base, field: '—', oldVal: '—', newVal: '—', isFirst: true, rowSpan: 1 });
      } else {
        changed.forEach((f, i) => {
          result.push({ ...base, field: f, oldVal: old[f], newVal: nw[f], isFirst: i === 0, rowSpan: i === 0 ? changed.length : 0 });
        });
      }
    } else if (op === 'append' || op === 'new') {
      const nw = r.sl_new_data ?? {};
      const fields = Object.keys(nw).filter((k) => k !== 'ogc_fid' && k !== 'geom');
      if (fields.length === 0) {
        result.push({ ...base, field: '(전체)', oldVal: null, newVal: '—', isFirst: true, rowSpan: 1 });
      } else {
        fields.forEach((f, i) => {
          result.push({ ...base, field: f, oldVal: null, newVal: nw[f], isFirst: i === 0, rowSpan: i === 0 ? fields.length : 0 });
        });
      }
    } else if (op === 'remove' || op === 'delete') {
      const old = r.sl_old_data ?? {};
      const keyVal = r.sl_key_value ?? '';
      const titleVal = titleField ? (old[titleField] ?? '') : '';
      const combined = titleField ? `${titleVal} (${keyVal})` : `(${keyVal})`;
      result.push({ ...base, field: '—', oldVal: combined, newVal: null, isFirst: true, rowSpan: 1 });
    }
  }
  return result;
}

export function SyncDetailModal({ dhKey, tableName, shpPath, pendingOnly, onClose, onRollbackDone }: Props) {
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [titleField, setTitleField] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(pendingOnly ? 'pending' : 'all');
  const [busyKey, setBusyKey] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detailLog, setDetailLog] = useState<SyncLogRow | null>(null);
  const [shpEpsg, setShpEpsg] = useState<number | null>(null);

  const fetchLogs = useCallback(async (): Promise<SyncLogRow[]> => {
    setLoading(true);
    setError(null);
    try {
      const p: Record<string, unknown> = { tableName };
      if (dhKey) p.dhKey = dhKey;
      if (pendingOnly) p.pendingOnly = true;
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'getSyncLogs',
        params: p,
      });
      const d = res?.data ?? res;
      const logRows: SyncLogRow[] = d?.success ? (d.rows ?? []) : [];
      setRows(logRows);
      if (!d?.success) setError(d?.error ?? '조회 실패');
      const hasRemoveOrDelete = logRows.some((r) => {
        const op = r.sl_operation ?? (r.sl_old_data && !r.sl_new_data ? 'delete' : null);
        return op === 'remove' || op === 'delete';
      });
      if (hasRemoveOrDelete) {
        try {
          const tr = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'getTitleFieldName',
            params: { tableName },
          });
          const td = tr?.data ?? tr;
          if (td?.success && td.titleField) setTitleField(td.titleField);
          else setTitleField(null);
        } catch {
          setTitleField(null);
        }
      } else {
        setTitleField(null);
      }
      return logRows;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [dhKey, tableName, pendingOnly]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!detailLog || !shpPath) {
      setShpEpsg(null);
      return;
    }
    let cancelled = false;
    call('', 'POST', { service: 'shpUploadService', action: 'getShpEpsg', params: { pathOrResult: shpPath } })
      .then((res) => {
        const d = res?.data ?? res;
        if (!cancelled && d?.success && d.epsg != null) setShpEpsg(Number(d.epsg));
        else if (!cancelled) setShpEpsg(null);
      })
      .catch(() => { if (!cancelled) setShpEpsg(null); });
    return () => { cancelled = true; };
  }, [detailLog, shpPath]);

  const pendingRows = useMemo(() => rows.filter((r) => !r.sl_operation), [rows]);

  const updateHistoryResult = useCallback(async (freshRows: SyncLogRow[]) => {
    if (!dhKey) return;
    const stillPending = freshRows.filter((r) => !r.sl_operation).length;
    if (stillPending > 0) return;
    const appended = freshRows.filter((r) => r.sl_operation === 'append' && !r.sl_rolled_back).length;
    const conflicted = freshRows.filter((r) => r.sl_operation === 'conflict' && !r.sl_rolled_back).length;
    const removed = freshRows.filter((r) => r.sl_operation === 'remove' && !r.sl_rolled_back).length;
    const kept = freshRows.filter((r) => r.sl_operation === 'kept').length;
    const parts = [
      appended > 0 ? `신규 ${appended}` : '',
      conflicted > 0 ? `충돌 ${conflicted}` : '',
      removed > 0 ? `삭제 ${removed}` : '',
      kept > 0 ? `유지 ${kept}` : '',
    ].filter(Boolean).join(', ');
    try {
      await call('', 'POST', {
        service: 'layerHistoryService',
        action: 'updateDetailResult',
        params: { dhKey, result: '성공', contents: `동기화 완료 (${parts})` },
      });
    } catch { /* ignore */ }
  }, [dhKey]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return rows;
    if (activeTab === 'pending') return pendingRows;
    return rows.filter((r) => {
      const cat = opCategory(r);
      if (activeTab === 'conflict') return cat === 'conflict';
      if (activeTab === 'kept') return cat === 'kept';
      if (activeTab === 'append') return cat === 'append' || cat === 'new';
      if (activeTab === 'remove') return cat === 'remove' || cat === 'delete';
      return false;
    });
  }, [rows, activeTab, pendingRows]);

  const flatRows = useMemo(() => buildFlatRows(filtered, titleField), [filtered, titleField]);

  const counts = useMemo(() => {
    let pending = 0, conflict = 0, kept = 0, append = 0, remove = 0, rolledBack = 0;
    for (const r of rows) {
      const cat = opCategory(r);
      if (!r.sl_operation) { pending++; continue; }
      if (r.sl_rolled_back) { rolledBack++; continue; }
      if (cat === 'conflict') conflict++;
      else if (cat === 'kept') kept++;
      else if (cat === 'append') append++;
      else if (cat === 'remove') remove++;
    }
    return { all: rows.length, pending, conflict, kept, append, remove, rolledBack };
  }, [rows]);

  const afterAction = useCallback(async () => {
    const fresh = await fetchLogs();
    await updateHistoryResult(fresh);
    onRollbackDone?.();
  }, [fetchLogs, updateHistoryResult, onRollbackDone]);

  const handleApplyOne = async (slKey: number) => {
    if (!confirm('SHP 값으로 DB에 반영하시겠습니까?')) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'applySyncEntries',
        params: { slKeys: [slKey], dhKey: dhKey || undefined },
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
    if (!confirm('기존 DB 값을 유지하시겠습니까?')) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'keepSyncEntries',
        params: { slKeys: [slKey], dhKey: dhKey || undefined },
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
    if (!confirm('이 항목을 롤백하시겠습니까?')) return;
    setBusyKey(slKey);
    try {
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'rollbackSyncRows',
        params: { slKeys: [slKey] },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
      } else {
        alert(d?.error ?? '롤백 실패');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleApplyAll = async () => {
    if (!confirm(`미결 ${pendingRows.length}건을 모두 SHP 값으로 반영하시겠습니까?`)) return;
    setBulkBusy(true);
    try {
      const keys = pendingRows.map((r) => r.sl_key);
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'applySyncEntries',
        params: { slKeys: keys, dhKey: dhKey || undefined },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
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
    if (!confirm(`미결 ${pendingRows.length}건을 모두 기존값으로 유지하시겠습니까?`)) return;
    setBulkBusy(true);
    try {
      const keys = pendingRows.map((r) => r.sl_key);
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'keepSyncEntries',
        params: { slKeys: keys, dhKey: dhKey || undefined },
      });
      const d = res?.data ?? res;
      if (d?.success) {
        await afterAction();
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
    if (v === null || v === undefined) return <span className="text-muted-foreground italic text-[10px]">—</span>;
    if (typeof v === 'object') return <span className="font-mono text-[10px]">{JSON.stringify(v)}</span>;
    return String(v);
  };

  const isValEmpty = (v: unknown) => v === null || v === undefined || v === '';

  const openDetail = useCallback((slKey: number) => {
    const log = rows.find((r) => r.sl_key === slKey);
    if (log) setDetailLog(log);
  }, [rows]);

  const closeDetail = useCallback(() => setDetailLog(null), []);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'all', label: `전체 (${counts.all})` },
    { id: 'pending', label: `미결 (${counts.pending})` },
    { id: 'conflict', label: `충돌 (${counts.conflict})` },
    { id: 'kept', label: `유지 (${counts.kept})` },
    { id: 'append', label: `신규 (${counts.append})` },
    { id: 'remove', label: `삭제 (${counts.remove})` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-background rounded-lg shadow-xl w-[92vw] min-w-[92vw] max-w-[1100px] min-h-[85vh] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="text-sm font-semibold">동기화 내역 — {tableName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              전체 {counts.all}건
              {counts.pending > 0 && <> · 미결 <span className="text-amber-600 font-semibold">{counts.pending}</span>건</>}
              {counts.conflict > 0 && <> · 충돌 <span className="text-orange-600">{counts.conflict}</span></>}
              {counts.kept > 0 && <> · 유지 <span className="text-blue-600">{counts.kept}</span></>}
              {counts.append > 0 && <> · 신규 <span className="text-green-600">{counts.append}</span></>}
              {counts.remove > 0 && <> · 삭제 <span className="text-red-500">{counts.remove}</span></>}
              {counts.rolledBack > 0 && <> · 롤백 <span className="text-muted-foreground">{counts.rolledBack}</span></>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
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
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* bulk actions for pending */}
        {pendingRows.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b bg-amber-50 dark:bg-amber-950/20">
            <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
              미결 {pendingRows.length}건
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={handleApplyAll}
                disabled={bulkBusy}
              >
                {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                전체 반영
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={handleKeepAll}
                disabled={bulkBusy}
              >
                {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                전체 유지
              </Button>
            </div>
          </div>
        )}

        {/* body */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-xs text-muted-foreground gap-1">
              <Loader2 className="w-4 h-4 animate-spin" /> 로딩 중…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-40 text-xs text-red-500">{error}</div>
          ) : flatRows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">변경 내역이 없습니다.</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-muted z-10">
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 px-2 w-12 text-center border-b">상태</th>
                  <th className="py-1.5 px-2 w-20 text-center border-b">구분</th>
                  <th className="py-1.5 px-2 w-28 text-center border-b">액션</th>
                  <th className="py-1.5 px-2 w-[50px] border-b">Key</th>
                  <th className="py-1.5 px-2 w-[100px] border-b">Title</th>
                  <th className="py-1.5 px-2 w-32 border-b">변경 필드</th>
                  <th className="py-1.5 px-2 border-b">값</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map((fr, idx) => {
                  const opInfo = OP_LABEL[fr.operation] ?? OP_LABEL['conflict'];
                  const Icon = opInfo?.icon ?? AlertTriangle;
                  const isBusy = busyKey === fr.slKey;

                  return (
                    <tr
                      key={`${fr.slKey}-${fr.field}-${idx}`}
                      className={cn(
                        fr.isFirst ? 'border-t' : '',
                        fr.isRolledBack && 'opacity-40',
                        fr.isPending && 'bg-amber-50/50 dark:bg-amber-950/10',
                        'cursor-pointer hover:bg-muted/30',
                      )}
                      onClick={() => openDetail(fr.slKey)}
                    >
                      {fr.isFirst && (
                        <>
                          <td className="py-1.5 px-2 text-center align-top" rowSpan={fr.rowSpan}>
                            {fr.isRolledBack ? (
                              <span className="text-[10px] text-muted-foreground">롤백됨</span>
                            ) : fr.isPending ? (
                              <span className="text-[10px] text-amber-600 font-semibold">미결</span>
                            ) : fr.operation === 'kept' ? (
                              <span className="text-[10px] text-blue-500">유지</span>
                            ) : (
                              <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-center align-top" rowSpan={fr.rowSpan}>
                            <span
                              className={cn(
                                'inline-flex items-center justify-center gap-0.5 text-[10px] font-medium whitespace-nowrap',
                                opInfo?.badge ? `rounded-full px-1.5 py-0.5 ${opInfo.badge}` : opInfo?.color ?? ''
                              )}
                            >
                              <Icon className="w-3 h-3 shrink-0" />
                              {opInfo?.label ?? fr.operation}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center align-top" rowSpan={fr.rowSpan} onClick={(e) => e.stopPropagation()}>
                            {!fr.isRolledBack && (
                              fr.isPending ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-0.5 text-[10px] text-orange-600 hover:underline font-medium disabled:opacity-40"
                                    onClick={() => handleApplyOne(fr.slKey)}
                                    disabled={isBusy || bulkBusy}
                                  >
                                    {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                    반영
                                  </button>
                                  <span className="text-muted-foreground">|</span>
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline font-medium disabled:opacity-40"
                                    onClick={() => handleKeepOne(fr.slKey)}
                                    disabled={isBusy || bulkBusy}
                                  >
                                    {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                                    유지
                                  </button>
                                </div>
                              ) : fr.operation !== 'kept' ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-red-500 hover:underline font-medium disabled:opacity-40"
                                  onClick={() => handleRollbackOne(fr.slKey)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                  롤백
                                </button>
                              ) : null
                            )}
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[10px] align-top truncate min-w-[200px] max-w-[200px]" rowSpan={fr.rowSpan} title={fr.keyValue}>
                            {fr.keyValue}
                          </td>
                          <td className="py-1.5 px-2 text-[10px] align-top truncate min-w-[200px] max-w-[200px]" rowSpan={fr.rowSpan} title={fr.titleValue}>
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
                          <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                            {fr.field}
                          </td>
                          <td
                            className={cn(
                              'py-1 px-2 text-[11px] max-w-[18rem] truncate',
                              fr.operation === 'kept' && 'font-semibold text-blue-700 dark:text-blue-300',
                              (fr.operation === 'append' || fr.operation === 'new') && 'text-green-700 dark:text-green-300',
                            )}
                            title={[fr.oldVal, fr.newVal].filter((v) => v != null).map(String).join(' → ')}
                          >
                            {fr.newVal != null && isValEmpty(fr.oldVal) ? (
                              <span className="inline-flex items-center gap-1 flex-wrap">
                                <span className="text-muted-foreground text-[10px]">(데이터 없음)</span>
                                <span className="text-muted-foreground shrink-0">→</span>
                                <span className={cn(
                                  (fr.operation === 'conflict' || fr.operation === 'kept') && 'font-semibold text-orange-600 dark:text-orange-400',
                                )}>
                                  {fmtVal(fr.newVal)}
                                </span>
                              </span>
                            ) : fr.oldVal != null && fr.newVal != null && JSON.stringify(fr.oldVal) !== JSON.stringify(fr.newVal) ? (
                              <span className="inline-flex items-center gap-1 flex-wrap">
                                {fmtVal(fr.oldVal)}
                                <span className="text-muted-foreground shrink-0">→</span>
                                <span className={cn(
                                  (fr.operation === 'conflict' || fr.operation === 'kept') && 'font-semibold text-orange-600 dark:text-orange-400',
                                )}>
                                  {fmtVal(fr.newVal)}
                                </span>
                              </span>
                            ) : fr.newVal != null ? (
                              fmtVal(fr.newVal)
                            ) : (
                              fmtVal(fr.oldVal)
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

        {/* footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>닫기</Button>
        </div>
      </div>

      {/* 상세 정보 모달 */}
      {detailLog && (() => {
        const op = opCategory(detailLog);
        const opInfo = OP_LABEL[op] ?? OP_LABEL['conflict'];
        const Icon = opInfo?.icon ?? AlertTriangle;
        const isPending = !detailLog.sl_operation;
        const oldData = detailLog.sl_old_data ?? {};
        const newData = detailLog.sl_new_data ?? {};
        const allKeys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])].filter((k) => k !== 'ogc_fid' && k !== 'geom');
        const parseGeom = (g: unknown): Record<string, unknown> | null => {
          if (g == null) return null;
          if (typeof g === 'string') try { return JSON.parse(g) as Record<string, unknown>; } catch { return null; }
          return typeof g === 'object' && g !== null && 'type' in g && 'coordinates' in g ? (g as Record<string, unknown>) : null;
        };
        const oldGeom = parseGeom(oldData.geom);
        const newGeom = parseGeom(newData.geom);
        const titleVal = titleField ? String(oldData[titleField] ?? newData[titleField] ?? '') : '';
        const isBusyDetail = busyKey === detailLog.sl_key;
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
            onClick={(e) => { e.stopPropagation(); closeDetail(); }}
            role="presentation"
          >
            <div
              className="bg-background rounded-lg shadow-xl w-[90vw] max-w-[800px] max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
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
                    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', opInfo?.badge ?? opInfo?.color)}>
                      <Icon className="w-3 h-3" />
                      {opInfo?.label ?? op}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Key</span>
                    <span className="font-mono text-xs">{detailLog.sl_key_value}</span>
                  </div>
                  {titleField && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Title</span>
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
                          {allKeys.length === 0 && (
                            <tr><td className="py-2 px-2 text-muted-foreground">—</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <GeoJsonMiniMap geometry={oldGeom} dataProjection="EPSG:5181" className="mt-2" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">변경값 (SHP)</h4>
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
                          {allKeys.length === 0 && (
                            <tr><td className="py-2 px-2 text-muted-foreground">—</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <GeoJsonMiniMap geometry={newGeom} dataProjection={shpEpsg != null ? `EPSG:${shpEpsg}` : 'EPSG:4326'} className="mt-2" />
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t">
                <div className="flex items-center gap-2">
                  {!detailLog.sl_rolled_back && (
                    isPending ? (
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
                    ) : null
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={closeDetail}>닫기</Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
