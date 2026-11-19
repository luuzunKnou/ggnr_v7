/**
 * 자전거도로 위치도 — 오프스크린 배경지도 + 구간별 색 선을 PNG로 담는다.
 * 선 색은 OL 스타일에 의존하지 않고 캔버스에 직접 그린다(종류별 색 누락 방지).
 */
import { Map, View } from "ol";
import Feature from "ol/Feature";
import { defaults as defaultControls } from "ol/control";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import type MapType from "ol/Map";
import VectorSource from "ol/source/Vector";
import type XYZ from "ol/source/XYZ";
import { fromLonLat } from "ol/proj";
import { fromString } from "ol/transform";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import {
  createEmpty as createEmptyExtent,
  extend as extendExtent,
  getCenter,
  getHeight,
  getWidth,
  isEmpty as isEmptyExtent,
} from "ol/extent";
import "../../../_mapComponents/config/projections";
import { createPrintCaptureBackgroundLayer } from "../../mapPrint/mapPrintCapture";
import {
  BIKE_ROAD_PATH_LEGEND_TABLE,
  bikeRoadStrokeColor,
  pathStyleFromPathType,
  type BikeRoadRoute,
} from "./bikeRoadMock";
import {
  collectRouteEndpointMarkers,
  collectSegmentLines,
} from "./bikeRoadSegmentGeom";
import {
  BIKE_ROAD_LINE_WIDTH_SELECTED,
} from "./bikeRoadStrokeStyle";

/** 기점·종점 라벨이 잘리지 않게 여유 있는 캔버스 */
const CAPTURE_W = 960;
const CAPTURE_H = 640;
const WHITE_CASE_EXTRA = 3;

type CaptureLine = {
  segmentId: string;
  coords: [number, number][];
  pathStyle: BikeRoadRoute["pathStyle"];
  color: string;
};

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitRenderComplete(map: MapType, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once("rendercomplete", finish);
    map.render();
    window.setTimeout(finish, timeoutMs);
  });
}

function waitTilesLoaded(source: XYZ, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      source.un("tileloadstart", onStart);
      source.un("tileloadend", onEnd);
      source.un("tileloaderror", onEnd);
      resolve();
    };
    const onStart = () => {
      pending += 1;
    };
    const onEnd = () => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) window.setTimeout(finish, 80);
    };
    source.on("tileloadstart", onStart);
    source.on("tileloadend", onEnd);
    source.on("tileloaderror", onEnd);
    window.setTimeout(finish, timeoutMs);
  });
}

/**
 * 위치도 선 — 지도 오버레이와 같은 표시 기하 + 구간 pathType 색.
 * 노선 전체 lineCoords 한 줄·route.pathStyle(초록) 폴백 사용 금지.
 */
function buildCaptureLines(route: BikeRoadRoute): CaptureLine[] {
  const out: CaptureLine[] = [];
  const collected = collectSegmentLines(route.segments);

  // 1) 표시용 기하(겹침 오프셋 등) — segmentId로 종류 색 확정
  if (collected.length > 0) {
    for (const item of collected) {
      const seg = route.segments.find((s) => s.id === item.segmentId);
      if (!seg) continue;
      const pathStyle = pathStyleFromPathType(seg.pathType);
      out.push({
        segmentId: seg.id,
        coords: item.coords,
        pathStyle,
        color: bikeRoadStrokeColor(pathStyle),
      });
    }
  }

  // 2) collect에 빠진 구간은 원본 좌표로라도 그림(전체 구간 누락 방지)
  const drawn = new Set(out.map((l) => l.segmentId));
  for (const seg of route.segments) {
    if (drawn.has(seg.id)) continue;
    const coords = seg.centerLineCoords ?? seg.lineCoords;
    if (!coords || coords.length < 2) continue;
    const pathStyle = pathStyleFromPathType(seg.pathType);
    out.push({
      segmentId: seg.id,
      coords,
      pathStyle,
      color: bikeRoadStrokeColor(pathStyle),
    });
  }

  return out;
}

