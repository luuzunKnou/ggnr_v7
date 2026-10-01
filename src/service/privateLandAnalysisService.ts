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
}): Promise<{ geometry3857?: Geo | null; tooLarge?: boolean; error?: string }> {
  const bbox = Array.isArray(params?.bbox) ? params.bbox.map(toNum) : [];
  if (bbox.length !== 4 || bbox.some((v) => v == null)) return { error: '범위가 없습니다.' };
  const [x1, y1, x2, y2] = bbox as number[];
  const tolerance = Math.max(0, toNum(params?.tolerance) ?? 0);
  const target = await resolveTarget(params?.layer);
  if (!target) return { error: '분석할 수 없는 레이어입니다.' };
  const { qualified, srid, mode } = target;
  if (mode !== 'closed' && (x2 - x1 > VIEW_MAX_SPAN_M || y2 - y1 > VIEW_MAX_SPAN_M)) return { tooLarge: true };
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

    const res = await db.execute(
      sql.raw(
        `WITH area AS (SELECT ST_Buffer(${pointSql}, ${BASE_RADIUS_M}) AS g),
         src AS (
           SELECT ST_CollectionExtract(
             ST_MakeValid(ST_Buffer(ST_Buffer(ST_UnaryUnion(ST_Collect(${featGeom})), ${GAP_CLOSE_M}), -${GAP_CLOSE_M})),
             3
           ) AS g
           FROM ${qualified} f, area a
           WHERE f.geom IS NOT NULL
             AND f.geom && ST_Transform(a.g, ${srid})
             AND ST_Intersects(${featGeom}, a.g)${riverWhereSql(target, river)}
         )
         SELECT CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL
                ELSE ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(g, 0.1), 3857))::json END AS geometry3857
         FROM src`
      )
    );
    const row = res.rows?.[0] as { geometry3857?: Geo | null } | undefined;
    const geometry3857 = row?.geometry3857 && typeof row.geometry3857 === 'object' ? row.geometry3857 : null;
    if (!geometry3857) return { inside: false, error: '하천 도형을 불러오지 못했습니다.' };
    return { inside: true, name, river, geometry3857 };
  } catch (e: unknown) {
    return { inside: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function extendLineSql(alias: string, marginM: number = LINE_END_MARGIN_M): string {
  const dx = `(ST_X(ST_EndPoint(${alias}.g)) - ST_X(ST_StartPoint(${alias}.g))) / ST_Length(${alias}.g) * ${marginM}`;
  const dy = `(ST_Y(ST_EndPoint(${alias}.g)) - ST_Y(ST_StartPoint(${alias}.g))) / ST_Length(${alias}.g) * ${marginM}`;
  return `
    CASE
      WHEN ST_Length(${alias}.g) < 1e-3 THEN ${alias}.g
      ELSE ST_MakeLine(
        ST_Translate(ST_StartPoint(${alias}.g), -${dx}, -${dy}),
        ST_Translate(ST_EndPoint(${alias}.g), ${dx}, ${dy})
      )
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
  error?: string;
};

const MAX_TRIBUTARY_LINES = 20;
/** 본류와 지류 차이에서 남는 가는 틈 제거(m) */
const SLIVER_M = 1;
const MIN_TRIBUTARY_AREA_SQM = 30;

function isLineWkt(v: unknown): v is string {
  return typeof v === 'string' && /^LINESTRING/i.test(v.trim());
}

function parseLine3857(wkt: string): [number, number, number, number] | null {
  const m = /^LINESTRING\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/i.exec(
    wkt.trim()
  );
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
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
/** 두 선 사이 거리 × 폭 여유. 잘림 실패로 하천 전체가 잡히면 거절 */
const ZONE_WIDTH_M = 150;
const ZONE_WIND_FACTOR = 12;

/**
 * 여러 선으로 면을 자른 뒤, 선을 건너지 않고 이어진 조각 묶음 중
 * 1·2번 선(시작·끝)에 모두 닿는 묶음만 고른다. 둘 이상이면 두 선 사이 복도에 걸치고 면적이 작은 쪽.
 * 3번 이후 선(지류 자르기)은 자르기만 한다.
 */
function zoneMidCtes(target: Target, lines: string[], riverWhere: string): string {
  const { qualified, srid } = target;
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
  return `
    lines_raw AS (
      SELECT v.ord, ST_Transform(ST_MakeValid(ST_SetSRID(ST_GeomFromText(v.wkt), 3857)), ${WORK_SRID}) AS g
      FROM (VALUES ${values}) AS v(ord, wkt)
    ),
    lines AS (SELECT r.ord, ${extendLineSql('r')} AS g FROM lines_raw r),
    blade AS (SELECT ST_Collect(g) AS g FROM lines),
    l1 AS (SELECT g FROM lines WHERE ord = 1),
    l2 AS (SELECT g FROM lines WHERE ord = 2),
    area AS (
      SELECT ST_Expand(
        ST_Envelope(b.g),
        GREATEST(300, ST_Distance(ST_Centroid(l1.g), ST_Centroid(l2.g)))
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
    ),${splits}
    parts AS (
      SELECT row_number() OVER () AS id, d.g
      FROM (
        SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(g), 3))).geom AS g
        FROM s${lines.length}
        WHERE g IS NOT NULL
      ) d
      WHERE ST_Area(d.g) > 0.01
    ),
    cut_zone AS (SELECT ST_Buffer(b.g, 4) AS g FROM blade b),
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
             bool_or(ST_DWithin(p.g, l1.g, 2)) AS t1,
             bool_or(ST_DWithin(p.g, l2.g, 2)) AS t2
      FROM comp_min cm
      JOIN parts p ON p.id = cm.id
      CROSS JOIN l1
      CROSS JOIN l2
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

/** 전체 하천(지류 포함) 구간에서 본류 구간을 뺀 지류 조각 */
function tributaryPiecesCte(mainWkt: string): string {
  return `
    main AS (SELECT ST_SetSRID(ST_GeomFromText('${esc(mainWkt)}'), ${WORK_SRID}) AS g),
    pieces AS (
      SELECT d.geom AS g
      FROM mid, main,
      LATERAL ST_Dump(
        ST_CollectionExtract(
          ST_MakeValid(ST_Buffer(ST_Buffer(ST_Difference(mid.g, ST_Buffer(main.g, 0.5)), -${SLIVER_M}), ${SLIVER_M})),
          3
        )
      ) AS d
      WHERE ST_Area(d.geom) > ${MIN_TRIBUTARY_AREA_SQM}
        AND NOT EXISTS (SELECT 1 FROM lines l WHERE l.ord <= 2 AND ST_DWithin(d.geom, l.g, ${CUT_TOUCH_M}))
    )`;
}

/** 구간 경계에서 이만큼 안쪽에 절단선이 지나가면 잘림 실패로 본다(m) */
const LEAK_INSET_M = 1;

/**
 * 호출부는 `FROM mid zg` · `FROM final zg` 처럼 zg 별칭을 붙인다.
 * leak — 절단선이 구간 안쪽을 지나감(선이 하천을 끝까지 자르지 못해 구간이 선 너머로 이어짐)
 */
const ZONE_SELECT_SQL = `
  SELECT
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN NULL ELSE ST_AsText(zg.g) END AS wkt5181,
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN NULL ELSE ST_AsGeoJSON(ST_Transform(zg.g, 3857))::json END AS geometry3857,
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN NULL ELSE ST_Area(zg.g) END AS area_sqm,
    CASE WHEN zg.g IS NULL OR ST_IsEmpty(zg.g) THEN false
         ELSE EXISTS (SELECT 1 FROM lines_raw r WHERE ST_Intersects(ST_Buffer(zg.g, -${LEAK_INSET_M}), r.g)) END AS leak`;

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

async function runMainZone(target: Target, lines: string[], river: unknown): Promise<ZoneResult | null> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, riverWhereSql(target, river))}
      ${ZONE_SELECT_SQL}
      FROM mid zg`)
  );
  return readZoneRow(res.rows);
}

/** 지류 후보 — 전체 하천을 시작·끝선으로 자른 구간에서 본류 구간을 뺀 조각들 */
async function runTributaryCandidates(target: Target, lines: string[], mainWkt: string): Promise<Geo[]> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, '')}, ${tributaryPiecesCte(mainWkt)}
      SELECT ST_AsGeoJSON(ST_Transform(g, 3857))::json AS geometry3857 FROM pieces`)
  );
  return (res.rows ?? [])
    .map((r) => (r as { geometry3857?: Geo | null }).geometry3857)
    .filter((g): g is Geo => g != null && typeof g === 'object');
}

