'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Search, X, ChevronDown, LayoutGrid, Check, Loader2, History, EyeOff } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MapLayergroupBar } from './map-layergroup-bar';
import {
  getAddressFromCoord,
  searchAddress,
  searchPlace,
  type VWorldAddressItem,
} from './addressSearch/vworldAddressSearch';
import { useMapContext } from './MapContext';
import { transform } from 'ol/proj';
import { canAccessPrivateSystem } from '@/lib/accessClient';
import { useMyAccessSnapshot } from '@/hooks/useMyAccessSnapshot';
import { useConsoleMenuAccess } from '@/hooks/useConsoleMenuAccess';
import { hasAnyDevConsoleAccess } from '@/lib/consoleMenuAccess/client';
import { ResourceAccessDeniedDialog } from '@/app/(pages)/_components/AccessRequest';
import { ThemeToggle } from '@/app/(pages)/(index)/theme-toggle';
import { scrubOccupationLedgerFromMapSearchParams } from '@/lib/occupationLedgerBinding';
import { scrubUseFeeFromMapSearchParams } from '@/lib/useFeeBinding';
import { MapAdminToolsMenu } from './mapAdminTools/MapAdminToolsMenu';

/** 검색바 아이콘 버튼 — 우측 메뉴와 동일: 바깥=패널 배경, 안=투명+hover만 */
const mapSearchBarIconShell = cn(
  'shrink-0 opacity-90 rounded-[5px] backdrop-blur-sm shadow-lg border overflow-hidden',
  'bg-white/95 border-slate-200',
  'dark:bg-black/95 dark:border-white/10'
);

const mapSearchBarIconBtnInner = cn(
  'box-border flex items-center justify-center w-[30px] h-[30px] p-0 cursor-pointer transition-colors',
  'text-slate-600 dark:text-white/90',
  'hover:bg-slate-100 hover:text-primary',
  'dark:hover:bg-white/10 dark:hover:text-primary'
);

const mapSearchBarIconBtnActive = cn(
  'bg-slate-100 text-primary',
  'dark:bg-white/20 dark:text-primary'
);

/** 검색바 공통 표면 — 시스템 선택 등 넓은 컨트롤 */
const mapSearchBarSurface = cn(
  'opacity-90 rounded-[5px] backdrop-blur-sm shadow-lg border transition-colors',
  'bg-white/95 border-slate-200',
  'dark:bg-black/95 dark:border-white/10'
);

const mapSearchBarSurfaceHover = cn(
  'hover:bg-slate-100 hover:text-primary',
  'dark:hover:bg-white/10 dark:hover:text-primary'
);

/** 시스템 선택 트리거 */
const mapSearchBarSystemSelectBtn = cn(
  'shrink-0 flex items-center gap-2.5 h-[30px] w-[230px] cursor-pointer pl-3 pr-3 text-left',
  mapSearchBarSurface,
  mapSearchBarSurfaceHover
);

type SystemOption = {
  sys_key: string;
  sys_kor: string;
  sys_eng?: string;
  sys_detail?: string;
  sys_idx?: number;
  sys_col?: string;
  serviceList?: string[];
  sys_is_private?: boolean | null;
};

const SIDEBAR_WIDTH = 65;
const SEARCH_BAR_MARGIN = 20;
/** 지도가 넓을 때 주소검색 칸 최대 너비 */
const ADDRESS_SEARCH_WIDTH_MAX_PX = 260;
/** 왼쪽 패널이 넓어져 지도가 좁아져도 칸이 남을 최소 너비 */
const ADDRESS_SEARCH_WIDTH_MIN_PX = 120;
/** 우측 시스템선택·아이콘·여백 */
const SEARCH_BAR_RIGHT_RESERVE_PX = 380;
const SEARCH_BAR_EYE_BTN_PX = 38;

/**
 * 상단 왼쪽 검색창 (지도 위 오버레이)
 * - listPanelWidth: 열린 MapSideListPanel 너비 합 → 겹치지 않게 left 계산 (Layout에서 계산해 전달)
 * - URL query param `q`에 검색어를 동기화(간단 동작)
 */