/** 범례 표(소형) — 노선이 화면 중앙에 오도록 작게 */
function drawLegendOnCanvas(ctx: CanvasRenderingContext2D) {
  const t = BIKE_ROAD_PATH_LEGEND_TABLE;
  const titleH = 18;
  const colH = 16;
  const rowH = 17;
  const colGroupW = 72;
  const colSubW = 32;
  const colStatusW = 36;
  const boxW = colGroupW + colSubW + colStatusW;
  const boxH = titleH + colH + rowH * 3;
  const x = CAPTURE_W - boxW - 10;
  const y = CAPTURE_H - boxH - 10;
  const grid = "rgba(0,0,0,0.16)";
  const mutedBg = "rgba(243,244,246,0.98)";
  const titleBg = "rgba(15,145,178,0.14)";
  const titleFg = "#0F91B2";
  const textFg = "#111827";
  const mutedFg = "#6b7280";

  const strokeRect = (
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    fill?: string
  ) => {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  };

  const centerText = (
    label: string,
    cx: number,
    cy: number,
    font: string,
    color: string
  ) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy);
  };

  const drawStatusLine = (cx: number, cy: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy);
    ctx.lineTo(cx + 11, cy);
    ctx.stroke();
  };

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.fillRect(x, y, boxW, boxH);

  strokeRect(x, y, boxW, titleH, titleBg);
  centerText(
    t.title,
    x + boxW / 2,
    y + titleH / 2,
    '600 10px "Pretendard", sans-serif',
    titleFg
  );

  const yCol = y + titleH;
  strokeRect(x, yCol, colGroupW + colSubW, colH, mutedBg);
  strokeRect(x + colGroupW + colSubW, yCol, colStatusW, colH, mutedBg);
  centerText(
    t.colGroup,
    x + (colGroupW + colSubW) / 2,
    yCol + colH / 2,
    '500 9px "Pretendard", sans-serif',
    mutedFg
  );
  centerText(
    t.colStatus,
    x + colGroupW + colSubW + colStatusW / 2,
    yCol + colH / 2,
    '500 9px "Pretendard", sans-serif',
    mutedFg
  );

  const y0 = yCol + colH;
  strokeRect(x, y0, colGroupW + colSubW, rowH);
  strokeRect(x + colGroupW + colSubW, y0, colStatusW, rowH);
  centerText(
    t.dedicated.group,
    x + (colGroupW + colSubW) / 2,
    y0 + rowH / 2,
    '500 8px "Pretendard", sans-serif',
    textFg
  );
  drawStatusLine(
    x + colGroupW + colSubW + colStatusW / 2,
    y0 + rowH / 2,
    t.dedicated.color
  );

  const y1 = y0 + rowH;
  const sharedH = rowH * t.shared.length;
  strokeRect(x, y1, colGroupW, sharedH);
  ctx.font = '500 8px "Pretendard", sans-serif';
  ctx.fillStyle = textFg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const mid = y1 + sharedH / 2;
  ctx.fillText("자전거 보행자", x + colGroupW / 2, mid - 5);
  ctx.fillText("겸용도로", x + colGroupW / 2, mid + 5);

  t.shared.forEach((row, i) => {
    const ry = y1 + i * rowH;
    strokeRect(x + colGroupW, ry, colSubW, rowH);
    strokeRect(x + colGroupW + colSubW, ry, colStatusW, rowH);
    centerText(
      row.sub,
      x + colGroupW + colSubW / 2,
      ry + rowH / 2,
      '500 8px "Pretendard", sans-serif',
      textFg
    );
    drawStatusLine(
      x + colGroupW + colSubW + colStatusW / 2,
      ry + rowH / 2,
      row.color
    );
  });

  ctx.restore();
}

