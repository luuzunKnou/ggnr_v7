"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Circle,
  Download,
  Landmark,
  Pentagon,
  Plus,
  RefreshCw,
  Search,
  Signpost,
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
import {
  LayerRowAddButton,
  LayerRowPanelButton,
} from "../../../_mapComponents/layerRowEdit";
import { transformCoordinate } from "../../../_mapComponents/services/coordinateService";
import { exportRoadNetworkExcel } from "./exportRoadNetworkExcel";
import { formatRoadNetworkListTitle } from "./roadNetworkFormat";
import { filterRoadNetworkRowsByWkt5181 } from "./roadNetworkSpatial";
import {
  extent3857FromRoadNetworkGeoms,
  groupRoadNetworkRows,
  type RoadNetworkRowGroup,
} from "./roadNetworkGroup";
import {
  clearRoadNetworkUnifiedCql,
  clearRoadNetworkWmsLayers,
  ensureRoadNetworkWmsLayers,
  syncRoadNetworkLayerCql,
  syncRoadNetworkUnifiedCql,
} from "./roadNetworkMapSync";
import { buildRoadNetworkSharedTableCql } from "./roadNetworkLayerId";
import { useRoadNetworkSourceMode } from "./useRoadNetworkSourceMode";
import { useRoadNetworkUnopenedSignLayer } from "./useRoadNetworkUnopenedSignLayer";
import {
  buildRoadNetworkUnifiedLineCql,
  buildRoadNetworkUnifiedSignCql,
  type RoadNetworkSignIndexItem,
} from "./roadNetworkGrade";
import {
  ROAD_NETWORK_NEW_ID,
  ROAD_NETWORK_OPEN_STATUS_FILTERS,
  ROAD_NETWORK_TYPE_BADGE,
  ROAD_NETWORK_TYPE_FILTERS,
  createEmptyRoadNetworkRow,
  isNewRoadNetworkRowId,
  matchesRoadNetworkTypeFilter,
  matchesRoadNetworkTypeSelection,
  type RoadNetworkOpenStatusFilter,
  type RoadNetworkRow,
  type RoadNetworkTypeSelection,
} from "./roadNetworkMock";

const EMPTY_ROWS: RoadNetworkRow[] = [];
const LIST_FIT_PADDING = [80, 80, 80, 80] as const;
const LIST_FIT_MAX_ZOOM = Math.min(16, MAP_AUTO_NAV_MAX_ZOOM);

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

