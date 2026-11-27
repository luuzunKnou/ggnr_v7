'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LayerRowAddButton } from '../../../_mapComponents/layerRowEdit';
import {
  PUBLIC_PROPERTY_PERMIT_NEW_ID,
  derivePermitStatus,
  formatParcelAddress,
  type PublicPropertyOwnership,
  type PublicPropertyPermit,
} from './publicPropertyPermitMock';
import { usePublicPropertyPermits } from './publicPropertyPermitStore';
import { usePublicPropertyPermitMapHighlight } from './usePublicPropertyPermitMapHighlight';

type SortKey = 'permitNo' | 'ownership' | 'purpose' | 'periodEnd';
type SortDir = 'asc' | 'desc';
type SortSpec = { key: SortKey; dir: SortDir };

const SORT_COLUMNS: { key: SortKey; label: string; align: 'left' | 'center' }[] = [
  { key: 'permitNo', label: '허가번호', align: 'left' },
  { key: 'ownership', label: '국유/공유', align: 'center' },
  { key: 'purpose', label: '용도', align: 'left' },
  { key: 'periodEnd', label: '종료일', align: 'center' },
];

function compareRows(a: PublicPropertyPermit, b: PublicPropertyPermit, sorts: SortSpec[]): number {
  for (const { key, dir } of sorts) {
    const av = String(a[key] ?? '').trim();
    const bv = String(b[key] ?? '').trim();
    if (!av && bv) return 1;
    if (av && !bv) return -1;
    const c = av.localeCompare(bv, 'ko', { numeric: true });
    if (c !== 0) return dir === 'asc' ? c : -c;
  }
  return 0;
}

function formatYmd(ymd: string): string {
  const s = String(ymd ?? '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

type Props = {
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onClose: () => void;
};

/** 국공유재산 사용허가 목록 — 점용대장 목록 패턴(검색·필터·표) */
export function PublicPropertyPermitListPanel({
  selectedId,
  onSelectId,
  onClose,
}: Props) {
  const rows = usePublicPropertyPermits();
  const [keyword, setKeyword] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState<'' | PublicPropertyOwnership>('');
  const [statusFilter, setStatusFilter] = useState<'' | '진행중' | '종료'>('');
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const { highlightRow, clearHighlight } = usePublicPropertyPermitMapHighlight();

  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    let filtered = rows.filter((r) => {
      if (ownershipFilter && r.ownership !== ownershipFilter) return false;
      const status = derivePermitStatus(r.renewEnd || r.periodEnd);
      if (statusFilter && status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        r.permitNo,
        r.ownership,
        r.purpose,
        r.userName,
        formatParcelAddress(r.parcel),
        r.periodEnd,
        r.renewEnd,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
    if (sorts.length > 0) {
      filtered = filtered.slice().sort((a, b) => compareRows(a, b, sorts));
    } else {
      filtered = filtered.slice().sort((a, b) =>
        String(a.permitNo).localeCompare(String(b.permitNo), 'ko', { numeric: true })
      );
    }
    return filtered;
  }, [rows, keyword, ownershipFilter, statusFilter, sorts]);

  useEffect(() => {
    const row = rows.find((r) => r.id === selectedId) ?? null;
    if (row) highlightRow(row);
    else clearHighlight();
  }, [selectedId, rows, highlightRow, clearHighlight]);

  useEffect(() => {
    return () => clearHighlight();
  }, [clearHighlight]);

  const toggleSort = (key: SortKey) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx < 0) return [...prev, { key, dir: 'asc' }];
      if (prev[idx]!.dir === 'asc') {
        const next = [...prev];
        next[idx] = { key, dir: 'desc' };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">국공유재산 사용허가</span>
        <div className="flex items-center gap-1">
          <LayerRowAddButton
            onClick={() => onSelectId(PUBLIC_PROPERTY_PERMIT_NEW_ID)}
            disabled={selectedId === PUBLIC_PROPERTY_PERMIT_NEW_ID}
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (허가번호, 용도, 사용자, 소재지)"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { value: '', label: '전체' },
              { value: '국유', label: '국유' },
              { value: '공유', label: '공유' },
            ] as const
          ).map((opt) => {
            const active = ownershipFilter === opt.value;
            return (
              <button
                key={opt.value || '__all_own__'}
                type="button"
                onClick={() => setOwnershipFilter(opt.value)}
                className={cn(
                  'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            );
          })}
          <span className="mx-1 self-center text-[10px] text-muted-foreground">|</span>
          {(
            [
              { value: '', label: '기간전체' },
              { value: '진행중', label: '진행중' },
              { value: '종료', label: '종료' },
            ] as const
          ).map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value || '__all_st__'}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={cn(
                  'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[52px]" />
              <col className="w-[72px]" />
              <col className="w-[64px]" />
              <col />
              <col className="w-[88px]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted/95">
              <tr>
                <th className="border-b border-border px-2 py-1.5 text-center text-[11px] font-semibold text-muted-foreground">
                  상태
                </th>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key);
                  const active = sortIdx >= 0;
                  const dir = active ? sorts[sortIdx]!.dir : null;
                  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'border-b border-border px-1 py-1.5 text-[11px] font-semibold text-muted-foreground',
                        col.align === 'center' ? 'text-center' : 'text-left'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted',
                          col.align === 'center' && 'justify-center',
                          active && 'text-foreground'
                        )}
                      >
                        {col.label}
                        <Icon className="h-3 w-3 opacity-60" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    검색 결과가 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const end = row.renewEnd || row.periodEnd;
                  const status = derivePermitStatus(end);
                  const selected = selectedId === row.id;
                  return (
                    <tr
                      key={row.id}
                      data-ppp-row={row.id}
                      onClick={() => onSelectId(row.id)}
                      className={cn(
                        'cursor-pointer border-b border-border/70 transition-colors',
                        selected ? 'bg-primary/10' : 'hover:bg-muted/50'
                      )}
                    >
                      <td className="px-1 py-1.5 text-center">
                        <span
                          className={cn(
                            'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                            status === '진행중'
                              ? 'bg-emerald-500/15 text-emerald-700'
                              : 'bg-slate-500/15 text-slate-600'
                          )}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="truncate px-2 py-1.5 font-medium">{row.permitNo || '—'}</td>
                      <td className="px-1 py-1.5 text-center">{row.ownership}</td>
                      <td className="truncate px-2 py-1.5" title={row.purpose}>
                        {row.purpose || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums">
                        {formatYmd(end)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {items.length}건 · 프로토타입(목업)
        </div>
      </div>
    </div>
  );
}
