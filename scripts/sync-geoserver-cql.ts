/**
 * tables.json 분할(div_query) → GeoServer FeatureType CQL 일괄 동기화
 * 사용: npx tsx scripts/sync-geoserver-cql.ts build_uj dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
const url = process.argv[4] || process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver';

loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const { syncGeoServerCqlFiltersFromDefine } = await import('../src/service/devTestService');
  console.log(`[sync-cql] project=${project} type=${type} url=${url}`);
  const result = await syncGeoServerCqlFiltersFromDefine({ url });
  console.log('[sync-cql] summary:', result.summary ?? {
    updated: result.updated?.length ?? 0,
    skipped: result.skipped?.length ?? 0,
    failed: result.failed?.length ?? 0,
  });
  if (result.error) console.error('[sync-cql] error:', result.error);
  if (result.updated?.length) {
    console.log('[sync-cql] updated sample:', result.updated.slice(0, 15));
  }
  if (result.skipped?.length) {
    console.log('[sync-cql] skipped sample:', result.skipped.slice(0, 10));
  }
  if (result.failed?.length) {
    console.error('[sync-cql] failed:', result.failed);
  }
  process.exit(result.success ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