/** 본류 구간 + 지류 자르기 선까지의 지류 조각. 자르지 않은 지류는 제외 */
async function runZoneWithTributaries(target: Target, lines: string[], mainWkt: string): Promise<ZoneResult | null> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, '')}, ${tributaryPiecesCte(mainWkt)},
      kept AS (
        SELECT p.g FROM pieces p
        WHERE EXISTS (SELECT 1 FROM lines_raw t WHERE t.ord > 2 AND ST_DWithin(p.g, t.g, 3))
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
      ${ZONE_SELECT_SQL}
      FROM final zg`)
  );
  return readZoneRow(res.rows);
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
        (SELECT bool_or(open) FROM ranked WHERE n = ${lines.length}) AS open_any
        FROM mid zg`)
    );
    const row = res.rows?.[0] as { open_any?: unknown } | undefined;
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

    const candidates = await runTributaryCandidates(target, [line1, line2], main.wkt5181);
    const tribLines = (Array.isArray(params.tributaryLines) ? params.tributaryLines : [])
      .filter(isLineWkt)
      .slice(0, MAX_TRIBUTARY_LINES);
    if (tribLines.length === 0) return { ...main, tributaryCandidates3857: candidates };

    const withTrib = await runZoneWithTributaries(target, [line1, line2, ...tribLines], main.wkt5181);
    if (withTrib?.leak) {
      return {
        ...empty,
        tributaryCandidates3857: candidates,
        error: '지류 끝선이 지류를 끝까지 자르지 못했습니다. 지류 끝 위치를 다시 찍으세요.',
      };
    }
    return { ...(withTrib ?? main), tributaryCandidates3857: candidates };
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
  error?: string;
}> {
  const zone = await computeZone(params ?? {});
  return {
    zoneGeometry3857: zone.geometry3857,
    areaSqm: zone.areaSqm,
    tributaryCandidates3857: zone.tributaryCandidates3857,
    open: zone.open,
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