/** 구간 색 선을 픽셀 좌표로 직접 그림 — OL 벡터 스타일 우회 */
function paintCaptureLinesOnCanvas(
  ctx: CanvasRenderingContext2D,
  map: MapType,
  lines: CaptureLine[]
) {
  const width = BIKE_ROAD_LINE_WIDTH_SELECTED;
  for (const line of lines) {
    const pts: [number, number][] = [];
    for (const c of line.coords) {
      const px = map.getPixelFromCoordinate(fromLonLat(c));
      if (!px || px.length < 2) continue;
      pts.push([px[0]!, px[1]!]);
    }
    if (pts.length < 2) continue;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i]![0], pts[i]![1]);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = width + WHITE_CASE_EXTRA;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i]![0], pts[i]![1]);
    }
    ctx.strokeStyle = line.color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }
}

function paintEndpointOnCanvas(
  ctx: CanvasRenderingContext2D,
  map: MapType,
  lonLat: [number, number],
  label: string,
  color: string
) {
  const px = map.getPixelFromCoordinate(fromLonLat(lonLat));
  if (!px || px.length < 2) return;
  const x = px[0]!;
  const y = px[1]!;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  ctx.font = '13px "Pretendard", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const textY = y - 14;
  const metrics = ctx.measureText(label);
  const tw = metrics.width + 12;
  const th = 18;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(x - tw / 2, textY - th + 2, tw, th);
  ctx.fillStyle = "#111827";
  ctx.fillText(label, x, textY);
  ctx.restore();
}

