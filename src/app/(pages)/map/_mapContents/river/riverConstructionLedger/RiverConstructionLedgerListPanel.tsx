"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Landmark,
  Pentagon,
  Plus,
  RefreshCw,
  Search,
  Square,
  X,
} from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  scheduleAnimateMapToCenter3857,
  scheduleFitMapToExtent3857,
} from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";
import { LayerRowAddButton } from "../../../_mapComponents/layerRowEdit";
import { transformCoordinate } from "../../../_mapComponents/services/coordinateService";
import { CONS_DATA_AS_WMS_LAYER_IDS } from "./consDataAsLayerId";
import {
  createEmptyRiverConstructionLedgerRow,
  formatRiverNamesLabel,
  formatRiverNamesShort,
  isNewRiverConstructionLedgerRow,
  mapConsDataAsApiToLedgerRow,
  type ConsDataAsApiRow,
} from "./riverConstructionLedgerMock";
import { filterRiverConstructionLedgerRowsByWkt5181 } from "./riverConstructionLedgerSpatial";

function lowerLayerIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.toLowerCase());
}
type SpatialTool = "rectangle" | "polygon" | "circle";
type SearchTab = "keyword" | "shape" | "boundary";

type BoundaryBadgeItem = {
  key: string;
  kind: "emd" | "ri";
  code: string;
  label: string;
};

type Props = {
  onClose: () => void;
};

export function RiverConstructionLedgerListPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const rows = mapContext?.riverConstructionLedgerRows ?? [];
  const selectedId = mapContext?.riverConstructionLedgerSelectedId ?? null;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt;
  const setOverlayRows = mapContext?.setRiverConstructionLedgerOverlayRows;
  const setRows = mapContext?.setRiverConstructionLedgerRows;
  const setSelectedId = mapContext?.setRiverConstructionLedgerSelectedId;
  const setSelectedRiver = mapContext?.setRiverConstructionLedgerSelectedRiver;
  const setRiverFocus = mapContext?.setRiverConstructionLedgerRiverFocus;

  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [spatialWkt, setSpatialWkt] = useState<string | null>(null);
  const [activeSpatialTool, setActiveSpatialTool] = useState<SpatialTool | null>(null);
  const [mapSearchTab, setMapSearchTab] = useState<SearchTab>("keyword");
  const [boundaryBadges, setBoundaryBadges] = useState<BoundaryBadgeItem[]>([]);
  const [emdSelected, setEmdSelected] = useState("");
  const [riSelected, setRiSelected] = useState("");
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([]);
  const [boundaryLoading, setBoundaryLoading] = useState(false);

  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;

  /** 패널 진입 시 공사대장 레이어 켜고 전체 extent로 지도 이동 */
  useEffect(() => {
    const ctx = mapContextRef.current;
    const layerIds = lowerLayerIds(CONS_DATA_AS_WMS_LAYER_IDS);
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
      service: "consDataAsService",
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

  const loadRows = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await call("", "POST", {
        service: "consDataAsService",
        action: "listRows",
        params: {},
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setListError(String(data.error));
        return;
      }
      const raw = Array.isArray(data?.rows) ? (data.rows as ConsDataAsApiRow[]) : [];
      const mapped = raw.map(mapConsDataAsApiToLedgerRow);
      setRows?.((prev) => {
        const drafts = prev.filter(isNewRiverConstructionLedgerRow);
        const byId = new Map(mapped.map((r) => [r.id, r]));
        for (const p of prev) {
          if (isNewRiverConstructionLedgerRow(p)) continue;
          const next = byId.get(p.id);
          if (!next) continue;
          if (p.id === selectedId) {
            byId.set(p.id, {
              ...next,
              geom: p.geom ?? next.geom,
              parcels: p.parcels?.length ? p.parcels : next.parcels,
            });
          }
        }
        return [...drafts, ...byId.values()];
      });
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [selectedId, setRows]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const selectRow = useCallback(
    async (rowId: string) => {
      setSelectedId?.(rowId);
      setRiverFocus?.(null);
      if (isNewRiverConstructionLedgerRow({ id: rowId })) return;
      // 클릭 즉시 지도만 이동 — 상세·필지 GeoJSON은 DetailPanel에서 비동기 로드
      try {
        const map = mapContext?.mapInstanceRef?.current;
        if (!map) return;
        const extRes = await call("", "POST", {
          service: "consDataAsService",
          action: "getExtent3857ByConsCode",
          params: { consCode: rowId },
        });
        const extData = extRes?.data ?? extRes;
        const extent = extData?.extent3857 as number[] | null | undefined;
        if (Array.isArray(extent) && extent.length === 4 && extent.every((v) => Number.isFinite(Number(v)))) {
          scheduleFitMapToExtent3857(map, extent.map(Number), {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
          });
        }
      } catch {
        /* extent 실패 시 목록 행 geom 강조에 맡김 */
      }
    },
    [mapContext, setRiverFocus, setSelectedId]
  );

  useEffect(() => {
    let cancelled = false;
    void call("", "POST", {
      service: "devTestService",
      action: "getEmdRiOptions",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : []);
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mapSearchTab !== "boundary" || !emdSelected) {
      setRiOptions([]);
      setRiSelected("");
      return;
    }
    let cancelled = false;
    void call("", "POST", {
      service: "devTestService",
      action: "getRiOptionsByEmd",
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRiOptions(Array.isArray(data?.ri) ? data.ri : []);
        setRiSelected("");
      })
      .catch(() => {
        if (!cancelled) setRiOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mapSearchTab, emdSelected]);

  const clearSpatial = useCallback(() => {
    setSpatialWkt(null);
    setActiveSpatialTool(null);
    setSpatialDrawRequest?.(null);
    setSpatialFilterWkt?.(null);
    setBoundaryLoading(false);
  }, [setSpatialDrawRequest, setSpatialFilterWkt]);

  const clearBoundaryForm = useCallback(() => {
    setBoundaryBadges([]);
    setEmdSelected("");
    setRiSelected("");
  }, []);

  const moveMapToCenter = useCallback(
    (center: { x: number; y: number } | null) => {
      if (!center) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const center3857 = transformCoordinate([center.x, center.y], "EPSG:5181", "EPSG:3857");
      if (!center3857) return;
      scheduleAnimateMapToCenter3857(map, center3857 as [number, number], map.getView().getZoom() ?? 14, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  );

  const applySpatialWkt = useCallback(
    (wkt5181: string, center?: { x: number; y: number } | null) => {
      setSpatialWkt(wkt5181);
      setSpatialFilterWkt?.(wkt5181);
      setActiveSpatialTool(null);
      setSpatialDrawRequest?.(null);
      if (center) moveMapToCenter(center);
    },
    [moveMapToCenter, setSpatialDrawRequest, setSpatialFilterWkt]
  );

  const startSpatial = useCallback(
    (type: SpatialTool) => {
      if (!setSpatialDrawRequest) return;
      if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) return;
      setMapSearchTab("shape");
      setActiveSpatialTool(type);
      setSpatialDrawRequest({
        type,
        onComplete: (wkt5181: string) => {
          applySpatialWkt(wkt5181);
        },
      });
    },
    [applySpatialWkt, mapContext, setSpatialDrawRequest]
  );

  const addBoundaryBadgeFromDraft = useCallback(() => {
    if (riSelected) {
      const label = riOptions.find((o) => o.code === riSelected)?.name ?? riSelected;
      const item: BoundaryBadgeItem = {
        key: `ri:${riSelected}`,
        kind: "ri",
        code: riSelected,
        label,
      };
      setBoundaryBadges((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item]));
      return;
    }
    if (emdSelected) {
      const label = emdOptions.find((o) => o.code === emdSelected)?.name ?? emdSelected;
      const item: BoundaryBadgeItem = {
        key: `emd:${emdSelected}`,
        kind: "emd",
        code: emdSelected,
        label,
      };
      setBoundaryBadges((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item]));
      return;
    }
    window.alert("읍면동 또는 리를 선택한 뒤 + 를 눌러 주세요.");
  }, [riSelected, emdSelected, riOptions, emdOptions]);

  const runBoundarySearch = useCallback(async () => {
    if (boundaryBadges.length === 0) {
      window.alert("추가된 읍면동·리가 없습니다. 선택 후 + 를 눌러 추가하세요.");
      return;
    }
    setBoundaryLoading(true);
    try {
      const wktParts: string[] = [];
      let lastCenter: { x: number; y: number } | null = null;
      for (const b of boundaryBadges) {
        const res = await call("", "POST", {
          service: "devTestService",
          action: b.kind === "emd" ? "getEmdGeometry" : "getRiGeometry",
          params: b.kind === "emd" ? { emdCode: b.code } : { riCode: b.code },
        });
        const data = res?.data ?? res;
        const w = data?.wkt != null ? String(data.wkt).trim() : "";
        if (w) {
          wktParts.push(w);
          const c = data?.center as { x?: number; y?: number } | null | undefined;
          if (c?.x != null && c?.y != null) {
            lastCenter = { x: Number(c.x), y: Number(c.y) };
          }
        }
      }
      if (wktParts.length === 0) {
        window.alert("행정경계 도형을 가져오지 못했습니다.");
        return;
      }
      let unionWkt: string | null = wktParts[0] ?? null;
      let center: { x: number; y: number } | null = lastCenter;
      if (wktParts.length > 1) {
        const ures = await call("", "POST", {
          service: "devTestService",
          action: "unionWkts5181",
          params: { wkts: wktParts },
        });
        const udata = ures?.data ?? ures;
        unionWkt = udata?.wkt != null ? String(udata.wkt).trim() : null;
        const uc = udata?.center as { x?: number; y?: number } | null | undefined;
        if (uc?.x != null && uc?.y != null) {
          center = { x: Number(uc.x), y: Number(uc.y) };
        }
      }
      if (!unionWkt) {
        window.alert("행정경계 도형을 합치지 못했습니다.");
        return;
      }
      applySpatialWkt(unionWkt, center);
    } catch {
      window.alert("행정경계 검색 중 오류가 발생했습니다.");
    } finally {
      setBoundaryLoading(false);
    }
  }, [applySpatialWkt, boundaryBadges]);

  const spatialFiltered = useMemo(
    () => filterRiverConstructionLedgerRowsByWkt5181(rows, spatialWkt),
    [rows, spatialWkt]
  );

  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return spatialFiltered.filter((row) => {
      if (!q) return true;
      const hay = [
        row.name,
        formatRiverNamesLabel(row.riverNames),
        row.companyName,
        row.startDate,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [keyword, spatialFiltered]);

  useEffect(() => {
    setOverlayRows?.(items);
  }, [items, setOverlayRows]);

  const handleAdd = () => {
    const created = createEmptyRiverConstructionLedgerRow();
    setRows?.((prev) => [created, ...prev]);
    setSelectedId?.(created.id);
    setRiverFocus?.(null);
  };

  const spatialTools: { id: SpatialTool; label: string; icon: typeof Square }[] = [
    { id: "rectangle", label: "사각형", icon: Square },
    { id: "polygon", label: "다각형", icon: Pentagon },
    { id: "circle", label: "원형", icon: Circle },
  ];

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">공사대장</span>
        <div className="flex items-center gap-1">
          <LayerRowAddButton onClick={handleAdd} />
          <button
            type="button"
            onClick={() => {
              clearSpatial();
              clearBoundaryForm();
              setSelectedRiver?.(null);
              setRiverFocus?.(null);
              onClose();
            }}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="flex rounded-md border border-border bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => {
              setMapSearchTab("keyword");
              setSpatialDrawRequest?.(null);
              setActiveSpatialTool(null);
            }}
            className={cn(
              "flex-1 rounded py-1.5 text-[11px] font-medium transition-colors",
              mapSearchTab === "keyword"
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            통합검색
          </button>
          <button
            type="button"
            onClick={() => setMapSearchTab("shape")}
            className={cn(
              "flex-1 rounded py-1.5 text-[11px] font-medium transition-colors",
              mapSearchTab === "shape"
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            도형검색
          </button>
          <button
            type="button"
            onClick={() => {
              setMapSearchTab("boundary");
              setSpatialDrawRequest?.(null);
              setActiveSpatialTool(null);
            }}
            className={cn(
              "flex-1 rounded px-0.5 py-1.5 text-[10px] font-medium leading-tight transition-colors",
              mapSearchTab === "boundary"
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            행정경계 검색
          </button>
        </div>

        {mapSearchTab === "keyword" ? (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="공사명·하천·업체명·착수일자"
              className="h-8 w-full rounded border border-border pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
        ) : null}

        {mapSearchTab === "shape" ? (
          <div className="flex flex-wrap items-stretch gap-1.5">
            {spatialTools.map((tool) => {
              const Icon = tool.icon;
              const active =
                activeSpatialTool === tool.id ||
                (spatialDrawRequest?.type === tool.id && !spatialWkt);
              return (
                <button
                  key={tool.id}
                  type="button"
                  title={`지도에 ${tool.label} 그리기`}
                  onClick={() => startSpatial(tool.id)}
                  className={cn(
                    "flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border py-1.5 text-[10px] transition-colors",
                    active
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                  {tool.label}
                </button>
              );
            })}
            <button
              type="button"
              title="검색 초기화"
              onClick={clearSpatial}
              className="flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border border-border bg-background py-1.5 text-muted-foreground transition-colors hover:border-border hover:text-primary"
            >
              <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="text-[10px]">초기화</span>
            </button>
            {spatialDrawRequest ? (
              <p className="w-full text-[10px] text-muted-foreground">지도에 도형을 그려 주세요.</p>
            ) : null}
          </div>
        ) : null}

        {mapSearchTab === "boundary" ? (
          <div className="space-y-1.5">
            <div className="flex items-end gap-1.5">
              <div className="min-w-0 flex-1">
                <select
                  value={emdSelected}
                  onChange={(e) => {
                    setEmdSelected(e.target.value);
                    setRiSelected("");
                  }}
                  disabled={boundaryLoading}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">읍면동 선택</option>
                  {emdOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <select
                  value={riSelected}
                  onChange={(e) => setRiSelected(e.target.value)}
                  disabled={!emdSelected || boundaryLoading}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">리 선택</option>
                  {riOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                title="선택 항목을 목록에 추가"
                onClick={addBoundaryBadgeFromDraft}
                disabled={boundaryLoading}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </div>
            {boundaryBadges.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {boundaryBadges.map((b) => (
                  <span
                    key={b.key}
                    className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-primary/25 bg-primary/8 py-0.5 pl-1.5 pr-0.5 text-[10px] text-foreground"
                  >
                    <Landmark className="h-2.5 w-2.5 shrink-0 text-primary/70" />
                    <span className="max-w-[4.5rem] truncate" title={b.label}>
                      {b.label}
                    </span>
                    <button
                      type="button"
                      title="목록에서 제거"
                      onClick={() => setBoundaryBadges((prev) => prev.filter((x) => x.key !== b.key))}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-primary"
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={2} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void runBoundarySearch()}
                disabled={boundaryLoading || boundaryBadges.length === 0}
                className="min-h-8 flex-1 rounded-md border border-primary bg-primary py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {boundaryLoading ? "검색 중…" : "검색"}
              </button>
              <button
                type="button"
                title="선택·목록·지도 필터 초기화"
                onClick={() => {
                  clearBoundaryForm();
                  clearSpatial();
                }}
                disabled={boundaryLoading}
                className="min-h-8 flex-1 rounded-md border border-border bg-background py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-primary disabled:opacity-50"
              >
                초기화
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>목록 {items.length}건</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {listError ? (
          <p className="px-3 py-2.5 text-xs text-destructive">{listError}</p>
        ) : null}
        {loading && items.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col />
              <col className="w-[4.5rem]" />
              <col className="w-[4.75rem]" />
              <col className="w-[5.25rem]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted/50">
              <tr>
                <th className="border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">공사명</th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                  하천
                </th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                  업체명
                </th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                  착수일자
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const isSelected = selectedId === row.id;
                return (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      void selectRow(row.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void selectRow(row.id);
                      }
                    }}
                    className={cn(
                      "border-b border-border cursor-pointer hover:bg-muted/50 transition-colors",
                      isSelected && "bg-primary/10"
                    )}
                  >
                    <td
                      className="min-w-0 truncate px-2 py-1.5 text-foreground"
                      title={row.name}
                    >
                      {row.name || "—"}
                    </td>
                    <td
                      className="min-w-0 truncate px-2 py-1.5 text-foreground/90"
                      title={formatRiverNamesLabel(row.riverNames)}
                    >
                      {formatRiverNamesShort(row.riverNames)}
                    </td>
                    <td
                      className="min-w-0 truncate px-2 py-1.5 text-foreground/90"
                      title={row.companyName}
                    >
                      {row.companyName || "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-foreground/90">
                      {row.startDate || "—"}
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
