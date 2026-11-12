/**
 * public.data_history 확보
 * - safedata_history 있으면 data_history 로 rename
 * - 없으면 생성
 * 사용: npx tsx scripts/ensure-data-history-table.ts build_yy dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_yy';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const { ensureDataHistoryTable } = await import('../src/service/ensureLayerAppTables');
  const result = await ensureDataHistoryTable();
  console.log(`[ensure-data-history] ok — ${project} ${type}`, result);
  process.exit(result.errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error('[ensure-data-history] failed', e);
  process.exit(1);
});
