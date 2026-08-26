"use client";

import { useEffect, useRef, useState } from "react";
import type { Feature } from "ol";
import type { Map as OLMap } from "ol";
import { transform } from "ol/proj";
import { easeOut } from "ol/easing";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import GeoJSONFormat from "ol/format/GeoJSON";
import "../../_mapComponents/config/projections";
import { useMapContext } from "../../_mapComponents/MapContext";
import { compareFeaturesByGeometryStackOrder } from "@/lib/mapLayerGeometryOrder";
import { prepareMapForPanelAwareNavigation } from "../../_mapComponents/config/mapAutoNavigation";
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from "@/lib/mapDataQueryMapHighlight";

const MEMO_CLICK_ZOOM = 18;
const MEMO_FLY_MS = 600;

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== "object" || !("type" in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== "string") return false;
  if (t === "GeometryCollection") return "geometries" in v;
  return "coordinates" in v;
}

export function center3857FromExtent(extent: unknown): [number, number] | null {
  if (!Array.isArray(extent) || extent.length !== 4) return null;
  const nums = extent.map((v) => Number(v));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  return [(nums[0]! + nums[2]!) / 2, (nums[1]! + nums[3]!) / 2];
}

export function animateMemoToCenter3857(
  map: OLMap,
  center3857: [number, number],
  applyMapViewPadding?: (() => void) | null
) {
  const run = () => {
    prepareMapForPanelAwareNavigation(map, applyMapViewPadding);
    const view = map.getView();
    view.cancelAnimations();
    const viewProj = view.getProjection()?.getCode() || "EPSG:3857";
    const center =
      viewProj === "EPSG:3857" ? center3857 : transform(center3857, "EPSG:3857", viewProj);
    const currentZoom = view.getZoom();
    const targetZoom = Math.max(
      Number.isFinite(currentZoom) ? (currentZoom as number) : 0,
      MEMO_CLICK_ZOOM
    );
    const resolution = view.getResolutionForZoom(targetZoom);
    view.animate({
      center,
      resolution,
      duration: MEMO_FLY_MS,
      easing: easeOut,
    });
  };
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });
}

function featuresFromGeom(
  map: OLMap,
  geomGeoJson4326: Record<string, unknown> | null | undefined
): Feature[] {
  if (!looksLikeGeoJsonGeometry(geomGeoJson4326)) return [];
  const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
  const format = new GeoJSONFormat();
  const features = format.readFeatures(
    {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: geomGeoJson4326, properties: {} }],
    },
    { dataProjection: "EPSG:4326", featureProjection: viewProj }
  );
  if (features.length === 0) return [];
  const geomType = features[0].getGeometry()?.getType();
  if (geomType === "Point" || geomType === "MultiPoint") {
    features[0].set("isRadarPoint", true);
  }
  return features;
}

/** 메모 선택 — 민원과 동일한 붉은 펄스·동심원 강조 */
export function useMemoMapHighlight(
  mapReady: boolean,
  geomGeoJson4326: Record<string, unknown> | null | undefined
) {
  const mapContext = useMapContext();
  const sourceRef = useRef<VectorSource | null>(null);
  const geomRef = useRef(geomGeoJson4326);
  geomRef.current = geomGeoJson4326;
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);

  useEffect(() => {
    if (!radarActive) return;
    let rafId: number;
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP;
      sourceRef.current?.changed();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [radarActive]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      zIndex: 10000,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    });
    layer.set("memoHighlight", true);
    map.addLayer(layer);

    const pending = featuresFromGeom(map, geomRef.current);
    if (pending.length > 0) {
      source.addFeatures(pending);
      setRadarActive(true);
    }

    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source) return;

    source.clear();
    const features = featuresFromGeom(map, geomGeoJson4326);
    if (features.length === 0) {
      setRadarActive(false);
      return;
    }
    source.addFeatures(features);
    setRadarActive(true);
  }, [geomGeoJson4326, mapContext?.mapInstanceRef]);
}
