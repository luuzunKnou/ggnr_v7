"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, RefreshCw, X, Download } from "lucide-react";
import { call } from "@/lib/api";
import type { DefineCodeRow } from "@/lib/defineLayerCodeDisplay";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  WATER_PLAY_SIGN_GEO_TABLE,
  refreshSafetyMapGeoLayer,
} from "../../../_mapComponents/layerFactory/safetydataMapLayerFactory";
import { LAYER_ROW_NEW_ID } from "../../../_mapComponents/layerRowEdit";
import { LayerRowAddButton } from "../../../_mapComponents/layerRowEdit/LayerRowAddButton";
import { LayerRowPanelButton } from "../../../_mapComponents/layerRowEdit/LayerRowPanelButton";
import type { WaterPlaySignListItem } from "@/service/waterPlaySignService";
import { useWaterPlaySignMapHighlight } from "./useWaterPlaySignMapHighlight";
import { useWaterPlaySignMapClick } from "./useWaterPlaySignMapClick";
import { SafetyLayerListTable } from "../SafetyLayerListTable";
import { useSafetyLayerListColumns } from "../useSafetyLayerListColumns";
import {
  initialWaterPlaySignSortDir,
  sortWaterPlaySignListRows,
  toggleWaterPlaySignSort,
  type WaterPlaySignListSortSpec,
} from "./waterPlaySignListSort";
import { formatWaterPlaySignAddressDisplay } from "./waterPlaySignAddressDisplay";
import { flyToWaterPlaySignRow } from "./waterPlaySignMapFly";
import { exportWaterPlaySignExcel } from "./waterPlaySignExcel";
import {
  applyWaterPlaySignLayerCql,
} from "./waterPlaySignLayerCql";
import { buildSafetyLayerIdInCql } from "../applySafetyMapGeoLayerCql";
import { usePublicLayerAddressPrefixes } from "../usePublicLayerAddressPrefixes";

type DetailId = number | typeof LAYER_ROW_NEW_ID | null;

type Props = {
  onClose: () => void;
  selectedDetailId: DetailId;
  onSelectDetailId: (id: DetailId) => void;
  listRefreshKey?: number;
};

const WATER_PLAY_SIGN_TABLE = "water_play_sign";
const GUBUN_CODE_KEY = `${WATER_PLAY_SIGN_TABLE}__gubun`;

