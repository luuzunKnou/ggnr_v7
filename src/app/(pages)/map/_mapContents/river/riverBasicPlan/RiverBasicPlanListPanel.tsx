"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";

/** 하천 기본계획 진입 시 항상 켜야 하는 레이어 (하천 선택 시 DetailPanel과 동일) */
const RIVER_BASIC_PLAN_DEFAULT_LAYERS = ["river_d_index", "river_plan_as"] as const;

type RiverType = "river" | "smallRiver";

type RiverItem = {
  riverName: string;
  riverType: string | null;
  count: number;
};

type Props = {
  tab: RiverType;
  onTabChange: (tab: RiverType) => void;
  selectedRiver: string;
  onSelectRiver: (riverName: string) => void;
  onClose: () => void;
};

export function RiverBasicPlanListPanel({
  tab,
  onTabChange,
  selectedRiver,
  onSelectRiver,
  onClose,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RiverItem[]>([]);

  /** 패널 진입 시 기본 레이어 켜기, 언마운트 시 끄기 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames) return;
    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of RIVER_BASIC_PLAN_DEFAULT_LAYERS) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      return changed ? next : prev;
    });
    return () => {
      const c = mapContextRef.current;
      if (!c?.setVisibleLayerNames) return;
      c.setVisibleLayerNames((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of RIVER_BASIC_PLAN_DEFAULT_LAYERS) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prev;
      });
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanRiverList",
          params: { tab, keyword },
        });
        const data = res?.data ?? res;
        setItems(Array.isArray(data?.rivers) ? data.rivers : []);
      } catch (e: unknown) {
        setItems([]);
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [tab, keyword]);

  const title = useMemo(() => (tab === "smallRiver" ? "소하천 기본계획" : "지방하천 기본계획"), [tab]);

  return (
    <div className="flex flex-col min-h-0 h-full bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 shrink-0">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => onTabChange("river")}
            className={cn(
              "w-1/2 px-3 py-2 text-xs font-medium text-center transition-colors",
              tab === "river"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            지방하천
          </button>
          <button
            type="button"
            onClick={() => onTabChange("smallRiver")}
            className={cn(
              "w-1/2 px-3 py-2 text-xs font-medium text-center transition-colors",
              tab === "smallRiver"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            소하천
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-200 px-3 py-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="하천명 통합검색"
            className="w-full h-9 rounded border border-slate-300 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <p className="text-sm text-slate-500 px-4 py-4">불러오는 중...</p>
        ) : error ? (
          <p className="text-sm text-red-600 px-4 py-4">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500 px-4 py-4">검색 결과가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {items.map((item) => {
              const active = selectedRiver === item.riverName;
              return (
                <li key={`${item.riverName}-${item.riverType ?? ""}`}>
                  <button
                    type="button"
                    onClick={async () => {
                      onSelectRiver(item.riverName);
                      mapContext?.riverBasicPlanExitIndexViewToDetailRef?.current?.();
                      try {
                        let res = await call("", "POST", {
                          service: "riverBasicPlanService",
                          action: "getRiverBasicPlanIndexExtent",
                          params: { tab, riverName: item.riverName },
                        });
                        let data = res?.data ?? res;
                        let ext = Array.isArray(data?.extent3857) ? data.extent3857 : null;
                        if (!ext || ext.length !== 4) {
                          res = await call("", "POST", {
                            service: "riverBasicPlanService",
                            action: "getRiverBasicPlanExtent",
                            params: { tab, riverName: item.riverName },
                          });
                          data = res?.data ?? res;
                          ext = Array.isArray(data?.extent3857) ? data.extent3857 : null;
                        }
                        const map = mapContext?.mapInstanceRef?.current;
                        if (!map || !ext || ext.length !== 4) return;
                        scheduleFitMapToExtent3857(map, ext as number[], {
                          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
                          pointThreshold: 1,
                          applyMapViewPadding: () =>
                            mapContext?.applyMapViewPaddingRef?.current?.(),
                        });
                      } catch {
                        // 지도 이동 실패는 사용자 동작을 막지 않음
                      }
                    }}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors",
                      active && "bg-blue-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3 h-2">
                      <p className={cn("text-sm font-medium", active ? "text-blue-700" : "text-slate-800")}>
                        {item.riverName}
                      </p>
                      <span className="text-xs text-slate-500 shrink-0">기본계획 {item.count}건</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

