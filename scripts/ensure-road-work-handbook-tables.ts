/**
 * layer.rd_work_target_review / layer.rd_hbook_mat 생성
 * 사용: npx tsx scripts/ensure-road-work-handbook-tables.ts [project] [env]
 */
import { loadProjectEnv } from './load-project-env';

const project = String(process.argv[2] ?? 'build_yy').trim() || 'build_yy';
const env = String(process.argv[3] ?? 'dev').trim() || 'dev';
loadProjectEnv(project, env);

async function main() {
  const { pool } = await import('../src/database/db');
  const { ensureRoadWorkHandbookTables } = await import('../src/service/ensureLayerAppTables');
  try {
    const result = await ensureRoadWorkHandbookTables();
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
