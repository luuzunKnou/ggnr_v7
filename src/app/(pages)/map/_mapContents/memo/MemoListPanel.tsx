"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Search,
  StickyNote,
  User,
  X,
} from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/app/shadcnComponents/ui/input";
import { Button } from "@/app/shadcnComponents/ui/button";
import { useMapContext } from "../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../_mapComponents/config/mapAutoNavigation";
import { refreshServiceWmsLayer } from "../../_mapComponents/layerFactory/serviceLayerFactory";
import { memoWmsLayerId, parseMemoRowKey } from "./memoConfig";
import { useMemoMapHighlight } from "./useMemoMapHighlight";
import { useMemoMapClick } from "./useMemoMapClick";
import { useSerWriteAccess } from "@/hooks/useSerWriteAccess";
import { ListPaginationBar } from "../../_mapComponents/ListPaginationBar";

type ListRow = {
  rowKey: string;
  tableName: string;
  tableLabel: string;
  memoKey: string;
  title: string;
  contents: string;
  createDate: string;
  createUser: string;
};

type TableOption = { tableName: string; label: string };

const PAGE_SIZE = 50;

/** 임시 UI 비교용. sessionStorage에 유지. 확정 후 제거 */
const MEMO_UI_THEME_KEY = "ggnr.memoListUiTheme";
type MemoUiTheme = "current" | "category";
const MEMO_CATEGORY_OPTIONS = ["전체", "상수", "하수", "급수", "준설"] as const;
type MemoCategory = (typeof MEMO_CATEGORY_OPTIONS)[number];

function tablesForMemoCategory(
  options: TableOption[],
  category: MemoCategory,
  useCategoryUi: boolean
): string[] {
  if (!useCategoryUi || category === "전체") {
    return options.map((t) => t.tableName);
  }
  return options
    .filter((t) => resolveMemoCategory(t.tableName, t.label) === category)
    .map((t) => t.tableName);
}

function readMemoUiTheme(): MemoUiTheme {
  if (typeof window === "undefined") return "current";
  return window.sessionStorage.getItem(MEMO_UI_THEME_KEY) === "category" ? "category" : "current";
}

function resolveMemoCategory(tableName: string, tableLabel: string): Exclude<MemoCategory, "전체"> | null {
  const name = String(tableName ?? "").toLowerCase();
  const label = String(tableLabel ?? "");
  if (name.includes("sply") || label.includes("급수")) return "급수";
  if (name.includes("dre") || label.includes("준설")) return "준설";
  if (name.includes("swl") || label.includes("하수")) return "하수";
  if (name.includes("wtl") || label.includes("상수")) return "상수";
  return null;
}

type Props = {
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string | null) => void;
  refreshKey?: number;
  onAdd?: (tableName: string) => void;
  /** 있으면 이 테이블만 조회한다 */
  fixedTables?: TableOption[];
  title?: string;
};

