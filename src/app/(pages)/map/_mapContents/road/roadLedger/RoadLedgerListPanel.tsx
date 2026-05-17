"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fromLonLat } from "ol/proj";
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  DEFAULT_CENTER_LAT,
  DEFAULT_CENTER_LON,
  DEFAULT_ZOOM_2D,
} from "../../../_mapComponents/config/mapDefaults";
import { getFitPaddingWithView } from "../../../_mapComponents/config/mapFitPadding";
import {
  formatRoadLedgerDecimalKo,
  formatRoadLedgerNameSectLabel,
  formatRoadLedgerParenRoadNoSectOnly,
  formatRoadLedgerRoadRankForTitle,
  getRoadLedgerRankBadgeStyle,
  pickRoadLedgerOgcFid,
} from "./roadLedgerFormat";
import { ROAD_LEDGER_SUMMARY_LAYER_ID } from "./roadLedgerDocLayerMap";

/** extent 없음·오류 시 맞춤 줌과 함께 이동할 기본 중심(지도 초기와 동일, EPSG:3857) */
function getDefaultMapCenter3857(): [number, number] {
  return fromLonLat([DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT]) as [number, number];
}

type RoadLedgerListRow = {
  roadLedgerOgcFid: number;
  rdid: string;
  roadName: string;
  roadNo: string;
  sect: string;
  roadRank: string;
  roadLedgerDsgdate: string;
  roadLedgerLenth: string;
  /** 노선에 2구간 등이 있으면 true — 1구간도 표시 */
  roadLedgerShowSectSuffix: boolean;
};

type Props = {
  onClose: () => void;
};

/** LENTH — 숫자면 소수 둘째 자리까지(끝이 0이면 생략), 천단위 구분, 아니면 `원문m` */
function formatRoadLedgerLengthM(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const n = Number(String(s).replace(/,/g, ""));
  if (Number.isFinite(n)) {
    return `${formatRoadLedgerDecimalKo(n)}m`;
  }
  return `${s}m`;
}

