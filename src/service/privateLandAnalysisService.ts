import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { listJijukParcelsByGeomWkt5181 } from '@/service/layerRowService';
import { loadJijukOwnGbn } from '@/service/riverBasicPlanService';
import {
  findPrivateLandAnalysisLayer,
  privateLandAnalysisLayersFor,
  privateLandRangeMode,
  type PrivateLandAnalysisLayer,
  type PrivateLandRangeMode,
} from '@/lib/privateLandAnalysisLayers';

/** 분석 도형 계산 좌표계 (지적과 동일, 미터) */
const WORK_SRID = 5181;
/** 찍은 지점 주변에서 불러올 하천 면 반경(m) */
const BASE_RADIUS_M = 5000;
/**
 * 하천 도형 사이 틈 메움(m). 맞닿은 도형의 미세한 틈만 메운다.
 * 크게 잡으면 구역 레이어의 좁은 오목부·삼각형 틈까지 메워져 레이어 모양과 달라진다.
 */
const GAP_CLOSE_M = 0.05;
/** 절단선 끝이 경계에 살짝 못 미쳐도 자르도록 양끝 연장(m) — 합류부·굴곡에서 잘림이 끊기지 않게 */
const LINE_END_MARGIN_M = 50;
/** 자르기 전 도형 꼭짓점을 절단선에 붙이는 거리(m). 크면 선 근처 레이어 모서리가 끌려가 모양이 바뀐다 */
const CUT_SNAP_M = 0.01;
/** 접선 판정 — 선이 도형 경계에서 이 거리 안에 놓인 비율(m, 비율) */
const SEAM_LINE_TOL_M = 1;
const SEAM_LINE_COVER = 0.8;
/** 접선 위 시작·끝선은 옆 하천을 자르지 않도록 조금만 연장(m) */
const SEAM_LINE_MARGIN_M = 2;
/** 지류 끝선 — 하천을 가로지른 토막을 면 밖으로 살짝 더 내밀어 확실히 자름(m) */
const TRIB_CUT_OVERSHOOT_M = 1;
/** 시작·끝선 — 하천 도형 사이 이 거리 이하 틈은 이어진 것으로 보고 자른다(m) */
const CHORD_GAP_BRIDGE_M = 1.5;
const PARCEL_LIMIT = 1000;

type Geo = Record<string, unknown>;

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 같은 하천 판별 컬럼 — 앞쪽 우선 */
const RIVER_KEY_COLUMNS = ['river_code', 'river_name'] as const;
type RiverKeyColumn = (typeof RIVER_KEY_COLUMNS)[number];

/** 같은 하천(본류)만 남기는 조건. 지류는 하천코드·하천명이 달라 제외된다 */
export type PrivateLandRiverKey = { field: RiverKeyColumn; value: string };

type Target = { qualified: string; srid: number; riverCols: RiverKeyColumn[]; mode: PrivateLandRangeMode };

const DEFAULT_LAYER_SCHEMA = 'layer';

function riverWhereSql(target: Target, key: unknown): string {
  const k = key as Partial<PrivateLandRiverKey> | null | undefined;
  const field = String(k?.field ?? '') as RiverKeyColumn;
  const value = String(k?.value ?? '').trim();
  if (!value || !target.riverCols.includes(field)) return '';
  return ` AND TRIM(f.${quoteIdent(field)}::text) = '${esc(value)}'`;
}

/** 설정된 스키마의 실제 테이블명 + 도형 SRID. 허용 레이어가 아니거나 없으면 null */
async function resolveTarget(layer: unknown): Promise<Target | null> {
  const def = findPrivateLandAnalysisLayer(String(layer ?? ''));
  if (!def) return null;
  const schema = def.schema ?? DEFAULT_LAYER_SCHEMA;
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = '${esc(schema)}' AND lower(table_name) = '${esc(def.table)}'
       LIMIT 1`
    )
  );
  const name = String((res.rows?.[0] as { table_name?: string } | undefined)?.table_name ?? '').trim();
  if (!name) return null;
  const qualified = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const sridRes = await db.execute(
    sql.raw(`SELECT ST_SRID(geom) AS srid FROM ${qualified} WHERE geom IS NOT NULL LIMIT 1`)
  );
  const srid = toNum((sridRes.rows?.[0] as { srid?: unknown } | undefined)?.srid) || WORK_SRID;
  const colRes = await db.execute(
    sql.raw(
      `SELECT lower(column_name) AS c
       FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(name)}'
         AND lower(column_name) IN (${RIVER_KEY_COLUMNS.map((c) => `'${c}'`).join(',')})`
    )
  );
  const found = new Set((colRes.rows ?? []).map((r) => String((r as { c?: string }).c ?? '')));
  const riverCols = RIVER_KEY_COLUMNS.filter((c) => found.has(c));
  return { qualified, srid, riverCols, mode: privateLandRangeMode(def) };
}

/** 선택 가능한 분석 대상 레이어 (DB에 테이블이 있는 것만) */
export async function listPrivateLandAnalysisLayers(params?: {
  system?: string;
}): Promise<{ layers: PrivateLandAnalysisLayer[] }> {
  const candidates = privateLandAnalysisLayersFor(params?.system);
  if (candidates.length === 0) return { layers: [] };
  const pairs = candidates
    .map((l) => `('${esc(l.schema ?? DEFAULT_LAYER_SCHEMA)}', '${esc(l.table)}')`)
    .join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema AS s, lower(table_name) AS t
       FROM information_schema.tables
       WHERE (table_schema, lower(table_name)) IN (${pairs})`
    )
  );
  const found = new Set(
    (res.rows ?? []).map((r) => {
      const row = r as { s?: string; t?: string };
      return `${row.s ?? ''}.${row.t ?? ''}`;
    })
  );
  return { layers: candidates.filter((l) => found.has(`${l.schema ?? DEFAULT_LAYER_SCHEMA}.${l.table}`)) };
}

/** 화면 범위 레이어 도형 조회 상한 — 이보다 넓으면 커서 구분 생략(m) */
const VIEW_MAX_SPAN_M = 30000;

/**
 * 시작 위치 찍기 전 커서 구분용 — 현재 화면 범위 안 레이어 면(EPSG:3857 GeoJSON, 화면 해상도로 단순화).
 * 하천은 화면이 너무 넓으면 tooLarge. 닫힌 범위(도로)는 줌과 상관없이 합친 면을 돌려준다.
 */
