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
import { collectDisplayLines } from "./bikeRoadOverlapDisplay";
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

/** 표·스냅에 남은 «기점»«종점» 자리표시 — 주소로 취급하지 않음 */
export function isBikeRoadPlaceholderName(
  name: string | null | undefined
): boolean {
  const t = String(name ?? "").trim();
  return !t || t === "기점" || t === "종점";
}

/**
 * 화면용 짧은 주소 — «경상북도 경산시» 등 시·도·시군구 앞자리 제거.
 * 예: 경상북도 경산시 옥곡동 842 → 옥곡동 842
 */
export function bikeRoadShortAddress(raw: string): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  t = t.replace(/^(서울|부산|대구|인천|광주|대전|울산)광역시\s+/u, "");
  t = t.replace(/^서울특별시\s+/u, "");
  t = t.replace(/^세종특별자치시\s+/u, "");
  t = t.replace(/^.+?특별자치도\s+/u, "");
  t = t.replace(/^.+?도\s+/u, "");
  t = t.replace(/^[가-힣0-9]+(시|군|구)\s+/u, "");
  return t.trim();
}

/** 역지오코딩 결과 → 점(지번) 주소 우선, 없으면 도로명 (시·도 생략) */
export function bikeRoadPointAddressLabel(addr: {
  jibun?: string;
  road?: string;
} | null | undefined): string {
  return bikeRoadShortAddress((addr?.jibun || addr?.road || "").trim());
}

/** 노선 시점·종점·진행방향 — 첫 구간 기점 / 마지막 구간 종점 */
export function routeEndsFromSegments(segments: BikeRoadSegment[]): {
  startPoint: string;
  endPoint: string;
  /** «시점 → 종점» (둘 다 있을 때) */
  direction: string;
} {
  if (segments.length === 0) {
    return { startPoint: "", endPoint: "", direction: "" };
  }
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const startRaw = first.startName.trim();
  const endRaw = last.endName.trim();
  const startPoint = isBikeRoadPlaceholderName(startRaw) ? "" : startRaw;
  const endPoint = isBikeRoadPlaceholderName(endRaw) ? "" : endRaw;
  let direction = "";
  if (startPoint && endPoint) {
    direction =
      startPoint === endPoint ? startPoint : `${startPoint} → ${endPoint}`;
  } else if (startPoint) {
    direction = startPoint;
  } else if (endPoint) {
    direction = endPoint;
  }
  return { startPoint, endPoint, direction };
}

/** 지도 기점·종점 마커용 — 첫 구간 시작 / 마지막 구간 끝 좌표 */
export function routeEndpointCoords(segments: BikeRoadSegment[]): {
  start: [number, number] | null;
  end: [number, number] | null;
} {
  const withGeom = segments.filter(
    (s) =>
      (s.centerLineCoords?.length ?? 0) >= 2 || (s.lineCoords?.length ?? 0) >= 2
  );
  if (withGeom.length === 0) return { start: null, end: null };
  const first = withGeom[0]!;
  const last = withGeom[withGeom.length - 1]!;
  const a = first.centerLineCoords ?? first.lineCoords!;
  const b = last.centerLineCoords ?? last.lineCoords!;
  const s0 = a[0]!;
  const e0 = b[b.length - 1]!;
  return {
    start: [s0[0], s0[1]],
    end: [e0[0], e0[1]],
  };
}

/** 지도·위치도 기점/종점 라벨 1건 */
export type BikeRoadEndpointMarker = {
  kind: "start" | "end";
  lonLat: [number, number];
  /** 표시용 짧은 주소 (기점:/종점: 접두 없음) */
  name: string;
  pathType: string;
};

/** 양측·같은 끝점은 이 거리(m) 안이면 라벨 1개로 합침 */
const ENDPOINT_MERGE_M = 18;

function distMApprox(a: [number, number], b: [number, number]): number {
  // lon/lat → 대략 m (중위도)
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110540;
  return Math.hypot(dx, dy);
}

/**
 * 구간마다 기점·종점을 모은 뒤, 같은 위치(양측·공통 기점)는 하나로 합친다.
 * 기점은 같고 종점만 다르면 종점 라벨이 여러 개 나온다.
 * 다음 구간 기점이 직전 종점과 겹치면(이어 붙인 지점) 라벨은 숨긴다.
 */
