/**
 * layer 스키마에 공통 점용대장·점사용료 빈 테이블 생성
 * (본대·지적·물건지 × 하천/도로/국공유지 + ngl_fee_list × 3 = 12개)
 * 사용: npx tsx scripts/ensure-occupation-ledger-tables.ts build_uj dev
 *
 * 실제 DDL은 ensureLayerAppTables(기동 시와 동일)를 호출한다.
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const {
    ensureOccupationLedgerTables,
    ensureNglFeeListTables,
  } = await import('../src/service/ensureLayerAppTables');

  const result = {
    created: [] as string[],
    moved: [] as string[],
    existed: [] as string[],
    errors: [] as string[],
  };
  await ensureOccupationLedgerTables(result);
  await ensureNglFeeListTables(result);

  for (const t of result.created) console.log('[created]', t);
  for (const t of result.moved) console.log('[moved]', t);
  for (const t of result.existed) console.log('[exists]', t);
  for (const t of result.errors) console.error('[error]', t);

  console.log(
    `[done] occupation+fee tables — created ${result.created.length}, existed ${result.existed.length}, errors ${result.errors.length}`
  );
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
