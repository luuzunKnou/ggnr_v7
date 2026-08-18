'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { RefreshCw } from 'lucide-react';
import { USER_MANAGER_UI_STYLE } from './userManagerUiVariants';

/** 0=없음 1=버튼보기 2=읽기 3=쓰기 — 클라 표시용(스키마 미 import) */
const SERP_TYPE_LABELS: Record<number, string> = {
  0: '없음',
  1: '버튼보기',
  2: '읽기',
  3: '쓰기',
};

type Row = {
  uarKey: number;
  usrId: string;
  targetType: string;
  serEng: string | null;
  sysKey: string | null;
  requestedSerpType: number | null;
  requestReason?: string | null;
  rejectReason?: string | null;
  state: string;
  createdAt: string;
  processedAt?: string | null;
};

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type RowStatus = 'pending' | 'approved' | 'rejected';

async function permCall(action: string, params: Record<string, unknown> = {}) {
  const res = await call('', 'POST', { service: 'permissionService', action, params });
  if (!res?.success) throw new Error(res?.error ?? 'failed');
  return res.data;
}

function formatTime(v: string | null | undefined): string {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleString('ko-KR');
  } catch {
    return v;
  }
}

function rowStatus(r: Row): RowStatus {
  if (r.state === 'approved') return 'approved';
  if (r.state === 'rejected') return 'rejected';
  return 'pending';
}

function targetLabel(r: Row): string {
  if (r.targetType === 'ser') return r.serEng?.trim() || '—';
  return r.sysKey != null ? `시스템:${r.sysKey}` : '—';
}

function typeLabel(targetType: string): string {
  if (targetType === 'ser') return '기능';
  if (targetType === 'sys') return '시스템';
  return targetType;
}

function stepLabel(n: number | null): string {
  if (n == null) return '—';
  return SERP_TYPE_LABELS[n] ?? String(n);
}

const STATUS_LABEL: Record<RowStatus, string> = {
  pending: '승인대기',
  approved: '승인완료',
  rejected: '반려',
};

const STATUS_CLASS: Record<RowStatus, string> = {
  pending:
    'inline-flex rounded-sm bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  approved:
    'inline-flex rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
  rejected:
    'inline-flex rounded-sm bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/30 dark:text-red-200',
};

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '승인대기' },
  { id: 'approved', label: '승인완료' },
  { id: 'rejected', label: '반려' },
];

const uiStyle = USER_MANAGER_UI_STYLE;
const tableRowClass =
  'border-t border-border hover:bg-muted/50 transition-colors [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0';

