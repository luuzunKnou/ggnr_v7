'use client';

import { useEffect, useState } from 'react';
import type Map from 'ol/Map';
import './mapScaleLine.css';

type Props = {
  map: Map | null;
  mapReady: boolean;
};

/** 줌 레벨 기준 축척 거리 — 7864320 / 2^(zoom-1), km·m·mm 자동 */
function formatScaleFromZoom(zoom: number): string | null {
  if (!Number.isFinite(zoom)) return null;

  let scaleValue = 7864320 / Math.pow(2, zoom - 1);
  let unit = 'm';

  if (scaleValue >= 1000) {
    scaleValue /= 1000;
    unit = 'km';
  } else if (scaleValue < 1) {
    scaleValue *= 1000;
    unit = 'mm';
  }

  return `${scaleValue.toFixed(2)}${unit}`;
}

/**
 * 지도 우측 하단 축척 — 줌에 따라 거리 표시 (글자 + 얇은 밑선).
 */
export function MapScaleIndicator({ map, mapReady }: Props) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!mapReady || !map) {
      setText(null);
      return;
    }
    const view = map.getView();
    const update = () => {
      const zoom = view.getZoom();
      setText(zoom == null ? null : formatScaleFromZoom(zoom));
    };
    update();
    view.on('change:resolution', update);
    map.on('moveend', update);
    return () => {
      view.un('change:resolution', update);
      map.un('moveend', update);
    };
  }, [map, mapReady]);

  if (!text) return null;

  return (
    <div className="ggnr-scale-bar" aria-hidden>
      <div className="ggnr-scale-bar-inner">{text}</div>
    </div>
  );
}
