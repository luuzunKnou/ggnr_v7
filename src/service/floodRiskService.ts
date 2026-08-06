/**
 * 침수 피해 예상 필지 — 관측소 2km 버퍼 jijuk × 중심 해발 vs 수위해발
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { interpolateElevationFromCandidates } from '@/service/elevationService';

const JIJUK_SCHEMA = 'public_layer';
const JIJUK_GEOM_SRID = 5181;
const ELEVATION_SCHEMA = 'public_layer';
const ELEVATION_TABLE = 'elevation';
const SEARCH_RADIUS_M = 300;
const CANDIDATE_DISTINCT_ELEV = 12;
const DEFAULT_BUFFER_M = 2000;
const MAX_CANDIDATES = 800;

type ElevCandidate = { elevation: number; distanceM: number };

export type FloodRiskThresholds = {
  attwl?: number | null;
  wrnwl?: number | null;
  almwl?: number | null;
  srswl?: number | null;
  pfh?: number | null;
};

export type FloodRiskParcel = {
  id: string;
  name: string;
  riskLevel: string;
  note: string;
  lon: number;
  lat: number;
  proximity: number;
  ring: [number, number][];
  elevM: number;
  distM: number;
  depthM: number;
};

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizedSrid(catalogSrid: unknown): number {
  const n = Number(catalogSrid);
  if (catalogSrid == null || !Number.isFinite(n) || n <= 0) return 5181;
  return Math.floor(n);
}

function geomStamped(geomIdent: string, catalogSrid: number): string {
  return `ST_SetSRID(${geomIdent}, ${catalogSrid})`;
}

async function getGeomMeta(
  schema: string,
  table: string
): Promise<{ geomCol: string; srid: number } | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid
         FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!row?.name) return null;
    return {
      geomCol: String(row.name).trim(),
      srid: normalizedSrid(row.srid),
    };
  } catch {
    return null;
  }
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  try {
    const res = await db.execute(
      sql.raw(`SELECT to_regclass('${esc(schema)}.${esc(table)}') IS NOT NULL AS ok`)
    );
    const row = res.rows?.[0] as { ok?: boolean } | undefined;
    return row?.ok === true;
  } catch {
    return false;
  }
}

/** 계획홍수 > 심각 > 경보 > 주의보 > 관심 — 통과하는 최고 단계 */
export function resolveFloodRiskLevel(
  parcelElevM: number,
  gdt: number,
  thresholds: FloodRiskThresholds | null | undefined
): string {
  const stages: { label: string; wl: number | null | undefined }[] = [
    { label: '계획홍수', wl: thresholds?.pfh },
    { label: '심각', wl: thresholds?.srswl },
    { label: '경보', wl: thresholds?.almwl },
    { label: '주의보', wl: thresholds?.wrnwl },
    { label: '관심', wl: thresholds?.attwl },
  ];
  for (const s of stages) {
    const wl = Number(s.wl);
    if (!Number.isFinite(wl)) continue;
    if (parcelElevM < gdt + wl) return s.label;
  }
  return '침수';
}

function proximityFromRiskLevel(level: string): number {
  switch (level) {
    case '계획홍수':
      return 1;
    case '심각':
      return 0.85;
    case '경보':
      return 0.7;
    case '주의보':
      return 0.55;
    case '관심':
      return 0.4;
    default:
      return 0.28;
  }
}

function parseRingFromGeoJson(raw: unknown): [number, number][] | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const g = obj as { type?: string; coordinates?: unknown };
  if (!g?.type || !g.coordinates) return null;
  let ring: unknown;
  if (g.type === 'Polygon') {
    ring = (g.coordinates as unknown[])[0];
  } else if (g.type === 'MultiPolygon') {
    ring = ((g.coordinates as unknown[])[0] as unknown[])?.[0];
  } else {
    return null;
  }
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out: [number, number][] = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([lon, lat]);
  }
  return out.length >= 3 ? out : null;
}

type ParcelCandidate = {
  pnu: string;
  jibun: string;
  distM: number;
  cx: number;
  cy: number;
  lon: number;
  lat: number;
  ring: [number, number][];
};

async function listCandidatesInBuffer(params: {
  lon: number;
  lat: number;
  radiusM: number;
}): Promise<ParcelCandidate[]> {
  const { lon, lat, radiusM } = params;
  const station5181 = `ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${JIJUK_GEOM_SRID})`;
  const bufferGeom = `ST_Buffer(${station5181}, ${radiusM})`;
  const jijukGeom = `ST_SetSRID(j.geom, ${JIJUK_GEOM_SRID})`;
  const intersectGeom = `ST_Intersection(${jijukGeom}, ${bufferGeom})`;
  const hitWhere = `j.geom IS NOT NULL
      AND ${jijukGeom} && ${bufferGeom}
      AND ST_Intersects(${jijukGeom}, ${bufferGeom})
      AND ST_Dimension(${intersectGeom}) = 2
      AND ST_Area(${intersectGeom}) > 1.0`;

  const queryStr = `
    SELECT
      j.pnu::text AS pnu,
      COALESCE(NULLIF(TRIM(j.jibun::text), ''), j.pnu::text) AS jibun,
      ST_Distance(${jijukGeom}, ${station5181}) AS dist_m,
      ST_X(ST_Centroid(${jijukGeom})) AS cx,
      ST_Y(ST_Centroid(${jijukGeom})) AS cy,
      ST_X(ST_Transform(ST_Centroid(${jijukGeom}), 4326)) AS lon,
      ST_Y(ST_Transform(ST_Centroid(${jijukGeom}), 4326)) AS lat,
      ST_AsGeoJSON(ST_Transform(${jijukGeom}, 4326)) AS geojson
    FROM ${JIJUK_SCHEMA}.jijuk j
    WHERE ${hitWhere}
    ORDER BY dist_m ASC
    LIMIT ${MAX_CANDIDATES}
  `;

  const res = await db.execute(sql.raw(queryStr));
  const out: ParcelCandidate[] = [];
  for (const raw of res.rows ?? []) {
    const row = raw as {
      pnu?: string;
      jibun?: string;
      dist_m?: number | string;
      cx?: number | string;
      cy?: number | string;
      lon?: number | string;
      lat?: number | string;
      geojson?: unknown;
    };
    const pnu = String(row.pnu ?? '').trim();
    if (!pnu) continue;
    const ring = parseRingFromGeoJson(row.geojson);
    if (!ring) continue;
    const distM = Number(row.dist_m);
    const cx = Number(row.cx);
    const cy = Number(row.cy);
    const clon = Number(row.lon);
    const clat = Number(row.lat);
    if (![distM, cx, cy, clon, clat].every(Number.isFinite)) continue;
    out.push({
      pnu,
      jibun: String(row.jibun ?? pnu).trim() || pnu,
      distM,
      cx,
      cy,
      lon: clon,
      lat: clat,
      ring,
    });
  }
  return out;
}

