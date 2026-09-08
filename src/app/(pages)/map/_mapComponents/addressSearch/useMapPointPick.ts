"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { fromLonLat, toLonLat } from "ol/proj";
import { Style, Circle as CircleStyle, Fill, Stroke } from "ol/style";
import type { MapBrowserEvent } from "ol";
import { unByKey } from "ol/Observable";
import { useMapContext } from "../MapContext";
import { bindMapViewportPointerPresence } from "../hooks/mapViewportPointerPresence";
import { getAddressFromCoord } from "./vworldAddressSearch";

const DRAFT_LAYER_ID = "map-point-pick-draft";
const DRAFT_FEATURE_ID = "draft";
const CURSOR_FEATURE_ID = "cursor";

/** 고도 측정과 동일 계열 — 이동 중 미리보기 점 */
const styleCursor = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#3388ff" }),
    stroke: new Stroke({ color: "#fff", width: 2 }),
  }),
});

const styleDraft = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: "rgba(29, 106, 227, 0.85)" }),
    stroke: new Stroke({ color: "#fff", width: 2 }),
  }),
});

type PickResult = {
  lon: number;
  lat: number;
  address: string;
};

type Options = {
  vworldApiKey?: string;
  onPicked: (result: PickResult) => void;
};

export function useMapPointPick({ vworldApiKey = "", onPicked }: Options) {
  const mapContext = useMapContext();
  const mapInstanceRef = mapContext?.mapInstanceRef;
  const setDrawSuspended = mapContext?.setMapDrawInputSuspended;
  const onPickedRef = useRef(onPicked);
  onPickedRef.current = onPicked;

  const [pickMode, setPickMode] = useState(false);
  const drawLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  const ensureDraftLayer = useCallback(
    (map: NonNullable<typeof mapInstanceRef>["current"]) => {
      if (!map) return null;
      if (!drawLayerRef.current) {
        const source = new VectorSource();
        const layer = new VectorLayer({
          source,
          properties: { id: DRAFT_LAYER_ID },
          zIndex: 9999,
          style: (feature) =>
            feature.getId() === CURSOR_FEATURE_ID ? styleCursor : styleDraft,
        });
        map.addLayer(layer);
        drawLayerRef.current = layer;
      }
      return drawLayerRef.current;
    },
    [mapInstanceRef]
  );

  const showDraftAt = useCallback(
    (lon: number, lat: number) => {
      const map = mapInstanceRef?.current;
      if (!map) return;
      const layer = ensureDraftLayer(map);
      const source = layer?.getSource();
      if (!source) return;
      const cursor = source.getFeatureById(CURSOR_FEATURE_ID);
      if (cursor) source.removeFeature(cursor);
      const prev = source.getFeatureById(DRAFT_FEATURE_ID);
      if (prev) source.removeFeature(prev);
      const feature = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
      feature.setId(DRAFT_FEATURE_ID);
      source.addFeature(feature);
      layer?.changed();
    },
    [ensureDraftLayer, mapInstanceRef]
  );

  const clearDraftPoint = useCallback(() => {
    const map = mapInstanceRef?.current;
    if (drawLayerRef.current) {
      drawLayerRef.current.getSource()?.clear();
      if (map) {
        map.removeLayer(drawLayerRef.current);
      }
      drawLayerRef.current = null;
    }
  }, [mapInstanceRef]);

  const stopPick = useCallback(() => {
    setPickMode(false);
  }, []);

  const startPick = useCallback(() => {
    if (!mapInstanceRef?.current) {
      window.alert("지도가 준비되지 않았습니다.");
      return;
    }
    setPickMode(true);
  }, [mapInstanceRef]);

  useEffect(() => {
    if (!pickMode) {
      setDrawSuspended?.(false);
      return;
    }

    const map = mapInstanceRef?.current;
    if (!map) {
      setPickMode(false);
      return;
    }

    setDrawSuspended?.(true);
    const layer = ensureDraftLayer(map);
    const source = layer?.getSource();
    if (!source) {
      setPickMode(false);
      return;
    }

    const targetEl = map.getTargetElement();
    if (targetEl) targetEl.style.cursor = "crosshair";

    const hideCursor = () => {
      const cursor = source.getFeatureById(CURSOR_FEATURE_ID);
      if (cursor) source.removeFeature(cursor);
      layer?.changed();
    };

    const onPointerMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (source.getFeatureById(DRAFT_FEATURE_ID)) return;
      let cursor = source.getFeatureById(CURSOR_FEATURE_ID);
      if (!cursor) {
        cursor = new Feature({ geometry: new Point(evt.coordinate) });
        cursor.setId(CURSOR_FEATURE_ID);
        source.addFeature(cursor);
      } else {
        const geom = cursor.getGeometry();
        if (geom instanceof Point) geom.setCoordinates(evt.coordinate);
      }
      layer?.changed();
    };

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      const viewProj = map.getView().getProjection();
      const [lon, lat] = toLonLat(evt.coordinate, viewProj);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      hideCursor();
      showDraftAt(lon, lat);
      onPickedRef.current({ lon, lat, address: "" });
      evt.stopPropagation();

      void (async () => {
        const addr = await getAddressFromCoord(lon, lat, { apiKey: vworldApiKey || undefined });
        const address = (addr?.road || addr?.jibun || "").trim();
        onPickedRef.current({ lon, lat, address });
      })();

      setPickMode(false);
    };

    hideCursor();
    const unbindPresence = bindMapViewportPointerPresence(map, { onLeave: hideCursor });
    const moveKey = map.on("pointermove", onPointerMove as never);
    const clickKey = map.on("singleclick", onClick as never);

    return () => {
      unbindPresence();
      unByKey(moveKey);
      unByKey(clickKey);
      if (targetEl) targetEl.style.cursor = "";
      hideCursor();
      setDrawSuspended?.(false);
    };
  }, [
    ensureDraftLayer,
    mapInstanceRef,
    pickMode,
    setDrawSuspended,
    showDraftAt,
    vworldApiKey,
  ]);

  useEffect(() => {
    return () => {
      const map = mapInstanceRef?.current;
      if (map && drawLayerRef.current) {
        map.removeLayer(drawLayerRef.current);
        drawLayerRef.current = null;
      }
      setDrawSuspended?.(false);
    };
  }, [mapInstanceRef, setDrawSuspended]);

  return { pickMode, startPick, stopPick, clearDraftPoint };
}
