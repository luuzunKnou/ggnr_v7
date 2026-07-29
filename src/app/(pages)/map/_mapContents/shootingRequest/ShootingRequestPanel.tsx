'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import {
  REQUEST_STATUS_LABEL,
  SHOOT_TYPE_LABEL,
  isApprovedFamily,
  type RequestStatus,
} from './shootingRequestMockData';
import {
  countByStatus,
  getShootingRequests,
  SHOOTING_REQUEST_NEW_ID,
  subscribeShootingRequests,
} from './shootingRequestMockStore';

export type ShootingListMode = 'mine' | 'approval';

type Props = {
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string | null) => void;
  listMode: ShootingListMode;
  onListModeChange: (mode: ShootingListMode) => void;
  /** true면 내 신청/승인관리 탭 숨김 (메뉴·지도 버튼으로 분리된 경우) */
  hideModeTabs?: boolean;
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const tone =
    status === 'approved' || status === 'registering'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'registered'
        ? 'bg-slate-100 text-slate-700 ring-slate-300'
        : status === 'rejected'
          ? 'bg-rose-50 text-rose-700 ring-rose-200'
          : 'bg-amber-50 text-amber-800 ring-amber-200';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        tone
      )}
    >
      {REQUEST_STATUS_LABEL[status]}
    </span>
  );
}

export function ShootingRequestPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  listMode,
  onListModeChange,
  hideModeTabs = false,
}: Props) {
  const [keyword, setKeyword] = useState('');
  /** 승인관리: 대기 / 승인 / 반려 (기본 대기) */
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const myRequests = useSyncExternalStore(
    subscribeShootingRequests,
    getShootingRequests,
    getShootingRequests
  );

  useEffect(() => {
    if (listMode === 'approval') setStatusFilter('pending');
    setKeyword('');
  }, [listMode]);

  const pendingCount = countByStatus('pending');
  const approvedCount = countByStatus('approved');
  const rejectedCount = countByStatus('rejected');

  const filtered = useMemo(() => {
    let rows = myRequests;
    if (listMode === 'approval') {
      rows =
        statusFilter === 'approved'
          ? rows.filter((r) => isApprovedFamily(r.status))
          : rows.filter((r) => r.status === statusFilter);
    }
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.purpose,
        row.address,
        row.department,
        row.applicantRankName,
        row.shootDate,
        row.useDate,
        row.submittedAt,
        SHOOT_TYPE_LABEL[row.shootType],
        row.detailRequest,
        REQUEST_STATUS_LABEL[row.status],
        row.rejectReason ?? '',
        row.linkedWorkUnitLabel ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [keyword, myRequests, listMode, statusFilter]);

  const handleAdd = () => {
    onListModeChange('mine');
    onSelectDetailId(SHOOTING_REQUEST_NEW_ID);
  };

  const switchMode = (mode: ShootingListMode) => {
    onListModeChange(mode);
    onSelectDetailId(null);
  };

  const title = listMode === 'mine' ? '내 신청 목록' : '승인 관리';
  const subtitle =
    listMode === 'mine'
      ? `${filtered.length}건${keyword.trim() ? ' · 검색' : ''} · 목업`
      : `대기 ${pendingCount} · 승인 ${approvedCount} · 반려 ${rejectedCount}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-slate-800">{title}</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">{subtitle}</p>
        </div>
        {listMode === 'mine' ? (
          <Button type="button" size="sm" className="h-8 gap-1 px-2.5 text-[11px]" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            추가
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!hideModeTabs ? (
      <div className="flex shrink-0 gap-1 border-b border-slate-100 bg-slate-50/80 px-2.5 py-2">
        {(
          [
            { id: 'mine' as const, label: '내 신청' },
            { id: 'approval' as const, label: `승인관리${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
          ] as const
        ).map((t) => {
          const active = listMode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchMode(t.id)}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[11px] transition-colors',
                active
                  ? 'bg-white font-semibold text-sky-800 shadow-sm ring-1 ring-sky-200'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      ) : null}

      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="목적·지번·부서·상태 검색"
            className="h-9 border-slate-200 bg-slate-50/80 pl-8 text-xs focus-visible:bg-white"
          />
        </div>

        {listMode === 'approval' ? (
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'pending' as const, label: '대기' },
                { id: 'approved' as const, label: '승인' },
                { id: 'rejected' as const, label: '반려' },
              ] as const
            ).map((f) => {
              const active = statusFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                    active
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {listMode === 'approval' ? (
          <p className="rounded-md border border-sky-100 bg-sky-50/80 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-900">
            대기 건을 승인하면 상세에서 비행기록부·파일 업로드를 바로 진행합니다. (목업)
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
            <p className="text-xs text-slate-400">
              {myRequests.length === 0 ? '신청 내역이 없습니다.' : '검색 결과가 없습니다.'}
            </p>
            {listMode === 'mine' && myRequests.length === 0 ? (
              <Button type="button" size="sm" className="mt-1 h-8 gap-1 text-[11px]" onClick={handleAdd}>
                <Plus className="h-3.5 w-3.5" />
                신청서 작성
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((row) => {
              const active = row.id === selectedDetailId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelectDetailId(row.id)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                      active
                        ? 'border-sky-300 bg-sky-50 shadow-sm ring-1 ring-sky-200/80'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600">
                        {row.submittedAt}
                      </span>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="mt-1 truncate text-[12px] font-medium text-slate-800">
                      {row.purpose || '(목적 없음)'}
                      <span className="font-normal text-slate-400">
                        {' · '}
                        {row.applicantRankName || row.department || '신청자 미입력'}
                      </span>
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
