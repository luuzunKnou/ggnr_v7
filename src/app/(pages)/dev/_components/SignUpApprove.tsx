'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { RefreshCw } from 'lucide-react';
import { USER_MANAGER_UI_STYLE } from './userManagerUiVariants';

type SignUpRow = {
  usrId: string;
  ugName: string;
  utName: string;
  usrName: string | null;
  usrTel: string | null;
  usrMail: string | null;
  usrEtc: string | null;
  usrReqTime: string | null;
  usrOkTime: string | null;
  usrCancleTime: string | null;
  usrRejectReason: string | null;
};

type StatusFilter = 'all' | 'pending' | 'rejected';
type SignUpStatus = 'pending' | 'rejected';

function unwrapData<T>(res: { data?: unknown; success?: boolean; error?: string }): T {
  const inner = res.data as { data?: T; success?: boolean; error?: string } | T | undefined;
  if (inner && typeof inner === 'object' && 'data' in (inner as object) && 'success' in (inner as object)) {
    return (inner as { data: T }).data;
  }
  return inner as T;
}

function formatTime(v: string | null): string {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleString('ko-KR');
  } catch {
    return v;
  }
}

function rowStatus(r: SignUpRow): SignUpStatus {
  if (r.usrCancleTime) return 'rejected';
  return 'pending';
}

const STATUS_LABEL: Record<SignUpStatus, string> = {
  pending: '승인대기',
  rejected: '반려',
};

const STATUS_CLASS: Record<SignUpStatus, string> = {
  pending:
    'inline-flex rounded-sm bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  rejected:
    'inline-flex rounded-sm bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/30 dark:text-red-200',
};

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '승인대기' },
  { id: 'rejected', label: '반려' },
];

const uiStyle = USER_MANAGER_UI_STYLE;
const tableRowClass =
  'border-b border-border hover:bg-muted/50 transition-colors [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0';

