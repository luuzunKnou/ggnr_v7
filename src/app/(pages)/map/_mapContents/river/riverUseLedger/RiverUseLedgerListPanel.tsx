"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import {
  RIVER_USE_LEDGER_WMS_LAYER_ID,
  RIVER_USAGE_DATA_WMS_LAYER_ID,
} from "./riverUseLedgerLayerId";
import { LAYER_ROW_NEW_ID, LayerRowAddButton } from "../../../_mapComponents/layerRowEdit";

type ListRow = {
  rowKey: string;
  permitNo: string;
  spot: string;
  col3: string;
  col4: string;
};

type ListHeaders = {
  permitNo: string;
  spot: string;
  col3: string;
  col4: string;
};

type Props = {
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string) => void;
  refreshKey?: number;
  onAdd?: () => void;
};

const DEFAULT_HEADERS: ListHeaders = {
  permitNo: "부과번호",
  spot: "소재지",
  col3: "부과연도",
  col4: "부과일자",
};

export function RiverUseLedgerListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  refreshKey = 0,
  onAdd,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const layerAddedByPanelRef = useRef(false);
  const activeLayerIdRef = useRef(RIVER_USE_LEDGER_WMS_LAYER_ID.toLowerCase());

  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);
  const [headers, setHeaders] = useState<ListHeaders>(DEFAULT_HEADERS);
  const [searchPlaceholder, setSearchPlaceholder] = useState(
    "검색 (부과번호, 장소, 연도, 일자 등)"
  );
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await call("", "POST", {
          service: "riverUseLedgerService",
          action: "getRiverUseLedgerConfig",
          params: {},
        });
        const data = res?.data ?? res;
        if (cancelled || data?.error) return;
        if (data?.listHeaders) {
          setHeaders({
            permitNo: String(data.listHeaders.permitNo ?? DEFAULT_HEADERS.permitNo),
            spot: String(data.listHeaders.spot ?? DEFAULT_HEADERS.spot),
            col3: String(data.listHeaders.col3 ?? DEFAULT_HEADERS.col3),
            col4: String(data.listHeaders.col4 ?? DEFAULT_HEADERS.col4),
          });
        }
        const lid = String(data?.wmsLayerId ?? RIVER_USE_LEDGER_WMS_LAYER_ID)
          .trim()
          .toLowerCase();
        activeLayerIdRef.current = lid || RIVER_USE_LEDGER_WMS_LAYER_ID.toLowerCase();
        if (data?.variant === "usage") {
          setSearchPlaceholder("검색 (허가번호, 위치, 하천명, 점용자 등)");
        }
        const ctx = mapContextRef.current;
        if (ctx?.setVisibleLayerNames) {
          const alreadyOn = (ctx.visibleLayerNames ?? new Set<string>()).has(activeLayerIdRef.current);
          if (!alreadyOn) {
            ctx.setVisibleLayerNames((prev) => new Set(prev).add(activeLayerIdRef.current));
            layerAddedByPanelRef.current = true;
          }
        }
      } catch {
        /* keep defaults */
      }
    })();

    return () => {
      cancelled = true;
      const c = mapContextRef.current;
      if (!layerAddedByPanelRef.current || !c?.setVisibleLayerNames) return;
      const lid = activeLayerIdRef.current;
      c.setVisibleLayerNames((prev) => {
        if (!prev.has(lid)) return prev;
        const next = new Set(prev);
        next.delete(lid);
        return next;
      });
      layerAddedByPanelRef.current = false;
    };
  }, []);

  const handleRowClick = useCallback(
    async (rowKey: string) => {
      if (!rowKey) return;
      onSelectDetailId(rowKey);
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      setNavigatingId(rowKey);
      try {
        const res = await call("", "POST", {
          service: "riverUseLedgerService",
          action: "getRiverUseLedgerExtent3857ById",
          params: { id: rowKey },
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
        const lid = activeLayerIdRef.current || RIVER_USAGE_DATA_WMS_LAYER_ID.toLowerCase();
        mapContext?.setVisibleLayerNames?.((prev) => {
          if (prev.has(lid)) return prev;
          return new Set(prev).add(lid);
        });
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
    [mapContext, onSelectDetailId]
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "riverUseLedgerService",
          action: "getRiverUseLedgerList",
          params: { keyword },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          setItems([]);
          setError(String(data.error));
          return;
        }
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        setItems(
          rows.map((r: Record<string, unknown>) => ({
            rowKey: String(r.rowKey ?? "").trim(),
            permitNo: String(r.permitNo ?? "").trim(),
            spot: String(r.spot ?? "").trim(),
            col3: String(r.col3 ?? r.year ?? "").trim(),
            col4: String(r.col4 ?? r.date ?? "").trim(),
          }))
        );
      } catch (e: unknown) {
        setItems([]);
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword, refreshKey]);

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">하천점용</span>
        <div className="flex items-center gap-1">
          {onAdd && (
            <LayerRowAddButton
              onClick={() => onAdd()}
              disabled={selectedDetailId === LAYER_ROW_NEW_ID}
            />
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="shrink-0 px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  {headers.permitNo}
                </th>
                <th className="min-w-[120px] px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  {headers.spot}
                </th>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  {headers.col3}
                </th>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  {headers.col4}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    {error ? "데이터를 표시할 수 없습니다." : "조회된 항목이 없습니다."}
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const isSelected = selectedDetailId != null && row.rowKey === selectedDetailId;
                  const isBusy = navigatingId != null && row.rowKey === navigatingId;
                  return (
                    <tr
                      key={row.rowKey ? row.rowKey : `r-${idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleRowClick(row.rowKey)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void handleRowClick(row.rowKey);
                        }
                      }}
                      className={cn(
                        "border-b border-slate-100 cursor-pointer hover:bg-slate-50/80 transition-colors",
                        isSelected && "bg-primary/10"
                      )}
                      aria-busy={isBusy}
                    >
                      <td className="max-w-[140px] truncate px-2 py-1.5 text-slate-800" title={row.permitNo}>
                        {row.permitNo || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700 align-top break-words" title={row.spot}>
                        {row.spot || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700" title={row.col3}>
                        {row.col3 || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700" title={row.col4}>
                        {row.col4 || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && items.length > 0 && (
          <div className="shrink-0 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
            {items.length.toLocaleString()}건
          </div>
        )}
      </div>
    </div>
  );
}
