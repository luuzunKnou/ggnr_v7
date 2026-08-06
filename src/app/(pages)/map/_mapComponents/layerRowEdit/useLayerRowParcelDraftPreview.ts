"use client";

import { useEffect, useRef } from "react";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import Feature from "ol/Feature";
import { Polygon } from "ol/geom";
import { Style, Stroke, Fill } from "ol/style";
import { useMapContext } from "../MapContext";
import { getParcelExtent3857 } from "./layerRowParcelUtils";
import type { LayerRowParcelHighlightVariant } from "./useLayerRowParcelHighlight";
import type { LayerRowParcelItem } from "./types";

const DRAFT_PREVIEW_STYLES: Record<LayerRowParcelHighlightVariant, Style> = {
  blue: new Style({
    stroke: new Stroke({ color: "rgba(29, 78, 216, 0.85)", width: 2 }),
    fill: new Fill({ color: "rgba(29, 78, 216, 0.2)" }),
  }),
  yellow: new Style({
    stroke: new Stroke({ color: "rgba(234, 179, 8, 0.9)", width: 2 }),
    fill: new Fill({ color: "rgba(250, 204, 21, 0.28)" }),
  }),
};

function addParcelItemToSource(source: VectorSource, item: LayerRowParcelItem) {
  if (item.showMapGeom === false) return;

  if (item.geometry3857) {
    try {
      const format = new GeoJSON();
      const features = format.readFeatures(
        {
          type: "Feature",
          geometry: item.geometry3857,
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

  const ext = getParcelExtent3857(item);
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
}

/** 수정 중 draft 목록 — WMS 저장 전 지도 미리보기 (필지·물건지) */
export function useLayerRowParcelDraftPreview(
  items: LayerRowParcelItem[],
  variant: LayerRowParcelHighlightVariant,
  active: boolean
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: DRAFT_PREVIEW_STYLES[variant],
      zIndex: 915,
    });
    layer.set("layerRowParcelDraftPreview", true);
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
    source.clear();
    if (!active) return;

    for (const item of items) {
      addParcelItemToSource(source, item);
    }
  }, [active, items, variant]);
}
