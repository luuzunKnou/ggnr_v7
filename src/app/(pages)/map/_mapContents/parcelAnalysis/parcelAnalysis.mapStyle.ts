import type { Geometry } from 'ol/geom';
import Polygon, { fromExtent } from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import WKT from 'ol/format/WKT';
import Collection from 'ol/Collection';
import type { Interaction } from 'ol/interaction';
import type { View } from 'ol';
import type { Extent } from 'ol/extent';
import { getCenter } from 'ol/extent';
import type { Tile } from 'ol';
import ImageTile from 'ol/ImageTile';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { XYZ } from 'ol/source';
import {
  PARCEL_ANALYSIS_BASEMAP_TILE_TIMEOUT_MS,
  PARCEL_THEME_MAP_MIN_AREA_VISIBLE_RATIO,
  PARCEL_THEME_MAP_NO_PARCEL_FILL,
  PARCEL_THEME_MAP_OTHER_CATEGORY,
  PARCEL_THEME_OTHER_FILL,
  PARCEL_THEME_OTHER_STROKE,
  resolveThemeColor,
  themeFillColor,
  type ParcelThemeMapKind,
} from '@/lib/parcelAnalysisTheme';

/** 분석 영역 바깥 반투명 마스크 (기본분석지도·테마 지도 공통) */
export const PARCEL_ANALYSIS_OUTSIDE_MASK_FILL = 'rgba(0, 0, 0, 0.7)';

/** 분석 영역 노란 외곽선 — 캡처·테마 지도 공통 */
export const PARCEL_ANALYSIS_BOUNDARY_STROKE = 'rgba(255, 220, 0, 1)';
export const PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH = 2;

/** VWorld 타일 — 캡처·테마 지도 공통 */
export const PARCEL_ANALYSIS_VWORLD_BASE_URL =
  'https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png';
export const PARCEL_ANALYSIS_VWORLD_SATELLITE_URL =
  'https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg';

/** 브이월드 타일 실패·타임아웃 시 단색 배경 (행망 등 외부 타일 불가 대비) */
export const PARCEL_ANALYSIS_FALLBACK_BASEMAP_COLOR = '#e8eef3';

function solidBasemapDataUrl(color = PARCEL_ANALYSIS_FALLBACK_BASEMAP_COLOR): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
  }
  return canvas.toDataURL('image/png');
}

/**
 * 결과 지도용 XYZ — 타일 오류·타임아웃 시 단색으로 대체해 빈 화면을 막는다.
 */
export function createParcelAnalysisBasemapSource(url: string): XYZ {
  const fallback = solidBasemapDataUrl();
  const timeoutMs = PARCEL_ANALYSIS_BASEMAP_TILE_TIMEOUT_MS;
  return new XYZ({
    url,
    crossOrigin: 'anonymous',
    tileLoadFunction: (tile: Tile, src: string) => {
      if (!(tile instanceof ImageTile)) return;
      const image = tile.getImage();
      if (!(image instanceof HTMLImageElement)) return;

      let done = false;
      const finish = (nextSrc: string) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        image.src = nextSrc;
      };

      const timer = window.setTimeout(() => {
        if (fallback) finish(fallback);
      }, timeoutMs);

      image.onload = () => {
        done = true;
        window.clearTimeout(timer);
      };
      image.onerror = () => {
        if (fallback) finish(fallback);
        else {
          done = true;
          window.clearTimeout(timer);
        }
      };
      image.src = src;
    },
  });
}

/** 캡처·테마 지도 최대 줌 (VWorld 타일 상한과 동일) */
export const PARCEL_ANALYSIS_MAP_MAX_ZOOM = 19;

/**
 * 결과 지도(테마·캡처) — 휠·드래그·핀치·줌 UI 없음.
 * Map 생성 시 spread 해서 쓴다.
 */
export function createParcelAnalysisStaticMapOptions(): {
  controls: [];
  interactions: Collection<Interaction>;
} {
  return {
    controls: [],
    interactions: new Collection<Interaction>(),
  };
}

/** 메인 지도 분석 영역 강조색 (확정·그리기·행정경계 공통) */
export const PARCEL_ANALYSIS_AREA_BLUE = '37, 99, 235';

function areaBlueRgba(alpha: number): string {
  return `rgba(${PARCEL_ANALYSIS_AREA_BLUE}, ${alpha})`;
}

