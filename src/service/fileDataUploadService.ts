/**
 * 개발자 모드 Data File Upload — service_data/file_data/{테이블}/{키}/ 구조 검증·로그
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getDefineLayerTables, getLayerTableList } from './devTestService';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const DEFINE_LAYER_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const FILE_DATA_PREFIX = 'service_data/file_data';
const HISTORY_FILE = '.meta/file_data_upload_history.json';

/** 업로드·후처리 로그 등 — 데이터 상태 검증 대상에서 제외 */
function isValidationIgnoredFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.log');
}

function getKeyFieldName(tableName: string): string | null {
  const safe = String(tableName).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fsSync.existsSync(filePath)) return null;
    const fields: Record<string, unknown>[] = JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
    const keyField = Array.isArray(fields)
      ? fields.find((f) => String(f?.define_field_is_key ?? '').toLowerCase() === 'true')
      : null;
    return keyField ? String((keyField as { define_field_name?: string }).define_field_name ?? '').trim() || null : null;
  } catch {
    return null;
  }
}

function resolveFileDataRoot(relativePath?: string): { abs: string; rel: string } | null {
  const base = path.resolve(GGNR_DATA_DIR);
  const raw = (relativePath ?? FILE_DATA_PREFIX).trim().replace(/^[/\\]+/, '');
  if (!raw.startsWith(FILE_DATA_PREFIX) || raw.includes('..')) {
    const rel = FILE_DATA_PREFIX;
    const abs = path.join(base, ...rel.split('/'));
    return { abs, rel };
  }
  const abs = path.join(base, ...raw.split('/'));
  if (!abs.startsWith(path.join(base, ...FILE_DATA_PREFIX.split('/')))) return null;
  return { abs, rel: raw.replace(/\\/g, '/') };
}

export type FileDataInvalidTop = { folderName: string; reason: string };
export type FileDataInvalidKey = {
  relativePath: string;
  tableName: string;
  keyFolder: string;
  reason: string;
};
export type FileDataLooseFile = { relativePath: string; fileName: string };

export type FileDataValidationResult = {
  rootRelative: string;
  invalidTopLevel: FileDataInvalidTop[];
  invalidKeyFolders: FileDataInvalidKey[];
  looseFilesUnderTable: FileDataLooseFile[];
  tablesMissingKeyField: string[];
  /** 키 값 목록 DB 조회 실패 시 테이블명 */
  tablesKeyQueryFailed: string[];
};

async function loadDbKeySet(tableName: string, keyField: string): Promise<Set<string> | null> {
  const safeTable = tableName.replace(/"/g, '""');
  const safeKey = keyField.replace(/"/g, '""');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT TRIM("${safeKey}"::text) AS k FROM layer."${safeTable}" WHERE "${safeKey}" IS NOT NULL`
      )
    );
    const set = new Set<string>();
    for (const row of res.rows as Array<{ k?: string }>) {
      const k = String(row?.k ?? '').trim();
      if (k) set.add(k);
    }
    return set;
  } catch {
    return null;
  }
}

/**
 * file_data 트리 검증: 최상위 폴더 = define 테이블명, 하위 = 해당 테이블 키 값
 */
