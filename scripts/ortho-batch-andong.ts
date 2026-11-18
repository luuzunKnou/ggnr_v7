/**
 * 안동 정사영상 배치 진입점 (경로에 한글·괄호·공백 → bat/CMD 인자 전달 우회).
 * 사용: npx tsx scripts/ortho-batch-andong.ts
 *       npx tsx scripts/ortho-batch-andong.ts --dry-run
 *       또는 scripts/ortho-batch-remote.example.bat
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(__dirname, '..');

const SRC =
  '\\\\192.168.127.14\\ftp_안동시\\06.고정밀 전자지도 구축 챌린지 사업(안동시)_정사영상(보안성 검토완)\\1_정사영상_tiff(5000)';
const DATA = 'F:\\안동 정사영상';
const WORK = 'F:\\temp\\ortho_work';
const GROUP = 'satellite_2024_5187';

async function main(): Promise<void> {
  const extra = process.argv.slice(2);

  console.log('[ortho-batch-andong] SRC=', SRC);
  console.log('[ortho-batch-andong] DATA=', DATA);
  console.log('[ortho-batch-andong] GROUP=', GROUP);

  process.argv = [
    process.argv[0] ?? 'node',
    path.join(projectRoot, 'scripts', 'ortho-batch.ts'),
    'ggnr_ad',
    'dev',
    `--group=${GROUP}`,
    `--source-dir=${SRC}`,
    `--work-dir=${WORK}`,
    `--data-dir=${DATA}`,
    ...extra,
  ];

  await import(pathToFileURL(path.join(projectRoot, 'scripts', 'ortho-batch.ts')).href);
}

main().catch((e) => {
  console.error('[ortho-batch-andong] fatal', e);
  process.exit(1);
});
