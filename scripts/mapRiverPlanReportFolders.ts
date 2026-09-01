/**
 * 하천기본계획 보고서 ZIP 해제 + river_plan_as ogc_fid 폴더명 매핑
 *
 * 사용:
 *   npx tsx scripts/mapRiverPlanReportFolders.ts --project build_yy --env dev --dir "C:\...\보고서" --dry-run
 *   npx tsx scripts/mapRiverPlanReportFolders.ts --project build_yy --env dev --dir "C:\...\보고서" --apply
 *   npx tsx scripts/mapRiverPlanReportFolders.ts ... --apply --remove-zip
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import { loadProjectEnv } from './load-project-env';

const execFileAsync = promisify(execFile);

const FOLDER_NAME_RE = /^(\d{4})_(.+?)_보고서_지방$/;

type CliOptions = {
  project: string;
  env: string;
  dir: string;
  apply: boolean;
  removeZip: boolean;
};

type RowResult = {
  folderName: string;
  planYear: string;
  riverName: string;
  ogcFid: number | null;
  duplicateCount: number;
  action: string;
  error?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const project = get('--project') ?? 'build_yy';
  const env = get('--env') ?? 'dev';
  const dir = get('--dir');
  if (!dir?.trim()) {
    throw new Error('--dir 경로가 필요합니다.');
  }

  return {
    project,
    env,
    dir: path.resolve(dir.trim()),
    apply: argv.includes('--apply'),
    removeZip: argv.includes('--remove-zip'),
  };
}

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirHasEntries(p: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function extractZipWindows(zipPath: string, destDir: string): Promise<void> {
  if (await pathExists(destDir)) {
    await fs.rm(destDir, { recursive: true, force: true });
  }
  await fs.mkdir(destDir, { recursive: true });
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = ${JSON.stringify(zipPath)}`,
    `$dest = ${JSON.stringify(destDir)}`,
    '[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)',
  ].join('; ');
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { maxBuffer: 20 * 1024 * 1024 },
  );
}

async function lookupOgcFid(
  riverName: string,
  planYear: string,
): Promise<{ ogcFid: number | null; duplicateCount: number }> {
  const { db } = await import('../src/database/db');
  const res = await db.execute(
    sql.raw(
      `SELECT ogc_fid
       FROM layer.river_plan_as
       WHERE river_name = '${escSql(riverName)}'
         AND COALESCE(plan_year, '') = '${escSql(planYear)}'
       ORDER BY ogc_fid`,
    ),
  );

  const rows = (res.rows ?? []) as { ogc_fid?: number | string }[];
  if (rows.length === 0) {
    return { ogcFid: null, duplicateCount: 0 };
  }

  const first = Number(rows[0]?.ogc_fid);
  if (!Number.isFinite(first)) {
    return { ogcFid: null, duplicateCount: rows.length };
  }

  return { ogcFid: Math.floor(first), duplicateCount: rows.length };
}

async function listReportFolders(baseDir: string): Promise<string[]> {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && FOLDER_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

async function listReportCandidates(baseDir: string): Promise<string[]> {
  const names = new Set<string>();
  for (const folderName of await listReportFolders(baseDir)) {
    names.add(folderName);
  }
  for (const zipName of await listZipFiles(baseDir)) {
    names.add(zipName.replace(/\.zip$/i, ''));
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
}

async function listZipFiles(baseDir: string): Promise<string[]> {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.zip'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

async function ensureExtracted(baseDir: string, zipName: string, apply: boolean): Promise<string | null> {
  const baseName = zipName.replace(/\.zip$/i, '');
  const folderPath = path.join(baseDir, baseName);
  const zipPath = path.join(baseDir, zipName);

  if (await dirHasEntries(folderPath)) {
    return `extract-skip (폴더 존재)`;
  }

  if (!apply) {
    return `extract-pending (${zipName})`;
  }

  await extractZipWindows(zipPath, folderPath);
  if (!(await dirHasEntries(folderPath))) {
    throw new Error(`압축 해제 후 폴더가 비어 있습니다: ${folderPath}`);
  }
  return `extracted (${zipName})`;
}

async function renameFolderToPk(
  baseDir: string,
  folderName: string,
  ogcFid: number,
  apply: boolean,
): Promise<string> {
  const src = path.join(baseDir, folderName);
  const dest = path.join(baseDir, String(ogcFid));

  if (!(await pathExists(src))) {
    return 'rename-skip (원본 없음)';
  }

  if (path.basename(src) === String(ogcFid)) {
    return 'rename-skip (이미 PK명)';
  }

  if (await pathExists(dest)) {
    return `rename-skip (대상 ${ogcFid} 폴더 이미 존재)`;
  }

  if (!apply) {
    return `rename-pending → ${ogcFid}`;
  }

  await fs.rename(src, dest);
  return `renamed → ${ogcFid}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  loadProjectEnv(opts.project, opts.env);
  process.env.GGNR_PROJECT = opts.project;
  process.env.GGNR_ENV = opts.env;

  if (!(await pathExists(opts.dir))) {
    throw new Error(`대상 폴더가 없습니다: ${opts.dir}`);
  }

  const mode = opts.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[map-river-report] mode=${mode} project=${opts.project} env=${opts.env}`);
  console.log(`[map-river-report] dir=${opts.dir}`);
  console.log(`[map-river-report] removeZip=${opts.removeZip}`);

  const zipNames = await listZipFiles(opts.dir);
  console.log(`[map-river-report] zip files: ${zipNames.length}`);

  const results: RowResult[] = [];
  let unmatched = 0;
  let duplicated = 0;

  const processCandidate = async (folderName: string, extractNote?: string) => {
    const m = FOLDER_NAME_RE.exec(folderName);
    if (!m) return;

    const planYear = m[1]!;
    const riverName = m[2]!;
    const { ogcFid, duplicateCount } = await lookupOgcFid(riverName, planYear);

    if (ogcFid == null) {
      unmatched += 1;
      results.push({
        folderName,
        planYear,
        riverName,
        ogcFid: null,
        duplicateCount,
        action: extractNote ? `${extractNote}; skip (DB 미매칭)` : 'skip (DB 미매칭)',
      });
      return;
    }

    if (duplicateCount > 1) {
      duplicated += 1;
    }

    let action = await renameFolderToPk(opts.dir, folderName, ogcFid, opts.apply);
    if (extractNote) {
      action = `${extractNote}; ${action}`;
    }

    if (opts.apply && opts.removeZip && action.includes('renamed')) {
      const zipPath = path.join(opts.dir, `${folderName}.zip`);
      if (await pathExists(zipPath)) {
        await fs.unlink(zipPath);
        action += ' + zip removed';
      }
    }

    results.push({
      folderName,
      planYear,
      riverName,
      ogcFid,
      duplicateCount,
      action,
    });
  };

  if (opts.apply) {
    for (const zipName of zipNames) {
      const baseName = zipName.replace(/\.zip$/i, '');
      const extractNote = await ensureExtracted(opts.dir, zipName, true);
      console.log(`  ${zipName}: ${extractNote}`);
      await processCandidate(baseName, extractNote ?? undefined);
    }

    const leftoverFolders = await listReportFolders(opts.dir);
    for (const folderName of leftoverFolders) {
      if (results.some((r) => r.folderName === folderName)) continue;
      await processCandidate(folderName);
    }
  } else {
    for (const zipName of zipNames) {
      const note = await ensureExtracted(opts.dir, zipName, false);
      console.log(`  ${zipName}: ${note}`);
    }

    const candidates = await listReportCandidates(opts.dir);
    console.log(`[map-river-report] report candidates: ${candidates.length}`);
    for (const folderName of candidates) {
      await processCandidate(folderName);
    }
  }

  if (opts.apply) {
    console.log(`[map-river-report] report candidates processed: ${results.length}`);
  }

  console.log('\nfolderName | riverName | planYear | ogc_fid | dup | action');
  console.log('-'.repeat(90));
  for (const r of results) {
    const dupNote = r.duplicateCount > 1 ? ` (${r.duplicateCount} rows)` : '';
    console.log(
      `${r.folderName} | ${r.riverName} | ${r.planYear} | ${r.ogcFid ?? '-'} | ${r.duplicateCount || '-'} | ${r.action}${dupNote}`,
    );
  }

  console.log('\n[summary]');
  console.log(`  mapped: ${results.filter((r) => r.ogcFid != null).length}`);
  console.log(`  unmatched: ${unmatched}`);
  console.log(`  duplicate ogc_fid rows: ${duplicated}`);

  if (unmatched > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const { closePool } = await import('../src/database/db');
      await closePool();
    } catch {
      /* ignore */
    }
  });
