/**
 * CRA PUBLIC_URL 에 해당하는 Next basePath 를 프로젝트 env 로 주입한 뒤 next build.
 * Usage: npx tsx scripts/build-with-project-env.ts <project> <dev|demo|prod>
 *
 * 게이트(dggskorea/[project]/) 는 build 시점에 basePath 가 HTML/JS 에 박혀야 함.
 * starter 의 `npm run build` 만으로는 process.env.BASE_PATH 가 비어 있을 수 있어
 * next.config 가 파일을 읽더라도 누락·불일치를 막기 위해 여기서 명시 주입·검증한다.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectEnvVars, loadProjectEnv } from './load-project-env';

/** next build 힙 상한(MB). NODE_OPTIONS 에 이미 지정돼 있으면 그 값을 쓴다 */
const BUILD_HEAP_MB = 4096;

function normalizeBasePath(raw: string): string {
  let p = (raw ?? '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      /* keep */
    }
  }
  p = p.replace(/\/+$/, '');
  if (!p || p === '/') return '';
  return p.startsWith('/') ? p : `/${p}`;
}

function readBuiltBasePath(): string | null {
  const p = path.join(process.cwd(), '.next', 'required-server-files.json');
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      config?: { basePath?: string };
    };
    return normalizeBasePath(String(j.config?.basePath ?? ''));
  } catch {
    return null;
  }
}

function main(): void {
  const project = (process.argv[2] ?? '').trim();
  const type = (process.argv[3] ?? '').trim();
  if (!project || !type) {
    console.error('Usage: npx tsx scripts/build-with-project-env.ts <project> <dev|demo|prod>');
    process.exit(1);
  }

  loadProjectEnv(project, type);
  process.env.GGNR_PROJECT = project;
  process.env.GGNR_ENV = type;

  const expected = normalizeBasePath(
    process.env.BASE_PATH ?? getProjectEnvVars(project, type).BASE_PATH ?? ''
  );
  if (expected) {
    process.env.BASE_PATH = expected;
    console.log(
      `[build] BASE_PATH=${expected}`
    );
  } else {
    delete process.env.BASE_PATH;
    console.log('[build] BASE_PATH 없음 — 루트(/) 빌드 (로컬 IP 직결용)');
  }

  // 기본 Node 힙(약 2GB)으로는 webpack 서버 번들·파일 추적 중 메모리 부족(종료 134)이 날 수 있다
  const nodeOptions = process.env.NODE_OPTIONS ?? '';
  if (!/--max-old-space-size=/.test(nodeOptions)) {
    process.env.NODE_OPTIONS = `${nodeOptions} --max-old-space-size=${BUILD_HEAP_MB}`.trim();
  }
  console.log(`[build] NODE_OPTIONS=${process.env.NODE_OPTIONS}`);

  const r = spawnSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  // package.json build = next build --webpack (Turbopack orthophotoService panic 회피)
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }

  const built = readBuiltBasePath();
  if (built === null) {
    console.error('[build] .next/required-server-files.json 없음 — 빌드 실패로 간주');
    process.exit(1);
  }
  if (built !== expected) {
    console.error(
      `[build] basePath 불일치 — 빌드="${built || '(루트)'}" 기대="${expected || '(루트)'}"`
    );
    console.error(
      '[build] 게이트 접속 시 HTML 의 script 가 /_next/... 이면 JS 404 → 백지. BASE_PATH 로 재빌드 필요.'
    );
    process.exit(1);
  }
  console.log(`[build] OK basePath=${built || '(루트)'}`);
}

main();
