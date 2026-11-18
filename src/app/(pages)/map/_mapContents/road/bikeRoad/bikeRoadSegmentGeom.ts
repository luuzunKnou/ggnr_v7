/**
 * 구간 도형·자동채움 도우미
 */

import { getLength } from "ol/sphere";
import LineString from "ol/geom/LineString";
import { fromLonLat, toLonLat } from "ol/proj";
import {
  createEmptyBikeRoadSegment,
  type BikeRoadSegment,
  type BikeRoadSegmentSide,
} from "./bikeRoadMock";
import { dualOffsetLines3857 } from "./bikeRoadLineOffset";
import type { Pt } from "./bikeRoadRoadNet";

export function lineLengthKmLonLat(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  const mapCoords = coords.map((c) => fromLonLat(c));
  const m = getLength(new LineString(mapCoords));
  return Math.round((m / 1000) * 100) / 100;
}

export function lineLengthKm3857(coords: Pt[]): number {
  if (coords.length < 2) return 0;
  const m = getLength(new LineString(coords));
  return Math.round((m / 1000) * 100) / 100;
}

export function toLonLatCoords(coords: Pt[]): [number, number][] {
  return coords.map((c) => {
    const ll = toLonLat(c);
    return [ll[0]!, ll[1]!] as [number, number];
  });
}

export function to3857Coords(coords: [number, number][]): Pt[] {
  return coords.map((c) => {
    const p = fromLonLat(c);
    return [p[0]!, p[1]!] as Pt;
  });
}

/** 노선 시점·종점 — 첫 구간 기점 / 마지막 구간 종점 */
export function routeEndsFromSegments(segments: BikeRoadSegment[]): {
  startPoint: string;
  endPoint: string;
} {
  if (segments.length === 0) {
    return { startPoint: "", endPoint: "" };
  }
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  return {
    startPoint: first.startName.trim(),
    endPoint: last.endName.trim(),
  };
}

/**
 * 엑셀처럼 구간이 이어질 때 — 직전 구간의 종점명.
 * 양측(R/L)은 같은 종점이므로 마지막 행 기준.
 */
export function previousSegmentEndName(segments: BikeRoadSegment[]): string {
  if (segments.length === 0) return "";
  return segments[segments.length - 1]!.endName.trim();
}

/** 다음 구간 그리기 시작점 — 직전 구간 선의 끝 좌표 */
export function previousSegmentEndLonLat(
  segments: BikeRoadSegment[]
): [number, number] | null {
  if (segments.length === 0) return null;
  // 양측이면 R(또는 C) 중심/우측 선 끝을 이어붙임
  const preferred =
    [...segments].reverse().find((s) => s.side === "R" || s.side === "C") ??
    segments[segments.length - 1]!;
  const coords =
    preferred.centerLineCoords && preferred.centerLineCoords.length >= 2
      ? preferred.centerLineCoords
      : preferred.lineCoords;
  if (!coords || coords.length < 2) return null;
  const end = coords[coords.length - 1]!;
  return [end[0], end[1]];
}

/** 새 구간 기점 = 직전 종점(있으면), 없으면 방금 찍은 주소 */
export function chainStartName(
  segments: BikeRoadSegment[],
  geocodedStart: string
): string {
  return previousSegmentEndName(segments) || geocodedStart.trim();
}

/** 구간 라인들을 이은 표시용 합본 (첫 유효 구간 기준) */
export function mergeRouteLineCoords(
  segments: BikeRoadSegment[]
): [number, number][] {
  const withGeom = segments.filter((s) => (s.lineCoords?.length ?? 0) >= 2);
  if (withGeom.length === 0) return [];
  // 양측이면 R만 합본에 쓰고, 없으면 전부 것
  const preferred =
    withGeom.find((s) => s.side === "R" || s.side === "C") ?? withGeom[0]!;
  return preferred.lineCoords!.map((c) => [...c] as [number, number]);
}

/** 오버레이용 — 모든 구간 라인 */
export function collectSegmentLines(
  segments: BikeRoadSegment[]
): { segmentId: string; side: BikeRoadSegmentSide; coords: [number, number][] }[] {
  const out: {
    segmentId: string;
    side: BikeRoadSegmentSide;
    coords: [number, number][];
  }[] = [];
  for (const s of segments) {
    if ((s.lineCoords?.length ?? 0) < 2) continue;
    out.push({
      segmentId: s.id,
      side: s.side ?? "C",
      coords: s.lineCoords!,
    });
  }
  return out;
}

export type BuiltSegmentDrawResult = {
  segments: BikeRoadSegment[];
  centerLonLat: [number, number][];
};

/**
 * 중심선(3857) + 측 모드 → 표에 넣을 구간 행들
 */
export function buildSegmentsFromCenterPath(opts: {
  center3857: Pt[];
  mode: "both" | "one";
  routePrefix: string;
  startIndex1: number;
  startName: string;
  endName: string;
  routeNameBase?: string;
}): BuiltSegmentDrawResult {
  const {
    center3857,
    mode,
    routePrefix,
    startIndex1,
    startName,
    endName,
    routeNameBase = "",
  } = opts;
  const centerLonLat = toLonLatCoords(center3857);
  const km = lineLengthKm3857(center3857);
  const kmStr = km > 0 ? String(km) : "";
  const base = routeNameBase.trim();

  if (mode === "one") {
    const seg = createEmptyBikeRoadSegment({
      routePrefix,
      index1: startIndex1,
      side: "C",
    });
    return {
      centerLonLat,
      segments: [
        {
          ...seg,
          startName,
          endName,
          totalLength: kmStr,
          roadLink: "○",
          routeName: base,
          lineCoords: centerLonLat,
          centerLineCoords: centerLonLat,
        },
      ],
    };
  }

  const { right, left } = dualOffsetLines3857(center3857);
  const rightLl = toLonLatCoords(right);
  const leftLl = toLonLatCoords(left);
  const r = createEmptyBikeRoadSegment({
    routePrefix,
    index1: startIndex1,
    side: "R",
  });
  const l = createEmptyBikeRoadSegment({
    routePrefix,
    index1: startIndex1 + 1,
    side: "L",
  });
  return {
    centerLonLat,
    segments: [
      {
        ...r,
        startName,
        endName,
        totalLength: kmStr,
        roadLink: "○",
        routeName: base ? `${base}R` : "R",
        lineCoords: rightLl,
        centerLineCoords: centerLonLat,
      },
      {
        ...l,
        startName,
        endName,
        totalLength: kmStr,
        roadLink: "○",
        routeName: base ? `${base}L` : "L",
        lineCoords: leftLl,
        centerLineCoords: centerLonLat,
      },
    ],
  };
}