export async function getPrivateLandAnalysisLayerView(params?: {
  layer?: string;
  bbox?: number[];
  tolerance?: number;
}): Promise<{ geometry3857?: Geo | null; seams3857?: Geo | null; tooLarge?: boolean; error?: string }> {
  const bbox = Array.isArray(params?.bbox) ? params.bbox.map(toNum) : [];
  if (bbox.length !== 4 || bbox.some((v) => v == null)) return { error: '범위가 없습니다.' };
  const [x1, y1, x2, y2] = bbox as number[];
  const tolerance = Math.max(0, toNum(params?.tolerance) ?? 0);
  const target = await resolveTarget(params?.layer);
  if (!target) return { error: '분석할 수 없는 레이어입니다.' };
  const { qualified, srid, mode } = target;
  if (mode !== 'closed' && (x2 - x1 > VIEW_MAX_SPAN_M || y2 - y1 > VIEW_MAX_SPAN_M)) return { tooLarge: true };
  if (mode !== 'closed' && x2 - x1 <= VIEW_SEAM_MAX_SPAN_M && y2 - y1 <= VIEW_SEAM_MAX_SPAN_M) {
    const withSeams = await loadViewWithSeams(target, [x1, y1, x2, y2], tolerance);
    if (withSeams) return withSeams;
  }
  /** 닫힌 범위 — 넓은 화면에서도 가볍도록 화면 해상도 절반으로 먼저 단순화한 뒤 통짜 면으로 합침 */
  const featTol = tolerance / 2;
  const collect =
    mode === 'closed'
      ? `ST_UnaryUnion(ST_Collect(ST_Intersection(ST_MakeValid(ST_SimplifyPreserveTopology(f.geom, ${featTol})), e.g)))`
      : `ST_Collect(ST_Intersection(ST_MakeValid(f.geom), e.g))`;

  try {
    const res = await db.execute(
      sql.raw(
        `WITH env AS (SELECT ST_Transform(ST_MakeEnvelope(${x1}, ${y1}, ${x2}, ${y2}, 3857), ${srid}) AS g),
         src AS (
           SELECT ST_CollectionExtract(
             ST_MakeValid(ST_SimplifyPreserveTopology(ST_Transform(${collect}, 3857), ${tolerance})),
             3
           ) AS g
           FROM ${qualified} f, env e
           WHERE f.geom IS NOT NULL AND f.geom && e.g AND ST_Intersects(f.geom, e.g)
         )
         SELECT CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(g)::json END AS geometry3857
         FROM src`
      )
    );
    const row = res.rows?.[0] as { geometry3857?: Geo | null } | undefined;
    return { geometry3857: row?.geometry3857 && typeof row.geometry3857 === 'object' ? row.geometry3857 : null };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** 바깥 경계에서 이만큼 떨어진 도형 경계만 안쪽 접선으로 본다(m) */
const SEAM_OUTER_M = 0.3;
/** 이보다 짧은 접선 토막만 버림 — 이웃 도형 꼭짓점이 어긋나 생긴 짧은 토막도 접선을 잇는 데 필요 */
const SEAM_MIN_LEN_M = 0.05;
/** 화면이 이보다 좁으면 시작 위치 미리보기용 합친 면·접선을 함께 내려준다(m) */
const VIEW_SEAM_MAX_SPAN_M = 5000;

/**
 * 화면 범위 하천 — 틈 메워 합친 면과 도형끼리 맞닿은 선(접선).
 * 시작 위치 미리보기가 접선에 맞추고, 도형 경계가 아닌 하천 바깥 경계로 폭 방향 선을 잡게 한다. 실패하면 null.
 */
async function loadViewWithSeams(
  target: Target,
  bbox: [number, number, number, number],
  tolerance: number
): Promise<{ geometry3857: Geo | null; seams3857: Geo | null } | null> {
  const { qualified, srid } = target;
  const [x1, y1, x2, y2] = bbox;
  try {
    const res = await db.execute(
      sql.raw(
        `WITH env AS (SELECT ST_Transform(ST_MakeEnvelope(${x1}, ${y1}, ${x2}, ${y2}, 3857), ${WORK_SRID}) AS g),
         feats AS (
           SELECT ST_CollectionExtract(ST_MakeValid(ST_Intersection(ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID})), e.g)), 3) AS g
           FROM ${qualified} f, env e
           WHERE f.geom IS NOT NULL
             AND f.geom && ST_Transform(e.g, ${srid})
             AND ST_Intersects(f.geom, ST_Transform(e.g, ${srid}))
         ),
         merged AS (
           SELECT ST_CollectionExtract(
             ST_MakeValid(ST_Buffer(ST_Buffer(ST_UnaryUnion(ST_Collect(g)), ${GAP_CLOSE_M}), -${GAP_CLOSE_M})),
             3
           ) AS g
           FROM feats
         ),
         seam_raw AS (
           SELECT ST_LineMerge(ST_CollectionExtract(ST_Difference(
             (SELECT ST_UnaryUnion(ST_Collect(ST_Boundary(g))) FROM feats),
             ST_Buffer(ST_Boundary(m.g), ${SEAM_OUTER_M})
           ), 2)) AS g
           FROM merged m
         ),
         seams AS (
           SELECT ST_Collect(d.geom) AS g
           FROM seam_raw r, LATERAL ST_Dump(r.g) AS d
           WHERE ST_Length(d.geom) > ${SEAM_MIN_LEN_M}
         )
         SELECT
           CASE WHEN m.g IS NULL OR ST_IsEmpty(m.g) THEN NULL
             ELSE ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(ST_Transform(m.g, 3857), ${tolerance})), 3))::json END AS geometry3857,
           CASE WHEN s.g IS NULL OR ST_IsEmpty(s.g) THEN NULL
             ELSE ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Transform(s.g, 3857), ${tolerance / 2}))::json END AS seams3857
         FROM merged m, seams s`
      )
    );
    const row = res.rows?.[0] as { geometry3857?: Geo | null; seams3857?: Geo | null } | undefined;
    const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Geo) : null);
    return { geometry3857: obj(row?.geometry3857), seams3857: obj(row?.seams3857) };
  } catch {
    return null;
  }
}
/**
 * 도형끼리 맞닿은 선(접선)과, 다른 하천까지 합친 주변 면.
 * 접선은 다른 하천 도형도 포함해 지류가 큰 하천과 만나는 경계도 잡고, 레이어 전체 합친 면의 바깥 경계는 제외.
 * 합친 면은 끝 위치가 다른 하천으로 넘어갈 때 절단선 계산용. 실패해도 기본 면 조회는 계속.
 */
async function loadBaseExtras(baseCtes: string, allFeatsSql: string): Promise<{ seams: Geo | null; all: Geo | null }> {
  try {
    const res = await db.execute(
      sql.raw(
        `WITH ${baseCtes},
         all_feats AS (${allFeatsSql}),
         all_src AS (
           SELECT ST_MakeValid(ST_Buffer(ST_Buffer(ST_UnaryUnion(ST_Collect(g)), ${GAP_CLOSE_M}), -${GAP_CLOSE_M})) AS g
           FROM all_feats
         ),
         seam_raw AS (
           SELECT ST_LineMerge(ST_CollectionExtract(ST_Difference(
             (SELECT ST_UnaryUnion(ST_Collect(ST_Boundary(g))) FROM all_feats),
             ST_Buffer(ST_Boundary(s.g), ${SEAM_OUTER_M})
           ), 2)) AS g
           FROM all_src s
         ),
         seams AS (
           SELECT ST_Collect(d.geom) AS g
           FROM seam_raw r CROSS JOIN src, LATERAL ST_Dump(r.g) AS d
           WHERE ST_Length(d.geom) > ${SEAM_MIN_LEN_M}
             AND ST_DWithin(d.geom, src.g, ${SEAM_OUTER_M})
         )
         SELECT CASE WHEN s.g IS NULL OR ST_IsEmpty(s.g) THEN NULL
                ELSE ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(s.g, 0.1), 3857))::json END AS seams3857,
                CASE WHEN a.g IS NULL OR ST_IsEmpty(a.g) THEN NULL
                ELSE ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(ST_CollectionExtract(a.g, 3), 0.1), 3857))::json END AS all3857
         FROM seams s, all_src a`
      )
    );
    const row = res.rows?.[0] as { seams3857?: Geo | null; all3857?: Geo | null } | undefined;
    const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Geo) : null);
    return { seams: obj(row?.seams3857), all: obj(row?.all3857) };
  } catch {
    return { seams: null, all: null };
  }
}

/**
 * 찍은 지점이 레이어 안인지 확인하고, 주변 하천 면(틈 메운 합집합)을 EPSG:3857 GeoJSON 으로 반환.
 * 절단선(하천 폭 방향)은 이 면으로 화면에서 계산한다.
 */