function compositeOffscreenToCanvas(map: MapType, target: HTMLCanvasElement): boolean {
  const size = map.getSize();
  if (!size) return false;
  const [width, height] = size;
  target.width = width;
  target.height = height;
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  const layersRoot = map.getViewport().querySelector(".ol-layers");
  if (!layersRoot) return false;
  ctx.fillStyle = "#e8eef2";
  ctx.fillRect(0, 0, width, height);
  let drew = false;
  for (const container of layersRoot.children) {
    const element = container as HTMLElement;
    const canvas = (element.firstElementChild ?? element) as HTMLCanvasElement;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) continue;
    const transform = canvas.style.transform;
    if (transform) {
      const matrix = fromString(transform);
      if (matrix.length === 6) {
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      }
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    try {
      ctx.drawImage(canvas, 0, 0);
      drew = true;
    } catch {
      /* tainted */
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return drew;
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    const url = canvas.toDataURL("image/png");
    return url && url.length > 64 ? url : null;
  } catch {
    return null;
  }
}

function extentFromLonLatLines(
  lines: CaptureLine[]
): [number, number, number, number] | null {
  const extent = createEmptyExtent();
  for (const line of lines) {
    for (const c of line.coords) {
      extendExtent(extent, fromLonLat(c));
    }
  }
  return isEmptyExtent(extent) ? null : (extent as [number, number, number, number]);
}

/**
 * 기점·종점이 아니라 구간 전체 extent 중심·해상도로 맞춤.
 * constrainResolution 스냅으로 잘리는 것 방지.
 */
function fitViewToRouteExtent(
  view: View,
  extent: [number, number, number, number],
  size: [number, number]
) {
  const pad = 56;
  const availW = Math.max(64, size[0] - pad * 2);
  const availH = Math.max(64, size[1] - pad * 2);
  const w = Math.max(getWidth(extent), 1);
  const h = Math.max(getHeight(extent), 1);
  // 전체 레이어가 들어오도록 해상도(클수록 넓게 보임)
  const resolution = Math.max(w / availW, h / availH) * 1.12;
  view.setCenter(getCenter(extent));
  view.setResolution(resolution);
}

/**
 * 배경지도 + 구간별 색 노선 + 기점·종점·범례 → 위치도 PNG data URL
 */
export async function captureBikeRoadLocationMap(
  route: BikeRoadRoute,
  backgroundId?: string
): Promise<string | null> {
  const captureLines = buildCaptureLines(route);
  if (captureLines.length === 0) return null;

  // opacity:0 이면 타일/벡터 스킵되는 브라우저 있음 → 화면 밖·불투명
  const host = document.createElement("div");
  host.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    `width:${CAPTURE_W}px`,
    `height:${CAPTURE_H}px`,
    "opacity:1",
    "visibility:visible",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  document.body.appendChild(host);

  let map: Map | null = null;
  try {
    const bgId = backgroundId?.trim() || "aerial-vworld";
    const tileLayer = createPrintCaptureBackgroundLayer(bgId);
    tileLayer.set("name", "background");
    const tileSource = tileLayer.getSource() as XYZ | null;

    const endpointMarkers = collectRouteEndpointMarkers(route.segments);

    // 기점·종점 라벨은 캔버스 — OL은 fit용 투명 기하만
    const vector = new VectorSource();

    // 구간 전체 선(투명) — fit 기준은 포인트가 아니라 레이어 전체
    const invisibleLine = new Style({
      stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 1 }),
    });
    for (const line of captureLines) {
      const f = new Feature({
        geometry: new LineString(line.coords.map((c) => fromLonLat(c))),
      });
      f.setStyle(invisibleLine);
      vector.addFeature(f);
    }
    const invisiblePoint = () =>
      new Style({
        image: new CircleStyle({
          radius: 1,
          fill: new Fill({ color: "rgba(0,0,0,0)" }),
          stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 }),
        }),
      });
    for (const m of endpointMarkers) {
      const f = new Feature({ geometry: new Point(fromLonLat(m.lonLat)) });
      f.setStyle(invisiblePoint());
      vector.addFeature(f);
    }

    const vectorLayer = new VectorLayer({
      source: vector,
      zIndex: 10,
    });

    const fitExtent =
      extentFromLonLatLines(captureLines) ??
      (!isEmptyExtent(vector.getExtent())
        ? (vector.getExtent() as [number, number, number, number])
        : null);
    const centerCoord = fitExtent
      ? getCenter(fitExtent)
      : fromLonLat(captureLines[0]!.coords[0]!);

    map = new Map({
      target: host,
      layers: [tileLayer, vectorLayer],
      view: new View({
        // 캡처용 — 해상도 스냅 끄고 구간 전체 fit
        constrainResolution: false,
        center: centerCoord,
        zoom: 14,
      }),
      controls: defaultControls({ attribution: false, zoom: false }),
      interactions: [],
    });
    map.setSize([CAPTURE_W, CAPTURE_H]);
    map.updateSize();

    if (fitExtent && !isEmptyExtent(fitExtent)) {
      fitViewToRouteExtent(map.getView(), fitExtent, [CAPTURE_W, CAPTURE_H]);
    }

    if (tileSource) await waitTilesLoaded(tileSource, 7000);
    await waitRenderComplete(map, 3000);
    await waitMs(250);
    await waitRenderComplete(map, 2000);

    // 타일 합성 실패해도 배경+선은 그리도록 (담지 못함 방지)
    const canvas = document.createElement("canvas");
    const composited = compositeOffscreenToCanvas(map, canvas);
    if (!composited || canvas.width < 2) {
      canvas.width = CAPTURE_W;
      canvas.height = CAPTURE_H;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (!composited) {
      ctx.fillStyle = "#e8eef2";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    paintCaptureLinesOnCanvas(ctx, map, captureLines);
    for (const m of endpointMarkers) {
      const prefix = m.kind === "start" ? "기점" : "종점";
      const label = m.name ? `${prefix}: ${m.name}` : prefix;
      const color = bikeRoadStrokeColor(
        pathStyleFromPathType(m.pathType) || route.pathStyle
      );
      paintEndpointOnCanvas(ctx, map, m.lonLat, label, color);
    }
    drawLegendOnCanvas(ctx);
    return canvasToDataUrl(canvas);
  } catch {
    return null;
  } finally {
    map?.setTarget(undefined);
    host.remove();
  }
}