export async function validateFileDataTree(params?: { relativePath?: string }): Promise<FileDataValidationResult> {
  const resolved = resolveFileDataRoot(params?.relativePath);
  const empty: FileDataValidationResult = {
    rootRelative: FILE_DATA_PREFIX,
    invalidTopLevel: [],
    invalidKeyFolders: [],
    looseFilesUnderTable: [],
    tablesMissingKeyField: [],
    tablesKeyQueryFailed: [],
  };
  if (!resolved) return empty;

  const [defineRes, dbRes] = await Promise.all([getDefineLayerTables(), getLayerTableList()]);
  const defineNames: { lower: string; canonical: string }[] = [];
  if (defineRes.success && Array.isArray(defineRes.tables)) {
    for (const row of defineRes.tables) {
      const n = String(row.define_table_name ?? '').trim();
      if (n) defineNames.push({ lower: n.toLowerCase(), canonical: n });
    }
  }
  const layerTables = (dbRes.tables ?? []).filter((t) => t.schema === 'layer');
  const dbByLower = new Map<string, string>();
  for (const t of layerTables) {
    dbByLower.set(String(t.table).toLowerCase(), t.table);
  }

  let rootAbs = resolved.abs;
  let rootRel = resolved.rel;
  try {
    const st = await fs.stat(rootAbs);
    if (!st.isDirectory()) {
      return { ...empty, rootRelative: rootRel };
    }
  } catch {
    return { ...empty, rootRelative: rootRel };
  }

  const invalidTopLevel: FileDataInvalidTop[] = [];
  const invalidKeyFolders: FileDataInvalidKey[] = [];
  const looseFilesUnderTable: FileDataLooseFile[] = [];
  const tablesMissingKeyField: string[] = [];
  const tablesKeyQueryFailed: string[] = [];

  const entries = await fs.readdir(rootAbs, { withFileTypes: true }).catch(() => [] as Dirent[]);

  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith('.')) continue;

    const childAbs = path.join(rootAbs, name);
    const childRel = `${rootRel}/${name}`.replace(/\\/g, '/');

    if (ent.isFile()) {
      if (isValidationIgnoredFileName(name)) continue;
      invalidTopLevel.push({ folderName: name, reason: '최상위는 테이블 폴더만 허용됩니다 (파일은 테이블/키/ 아래에 두세요).' });
      continue;
    }

    if (!ent.isDirectory()) continue;

    const def = defineNames.find((d) => d.lower === name.toLowerCase());
    if (!def) {
      invalidTopLevel.push({ folderName: name, reason: 'defineLayer(tables.json)에 없는 테이블명입니다.' });
      continue;
    }

    const canonicalTable = def.canonical;
    const dbTable = dbByLower.get(canonicalTable.toLowerCase());
    if (!dbTable) {
      invalidTopLevel.push({ folderName: name, reason: `DB layer 스키마에 테이블 "${canonicalTable}"이(가) 없습니다.` });
      continue;
    }

    const keyField = getKeyFieldName(dbTable);
    if (!keyField) {
      tablesMissingKeyField.push(dbTable);
      const sub = await fs.readdir(childAbs, { withFileTypes: true }).catch(() => [] as Dirent[]);
      for (const s of sub) {
        if (s.isDirectory()) {
          invalidKeyFolders.push({
            relativePath: `${childRel}/${s.name}`.replace(/\\/g, '/'),
            tableName: dbTable,
            keyFolder: s.name,
            reason: '레이어 속성에 키 필드(define_field_is_key)가 설정되어 있지 않아 검증할 수 없습니다.',
          });
        }
      }
      for (const s of sub) {
        if (s.isFile() && !isValidationIgnoredFileName(s.name)) {
          looseFilesUnderTable.push({ relativePath: childRel, fileName: s.name });
        }
      }
      continue;
    }

    const keySet = await loadDbKeySet(dbTable, keyField);
    if (keySet === null) {
      tablesKeyQueryFailed.push(dbTable);
      const sub = await fs.readdir(childAbs, { withFileTypes: true }).catch(() => [] as Dirent[]);
      for (const s of sub) {
        if (s.isFile() && !isValidationIgnoredFileName(s.name)) {
          looseFilesUnderTable.push({ relativePath: childRel, fileName: s.name });
        }
      }
      continue;
    }

    const sub = await fs.readdir(childAbs, { withFileTypes: true }).catch(() => [] as Dirent[]);

    for (const s of sub) {
      if (s.isFile()) {
        if (!isValidationIgnoredFileName(s.name)) {
          looseFilesUnderTable.push({ relativePath: childRel, fileName: s.name });
        }
        continue;
      }
      if (!s.isDirectory()) continue;

      const keyFolder = s.name.trim();
      if (!keySet.has(keyFolder)) {
        invalidKeyFolders.push({
          relativePath: `${childRel}/${s.name}`.replace(/\\/g, '/'),
          tableName: dbTable,
          keyFolder: s.name,
          reason: `키 필드 "${keyField}" 값과 일치하는 행이 DB에 없습니다.`,
        });
      }
    }
  }

  return {
    rootRelative: rootRel,
    invalidTopLevel,
    invalidKeyFolders,
    looseFilesUnderTable,
    tablesMissingKeyField: [...new Set(tablesMissingKeyField)],
    tablesKeyQueryFailed: [...new Set(tablesKeyQueryFailed)],
  };
}

export type FileDataUploadLogRow = {
  path: string;
  status: 'ok' | 'warn' | 'fail';
  message?: string;
};

/**
 * 업로드 세션 요약 로그 (file_data 루트 또는 지정 폴더에 .log)
 */
