"use client";

import { useEffect, useRef } from "react";
import type Map from "ol/Map";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import GeoJSONFormat from "ol/format/GeoJSON";
import { Icon, Style } from "ol/style";
import type { RoadNetworkRow } from "./roadNetworkMock";

/** GeoServer 표지 점 스타일(rdl_network_ps)과 같은 모양·색 — 미개설 필터 때 선 위에 직접 그린다 */
type ShieldKind = "highway" | "national" | "provincial" | "county" | "local";

const SHIELD_SVG: Record<ShieldKind, string> = {
  highway:
    '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><defs><clipPath id="s"><path d="M1.2 1.6 Q4 6 7.4 4.2 Q10.4 2.4 13 3.4 Q15.6 2.4 18.6 4.2 Q22 6 24.8 1.6 C24 8 23.4 9.4 24.2 13 C25.2 19 18.4 21.4 13 25 C7.6 21.4 0.8 19 1.8 13 C2.6 9.4 2 8 1.2 1.6 Z"/></clipPath></defs><g clip-path="url(#s)"><rect x="0" y="0" width="26" height="26" fill="#0A2FA8"/><rect x="0" y="0" width="26" height="8.6" fill="#E8141B"/></g><path d="M1.2 1.6 Q4 6 7.4 4.2 Q10.4 2.4 13 3.4 Q15.6 2.4 18.6 4.2 Q22 6 24.8 1.6 C24 8 23.4 9.4 24.2 13 C25.2 19 18.4 21.4 13 25 C7.6 21.4 0.8 19 1.8 13 C2.6 9.4 2 8 1.2 1.6 Z" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  national:
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 40 24" preserveAspectRatio="none"><ellipse cx="20" cy="12" rx="19.2" ry="11.2" fill="#1E4FA8" stroke="#FFFFFF" stroke-width="1.2"/></svg>',
  provincial:
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 40 24" preserveAspectRatio="none"><rect x="0.6" y="0.6" width="38.8" height="22.8" rx="2" ry="2" fill="#FFD200" stroke="#6D5A00" stroke-width="1.2"/></svg>',
  county:
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 40 24" preserveAspectRatio="none"><polygon points="7,1 33,1 39,12 33,23 7,23 1,12" fill="#FFFFFF" stroke="#1F76AC" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  local:
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 40 24" preserveAspectRatio="none"><rect x="0.6" y="0.6" width="38.8" height="22.8" rx="2" ry="2" fill="#FFFFFF" stroke="#883700" stroke-width="1.6"/></svg>',
};

const SHIELD_TEXT_COLOR: Record<ShieldKind, string> = {
  highway: "#FFFFFF",
  national: "#FFFFFF",
  provincial: "#1E4FA8",
  county: "#1F76AC",
  local: "#212121",
};

const SHIELD_SIZE: Record<ShieldKind, [number, number]> = {
  highway: [24, 24],
  national: [33, 20],
  provincial: [33, 20],
  county: [33, 20],
  local: [33, 20],
};

/** 표지 우선순위 — 겹치면 높은 등급이 남는다 */
const SHIELD_PRIORITY: Record<ShieldKind, number> = {
  highway: 5,
  national: 4,
  provincial: 3,
  county: 2,
  local: 1,
};

/** GeoServer 표지 축척 조건(1:400,000 미만)과 비슷한 줌 */
const MIN_ZOOM = 10.5;

function shieldKindFromGrade(grade: string | undefined): ShieldKind | null {
  switch (grade) {
    case "고속도로":
      return "highway";
    case "국도":
      return "national";
    case "국가지원지방도":
    case "지방도":
      return "provincial";
    case "시군도":
      return "county";
    case "면도":
    case "리도":
    case "농도":
      return "local";
    default:
      return null;
  }
}

/** 지도 서버 표지(rdl_network_ps.css, Serif = 윈도우 Times New Roman)와 같은 명조 굵게 */
const SHIELD_TEXT_FONTS = ["'Times New Roman', serif"];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shieldSvgWithText(kind: ShieldKind, num: string): string {
  const [width, height] = SHIELD_SIZE[kind];
  const shield = SHIELD_SVG[kind].replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
  const text = SHIELD_TEXT_FONTS.map(
    (family) =>
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-size="12" font-weight="bold" fill="${SHIELD_TEXT_COLOR[kind]}">${escapeXml(num)}</text>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shield}${text}</svg>`;
}

const styleCache = new globalThis.Map<string, Style>();
function shieldStyle(kind: ShieldKind, num: string): Style {
  const key = `${kind}|${num}`;
  let style = styleCache.get(key);
  if (!style) {
    const [width, height] = SHIELD_SIZE[kind];
    style = new Style({
      image: new Icon({
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shieldSvgWithText(kind, num))}`,
        width,
        height,
      }),
      zIndex: SHIELD_PRIORITY[kind],
    });
    styleCache.set(key, style);
  }
  return style;
}

/** 선(여러 줄이면 가장 긴 줄)의 길이 중간 지점 */
function lineMidpoint(geom: unknown): number[] | null {
  let line: LineString | null = null;
  if (geom instanceof LineString) line = geom;
  else if (geom instanceof MultiLineString) {
    for (const part of geom.getLineStrings()) {
      if (!line || part.getLength() > line.getLength()) line = part;
    }
  }
  if (!line || line.getLength() === 0) return null;
  return line.getCoordinateAt(0.5);
}

/**
 * 도로망도 미개설 필터 — 표지 점(개설 구간 기준으로 찍힘) 대신 목록에 남은 미개설 구간 선 위에 번호 표지를 그린다.
 * 목록과 같은 행(검색·영역·종류 필터 반영)을 쓰므로 목록에 없는 노선 표지는 나오지 않는다.
 */
export function useRoadNetworkUnopenedSignLayer(
  map: Map | null | undefined,
  rows: readonly RoadNetworkRow[],
  enabled: boolean
): void {
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    if (!map) return;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      declutter: true,
      minZoom: MIN_ZOOM,
      zIndex: 1102,
      style: (f) => shieldStyle(f.get("kind") as ShieldKind, String(f.get("num") ?? "")),
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
    const source = sourceRef.current;
    const layer = layerRef.current;
    if (!map || !source || !layer) return;
    source.clear();
    layer.setVisible(enabled);
    if (!enabled) return;

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    const format = new GeoJSONFormat();
    const features: Feature[] = [];
    for (const row of rows) {
      if (row.openStatus !== "미개설" || !row.geom) continue;
      const num = row.roadNo.trim();
      const kind = shieldKindFromGrade(row.roadGrade);
      if (!num || !kind) continue;
      const geom = format.readGeometry(row.geom, {
        dataProjection: "EPSG:4326",
        featureProjection: viewProj,
      });
      const at = lineMidpoint(geom);
      if (!at) continue;
      const f = new Feature({ geometry: new Point(at) });
      f.set("kind", kind);
      f.set("num", num);
      features.push(f);
    }
    source.addFeatures(features);
  }, [map, rows, enabled]);
}
