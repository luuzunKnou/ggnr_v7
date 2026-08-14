"use client";

import { useEffect, useRef } from "react";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import Feature from "ol/Feature";
import { Polygon } from "ol/geom";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import {
  occupationFillRgba,
  occupationStrokeRgba,
} from "@/lib/occupationLayerStyle";
import { useMapContext } from "../MapContext";
import { getParcelExtent3857 } from "./layerRowParcelUtils";
import type { LayerRowParcelItem } from "./types";

/** blue=필지, red=물건지 (GeoServer 팔레트와 동일) */
export type LayerRowParcelHighlightVariant = "blue" | "red" | "yellow" | "black";

const HIGHLIGHT_STYLES: Record<
  LayerRowParcelHighlightVariant,
  { polygon: Style; point: Style }
> = {
  blue: {
    polygon: new Style({
      stroke: new Stroke({ color: occupationStrokeRgba("parcel"), width: 2 }),
      fill: new Fill({ color: occupationFillRgba("parcel") }),
    }),
    point: new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: occupationFillRgba("parcel", 0.85) }),
        stroke: new Stroke({ color: "#fff", width: 2 }),
      }),
    }),
  },
  red: {
    polygon: new Style({
      stroke: new Stroke({ color: occupationStrokeRgba("mgj"), width: 2 }),
      fill: new Fill({ color: occupationFillRgba("mgj") }),
    }),
    point: new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: occupationFillRgba("mgj", 0.85) }),
        stroke: new Stroke({ color: "#fff", width: 2 }),
      }),
    }),
  },
  yellow: {
    polygon: new Style({
      stroke: new Stroke({ color: occupationStrokeRgba("facility"), width: 2 }),
      fill: new Fill({ color: occupationFillRgba("facility") }),
    }),
    point: new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: occupationFillRgba("facility", 0.9) }),
        stroke: new Stroke({ color: "#333", width: 2 }),
      }),
    }),
  },
  black: {
    polygon: new Style({
      stroke: new Stroke({ color: occupationStrokeRgba("mgj"), width: 2 }),
      fill: new Fill({ color: occupationFillRgba("mgj") }),
    }),
    point: new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: occupationFillRgba("mgj", 0.85) }),
        stroke: new Stroke({ color: "#fff", width: 2 }),
      }),
    }),
  },
};

function highlightStyleForFeature(
  feature: import("ol/Feature").FeatureLike,
  variant: LayerRowParcelHighlightVariant
) {
  const styles = HIGHLIGHT_STYLES[variant];
  const type = feature.getGeometry()?.getType();
  return type === "Point" || type === "MultiPoint" ? styles.point : styles.polygon;
}

/** 필지목록 선택 — 지도 위 활성 필지 표시 */
export function useLayerRowParcelHighlight(
  selectedItem: LayerRowParcelItem | null,
  variant: LayerRowParcelHighlightVariant = "blue"
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: (feature) => highlightStyleForFeature(feature, variant),
      zIndex: 920,
    });
    layer.set("layerRowParcelHighlight", true);
    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [mapContext?.mapInstanceRef, variant]);

  useEffect(() => {
    const source = layerRef.current?.getSource();
    if (!source) return;
    layerRef.current?.setStyle((feature) => highlightStyleForFeature(feature, variant));
    source.clear();
    if (!selectedItem) return;

    if (selectedItem.geometry3857) {
      try {
        const format = new GeoJSON();
        const features = format.readFeatures(
          {
            type: "Feature",
            geometry: selectedItem.geometry3857,
            properties: {},
          },
          { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" }
        );
        if (features.length > 0) {
          source.addFeatures(features);
          return;
        }
      } catch {
        // extent 폴백
      }
    }

    const ext = getParcelExtent3857(selectedItem);
    if (!ext) return;
    source.addFeature(
      new Feature(
        new Polygon([
          [
            [ext[0], ext[1]],
            [ext[2], ext[1]],
            [ext[2], ext[3]],
            [ext[0], ext[3]],
            [ext[0], ext[1]],
          ],
        ])
      )
    );
  }, [selectedItem, variant]);
}
