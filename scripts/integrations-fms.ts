/**
 * FMS 안전점검 수동 연계
 * 사용: npm run integrations:fms -- build_uj dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const { runFmsSync } = await import('../src/lib/fmsLinkage/syncRunner');
  const r = await runFmsSync();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
