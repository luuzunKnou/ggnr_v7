import path from 'node:path';

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
 * G: → \\192.168.127.11\service_data 등 UNC 루트 치환.
 * Windows 서비스(nssm)·Node는 로그인 세션의 드라이브 매핑(G:)을 못 보므로
 * GGNR_DATA_UNC_ROOT 가 있으면 GGNR_DATA_DIR 의 드라이브 문자를 UNC 로 바꾼다.
 */
function applyWindowsUncDataRoot(rawPath: string): string {
  if (process.platform !== 'win32') return rawPath;
  const uncRoot = (process.env.GGNR_DATA_UNC_ROOT ?? '').trim();
  if (!uncRoot) return rawPath;
  const driveMatch = /^([a-zA-Z]):[\\/]/.exec(rawPath);
  if (!driveMatch) return rawPath;
  const rest = rawPath.slice(2);
  return joinUncRoot(uncRoot, rest);
}

/** GGNR_DATA_DIR — 리터럴 d:\ggnr_data_dir / 환경변수 키 정적 추적 회피 */
export function resolveGgnrDataDir(): string {
  const key = ['GGNR', 'DATA', 'DIR'].join('_');
  const fromEnv = process.env[key];
  let raw: string;
  if (fromEnv?.trim()) {
    raw = path.normalize(fromEnv.trim());
  } else {
    raw = ['d:', 'ggnr_data_dir'].join(path.sep);
  }
  raw = applyWindowsUncDataRoot(raw);
  return turbopackOpaquePath(raw);
}