export function WaterPlaySignPanel({
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
  const [items, setItems] = useState<WaterPlaySignListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [emdFilter, setEmdFilter] = useState("");
  const [riFilter, setRiFilter] = useState("");
  const [gubunFilter, setGubunFilter] = useState("");
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([]);
  const [gubunChipOptions, setGubunChipOptions] = useState<{ value: string; label: string }[]>(
    []
  );
  const [sorts, setSorts] = useState<WaterPlaySignListSortSpec[]>([]);
  const [exporting, setExporting] = useState(false);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const { columns, columnsLoading } = useSafetyLayerListColumns(WATER_PLAY_SIGN_TABLE);
  const addressPrefixes = usePublicLayerAddressPrefixes();

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/config/defineLayer/codes/${encodeURIComponent(GUBUN_CODE_KEY)}`)
      .then((r) => r.json())
      .then((body: { data?: DefineCodeRow[] }) => {
        if (cancelled) return;
        const codes = Array.isArray(body?.data) ? body.data : [];
        setGubunChipOptions(
          codes
            .map((c) => {
              const value = String(c.define_code_name ?? "").trim();
              const label = String(c.define_code_kor_name ?? c.define_code_name ?? "").trim();
              return value ? { value, label: label || value } : null;
            })
            .filter((o): o is { value: string; label: string } => o != null)
        );
      })
      .catch(() => {
        if (!cancelled) setGubunChipOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [listRefreshKey]);

  const selectedRow = useMemo(() => {
    if (selectedDetailId == null || selectedDetailId === LAYER_ROW_NEW_ID) return null;
    return items.find((r) => r.id === selectedDetailId) ?? null;
  }, [items, selectedDetailId]);

  useWaterPlaySignMapHighlight(mapReady, selectedRow);

  useWaterPlaySignMapClick({
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

  /** 읍면동 미선택 → 전체 리 / 선택 → emd_cd로 시작하는 ri_cd만 */
  useEffect(() => {
    let cancelled = false;
    if (emdFilter && emdOptions.length === 0) return;

    const emdCode = !emdFilter
      ? ""
      : (emdOptions.find((o) => o.name === emdFilter)?.code ?? "").trim();

    if (emdFilter && !emdCode) {
      setRiOptions([]);
      setRiFilter("");
      return;
    }

    void call("", "POST", {
      service: "devTestService",
      action: "getRiOptionsByEmd",
      params: { schema: "public_layer", emdCode },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const next = Array.isArray(data?.ri) ? (data.ri as { code: string; name: string }[]) : [];
        setRiOptions(next);
        setRiFilter((prev) => {
          if (!prev) return "";
          return next.some((o) => o.code === prev) ? prev : "";
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRiOptions([]);
          setRiFilter("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [emdFilter, emdOptions]);

  const emdFilterCode = useMemo(
    () => (!emdFilter ? "" : (emdOptions.find((o) => o.name === emdFilter)?.code ?? "").trim()),
    [emdFilter, emdOptions]
  );

  const fetchList = useCallback(async (kw?: string, emdCode?: string, gubun?: string, riCode?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "waterPlaySignService",
        action: "list",
        params: {
          keyword: kw ?? "",
          emdCode: emdCode ?? "",
          riCode: riCode ?? "",
          gubun: gubun ?? "",
          limit: 200,
        },
      });
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.items) ? (data.items as WaterPlaySignListItem[]) : [];
      setItems(rows);
    } catch (e: unknown) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList(appliedKeyword, emdFilterCode, gubunFilter, riFilter);
  }, [appliedKeyword, emdFilterCode, gubunFilter, riFilter, fetchList, listRefreshKey]);

  /** 목록 필터와 동일 건만 WMS 표시 — 목록 id로 CQL (경계 WKT GET 실패·전체 잔상 방지) */
  useEffect(() => {
    if (!mapReady) return;
    const mapInst = mapContextRef.current?.mapInstanceRef?.current ?? null;
    const hasFilter =
      appliedKeyword.trim().length > 0 ||
      emdFilterCode.trim().length > 0 ||
      riFilter.trim().length > 0 ||
      gubunFilter.trim().length > 0;

    if (!hasFilter) {
      applyWaterPlaySignLayerCql(mapInst, null);
      return;
    }
    if (loading) return;

    applyWaterPlaySignLayerCql(
      mapInst,
      buildSafetyLayerIdInCql(items.map((r) => r.id))
    );
  }, [mapReady, appliedKeyword, emdFilterCode, riFilter, gubunFilter, items, loading]);

  useEffect(() => {
    return () => {
      const mapInst = mapContextRef.current?.mapInstanceRef?.current ?? null;
      applyWaterPlaySignLayerCql(mapInst, null);
    };
  }, []);

  useEffect(() => {
    if (!listRefreshKey) return;
    const mapInst = mapContext?.mapInstanceRef?.current ?? null;
    refreshSafetyMapGeoLayer(mapInst, WATER_PLAY_SIGN_GEO_TABLE);
  }, [listRefreshKey, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => ({ ...prev, [WATER_PLAY_SIGN_GEO_TABLE]: true }));
    return () => {
      setVis((prev) => ({ ...prev, [WATER_PLAY_SIGN_GEO_TABLE]: false }));
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

  const sortedItems = useMemo(
    () => sortWaterPlaySignListRows(items, sorts, columns),
    [items, sorts, columns]
  );

  const totalCount = useMemo(() => sortedItems.length, [sortedItems.length]);
  const safeboxSum = useMemo(
    () =>
      sortedItems.reduce((sum, row) => {
        const n = row.safeboxCnt;
        return sum + (n != null && Number.isFinite(n) ? n : 0);
      }, 0),
    [sortedItems]
  );
  const signSum = useMemo(
    () =>
      sortedItems.reduce((sum, row) => {
        const n = row.signCnt;
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
    setRiFilter("");
    setGubunFilter("");
  }, []);

  const toggleSort = useCallback(
    (fieldKey: string) => {
      setSorts((prev) => toggleWaterPlaySignSort(prev, fieldKey, columns));
    },
    [columns]
  );

  const applyMapViewPadding = useCallback(
    () => mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
    []
  );

  const flyToRow = useCallback(
    (row: WaterPlaySignListItem | null | undefined) => {
      const map = mapContextRef.current?.mapInstanceRef?.current ?? null;
      flyToWaterPlaySignRow(map, row, applyMapViewPadding);
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
    (row: WaterPlaySignListItem) => {
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

  /** 화면 필터와 무관하게 전체 목록을 참고 서식으로 내려받기 */
  const handleExportExcel = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await call("", "POST", {
        service: "waterPlaySignService",
        action: "list",
        params: {
          keyword: "",
          emdNm: "",
          gubun: "",
          limit: 5000,
        },
      });
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.items) ? (data.items as WaterPlaySignListItem[]) : [];
      exportWaterPlaySignExcel(rows, addressPrefixes);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "명단 다운로드에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  }, [exporting, addressPrefixes]);

  const selectedListId =
    selectedDetailId != null && selectedDetailId !== LAYER_ROW_NEW_ID
      ? selectedDetailId
      : null;

  const listCellDisplayFormatters = useMemo(
    () => ({
      addr: (_raw: unknown, display: string) =>
        formatWaterPlaySignAddressDisplay(display, addressPrefixes),
    }),
    [addressPrefixes]
  );

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">물놀이 표지판</span>
        <div className="flex shrink-0 items-center gap-1">
          <LayerRowPanelButton
            type="button"
            onClick={() => void handleExportExcel()}
            title="명단 다운로드"
            disabled={exporting}
            loading={exporting}
          >
            <Download className="h-3 w-3 shrink-0" aria-hidden />
            명단 다운로드
          </LayerRowPanelButton>
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
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={emdFilter}
            onChange={(e) => setEmdFilter(e.target.value)}
            title="읍·면·동"
            className="standard-filter-select"
          >
            <option value="">읍·면·동 전체</option>
            {emdOptions.map((opt) => (
              <option key={opt.code} value={opt.name}>
                {opt.name}
              </option>
            ))}
          </select>
          <select
            value={riFilter}
            onChange={(e) => setRiFilter(e.target.value)}
            title="리"
            className="standard-filter-select"
          >
            <option value="">리 전체</option>
            {riOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.name}
              </option>
            ))}
          </select>
          {gubunChipOptions.length > 0 ? (
            <div
              role="radiogroup"
              aria-label="구분 필터"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
            >
              <button
                type="button"
                role="radio"
                title="구분 전체"
                aria-checked={!gubunFilter}
                onClick={() => setGubunFilter("")}
                className={cn(
                  "inline-flex cursor-pointer items-center rounded px-2.5 py-1.5 text-[10px] font-medium leading-tight transition-colors",
                  !gubunFilter
                    ? "border border-primary/40 bg-primary/14 text-primary"
                    : "border border-border bg-background text-muted-foreground hover:border-border"
                )}
              >
                구분 전체
              </button>
              {gubunChipOptions.map(({ value, label }) => {
                const active = gubunFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    title={label}
                    aria-checked={active}
                    onClick={() => setGubunFilter(value)}
                    className={cn(
                      "inline-flex cursor-pointer items-center rounded px-2.5 py-1.5 text-[10px] font-medium leading-tight transition-colors",
                      active
                        ? "border border-primary/40 bg-primary/14 text-primary"
                        : "border border-border bg-background text-muted-foreground hover:border-border"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
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
            emptyMessage="표시할 물놀이 표지판이 없습니다."
            selectedId={selectedListId}
            getRowId={(row) => row.id}
            onRowClick={onClickRow}
            rowDataAttr="data-water-play-sign-row"
            sorts={sorts}
            onToggleSort={toggleSort}
            initialSortDir={(key) => initialWaterPlaySignSortDir(key, columns)}
            columnWidthWeights={{
              addr: 30,
              addr_detail: 26,
              gubun: 12,
              safebox_cnt: 16,
              sign_cnt: 16,
            }}
            columnTextAlign={{ safebox_cnt: "right", sign_cnt: "right" }}
            cellDisplayFormatters={listCellDisplayFormatters}
          />
        </div>
        <div className="standard-list-footer flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
          <span>총 {totalCount.toLocaleString()}건</span>
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[11px]">
            <span>구조함 합계: {safeboxSum.toLocaleString("ko-KR")}</span>
            <span>표지판 합계: {signSum.toLocaleString("ko-KR")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
