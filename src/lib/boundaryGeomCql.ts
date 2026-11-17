/** GeoServer ECQL — 경계 WKT(5181) ∩ geom. 필터 없으면 null. */
export function cqlIntersectsBoundaryWkt(wkt: string | null | undefined): string | null {
  const raw = String(wkt ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^SRID=\d+\s*;\s*/i, '').trim();
  if (!cleaned) return null;
  return `INTERSECTS(geom, ${cleaned})`;
}