const ADDRESS_DEBOUNCE_MS = 300;
const ADDRESS_RESULT_MAX = 5;
const RECENT_QUERIES_KEY = 'map-address-recent';
const RECENT_QUERIES_MAX = 10;

function loadRecentQueries(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_QUERIES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, RECENT_QUERIES_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecentQueries(queries: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(queries.slice(0, RECENT_QUERIES_MAX)));
  } catch {
    // ignore
  }
}

const addressSearchResultRowClass = cn(
  'w-full cursor-pointer text-left px-4 py-1.5 transition-colors min-h-[44px] flex flex-col justify-center gap-0.5',
  'border-b border-slate-100 last:border-b-0 hover:bg-slate-50',
  'dark:border-white/10 dark:hover:bg-white/10'
);

function MapAddressSearchResultRow({
  item,
  variant,
  onSelect,
}: {
  item: VWorldAddressItem;
  variant: 'address' | 'place';
  onSelect: (item: VWorldAddressItem) => void;
}) {
  const title = (item.title ?? '').trim();
  const label = title || item.address;

  return (
    <button
      type="button"
      title={label}
      onClick={() => onSelect(item)}
      className={addressSearchResultRowClass}
    >
      {variant === 'place' && title ? (
        <div className="flex min-h-[1.25rem] items-center gap-2">
          <span className="w-12 shrink-0 rounded bg-emerald-100 py-0.5 text-center text-[10px] font-semibold text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-200">
            장소
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800 dark:text-white/90">{title}</span>
        </div>
      ) : null}
      {item.roadAddress ? (
        <div className="flex min-h-[1.25rem] items-center gap-2">
          <span className="w-12 shrink-0 rounded bg-blue-100 py-0.5 text-center text-[10px] font-semibold text-blue-700 dark:bg-blue-500/25 dark:text-blue-300">
            도로명
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800 dark:text-white/90">
            {item.roadAddress}
            {item.buildingName ? ` (${item.buildingName})` : ''}
          </span>
        </div>
      ) : null}
      {item.jibunAddress ? (
        <div className="flex min-h-[1.25rem] items-center gap-2">
          <span className="w-12 shrink-0 rounded bg-amber-100 py-0.5 text-center text-[10px] font-semibold text-amber-800 dark:bg-amber-500/25 dark:text-amber-200">
            지번
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800 dark:text-white/90">
            {item.jibunAddress}
          </span>
        </div>
      ) : null}
      {!item.roadAddress && !item.jibunAddress && !(variant === 'place' && title) ? (
        <span className="line-clamp-2 text-[12px] text-slate-800 dark:text-white/90">{item.address}</span>
      ) : null}
    </button>
  );
}