async function elevationAt5181(
  x: number,
  y: number,
  elevMeta: { geomCol: string; srid: number }
): Promise<number | null> {
  const elevGeomCol = `"${elevMeta.geomCol.replace(/"/g, '""')}"`;
  const elevGeom = geomStamped(elevGeomCol, elevMeta.srid);
  const elevFrom = `"${ELEVATION_SCHEMA.replace(/"/g, '""')}"."${ELEVATION_TABLE.replace(/"/g, '""')}"`;
  const pointSql = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${JIJUK_GEOM_SRID}), ${elevMeta.srid})`;

  try {
    const res = await db.execute(
      sql.raw(
        `WITH by_elev AS (
           SELECT DISTINCT ON ((cont::double precision))
             cont::double precision AS elevation,
             ST_Distance(${elevGeom}, ${pointSql}) AS distance_m
           FROM ${elevFrom}
           WHERE ${elevGeomCol} IS NOT NULL AND cont IS NOT NULL
             AND ST_DWithin(${elevGeom}, ${pointSql}, ${SEARCH_RADIUS_M})
           ORDER BY (cont::double precision), ${elevGeom} <-> ${pointSql}
         )
         SELECT elevation, distance_m
         FROM by_elev
         ORDER BY distance_m ASC
         LIMIT ${CANDIDATE_DISTINCT_ELEV}`
      )
    );
    const candidates: ElevCandidate[] = [];
    for (const raw of res.rows ?? []) {
      const row = raw as { elevation?: number | string; distance_m?: number | string };
      const elevation = Number(row.elevation);
      const distanceM = Number(row.distance_m);
      if (!Number.isFinite(elevation) || !Number.isFinite(distanceM)) continue;
      candidates.push({ elevation, distanceM });
    }
    if (!candidates.length) return null;
    const { elevation } = interpolateElevationFromCandidates(candidates);
    return Number.isFinite(elevation) ? elevation : null;
  } catch {
    return null;
  }
}

/**
 * 수위해발보다 낮은 필지만 거리순으로 포함. 첫 «수위해발 이상»에서 중단.
 */
export async function listFloodRiskParcels(params: {
  lon?: number;
  lat?: number;
  /** 수위해발 = gdt + 유효수위 (이미 합산된 값) */
  seaLevelM?: number;
  gdt?: number;
  thresholds?: FloodRiskThresholds | null;
  radiusM?: number;
}): Promise<{ success: boolean; message?: string; items: FloodRiskParcel[] }> {
  const lon = Number(params?.lon);
  const lat = Number(params?.lat);
  const seaLevelM = Number(params?.seaLevelM);
  const gdt = Number(params?.gdt);
  const radiusM =
    Number(params?.radiusM) > 0 && Number.isFinite(Number(params?.radiusM))
      ? Number(params.radiusM)
      : DEFAULT_BUFFER_M;
  const thresholds = params?.thresholds ?? null;

  if (![lon, lat, seaLevelM, gdt].every(Number.isFinite)) {
    return { success: false, message: '관측소 좌표·영점표고·수위가 필요합니다', items: [] };
  }

  const elevExists = await tableExists(ELEVATION_SCHEMA, ELEVATION_TABLE);
  const elevMeta = elevExists ? await getGeomMeta(ELEVATION_SCHEMA, ELEVATION_TABLE) : null;
  if (!elevExists || !elevMeta) {
    return { success: false, message: '고도 관련 데이터가 없습니다', items: [] };
  }

  let candidates: ParcelCandidate[];
  try {
    candidates = await listCandidatesInBuffer({ lon, lat, radiusM });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, message: msg || '필지 조회 실패', items: [] };
  }

  const items: FloodRiskParcel[] = [];
  for (const c of candidates) {
    const elevM = await elevationAt5181(c.cx, c.cy, elevMeta);
    if (elevM == null) continue;
    if (elevM >= seaLevelM) {
      break;
    }
    const depthM = seaLevelM - elevM;
    const riskLevel = resolveFloodRiskLevel(elevM, gdt, thresholds);
    const proximity = proximityFromRiskLevel(riskLevel);
    items.push({
      id: c.pnu,
      name: c.jibun,
      riskLevel,
      note: `침수심 ${depthM.toFixed(1)}m · ${Math.round(c.distM)}m`,
      lon: c.lon,
      lat: c.lat,
      proximity,
      ring: c.ring,
      elevM,
      distM: c.distM,
      depthM,
    });
  }

  return { success: true, items };
}
