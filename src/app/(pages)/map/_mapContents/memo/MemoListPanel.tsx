"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  StickyNote,
  User,
} from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/app/shadcnComponents/ui/input";
import { Button } from "@/app/shadcnComponents/ui/button";
import { useMapContext } from "../../_mapComponents/MapContext";
import { refreshServiceWmsLayer } from "../../_mapComponents/layerFactory/serviceLayerFactory";
import { memoWmsLayerId, parseMemoRowKey } from "./memoConfig";
import {
  animateMemoToCenter3857,
  center3857FromExtent,
  useMemoMapHighlight,
} from "./useMemoMapHighlight";

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

type Props = {
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string | null) => void;
  refreshKey?: number;
  onAdd?: (tableName: string) => void;
};

export function MemoListPanel({
  onClose: _onClose,
  selectedDetailId,
  onSelectDetailId,
  refreshKey = 0,
  onAdd,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const layersAddedRef = useRef<Set<string>>(new Set());

  const [keyword, setKeyword] = useState("");
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [highlightGeom, setHighlightGeom] = useState<Record<string, unknown> | null>(null);

  useMemoMapHighlight(Boolean(mapContext?.mapReady), highlightGeom);

  useEffect(() => {
    void call("", "POST", {
      service: "memoService",
      action: "listAvailableMemoTables",
      params: {},
    }).then((res) => {
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.tables) ? data.tables : Array.isArray(data) ? data : [];
      setTableOptions(rows as TableOption[]);
    });
  }, []);

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

  const focusMemoOnMap = useCallback(async (rowKey: string, tableName: string, memoKey: string) => {
    focusedIdRef.current = rowKey;
    ensureLayerVisible(tableName);
    setNavigatingId(rowKey);
    try {
      const res = await call("", "POST", {
        service: "memoService",
        action: "getMemoExtent3857",
        params: { table: tableName, memoKey },
      });
      const data = res?.data ?? res;
      const geom = data?.geomGeoJson4326;
      setHighlightGeom(geom && typeof geom === "object" ? (geom as Record<string, unknown>) : null);
      const map = mapContextRef.current?.mapInstanceRef?.current;
      const center = center3857FromExtent(data?.extent3857);
      if (map && center) {
        animateMemoToCenter3857(map, center, () =>
          mapContextRef.current?.applyMapViewPaddingRef?.current?.()
        );
      }
    } catch {
      setHighlightGeom(null);
    } finally {
      setNavigatingId(null);
    }
  }, [ensureLayerVisible]);

  const handleRowClick = useCallback(
    (row: ListRow) => {
      // 같은 행을 한 번 더 누르면 상세를 닫는다
      if (selectedDetailId === row.rowKey) {
        focusedIdRef.current = null;
        setHighlightGeom(null);
        onSelectDetailId(null);
        return;
      }
      onSelectDetailId(row.rowKey);
      void focusMemoOnMap(row.rowKey, row.tableName, row.memoKey);
    },
    [focusMemoOnMap, onSelectDetailId, selectedDetailId]
  );

  useEffect(() => {
    if (!selectedDetailId) {
      focusedIdRef.current = null;
      setHighlightGeom(null);
      return;
    }
    if (focusedIdRef.current === selectedDetailId) return;
    const parsed = parseMemoRowKey(selectedDetailId);
    if (!parsed) {
      setHighlightGeom(null);
      return;
    }
    void focusMemoOnMap(selectedDetailId, parsed.tableName, parsed.memoKey);
  }, [focusMemoOnMap, selectedDetailId]);

  const prevRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === prevRefreshKeyRef.current) return;
    prevRefreshKeyRef.current = refreshKey;
    if (!selectedDetailId) return;
    const parsed = parseMemoRowKey(selectedDetailId);
    if (!parsed) return;
    refreshServiceWmsLayer(mapContextRef.current?.mapInstanceRef?.current);
    void focusMemoOnMap(selectedDetailId, parsed.tableName, parsed.memoKey);
  }, [focusMemoOnMap, refreshKey, selectedDetailId]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "memoService",
          action: "getMemoList",
          params: { keyword, limit: 200 },
        });
        const data = res?.data ?? res;
        if (data?.error) setError(String(data.error));
        setItems(Array.isArray(data?.rows) ? data.rows : []);
      } catch {
        setError("목록을 불러오지 못했습니다.");
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword, refreshKey]);

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
                <StickyNote className="h-4 w-4 text-primary/80" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-foreground/90">메모관리</h1>
                <p className="text-[11px] text-muted-foreground">
                  전체 <span className="font-medium text-foreground/80">{items.length}</span>건
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary rounded-lg"
              onClick={handleAdd}
              disabled={tableOptions.length === 0}
            >
              <Plus className="h-3 w-3" />
              메모 추가
            </Button>
          </div>

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
                return (
                  <button
                    key={row.rowKey}
                    type="button"
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
                          <span className="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {row.tableLabel}
                          </span>
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
      </div>
    </div>
  );
}