function MapAddressSearchResultsSection({
  title,
  items,
  variant,
  onSelect,
}: {
  title: string;
  items: VWorldAddressItem[];
  variant: 'address' | 'place';
  onSelect: (item: VWorldAddressItem) => void;
}) {
  return (
    <div>
      <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-slate-500 dark:text-white/50">{title}</p>
      {items.length > 0 ? (
        <ul className="scrollbar-thin max-h-[130px] overflow-y-auto py-0.5">
          {items.map((item, idx) => (
            <li key={item.id ?? `${variant}-${item.address}-${idx}`}>
              <MapAddressSearchResultRow item={item} variant={variant} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-3 text-center text-[12px] text-slate-500 dark:text-white/50">검색 결과가 없습니다</div>
      )}
    </div>
  );
}

function MapSearchBarIconButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={mapSearchBarIconShell}>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={active}
        onClick={onClick}
        className={cn(mapSearchBarIconBtnInner, active && mapSearchBarIconBtnActive)}
      >
        <span className="flex shrink-0 items-center justify-center leading-none">{children}</span>
      </button>
    </div>
  );
}

export function MapSearchBar({
  listPanelWidth = 0,
  onInputBottomChange,
}: {
  listPanelWidth?: number;
  /** viewport 기준 주소검색 입력란 하단(px) — 플로팅 UI 정렬용 */
  onInputBottomChange?: (bottomPx: number) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();
  const { data: session } = useSession();
  const { levels: consoleMenuLevels, loading: consoleAccessLoading } = useConsoleMenuAccess();

  const showDebugUi = mapContext?.showDebugUi ?? false;
  const canToggleGeoserverLog = useMemo(() => {
    if (String(session?.user?.id ?? '').trim() === 'su') return true;
    if (consoleAccessLoading) return false;
    return hasAnyDevConsoleAccess(consoleMenuLevels);
  }, [session?.user?.id, consoleAccessLoading, consoleMenuLevels]);

  const initialQuery = useMemo(() => searchParams.get('q') ?? '', [searchParams]);
  const [query, setQuery] = useState(initialQuery);
  const selectedSystemKey = searchParams.get('system') ?? '';

  const [systemList, setSystemList] = useState<SystemOption[]>([]);
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [deniedOpen, setDeniedOpen] = useState(false);
  const [deniedSysKey, setDeniedSysKey] = useState('');
  const { snapshot } = useMyAccessSnapshot();

  const [addressSearchResults, setAddressSearchResults] = useState<VWorldAddressItem[]>([]);
  const [placeSearchResults, setPlaceSearchResults] = useState<VWorldAddressItem[]>([]);
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const [addressPanelOpen, setAddressPanelOpen] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => loadRecentQueries());
  const [centerPlaceholder, setCenterPlaceholder] = useState('주소/지번/장소 검색');
  const [viewportWidth, setViewportWidth] = useState(1280);
  const addressSearchWrapperRef = useRef<HTMLDivElement>(null);
  const centerPlaceholderReqIdRef = useRef(0);
  const vworldApiKey = mapContext?.vworldApiKey ?? '';

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const el = addressSearchWrapperRef.current;
    if (!el || !onInputBottomChange) return;
    let last = Number.NaN;
    const report = () => {
      const next = Math.round(el.getBoundingClientRect().bottom);
      if (next === last) return;
      last = next;
      onInputBottomChange(next);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [onInputBottomChange, listPanelWidth]);

  const addRecentQuery = useCallback((trimmed: string) => {
    if (!trimmed) return;
    setRecentQueries((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, RECENT_QUERIES_MAX);
      saveRecentQueries(next);
      return next;
    });
  }, []);

  const handleSelectAddress = useCallback(
    (item: VWorldAddressItem) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (map) {
        const view = map.getView();
        const center3857 = transform(
          [item.point.x, item.point.y],
          'EPSG:4326',
          'EPSG:3857'
        );
        view.setCenter(center3857);
        view.setZoom(17);
      }
      if (query.trim()) addRecentQuery(query.trim());
    },
    [mapContext, query, addRecentQuery]
  );

  const runSplitAddressSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed || !vworldApiKey) {
        setAddressSearchResults([]);
        setPlaceSearchResults([]);
        return Promise.resolve();
      }
      setAddressSearchLoading(true);
      setAddressPanelOpen(true);
      return Promise.all([
        searchAddress(trimmed, {
          maxResults: ADDRESS_RESULT_MAX,
          type: 'address',
          apiKey: vworldApiKey,
        }),
        searchPlace(trimmed, {
          maxResults: ADDRESS_RESULT_MAX,
          apiKey: vworldApiKey,
        }),
      ])
        .then(([addressItems, placeItems]) => {
          setAddressSearchResults(addressItems);
          setPlaceSearchResults(placeItems);
        })
        .finally(() => setAddressSearchLoading(false));
    },
    [vworldApiKey]
  );

  useEffect(() => {
    if (!query.trim()) {
      setAddressSearchResults([]);
      setPlaceSearchResults([]);
      return;
    }
    if (!vworldApiKey) return;
    const t = setTimeout(() => {
      void runSplitAddressSearch(query);
    }, ADDRESS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, vworldApiKey, runSplitAddressSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        addressPanelOpen &&
        addressSearchWrapperRef.current &&
        !addressSearchWrapperRef.current.contains(e.target as Node)
      ) {
        setAddressPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [addressPanelOpen]);

  const updateCenterPlaceholderFromMap = useCallback(async () => {
    const map = mapContext?.mapInstanceRef?.current;
    const apiKey = vworldApiKey.trim();
    if (!map || !apiKey) return;
    const center = map.getView().getCenter();
    if (!center) return;
    const [lon, lat] = transform(center, 'EPSG:3857', 'EPSG:4326');
    if (![lon, lat].every((v) => Number.isFinite(v))) return;
    const reqId = ++centerPlaceholderReqIdRef.current;
    try {
      const addr = await getAddressFromCoord(lon, lat, { apiKey });
      if (reqId !== centerPlaceholderReqIdRef.current) return;
      const jibun = String(addr?.jibun ?? '').trim();
      const road = String(addr?.road ?? '').trim();
      setCenterPlaceholder(jibun || road || '주소/지번/장소 검색');
    } catch {
      if (reqId !== centerPlaceholderReqIdRef.current) return;
      setCenterPlaceholder('주소/지번/장소 검색');
    }
  }, [mapContext, vworldApiKey]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !vworldApiKey.trim()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void updateCenterPlaceholderFromMap();
      }, 150);
    };
    void updateCenterPlaceholderFromMap();
    map.on('moveend', onMoveEnd);
    return () => {
      if (timer) clearTimeout(timer);
      map.un('moveend', onMoveEnd);
    };
  }, [mapContext, vworldApiKey, updateCenterPlaceholderFromMap]);

  const fetchSystemList = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const systems = Array.isArray(data?.systems) ? data.systems : [];
        const sorted = [...systems].sort(
          (a: SystemOption, b: SystemOption) => (Number(a.sys_idx) || 999) - (Number(b.sys_idx) || 999)
        );
        setSystemList(sorted);
      })
      .catch(() => setSystemList([]));
  }, []);

  useEffect(() => {
    fetchSystemList();
  }, [fetchSystemList]);

  const mustPickSystem = !selectedSystemKey && systemList.length > 0;

  useEffect(() => {
    if (mustPickSystem) setSystemModalOpen(true);
  }, [mustPickSystem]);

  const handleSystemModalOpenChange = (open: boolean) => {
    if (!open && mustPickSystem) return;
    setSystemModalOpen(open);
  };

  /** 지도 주소 검색·역지오코딩용 VWorld API 키는 서버(runtime.env)에서만 읽히므로 API로 조회 후 context에 저장 */
  const fetchMapConfig = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getMapConfig', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const key = (data?.VWORLD_API_KEY ?? '').trim();
        mapContext?.setVworldApiKey?.(key);
      })
      .catch(() => mapContext?.setVworldApiKey?.(''));
  }, [mapContext]);
  useEffect(() => {
    fetchMapConfig();
  }, [fetchMapConfig]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSystemList();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchSystemList]);

  const selectSystem = (sysKey: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (sysKey) current.set('system', sysKey);
    else current.delete('system');
    scrubOccupationLedgerFromMapSearchParams(current, sysKey);
    scrubUseFeeFromMapSearchParams(current, sysKey);
    router.push(`/map?${current.toString()}`);
    setSystemModalOpen(false);
  };

  const trySelectSystem = (sys: SystemOption) => {
    if (!canAccessPrivateSystem(snapshot, sys.sys_key, sys.sys_is_private)) {
      setDeniedSysKey(sys.sys_key);
      setDeniedOpen(true);
      return;
    }
    selectSystem(sys.sys_key);
  };

  const submit = (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    router.push(`/map?${params.toString()}`);
  };

  /** 검색 버튼 클릭 시 VWorld 주소·장소 검색 실행 */
  const runAddressSearch = useCallback(() => {
    void runSplitAddressSearch(query);
  }, [query, runSplitAddressSearch]);

  const leftOffset = SIDEBAR_WIDTH + listPanelWidth + SEARCH_BAR_MARGIN;
  const availableSearchWidthPx =
    viewportWidth - leftOffset - SEARCH_BAR_EYE_BTN_PX - SEARCH_BAR_RIGHT_RESERVE_PX;
  const addressSearchWidthPx = Math.min(
    ADDRESS_SEARCH_WIDTH_MAX_PX,
    Math.max(ADDRESS_SEARCH_WIDTH_MIN_PX, availableSearchWidthPx)
  );

  return (
    <>
      {/* 좌측: 주소검색 — 목록 패널에 따라 left만 이동 */}
      <div
        className="pointer-events-none fixed top-4 z-40 transition-[left] duration-200"
        style={{ left: `${leftOffset}px` }}
      >
        <div className="pointer-events-auto flex items-start gap-2 shrink-0">
        <div ref={addressSearchWrapperRef} className="relative shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(query);
              runAddressSearch();
            }}
            className={cn(
              'flex items-center gap-2 rounded-[5px] px-1 py-1 transition-[width] duration-200',
              mapSearchBarSurface
            )}
            style={{ width: addressSearchWidthPx }}
          >
            <button
              type="submit"
              className={cn(
                'inline-flex items-center justify-center w-[20px] h-[20px] rounded-[5px] -mr-1 min-h-[20px] cursor-pointer',
                'text-slate-600 hover:bg-slate-100',
                'dark:text-white/90 dark:hover:bg-white/10'
              )}
              aria-label="검색"
              title="검색"
            >
              <Search className="w-4 h-4 shrink-0" />
            </button>

            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setAddressPanelOpen(true)}
              placeholder={centerPlaceholder}
              className={cn(
                'h-[20px] min-h-[20px] min-w-0 flex-1 text-[12px] border-0 bg-transparent shadow-none',
                'text-foreground placeholder:text-muted-foreground',
                'focus-visible:ring-0 focus-visible:border-0 dark:bg-transparent'
              )}
            />

            {query.trim().length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  submit('');
                  setAddressSearchResults([]);
                  setPlaceSearchResults([]);
                  setAddressPanelOpen(false);
                }}
                className={cn(
                  'inline-flex items-center justify-center w-[20px] h-[20px] rounded-md cursor-pointer',
                  'text-slate-500 hover:bg-slate-100',
                  'dark:text-white/60 dark:hover:bg-white/10'
                )}
                aria-label="검색어 지우기"
                title="지우기"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>

          {/* 주소검색 결과 패널 + 최근 검색어 */}
          {addressPanelOpen && (
            <div
              className={cn(
                'absolute top-full left-0 mt-1 rounded-[5px] opacity-90 shadow-lg overflow-hidden z-50 border transition-[width] duration-200',
                'bg-white border-slate-200',
                'dark:bg-black/80 dark:border-white/10 dark:backdrop-blur-sm'
              )}
              style={{ width: addressSearchWidthPx }}
            >
              {addressSearchLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-slate-500 dark:text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  검색 중...
                </div>
              ) : query.trim() ? (
                <>
                  <MapAddressSearchResultsSection
                    title="주소 검색"
                    items={addressSearchResults}
                    variant="address"
                    onSelect={handleSelectAddress}
                  />
                  <div className="border-t border-slate-100 dark:border-white/10" />
                  <MapAddressSearchResultsSection
                    title="장소 검색"
                    items={placeSearchResults}
                    variant="place"
                    onSelect={handleSelectAddress}
                  />
                </>
              ) : recentQueries.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-slate-400">
                  주소, 지번 또는 장소를 입력하세요
                </div>
              ) : null}

              {recentQueries.length > 0 && (
                <>
                  {(addressSearchLoading || Boolean(query.trim())) && (
                    <div className="border-t border-slate-100 dark:border-white/10" />
                  )}
                  <div className="px-3 py-2">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-slate-500 dark:text-white/50">
                      <History className="h-3.5 w-3.5" />
                      최근 검색어
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {recentQueries.map((q) => (
                        <li key={q}>
                          <button
                            type="button"
                            title={q}
                            onClick={() => {
                              setQuery(q);
                              void runSplitAddressSearch(q);
                            }}
                            className={cn(
                              'cursor-pointer rounded-[5px] px-2.5 py-1.5 text-[12px] transition-colors',
                              'bg-slate-100 text-slate-700 hover:bg-slate-200',
                              'dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/15'
                            )}
                          >
                            {q}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <MapSearchBarIconButton
          title="전체 레이어 끄기 (지적도·건물도로·기초구간 포함)"
          onClick={() => mapContext?.allLayersOffRef?.current?.()}
        >
          <EyeOff className="w-5 h-5" strokeWidth={2} />
        </MapSearchBarIconButton>
        </div>
      </div>

      {/* 우측: 테마·로그·시스템 선택 — viewport right 고정 (좌측 패널과 무관) */}
      <div className="pointer-events-none fixed top-4 right-4 z-40">
        <div className="pointer-events-auto shrink-0 flex items-center gap-2">
          {canToggleGeoserverLog && (
            <MapAdminToolsMenu
              logOn={showDebugUi}
              onToggleLog={() => mapContext?.setShowDebugUi(!showDebugUi)}
            />
          )}
          <div className={mapSearchBarIconShell}>
            <ThemeToggle variant="mapIcon" iconBtnClassName={mapSearchBarIconBtnInner} />
          </div>
        {/* 시스템 선택: 오른쪽 끝 고정, 셀렉트박스 스타일, 클릭 시 모달 */}
        {systemList.length > 0 && (() => {
          const selectedSystem = systemList.find((s) => s.sys_key === selectedSystemKey);
          const systemColor = selectedSystem?.sys_col || 'var(--primary)';
          return (
            <>
              <button
                type="button"
                onClick={() => setSystemModalOpen(true)}
                className={mapSearchBarSystemSelectBtn}
                aria-label="시스템 선택"
                title="시스템 선택"
              >
                <div
                  className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
                  style={{ backgroundColor: `${systemColor}18`, color: systemColor }}
                >
                  <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden />
                </div>
                <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-slate-700 dark:text-white/90">
                  {selectedSystem?.sys_kor ?? (selectedSystemKey || '시스템 선택')}
                </span>
                <ChevronDown className="w-4 h-4 shrink-0 text-slate-400 dark:text-white/50" aria-hidden />
              </button>

              <Dialog open={systemModalOpen} onOpenChange={handleSystemModalOpenChange}>
                <DialogContent
                  className="sm:max-w-[380px] p-0 gap-0 overflow-hidden rounded-[10px] border-slate-200/80 shadow-xl dark:border-white/10 dark:bg-black/90"
                  showCloseButton={false}
                  onPointerDownOutside={(e) => {
                    if (mustPickSystem) e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    if (mustPickSystem) e.preventDefault();
                  }}
                  onEscapeKeyDown={(e) => {
                    if (mustPickSystem) e.preventDefault();
                  }}
                >
                  <DialogHeader className="px-3 py-2 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white dark:border-white/10 dark:from-white/5 dark:to-black/90">
                    <DialogTitle className="text-sm font-semibold text-slate-800 dark:text-white/90 flex items-center gap-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded-[5px] bg-primary/10 text-primary">
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </div>
                      시스템 선택
                    </DialogTitle>
                  </DialogHeader>
                  <ul className="grid gap-2 p-4">
                    {systemList.map((sys) => {
                      const isSelected = sys.sys_key === selectedSystemKey;
                      const accentColor = sys.sys_col || 'var(--primary)';
                      return (
                        <li key={sys.sys_key}>
                          <button
                            type="button"
                            onClick={() => trySelectSystem(sys)}
                            className={cn(
                              'w-full flex items-center gap-4 rounded-xl px-4 py-3 text-left transition-all duration-200 border',
                              isSelected
                                ? 'border-transparent shadow-md ring-1 ring-primary/20'
                                : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100/80 hover:border-slate-200 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:hover:border-white/15'
                            )}
                            style={isSelected ? { backgroundColor: `${accentColor}12`, borderColor: `${accentColor}30` } : undefined}
                          >
                            <span
                              className="w-1.5 h-8 shrink-0 rounded-full"
                              style={{ backgroundColor: accentColor }}
                              aria-hidden
                            />
                            <div className="flex-1 min-w-0 text-left">
                              <span className={cn('block truncate text-sm', isSelected ? 'font-semibold text-slate-800 dark:text-white' : 'font-medium text-slate-700 dark:text-white/90')}>
                                {sys.sys_kor}
                              </span>
                              {sys.sys_detail && (
                                <span className="block text-xs text-slate-500 dark:text-white/50 mt-1 leading-relaxed">{sys.sys_detail}</span>
                              )}
                            </div>
                            {isSelected && (
                              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary shrink-0">
                                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <footer className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
                  </footer>
                </DialogContent>
              </Dialog>
              <ResourceAccessDeniedDialog
                open={deniedOpen}
                onOpenChange={setDeniedOpen}
                resource="system"
                sysKey={deniedSysKey}
              />
            </>
          );
        })()}
        </div>
      </div>
    </>
  );
}

