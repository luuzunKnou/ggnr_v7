"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fromLonLat } from "ol/proj";
import { call } from "@/lib/api";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { WATER_PLAY_SIGN_GEO_TABLE } from "../../../_mapComponents/layerFactory/safetydataMapLayerFactory";
import type { WaterPlaySignListItem } from "@/service/waterPlaySignService";
import { useWaterPlaySignMapHighlight } from "./useWaterPlaySignMapHighlight";
import { SafetyLayerListTable } from "../SafetyLayerListTable";
import { useSafetyLayerListColumns } from "../useSafetyLayerListColumns";

type Props = {
  onClose: () => void;
};

export function WaterPlaySignPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const mapReady = mapContext?.mapReady ?? false;
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const [items, setItems] = useState<WaterPlaySignListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selected, setSelected] = useState<WaterPlaySignListItem | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const { columns, columnsLoading } = useSafetyLayerListColumns("water_play_sign");

  useWaterPlaySignMapHighlight(mapReady, selected);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
    return () => clearTimeout(t);
  }, [keyword]);

  const fetchList = useCallback(async (kw?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "waterPlaySignService",
        action: "list",
        params: { keyword: kw ?? "", limit: 200 },
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
    void fetchList(debouncedKeyword);
  }, [debouncedKeyword, fetchList]);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => ({ ...prev, [WATER_PLAY_SIGN_GEO_TABLE]: true }));
    return () => {
      setVis((prev) => ({ ...prev, [WATER_PLAY_SIGN_GEO_TABLE]: false }));
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

  const totalCount = useMemo(() => items.length, [items.length]);

  const onClickRow = useCallback(
    (row: WaterPlaySignListItem) => {
      setSelected(row);
      if (!map) return;
      const g = row.geomJson;
      if (g && typeof g === "object" && "coordinates" in g) {
        const coords = (g as { coordinates?: number[] }).coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const center = fromLonLat([coords[0], coords[1]]);
          map.getView().animate({
            center,
            zoom: Math.max(map.getView().getZoom() ?? 15, 15),
            duration: 450,
          });
        }
      }
    },
    [map]
  );

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">물놀이 표지판</span>
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

      <div className="standard-filter-section">
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="주소·비고 검색"
            className="standard-search-input"
          />
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
            items={items}
            loading={loading || columnsLoading}
            emptyMessage="표시할 물놀이 표지판이 없습니다."
            selectedId={selected?.id ?? null}
            getRowId={(row) => row.id}
            onRowClick={onClickRow}
            rowDataAttr="data-water-play-sign-row"
          />
        </div>
        <div className="standard-list-footer">{totalCount.toLocaleString()}건</div>
      </div>
    </div>
  );
}
