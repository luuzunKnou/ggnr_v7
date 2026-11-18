"use client";

import { useEffect, useRef } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { fromLonLat } from "ol/proj";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { isEmpty as isEmptyExtent } from "ol/extent";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { BIKE_ROAD_MOCK_ROUTES, type BikeRoadRoute } from "./bikeRoadMock";
import { collectSegmentLines } from "./bikeRoadSegmentGeom";

const LAYER_PROP = "bikeRoadMockOverlay";

/** 위치도 범례와 동일: 전용 분홍 / 겸용분리 초록 / 겸용비분리 파랑 */
const PATH_STYLE_COLOR = {
  dedicated: "#FF2D95",
  sharedSep: "#00C853",
  sharedNonSep: "#1E88E5",
} as const;

function routeStrokeColor(pathStyle: string): string {
  if (pathStyle === "dedicated") return PATH_STYLE_COLOR.dedicated;
  if (pathStyle === "sharedNonSep") return PATH_STYLE_COLOR.sharedNonSep;
  return PATH_STYLE_COLOR.sharedSep;
}

function createStyle(getSelectedId: () => string | null) {
  return (feature: FeatureLike) => {
    const pathStyle = String(feature.get("pathStyle") ?? "sharedSep");
    const routeId = String(feature.get("routeId") ?? "");
    const role = String(feature.get("role") ?? "line");
    const selectedId = getSelectedId();
    const selected = selectedId != null && routeId === selectedId;
    const dimmed = selectedId != null && !selected;
    const color = routeStrokeColor(pathStyle);

    if (role === "endpoint") {
      if (!selected) return [];
      const label = String(feature.get("label") ?? "");
      return new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: "#fff", width: 2 }),
        }),
        text: new Text({
          text: label,
          font: '11px "Pretendard", sans-serif',
          offsetY: -14,
          fill: new Fill({ color: "#111827" }),
          stroke: new Stroke({ color: "#ffffff", width: 3 }),
          backgroundFill: new Fill({ color: "rgba(255,255,255,0.92)" }),
          padding: [2, 4, 2, 4],
        }),
        zIndex: 6,
      });
    }

    const width = selected ? 5 : 3.5;
    const opacity = dimmed ? 0.35 : 1;
    return [
      new Style({
        stroke: new Stroke({
          color: `rgba(255,255,255,${0.85 * opacity})`,
          width: width + 3,
        }),
        zIndex: selected ? 4 : 2,
      }),
      new Style({
        stroke: new Stroke({
          color,
          width,
          lineCap: "round",
          lineJoin: "round",
        }),
        zIndex: selected ? 5 : 3,
      }),
    ];
  };
}

function addRouteFeatures(source: VectorSource, route: BikeRoadRoute) {
  const segLines = collectSegmentLines(route.segments);
  if (segLines.length > 0) {
    for (const line of segLines) {
      const mapCoords = line.coords.map((c) => fromLonLat(c));
      const f = new Feature({ geometry: new LineString(mapCoords) });
      f.set("routeId", route.id);
      f.set("pathStyle", route.pathStyle);
      f.set("role", "line");
      f.set("segmentId", line.segmentId);
      f.set("side", line.side);
      source.addFeature(f);
    }
  } else if (route.lineCoords.length >= 2) {
    const mapCoords = route.lineCoords.map((c) => fromLonLat(c));
    const line = new Feature({ geometry: new LineString(mapCoords) });
    line.set("routeId", route.id);
    line.set("pathStyle", route.pathStyle);
    line.set("role", "line");
    source.addFeature(line);
  }

  const start =
    route.lineCoords[0] ??
    segLines[0]?.coords[0] ??
    null;
  const endLine = segLines.find((s) => s.side === "R" || s.side === "C") ?? segLines[0];
  const end =
    route.lineCoords[route.lineCoords.length - 1] ??
    (endLine ? endLine.coords[endLine.coords.length - 1] : null);

  if (start) {
    const f = new Feature({ geometry: new Point(fromLonLat(start)) });
    f.set("routeId", route.id);
    f.set("pathStyle", route.pathStyle);
    f.set("role", "endpoint");
    f.set("label", `기점: ${route.startLabel || ""}`);
    source.addFeature(f);
  }
  if (end) {
    const f = new Feature({ geometry: new Point(fromLonLat(end)) });
    f.set("routeId", route.id);
    f.set("pathStyle", route.pathStyle);
    f.set("role", "endpoint");
    f.set("label", `종점: ${route.endLabel || ""}`);
    source.addFeature(f);
  }
}

type Options = {
  open: boolean;
  selectedId: string | null;
  routes?: BikeRoadRoute[];
};

/** 자전거도로 — 구간별 라인(양측 이중선) 오버레이 */
export function useBikeRoadMapOverlay({
  open,
  selectedId,
  routes = BIKE_ROAD_MOCK_ROUTES,
}: Options) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapReady = mapContext?.mapReady;
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const fittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    sourceRef.current?.changed();
  }, [selectedId]);

  useEffect(() => {
    if (!open || !mapReady || !map) {
      const layer = layerRef.current;
      if (layer && map) {
        map.removeLayer(layer);
      }
      sourceRef.current = null;
      layerRef.current = null;
      fittedKeyRef.current = null;
      return;
    }

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 900,
      style: createStyle(() => selectedIdRef.current),
    });
    layer.set(LAYER_PROP, true);
    map.addLayer(layer);
    sourceRef.current = source;
    layerRef.current = layer;

    for (const route of routes) {
      addRouteFeatures(source, route);
    }

    return () => {
      map.removeLayer(layer);
      if (sourceRef.current === source) sourceRef.current = null;
      if (layerRef.current === layer) layerRef.current = null;
      fittedKeyRef.current = null;
    };
  }, [open, map, mapReady, routes]);

  useEffect(() => {
    if (!open || !mapReady || !map) return;
    const source = sourceRef.current;
    if (!source) return;

    const fitKey = `${selectedId ?? "__all__"}:${routes.length}`;
    if (fittedKeyRef.current === fitKey) return;

    const features = source.getFeatures().filter((f) => {
      if (f.get("role") !== "line") return false;
      if (!selectedId) return true;
      return f.get("routeId") === selectedId;
    });
    if (features.length === 0) return;

    const extent = features
      .map((f) => f.getGeometry()?.getExtent())
      .filter((e): e is number[] => !!e && e.length === 4)
      .reduce<[number, number, number, number] | null>((acc, e) => {
        if (!acc) return [e[0]!, e[1]!, e[2]!, e[3]!];
        return [
          Math.min(acc[0], e[0]!),
          Math.min(acc[1], e[1]!),
          Math.max(acc[2], e[2]!),
          Math.max(acc[3], e[3]!),
        ];
      }, null);

    if (!extent || isEmptyExtent(extent)) return;
    fittedKeyRef.current = fitKey;
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
      fitPadding: [80, 80, 80, 80],
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  }, [open, selectedId, map, mapReady, mapContext?.applyMapViewPaddingRef, routes]);
}

/** map-layout에서 훅만 쓰기 위한 빈 컴포넌트 */
export function BikeRoadMapOverlay({
  open,
  selectedId,
  routes,
}: {
  open: boolean;
  selectedId: string | null;
  routes?: BikeRoadRoute[];
}) {
  useBikeRoadMapOverlay({ open, selectedId, routes });
  return null;
}
