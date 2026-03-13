/**
 * 프로젝트 env 로드 후 drizzle-kit push 실행
 * 사용: npm run db:push:project -- river_yd dev
 */
import { spawn } from 'node:child_process';
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2];
const type = process.argv[3] || 'dev';

if (!project) {
  console.error('Usage: npm run db:push:project -- <project> [type]');
  console.error('  e.g. npm run db:push:project -- river_yd dev');
  process.exit(1);
}

loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

const child = spawn('npx', ['drizzle-kit', 'push'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
child.on('close', (code) => process.exit(code ?? 0));
