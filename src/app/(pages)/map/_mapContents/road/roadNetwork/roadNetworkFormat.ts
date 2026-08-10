import type { RoadNetworkGeom } from "./roadNetworkMock";

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

/** 목록 제목: 이름 + (도로번호). 번호가 없거나 `-`면 괄호 생략 */
export function formatRoadNetworkListTitle(roadName: string, roadNo: string): string {
  const name = cleanRoadNetworkDisplayText(roadName) || "(이름 없음)";
  const no = cleanRoadNetworkDisplayText(roadNo);
  return no ? `${name} (${no})` : name;
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