export async function getPrivateLandAnalysisBase(params?: {
  layer?: string;
  x?: number;
  y?: number;
}): Promise<{
  inside: boolean;
  name?: string | null;
  river?: PrivateLandRiverKey | null;
  geometry3857?: Geo | null;
  /** 같은 하천 도형끼리 맞닿은 경계선 — 끝 위치를 이 선에 맞출 때 사용 */
  seams3857?: Geo | null;
  /** 다른 하천까지 합친 주변 면 — 끝 위치가 다른 하천으로 넘어갈 때 */
  allGeometry3857?: Geo | null;
  error?: string;
}> {
  const x = toNum(params?.x);
  const y = toNum(params?.y);
  if (x == null || y == null) return { inside: false, error: '좌표가 없습니다.' };
  const target = await resolveTarget(params?.layer);
  if (!target) return { inside: false, error: '분석할 수 없는 레이어입니다.' };
  const { qualified, srid } = target;
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const pointSql = `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), ${WORK_SRID})`;

  try {
    const hitRes = await db.execute(
      sql.raw(
        `WITH p AS (SELECT ${pointSql} AS g)
         SELECT to_jsonb(f) - 'geom' AS row
         FROM ${qualified} f, p
         WHERE f.geom IS NOT NULL
           AND f.geom && ST_Transform(ST_Expand(p.g, 1), ${srid})
           AND ST_DWithin(${featGeom}, p.g, 0.5)
         ORDER BY ST_Distance(${featGeom}, p.g)
         LIMIT 1`
      )
    );
    const hit = (hitRes.rows?.[0] as { row?: Record<string, unknown> } | undefined)?.row;
    if (!hit) return { inside: false };

    let river: PrivateLandRiverKey | null = null;
    for (const field of target.riverCols) {
      const value = String(hit[field] ?? '').trim();
      if (value) {
        river = { field, value };
        break;
      }
    }
    const name = String(hit.river_name ?? hit.name ?? '').trim() || null;

    const featsSql = (where: string) => `
           SELECT ST_CollectionExtract(${featGeom}, 3) AS g
           FROM ${qualified} f, area a
           WHERE f.geom IS NOT NULL
             AND f.geom && ST_Transform(a.g, ${srid})
             AND ST_Intersects(${featGeom}, a.g)${where}`;
    const baseCtes = `area AS (SELECT ST_Buffer(${pointSql}, ${BASE_RADIUS_M}) AS g),
         feats AS (${featsSql(riverWhereSql(target, river))}),
         src AS (
           SELECT ST_CollectionExtract(
             ST_MakeValid(ST_Buffer(ST_Buffer(ST_UnaryUnion(ST_Collect(g)), ${GAP_CLOSE_M}), -${GAP_CLOSE_M})),
             3
           ) AS g
           FROM feats
         )`;
    const res = await db.execute(
      sql.raw(
        `WITH ${baseCtes}
         SELECT CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL
                ELSE ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(g, 0.1), 3857))::json END AS geometry3857
         FROM src`
      )
    );
    const row = res.rows?.[0] as { geometry3857?: Geo | null } | undefined;
    const geometry3857 = row?.geometry3857 && typeof row.geometry3857 === 'object' ? row.geometry3857 : null;
    if (!geometry3857) return { inside: false, error: '하천 도형을 불러오지 못했습니다.' };
    const extras = await loadBaseExtras(baseCtes, featsSql(''));
    return { inside: true, name, river, geometry3857, seams3857: extras.seams, allGeometry3857: extras.all };
  } catch (e: unknown) {
    return { inside: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 선 양끝을 끝 토막 방향으로 늘린다. 접선처럼 꺾인 선은 가운데 꼭짓점을 그대로 둔다 */
function extendLineSql(alias: string, marginM: number = LINE_END_MARGIN_M): string {
  const g = `${alias}.g`;
  /** from 을 to 반대 방향으로 marginM 만큼 민 점 */
  const pushOut = (from: string, to: string) => `ST_Translate(${from},
        (ST_X(${from}) - ST_X(${to})) / NULLIF(ST_Distance(${from}, ${to}), 0) * ${marginM},
        (ST_Y(${from}) - ST_Y(${to})) / NULLIF(ST_Distance(${from}, ${to}), 0) * ${marginM})`;
  const head = pushOut(`ST_StartPoint(${g})`, `ST_PointN(${g}, 2)`);
  const tail = pushOut(`ST_EndPoint(${g})`, `ST_PointN(${g}, ST_NPoints(${g}) - 1)`);
  return `
    CASE
      WHEN GeometryType(${g}) <> 'LINESTRING' OR ST_Length(${g}) < 1e-3 THEN ${g}
      ELSE COALESCE(ST_AddPoint(ST_AddPoint(${g}, ${head}, 0), ${tail}), ${g})
    END`;
}

type ZoneParams = {
  layer?: string;
  line1Wkt3857?: string;
  line2Wkt3857?: string;
  river?: PrivateLandRiverKey | null;
  /** 지류 포함 — 본류 구간에 합류하는 지류 중 자른 곳까지만 추가 */
  includeTributary?: boolean;
  /** 지류 자르기 선 (EPSG:3857 WKT) */
  tributaryLines?: string[];
  /** 닫힌 범위 — 경계선 목록 (EPSG:3857 WKT) */
  lines?: string[];
};

type ZoneResult = {
  wkt5181: string | null;
  geometry3857: Geo | null;
  areaSqm: number | null;
  /** 지류 포함 시 — 본류 구간에 합류하는 지류 후보 */
  tributaryCandidates3857?: Geo[];
  /** 절단선이 하천을 끝까지 자르지 못함 */
  leak?: boolean;
  /** 닫힌 범위가 아직 열림 — 경계선을 더 찍어야 함 */
  open?: boolean;
  /** 이 순번의 지류 끝선을 새 끝선으로 바꿔 계산함(끝선 너머 하천을 찍은 경우) */
  endSwapIndex?: number;
  /** 지류를 더하기 전 구간 — 지류 끝선이 합류부 어느 쪽인지 판정용 */
  mainGeometry3857?: Geo | null;
  error?: string;
};

const MAX_TRIBUTARY_LINES = 20;
/** 본류와 지류 차이에서 남는 가는 틈 제거(m) */
const SLIVER_M = 1;
const MIN_TRIBUTARY_AREA_SQM = 30;

function isLineWkt(v: unknown): v is string {
  return typeof v === 'string' && /^LINESTRING/i.test(v.trim());
}

/** 선의 첫·마지막 꼭짓점 [x1, y1, x2, y2] */
function parseLine3857(wkt: string): [number, number, number, number] | null {
  const body = /^LINESTRING\s*\(([^)]*)\)/i.exec(wkt.trim())?.[1];
  if (!body) return null;
  const pts = body.split(',').map((s) => s.trim().split(/\s+/).map(Number));
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (pts.length < 2 || !a || !b || [a[0], a[1], b[0], b[1]].some((v) => !Number.isFinite(v))) return null;
  return [a[0], a[1], b[0], b[1]];
}

/** 웹메르카토르 대략 거리(한국에서 m에 가깝게 0.8배). 면적 상한·너무 가까운 선 판정용 */
function chordSepApproxM(line1: string, line2: string): number | null {
  const a = parseLine3857(line1);
  const b = parseLine3857(line2);
  if (!a || !b) return null;
  const mx = (a[0] + a[2]) / 2 - (b[0] + b[2]) / 2;
  const my = (a[1] + a[3]) / 2 - (b[1] + b[3]) / 2;
  return Math.hypot(mx, my) * 0.8;
}

const MIN_CHORD_SEP_M = 8;
/** 계산 범위 — 선 묶음 바깥 여유(m) */
const AREA_PAD_M = 300;
/** 막지 않은 반대쪽 갈래를 끝까지 포함할 때 계산 범위 여유(m) */
const OPEN_AREA_PAD_M = 3000;
/** 두 선 사이 거리 × 폭 여유. 잘림 실패로 하천 전체가 잡히면 거절 */
const ZONE_WIDTH_M = 150;
const ZONE_WIND_FACTOR = 12;

/**
 * 여러 선으로 면을 자른 뒤, 선을 건너지 않고 이어진 조각 묶음 중
 * 1·2번 선(시작·끝)에 모두 닿는 묶음만 고른다. 둘 이상이면 두 선 사이 복도에 걸치고 면적이 작은 쪽.
 * 3번 이후 선(지류 자르기)은 자르기만 한다.
 * connectAcrossSeams — 접선 위 시작·끝선은 자르기만 하고 조각을 끊지 않음(지류 후보에서 접선 너머 하천을 잇기 위함).
 * areaHints — 자르지 않고 계산 범위만 넓힐 선(이미 찍은 지류 끝선 너머 갈래도 후보에 들도록).
 */
function zoneMidCtes(
  target: Target,
  lines: string[],
  riverWhere: string,
  connectAcrossSeams = false,
  areaHints: string[] = [],
  areaPadM = AREA_PAD_M
): string {
  const { qualified, srid } = target;
  const areaGeom = areaHints.length
    ? `ST_Collect(ARRAY[b.g, ${areaHints
        .map((wkt) => `ST_Transform(ST_SetSRID(ST_GeomFromText('${esc(wkt.trim())}'), 3857), ${WORK_SRID})`)
        .join(', ')}])`
    : 'b.g';
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const values = lines.map((wkt, i) => `(${i + 1}, '${esc(wkt.trim())}')`).join(', ');
  const splits = lines
    .map(
      (_, i) => `
    s${i + 1} AS (
      SELECT ST_Collect(
        ST_Split(
          ST_Snap(d.geom, (SELECT g FROM lines WHERE ord = ${i + 1}), ${CUT_SNAP_M}),
          (SELECT g FROM lines WHERE ord = ${i + 1})
        )
      ) AS g
      FROM s${i} CROSS JOIN LATERAL ST_Dump(s${i}.g) AS d
    ),`
    )
    .join('');
  const cutLinesWhere = connectAcrossSeams ? 'WHERE NOT l.seam' : '';
  return `
    lines_raw AS (
      SELECT v.ord, ST_Transform(ST_MakeValid(ST_SetSRID(ST_GeomFromText(v.wkt), 3857)), ${WORK_SRID}) AS g
      FROM (VALUES ${values}) AS v(ord, wkt)
    ),
    /** 시작·끝선이 도형끼리 맞닿은 경계선(접선) 위에 놓였는지 */
    lines_on_seam AS (
      SELECT r.ord, r.g, (ST_Length(r.g) > ${SEAM_LINE_TOL_M * 5} AND EXISTS (
        SELECT 1 FROM ${qualified} f
        WHERE f.geom IS NOT NULL
          AND f.geom && ST_Transform(ST_Expand(r.g, ${SEAM_LINE_TOL_M}), ${srid})
          AND ST_Length(ST_Intersection(r.g, ST_Buffer(ST_Boundary(ST_CollectionExtract(${featGeom}, 3)), ${SEAM_LINE_TOL_M})))
              >= ${SEAM_LINE_COVER} * ST_Length(r.g)
      )) AS on_seam
      FROM lines_raw r
    ),
    /** seam — 접선 위 시작·끝선(조각을 끊지 않는 계산이 있음). 접선 위 지류 끝선은 연장만 짧게 */
    lines_seam AS (
      SELECT r.ord, r.g, (r.ord <= 2 AND r.on_seam) AS seam, r.on_seam FROM lines_on_seam r
    ),
    lines_ext AS (
      SELECT r.ord, r.seam,
        CASE WHEN r.on_seam THEN ${extendLineSql('r', SEAM_LINE_MARGIN_M)} ELSE ${extendLineSql('r')} END AS g
      FROM lines_seam r
    ),
    blade AS (SELECT ST_Collect(g) AS g FROM lines_ext),
    l1 AS (SELECT g FROM lines_ext WHERE ord = 1),
    l2 AS (SELECT g FROM lines_ext WHERE ord = 2),
    area AS (
      SELECT ST_Expand(
        ST_Envelope(${areaGeom}),
        GREATEST(${areaPadM}, ST_Distance(ST_Centroid(l1.g), ST_Centroid(l2.g)))
      ) AS g
      FROM blade b, l1, l2
    ),
    s0 AS (
      SELECT ST_CollectionExtract(
        ST_MakeValid(ST_Buffer(ST_Buffer(ST_UnaryUnion(ST_Collect(${featGeom})), ${GAP_CLOSE_M}), -${GAP_CLOSE_M})),
        3
      ) AS g
      FROM ${qualified} f, area a
      WHERE f.geom IS NOT NULL
        AND f.geom && ST_Transform(a.g, ${srid})
        AND ST_Intersects(${featGeom}, a.g)${riverWhere}
    ),
    /**
     * 찍은 위치에서 하천을 가로지르는 한 토막만 — 늘린 선이 옆 갈래·근처 지류까지 자르지 않게.
     * 시작·끝선(접선 아님)은 작은 틈을 넘어 이어지도록 면을 조금 불려 자른다.
     */
    lines AS (
      SELECT e.ord, e.seam,
        CASE
          WHEN e.ord > 2 THEN COALESCE((
            SELECT ${extendLineSql('d', TRIB_CUT_OVERSHOOT_M)}
            FROM (
              SELECT dd.geom AS g
              FROM ST_Dump(ST_CollectionExtract(ST_Intersection(e.g, s0.g), 2)) dd
              ORDER BY ST_Distance(dd.geom, ST_LineInterpolatePoint(r.g, 0.5))
              LIMIT 1
            ) d
          ), e.g)
          WHEN NOT e.seam THEN COALESCE((
            SELECT ${extendLineSql('d', TRIB_CUT_OVERSHOOT_M)}
            FROM (
              SELECT dd.geom AS g
              FROM ST_Dump(ST_CollectionExtract(ST_Intersection(
                e.g,
                ST_Buffer(ST_Intersection(s0.g, ST_Expand(e.g, ${CHORD_GAP_BRIDGE_M * 4})), ${CHORD_GAP_BRIDGE_M})
              ), 2)) dd
              ORDER BY ST_Distance(dd.geom, ST_LineInterpolatePoint(r.g, 0.5))
              LIMIT 1
            ) d
          ), e.g)
          ELSE e.g
        END AS g
      FROM lines_ext e
      JOIN lines_raw r ON r.ord = e.ord
      CROSS JOIN s0
    ),
    l1c AS (SELECT g FROM lines WHERE ord = 1),
    l2c AS (SELECT g FROM lines WHERE ord = 2),${splits}
    parts AS (
      SELECT row_number() OVER () AS id, d.g
      FROM (
        SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(g), 3))).geom AS g
        FROM s${lines.length}
        WHERE g IS NOT NULL
      ) d
      WHERE ST_Area(d.g) > 0.01
    ),
    cut_zone AS (
      SELECT COALESCE(ST_Buffer(ST_Collect(l.g), 4), ST_SetSRID('POLYGON EMPTY'::geometry, ${WORK_SRID})) AS g
      FROM lines l ${cutLinesWhere}
    ),
    edges AS (
      SELECT a.id AS a, b.id AS b
      FROM parts a
      JOIN parts b ON a.id <> b.id AND ST_DWithin(a.g, b.g, 3)
      CROSS JOIN cut_zone c
      WHERE NOT ST_CoveredBy(ST_Intersection(ST_Buffer(a.g, 1.5), ST_Buffer(b.g, 1.5)), c.g)
    ),
    comp(id, root) AS (
      SELECT id, id FROM parts
      UNION
      SELECT e.b, c.root FROM comp c JOIN edges e ON e.a = c.id
    ),
    comp_min AS (SELECT id, MIN(root) AS r FROM comp GROUP BY id),
    comp_touch AS (
      SELECT cm.r,
             bool_or(ST_DWithin(p.g, l1c.g, 2)) AS t1,
             bool_or(ST_DWithin(p.g, l2c.g, 2)) AS t2
      FROM comp_min cm
      JOIN parts p ON p.id = cm.id
      CROSS JOIN l1c
      CROSS JOIN l2c
      GROUP BY cm.r
    ),
    seed AS (
      SELECT CASE
        WHEN ST_Distance(l1.g, l2.g) < 1 THEN NULL::geometry
        ELSE ST_Buffer(
          ST_MakeLine(ST_Centroid(l1.g), ST_Centroid(l2.g)),
          GREATEST(20, ST_Length(l1.g) * 0.6, ST_Length(l2.g) * 0.6)
        )
      END AS g
      FROM l1, l2
    ),
    ranked AS (
      SELECT cm.r,
             SUM(ST_Area(p.g)) AS ar,
             bool_or(s.g IS NOT NULL AND ST_Intersects(p.g, s.g)) AS hits_seed
      FROM comp_min cm
      JOIN parts p ON p.id = cm.id
      JOIN comp_touch ct ON ct.r = cm.r
      CROSS JOIN seed s
      WHERE ct.t1 AND ct.t2
      GROUP BY cm.r
    ),
    best AS (
      SELECT r FROM ranked
      ORDER BY hits_seed DESC, ar ASC
      LIMIT 1
    ),
    layer_raw AS (
      SELECT ST_UnaryUnion(ST_Collect(${featGeom})) AS g
      FROM ${qualified} f, area a
      WHERE f.geom IS NOT NULL
        AND f.geom && ST_Transform(a.g, ${srid})
        AND ST_Intersects(${featGeom}, a.g)${riverWhere}
    ),
    mid AS (
      SELECT ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(ST_UnaryUnion(ST_Collect(p.g)), (SELECT g FROM layer_raw))),
        3
      ) AS g
      FROM parts p
      JOIN comp_min cm ON cm.id = p.id
      JOIN best b ON b.r = cm.r
    )`;
}

/**
 * 시작·끝선에 닿는 조각은 지류로 보지 않음(m).
 * 늘린 절단선이 옆 도형을 잘라 생긴 삼각형 조각이 구간에 끼어드는 것을 막는다.
 */
const CUT_TOUCH_M = 2;
/** 지류 후보 조각 중 이 비율 넘게 같은 하천이면 후보에서 제외 */
const SAME_RIVER_PIECE_RATIO = 0.5;

/**
 * 전체 하천(지류 포함) 구간에서 본류 구간을 뺀 지류 조각.
 * 접선이 아닌 시작·끝선에 닿은 조각(선 너머 같은 하천·자투리)과, 대부분 같은 하천인 조각은 제외.
 * 접선 너머 큰 하천·이어지는 지류는 후보로 남는다.
 * riverField — 있으면 하천 구분값별로 조각을 나눠, 지류에 붙은 지류도 따로 찍을 수 있게 한다.
 */
function tributaryPiecesCte(target: Target, mainWkt: string, riverWhere: string, riverField: string | null): string {
  const { qualified, srid } = target;
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const restSql = `ST_Difference(mid.g, ST_Buffer(main.g, 0.5))`;
  const groupsCte = riverField
    ? `river_groups AS (
      SELECT ST_UnaryUnion(ST_Collect(${featGeom})) AS g
      FROM ${qualified} f, area a
      WHERE f.geom IS NOT NULL
        AND f.geom && ST_Transform(a.g, ${srid})
        AND ST_Intersects(${featGeom}, a.g)
      GROUP BY COALESCE(TRIM(f.${quoteIdent(riverField)}::text), '')
    ),
    rest AS (
      SELECT ST_CollectionExtract(ST_MakeValid(ST_Intersection(${restSql}, rg.g)), 3) AS g
      FROM mid, main, river_groups rg
    ),`
    : `rest AS (SELECT ${restSql} AS g FROM mid, main),`;
  const sameRiverCte = riverWhere
    ? `same_river AS (
      SELECT ST_UnaryUnion(ST_Collect(${featGeom})) AS g
      FROM ${qualified} f, area a
      WHERE f.geom IS NOT NULL
        AND f.geom && ST_Transform(a.g, ${srid})
        AND ST_Intersects(${featGeom}, a.g)${riverWhere}
    ),`
    : `same_river AS (SELECT NULL::geometry AS g),`;
  return `
    main AS (SELECT ST_SetSRID(ST_GeomFromText('${esc(mainWkt)}'), ${WORK_SRID}) AS g),
    ${sameRiverCte}
    ${groupsCte}
    pieces AS (
      SELECT d.geom AS g
      FROM rest,
      LATERAL ST_Dump(
        ST_CollectionExtract(
          ST_MakeValid(ST_Buffer(ST_Buffer(rest.g, -${SLIVER_M}), ${SLIVER_M})),
          3
        )
      ) AS d
      WHERE ST_Area(d.geom) > ${MIN_TRIBUTARY_AREA_SQM}
        AND NOT EXISTS (SELECT 1 FROM lines l WHERE l.ord <= 2 AND NOT l.seam AND ST_DWithin(d.geom, l.g, ${CUT_TOUCH_M}))
        AND NOT EXISTS (
          SELECT 1 FROM same_river sr
          WHERE sr.g IS NOT NULL AND ST_Area(ST_Intersection(d.geom, sr.g)) > ${SAME_RIVER_PIECE_RATIO} * ST_Area(d.geom)
        )
    )`;
}

/** 구간 경계에서 이만큼 안쪽에 절단선이 지나가면 잘림 실패로 본다(m) */
const LEAK_INSET_M = 1;

/**
 * 호출부는 `FROM mid zg` · `FROM final zg` 처럼 zg 별칭을 붙인다.
 * leak — 절단선이 구간 안쪽을 지나감(선이 하천을 끝까지 자르지 못해 구간이 선 너머로 이어짐)
 * leakFrom·leakWhere — 잘림 검사할 선. 접선 너머까지 잇는 계산은 접선 위 시작·끝선을 빼야 한다.
 */
function zoneSelectSql(leakFrom = 'lines_raw r', leakWhere = 'TRUE'): string {
  return `
  SELECT
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN NULL ELSE ST_AsText(zg.g) END AS wkt5181,
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN NULL ELSE ST_AsGeoJSON(ST_Transform(zg.g, 3857))::json END AS geometry3857,
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN NULL ELSE ST_Area(zg.g) END AS area_sqm,
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN false
         ELSE EXISTS (
           SELECT 1 FROM ${leakFrom}
           WHERE ${leakWhere} AND ST_Intersects(ST_Buffer(zg.g, -${LEAK_INSET_M}), r.g)
         ) END AS leak`;
}
const ZONE_SELECT_SQL = zoneSelectSql();

function readZoneRow(rows: unknown[] | undefined): ZoneResult | null {
  const row = rows?.[0] as
    | { wkt5181?: string | null; geometry3857?: Geo | null; area_sqm?: unknown; leak?: unknown }
    | undefined;
  const wkt5181 = String(row?.wkt5181 ?? '').trim();
  if (!wkt5181) return null;
  return {
    wkt5181,
    geometry3857: row?.geometry3857 && typeof row.geometry3857 === 'object' ? row.geometry3857 : null,
    areaSqm: toNum(row?.area_sqm),
    leak: row?.leak === true || row?.leak === 't',
  };
}

/**
 * 끝선 가운데가 놓인 하천 키. 시작 하천과 다르면 두 하천에 걸친 구간.
 * prefer — 가운데가 두 하천 경계(접선) 위라 여러 하천에 닿으면 이 하천을 고른다.
 * 지류·큰 하천 접선에 찍은 끝선이 그때그때 큰 하천으로 잡혀 큰 하천이 지류 후보에서 빠지던 것 방지.
 */
async function riverKeyAtLine(
  target: Target,
  lineWkt3857: string,
  field: RiverKeyColumn,
  prefer: string | null = null
): Promise<string | null> {
  const { qualified, srid } = target;
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const res = await db.execute(
    sql.raw(
      `WITH p AS (
         SELECT ST_LineInterpolatePoint(ST_Transform(ST_SetSRID(ST_GeomFromText('${esc(lineWkt3857)}'), 3857), ${WORK_SRID}), 0.5) AS g
       )
       SELECT TRIM(f.${quoteIdent(field)}::text) AS v
       FROM ${qualified} f, p
       WHERE f.geom IS NOT NULL
         AND f.geom && ST_Transform(ST_Expand(p.g, 1), ${srid})
         AND ST_DWithin(${featGeom}, p.g, 0.5)
       ORDER BY ${prefer ? `(TRIM(f.${quoteIdent(field)}::text) = '${esc(prefer)}') DESC, ` : ''}ST_Distance(${featGeom}, p.g)
       LIMIT 1`
    )
  );
  const v = String((res.rows?.[0] as { v?: unknown } | undefined)?.v ?? '').trim();
  return v || null;
}

/** 시작선에서 끝선 쪽으로 이만큼 들어간 지점의 하천을 구간 시작 하천으로 본다(m) */
const START_SIDE_M = 1.5;

/**
 * 시작선이 두 하천 접선 위면 찍은 쪽 하천이 구간 방향과 다를 수 있다.
 * 시작선 가운데에서 끝선 쪽으로 조금 들어간 지점의 하천으로 시작 하천을 바로잡는다.
 */
async function withStartRiver(target: Target, line1: string, line2: string, params: ZoneParams): Promise<ZoneParams> {
  const k = params.river as Partial<PrivateLandRiverKey> | null | undefined;
  const field = String(k?.field ?? '') as RiverKeyColumn;
  const value = String(k?.value ?? '').trim();
  if (!value || !target.riverCols.includes(field)) return params;
  const { qualified, srid } = target;
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const toWork = (wkt: string) => `ST_Transform(ST_SetSRID(ST_GeomFromText('${esc(wkt)}'), 3857), ${WORK_SRID})`;
  const res = await db.execute(
    sql.raw(
      `WITH l AS (SELECT ${toWork(line1)} AS g),
       a AS (
         SELECT ST_LineInterpolatePoint(l.g, 0.5) AS g,
           -(ST_Y(ST_EndPoint(l.g)) - ST_Y(ST_StartPoint(l.g))) / NULLIF(ST_Distance(ST_StartPoint(l.g), ST_EndPoint(l.g)), 0) AS nx,
           (ST_X(ST_EndPoint(l.g)) - ST_X(ST_StartPoint(l.g))) / NULLIF(ST_Distance(ST_StartPoint(l.g), ST_EndPoint(l.g)), 0) AS ny
         FROM l
       ),
       b AS (SELECT ST_LineInterpolatePoint(${toWork(line2)}, 0.5) AS g),
       s AS (
         SELECT a.g, a.nx, a.ny,
           SIGN(a.nx * (ST_X(b.g) - ST_X(a.g)) + a.ny * (ST_Y(b.g) - ST_Y(a.g))) AS sg
         FROM a, b
       ),
       p AS (SELECT ST_Translate(s.g, ${START_SIDE_M} * s.sg * s.nx, ${START_SIDE_M} * s.sg * s.ny) AS g FROM s)
       SELECT TRIM(f.${quoteIdent(field)}::text) AS v
       FROM ${qualified} f, p
       WHERE p.g IS NOT NULL AND f.geom IS NOT NULL
         AND f.geom && ST_Transform(ST_Expand(p.g, 1), ${srid})
         AND ST_Intersects(${featGeom}, p.g)
       LIMIT 1`
    )
  );
  const v = String((res.rows?.[0] as { v?: unknown } | undefined)?.v ?? '').trim();
  if (!v || v === value) return params;
  return { ...params, river: { field, value: v } };
}

/**
 * 두 하천에 걸친 구간 — 두 하천 면을 시작·끝선·추가 끝선으로 자른 뒤 시작·끝선에 닿는 조각.
 * open — 구간이 계산 범위 테두리까지 이어짐(반대쪽 갈래를 아직 막지 않음).
 */
async function runCrossZone(
  target: Target,
  lines: string[],
  riverWhere: string,
  areaPadM = AREA_PAD_M
): Promise<(ZoneResult & { open: boolean }) | null> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, riverWhere, false, [], areaPadM)}
      ${ZONE_SELECT_SQL},
      (SELECT zg.g IS NOT NULL AND ST_DWithin(zg.g, ST_Boundary(a.g), 1) FROM area a) AS open
      FROM mid zg`)
  );
  const zone = readZoneRow(res.rows);
  if (!zone) return null;
  const open = (res.rows?.[0] as { open?: unknown } | undefined)?.open;
  return { ...zone, open: open === true || open === 't' };
}

async function runMainZone(target: Target, lines: string[], river: unknown): Promise<ZoneResult | null> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, riverWhereSql(target, river))}
      ${ZONE_SELECT_SQL}
      FROM mid zg`)
  );
  return readZoneRow(res.rows);
}

