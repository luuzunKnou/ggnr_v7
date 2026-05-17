"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID } from "./roadUseLedgerLayerId";

type DetailAttr = { field: string; label: string; value: string };
type ParcelItem = { address: string; extent3857: [number, number, number, number] | null };

type Props = {
  detailId: string;
  onClose: () => void;
};

export function RoadUseLedgerDetailPanel({ detailId, onClose }: Props) {
  const mapContext = useMapContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<DetailAttr[]>([]);
  const [parcels, setParcels] = useState<ParcelItem[]>([]);
  const [movingParcelIdx, setMovingParcelIdx] = useState<number | null>(null);

  const handleParcelClick = useCallback(
    async (item: ParcelItem, idx: number) => {
      const ext = item.extent3857;
      const map = mapContext?.mapInstanceRef?.current;
      if (!ext || !map) return;
      setMovingParcelIdx(idx);
      try {
        const lid = ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID.toLowerCase();
        mapContext?.setVisibleLayerNames?.((prev) => {
          if (prev.has(lid)) return prev;
          return new Set(prev).add(lid);
        });
        const [xmin, ymin, xmax, ymax] = ext;
        const view = map.getView();
        const w = Math.abs(xmax - xmin);
        const h = Math.abs(ymax - ymin);
        if (w < 2 && h < 2) {
          view.animate({
            center: [(xmin + xmax) / 2, (ymin + ymax) / 2],
            zoom: 16,
            duration: 450,
          });
        } else {
          view.fit([xmin, ymin, xmax, ymax], {
            padding: [80, 80, 80, 80],
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            duration: 500,
          });
        }
      } finally {
        setMovingParcelIdx(null);
      }
    },
    [mapContext]
  );

  useEffect(() => {
    let cancelled = false;
    const id = String(detailId ?? "").trim();
    if (!id) {
      setLoading(false);
      setError(null);
      setAttributes([]);
      setParcels([]);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await call("", "POST", {
          service: "roadUseLedgerService",
          action: "getRoadUseLedgerDetailById",
          params: { id },
        });
        const data = res?.data ?? res;
        if (cancelled) return;
        if (data?.error) {
          setAttributes([]);
          setParcels([]);
          setError(String(data.error));
          return;
        }
        setAttributes(Array.isArray(data?.attributes) ? data.attributes : []);
        const items = Array.isArray(data?.parcelItems)
          ? data.parcelItems
              .map((x: Record<string, unknown>) => {
                const address = String(x?.address ?? "").trim();
                const extRaw = x?.extent3857 as unknown;
                const extent3857 =
                  Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
                    ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
                    : null;
                if (!address) return null;
                return { address, extent3857 };
              })
              .filter((x: ParcelItem | null): x is ParcelItem => x != null)
          : [];
        if (items.length > 0) {
          setParcels(items);
        } else {
          const lines = Array.isArray(data?.parcels) ? data.parcels : [];
          setParcels(
            lines
              .map((line: unknown) => String(line ?? "").trim())
              .filter(Boolean)
              .map((address: string) => ({ address, extent3857: null }))
          );
        }
      } catch {
        if (!cancelled) {
          setAttributes([]);
          setParcels([]);
          setError("상세 정보를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">도로점용 상세</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="상세 닫기"
          aria-label="상세 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
            불러오는 중…
          </div>
        )}
        {!loading && error && (
          <div className="rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700">{error}</div>
        )}
        {!loading && !error && (
          <>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              상세 속성
            </div>
            <dl className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
              {attributes.length === 0 ? (
                <div className="px-2 py-3 text-slate-500">표시할 속성이 없습니다.</div>
              ) : (
                attributes.map((row) => (
                  <div key={row.field} className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
                    <dt className="shrink-0 font-medium text-slate-600">{row.label}</dt>
                    <dd className="min-w-0 break-words text-slate-800">{row.value}</dd>
                  </div>
                ))
              )}
            </dl>

            <div className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              필지목록
            </div>
            {parcels.length === 0 ? (
              <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-slate-500">
                등록된 필지가 없습니다.
              </div>
            ) : (
              <ul className="list-none space-y-0 rounded border border-slate-200 bg-white">
                {parcels.map((item, i) => (
                  <li
                    key={`${i}-${item.address.slice(0, 24)}`}
                    className="border-b border-slate-100 px-2 py-2 text-slate-800 last:border-b-0 break-words"
                  >
                    <button
                      type="button"
                      className={cn(
                        "w-full text-left text-slate-800 hover:text-primary",
                        "disabled:opacity-70 disabled:cursor-default"
                      )}
                      disabled={!item.extent3857}
                      onClick={() => void handleParcelClick(item, i)}
                      title={item.extent3857 ? "클릭 시 위치 이동" : "위치 정보 없음"}
                    >
                      <span className="mr-2 tabular-nums text-slate-400">{i + 1}.</span>
                      {item.address}
                      {movingParcelIdx === i && <span className="ml-2 text-[11px] text-slate-500">이동 중…</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
