'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { transformCoordinate } from './services/coordinateService';

/** 위치정보 좌표계 옵션 (10개). shortLabel: 한 줄 표시용 */
export const COORDINATE_SYSTEM_OPTIONS: { label: string; shortLabel: string; code: string }[] = [
  { label: '서부원점 50만, GRS80 [EPSG:5180]', shortLabel: '서부 50만(5180)', code: 'EPSG:5180' },
  { label: '중부원점 50만, GRS80 [EPSG:5181]', shortLabel: '중부 50만(5181)', code: 'EPSG:5181' },
  { label: '제주원점 55만, GRS80 [EPSG:5182]', shortLabel: '제주 55만(5182)', code: 'EPSG:5182' },
  { label: '동부원점 50만, GRS80 [EPSG:5183]', shortLabel: '동부 50만(5183)', code: 'EPSG:5183' },
  { label: '울릉원점 50만, GRS80 [EPSG:5184]', shortLabel: '울릉 50만(5184)', code: 'EPSG:5184' },
  { label: '서부원점 60만, GRS80 [EPSG:5185]', shortLabel: '서부 60만(5185)', code: 'EPSG:5185' },
  { label: '중부원점 60만, GRS80 [EPSG:5186]', shortLabel: '중부 60만(5186)', code: 'EPSG:5186' },
  { label: '동부원점 60만, GRS80 [EPSG:5187]', shortLabel: '동부 60만(5187)', code: 'EPSG:5187' },
  { label: '울릉원점 60만, GRS80 [EPSG:5188]', shortLabel: '울릉 60만(5188)', code: 'EPSG:5188' },
  { label: '위경도, WGS84 [EPSG:4326]', shortLabel: '위경도(4326)', code: 'EPSG:4326' },
];

const DEFAULT_CRS = 'EPSG:5181';

const TAB_IDS = ['parcel', 'building', 'permit', 'consumer'] as const;
const TAB_LABELS: Record<(typeof TAB_IDS)[number], string> = {
  parcel: '필지정보',
  building: '건축물대장',
  permit: '건축인허가',
  consumer: '수용가정보',
};

function copyToClipboard(text: string): void {
  if (typeof navigator?.clipboard?.writeText === 'function') {
    navigator.clipboard.writeText(text);
  }
}

export interface AddressInfoPanelProps {
  coordinate: [number, number];
  viewProjection: string;
  jibun: string | null;
  road: string | null;
  buildingName?: string | null;
  loading?: boolean;
}

