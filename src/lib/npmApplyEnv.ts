import fsSync from 'node:fs';
import path from 'node:path';

/** 사전 빌드(prebuild)에 필요한 devDependencies 설치 인자 */
export const NPM_INSTALL_DEV_ARGS = [
  'install',
  '--include=dev',
  '--no-audit',
  '--no-fund',
] as const;

/** 운영 NODE_ENV=production 이어도 devDependencies(tsx 등) 설치되도록 env 보정 */
export function resolveNpmInstallEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base } as Record<string, string>;
  delete env.NODE_ENV;
  env.npm_config_production = 'false';
  env.npm_config_include_dev = 'true';
  return env as NodeJS.ProcessEnv;
}

/**
 * next build 힙 상한(MB).
 * 기본 Node 힙(~2GB)에서는 TypeScript 단계에서 OOM(exit 134)이 날 수 있다.
 * NODE_OPTIONS 에 이미 --max-old-space-size 가 있으면 그대로 둔다.
 */
export const BUILD_HEAP_MB = 4096;

/** 최신 소스 적용·재기동 경로의 npm run build 용 env */
export function resolveNpmBuildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base } as Record<string, string>;
  const nodeOptions = env.NODE_OPTIONS ?? '';
  if (!/--max-old-space-size=/.test(nodeOptions)) {
    env.NODE_OPTIONS = `${nodeOptions} --max-old-space-size=${BUILD_HEAP_MB}`.trim();
  }
  return env as NodeJS.ProcessEnv;
}

/** prebuild(schema:index)용 tsx CLI 존재 여부 */
export function isPrebuildTsxAvailable(cwd = process.cwd()): boolean {
  const cli = path.join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fsSync.existsSync(cli)) return true;
  const bin = path.join(
    cwd,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );
  return fsSync.existsSync(bin);
}
