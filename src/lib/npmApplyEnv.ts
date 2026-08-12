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
