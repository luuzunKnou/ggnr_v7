import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { getProjectEnvVars } from '../../scripts/load-project-env';

const BUILD_CHECK_GGNR_ENV = 'demo';

/** 빌드 확인용 임시 복사에서 제외할 최상위 디렉터리 */
const SKIP_TOP_LEVEL_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.cursor',
  '.vscode',
  '.yarn',
  '.cursor-runtime',
  'coverage',
  'out',
  'build',
  'file_data',
  'shp_data',
  'excel_data',
  'source_upload',
  '3dtiles_las',
  'tiles_tif',
  'tiles_jpg',
  '3dtiles_b3dm',
  '3dtiles_pnts',
  '3dtiles_obj',
  '3dtiles_tiff',
  '.cad-preview-work',
  'python',
]);

/** 하위 경로 prefix 제외 (대용량·런타임 데이터) */
const SKIP_DIR_PREFIXES = [
  'geoserver_modules/data_dir/',
  'geoserver_modules/java/',
  'geoserver_modules/geoserver/',
  'pg_map_modules/',
];

export type BuildCheckProgressCallback = (line: string) => void;

export type BuildCheckResult = {
  ok: boolean;
  message: string;
  cancelled?: boolean;
};

let buildCheckInflight = false;

export function isBuildCheckInflight(): boolean {
  return buildCheckInflight;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid == null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

function toPosixRel(absPath: string, root: string): string {
  return path.relative(root, absPath).replace(/\\/g, '/');
}

function shouldSkipCopyDir(relPosix: string): boolean {
  if (!relPosix) return false;
  const top = relPosix.split('/')[0] ?? relPosix;
  if (SKIP_TOP_LEVEL_DIRS.has(top)) return true;
  const dir = relPosix.endsWith('/') ? relPosix : `${relPosix}/`;
  return SKIP_DIR_PREFIXES.some((prefix) => dir === prefix || dir.startsWith(prefix));
}

function readRuntimeEnvVars(projectName: string, sourceRoot: string): Record<string, string> {
  const filePath = path.join(sourceRoot, 'src', 'config', 'projects', `${projectName}.runtime.env`);
  if (!fsSync.existsSync(filePath)) return {};
  const content = fsSync.readFileSync(filePath, 'utf-8');
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) vars[key] = value;
  }
  return vars;
}

/** 빌드 subprocess 전용 env (NODE_ENV=production, GGNR_ENV=demo, 프로젝트 env 병합) */
export function resolveBuildCheckEnv(sourceRoot: string): NodeJS.ProcessEnv {
  const project = process.env.GGNR_PROJECT?.trim();
  if (!project) {
    throw new Error(
      '기동 프로젝트(GGNR_PROJECT)가 없습니다. npm run dev -- <project> <type> 으로 기동하세요.'
    );
  }
  const env = { ...process.env } as Record<string, string>;
  env.NODE_ENV = 'production';
  env.GGNR_ENV = BUILD_CHECK_GGNR_ENV;
  env.GGNR_PROJECT = project;

  Object.assign(env, getProjectEnvVars(project, BUILD_CHECK_GGNR_ENV));
  Object.assign(env, readRuntimeEnvVars(project, sourceRoot));

  if (!env.AUTH_SECRET?.trim() && !env.NEXTAUTH_SECRET?.trim()) {
    env.AUTH_SECRET = 'ggnr-dev-auth-secret-change-me';
  }
  return env as NodeJS.ProcessEnv;
}

