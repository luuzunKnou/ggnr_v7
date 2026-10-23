'use client';

import { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import { defaults } from 'ol/control';
import Feature from 'ol/Feature';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import ImageWMS from 'ol/source/ImageWMS';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import Polygon from 'ol/geom/Polygon';
import type { Extent } from 'ol/extent';
import { toLonLat } from 'ol/proj';
import Draw, { createBox } from 'ol/interaction/Draw';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { createVWorldRasterLayer } from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';
import { RESOLUTIONS_3857 } from '@/app/(pages)/map/_mapComponents/config/mapDefaults';
import { WORKSPACE } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad';
import { call } from '@/lib/api';
import 'ol/ol.css';

/** 지표 m → EPSG:3857 오프셋 (위도 보정) */
function metersToMercator(center3857: [number, number], meters: number): number {
  const [, lat] = toLonLat(center3857);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return meters;
  return meters / cosLat;
}

function mercatorToMeters(center3857: [number, number], projDelta: number): number {
  const [, lat] = toLonLat(center3857);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return projDelta;
  return projDelta * cosLat;
}

/** 중심·절반(m) → 정사각 폴리곤 (EPSG:3857) */
function squareAround(center3857: [number, number], halfM: number): Polygon {
  const half = metersToMercator(center3857, halfM);
  const [cx, cy] = center3857;
  return new Polygon([
    [
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half],
    ],
  ]);
}

/** 그린 사각형 extent → 중심 + 덮는 정사각 반경(m) */
function extentToCenterRadius(extent: Extent): {
  center: [number, number];
  radiusM: number;
} {
  const minx = extent[0];
  const miny = extent[1];
  const maxx = extent[2];
  const maxy = extent[3];
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const center: [number, number] = [cx, cy];
  const halfXM = mercatorToMeters(center, (maxx - minx) / 2);
  const halfYM = mercatorToMeters(center, (maxy - miny) / 2);
  // 최소 반경 1m(한 변 2m) — 그리기 범위를 그대로 반영
  const radiusM = Math.max(1, Math.min(2000, Math.max(halfXM, halfYM)));
  return { center, radiusM };
}

export type GroundPickResult = {
  center: [number, number];
  radiusM: number;
};

type Props = {
  /** EPSG:3857 — 선택 후 중심 */
  center: [number, number] | null;
  radiusM: number;
  onPick: (result: GroundPickResult) => void;
};

const DEFAULT_CENTER: [number, number] = [14135027, 4517000];

const DRAW_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(59,130,246,0.9)', width: 2 }),
  fill: new Fill({ color: 'rgba(59,130,246,0.12)' }),
});

