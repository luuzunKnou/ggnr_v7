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
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import type { Coordinate } from 'ol/coordinate';
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
import { WTL_LAYER_SHAPE_DEFS } from '@/lib/wtlLayerShapeDefs';
import type { GroundDrawMode, GroundSectionLine } from './shapeTypes';
import {
  SECTION_DEFAULT_HALF_WIDTH_M,
  normalizeSectionLineLTR,
  sectionCoverRadiusM,
  sectionRectCenter3857,
  sectionRectRing3857,
  suggestSectionHalfWidthM,
} from './groundSection';
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

/** 절단선 중심 ±depthM 띠 — 지형·관로 조회와 동일 */
function rectFromBaseLine(
  start: Coordinate,
  end: Coordinate,
  depthM: number
): Polygon {
  const ring = sectionRectRing3857({
    start3857: [start[0]!, start[1]!],
    end3857: [end[0]!, end[1]!],
    halfWidthM: depthM,
  });
  return new Polygon([ring]);
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
  const radiusM = Math.max(1, Math.min(2000, Math.max(halfXM, halfYM)));
  return { center, radiusM };
}

function lineLengthM(start: Coordinate, end: Coordinate): number {
  const center: [number, number] = [
    (start[0]! + end[0]!) / 2,
    (start[1]! + end[1]!) / 2,
  ];
  return mercatorToMeters(center, Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!));
}

export type GroundPickResult = {
  mode: GroundDrawMode;
  center: [number, number];
  radiusM: number;
  sectionLine?: GroundSectionLine;
};

type Props = {
  drawMode: GroundDrawMode;
  /** EPSG:3857 — 선택 후 중심 */
  center: [number, number] | null;
  radiusM: number;
  sectionLine?: GroundSectionLine | null;
  onPick: (result: GroundPickResult) => void;
};

const DEFAULT_CENTER: [number, number] = [14135027, 4517000];

const DRAW_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(59,130,246,0.9)', width: 2 }),
  fill: new Fill({ color: 'rgba(59,130,246,0.12)' }),
});

const LINE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(234,179,8,0.95)', width: 3 }),
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

/** 지형 범위 — 사각형 드래그 또는 라인(단면도) */
export function GroundPickMap({
  drawMode,
  center,
  radiusM,
  sectionLine,
  onPick,
}: Props) {
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
      style: (feat) => {
        const kind = feat.get('kind');
        if (kind === 'line') return LINE_STYLE;
        return DRAW_STYLE;
      },
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

    // Three.js 상수 도형 레이어 전부 (분할·심도점 제외)
    const wtlShapeLayers = WTL_LAYER_SHAPE_DEFS.map((def, i) =>
      createNamedWmsLayer({
        tableName: def.table,
        layerName: def.label,
        minZoom: 12,
        maxZoom: 22,
        zIndex: 8 + i,
      })
    );

    const map = new Map({
      target: host,
      layers: [
        base,
        elevationLayer,
        emdLayer,
        riverLocalLayer,
        riverSmallLayer,
        ...wtlShapeLayers,
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

    const draw =
      drawMode === 'section'
        ? new Draw({
            source: markerSrc,
            type: 'LineString',
            maxPoints: 2,
            style: LINE_STYLE,
            stopClick: true,
          })
        : new Draw({
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
      skipFitRef.current = true;
      markerSrc.clear();

      if (drawMode === 'section' && geom instanceof LineString) {
        const coords = geom.getCoordinates();
        if (coords.length < 2) return;
        const start = coords[0]!;
        const end = coords[coords.length - 1]!;
        const lenM = lineLengthM(start, end);
        if (lenM < 1) return;
        const halfWidthM = suggestSectionHalfWidthM(lenM);
        const section = normalizeSectionLineLTR({
          start3857: [start[0]!, start[1]!],
          end3857: [end[0]!, end[1]!],
          halfWidthM,
        });
        const center = sectionRectCenter3857(section);
        const coverR = sectionCoverRadiusM(section);
        markerSrc.addFeature(
          new Feature({
            geometry: rectFromBaseLine(
              section.start3857,
              section.end3857,
              halfWidthM
            ),
            kind: 'extent',
          })
        );
        markerSrc.addFeature(
          new Feature({
            geometry: new LineString([section.start3857, section.end3857]),
            kind: 'line',
          })
        );
        onPickRef.current({
          mode: 'section',
          center,
          radiusM: coverR,
          sectionLine: section,
        });
        return;
      }

      const extent = geom.getExtent();
      const result = extentToCenterRadius(extent);
      markerSrc.addFeature(
        new Feature({
          geometry: squareAround(result.center, result.radiusM),
          kind: 'extent',
        })
      );
      onPickRef.current({
        mode: 'extent',
        center: result.center,
        radiusM: result.radiusM,
      });
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
    // drawMode 변경 시 맵·드로우 재생성
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount on drawMode
  }, [drawMode]);

  useEffect(() => {
    const src = markerSrcRef.current;
    const map = mapRef.current;
    if (!src) return;
    if (!center) {
      src.clear();
      return;
    }

    src.clear();
    if (drawMode === 'section' && sectionLine) {
      const start = sectionLine.start3857;
      const end = sectionLine.end3857;
      const depth = sectionLine.halfWidthM || SECTION_DEFAULT_HALF_WIDTH_M;
      const rect = rectFromBaseLine(start, end, depth);
      src.addFeature(
        new Feature({
          geometry: rect,
          kind: 'extent',
        })
      );
      src.addFeature(
        new Feature({
          geometry: new LineString([start, end]),
          kind: 'line',
        })
      );
      if (skipFitRef.current) {
        skipFitRef.current = false;
        return;
      }
      map?.getView().fit(rect.getExtent(), {
        padding: [36, 36, 36, 36],
        maxZoom: 21,
        duration: 250,
      });
      return;
    }

    const square = squareAround(center, radiusM);
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
  }, [center, radiusM, drawMode, sectionLine]);

  const title =
    drawMode === 'section'
      ? '지도에서 두 점을 찍어 절단 라인을 그리세요'
      : '지도에서 드래그해 사각형 범위를 그리세요';

  return (
    <div
      ref={hostRef}
      className="h-[220px] w-full overflow-hidden rounded border border-border bg-muted/30"
      title={title}
    />
  );
}
