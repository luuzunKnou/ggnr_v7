/**
 * 고도 측정 — public_layer.elevation 상·하 인접 등고 보간, 시군구(sgg) 범위 검사
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import {
  readWtlLayerLineColor,
  readWtlLayerPointColor,
  readWtlManhPsSymbolColor,
  readWtlPipeLmStrokeColor,
} from '@/lib/geoserverStyleFillColor';
import {
  getWtlLayerShapeDef,
  type WtlLayerShapeDef,
} from '@/lib/wtlLayerShapeDefs';

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

/** 등고 레벨 이하로 양자화(간격 사이 평지) */
function quantizeToLowerLevel(elev: number, levels: number[]): number {
  if (!levels.length) return Math.floor(elev / 5) * 5;
  const sorted = [...levels].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return Math.floor(elev / 5) * 5;
  let best = sorted[0];
  for (const lv of sorted) {
    if (lv <= elev + 0.05) best = lv;
    else break;
  }
  return best;
}

/**
 * 지형 격자용 고도 조회 (지표 결정 = 고도 측정과 동일):
 * 1) 격자 bbox(+여유)로 등고선 MATERIALIZED
 * 2) 격자점마다 cont별 최근접 후보 → 상·하 등고 거리가중 보간(IDW)
 */
async function fetchElevationGridIdwBatch(opts: {
  elevFrom: string;
  elevGeomCol: string;
  elevGeom: string;
  elevSrid: number;
  inputSrid: number;
  centerX: number;
  centerY: number;
  stepProj: number;
  mid: number;
  size: number;
  /** 격자 밖 후보 탐색 여유(m, elev CRS) */
  padM: number;
}): Promise<Map<string, number>> {
  const {
    elevFrom,
    elevGeomCol,
    elevGeom,
    elevSrid,
    inputSrid,
    centerX,
    centerY,
    stepProj,
    mid,
    size,
    padM,
  } = opts;
  const last = size - 1;
  const halfExtent = mid * stepProj;
  // DWithin 탐색 반경 — elev_local 적재 범위도 동일해야 함.
  // (이전: ST_Expand는 padM≈40m만 써서 작은 격자에서 등고가 안 실리고
  //  점 탐색 300m과 어긋나 «고도 샘플 없음»이 났음. 측정 API는 300m 사용.)
  const searchR = Math.max(padM, SEARCH_RADIUS_M);
  const res = await db.execute(
    sql.raw(
      `WITH grid_env AS (
         SELECT ST_Expand(
           ST_Transform(
             ST_SetSRID(
               ST_MakeEnvelope(
                 ${centerX - halfExtent},
                 ${centerY - halfExtent},
                 ${centerX + halfExtent},
                 ${centerY + halfExtent},
                 ${inputSrid}
               ),
               ${inputSrid}
             ),
             ${elevSrid}
           ),
           ${searchR}
         ) AS env
       ),
       elev_local AS MATERIALIZED (
         SELECT ${elevGeom} AS geom, cont::double precision AS elevation
         FROM ${elevFrom}
         WHERE ${elevGeomCol} IS NOT NULL
           AND cont IS NOT NULL
           AND ST_Intersects(${elevGeom}, (SELECT env FROM grid_env))
       ),
       grid AS (
         SELECT
           i::integer AS i,
           j::integer AS j,
           ST_Transform(
             ST_SetSRID(
               ST_MakePoint(
                 ${centerX} + (i - ${mid}) * ${stepProj},
                 ${centerY} + (j - ${mid}) * ${stepProj}
               ),
               ${inputSrid}
             ),
             ${elevSrid}
           ) AS pt
         FROM generate_series(0, ${last}) AS i
         CROSS JOIN generate_series(0, ${last}) AS j
       )
       SELECT g.i, g.j, c.elevation, c.distance_m
       FROM grid g
       LEFT JOIN LATERAL (
         SELECT elevation, distance_m
         FROM (
           SELECT DISTINCT ON ((e.elevation))
             e.elevation,
             ST_Distance(e.geom, g.pt) AS distance_m
           FROM elev_local e
           WHERE ST_DWithin(e.geom, g.pt, ${searchR})
           ORDER BY e.elevation, e.geom <-> g.pt
         ) u
         ORDER BY distance_m ASC
         LIMIT ${CANDIDATE_DISTINCT_ELEV}
       ) c ON true`
    )
  );

  const candByCell = new Map<string, ElevCandidate[]>();
  for (const raw of res.rows ?? []) {
    const row = raw as {
      i?: number;
      j?: number;
      elevation?: number | string | null;
      distance_m?: number | string | null;
    };
    const i = Number(row.i);
    const j = Number(row.j);
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
    if (row.elevation == null) continue;
    const elevation = Number(row.elevation);
    const distanceM = Number(row.distance_m);
    if (!Number.isFinite(elevation) || !Number.isFinite(distanceM)) continue;
    const key = `${i},${j}`;
    const list = candByCell.get(key) ?? [];
    list.push({ elevation, distanceM });
    candByCell.set(key, list);
  }

  const map = new Map<string, number>();
  for (const [key, candidates] of candByCell) {
    const { elevation } = interpolateElevationFromCandidates(candidates);
    if (!Number.isFinite(elevation)) continue;
    // 측정 고도와 동일 — 소수 1자리
    map.set(key, Math.round(elevation * 10) / 10);
  }
  return map;
}

/** 범위로 클립된 실제 등고선 (평면도 elevation.cont) */
export type ElevationContourInExtent = {
  elevM: number;
  coords3857: [number, number][];
};

/** 범위로 클립된 하천구역 (지방·소하천) */
export type ElevationRiverInExtent = {
  kind: 'local' | 'small';
  /** rings[0]=외곽, 이후 홀 */
  rings3857: [number, number][][];
};

export type ElevationGridResult = {
  success: boolean;
  error?: string;
  size: number;
  stepM: number;
  radiusM: number;
  centerX: number;
  centerY: number;
  /** 입력 좌표계 */
  srid: number;
  baseElevM: number;
  /** row-major, 원 밖 null, 값은 양자화된 고도(m) */
  heights: (number | null)[];
  /** 격자 내 등장하는 등고 고도(m) */
  levels: number[];
  /** 범위와 교차하는 실제 등고선 (평면도와 동일 cont) */
  contours: ElevationContourInExtent[];
  /** 지방하천·소하천 구역 */
  rivers: ElevationRiverInExtent[];
};

type LayerExtentCenter = {
  success: boolean;
  centerX?: number;
  centerY?: number;
  extent?: [number, number, number, number];
  error?: string;
};

async function getPublicLayerExtentCenter3857(
  schema: string,
  table: string,
  label: string
): Promise<LayerExtentCenter> {
  const exists = await tableExists(schema, table);
  const meta = exists ? await getGeomMeta(schema, table) : null;
  if (!meta) {
    return { success: false, error: `${label} 데이터가 없습니다` };
  }
  const geomCol = `"${meta.geomCol.replace(/"/g, '""')}"`;
  const geom = geomStamped(geomCol, meta.srid);
  const from = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           ST_XMin(e) AS minx, ST_YMin(e) AS miny,
           ST_XMax(e) AS maxx, ST_YMax(e) AS maxy,
           ST_X(ST_Centroid(e)) AS cx, ST_Y(ST_Centroid(e)) AS cy
         FROM (
           SELECT ST_Transform(ST_SetSRID(ST_Extent(${geom}), ${meta.srid}), 3857) AS e
           FROM ${from}
           WHERE ${geomCol} IS NOT NULL
         ) t`
      )
    );
    const row = res.rows?.[0] as
      | { minx?: number; miny?: number; maxx?: number; maxy?: number; cx?: number; cy?: number }
      | undefined;
    const cx = Number(row?.cx);
    const cy = Number(row?.cy);
    const minx = Number(row?.minx);
    const miny = Number(row?.miny);
    const maxx = Number(row?.maxx);
    const maxy = Number(row?.maxy);
    if (![cx, cy, minx, miny, maxx, maxy].every(Number.isFinite)) {
      return { success: false, error: `${label} 범위를 계산하지 못했습니다` };
    }
    return {
      success: true,
      centerX: cx,
      centerY: cy,
      extent: [minx, miny, maxx, maxy],
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : `${label} 범위 조회 오류`,
    };
  }
}

/**
 * public_layer.sgg 전체 extent 중심 (EPSG:3857)
 */
export async function getSggCenter3857(): Promise<LayerExtentCenter> {
  return getPublicLayerExtentCenter3857(SGG_SCHEMA, SGG_TABLE, '시군구(sgg)');
}

/**
 * public_layer.emd 전체 extent 중심 (EPSG:3857) — 지형·관로 선택 지도 초기 위치.
 */
export async function getEmdCenter3857(): Promise<LayerExtentCenter> {
  return getPublicLayerExtentCenter3857('public_layer', 'emd', '읍면동(emd)');
}

/**
 * 클릭 중심 반경 내 격자 고도 — 등고 상·하 거리가중 보간(지표 = 고도 측정과 동일).
 * ThreeJs 지형(GROUND)·관로 지표용. (5m 양자화/최근접 1건만 쓰지 않음)
 */
export async function getElevationGrid(params: {
  x?: number;
  y?: number;
  srid?: number;
  radiusM?: number;
  stepM?: number;
}): Promise<ElevationGridResult> {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const inputSrid = Number(params?.srid) > 0 ? Number(params.srid) : 3857;
  const radiusM = Math.max(1, Math.min(2000, Number(params?.radiusM) || 10));
  let stepM = Math.max(0.5, Math.min(100, Number(params?.stepM) || 5));
  // 작은 범위: step이 반경보다 크면 줄여 요청 크기를 유지
  if (stepM > radiusM) stepM = Math.max(0.5, radiusM);

  const empty = (error: string): ElevationGridResult => ({
    success: false,
    error,
    size: 0,
    stepM,
    radiusM,
    centerX: x,
    centerY: y,
    srid: inputSrid,
    baseElevM: 0,
    heights: [],
    levels: [],
    contours: [],
    rivers: [],
  });

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return empty('중심 좌표가 올바르지 않습니다');
  }

  const elevExists = await tableExists(ELEVATION_SCHEMA, ELEVATION_TABLE);
  const elevMeta = elevExists ? await getGeomMeta(ELEVATION_SCHEMA, ELEVATION_TABLE) : null;
  if (!elevExists || !elevMeta) {
    return empty('고도 관련 데이터가 없습니다');
  }

  const elevGeomCol = `"${elevMeta.geomCol.replace(/"/g, '""')}"`;
  const elevGeom = geomStamped(elevGeomCol, elevMeta.srid);
  const elevFrom = `"${ELEVATION_SCHEMA.replace(/"/g, '""')}"."${ELEVATION_TABLE.replace(/"/g, '""')}"`;

  // 정사각 격자: 홀수 격자로 중심 셀 포함. 반경은 요청값 유지, step만 맞춤
  // (이전: ceil×step으로 반경이 커지며 작은 선택이 강제 확대됨)
  const halfSteps = Math.max(1, Math.ceil(radiusM / stepM));
  const size = halfSteps * 2 + 1;
  const gridRadiusM = radiusM;
  const stepActual = radiusM / halfSteps;
  const heights: (number | null)[] = new Array(size * size).fill(null);
  const mid = halfSteps;

  // EPSG:3857은 위도에 따라 지표 m ≠ 투영 m → 격자 오프셋에 보정
  let meterToProj = 1;
  if (inputSrid === 3857) {
    const latRad = 2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  const stepProj = stepActual * meterToProj;

  let elevByCell: Map<string, number>;
  try {
    elevByCell = await fetchElevationGridIdwBatch({
      elevFrom,
      elevGeomCol,
      elevGeom,
      elevSrid: elevMeta.srid,
      inputSrid,
      centerX: x,
      centerY: y,
      stepProj,
      mid,
      size,
      padM: Math.max(SEARCH_RADIUS_M, stepActual * 8),
    });
  } catch (e) {
    return empty(e instanceof Error ? e.message : '격자 고도 배치 조회 실패');
  }

  const levelSet = new Set<number>();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const elev = elevByCell.get(`${i},${j}`);
      if (elev == null || !Number.isFinite(elev)) continue;
      heights[j * size + i] = elev;
      levelSet.add(elev);
    }
  }

  const levels = [...levelSet].sort((a, b) => a - b);
  const valid = heights.filter((h): h is number => h != null && Number.isFinite(h));
  if (!valid.length) {
    return empty('범위 내 고도 샘플을 만들지 못했습니다');
  }
  const baseElevM = Math.min(...valid);

  // 평면도와 동일한 실제 등고선(cont) — 메시와 동일 정사각 범위 클립
  let contours: ElevationContourInExtent[] = [];
  try {
    contours = await fetchElevationContoursInExtent({
      elevFrom,
      elevGeomCol,
      elevGeom,
      centerX: x,
      centerY: y,
      radiusM: gridRadiusM,
      meterToProj,
    });
  } catch {
    contours = [];
  }

  let rivers: ElevationRiverInExtent[] = [];
  try {
    rivers = await fetchRiversInExtent({
      centerX: x,
      centerY: y,
      radiusM: gridRadiusM,
      meterToProj,
    });
  } catch {
    rivers = [];
  }

  return {
    success: true,
    size,
    stepM: stepActual,
    radiusM: gridRadiusM,
    centerX: x,
    centerY: y,
    srid: inputSrid,
    baseElevM,
    heights,
    levels,
    contours,
    rivers,
  };
}