export async function saveFileDataUploadLog(params: {
  relativePath?: string;
  results: FileDataUploadLogRow[];
  validation: FileDataValidationResult;
}): Promise<{ success: boolean; logPath?: string; error?: string }> {
  try {
    const rp = (params.relativePath ?? FILE_DATA_PREFIX).trim().replace(/^[/\\]+/, '');
    const safeRp = rp.startsWith(FILE_DATA_PREFIX) ? rp : FILE_DATA_PREFIX;
    const dir = path.join(GGNR_DATA_DIR, ...safeRp.split('/'));
    await fs.mkdir(dir, { recursive: true });

    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const logName = `filedata_upload_${ts}.log`;
    const logPath = path.join(dir, logName);

    const v = params.validation;
    const lines: string[] = [];
    lines.push('=== Data File Upload (file_data) ===');
    lines.push(`일시: ${now.toLocaleString('ko-KR')}`);
    lines.push(`경로: ${safeRp}`);
    lines.push('');
    lines.push('--- 검증 요약 ---');
    lines.push(`미등록/오류 최상위 폴더: ${v.invalidTopLevel.length}건`);
    for (const x of v.invalidTopLevel) {
      lines.push(`  [폴더] ${x.folderName} — ${x.reason}`);
    }
    lines.push(`키 값 불일치 하위 폴더: ${v.invalidKeyFolders.length}건`);
    for (const x of v.invalidKeyFolders) {
      lines.push(`  [경로] ${x.relativePath} — ${x.reason}`);
    }
    if (v.looseFilesUnderTable.length > 0) {
      lines.push(`테이블 바로 아래 잘못된 위치의 파일: ${v.looseFilesUnderTable.length}건`);
      for (const x of v.looseFilesUnderTable) {
        lines.push(`  ${x.relativePath}/${x.fileName}`);
      }
    }
    if (v.tablesMissingKeyField.length > 0) {
      lines.push(`키 필드 미설정 테이블: ${v.tablesMissingKeyField.join(', ')}`);
    }
    if (v.tablesKeyQueryFailed.length > 0) {
      lines.push(`키 값 DB 조회 실패 테이블: ${v.tablesKeyQueryFailed.join(', ')}`);
    }
    lines.push('');
    lines.push('--- 파일별 업로드 ---');
    for (const r of params.results) {
      lines.push(`[${r.status}] ${r.path}${r.message ? ` — ${r.message}` : ''}`);
    }
    lines.push('');

    await fs.writeFile(logPath, lines.join('\n'), 'utf-8');
    return { success: true, logPath: path.relative(GGNR_DATA_DIR, logPath).replace(/\\/g, '/') };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

export type FileDataHistoryEntry = {
  at: string;
  fileCount: number;
  savedPathsSample: string[];
  validation: {
    invalidTopCount: number;
    invalidKeyCount: number;
    looseFileCount: number;
    missingKeyTableCount: number;
    keyQueryFailedCount: number;
  };
  logFileRelative?: string;
};

async function readFileDataHistory(): Promise<FileDataHistoryEntry[]> {
  const filePath = path.join(GGNR_DATA_DIR, HISTORY_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeFileDataHistory(entries: FileDataHistoryEntry[]): Promise<void> {
  const dir = path.join(GGNR_DATA_DIR, path.dirname(HISTORY_FILE));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(GGNR_DATA_DIR, HISTORY_FILE);
  const max = 200;
  const trimmed = entries.slice(0, max);
  await fs.writeFile(filePath, JSON.stringify(trimmed, null, 0), 'utf-8');
}

/** 업로드 직후 검증 실행 + 이력·로그 파일 기록 */
export async function recordFileDataUploadSession(params: {
  savedPaths: string[];
  logRelativeDir?: string;
}): Promise<{
  validation: FileDataValidationResult;
  logPath?: string;
}> {
  const validation = await validateFileDataTree({ relativePath: FILE_DATA_PREFIX });
  const results: FileDataUploadLogRow[] = (params.savedPaths ?? []).map((p) => {
    const norm = p.replace(/\\/g, '/');
    const rest = norm.startsWith(FILE_DATA_PREFIX + '/') ? norm.slice(FILE_DATA_PREFIX.length + 1) : norm;
    const parts = rest.split('/').filter(Boolean);
    if (parts.length < 3) {
      return { path: norm, status: 'warn' as const, message: '경로는 테이블명/키값/파일명 형태여야 합니다.' };
    }
    const tableFolder = parts[0];
    const keyFolder = parts[1];
    const topHit = validation.invalidTopLevel.find((x) => x.folderName.toLowerCase() === tableFolder.toLowerCase());
    if (topHit) {
      return { path: norm, status: 'fail' as const, message: topHit.reason };
    }
    const keyPath = `${FILE_DATA_PREFIX}/${tableFolder}/${keyFolder}`.replace(/\\/g, '/');
    const keyIssue = validation.invalidKeyFolders.find(
      (x) => x.relativePath.replace(/\\/g, '/').toLowerCase() === keyPath.toLowerCase()
    );
    if (keyIssue) {
      return { path: norm, status: 'fail' as const, message: keyIssue.reason };
    }
    return { path: norm, status: 'ok' as const };
  });

  const logRes = await saveFileDataUploadLog({
    relativePath: params.logRelativeDir ?? FILE_DATA_PREFIX,
    results,
    validation,
  });

  const entry: FileDataHistoryEntry = {
    at: new Date().toISOString(),
    fileCount: params.savedPaths.length,
    savedPathsSample: params.savedPaths.slice(0, 30).map((p) => p.replace(/\\/g, '/')),
    validation: {
      invalidTopCount: validation.invalidTopLevel.length,
      invalidKeyCount: validation.invalidKeyFolders.length,
      looseFileCount: validation.looseFilesUnderTable.length,
      missingKeyTableCount: validation.tablesMissingKeyField.length,
      keyQueryFailedCount: validation.tablesKeyQueryFailed.length,
    },
    logFileRelative: logRes.logPath,
  };
  const hist = await readFileDataHistory();
  hist.unshift(entry);
  await writeFileDataHistory(hist);

  return { validation, logPath: logRes.logPath };
}

export async function getFileDataUploadHistory(params?: { limit?: number }): Promise<{
  entries: FileDataHistoryEntry[];
  path: string;
}> {
  const limit = params?.limit ?? 100;
  const entries = await readFileDataHistory();
  return {
    entries: entries.slice(0, limit),
    path: path.join(GGNR_DATA_DIR, HISTORY_FILE),
  };
}
