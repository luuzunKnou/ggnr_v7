"use client";

import { useEffect, useRef, useState } from "react";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { call } from "@/lib/api";
import { compareFeaturesByGeometryStackOrder } from "@/lib/mapLayerGeometryOrder";
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from "@/lib/mapDataQueryMapHighlight";
import { useMapContext } from "../../../_mapComponents/MapContext";

/**
 * 하천기본계획 색인도 선택 — 데이터조회 선택 행과 동일한 붉은 펄스 폴리곤 강조.
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
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
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
