import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { listJijukParcelsByGeomWkt5181 } from '@/service/layerRowService';
import { loadJijukOwnGbn } from '@/service/riverBasicPlanService';
import {
  isPrivateLandAnalysisLayer,
  privateLandAnalysisLayersFor,
  type PrivateLandAnalysisLayer,
} from '@/lib/privateLandAnalysisLayers';

/** 분석 도형 계산 좌표계 (지적과 동일, 미터) */
const WORK_SRID = 5181;
/** 찍은 지점 주변에서 불러올 하천 면 반경(m) */
const BASE_RADIUS_M = 5000;
/** 하천 도형 사이 작은 틈 메움(m) */
const GAP_CLOSE_M = 0.5;
/** 절단선 끝이 경계에 살짝 못 미쳐도 자르도록 양끝 연장(m) */
const LINE_END_MARGIN_M = 5;
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

type Target = { qualified: string; srid: number; riverCols: RiverKeyColumn[] };

function riverWhereSql(target: Target, key: unknown): string {
  const k = key as Partial<PrivateLandRiverKey> | null | undefined;
  const field = String(k?.field ?? '') as RiverKeyColumn;
  const value = String(k?.value ?? '').trim();
  if (!value || !target.riverCols.includes(field)) return '';
  return ` AND TRIM(f.${quoteIdent(field)}::text) = '${esc(value)}'`;
}

