/**
 * 도형 동일 여부 — SHP 정합성과 같은 SnapToGrid(1mm) + WKB md5
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

/** CRS 재투영 미세 오차 허용 격자(m) — shpUploadService GEOM_COMPARE_GRID_M 과 동일 */
export const GEOM_COMPARE_GRID_M = 0.001;

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function isGeomMetaOnly(g: unknown): boolean {
  if (g == null || typeof g !== 'object' || Array.isArray(g)) return false;
  const o = g as Record<string, unknown>;
  if ('coordinates' in o || 'geometries' in o) return false;
  return typeof o.hash === 'string' || o._meta === true;
}

function metaHash(g: unknown): string | null {
  if (!isGeomMetaOnly(g)) return null;
  const h = String((g as Record<string, unknown>).hash ?? '').trim();
  return h || null;
}

function toGeoJsonText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s || null;
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }
  return null;
}

function geomExprFromTextSql(escapedJsonOrWkt: string): string {
  // GeoJSON object vs WKT
  return `(CASE
    WHEN left(btrim('${escapedJsonOrWkt}'), 1) = '{' THEN ST_GeomFromGeoJSON('${escapedJsonOrWkt}')::geometry
    ELSE ST_SetSRID(ST_GeomFromText('${escapedJsonOrWkt}'), 5181)
  END)`;
}

/**
 * 이력·정합성용 도형 동일 판정.
 * - 둘 다 없으면 동일
 * - sync 메타 hash가 있으면 hash 비교
 * - 그 외 GeoJSON/WKT → PostGIS SnapToGrid(1mm) 후 WKB md5
 */
export async function areGeomsEquivalentForHistory(
  a: unknown,
  b: unknown,
): Promise<boolean> {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  const ha = metaHash(a);
  const hb = metaHash(b);
  if (ha != null && hb != null) return ha === hb;

  const aText = toGeoJsonText(isGeomMetaOnly(a) ? null : a);
  const bText = toGeoJsonText(isGeomMetaOnly(b) ? null : b);

  // 한쪽만 메타(hash)이고 한쪽만 좌표 — hash끼리 못 맞추면 DB로 좌표 쪽만 해시 계산 후 비교
  if (ha != null && bText) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT md5(encode(ST_AsBinary(ST_SnapToGrid(${geomExprFromTextSql(esc(bText))}, ${GEOM_COMPARE_GRID_M})), 'hex')) AS h`
        )
      );
      const h = String((res.rows?.[0] as { h?: string } | undefined)?.h ?? '');
      return h !== '' && h === ha;
    } catch {
      return false;
    }
  }
  if (hb != null && aText) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT md5(encode(ST_AsBinary(ST_SnapToGrid(${geomExprFromTextSql(esc(aText))}, ${GEOM_COMPARE_GRID_M})), 'hex')) AS h`
        )
      );
      const h = String((res.rows?.[0] as { h?: string } | undefined)?.h ?? '');
      return h !== '' && h === hb;
    } catch {
      return false;
    }
  }

  if (!aText || !bText) return false;
  if (aText === bText) return true;

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT (
           md5(encode(ST_AsBinary(ST_SnapToGrid(${geomExprFromTextSql(esc(aText))}, ${GEOM_COMPARE_GRID_M})), 'hex'))
           =
           md5(encode(ST_AsBinary(ST_SnapToGrid(${geomExprFromTextSql(esc(bText))}, ${GEOM_COMPARE_GRID_M})), 'hex'))
         ) AS same`
      )
    );
    return Boolean((res.rows?.[0] as { same?: boolean } | undefined)?.same);
  } catch {
    return false;
  }
}
