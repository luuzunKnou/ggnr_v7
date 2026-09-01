"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
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
import {
  useRoadRewardMapClick,
  type RoadRewardMapPick,
} from "./useRoadRewardMapClick";

function lowerLayerIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.toLowerCase());
}

type SortKey = "name" | "parcelCount";
type SortDir = "asc" | "desc";
type SortSpec = { key: SortKey; dir: SortDir };

const SORT_COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "건명", align: "left" },
  { key: "parcelCount", label: "필지", align: "right" },
];

function initialSortDir(key: SortKey): SortDir {
  return key === "name" ? "asc" : "desc";
}

function parcelCountOf(c: RoadRewardCase): number {
  return c.parcels.length || c.parcelCount || 0;
}

type Props = {
  cases: RoadRewardCase[];
  selectedId: string | null;
  onCasesChange: Dispatch<SetStateAction<RoadRewardCase[]>>;
  onSelectId: (id: string) => void;
  onFocusParcelId?: (id: string | null) => void;
  onAdd?: () => void;
  onClose: () => void;
};

export function RoadRewardListPanel({
  cases,
  selectedId,
  onCasesChange,
  onSelectId,
  onFocusParcelId,
  onAdd,
  onClose,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const [keyword, setKeyword] = useState("");
  const [sorts, setSorts] = useState<SortSpec[]>([]);
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

  /** 목록을 한 번에 받아오므로 정렬은 화면에서 처리. 여러 열을 누른 순서대로 적용 */
  const sorted = useMemo(() => {
    if (sorts.length === 0) return filtered;
    const rows = [...filtered];
    rows.sort((a, b) => {
      for (const s of sorts) {
        const dir = s.dir === "asc" ? 1 : -1;
        const cmp =
          s.key === "name"
            ? a.name.trim().localeCompare(b.name.trim(), "ko")
            : parcelCountOf(a) - parcelCountOf(b);
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
    return rows;
  }, [filtered, sorts]);

  const toggleSort = (key: SortKey) => {
    const initial = initialSortDir(key);
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx < 0) return [...prev, { key, dir: initial }];
      const cur = prev[idx];
      if (cur.dir === initial) {
        const next = [...prev];
        next[idx] = { key, dir: initial === "asc" ? "desc" : "asc" };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleAdd = () => {
    // 목록·DB에 행을 만들지 않고 등록 패널만 연다
    onSelectId(ROAD_REWARD_NEW_ID);
    onAdd?.();
  };

  const enrichCaseDetail = useCallback(
    async (id: string) => {
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
    },
    [onCasesChange]
  );

  const handleSelect = useCallback(
    async (id: string) => {
      onFocusParcelId?.(null);
      onSelectId(id);
      await enrichCaseDetail(id);
    },
    [onFocusParcelId, onSelectId, enrichCaseDetail]
  );

  const openDetailFromMap = useCallback(
    async (pick: RoadRewardMapPick) => {
      onSelectId(pick.caseId);
      onFocusParcelId?.(pick.parcelId ?? null);
      await enrichCaseDetail(pick.caseId);
    },
    [onFocusParcelId, onSelectId, enrichCaseDetail]
  );

  useRoadRewardMapClick({
    enabled: true,
    onPick: openDetailFromMap,
  });

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">보상편입용지</span>
        <div className="flex items-center gap-1">
          <LayerRowAddButton
            onClick={handleAdd}
            disabled={selectedId === ROAD_REWARD_NEW_ID}
          />
          <button
            type="button"
            onClick={onClose}
            className="standard-panel-close"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="standard-filter-section">
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="건명·조직·정책"
            className="standard-search-input"
          />
        </div>
      </div>

      <div className="standard-list-body">
        {listError ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {listError}
          </div>
        ) : null}
        <div className="standard-list-scroll">
          <table className="standard-list-table min-w-0 w-full table-fixed">
            <colgroup>
              <col />
              <col className="w-[88px]" />
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key);
                  const active = sortIdx >= 0;
                  const sortDir = active ? sorts[sortIdx].dir : null;
                  const Icon = !active
                    ? ArrowUpDown
                    : sortDir === "asc"
                      ? ArrowUp
                      : ArrowDown;
                  const initial = initialSortDir(col.key);
                  const alignRight = col.align === "right";
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        "standard-table-th",
                        alignRight ? "standard-table-th-center" : "standard-table-th-left"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "standard-sort-button",
                          alignRight ? "standard-sort-button-center" : "standard-sort-button-left",
                          active && "standard-sort-button-active"
                        )}
                        title={
                          !active
                            ? `${col.label} 정렬 추가`
                            : sortDir === initial
                              ? `${col.label} 방향 바꾸기`
                              : `${col.label} 정렬 해제`
                        }
                      >
                        <span className="truncate">{col.label}</span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && sorted.length === 0 ? (
                <tr>
                  <td colSpan={SORT_COLUMNS.length} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={SORT_COLUMNS.length} className="standard-table-empty">
                    {cases.length === 0 ? "등록된 건이 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              ) : (
                sorted.map((c) => {
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
                      className={cn("standard-list-row", isSelected && "standard-list-row-selected")}
                    >
                      <td className="standard-table-td-text" title={displayName}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "min-w-0 truncate",
                              c.name.trim() ? "text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {displayName}
                          </span>
                          {!c.geometry3857 ? (
                            <span className="standard-status-badge standard-status-badge-ended shrink-0">
                              범위미정
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="standard-table-td-date text-right">
                        {parcelCount.toLocaleString()}건
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          {loading ? "불러오는 중…" : `${filtered.length.toLocaleString()}건`}
          {!loading && filtered.length !== cases.length
            ? ` / 전체 ${cases.length.toLocaleString()}건`
            : ""}
        </div>
      </div>
    </div>
  );
}
