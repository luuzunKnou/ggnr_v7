'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout';
import type { AerialKind, WorkUnitItem } from './aerialMediaTypes';
import { deriveOrthoUnitStatus } from './aerialMediaTypes';
import {
  mockUnitsForKind,
  replaceDroneUnitsFromServer,
  replaceOrthoUnitsFromServer,
  replacePanoUnitsFromServer,
  subscribeMockWorkUnits,
} from './aerialMediaMockData';

type Props = {
  checkedUnitIds: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  /** 지도에서 영상을 켜면 그 그룹을 펼치고 체크된 줄로 맞춘다 */
  reveal?: { id: string; kind: AerialKind; n: number } | null;
  onClose?: () => void;
  className?: string;
};

const GROUPS: { kind: AerialKind; title: string; accent: string }[] = [
  { kind: 'ortho', title: '드론영상', accent: 'bg-blue-500 dark:bg-blue-400' },
  { kind: 'drone', title: '사진,동영상', accent: 'bg-sky-500 dark:bg-sky-400' },
  { kind: 'panorama', title: '항공뷰', accent: 'bg-orange-500 dark:bg-orange-400' },
];

function matchesKeyword(unit: WorkUnitItem, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return unit.workName.toLowerCase().includes(q);
}

function visibleUnits(kind: AerialKind, units: WorkUnitItem[]): WorkUnitItem[] {
  if (kind !== 'ortho') return units.filter((u) => u.files.length > 0);
  return units.filter((u) => {
    const st = u.status ?? deriveOrthoUnitStatus(u.files);
    return st === 'done' || u.files.some((f) => f.status === 'done' && f.tuKey != null);
  });
}

