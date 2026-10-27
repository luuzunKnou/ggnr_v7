/**
 * 고도 측정 — public_layer.elevation 상·하 인접 등고 보간, 시군구(sgg) 범위 검사
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { readWtlPipeLmStrokeColor } from '@/lib/geoserverStyleFillColor';

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
   * 심도 m — 횡단면도(CrossSection)와 동일:
   * 관 라인 최근접 wtl_pipe_ps.pip_dep → (low_dep+hgh_dep)/2 → hgh_dep|low_dep
   */
  depthM: number;
  /** 지표 해발(m) — 관 중점 등고 상·하 보간(고도 측정과 동일) */
  surfaceElevM?: number;
};

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
 * 심도: 횡단면도(CrossSectionController)와 동일 —
 *   관마다 최근접 wtl_pipe_ps.pip_dep → (low_dep+hgh_dep)/2 → 단독 심도필드 → 기본 1.2m
 */
export async function getWtlPipesInExtent(params: {
  x?: number;
  y?: number;
  srid?: number;
  radiusM?: number;
}): Promise<{ success: boolean; pipes: WtlPipeInExtent[]; error?: string }> {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const inputSrid = Number(params?.srid) > 0 ? Number(params.srid) : 3857;
  const radiusM = Math.max(1, Math.min(2000, Number(params?.radiusM) || 10));

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { success: false, pipes: [], error: '중심 좌표가 올바르지 않습니다' };
  }

  const lmExists = await tableExists(PIPE_LM_SCHEMA, PIPE_LM_TABLE);
  const lmMeta = lmExists ? await getGeomMeta(PIPE_LM_SCHEMA, PIPE_LM_TABLE) : null;
  if (!lmMeta) {
    return { success: false, pipes: [], error: '상수관로(wtl_pipe_lm) 데이터가 없습니다' };
  }

  let meterToProj = 1;
  if (inputSrid === 3857) {
    const latRad = 2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2;
    const cosLat = Math.cos(latRad);
    if (Number.isFinite(cosLat) && cosLat >= 0.2) meterToProj = 1 / cosLat;
  }
  const half = radiusM * meterToProj;
  const minx = x - half;
  const maxx = x + half;
  const miny = y - half;
  const maxy = y + half;
  /** 횡단면도 DWithin 10m 와 동일 (3857 보정) */
  const depSearchProj = 10 * meterToProj;

  const lmGeomCol = `"${lmMeta.geomCol.replace(/"/g, '""')}"`;
  const lmGeom = geomStamped(lmGeomCol, lmMeta.srid);
  const lmFrom = `"${PIPE_LM_SCHEMA.replace(/"/g, '""')}"."${PIPE_LM_TABLE.replace(/"/g, '""')}"`;
  const env3857 = `ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 3857)`;
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
           ST_AsGeoJSON(h.clip) AS geojson,
           ${nearestPipDepSql}
         FROM hits h
         WHERE h.clip IS NOT NULL AND NOT ST_IsEmpty(h.clip)`
      )
    );

    const pipes: WtlPipeInExtent[] = [];
    const midPoints: [number, number][] = [];
    for (const raw of res.rows ?? []) {
      const row = raw as {
        pip_lbl?: unknown;
        saa_cde?: unknown;
        std_dip?: unknown;
        hgh_dep?: unknown;
        low_dep?: unknown;
        nearest_pip_dep?: unknown;
        geojson?: string;
      };
      const coords = parseLineCoords3857(String(row.geojson ?? ''));
      if (coords.length < 2) continue;

      // 1) 최근접 심도점 pip_dep  2) (low+hgh)/2  3) 단독 필드  4) 기본 1.2m
      let depthM = parseDepthMeters(row.nearest_pip_dep);
      if (depthM == null) {
        const low = parseDepthMeters(row.low_dep);
        const high = parseDepthMeters(row.hgh_dep);
        if (low != null && high != null) depthM = (low + high) / 2;
        else depthM = high ?? low;
      }
      if (depthM == null) depthM = 1.2;

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