export function SignUpApprove() {
  const [rows, setRows] = useState<SignUpRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'usrService',
        action: 'listPendingSignUps',
        params: {},
      });
      const data = unwrapData<SignUpRow[]>(res);
      const list = Array.isArray(data) ? data : [];
      setRows(
        list.map((r) => ({
          ...r,
          usrCancleTime:
            r.usrCancleTime ??
            (r as { usr_cancle_time?: string | null }).usr_cancle_time ??
            null,
          usrRejectReason:
            r.usrRejectReason ??
            (r as { usr_reject_reason?: string | null }).usr_reject_reason ??
            null,
        }))
      );
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
    if (filter === 'pending') return rows.filter((r) => rowStatus(r) === 'pending');
    return rows.filter((r) => rowStatus(r) === 'rejected');
  }, [rows, filter]);

  async function approve(usrId: string) {
    setBusyId(usrId);
    setMsg('');
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'usrService',
        action: 'approveSignUp',
        params: { usr_id: usrId },
      });
      const inner = res.data as { success?: boolean; error?: string } | undefined;
      if (inner?.success === false) {
        setError(inner.error ?? '승인 실패');
        return;
      }
      setMsg(`승인됨: ${usrId}`);
      setRejectingId((id) => (id === usrId ? null : id));
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '승인 실패');
    } finally {
      setBusyId(null);
    }
  }

  function openReject(usrId: string) {
    setRejectingId(usrId);
    setRejectReasonDraft('');
    setMsg('');
    setError(null);
  }

  function cancelReject() {
    setRejectingId(null);
    setRejectReasonDraft('');
  }

  async function confirmReject(usrId: string) {
    setBusyId(usrId);
    setMsg('');
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'usrService',
        action: 'rejectSignUp',
        params: {
          usr_id: usrId,
          reject_reason: rejectReasonDraft.trim() || null,
        },
      });
      const inner = res.data as { success?: boolean; error?: string } | undefined;
      if (inner?.success === false) {
        setError(inner.error ?? '반려 실패');
        return;
      }
      setMsg(`반려됨: ${usrId}`);
      setFilter((f) => (f === 'pending' ? 'all' : f));
      setRejectingId(null);
      setRejectReasonDraft('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '반려 실패');
    } finally {
      setBusyId(null);
    }
  }

  const emptyText =
    filter === 'pending'
      ? '승인 대기 중인 가입 신청이 없습니다.'
      : filter === 'rejected'
        ? '반려된 가입 신청이 없습니다.'
        : '가입 신청 내역이 없습니다.';

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
        <div className={uiStyle.tableScroll}>
        <table className={cn(uiStyle.table, 'min-w-[72rem] table-fixed')}>
          <thead className={cn('sticky top-0', uiStyle.tableHead)}>
            <tr>
              <th className={cn('w-20 text-left', uiStyle.tableCell)}>상태</th>
              <th className={cn('w-24 text-left', uiStyle.tableCell)}>아이디</th>
              <th className={cn('w-20 text-left', uiStyle.tableCell)}>이름</th>
              <th className={cn('w-36 text-left', uiStyle.tableCell)}>부서/팀</th>
              <th className={cn('w-28 text-left', uiStyle.tableCell)}>연락처</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>이메일</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>비고</th>
              <th className={cn('w-36 text-left', uiStyle.tableCell)}>신청시간</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>반려사유</th>
              <th className={cn('w-[8.5rem] text-left', uiStyle.tableCell)}>처리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={10}>
                  불러오는 중…
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={10}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const status = rowStatus(r);
                const pending = status === 'pending';
                const dept = `${r.ugName} / ${r.utName}`;
                return (
                  <tr key={r.usrId} className={tableRowClass}>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>
                    </td>
                    <td
                      className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)}
                      title={r.usrId}
                    >
                      {r.usrId}
                    </td>
                    <td
                      className={cn('truncate', uiStyle.tableCell)}
                      title={r.usrName ?? undefined}
                    >
                      {r.usrName ?? '—'}
                    </td>
                    <td className={cn('truncate', uiStyle.tableCell)} title={dept}>
                      {dept}
                    </td>
                    <td
                      className={cn('truncate whitespace-nowrap', uiStyle.tableCell)}
                      title={r.usrTel ?? undefined}
                    >
                      {r.usrTel ?? '—'}
                    </td>
                    <td
                      className={cn('truncate', uiStyle.tableCell)}
                      title={r.usrMail ?? undefined}
                    >
                      {r.usrMail ?? '—'}
                    </td>
                    <td
                      className={cn('truncate', uiStyle.tableCell)}
                      title={r.usrEtc?.trim() ? r.usrEtc : undefined}
                    >
                      {r.usrEtc?.trim() ? r.usrEtc : '—'}
                    </td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      {formatTime(r.usrReqTime)}
                    </td>
                    <td
                      className={cn('truncate', uiStyle.tableCell)}
                      title={
                        status === 'rejected' && r.usrRejectReason?.trim()
                          ? r.usrRejectReason
                          : undefined
                      }
                    >
                      {status === 'rejected'
                        ? r.usrRejectReason?.trim()
                          ? r.usrRejectReason
                          : '—'
                        : '—'}
                    </td>
                    <td className={uiStyle.tableCell}>
                      {pending ? (
                        rejectingId === r.usrId ? (
                          <div className="flex flex-col gap-1.5">
                            <Input
                              placeholder="반려 사유 (선택)"
                              className="h-7 rounded-none text-xs"
                              value={rejectReasonDraft}
                              onChange={(e) => setRejectReasonDraft(e.target.value)}
                              disabled={busyId === r.usrId}
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
                                disabled={busyId === r.usrId}
                                onClick={() => void confirmReject(r.usrId)}
                                title={`${r.usrId} 반려 확정`}
                              >
                                반려 확정
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 rounded-none px-2 text-[11px]"
                                disabled={busyId === r.usrId}
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
                              disabled={busyId === r.usrId}
                              onClick={() => void approve(r.usrId)}
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
                              disabled={busyId === r.usrId}
                              onClick={() => openReject(r.usrId)}
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
    </div>
  );
}
