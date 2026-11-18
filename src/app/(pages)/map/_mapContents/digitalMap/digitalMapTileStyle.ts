import type { FeatureLike } from 'ol/Feature';
import { Fill, Stroke, Style, Text as OlText } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import {
  DIGITAL_MAP_FOOTPRINT_STROKE,
  DIGITAL_MAP_FOOTPRINT_WIDTH,
  DIGITAL_MAP_FRAME_LAYER,
  DIGITAL_MAP_OUTLINE_MAX_ZOOM,
} from './digitalMapConfig';

/**
 * 수치지형도 벡터타일 표시 규칙.
 * 타일 속성(digitalMapPmtilesBuild.ts): c 선·글자 색 / d 점선 간격(도면 지상 m) / t 글자 /
 * h 글자 높이(도면 지상 m) / a 회전각(도) — 도면 원본 값을 그대로 쓴다.
 * 레이어: frame = 도엽 테두리(14줌 이하만), z15…z19 = 도면 표시 단계(해당 줌부터).
 */

const FRAME_STYLE = new Style({
  stroke: new Stroke({ color: DIGITAL_MAP_FOOTPRINT_STROKE, width: DIGITAL_MAP_FOOTPRINT_WIDTH }),
});

const EARTH_R = 6378137;
const DEFAULT_COLOR = '#000000';
const LINE_WIDTH = 1.1;
const MIN_LABEL_PX = 5;
const MAX_LABEL_PX = 64;
/** 점선 한 주기가 이보다 작으면 실선으로 그려 번쩍임을 막는다 */
const MIN_DASH_TOTAL_PX = 4;
const CACHE_MAX = 6000;

const FONT_STACK =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Nanum Gothic", Gulim, sans-serif';

/** EPSG:3857 z0 해상도(m/px) — 해상도 → 줌 환산 */
const WORLD_RESOLUTION_Z0 = 156543.03392804097;
/** PMTiles 적재본은 표시 줌별 레이어(z15…z19) — 그 줌 미만에서는 숨긴다 */
const ZOOM_LAYER_RE = /^z(\d{1,2})$/;

type TileProps = {
  /** 타일 레이어 이름 (PMTiles: z15…z19, PostGIS: dm) */
  layer?: string;
  l?: string;
  c?: string;
  d?: string;
  t?: string;
  h?: number;
  a?: number;
};

/** 웹메르카토르 y(m) → 도면 지상 1m 가 지도 단위로 몇 m 인지 (1/cos 위도) */
export function digitalMapMercatorScaleAtY(y: number): number {
  const k = Math.cosh(y / EARTH_R);
  return Number.isFinite(k) && k >= 1 ? k : 1;
}

function parseDash(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const nums = raw
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length ? nums : null;
}

/**
 * @param getMapScale 현재 화면 중심 위도의 지도 배율 (도면 m → 지도 단위)
 */
export function createDigitalMapTileStyle(getMapScale: () => number): StyleFunction {
  const lineCache = new Map<string, Style>();
  const textCache = new Map<string, Style>();

  return (feature: FeatureLike, resolution: number): Style | undefined => {
    if (!(resolution > 0)) return undefined;
    const p = feature.getProperties() as TileProps;
    const zoom = Math.floor(Math.log2(WORLD_RESOLUTION_Z0 / resolution) + 1e-6);
    if (p.layer === DIGITAL_MAP_FRAME_LAYER) {
      return zoom <= DIGITAL_MAP_OUTLINE_MAX_ZOOM ? FRAME_STYLE : undefined;
    }
    const zm = p.layer ? ZOOM_LAYER_RE.exec(p.layer) : null;
    if (zm && zoom < Number(zm[1])) return undefined;
    const k = getMapScale();
    const color = p.c || DEFAULT_COLOR;

    if (p.t != null && p.t !== '') {
      const h = Number(p.h);
      if (!(h > 0)) return undefined;
      const px = Math.round((h * k) / resolution);
      if (px < MIN_LABEL_PX) return undefined;
      const fontPx = Math.min(MAX_LABEL_PX, px);
      const rotDeg = Math.round(Number(p.a) || 0);
      const key = `${fontPx}|${color}|${rotDeg}|${p.t}`;
      let st = textCache.get(key);
      if (!st) {
        if (textCache.size > CACHE_MAX) textCache.clear();
        st = new Style({
          text: new OlText({
            text: String(p.t),
            font: `500 ${fontPx}px ${FONT_STACK}`,
            fill: new Fill({ color }),
            stroke: new Stroke({
              color: 'rgba(255,255,255,0.92)',
              width: Math.max(2, Math.min(5, Math.round(fontPx * 0.2))),
            }),
            rotation: (-rotDeg * Math.PI) / 180,
            textAlign: 'left',
            textBaseline: 'alphabetic',
            overflow: true,
          }),
        });
        textCache.set(key, st);
      }
      return st;
    }

    const gt = feature.getGeometry()?.getType();
    if (gt === 'Point' || gt === 'MultiPoint') return undefined;

    const dashBase = parseDash(p.d);
    let lineDash: number[] | undefined;
    if (dashBase) {
      const px = dashBase.map((v) => Math.round(((v * k) / resolution) * 2) / 2);
      const total = px.reduce((s, v) => s + v, 0);
      if (total >= MIN_DASH_TOTAL_PX) lineDash = px;
    }
    const key = `${color}|${lineDash ? lineDash.join(',') : ''}`;
    let st = lineCache.get(key);
    if (!st) {
      if (lineCache.size > CACHE_MAX) lineCache.clear();
      st = new Style({
        stroke: new Stroke({
          color,
          width: LINE_WIDTH,
          lineDash,
          lineCap: lineDash && lineDash[0] === 0 ? 'round' : 'butt',
          lineJoin: 'round',
        }),
      });
      lineCache.set(key, st);
    }
    return st;
  };
}
