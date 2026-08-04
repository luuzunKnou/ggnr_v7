'use client';

import { useState } from 'react';
import type { Map as OlMap } from 'ol';
import { transform } from 'ol/proj';

type Props = {
  map: OlMap | null;
  onClose: () => void;
};

export function MapPrintCoordPanel({ map, onClose }: Props) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [error, setError] = useState<string | null>(null);

  const move = () => {
    if (!map) return;
    const lon = Number(x.trim());
    const lat = Number(y.trim());
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      setError('숫자 좌표를 입력하세요. (경도·위도)');
      return;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      setError('경도는 -180~180, 위도는 -90~90 범위여야 합니다.');
      return;
    }
    setError(null);
    const view = map.getView();
    const projection = view.getProjection();
    if (!projection) return;
    const center = transform([lon, lat], 'EPSG:4326', projection);
    view.setCenter(center);
  };

  return (
    <div className="map-print-coord-panel map-print-ignore">
      <div className="mb-2 font-medium text-slate-800">좌표 입력 (WGS84)</div>
      <label className="mb-2 flex items-center gap-2">
        <span className="w-10 shrink-0 text-slate-500">경도</span>
        <input
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          value={x}
          onChange={(e) => setX(e.target.value)}
          placeholder="예: 129.4"
        />
      </label>
      <label className="mb-2 flex items-center gap-2">
        <span className="w-10 shrink-0 text-slate-500">위도</span>
        <input
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          value={y}
          onChange={(e) => setY(e.target.value)}
          placeholder="예: 36.99"
        />
      </label>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          onClick={onClose}
        >
          닫기
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          onClick={move}
        >
          이동
        </button>
      </div>
    </div>
  );
}
