import fs from 'node:fs';
import path from 'node:path';
import { getProjectEnvVars } from '../../scripts/load-project-env';

/**
 * Turbopack NFT: path.resolve/join + fs.* 에 정적 분석 가능한 경로가 있으면
 * 프로젝트 전체 글로브로 추적해 «Overly broad patterns» 경고가 난다.
 * leaf·접두를 런타임에 이어 붙여 정적 경로 추적을 끊는다.
 * (@/service/sourceInstallZipService installZipDownloadRoot 와 동일 목적)
 */
export function turbopackOpaquePath(absolutePath: string): string {
  return ['', absolutePath].join('');
}

function joinUncRoot(uncRoot: string, rest: string): string {
  const root = uncRoot.replace(/[\\/]+$/, '');
  const tail = rest.replace(/^[\\/]+/, '').replace(/\//g, '\\');
  return tail ? `${root}\\${tail}` : root;
}

/**
 * GGNR_DATA_UNC_ROOT — 출처는 src/config/projects/common.runtime.env 고정.
 * (프로젝트 .env / *.runtime.env 값은 쓰지 않음)
 */
export function resolveGgnrDataUncRoot(): string {
  try {
    const envFile = path.join(process.cwd(), 'src', 'config', 'projects', 'common.runtime.env');
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (key !== 'GGNR_DATA_UNC_ROOT') continue;
        const value = trimmed.slice(eq + 1).trim();
        if (value) return value;
      }
    }
  } catch {
    /* ignore */
  }
  return (process.env.GGNR_DATA_UNC_ROOT ?? '').trim();
}

/**
 * G: 만 UNC 로 바꾼다. 로그인 세션에 매핑된 G: 는 Windows 서비스가 못 본다.
 * C: 처럼 운영 env 에 적힌 로컬 경로는 바꾸지 않는다.
 */
function applyWindowsUncDataRoot(rawPath: string): string {
  if (process.platform !== 'win32') return rawPath;
  const uncRoot = resolveGgnrDataUncRoot();
  if (!uncRoot) return rawPath;
  const driveMatch = /^([a-zA-Z]):[\\/]/.exec(rawPath);
  if (!driveMatch || driveMatch[1].toUpperCase() !== 'G') return rawPath;
  const rest = rawPath.slice(2);
  return joinUncRoot(uncRoot, rest);
}

/** prod: <project>.env [prod] 의 GGNR_DATA_DIR (runtime.env 등 process.env 덮어쓰기 무시) */
function readProdDataDirFromProjectEnv(key: string): string {
  const project = (process.env.GGNR_PROJECT ?? '').trim();
  if (!project) return '';
  try {
    return (getProjectEnvVars(project, 'prod')[key] ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * GGNR_DATA_DIR — 리터럴 d:\ggnr_data_dir / 환경변수 키 정적 추적 회피.
 * prod 는 프로젝트 .env 값을 그대로 사용 (UNC 치환 없음). dev·demo 만 G: → UNC 치환.
 */
export function resolveGgnrDataDir(): string {
  const key = ['GGNR', 'DATA', 'DIR'].join('_');
  const isProd = (process.env.GGNR_ENV ?? '').trim().toLowerCase() === 'prod';
  const fromEnv = (isProd ? readProdDataDirFromProjectEnv(key) : '') || (process.env[key] ?? '').trim();
  let raw = fromEnv ? path.normalize(fromEnv) : ['d:', 'ggnr_data_dir'].join(path.sep);
  if (!isProd) raw = applyWindowsUncDataRoot(raw);
  return turbopackOpaquePath(raw);
}
