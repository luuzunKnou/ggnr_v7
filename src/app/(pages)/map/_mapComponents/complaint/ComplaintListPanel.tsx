'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { call } from '@/lib/api';
import {
  complaintCategoryFromTableName,
  complaintCategoryTabsForSystem,
  complaintMapLayerIdsForTables,
  complaintTablesInSystemScope,
  defaultComplaintTableForCategory,
  parseComplaintCatTags,
  type ComplaintCategoryLabel,
  waterComplaintSystemScope,
} from '@/lib/waterComplaintCategory';
import type { WaterComplaintListRow } from '@/service/waterAdminComplaintService';
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
  RefreshCw,
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
import {
  focusFromIdentifyGeom,
  type WaterPlaceFocus,
} from '../../_mapContents/waterAdminMemoComplaint/waterComplaintMapFly';
import { ListPaginationBar } from '../ListPaginationBar';

function lowerLayerIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.toLowerCase());
}

/** d = 300000 * 0.54^z — 재난대응시설·일반 식별과 동일 */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

function pickCompKey(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const n = Number(row.comp_key ?? row.compKey ?? row.COMP_KEY);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const PAGE_SIZE = 50;

export type ComplaintCategorySelection = { tableName: string; compKey: number } | null;

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
  commonUi = false,
  refreshKey = 0,
  onRequestAdd,
  onRequestAddCategory,
  onSelectCategoryRow,
  categorySelected = null,
  onClose,
}: {
  /** 상하수도 통합 민원관리(구 통합UI) — 대장 통합 목록 */
  commonUi?: boolean;
  refreshKey?: number;
  onRequestAdd?: () => void;
  onRequestAddCategory?: (tableName: string) => void;
  onSelectCategoryRow?: (
    tableName: string,
    compKey: number | null,
    fly: boolean,
    focus?: WaterPlaceFocus | null
  ) => void;
  categorySelected?: ComplaintCategorySelection;
  onClose?: () => void;
}) {
  const searchParams = useSearchParams();
  const systemKey = searchParams.get('system') ?? '';
  const systemScope = waterComplaintSystemScope(systemKey);
  const categoryTabOptions = useMemo(
    () => complaintCategoryTabsForSystem(systemScope),
    [systemScope]
  );
  const mapContext = useMapContext();
  const canWrite = useSerWriteAccess();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const setComplaintDetail = mapContext?.setComplaintDetail;
  const complaintDetail = mapContext?.complaintDetail ?? null;

  const [complaints, setComplaints] = useState<CompUI[]>([]);
  const [waterRows, setWaterRows] = useState<WaterComplaintListRow[]>([]);
  const [scopedTableNames, setScopedTableNames] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** 통합검색 서버 전달용 (입력 debounce) */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterState, setFilterState] = useState<string | null>(null);
  /** 통합UI 민원분류 칩 (null=전체). 클라이언트 필터 */
  const [commonCategoryFilter, setCommonCategoryFilter] = useState<
    Exclude<ComplaintCategoryLabel, '전체'> | null
  >(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const queryTablesRef = useRef<string[]>([]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);

  const commonCategoryOptions = useMemo(
    () => categoryTabOptions.filter((c): c is Exclude<ComplaintCategoryLabel, '전체'> => c !== '전체'),
    [categoryTabOptions]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  /** 통합UI — 시스템별 대장(상수·급수 / 하수·준설) 통합 목록 */
  const useCommonListUi = commonUi;
  const useLedgerList = useCommonListUi;

  const activeQueryTables = useMemo(() => scopedTableNames, [scopedTableNames]);

  useEffect(() => {
    setPage(1);
    setCommonCategoryFilter(null);
    setDateFrom('');
    setDateTo('');
  }, [systemScope, useLedgerList]);

  /** 패널 진입 시 민원관리 레이어 켜고 전체 extent로 지도 이동 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    const layerIds = lowerLayerIds(
      useLedgerList ? complaintMapLayerIdsForTables(activeQueryTables) : COMP_WMS_LAYER_IDS
    );
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
    const extentCall = useLedgerList
      ? call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'getCombinedLayerExtent3857',
          params: { tableNames: activeQueryTables },
        })
      : call('', 'POST', {
          service: 'complaintService',
          action: 'getLayerExtent3857',
          params: {},
        });
    void extentCall
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
  }, [useLedgerList, activeQueryTables.join(',')]);

  const loadList = useCallback(async () => {
    setLoading(true);
    const offset = Math.max(0, (page - 1) * PAGE_SIZE);
    try {
      if (useLedgerList) {
        const tablesRes = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'listAvailableComplaintTables',
          params: {},
        });
        const tablesData = tablesRes?.data ?? tablesRes;
        const allNames = (Array.isArray(tablesData?.tables) ? tablesData.tables : [])
          .map((row: { tableName?: string }) => String(row?.tableName ?? '').trim())
          .filter(Boolean);
        const scoped = complaintTablesInSystemScope(allNames, systemScope);
        setScopedTableNames(scoped);
        queryTablesRef.current = scoped;
        const res = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'listCombined',
          params: {
            tableNames: scoped,
            limit: PAGE_SIZE,
            offset,
            state: filterState,
            q: debouncedSearch || null,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
          },
        });
        const serverRows = (
          res?.success && res?.data ? (res.data.rows ?? []) : []
        ) as WaterComplaintListRow[];
        const nextTotal = res?.success && res?.data ? Number(res.data.total ?? 0) : 0;
        setWaterRows(serverRows);
        setTotal(nextTotal);
        setComplaints([]);
        const maxPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE) || 1);
        if (page > maxPage) setPage(maxPage);
      } else {
        const res = await call('', 'POST', {
          service: 'complaintService',
          action: 'list',
          params: { limit: PAGE_SIZE, offset, state: filterState },
        });
        if (res?.success && res?.data) {
          const rows = (res.data.rows ?? []) as (CompUI & { latestState?: string | null })[];
          setComplaints(rows);
          const nextTotal = Number(res.data.total ?? 0);
          setTotal(nextTotal);
          const maxPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE) || 1);
          if (page > maxPage) setPage(maxPage);
        } else {
          setComplaints([]);
          setTotal(0);
        }
        setWaterRows([]);
        setScopedTableNames([]);
        queryTablesRef.current = [];
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === 'object'
            ? JSON.stringify(e)
            : String(e);
      console.error(`민원 목록 조회 실패: ${msg}`);
      setComplaints([]);
      setWaterRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [useLedgerList, systemScope, page, filterState, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  /** 지도에서 고른 행이 있는 페이지로 이동 */
  const jumpToCategoryRowPage = useCallback(
    async (tableName: string, compKey: number, tables: string[]) => {
      if (tables.length === 0) return;
      try {
        const res = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'findCombinedRank',
          params: {
            tableNames: tables,
            tableName,
            compKey,
            state: filterState,
            q: debouncedSearch || null,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
          },
        });
        const data = res?.data ?? res;
        const index = Number(data?.index ?? -1);
        if (!Number.isInteger(index) || index < 0) return;
        const nextPage = Math.floor(index / PAGE_SIZE) + 1;
        setPage((prev) => (prev === nextPage ? prev : nextPage));
      } catch {
        /* ignore */
      }
    },
    [filterState, debouncedSearch, dateFrom, dateTo]
  );

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

  const handleSelectComp = useCallback(
    async (comp: CompUI) => {
      if (complaintDetail?.compKey === comp.compKey) {
        setComplaintDetail?.(null);
        return;
      }
      await openDetailByCompKey(comp.compKey, { flyToMap: true });
    },
    [openDetailByCompKey, complaintDetail?.compKey, setComplaintDetail]
  );

  const handleSelectWaterRow = useCallback(
    (row: WaterComplaintListRow) => {
      if (
        categorySelected?.tableName === row.tableName &&
        categorySelected.compKey === row.compKey
      ) {
        onSelectCategoryRow?.(row.tableName, null, false);
        return;
      }
      onSelectCategoryRow?.(row.tableName, row.compKey, true);
    },
    [categorySelected, onSelectCategoryRow]
  );

  const onSelectCategoryRef = useRef(onSelectCategoryRow);
  onSelectCategoryRef.current = onSelectCategoryRow;
  const activeQueryTablesRef = useRef(activeQueryTables);
  activeQueryTablesRef.current = activeQueryTables;
  const scopedTableNamesRef = useRef(scopedTableNames);
  scopedTableNamesRef.current = scopedTableNames;
  useComplaintMapClick({
    enabled: !useLedgerList,
    onSelectCompKey: (compKey) => openDetailByCompKey(compKey, { flyToMap: false }),
  });

  /** 통합UI: 켜진 민원 대장 레이어 클릭 → 해당 상세 */
  useEffect(() => {
    if (!useLedgerList) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapContext?.mapReady || !map) return;

    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (mapContext?.spatialDrawRequest) return;
      if (mapContext?.mapMeasureTool) return;
      if (mapContext?.mapDrawInputSuspended) return;
      if (mapContext?.layerRowGeomEdit) return;

      const tables = activeQueryTablesRef.current;
      if (tables.length === 0) return;
      const identifyTables = complaintMapLayerIdsForTables(tables);
      const zoom = evt.map.getView().getZoom() ?? 10;
      const [x, y] = evt.coordinate as [number, number];

      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: {
            x,
            y,
            buffer: zoomToBuffer(zoom),
            tables: identifyTables,
            schema: 'layer',
          },
        });
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results[0] as
          | { tableName?: string; features?: { data?: Record<string, unknown> }[] }
          | undefined;
        const table = String(first?.tableName ?? '').trim().toLowerCase();
        const raw = first?.features?.[0]?.data;
        if (!table || !raw) return;

        if (table === 'complaint_dre_detail') {
          const parent = Number(raw.dre_key ?? raw.dreKey ?? raw.DRE_KEY);
          if (!Number.isInteger(parent) || parent < 1) return;
          const dreTable =
            scopedTableNamesRef.current.find(
              (name) => complaintCategoryFromTableName(name) === '준설'
            ) ?? 'complaint_dre';
          const detailKey = Number(
            raw.dre_detail_key ?? raw.dreDetailKey ?? raw.DRE_DETAIL_KEY
          );
          const geomKey = Object.keys(raw).find((name) => name.toLowerCase() === 'geom');
          const place = focusFromIdentifyGeom(geomKey ? raw[geomKey] : null);
          onSelectCategoryRef.current?.(
            dreTable,
            parent,
            false,
            place && Number.isInteger(detailKey) && detailKey > 0
              ? { detailKey, ...place }
              : null
          );
          return;
        }

        if (!tables.includes(table)) return;
        const key = pickCompKey(raw);
        if (key == null) return;
        onSelectCategoryRef.current?.(table, key, false);
      } catch {
        /* 클릭 식별 실패는 무시 */
      }
    };

    const key = map.on('singleclick', handleClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [
    useLedgerList,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
    mapContext?.spatialDrawRequest,
    mapContext?.mapMeasureTool,
    mapContext?.mapDrawInputSuspended,
    mapContext?.layerRowGeomEdit,
  ]);

  useComplaintMapHighlight(
    Boolean(mapContext?.mapReady) && !useLedgerList,
    complaintDetail?.geomGeoJson4326 ?? null,
    complaintDetail?.compKey ?? null
  );

  const selectedCompKey = complaintDetail?.compKey ?? null;
  const listItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const focusListKeyRef = useRef<string | null>(null);

  const lastJumpedSelectionRef = useRef<string | null>(null);

  /** 지도 선택 시 해당 건이 있는 페이지로 한 번 이동 */
  useEffect(() => {
    if (!useLedgerList || !categorySelected) {
      lastJumpedSelectionRef.current = null;
      return;
    }
    const selectionKey = `${categorySelected.tableName}::${categorySelected.compKey}`;
    if (lastJumpedSelectionRef.current === selectionKey) return;
    if (scopedTableNames.length === 0) return;
    lastJumpedSelectionRef.current = selectionKey;
    setSearchQuery('');
    setFilterState(null);
    setCommonCategoryFilter(null);
    void jumpToCategoryRowPage(
      categorySelected.tableName,
      categorySelected.compKey,
      scopedTableNames
    );
  }, [
    useLedgerList,
    categorySelected?.tableName,
    categorySelected?.compKey,
    scopedTableNames,
    jumpToCategoryRowPage,
  ]);

  /** 선택이 바뀌면 목록 행으로 스크롤 */
  useEffect(() => {
    const focusKey = useLedgerList
      ? categorySelected
        ? `${categorySelected.tableName}::${categorySelected.compKey}`
        : null
      : selectedCompKey != null
        ? String(selectedCompKey)
        : null;

    if (!focusKey) {
      focusListKeyRef.current = null;
      return;
    }
    focusListKeyRef.current = focusKey;

    let tries = 0;
    let timer: number | undefined;
    const scroll = () => {
      const el = listItemRefs.current.get(focusKey);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (tries++ < 12) {
        timer = window.setTimeout(scroll, 50);
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(scroll));
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [
    useLedgerList,
    categorySelected?.tableName,
    categorySelected?.compKey,
    selectedCompKey,
    waterRows,
    complaints,
    page,
  ]);

  const filteredComp = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qTag = q.startsWith('#') ? q.slice(1) : '';
    return complaints.filter((c) => {
      if (useCommonListUi) {
        const day = c.compDate ? c.compDate.slice(0, 10) : '';
        if (dateFrom && day && day < dateFrom) return false;
        if (dateTo && day && day > dateTo) return false;
      }
      if (!q) return true;
      if (qTag) {
        const hay = [
          String(c.compKey),
          c.compName ?? '',
          c.compAdr ?? '',
          c.compContent ?? '',
          c.latestState ?? '',
        ].map((s) => s.toLowerCase());
        return hay.some((h) => h.includes(qTag));
      }
      return (
        c.compName?.toLowerCase().includes(q) ||
        c.compAdr?.toLowerCase().includes(q) ||
        c.compContent?.toLowerCase().includes(q) ||
        String(c.compKey).includes(q)
      );
    });
  }, [complaints, searchQuery, useCommonListUi, dateFrom, dateTo]);

  /** 통합검색·접수일(작성일)은 서버. 여기선 민원분류만 클라이언트 필터 */
  const filteredWater = useMemo(() => {
    return waterRows.filter((c) => {
      if (!useCommonListUi || !commonCategoryFilter) return true;
      return complaintCategoryFromTableName(c.tableName) === commonCategoryFilter;
    });
  }, [waterRows, useCommonListUi, commonCategoryFilter]);

  const filtered = useLedgerList ? filteredWater : filteredComp;

  const hasListRows = useLedgerList ? waterRows.length > 0 : complaints.length > 0;
  if (loading && !hasListRows) {
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
                  전체{' '}
                  <span className="font-medium text-foreground/80">{total}</span>건
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {canWrite ? (
                <Button
                  size="sm"
                  className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary rounded-lg"
                  onClick={() => {
                    if (useLedgerList) {
                      const table = defaultComplaintTableForCategory(scopedTableNames, '전체');
                      if (table) onRequestAddCategory?.(table);
                      return;
                    }
                    onRequestAdd?.();
                  }}
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

          {useCommonListUi ? (
            <div className="space-y-2 px-3 pb-2">
              <div className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="통합 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 rounded-lg border-transparent bg-muted/50 pl-8 pr-2 text-xs focus:border-border focus:bg-background"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setDebouncedSearch('');
                    setDateFrom('');
                    setDateTo('');
                    setCommonCategoryFilter(null);
                    setFilterState(null);
                    setPage(1);
                  }}
                  className="standard-detail-action-btn inline-flex h-8 shrink-0 cursor-pointer items-center gap-0.5 px-1.5 text-[11px]"
                  title="검색·접수일·필터 초기화"
                >
                  <RefreshCw className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                  초기화
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-muted-foreground">접수일</span>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-lg border-border/80 bg-muted/30 px-2 text-[11px]"
                  title="시작일"
                />
                <span className="shrink-0 text-[10px] text-muted-foreground">~</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-lg border-border/80 bg-muted/30 px-2 text-[11px]"
                  title="종료일"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCommonCategoryFilter(null);
                    setPage(1);
                  }}
                  className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-normal transition-colors',
                    commonCategoryFilter === null
                      ? 'border-primary/35 bg-primary/10 font-medium text-primary'
                      : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  전체
                </button>
                {commonCategoryOptions.map((cat) => {
                  const isActive = commonCategoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setCommonCategoryFilter(isActive ? null : cat);
                        setPage(1);
                      }}
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-normal transition-colors',
                        isActive
                          ? 'border-primary/35 bg-primary/10 font-medium text-primary'
                          : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80'
                      )}
                    >
                      #{cat}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFilterState(null);
                    setPage(1);
                  }}
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
                      onClick={() => {
                        setFilterState(isActive ? null : state);
                        setPage(1);
                      }}
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
          ) : (
            <>
              <div className="px-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="접수번호, 민원인, 주소 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 rounded-lg border-transparent bg-muted/50 pl-8 text-xs focus:border-border focus:bg-background"
                  />
                </div>
              </div>
              <div className="px-3 pb-2">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterState(null);
                      setPage(1);
                    }}
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
                        onClick={() => {
                          setFilterState(isActive ? null : state);
                          setPage(1);
                        }}
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
            </>
          )}
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
              const waterRow = useLedgerList ? (comp as WaterComplaintListRow) : null;
              const isSelected = useLedgerList
                ? categorySelected?.tableName === waterRow?.tableName &&
                  categorySelected?.compKey === waterRow?.compKey
                : selectedCompKey === comp.compKey;
              const category = waterRow
                ? complaintCategoryFromTableName(waterRow.tableName)
                : null;
              const rowKey = waterRow
                ? `${waterRow.tableName}::${waterRow.compKey}`
                : String(comp.compKey);
              const onSelectRow = () =>
                useLedgerList && waterRow
                  ? handleSelectWaterRow(waterRow)
                  : handleSelectComp(comp);

              if (useCommonListUi) {
                const catTags = parseComplaintCatTags(
                  waterRow ? waterRow.compCat : null
                );
                return (
                  <button
                    key={rowKey}
                    type="button"
                    ref={(el) => {
                      if (el) listItemRefs.current.set(rowKey, el);
                      else listItemRefs.current.delete(rowKey);
                    }}
                    onClick={onSelectRow}
                    className={cn(
                      'w-full text-left rounded-[10px] border px-3 py-2.5 transition-colors',
                      isSelected
                        ? 'border-primary/45 bg-primary/[0.03] shadow-[0_0_0_2px_rgba(37,99,235,0.12)]'
                        : 'border-border bg-card hover:border-primary/35 hover:bg-primary/[0.03]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground/90">
                        {comp.compName || '-'}
                      </span>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                          stateStyle.bg,
                          stateStyle.text,
                          stateStyle.border
                        )}
                      >
                        {stateStyle.icon}
                        {latestState}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{comp.compAdr || '-'}</span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Calendar className="h-3 w-3 shrink-0" />
                        <span className="shrink-0">
                          {comp.compDate ? comp.compDate.slice(0, 10) : '-'}
                        </span>
                        <span className="text-muted-foreground/40" aria-hidden>
                          ·
                        </span>
                        <span className="min-w-0 truncate text-foreground/85">
                          {comp.compContent || '-'}
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {category ? (
                        <span className="inline-flex items-center rounded border border-primary/20 bg-primary/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          #{category}
                        </span>
                      ) : null}
                      {catTags.map((tag) => (
                        <span
                          key={`cat-${tag}`}
                          className="inline-flex items-center rounded border border-border bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700"
                        >
                          #{tag}
                        </span>
                      ))}
                      {waterRow?.compStat ? (
                        <span className="inline-flex items-center rounded border border-border bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">
                          #{waterRow.compStat}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center rounded border border-border bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">
                        #{comp.compKey}
                      </span>
                    </div>
                  </button>
                );
              }

              return (
                <button
                  key={rowKey}
                  type="button"
                  ref={(el) => {
                    if (el) listItemRefs.current.set(rowKey, el);
                    else listItemRefs.current.delete(rowKey);
                  }}
                  onClick={onSelectRow}
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

        {total > 0 ? (
          <ListPaginationBar
            page={page}
            pageCount={pageCount}
            loading={loading}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </div>
  );
}
