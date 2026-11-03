"use client";

/**
 * 사업계획(제방) — 레이어 ON 시 펄스만 (이름 라벨은 GeoServer 스타일).
 * 색인도 상세: 미선택이면 교차 제방 전체, 목록 선택 시 해당 제방만.
 */

import { useEffect, useRef, useState } from "react";
import Feature from "ol/Feature";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Stroke, Style } from "ol/style";
import type { StyleLike } from "ol/style/Style";
import { call } from "@/lib/api";
import {
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from "@/lib/mapDataQueryMapHighlight";
import { useMapContext } from "../../../_mapComponents/MapContext";

function createPulseLineStyle(getPulsePhase: () => number): StyleLike {
  return () => {
    const t = Math.sin(getPulsePhase());
    const whiteOp = 0.35 + 0.6 * t;
    const redOp = 0.3 + 0.65 * t;
    return [
      new Style({
        stroke: new Stroke({
          color: `rgba(255, 255, 255, ${whiteOp})`,
          width: 5,
          lineCap: "round",
          lineJoin: "round",
        }),
      }),
      new Style({
        stroke: new Stroke({
          color: `rgba(220, 38, 38, ${redOp})`,
          width: 3,
          lineCap: "round",
          lineJoin: "round",
        }),
      }),
    ];
  };
}

type JbRow = {
  ogcFid: number;
  geometry: Record<string, unknown> | null;
};

export function useRiverBasicPlanJbLabels(opts: {
  tab: string;
  riverName: string;
  active: boolean;
  pulseOgcFids?: number[];
}) {
  const { tab, riverName, active, pulseOgcFids = [] } = opts;
  const mapContext = useMapContext();
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const [rows, setRows] = useState<JbRow[]>([]);
  const [radarActive, setRadarActive] = useState(false);

  const pulseKey = pulseOgcFids
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.floor(n))
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      zIndex: 860,
      declutter: false,
    });
    layer.set("riverBasicPlanJbPulse", true);
    insertLayerBelowServiceLayer(map, layer);

    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapContext?.mapInstanceRef]);

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
    if (!active || !riverName.trim()) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanJbList",
          params: { tab, riverName: riverName.trim() },
        });
        if (cancelled) return;
        const data = res?.data ?? res;
        const list = Array.isArray(data?.items) ? data.items : [];
        const parsed: JbRow[] = [];
        for (const raw of list) {
          const r = raw as Record<string, unknown>;
          const fid = Number(r.ogcFid);
          if (!Number.isFinite(fid)) continue;
          parsed.push({
            ogcFid: Math.floor(fid),
            geometry:
              r.geometry && typeof r.geometry === "object"
                ? (r.geometry as Record<string, unknown>)
                : null,
          });
        }
        setRows(parsed);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, tab, riverName]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();
    setRadarActive(false);

    if (!active || rows.length === 0 || !pulseKey) return;

    const format = new GeoJSON();
    const pulseSet = new Set(
      pulseKey
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    if (pulseSet.size === 0) return;

    const pulseStyle = createPulseLineStyle(() => pulsePhaseRef.current);
    const features: Feature[] = [];

    for (const row of rows) {
      if (!row.geometry || !pulseSet.has(row.ogcFid)) continue;
      try {
        const read = format.readFeatures(
          { type: "Feature", geometry: row.geometry, properties: {} },
          { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" }
        );
        const g = read[0]?.getGeometry()?.clone();
        if (!g) continue;
        const lineFeat = new Feature({ geometry: g });
        lineFeat.setStyle(pulseStyle);
        features.push(lineFeat);
      } catch {
        /* skip */
      }
    }

    if (features.length === 0) return;
    source.addFeatures(features);
    setRadarActive(true);
  }, [active, rows, pulseKey]);
}