export function RoadNetworkListPanel({ onClose }: Props) {
  const { data: session } = useSession();
  const historyUser =
    session?.user?.name?.trim() ||
    (session?.user?.id === "su" ? "슈퍼관리자" : "") ||
    session?.user?.id ||
    "미확인";

  const mapContext = useMapContext();
  const rows = mapContext?.roadNetworkRows ?? EMPTY_ROWS;
  const selectedId = mapContext?.roadNetworkSelectedId ?? null;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt;
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setServiceWmsCqlByLayer = mapContext?.setServiceWmsCqlByLayer;
  const sourceMode = useRoadNetworkSourceMode();
  const setRoadNetworkOverlayRows = mapContext?.setRoadNetworkOverlayRows;
  const setRoadNetworkRows = mapContext?.setRoadNetworkRows;
  const setRoadNetworkSelectedId = mapContext?.setRoadNetworkSelectedId;
  const setRoadNetworkWholeRoad = mapContext?.setRoadNetworkWholeRoad;
  const [keyword, setKeyword] = useState("");
  /** 종류 중복 선택 — 빈 배열이면 전체 */
  const [typeFilter, setTypeFilter] = useState<RoadNetworkTypeSelection>([]);
  const [openStatusFilter, setOpenStatusFilter] =
    useState<RoadNetworkOpenStatusFilter>("전체");
  const [spatialWkt, setSpatialWkt] = useState<string | null>(null);
  const [activeSpatialTool, setActiveSpatialTool] = useState<SpatialTool | null>(
    null
  );
  const [mapSearchTab, setMapSearchTab] = useState<SearchTab>("keyword");
  const [boundaryBadges, setBoundaryBadges] = useState<BoundaryBadgeItem[]>([]);
  const [emdSelected, setEmdSelected] = useState("");
  const [riSelected, setRiSelected] = useState("");
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>(
    []
  );
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>(
    []
  );
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const listLoadSeqRef = useRef(0);

  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;
  const isSpatialActive = !!(spatialWkt || spatialDrawRequest);

  /** 자료가 있는 종류 탭만 (목록 로드 전에는 전부) */
  const visibleTypeFilters = useMemo(() => {
    const saved = rows.filter((r) => !isNewRoadNetworkRowId(r.id));
    if (saved.length === 0) return ROAD_NETWORK_TYPE_FILTERS;
    return ROAD_NETWORK_TYPE_FILTERS.filter(
      (f) => f === "전체" || saved.some((r) => matchesRoadNetworkTypeFilter(r.roadType, f))
    );
  }, [rows]);
  const activeTypeFilter = useMemo<RoadNetworkTypeSelection>(
    () => typeFilter.filter((f) => visibleTypeFilters.includes(f)),
    [typeFilter, visibleTypeFilters]
  );
  const toggleTypeFilter = useCallback((filter: (typeof visibleTypeFilters)[number]) => {
    if (filter === "전체") {
      setTypeFilter([]);
      return;
    }
    setTypeFilter((prev) =>
      prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
    );
  }, []);

  const reloadList = useCallback(async () => {
    const seq = ++listLoadSeqRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const res = await call("", "POST", {
        service: "roadNetworkService",
        action: "getRoadNetworkList",
        params: {},
      });
      if (seq !== listLoadSeqRef.current) return;
      const data = res?.data ?? res;
      const next = Array.isArray(data?.rows) ? data.rows : [];
      // API 목록으로 덮되, 미저장·로컬 추가 행은 유지 (로드 중 추가 시 사라짐 방지)
      setRoadNetworkRows?.((prev) => {
        const clientRows = prev.filter(
          (r) => isNewRoadNetworkRowId(r.id) || String(r.id).startsWith("local-")
        );
        return [...clientRows, ...next];
      });
    } catch (e: unknown) {
      if (seq !== listLoadSeqRef.current) return;
      setListError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      if (seq === listLoadSeqRef.current) setListLoading(false);
    }
  }, [setRoadNetworkRows]);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  /** 통합 도로망 표지 점 — 종류 필터용 id 목록 */
  const [signIndex, setSignIndex] = useState<RoadNetworkSignIndexItem[]>([]);
  useEffect(() => {
    if (sourceMode !== "unified") return;
    let cancelled = false;
    void call("", "POST", {
      service: "roadNetworkService",
      action: "getRoadNetworkSignIndex",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setSignIndex(Array.isArray(data?.signs) ? data.signs : []);
      })
      .catch(() => {
        if (!cancelled) setSignIndex([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceMode]);

  const unifiedCql = useMemo(() => {
    if (sourceMode !== "unified") return { line: null, sign: null };
    const opts = { typeFilter: activeTypeFilter, openStatusFilter };
    return {
      line: buildRoadNetworkUnifiedLineCql(rows, opts),
      sign: buildRoadNetworkUnifiedSignCql(signIndex, rows, opts),
    };
  }, [sourceMode, rows, signIndex, activeTypeFilter, openStatusFilter]);

  /** 군도 표에 섞인 면도·리도 — 종류 필터 시 해당 피처만 그림 */
  const sharedTableCql = useMemo(
    () =>
      buildRoadNetworkSharedTableCql(
        sourceMode === "legacy" ? rows : EMPTY_ROWS,
        sourceMode === "legacy" ? activeTypeFilter : []
      ),
    [sourceMode, rows, activeTypeFilter]
  );

  const [showSigns, setShowSigns] = useState(true);
  /** 표지 점은 개설 구간 기준으로 찍혀 있어 미개설 필터 때는 미개설 선 위에 표지를 직접 그린다 */
  const signsOnUnopenedLines =
    sourceMode === "unified" && openStatusFilter === "미개설" && showSigns;

  /** GeoServer WMS — 종류·개설 필터에 맞는 레이어만 표시 (통합 도로망은 피처 id CQL로 거름) */
  useEffect(() => {
    if (!sourceMode) return;
    ensureRoadNetworkWmsLayers(
      setVisibleLayerNames,
      {
        typeFilter: activeTypeFilter,
        openStatusFilter,
        showSigns: showSigns && !signsOnUnopenedLines,
      },
      sourceMode
    );
    syncRoadNetworkUnifiedCql(setServiceWmsCqlByLayer, unifiedCql.line, unifiedCql.sign);
    syncRoadNetworkLayerCql(setServiceWmsCqlByLayer, sharedTableCql);
  }, [
    activeTypeFilter,
    openStatusFilter,
    showSigns,
    signsOnUnopenedLines,
    sourceMode,
    unifiedCql,
    sharedTableCql,
    setVisibleLayerNames,
    setServiceWmsCqlByLayer,
  ]);

  useEffect(() => {
    return () => {
      clearRoadNetworkWmsLayers(setVisibleLayerNames);
      clearRoadNetworkUnifiedCql(setServiceWmsCqlByLayer);
      syncRoadNetworkLayerCql(
        setServiceWmsCqlByLayer,
        buildRoadNetworkSharedTableCql(EMPTY_ROWS, [])
      );
    };
  }, [setVisibleLayerNames, setServiceWmsCqlByLayer]);

  /** 지도 WMS 클릭 → 목록 선택 */
  useEffect(() => {
    const pickRef = mapContext?.applyRoadNetworkMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const rowId = String(pick?.rowId ?? "").trim();
      if (!rowId) return;
      setRoadNetworkRows?.((prev) =>
        prev.filter((r) => !isNewRoadNetworkRowId(r.id))
      );
      setRoadNetworkSelectedId?.(rowId);
      setRoadNetworkWholeRoad?.(false);
    };
    return () => {
      pickRef.current = null;
    };
  }, [
    mapContext?.applyRoadNetworkMapPickRef,
    setRoadNetworkRows,
    setRoadNetworkSelectedId,
    setRoadNetworkWholeRoad,
  ]);

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
      const center3857 = transformCoordinate(
        [center.x, center.y],
        "EPSG:5181",
        "EPSG:3857"
      );
      if (!center3857) return;
      scheduleAnimateMapToCenter3857(
        map,
        center3857 as [number, number],
        map.getView().getZoom() ?? 14,
        {
          applyMapViewPadding: () =>
            mapContext?.applyMapViewPaddingRef?.current?.(),
        }
      );
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
      const label =
        riOptions.find((o) => o.code === riSelected)?.name ?? riSelected;
      const item: BoundaryBadgeItem = {
        key: `ri:${riSelected}`,
        kind: "ri",
        code: riSelected,
        label,
      };
      setBoundaryBadges((prev) =>
        prev.some((p) => p.key === item.key) ? prev : [...prev, item]
      );
      return;
    }
    if (emdSelected) {
      const label =
        emdOptions.find((o) => o.code === emdSelected)?.name ?? emdSelected;
      const item: BoundaryBadgeItem = {
        key: `emd:${emdSelected}`,
        kind: "emd",
        code: emdSelected,
        label,
      };
      setBoundaryBadges((prev) =>
        prev.some((p) => p.key === item.key) ? prev : [...prev, item]
      );
      return;
    }
    window.alert("읍면동 또는 리를 선택한 뒤 + 를 눌러 주세요.");
  }, [riSelected, emdSelected, riOptions, emdOptions]);

  const runBoundarySearch = useCallback(async () => {
    if (boundaryBadges.length === 0) {
      window.alert(
        "추가된 읍면동·리가 없습니다. 선택 후 + 를 눌러 추가하세요."
      );
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
          params:
            b.kind === "emd" ? { emdCode: b.code } : { riCode: b.code },
        });
        const data = res?.data ?? res;
        const w = data?.wkt != null ? String(data.wkt).trim() : "";
        if (w) {
          wktParts.push(w);
          const c = data?.center as
            | { x?: number; y?: number }
            | null
            | undefined;
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
        const uc = udata?.center as
          | { x?: number; y?: number }
          | null
          | undefined;
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

  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return filterRoadNetworkRowsByWkt5181(rows, spatialWkt)
      .filter((row) => {
        // 미저장 신규는 목록에 표시하지 않음
        if (isNewRoadNetworkRowId(row.id)) return false;
        if (!matchesRoadNetworkTypeSelection(row.roadType, activeTypeFilter)) return false;
        if (openStatusFilter !== "전체" && row.openStatus !== openStatusFilter) {
          return false;
        }
        if (!q) return true;
        const hay = [
          row.roadName,
          row.roadNo,
          row.roadType,
          row.roadGrade ?? "",
          row.address ?? "",
          row.openStatus ?? "",
          row.sect,
          row.dept,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      // 입체교차로는 목록 최하단
      .sort((a, b) => {
        const aBottom = a.roadType === "입체교차로" ? 1 : 0;
        const bBottom = b.roadType === "입체교차로" ? 1 : 0;
        return aBottom - bBottom;
      });
  }, [keyword, activeTypeFilter, openStatusFilter, rows, spatialWkt]);

  useRoadNetworkUnopenedSignLayer(
    mapContext?.mapInstanceRef?.current,
    items,
    signsOnUnopenedLines
  );

  /** 같은 노선번호 구간은 한 행 — 구간 구분은 상세 패널에서 */
  const groups = useMemo(() => groupRoadNetworkRows(items), [items]);

  /** 지도 도로명 라벨용 — 필터된 목록과 동일 */
  useEffect(() => {
    setRoadNetworkOverlayRows?.(items);
  }, [items, setRoadNetworkOverlayRows]);

  const handleAdd = () => {
    // 목록 행은 만들지 않고 상세 등록만 연다(저장 시 목록에 반영)
    setRoadNetworkRows?.((prev) => {
      const withoutDraft = prev.filter((r) => !isNewRoadNetworkRowId(r.id));
      const draft = createEmptyRoadNetworkRow(String(historyUser), ROAD_NETWORK_NEW_ID);
      if (sourceMode === "unified") {
        draft.roadGrade = "국도";
        draft.roadType = "국도";
      }
      return [draft, ...withoutDraft];
    });
    setRoadNetworkSelectedId?.(ROAD_NETWORK_NEW_ID);
    setRoadNetworkWholeRoad?.(false);
  };

  const handleSelectGroup = (group: RoadNetworkRowGroup) => {
    const first = group.rows[0];
    if (!first) return;
    setRoadNetworkRows?.((prev) => prev.filter((r) => !isNewRoadNetworkRowId(r.id)));
    // 대표 구간을 열고 구간은 미선택(노선 전체 강조) — 구간 선택은 상세에서
    setRoadNetworkSelectedId?.(first.id);
    setRoadNetworkWholeRoad?.(group.rows.length > 1);
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    const ext = extent3857FromRoadNetworkGeoms(group.rows.map((r) => r.geom));
    if (!ext) return;
    scheduleFitMapToExtent3857(map, ext, {
      fitPadding: [...LIST_FIT_PADDING],
      maxZoom: LIST_FIT_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };

  const handleExport = () => {
    if (items.length === 0) {
      window.alert("내보낼 목록이 없습니다.");
      return;
    }
    exportRoadNetworkExcel(items);
  };

  const spatialTools: { id: SpatialTool; label: string; icon: typeof Square }[] =
    [
      { id: "rectangle", label: "사각형", icon: Square },
      { id: "polygon", label: "다각형", icon: Pentagon },
      { id: "circle", label: "원형", icon: Circle },
    ];

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">도로망도</span>
        <div className="flex items-center gap-1">
          {sourceMode === "unified" ? (
            <LayerRowPanelButton
              type="button"
              onClick={() => setShowSigns((v) => !v)}
              title={showSigns ? "지도 노선번호 표지 끄기" : "지도 노선번호 표지 켜기"}
              aria-pressed={showSigns}
              className={cn(showSigns && "border-primary bg-primary/10 text-primary hover:bg-primary/15")}
            >
              <Signpost className="h-3 w-3 shrink-0" aria-hidden />
              번호표지
            </LayerRowPanelButton>
          ) : null}
          <LayerRowPanelButton type="button" onClick={handleExport} title="엑셀 내보내기">
            <Download className="h-3 w-3 shrink-0" aria-hidden />
            엑셀
          </LayerRowPanelButton>
          <LayerRowAddButton
            onClick={handleAdd}
            disabled={isNewRoadNetworkRowId(selectedId)}
          />
          <button
            type="button"
            onClick={() => {
              clearSpatial();
              clearBoundaryForm();
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
          <div className="space-y-1.5">
            <div className="flex items-stretch gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="도로명·도로번호·종류·관리기관"
                  className="h-8 w-full rounded border border-border pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                />
              </div>
              <div
                className="flex h-8 shrink-0 items-stretch gap-0.5"
                role="group"
                aria-label="개설 여부 필터"
                title="개설 여부"
              >
                {ROAD_NETWORK_OPEN_STATUS_FILTERS.map((filter) => {
                  const active = openStatusFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setOpenStatusFilter(filter)}
                      title={filter}
                      className={cn(
                        "rounded border px-1.5 text-[10px] font-medium leading-tight transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/50"
                      )}
                      aria-pressed={active}
                    >
                      {filter}
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className="flex w-full flex-nowrap gap-0.5"
              role="group"
              aria-label="도로 종류 필터"
            >
              {visibleTypeFilters.map((filter) => {
                const active =
                  filter === "전체"
                    ? activeTypeFilter.length === 0
                    : activeTypeFilter.includes(filter);
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => toggleTypeFilter(filter)}
                    title={filter}
                    className={cn(
                      "flex-auto whitespace-nowrap rounded border px-1 py-1 text-center text-[10px] font-medium leading-tight transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/50"
                    )}
                    aria-pressed={active}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
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
              title={spatialWkt ? "공간 필터 해제" : "검색 초기화"}
              onClick={clearSpatial}
              className={cn(
                "flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border py-1.5 transition-colors",
                spatialWkt
                  ? "border-chart-4/50 bg-background text-chart-4 hover:border-chart-4"
                  : "border-border bg-background text-muted-foreground hover:border-border hover:text-primary"
              )}
            >
              <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="text-[10px]">{spatialWkt ? "해제" : "초기화"}</span>
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
                      onClick={() =>
                        setBoundaryBadges((prev) =>
                          prev.filter((x) => x.key !== b.key)
                        )
                      }
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
          <span>
            목록 {groups.length}건
            {groups.length !== items.length ? ` · 구간 ${items.length}개` : ""}
          </span>
          {isSpatialActive ? (
            <button
              type="button"
              onClick={clearSpatial}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-chart-4 hover:text-chart-4/80"
            >
              <X className="h-3 w-3" />
              범위 적용 중 · 해제
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {listLoading ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">불러오는 중...</p>
        ) : listError ? (
          <p className="px-3 py-2.5 text-xs text-destructive">{listError}</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col />
              <col className="w-[5.75rem]" />
            </colgroup>
            <tbody>
              {groups.map((group) => {
                const item = group.rows[0]!;
                const segCount = group.rows.length;
                const titleLine = formatRoadNetworkListTitle(item);
                const hasName = Boolean(item.roadName.trim());
                const isSelected = group.rows.some((r) => r.id === selectedId);
                const badge = ROAD_NETWORK_TYPE_BADGE[item.roadType];
                const rightText = segCount > 1 ? `${segCount}구간` : item.dept || "—";
                return (
                  <tr
                    key={group.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectGroup(group)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectGroup(group);
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
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                            item.roadType === "입체교차로"
                              ? "max-w-[5.5rem] truncate"
                              : "w-[3.5rem]",
                            badge.bg,
                            badge.text,
                            badge.border
                          )}
                          title={item.roadType}
                        >
                          {item.roadType}
                        </span>
                        <p
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm font-medium leading-tight",
                            hasName ? "text-foreground" : "text-muted-foreground"
                          )}
                          title={titleLine}
                        >
                          {titleLine}
                        </p>
                      </div>
                    </td>
                    <td
                      className="min-w-0 px-3 py-2.5 pl-1.5 text-right text-[11px] text-muted-foreground"
                      title={segCount > 1 ? `같은 번호 구간 ${segCount}개` : item.dept || undefined}
                    >
                      <span className="block truncate">{rightText}</span>
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
