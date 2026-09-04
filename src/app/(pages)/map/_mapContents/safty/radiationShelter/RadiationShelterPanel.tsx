"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, RefreshCw, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { RADIATION_SHELTER_GEO_TABLE, refreshSafetyMapGeoLayer } from "../../../_mapComponents/layerFactory/safetydataMapLayerFactory";
import { LAYER_ROW_NEW_ID } from "../../../_mapComponents/layerRowEdit";
import { LayerRowAddButton } from "../../../_mapComponents/layerRowEdit/LayerRowAddButton";
import type { RadiationShelterListItem } from "@/service/radiationShelterService";
import { useRadiationShelterMapHighlight } from "./useRadiationShelterMapHighlight";
import { useRadiationShelterMapClick } from "./useRadiationShelterMapClick";
import { SafetyLayerListTable } from "../SafetyLayerListTable";
import { useSafetyLayerListColumns } from "../useSafetyLayerListColumns";
import {
  initialRadiationShelterSortDir,
  sortRadiationShelterListRows,
  toggleRadiationShelterSort,
  type RadiationShelterListSortSpec,
} from "./radiationShelterListSort";
import { formatRadiationShelterAddressDisplay } from "./radiationShelterAddressDisplay";
import { flyToRadiationShelterRow } from "./radiationShelterMapFly";
import {
  applyRadiationShelterLayerCql,
} from "./radiationShelterLayerCql";
import { buildSafetyLayerIdInCql } from "../applySafetyMapGeoLayerCql";
import { usePublicLayerAddressPrefixes } from "../usePublicLayerAddressPrefixes";

type DetailId = number | typeof LAYER_ROW_NEW_ID | null;

type Props = {
  onClose: () => void;
  selectedDetailId: DetailId;
  onSelectDetailId: (id: DetailId) => void;
  listRefreshKey?: number;
};

