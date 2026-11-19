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
import {
  BIKE_ROAD_MOCK_ROUTES,
  bikeRoadStrokeColor,
  pathStyleFromPathType,
  type BikeRoadRoute,
} from "./bikeRoadMock";
import {
  collectRouteEndpointMarkers,
  collectSegmentLines,
} from "./bikeRoadSegmentGeom";
import { bikeRoadLineStyles } from "./bikeRoadStrokeStyle";
const LAYER_PROP = "bikeRoadMockOverlay";

function createStyle(getSelectedId: () => string | null) {
  return (feature: FeatureLike) => {
    const pathStyle = String(feature.get("pathStyle") ?? "sharedSep");
    const routeId = String(feature.get("routeId") ?? "");
    const role = String(feature.get("role") ?? "line");
    const selectedId = getSelectedId();
    const selected = selectedId != null && routeId === selectedId;
    const dimmed = selectedId != null && !selected;
    const color = bikeRoadStrokeColor(pathStyle);

    if (role === "endpoint") {
      if (!selected) return [];
      const label = String(feature.get("label") ?? "");
      const offsetY = Number(feature.get("labelOffsetY") ?? -14);
      return new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: "#fff", width: 2 }),
        }),
        text: new Text({
          text: label,
          font: '11px "Pretendard", sans-serif',
          offsetY,
          fill: new Fill({ color: "#111827" }),
          stroke: new Stroke({ color: "#ffffff", width: 3 }),
          backgroundFill: new Fill({ color: "rgba(255,255,255,0.92)" }),
          padding: [2, 4, 2, 4],
        }),
        zIndex: 6,
      });
    }

    return bikeRoadLineStyles(color, {
      selected,
      opacity: dimmed ? 0.35 : 1,
      zBase: selected ? 4 : 2,
    });
  };
}

function addRouteFeatures(source: VectorSource, route: BikeRoadRoute) {
  const segById = new Map(route.segments.map((s) => [s.id, s]));
  const segLines = collectSegmentLines(route.segments);
  if (segLines.length > 0) {
    for (const line of segLines) {
      const seg = segById.get(line.segmentId);
      const pathStyle = seg
        ? pathStyleFromPathType(seg.pathType)
        : route.pathStyle;
      const mapCoords = line.coords.map((c) => fromLonLat(c));
      const f = new Feature({ geometry: new LineString(mapCoords) });
      f.set("routeId", route.id);
      f.set("pathStyle", pathStyle);
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

  // 양측·공통 기점은 1개, 종점이 다르면 종점 라벨 여러 개
  const markers = collectRouteEndpointMarkers(route.segments);
  const endMarkers = markers.filter((m) => m.kind === "end");
  markers.forEach((m, i) => {
    const pathStyle = pathStyleFromPathType(m.pathType) || route.pathStyle;
    const f = new Feature({ geometry: new Point(fromLonLat(m.lonLat)) });
    f.set("routeId", route.id);
    f.set("pathStyle", pathStyle);
    f.set("role", "endpoint");
    const prefix = m.kind === "start" ? "기점" : "종점";
    f.set("label", m.name ? `${prefix}: ${m.name}` : prefix);
    // 종점이 여러 개면 라벨이 겹치지 않게 살짝 어긋남
    if (m.kind === "end" && endMarkers.length > 1) {
      const idx = endMarkers.indexOf(m);
      f.set("labelOffsetY", -14 - idx * 16);
    }
    f.set("endpointIndex", i);
    source.addFeature(f);
  });
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

