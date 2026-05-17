import type { FeatureLike } from "ol/Feature";
import { Fill, Icon, Stroke, Style, Circle as CircleStyle } from "ol/style";
import type { StyleFunction } from "ol/style/Style";

/**
 * 데이터조회(LayerDataPanel) — 목록 조회 결과 전체 도형 오버레이.
 * 연한 빨강 채움/선 + 흰 외곽선.
 */
export function createDataQueryBulkListHighlightStyle(): StyleFunction {
  return (feature: FeatureLike) => {
    const geom = feature.getGeometry();
    if (!geom) return undefined;
    const type = geom.getType();
    if (type === "Point" || type === "MultiPoint") {
      return new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: "rgba(220, 00, 00, 0.55)" }),
          stroke: new Stroke({ color: "#ffffff", width: 2 }),
        }),
      });
    }
    if (type === "LineString" || type === "MultiLineString") {
      return [
        new Style({ stroke: new Stroke({ color: "#ffffff", width: 7 }) }),
        new Style({ stroke: new Stroke({ color: "rgba(220, 00, 00, 0.55)", width: 5 }) }),
      ];
    }
    return new Style({
      stroke: new Stroke({ color: "#ffffff", width: 3 }),
      fill: new Fill({ color: "rgba(220, 00, 00, 0.55)" }),
    });
  };
}

const RADAR_CANVAS_SIZE = 120;
const RADAR_RADIUS = 52;

/**
 * 데이터조회(LayerDataPanel) — 선택 행 1건 강조(펄스 + 포인트 레이더).
 * `getPulsePhase()`는 requestAnimationFrame 루프에서 소량씩 증가 (LayerDataPanel 과 동일).
 */
export function createDataQuerySelectionRowHighlightStyle(
  getPulsePhase: () => number
): StyleFunction {
  return (feature: FeatureLike) => {
    const phase = getPulsePhase();
    const pulse = 0.7 + 0.4 * Math.sin(phase);
    if (feature.get("isRadarPoint")) {
      const canvas = document.createElement("canvas");
      canvas.width = RADAR_CANVAS_SIZE;
      canvas.height = RADAR_CANVAS_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return new Style({});
      const cx = RADAR_CANVAS_SIZE / 2;
      const cy = RADAR_CANVAS_SIZE / 2;
      const r = RADAR_RADIUS * pulse;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, `rgba(220, 38, 38, ${0.5 + 0.3 * Math.sin(phase)})`);
      gradient.addColorStop(0.5, "rgba(220, 38, 38, 0.2)");
      gradient.addColorStop(1, "rgba(220, 38, 38, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      return new Style({
        image: new Icon({
          img: canvas,
          width: RADAR_CANVAS_SIZE,
          height: RADAR_CANVAS_SIZE,
          anchor: [0.5, 0.5],
        }),
      });
    }
    const geomType = feature.getGeometry()?.getType();
    const isLineOrPolygon =
      geomType === "LineString" ||
      geomType === "MultiLineString" ||
      geomType === "Polygon" ||
      geomType === "MultiPolygon";
    if (isLineOrPolygon) {
      const whiteGlow = 0.6 + 0.4 * Math.sin(phase);
      return new Style({
        stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteGlow})`, width: 6 }),
        fill: new Fill({ color: "rgba(255, 255, 255, 0.08)" }),
      });
    }
    const strokeOpacity = 0.5 + 0.4 * Math.sin(phase);
    return new Style({
      stroke: new Stroke({ color: `rgba(220, 38, 38, ${strokeOpacity})`, width: 6 }),
      fill: new Fill({ color: "rgba(220, 38, 38, 0.15)" }),
    });
  };
}

/** LayerDataPanel selection 레이어 rAF — 매 프레임 증가분 */
export const DATA_QUERY_SELECTION_PULSE_STEP = 0.08;