/**
 * 지류 끝선 중 끝선 너머에 놓인 선의 순번(0부터).
 * 시작·끝 사이 구간 덩어리에는 닿지 않고, 끝선에 닿는 다른 덩어리(하천이 바깥에서 이어져 시작선에도 닿는 경우 포함)에 있는 선.
 * 시작·끝을 같은 지류에 찍은 뒤 끝선 너머 큰 하천을 찍은 경우 — 그 선을 새 끝선으로 쓴다.
 */
async function tribLinesBeyondEnd(target: Target, line1: string, line2: string, tribLines: string[]): Promise<number[]> {
  const values = tribLines
    .map((wkt, i) => `(${i}, ST_Transform(ST_SetSRID(ST_GeomFromText('${esc(wkt.trim())}'), 3857), ${WORK_SRID}))`)
    .join(', ');
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, [line1, line2], '', true, tribLines)},
      cuts(i, g) AS (VALUES ${values})
      SELECT c.i FROM cuts c
      WHERE EXISTS (
        SELECT 1 FROM parts p
        JOIN comp_min cm ON cm.id = p.id
        JOIN comp_touch ct ON ct.r = cm.r
        WHERE ct.t2 AND cm.r NOT IN (SELECT r FROM best) AND ST_DWithin(p.g, c.g, 1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM parts p
        JOIN comp_min cm ON cm.id = p.id
        WHERE cm.r IN (SELECT r FROM best) AND ST_DWithin(p.g, c.g, 1)
      )
      ORDER BY c.i`)
  );
  return (res.rows ?? []).map((r) => Number((r as { i?: unknown }).i)).filter((n) => Number.isInteger(n));
}

/**
 * 끝선 너머 다른 하천 조각 — 시작·끝 사이 구간 덩어리 밖에서 끝선에 이어진 다른 하천(구분값별).
 * 지류 추가로 찍으면 끝선 바꾸기 대상이 된다. 같은 하천 조각은 제외.
 */
async function runBeyondEndCandidates(
  target: Target,
  line1: string,
  line2: string,
  river: { field: string; value: string }
): Promise<Geo[]> {
  const { qualified, srid } = target;
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const col = `COALESCE(TRIM(f.${quoteIdent(river.field)}::text), '')`;
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, [line1, line2], '', true)},
      beyond AS (
        SELECT ST_UnaryUnion(ST_Collect(p.g)) AS g
        FROM parts p
        JOIN comp_min cm ON cm.id = p.id
        JOIN comp_touch ct ON ct.r = cm.r
        WHERE ct.t2 AND cm.r NOT IN (SELECT r FROM best)
      ),
      other_groups AS (
        SELECT ST_UnaryUnion(ST_Collect(${featGeom})) AS g
        FROM ${qualified} f, area a
        WHERE f.geom IS NOT NULL
          AND f.geom && ST_Transform(a.g, ${srid})
          AND ST_Intersects(${featGeom}, a.g)
          AND ${col} <> '${esc(river.value)}'
        GROUP BY ${col}
      ),
      pieces AS (
        SELECT d.geom AS g
        FROM beyond b, other_groups og,
        LATERAL ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_Intersection(b.g, og.g)), 3)) d
        WHERE b.g IS NOT NULL AND ST_Area(d.geom) > ${MIN_TRIBUTARY_AREA_SQM}
      )
      SELECT ST_AsGeoJSON(ST_Transform(g, 3857))::json AS geometry3857 FROM pieces`)
  );
  return (res.rows ?? [])
    .map((r) => (r as { geometry3857?: Geo | null }).geometry3857)
    .filter((g): g is Geo => g != null && typeof g === 'object');
}

