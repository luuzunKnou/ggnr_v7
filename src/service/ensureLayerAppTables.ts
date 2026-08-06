/**
 * 서버 기동 시 앱 필수 layer 테이블 확보 (없으면 생성, public에만 있으면 layer로 이동).
 * - 도로점용: road_use_ledger, road_use_ledger_jijuk
 * - 메모: memo 및 memo_* 계열
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { MEMO_TABLES } from '@/lib/memoConfig';

type EnsureResult = {
  created: string[];
  moved: string[];
  existed: string[];
  errors: string[];
};

async function tableExists(schema: string, table: string): Promise<'BASE TABLE' | 'VIEW' | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_type
       FROM information_schema.tables
       WHERE table_schema = '${schema.replace(/'/g, "''")}'
         AND table_name = '${table.replace(/'/g, "''")}'
       LIMIT 1`
    )
  );
  const t = String((res.rows?.[0] as { table_type?: string } | undefined)?.table_type ?? '');
  if (t === 'BASE TABLE' || t === 'VIEW') return t;
  return null;
}

async function ensureSchemaLayer(): Promise<void> {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS layer`));
}

async function execSqlStatements(raw: string): Promise<void> {
  const parts = raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const part of parts) {
    await db.execute(sql.raw(part));
  }
}

/**
 * layer에 실테이블이 있으면 유지.
 * VIEW만 있으면 제거하고 public 실테이블을 옮기거나 새로 만든다.
 */
async function ensureBaseTable(params: {
  table: string;
  createSql: string;
  result: EnsureResult;
}): Promise<void> {
  const { table, createSql, result } = params;
  const fq = `layer.${table}`;

  try {
    const layerType = await tableExists('layer', table);
    if (layerType === 'BASE TABLE') {
      result.existed.push(fq);
      return;
    }
    if (layerType === 'VIEW') {
      await db.execute(sql.raw(`DROP VIEW IF EXISTS layer."${table}" CASCADE`));
    }

    const publicType = await tableExists('public', table);
    if (publicType === 'BASE TABLE') {
      await db.execute(sql.raw(`ALTER TABLE public."${table}" SET SCHEMA layer`));
      result.moved.push(fq);
      return;
    }

    await execSqlStatements(createSql);
    result.created.push(fq);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}: ${msg}`);
  }
}

const ROAD_USE_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_use_ledger (
  id SERIAL PRIMARY KEY,
  geom geometry(Polygon, 5181),
  parcel_address text,
  use_no text,
  use_permit_date text,
  use_road_type text,
  use_road_name text,
  use_addr text,
  use_mgj text,
  use_why text,
  use_lic_addr text,
  use_lic_tel text,
  use_lic_name text,
  use_area double precision,
  use_start text,
  use_end text
);
CREATE INDEX IF NOT EXISTS road_use_ledger_geom_gix ON layer.road_use_ledger USING GIST (geom);
COMMENT ON TABLE layer.road_use_ledger IS '도로점용 대장';
`;

const ROAD_USE_LEDGER_JIJUK_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_use_ledger_jijuk (
  id SERIAL PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES layer.road_use_ledger (id) ON DELETE CASCADE,
  geom geometry(Polygon, 5181),
  parcel_address text
);
CREATE INDEX IF NOT EXISTS road_use_ledger_jijuk_parent_id_idx
  ON layer.road_use_ledger_jijuk (parent_id);
CREATE INDEX IF NOT EXISTS road_use_ledger_jijuk_geom_gix
  ON layer.road_use_ledger_jijuk USING GIST (geom);
COMMENT ON TABLE layer.road_use_ledger_jijuk IS '도로점용 대장 필지목록';
`;

function memoCreateSql(tableName: string): string {
  const t = tableName.replace(/"/g, '""');
  return `
CREATE TABLE IF NOT EXISTS layer."${t}" (
  memo_key SERIAL PRIMARY KEY,
  geom geometry(Point, 5181),
  memo_title text,
  memo_contents text,
  memo_create_date text,
  memo_create_user text,
  memo_create_group text,
  memo_is_del boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS "${t}_geom_gix" ON layer."${t}" USING GIST (geom);
COMMENT ON TABLE layer."${t}" IS '메모';
`;
}

export async function ensureRoadUseLedgerTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  // 부모 먼저
  await ensureBaseTable({
    table: 'road_use_ledger',
    createSql: ROAD_USE_LEDGER_SQL,
    result: out,
  });
  await ensureBaseTable({
    table: 'road_use_ledger_jijuk',
    createSql: ROAD_USE_LEDGER_JIJUK_SQL,
    result: out,
  });
  return out;
}

export async function ensureMemoTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  for (const m of MEMO_TABLES) {
    await ensureBaseTable({
      table: m.tableName,
      createSql: memoCreateSql(m.tableName),
      result: out,
    });
  }
  return out;
}

/** instrumentation / 수동 호출용 */
export async function ensureLayerAppTables(): Promise<EnsureResult> {
  const result: EnsureResult = { created: [], moved: [], existed: [], errors: [] };
  try {
    await ensureSchemaLayer();
    await ensureRoadUseLedgerTables(result);
    await ensureMemoTables(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
  }
  return result;
}
