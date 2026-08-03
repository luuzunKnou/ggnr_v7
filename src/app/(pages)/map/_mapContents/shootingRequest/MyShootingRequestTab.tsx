'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { REQUEST_STATUS_LABEL, type RequestStatus } from './shootingRequestMockData';
import {
  getShootingRequests,
  refreshShootingRequests,
  subscribeShootingRequests,
} from './shootingRequestMockStore';

type Props = {
  open: boolean;
  onSelectRequest: (id: string) => void;
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
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1 ring-inset',
        tone
      )}
    >
      {REQUEST_STATUS_LABEL[status]}
    </span>
  );
}

/** 내 정보 패널 — 내 촬영요청 목록 탭 */
export function MyShootingRequestTab({ open, onSelectRequest }: Props) {
  const rows = useSyncExternalStore(
    subscribeShootingRequests,
    getShootingRequests,
    getShootingRequests
  );

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [rows]
  );

  useEffect(() => {
    if (!open) return;
    void refreshShootingRequests('mine').catch(() => undefined);
  }, [open]);

  if (sorted.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6">
        <p className="text-center text-[11px] text-slate-400">신청 내역이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-1.5">
        {sorted.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onSelectRequest(row.id)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600">
                  {row.submittedAt}
                </span>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-1 truncate text-[11px] font-medium text-slate-800">
                {row.purpose || '(목적 없음)'}
                <span className="font-normal text-slate-400">
                  {' · '}
                  {row.applicantRankName || row.department || '신청자 미입력'}
                </span>
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useMyShootingRequestCount(panelOpen: boolean): number {
  const rows = useSyncExternalStore(
    subscribeShootingRequests,
    getShootingRequests,
    getShootingRequests
  );

  useEffect(() => {
    if (!panelOpen) return;
    void refreshShootingRequests('mine').catch(() => undefined);
  }, [panelOpen]);

  return rows.length;
}
