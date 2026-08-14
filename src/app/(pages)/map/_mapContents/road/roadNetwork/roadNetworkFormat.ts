import {
  formatRoadNetworkLengthKm,
  type RoadNetworkGeom,
  type RoadNetworkType,
} from "./roadNetworkMock";

/** 도로망도 목록·표시용 문자열 정리 (플레이스홀더 -, \ 등 숨김) */

const PLACEHOLDER_RE = /^[-–—\\/.]+$/;

function isPlaceholderToken(raw: string): boolean {
  const t = raw.trim();
  return !t || PLACEHOLDER_RE.test(t);
}

/** 쉼표·슬래시로 이어진 구간에서 `-`·`\` 등 무의미 토큰 제거 */
export function cleanRoadNetworkDisplayText(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || isPlaceholderToken(s)) return "";
  const parts = s
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter((p) => !isPlaceholderToken(p));
  return parts.join(", ");
}

export type RoadNetworkListTitleInput = {
  roadName: string;
  roadType: RoadNetworkType;
  roadNo: string;
  /** SHP 원본 길이 속성 — 있으면 단위 임의 부여 없이 그대로 표시 */
  lengthAttr?: string | null;
  /** 도형 계산 연장(m) — 표시 시 km */
  lengthM?: number | null;
};

/**
 * 목록·패널 헤더용 표시명.
 * 원본 도로명이 있으면 그대로, 없으면 번호·길이 등으로만 대체 (속성값에는 쓰지 않음).
 */
export function formatRoadNetworkListTitle(row: RoadNetworkListTitleInput): string {
  const name = cleanRoadNetworkDisplayText(row.roadName);
  if (name) return name;

  const no = cleanRoadNetworkDisplayText(row.roadNo);
  if (no) return `${row.roadType} ${no}`;

  const attrLen = cleanRoadNetworkDisplayText(row.lengthAttr);
  if (attrLen) return `${row.roadType} · ${attrLen}`;

  const km = formatRoadNetworkLengthKm(Number(row.lengthM));
  if (km !== "—") return `${row.roadType} · ${km}`;

  return row.roadType;
}

/**
 * 굴곡도 등 숫자 속성 — 끝자리 불필요 0 제거, 값 0은 빈 문자열
 * 예: "1.5000" → "1.5", "2.000" → "2", "0" / "0.0" → ""
 */
export function formatRoadNetworkNumericAttr(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || isPlaceholderToken(s)) return "";
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return "";
  // toString이 지수표기하는 극단값만 원문 유지
  const normalized = String(n);
  if (/e/i.test(normalized)) {
    return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  }
  return normalized;
}

/** MultiLineString → 편집용 LineString 좌표 (구간 연결) */
export function roadNetworkGeomToLineCoords(
  geom: RoadNetworkGeom | null | undefined
): [number, number][] | null {
  if (!geom) return null;
  if (geom.type === "LineString") {
    return geom.coordinates.length >= 2 ? geom.coordinates : null;
  }
  if (geom.type === "MultiLineString") {
    const flat = geom.coordinates.flat() as [number, number][];
    return flat.length >= 2 ? flat : null;
  }
  return null;
}

export function lineCoordsToRoadNetworkGeom(
  coords: [number, number][]
): RoadNetworkGeom | null {
  if (coords.length < 2) return null;
  return { type: "LineString", coordinates: coords };
}
