/**
 * 고도 측정 — public_layer.elevation 상·하 인접 등고 보간, 시군구(sgg) 범위 검사
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

const ELEVATION_SCHEMA = 'public_layer';
const ELEVATION_TABLE = 'elevation';
const SGG_SCHEMA = 'public_layer';
const SGG_TABLE = 'sgg';

/** 등고선 위에 있다고 볼 거리(m) — 이내면 보간 없이 cont 그대로 */
const ON_LINE_EPS_M = 0.5;
/** 점 주변에서만 등고 후보를 모을 반경(m) */
const SEARCH_RADIUS_M = 300;
/** 보간에 쓸 서로 다른 높이 후보 개수 */
const CANDIDATE_DISTINCT_ELEV = 12;

export type ElevationAtPointCode = 'NO_ELEVATION_DATA' | 'OUT_OF_SGG' | 'OK';

export type ElevationAtPointResult = {
  success: boolean;
  code: ElevationAtPointCode;
  message: string;
  elevation?: number;
  /** 최근접 등고선까지 거리(m) */
  distanceM?: number;
  /** nearest=한 선만, idw=상·하 등고 거리가중 보간 */
  method?: 'nearest' | 'idw';
};

type ElevCandidate = { elevation: number; distanceM: number };

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/** geometry_columns.srid 가 0·NULL 이면 프로젝트 기본(EPSG:5181) */
function normalizedSrid(catalogSrid: unknown): number {
  const n = Number(catalogSrid);
  if (catalogSrid == null || !Number.isFinite(n) || n <= 0) return 5181;
  return Math.floor(n);
}

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

/**
 * catalog SRID 로 스탬프 (SRID 0 컬럼 ↔ Transform 점 mixed-SRID 방지).
 * 좌표값은 그대로 두고 메타만 맞춤 — jijuk/emd 등과 동일 패턴.
 */
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

/**
 * 상·하 인접 등고선으로만 높이 보간 (역거리 가중).
 * - low·high 둘 다 있을 때만 보간 → 결과는 항상 [low, high] 안
 * - 한쪽만 있으면 최근접 cont만 사용 (외삽 금지)
 * - 선 위(0.5m 이내)면 해당 cont 그대로
 */
export function interpolateElevationFromCandidates(
  candidates: ElevCandidate[]
): { elevation: number; method: 'nearest' | 'idw'; distanceM: number } {
  if (!candidates.length) {
    return { elevation: NaN, method: 'nearest', distanceM: NaN };
  }
  const sorted = [...candidates]
    .filter((c) => Number.isFinite(c.elevation) && Number.isFinite(c.distanceM) && c.distanceM >= 0)
    .sort((a, b) => a.distanceM - b.distanceM);
  if (!sorted.length) {
    return { elevation: NaN, method: 'nearest', distanceM: NaN };
  }

  const a = sorted[0];
  if (a.distanceM <= ON_LINE_EPS_M) {
    return { elevation: a.elevation, method: 'nearest', distanceM: a.distanceM };
  }

  let low: ElevCandidate | null = null;
  let high: ElevCandidate | null = null;
  for (const c of sorted) {
    if (c.elevation < a.elevation - 0.05) {
      if (!low || c.distanceM < low.distanceM) low = c;
    } else if (c.elevation > a.elevation + 0.05) {
      if (!high || c.distanceM < high.distanceM) high = c;
    }
  }

  if (low && high) {
    const d0 = Math.max(low.distanceM, 1e-6);
    const d1 = Math.max(high.distanceM, 1e-6);
    const elevation = (low.elevation * d1 + high.elevation * d0) / (d0 + d1);
    return {
      elevation,
      method: 'idw',
      distanceM: a.distanceM,
    };
  }

  return { elevation: a.elevation, method: 'nearest', distanceM: a.distanceM };
}

/**
 * 지도 좌표(기본 EPSG:3857)에서 고도 조회 — 상·하 인접 등고 보간
 */
