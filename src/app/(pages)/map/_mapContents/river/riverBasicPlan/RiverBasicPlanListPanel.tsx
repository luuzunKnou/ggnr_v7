"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  riverBasicPlanAsDefineTable,
  riverBasicPlanGdWmsDefineTables,
  riverBasicPlanHdDefineTable,
  riverBasicPlanIndexDefineTable,
  riverBasicPlanJdDefineTable,
  buildRiverBasicPlanRiverNameCqlByLayer,
  type RiverBasicPlanTab,
} from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";

type RiverType = RiverBasicPlanTab;

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

function defaultLayersForTab(tab: RiverType): readonly string[] {
  return [
    riverBasicPlanIndexDefineTable(tab),
    riverBasicPlanAsDefineTable(tab),
    riverBasicPlanJdDefineTable(tab),
    riverBasicPlanHdDefineTable(tab),
    ...riverBasicPlanGdWmsDefineTables(tab),
  ];
}

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

  /**
   * 탭 전환: 상대 탭 레이어 끄기. 언마운트 시 양쪽·CQL 해제.
   * 현재 탭 WMS는 목록 건수가 있을 때만 켠다(미구축 시 빈 GetMap → Issues 방지).
   */
  useEffect(() => {
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames) return;
    const onLayers = defaultLayersForTab(tab);
    const offLayers = defaultLayersForTab(tab === "smallRiver" ? "river" : "smallRiver");
    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of offLayers) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
    return () => {
      const c = mapContextRef.current;
      if (!c?.setVisibleLayerNames) return;
      c.setVisibleLayerNames((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of [...onLayers, ...offLayers]) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prev;
      });
      c.setServiceWmsCqlByLayer?.(null);
    };
  }, [tab]);

  useEffect(() => {
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames || loading) return;
    const onLayers = defaultLayersForTab(tab);
    const enableCurrent = !error && items.length > 0;
    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      if (enableCurrent) {
        for (const id of onLayers) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
      } else {
        for (const id of onLayers) {
          if (next.delete(id)) changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tab, loading, error, items.length]);

  /** 목록에서 하천 선택 시 해당 하천만 WMS 표시 */
  useEffect(() => {
    const setCql = mapContextRef.current?.setServiceWmsCqlByLayer;
    if (!setCql) return;
    setCql(buildRiverBasicPlanRiverNameCqlByLayer(tab, selectedRiver));
  }, [tab, selectedRiver]);

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
        // 네트워크·인증 등 실제 실패만 표시. 테이블 없음·무자료는 서버가 빈 목록으로 반환함
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [tab, keyword]);

  const title = useMemo(() => (tab === "smallRiver" ? "소하천 기본계획" : "지방하천 기본계획"), [tab]);

  return (
    <div className="flex flex-col min-h-0 h-full bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 shrink-0">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-border bg-background">
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

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="하천명 통합검색"
            className="w-full h-9 rounded border border-border pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground px-4 py-4">불러오는 중...</p>
        ) : error ? (
          <p className="text-sm px-4 py-4 text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 py-4">검색 결과가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
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
                      "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                      active && "bg-primary/10"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3 h-2">
                      <p className={cn("text-sm font-medium", active ? "text-primary" : "text-foreground")}>
                        {item.riverName}
                      </p>
                      <span className="text-xs text-muted-foreground shrink-0">기본계획 {item.count}건</span>
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

