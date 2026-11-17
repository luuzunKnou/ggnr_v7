"use client";

import { useEffect, useRef } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import Translate from "ol/interaction/Translate";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import { Fill, Icon, Stroke, Style } from "ol/style";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { getBlockingMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import {
  roadLedgerVideoNearestFrac,
  roadLedgerVideoPointAtFrac,
  roadLedgerVideoSlice,
  type RoadLedgerVideoRoute,
} from "./roadLedgerVideoTrack";

/** 위에서 본 자동차(바퀴·앞유리·지붕·뒷유리·전조등·후미등) — 위쪽이 진행 방향 */
const CAR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="46" viewBox="0 0 30 46">` +
    `<rect x="2.5" y="8" width="4" height="8" rx="1.5" fill="#1f2937"/>` +
    `<rect x="23.5" y="8" width="4" height="8" rx="1.5" fill="#1f2937"/>` +
    `<rect x="2.5" y="30" width="4" height="8" rx="1.5" fill="#1f2937"/>` +
    `<rect x="23.5" y="30" width="4" height="8" rx="1.5" fill="#1f2937"/>` +
    `<path d="M15 2 C21.5 2 25 5 25 11 L25 37 C25 42 21.5 44 15 44 C8.5 44 5 42 5 37 L5 11 C5 5 8.5 2 15 2 Z" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>` +
    `<path d="M8.5 14 Q15 10.5 21.5 14 L20 19.5 Q15 18 10 19.5 Z" fill="#dbeafe"/>` +
    `<rect x="9.5" y="20.5" width="11" height="11" rx="2.5" fill="#1d4ed8"/>` +
    `<path d="M10 33 Q15 34.5 20 33 L21 37.5 Q15 39.5 9 37.5 Z" fill="#bfdbfe"/>` +
    `<ellipse cx="9.5" cy="5.2" rx="2.2" ry="1.3" fill="#fde047"/>` +
    `<ellipse cx="20.5" cy="5.2" rx="2.2" ry="1.3" fill="#fde047"/>` +
    `<rect x="8" y="41.2" width="3.5" height="1.3" rx="0.6" fill="#f87171"/>` +
    `<rect x="18.5" y="41.2" width="3.5" height="1.3" rx="0.6" fill="#f87171"/>` +
    `</svg>`
);
const CAR_ICON_SRC = `data:image/svg+xml;charset=utf-8,${CAR_SVG}`;
/** 노선 누르기로 인정하는 거리(px) */
const ROUTE_HIT_PX = 12;
/** 보는 방향 부채꼴 반지름(px) — 지도 확대와 무관하게 같은 크기 */
const VIEW_CONE_PX = 70;

const viewConeFill = new Fill({ color: "rgba(245, 158, 11, 0.22)" });
const viewConeStroke = new Stroke({ color: "rgba(217, 119, 6, 0.85)", width: 1.5 });

/** 점 피처의 bearing(라디안, 북 0 시계방향)·fov(라디안) 속성으로 부채꼴을 그린다 */
function viewConeStyle(feature: FeatureLike, resolution: number): Style | undefined {
  const geom = feature.getGeometry();
  const bearing = feature.get("bearing") as number | undefined;
  const fov = feature.get("fov") as number | undefined;
  if (!(geom instanceof Point) || bearing == null || fov == null) return undefined;
  const [cx, cy] = geom.getCoordinates() as [number, number];
  const r = VIEW_CONE_PX * resolution;
  const ring: [number, number][] = [[cx, cy]];
  const steps = 18;
  for (let i = 0; i <= steps; i += 1) {
    const a = bearing - fov / 2 + (fov * i) / steps;
    ring.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
  }
  ring.push([cx, cy]);
  return new Style({ geometry: new Polygon([ring]), fill: viewConeFill, stroke: viewConeStroke, zIndex: 1 });
}

type Params = {
  route: RoadLedgerVideoRoute | null;
  /** 노선 비율 0~1 */
  frac: number;
  /** 지금 진행이 노선 끝→시작 쪽인지 */
  travelReverse: boolean;
  /** 지나온 길: 정방향이면 시작~현재, 역방향이면 현재~끝 */
  passedFromEnd: boolean;
  /** 영상에서 보는 방향 — 차 진행 방향 기준(도, 오른쪽 +). 모르면 null */
  viewRelDeg: number | null;
  /** 영상 가로 시야각(도) */
  viewFovDeg: number;
  /** 자동차 놓기·노선 누르기 → 노선 비율 */
  onPickFrac: (frac: number) => void;
};

/**
 * 도로영상 재생 위치를 지도 노선 위 자동차와 보는 방향 부채꼴로 표시하고, 지도에서 위치를 골라 영상을 옮긴다. */
export function useRoadLedgerVideoCarLayer({
  route,
  frac,
  travelReverse,
  passedFromEnd,
  viewRelDeg,
  viewFovDeg,
  onPickFrac,
}: Params) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  const onPickFracRef = useRef(onPickFrac);
  const draggingRef = useRef(false);
  const partsRef = useRef<{
    route: Feature<LineString>;
    passed: Feature<LineString>;
    car: Feature<Point>;
    carStyle: Style;
    cone: Feature<Point>;
  } | null>(null);
  /** 창을 연 뒤 처음 한 번만 노선 전체로 맞춤 (상행·하행 전환 시 지도 유지) */
  const fittedRef = useRef(false);

  useEffect(() => {
    mapContextRef.current = mapContext;
    onPickFracRef.current = onPickFrac;
  }, [mapContext, onPickFrac]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !route) return;

    const routeFeature = new Feature(new LineString(route.coords));
    routeFeature.setStyle([
      new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 7 }) }),
      new Style({ stroke: new Stroke({ color: "rgba(37,99,235,0.45)", width: 4 }) }),
    ]);
    const passedFeature = new Feature(new LineString([route.coords[0]!, route.coords[0]!]));
    passedFeature.setStyle(new Style({ stroke: new Stroke({ color: "#1d4ed8", width: 5 }) }));
    const carStyle = new Style({
      image: new Icon({ src: CAR_ICON_SRC, anchor: [0.5, 0.5], rotateWithView: true, scale: 1 }),
      zIndex: 3,
    });
    const carFeature = new Feature(new Point(route.coords[0]!));
    carFeature.setStyle(carStyle);
    const coneFeature = new Feature(new Point(route.coords[0]!));
    coneFeature.setStyle(viewConeStyle);

    const source = new VectorSource({ features: [routeFeature, passedFeature, coneFeature] });
    const carSource = new VectorSource({ features: [carFeature] });
    const lineLayer = new VectorLayer({ source, zIndex: 9700 });
    const carLayer = new VectorLayer({ source: carSource, zIndex: 9701 });
    map.addLayer(lineLayer);
    map.addLayer(carLayer);
    partsRef.current = { route: routeFeature, passed: passedFeature, car: carFeature, carStyle, cone: coneFeature };

    const translate = new Translate({ layers: [carLayer], hitTolerance: 6 });
    const snapCar = () => {
      const c = carFeature.getGeometry()?.getCoordinates() as [number, number] | undefined;
      if (!c) return null;
      const hit = roadLedgerVideoNearestFrac(route, c);
      const snapped = roadLedgerVideoPointAtFrac(route, hit.frac, false).coord;
      carFeature.getGeometry()?.setCoordinates(snapped);
      return hit.frac;
    };
    const onTranslateStart = () => {
      draggingRef.current = true;
    };
    const onTranslating = () => {
      snapCar();
    };
    const onTranslateEnd = () => {
      const f = snapCar();
      draggingRef.current = false;
      if (f != null) onPickFracRef.current(f);
    };
    translate.on("translatestart", onTranslateStart);
    translate.on("translating", onTranslating);
    translate.on("translateend", onTranslateEnd);
    map.addInteraction(translate);

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (getBlockingMapDrawInteraction(mapContextRef.current)) return;
      const res = map.getView().getResolution() ?? 1;
      const hit = roadLedgerVideoNearestFrac(route, evt.coordinate as [number, number]);
      if (hit.dist / res > ROUTE_HIT_PX) return;
      onPickFracRef.current(hit.frac);
    };
    map.on("singleclick", onClick as never);

    if (!fittedRef.current) {
      fittedRef.current = true;
      const ext = routeFeature.getGeometry()!.getExtent();
      scheduleFitMapToExtent3857(map, [ext[0], ext[1], ext[2], ext[3]], {
        applyMapViewPadding: () => mapContextRef.current?.applyMapViewPaddingRef?.current?.(),
      });
    }

    return () => {
      map.un("singleclick", onClick as never);
      translate.un("translatestart", onTranslateStart);
      translate.un("translating", onTranslating);
      translate.un("translateend", onTranslateEnd);
      map.removeInteraction(translate);
      map.removeLayer(lineLayer);
      map.removeLayer(carLayer);
      partsRef.current = null;
    };
  }, [mapContext?.mapInstanceRef, route]);

  useEffect(() => {
    const parts = partsRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!parts || !route || !map || draggingRef.current) return;
    const { coord, heading } = roadLedgerVideoPointAtFrac(route, frac, travelReverse);
    parts.car.getGeometry()?.setCoordinates(coord);
    parts.carStyle.getImage()?.setRotation(heading);
    parts.car.changed();
    parts.passed
      .getGeometry()
      ?.setCoordinates(passedFromEnd ? roadLedgerVideoSlice(route, frac, 1) : roadLedgerVideoSlice(route, 0, frac));
    parts.cone.getGeometry()?.setCoordinates(coord);
    parts.cone.setProperties({
      bearing: viewRelDeg == null ? undefined : heading + (viewRelDeg * Math.PI) / 180,
      fov: (Math.min(150, Math.max(20, viewFovDeg)) * Math.PI) / 180,
    });
  }, [frac, travelReverse, passedFromEnd, viewRelDeg, viewFovDeg, route, mapContext?.mapInstanceRef]);
}
