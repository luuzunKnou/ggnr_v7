"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fromLonLat } from "ol/proj";
import { call } from "@/lib/api";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { RADIATION_SHELTER_GEO_TABLE } from "../../../_mapComponents/layerFactory/safetydataMapLayerFactory";
import type { RadiationShelterListItem } from "@/service/radiationShelterService";
import { useRadiationShelterMapHighlight } from "./useRadiationShelterMapHighlight";
import { SafetyLayerListTable } from "../SafetyLayerListTable";
import { useSafetyLayerListColumns } from "../useSafetyLayerListColumns";

type Props = {
  onClose: () => void;
};

export function RadiationShelterPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const mapReady = mapContext?.mapReady ?? false;
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const [items, setItems] = useState<RadiationShelterListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selected, setSelected] = useState<RadiationShelterListItem | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const { columns, columnsLoading } = useSafetyLayerListColumns("radiation_shelter");

  useRadiationShelterMapHighlight(mapReady, selected);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
    return () => clearTimeout(t);
  }, [keyword]);

  const fetchList = useCallback(async (kw?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "radiationShelterService",
        action: "list",
        params: { keyword: kw ?? "", limit: 200 },
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

  useEffect(() => {
    void fetchList(debouncedKeyword);
  }, [debouncedKeyword, fetchList]);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => ({ ...prev, [RADIATION_SHELTER_GEO_TABLE]: true }));
    return () => {
      setVis((prev) => ({ ...prev, [RADIATION_SHELTER_GEO_TABLE]: false }));
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

  const totalCount = useMemo(() => items.length, [items.length]);

  const onClickRow = useCallback(
    (row: RadiationShelterListItem) => {
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
        <span className="standard-panel-title">방사선 대피소</span>
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
            placeholder="시설명·주소 검색"
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
            emptyMessage="표시할 방사선 대피소가 없습니다."
            selectedId={selected?.id ?? null}
            getRowId={(row) => row.id}
            onRowClick={onClickRow}
            rowDataAttr="data-radiation-shelter-row"
          />
        </div>
        <div className="standard-list-footer">{totalCount.toLocaleString()}건</div>
      </div>
    </div>
  );
}