export async function getElevationAtPoint(params: {
  x?: number;
  y?: number;
  srid?: number;
}): Promise<ElevationAtPointResult> {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const inputSrid = Number(params?.srid) > 0 ? Number(params.srid) : 3857;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      success: false,
      code: 'NO_ELEVATION_DATA',
      message: '고도 관련 데이터가 없습니다',
    };
  }

  const elevExists = await tableExists(ELEVATION_SCHEMA, ELEVATION_TABLE);
  const elevMeta = elevExists
    ? await getGeomMeta(ELEVATION_SCHEMA, ELEVATION_TABLE)
    : null;
  if (!elevExists || !elevMeta) {
    return {
      success: false,
      code: 'NO_ELEVATION_DATA',
      message: '고도 관련 데이터가 없습니다',
    };
  }

  const elevGeomCol = `"${elevMeta.geomCol.replace(/"/g, '""')}"`;
  const elevGeom = geomStamped(elevGeomCol, elevMeta.srid);
  const elevFrom = `"${ELEVATION_SCHEMA.replace(/"/g, '""')}"."${ELEVATION_TABLE.replace(/"/g, '""')}"`;
  const pointSql = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${inputSrid}), ${elevMeta.srid})`;

  const outOfSgg = (): ElevationAtPointResult => ({
    success: false,
    code: 'OUT_OF_SGG',
    message: '지원 지역을 벗어남',
  });

  let insideSgg = true;
  let boundaryChecked = false;
  const sggExists = await tableExists(SGG_SCHEMA, SGG_TABLE);
  const sggMeta = sggExists ? await getGeomMeta(SGG_SCHEMA, SGG_TABLE) : null;
  if (sggMeta) {
    boundaryChecked = true;
    const sggGeomCol = `"${sggMeta.geomCol.replace(/"/g, '""')}"`;
    const sggGeom = geomStamped(sggGeomCol, sggMeta.srid);
    const sggFrom = `"${SGG_SCHEMA.replace(/"/g, '""')}"."${SGG_TABLE.replace(/"/g, '""')}"`;
    const sggPoint = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${inputSrid}), ${sggMeta.srid})`;
    try {
      const sggRes = await db.execute(
        sql.raw(
          `SELECT EXISTS (
             SELECT 1 FROM ${sggFrom}
             WHERE ${sggGeomCol} IS NOT NULL
               AND ST_Intersects(${sggGeom}, ${sggPoint})
           ) AS inside`
        )
      );
      insideSgg = asBool((sggRes.rows?.[0] as { inside?: unknown } | undefined)?.inside);
    } catch {
      return outOfSgg();
    }
  } else {
    const emdExists = await tableExists('public_layer', 'emd');
    const emdMeta = emdExists ? await getGeomMeta('public_layer', 'emd') : null;
    if (emdMeta) {
      boundaryChecked = true;
      const emdGeomCol = `"${emdMeta.geomCol.replace(/"/g, '""')}"`;
      const emdGeom = geomStamped(emdGeomCol, emdMeta.srid);
      const emdPoint = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${inputSrid}), ${emdMeta.srid})`;
      try {
        const emdRes = await db.execute(
          sql.raw(
            `SELECT EXISTS (
               SELECT 1 FROM "public_layer"."emd"
               WHERE ${emdGeomCol} IS NOT NULL
                 AND ST_Intersects(${emdGeom}, ${emdPoint})
             ) AS inside`
          )
        );
        insideSgg = asBool((emdRes.rows?.[0] as { inside?: unknown } | undefined)?.inside);
      } catch {
        return outOfSgg();
      }
    }
  }

  if (boundaryChecked && !insideSgg) {
    return outOfSgg();
  }

  try {
    // 검색 반경 내, 높이(cont)별 최근접 선 → 가까운 순 후보
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

    if (!candidates.length) {
      return {
        success: false,
        code: 'NO_ELEVATION_DATA',
        message: '고도 관련 데이터가 없습니다',
      };
    }

    const { elevation, method, distanceM } = interpolateElevationFromCandidates(candidates);
    if (!Number.isFinite(elevation)) {
      return {
        success: false,
        code: 'NO_ELEVATION_DATA',
        message: '고도 관련 데이터가 없습니다',
      };
    }

    return {
      success: true,
      code: 'OK',
      message: `고도 : ${formatElevationM(elevation)}`,
      elevation,
      distanceM: Number.isFinite(distanceM) ? distanceM : undefined,
      method,
    };
  } catch {
    return {
      success: false,
      code: 'NO_ELEVATION_DATA',
      message: '고도 관련 데이터가 없습니다',
    };
  }
}

function formatElevationM(value: number): string {
  // 보간값은 소수 1자리까지 (5m 등고 간격보다 세밀하게)
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded} m`;
  return `${rounded.toFixed(1)} m`;
}