export function AccessRequestQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<number | null>(null);
  /** 반려 사유 입력 중인 행 */
  const [rejectingKey, setRejectingKey] = useState<number | null>(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await permCall('listPendingAccessRequests')) as Row[];
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '목록 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => rowStatus(r) === filter);
  }, [rows, filter]);

  async function approve(key: number) {
    setBusyKey(key);
    setMsg('');
    setError(null);
    try {
      await permCall('approveAccessRequest', { uarKey: key });
      setMsg(`승인됨 (#${key})`);
      setRejectingKey((k) => (k === key ? null : k));
      setFilter((f) => (f === 'pending' ? 'all' : f));
      // 서버 목록이 승인·반려 포함이므로 load로 확정 (낙관적 갱신만 하면 pending-only API와 어긋남)
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '승인 실패');
    } finally {
      setBusyKey(null);
    }
  }

  function openReject(key: number) {
    setRejectingKey(key);
    setRejectReasonDraft('');
    setMsg('');
    setError(null);
  }

  function cancelReject() {
    setRejectingKey(null);
    setRejectReasonDraft('');
  }

  async function confirmReject(key: number) {
    setBusyKey(key);
    setMsg('');
    setError(null);
    try {
      await permCall('rejectAccessRequest', {
        uarKey: key,
        rejectReason: rejectReasonDraft.trim() || null,
      });
      setMsg(`반려됨 (#${key})`);
      setFilter((f) => (f === 'pending' ? 'all' : f));
      setRejectingKey(null);
      setRejectReasonDraft('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '반려 실패');
    } finally {
      setBusyKey(null);
    }
  }

  const emptyText =
    filter === 'pending'
      ? '승인 대기 중인 권한 신청이 없습니다.'
      : filter === 'approved'
        ? '승인 완료된 권한 신청이 없습니다.'
        : filter === 'rejected'
          ? '반려된 권한 신청이 없습니다.'
          : '권한 신청 내역이 없습니다.';

  return (
    <div className={uiStyle.page}>
      <div className={uiStyle.toolbar}>
        <div className="flex shrink-0 items-center gap-0 border border-border">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              title={`${f.label} 보기`}
              className={cn(
                'h-8 px-3 text-xs transition-colors',
                filter === f.id
                  ? 'bg-foreground text-background'
                  : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {error ? (
          <p className="min-w-0 max-w-[280px] shrink truncate text-sm text-red-600" title={error}>
            {error}
          </p>
        ) : msg ? (
          <p className="min-w-0 max-w-[280px] shrink truncate text-sm text-emerald-600" title={msg}>
            {msg}
          </p>
        ) : null}
        {loading && <span className="text-sm text-muted-foreground">조회 중...</span>}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('ml-auto shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
          onClick={() => void load()}
          disabled={loading}
          title="새로고침"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          새로고침
        </Button>
      </div>

      <div className={uiStyle.tableWrap}>
        <table className={cn(uiStyle.table, 'min-w-[68rem] table-fixed')}>
          <thead className={cn('sticky top-0', uiStyle.tableHead)}>
            <tr>
              <th className={cn('w-20 text-left', uiStyle.tableCell)}>상태</th>
              <th className={cn('w-24 text-left', uiStyle.tableCell)}>신청자</th>
              <th className={cn('w-16 text-left', uiStyle.tableCell)}>유형</th>
              <th className={cn('w-28 text-left', uiStyle.tableCell)}>대상</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>신청사유</th>
              <th className={cn('w-24 text-left', uiStyle.tableCell)}>단계</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>반려사유</th>
              <th className={cn('w-36 text-left', uiStyle.tableCell)}>신청시간</th>
              <th className={cn('w-[8.5rem] text-left', uiStyle.tableCell)}>처리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={9}>
                  불러오는 중…
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={9}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const status = rowStatus(r);
                const pending = status === 'pending';
                const isRejecting = rejectingKey === r.uarKey;
                return (
                  <tr key={r.uarKey} className={tableRowClass}>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>
                    </td>
                    <td
                      className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)}
                      title={r.usrId}
                    >
                      {r.usrId}
                    </td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      {typeLabel(r.targetType)}
                    </td>
                    <td
                      className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)}
                      title={targetLabel(r)}
                    >
                      {targetLabel(r)}
                    </td>
                    <td
                      className={cn('truncate', uiStyle.tableCell)}
                      title={r.requestReason?.trim() ? r.requestReason : undefined}
                    >
                      {r.requestReason?.trim() ? r.requestReason : '—'}
                    </td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      {r.targetType === 'ser' ? stepLabel(r.requestedSerpType) : '—'}
                    </td>
                    <td
                      className={cn('truncate', uiStyle.tableCell)}
                      title={
                        status === 'rejected' && r.rejectReason?.trim()
                          ? r.rejectReason
                          : undefined
                      }
                    >
                      {status === 'rejected'
                        ? r.rejectReason?.trim()
                          ? r.rejectReason
                          : '—'
                        : '—'}
                    </td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      {formatTime(r.createdAt)}
                    </td>
                    <td className={uiStyle.tableCell}>
                      {pending ? (
                        isRejecting ? (
                          <div className="flex flex-col gap-1.5">
                            <Input
                              placeholder="반려 사유 (선택)"
                              className="h-7 rounded-none text-xs"
                              value={rejectReasonDraft}
                              onChange={(e) => setRejectReasonDraft(e.target.value)}
                              disabled={busyKey === r.uarKey}
                              title="반려 사유"
                              autoFocus
                            />
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className={cn(
                                  'h-6 rounded-none px-2 text-[11px]',
                                  uiStyle.secondaryButton
                                )}
                                disabled={busyKey === r.uarKey}
                                onClick={() => void confirmReject(r.uarKey)}
                                title={`${r.usrId} 반려 확정`}
                              >
                                반려 확정
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 rounded-none px-2 text-[11px]"
                                disabled={busyKey === r.uarKey}
                                onClick={cancelReject}
                                title="반려 취소"
                              >
                                취소
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-nowrap gap-1">
                            <Button
                              type="button"
                              size="sm"
                              className={cn(
                                'h-6 rounded-none px-2 text-[11px]',
                                uiStyle.primaryButton
                              )}
                              disabled={busyKey === r.uarKey}
                              onClick={() => void approve(r.uarKey)}
                              title={`${r.usrId} 승인`}
                            >
                              승인
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className={cn(
                                'h-6 rounded-none px-2 text-[11px]',
                                uiStyle.secondaryButton
                              )}
                              disabled={busyKey === r.uarKey}
                              onClick={() => openReject(r.uarKey)}
                              title={`${r.usrId} 반려`}
                            >
                              반려
                            </Button>
                          </div>
                        )
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