/** 메인 지도와 동일 — GeoServer 테이블명 = 스타일명 */
function createNamedWmsLayer(opts: {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
  zIndex: number;
}): ImageLayer<ImageWMS> {
  const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`;
  const layer = new ImageLayer({
    minZoom: opts.minZoom,
    maxZoom: opts.maxZoom,
    visible: true,
    zIndex: opts.zIndex,
    source: new ImageWMS({
      url: wmsUrl,
      params: {
        LAYERS: `${WORKSPACE}:${opts.tableName}`,
        STYLES: opts.tableName,
        TRANSPARENT: true,
        FORMAT: 'image/png',
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      },
      serverType: 'geoserver',
      ratio: 1.5,
      crossOrigin: 'anonymous',
      imageLoadFunction: geoserverWmsImageLoadFunction,
    }),
  });
  layer.set('name', opts.layerName);
  layer.set('layerTableName', opts.tableName);
  return layer;
}

/** 지형·관로 범위 — 지도에서 사각형 드래그 (createBox) */
export function GroundPickMap({ center, radiusM, onPick }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerSrcRef = useRef<VectorSource | null>(null);
  const onPickRef = useRef(onPick);
  const initialFittedRef = useRef(false);
  const skipFitRef = useRef(false);
  onPickRef.current = onPick;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const markerSrc = new VectorSource();
    markerSrcRef.current = markerSrc;
    const markerLayer = new VectorLayer({
      source: markerSrc,
      style: DRAW_STYLE,
      zIndex: 20,
    });

    const base = createVWorldRasterLayer('satellite');
    base.set('name', 'background');

    const elevationLayer = createNamedWmsLayer({
      tableName: 'elevation',
      layerName: '등고선',
      minZoom: 10,
      maxZoom: 22,
      zIndex: 3,
    });

    const emdLayer = createNamedWmsLayer({
      tableName: 'emd',
      layerName: '읍면동',
      minZoom: 8,
      maxZoom: 22,
      zIndex: 6,
    });

    const pipeLayer = createNamedWmsLayer({
      tableName: 'wtl_pipe_lm',
      layerName: '상수관로',
      minZoom: 12,
      maxZoom: 22,
      zIndex: 8,
    });

    const riverLocalLayer = createNamedWmsLayer({
      tableName: 'river_plan_as',
      layerName: '지방하천',
      minZoom: 10,
      maxZoom: 22,
      zIndex: 7,
    });

    const riverSmallLayer = createNamedWmsLayer({
      tableName: 'river_plan_s_as',
      layerName: '소하천',
      minZoom: 10,
      maxZoom: 22,
      zIndex: 7,
    });

    const map = new Map({
      target: host,
      layers: [
        base,
        elevationLayer,
        emdLayer,
        riverLocalLayer,
        riverSmallLayer,
        pipeLayer,
        markerLayer,
      ],
      view: new View({
        center: center ?? DEFAULT_CENTER,
        zoom: 12,
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: 22,
      }),
      controls: defaults({ zoom: true, attribution: false }),
    });
    mapRef.current = map;

    // 기존 공간검색·촬영범위와 동일 — Circle + createBox = 사각형 드래그
    const draw = new Draw({
      source: markerSrc,
      type: 'Circle',
      geometryFunction: createBox(),
      style: DRAW_STYLE,
      stopClick: true,
    });
    draw.on('drawstart', () => {
      markerSrc.clear();
    });
    draw.on('drawend', (ev) => {
      const geom = ev.feature.getGeometry();
      if (!geom) return;
      const extent = geom.getExtent();
      const result = extentToCenterRadius(extent);
      // 그린 도형 대신 생성에 쓰는 정사각으로 맞춤
      skipFitRef.current = true;
      markerSrc.clear();
      markerSrc.addFeature(
        new Feature({
          geometry: squareAround(result.center, result.radiusM),
          kind: 'extent',
        })
      );
      onPickRef.current(result);
    });
    map.addInteraction(draw);

    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'elevationService',
          action: 'getEmdCenter3857',
          params: {},
        });
        const data = (res?.data ?? res) as {
          success?: boolean;
          centerX?: number;
          centerY?: number;
          extent?: [number, number, number, number];
        };
        if (!mapRef.current || initialFittedRef.current) return;
        if (center) return;
        if (data?.success && data.extent?.length === 4) {
          initialFittedRef.current = true;
          mapRef.current.getView().fit(data.extent, {
            padding: [24, 24, 24, 24],
            maxZoom: 14,
            duration: 0,
          });
        } else if (
          data?.success &&
          Number.isFinite(data.centerX) &&
          Number.isFinite(data.centerY)
        ) {
          initialFittedRef.current = true;
          mapRef.current.getView().setCenter([data.centerX!, data.centerY!]);
          mapRef.current.getView().setZoom(12);
        }
      } catch {
        /* keep default */
      }
    })();

    return () => {
      map.removeInteraction(draw);
      map.setTarget(undefined);
      mapRef.current = null;
      markerSrcRef.current = null;
      initialFittedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    const src = markerSrcRef.current;
    const map = mapRef.current;
    if (!src) return;
    if (!center) {
      src.clear();
      return;
    }

    const square = squareAround(center, radiusM);
    src.clear();
    src.addFeature(
      new Feature({
        geometry: square,
        kind: 'extent',
      })
    );
    if (skipFitRef.current) {
      skipFitRef.current = false;
      return;
    }
    map?.getView().fit(square.getExtent(), {
      padding: [36, 36, 36, 36],
      maxZoom: 21,
      duration: 250,
    });
  }, [center, radiusM]);

  return (
    <div
      ref={hostRef}
      className="h-[220px] w-full overflow-hidden rounded border border-border bg-muted/30"
      title="지도에서 드래그해 사각형 범위를 그리세요"
    />
  );
}
