import type { Coordinate } from 'ol/coordinate';
import MultiPolygon from 'ol/geom/MultiPolygon';
import Polygon from 'ol/geom/Polygon';
import type Geometry from 'ol/geom/Geometry';

/** [ax, ay, bx, by] */
type Seg = [number, number, number, number];

export type Chord = [Coordinate, Coordinate];

/** 절단선 탐색 반경 (지도 좌표 단위) — 하천 폭보다 충분히 크게 */
const SEARCH_HALF = 3000;

export function toAreaGeometry(geom: Geometry | null | undefined): Polygon | MultiPolygon | null {
  if (geom instanceof Polygon || geom instanceof MultiPolygon) return geom;
  return null;
}

export function collectSegments(geom: Polygon | MultiPolygon): Seg[] {
  const polys = geom instanceof Polygon ? [geom.getCoordinates()] : geom.getCoordinates();
  const out: Seg[] = [];
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        out.push([ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]]);
      }
    }
  }
  return out;
}

function chordAtAngle(segs: Seg[], px: number, py: number, rad: number): [number, number] | null {
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  let tNeg = -Infinity;
  let tPos = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = ax - px;
    const wy = ay - py;
    const s = (wx * dy - wy * dx) / den;
    if (s < 0 || s > 1) continue;
    const t = (wx * ey - wy * ex) / den;
    if (t < 0 && t > tNeg) tNeg = t;
    else if (t >= 0 && t < tPos) tPos = t;
  }
  if (!Number.isFinite(tNeg) || !Number.isFinite(tPos)) return null;
  return [tNeg, tPos];
}

/**
 * 면 안의 한 점에서 양쪽 경계까지 가장 짧게 가로지르는 선 (하천 폭 방향).
 * 점이 면 밖이면 null.
 */
export function shortestChordAt(geom: Polygon | MultiPolygon, segsAll: Seg[], p: Coordinate): Chord | null {
  if (!geom.intersectsCoordinate(p)) return null;
  const [px, py] = p;
  const segs = segsAll.filter(
    ([ax, ay, bx, by]) =>
      Math.max(ax, bx) >= px - SEARCH_HALF &&
      Math.min(ax, bx) <= px + SEARCH_HALF &&
      Math.max(ay, by) >= py - SEARCH_HALF &&
      Math.min(ay, by) <= py + SEARCH_HALF
  );
  if (segs.length === 0) return null;

  type Best = { rad: number; t: [number, number]; len: number };
  const scan = (from: number, to: number, step: number, prev: Best | null): Best | null => {
    let best = prev;
    for (let deg = from; deg < to; deg += step) {
      const rad = (deg * Math.PI) / 180;
      const t = chordAtAngle(segs, px, py, rad);
      if (!t) continue;
      const len = t[1] - t[0];
      if (!best || len < best.len) best = { rad, t, len };
    }
    return best;
  };
  const coarse = scan(0, 180, 3, null);
  if (!coarse) return null;
  const coarseDeg = (coarse.rad * 180) / Math.PI;
  const fine = scan(coarseDeg - 3, coarseDeg + 3.01, 0.5, coarse) ?? coarse;

  const { rad, t } = fine;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  return [
    [px + t[0] * dx, py + t[0] * dy],
    [px + t[1] * dx, py + t[1] * dy],
  ];
}

/**
 * 커서가 면 밖이면 maxDist 안의 가장 가까운 경계 지점 바로 안쪽으로 붙임.
 * 하천을 따라 끝 위치를 끌 때 제방 밖으로 살짝 벗어나도 끊기지 않게 한다.
 */
export function snapInside(geom: Polygon | MultiPolygon, p: Coordinate, maxDist: number): Coordinate | null {
  if (geom.intersectsCoordinate(p)) return p;
  const q = geom.getClosestPoint(p);
  if (Math.hypot(q[0] - p[0], q[1] - p[1]) > maxDist) return null;
  for (const r of [0.5, 1.5, 3]) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4;
      const c: Coordinate = [q[0] + r * Math.cos(a), q[1] + r * Math.sin(a)];
      if (geom.intersectsCoordinate(c)) return c;
    }
  }
  return null;
}