/** 본류(같은 하천) 조건과 하천 구분 컬럼 */
type RiverScope = { where: string; field: string | null };

/** 지류 후보 — 전체 하천을 시작·끝선으로 자른 구간에서 본류 구간을 뺀 조각들 */
async function runTributaryCandidates(
  target: Target,
  lines: string[],
  mainWkt: string,
  river: RiverScope,
  areaHints: string[] = []
): Promise<Geo[]> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, '', true, areaHints)}, ${tributaryPiecesCte(target, mainWkt, river.where, river.field)}
      SELECT ST_AsGeoJSON(ST_Transform(g, 3857))::json AS geometry3857 FROM pieces`)
  );
  return (res.rows ?? [])
    .map((r) => (r as { geometry3857?: Geo | null }).geometry3857)
    .filter((g): g is Geo => g != null && typeof g === 'object');
}

/** 지류 조각끼리·본류와 이어졌다고 보는 거리(m) */
const PIECE_LINK_M = 2;
/** 본류에서 끝선 찍은 지류까지 거쳐 갈 수 있는 조각 수 상한 */
const PIECE_PATH_MAX = 8;

/**
 * 본류 구간 + 지류 자르기 선(keepFromOrd번 이후)까지의 지류 조각. 자르지 않은 지류는 제외.
 * 지류에 붙은 지류만 찍어도 본류에서 그 지류까지 가장 짧게 거치는 지류 조각을 함께 포함한다.
 * 거치는 조각은 계산 범위 테두리에 닿지 않는(끝이 막힌) 조각만 쓴다.
 * open — 끝선을 찍은 조각이 아직 계산 범위 테두리까지 이어짐(큰 하천 반대쪽 갈래를 막지 않음).
 * 열려 있으면 계산 범위를 넓혀 다시 계산해 반대쪽 갈래를 끝까지 포함한다.
 */
async function runZoneWithTributaries(
  target: Target,
  lines: string[],
  mainWkt: string,
  river: RiverScope,
  keepFromOrd = 3,
  areaPadM = AREA_PAD_M
): Promise<ZoneResult | null> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, '', true, [], areaPadM)}, ${tributaryPiecesCte(target, mainWkt, river.where, river.field)},
      piece_info AS (
        SELECT n.id, n.g,
          EXISTS (SELECT 1 FROM lines_raw t WHERE t.ord >= ${keepFromOrd} AND ST_DWithin(n.g, t.g, 3)) AS cut,
          ST_DWithin(n.g, main.g, ${PIECE_LINK_M}) AS at_main,
          ST_DWithin(n.g, ST_Boundary(a.g), 1) AS open
        FROM (SELECT row_number() OVER () AS id, p.g FROM pieces p) n, main, area a
      ),
      cand AS (SELECT * FROM piece_info WHERE cut OR NOT open),
      adj AS (
        SELECT x.id AS a, y.id AS b
        FROM cand x JOIN cand y ON x.id <> y.id AND ST_DWithin(x.g, y.g, ${PIECE_LINK_M})
      ),
      walk(id, depth) AS (
        SELECT id, 1 FROM cand WHERE at_main
        UNION
        SELECT j.b, w.depth + 1
        FROM walk w JOIN adj j ON j.a = w.id
        WHERE w.depth < ${PIECE_PATH_MAX}
      ),
      dist AS (SELECT id, MIN(depth) AS d FROM walk GROUP BY id),
      back(id, d) AS (
        SELECT c.id, ds.d FROM cand c JOIN dist ds ON ds.id = c.id WHERE c.cut
        UNION
        SELECT j.b, ds.d
        FROM back k
        JOIN adj j ON j.a = k.id
        JOIN dist ds ON ds.id = j.b AND ds.d = k.d - 1
      ),
      kept AS (
        SELECT c.g, c.open FROM cand c
        WHERE c.id IN (SELECT id FROM back)
      ),
      final AS (
        SELECT ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(
            ST_UnaryUnion(ST_Collect(main.g, (SELECT ST_Buffer(ST_Collect(k.g), 1.1) FROM kept k))),
            mid.g
          )),
          3
        ) AS g
        FROM main, mid
      )
      ${zoneSelectSql('lines_seam r', 'NOT r.seam')},
      COALESCE((SELECT bool_or(k.open) FROM kept k), false) AS open
      FROM final zg`)
  );
  const zone = readZoneRow(res.rows);
  if (!zone) return null;
  const openRaw = (res.rows?.[0] as { open?: unknown } | undefined)?.open;
  const open = openRaw === true || openRaw === 't';
  if (open && areaPadM < OPEN_AREA_PAD_M) {
    const wide = await runZoneWithTributaries(target, lines, mainWkt, river, keepFromOrd, OPEN_AREA_PAD_M);
    if (wide?.wkt5181 && !wide.leak) return { ...wide, open: true };
  }
  return { ...zone, open };
}