/** 우측 컨트롤 «드론영상» — 종류별 작업목록을 켜고 끈다 */
export function AerialViewLayerPanel({
  checkedUnitIds,
  onCheckedChange,
  reveal = null,
  onClose,
  className,
}: Props) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);
  const [openKinds, setOpenKinds] = useState<Set<AerialKind>>(() => new Set());
  const listScrollRef = useRef<HTMLDivElement>(null);
  const scrollToUnitIdRef = useRef<{ id: string; kind: AerialKind } | null>(null);
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => subscribeMockWorkUnits(() => setListTick((t) => t + 1)), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loadKind = async (kind: 'ortho' | 'drone' | 'panorama') => {
        const res = await call('', 'POST', {
          service: 'aerialUploadService',
          action: 'listWorkUnits',
          params: { kind },
        });
        if (!res?.success) throw new Error('목록을 불러오지 못했습니다.');
        const data = (res.data ?? res) as { units?: never[] };
        const units = data.units ?? [];
        if (kind === 'ortho') replaceOrthoUnitsFromServer(units as never);
        else if (kind === 'drone') replaceDroneUnitsFromServer(units as never);
        else replacePanoUnitsFromServer(units as never);
      };
      await Promise.all([loadKind('ortho'), loadKind('drone'), loadKind('panorama')]);
      setListTick((t) => t + 1);
    } catch {
      setLoadError('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    void listTick;
    return GROUPS.map((group) => ({
      ...group,
      units: visibleUnits(group.kind, mockUnitsForKind(group.kind)).filter((u) =>
        matchesKeyword(u, keyword)
      ),
    }));
  }, [listTick, keyword]);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(checkedUnitIds);
    if (checked) next.add(id);
    else next.delete(id);
    onCheckedChange(next);
  };

  const toggleGroup = (kind: AerialKind) => {
    setOpenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
        return next;
      }
      next.add(kind);
      if (kind === 'ortho' || kind === 'drone') {
        const units = visibleUnits(kind, mockUnitsForKind(kind)).filter((u) => matchesKeyword(u, keyword));
        const checked = units.find((u) => checkedUnitIds.has(u.id));
        scrollToUnitIdRef.current = checked ? { id: checked.id, kind } : null;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!reveal?.id) return;
    scrollToUnitIdRef.current = { id: reveal.id, kind: reveal.kind };
    setOpenKinds((prev) => {
      if (prev.has(reveal.kind)) return prev;
      const next = new Set(prev);
      next.add(reveal.kind);
      return next;
    });
    setScrollTick((tick) => tick + 1);
  }, [reveal]);

  useEffect(() => {
    const target = scrollToUnitIdRef.current;
    const container = listScrollRef.current;
    if (!target || !container) return;
    const row = container.querySelector(
      `[data-aerial-unit="${target.id}"][data-aerial-kind="${target.kind}"]`
    );
    if (!(row instanceof HTMLElement)) return;
    scrollToUnitIdRef.current = null;
    const listRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      container.scrollTop -= listRect.top - rowRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      container.scrollTop += rowRect.bottom - listRect.bottom;
    }
  }, [openKinds, grouped, scrollTick]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-56 flex-col overflow-hidden',
        MAP_LAYER_PANEL_SURFACE_CLASS,
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-white/10">
        <span className="text-[13px] font-medium text-foreground">드론영상</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            닫기
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-[10px] text-muted-foreground dark:border-white/10">
        <button
          type="button"
          onClick={() => toggleGroup('drone')}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 hover:text-foreground dark:hover:bg-white/10',
            openKinds.has('drone') && 'font-medium text-foreground'
          )}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          사진,동영상
        </button>
        <button
          type="button"
          onClick={() => toggleGroup('panorama')}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 hover:text-foreground dark:hover:bg-white/10',
            openKinds.has('panorama') && 'font-medium text-foreground'
          )}
        >
          <span className="h-2.5 w-2.5 rotate-45 bg-orange-500" />
          항공뷰
        </button>
      </div>

      <div className="shrink-0 border-b border-slate-100 px-2.5 py-2 dark:border-white/10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="작업목록"
            className="h-8 border-border bg-muted/50 pl-7 text-[11px] focus-visible:bg-background"
          />
        </div>
      </div>

      <div ref={listScrollRef} className="max-h-[min(420px,calc(100vh-260px))] overflow-y-auto">
        {loadError ? (
          <p className="px-3 py-6 text-center text-[11px] text-rose-500">{loadError}</p>
        ) : (
          grouped.map((group) => {
            const expanded = openKinds.has(group.kind) || keyword.trim().length > 0;
            const checkedCount = group.units.filter((u) => checkedUnitIds.has(u.id)).length;
            return (
              <div key={group.kind} className="border-b border-slate-100 last:border-b-0 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.kind)}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between bg-slate-100 px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-slate-200',
                    'dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/15',
                    checkedCount > 0 && 'text-primary'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-4 w-1 shrink-0 rounded-full', group.accent)} />
                    <span className="truncate">{group.title}</span>
                  </span>
                  <span className="flex items-center gap-1 text-slate-400 dark:text-white/50">
                    {checkedCount > 0 ? (
                      <span className="text-[10px] tabular-nums text-primary">{checkedCount}</span>
                    ) : null}
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>
                {expanded ? (
                  group.units.length === 0 ? (
                    <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                      {loading ? '불러오는 중…' : '작업목록이 없습니다.'}
                    </p>
                  ) : (
                    <ul>
                      {group.units.map((u) => {
                        const checked = checkedUnitIds.has(u.id);
                        return (
                          <li key={u.id} data-aerial-unit={u.id} data-aerial-kind={group.kind}>
                            <label
                              className={cn(
                                'flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-slate-50 dark:hover:bg-white/10',
                                checked && 'bg-blue-50 dark:bg-white/20'
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 dark:border-white/30"
                                checked={checked}
                                onChange={(e) => toggle(u.id, e.target.checked)}
                              />
                              <span
                                className={cn(
                                  'min-w-0 flex-1 truncate text-xs',
                                  checked
                                    ? 'font-medium text-primary'
                                    : 'text-slate-700 dark:text-white/90'
                                )}
                              >
                                {u.workName}
                              </span>
                              {u.workDate ? (
                                <span className="shrink-0 text-[10px] text-muted-foreground">{u.workDate}</span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
