/**
 * 접도구역 표주 — 레거시 주소 컬럼 정리·샘플 확인 (필요 시)
 *
 * 사용:
 *   npx tsx scripts/migrate-road-frontage-marker-address.ts build_yy dev
 */
import type { Pool } from 'pg';
import { loadProjectEnv } from './load-project-env';

const LOG = '[migrate-road-frontage-marker-address]';

const LEGACY_COLS = [
  'county',
  'myeon',
  'ri',
  'lot_no',
  'lon',
  'lat',
  'sort_no',
  'is_del',
  'create_date',
  'create_user',
  'update_date',
  'update_user',
] as const;

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'layer' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [table, column]
  );
  return (res.rowCount ?? 0) > 0;
}

async function dropLegacyColumns(pool: Pool): Promise<void> {
  for (const table of ['road_frontage_marker_item', 'road_frontage_marker'] as const) {
    for (const col of LEGACY_COLS) {
      if (!(await columnExists(pool, table, col))) continue;
      await pool.query(`ALTER TABLE layer.${table} DROP COLUMN IF EXISTS ${col}`);
      console.log(`${LOG} dropped ${table}.${col}`);
    }
  }
}

function parseArgs(): { project: string; type: string } {
  const argv = process.argv.slice(2);
  return {
    project: argv[0] || 'build_yy',
    type: argv[1] || 'dev',
  };
}

async function main() {
  const { project, type } = parseArgs();
  loadProjectEnv(project, type);

  const { pool } = await import('../src/database/db');
  const { ensureRoadFrontageMarkerTables } = await import('../src/service/ensureLayerAppTables');
  await ensureRoadFrontageMarkerTables();

  await dropLegacyColumns(pool);

  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS n FROM layer.road_frontage_marker_item`
  );
  console.log(`${LOG} items=${cnt.rows[0]?.n ?? 0}`);
  await pool.end();
}

main().catch((e) => {
  console.error(LOG, e);
  process.exit(1);
});
