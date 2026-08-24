/**
 * fms_linkage.fms_identifier_header — 시설물관리대장(42)·점검진단실적(13) 컬럼 순서·한글명 보정
 * 사용: npx tsx scripts/fix-fms-identifier-header.ts build_uj dev
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';
import {
  defaultHeaderColumnOrder,
  defaultHeaderLabels,
  FMS_HEADER_CODE_FIELDS,
} from '../src/lib/fmsLinkage/fmsHeaderSeed';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

type HeaderRow = {
  col_name: string;
  col_name_kor: string | null;
  ref_name: string | null;
  code_dept: string | null;
};

type PoolLike = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
  end: () => Promise<void>;
};

const IDENTIFIERS = ['BASTB_MASTER', 'MANTB_DIGN_RESULT'] as const;

function metaKey(colName: string): string {
  return String(colName ?? '').trim().toLowerCase();
}

async function ensureMetaTables(pool: PoolLike): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS fms_linkage`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fms_linkage.fms_identifier_header (
      identifier text,
      col_order integer,
      col_name text,
      col_name_kor text,
      ref_name text,
      code_dept text
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fms_linkage.fms_query_table (
      fq_key serial PRIMARY KEY,
      interface_name text,
      identifier text,
      is_active text
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fms_linkage.fms_error_log (
      id serial PRIMARY KEY,
      identifier text,
      error_code text,
      error_message text,
      created_at timestamp
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fms_linkage.fms_code (
      code_key serial PRIMARY KEY,
      code_name text,
      code_kor_name text,
      code1 text,
      code2 text,
      code3 text,
      data1 text,
      data2 text,
      data3 text
    )
  `);

  const qt = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM fms_linkage.fms_query_table`
  );
  if ((qt.rows[0]?.c ?? 0) === 0) {
    await pool.query(
      `INSERT INTO fms_linkage.fms_query_table (interface_name, identifier, is_active)
       VALUES
         ('시설물관리대장', 'BASTB_MASTER', 'Y'),
         ('점검진단실적', 'MANTB_DIGN_RESULT', 'Y')`
    );
    console.log('[fix-fms-header] seeded fms_query_table (2)');
  }

  const codeCnt = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM fms_linkage.fms_code`
  );
  if ((codeCnt.rows[0]?.c ?? 0) === 0) {
    const sqlPath = path.join(process.cwd(), 'scripts', 'fms', 'insert-fms-code.sql');
    const insertSql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(insertSql);
    const after = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM fms_linkage.fms_code`
    );
    console.log(`[fix-fms-header] seeded fms_code (${after.rows[0]?.c ?? 0})`);
  }
}

async function loadExisting(
  pool: PoolLike,
  identifier: string
): Promise<Map<string, HeaderRow>> {
  const r = await pool.query<HeaderRow>(
    `SELECT col_name, col_name_kor, ref_name, code_dept
     FROM fms_linkage.fms_identifier_header
     WHERE identifier = $1`,
    [identifier]
  );
  const map = new Map<string, HeaderRow>();
  for (const row of r.rows) {
    map.set(metaKey(row.col_name), row);
  }
  return map;
}

async function fixIdentifier(
  pool: PoolLike,
  identifier: 'BASTB_MASTER' | 'MANTB_DIGN_RESULT'
): Promise<number> {
  const columns = defaultHeaderColumnOrder(identifier);
  const defaultLabels = defaultHeaderLabels(identifier);
  const existing = await loadExisting(pool, identifier);
  const legacyEtc = existing.get('whl_pht_file_nm');

  await pool.query(`DELETE FROM fms_linkage.fms_identifier_header WHERE identifier = $1`, [
    identifier,
  ]);

  for (let i = 0; i < columns.length; i++) {
    const colName = columns[i]!;
    const key = metaKey(colName);
    const prev = existing.get(key);
    const code = FMS_HEADER_CODE_FIELDS[key];
    const colNameKor =
      defaultLabels[key] ||
      prev?.col_name_kor?.trim() ||
      (key === 'etc_pht_file_ct' ? legacyEtc?.col_name_kor?.trim() : undefined) ||
      colName;

    await pool.query(
      `INSERT INTO fms_linkage.fms_identifier_header
         (identifier, col_order, col_name, col_name_kor, ref_name, code_dept)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        identifier,
        i + 1,
        colName,
        colNameKor,
        prev?.ref_name ?? code?.refName ?? null,
        prev?.code_dept ?? code?.codeDept ?? null,
      ]
    );
  }

  return columns.length;
}

async function main(): Promise<void> {
  const { pool } = await import('../src/database/db');
  console.log(`[fix-fms-header] project=${project} env=${type}`);
  await ensureMetaTables(pool);
  for (const identifier of IDENTIFIERS) {
    const count = await fixIdentifier(pool, identifier);
    console.log(`[fix-fms-header] ${identifier}: ${count} columns`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