const RIVER_LOCAL_SCHEMA = 'layer';
const RIVER_LOCAL_TABLE = 'river_plan_as';
const RIVER_SMALL_SCHEMA = 'layer';
const RIVER_SMALL_TABLE = 'river_plan_s_as';

/**
 * 정사각 범위와 교차하는 지방하천·소하천 구역(폴리곤) 클립.
 */
async function fetchRiversInExtent(opts: {
  centerX: number;
  centerY: number;
  radiusM: number;
  meterToProj: number;
}): Promise<ElevationRiverInExtent[]> {
  const half = opts.radiusM * opts.meterToProj;
  const minx = opts.centerX - half;
  const maxx = opts.centerX + half;
  const miny = opts.centerY - half;
  const maxy = opts.centerY + half;
  const env3857 = `ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 3857)`;

  const out: ElevationRiverInExtent[] = [];
  const sources: { kind: 'local' | 'small'; schema: string; table: string }[] = [
    { kind: 'local', schema: RIVER_LOCAL_SCHEMA, table: RIVER_LOCAL_TABLE },
    { kind: 'small', schema: RIVER_SMALL_SCHEMA, table: RIVER_SMALL_TABLE },
  ];

  for (const src of sources) {
    const exists = await tableExists(src.schema, src.table);
    const meta = exists ? await getGeomMeta(src.schema, src.table) : null;
    if (!meta) continue;

    const geomCol = `"${meta.geomCol.replace(/"/g, '""')}"`;
    const geom = geomStamped(geomCol, meta.srid);
    const from = `"${src.schema.replace(/"/g, '""')}"."${src.table.replace(/"/g, '""')}"`;
    const in3857 = `ST_Transform(${geom}, 3857)`;

    try {
      const res = await db.execute(
        sql.raw(
          `WITH hits AS (
             SELECT
               ST_CollectionExtract(
                 ST_MakeValid(ST_Intersection(${in3857}, ${env3857})),
                 3
               ) AS clip
             FROM ${from}
             WHERE ${geomCol} IS NOT NULL
               AND ST_Intersects(${in3857}, ${env3857})
             LIMIT 200
           )
           SELECT ST_AsGeoJSON(clip) AS geojson
           FROM hits
           WHERE clip IS NOT NULL AND NOT ST_IsEmpty(clip)`
        )
      );
      for (const raw of res.rows ?? []) {
        const geojson = String((raw as { geojson?: string }).geojson ?? '');
        const polys = parsePolygonRingsParts3857(geojson);
        for (const rings3857 of polys) {
          if (!rings3857.length || rings3857[0].length < 3) continue;
          out.push({ kind: src.kind, rings3857 });
        }
      }
    } catch {
      /* 테이블·교차 실패 시 해당 종류만 스킵 */
    }
  }

  return out;
}

/** GeoJSON Polygon / MultiPolygon → 폴리곤별 링 배열 */
function parsePolygonRingsParts3857(geojson: string): [number, number][][][] {
  try {
    const g = JSON.parse(geojson) as {
      type?: string;
      coordinates?: unknown;
    };
    const toRing = (ring: unknown): [number, number][] => {
      const out: [number, number][] = [];
      if (!Array.isArray(ring)) return out;
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const x = Number(c[0]);
        const y = Number(c[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
      }
      return out;
    };
    const polys: [number, number][][][] = [];
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const rings = (g.coordinates as unknown[]).map(toRing).filter((r) => r.length >= 3);
      if (rings.length) polys.push(rings);
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates) {
        if (!Array.isArray(poly)) continue;
        const rings = (poly as unknown[]).map(toRing).filter((r) => r.length >= 3);
        if (rings.length) polys.push(rings);
      }
    }
    return polys;
  } catch {
    return [];
  }
}

/**
 * 정사각 범위와 교차하는 elevation 등고선(cont)을 3857로 클립해 반환.
 * 평면 지도 등고선과 동일 간격·형상.
 */
async function fetchElevationContoursInExtent(opts: {
  elevFrom: string;
  elevGeomCol: string;
  elevGeom: string;
  centerX: number;
  centerY: number;
  radiusM: number;
  meterToProj: number;
}): Promise<ElevationContourInExtent[]> {
  const half = opts.radiusM * opts.meterToProj;
  const minx = opts.centerX - half;
  const maxx = opts.centerX + half;
  const miny = opts.centerY - half;
  const maxy = opts.centerY + half;
  const env3857 = `ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 3857)`;
  const elevIn3857 = `ST_Transform(${opts.elevGeom}, 3857)`;

  const res = await db.execute(
    sql.raw(
      `WITH hits AS (
         SELECT
           cont::double precision AS elev,
           ST_CollectionExtract(
             ST_MakeValid(ST_Intersection(${elevIn3857}, ${env3857})),
             2
           ) AS clip
         FROM ${opts.elevFrom}
         WHERE ${opts.elevGeomCol} IS NOT NULL
           AND cont IS NOT NULL
           AND ST_Intersects(${elevIn3857}, ${env3857})
         LIMIT 800
       )
       SELECT elev, ST_AsGeoJSON(clip) AS geojson
       FROM hits
       WHERE clip IS NOT NULL AND NOT ST_IsEmpty(clip)`
    )
  );

  const out: ElevationContourInExtent[] = [];
  for (const raw of res.rows ?? []) {
    const row = raw as { elev?: number | string; geojson?: string };
    const elevM = Number(row.elev);
    if (!Number.isFinite(elevM)) continue;
    const parts = parseLineCoordsParts3857(String(row.geojson ?? ''));
    for (const coords3857 of parts) {
      if (coords3857.length < 2) continue;
      out.push({ elevM, coords3857 });
    }
  }
  return out;
}

