/**
 * 교량(a0070000)이 있는 모든 프로젝트 DB에 선형 뷰(a0070000_ls) 생성
 * + (가능하면) GeoServer 레이어·스타일 등록
 *
 * 사용:
 *   npx tsx scripts/setup-a0070000-ls.ts              # 전 프로젝트(교량 있는 것만)
 *   npx tsx scripts/setup-a0070000-ls.ts all dev
 *   npx tsx scripts/setup-a0070000-ls.ts road_cd dev
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { loadProjectEnv } from './load-project-env';

const LAYER_NAME = 'a0070000_ls';
const SOURCE_TABLE = 'a0070000';
const PROJECTS_DIR = path.join(process.cwd(), 'src', 'config', 'projects');

function listAllProjects(): string[] {
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith('.env') && !f.endsWith('.runtime.env') && f !== 'common.env')
    .map((f) => f.replace(/\.env$/, ''))
    .sort();
}

function resolveProjects(): string[] {
  const arg = String(process.argv[2] ?? 'all').trim().toLowerCase();
  if (arg === 'all' || arg === '') return listAllProjects();
  return [arg];
}

function resolveEnvSection(): string {
  return String(process.argv[3] ?? 'dev').trim().toLowerCase() || 'dev';
}

function quoteIdent(col: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(col)) return col;
  return `"${col.replace(/"/g, '""')}"`;
}

/** 컬럼 세트에 맞춰 뷰 SQL 생성 (rdid·교량명 없으면 NULL) */
function buildViewSql(brdgExpr: string, rdidExpr: string): string {
  return `
CREATE OR REPLACE VIEW layer.${LAYER_NAME} AS
WITH parts AS (
  SELECT ogc_fid,
         ${rdidExpr} AS rdid,
         ${brdgExpr} AS brdg_name,
         ST_OrientedEnvelope((ST_Dump(geom)).geom) AS env
  FROM layer.${SOURCE_TABLE}
  WHERE geom IS NOT NULL
    AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
),
p AS (
  SELECT ogc_fid, rdid, brdg_name,
    ST_PointN(ST_ExteriorRing(env), 1) a,
    ST_PointN(ST_ExteriorRing(env), 2) b,
    ST_PointN(ST_ExteriorRing(env), 3) c,
    ST_PointN(ST_ExteriorRing(env), 4) d
  FROM parts
  WHERE ST_GeometryType(env) = 'ST_Polygon'
),
s AS (
  SELECT ogc_fid, rdid, brdg_name,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN a ELSE b END AS a,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN b ELSE c END AS b,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN c ELSE d END AS c,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN d ELSE a END AS d
  FROM p
),
v AS (
  SELECT ogc_fid, rdid, brdg_name,
    ST_X(a) ax, ST_Y(a) ay, ST_X(b) bx, ST_Y(b) by,
    ST_X(c) cx, ST_Y(c) cy, ST_X(d) dx, ST_Y(d) dy,
    ST_Distance(a, b) lab, ST_Distance(a, d) lad,
    3.0 AS f,
    2.0 AS w
  FROM s
),
u AS (
  SELECT *,
    (bx - ax) / lab AS ux, (by - ay) / lab AS uy,
    (ax - dx) / lad AS nx, (ay - dy) / lad AS ny
  FROM v
  WHERE lab > 0 AND lad > 0
),
l AS (
  SELECT ogc_fid, rdid, brdg_name,
    ST_MakeLine(ARRAY[
      ST_MakePoint(ax - ux * f + nx * w, ay - uy * f + ny * w),
      ST_MakePoint(ax, ay),
      ST_MakePoint(bx, by),
      ST_MakePoint(bx + ux * f + nx * w, by + uy * f + ny * w)
    ]) AS line1,
    ST_MakeLine(ARRAY[
      ST_MakePoint(dx - ux * f - nx * w, dy - uy * f - ny * w),
      ST_MakePoint(dx, dy),
      ST_MakePoint(cx, cy),
      ST_MakePoint(cx + ux * f - nx * w, cy + uy * f - ny * w)
    ]) AS line2
  FROM u
)
SELECT ogc_fid,
       rdid,
       brdg_name,
       ST_SetSRID(ST_Multi(ST_Collect(x)), 5181)::geometry(MultiLineString, 5181) AS geom
FROM l, LATERAL unnest(ARRAY[line1, line2]) AS x
GROUP BY ogc_fid, rdid, brdg_name;

COMMENT ON VIEW layer.${LAYER_NAME} IS '교량(a0070000) 양쪽 선형 표현 뷰';
`.trim();
}

type EnsureResult = 'created' | 'skipped' | 'failed';

