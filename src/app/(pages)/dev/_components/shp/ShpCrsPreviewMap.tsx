'use client';

import { useRef, useEffect } from 'react';
import { Map, View } from 'ol';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import { defaults } from 'ol/control';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { createVWorldLayer } from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';
import { RESOLUTIONS_3857 } from '@/app/(pages)/map/_mapComponents/config/mapDefaults';
import { getTransform } from 'ol/proj';
import 'ol/ol.css';

type Props = {
  /** ogr2ogr -a_srs 로 변환 없이 뽑은 원시 좌표의 GeoJSON FeatureCollection */
  geojson: Record<string, unknown> | null | undefined;
  /** 이 후보 EPSG로 해석해서 그린다 (예: EPSG:5186) */
  dataProjection: string;
  className?: string;
};

const DEFAULT_CENTER: [number, number] = getTransform('EPSG:4326', 'EPSG:3857')([128.7229, 36.5664]) as [number, number];
const DEFAULT_ZOOM = 7;
const VIEW_PROJECTION = 'EPSG:3857';

export function ShpCrsPreviewMap({ geojson, dataProjection, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 정사영상관리 미리보기와 동일한 방식: 도형 범위를 먼저 계산해 View에 곧바로 fit() 적용 후 지도를 생성한다.
  // (지도부터 만들고 나중에 fit하면 다이얼로그 진입 애니메이션 중 컨테이너 크기가 0이라 범위가 넓게 보이는 문제가 있었음)
  useEffect(() => {
    if (!containerRef.current) return;

    const vectorSource = new VectorSource();
    let extent: [number, number, number, number] | null = null;

    if (geojson && typeof geojson === 'object') {
      try {
        const format = new GeoJSON();
        const features = format.readFeatures(geojson, { dataProjection, featureProjection: VIEW_PROJECTION });
        if (features.length > 0) {
          vectorSource.addFeatures(features);
          const ext = vectorSource.getExtent();
          if (ext.every((v) => isFinite(v))) {
            extent = ext as [number, number, number, number];
          }
        }
      } catch {
        // fall through to default view
      }
    }

    const baseLayer = createVWorldLayer('satellite');
    baseLayer.set('name', 'background');

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: (feature) => {
        const geom = feature.getGeometry();
        if (!geom) return undefined;
        const type = geom.getType();
        if (type === 'Point' || type === 'MultiPoint') {
          return new Style({
            image: new CircleStyle({
              radius: 4,
              fill: new Fill({ color: 'rgba(239, 68, 68, 0.7)' }),
              stroke: new Stroke({ color: '#dc2626', width: 1.5 }),
            }),
          });
        }
        if (type === 'LineString' || type === 'MultiLineString') {
          return new Style({ stroke: new Stroke({ color: '#dc2626', width: 3 }) });
        }
        return new Style({
          stroke: new Stroke({ color: '#dc2626', width: 2 }),
          fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
        });
      },
    });

    const map = new Map({
      target: containerRef.current,
      layers: [baseLayer, vectorLayer],
      view: extent
        ? new View({ resolutions: RESOLUTIONS_3857, minZoom: 0, maxZoom: 20 })
        : new View({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, resolutions: RESOLUTIONS_3857, minZoom: 0, maxZoom: 20 }),
      controls: defaults({ zoom: false, attribution: false }),
    });

    if (extent) {
      map.getView().fit(extent, { padding: [14, 14, 14, 14], maxZoom: 19 });
    }

    // 다이얼로그 진입 애니메이션 중 생성되면 컨테이너 크기가 아직 0일 수 있어, 실제 크기가 잡히면 다시 맞춘다.
    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
      if (extent) map.getView().fit(extent, { padding: [14, 14, 14, 14], maxZoom: 19 });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.setTarget(undefined);
    };
  }, [geojson, dataProjection]);

  return (
    <div className={className}>
      <div className="relative w-full rounded bg-muted/20" style={{ height: 200 }}>
        <div ref={containerRef} className="absolute inset-0 rounded" />
      </div>
    </div>
  );
}
