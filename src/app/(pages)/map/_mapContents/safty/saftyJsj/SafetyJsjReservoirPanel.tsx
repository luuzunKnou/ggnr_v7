"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Droplets, Loader2, MapPin, X } from "lucide-react";
import { fromLonLat } from "ol/proj";
import { call } from "@/lib/api";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { SAFETY_RESERVOIR_MASTER_GEO_TABLE } from "../../../_mapComponents/layerFactory/safetydataMapLayerFactory";

type ReservoirRow = {
  rsrvrCd: string;
  rsrvrNm: string;
  basinAddr: string;
  msrnDt: string;
  lole: string;
  pondage: string;
  wrerates: string;
  lon: number | null;
  lat: number | null;
};

type Props = {
  onClose: () => void;
};

export function SafetyJsjReservoirPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const [items, setItems] = useState<ReservoirRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "integrationService",
        action: "fetchSafetyReservoirStateList",
        params: { limit: 2000 },
      });
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.items) ? data.items : [];
      const parsed: ReservoirRow[] = rows.map((r: Record<string, unknown>) => ({
        rsrvrCd: String(r.rsrvrCd ?? "-"),
        rsrvrNm: String(r.rsrvrNm ?? "-"),
        basinAddr: String(r.basinAddr ?? "-"),
        msrnDt: String(r.msrnDt ?? "-"),
        lole: String(r.lole ?? "-"),
        pondage: String(r.pondage ?? "-"),
        wrerates: String(r.wrerates ?? "-"),
        lon: typeof r.lon === "number" && Number.isFinite(r.lon) ? r.lon : null,
        lat: typeof r.lat === "number" && Number.isFinite(r.lat) ? r.lat : null,
      }));
      setItems(parsed);
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

  /** 패널 열림: 저수지 제원 GeoServer WMS, 닫힘 시 끔 (병상정보 패널과 동일) */
  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => ({ ...prev, [SAFETY_RESERVOIR_MASTER_GEO_TABLE]: true }));
    return () => {
      setVis((prev) => ({ ...prev, [SAFETY_RESERVOIR_MASTER_GEO_TABLE]: false }));
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

  const selectedCount = useMemo(() => items.length, [items.length]);

  const onClickRow = useCallback(
    (row: ReservoirRow) => {
      const key = `${row.rsrvrCd}|${row.rsrvrNm}`;
      setSelectedKey(key);
      if (!map || row.lon == null || row.lat == null) return;
      const center = fromLonLat([row.lon, row.lat]);
      map.getView().animate({
        center,
        zoom: Math.max(map.getView().getZoom() ?? 13, 13),
        duration: 450,
      });
    },
    [map]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-800">저수지 수위</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              저수지 제원과 최신 10분 계측(IF-20286)을 RSRVR_CD로 조인하며, 계측 행이 있는 저수지만 목록에 포함됩니다.
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-primary/90">목록 {selectedCount}건</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
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
            표시할 저수지 정보가 없습니다.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((row, idx) => {
              const key = `${row.rsrvrCd}|${row.rsrvrNm}`;
              const active = key === selectedKey;
              return (
                <li key={`${key}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => onClickRow(row)}
                    className={`w-full rounded border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/5"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-slate-900">{row.rsrvrNm}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{row.rsrvrCd}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                        <MapPin className="h-3 w-3" />
                        {row.lon != null && row.lat != null ? "지도 이동" : "위치 없음"}
                      </span>
                    </div>
                    {row.basinAddr !== "-" ? (
                      <p className="mt-1 truncate text-[11px] text-slate-600">{row.basinAddr}</p>
                    ) : null}
                    <div className="mt-2 space-y-1 text-[11px]">
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                        <p className="text-[10px] text-slate-500">계측일시(최신, MSRN_DT)</p>
                        <p className="font-medium text-slate-800">{row.msrnDt}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <p className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                            <Droplets className="h-3 w-3" />
                            저수위
                          </p>
                          <p className="font-medium text-slate-800">{row.lole}</p>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <p className="text-[10px] text-slate-500">저수량</p>
                          <p className="font-medium text-slate-800">{row.pondage}</p>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <p className="text-[10px] text-slate-500">저수율</p>
                          <p className="font-medium text-slate-800">{row.wrerates}</p>
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
        항목 클릭 시 해당 저수지 위치로 지도를 이동합니다. 레이어는 패널을 닫으면 꺼집니다.
      </div>
    </div>
  );
}