/** GeoJSON LineString / MultiLineString → 라인별 좌표 배열 */
function parseLineCoordsParts3857(geojson: string): [number, number][][] {
  try {
    const g = JSON.parse(geojson) as {
      type?: string;
      coordinates?: unknown;
    };
    const parts: [number, number][][] = [];
    const toRing = (ring: unknown): [number, number][] => {
      const out: [number, number][] = [];
      if (!Array.isArray(ring)) return out;
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const x = Number(c[0]);
        const y = Number(c[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
      }
      return out;
    };
    if (g.type === 'LineString') {
      const ring = toRing(g.coordinates);
      if (ring.length >= 2) parts.push(ring);
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      for (const line of g.coordinates) {
        const ring = toRing(line);
        if (ring.length >= 2) parts.push(ring);
      }
    } else if (g.type === 'GeometryCollection' && Array.isArray((g as { geometries?: unknown }).geometries)) {
      // ST_Intersection 결과가 Collection 인 경우 AsGeoJSON 은 보통 단일 clip
      /* handled by CollectionExtract type 2 */
    }
    return parts;
  } catch {
    return [];
  }
}

const PIPE_LM_SCHEMA = 'layer';
const PIPE_LM_TABLE = 'wtl_pipe_lm';
const PIPE_PS_SCHEMA = 'layer';
const PIPE_PS_TABLE = 'wtl_pipe_ps';

export type WtlPipeInExtent = {
  id: string;
  /** 관라벨 (pip_lbl) */
  label?: string;
  /** 상수관용도 (saa_cde) */
  saaCde?: string;
  /** GeoServer CSS stroke 색 */
  color?: string;
  coords3857: [number, number][];
  /** 관경 m (std_dip: mm면 /1000) */
  diameterM: number;
  /**
   * 심도 m — CrossSectionController 와 동일 우선순위:
   * 최근접 pip_dep → (low+hgh)/2 → (beg+end)/2 → std_dep → dep_avg → lay_dep → 기본
   */
  depthM: number;
  /**
   * 꼭짓점별 심도(m). 근처 wtl_pipe_ps.pip_dep(10m) 최근접, 없으면 depthM.
   * coords3857 과 동일 길이.
   */
  depthsM?: number[];
  /** 지표 해발(m) — 관 중점 등고 상·하 보간(고도 측정과 동일) */
  surfaceElevM?: number;
};

type PipeDepthSample = { x: number; y: number; depthM: number };

function parseStdDipToMeters(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0.1; // 기본 100mm
  // 관경 정의: 통상 mm (100, 150, 200…) — 10 초과면 mm로 간주
  if (n > 10) return n / 1000;
  return n;
}

function parseDepthMeters(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * 레거시 CrossSectionController 심도 폴백.
 * low_dep 있으면 (low+hgh)/2, beg_dep 있으면 (beg+end)/2.
 */
function resolveLegacyPipeDepthM(
  row: {
    nearest_pip_dep?: unknown;
    low_dep?: unknown;
    hgh_dep?: unknown;
    beg_dep?: unknown;
    end_dep?: unknown;
    std_dep?: unknown;
    dep_avg?: unknown;
    lay_dep?: unknown;
  },
  fallbackDefault: number
): number {
  const nearest = parseDepthMeters(row.nearest_pip_dep);
  if (nearest != null) return nearest;

  const low = parseDepthMeters(row.low_dep);
  const high = parseDepthMeters(row.hgh_dep);
  if (low != null) {
    return high != null ? (low + high) / 2 : low;
  }

  const beg = parseDepthMeters(row.beg_dep);
  const end = parseDepthMeters(row.end_dep);
  if (beg != null) {
    return end != null ? (beg + end) / 2 : beg;
  }

  const std = parseDepthMeters(row.std_dep);
  if (std != null) return std;
  const avg = parseDepthMeters(row.dep_avg);
  if (avg != null) return avg;
  const lay = parseDepthMeters(row.lay_dep);
  if (lay != null) return lay;
  return fallbackDefault;
}

/** 범위(+여유) 안 심도점 — 꼭짓점별 최근접 pip_dep 용 */
async function fetchPipeDepthSamplesInEnv(
  env3857Sql: string,
  padProj: number
): Promise<PipeDepthSample[]> {
  const psExists = await tableExists(PIPE_PS_SCHEMA, PIPE_PS_TABLE);
  const psMeta = psExists ? await getGeomMeta(PIPE_PS_SCHEMA, PIPE_PS_TABLE) : null;
  if (!psMeta) return [];

  const psGeomCol = `"${psMeta.geomCol.replace(/"/g, '""')}"`;
  const psGeom = geomStamped(psGeomCol, psMeta.srid);
  const psFrom = `"${PIPE_PS_SCHEMA.replace(/"/g, '""')}"."${PIPE_PS_TABLE.replace(/"/g, '""')}"`;
  const psIn3857 = `ST_Transform(${psGeom}, 3857)`;
  const buf = `ST_Buffer(${env3857Sql}, ${padProj})`;

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           ST_X(${psIn3857}) AS x,
           ST_Y(${psIn3857}) AS y,
           d.pip_dep::double precision AS pip_dep
         FROM ${psFrom} d
         WHERE ${psGeomCol} IS NOT NULL
           AND d.pip_dep IS NOT NULL
           AND ST_Intersects(${psIn3857}, ${buf})
         LIMIT 4000`
      )
    );
    const out: PipeDepthSample[] = [];
    for (const raw of res.rows ?? []) {
      const row = raw as { x?: unknown; y?: unknown; pip_dep?: unknown };
      const x = Number(row.x);
      const y = Number(row.y);
      const depthM = parseDepthMeters(row.pip_dep);
      if (!Number.isFinite(x) || !Number.isFinite(y) || depthM == null) continue;
      out.push({ x, y, depthM });
    }
    return out;
  } catch {
    return [];
  }
}

/** 꼭짓점마다 10m(투영) 안 최근접 심도점. 없으면 fallback */
function depthsAlongCoords(
  coords: [number, number][],
  samples: PipeDepthSample[],
  searchProj: number,
  fallback: number
): number[] {
  if (!coords.length) return [];
  if (!samples.length) return coords.map(() => fallback);
  const r2 = searchProj * searchProj;
  return coords.map(([x, y]) => {
    let bestD = Infinity;
    let bestDep = fallback;
    for (const s of samples) {
      const dx = s.x - x;
      const dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 < bestD) {
        bestD = d2;
        bestDep = s.depthM;
      }
    }
    return bestDep;
  });
}

function parseLineCoords3857(geojson: string): [number, number][] {
  try {
    const g = JSON.parse(geojson) as {
      type?: string;
      coordinates?: unknown;
    };
    const out: [number, number][] = [];
    const pushRing = (ring: unknown) => {
      if (!Array.isArray(ring)) return;
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const x = Number(c[0]);
        const y = Number(c[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
      }
    };
    if (g.type === 'LineString') pushRing(g.coordinates);
    else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      for (const line of g.coordinates) pushRing(line);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 정사각 범위(중심·절반 m, EPSG:3857)와 교차하는 상수관로(wtl_pipe_lm).
 * 심도: CrossSectionController 폴백 + 꼭짓점별 최근접 pip_dep(10m).
 */
export async function getWtlPipesInExtent(params: {
  x?: number;
  y?: number;
  srid?: number;
  radiusM?: number;
  /**
   * 단면도 등 — 정사각 envelope 대신 폴리곤으로 클립.
   * EPSG:3857 링(닫힘 권장). 유효하면 radius 정사각 대신 사용.
   */
  polygon3857?: [number, number][] | number[][];
}): Promise<{ success: boolean; pipes: WtlPipeInExtent[]; error?: string }> {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const inputSrid = Number(params?.srid) > 0 ? Number(params.srid) : 3857;
  const radiusM = Math.max(1, Math.min(2000, Number(params?.radiusM) || 10));

  const polyRaw = Array.isArray(params?.polygon3857) ? params.polygon3857 : null;
  const polyPts: [number, number][] = [];
  if (polyRaw) {
    for (const p of polyRaw) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const px = Number(p[0]);
      const py = Number(p[1]);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      polyPts.push([px, py]);
    }
  }
  const usePolygon = polyPts.length >= 3;

  if (!usePolygon && (!Number.isFinite(x) || !Number.isFinite(y))) {
    return { success: false, pipes: [], error: '중심 좌표가 올바르지 않습니다' };
  }

  const lmExists = await tableExists(PIPE_LM_SCHEMA, PIPE_LM_TABLE);
  const lmMeta = lmExists ? await getGeomMeta(PIPE_LM_SCHEMA, PIPE_LM_TABLE) : null;
  if (!lmMeta) {
    return { success: false, pipes: [], error: '상수관로(wtl_pipe_lm) 데이터가 없습니다' };
  }

  const cyForLat = usePolygon
    ? polyPts.reduce((s, p) => s + p[1], 0) / polyPts.length
    : y;
  let meterToProj = 1;
  if (inputSrid === 3857) {
    const latRad = 2 * Math.atan(Math.exp(cyForLat / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  /** 횡단면도 DWithin 10m 와 동일 (3857 보정) */
  const depSearchProj = 10 * meterToProj;

  const lmGeomCol = `"${lmMeta.geomCol.replace(/"/g, '""')}"`;
  const lmGeom = geomStamped(lmGeomCol, lmMeta.srid);
  const lmFrom = `"${PIPE_LM_SCHEMA.replace(/"/g, '""')}"."${PIPE_LM_TABLE.replace(/"/g, '""')}"`;

  const begCol = await resolveLayerColumnName(PIPE_LM_TABLE, ['beg_dep', 'BEG_DEP']);
  const endCol = await resolveLayerColumnName(PIPE_LM_TABLE, ['end_dep', 'END_DEP']);
  const stdDepCol = await resolveLayerColumnName(PIPE_LM_TABLE, ['std_dep', 'STD_DEP']);
  const depAvgCol = await resolveLayerColumnName(PIPE_LM_TABLE, ['dep_avg', 'DEP_AVG']);
  const layCol = await resolveLayerColumnName(PIPE_LM_TABLE, ['lay_dep', 'LAY_DEP']);

  let env3857: string;
  if (usePolygon) {
    const ring = [...polyPts];
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    const wkt = `POLYGON((${ring.map(([px, py]) => `${px} ${py}`).join(',')}))`;
    env3857 = `ST_MakeValid(ST_GeomFromText('${wkt}', 3857))`;
  } else {
    const half = radiusM * meterToProj;
    const minx = x - half;
    const maxx = x + half;
    const miny = y - half;
    const maxy = y + half;
    env3857 = `ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 3857)`;
  }
  const lmIn3857 = `ST_Transform(${lmGeom}, 3857)`;

  const psExists = await tableExists(PIPE_PS_SCHEMA, PIPE_PS_TABLE);
  const psMeta = psExists ? await getGeomMeta(PIPE_PS_SCHEMA, PIPE_PS_TABLE) : null;

  let nearestPipDepSql = 'NULL::double precision AS nearest_pip_dep';
  if (psMeta) {
    const psGeomCol = `"${psMeta.geomCol.replace(/"/g, '""')}"`;
    const psGeom = geomStamped(psGeomCol, psMeta.srid);
    const psFrom = `"${PIPE_PS_SCHEMA.replace(/"/g, '""')}"."${PIPE_PS_TABLE.replace(/"/g, '""')}"`;
    const psIn3857 = `ST_Transform(${psGeom}, 3857)`;
    // 관 클립 라인에 가장 가까운 심도점 1건 (선 bbox 전체 AVG 금지 — 횡단면도와 동일)
    nearestPipDepSql = `(
         SELECT d.pip_dep::double precision
         FROM ${psFrom} d
         WHERE ${psGeomCol} IS NOT NULL
           AND d.pip_dep IS NOT NULL
           AND ST_DWithin(${psIn3857}, h.clip, ${depSearchProj})
         ORDER BY ${psIn3857} <-> h.clip
         LIMIT 1
       ) AS nearest_pip_dep`;
  }

  const hitExtra = [
    begCol ? `${quoteIdent(begCol)} AS beg_dep` : `NULL::double precision AS beg_dep`,
    endCol ? `${quoteIdent(endCol)} AS end_dep` : `NULL::double precision AS end_dep`,
    stdDepCol ? `${quoteIdent(stdDepCol)} AS std_dep` : `NULL::double precision AS std_dep`,
    depAvgCol ? `${quoteIdent(depAvgCol)} AS dep_avg` : `NULL::double precision AS dep_avg`,
    layCol ? `${quoteIdent(layCol)} AS lay_dep` : `NULL::double precision AS lay_dep`,
  ];

  try {
    const res = await db.execute(
      sql.raw(
        `WITH hits AS (
           SELECT
             pip_lbl,
             saa_cde,
             std_dip,
             hgh_dep,
             low_dep,
             ${hitExtra.join(',\n             ')},
             ST_CollectionExtract(
               ST_MakeValid(ST_Intersection(${lmIn3857}, ${env3857})),
               2
             ) AS clip
           FROM ${lmFrom}
           WHERE ${lmGeomCol} IS NOT NULL
             AND ST_Intersects(${lmIn3857}, ${env3857})
           LIMIT 300
         )
         SELECT
           h.pip_lbl,
           h.saa_cde,
           h.std_dip,
           h.hgh_dep,
           h.low_dep,
           h.beg_dep,
           h.end_dep,
           h.std_dep,
           h.dep_avg,
           h.lay_dep,
           ST_AsGeoJSON(h.clip) AS geojson,
           ${nearestPipDepSql}
         FROM hits h
         WHERE h.clip IS NOT NULL AND NOT ST_IsEmpty(h.clip)`
      )
    );

    const depthSamples = await fetchPipeDepthSamplesInEnv(env3857, depSearchProj);

    const pipes: WtlPipeInExtent[] = [];
    const midPoints: [number, number][] = [];
    for (const raw of res.rows ?? []) {
      const row = raw as {
        pip_lbl?: unknown;
        saa_cde?: unknown;
        std_dip?: unknown;
        hgh_dep?: unknown;
        low_dep?: unknown;
        beg_dep?: unknown;
        end_dep?: unknown;
        std_dep?: unknown;
        dep_avg?: unknown;
        lay_dep?: unknown;
        nearest_pip_dep?: unknown;
        geojson?: string;
      };
      const coords = parseLineCoords3857(String(row.geojson ?? ''));
      if (coords.length < 2) continue;

      const depthM = resolveLegacyPipeDepthM(row, 1.2);
      const depthsM = depthsAlongCoords(coords, depthSamples, depSearchProj, depthM);

      const labelRaw = row.pip_lbl != null ? String(row.pip_lbl).trim() : '';
      const saaCde =
        row.saa_cde != null ? String(row.saa_cde).trim().toUpperCase() : '';
      const mid = coords[Math.floor(coords.length / 2)]!;
      midPoints.push(mid);
      pipes.push({
        id: `pipe-${pipes.length}`,
        label: labelRaw || undefined,
        saaCde: saaCde || undefined,
        color: readWtlPipeLmStrokeColor(saaCde || null),
        coords3857: coords,
        diameterM: parseStdDipToMeters(row.std_dip),
        depthM,
        depthsM,
      });
    }

    // 지표: 관 중점 등고 상·하 보간 (지도 고도 측정과 동일)
    try {
      const surfaces = await fetchSurfaceElevIdwAtPoints3857(midPoints);
      for (let i = 0; i < pipes.length; i++) {
        const elev = surfaces[i];
        if (elev != null) pipes[i].surfaceElevM = elev;
      }
    } catch {
      /* 지표 실패 시 depth만으로 배치(Y=0 기준) */
    }

    return { success: true, pipes };
  } catch (e) {
    return {
      success: false,
      pipes: [],
      error: e instanceof Error ? e.message : '상수관로 조회 오류',
    };
  }
}

