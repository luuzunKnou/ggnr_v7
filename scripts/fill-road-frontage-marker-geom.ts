/**
 * 접도구역 표주 — 설치위치·지목 분리 + 점 + 관리대장 점 모음 보강
 *
 * 사용:
 *   npx tsx scripts/fill-road-frontage-marker-geom.ts build_yy dev
 *   npx tsx scripts/fill-road-frontage-marker-geom.ts build_yy dev --refresh
 */
import { loadProjectEnv } from './load-project-env';

const LOG = '[fill-road-frontage-marker-geom]';

function parseArgs(): { project: string; type: string; refreshAll: boolean } {
  const argv = process.argv.slice(2);
  const positional: string[] = [];
  let refreshAll = false;
  for (const a of argv) {
    if (a === '--refresh') {
      refreshAll = true;
      continue;
    }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  return {
    project: positional[0] || 'build_yy',
    type: positional[1] || 'dev',
    refreshAll,
  };
}

async function main() {
  const { project, type, refreshAll } = parseArgs();
  loadProjectEnv(project, type);

  const { ensureRoadFrontageMarkerTables } = await import('../src/service/ensureLayerAppTables');
  await ensureRoadFrontageMarkerTables();

  const { fillMissingInstallLocationAndGeom } = await import(
    '../src/service/roadFrontageMarkerService'
  );
  const filled = await fillMissingInstallLocationAndGeom({ refreshAll, limit: 10000 });
  console.log(
    `${LOG} updated=${filled.updated} withGeom=${filled.withGeom} failed=${filled.failed}`
  );

  const { pool } = await import('../src/database/db');
  const parents = await pool.query(`
    SELECT
      count(*) FILTER (WHERE geom IS NOT NULL)::int AS with_geom,
      count(*)::int AS total
    FROM layer.road_frontage_marker
  `);
  const items = await pool.query(`
    SELECT
      count(*) FILTER (WHERE i.geom IS NOT NULL)::int AS with_geom,
      count(*)::int AS total
    FROM layer.road_frontage_marker_item i
  `);
  console.log(`${LOG} ledger geom`, parents.rows[0]);
  console.log(`${LOG} item geom`, items.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(LOG, e);
  process.exit(1);
});