/** 확정 분석 영역 — 실선 + 반투명 채움 */
export const PARCEL_ANALYSIS_AREA_STYLE = new Style({
  stroke: new Stroke({ color: areaBlueRgba(1), width: 2.5 }),
  fill: new Fill({ color: areaBlueRgba(0.18) }),
});

/** 도형 그리기 중 — 확정과 동일 + 꼭짓점 */
export const PARCEL_ANALYSIS_DRAW_STYLE = new Style({
  stroke: new Stroke({ color: areaBlueRgba(1), width: 2.5 }),
  fill: new Fill({ color: areaBlueRgba(0.18) }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: areaBlueRgba(1) }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

/** 시군구 참고 경계 — 점선 + 연한 채움 (색만 확정과 공유) */
export const PARCEL_ANALYSIS_SIGUNGU_BOUNDARY_STYLE = new Style({
  stroke: new Stroke({ color: areaBlueRgba(0.9), width: 2.5, lineDash: [6, 4] }),
  fill: new Fill({ color: areaBlueRgba(0.05) }),
});

/** 지도 캡처·테마 지도 — WKT·GeoServer·v6와 동일 (중부원점 GRS80) */
export const PARCEL_ANALYSIS_CAPTURE_PROJECTION = 'EPSG:5181';
const CAPTURE_RING_EPS = 1e-3;

function countPolygonExteriorVertices(ring: number[][] | undefined): number {
  if (!ring?.length) return 0;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  const closed =
    Math.abs(fx - lx) < CAPTURE_RING_EPS && Math.abs(fy - ly) < CAPTURE_RING_EPS;
  return closed ? ring.length - 1 : ring.length;
}

/** 5181 WKT → 캡처 지도 좌표계 geometry */
export function readParcelAnalysisCaptureGeometry(wkt5181: string): Geometry {
  return new WKT().readGeometry(wkt5181, {
    dataProjection: PARCEL_ANALYSIS_CAPTURE_PROJECTION,
    featureProjection: PARCEL_ANALYSIS_CAPTURE_PROJECTION,
  });
}

/**
 * 캡처 표시용 geometry.
 * 메인 지도(3857)에서 그린 사각형은 5181 WKT가 축에 기울어진 사변형이 되므로,
 * 4꼭짓점·원은 5181 extent bbox로 맞춰 화면에서 직사각형으로 보이게 한다.
 */
export function toCaptureDisplayGeometry(geom: Geometry): Geometry {
  if (geom.getType() === 'Polygon') {
    const ring = (geom as Polygon).getCoordinates()[0];
    if (ring && countPolygonExteriorVertices(ring) === 4) {
      return fromExtent(geom.getExtent());
    }
  }
  if (geom.getType() === 'Circle') {
    return fromExtent(geom.getExtent());
  }
  return geom.clone();
}

/** view.fit 여백(px) — 분석 영역 외곽선이 잘리지 않도록 */
export const PARCEL_ANALYSIS_MAP_FIT_PADDING: [number, number, number, number] = [20, 20, 20, 20];

/**
 * 분석 영역 바깥 마스크 외곽 링.
 * 지정 해상도·화면 크기보다 넓게 잡아 최대 축소·이동 시에도 화면 모서리까지 덮는다.
 */
export function createParcelAnalysisMaskOuterRing(
  center: [number, number],
  resolution: number,
  mapSize: [number, number],
  marginRatio = 1.5
): number[][] {
  const halfW = (mapSize[0] / 2) * resolution * marginRatio;
  const halfH = (mapSize[1] / 2) * resolution * marginRatio;
  const [cx, cy] = center;
  return [
    [cx - halfW, cy - halfH],
    [cx + halfW, cy - halfH],
    [cx + halfW, cy + halfH],
    [cx - halfW, cy + halfH],
    [cx - halfW, cy - halfH],
  ];
}

/** 폴리곤/멀티폴리곤 외곽 링 — 마스크 구멍용 */
export function getParcelAnalysisExteriorRings(geom: Geometry): number[][][] {
  if (geom instanceof Polygon) {
    const ring = geom.getCoordinates()[0];
    return ring ? [ring as number[][]] : [];
  }
  if (geom instanceof MultiPolygon) {
    return geom
      .getCoordinates()
      .map((poly) => poly[0] as number[][])
      .filter(Boolean);
  }
  return [];
}

export type ParcelAnalysisBasicMapLayerDef = {
  id: string;
  title: string;
  wmsLayer?: string;
  showSatellite?: boolean;
};

/** v6 data.json 기본도 WMS 레이어명 */
export const PARCEL_ANALYSIS_BASIC_MAP_LAYERS: ParcelAnalysisBasicMapLayerDef[] = [
  { id: 'basicMap:aerial', title: '항공영상', showSatellite: true },
  { id: 'basicMap:jijuk', title: '연속지적도', wmsLayer: 'jijuk' },
  { id: 'basicMap:building', title: '건물 및 건물군', wmsLayer: 'tl_sgco_rnadr_mst' },
  { id: 'basicMap:road', title: '실폭도로', wmsLayer: 'tl_sprd_rw' },
];

/** 결과 모달 기본도 — 합성 지도 1장 섹션 id */
export const BASIC_MAP_COMPOSITE_SECTION_ID = 'basicMap:map';

/** 목차에 표시할 짧은 제목 */
export const BASIC_MAP_TOC_TITLE = '분석 지도';

export function resolveBasicMapLayersForCapture(layerIds: string[]): ParcelAnalysisBasicMapLayerDef[] {
  const idSet = new Set(layerIds);
  return PARCEL_ANALYSIS_BASIC_MAP_LAYERS.filter((d) => idSet.has(d.id));
}

export function basicMapCompositeTitle(layerIds: string[]): string {
  const titles = resolveBasicMapLayersForCapture(layerIds).map((d) => d.title);
  return titles.length ? titles.join(' · ') : '분석 지도';
}

export function createThemeMapAreaBaseFillStyle(): Style {
  return new Style({
    fill: new Fill({ color: PARCEL_THEME_MAP_NO_PARCEL_FILL }),
  });
}

export function buildThemeMapStyleLookup(
  theme: ParcelThemeMapKind,
  onMapLabels: Iterable<string>
): Map<string, Style> {
  const lookup = new Map<string, Style>();
  lookup.set(
    PARCEL_THEME_MAP_OTHER_CATEGORY,
    new Style({
      fill: new Fill({ color: PARCEL_THEME_OTHER_FILL }),
      stroke: new Stroke({ color: PARCEL_THEME_OTHER_STROKE, width: 1 }),
    })
  );
  for (const label of onMapLabels) {
    const strokeColor = resolveThemeColor(theme, label);
    lookup.set(
      label,
      new Style({
        fill: new Fill({ color: themeFillColor(strokeColor) }),
        stroke: new Stroke({ color: strokeColor, width: 1 }),
      })
    );
  }
  return lookup;
}

export function resolveThemeMapFeatureStyle(
  category: string,
  onMapLabels: Set<string>,
  lookup: Map<string, Style>
): Style {
  if (category === PARCEL_THEME_MAP_OTHER_CATEGORY || !onMapLabels.has(category)) {
    return lookup.get(PARCEL_THEME_MAP_OTHER_CATEGORY)!;
  }
  return lookup.get(category) ?? lookup.get(PARCEL_THEME_MAP_OTHER_CATEGORY)!;
}

export type ThemeMapHomeView = {
  center: [number, number];
  resolution: number;
  minResolution: number;
  zoom: number;
  extent: Extent;
  areaCenter: [number, number];
};

export function applyThemeMapHomeView(
  view: View,
  analysisExtent: Extent,
  mapSize: [number, number]
): ThemeMapHomeView {
  view.fit(analysisExtent, {
    size: mapSize,
    padding: PARCEL_ANALYSIS_MAP_FIT_PADDING,
    maxZoom: PARCEL_ANALYSIS_MAP_MAX_ZOOM,
  });

  const homeResolution = view.getResolution() ?? 1;
  const minResolution = homeResolution / PARCEL_THEME_MAP_MIN_AREA_VISIBLE_RATIO;
  const minZoom = view.getZoomForResolution(minResolution);
  view.setMaxZoom(PARCEL_ANALYSIS_MAP_MAX_ZOOM);
  if (minZoom != null) {
    view.setMinZoom(minZoom);
  }

  const center = view.getCenter();
  const homeCenter: [number, number] = center
    ? [center[0], center[1]]
    : (getCenter(analysisExtent) as [number, number]);

  return {
    center: homeCenter,
    resolution: homeResolution,
    minResolution,
    zoom: view.getZoom() ?? 0,
    extent: view.calculateExtent(mapSize),
    areaCenter: getCenter(analysisExtent) as [number, number],
  };
}
