/**
 * 자전거도로 위치도 — 불법점용·접도구역과 같이 오프스크린 배경지도에
 * 노선(기점~종점) 레이어를 그려 PNG로 담는다.
 */
import { Map, View } from "ol";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import { defaults as defaultControls } from "ol/control";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import type MapType from "ol/Map";
import VectorSource from "ol/source/Vector";
import type XYZ from "ol/source/XYZ";
import { fromLonLat } from "ol/proj";
import { fromString } from "ol/transform";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { isEmpty as isEmptyExtent } from "ol/extent";
import "../../../_mapComponents/config/projections";
import { RESOLUTIONS_3857 } from "../../../_mapComponents/config/mapDefaults";
import { createPrintCaptureBackgroundLayer } from "../../mapPrint/mapPrintCapture";
import type { BikeRoadRoute } from "./bikeRoadMock";

/** 기점·종점 라벨이 잘리지 않게 여유 있는 캔버스 */
const CAPTURE_W = 960;
const CAPTURE_H = 640;

const PATH_COLOR = {
  dedicated: "#FF2D95",
  sharedSep: "#00C853",
  sharedNonSep: "#1E88E5",
} as const;

function routeStrokeColor(pathStyle: string): string {
  if (pathStyle === "dedicated") return PATH_COLOR.dedicated;
  if (pathStyle === "sharedNonSep") return PATH_COLOR.sharedNonSep;
  return PATH_COLOR.sharedSep;
}

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

function createRouteStyle(pathStyle: string) {
  const color = routeStrokeColor(pathStyle);
  return (feature: FeatureLike) => {
    const role = String(feature.get("role") ?? "line");
    if (role === "endpoint") {
      const label = String(feature.get("label") ?? "");
      return new Style({
        image: new CircleStyle({
          radius: 7,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: "#fff", width: 2.5 }),
        }),
        text: new Text({
          text: label,
          font: '13px "Pretendard", sans-serif',
          offsetY: -18,
          fill: new Fill({ color: "#111827" }),
          stroke: new Stroke({ color: "#ffffff", width: 3.5 }),
          backgroundFill: new Fill({ color: "rgba(255,255,255,0.95)" }),
          padding: [3, 6, 3, 6],
        }),
        zIndex: 6,
      });
    }
    return [
      new Style({
        stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 8 }),
        zIndex: 2,
      }),
      new Style({
        stroke: new Stroke({
          color,
          width: 5,
          lineCap: "round",
          lineJoin: "round",
        }),
        zIndex: 3,
      }),
    ];
  };
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

/**
 * 배경지도 + 노선(기점·종점 라벨)을 오프스크린으로 그려 위치도 PNG data URL을 만든다.
 * 불법점용 관리카드 위치도와 같은 방식.
 */
export async function captureBikeRoadLocationMap(
  route: BikeRoadRoute,
  backgroundId?: string
): Promise<string | null> {
  const segLines = route.segments
    .map((s) => s.lineCoords)
    .filter((c): c is [number, number][] => (c?.length ?? 0) >= 2);
  const fallback =
    route.lineCoords.length >= 2 ? [route.lineCoords] : ([] as [number, number][][]);
  const lines = segLines.length > 0 ? segLines : fallback;
  if (lines.length === 0) return null;

  const host = document.createElement("div");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CAPTURE_W}px`,
    `height:${CAPTURE_H}px`,
    "opacity:0",
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

    const vector = new VectorSource();
    let mapCoords: ReturnType<typeof fromLonLat>[] = [];
    for (const coords of lines) {
      const mc = coords.map((c) => fromLonLat(c));
      if (mapCoords.length === 0) mapCoords = mc;
      const line = new Feature({ geometry: new LineString(mc) });
      line.set("role", "line");
      vector.addFeature(line);
    }

    const start = lines[0]![0]!;
    const endLine = lines[0]!;
    const end = endLine[endLine.length - 1]!;
    const startF = new Feature({ geometry: new Point(fromLonLat(start)) });
    startF.set("role", "endpoint");
    startF.set("label", `기점: ${route.startLabel || route.startPoint || "기점"}`);
    vector.addFeature(startF);
    const endF = new Feature({ geometry: new Point(fromLonLat(end)) });
    endF.set("role", "endpoint");
    endF.set("label", `종점: ${route.endLabel || route.endPoint || "종점"}`);
    vector.addFeature(endF);

    const vectorLayer = new VectorLayer({
      source: vector,
      zIndex: 10,
      style: createRouteStyle(route.pathStyle),
    });

    const center = mapCoords[Math.floor(mapCoords.length / 2)] ?? mapCoords[0]!;
    map = new Map({
      target: host,
      layers: [tileLayer, vectorLayer],
      view: new View({
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
        center,
        zoom: 14,
      }),
      controls: defaultControls({ attribution: false, zoom: false }),
      interactions: [],
    });
    map.setSize([CAPTURE_W, CAPTURE_H]);
    map.updateSize();

    const extent = vector.getExtent();
    if (!isEmptyExtent(extent)) {
      map.getView().fit(extent, {
        size: [CAPTURE_W, CAPTURE_H],
        /** 기점·종점 라벨이 프레임 안에 들어오도록 여백 */
        padding: [72, 88, 56, 88],
        maxZoom: 15,
        duration: 0,
      });
    }

    if (tileSource) await waitTilesLoaded(tileSource, 7000);
    await waitRenderComplete(map, 3000);
    await waitMs(350);
    await waitRenderComplete(map, 2000);

    const canvas = document.createElement("canvas");
    if (!compositeOffscreenToCanvas(map, canvas) || canvas.width < 2) return null;
    return canvasToDataUrl(canvas);
  } catch {
    return null;
  } finally {
    map?.setTarget(undefined);
    host.remove();
  }
}