const MANH_SCHEMA = 'layer';
const MANH_TABLE = 'wtl_manh_ps';

export type WtlManholeInExtent = {
  id: string;
  label?: string;
  color?: string;
  x3857: number;
  y3857: number;
  /** 외경 m (MAN_STD 규격) */
  diameterM: number;
  /**
   * 표시용 원통 높이(m).
   * 상수맨홀 테이블에 심도 필드 없음 — 고정 표고.
   */
  depthM: number;
  surfaceElevM?: number;
  /** SLD 조건 심볼용 (ftr_cde 등) */
  styleCode?: string;
};

/** 상수맨홀 3D 표시용 기본 높이(심도 컬럼 없음) */
const MANHOLE_DISPLAY_DEPTH_M = 0.4;

function parseManStdToMeters(raw: unknown): number {
  if (typeof raw === 'string') {
    const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (m) return parseStdDipToMeters(m[1]);
  }
  return parseStdDipToMeters(raw);
}

/** layer 스키마 실제 컬럼명(대소문자 유지). 없으면 null */
async function resolveLayerColumnName(
  table: string,
  candidates: string[]
): Promise<string | null> {
  const t = table.toLowerCase().replace(/"/g, '""');
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/"/g, '""');
    const res = await db.execute(
      sql.raw(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'layer'
           AND lower(table_name) = '${esc(t)}'
           AND lower(column_name) = '${esc(c)}'
         LIMIT 1`
      )
    );
    const name = (res.rows?.[0] as { column_name?: unknown } | undefined)?.column_name;
    if (typeof name === 'string' && name.length) return name;
  }
  return null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function parsePointCoords3857(geojson: string): [number, number] | null {
  try {
    const g = JSON.parse(geojson) as {
      type?: string;
      coordinates?: unknown;
    };
    if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      const x = Number(g.coordinates[0]);
      const y = Number(g.coordinates[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
    }
    if (
      g.type === 'MultiPoint' &&
      Array.isArray(g.coordinates) &&
      Array.isArray(g.coordinates[0]) &&
      (g.coordinates[0] as unknown[]).length >= 2
    ) {
      const c = g.coordinates[0] as number[];
      const x = Number(c[0]);
      const y = Number(c[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 정사각 또는 폴리곤 범위의 상수맨홀(wtl_manh_ps).
 * 필드: FTR_IDN(관리번호), MAN_STD(규격) — 심도 컬럼 없음.
 */
export async function getWtlManholesInExtent(params: {
  x?: number;
  y?: number;
  srid?: number;
  radiusM?: number;
  polygon3857?: [number, number][] | number[][];
}): Promise<{ success: boolean; manholes: WtlManholeInExtent[]; error?: string }> {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const inputSrid = Number(params?.srid) > 0 ? Number(params.srid) : 3857;
  const radiusM = Math.max(1, Math.min(2000, Number(params?.radiusM) || 10));

  const polyRaw = Array.isArray(params?.polygon3857) ? params.polygon3857 : null;
  const polyPts: [number, number][] = [];
  if (polyRaw) {
    for (const p of polyRaw) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const px = Number(p[0]);
      const py = Number(p[1]);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      polyPts.push([px, py]);
    }
  }
  const usePolygon = polyPts.length >= 3;

  if (!usePolygon && (!Number.isFinite(x) || !Number.isFinite(y))) {
    return { success: false, manholes: [], error: '중심 좌표가 올바르지 않습니다' };
  }

  const exists = await tableExists(MANH_SCHEMA, MANH_TABLE);
  const meta = exists ? await getGeomMeta(MANH_SCHEMA, MANH_TABLE) : null;
  if (!meta) {
    return { success: false, manholes: [], error: '상수맨홀(wtl_manh_ps) 데이터가 없습니다' };
  }

  const idCol = await resolveLayerColumnName(MANH_TABLE, ['FTR_IDN', 'ftr_idn']);
  const stdCol = await resolveLayerColumnName(MANH_TABLE, ['MAN_STD', 'man_std']);
  if (!idCol && !stdCol) {
    // 최소한 geom만으로도 점은 조회
  }

  const cyForLat = usePolygon
    ? polyPts.reduce((s, p) => s + p[1], 0) / polyPts.length
    : y;
  let meterToProj = 1;
  if (inputSrid === 3857) {
    const latRad = 2 * Math.atan(Math.exp(cyForLat / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }

  const geomCol = `"${meta.geomCol.replace(/"/g, '""')}"`;
  const geom = geomStamped(geomCol, meta.srid);
  const from = `"${MANH_SCHEMA.replace(/"/g, '""')}"."${MANH_TABLE.replace(/"/g, '""')}"`;
  const in3857 = `ST_Transform(${geom}, 3857)`;

  let env3857: string;
  if (usePolygon) {
    const ring = [...polyPts];
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    const wkt = `POLYGON((${ring.map(([px, py]) => `${px} ${py}`).join(',')}))`;
    env3857 = `ST_MakeValid(ST_GeomFromText('${wkt}', 3857))`;
  } else {
    const half = radiusM * meterToProj;
    env3857 = `ST_MakeEnvelope(${x - half}, ${y - half}, ${x + half}, ${y + half}, 3857)`;
  }

  const selectParts = [
    idCol ? `${quoteIdent(idCol)} AS ftr_idn` : `NULL::text AS ftr_idn`,
    stdCol ? `${quoteIdent(stdCol)} AS man_std` : `NULL::text AS man_std`,
    `ST_AsGeoJSON(${in3857}) AS geojson`,
  ];

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           ${selectParts.join(',\n           ')}
         FROM ${from}
         WHERE ${geomCol} IS NOT NULL
           AND ST_Intersects(${in3857}, ${env3857})
         LIMIT 500`
      )
    );

    const manholes: WtlManholeInExtent[] = [];
    const pts: [number, number][] = [];
    for (const raw of res.rows ?? []) {
      const row = raw as {
        ftr_idn?: unknown;
        man_std?: unknown;
        geojson?: string;
      };
      const xy = parsePointCoords3857(String(row.geojson ?? ''));
      if (!xy) continue;
      const labelRaw = row.ftr_idn != null ? String(row.ftr_idn).trim() : '';
      pts.push(xy);
      manholes.push({
        id: `manh-${manholes.length}`,
        label: labelRaw || undefined,
        color: readWtlManhPsSymbolColor(),
        x3857: xy[0],
        y3857: xy[1],
        diameterM: Math.max(0.2, parseManStdToMeters(row.man_std)),
        depthM: MANHOLE_DISPLAY_DEPTH_M,
      });
    }

    try {
      const surfaces = await fetchSurfaceElevIdwAtPoints3857(pts);
      for (let i = 0; i < manholes.length; i++) {
        const elev = surfaces[i];
        if (elev != null) manholes[i].surfaceElevM = elev;
      }
    } catch {
      /* ignore */
    }

    return { success: true, manholes };
  } catch (e) {
    return {
      success: false,
      manholes: [],
      error: e instanceof Error ? e.message : '상수맨홀 조회 오류',
    };
  }
}

/**
 * EPSG:3857 점들의 지표 해발 — cont별 최근접 후 상·하 등고 IDW (getElevationAtPoint와 동일).
 */
async function fetchSurfaceElevIdwAtPoints3857(
  points: [number, number][]
): Promise<(number | null)[]> {
  const out: (number | null)[] = points.map(() => null);
  if (!points.length) return out;

  const elevExists = await tableExists(ELEVATION_SCHEMA, ELEVATION_TABLE);
  const elevMeta = elevExists ? await getGeomMeta(ELEVATION_SCHEMA, ELEVATION_TABLE) : null;
  if (!elevMeta) return out;

  const elevGeomCol = `"${elevMeta.geomCol.replace(/"/g, '""')}"`;
  const elevGeom = geomStamped(elevGeomCol, elevMeta.srid);
  const elevFrom = `"${ELEVATION_SCHEMA.replace(/"/g, '""')}"."${ELEVATION_TABLE.replace(/"/g, '""')}"`;

  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const [px, py] of points) {
    if (px < minx) minx = px;
    if (py < miny) miny = py;
    if (px > maxx) maxx = px;
    if (py > maxy) maxy = py;
  }
  const pad = SEARCH_RADIUS_M * 1.2;
  const valuesSql = points
    .map(([px, py], idx) => `(${idx}::integer, ${px}::double precision, ${py}::double precision)`)
    .join(',\n');

  const res = await db.execute(
    sql.raw(
      `WITH pts AS (
         SELECT * FROM (VALUES ${valuesSql}) AS t(idx, x, y)
       ),
       elev_local AS MATERIALIZED (
         SELECT ${elevGeom} AS geom, cont::double precision AS elevation
         FROM ${elevFrom}
         WHERE ${elevGeomCol} IS NOT NULL
           AND cont IS NOT NULL
           AND ST_Intersects(
             ${elevGeom},
             ST_Transform(
               ST_Expand(ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 3857), ${pad}),
               ${elevMeta.srid}
             )
           )
       )
       SELECT p.idx, c.elevation, c.distance_m
       FROM pts p
       LEFT JOIN LATERAL (
         SELECT elevation, distance_m
         FROM (
           SELECT DISTINCT ON ((e.elevation))
             e.elevation,
             ST_Distance(
               e.geom,
               ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${elevMeta.srid})
             ) AS distance_m
           FROM elev_local e
           WHERE ST_DWithin(
             e.geom,
             ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${elevMeta.srid}),
             ${SEARCH_RADIUS_M}
           )
           ORDER BY e.elevation,
             e.geom <-> ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${elevMeta.srid})
         ) u
         ORDER BY distance_m ASC
         LIMIT ${CANDIDATE_DISTINCT_ELEV}
       ) c ON true`
    )
  );

  const candByIdx = new Map<number, ElevCandidate[]>();
  for (const raw of res.rows ?? []) {
    const row = raw as {
      idx?: number;
      elevation?: number | string | null;
      distance_m?: number | string | null;
    };
    const idx = Number(row.idx);
    if (!Number.isInteger(idx) || row.elevation == null) continue;
    const elevation = Number(row.elevation);
    const distanceM = Number(row.distance_m);
    if (!Number.isFinite(elevation) || !Number.isFinite(distanceM)) continue;
    const list = candByIdx.get(idx) ?? [];
    list.push({ elevation, distanceM });
    candByIdx.set(idx, list);
  }

  for (const [idx, candidates] of candByIdx) {
    const { elevation } = interpolateElevationFromCandidates(candidates);
    if (!Number.isFinite(elevation)) continue;
    out[idx] = Math.round(elevation * 10) / 10;
  }
  return out;
}