async function ensureView(pool: Pool): Promise<EnsureResult> {
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'layer' AND table_name = $1
     ) AS exists`,
    [SOURCE_TABLE]
  );
  if (!exists.rows[0]?.exists) {
    console.log(`  skip: layer.${SOURCE_TABLE} 없음`);
    return 'skipped';
  }

  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'layer' AND table_name = $1
     ORDER BY ordinal_position`,
    [SOURCE_TABLE]
  );
  const names = new Set(cols.rows.map((r) => String(r.column_name)));
  if (!names.has('geom')) {
    console.log(`  skip: layer.${SOURCE_TABLE}.geom 없음`);
    return 'skipped';
  }
  if (!names.has('ogc_fid')) {
    console.log(`  skip: layer.${SOURCE_TABLE}.ogc_fid 없음`);
    return 'skipped';
  }

  const brdgCol = names.has('brdg_name')
    ? 'brdg_name'
    : names.has('BRDG_NAME')
      ? 'BRDG_NAME'
      : null;
  const rdidCol = names.has('rdid') ? 'rdid' : names.has('RDID') ? 'RDID' : null;

  const brdgExpr = brdgCol ? quoteIdent(brdgCol) : 'NULL::text';
  const rdidExpr = rdidCol ? quoteIdent(rdidCol) : 'NULL::text';
  if (!brdgCol) console.log('  warn: 교량명 컬럼 없음 → NULL');
  if (!rdidCol) console.log('  warn: rdid 컬럼 없음 → NULL');

  await pool.query(buildViewSql(brdgExpr, rdidExpr));

  const cnt = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM layer.${LAYER_NAME}`
  );
  const gc = await pool.query(
    `SELECT f_table_schema, f_table_name, type, srid
     FROM geometry_columns
     WHERE f_table_schema = 'layer' AND f_table_name = $1`,
    [LAYER_NAME]
  );
  console.log(`  view rows=${cnt.rows[0]?.n ?? '?'} geometry_columns=`, gc.rows);
  return 'created';
}

async function publishGeoServer(): Promise<void> {
  const { createOrUpdateGeoServerLayer, applyDefaultStyleToLayer, getLayerTableList } =
    await import('../src/service/devTestService');

  const list = await getLayerTableList();
  const hit = (list.tables ?? []).find(
    (t) => t.schema === 'layer' && String(t.table).toLowerCase() === LAYER_NAME
  );
  console.log('  getLayerTableList hit:', hit ?? '(none)');
  if (!hit) {
    console.log('  skip GeoServer: 현재 DB에 뷰가 geometry_columns에 없음');
    return;
  }

  const layerRes = await createOrUpdateGeoServerLayer({ layerName: LAYER_NAME });
  console.log(
    '  createOrUpdateGeoServerLayer:',
    layerRes.success ? 'ok' : 'error' in layerRes ? layerRes.error : layerRes
  );
  if (!layerRes.success) return;

  const styleRes = await applyDefaultStyleToLayer({ layerName: LAYER_NAME });
  console.log(
    '  applyDefaultStyleToLayer:',
    styleRes.success ? 'ok' : 'error' in styleRes ? styleRes.error : styleRes
  );
}

async function ensureGeoServerUrl(): Promise<void> {
  if (process.env.GEOSERVER_URL?.trim()) return;
  for (const port of [8090, 8080]) {
    const base = `http://127.0.0.1:${port}/geoserver`;
    try {
      const res = await fetch(`${base}/rest/about/version.json`, {
        headers: { Authorization: `Basic ${Buffer.from('admin:geoserver').toString('base64')}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        process.env.GEOSERVER_URL = base;
        console.log(`  GEOSERVER_URL=${base}`);
        return;
      }
    } catch {
      /* try next */
    }
  }
}

async function runOne(project: string, section: string): Promise<EnsureResult> {
  console.log(`\n=== ${project} [${section}] ===`);
  try {
    loadProjectEnv(project, section);
  } catch (e) {
    console.log(`  skip: env 로드 실패 — ${e instanceof Error ? e.message : String(e)}`);
    return 'skipped';
  }
  process.env.GGNR_PROJECT = project;
  process.env.GGNR_ENV = section;
  await ensureGeoServerUrl();

  if (!process.env.DATABASE_HOST || !process.env.DATABASE_NAME) {
    console.log('  skip: DATABASE_* 없음');
    return 'skipped';
  }

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT ? Number(process.env.DATABASE_PORT) : 5432,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    connectionTimeoutMillis: 8000,
  });

  try {
    const result = await ensureView(pool);
    if (result === 'created') {
      await publishGeoServer();
    }
    return result;
  } catch (e) {
    console.log(`  failed: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  } finally {
    await pool.end();
  }
}

async function main() {
  const projects = resolveProjects();
  const section = resolveEnvSection();
  console.log(`projects (${projects.length}): ${projects.join(', ')}`);
  console.log(`env section: ${section}`);

  const summary = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
  for (const p of projects) {
    const r = await runOne(p, section);
    summary[r === 'created' ? 'created' : r === 'failed' ? 'failed' : 'skipped'].push(p);
  }

  console.log('\n--- summary ---');
  console.log('created:', summary.created.join(', ') || '(none)');
  console.log('skipped:', summary.skipped.join(', ') || '(none)');
  console.log('failed:', summary.failed.join(', ') || '(none)');
  console.log('\ndone');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