async function copyWorkspaceForBuildCheck(
  sourceRoot: string,
  destRoot: string,
  onLine?: BuildCheckProgressCallback,
  signal?: AbortSignal
): Promise<number> {
  let copied = 0;

  async function walk(relDir: string): Promise<void> {
    throwIfAborted(signal);
    const srcAbs = relDir ? path.join(sourceRoot, relDir) : sourceRoot;
    const entries = await fs.readdir(srcAbs, { withFileTypes: true });
    for (const entry of entries) {
      throwIfAborted(signal);
      const childRel = toPosixRel(path.join(srcAbs, entry.name), sourceRoot);
      if (!childRel || childRel.startsWith('..')) continue;
      if (entry.isDirectory()) {
        if (shouldSkipCopyDir(childRel)) continue;
        await fs.mkdir(path.join(destRoot, childRel), { recursive: true });
        await walk(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const destAbs = path.join(destRoot, childRel);
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.copyFile(path.join(sourceRoot, childRel), destAbs);
      copied += 1;
      if (copied % 400 === 0) {
        onLine?.(`임시 복사 진행 ${copied}건...`);
      }
    }
  }

  await fs.mkdir(destRoot, { recursive: true });
  await walk('');
  throwIfAborted(signal);
  for (const must of ['package.json', 'package-lock.json']) {
    const src = path.join(sourceRoot, must);
    if (!fsSync.existsSync(src)) {
      throw new Error(`빌드 확인에 필요한 ${must} 가 없습니다.`);
    }
    await fs.copyFile(src, path.join(destRoot, must));
  }
  return copied;
}

function spawnNpmWithLines(
  args: string[],
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  onLine: BuildCheckProgressCallback | undefined,
  labels: { ok: string; fail: string },
  signal?: AbortSignal
): Promise<BuildCheckResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
      return;
    }

    const child = spawn('npm', args, {
      cwd: workspaceRoot,
      shell: true,
      windowsHide: true,
      env,
    });
    let stderr = '';
    let settled = false;

    const finish = (result: BuildCheckResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const onAbort = () => {
      killProcessTree(child);
      finish({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const emitLines = (buf: Buffer) => {
      const text = buf.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed) onLine?.(trimmed);
      }
    };
    child.stdout?.on('data', emitLines);
    child.stderr?.on('data', (buf: Buffer) => {
      emitLines(buf);
      stderr += buf.toString('utf-8');
    });
    child.on('error', (err) => {
      if (signal?.aborted) {
        finish({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
        return;
      }
      finish({ ok: false, message: err.message });
    });
    child.on('close', (code) => {
      if (signal?.aborted) {
        finish({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
        return;
      }
      if ((code ?? 1) === 0) finish({ ok: true, message: labels.ok });
      else finish({ ok: false, message: stderr.trim() || `${labels.fail} (code=${code})` });
    });
  });
}

function buildCheckTempRoot(sourceRoot: string): string {
  return path.join(sourceRoot, '.cursor-runtime', 'build-check', `${Date.now()}`);
}

/**
 * 원본 워크스페이스는 읽기만 하고, 임시 복사본에서 npm install·npm run build 실행.
 * schema:index·.next·cesiumStatic 등 빌드 부수 효과는 temp에만 적용된다.
 */
export async function runIsolatedBuildCheck(
  sourceRoot: string,
  onLine?: BuildCheckProgressCallback,
  signal?: AbortSignal
): Promise<BuildCheckResult> {
  if (buildCheckInflight) {
    return { ok: false, message: '빌드 확인이 이미 진행 중입니다.' };
  }
  throwIfAborted(signal);
  buildCheckInflight = true;
  const tempRoot = buildCheckTempRoot(sourceRoot);
  try {
    const buildEnv = resolveBuildCheckEnv(sourceRoot);
    const project = buildEnv.GGNR_PROJECT ?? '';
    onLine?.(
      `빌드 env: project=${project} GGNR_ENV=${BUILD_CHECK_GGNR_ENV} NODE_ENV=production`
    );
    onLine?.('임시 워크스페이스 준비 중 (원본 소스 무영향)...');
    const copied = await copyWorkspaceForBuildCheck(sourceRoot, tempRoot, onLine, signal);
    throwIfAborted(signal);
    onLine?.(`소스 복사 완료 (${copied}건)`);
    onLine?.('npm install (캐시 재사용) 시작...');
    const installResult = await spawnNpmWithLines(
      ['install', '--prefer-offline', '--no-audit', '--no-fund', '--ignore-scripts'],
      tempRoot,
      buildEnv,
      onLine,
      { ok: 'npm install 완료', fail: 'npm install 실패' },
      signal
    );
    if (!installResult.ok) {
      return installResult;
    }
    throwIfAborted(signal);
    onLine?.('npm run build 시작...');
    return await spawnNpmWithLines(['run', 'build'], tempRoot, buildEnv, onLine, {
      ok: '빌드 성공',
      fail: 'npm run build 실패',
    }, signal);
  } catch (e: unknown) {
    if (isAbortError(e) || signal?.aborted) {
      return { ok: false, message: '사용자가 취소했습니다.', cancelled: true };
    }
    throw e;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    onLine?.('임시 워크스페이스 정리 완료');
    buildCheckInflight = false;
  }
}