type ExtentParams = {
  x?: number;
  y?: number;
  srid?: number;
  radiusM?: number;
  polygon3857?: [number, number][] | number[][];
};

function resolveLayerColor(def: WtlLayerShapeDef, saaCde?: string | null): string {
  if (def.colorMode === 'pipe_saa') {
    return readWtlPipeLmStrokeColor(saaCde, def.fallbackColor);
  }
  if (def.geom === 'line') {
    return readWtlLayerLineColor(def.styleName, def.fallbackColor);
  }
  // POINT: SVG 심볼 → CSS fill/stroke → SLD stroke → fallback
  return (
    readWtlLayerPointColor(def.styleName, '') ||
    readWtlLayerLineColor(def.styleName, def.fallbackColor)
  );
}

function buildExtentEnv3857(params: ExtentParams): {
  ok: true;
  env3857: string;
  x: number;
  y: number;
  radiusM: number;
} | { ok: false; error: string } {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const inputSrid = Number(params?.srid) > 0 ? Number(params.srid) : 3857;
  const radiusM = Math.max(1, Math.min(2000, Number(params?.radiusM) || 10));

  const polyRaw = Array.isArray(params?.polygon3857) ? params.polygon3857 : null;
  const polyPts: [number, number][] = [];
  if (polyRaw) {
    for (const p of polyRaw) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const px = Number(p[0]);
      const py = Number(p[1]);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      polyPts.push([px, py]);
    }
  }
  const usePolygon = polyPts.length >= 3;
  if (!usePolygon && (!Number.isFinite(x) || !Number.isFinite(y))) {
    return { ok: false, error: '중심 좌표가 올바르지 않습니다' };
  }

  const cyForLat = usePolygon
    ? polyPts.reduce((s, p) => s + p[1], 0) / polyPts.length
    : y;
  let meterToProj = 1;
  if (inputSrid === 3857) {
    const latRad = 2 * Math.atan(Math.exp(cyForLat / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }

  let env3857: string;
  if (usePolygon) {
    const ring = [...polyPts];
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    const wkt = `POLYGON((${ring.map(([px, py]) => `${px} ${py}`).join(',')}))`;
    env3857 = `ST_MakeValid(ST_GeomFromText('${wkt}', 3857))`;
  } else {
    const half = radiusM * meterToProj;
    env3857 = `ST_MakeEnvelope(${x - half}, ${y - half}, ${x + half}, ${y + half}, 3857)`;
  }
  return {
    ok: true,
    env3857,
    x: usePolygon ? polyPts.reduce((s, p) => s + p[0], 0) / polyPts.length : x,
    y: cyForLat,
    radiusM,
  };
}

/**
 * LINE 레이어(wtl_pipe_lm 제외 폐관·급수 등) 범위 조회.
 * wtl_pipe_lm 은 getWtlPipesInExtent 위임.
 * 심도: CrossSectionController 폴백 + 꼭짓점별 최근접 pip_dep.
 */
export async function getWtlLineLayerInExtent(
  params: ExtentParams & { table?: string }
): Promise<{ success: boolean; pipes: WtlPipeInExtent[]; error?: string }> {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) {
    return { success: false, pipes: [], error: '레이어 테이블이 없습니다' };
  }
  if (table === 'wtl_pipe_lm') {
    return getWtlPipesInExtent(params);
  }

  const def = getWtlLayerShapeDef(table);
  if (!def || def.geom !== 'line') {
    return { success: false, pipes: [], error: `지원하지 않는 관로 레이어: ${table}` };
  }

  const extent = buildExtentEnv3857(params);
  if (!extent.ok) return { success: false, pipes: [], error: extent.error };

  const exists = await tableExists('layer', def.table);
  const meta = exists ? await getGeomMeta('layer', def.table) : null;
  if (!meta) {
    return { success: false, pipes: [], error: `${def.label}(${def.table}) 데이터가 없습니다` };
  }

  const labelCol = await resolveLayerColumnName(def.table, def.labelCols);
  const dipCol = await resolveLayerColumnName(def.table, def.diameterCols);
  const highCol = await resolveLayerColumnName(def.table, def.depthHighCols);
  const lowCol = await resolveLayerColumnName(def.table, def.depthLowCols);
  const depthCol = await resolveLayerColumnName(def.table, def.depthCols);
  const begCol = await resolveLayerColumnName(def.table, ['beg_dep', 'BEG_DEP']);
  const endCol = await resolveLayerColumnName(def.table, ['end_dep', 'END_DEP']);
  const stdDepCol = await resolveLayerColumnName(def.table, ['std_dep', 'STD_DEP']);
  const depAvgCol = await resolveLayerColumnName(def.table, ['dep_avg', 'DEP_AVG']);

  const geomCol = `"${meta.geomCol.replace(/"/g, '""')}"`;
  const geom = geomStamped(geomCol, meta.srid);
  const from = `"layer"."${def.table.replace(/"/g, '""')}"`;
  const in3857 = `ST_Transform(${geom}, 3857)`;

  // wtl_pipe_lm 과 동일 — 최근접 wtl_pipe_ps.pip_dep (횡단면도 10m)
  let meterToProj = 1;
  {
    const latRad = 2 * Math.atan(Math.exp(extent.y / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  const depSearchProj = 10 * meterToProj;

  const psExists = await tableExists(PIPE_PS_SCHEMA, PIPE_PS_TABLE);
  const psMeta = psExists ? await getGeomMeta(PIPE_PS_SCHEMA, PIPE_PS_TABLE) : null;
  let nearestPipDepSql = 'NULL::double precision AS nearest_pip_dep';
  // 레거시: wtl_pipe_lm→wtl_pipe_ps. 급수·폐관도 동일 심도점이 범위에 있으면 사용
  if (psMeta) {
    const psGeomCol = `"${psMeta.geomCol.replace(/"/g, '""')}"`;
    const psGeom = geomStamped(psGeomCol, psMeta.srid);
    const psFrom = `"${PIPE_PS_SCHEMA.replace(/"/g, '""')}"."${PIPE_PS_TABLE.replace(/"/g, '""')}"`;
    const psIn3857 = `ST_Transform(${psGeom}, 3857)`;
    nearestPipDepSql = `(
         SELECT d.pip_dep::double precision
         FROM ${psFrom} d
         WHERE ${psGeomCol} IS NOT NULL
           AND d.pip_dep IS NOT NULL
           AND ST_DWithin(${psIn3857}, h.clip, ${depSearchProj})
         ORDER BY ${psIn3857} <-> h.clip
         LIMIT 1
       ) AS nearest_pip_dep`;
  }

  const hitSelect = [
    labelCol ? `${quoteIdent(labelCol)} AS pip_lbl` : `NULL::text AS pip_lbl`,
    dipCol ? `${quoteIdent(dipCol)} AS std_dip` : `NULL::double precision AS std_dip`,
    highCol ? `${quoteIdent(highCol)} AS hgh_dep` : `NULL::double precision AS hgh_dep`,
    lowCol ? `${quoteIdent(lowCol)} AS low_dep` : `NULL::double precision AS low_dep`,
    begCol ? `${quoteIdent(begCol)} AS beg_dep` : `NULL::double precision AS beg_dep`,
    endCol ? `${quoteIdent(endCol)} AS end_dep` : `NULL::double precision AS end_dep`,
    stdDepCol ? `${quoteIdent(stdDepCol)} AS std_dep` : `NULL::double precision AS std_dep`,
    depAvgCol ? `${quoteIdent(depAvgCol)} AS dep_avg` : `NULL::double precision AS dep_avg`,
    depthCol ? `${quoteIdent(depthCol)} AS lay_dep` : `NULL::double precision AS lay_dep`,
    `ST_CollectionExtract(
       ST_MakeValid(ST_Intersection(${in3857}, ${extent.env3857})),
       2
     ) AS clip`,
  ];

  try {
    const res = await db.execute(
      sql.raw(
        `WITH hits AS (
           SELECT
             ${hitSelect.join(',\n             ')}
           FROM ${from}
           WHERE ${geomCol} IS NOT NULL
             AND ST_Intersects(${in3857}, ${extent.env3857})
           LIMIT 300
         )
         SELECT
           h.pip_lbl,
           h.std_dip,
           h.hgh_dep,
           h.low_dep,
           h.beg_dep,
           h.end_dep,
           h.std_dep,
           h.dep_avg,
           h.lay_dep,
           ST_AsGeoJSON(h.clip) AS geojson,
           ${nearestPipDepSql}
         FROM hits h
         WHERE h.clip IS NOT NULL AND NOT ST_IsEmpty(h.clip)`
      )
    );

    const depthSamples = await fetchPipeDepthSamplesInEnv(
      extent.env3857,
      depSearchProj
    );

    const pipes: WtlPipeInExtent[] = [];
    const midPoints: [number, number][] = [];
    const layerColor = resolveLayerColor(def);
    for (const raw of res.rows ?? []) {
      const row = raw as {
        pip_lbl?: unknown;
        std_dip?: unknown;
        hgh_dep?: unknown;
        low_dep?: unknown;
        beg_dep?: unknown;
        end_dep?: unknown;
        std_dep?: unknown;
        dep_avg?: unknown;
        lay_dep?: unknown;
        nearest_pip_dep?: unknown;
        geojson?: string;
      };
      const coords = parseLineCoords3857(String(row.geojson ?? ''));
      if (coords.length < 2) continue;

      const depthM = resolveLegacyPipeDepthM(row, def.defaultDisplayDepthM);
      const depthsM = depthsAlongCoords(coords, depthSamples, depSearchProj, depthM);

      const labelRaw = row.pip_lbl != null ? String(row.pip_lbl).trim() : '';
      const mid = coords[Math.floor(coords.length / 2)]!;
      midPoints.push(mid);
      pipes.push({
        id: `${def.table}-${pipes.length}`,
        label: labelRaw || undefined,
        color: layerColor,
        coords3857: coords,
        diameterM: Math.max(0.02, parseStdDipToMeters(row.std_dip)),
        depthM,
        depthsM,
      });
    }

    try {
      const surfaces = await fetchSurfaceElevIdwAtPoints3857(midPoints);
      for (let i = 0; i < pipes.length; i++) {
        const elev = surfaces[i];
        if (elev != null) pipes[i].surfaceElevM = elev;
      }
    } catch {
      /* ignore */
    }

    return { success: true, pipes };
  } catch (e) {
    return {
      success: false,
      pipes: [],
      error: e instanceof Error ? e.message : `${def.label} 조회 오류`,
    };
  }
}

/**
 * POINT 레이어(맨홀·밸브·심도점 등) 범위 조회.
 */
export async function getWtlPointLayerInExtent(
  params: ExtentParams & { table?: string }
): Promise<{ success: boolean; manholes: WtlManholeInExtent[]; error?: string }> {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) {
    return { success: false, manholes: [], error: '레이어 테이블이 없습니다' };
  }

  const def = getWtlLayerShapeDef(table);
  if (!def || def.geom !== 'point_std') {
    return { success: false, manholes: [], error: `지원하지 않는 점 레이어: ${table}` };
  }

  if (table === 'wtl_manh_ps') {
    return getWtlManholesInExtent(params);
  }

  const extent = buildExtentEnv3857(params);
  if (!extent.ok) return { success: false, manholes: [], error: extent.error };

  const exists = await tableExists('layer', def.table);
  const meta = exists ? await getGeomMeta('layer', def.table) : null;
  if (!meta) {
    return {
      success: false,
      manholes: [],
      error: `${def.label}(${def.table}) 데이터가 없습니다`,
    };
  }

  const labelCol = await resolveLayerColumnName(def.table, def.labelCols);
  const dipCol = await resolveLayerColumnName(def.table, def.diameterCols);
  const depthCol = await resolveLayerColumnName(def.table, def.depthCols);
  const styleCodeCol = await resolveLayerColumnName(def.table, [
    'FTR_CDE',
    'ftr_cde',
    'HOM_CDE',
    'hom_cde',
  ]);

  const geomCol = `"${meta.geomCol.replace(/"/g, '""')}"`;
  const geom = geomStamped(geomCol, meta.srid);
  const from = `"layer"."${def.table.replace(/"/g, '""')}"`;
  const in3857 = `ST_Transform(${geom}, 3857)`;

  const selectParts = [
    labelCol ? `${quoteIdent(labelCol)} AS ftr_idn` : `NULL::text AS ftr_idn`,
    dipCol ? `${quoteIdent(dipCol)} AS man_std` : `NULL::text AS man_std`,
    depthCol
      ? `${quoteIdent(depthCol)} AS pip_dep`
      : `NULL::double precision AS pip_dep`,
    styleCodeCol
      ? `${quoteIdent(styleCodeCol)} AS style_code`
      : `NULL::text AS style_code`,
    `ST_AsGeoJSON(${in3857}) AS geojson`,
  ];

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ${selectParts.join(',\n           ')}
         FROM ${from}
         WHERE ${geomCol} IS NOT NULL
           AND ST_Intersects(${in3857}, ${extent.env3857})
         LIMIT 500`
      )
    );

    const manholes: WtlManholeInExtent[] = [];
    const pts: [number, number][] = [];
    const layerColor = resolveLayerColor(def);
    for (const raw of res.rows ?? []) {
      const row = raw as {
        ftr_idn?: unknown;
        man_std?: unknown;
        pip_dep?: unknown;
        style_code?: unknown;
        geojson?: string;
      };
      const xy = parsePointCoords3857(String(row.geojson ?? ''));
      if (!xy) continue;

      const diameterM = dipCol
        ? Math.max(0.08, parseManStdToMeters(row.man_std))
        : def.defaultDiameterM;

      // 점형 시설(변류·소방 등)은 단면도에서 지표 표기 — 심도 컬럼·기본심도 미사용
      let depthM = 0;
      if (!def.fromGround) {
        depthM = def.defaultDisplayDepthM;
        const d = parseDepthMeters(row.pip_dep);
        if (d != null) depthM = Math.max(0, d);
      }

      const labelRaw = row.ftr_idn != null ? String(row.ftr_idn).trim() : '';
      const styleCode =
        row.style_code != null ? String(row.style_code).trim().toUpperCase() : '';

      pts.push(xy);
      manholes.push({
        id: `${def.table}-${manholes.length}`,
        label: labelRaw || undefined,
        color: layerColor,
        x3857: xy[0],
        y3857: xy[1],
        diameterM,
        depthM,
        styleCode: styleCode || undefined,
      });
    }

    try {
      const surfaces = await fetchSurfaceElevIdwAtPoints3857(pts);
      for (let i = 0; i < manholes.length; i++) {
        const elev = surfaces[i];
        if (elev != null) manholes[i].surfaceElevM = elev;
      }
    } catch {
      /* ignore */
    }

    return { success: true, manholes };
  } catch (e) {
    return {
      success: false,
      manholes: [],
      error: e instanceof Error ? e.message : `${def.label} 조회 오류`,
    };
  }
}

export type ElevationAlongPoint = {
  distM: number;
  elevM: number;
  x3857: number;
  y3857: number;
};

/** 라인 좌표를 거리 비율로 샘플링 (EPSG:3857, 지표 m 근사) */
function sampleCoordsAlongLine3857(
  coords: [number, number][],
  sampleCount: number
): ElevationAlongPoint[] {
  if (coords.length < 2) return [];
  const n = Math.max(2, Math.min(80, Math.floor(sampleCount) || 24));
  const midY = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  let meterToProj = 1;
  {
    const latRad = 2 * Math.atan(Math.exp(midY / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i]![0] - coords[i - 1]![0];
    const dy = coords[i]![1] - coords[i - 1]![1];
    const len = Math.hypot(dx, dy) / meterToProj;
    segLens.push(len);
    total += len;
  }
  const out: ElevationAlongPoint[] = [];
  for (let i = 0; i < n; i++) {
    const target = total * (i / (n - 1));
    let walked = 0;
    let x = coords[0]![0];
    let y = coords[0]![1];
    for (let s = 0; s < segLens.length; s++) {
      const len = segLens[s]!;
      if (walked + len >= target || s === segLens.length - 1) {
        const t = len > 0 ? Math.min(1, (target - walked) / len) : 0;
        x = coords[s]![0] + (coords[s + 1]![0] - coords[s]![0]) * t;
        y = coords[s]![1] + (coords[s + 1]![1] - coords[s]![1]) * t;
        break;
      }
      walked += len;
    }
    out.push({ distM: target, elevM: NaN, x3857: x, y3857: y });
  }
  return out;
}

/**
 * 절단선(EPSG:3857)을 따라 등고 보간 고도 샘플.
 * 관망조회 횡·종단면도 지반고용.
 */
export async function getElevationAlongLine(params: {
  coords3857?: [number, number][] | number[][];
  sampleCount?: number;
}): Promise<{
  success: boolean;
  points: ElevationAlongPoint[];
  totalLengthM: number;
  error?: string;
}> {
  const raw = Array.isArray(params?.coords3857) ? params.coords3857 : [];
  const coords: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y]);
  }
  if (coords.length < 2) {
    return { success: false, points: [], totalLengthM: 0, error: '라인이 올바르지 않습니다' };
  }

  const elevExists = await tableExists(ELEVATION_SCHEMA, ELEVATION_TABLE);
  if (!elevExists) {
    return { success: false, points: [], totalLengthM: 0, error: '고도 관련 데이터가 없습니다' };
  }

  const samples = sampleCoordsAlongLine3857(coords, Number(params?.sampleCount) || 24);
  if (!samples.length) {
    return { success: false, points: [], totalLengthM: 0, error: '샘플을 만들지 못했습니다' };
  }

  try {
    const elevs = await fetchSurfaceElevIdwAtPoints3857(
      samples.map((s) => [s.x3857, s.y3857] as [number, number])
    );
    const points: ElevationAlongPoint[] = [];
    for (let i = 0; i < samples.length; i++) {
      const elev = elevs[i];
      if (elev == null || !Number.isFinite(elev)) continue;
      points.push({ ...samples[i]!, elevM: elev });
    }
    if (!points.length) {
      return { success: false, points: [], totalLengthM: 0, error: '라인 위 고도를 읽지 못했습니다' };
    }
    return {
      success: true,
      points,
      totalLengthM: samples[samples.length - 1]?.distM ?? 0,
    };
  } catch (e) {
    return {
      success: false,
      points: [],
      totalLengthM: 0,
      error: e instanceof Error ? e.message : '라인 고도 조회 오류',
    };
  }
}

/**
 * 관망조회 단면도 — 절단선 버퍼 내 관로·점시설 + 라인 등고.
 */
/** 단면도 — 절단선 위치의 급수구역·분구·블록 명칭 */
export type WtlSectionSupplyAreas = {
  zoneName: string | null;
  subzoneName: string | null;
  blockName: string | null;
};

type SupplyAreaRole = 'zone' | 'subzone' | 'block';

function supplyAreaRoleOfTable(table: string): SupplyAreaRole | null {
  const t = String(table ?? '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (t === 'wtl_wtsba_as' || t.endsWith('_wtl_wtsba_as')) return 'block';
  if (t === 'wtl_wtssa_as' || t.endsWith('_wtl_wtssa_as')) return 'subzone';
  if (t === 'wtl_wtsa_as' || t.endsWith('_wtl_wtsa_as')) return 'zone';
  return null;
}

function supplyAreaNameColumn(role: SupplyAreaRole): string {
  if (role === 'zone') return 'wsg_nam';
  if (role === 'subzone') return 'wsb_nam';
  return 'wbb_nam';
}

/** 단면도 X축 하단 — 급수구역·분구·블록 구간 밴드 */
export type WtlSectionSupplyBandSegment = {
  role: SupplyAreaRole;
  /** 표시명 (구역/분구/블록명) */
  name: string;
  fromM: number;
  toM: number;
  /** 레이어 stroke 색 */
  color: string;
};

/** 종단 — 표고별 구역·분구·블록 구성 비율(띠 격자 2D 집계) */
export type WtlSectionSupplyElevSeg = {
  name: string;
  color: string;
  pct: number;
};
export type WtlSectionSupplyElevRow = {
  elevM: number;
  role: SupplyAreaRole;
  segs: WtlSectionSupplyElevSeg[];
};

function supplyElevStepsOf(ymin: number, ymax: number): number[] {
  const lo = Math.min(ymin, ymax);
  const hi = Math.max(ymin, ymax);
  const span = Math.max(hi - lo, 1);
  const step = span > 40 ? 10 : span > 20 ? 5 : span > 10 ? 2 : 1;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let e = start; e <= hi + 1e-6; e += step) out.push(Number(e.toFixed(4)));
  if (!out.length) {
    out.push(Number(lo.toFixed(2)), Number(hi.toFixed(2)));
  }
  return out;
}

/** 격자 점마다 급수 폴리곤 명칭 1건 */
async function lookupSupplyNamesAtPoints3857(
  pts: [number, number][],
  table: string,
  nameCol: string,
  geomCol: string,
  srid: number
): Promise<(string | null)[]> {
  const out: (string | null)[] = pts.map(() => null);
  if (!pts.length) return out;
  const valuesSql = pts
    .map(
      (p, idx) =>
        `(${idx}::integer, ${p[0]}::double precision, ${p[1]}::double precision)`
    )
    .join(',\n');
  const safeTable = table.replace(/"/g, '""');
  const safeGeom = geomCol.replace(/"/g, '""');
  const safeName = nameCol.replace(/"/g, '""');
  try {
    const res = await db.execute(
      sql.raw(
        `WITH pts AS (
           SELECT * FROM (VALUES ${valuesSql}) AS t(idx, x, y)
         )
         SELECT p.idx,
                NULLIF(trim(hit.nam::text), '') AS nam
         FROM pts p
         LEFT JOIN LATERAL (
           SELECT t."${safeName}" AS nam
           FROM layer."${safeTable}" t
           WHERE t."${safeGeom}" IS NOT NULL
             AND ST_Intersects(
               ${geomStamped(`t."${safeGeom}"`, srid)},
               ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${srid})
             )
           ORDER BY ST_Distance(
             ${geomStamped(`t."${safeGeom}"`, srid)},
             ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${srid})
           )
           LIMIT 1
         ) hit ON true
         ORDER BY p.idx`
      )
    );
    for (const raw of res.rows ?? []) {
      const row = raw as { idx?: number; nam?: string | null };
      const idx = Number(row.idx);
      if (!Number.isFinite(idx) || idx < 0 || idx >= out.length) continue;
      const nam = String(row.nam ?? '').trim();
      out[idx] = nam || null;
    }
  } catch {
    /* keep nulls */
  }
  return out;
}

/**
 * 종단 띠(깊이×절단방향) 격자에서 표고 e 이상인 칸만 모아
 * 구역·분구·블록 명칭 비율을 계산.
 */
async function buildSupplyElevCompositionFromGrid(params: {
  queryPts: [number, number][];
  elevs: (number | null)[];
  elevMin: number;
  elevMax: number;
  supplyAreaTables: string[];
}): Promise<WtlSectionSupplyElevRow[]> {
  const { queryPts, elevs, supplyAreaTables } = params;
  if (!queryPts.length || queryPts.length !== elevs.length) return [];
  const elevSteps = supplyElevStepsOf(params.elevMin, params.elevMax);
  if (!elevSteps.length) return [];

  const out: WtlSectionSupplyElevRow[] = [];
  const seenRole = new Set<SupplyAreaRole>();
  for (const rawTable of supplyAreaTables) {
    const table = String(rawTable ?? '')
      .trim()
      .toLowerCase();
    const role = supplyAreaRoleOfTable(table);
    if (!role || seenRole.has(role)) continue;
    seenRole.add(role);
    if (!(await tableExists('layer', table))) continue;
    const meta = await getGeomMeta('layer', table);
    if (!meta) continue;
    const names = await lookupSupplyNamesAtPoints3857(
      queryPts,
      table,
      supplyAreaNameColumn(role),
      meta.geomCol,
      meta.srid
    );
    const color = readWtlLayerLineColor(table, '#888888');
    for (const elevM of elevSteps) {
      const acc = new Map<string, number>();
      let total = 0;
      for (let i = 0; i < elevs.length; i++) {
        const e = elevs[i];
        if (e == null || !Number.isFinite(e) || e < elevM - 1e-6) continue;
        const nam = names[i];
        if (!nam) continue;
        total += 1;
        acc.set(nam, (acc.get(nam) ?? 0) + 1);
      }
      if (total < 1) continue;
      const segs = [...acc.entries()]
        .map(([name, n]) => ({
          name,
          color,
          pct: (n / total) * 100,
        }))
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'ko'));
      if (!segs.length) continue;
      out.push({ elevM, role, segs });
    }
  }
  out.sort((a, b) => a.elevM - b.elevM || a.role.localeCompare(b.role));
  return out;
}

/**
 * 샘플 점열을 따라 급수구역·분구·블록 연속 구간 조회.
 * 동일 명칭이 이어지면 하나의 세그먼트로 병합.
 */
async function lookupSupplyAreaBandsAlongSamples(
  samples: { distM: number; x3857: number; y3857: number }[],
  supplyAreaTables: string[]
): Promise<WtlSectionSupplyBandSegment[]> {
  const out: WtlSectionSupplyBandSegment[] = [];
  if (samples.length < 1 || supplyAreaTables.length === 0) return out;

  const pts = samples.filter(
    (s) =>
      Number.isFinite(s.distM) &&
      Number.isFinite(s.x3857) &&
      Number.isFinite(s.y3857)
  );
  if (!pts.length) return out;

  const valuesSql = pts
    .map(
      (p, idx) =>
        `(${idx}::integer, ${p.distM}::double precision, ${p.x3857}::double precision, ${p.y3857}::double precision)`
    )
    .join(',\n');

  const seenRole = new Set<SupplyAreaRole>();
  for (const rawTable of supplyAreaTables) {
    const table = String(rawTable ?? '')
      .trim()
      .toLowerCase();
    const role = supplyAreaRoleOfTable(table);
    if (!role || seenRole.has(role)) continue;
    seenRole.add(role);
    if (!(await tableExists('layer', table))) continue;
    const meta = await getGeomMeta('layer', table);
    if (!meta) continue;
    const nameCol = supplyAreaNameColumn(role);
    const safeTable = table.replace(/"/g, '""');
    const safeGeom = meta.geomCol.replace(/"/g, '""');
    const safeName = nameCol.replace(/"/g, '""');
    const srid = meta.srid;
    const color = readWtlLayerLineColor(table, '#888888');

    try {
      const res = await db.execute(
        sql.raw(
          `WITH pts AS (
             SELECT * FROM (VALUES ${valuesSql}) AS t(idx, dist_m, x, y)
           )
           SELECT p.idx, p.dist_m,
                  NULLIF(trim(hit.nam::text), '') AS nam
           FROM pts p
           LEFT JOIN LATERAL (
             SELECT t."${safeName}" AS nam
             FROM layer."${safeTable}" t
             WHERE t."${safeGeom}" IS NOT NULL
               AND ST_Intersects(
                 ${geomStamped(`t."${safeGeom}"`, srid)},
                 ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${srid})
               )
             ORDER BY ST_Distance(
               ${geomStamped(`t."${safeGeom}"`, srid)},
               ST_Transform(ST_SetSRID(ST_MakePoint(p.x, p.y), 3857), ${srid})
             )
             LIMIT 1
           ) hit ON true
           ORDER BY p.idx`
        )
      );

      type Row = { idx?: number; dist_m?: number; nam?: string | null };
      const rows = (res.rows ?? []) as Row[];
      let cur: { name: string; fromM: number; toM: number } | null = null;
      const flush = () => {
        if (!cur || !cur.name) return;
        out.push({
          role,
          name: cur.name,
          fromM: cur.fromM,
          toM: Math.max(cur.fromM, cur.toM),
          color,
        });
        cur = null;
      };
      for (const row of rows) {
        const dist = Number(row.dist_m);
        const nam = String(row.nam ?? '').trim();
        if (!Number.isFinite(dist)) continue;
        if (!nam) {
          flush();
          continue;
        }
        if (!cur) {
          cur = { name: nam, fromM: dist, toM: dist };
        } else if (cur.name === nam) {
          cur.toM = dist;
        } else {
          flush();
          cur = { name: nam, fromM: dist, toM: dist };
        }
      }
      flush();
    } catch {
      /* skip table */
    }
  }

  // 점 샘플이면 최소 폭 부여 (절단선 스타일 보이게)
  for (const seg of out) {
    if (seg.toM - seg.fromM < 0.05) {
      const mid = (seg.fromM + seg.toM) / 2;
      seg.fromM = mid - 0.25;
      seg.toM = mid + 0.25;
    }
  }
  return out;
}

/**
 * 절단선 중점에서 켜진 급수구역·분구·블록 명칭 조회.
 */
async function lookupSupplyAreasAtLineMid(
  coords: [number, number][],
  supplyAreaTables: string[]
): Promise<WtlSectionSupplyAreas> {
  const out: WtlSectionSupplyAreas = {
    zoneName: null,
    subzoneName: null,
    blockName: null,
  };
  if (coords.length < 2 || supplyAreaTables.length === 0) return out;

  const midIdx = Math.floor((coords.length - 1) / 2);
  const a = coords[midIdx]!;
  const b = coords[Math.min(midIdx + 1, coords.length - 1)]!;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return out;

  const seenRole = new Set<SupplyAreaRole>();
  for (const rawTable of supplyAreaTables) {
    const table = String(rawTable ?? '')
      .trim()
      .toLowerCase();
    const role = supplyAreaRoleOfTable(table);
    if (!role || seenRole.has(role)) continue;
    seenRole.add(role);
    if (!(await tableExists('layer', table))) continue;
    const meta = await getGeomMeta('layer', table);
    if (!meta) continue;
    const nameCol = supplyAreaNameColumn(role);
    const safeTable = table.replace(/"/g, '""');
    const safeGeom = meta.geomCol.replace(/"/g, '""');
    const safeName = nameCol.replace(/"/g, '""');
    const srid = meta.srid;
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT NULLIF(trim(t."${safeName}"::text), '') AS nam
           FROM layer."${safeTable}" t
           WHERE t."${safeGeom}" IS NOT NULL
             AND ST_Intersects(
               ${geomStamped(`t."${safeGeom}"`, srid)},
               ST_Transform(ST_SetSRID(ST_MakePoint(${mx}, ${my}), 3857), ${srid})
             )
           ORDER BY ST_Distance(
             ${geomStamped(`t."${safeGeom}"`, srid)},
             ST_Transform(ST_SetSRID(ST_MakePoint(${mx}, ${my}), 3857), ${srid})
           )
           LIMIT 1`
        )
      );
      const nam = String(
        (res.rows?.[0] as { nam?: unknown } | undefined)?.nam ?? ''
      ).trim();
      if (!nam) continue;
      if (role === 'zone') out.zoneName = nam;
      else if (role === 'subzone') out.subzoneName = nam;
      else out.blockName = nam;
    } catch {
      /* skip table */
    }
  }
  return out;
}

