"use client";

import { useCallback, useEffect, useRef } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type { Map as OLMap } from "ol";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style";
import type { StyleFunction } from "ol/style/Style";
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from "@/lib/mapDataQueryMapHighlight";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { scheduleAnimateMapToCenter3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import {
  lonLatTo3857,
  type SteepSlopeSafetyCard,
} from "./steepSlopeSafetyMock";

const LAYER_PROP = "steepSlopeSafetyHighlight";

function createHighlightStyle(getPulsePhase: () => number): StyleFunction {
  const radarStyleFn = createDataQuerySelectionRowHighlightStyle(getPulsePhase);
  return (feature: FeatureLike, resolution: number) => {
    const radar = radarStyleFn(feature, resolution);
    const center = new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: "rgba(220, 38, 38, 0.95)" }),
        stroke: new Stroke({ color: "#ffffff", width: 2 }),
      }),
      zIndex: 2,
    });
    if (!radar) return center;
    if (Array.isArray(radar)) return [...radar, center];
    return [radar, center];
  };
}

let sharedMap: OLMap | null = null;
let sharedSource: VectorSource | null = null;
let sharedLayer: VectorLayer<VectorSource> | null = null;
let sharedMountCount = 0;
let sharedPulsePhase = 0;
let sharedRadarRaf: number | null = null;
let sharedRadarConsumers = 0;

function startSharedRadar() {
  sharedRadarConsumers += 1;
  if (sharedRadarRaf != null) return;
  const loop = () => {
    sharedPulsePhase += DATA_QUERY_SELECTION_PULSE_STEP;
    sharedSource?.changed();
    sharedRadarRaf = requestAnimationFrame(loop);
  };
  sharedRadarRaf = requestAnimationFrame(loop);
}

function stopSharedRadar() {
  sharedRadarConsumers = Math.max(0, sharedRadarConsumers - 1);
  if (sharedRadarConsumers > 0) return;
  if (sharedRadarRaf != null) {
    cancelAnimationFrame(sharedRadarRaf);
    sharedRadarRaf = null;
  }
  sharedPulsePhase = 0;
}

function ensureSharedLayer(map: OLMap): VectorSource {
  if (sharedSource && sharedLayer && sharedMap === map) return sharedSource;
  if (sharedLayer && sharedMap) sharedMap.removeLayer(sharedLayer);
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    style: createHighlightStyle(() => sharedPulsePhase),
    zIndex: 9600,
  });
  layer.set(LAYER_PROP, true);
  map.addLayer(layer);
  sharedMap = map;
  sharedSource = source;
  sharedLayer = layer;
  return source;
}

function disposeSharedLayerIfUnused() {
  if (sharedMountCount > 0) return;
  stopSharedRadar();
  if (sharedLayer && sharedMap) sharedMap.removeLayer(sharedLayer);
  sharedMap = null;
  sharedSource = null;
  sharedLayer = null;
}

export function useSteepSlopeSafetyMapHighlight() {
  const mapContext = useMapContext();
  const mapRef = useRef(mapContext?.mapInstanceRef);
  mapRef.current = mapContext?.mapInstanceRef;

  useEffect(() => {
    sharedMountCount += 1;
    startSharedRadar();
    return () => {
      sharedMountCount = Math.max(0, sharedMountCount - 1);
      stopSharedRadar();
      disposeSharedLayerIfUnused();
    };
  }, []);

  const clearHighlight = useCallback(() => {
    sharedSource?.clear();
  }, []);

  const highlightCard = useCallback(
    (card: SteepSlopeSafetyCard | null, opts?: { fly?: boolean }) => {
      const map = mapRef.current?.current;
      if (!map || !card) {
        clearHighlight();
        return;
      }
      const lon = Number(card.lon);
      const lat = Number(card.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        clearHighlight();
        return;
      }
      const source = ensureSharedLayer(map);
      source.clear();
      const coord = lonLatTo3857(lon, lat);
      const f = new Feature({ geometry: new Point(coord) });
      f.setId(card.id);
      source.addFeature(f);
      if (opts?.fly !== false) {
        scheduleAnimateMapToCenter3857(
          map,
          coord,
          Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
          {
            applyMapViewPadding: () =>
              mapContext?.applyMapViewPaddingRef?.current?.(),
          }
        );
      }
    },
    [clearHighlight, mapContext?.applyMapViewPaddingRef]
  );

  return { highlightCard, clearHighlight };
}
