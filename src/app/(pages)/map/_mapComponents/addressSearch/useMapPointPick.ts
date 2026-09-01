"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Draw } from "ol/interaction";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Point } from "ol/geom";
import { transform } from "ol/proj";
import { Style, Circle as CircleStyle, Fill, Stroke } from "ol/style";
import { useMapContext } from "../MapContext";
import { getAddressFromCoord } from "./vworldAddressSearch";

const DRAFT_LAYER_ID = "map-point-pick-draft";

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
  const drawRef = useRef<Draw | null>(null);

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
    const map = mapInstanceRef?.current;
    if (map && drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    setDrawSuspended?.(false);
  }, [mapInstanceRef, setDrawSuspended]);

  const startPick = useCallback(() => {
    const map = mapInstanceRef?.current;
    if (!map) {
      window.alert("지도가 준비되지 않았습니다.");
      return;
    }
    if (drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    setPickMode(true);
    setDrawSuspended?.(true);
    if (!drawLayerRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: DRAFT_LAYER_ID },
        zIndex: 9999,
        style: new Style({
          image: new CircleStyle({
            radius: 8,
            fill: new Fill({ color: "rgba(29, 106, 227, 0.85)" }),
            stroke: new Stroke({ color: "#fff", width: 2 }),
          }),
        }),
      });
      map.addLayer(layer);
      drawLayerRef.current = layer;
    }
    const source = drawLayerRef.current.getSource();
    if (!source) return;
    const draw = new Draw({ source, type: "Point", stopClick: true });
    draw.on("drawend", (e) => {
      const geom = e.feature.getGeometry();
      if (geom instanceof Point) {
        const [x, y] = geom.getCoordinates();
        const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
        const [x3857, y3857] =
          viewProj === "EPSG:3857" ? [x, y] : transform([x, y], viewProj, "EPSG:3857");
        const [lon, lat] = transform([x3857, y3857], "EPSG:3857", "EPSG:4326");
        void (async () => {
          const addr = await getAddressFromCoord(lon, lat, { apiKey: vworldApiKey || undefined });
          const address = (addr?.road || addr?.jibun || "").trim();
          onPickedRef.current({ lon, lat, address });
          if (drawLayerRef.current) {
            drawLayerRef.current.getSource()?.clear();
            map.removeLayer(drawLayerRef.current);
            drawLayerRef.current = null;
          }
        })();
      }
      setPickMode(false);
      if (drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      setDrawSuspended?.(false);
    });
    map.addInteraction(draw);
    drawRef.current = draw;
  }, [mapInstanceRef, setDrawSuspended, vworldApiKey]);

  useEffect(() => {
    return () => {
      const map = mapInstanceRef?.current;
      if (map && drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      if (map && drawLayerRef.current) {
        map.removeLayer(drawLayerRef.current);
        drawLayerRef.current = null;
      }
      setDrawSuspended?.(false);
    };
  }, [mapInstanceRef, setDrawSuspended]);

  return { pickMode, startPick, stopPick, clearDraftPoint };
}