/**
 * 종단(깊이축) — 절단선 중심 ±halfWidth 띠의 옆면 방향으로 표고 샘플.
 * distM: 0…2×halfWidth (절단선=halfWidth). groundMin/Max는 각 깊이에서 LINE 방향 격자 표고.
 */
async function sampleElevationAlongDepthAxis(params: {
  coords: [number, number][];
  halfWidthM: number;
  sampleCount?: number;
}): Promise<{
  success: boolean;
  ground: ElevationAlongPoint[];
  groundMin: ElevationAlongPoint[];
  groundMax: ElevationAlongPoint[];
  totalLengthM: number;
  /** 표고·급수 2D 집계용 격자 */
  gridPts?: [number, number][];
  gridElevs?: (number | null)[];
  error?: string;
}> {
  const coords = params.coords;
  let ax = coords[0]![0];
  let ay = coords[0]![1];
  let bx = coords[coords.length - 1]![0];
  let by = coords[coords.length - 1]![1];
  if (bx < ax || (bx === ax && by < ay)) {
    ;[ax, ay, bx, by] = [bx, by, ax, ay];
  }
  const midY = (ay + by) / 2;
  let meterToProj = 1;
  {
    const latRad = 2 * Math.atan(Math.exp(midY / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  let dx = bx - ax;
  let dy = by - ay;
  const lenProj = Math.hypot(dx, dy);
  if (lenProj < 1e-6) {
    return {
      success: false,
      ground: [],
      groundMin: [],
      groundMax: [],
      totalLengthM: 0,
      gridPts: [],
      gridElevs: [],
      error: '라인이 올바르지 않습니다',
    };
  }
  dx /= lenProj;
  dy /= lenProj;
  const perpX = -dy;
  const perpY = dx;
  const halfLenM = lenProj / meterToProj / 2;
  const halfWidthM = Math.max(1, params.halfWidthM);
  const depthSpanM = halfWidthM * 2;
  const midX = (ax + bx) / 2;
  const midY2 = (ay + by) / 2;

  const depthN = Math.max(3, Math.min(40, Math.floor(Number(params.sampleCount) || 24)));
  const alongN = Math.max(3, Math.min(16, Math.floor(halfLenM / 2) + 3));

  const queryPts: [number, number][] = [];
  /** depthIdx → along 샘플 시작 인덱스 */
  const rowStarts: number[] = [];
  for (let di = 0; di < depthN; di++) {
    rowStarts.push(queryPts.length);
    const vM = -halfWidthM + (depthSpanM * di) / (depthN - 1);
    for (let ai = 0; ai < alongN; ai++) {
      const uM = -halfLenM + ((2 * halfLenM) * ai) / (alongN - 1);
      const x = midX + dx * uM * meterToProj + perpX * vM * meterToProj;
      const y = midY2 + dy * uM * meterToProj + perpY * vM * meterToProj;
      queryPts.push([x, y]);
    }
  }

  const elevExists = await tableExists(ELEVATION_SCHEMA, ELEVATION_TABLE);
  if (!elevExists) {
    return {
      success: false,
      ground: [],
      groundMin: [],
      groundMax: [],
      totalLengthM: depthSpanM,
      gridPts: [],
      gridElevs: [],
      error: '고도 관련 데이터가 없습니다',
    };
  }

  try {
    const elevs = await fetchSurfaceElevIdwAtPoints3857(queryPts);
    const ground: ElevationAlongPoint[] = [];
    const groundMin: ElevationAlongPoint[] = [];
    const groundMax: ElevationAlongPoint[] = [];
    const midAlong = Math.floor((alongN - 1) / 2);
    const gridElevs: (number | null)[] = elevs.map((e) =>
      e != null && Number.isFinite(e) ? e : null
    );

    for (let di = 0; di < depthN; di++) {
      const distM = (depthSpanM * di) / (depthN - 1);
      const row0 = rowStarts[di]!;
      let minE = Infinity;
      let maxE = -Infinity;
      let midElev = NaN;
      let midX3857 = queryPts[row0 + midAlong]![0];
      let midY3857 = queryPts[row0 + midAlong]![1];

      for (let ai = 0; ai < alongN; ai++) {
        const elev = elevs[row0 + ai];
        if (elev == null || !Number.isFinite(elev)) continue;
        if (elev < minE) minE = elev;
        if (elev > maxE) maxE = elev;
        if (ai === midAlong) {
          midElev = elev;
          midX3857 = queryPts[row0 + ai]![0];
          midY3857 = queryPts[row0 + ai]![1];
        }
      }
      if (!Number.isFinite(minE) || !Number.isFinite(maxE)) continue;
      if (!Number.isFinite(midElev)) midElev = (minE + maxE) / 2;

      ground.push({ distM, elevM: midElev, x3857: midX3857, y3857: midY3857 });
      groundMin.push({
        distM,
        elevM: minE,
        x3857: midX3857,
        y3857: midY3857,
      });
      groundMax.push({
        distM,
        elevM: maxE,
        x3857: midX3857,
        y3857: midY3857,
      });
    }

    if (!ground.length) {
      return {
        success: false,
        ground: [],
        groundMin: [],
        groundMax: [],
        totalLengthM: depthSpanM,
        gridPts: queryPts,
        gridElevs,
        error: '깊이축 고도를 읽지 못했습니다',
      };
    }
    return {
      success: true,
      ground,
      groundMin,
      groundMax,
      totalLengthM: depthSpanM,
      gridPts: queryPts,
      gridElevs,
    };
  } catch (e) {
    return {
      success: false,
      ground: [],
      groundMin: [],
      groundMax: [],
      totalLengthM: depthSpanM,
      gridPts: [],
      gridElevs: [],
      error: e instanceof Error ? e.message : '깊이축 고도 조회 오류',
    };
  }
}

export async function getWtlNetworkSectionData(params: {
  coords3857?: [number, number][] | number[][];
  /** 종단·시설 조회용 사각형 깊이(m). 횡단 시설도 동일 버퍼 사용 */
  halfWidthM?: number;
  /**
   * along: 절단선 진행 거리 등고(횡단·기존).
   * depth: 옆면(깊이축) 등고 + min/max 격자(종단).
   */
  profileAxis?: 'along' | 'depth';
  sampleCount?: number;
  lineTables?: string[];
  pointTables?: string[];
  /** 켜진 급수구역·분구·블록 테이블(정의명) — 단면도 좌측 위치 표기용 */
  supplyAreaTables?: string[];
}): Promise<{
  success: boolean;
  ground: ElevationAlongPoint[];
  /** 종단(depth) — 깊이 스테이션별 격자 최소 표고 */
  groundMin?: ElevationAlongPoint[];
  /** 종단(depth) — 깊이 스테이션별 격자 최대 표고 */
  groundMax?: ElevationAlongPoint[];
  totalLengthM: number;
  pipes: WtlPipeInExtent[];
  points: WtlManholeInExtent[];
  polygon3857: [number, number][];
  supplyAreas: WtlSectionSupplyAreas;
  /** X축 하단 밴드 — 구역·분구·블록 구간(켜진 테이블만) */
  supplyAreaBands?: WtlSectionSupplyBandSegment[];
  /** 종단(depth) — 표고별 구역·분구·블록 구성 비율(띠 격자 2D) */
  supplyElevComposition?: WtlSectionSupplyElevRow[];
  error?: string;
}> {
  const raw = Array.isArray(params?.coords3857) ? params.coords3857 : [];
  const coords: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y]);
  }
  const emptySupply: WtlSectionSupplyAreas = {
    zoneName: null,
    subzoneName: null,
    blockName: null,
  };
  if (coords.length < 2) {
    return {
      success: false,
      ground: [],
      totalLengthM: 0,
      pipes: [],
      points: [],
      polygon3857: [],
      supplyAreas: emptySupply,
      error: '라인이 올바르지 않습니다',
    };
  }

  const halfWidthM = Math.max(1, Math.min(50, Number(params?.halfWidthM) || 5));
  const profileAxis = params?.profileAxis === 'depth' ? 'depth' : 'along';
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  const midY = (start[1] + end[1]) / 2;
  let meterToProj = 1;
  {
    const latRad = 2 * Math.atan(Math.exp(midY / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  let dx = end[0] - start[0];
  let dy = end[1] - start[1];
  const len = Math.hypot(dx, dy);
  const polygon3857: [number, number][] = [];
  if (len < 1e-6) {
    const h = halfWidthM * meterToProj;
    polygon3857.push(
      [start[0] - h, start[1] - h],
      [start[0] + h, start[1] - h],
      [start[0] + h, start[1] + h],
      [start[0] - h, start[1] + h],
      [start[0] - h, start[1] - h]
    );
  } else {
    dx /= len;
    dy /= len;
    const depthProj = halfWidthM * meterToProj;
    const ox = -dy * depthProj;
    const oy = dx * depthProj;
    // ThreeJs·지도 사각형과 동일 — 절단선 중심 ±halfWidth 띠
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (const c of coords) {
      left.push([c[0] + ox, c[1] + oy]);
      right.push([c[0] - ox, c[1] - oy]);
    }
    polygon3857.push(...left, ...right.reverse(), left[0]!);
  }

  const elevRes =
    profileAxis === 'depth'
      ? await sampleElevationAlongDepthAxis({
          coords,
          halfWidthM,
          sampleCount: params?.sampleCount,
        })
      : await getElevationAlongLine({
          coords3857: coords,
          sampleCount: params?.sampleCount,
        }).then((r) => ({
          success: r.success,
          ground: r.points,
          groundMin: [] as ElevationAlongPoint[],
          groundMax: [] as ElevationAlongPoint[],
          totalLengthM: r.totalLengthM,
          gridPts: [] as [number, number][],
          gridElevs: [] as (number | null)[],
          error: r.error,
        }));

  const lineTables = [
    ...new Set(
      (Array.isArray(params?.lineTables) ? params.lineTables : [])
        .map((t) => String(t ?? '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const pointTables = [
    ...new Set(
      (Array.isArray(params?.pointTables) ? params.pointTables : [])
        .map((t) => String(t ?? '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const pipes: WtlPipeInExtent[] = [];
  const points: WtlManholeInExtent[] = [];

  for (const table of lineTables) {
    const res = await getWtlLineLayerInExtent({
      polygon3857,
      table,
      srid: 3857,
    });
    if (res.success && res.pipes.length) pipes.push(...res.pipes);
  }
  for (const table of pointTables) {
    const res = await getWtlPointLayerInExtent({
      polygon3857,
      table,
      srid: 3857,
    });
    if (res.success && res.manholes.length) points.push(...res.manholes);
  }

  const supplyAreaTables = [
    ...new Set(
      (Array.isArray(params?.supplyAreaTables) ? params.supplyAreaTables : [])
        .map((t) => String(t ?? '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const supplyAreas =
    supplyAreaTables.length > 0
      ? await lookupSupplyAreasAtLineMid(coords, supplyAreaTables)
      : emptySupply;

  const bandSamples = (elevRes.ground ?? [])
    .filter(
      (p) =>
        Number.isFinite(p.distM) &&
        Number.isFinite(p.x3857) &&
        Number.isFinite(p.y3857)
    )
    .map((p) => ({
      distM: p.distM,
      x3857: p.x3857,
      y3857: p.y3857,
    }));
  const supplyAreaBands =
    supplyAreaTables.length > 0 && bandSamples.length > 0
      ? await lookupSupplyAreaBandsAlongSamples(bandSamples, supplyAreaTables)
      : [];

  let supplyElevComposition: WtlSectionSupplyElevRow[] = [];
  if (
    profileAxis === 'depth' &&
    supplyAreaTables.length > 0 &&
    (elevRes.gridPts?.length ?? 0) > 0 &&
    (elevRes.gridElevs?.length ?? 0) > 0
  ) {
    const elevPool = [
      ...(elevRes.groundMin ?? []).map((g) => g.elevM),
      ...(elevRes.groundMax ?? []).map((g) => g.elevM),
    ].filter((e) => Number.isFinite(e));
    const elevMin = elevPool.length ? Math.min(...elevPool) : 0;
    const elevMax = elevPool.length ? Math.max(...elevPool) : elevMin + 1;
    supplyElevComposition = await buildSupplyElevCompositionFromGrid({
      queryPts: elevRes.gridPts ?? [],
      elevs: elevRes.gridElevs ?? [],
      elevMin,
      elevMax,
      supplyAreaTables,
    });
  }

  if (!elevRes.success && !pipes.length && !points.length) {
    return {
      success: false,
      ground: [],
      groundMin: elevRes.groundMin,
      groundMax: elevRes.groundMax,
      totalLengthM: elevRes.totalLengthM || 0,
      pipes: [],
      points: [],
      polygon3857,
      supplyAreas,
      supplyAreaBands,
      supplyElevComposition,
      error: elevRes.error ?? '단면도 데이터를 만들지 못했습니다',
    };
  }

  return {
    success: true,
    ground: elevRes.ground,
    groundMin: profileAxis === 'depth' ? elevRes.groundMin : undefined,
    groundMax: profileAxis === 'depth' ? elevRes.groundMax : undefined,
    totalLengthM: elevRes.totalLengthM,
    pipes,
    points,
    polygon3857,
    supplyAreas,
    supplyAreaBands,
    supplyElevComposition:
      profileAxis === 'depth' ? supplyElevComposition : undefined,
    error: elevRes.success ? undefined : elevRes.error,
  };
}
