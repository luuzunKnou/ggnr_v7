/**
 * layer 스키마에 공통 점용대장 빈 테이블 생성 (본대·지적·물건지 × 하천/도로/국공유지)
 * 사용: npx tsx scripts/ensure-occupation-ledger-tables.ts build_uj dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

const PREFIXES = ['water', 'road', 'public'] as const;

const MAIN_COLS = `
  ogc_fid serial PRIMARY KEY,
  id text,
  work_name text,
  occup_place text,
  occup_purpose text,
  perm_start_date date,
  perm_end_date date,
  perm_area text,
  permit_no text,
  permit_date date,
  occup_name text,
  occup_phone text,
  applicant_addr text,
  manage_name text,
  state text,
  remark text,
  geom geometry(MultiPolygon, 5181)
`;

const CHILD_COLS = `
  ogc_fid serial PRIMARY KEY,
  id text,
  occup_place text,
  geom geometry(MultiPolygon, 5181)
`;

async function main() {
  const { db } = await import('../src/database/db');
  const { sql } = await import('drizzle-orm');

  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS layer`));
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS postgis`));

  for (const prefix of PREFIXES) {
    const base = `${prefix}_occupationledger`;
    const specs: Array<{ table: string; cols: string }> = [
      { table: base, cols: MAIN_COLS },
      { table: `${base}_jijuk`, cols: CHILD_COLS },
      { table: `${base}_mgj`, cols: CHILD_COLS },
    ];
    for (const { table, cols } of specs) {
      const ddl = `CREATE TABLE IF NOT EXISTS layer.${table} (${cols})`;
      await db.execute(sql.raw(ddl));
      console.log('[ok]', `layer.${table}`);
    }
  }
  console.log('[done] occupation ledger empty tables ready');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