const MAX_CLOSED_LINES = 30;
/** 닫힌 범위 — 경계선 양끝 연장(m). 화면 단순화 도형으로 찍은 선이 실제 경계에 못 미쳐도 자르도록 */
const CLOSED_LINE_MARGIN_M = 15;
/** 닫힌 범위 — 경계선 묶음 바깥 여유(m). 이 테두리에 닿는 조각은 범위 밖으로 뻗어나간 것으로 본다 */
const CLOSED_AREA_PAD_M = 300;
/** 닫힌 범위 — 합친 도로 면의 미세한 틈 메움(m). 최종 구간은 원래 도로 면으로 다시 잘라 모양은 유지 */
const CLOSED_GAP_M = 0.5;
/** 닫힌 범위 — 경계선을 도로 면에서 빼낼 띠의 반폭(m) */
const CLOSED_CUT_HALF_M = 0.05;
/** 닫힌 범위 — 도로 면을 가로지른 경계선을 면 밖으로 살짝 더 내밀어 확실히 끊음(m) */
const CLOSED_CUT_OVERSHOOT_M = 0.5;

/**
 * 하나로 합친 도로 면에서 경계선(찍은 위치에서 도로 폭만큼만)을 얇은 띠로 빼내 조각을 나눈다.
 * 조각 중 모든 경계선에 닿고 바깥 테두리에 닿지 않는(닫힌) 가장 작은 조각을 구간으로 고른다.
 * 호출부는 `FROM mid zg` 로 ZONE_SELECT_SQL 을 붙이고, 추가로 open_any 를 함께 읽는다.
 */
