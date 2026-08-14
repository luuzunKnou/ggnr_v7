"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { formatFiniteNumberKoTrimZeros } from "@/lib/formatDetailScalar";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { ROAD_USE_LEDGER_WMS_LAYER_ID } from "./roadUseLedgerLayerId";
import { RoadUseLedgerAnalysisModal } from "./RoadUseLedgerAnalysisModal";
import { LAYER_ROW_NEW_ID, LayerRowAddButton, LayerRowPanelButton } from "../../../_mapComponents/layerRowEdit";

const SPOT_MODE_STORAGE_KEY = "ggnr.roadUseLedger.spotDisplayMode";

type SpotMode = "occupancy" | "property";

type ListRow = {
  rowKey: string;
  permitNo: string;
  spotWithoutSidoSgg: string;
  propertySpot: string;
  area: string;
  useStart: string;
  useEnd: string;
};

type Props = {
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string) => void;
  refreshKey?: number;
  onAdd?: () => void;
};

function formatAreaWithM2(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const withoutUnit = s
    .replace(/\s*[m㎡][²2]?\s*$/gi, "")
    .replace(/\s*m\s*²\s*$/gi, "")
    .trim();
  const numPart = withoutUnit.replace(/,/g, "").trim();
  if (!numPart) return "—";
  const n = Number(numPart);
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(numPart)) {
    return `${formatFiniteNumberKoTrimZeros(n)} m²`;
  }
  return `${withoutUnit || s} m²`;
}

function readStoredSpotMode(): SpotMode {
  if (typeof window === "undefined") return "occupancy";
  return window.localStorage.getItem(SPOT_MODE_STORAGE_KEY) === "property" ? "property" : "occupancy";
}

export function RoadUseLedgerListPanel({
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
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);
  const [hasUseMgjColumn, setHasUseMgjColumn] = useState(false);
  const [spotMode, setSpotMode] = useState<SpotMode>("occupancy");
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);

  /** 패널 마운트 시 도로점용 레이어를 켜고, 언마운트 시 이 패널이 켠 경우만 원복 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    const lid = ROAD_USE_LEDGER_WMS_LAYER_ID.toLowerCase();
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

  useEffect(() => {
    setSpotMode(readStoredSpotMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SPOT_MODE_STORAGE_KEY, spotMode);
  }, [spotMode]);

  const toggleSpotMode = useCallback(() => {
    const next: SpotMode = spotMode === "occupancy" ? "property" : "occupancy";
    if (next === "property" && !hasUseMgjColumn) {
      window.alert("물건지 정보가 존재하지 않습니다.");
      return;
    }
    setSpotMode(next);
  }, [spotMode, hasUseMgjColumn]);

  const handleRowClick = useCallback(
    async (rowKey: string) => {
      if (!rowKey) return;
      onSelectDetailId(rowKey);
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      setNavigatingId(rowKey);
      try {
        const res = await call("", "POST", {
          service: "roadUseLedgerService",
          action: "getRoadUseLedgerExtent3857ById",
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
        const lid = ROAD_USE_LEDGER_WMS_LAYER_ID.toLowerCase();
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
          service: "roadUseLedgerService",
          action: "getRoadUseLedgerList",
          params: { keyword },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          setItems([]);
          setHasUseMgjColumn(false);
          setError(String(data.error));
          return;
        }
        setHasUseMgjColumn(Boolean(data?.hasUseMgjColumn));
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        setItems(
          rows.map((r: Record<string, unknown>) => ({
            rowKey: String(r.rowKey ?? "").trim(),
            permitNo: String(r.permitNo ?? "").trim(),
            spotWithoutSidoSgg: String(r.spotWithoutSidoSgg ?? "").trim(),
            propertySpot: String(r.propertySpot ?? "").trim(),
            area: String(r.area ?? "").trim(),
            useStart: String(r.useStart ?? "").trim(),
            useEnd: String(r.useEnd ?? "").trim(),
          }))
        );
      } catch (e: unknown) {
        setItems([]);
        setHasUseMgjColumn(false);
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword, refreshKey]);

  useEffect(() => {
    if (loading) return;
    if (!hasUseMgjColumn && spotMode === "property") {
      setSpotMode("occupancy");
    }
  }, [loading, hasUseMgjColumn, spotMode]);

  const spotLabel = spotMode === "occupancy" ? "점용장소" : "물건지";

  return (
    <>
      <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">도로점용</span>
        <div className="flex items-center gap-1">
          {onAdd && (
            <LayerRowAddButton
              onClick={() => onAdd()}
              disabled={selectedDetailId === LAYER_ROW_NEW_ID}
            />
          )}
          <LayerRowPanelButton onClick={() => setAnalysisModalOpen(true)}>
            도로점용 분석
          </LayerRowPanelButton>
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
            placeholder="검색 (허가번호, 장소, 일자 등)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="shrink-0 px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{error}</div>
        )}
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  허가번호
                </th>
                <th className="min-w-[120px] px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  <div className="flex items-center gap-1">
                    <span>{spotLabel}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSpotMode();
                      }}
                      className={cn(
                        "shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800",
                        !hasUseMgjColumn && "opacity-50"
                      )}
                      title={
                        hasUseMgjColumn
                          ? spotMode === "occupancy"
                            ? "물건지 주소로 전환"
                            : "점용장소로 전환"
                          : "물건지 컬럼 없음"
                      }
                      aria-label="점용장소와 물건지 표시 전환"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </th>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  점용면적
                </th>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  점용시작일
                </th>
                <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  점용종료일
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    {error ? "데이터를 표시할 수 없습니다." : "조회된 항목이 없습니다."}
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const spotText =
                    spotMode === "property" ? row.propertySpot || "—" : row.spotWithoutSidoSgg || "—";
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
                      <td className="px-2 py-1.5 text-slate-700 align-top break-words" title={spotText}>
                        {spotText}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700 tabular-nums">
                        {formatAreaWithM2(row.area)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                        {row.useStart || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
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
      <RoadUseLedgerAnalysisModal open={analysisModalOpen} onClose={() => setAnalysisModalOpen(false)} />
    </>
  );
}