export function AddressInfoPanel({
  coordinate,
  viewProjection,
  jibun,
  road,
  buildingName,
  loading = false,
}: AddressInfoPanelProps) {
  const [selectedCrs, setSelectedCrs] = useState(DEFAULT_CRS);
  const [activeTab, setActiveTab] = useState<(typeof TAB_IDS)[number]>('parcel');

  const { xy, label, shortLabel } = useMemo(() => {
    const transformed = transformCoordinate(coordinate, viewProjection, selectedCrs);
    const opt = COORDINATE_SYSTEM_OPTIONS.find((o) => o.code === selectedCrs);
    if (!transformed || !opt) return { xy: null, label: opt?.label ?? selectedCrs, shortLabel: opt?.shortLabel ?? selectedCrs };
    const [x, y] = transformed;
    return { xy: { x, y }, label: opt.label, shortLabel: opt.shortLabel };
  }, [coordinate, viewProjection, selectedCrs]);

  const wgs84 = useMemo(
    () => transformCoordinate(coordinate, viewProjection, 'EPSG:4326'),
    [coordinate, viewProjection]
  );

  const handleCopy = useCallback((text: string) => {
    if (text) copyToClipboard(text);
  }, []);

  const handleCopyCoords = useCallback(() => {
    if (!xy) return;
    const text =
      selectedCrs === 'EPSG:4326'
        ? `${label}\n경도: ${xy.x}\n위도: ${xy.y}`
        : `${label}\nX: ${xy.x}\nY: ${xy.y}`;
    copyToClipboard(text);
  }, [xy, label, selectedCrs]);

  const roadDisplay = road ? (buildingName ? `${road} (${buildingName})` : road) : null;

  return (
    <div className="flex flex-col min-h-0 text-sm">
      {/* 주소정보 */}
      <section className="px-3 py-2 border-b border-slate-100">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-12 text-center text-[10px] mb-1 font-semibold py-0.5 rounded bg-blue-100 text-blue-700">
              도로명
            </span>
            <span className="text-slate-800 text-xs truncate min-w-0 flex-1 mb-1">
              {loading ? '조회 중...' : roadDisplay ?? '-'}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(road ?? '')}
              disabled={!road || loading}
              className="text-[11px] text-blue-600 hover:underline shrink-0 disabled:opacity-50 mb-1"
            >
              [복사]
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-12 text-center text-[10px] font-semibold py-0.5 rounded mb-1 bg-amber-100 text-amber-800">
              지번
            </span>
            <span className="text-slate-800 text-xs truncate min-w-0 flex-1 mb-1">
              {loading ? '조회 중...' : jibun ?? '-'}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(jibun ?? '')}
              disabled={!jibun || loading}
              className="text-[11px] text-blue-600 hover:underline shrink-0 disabled:opacity-50 mb-1"
            >
              [복사]
            </button>
          </div>
        </div>
        <div className="mt-0 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700">
            <select
              value={selectedCrs}
              onChange={(e) => setSelectedCrs(e.target.value)}
              className="shrink-0 text-[11px] border border-slate-200 rounded px-1 py-0.5 min-w-0 max-w-[140px]"
            >
              {COORDINATE_SYSTEM_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.shortLabel}
                </option>
              ))}
            </select>
            <span className="shrink-0">:</span>
            {xy ? (
              <>
                <span className="font-mono text-slate-800 truncate min-w-0 flex-1">
                  {xy.x.toFixed(6)} , {xy.y.toFixed(6)}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCoords}
                  className="text-[11px] text-blue-600 hover:underline shrink-0 disabled:opacity-50"
                >
                  [복사]
                </button>
              </>
            ) : (
              <span className="text-slate-400 flex-1">-</span>
            )}
          </div>
        </div>
      </section>

      {/* 바로가기 (버튼 너비 합 100%) */}
      <section className="-mt-1 mb-0 px-3 py-2 border-b border-slate-100">
        <div className="flex w-full gap-1">
          <button
            type="button"
            onClick={() =>
              wgs84 &&
              window.open(
                `https://map.naver.com/v5/search/?c=${wgs84[1]},${wgs84[0]},15,0,0,0,dh`,
                '_blank',
                'noopener,noreferrer'
              )
            }
            disabled={!wgs84}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="네이버 지도"
          >
            <img src="/image/addressInfoIcon/naverMap_icon.svg" alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() =>
              wgs84 &&
              window.open(`https://map.kakao.com/link/map/${wgs84[1]},${wgs84[0]}`, '_blank', 'noopener,noreferrer')
            }
            disabled={!wgs84}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="카카오 지도"
          >
            <img src="/image/addressInfoIcon/kakaoMap_icon.svg" alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() =>
              wgs84 &&
              window.open(`https://www.google.com/maps?q=${wgs84[1]},${wgs84[0]}`, '_blank', 'noopener,noreferrer')
            }
            disabled={!wgs84}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="구글 지도"
          >
            <img src="/image/addressInfoIcon/googleMap_icon.svg" alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200"
            aria-label="토지이음"
          >
            <img src="/image/addressInfoIcon/toji-e-um.png" alt="" className="w-5 h-5 object-contain" />
          </button>
        </div>
      </section>

      {/* 탭 */}
      <section className="flex-1 min-h-0 flex flex-col">
        <div className="flex border-b border-slate-200 shrink-0">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex-1 min-w-0 px-2 py-2 text-xs border-b-2 -mb-px transition-colors ${
                activeTab === id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 text-slate-500 text-xs">
          {/* 추후 구현 */}
          {TAB_LABELS[activeTab]} 내용은 추후 구현됩니다.
        </div>
      </section>
    </div>
  );
}
