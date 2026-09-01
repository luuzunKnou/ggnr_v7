/**
 * ggnr_start.bat — BUILD_ID 존재·BASE_PATH 일치 여부 확인.
 * exit 0: skip build OK
 * exit 1: build 필요 (.next 없음·BUILD_ID 없음·basePath 불일치)
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProjectEnvVars, loadProjectEnv } from './load-project-env';

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
    console.error('Usage: npx tsx scripts/check-base-path-build.ts <project> <dev|demo|prod>');
    process.exit(1);
  }

  const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID');
  if (!fs.existsSync(buildIdPath)) {
    console.log('[check-base-path] .next/BUILD_ID 없음 — build 필요');
    process.exit(1);
  }

  loadProjectEnv(project, type);
  const expected = normalizeBasePath(
    process.env.BASE_PATH ?? getProjectEnvVars(project, type).BASE_PATH ?? ''
  );
  const built = readBuiltBasePath();
  if (built === null) {
    console.log('[check-base-path] required-server-files.json 없음 — build 필요');
    process.exit(1);
  }
  if (built !== expected) {
    console.log(
      `[check-base-path] basePath 불일치 — 빌드="${built || '(루트)'}" env="${expected || '(루트)'}" — rebuild 필요`
    );
    process.exit(1);
  }
  console.log(`[check-base-path] OK basePath=${built || '(루트)'} — skip build`);
  process.exit(0);
}

main();
