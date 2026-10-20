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

/** GeoServer 표지 점 스타일(rdl_network_ps)과 같은 모양·색(지도 서버 styles 폴더의 표지 SVG와 같은 내용) — 미개설 필터 때 선 위에 직접 그린다 */
type ShieldKind = "highway" | "national" | "provincial" | "county" | "local";

const SHIELD_SVG: Record<ShieldKind, string> = {
  highway:
    '<svg width="26" height="25" viewBox="0 0 26 25" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_16610_17)"><path d="M24.5775 14.1801C23.9119 13.2682 23.2833 12.4068 23.2833 10.677C23.2833 9.55542 23.6477 8.48965 24.3664 7.50932C24.9176 6.75759 25.4804 6.34202 25.4852 6.33852L25.9759 5.98313L20.4295 0.423962L20.0923 0.0835259L19.7848 0.456505C19.7817 0.460176 19.4709 0.82824 18.9084 1.18931C18.1658 1.66597 17.3559 1.90766 16.5011 1.90766C15.6513 1.90766 14.8651 1.66867 14.1643 1.19733C13.6343 0.840926 13.3537 0.477499 13.3522 0.475567L13.0046 0L12.6492 0.47385C12.6464 0.477478 12.3658 0.840926 11.8358 1.19733C11.1349 1.66867 10.3487 1.90766 9.49901 1.90766C8.6442 1.90766 7.83424 1.66597 7.09169 1.18931C6.52924 0.82824 6.21834 0.460198 6.21637 0.457858L5.90895 0.0848783L0.458408 5.54787L0.0269298 5.98177L0.514008 6.3379C0.519634 6.34202 1.08245 6.75757 1.63359 7.5093C2.35232 8.48963 2.71676 9.5554 2.71676 10.677C2.71676 12.4068 2.08811 13.2682 1.42253 14.1801C0.723154 15.1383 0 16.1291 0 18.0185C0 19.299 0.518839 20.5544 1.46095 21.5533C2.54794 22.7058 4.0667 23.3589 5.52298 23.2998C6.1938 23.2726 6.84512 23.2432 7.475 23.2147C9.17949 23.1376 10.7895 23.0648 11.1895 23.1235C11.6421 23.1899 12.1565 23.5276 12.6771 24.1003L13 24.4554L13.3228 24.1003C13.8434 23.5276 14.3578 23.1898 14.8104 23.1235C15.2105 23.0649 16.8205 23.1376 18.525 23.2147C19.1548 23.2432 19.8062 23.2726 20.477 23.2998C20.5377 23.3022 20.5983 23.3035 20.6592 23.3035C22.0592 23.3034 23.4973 22.6578 24.539 21.5533C25.4811 20.5544 26 19.299 26 18.0185C26 16.1291 25.2768 15.1383 24.5774 14.1801L24.5775 14.1801Z" fill="white"/><path d="M5.48942 22.296C6.15828 22.2689 6.80859 22.2395 7.43749 22.2111C8.93152 22.1435 9.98912 22.0977 10.6515 22.0977C10.9502 22.0977 11.1683 22.107 11.3102 22.1278C11.8667 22.2094 12.4337 22.5223 13 23.0594C13.5662 22.5223 14.1332 22.2094 14.6898 22.1278C15.1463 22.0608 16.3949 22.113 18.5625 22.211C19.1914 22.2395 19.8417 22.2689 20.5106 22.296C21.7241 22.3453 22.9933 21.797 23.9053 20.8301C24.6673 20.0222 25.0869 19.0237 25.0869 18.0183C25.0869 16.4823 24.5209 15.7068 23.8655 14.8088C23.1646 13.8485 22.3702 12.7601 22.3702 10.6769C22.3702 9.47108 22.7312 8.28617 23.418 7.22412H2.58205C3.26876 8.28615 3.62982 9.47106 3.62982 10.6769C3.62982 12.7601 2.83541 13.8485 2.13453 14.8088C1.47911 15.7068 0.913086 16.4823 0.913086 18.0183C0.913086 19.0236 1.33271 20.0222 2.09465 20.8301C3.00668 21.797 4.27562 22.3451 5.48942 22.296Z" fill="#0044DC"/><path d="M16.5011 2.91217C14.7293 2.91217 13.5487 2.0299 13.0001 1.50081C12.4514 2.02988 11.2708 2.91217 9.49904 2.91217C7.69332 2.91217 6.44014 1.99547 5.87581 1.47705L1.47339 5.88961C1.58577 5.99618 1.69468 6.10635 1.79996 6.21993H24.2002C24.3055 6.10635 24.4144 5.99618 24.5268 5.88961L20.1244 1.47705C19.5601 1.99544 18.3068 2.91217 16.5011 2.91217Z" fill="#CB2235"/></g><defs><clipPath id="clip0_16610_17"><rect width="26" height="24.4554" fill="white"/></clipPath></defs></svg>',
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
  highway: [25, 24],
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