export function collectRouteEndpointMarkers(
  segments: BikeRoadSegment[]
): BikeRoadEndpointMarker[] {
  type Cand = BikeRoadEndpointMarker;
  const starts: Cand[] = [];
  const ends: Cand[] = [];

  for (const s of segments) {
    const coords = s.centerLineCoords ?? s.lineCoords;
    if (!coords || coords.length < 2) continue;
    const a = coords[0]!;
    const b = coords[coords.length - 1]!;
    const startName = bikeRoadShortAddress(s.startName);
    const endName = bikeRoadShortAddress(s.endName);
    starts.push({
      kind: "start",
      lonLat: [a[0], a[1]],
      name: isBikeRoadPlaceholderName(startName) ? "" : startName,
      pathType: s.pathType ?? "",
    });
    ends.push({
      kind: "end",
      lonLat: [b[0], b[1]],
      name: isBikeRoadPlaceholderName(endName) ? "" : endName,
      pathType: s.pathType ?? "",
    });
  }

  function merge(list: Cand[]): Cand[] {
    const out: Cand[] = [];
    for (const c of list) {
      const hit = out.find(
        (o) =>
          distMApprox(o.lonLat, c.lonLat) <= ENDPOINT_MERGE_M ||
          (o.name && c.name && o.name === c.name && distMApprox(o.lonLat, c.lonLat) <= 80)
      );
      if (!hit) {
        out.push(c);
        continue;
      }
      // 이름 비어 있으면 채움
      if (!hit.name && c.name) hit.name = c.name;
    }
    return out;
  }

  const mergedStarts = merge(starts);
  const mergedEnds = merge(ends);

  // 이음점(직전 종점 ≈ 다음 기점) — 기점·종점 라벨 모두 생략
  const startsOut = mergedStarts.filter(
    (s) =>
      !mergedEnds.some(
        (e) => distMApprox(s.lonLat, e.lonLat) <= ENDPOINT_MERGE_M
      )
  );
  const endsOut = mergedEnds.filter(
    (e) =>
      !mergedStarts.some(
        (s) => distMApprox(s.lonLat, e.lonLat) <= ENDPOINT_MERGE_M
      )
  );

  return [...startsOut, ...endsOut];
}

/**
 * 엑셀처럼 구간이 이어질 때 — 직전 구간의 종점명.
 * 양측(R/L)은 같은 종점이므로 마지막 행 기준.
 */
export function previousSegmentEndName(segments: BikeRoadSegment[]): string {
  if (segments.length === 0) return "";
  const name = segments[segments.length - 1]!.endName.trim();
  return isBikeRoadPlaceholderName(name) ? "" : name;
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

/** 구간 라인들을 이은 표시용 합본 — 편측·우측을 순서대로 */
export function mergeRouteLineCoords(
  segments: BikeRoadSegment[]
): [number, number][] {
  const withGeom = segments.filter((s) => (s.lineCoords?.length ?? 0) >= 2);
  if (withGeom.length === 0) return [];
  const preferred = withGeom.filter((s) => {
    const side = s.side ?? "C";
    return side === "R" || side === "C";
  });
  const use = preferred.length > 0 ? preferred : withGeom;
  const out: [number, number][] = [];
  for (const s of use) {
    for (const c of s.lineCoords!) {
      const pt: [number, number] = [c[0], c[1]];
      const last = out[out.length - 1];
      if (last && last[0] === pt[0] && last[1] === pt[1]) continue;
      out.push(pt);
    }
  }
  return out;
}

/**
 * 오버레이용 — R/L miter 오프셋, 편측 겹침 시 긴 쪽은 꺾임 측·짧은 쪽은 반대.
 */
export function collectSegmentLines(
  segments: BikeRoadSegment[]
): { segmentId: string; side: BikeRoadSegmentSide; coords: [number, number][] }[] {
  return collectDisplayLines(segments);
}

export type BuiltSegmentDrawResult = {
  segments: BikeRoadSegment[];
  centerLonLat: [number, number][];
};

/**
 * 그린 경로(3857) + 측 → 표 행 1개.
 * 편측은 중심 그대로, 우·좌는 평행 오프셋.
 */
export function buildSegmentFromDrawnPath(opts: {
  path3857: Pt[];
  side: BikeRoadSegmentSide;
  routePrefix: string;
  index1: number;
  startName: string;
  endName: string;
  routeNameBase?: string;
}): BikeRoadSegment {
  const {
    path3857,
    side,
    routePrefix,
    index1,
    startName,
    endName,
    routeNameBase = "",
  } = opts;
  const centerLonLat = toLonLatCoords(path3857);
  const km = lineLengthKm3857(path3857);
  const kmStr = km > 0 ? String(km) : "";
  const base = routeNameBase.trim();
  const seg = createEmptyBikeRoadSegment({
    routePrefix,
    index1,
    side,
  });

  let lineCoords = centerLonLat;
  if (side === "R" || side === "L") {
    const { right, left } = dualOffsetLines3857(path3857);
    lineCoords = toLonLatCoords(side === "R" ? right : left);
  }

  const routeName =
    side === "C"
      ? base
      : base
        ? `${base}${side}`
        : side;

  return {
    ...seg,
    startName,
    endName,
    totalLength: kmStr,
    roadLink: "○",
    routeName,
    lineCoords,
    centerLineCoords: centerLonLat,
  };
}

/**
 * @deprecated 양측 한 번 생성 — 측별 자유 긋기 이전 호환
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
  if (mode === "one") {
    const seg = buildSegmentFromDrawnPath({
      path3857: center3857,
      side: "C",
      routePrefix,
      index1: startIndex1,
      startName,
      endName,
      routeNameBase,
    });
    return {
      centerLonLat: seg.centerLineCoords ?? [],
      segments: [seg],
    };
  }
  const r = buildSegmentFromDrawnPath({
    path3857: center3857,
    side: "R",
    routePrefix,
    index1: startIndex1,
    startName,
    endName,
    routeNameBase,
  });
  const l = buildSegmentFromDrawnPath({
    path3857: center3857,
    side: "L",
    routePrefix,
    index1: startIndex1 + 1,
    startName,
    endName,
    routeNameBase,
  });
  return {
    centerLonLat: r.centerLineCoords ?? [],
    segments: [r, l],
  };
}
