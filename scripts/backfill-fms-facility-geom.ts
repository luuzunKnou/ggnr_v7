/**
 * 기존 FMS 시설 geom 적재 (주소 → 필지, 실패 시 시설명 명칭점 → 필지)
 * 사용: npx tsx scripts/backfill-fms-facility-geom.ts build_uj dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
const limitArg = process.argv[4];
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const { backfillFmsFacilityGeom } = await import('../src/lib/fmsLinkage/backfillFacilityGeom');
  const limit = limitArg ? Number(limitArg) : 5000;
  console.log(`[backfill-fms-facility-geom] project=${project} type=${type} limit=${limit}`);
  const result = await backfillFmsFacilityGeom({ limit });
  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