function closedZoneCtes(target: Target, lines: string[]): string {
  const { qualified, srid } = target;
  const featGeom = `ST_MakeValid(ST_Transform(f.geom, ${WORK_SRID}))`;
  const values = lines.map((wkt, i) => `(${i + 1}, '${esc(wkt.trim())}')`).join(', ');
  return `
    lines_raw AS (
      SELECT v.ord, ST_Transform(ST_MakeValid(ST_SetSRID(ST_GeomFromText(v.wkt), 3857)), ${WORK_SRID}) AS g
      FROM (VALUES ${values}) AS v(ord, wkt)
    ),
    lines_ext AS (SELECT r.ord, ${extendLineSql('r', CLOSED_LINE_MARGIN_M)} AS g FROM lines_raw r),
    area AS (SELECT ST_Expand(ST_Envelope(ST_Collect(e.g)), ${CLOSED_AREA_PAD_M}) AS g FROM lines_ext e),
    layer_raw AS (
      SELECT ST_Intersection(ST_UnaryUnion(ST_Collect(${featGeom})), (SELECT g FROM area)) AS g
      FROM ${qualified} f, area a
      WHERE f.geom IS NOT NULL
        AND f.geom && ST_Transform(a.g, ${srid})
        AND ST_Intersects(${featGeom}, a.g)
    ),
    s0 AS (
      SELECT ST_CollectionExtract(ST_MakeValid(ST_Buffer(ST_Buffer(l.g, ${CLOSED_GAP_M}), -${CLOSED_GAP_M})), 3) AS g
      FROM layer_raw l
    ),
    /** 늘린 선 중 찍은 위치에서 도로 면을 가로지르는 한 토막만 — 옆 도로까지 자르지 않게 */
    cuts AS (
      SELECT e.ord, (
        SELECT d.geom
        FROM ST_Dump(ST_CollectionExtract(ST_Intersection(e.g, s0.g), 2)) d
        ORDER BY ST_Distance(d.geom, ST_LineInterpolatePoint(r.g, 0.5))
        LIMIT 1
      ) AS g
      FROM lines_ext e
      JOIN lines_raw r ON r.ord = e.ord
      CROSS JOIN s0
    ),
    lines AS (
      SELECT c.ord, ${extendLineSql('c', CLOSED_CUT_OVERSHOOT_M)} AS g
      FROM cuts c
      WHERE c.g IS NOT NULL
    ),
    blade AS (SELECT ST_Buffer(ST_Collect(l.g), ${CLOSED_CUT_HALF_M}) AS g FROM lines l),
    pieces AS (
      SELECT d.geom AS g
      FROM s0, blade b,
      LATERAL ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_Difference(s0.g, b.g)), 3)) d
      WHERE ST_Area(d.geom) > 0.01
    ),
    ranked AS (
      SELECT p.g,
             ST_Area(p.g) AS ar,
             (SELECT COUNT(DISTINCT l.ord) FROM lines l WHERE ST_DWithin(p.g, l.g, ${CLOSED_CUT_HALF_M * 4})) AS n,
             ST_DWithin(p.g, ST_Boundary(a.g), 1) AS open
      FROM pieces p, area a
    ),
    mid AS (
      SELECT (
        SELECT ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(ST_Buffer(k.g, ${CLOSED_CUT_HALF_M}), (SELECT g FROM layer_raw))),
          3
        )
        FROM ranked k
        WHERE k.n = ${lines.length} AND NOT k.open
        ORDER BY k.ar ASC
        LIMIT 1
      ) AS g
    )`;
}

