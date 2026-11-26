/**
 * 안동 정사영상 배치.
 *
 * - 시계열(네트워크): \\192.168.127.14\ftp_안동시\2011~2023 …\{year}
 * - 2025(로컬): F:\20260729안동정사영상(2025) → satellite_2025_5187
 * 결과: F:\안동 정사영상\tiles_jpg\satellite_{year}_5187\
 *
 * 사용:
 *   npx tsx scripts/ortho-batch-andong.ts
 *   npx tsx scripts/ortho-batch-andong.ts --dry-run
 *   npx tsx scripts/ortho-batch-andong.ts --year=2025
 *   npx tsx scripts/ortho-batch-andong.ts --year=2017 --force
 *   또는 scripts/ortho-batch-remote.example.bat
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LOG = '[ortho-batch-andong]';
const projectRoot = path.resolve(__dirname, '..');

const SERIES_ROOT =
  '\\\\192.168.127.14\\ftp_안동시\\2011~2023 시계열 항공영상 (국토지리정보원, 안동시, 25cm)';
/** 연도별 로컬 원본(네트워크 시계열 대신/추가) */
const LOCAL_YEAR_SOURCES: Record<string, string> = {
  '2025': 'F:\\20260729안동정사영상(2025)',
};
const DATA = 'F:\\안동 정사영상';
const WORK = 'F:\\temp\\ortho_work';
/** 파일명·국토지리 25cm east 계열 → EPSG:5187 */
const CRS = '5187';

type YearJob = { year: string; src: string; group: string };

function parseExtra(argv: string[]): { years: string[]; passthrough: string[] } {
  const years: string[] = [];
  const passthrough: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--year=')) {
      const v = a.slice('--year='.length).trim();
      if (/^\d{4}$/.test(v)) years.push(v);
      continue;
    }
    if (a === '--year') continue;
    passthrough.push(a);
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--year') {
      const v = (argv[i + 1] ?? '').trim();
      if (/^\d{4}$/.test(v) && !years.includes(v)) years.push(v);
    }
  }
  return { years, passthrough };
}

function listYearJobs(): YearJob[] {
  const byYear = new Map<string, YearJob>();

  try {
    const entries = fs.readdirSync(SERIES_ROOT, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || !/^\d{4}$/.test(e.name)) continue;
      byYear.set(e.name, {
        year: e.name,
        src: path.join(SERIES_ROOT, e.name),
        group: `satellite_${e.name}_${CRS}`,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} 시계열 루트 접근 실패(로컬 연도만 진행 가능): ${msg}`);
  }

  for (const [year, src] of Object.entries(LOCAL_YEAR_SOURCES)) {
    byYear.set(year, {
      year,
      src,
      group: `satellite_${year}_${CRS}`,
    });
  }

  return [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year));
}

function runYear(job: YearJob, passthrough: string[]): Promise<number> {
  const script = path.join(projectRoot, 'scripts', 'ortho-batch.ts');
  const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const args = [
    tsxCli,
    script,
    'ggnr_ad',
    'dev',
    `--group=${job.group}`,
    `--source-dir=${job.src}`,
    `--work-dir=${WORK}`,
    `--data-dir=${DATA}`,
    ...passthrough,
  ];

  console.log(`\n${LOG} ========== ${job.year} → ${job.group} ==========`);
  console.log(`${LOG} SRC=${job.src}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const { years: onlyYears, passthrough } = parseExtra(process.argv.slice(2));
  let jobs = listYearJobs();
  if (onlyYears.length) {
    const want = new Set(onlyYears);
    const missing = onlyYears.filter((y) => !jobs.some((j) => j.year === y));
    if (missing.length) {
      console.warn(`${LOG} 등록된 연도 없음: ${missing.join(', ')}`);
    }
    jobs = jobs.filter((j) => want.has(j.year));
  }

  console.log(`${LOG} SERIES_ROOT=${SERIES_ROOT}`);
  console.log(`${LOG} LOCAL_2025=${LOCAL_YEAR_SOURCES['2025']}`);
  console.log(`${LOG} DATA=${DATA} WORK=${WORK}`);
  console.log(`${LOG} 대상 연도 ${jobs.length}개: ${jobs.map((j) => j.year).join(', ') || '(없음)'}`);

  if (!jobs.length) {
    console.error(`${LOG} 변환할 연도 폴더가 없습니다.`);
    process.exitCode = 1;
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const job of jobs) {
    if (!fs.existsSync(job.src)) {
      fail += 1;
      console.error(`${LOG} FAIL year=${job.year} — 원본 경로 없음: ${job.src}`);
      continue;
    }
    const code = await runYear(job, passthrough);
    if (code === 0) {
      ok += 1;
    } else {
      fail += 1;
      console.error(`${LOG} FAIL year=${job.year} exit=${code} — 다음 연도 계속`);
    }
  }

  console.log(`\n${LOG} 전체 완료: 성공 ${ok} · 실패 ${fail} · 대상 ${jobs.length}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`${LOG} fatal`, e);
  process.exit(1);
});
