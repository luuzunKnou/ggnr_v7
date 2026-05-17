'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Video, Loader2 } from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../../_mapComponents/MapContext';
import type { ItsCctvItem } from './itsCctvTypes';
import { RoadCctvHlsPlayer } from './RoadCctvHlsPlayer';

type Props = {
  onClose: () => void;
};

/** ITS CCTV API: HLS */
const CCTV_TYPE_HLS = '1';

type Wgs84Bbox = { minX: number; maxX: number; minY: number; maxY: number };

async function fetchCctvList(params: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  type: string;
  cctvType: string;
}): Promise<ItsCctvItem[]> {
  const sp = new URLSearchParams({
    minX: String(params.minX),
    maxX: String(params.maxX),
    minY: String(params.minY),
    maxY: String(params.maxY),
    type: params.type,
    cctvType: params.cctvType,
    getType: 'xml',
  });
  const res = await fetch(`/api/its/cctv?${sp.toString()}`);
  const data = (await res.json()) as { items?: ItsCctvItem[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return Array.isArray(data.items) ? data.items : [];
}

/** 고속도로(ex) + 국도(its) 병합. 동일 URL 또는 동일 좌표+명칭은 한 건만 유지 */
function mergeExAndIts(exList: ItsCctvItem[], itsList: ItsCctvItem[]): ItsCctvItem[] {
  const map = new Map<string, ItsCctvItem>();
  for (const it of [...exList, ...itsList]) {
    const url = it.cctvurl.trim();
    const dedupeKey =
      url ||
      `${Number(it.coordx).toFixed(5)}_${Number(it.coordy).toFixed(5)}_${it.cctvname.trim()}`;
    if (map.has(dedupeKey)) continue;
    map.set(dedupeKey, { ...it, key: dedupeKey });
  }
  return [...map.values()];
}

async function fetchMergedCctvList(params: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): Promise<ItsCctvItem[]> {
  const settled = await Promise.allSettled([
    fetchCctvList({ ...params, type: 'ex', cctvType: CCTV_TYPE_HLS }),
    fetchCctvList({ ...params, type: 'its', cctvType: CCTV_TYPE_HLS }),
  ]);
  const exList = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const itsList = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const merged = mergeExAndIts(exList, itsList);
  if (merged.length === 0) {
    const firstReject = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (firstReject) {
      const msg =
        firstReject.reason instanceof Error ? firstReject.reason.message : String(firstReject.reason);
      throw new Error(msg);
    }
  }
  return merged;
}

export function RoadCctvPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const setRoadCctvOverlay = mapContext?.setRoadCctvOverlay;
  const overlay = mapContext?.roadCctvOverlay;
  const underlayMode = mapContext?.roadCctvUnderlayMode ?? 'traffic';
  const setUnderlayMode = mapContext?.setRoadCctvUnderlayMode;
  const setRoadCctvExtentWgs84 = mapContext?.setRoadCctvExtentWgs84;
  const items = overlay?.items ?? [];
  const selectedKey = overlay?.selectedKey ?? null;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emdExtent, setEmdExtent] = useState<Wgs84Bbox | null>(null);
  const [emdExtentError, setEmdExtentError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  const selected = useMemo(
    () => items.find((x) => x.key === selectedKey) ?? null,
    [items, selectedKey]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: 'getEmdExtentWgs84',
          params: {},
        });
        if (cancelled) return;
        const d = res?.data ?? res;
        const err = d?.error;
        if (err || d?.minX == null || d?.maxX == null || d?.minY == null || d?.maxY == null) {
          setEmdExtentError(typeof err === 'string' ? err : 'emd 범위를 불러오지 못했습니다.');
          setEmdExtent(null);
          return;
        }
        setEmdExtent({
          minX: Number(d.minX),
          maxX: Number(d.maxX),
          minY: Number(d.minY),
          maxY: Number(d.maxY),
        });
        setEmdExtentError(null);
      } catch (e) {
        if (cancelled) return;
        setEmdExtentError(e instanceof Error ? e.message : String(e));
        setEmdExtent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** CCTV 목록·통행 타일이 동일 emd bbox(WGS84)를 쓰도록 컨텍스트에 반영 */
  useEffect(() => {
    if (!emdExtent) {
      setRoadCctvExtentWgs84?.(null);
      return;
    }
    setRoadCctvExtentWgs84?.(emdExtent);
  }, [emdExtent, setRoadCctvExtentWgs84]);

  const loadForExtent = useCallback(async () => {
    if (!setRoadCctvOverlay) return;
    if (!emdExtent) return;

    const gen = ++fetchGenRef.current;
    const { minX, maxX, minY, maxY } = emdExtent;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchMergedCctvList({
        minX,
        maxX,
        minY,
        maxY,
      });
      if (gen !== fetchGenRef.current) return;
      setRoadCctvOverlay((prev) => {
        const prevSk = prev?.selectedKey ?? null;
        const nextSk = prevSk && list.some((x) => x.key === prevSk) ? prevSk : null;
        return { items: list, selectedKey: nextSk };
      });
    } catch (e) {
      if (gen !== fetchGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setRoadCctvOverlay((prev) => {
        if (prev && prev.items.length > 0) return prev;
        return { items: [], selectedKey: null };
      });
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [setRoadCctvOverlay, emdExtent]);

  useEffect(() => {
    void loadForExtent();
  }, [loadForExtent]);

  const onSelectItem = useCallback(
    (it: ItsCctvItem) => {
      setRoadCctvOverlay?.((prev) => ({
        items: prev?.items ?? items,
        selectedKey: it.key,
      }));
      if (map) {
        const c = fromLonLat([it.coordx, it.coordy]);
        map.getView().animate({ center: c, zoom: Math.max(map.getView().getZoom() ?? 14, 14), duration: 350 });
      }
    },
    [map, setRoadCctvOverlay, items]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Video className="h-4 w-4 shrink-0 text-slate-600" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800">교통정보</h2>
            <p className="truncate text-[11px] text-slate-500">
              국가교통정보센터 CCTV 화상자료 및 교통소통정보
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2">
        {emdExtentError && (
          <p className="text-[10px] text-amber-800">{emdExtentError}</p>
        )}

        <fieldset className="space-y-1.5 rounded border border-slate-100 bg-slate-50/80 px-2 py-2 text-[11px] text-slate-600">
          <legend className="px-0.5 text-[10px] font-medium text-slate-700">지도 부가 표시 (택 1)</legend>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="road-cctv-underlay"
              className="accent-primary"
              checked={underlayMode === 'traffic'}
              onChange={() => setUnderlayMode?.('traffic')}
            />
            <span>
              <span className="font-medium text-slate-800">실시간 통행속도(5분)</span>
              <span className="ml-1 text-[10px] text-slate-500">
                국가교통정보센터 교통소통정보
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="road-cctv-underlay"
              className="accent-primary"
              checked={underlayMode === 'roadLedgerSummary'}
              onChange={() => setUnderlayMode?.('roadLedgerSummary')}
            />
            <span>
              <span className="font-medium text-slate-800">도로대장 노선도</span>
              <span className="ml-1 text-[10px] text-slate-500">도로대장총괄 노선도 정보</span>
            </span>
          </label>
        </fieldset>

        <div className="overflow-hidden rounded-md border border-slate-200 bg-black">
          {selected ? (
            <RoadCctvHlsPlayer
              key={selected.cctvurl}
              url={selected.cctvurl}
              className="aspect-video max-h-[200px] w-full object-contain"
            />
          ) : (
            <div className="flex aspect-video max-h-[160px] items-center justify-center bg-slate-900/90 px-2 text-center text-[11px] text-slate-300">
              목록에서 CCTV를 선택하면 영상이 표시됩니다.
            </div>
          )}
        </div>
        {selected && (
          <p className="line-clamp-2 text-[11px] font-medium text-slate-700">{selected.cctvname}</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          <span>목록 {items.length}건</span>
          {loading && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              불러오는 중
            </span>
          )}
        </div>
        {error && (
          <div className="m-2 shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            {error}
          </div>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((it) => {
            const active = it.key === selectedKey;
            return (
              <li key={it.key} className="border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => onSelectItem(it)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-[12px] transition-colors hover:bg-slate-50',
                    active && 'bg-primary/5 text-primary'
                  )}
                >
                  <span className="line-clamp-2 font-medium">{it.cctvname}</span>
                  <span className="text-[10px] text-slate-400">
                    {it.coordx.toFixed(5)}, {it.coordy.toFixed(5)} · {it.cctvformat || it.cctvtype || '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