/** 닫힌 범위(도로) — 경계선 여러 개로 둘러싼 구간 */
async function computeClosedZone(target: Target, rawLines: unknown): Promise<ZoneResult> {
  const empty: ZoneResult = { wkt5181: null, geometry3857: null, areaSqm: null };
  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((l) => String(l ?? '').trim())
    .filter(isLineWkt)
    .slice(0, MAX_CLOSED_LINES);
  if (lines.length < 2) return { ...empty, error: '경계선을 2개 이상 찍으세요.' };

  try {
    const res = await db.execute(
      sql.raw(`WITH ${closedZoneCtes(target, lines)}
        ${ZONE_SELECT_SQL},
        (SELECT bool_or(open) FROM ranked WHERE n = ${lines.length}) AS open_any,
        (SELECT COUNT(*) FROM lines) AS line_n
        FROM mid zg`)
    );
    const row = res.rows?.[0] as { open_any?: unknown; line_n?: unknown } | undefined;
    if ((toNum(row?.line_n) ?? lines.length) < lines.length) {
      return { ...empty, error: '도로를 가로지르지 않는 경계선이 있습니다. «선 되돌리기» 후 도로 위에 다시 찍으세요.' };
    }
    const zone = readZoneRow(res.rows);
    if (!zone?.wkt5181) {
      const open = row?.open_any === true || row?.open_any === 't';
      if (open) return { ...empty, open: true, error: '범위가 아직 닫히지 않았습니다.' };
      return { ...empty, error: '모든 경계선으로 둘러싸인 구간을 찾지 못했습니다. 선을 다시 확인하세요.' };
    }
    if (zone.leak) {
      return { ...empty, error: '경계선이 도로를 끝까지 자르지 못했습니다. 도로 폭 방향으로 다시 찍으세요.' };
    }
    return zone;
  } catch (e: unknown) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 시작·끝선이 서로 다른 하천(지류↔큰 하천, 지류↔지류)이면 두 하천을 이어 계산.
 * 추가 끝선 중 두 하천 위 선은 반대쪽 갈래를 막고, 다른 하천 위 선은 그 지류를 끝선까지 포함한다.
 * 후보는 합류 지류 조각 + 시작·끝선만으로 자른 두 하천 구간 전체.
 * 같은 하천이면 null — 기존 계산으로.
 */
async function computeCrossZone(
  target: Target,
  line1: string,
  line2: string,
  params: ZoneParams
): Promise<ZoneResult | null> {
  const k = params.river as Partial<PrivateLandRiverKey> | null | undefined;
  const field = String(k?.field ?? '') as RiverKeyColumn;
  const value = String(k?.value ?? '').trim();
  if (!value || !target.riverCols.includes(field)) return null;
  const endValue = await riverKeyAtLine(target, line2, field, value);
  if (!endValue || endValue === value) return null;

  const empty: ZoneResult = { wkt5181: null, geometry3857: null, areaSqm: null };
  const where = ` AND TRIM(f.${quoteIdent(field)}::text) IN ('${esc(value)}', '${esc(endValue)}')`;
  const cutLines = (Array.isArray(params.tributaryLines) ? params.tributaryLines : [])
    .filter(isLineWkt)
    .slice(0, MAX_TRIBUTARY_LINES);
  const closeLines: string[] = [];
  const tribLines: string[] = [];
  for (const line of cutLines) {
    const key = await riverKeyAtLine(target, line, field);
    (key === value || key === endValue ? closeLines : tribLines).push(line);
  }

  const span = await runCrossZone(target, [line1, line2], where);
  const spanCandidates = span?.geometry3857 ? [span.geometry3857] : [];
  const near = closeLines.length > 0 ? await runCrossZone(target, [line1, line2, ...closeLines], where) : span;
  /** 막지 않은 반대쪽 갈래는 계산 범위를 넓혀 끝까지 포함 */
  const wide =
    near?.wkt5181 && !near.leak && near.open
      ? await runCrossZone(target, [line1, line2, ...closeLines], where, OPEN_AREA_PAD_M)
      : null;
  const zone = wide?.wkt5181 && !wide.leak ? { ...wide, open: true } : near;
  const areaPadM = zone === near ? AREA_PAD_M : OPEN_AREA_PAD_M;
  if (!zone?.wkt5181) {
    return {
      ...empty,
      tributaryCandidates3857: spanCandidates,
      error: '두 선 사이의 구간을 찾지 못했습니다. 구간을 다시 지정하세요.',
    };
  }
  if (zone.leak) {
    return {
      ...empty,
      tributaryCandidates3857: spanCandidates,
      error: '지정한 선이 하천을 끝까지 자르지 못했습니다. 끝 위치를 다시 찍으세요.',
    };
  }

  const baseLines = [line1, line2, ...closeLines];
  const scope: RiverScope = { where, field };
  const tribCandidates = await runTributaryCandidates(target, baseLines, zone.wkt5181, scope, tribLines);
  const candidates = [...tribCandidates, ...spanCandidates];
  const mainGeometry3857 = zone.geometry3857;
  if (tribLines.length === 0) return { ...zone, tributaryCandidates3857: candidates, mainGeometry3857 };

  const withTrib = await runZoneWithTributaries(
    target,
    [...baseLines, ...tribLines],
    zone.wkt5181,
    scope,
    baseLines.length + 1,
    areaPadM
  );
  if (withTrib?.leak) {
    return {
      ...empty,
      tributaryCandidates3857: candidates,
      mainGeometry3857,
      error: '지류 끝선이 지류를 끝까지 자르지 못했습니다. 지류 끝 위치를 다시 찍으세요.',
    };
  }
  return {
    ...(withTrib ?? zone),
    tributaryCandidates3857: candidates,
    mainGeometry3857,
    open: Boolean(zone.open || withTrib?.open),
  };
}

/**
 * 시작·끝 절단선 사이 하천 구간 (WORK_SRID WKT + 3857 GeoJSON).
 * 같은 하천(본류)만으로 계산하고, 지류 포함이면 자른 지류 조각을 더한다.
 */
async function computeZone(params: ZoneParams): Promise<ZoneResult> {
  const empty: ZoneResult = { wkt5181: null, geometry3857: null, areaSqm: null };
  const target = await resolveTarget(params.layer);
  if (!target) return { ...empty, error: '분석할 수 없는 레이어입니다.' };
  if (target.mode === 'closed') return computeClosedZone(target, params.lines);

  const line1 = String(params.line1Wkt3857 ?? '').trim();
  const line2 = String(params.line2Wkt3857 ?? '').trim();
  if (!isLineWkt(line1) || !isLineWkt(line2)) return { ...empty, error: '시작선·끝선이 필요합니다.' };

  try {
    const sepM = chordSepApproxM(line1, line2);
    if (sepM != null && sepM < MIN_CHORD_SEP_M) {
      return { ...empty, error: '시작과 끝이 너무 가깝습니다. 구간을 조금 더 벌려 찍으세요.' };
    }
    params = await withStartRiver(target, line1, line2, params);
    const cross = await computeCrossZone(target, line1, line2, params);
    if (cross) return cross;
    const main = await runMainZone(target, [line1, line2], params.river);
    if (!main?.wkt5181) {
      return { ...empty, error: '두 선 사이의 구간을 찾지 못했습니다. 구간을 다시 지정하세요.' };
    }
    if (main.leak) {
      return {
        ...empty,
        error: '지정한 선이 하천을 끝까지 자르지 못해 구간이 선 너머로 이어집니다. 시작·끝 위치를 다시 찍으세요.',
      };
    }
    const maxArea = Math.max(25_000, (sepM ?? 0) * ZONE_WIDTH_M * ZONE_WIND_FACTOR);
    if (main.areaSqm != null && main.areaSqm > maxArea) {
      return {
        ...empty,
        error:
          '지정한 선이 하천을 가로막지 못해 구간이 너무 넓게 잡혔습니다. 시작·끝 위치를 하천 폭 방향으로 다시 찍으세요.',
      };
    }
    const hasRiver = riverWhereSql(target, params.river) !== '';
    if (!params.includeTributary || !hasRiver) return main;

    const riverField = String((params.river as Partial<PrivateLandRiverKey> | null | undefined)?.field ?? '');
    const scope: RiverScope = {
      where: riverWhereSql(target, params.river),
      field: target.riverCols.includes(riverField as RiverKeyColumn) ? riverField : null,
    };
    const tribLines = (Array.isArray(params.tributaryLines) ? params.tributaryLines : [])
      .filter(isLineWkt)
      .slice(0, MAX_TRIBUTARY_LINES);
    /** 이 지류 끝선을 새 끝선으로 바꿔(중간 끝선 빼고) 두 하천 구간으로 계산. 안 되면 null */
    const trySwapEnd = async (order: number[]): Promise<ZoneResult | null> => {
      for (const swap of order) {
        const swapped = await computeCrossZone(target, line1, tribLines[swap], {
          ...params,
          tributaryLines: tribLines.filter((_, i) => i !== swap),
        });
        if (swapped?.wkt5181 && !swapped.error) return { ...swapped, endSwapIndex: swap };
      }
      return null;
    };
    if (tribLines.length > 0) {
      const beyond = await tribLinesBeyondEnd(target, line1, line2, tribLines);
      const swapped = beyond.length > 0 ? await trySwapEnd(beyond) : null;
      if (swapped) return swapped;
    }
    const riverValue = String((params.river as Partial<PrivateLandRiverKey> | null | undefined)?.value ?? '').trim();
    const beyondCandidates = scope.field
      ? await runBeyondEndCandidates(target, line1, line2, { field: scope.field, value: riverValue })
      : [];
    const candidates = [
      ...(await runTributaryCandidates(target, [line1, line2], main.wkt5181, scope, tribLines)),
      ...beyondCandidates,
    ];
    const mainGeometry3857 = main.geometry3857;
    if (tribLines.length === 0) return { ...main, tributaryCandidates3857: candidates, mainGeometry3857 };

    const withTrib = await runZoneWithTributaries(target, [line1, line2, ...tribLines], main.wkt5181, scope);
    if (withTrib?.leak) {
      return {
        ...empty,
        tributaryCandidates3857: candidates,
        mainGeometry3857,
        error: '지류 끝선이 지류를 끝까지 자르지 못했습니다. 지류 끝 위치를 다시 찍으세요.',
      };
    }
    return { ...(withTrib ?? main), tributaryCandidates3857: candidates, mainGeometry3857 };
  } catch (e: unknown) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 적용·미리보기 — 두 선 사이 구간 도형 (+ 지류 후보) */
export async function computePrivateLandAnalysisZone(params?: ZoneParams): Promise<{
  zoneGeometry3857: Geo | null;
  areaSqm: number | null;
  tributaryCandidates3857?: Geo[];
  open?: boolean;
  endSwapIndex?: number;
  mainGeometry3857?: Geo | null;
  error?: string;
}> {
  const zone = await computeZone(params ?? {});
  return {
    zoneGeometry3857: zone.geometry3857,
    areaSqm: zone.areaSqm,
    tributaryCandidates3857: zone.tributaryCandidates3857,
    open: zone.open,
    endSwapIndex: zone.endSwapIndex,
    mainGeometry3857: zone.mainGeometry3857,
    error: zone.error,
  };
}

/** 분석 — 구간과 겹치는 필지 전체 + 소유구분 코드 */
export async function listPrivateLandAnalysisParcels(params?: ZoneParams): Promise<{
  parcels: {
    address: string;
    pnu: string;
    jimok: string;
    ownGbn: string;
    areaSqm: number | null;
    intersectAreaSqm: number | null;
    geometry3857: Geo | null;
    extent3857: [number, number, number, number] | null;
  }[];
  truncated?: boolean;
  error?: string;
}> {
  const zone = await computeZone(params ?? {});
  if (!zone.wkt5181) return { parcels: [], error: zone.error };

  const hit = await listJijukParcelsByGeomWkt5181({
    wkt5181: zone.wkt5181,
    clipToSearchGeom: true,
    limit: PARCEL_LIMIT,
  });
  if (hit.error) return { parcels: [], error: hit.error };

  try {
    const own = await loadJijukOwnGbn(hit.parcels.map((p) => p.pnu));
    return {
      parcels: hit.parcels.map((p) => ({
        address: p.address,
        pnu: p.pnu,
        jimok: p.jimok ?? '',
        ownGbn: own.get(p.pnu) || '미상',
        areaSqm: p.areaSqm ?? null,
        intersectAreaSqm: p.intersectAreaSqm ?? null,
        geometry3857: p.geometry3857 ?? null,
        extent3857: p.extent3857 ?? null,
      })),
      truncated: hit.parcels.length >= PARCEL_LIMIT,
    };
  } catch (e: unknown) {
    return { parcels: [], error: e instanceof Error ? e.message : String(e) };
  }
}
