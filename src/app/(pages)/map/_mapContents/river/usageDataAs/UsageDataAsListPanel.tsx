"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import {
  LAYER_ROW_NEW_ID,
  LayerRowAddButton,
  LayerRowPanelButton,
} from "../../../_mapComponents/layerRowEdit";
import {
  clearUsageDataAsWmsLayers,
  ensureUsageDataAsWmsLayersVisible,
  isUsageDataAsSisulWmsVisible,
  toggleUsageDataAsSisulWmsLayer,
} from "./usageDataAsMapSync";
import {
  isUseFeeWmsVisible,
  toggleUseFeeWmsLayer,
} from "../../useFee/useFeeMapSync";
import { occupationLayerToggleActiveStyle } from "@/lib/occupationLayerStyle";

type ListRow = {
  rowKey: string;
  name: string;
  place: string;
  startDate: string;
  endDate: string;
};

type Props = {
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string) => void;
  refreshKey?: number;
  onAdd?: () => void;
};

export function UsageDataAsListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  refreshKey = 0,
  onAdd,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;

  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);

  useEffect(() => {
    ensureUsageDataAsWmsLayersVisible(mapContextRef.current?.setVisibleLayerNames);
    return () => {
      // 이 패널이 켠 것만 아니라 점용 WMS 전부 끔 (시스템 이동·재진입 잔상 방지)
      clearUsageDataAsWmsLayers(mapContextRef.current?.setVisibleLayerNames);
    };
  }, []);

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  /** 지도 픽이 클릭 도형으로 맞춘 경우 — selectedDetailId 자동 fit 1회 건너뜀 */
  const skipAutoFitOnceRef = useRef(false);

  const ensureUsageLayersVisible = useCallback(() => {
    ensureUsageDataAsWmsLayersVisible(mapContext?.setVisibleLayerNames);
  }, [mapContext]);

  /** 상세 패널 폭이 map padding에 반영된 뒤 fit (상세 오픈 직후 어긋남 방지) */
  const fitMapAfterDetailLayout = useCallback(
    (extent3857: number[]) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      ensureUsageLayersVisible();
      window.setTimeout(() => {
        scheduleFitMapToExtent3857(map, extent3857, {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      }, 80);
    },
    [mapContext, ensureUsageLayersVisible]
  );

  const fitMapToDetailKey = useCallback(
    async (rowKey: string) => {
      const key = String(rowKey ?? "").trim();
      if (!key || key === LAYER_ROW_NEW_ID) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      try {
        const res = await call("", "POST", {
          service: "usageDataAsService",
          action: "getUsageDataAsExtent3857ByKey",
          params: { key },
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
        fitMapAfterDetailLayout(ext as number[]);
      } catch {
        window.alert("지도 이동에 실패했습니다.");
      }
    },
    [mapContext?.mapInstanceRef, fitMapAfterDetailLayout]
  );

  /**
   * 상세 선택(목록·알림 등) 시 본표 범위로 지도 이동.
   * 알림 컴포넌트는 상세 ID만 넣고, 이동은 여기서 처리한다.
   */
  useEffect(() => {
    const key = String(selectedDetailId ?? "").trim();
    if (!key || key === LAYER_ROW_NEW_ID) return;
    if (skipAutoFitOnceRef.current) {
      skipAutoFitOnceRef.current = false;
      return;
    }
    void fitMapToDetailKey(key);
  }, [selectedDetailId, fitMapToDetailKey]);

  const handleRowClick = useCallback(
    (rowKey: string) => {
      if (!rowKey) return;
      mapContext?.setUsageDataAsMapHitOptions?.([]);
      // 같은 행 재클릭 — selectedDetailId 불변이라 effect가 안 도므로 직접 맞춤
      if (rowKey === selectedDetailId && rowKey !== LAYER_ROW_NEW_ID) {
        void fitMapToDetailKey(rowKey);
        return;
      }
      onSelectDetailId(rowKey);
    },
    [selectedDetailId, onSelectDetailId, fitMapToDetailKey, mapContext]
  );

  /** 지도에서 점용 레이어 클릭 → 목록·상세 선택 + 클릭 도형을 지도 중앙에 맞춤 */
  useEffect(() => {
    const pickRef = mapContext?.applyUsageDataAsMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const consCode = String(pick?.consCode ?? "").trim();
      if (!consCode) return;
      // 겹침 옵션은 OpenLayersMap이 Context에 먼저 넣음 — 여기서 []로 덮어쓰지 않음
      const opts = Array.isArray(pick?.overlapOptions) ? pick.overlapOptions : [];
      if (opts.length > 1) {
        mapContextRef.current?.setUsageDataAsMapHitOptions?.(opts);
      }
      const clickedExt = pick?.extent3857;
      if (
        Array.isArray(clickedExt) &&
        clickedExt.length === 4 &&
        clickedExt.every((v) => Number.isFinite(Number(v)))
      ) {
        skipAutoFitOnceRef.current = true;
        onSelectDetailId(consCode);
        fitMapAfterDetailLayout(clickedExt.map(Number));
        return;
      }
      onSelectDetailId(consCode);
    };
    return () => {
      pickRef.current = null;
    };
  }, [mapContext?.applyUsageDataAsMapPickRef, onSelectDetailId, fitMapAfterDetailLayout]);

  useEffect(() => {
    if (!selectedDetailId || selectedDetailId === LAYER_ROW_NEW_ID) return;
    const scroller = listScrollRef.current;
    if (!scroller) return;
    const el = scroller.querySelector(
      `[data-usage-data-as-row="${CSS.escape(selectedDetailId)}"]`
    );
    if (!(el instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta =
      elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    if (Math.abs(delta) < 4) return;
    scroller.scrollBy({ top: delta, behavior: "smooth" });
  }, [selectedDetailId, items]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "usageDataAsService",
          action: "getUsageDataAsList",
          params: { keyword: keyword.trim() || undefined },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          setError(String(data.error));
          setItems([]);
          return;
        }
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

  const sisulLayerOn = isUsageDataAsSisulWmsVisible(mapContext?.visibleLayerNames);
  const useFeeLayerOn = isUseFeeWmsVisible(mapContext?.visibleLayerNames, 'river');

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">하천점용</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={sisulLayerOn ? "점용시설물 레이어 끄기" : "점용시설물 레이어 켜기"}
            aria-label={sisulLayerOn ? "점용시설물 레이어 끄기" : "점용시설물 레이어 켜기"}
            aria-pressed={sisulLayerOn}
            onClick={() => toggleUsageDataAsSisulWmsLayer(mapContext?.setVisibleLayerNames)}
            style={sisulLayerOn ? occupationLayerToggleActiveStyle("facility") : undefined}
            className={sisulLayerOn ? "hover:opacity-90" : undefined}
          >
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            시설물
          </LayerRowPanelButton>
          <LayerRowPanelButton
            type="button"
            title={useFeeLayerOn ? "점사용료 레이어 끄기" : "점사용료 레이어 켜기"}
            aria-label={useFeeLayerOn ? "점사용료 레이어 끄기" : "점사용료 레이어 켜기"}
            aria-pressed={useFeeLayerOn}
            onClick={() =>
              toggleUseFeeWmsLayer(mapContext?.setVisibleLayerNames, 'river')
            }
            style={useFeeLayerOn ? occupationLayerToggleActiveStyle("useFee") : undefined}
            className={useFeeLayerOn ? "hover:opacity-90" : undefined}
          >
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            점사용료
          </LayerRowPanelButton>
          <LayerRowAddButton
            onClick={() => {
              if (onAdd) onAdd();
              else onSelectDetailId(LAYER_ROW_NEW_ID);
            }}
            disabled={selectedDetailId === LAYER_ROW_NEW_ID}
          />
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

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (점용명, 장소, 기간 등)"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-border"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        )}
        <div ref={listScrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">불러오는 중…</div>
          ) : (
            <table className="w-full min-w-[548px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[192px]" />
                <col className="w-[88px]" />
                <col className="w-[88px]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-muted/50">
                <tr>
                  <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                    점용명
                  </th>
                  <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                    점용장소
                  </th>
                  <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                    점용시작일
                  </th>
                  <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                    점용종료일
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const isSelected = selectedDetailId === row.rowKey;
                  return (
                    <tr
                      key={row.rowKey}
                      data-usage-data-as-row={row.rowKey}
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
                        "cursor-pointer border-b border-border transition-colors hover:bg-muted/50",
                        isSelected && "bg-primary/10"
                      )}
                    >
                      <td className="max-w-0 truncate px-2 py-1.5 text-foreground" title={row.name}>
                        {row.name}
                      </td>
                      <td className="max-w-0 truncate px-2 py-1.5 text-foreground/90" title={row.place}>
                        {row.place}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-foreground/90"
                        title={row.startDate}
                      >
                        {row.startDate}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-foreground/90"
                        title={row.endDate}
                      >
                        {row.endDate}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {items.length.toLocaleString()}건
        </div>
      </div>
    </div>
  );
}
