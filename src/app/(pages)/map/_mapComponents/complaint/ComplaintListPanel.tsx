'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { call } from '@/lib/api';
import { useMapContext } from '../MapContext';
import type { CompUI } from './types';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Search,
  MapPin,
  Calendar,
  User,
  ChevronRight,
  Plus,
  Users,
  CheckCircle2,
  Wrench,
  CircleDot,
  ClipboardList,
  ClipboardCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { COMPLAINT_STATE_OPTIONS, getStateStyle as getStateStyleBase } from './state-options';
import { scheduleFitMapToExtent3857 } from '../config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';
import { COMP_WMS_LAYER_IDS } from './complaintLayerId';
import {
  animateComplaintToCenter3857,
  center3857FromExtent,
  useComplaintMapClick,
} from './useComplaintMapClick';
import { useComplaintMapHighlight } from './useComplaintMapHighlight';
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess';

function lowerLayerIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.toLowerCase());
}

const PAGE_SIZE = 50;

/** 임시 UI 비교용. sessionStorage에 유지. 확정 후 제거 */
const COMPLAINT_UI_THEME_KEY = 'ggnr.complaintListUiTheme';
type ComplaintUiTheme = 'current' | 'category';
const COMPLAINT_CATEGORY_OPTIONS = ['전체', '상수', '하수', '급수', '준설'] as const;
type ComplaintCategory = (typeof COMPLAINT_CATEGORY_OPTIONS)[number];

function readComplaintUiTheme(): ComplaintUiTheme {
  if (typeof window === 'undefined') return 'current';
  return window.sessionStorage.getItem(COMPLAINT_UI_THEME_KEY) === 'category'
    ? 'category'
    : 'current';
}

