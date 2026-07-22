'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ClipboardList, UserRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { REQUEST_STATUS_LABEL, type RequestStatus } from './shootingRequestMockData';
import { getShootingRequests, subscribeShootingRequests } from './shootingRequestMockStore';

type Props = {
  onSelectRequest: (id: string) => void;
};

const SIDEBAR_WIDTH = 65;

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

/** 내 정보 패널 안 접이식 섹션 — 촬영요청·알람 등 공통 */
function MyInfoSection({
  title,
  count,
  icon,
  open,
  onToggle,
  headerRight,
  children,
}: {
  title: string;
  count?: number;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-1 px-1.5 py-0.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50"
        >
          <span className="shrink-0 text-sky-600">{icon}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
            {title}
          </span>
          {typeof count === 'number' ? (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-500">
              {count}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
        {headerRight}
      </div>
      {open ? <div className="px-2 pb-2">{children}</div> : null}
    </div>
  );
}

/** 왼쪽 «내 정보» 토글 → 패널(섹션 접기/펴기). 촬영요청·알람 등 확장용 */
export function MapMyInfoFab({ onSelectRequest }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [shootingOpen, setShootingOpen] = useState(true);
  const [bottomPx, setBottomPx] = useState(8);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const rows = useSyncExternalStore(
    subscribeShootingRequests,
    getShootingRequests,
    getShootingRequests
  );

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [rows]
  );

  const syncBottom = () => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBottomPx(Math.max(8, window.innerHeight - r.bottom));
  };

  useEffect(() => {
    if (!panelOpen) return;
    syncBottom();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    const onReposition = () => syncBottom();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [panelOpen]);

  const togglePanel = () => setPanelOpen((v) => !v);

  const panel = panelOpen
    ? createPortal(
        <div
          className={cn(
            'fixed z-[80] flex max-h-[min(420px,72vh)] w-[18rem] flex-col overflow-hidden',
            'rounded-r-xl border border-l-0 border-slate-200/90 bg-white shadow-lg',
            'animate-in fade-in-0 slide-in-from-left-2 duration-150'
          )}
          style={{ left: SIDEBAR_WIDTH, bottom: bottomPx }}
          role="dialog"
          aria-label="내 정보"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <p className="text-[12px] font-semibold text-slate-800">내 정보</p>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setPanelOpen(false)}
              aria-label="내 정보 닫기"
              title="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <MyInfoSection
              title="내 촬영요청"
              count={sorted.length}
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              open={shootingOpen}
              onToggle={() => setShootingOpen((v) => !v)}
            >
              {sorted.length === 0 ? (
                <p className="px-1 py-4 text-center text-[11px] text-slate-400">
                  신청 내역이 없습니다.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {sorted.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPanelOpen(false);
                          onSelectRequest(row.id);
                        }}
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
              )}
            </MyInfoSection>

            {/* 추후: 알람·기타 섹션을 같은 MyInfoSection 으로 추가 */}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative w-full shrink-0">
      {panel}
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePanel}
        title={panelOpen ? '내 정보 닫기' : '내 정보 열기'}
        aria-label={panelOpen ? '내 정보 닫기' : '내 정보 열기'}
        aria-expanded={panelOpen}
        aria-pressed={panelOpen}
        className={cn(
          'flex w-[65px] flex-col items-center justify-center pt-[7px] pb-[7px]',
          'text-white/90 transition-colors hover:bg-white/10 hover:text-white',
          panelOpen && 'bg-white/20 text-white'
        )}
      >
        <UserRound className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        <span className="break-keep pt-[4px] text-center text-[10.5px] font-light">내 정보</span>
      </button>
    </div>
  );
}
