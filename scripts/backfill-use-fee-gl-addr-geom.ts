/**
 * 점사용료 gl_addr → jijuk 폴리곤 geom 적재
 * 사용: npx tsx scripts/backfill-use-fee-gl-addr-geom.ts build_uj dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
const limit = Math.min(Math.max(Number(process.argv[4]) || 20000, 1), 50000);
const force = process.argv.includes('--force');

loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  console.log(`[backfill-use-fee-geom] project=${project} env=${type} limit=${limit} force=${force}`);
  const { backfillUseFeeGlAddrGeom } = await import('../src/service/useFeeService');
  const result = await backfillUseFeeGlAddrGeom({ force, limit });
  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
