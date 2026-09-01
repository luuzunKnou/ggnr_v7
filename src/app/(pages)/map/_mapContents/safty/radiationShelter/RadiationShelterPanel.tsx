"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { fromLonLat } from "ol/proj";
import { call } from "@/lib/api";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { RADIATION_SHELTER_GEO_TABLE } from "../../../_mapComponents/layerFactory/safetydataMapLayerFactory";
import type { RadiationShelterListItem } from "@/service/radiationShelterService";
import { useRadiationShelterMapHighlight } from "./useRadiationShelterMapHighlight";

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
  const [selected, setSelected] = useState<RadiationShelterListItem | null>(null);

  useRadiationShelterMapHighlight(mapReady, selected);

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
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => ({ ...prev, [RADIATION_SHELTER_GEO_TABLE]: true }));
    return () => {
      setVis((prev) => ({ ...prev, [RADIATION_SHELTER_GEO_TABLE]: false }));
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

  const totalCount = useMemo(() => items.length, [items.length]);

  const onSearch = useCallback(() => {
    void fetchList(keyword.trim());
  }, [fetchList, keyword]);

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
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[12px] font-semibold leading-tight text-slate-800">방사선 대피소</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              시설명·주소·수용인원 목록입니다. 행을 클릭하면 지도에서 위치를 확인합니다.
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-primary/90">총 {totalCount}건</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch();
            }}
            placeholder="시설명·주소 검색"
            className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-[12px]"
          />
          <button
            type="button"
            onClick={onSearch}
            className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            title="검색"
          >
            <Search className="h-3.5 w-3.5" />
            검색
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50/70 p-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            목록 불러오는 중...
          </div>
        ) : error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : items.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            표시할 방사선 대피소가 없습니다.
          </div>
        ) : (
          <ul className="space-y-0">
            {items.map((row) => {
              const active = selected?.id === row.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onClickRow(row)}
                    className={`w-full cursor-pointer border-b border-border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]"
                        : "border-l-[3px] border-l-transparent hover:bg-slate-100"
                    }`}
                    title={`${row.ftnNm} — ${row.addr}`}
                  >
                    <p className="text-[12px] font-semibold text-slate-900 truncate">{row.ftnNm}</p>
                    <p className="mt-0.5 flex items-start gap-1 text-[11px] text-slate-600">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="line-clamp-2">{row.addr}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      수용인원 {row.actcTnop != null ? `${row.actcTnop}명` : "-"}
                      {row.remark && row.remark !== "-" ? ` · ${row.remark}` : ""}
                    </p>
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