/** layer 스키마 실제 테이블명 + 도형 SRID. 허용 레이어가 아니거나 없으면 null */
async function resolveTarget(layer: unknown): Promise<Target | null> {
  const wanted = String(layer ?? '').trim().toLowerCase();
  if (!isPrivateLandAnalysisLayer(wanted)) return null;
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${esc(wanted)}'
       LIMIT 1`
    )
  );
  const name = String((res.rows?.[0] as { table_name?: string } | undefined)?.table_name ?? '').trim();
  if (!name) return null;
  const qualified = `layer.${quoteIdent(name)}`;
  const sridRes = await db.execute(
    sql.raw(`SELECT ST_SRID(geom) AS srid FROM ${qualified} WHERE geom IS NOT NULL LIMIT 1`)
  );
  const srid = toNum((sridRes.rows?.[0] as { srid?: unknown } | undefined)?.srid) || WORK_SRID;
  const colRes = await db.execute(
    sql.raw(
      `SELECT lower(column_name) AS c
       FROM information_schema.columns
       WHERE table_schema = 'layer' AND table_name = '${esc(name)}'
         AND lower(column_name) IN (${RIVER_KEY_COLUMNS.map((c) => `'${c}'`).join(',')})`
    )
  );
  const found = new Set((colRes.rows ?? []).map((r) => String((r as { c?: string }).c ?? '')));
  const riverCols = RIVER_KEY_COLUMNS.filter((c) => found.has(c));
  return { qualified, srid, riverCols };
}

/** 선택 가능한 분석 대상 레이어 (DB에 테이블이 있는 것만) */
export async function listPrivateLandAnalysisLayers(params?: {
  system?: string;
}): Promise<{ layers: PrivateLandAnalysisLayer[] }> {
  const candidates = privateLandAnalysisLayersFor(params?.system);
  if (candidates.length === 0) return { layers: [] };
  const inList = candidates.map((l) => `'${esc(l.table)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT lower(table_name) AS t
       FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) IN (${inList})`
    )
  );
  const found = new Set((res.rows ?? []).map((r) => String((r as { t?: string }).t ?? '')));
  return { layers: candidates.filter((l) => found.has(l.table)) };
}

/** 화면 범위 레이어 도형 조회 상한 — 이보다 넓으면 커서 구분 생략(m) */
const VIEW_MAX_SPAN_M = 30000;

/**
 * 시작 위치 찍기 전 커서 구분용 — 현재 화면 범위 안 레이어 면(EPSG:3857 GeoJSON, 화면 해상도로 단순화).
 * 화면이 너무 넓으면 tooLarge.
 */
export async function getPrivateLandAnalysisLayerView(params?: {
  layer?: string;
  bbox?: number[];
  tolerance?: number;
}): Promise<{ geometry3857?: Geo | null; tooLarge?: boolean; error?: string }> {
  const bbox = Array.isArray(params?.bbox) ? params.bbox.map(toNum) : [];
  if (bbox.length !== 4 || bbox.some((v) => v == null)) return { error: '범위가 없습니다.' };
  const [x1, y1, x2, y2] = bbox as number[];
  if (x2 - x1 > VIEW_MAX_SPAN_M || y2 - y1 > VIEW_MAX_SPAN_M) return { tooLarge: true };
  const tolerance = Math.max(0, toNum(params?.tolerance) ?? 0);
  const target = await resolveTarget(params?.layer);
  if (!target) return { error: '분석할 수 없는 레이어입니다.' };
  const { qualified, srid } = target;

  try {
    const res = await db.execute(
      sql.raw(
        `WITH env AS (SELECT ST_Transform(ST_MakeEnvelope(${x1}, ${y1}, ${x2}, ${y2}, 3857), ${srid}) AS g),
         src AS (
           SELECT ST_CollectionExtract(
             ST_MakeValid(ST_SimplifyPreserveTopology(
               ST_Transform(ST_Collect(ST_Intersection(ST_MakeValid(f.geom), e.g)), 3857),
               ${tolerance}
             )),
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

function extendLineSql(alias: string): string {
  const dx = `(ST_X(ST_EndPoint(${alias}.g)) - ST_X(ST_StartPoint(${alias}.g))) / ST_Length(${alias}.g) * ${LINE_END_MARGIN_M}`;
  const dy = `(ST_Y(ST_EndPoint(${alias}.g)) - ST_Y(ST_StartPoint(${alias}.g))) / ST_Length(${alias}.g) * ${LINE_END_MARGIN_M}`;
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
};

type ZoneResult = {
  wkt5181: string | null;
  geometry3857: Geo | null;
  areaSqm: number | null;
  /** 지류 포함 시 — 본류 구간에 합류하는 지류 후보 */
  tributaryCandidates3857?: Geo[];
  error?: string;
};

const MAX_TRIBUTARY_LINES = 20;
/** 본류와 지류 차이에서 남는 가는 틈 제거(m) */
const SLIVER_M = 1;
const MIN_TRIBUTARY_AREA_SQM = 30;

function isLineWkt(v: unknown): v is string {
  return typeof v === 'string' && /^LINESTRING/i.test(v.trim());
}

/**
 * 여러 선으로 면을 자른 뒤, 선을 건너지 않고 이어진 조각 묶음 중 1·2번 선(시작·끝)에 모두 닿는 묶음.
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
      SELECT ST_Collect(ST_Split(d.geom, (SELECT g FROM lines WHERE ord = ${i + 1}))) AS g
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
    cut_zone AS (SELECT ST_Buffer(b.g, 2.5) AS g FROM blade b),
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
    mid AS (
      SELECT ST_CollectionExtract(ST_MakeValid(ST_UnaryUnion(ST_Collect(p.g))), 3) AS g
      FROM parts p
      JOIN comp_min cm ON cm.id = p.id
      JOIN comp_touch ct ON ct.r = cm.r
      WHERE ct.t1 AND ct.t2
    )`;
}

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
    )`;
}

const ZONE_SELECT_SQL = `
  SELECT
    CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsText(g) END AS wkt5181,
    CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(ST_Transform(g, 3857))::json END AS geometry3857,
    CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_Area(g) END AS area_sqm`;

function readZoneRow(rows: unknown[] | undefined): ZoneResult | null {
  const row = rows?.[0] as { wkt5181?: string | null; geometry3857?: Geo | null; area_sqm?: unknown } | undefined;
  const wkt5181 = String(row?.wkt5181 ?? '').trim();
  if (!wkt5181) return null;
  return {
    wkt5181,
    geometry3857: row?.geometry3857 && typeof row.geometry3857 === 'object' ? row.geometry3857 : null,
    areaSqm: toNum(row?.area_sqm),
  };
}

async function runMainZone(target: Target, lines: string[], river: unknown): Promise<ZoneResult | null> {
  const res = await db.execute(
    sql.raw(`WITH RECURSIVE ${zoneMidCtes(target, lines, riverWhereSql(target, river))}
      ${ZONE_SELECT_SQL}
      FROM mid`)
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
        WHERE EXISTS (SELECT 1 FROM lines t WHERE t.ord > 2 AND ST_DWithin(p.g, t.g, 3))
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
      FROM final`)
  );
  return readZoneRow(res.rows);
}

/**
 * 시작·끝 절단선 사이 하천 구간 (WORK_SRID WKT + 3857 GeoJSON).
 * 같은 하천(본류)만으로 계산하고, 지류 포함이면 자른 지류 조각을 더한다.
 */
async function computeZone(params: ZoneParams): Promise<ZoneResult> {
  const empty: ZoneResult = { wkt5181: null, geometry3857: null, areaSqm: null };
  const line1 = String(params.line1Wkt3857 ?? '').trim();
  const line2 = String(params.line2Wkt3857 ?? '').trim();
  if (!isLineWkt(line1) || !isLineWkt(line2)) return { ...empty, error: '시작선·끝선이 필요합니다.' };
  const target = await resolveTarget(params.layer);
  if (!target) return { ...empty, error: '분석할 수 없는 레이어입니다.' };

  try {
    const main = await runMainZone(target, [line1, line2], params.river);
    if (!main?.wkt5181) {
      return { ...empty, error: '두 선 사이의 구간을 찾지 못했습니다. 구간을 다시 지정하세요.' };
    }
    const hasRiver = riverWhereSql(target, params.river) !== '';
    if (!params.includeTributary || !hasRiver) return main;

    const candidates = await runTributaryCandidates(target, [line1, line2], main.wkt5181);
    const tribLines = (Array.isArray(params.tributaryLines) ? params.tributaryLines : [])
      .filter(isLineWkt)
      .slice(0, MAX_TRIBUTARY_LINES);
    if (tribLines.length === 0) return { ...main, tributaryCandidates3857: candidates };

    const withTrib = await runZoneWithTributaries(target, [line1, line2, ...tribLines], main.wkt5181);
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
  error?: string;
}> {
  const zone = await computeZone(params ?? {});
  return {
    zoneGeometry3857: zone.geometry3857,
    areaSqm: zone.areaSqm,
    tributaryCandidates3857: zone.tributaryCandidates3857,
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
