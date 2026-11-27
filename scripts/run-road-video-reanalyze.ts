/**
 * 지정 도로영상만 최신 코드로 바로 재분석 (수동 기준점 반영 후 삭제).
 * 사용: npx tsx scripts/run-road-video-reanalyze.ts <project> <env> <roadKey> <fileName...>
 */
import { loadProjectEnv } from './load-project-env';

const project = (process.argv[2] ?? 'road_cd').trim();
const envType = (process.argv[3] ?? 'dev').trim();
const roadKey = (process.argv[4] ?? '').trim();
const fileNames = process.argv.slice(5).map((s) => s.trim()).filter(Boolean);

loadProjectEnv(project, envType);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = envType;

async function main() {
  if (!roadKey || fileNames.length === 0) {
    console.error('usage: npx tsx scripts/run-road-video-reanalyze.ts <project> <env> <roadKey> <fileName...>');
    process.exit(2);
  }
  const { runRoadVideoTrackForFiles } = await import('../src/integrations/roadVideoTrackScheduler');
  const { pool } = await import('../src/database/db');
  console.log(`[road-video-reanalyze] start ${roadKey} files=${fileNames.length}`);
  const done = await runRoadVideoTrackForFiles(roadKey, fileNames);
  console.log(`[road-video-reanalyze] done ${done.length}`, done);
  await pool.end().catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