export function MemoListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  refreshKey = 0,
  onAdd,
  fixedTables,
  title = "메모관리",
}: Props) {
  const mapContext = useMapContext();
  const canWrite = useSerWriteAccess();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const layersAddedRef = useRef<Set<string>>(new Set());

  const [keyword, setKeyword] = useState("");
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [highlightGeom, setHighlightGeom] = useState<Record<string, unknown> | null>(null);
  const [filterCategory, setFilterCategory] = useState<MemoCategory>("전체");
  // SSR·첫 클라이언트 렌더는 동일하게 current. sessionStorage는 mount 후 반영 (hydration 방지)
  const [uiTheme, setUiTheme] = useState<MemoUiTheme>("current");
  const useCategoryUi = uiTheme === "category";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  const listItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastJumpedSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    setUiTheme(readMemoUiTheme());
  }, []);

  const toggleUiTheme = useCallback(() => {
    setUiTheme((prev) => {
      const next: MemoUiTheme = prev === "current" ? "category" : "current";
      try {
        window.sessionStorage.setItem(MEMO_UI_THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
    setFilterCategory("전체");
    setPage(1);
  }, []);

  const queryTables = useMemo(
    () => tablesForMemoCategory(tableOptions, filterCategory, useCategoryUi),
    [tableOptions, filterCategory, useCategoryUi]
  );

  useMemoMapHighlight(Boolean(mapContext?.mapReady), highlightGeom);

  const fixedTableKey = fixedTables?.map((t) => t.tableName).join(",") ?? "";

  useEffect(() => {
    const tables = fixedTables;
    if (tables && tables.length > 0) {
      setTableOptions(tables);
      return;
    }
    void call("", "POST", {
      service: "memoService",
      action: "listAvailableMemoTables",
      params: {},
    }).then((res) => {
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.tables) ? data.tables : Array.isArray(data) ? data : [];
      setTableOptions(rows as TableOption[]);
    });
    // fixedTableKey만 보면 된다. 배열 참조가 바뀌어도 같은 테이블이면 다시 받지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixedTableKey
  }, [fixedTableKey]);

  const ensureLayerVisible = useCallback((tableName: string) => {
    const lid = memoWmsLayerId(tableName);
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames) return;
    ctx.setVisibleLayerNames((prev) => {
      if (prev.has(lid)) return prev;
      return new Set(prev).add(lid);
    });
    layersAddedRef.current.add(lid);
  }, []);

  useEffect(() => {
    const tables = tableOptions.map((opt) => opt.tableName);
    for (const name of tables) ensureLayerVisible(name);
    return () => {
      const ctx = mapContextRef.current;
      if (!ctx?.setVisibleLayerNames || layersAddedRef.current.size === 0) return;
      const toRemove = new Set(layersAddedRef.current);
      ctx.setVisibleLayerNames((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const lid of toRemove) {
          if (next.delete(lid)) changed = true;
        }
        return changed ? next : prev;
      });
      layersAddedRef.current.clear();
    };
  }, [ensureLayerVisible, tableOptions]);

  const focusedIdRef = useRef<string | null>(null);
  /** 목록 클릭·저장 후: true / 지도 객체 클릭: false — 지도 이동만 제어 */
  const fitOnFocusRef = useRef(true);

  const focusMemoOnMap = useCallback(async (
    rowKey: string,
    tableName: string,
    memoKey: string,
    opts?: { fit?: boolean }
  ) => {
    focusedIdRef.current = rowKey;
    ensureLayerVisible(tableName);
    const doFit = opts?.fit !== false;
    if (doFit) setNavigatingId(rowKey);
    try {
      const res = await call("", "POST", {
        service: "memoService",
        action: "getMemoExtent3857",
        params: { table: tableName, memoKey },
      });
      const data = res?.data ?? res;
      const geom = data?.geomGeoJson4326;
      setHighlightGeom(geom && typeof geom === "object" ? (geom as Record<string, unknown>) : null);
      if (!doFit) return;
      const map = mapContextRef.current?.mapInstanceRef?.current;
      const extent = data?.extent3857;
      if (
        map &&
        Array.isArray(extent) &&
        extent.length === 4 &&
        extent.every((v: unknown) => Number.isFinite(Number(v)))
      ) {
        scheduleFitMapToExtent3857(map, extent.map(Number), {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          pointZoom: 18,
          applyMapViewPadding: () =>
            mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
        });
      }
    } catch {
      setHighlightGeom(null);
    } finally {
      if (doFit) setNavigatingId(null);
    }
  }, [ensureLayerVisible]);

  const mapClickTables = useMemo(
    () =>
      (fixedTables && fixedTables.length > 0
        ? fixedTables
        : queryTables.map((tableName) => ({
            tableName,
            label: tableOptions.find((t) => t.tableName === tableName)?.label ?? tableName,
          }))
      ).map((t) => ({ tableName: t.tableName })),
    [fixedTables, queryTables, tableOptions]
  );

  useMemoMapClick({
    enabled: true,
    tables: mapClickTables,
    onSelectRowKey: (rowKey) => {
      fitOnFocusRef.current = false;
      onSelectDetailId(rowKey);
    },
  });

  const handleRowClick = useCallback(
    (row: ListRow) => {
      // 같은 행을 한 번 더 누르면 상세를 닫는다
      if (selectedDetailId === row.rowKey) {
        focusedIdRef.current = null;
        setHighlightGeom(null);
        onSelectDetailId(null);
        return;
      }
      fitOnFocusRef.current = true;
      onSelectDetailId(row.rowKey);
      void focusMemoOnMap(row.rowKey, row.tableName, row.memoKey, { fit: true });
    },
    [focusMemoOnMap, onSelectDetailId, selectedDetailId]
  );

  useEffect(() => {
    if (!selectedDetailId) {
      focusedIdRef.current = null;
      setHighlightGeom(null);
      lastJumpedSelectionRef.current = null;
      return;
    }
    if (focusedIdRef.current === selectedDetailId) return;
    const parsed = parseMemoRowKey(selectedDetailId);
    if (!parsed) {
      setHighlightGeom(null);
      return;
    }
    const fit = fitOnFocusRef.current;
    fitOnFocusRef.current = true;
    void focusMemoOnMap(selectedDetailId, parsed.tableName, parsed.memoKey, { fit });
  }, [focusMemoOnMap, selectedDetailId]);

  const prevRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === prevRefreshKeyRef.current) return;
    prevRefreshKeyRef.current = refreshKey;
    if (!selectedDetailId) return;
    const parsed = parseMemoRowKey(selectedDetailId);
    if (!parsed) return;
    refreshServiceWmsLayer(mapContextRef.current?.mapInstanceRef?.current);
    void focusMemoOnMap(selectedDetailId, parsed.tableName, parsed.memoKey, { fit: true });
  }, [focusMemoOnMap, refreshKey, selectedDetailId]);

  useEffect(() => {
    setPage(1);
  }, [keyword, useCategoryUi]);

  useEffect(() => {
    if (tableOptions.length === 0) return;
    const tables = queryTables;
    if (tables.length === 0) {
      setItems([]);
      setTotal(0);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const offset = Math.max(0, (page - 1) * PAGE_SIZE);
      try {
        const res = await call("", "POST", {
          service: "memoService",
          action: "getMemoList",
          params: {
            keyword,
            limit: PAGE_SIZE,
            offset,
            tables,
          },
        });
        const data = res?.data ?? res;
        if (data?.error) setError(String(data.error));
        const rows = Array.isArray(data?.rows) ? (data.rows as ListRow[]) : [];
        const nextTotal = Number(data?.total ?? 0);
        setItems(rows);
        setTotal(nextTotal);
        const maxPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE) || 1);
        if (page > maxPage) setPage(maxPage);
      } catch {
        setError("목록을 불러오지 못했습니다.");
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword, refreshKey, page, queryTables, tableOptions.length]);

  /** 지도 선택 시 해당 건이 있는 페이지로 한 번 이동 */
  useEffect(() => {
    if (!selectedDetailId) {
      lastJumpedSelectionRef.current = null;
      return;
    }
    if (lastJumpedSelectionRef.current === selectedDetailId) return;
    const parsed = parseMemoRowKey(selectedDetailId);
    if (!parsed || queryTables.length === 0) return;
    lastJumpedSelectionRef.current = selectedDetailId;
    const cat = resolveMemoCategory(parsed.tableName, "");
    if (useCategoryUi && cat && filterCategory !== "전체" && filterCategory !== cat) {
      setFilterCategory(cat);
      lastJumpedSelectionRef.current = null;
      return;
    }
    void call("", "POST", {
      service: "memoService",
      action: "findMemoListRank",
      params: {
        keyword,
        tables: queryTables,
        tableName: parsed.tableName,
        memoKey: parsed.memoKey,
      },
    }).then((res) => {
      const data = res?.data ?? res;
      const index = Number(data?.index ?? -1);
      if (!Number.isInteger(index) || index < 0) return;
      const nextPage = Math.floor(index / PAGE_SIZE) + 1;
      setPage((prev) => (prev === nextPage ? prev : nextPage));
    });
  }, [
    selectedDetailId,
    queryTables,
    keyword,
    useCategoryUi,
    filterCategory,
  ]);

  useEffect(() => {
    if (!selectedDetailId) return;
    let tries = 0;
    let timer: number | undefined;
    const scroll = () => {
      const el = listItemRefs.current.get(selectedDetailId);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (tries++ < 12) timer = window.setTimeout(scroll, 50);
    };
    requestAnimationFrame(() => requestAnimationFrame(scroll));
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [selectedDetailId, items, page]);

  const handleAdd = () => {
    const table = tableOptions[0]?.tableName;
    if (!table) {
      window.alert("등록 가능한 메모 테이블이 없습니다.");
      return;
    }
    onAdd?.(table);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-full flex-col bg-background">
        <div className="flex-shrink-0 border-b border-border">
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
                <FileText className="h-4 w-4 text-primary/80" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-foreground/90">{title}</h1>
                <p className="text-[11px] text-muted-foreground">
                  전체 <span className="font-medium text-foreground/80">{total}</span>건
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
                  "h-[26px] min-h-[26px] gap-1 px-2 text-[11px] font-medium rounded-lg",
                  useCategoryUi
                    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
                onClick={toggleUiTheme}
                title="임시: 기존 UI와 업무 분류 UI 전환"
              >
                {useCategoryUi ? "분류UI" : "기존UI"}
              </Button>
              {canWrite ? (
                <Button
                  size="sm"
                  className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary rounded-lg"
                  onClick={handleAdd}
                  disabled={tableOptions.length === 0}
                >
                  <Plus className="h-3 w-3" />
                  메모 추가
                </Button>
              ) : null}
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

          {useCategoryUi ? (
            <div className="px-3 pb-2">
              <div className="flex border-b border-border" role="tablist" aria-label="업무 분류">
                {MEMO_CATEGORY_OPTIONS.map((cat) => {
                  const isActive = filterCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        setFilterCategory(cat);
                        setPage(1);
                      }}
                      className={cn(
                        "h-7 min-w-0 flex-1 truncate border-b-2 px-0.5 text-center text-[11px] -mb-px",
                        isActive
                          ? "border-primary font-semibold text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
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
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="제목, 내용 검색..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-8 h-8 rounded-lg bg-muted/50 border-transparent focus:bg-background focus:border-border text-xs"
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex flex-col gap-2 py-3 pl-3 pr-0">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 pr-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                로딩 중...
              </div>
            )}
            {!loading && error && (
              <div className="mr-3 rounded border border-red-100 bg-red-50 px-2 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 pr-3 text-muted-foreground/80">
                <Search className="mb-3 h-10 w-10 opacity-25" />
                <p className="text-sm font-medium text-foreground/70">검색 결과가 없습니다</p>
                <p className="mt-1 text-xs">다른 검색어를 입력해보세요</p>
              </div>
            )}
            {!loading &&
              items.map((row) => {
                const isSelected = selectedDetailId === row.rowKey;
                const navigating = navigatingId === row.rowKey;
                const category = useCategoryUi
                  ? resolveMemoCategory(row.tableName, row.tableLabel)
                  : null;
                return (
                  <button
                    key={row.rowKey}
                    type="button"
                    ref={(el) => {
                      if (el) listItemRefs.current.set(row.rowKey, el);
                      else listItemRefs.current.delete(row.rowKey);
                    }}
                    onClick={() => void handleRowClick(row)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15"
                        : "border-border/80 bg-card hover:border-border hover:bg-muted/20"
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/90">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
                          {category ? (
                            <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              #{category}
                            </span>
                          ) : (
                            <span className="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                              {row.tableLabel}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[11px]">#{row.memoKey}</span>
                          {row.createUser ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
                              <User className="h-3 w-3" />
                              <span className="max-w-[4rem] truncate">{row.createUser}</span>
                            </span>
                          ) : null}
                          <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
                            <Calendar className="h-3 w-3" />
                            {row.createDate ? row.createDate.slice(0, 10) : "-"}
                          </span>
                        </div>
                        {navigating ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary/80" />
                        ) : (
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 shrink-0 transition-colors",
                              isSelected ? "text-primary/80" : "text-muted-foreground/40"
                            )}
                          />
                        )}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] leading-snug">
                        <span className="shrink-0 font-medium text-foreground/90">{row.title}</span>
                        <span className="shrink-0 text-muted-foreground/35" aria-hidden>
                          ·
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground/90">
                          {row.contents || "-"}
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