/** comp_extra.tag / tags 우선. 없으면 목록 미리보기용으로 키 기반 분류 */
function resolveComplaintCategory(comp: CompUI): Exclude<ComplaintCategory, '전체'> {
  const extra = comp.compExtra;
  if (extra && typeof extra === 'object') {
    const single = extra.tag ?? extra.category ?? extra.compTag;
    if (typeof single === 'string') {
      const t = single.replace(/^#/, '').trim();
      if (t === '상수' || t === '하수' || t === '급수' || t === '준설') return t;
    }
    const tags = extra.tags;
    if (Array.isArray(tags)) {
      for (const raw of tags) {
        const t = String(raw ?? '')
          .replace(/^#/, '')
          .trim();
        if (t === '상수' || t === '하수' || t === '급수' || t === '준설') return t;
      }
    }
  }
  const preview = ['상수', '하수', '급수', '준설'] as const;
  return preview[Math.abs(Number(comp.compKey) || 0) % preview.length];
}

/** 목록 카드 배지용: getStateStyle + 아이콘 (점검/처리중/완료만 아이콘 매핑, 나머지는 기본) */
function getStateStyle(state: string) {
  const style = getStateStyleBase(state);
  const iconMap: Record<string, React.ReactNode> = {
    접수: <ClipboardList className="h-3 w-3 text-[#1D6AE3]" />,
    점검: <ClipboardCheck className="h-3 w-3 text-violet-600" />,
    처리중: <Wrench className="h-3 w-3 text-orange-600" />,
    완료: <CheckCircle2 className="h-3 w-3 text-green-600" />,
  };
  return { ...style, icon: iconMap[state] ?? <CircleDot className="h-3 w-3 text-muted-foreground" /> };
}

export default function ComplaintListPanel({
  refreshKey = 0,
  onRequestAdd,
  onClose,
}: {
  refreshKey?: number;
  onRequestAdd?: () => void;
  onClose?: () => void;
}) {
  const mapContext = useMapContext();
  const canWrite = useSerWriteAccess();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const setComplaintDetail = mapContext?.setComplaintDetail;
  const complaintDetail = mapContext?.complaintDetail ?? null;

  const [complaints, setComplaints] = useState<CompUI[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<ComplaintCategory>('전체');
  // SSR·첫 클라이언트 렌더는 동일하게 current. sessionStorage는 mount 후 반영 (hydration 방지)
  const [uiTheme, setUiTheme] = useState<ComplaintUiTheme>('current');

  useEffect(() => {
    setUiTheme(readComplaintUiTheme());
  }, []);

  const toggleUiTheme = useCallback(() => {
    setUiTheme((prev) => {
      const next: ComplaintUiTheme = prev === 'current' ? 'category' : 'current';
      try {
        window.sessionStorage.setItem(COMPLAINT_UI_THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
    setFilterCategory('전체');
  }, []);

  /** 패널 진입 시 민원관리 레이어 켜고 전체 extent로 지도 이동 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    const layerIds = lowerLayerIds(COMP_WMS_LAYER_IDS);
    const leftover = ctx?.mapInstanceRef?.current
      ?.getLayers()
      .getArray()
      .find((l) => l.get('serviceLayer') === true);
    if (leftover?.get('complaintFlyHidden') === true) {
      const prev = leftover.get('complaintFlyPrevOpacity');
      leftover.setOpacity(typeof prev === 'number' ? prev : 1);
      leftover.unset('complaintFlyHidden');
      leftover.unset('complaintFlyPrevOpacity');
    }
    if (!ctx?.setVisibleLayerNames) return;

    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const lid of layerIds) {
        if (!next.has(lid)) {
          next.add(lid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    let cancelled = false;
    void call('', 'POST', {
      service: 'complaintService',
      action: 'getLayerExtent3857',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const extent = data?.extent3857 as number[] | null | undefined;
        const map = mapContextRef.current?.mapInstanceRef?.current;
        if (
          !map ||
          !Array.isArray(extent) ||
          extent.length !== 4 ||
          !extent.every((v) => Number.isFinite(Number(v)))
        ) {
          return;
        }
        window.setTimeout(() => {
          if (cancelled) return;
          scheduleFitMapToExtent3857(map, extent.map(Number), {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () =>
              mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
          });
        }, 80);
      })
      .catch(() => {
        /* extent 없으면 레이어만 켠 상태 유지 */
      });

    return () => {
      cancelled = true;
      const c = mapContextRef.current;
      if (!c?.setVisibleLayerNames) return;
      c.setVisibleLayerNames((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const lid of layerIds) {
          if (next.delete(lid)) changed = true;
        }
        return changed ? next : prev;
      });
    };
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'list',
        params: { limit: PAGE_SIZE, offset: 0 },
      });
      if (res?.success && res?.data) {
        const rows = (res.data.rows ?? []) as (CompUI & { latestState?: string | null })[];
        setComplaints(rows);
        setTotal(res.data.total ?? 0);
      } else {
        setComplaints([]);
        setTotal(0);
      }
    } catch (e) {
      console.error('민원 목록 조회 실패:', e);
      setComplaints([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList, refreshKey]);

  const openDetailByCompKey = useCallback(
    async (compKey: number, options?: { flyToMap?: boolean }) => {
      if (!setComplaintDetail) return;
      const flyToMap = options?.flyToMap !== false;
      try {
        const res = await call('', 'POST', {
          service: 'complaintService',
          action: 'get',
          params: { compKey },
        });
        if (res?.success && res?.data) {
          const data = res.data as CompUI;
          setComplaintDetail(data as Parameters<typeof setComplaintDetail>[0]);
          if (!flyToMap) return;
          const map = mapContext?.mapInstanceRef?.current;
          const center = center3857FromExtent(data.extent3857);
          if (map && center) {
            // 상세 패널이 열린 뒤 padding 반영 → 점 위치가 화면 정중앙
            animateComplaintToCenter3857(map, center, () =>
              mapContext?.applyMapViewPaddingRef?.current?.()
            );
          }
        }
      } catch (e) {
        console.error('민원 상세 조회 실패:', e);
      }
    },
    [setComplaintDetail, mapContext]
  );

  const handleSelect = useCallback(
    async (comp: CompUI) => {
      // 같은 행을 한 번 더 누르면 상세를 닫는다
      if (complaintDetail?.compKey === comp.compKey) {
        setComplaintDetail?.(null);
        return;
      }
      await openDetailByCompKey(comp.compKey, { flyToMap: true });
    },
    [openDetailByCompKey, complaintDetail?.compKey, setComplaintDetail]
  );

  useComplaintMapClick({
    enabled: true,
    onSelectCompKey: (compKey) => openDetailByCompKey(compKey, { flyToMap: false }),
  });

  useComplaintMapHighlight(
    Boolean(mapContext?.mapReady),
    complaintDetail?.geomGeoJson4326 ?? null,
    complaintDetail?.compKey ?? null
  );

  const selectedKey = complaintDetail?.compKey ?? null;

  const useCategoryUi = uiTheme === 'category';

  const filtered = useMemo(() => {
    return complaints.filter((c) => {
      const latestState = c.latestState ?? '접수';
      const matchesSearch =
        !searchQuery ||
        c.compName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.compAdr?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.compContent?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(c.compKey).includes(searchQuery);
      const matchesFilter = !filterState || latestState === filterState;
      const matchesCategory =
        !useCategoryUi ||
        filterCategory === '전체' ||
        resolveComplaintCategory(c) === filterCategory;
      return matchesSearch && matchesFilter && matchesCategory;
    });
  }, [complaints, searchQuery, filterState, filterCategory, useCategoryUi]);

  if (loading) {
    return (
      <div className="h-full flex flex-col min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1 py-12 text-sm text-muted-foreground">
          로딩 중...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="flex flex-col h-full bg-background">
        <div className="flex-shrink-0 border-b border-border">
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
                <Users className="h-4 w-4 text-primary/80" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-foreground/90">민원관리</h1>
                <p className="text-[11px] text-muted-foreground">
                  {useCategoryUi && filterCategory !== '전체' ? '표시' : '전체'}{' '}
                  <span className="font-medium text-foreground/80">
                    {useCategoryUi ? filtered.length : complaints.length}
                  </span>
                  건
                  {useCategoryUi ? (
                    <span className="ml-1 text-muted-foreground/70">(분류 UI)</span>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(
                  'h-[26px] min-h-[26px] gap-1 px-2 text-[11px] font-medium rounded-lg',
                  useCategoryUi
                    ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                    : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
                )}
                onClick={toggleUiTheme}
                title="임시: 기존 UI와 업무 분류 UI 전환"
              >
                {useCategoryUi ? '분류UI' : '기존UI'}
              </Button>
              {canWrite ? (
                <Button
                  size="sm"
                  className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary rounded-lg"
                  onClick={() => onRequestAdd?.()}
                >
                  <Plus className="h-3 w-3" />
                  민원 추가
                </Button>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="닫기"
                  aria-label="닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {useCategoryUi ? (
            <div className="px-3 pb-2">
              <div className="flex border-b border-border" role="tablist" aria-label="업무 분류">
                {COMPLAINT_CATEGORY_OPTIONS.map((cat) => {
                  const isActive = filterCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setFilterCategory(cat)}
                      className={cn(
                        'h-7 min-w-0 flex-1 truncate border-b-2 px-0.5 text-center text-[11px] -mb-px',
                        isActive
                          ? 'border-primary font-semibold text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="접수번호, 민원인, 주소 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 rounded-lg bg-muted/50 border-transparent focus:bg-background focus:border-border text-xs"
              />
            </div>
          </div>

          <div className="px-3 pb-2">
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFilterState(null)}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-normal transition-colors',
                  filterState === null
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                전체
              </button>
              {COMPLAINT_STATE_OPTIONS.map((state) => {
                const style = getStateStyle(state);
                const isActive = filterState === state;
                return (
                  <button
                    key={state}
                    type="button"
                    onClick={() => setFilterState(isActive ? null : state)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-normal transition-colors',
                      isActive
                        ? `${style.bg} ${style.text} ${style.border}`
                        : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    {state}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex flex-col gap-2 py-3 pl-3 pr-0">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 pr-3 text-muted-foreground/80">
                <Search className="h-10 w-10 mb-3 opacity-25" />
                <p className="text-sm font-medium text-foreground/70">검색 결과가 없습니다</p>
                <p className="text-xs mt-1">다른 검색어를 입력해보세요</p>
              </div>
            )}
            {filtered.map((comp) => {
              const latestState = comp.latestState ?? '접수';
              const stateStyle = getStateStyle(latestState);
              const isSelected = selectedKey === comp.compKey;
              const category = useCategoryUi ? resolveComplaintCategory(comp) : null;

              return (
                <button
                  key={comp.compKey}
                  type="button"
                  onClick={() => handleSelect(comp)}
                  className={cn(
                    'w-full text-left rounded-lg border px-3 py-2 transition-colors',
                    isSelected
                      ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15'
                      : 'border-border/80 bg-card hover:border-border hover:bg-muted/20'
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/90">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border shrink-0',
                            stateStyle.bg,
                            stateStyle.text,
                            stateStyle.border
                          )}
                        >
                          {stateStyle.icon}
                          {latestState}
                        </span>
                        {category ? (
                          <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            #{category}
                          </span>
                        ) : null}
                        <span className="text-[11px] font-mono shrink-0">#{comp.compKey}</span>
                        <span className="inline-flex items-center gap-1 shrink-0 text-[11px]">
                          <User className="h-3 w-3" />
                          <span className="truncate max-w-[4rem]">{comp.compName || '-'}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 shrink-0 text-[11px]">
                          <Calendar className="h-3 w-3" />
                          {comp.compDate ? comp.compDate.slice(0, 10) : '-'}
                        </span>
                      </div>
                      <ChevronRight
                        className={cn('h-4 w-4 shrink-0 transition-colors', isSelected ? 'text-primary/80' : 'text-muted-foreground/40')}
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] leading-snug">
                      <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/90" />
                      <span className="shrink-0 text-muted-foreground/90">
                        {comp.compAdr || '-'}
                      </span>
                      <span className="shrink-0 text-muted-foreground/35" aria-hidden>
                        ·
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground/90">
                        {comp.compContent || '-'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
