"use client";

import { useEffect, useRef, useState } from "react";
import type Map from "ol/Map";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import { Style, Stroke, Circle as CircleStyle, Fill, Text } from "ol/style";
import { transform } from "ol/proj";
import { call } from "@/lib/api";

type EndpointKind = "start" | "end";

type EndpointMarker = {
  id: string;
  kind: EndpointKind;
  lon: number;
  lat: number;
};

/** 상세·선택 시 쓰던 기점·종점 마커와 동일 */
function endpointMarkerStyle(kind: EndpointKind): Style {
  const fill = kind === "start" ? "#059669" : "#c2410c";
  const label = kind === "start" ? "기점" : "종점";
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: fill }),
      stroke: new Stroke({ color: "#fff", width: 2 }),
    }),
    text: new Text({
      text: label,
      offsetY: -14,
      font: "600 11px sans-serif",
      fill: new Fill({ color: fill }),
      stroke: new Stroke({ color: "#fff", width: 3 }),
    }),
  });
}

const styleStart = endpointMarkerStyle("start");
const styleEnd = endpointMarkerStyle("end");

/**
 * 도로망도 «시종점» 토글 — DB 기점·종점 점 레이어를 기존 UI(녹색 기점 / 주황 종점)로 표시.
 */
export function useRoadNetworkEndpointLayer(
  map: Map | null | undefined,
  enabled: boolean
): void {
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const [markers, setMarkers] = useState<EndpointMarker[] | null>(null);

  useEffect(() => {
    if (!map) return;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 1094,
      style: (f) =>
        String(f.get("kind")) === "end" ? styleEnd : styleStart,
      visible: false,
    });
    map.addLayer(layer);
    sourceRef.current = source;
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!enabled) {
      setMarkers(null);
      return;
    }
    let cancelled = false;
    void call("", "POST", {
      service: "roadNetworkService",
      action: "listRoadNetworkEndpointMarkers",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const list = Array.isArray(data?.markers) ? data.markers : [];
        const next: EndpointMarker[] = [];
        for (const raw of list) {
          const id = String(raw?.id ?? "").trim();
          const kind = raw?.kind === "end" ? "end" : "start";
          const lon = Number(raw?.lon);
          const lat = Number(raw?.lat);
          if (!id || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          next.push({ id, kind, lon, lat });
        }
        setMarkers(next);
      })
      .catch(() => {
        if (!cancelled) setMarkers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    const source = sourceRef.current;
    const layer = layerRef.current;
    if (!map || !source || !layer) return;
    source.clear();
    layer.setVisible(enabled && (markers?.length ?? 0) > 0);
    if (!enabled || !markers?.length) return;

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    for (const m of markers) {
      const coord = transform([m.lon, m.lat], "EPSG:4326", viewProj);
      const f = new Feature({ geometry: new Point(coord) });
      f.setId(m.id);
      f.set("kind", m.kind);
      source.addFeature(f);
    }
  }, [map, enabled, markers]);
}
