/**
 * FMS xls(xlsx) 초기 적재 — TRUNCATE 후 BASTB_MASTER / MANTB_DIGN_RESULT upsert + geom backfill
 *
 * 사용:
 *   npx tsx scripts/seed-fms-from-xls.ts build_yy dev
 *   npx tsx scripts/seed-fms-from-xls.ts build_yy dev --dir "\\\\192.168.127.11\\..."
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { loadProjectEnv } from './load-project-env';
import {
  FMS_FACILITY_TABLE_NAMES,
  FMS_INSPECTION_TABLE_NAMES,
  getFmsPrefixesForEnabledSystems,
} from '../src/lib/fmsLinkage/fmsBinding';
import { defaultHeaderColumnOrder } from '../src/lib/fmsLinkage/fmsHeaderSeed';
import { parseFmsDelimitedData } from '../src/lib/fmsLinkage/parseDelimited';

const LOG = '[seed-fms-xls]';

const DEFAULT_DIR =
  '\\\\192.168.127.11\\사업수행_개발\\101 연계서류관리\\연계현황\\영양 건설\\FMS';

const IDENTIFIERS = ['BASTB_MASTER', 'MANTB_DIGN_RESULT'] as const;

function parseArgs(): { project: string; type: string; dir: string } {
  const argv = process.argv.slice(2);
  let dir = DEFAULT_DIR;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dir') {
      dir = argv[++i] ?? dir;
      continue;
    }
    if (a.startsWith('--dir=')) {
      dir = a.slice('--dir='.length) || dir;
      continue;
    }
    positional.push(a);
  }
  return {
    project: positional[0] || 'build_yy',
    type: positional[1] || 'dev',
    dir,
  };
}

function loadRuntimeEnv(projectName: string): void {
  const dir = path.join(process.cwd(), 'src', 'config', 'projects');
  const apply = (filePath: string) => {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) (process.env as Record<string, string>)[key] = value;
    }
  };
  apply(path.join(dir, 'common.runtime.env'));
  apply(path.join(dir, `${projectName}.runtime.env`));
}

function readEnabledSystems(): string[] | null {
  const raw = (process.env.ENABLED_SYSTEMS ?? '').trim();
  if (!raw) return null;
  const keys = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return keys.length ? keys : null;
}

/** xls/xlsx 셀에서 FMS Ð 구분 raw 라인 추출 (첫 행 DATA 헤더 스킵) */
function extractRawLinesFromXls(filePath: string, identifier: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`파일 없음: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`시트 없음: ${filePath}`);
  const sheet = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  const lines: string[] = [];
  const idUpper = identifier.toUpperCase();
  for (const row of rows) {
    if (!Array.isArray(row) || !row.length) continue;
    const cell = String(row[0] ?? '').trim();
    if (!cell || cell.toUpperCase() === 'DATA') continue;
    if (!cell.toUpperCase().startsWith(idUpper)) continue;
    // CHECKLIST 등 다른 identifier 제외 (exact prefix + delimiter 또는 단독)
    const head = cell.split(/[\u00d0\r\n]/, 1)[0]?.trim().toUpperCase() ?? '';
    if (head !== idUpper) continue;
    lines.push(cell);
  }
  return lines.join('\n');
}

function resolveXlsPath(dir: string, identifier: string): string {
  const candidates = [
    path.join(dir, `${identifier}.xls`),
    path.join(dir, `${identifier}.xlsx`),
    path.join(dir, 'FMS 연계데이터', `${identifier}.xls`),
    path.join(dir, 'FMS 연계데이터', `${identifier}.xlsx`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`${identifier} 파일을 찾을 수 없습니다. 시도: ${candidates.join(' | ')}`);
}

async function main(): Promise<void> {
  const { project, type, dir } = parseArgs();
  loadProjectEnv(project, type);
  loadRuntimeEnv(project);
  process.env.GGNR_PROJECT = project;
  process.env.GGNR_ENV = type;

  const enabledSystems = readEnabledSystems();
  const prefixes = getFmsPrefixesForEnabledSystems(enabledSystems);

  console.info(`${LOG} project=${project} env=${type}`);
  console.info(`${LOG} dir=${dir}`);
  console.info(`${LOG} enabledSystems=${enabledSystems?.join(',') ?? '(all)'} prefixes=${prefixes.join(',')}`);

  const { pool } = await import('../src/database/db');
  const { ensureFmsTables } = await import('../src/service/ensureLayerAppTables');
  const { buildFacilPrefixMap, upsertFmsRowsToLayer } = await import(
    '../src/lib/fmsLinkage/upsertRows'
  );
  const { updateFmsCodeToKor } = await import('../src/lib/fmsLinkage/updateCodeToKor');
  const { backfillFmsFacilityGeom } = await import('../src/lib/fmsLinkage/backfillFacilityGeom');
  const { asc, eq } = await import('drizzle-orm');
  const { db } = await import('../src/database/db');
  const { fmsIdentifierHeader } = await import('../src/database/schema/fms_identifier_header');

  await ensureFmsTables();

  const tables = [...FMS_FACILITY_TABLE_NAMES, ...FMS_INSPECTION_TABLE_NAMES];
  for (const table of tables) {
    const before = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM layer.${table}`
    );
    await pool.query(`TRUNCATE TABLE layer.${table} RESTART IDENTITY`);
    console.info(`${LOG} TRUNCATE layer.${table} (was ${before.rows[0]?.c ?? '?'})`);
  }

  async function headersFor(identifier: (typeof IDENTIFIERS)[number]): Promise<string[]> {
    const rows = await db
      .select({ colName: fmsIdentifierHeader.colName })
      .from(fmsIdentifierHeader)
      .where(eq(fmsIdentifierHeader.identifier, identifier))
      .orderBy(asc(fmsIdentifierHeader.colOrder));
    const fromDb = rows.map((r) => String(r.colName ?? '').trim()).filter(Boolean);
    if (fromDb.length) return fromDb;
    console.warn(`${LOG} ${identifier}: fms_identifier_header 비어 있음 → 기본 컬럼 순서 사용`);
    return [...defaultHeaderColumnOrder(identifier)];
  }

  let facilPrefixMap = await buildFacilPrefixMap();

  for (const identifier of IDENTIFIERS) {
    const filePath = resolveXlsPath(dir, identifier);
    console.info(`${LOG} read ${identifier} ← ${filePath}`);
    const raw = extractRawLinesFromXls(filePath, identifier);
    const headers = await headersFor(identifier);
    const parsed = parseFmsDelimitedData(raw, identifier, headers);
    console.info(`${LOG} ${identifier} parsed=${parsed.length}`);

    const stats = await upsertFmsRowsToLayer(
      identifier,
      parsed,
      enabledSystems,
      facilPrefixMap
    );
    console.info(
      `${LOG} ${identifier} upsert ins=${stats.inserted} upd=${stats.updated} skip=${stats.skipped}`
    );

    await updateFmsCodeToKor(identifier);
    facilPrefixMap = await buildFacilPrefixMap();
  }

  for (const table of tables) {
    const r = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM layer.${table}`
    );
    console.info(`${LOG} count layer.${table}=${r.rows[0]?.c ?? '0'}`);
  }

  // geom 전에 idle 연결을 줄여 max_connections(53300) 회피
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND usename = current_user
          AND pid <> pg_backend_pid()
          AND state = 'idle'`
    );
  } catch (e) {
    console.warn(`${LOG} idle terminate skip:`, e instanceof Error ? e.message : e);
  }

  console.info(`${LOG} geom backfill start`);
  try {
    const geom = await backfillFmsFacilityGeom({ limit: 5000 });
    console.info(`${LOG} geom ${JSON.stringify(geom)}`);
  } catch (e) {
    console.error(`${LOG} geom backfill fail:`, e instanceof Error ? e.message : e);
    console.error(
      `${LOG} 속성 적재는 완료됨. 재시도: npx tsx scripts/backfill-fms-facility-geom.ts ${project} ${type} 5000`
    );
    process.exitCode = 1;
  }

  await pool.end();
  console.info(`${LOG} done`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
