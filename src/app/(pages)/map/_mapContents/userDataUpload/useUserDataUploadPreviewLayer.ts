'use client';

import { useEffect, useMemo, useRef } from 'react';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import WKT from 'ol/format/WKT';
import { MultiLineString, MultiPoint, MultiPolygon, Point, type Geometry } from 'ol/geom';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { GEOM_STACK_UI_ZINDEX_MIN } from '@/lib/mapLayerGeometryOrder';
import { useMapContext } from '../../_mapComponents/MapContext';
import '../../_mapComponents/config/projections';
import type { UploadCrsCode } from './userDataUploadConfig';
import type { RawPreviewGeometry } from './userDataUploadParse';

const LAYER_KEY = 'user-data-upload-preview';

/** 국내 표시 범위(경위도) — 벗어나면 좌표계가 틀린 것으로 본다 */
const KOREA_EXTENT_4326: [number, number, number, number] = [124, 33, 132, 39];

const previewStyle = new Style({
  stroke: new Stroke({ color: 'rgba(234, 88, 12, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(249, 115, 22, 0.22)' }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(249, 115, 22, 0.9)' }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
  }),
});

const wktFormat = new WKT();

function toOlGeometry(raw: RawPreviewGeometry): Geometry | null {
  switch (raw.type) {
    case 'Point':
      return new Point(raw.coordinates);
    case 'MultiPoint':
      return new MultiPoint(raw.coordinates);
    case 'MultiLineString':
      return new MultiLineString(raw.coordinates);
    case 'MultiPolygon':
      return new MultiPolygon(raw.coordinates);
    case 'WKT':
      return wktFormat.readGeometry(raw.text);
  }
}

export type UploadPreviewLayerStatus = {
  drawn: number;
  failed: number;
  outOfKorea: boolean;
};

type PreparedPreview = UploadPreviewLayerStatus & { geometries4326: Geometry[] };

const EMPTY_PREVIEW: PreparedPreview = { drawn: 0, failed: 0, outOfKorea: false, geometries4326: [] };

/** 원본 좌표를 고른 좌표계로 해석해 경위도로 바꾸고 국내 범위 여부를 판단한다 */
function preparePreview(geometries: RawPreviewGeometry[], crs: UploadCrsCode): PreparedPreview {
  const sourceProjection = `EPSG:${crs}`;
  const extent = createEmpty();
  const out: Geometry[] = [];
  let failed = 0;
  for (const raw of geometries) {
    try {
      const geom = toOlGeometry(raw);
      if (!geom) continue;
      geom.transform(sourceProjection, 'EPSG:4326');
      const ext = geom.getExtent();
      if (!ext.every(Number.isFinite)) {
        failed++;
        continue;
      }
      extend(extent, ext);
      out.push(geom);
    } catch {
      failed++;
    }
  }
  const [minX, minY, maxX, maxY] = KOREA_EXTENT_4326;
  const outOfKorea =
    !isEmpty(extent) && (extent[0] < minX || extent[1] < minY || extent[2] > maxX || extent[3] > maxY);
  return { drawn: out.length, failed, outOfKorea, geometries4326: out };
}

/**
 * 업로드 설정 단계 — 원본 좌표를 고른 좌표계로 해석해 지도에 임시로 그리고 범위로 이동한다.
 * 좌표계를 바꿀 때마다 다시 그려 맞는 위치인지 눈으로 확인하게 한다.
 */
export function useUserDataUploadPreviewLayer(
  enabled: boolean,
  geometries: RawPreviewGeometry[],
  crs: UploadCrsCode | ''
): UploadPreviewLayerStatus {
  const mapContext = useMapContext();
  const sourceRef = useRef(new VectorSource());
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  const mapRef = mapContext?.mapInstanceRef;
  const prepared = useMemo(
    () => (enabled && crs && geometries.length > 0 ? preparePreview(geometries, crs) : EMPTY_PREVIEW),
    [enabled, geometries, crs]
  );

  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;
    const source = sourceRef.current;
    if (!layerRef.current) {
      layerRef.current = new VectorLayer({
        source,
        style: previewStyle,
        zIndex: GEOM_STACK_UI_ZINDEX_MIN + 5,
        properties: { id: LAYER_KEY, geomStackSkip: true },
      });
    }
    const layer = layerRef.current;
    if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
      source.clear();
    };
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef?.current;
    const source = sourceRef.current;
    source.clear();
    if (!map || prepared.drawn === 0) return;

    const mapProjection = map.getView().getProjection();
    const extent = createEmpty();
    const features = prepared.geometries4326.map((g) => {
      const geom = g.clone().transform('EPSG:4326', mapProjection);
      extend(extent, geom.getExtent());
      return new Feature({ geometry: geom });
    });
    source.addFeatures(features);
    if (!prepared.outOfKorea && !isEmpty(extent)) {
      map.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
    }
  }, [mapRef, prepared]);

  return { drawn: prepared.drawn, failed: prepared.failed, outOfKorea: prepared.outOfKorea };
}
