"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureLike } from "ol/Feature";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Stroke, Style } from "ol/style";
import type { StyleFunction } from "ol/style/Style";
import { call } from "@/lib/api";
import { compareFeaturesByGeometryStackOrder } from "@/lib/mapLayerGeometryOrder";
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from "@/lib/mapDataQueryMapHighlight";
import { useMapContext } from "../../../_mapComponents/MapContext";

/**
 * 색인도 강조 — 데이터조회와 동일 펄스 선, 폴리곤은 윤곽만(면 채움 없음).
 */
function createRiverBasicPlanIndexHighlightStyle(
  getPulsePhase: () => number
): StyleFunction {
  const base = createDataQuerySelectionRowHighlightStyle(getPulsePhase);
  return (feature: FeatureLike, resolution: number) => {
    const geomType = feature.getGeometry()?.getType();
    if (geomType === "Polygon" || geomType === "MultiPolygon") {
      const t = Math.sin(getPulsePhase());
      const whiteOp = 0.6 + 0.35 * t;
      const redOp = 0.5 + 0.3 * t;
      return [
        new Style({
          stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteOp})`, width: 7 + t }),
        }),
        new Style({
          stroke: new Stroke({ color: `rgba(220, 38, 38, ${redOp})`, width: 4 + 0.8 * t }),
        }),
      ];
    }
    return base(feature, resolution);
  };
}

/**
 * 하천기본계획 색인도 선택 — 붉은 펄스 윤곽 강조(폴리곤 fill 없음).
 * 도형은 ogc_fid 로 조회. 지도 이동(fit)은 호출측에서 유지.
 */
export function useRiverBasicPlanIndexHighlight(
  indexTable: string,
  ogcFid: number | null,
  active: boolean
) {
  const mapContext = useMapContext();
  const sourceRef = useRef<VectorSource | null>(null);
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
    if (!map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createRiverBasicPlanIndexHighlightStyle(() => pulsePhaseRef.current),
    });
    layer.set("riverBasicPlanIndexHighlight", true);
    insertLayerBelowServiceLayer(map, layer);

    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapContext?.mapInstanceRef]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;

    source.clear();
    setRadarActive(false);

    const table = String(indexTable ?? "").trim();
    const fid = Number(ogcFid);
    if (!active || !table || !Number.isFinite(fid) || fid <= 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "getTableRowGeomGeoJson3857",
          params: {
            table,
            schema: "layer",
            keyField: "ogc_fid",
            keyValue: Math.floor(fid),
          },
        });
        if (cancelled) return;
        const data = res?.data ?? res;
        const geometry = data?.geometry;
        if (!geometry || typeof geometry !== "object") return;

        const format = new GeoJSON();
        const features = format.readFeatures(
          { type: "Feature", geometry, properties: {} },
          { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" }
        );
        if (cancelled || features.length === 0) return;
        const geomType = features[0]?.getGeometry()?.getType();
        if (geomType === "Point" || geomType === "MultiPoint") {
          features[0]!.set("isRadarPoint", true);
        }
        source.clear();
        source.addFeatures(features);
        setRadarActive(true);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, indexTable, ogcFid]);
}
