'use client';

import { useEffect, useRef } from 'react';
import 'ol/ol.css';
import { Map, View } from 'ol';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import { defaults as defaultControls } from 'ol/control';
import '../../_mapComponents/config/projections';
import { createVWorldLayer } from '../../_mapComponents/layerFactory/backgroundLayerFactory';
import { transformCoordinate } from '../../_mapComponents/services/coordinateService';
import { RESOLUTIONS_3857 } from '../../_mapComponents/config/mapDefaults';

const SCOPE_STYLE = new Style({
  stroke: new Stroke({ color: '#0284c7', width: 2 }),
  fill: new Fill({ color: 'rgba(2,132,199,0.22)' }),
});

/** `POLYGON((x y, ...))` EPSG:5181 → 링 좌표 */
function parsePolygonWkt5181(wkt: string): [number, number][] | null {
  const m = wkt.trim().match(/^POLYGON\s*\(\s*\(\s*(.+?)\s*\)\s*\)$/i);
  if (!m) return null;
  const ring: [number, number][] = [];
  for (const part of m[1].split(',')) {
    const nums = part.trim().split(/\s+/).map(Number);
    if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) return null;
    ring.push([nums[0], nums[1]]);
  }
  return ring.length >= 4 ? ring : null;
}

type Props = {
  wkt5181: string;
  className?: string;
};

/** 신청서 위치도 — 저장된 촬영 범위 미리보기 */
export function ScopePreviewMap({ wkt5181, className }: Props) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = mapDivRef.current;
    if (!el || !wkt5181.trim()) return;

    const ring5181 = parsePolygonWkt5181(wkt5181);
    if (!ring5181) return;

    const ring3857: [number, number][] = [];
    for (const pt of ring5181) {
      const c = transformCoordinate(pt, 'EPSG:5181', 'EPSG:3857');
      if (!c) return;
      ring3857.push([c[0], c[1]]);
    }

    const source = new VectorSource({
      features: [new Feature({ geometry: new Polygon([ring3857]) })],
    });

    const map = new Map({
      target: el,
      layers: [
        createVWorldLayer('satellite'),
        new VectorLayer({ source, style: SCOPE_STYLE, zIndex: 10 }),
      ],
      view: new View({
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
      controls: defaultControls({ attribution: false, zoom: false }),
      interactions: [],
    });

    const extent = source.getExtent();
    map.getView().fit(extent, { padding: [28, 28, 28, 28], maxZoom: 17, duration: 0 });

    const ro = new ResizeObserver(() => map.updateSize());
    ro.observe(el);
    const t = window.setTimeout(() => map.updateSize(), 80);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      map.setTarget(undefined);
    };
  }, [wkt5181]);

  return <div ref={mapDivRef} className={className ?? 'absolute inset-0'} />;
}
