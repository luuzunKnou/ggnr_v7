/**
 * 스케줄러와 동일 경로로 대기열(requested_at) 도로영상 분석을 한 번 실행.
 * 사용: npx tsx scripts/run-road-video-track-once.ts road_cd dev
 */
import { loadProjectEnv } from './load-project-env';

const project = (process.argv[2] ?? 'road_cd').trim();
const envType = (process.argv[3] ?? 'dev').trim();
loadProjectEnv(project, envType);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = envType;

async function main() {
  const { runRequestedRoadVideoTracks } = await import('../src/integrations/roadVideoTrackScheduler');
  const { pool } = await import('../src/database/db');
  console.log('[road-video-track-once] start');
  await runRequestedRoadVideoTracks();
  console.log('[road-video-track-once] done');
  await pool.end().catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
