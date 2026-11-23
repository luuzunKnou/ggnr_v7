/**
 * 경로 종류(색)와 무관하게 동일 본선·흰 외곽 굵기.
 */
import { Stroke, Style } from "ol/style";

/** 기본 본선 굵기 (px) — 전용·겸용 동일 */
export const BIKE_ROAD_LINE_WIDTH = 4;
/** 선택 시 본선 */
export const BIKE_ROAD_LINE_WIDTH_SELECTED = 5;
/** 흰 외곽 = 본선 + 이 값 (색마다 동일) */
const WHITE_CASE_EXTRA = 3;

function withAlpha(hexOrRgba: string, opacity: number): string {
  if (opacity >= 0.999) return hexOrRgba;
  const m = /^#([0-9a-f]{6})$/i.exec(hexOrRgba.trim());
  if (m) {
    const n = parseInt(m[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${opacity})`;
  }
  return hexOrRgba;
}

export function bikeRoadLineStyles(
  color: string,
  opts?: {
    selected?: boolean;
    opacity?: number;
    zBase?: number;
  }
): Style[] {
  const opacity = opts?.opacity ?? 1;
  const width = opts?.selected
    ? BIKE_ROAD_LINE_WIDTH_SELECTED
    : BIKE_ROAD_LINE_WIDTH;
  const z = opts?.zBase ?? 2;
  return [
    new Style({
      stroke: new Stroke({
        color: `rgba(255,255,255,${0.9 * opacity})`,
        width: width + WHITE_CASE_EXTRA,
        lineCap: "round",
        lineJoin: "round",
      }),
      zIndex: z,
    }),
    new Style({
      stroke: new Stroke({
        color: withAlpha(color, opacity),
        width,
        lineCap: "round",
        lineJoin: "round",
      }),
      zIndex: z + 1,
    }),
  ];
}