export function RadiationShelterPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  listRefreshKey = 0,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const mapReady = mapContext?.mapReady ?? false;
  const lastFlownDetailIdRef = useRef<number | null>(null);
  const [items, setItems] = useState<RadiationShelterListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [emdFilter, setEmdFilter] = useState("");
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [sorts, setSorts] = useState<RadiationShelterListSortSpec[]>([]);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const { columns, columnsLoading } = useSafetyLayerListColumns("radiation_shelter");
  const addressPrefixes = usePublicLayerAddressPrefixes();

  const selectedRow = useMemo(() => {
    if (selectedDetailId == null || selectedDetailId === LAYER_ROW_NEW_ID) return null;
    return items.find((r) => r.id === selectedDetailId) ?? null;
  }, [items, selectedDetailId]);

  useRadiationShelterMapHighlight(mapReady, selectedRow);

  useRadiationShelterMapClick({
    mapReady,
    panelOpen: true,
    items,
    onSelectDetailId: (id) => onSelectDetailId(id),
  });

  useEffect(() => {
    let cancelled = false;
    void call("", "POST", {
      service: "devTestService",
      action: "getEmdRiOptions",
      params: { schema: "public_layer" },
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

  const fetchList = useCallback(async (kw?: string, emdCode?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "radiationShelterService",
        action: "list",
        params: {
          keyword: kw ?? "",
          emdCode: emdCode ?? "",
          limit: 200,
        },
      });
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.items) ? (data.items as RadiationShelterListItem[]) : [];
      setItems(rows);
    } catch (e: unknown) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const emdFilterCode = useMemo(
    () => (!emdFilter ? "" : (emdOptions.find((o) => o.name === emdFilter)?.code ?? "").trim()),
    [emdFilter, emdOptions]
  );

  useEffect(() => {
    void fetchList(appliedKeyword, emdFilterCode);
  }, [appliedKeyword, emdFilterCode, fetchList, listRefreshKey]);

  /** 목록 필터와 동일 건만 WMS 표시 — 목록 id로 CQL (경계 WKT GET 실패·전체 잔상 방지) */
  useEffect(() => {
    if (!mapReady) return;
    const mapInst = mapContextRef.current?.mapInstanceRef?.current ?? null;
    const hasFilter =
      appliedKeyword.trim().length > 0 || emdFilterCode.trim().length > 0;

    if (!hasFilter) {
      applyRadiationShelterLayerCql(mapInst, null);
      return;
    }
    if (loading) return;

    applyRadiationShelterLayerCql(
      mapInst,
      buildSafetyLayerIdInCql(items.map((r) => r.id))
    );
  }, [mapReady, appliedKeyword, emdFilterCode, items, loading]);

  useEffect(() => {
    return () => {
      const mapInst = mapContextRef.current?.mapInstanceRef?.current ?? null;
      applyRadiationShelterLayerCql(mapInst, null);
    };
  }, []);

  useEffect(() => {
    if (!listRefreshKey) return;
    const map = mapContext?.mapInstanceRef?.current ?? null;
    refreshSafetyMapGeoLayer(map, RADIATION_SHELTER_GEO_TABLE);
  }, [listRefreshKey, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => ({ ...prev, [RADIATION_SHELTER_GEO_TABLE]: true }));
    return () => {
      setVis((prev) => ({ ...prev, [RADIATION_SHELTER_GEO_TABLE]: false }));
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

  const sortedItems = useMemo(
    () => sortRadiationShelterListRows(items, sorts, columns),
    [items, sorts, columns]
  );

  const totalCount = useMemo(() => items.length, [items.length]);
  const capacitySum = useMemo(
    () =>
      sortedItems.reduce((sum, row) => {
        const n = row.actcTnop;
        return sum + (n != null && Number.isFinite(n) ? n : 0);
      }, 0),
    [sortedItems]
  );
  const showSearchClear = keyword.trim().length > 0 || appliedKeyword.length > 0;

  const applySearch = useCallback(() => {
    setAppliedKeyword(keyword.trim());
  }, [keyword]);

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      applySearch();
    },
    [applySearch]
  );

  const handleClearSearch = useCallback(() => {
    setKeyword("");
    setAppliedKeyword("");
  }, []);

  const handleResetFilters = useCallback(() => {
    setKeyword("");
    setAppliedKeyword("");
    setEmdFilter("");
  }, []);

  const toggleSort = useCallback(
    (fieldKey: string) => {
      setSorts((prev) => toggleRadiationShelterSort(prev, fieldKey, columns));
    },
    [columns]
  );

  const applyMapViewPadding = useCallback(
    () => mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
    []
  );

  const flyToRow = useCallback(
    (row: RadiationShelterListItem | null | undefined) => {
      const map = mapContextRef.current?.mapInstanceRef?.current ?? null;
      flyToRadiationShelterRow(map, row, applyMapViewPadding);
    },
    [applyMapViewPadding]
  );

  /** 상세 선택(목록·지도 식별) 시 패널 padding 반영 후 좌표로 이동 */
  useEffect(() => {
    if (!mapReady) return;
    if (selectedDetailId == null || selectedDetailId === LAYER_ROW_NEW_ID) {
      lastFlownDetailIdRef.current = null;
      return;
    }
    if (lastFlownDetailIdRef.current === selectedDetailId) return;
    const row = items.find((r) => r.id === selectedDetailId) ?? null;
    if (!row) return;
    lastFlownDetailIdRef.current = selectedDetailId;
    flyToRow(row);
  }, [mapReady, selectedDetailId, items, flyToRow]);

  const onClickRow = useCallback(
    (row: RadiationShelterListItem) => {
      if (selectedDetailId === row.id) {
        lastFlownDetailIdRef.current = null;
        flyToRow(row);
        return;
      }
      lastFlownDetailIdRef.current = null;
      onSelectDetailId(row.id);
    },
    [selectedDetailId, onSelectDetailId, flyToRow]
  );

  const selectedListId =
    selectedDetailId != null && selectedDetailId !== LAYER_ROW_NEW_ID
      ? selectedDetailId
      : null;

  const listCellDisplayFormatters = useMemo(
    () => ({
      addr: (_raw: unknown, display: string) =>
        formatRadiationShelterAddressDisplay(display, addressPrefixes),
    }),
    [addressPrefixes]
  );

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">방사선 대피소</span>
        <div className="flex shrink-0 items-center gap-1">
          <LayerRowAddButton
            onClick={() => onSelectDetailId(LAYER_ROW_NEW_ID)}
            disabled={selectedDetailId === LAYER_ROW_NEW_ID}
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

      <div className="standard-filter-section space-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className="standard-search-wrap relative min-w-0 flex-1">
            <Search className="standard-search-icon" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="통합 검색 (Enter)"
              title="통합 검색 (Enter)"
              className={cn(
                "standard-search-input [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
                showSearchClear ? "pr-7" : undefined
              )}
            />
            {showSearchClear ? (
              <button
                type="button"
                title="검색어 초기화"
                aria-label="검색어 초기화"
                onClick={handleClearSearch}
                className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            title="초기화"
            aria-label="초기화"
            onClick={handleResetFilters}
            className="inline-flex h-[34px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted/50"
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            초기화
          </button>
        </div>
        <div
          role="radiogroup"
          aria-label="읍·면·동 필터"
          className="flex flex-wrap gap-1.5"
        >
          <button
            type="button"
            role="radio"
            title="읍·면·동 전체"
            aria-checked={!emdFilter}
            onClick={() => setEmdFilter("")}
            className={cn(
              "inline-flex cursor-pointer items-center rounded px-2.5 py-1.5 text-[10px] font-medium leading-tight transition-colors",
              !emdFilter
                ? "border border-primary/40 bg-primary/14 text-primary"
                : "border border-border bg-background text-muted-foreground hover:border-border"
            )}
          >
            전체
          </button>
          {emdOptions.map((opt) => {
            const active = emdFilter === opt.name;
            return (
              <button
                key={opt.code}
                type="button"
                role="radio"
                title={opt.name}
                aria-checked={active}
                onClick={() => setEmdFilter(opt.name)}
                className={cn(
                  "inline-flex cursor-pointer items-center rounded px-2.5 py-1.5 text-[10px] font-medium leading-tight transition-colors",
                  active
                    ? "border border-primary/40 bg-primary/14 text-primary"
                    : "border border-border bg-background text-muted-foreground hover:border-border"
                )}
              >
                {opt.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="standard-list-body">
        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div ref={listScrollRef} className="standard-list-scroll">
          <SafetyLayerListTable
            columns={columns}
            items={sortedItems}
            loading={loading || columnsLoading}
            emptyMessage="표시할 방사선 대피소가 없습니다."
            selectedId={selectedListId}
            getRowId={(row) => row.id}
            onRowClick={onClickRow}
            rowDataAttr="data-radiation-shelter-row"
            sorts={sorts}
            onToggleSort={toggleSort}
            initialSortDir={(key) => initialRadiationShelterSortDir(key, columns)}
            columnWidthWeights={{ ftn_nm: 38, addr: 42, actc_tnop: 20 }}
            columnTextAlign={{ actc_tnop: 'right' }}
            cellDisplayFormatters={listCellDisplayFormatters}
          />
        </div>
        <div className="standard-list-footer flex items-center justify-between gap-2">
          <span>총 {totalCount.toLocaleString()}건</span>
          <span>수용인원 합계: {capacitySum.toLocaleString('ko-KR')}</span>
        </div>
      </div>
    </div>
  );
}
