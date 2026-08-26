"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { call } from "@/lib/api";
import { LayerRowAddButton } from "../../../_mapComponents/layerRowEdit";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import type { RoadRewardCase } from "./roadRewardMock";
import {
  ROAD_REWARD_NEW_ID,
  isNewRoadRewardCaseId,
  mapRoadRewardDtoToCase,
  type RoadRewardCaseDtoClient,
} from "./roadRewardApi";
import { ROAD_REWARD_WMS_LAYER_IDS } from "./roadRewardLayerId";

function lowerLayerIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.toLowerCase());
}

type Props = {
  cases: RoadRewardCase[];
  selectedId: string | null;
  onCasesChange: Dispatch<SetStateAction<RoadRewardCase[]>>;
  onSelectId: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
};

export function RoadRewardListPanel({
  cases,
  selectedId,
  onCasesChange,
  onSelectId,
  onAdd,
  onClose,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);
  const selectSeqRef = useRef(0);

  /** 패널 진입 시 보상편입용지·필지 레이어 켜고 전체 extent로 지도 이동 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    const layerIds = lowerLayerIds(ROAD_REWARD_WMS_LAYER_IDS);
    if (!ctx?.setVisibleLayerNames) return;

    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const lid of layerIds) {
        if (!next.has(lid)) {
          next.add(lid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    let cancelled = false;
    void call("", "POST", {
      service: "roadRewardService",
      action: "getLayerExtent3857",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const extent = data?.extent3857 as number[] | null | undefined;
        const map = mapContextRef.current?.mapInstanceRef?.current;
        if (
          !map ||
          !Array.isArray(extent) ||
          extent.length !== 4 ||
          !extent.every((v) => Number.isFinite(Number(v)))
        ) {
          return;
        }
        window.setTimeout(() => {
          if (cancelled) return;
          scheduleFitMapToExtent3857(map, extent.map(Number), {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () =>
              mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
          });
        }, 80);
      })
      .catch(() => {
        /* extent 없으면 레이어만 켠 상태 유지 */
      });

    return () => {
      cancelled = true;
      const c = mapContextRef.current;
      if (!c?.setVisibleLayerNames) return;
      c.setVisibleLayerNames((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const lid of layerIds) {
          if (next.delete(lid)) changed = true;
        }
        return changed ? next : prev;
      });
    };
  }, []);

  const loadRows = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setListError(null);
    try {
      const res = await call("", "POST", {
        service: "roadRewardService",
        action: "listRows",
        params: { fillPnuGeom: true },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setListError(String(data.error));
        return;
      }
      const raw = Array.isArray(data?.rows) ? (data.rows as RoadRewardCaseDtoClient[]) : [];
      const mapped = raw.map(mapRoadRewardDtoToCase);
      // 서버 목록이 기준. 선택 행의 예전 도형·필지를 덮어쓰지 않음(깜빡·이전 도형 잔존 방지)
      onCasesChange(mapped);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onCasesChange]);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    // 미저장 신규는 목록 행으로 넣지 않음
    const saved = cases.filter((c) => !isNewRoadRewardCaseId(c.id));
    const kw = keyword.trim().toLowerCase();
    if (!kw) return saved;
    return saved.filter((c) => {
      const name = c.name.toLowerCase();
      const org = (c.org ?? "").toLowerCase();
      const policy = (c.policy ?? "").toLowerCase();
      return name.includes(kw) || org.includes(kw) || policy.includes(kw);
    });
  }, [cases, keyword]);

  const handleAdd = () => {
    // 목록·DB에 행을 만들지 않고 등록 패널만 연다
    onSelectId(ROAD_REWARD_NEW_ID);
    onAdd?.();
  };

  const handleSelect = async (id: string) => {
    onSelectId(id);
    if (isNewRoadRewardCaseId(id)) return;
    const seq = ++selectSeqRef.current;
    try {
      const res = await call("", "POST", {
        service: "roadRewardService",
        action: "getDetailByOgcFid",
        params: { ogcFid: Number(id), fillPnuGeom: true },
      });
      if (seq !== selectSeqRef.current) return;
      const data = res?.data ?? res;
      if (data?.error || !data?.row) return;
      const mapped = mapRoadRewardDtoToCase(data.row as RoadRewardCaseDtoClient);
      onCasesChange((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx < 0) return [...prev, mapped];
        return prev.map((c) => (c.id === id ? mapped : c));
      });
    } catch {
      /* 상세 보강 실패 시 목록 행으로 표시 */
    }
  };

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">보상편입용지</span>
        <div className="flex items-center gap-1">
          <LayerRowAddButton
            onClick={handleAdd}
            disabled={selectedId === ROAD_REWARD_NEW_ID}
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

      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="건명·조직·정책"
            className="h-8 w-full rounded border border-border bg-background pl-7 pr-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>목록 {filtered.length.toLocaleString()}건</span>
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              불러오는 중
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {listError ? (
          <div className="m-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {listError}
          </div>
        ) : null}
        {loading && filtered.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중…
          </div>
        ) : !loading && filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {cases.length === 0 ? "등록된 건이 없습니다." : "검색 결과가 없습니다."}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col />
              <col className="w-[90px]" />
            </colgroup>
            <tbody>
              {filtered.map((c) => {
                const isSelected = c.id === selectedId;
                const parcelCount = c.parcels.length || c.parcelCount || 0;
                const displayName = c.name.trim() || "(건명 없음)";
                return (
                  <tr
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void handleSelect(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handleSelect(c.id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-border align-middle transition-colors",
                      isSelected
                        ? "border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]"
                        : "border-l-[3px] border-l-transparent hover:bg-muted/50"
                    )}
                  >
                    <td className="min-w-0 overflow-hidden px-3 py-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm font-medium leading-tight",
                            c.name.trim() ? "text-foreground" : "text-muted-foreground"
                          )}
                          title={displayName}
                        >
                          {displayName}
                        </p>
                        {!c.geometry3857 ? (
                          <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                            범위미정
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                      필지 {parcelCount.toLocaleString()}건
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
