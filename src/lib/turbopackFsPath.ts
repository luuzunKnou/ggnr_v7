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

/** GGNR_DATA_DIR — 리터럴 d:\ggnr_data_dir / 환경변수 키 정적 추적 회피 */
export function resolveGgnrDataDir(): string {
  const key = ['GGNR', 'DATA', 'DIR'].join('_');
  const fromEnv = process.env[key];
  if (fromEnv?.trim()) {
    return turbopackOpaquePath(path.normalize(fromEnv.trim()));
  }
  return turbopackOpaquePath(['d:', 'ggnr_data_dir'].join(path.sep));
}
