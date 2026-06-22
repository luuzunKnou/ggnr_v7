"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { tryFormatToYmd } from "@/lib/formatDateYmd";
import { useMapContext } from "../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../_mapComponents/config/mapAutoNavigation";
import {
  LAYER_ROW_NEW_ID,
  LayerRowAddButton,
} from "../../_mapComponents/layerRowEdit";
import { BUILD_PUBLIC_LAND_WMS_LAYER_ID } from "./buildPublicLandLayerId";

type ListRow = {
  rowKey: string;
  ownershipType: string;
  address: string;
  useStart: string;
  useEnd: string;
};

type Props = {
  onClose: () => void;
  selectedId: string | null;
  onSelectId: (id: string) => void;
  refreshKey?: number;
  onAdd?: () => void;
};

export function BuildPublicLandListPanel({
  onClose,
  selectedId,
  onSelectId,
  refreshKey = 0,
  onAdd,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const layerAddedByPanelRef = useRef(false);

  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  /** 패널 마운트 시 public_land 레이어를 켜고, 언마운트 시 이 패널이 켠 경우만 원복 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    const lid = BUILD_PUBLIC_LAND_WMS_LAYER_ID.toLowerCase();
    if (!ctx?.setVisibleLayerNames) return;
    const alreadyOn = (ctx.visibleLayerNames ?? new Set<string>()).has(lid);
    if (!alreadyOn) {
      ctx.setVisibleLayerNames((prev) => new Set(prev).add(lid));
      layerAddedByPanelRef.current = true;
    } else {
      layerAddedByPanelRef.current = false;
    }
    return () => {
      const c = mapContextRef.current;
      if (!layerAddedByPanelRef.current || !c?.setVisibleLayerNames) return;
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
      onSelectId(rowKey);
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      setNavigatingId(rowKey);
      try {
        const res = await call("", "POST", {
          service: "buildPublicLandService",
          action: "getPublicLandExtent3857ById",
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
        const lid = BUILD_PUBLIC_LAND_WMS_LAYER_ID.toLowerCase();
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
    [mapContext, onSelectId]
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "buildPublicLandService",
          action: "getPublicLandList",
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
            ownershipType: String(r.ownershipType ?? "").trim(),
            address: String(r.address ?? "").trim(),
            useStart: String(r.useStart ?? "").trim(),
            useEnd: String(r.useEnd ?? "").trim(),
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

  const getUseEndStatus = useCallback((raw: string): "expired" | "soon" | "normal" => {
    const ymd = tryFormatToYmd(raw);
    if (!ymd) return "normal";
    const today = new Date();
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    if (ymd < todayYmd) return "expired";
    const oneMonthLater = new Date(today);
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
    const oneMonthLaterYmd = `${oneMonthLater.getFullYear()}-${String(oneMonthLater.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(oneMonthLater.getDate()).padStart(2, "0")}`;
    if (ymd <= oneMonthLaterYmd) return "soon";
    return "normal";
  }, []);

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">국공유지</span>
        <div className="flex shrink-0 items-center gap-1">
          {onAdd && (
            <LayerRowAddButton
              onClick={() => onAdd()}
              disabled={selectedId === LAYER_ROW_NEW_ID}
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
            placeholder="검색 (국유/공유, 필지, 소재지, 일자 등)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="shrink-0 px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{error}</div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="w-[18%] whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  국유/공유
                </th>
                <th className="w-[46%] px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  소재지
                </th>
                <th className="w-[18%] whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  사용시작일
                </th>
                <th className="w-[18%] whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  사용종료일
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
                  const isSelected = selectedId != null && row.rowKey === selectedId;
                  const isBusy = navigatingId != null && row.rowKey === navigatingId;
                  const useEndStatus = getUseEndStatus(row.useEnd);
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
                      <td className="truncate whitespace-nowrap px-2 py-1.5 text-slate-800" title={row.ownershipType}>
                        {row.ownershipType || "—"}
                      </td>
                      <td className="truncate whitespace-nowrap px-2 py-1.5 text-slate-700" title={row.address}>
                        {row.address || "—"}
                      </td>
                      <td className="truncate whitespace-nowrap px-2 py-1.5 text-slate-700">
                        {row.useStart || "—"}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-1.5",
                          useEndStatus === "expired"
                            ? "text-red-600 font-medium"
                            : useEndStatus === "soon"
                              ? "text-blue-600 font-medium"
                              : "text-slate-700"
                        )}
                      >
                        {row.useEnd || "—"}
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

