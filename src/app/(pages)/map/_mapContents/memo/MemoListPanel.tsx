"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search, StickyNote, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../_mapComponents/config/mapAutoNavigation";
import { LAYER_ROW_NEW_ID, LayerRowAddButton } from "../../_mapComponents/layerRowEdit";
import { encodeMemoRowKey, memoWmsLayerId } from "./memoConfig";

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
  onSelectDetailId: (id: string) => void;
  refreshKey?: number;
  onAdd?: (tableName: string) => void;
};

export function MemoListPanel({
  onClose,
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
  const [tableFilter, setTableFilter] = useState("");
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  useEffect(() => {
    void call("", "POST", {
      service: "memoService",
      action: "listAvailableMemoTables",
      params: {},
    }).then((res) => {
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.tables) ? data.tables : Array.isArray(data) ? data : [];
      const opts = rows as TableOption[];
      setTableOptions(opts);
      if (!tableFilter && opts.length > 0) setTableFilter(opts[0].tableName);
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
    if (tableFilter) ensureLayerVisible(tableFilter);
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
  }, [ensureLayerVisible, tableFilter]);

  const handleRowClick = useCallback(
    async (row: ListRow) => {
      onSelectDetailId(row.rowKey);
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      setNavigatingId(row.rowKey);
      ensureLayerVisible(row.tableName);
      try {
        const res = await call("", "POST", {
          service: "memoService",
          action: "getMemoExtent3857",
          params: { table: row.tableName, memoKey: row.memoKey },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          window.alert(String(data.error));
          return;
        }
        const ext = data?.extent3857 as unknown;
        if (!Array.isArray(ext) || ext.length !== 4) {
          window.alert("위치 정보를 찾을 수 없습니다.");
          return;
        }
        scheduleFitMapToExtent3857(map, ext as number[], {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      } catch {
        window.alert("지도 이동에 실패했습니다.");
      } finally {
        setNavigatingId(null);
      }
    },
    [ensureLayerVisible, mapContext, onSelectDetailId]
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "memoService",
          action: "getMemoList",
          params: { table: tableFilter || undefined, keyword, limit: 200 },
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
  }, [keyword, tableFilter, refreshKey]);

  const handleAdd = () => {
    const table = tableFilter || tableOptions[0]?.tableName;
    if (!table) {
      window.alert("등록 가능한 메모 테이블이 없습니다.");
      return;
    }
    onAdd?.(table);
    onSelectDetailId(encodeMemoRowKey(table, LAYER_ROW_NEW_ID));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <StickyNote className="h-4 w-4 text-[#1D6AE3]" aria-hidden />
          메모관리
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          aria-label="패널 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
        >
          {tableOptions.length === 0 && <option value="">메모 테이블 없음</option>}
          {tableOptions.map((opt) => (
            <option key={opt.tableName} value={opt.tableName}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="제목·내용 검색"
            className="h-8 w-full rounded border border-border pl-7 pr-2 text-xs"
          />
        </div>
        <LayerRowAddButton onClick={handleAdd} disabled={tableOptions.length === 0} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            불러오는 중…
          </div>
        )}
        {!loading && error && (
          <div className="rounded border border-red-100 bg-red-50 px-2 py-2 text-xs text-red-700">{error}</div>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">등록된 메모가 없습니다.</p>
        )}
        {!loading &&
          items.map((row) => {
            const selected = selectedDetailId === row.rowKey;
            const navigating = navigatingId === row.rowKey;
            return (
              <button
                key={row.rowKey}
                type="button"
                onClick={() => void handleRowClick(row)}
                className={cn(
                  "mb-2 w-full rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-[#1D6AE3]/40 bg-blue-50/80"
                    : "border-border bg-background hover:border-border hover:bg-muted/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{row.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{row.contents || "—"}</p>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                      <span>{row.tableLabel}</span>
                      {row.createDate && <span>{row.createDate}</span>}
                    </div>
                  </div>
                  {navigating ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#1D6AE3]" />
                  ) : (
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                  )}
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