/** dsgdate — 비어 있거나 빠진 구간은 `0000`·`00`으로 채워 `YYYY-MM-DD` 형태로 표시 */
function formatRoadLedgerDsgdateForList(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "0000-00-00";

  const datePart = s.includes("T") ? (s.split("T")[0] ?? s) : s;
  const digitsOnly = datePart.replace(/\D/g, "");
  if (digitsOnly.length === 8 && /^\d{8}$/.test(digitsOnly)) {
    return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4, 6)}-${digitsOnly.slice(6, 8)}`;
  }

  const parts = datePart.split(/[-/.]/).map((p) => p.trim()).filter(Boolean);
  const nums = parts.map((p) => (/^\d+$/.test(p) ? p : ""));
  const y = nums[0] ? nums[0].padStart(4, "0").slice(-4) : "0000";
  const mo = nums[1] ? nums[1].padStart(2, "0").slice(-2) : "00";
  const d = nums[2] ? nums[2].padStart(2, "0").slice(-2) : "00";
  return `${y}-${mo}-${d}`;
}

export function RoadLedgerListPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const layerAddedByPanelRef = useRef(false);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RoadLedgerListRow[]>([]);
  const [loadingOgcFid, setLoadingOgcFid] = useState<number | null>(null);

  const selectedOgcFid = pickRoadLedgerOgcFid(mapContext?.roadLedgerIdentifyRow ?? null);

  const handleRowClick = useCallback(
    async (ogcFid: number) => {
      if (!mapContext?.setRoadLedgerIdentifyRow || ogcFid <= 0) return;
      setLoadingOgcFid(ogcFid);
      try {
        const res = await call("", "POST", {
          service: "roadLedgerService",
          action: "getRoadLedgerFeatureByOgcFid",
          params: { ogcFid },
        });
        const data = res?.data ?? res;
        const row = data?.row as Record<string, unknown> | null | undefined;
        if (row && typeof row === "object") {
          mapContext.setRoadLedgerFacilityModal?.(null);
          mapContext.setRoadLedgerIdentifyRow(row);
        }
      } catch {
        // 목록은 유지, 상세만 열리지 않음
      } finally {
        setLoadingOgcFid(null);
      }
    },
    [mapContext]
  );

  /** 패널 마운트 시 레이어 켜기·extent 맞춤 줌, 언마운트 시 패널이 켠 레이어만 끄기 (mapContext 참조 변경으로 반복 실행되지 않도록 deps 비움) */
  useEffect(() => {
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames) return;

    const alreadyOn = (ctx.visibleLayerNames ?? new Set<string>()).has(ROAD_LEDGER_SUMMARY_LAYER_ID);
    if (!alreadyOn) {
      ctx.setVisibleLayerNames((prev) => new Set(prev).add(ROAD_LEDGER_SUMMARY_LAYER_ID));
      layerAddedByPanelRef.current = true;
    } else {
      layerAddedByPanelRef.current = false;
    }

    let cancelled = false;

    void (async () => {
      const c = mapContextRef.current;
      try {
        const res = await call("", "POST", {
          service: "roadLedgerService",
          action: "getRoadLedgerLayerExtent",
          params: {},
        });
        if (cancelled) return;
        const data = res?.data ?? res;
        const ext = data?.extent3857 as unknown;
        const map = c?.mapInstanceRef?.current;
        const view = map?.getView();
        if (!view) return;
        if (Array.isArray(ext) && ext.length === 4) {
          const [xmin, ymin, xmax, ymax] = ext.map((v) => Number(v));
          if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) {
            view.animate({
              center: getDefaultMapCenter3857(),
              zoom: DEFAULT_ZOOM_2D,
              duration: 450,
            });
            return;
          }
          const width = Math.abs(xmax - xmin);
          const height = Math.abs(ymax - ymin);
          if (width < 2 && height < 2) {
            view.animate({
              center: [(xmin + xmax) / 2, (ymin + ymax) / 2],
              zoom: 12,
              duration: 450,
            });
            return;
          }
          /** 하천 기본계획 목록(RiverBasicPlanListPanel)과 동일: view.padding이 패널을 반영하므로 fit은 균일 패딩 */
          view.fit([xmin, ymin, xmax, ymax], {
            padding: getFitPaddingWithView(view, [80, 80, 80, 80]),
            maxZoom: 13,
            duration: 500,
          });
          return;
        }
        view.animate({
          center: getDefaultMapCenter3857(),
          zoom: DEFAULT_ZOOM_2D,
          duration: 450,
        });
      } catch {
        if (cancelled) return;
        mapContextRef.current?.mapInstanceRef?.current?.getView()?.animate({
          center: getDefaultMapCenter3857(),
          zoom: DEFAULT_ZOOM_2D,
          duration: 450,
        });
      }
    })();

    return () => {
      cancelled = true;
      const c = mapContextRef.current;
      if (layerAddedByPanelRef.current && c?.setVisibleLayerNames) {
        c.setVisibleLayerNames((prev) => {
          const next = new Set(prev);
          next.delete(ROAD_LEDGER_SUMMARY_LAYER_ID);
          return next;
        });
        layerAddedByPanelRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "roadLedgerService",
          action: "getRoadLedgerList",
          params: { keyword },
        });
        const data = res?.data ?? res;
        setItems(Array.isArray(data?.rows) ? data.rows : []);
      } catch (e: unknown) {
        setItems([]);
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword]);

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">도로대장</span>
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

      <div className="shrink-0 border-b border-slate-200 px-2.5 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="도로명·노선번호·구간·일자·연장 검색"
            className="h-8 w-full rounded border border-slate-300 pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-hide">
        {loading ? (
          <p className="px-3 py-2.5 text-xs text-slate-500">불러오는 중...</p>
        ) : error ? (
          <p className="px-3 py-2.5 text-xs text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-slate-500">검색 결과가 없습니다.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col />
              <col className="w-[5.75rem]" />
              <col className="w-[5.25rem]" />
            </colgroup>
            <tbody>
              {items.map((item) => {
                const baseLine = formatRoadLedgerNameSectLabel(item.roadName, item.sect, {
                  showSectSuffix: item.roadLedgerShowSectSuffix,
                });
                const parenNums = formatRoadLedgerParenRoadNoSectOnly(item.roadNo, item.sect);
                const rankLabel = formatRoadLedgerRoadRankForTitle(item.roadRank);
                const titleLine = [baseLine, parenNums].filter(Boolean).join(" ");
                const dsg = item.roadLedgerDsgdate?.trim() ?? "";
                const lenM = formatRoadLedgerLengthM(item.roadLedgerLenth ?? "");
                const hasMeta = Boolean(dsg || lenM);

                const isSelected = selectedOgcFid != null && selectedOgcFid === item.roadLedgerOgcFid;
                const isBusy = loadingOgcFid === item.roadLedgerOgcFid;

                return (
                  <tr
                    key={item.roadLedgerOgcFid}
                    role="button"
                    tabIndex={0}
                    onClick={() => void handleRowClick(item.roadLedgerOgcFid)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handleRowClick(item.roadLedgerOgcFid);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-slate-200 align-middle transition-colors",
                      isSelected
                        ? "border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]"
                        : "border-l-[3px] border-l-transparent hover:bg-slate-50",
                      isBusy && "opacity-70"
                    )}
                  >
                    <td className="min-w-0 overflow-hidden px-3 py-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {rankLabel ? (
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                            style={getRoadLedgerRankBadgeStyle(item.roadRank)}
                          >
                            {rankLabel}
                          </span>
                        ) : null}
                        <p
                          className={cn(
                            "min-w-0 truncate text-sm font-medium leading-tight",
                            titleLine !== "—" ? "text-slate-800" : "text-slate-400"
                          )}
                          title={titleLine !== "—" ? titleLine : undefined}
                        >
                          {titleLine}
                        </p>
                      </div>
                    </td>
                    <td className="px-1 py-2.5 text-right text-[11px] tabular-nums text-slate-500 whitespace-nowrap">
                      {hasMeta ? formatRoadLedgerDsgdateForList(dsg) : ""}
                    </td>
                    <td className="px-3 py-1.5 pl-1.5 text-right text-[11px] tabular-nums text-slate-500 whitespace-nowrap">
                      {hasMeta ? lenM || "—" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
