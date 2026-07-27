/**
 * 고도 측정 — layer.elevation 등고선 거리가중 보간, 시군구(sgg) 범위 검사
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

const ELEVATION_SCHEMA = 'layer';
const ELEVATION_TABLE = 'elevation';
const SGG_SCHEMA = 'public_layer';
const SGG_TABLE = 'sgg';

/** 등고선 위에 있다고 볼 거리(m) — 이내면 보간 없이 cont 그대로 */
const ON_LINE_EPS_M = 0.5;
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
  /** nearest=한 선만, idw=두 선 거리가중 보간 */
  method?: 'nearest' | 'idw';
};

type ElevCandidate = { elevation: number; distanceM: number };

function esc(value: string): string {
  return value.replace(/'/g, "''");
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
    const srid = Number(row.srid);
    return {
      geomCol: String(row.name).trim(),
      srid: Number.isFinite(srid) && srid > 0 ? srid : 5181,
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
 * 두 등고선까지의 거리로 높이 보간 (역거리 가중).
 * - 점↔선 거리(가까운 정도)
 * - 두 선의 높이 차(등고 간격)를 반영해 중간 고도 추정
 * - 높이 차가 작은 이웃 등고선을 우선 (인접 주/간곡선)
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

  const others = sorted.filter((c) => Math.abs(c.elevation - a.elevation) > 0.05);
  if (!others.length) {
    return { elevation: a.elevation, method: 'nearest', distanceM: a.distanceM };
  }

  // 인접 등고 간격 우선: |Δh|가 작고, 거리가 과도하지 않은 후보
  const pool = others.slice(0, 6);
  pool.sort((x, y) => {
    const dhX = Math.abs(x.elevation - a.elevation);
    const dhY = Math.abs(y.elevation - a.elevation);
    if (dhX !== dhY) return dhX - dhY;
    return x.distanceM - y.distanceM;
  });
  const b = pool[0];

  const d0 = Math.max(a.distanceM, 1e-6);
  const d1 = Math.max(b.distanceM, 1e-6);
  // 역거리 가중: 가까운 선의 높이에 더 큰 비중
  const elevation = (a.elevation * d1 + b.elevation * d0) / (d0 + d1);
  return {
    elevation,
    method: 'idw',
    distanceM: a.distanceM,
  };
}

/**
 * 지도 좌표(기본 EPSG:3857)에서 고도 조회 — 등고선 간 거리가중 보간
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

  const pointSql = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${inputSrid}), ${elevMeta.srid})`;
  const elevGeom = `"${elevMeta.geomCol.replace(/"/g, '""')}"`;
  const elevFrom = `"${ELEVATION_SCHEMA.replace(/"/g, '""')}"."${ELEVATION_TABLE.replace(/"/g, '""')}"`;

  let insideSgg = true;
  const sggExists = await tableExists(SGG_SCHEMA, SGG_TABLE);
  const sggMeta = sggExists ? await getGeomMeta(SGG_SCHEMA, SGG_TABLE) : null;
  if (sggMeta) {
    const sggGeom = `"${sggMeta.geomCol.replace(/"/g, '""')}"`;
    const sggFrom = `"${SGG_SCHEMA.replace(/"/g, '""')}"."${SGG_TABLE.replace(/"/g, '""')}"`;
    const sggPoint = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${inputSrid}), ${sggMeta.srid})`;
    try {
      const sggRes = await db.execute(
        sql.raw(
          `SELECT EXISTS (
             SELECT 1 FROM ${sggFrom}
             WHERE ${sggGeom} IS NOT NULL
               AND ST_Intersects(${sggGeom}, ${sggPoint})
           ) AS inside`
        )
      );
      insideSgg = (sggRes.rows?.[0] as { inside?: boolean } | undefined)?.inside === true;
    } catch {
      insideSgg = true;
    }
  } else {
    const emdExists = await tableExists('public_layer', 'emd');
    const emdMeta = emdExists ? await getGeomMeta('public_layer', 'emd') : null;
    if (emdMeta) {
      const emdGeom = `"${emdMeta.geomCol.replace(/"/g, '""')}"`;
      const emdPoint = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${inputSrid}), ${emdMeta.srid})`;
      try {
        const emdRes = await db.execute(
          sql.raw(
            `SELECT EXISTS (
               SELECT 1 FROM "public_layer"."emd"
               WHERE ${emdGeom} IS NOT NULL
                 AND ST_Intersects(${emdGeom}, ${emdPoint})
             ) AS inside`
          )
        );
        insideSgg = (emdRes.rows?.[0] as { inside?: boolean } | undefined)?.inside === true;
      } catch {
        insideSgg = true;
      }
    }
  }

  if (!insideSgg) {
    return {
      success: false,
      code: 'OUT_OF_SGG',
      message: '지원 지역을 벗어남',
    };
  }

  try {
    // 높이(cont)별로 가장 가까운 선 1개씩 → 가까운 순 후보
    const res = await db.execute(
      sql.raw(
        `WITH by_elev AS (
           SELECT DISTINCT ON ((cont::double precision))
             cont::double precision AS elevation,
             ST_Distance(${elevGeom}, ${pointSql}) AS distance_m
           FROM ${elevFrom}
           WHERE ${elevGeom} IS NOT NULL AND cont IS NOT NULL
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
