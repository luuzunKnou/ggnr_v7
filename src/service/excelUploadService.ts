/**
 * Excel File Uploader service.
 * - Excel 파일 파싱 (단일 시트, 단일 헤더)
 * - 단일 테이블(denormalize) 생성 및 데이터 삽입
 * - defineLayer tables.json / fields (define_table_source: "excel")
 * - excelFieldNameMap.json (한글→영문 누적 사전)
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { db, pool } from '@/database/db';
import { getLayerTableList, getDefineLayerTables, createOrUpdateGeoServerLayer, applyDefaultStyleToLayer } from './devTestService';
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '@/lib/defineLayerTableRowOrder';
import { discardExcelIntegrityReview, getLatestExcelHistoryByTables } from './excelHistoryService';
import {
  parseExcelMatrix,
  coerceExcelDateCellsInAoa,
  SHEET_TO_JSON_HEADER1_DISPLAY,
} from '@/lib/excelSheetParse';
import { isSpreadsheetFileName, readWorkbookFromBuffer, stripSpreadsheetExt } from '@/lib/excelWorkbookRead';
import {
  buildPnu19,
  parseAddressForPnu,
  riNameLookupCandidates,
  type ExcelUploadParsedPnuParts,
} from '@/lib/excelUploadAddressNormalize';
import {
  insertExcelSyncLogGeomFromLayer,
  insertExcelSyncLogGeomFromLonLat,
  insertExcelSyncLogGeomFromWkt,
  fillExcelSyncLogNewGeoms,
  fillPendingExcelSyncLogOldGeoms,
  fillPendingExcelSyncLogNewGeomsFromCoords,
  syncExcelSyncLogJsonGeomFromSideTable,
  excelLayerRowJsonbSql,
} from '@/lib/syncLogGeom';
import { broadcastExcelWizardLog } from '@/lib/excelWizardEvents';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const DEFINE_LAYER_TABLES_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');
const DEFINE_LAYER_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const EXCEL_FIELD_NAME_MAP_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'excelFieldNameMap.json');

function safeTableName(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'layer_table';
  return s.toLowerCase();
}

function safeColumnName(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'col';
  return s.toLowerCase();
}

/** PostgreSQL 문자열 리터럴용 (COMMENT ON … IS '…') */
function escapePostgresStringLiteral(text: string): string {
  return String(text ?? '').replace(/'/g, "''");
}

export type ParseExcelResult = {
  success: boolean;
  error?: string;
  sheetCount?: number;
  hasSingleSheet?: boolean;
  hasSingleHeader?: boolean;
  headers?: string[];
  rows?: Record<string, unknown>[];
  /** per-column sample values (first 3) */
  samples?: Record<string, unknown[]>;
};

/**
 * Excel 파일 파싱. 첫 시트만 사용, 타이틀 1~3행 헤더 선택.
 */
export async function parseExcelFile(params: { pathOrResult: string; titleRowLines?: 1 | 2 | 3 }): Promise<ParseExcelResult> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };
  const titleRowLines = params?.titleRowLines === 3 ? 3 : params?.titleRowLines === 2 ? 2 : 1;

  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { success: false, error: '파일을 찾을 수 없습니다.' };
  } catch {
    return { success: false, error: '파일을 찾을 수 없습니다.' };
  }

  try {
    const buf = await fs.readFile(absolutePath);
    const { workbook: wb } = readWorkbookFromBuffer(buf, path.basename(absolutePath));
    const sheetNames = wb.SheetNames;
    const sheetCount = sheetNames.length;
    const hasSingleSheet = sheetCount === 1;

    if (sheetCount === 0) return { success: false, error: '시트가 없습니다.', sheetCount, hasSingleSheet: false };

    const firstSheetName = sheetNames[0];
    const ws = wb.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(ws, { ...SHEET_TO_JSON_HEADER1_DISPLAY }) as unknown[][];
    coerceExcelDateCellsInAoa(data);

    if (!data || data.length === 0) {
      return { success: false, error: '데이터가 없습니다.', sheetCount, hasSingleSheet };
    }

    const { headers: headerStrings, rows, samples, hasSingleTitleRow } = parseExcelMatrix(data, titleRowLines);

    return {
      success: true,
      sheetCount,
      hasSingleSheet,
      hasSingleHeader: hasSingleTitleRow,
      headers: headerStrings,
      rows,
      samples,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

export type ExlStatusRow = {
  fileName: string;
  pathOrResult: string;
  mtime: string;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
};

/**
 * excel_data 내 .xlsx/.xls/.csv 파일 목록 및 테이블/레이어/define 상태.
 */
export async function getExlStatusList(params?: { relativePath?: string }): Promise<{ success: boolean; rows?: ExlStatusRow[]; path?: string; error?: string }> {
  const baseExcel = path.join(GGNR_DATA_DIR, 'excel_data');
  const relativePath = (params?.relativePath ?? 'excel_data').trim().replace(/^[/\\]+/, '');
  const dir = relativePath ? path.join(GGNR_DATA_DIR, relativePath) : baseExcel;
  if (!dir.startsWith(baseExcel)) {
    return { success: true, rows: [], path: baseExcel };
  }

  try {
    await fs.mkdir(path.join(GGNR_DATA_DIR, 'excel_data'), { recursive: true });
  } catch {
    // ignore
  }

  let entries: { name: string; mtime: Date }[] = [];
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return { success: true, rows: [], path: dir };
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const e of list) {
      if (!e.isFile()) continue;
      if (!isSpreadsheetFileName(e.name)) continue;
      const fullPath = path.join(dir, e.name);
      const st = await fs.stat(fullPath).catch(() => null);
      entries.push({ name: e.name, mtime: st?.mtime ?? new Date(0) });
    }
  } catch {
    return { success: true, rows: [], path: dir };
  }

  const pathOrResultPrefix = relativePath ? `${relativePath.replace(/\\/g, '/')}/` : 'excel_data/';
  let layerNames: string[] = [];
  let styleNames: string[] = [];
  try {
    const geoserverUrl = process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver';
    const layerRes = await fetch(`${geoserverUrl}/rest/workspaces/ggnr/layers.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver', 'utf8').toString('base64') },
    });
    if (layerRes.ok) {
      const layerData = await layerRes.json();
      const raw = layerData?.layers?.layer ?? layerData?.layers ?? [];
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      layerNames = arr.map((l: { name?: string }) => l?.name ?? String(l));
    }
  } catch {
    // ignore
  }
  try {
    const styleRes = await fetch(`${process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver'}/rest/styles.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver', 'utf8').toString('base64') },
    });
    if (styleRes.ok) {
      const styleData = await styleRes.json();
      const raw = styleData?.styles?.style ?? styleData?.style ?? [];
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      styleNames = arr.map((s: { name?: string }) => s?.name ?? '');
    }
  } catch {
    // ignore
  }

  const listRes = await getLayerTableList();
  const layerTableSet = new Set<string>();
  if (listRes.success && Array.isArray(listRes.tables)) {
    for (const t of listRes.tables) {
      if (t.schema === 'layer') layerTableSet.add(String(t.table).toLowerCase());
    }
  }

  const defineRes = await getDefineLayerTables();
  const defineTableSet = new Set<string>();
  if (defineRes.success && Array.isArray(defineRes.tables)) {
    for (const row of defineRes.tables) {
      const name = String(row.define_table_name ?? '').trim().toLowerCase();
      if (name) defineTableSet.add(name);
    }
  }

  const rows: ExlStatusRow[] = [];
  for (const { name, mtime } of entries) {
    const baseName = path.basename(name, path.extname(name));
    const tableName = safeTableName(baseName);
    const pathOrResult = pathOrResultPrefix + name;
    rows.push({
      fileName: name,
      pathOrResult,
      mtime: mtime.toISOString(),
      table: layerTableSet.has(tableName),
      layer: layerNames.some((n) => String(n).toLowerCase() === tableName),
      style: styleNames.some((n) => String(n).toLowerCase() === tableName),
      define: defineTableSet.has(tableName),
    });
  }
  rows.sort((a, b) => (b.mtime > a.mtime ? 1 : b.mtime < a.mtime ? -1 : 0));
  return { success: true, rows, path: dir };
}

/** DB 기준 Excel 데이터 상태 행: define_table_source=excel 테이블 + 이력 최신 정보 */
export type ExcelDataStatusRow = {
  tableName: string;
  tableKorName: string;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
  lastSourcePath: string | null;
  lastCreateDate: string | null;
};

/**
 * DB 구조 기준 Excel 데이터 상태: define(source=excel) 테이블 목록에 대해
 * 테이블/레이어/스타일/define 여부와 excel_upload_history 최신 이력(경로·일시) 반환.
 */
export async function getExcelDataStatusList(): Promise<{
  success: boolean;
  rows?: ExcelDataStatusRow[];
  error?: string;
}> {
  try {
    const defineRes = await getDefineLayerTables();
    const tables = (defineRes.tables ?? []).filter(
      (row) => String((row as Record<string, unknown>).define_table_source ?? '').toLowerCase() === 'excel'
    );
    if (tables.length === 0) {
      return { success: true, rows: [] };
    }

    let layerNames: string[] = [];
    let styleNames: string[] = [];
    try {
      const geoserverUrl = process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver';
      const layerRes = await fetch(`${geoserverUrl}/rest/workspaces/ggnr/layers.json`, {
        headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver', 'utf8').toString('base64') },
      });
      if (layerRes.ok) {
        const layerData = await layerRes.json();
        const raw = layerData?.layers?.layer ?? layerData?.layers ?? [];
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        layerNames = arr.map((l: { name?: string }) => l?.name ?? String(l));
      }
      const styleRes = await fetch(`${process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver'}/rest/styles.json`, {
        headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver', 'utf8').toString('base64') },
      });
      if (styleRes.ok) {
        const styleData = await styleRes.json();
        const raw = styleData?.styles?.style ?? styleData?.style ?? [];
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        styleNames = arr.map((s: { name?: string }) => s?.name ?? '');
      }
    } catch {
      // ignore
    }

    const listRes = await getLayerTableList();
    const layerTableSet = new Set<string>();
    if (listRes.success && Array.isArray(listRes.tables)) {
      for (const t of listRes.tables) {
        if (t.schema === 'layer') layerTableSet.add(String(t.table).toLowerCase());
      }
    }

    const historyRes = await getLatestExcelHistoryByTables();
    const historyMap = historyRes.success ? historyRes.map : {};

    const rows: ExcelDataStatusRow[] = tables.map((row) => {
      const tableName = String(row.define_table_name ?? '').trim();
      const tableKeyLc = tableName.toLowerCase();
      const korName = String(row.define_table_kor_name ?? '').trim();
      const latest = historyMap[tableName];
      return {
        tableName,
        tableKorName: korName || tableName,
        table: layerTableSet.has(tableKeyLc),
        layer: layerNames.some((n) => String(n).toLowerCase() === tableKeyLc),
        style: styleNames.some((n) => String(n).toLowerCase() === tableKeyLc),
        define: true,
        lastSourcePath: latest?.sourcePath ?? null,
        lastCreateDate: latest?.createDate != null ? String(latest.createDate) : null,
      };
    });
    rows.sort((a, b) => a.tableName.localeCompare(b.tableName));
    return { success: true, rows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 한글→영문 필드명 사전 읽기.
 */
export async function readExcelFieldNameMap(): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
  try {
    if (!fsSync.existsSync(EXCEL_FIELD_NAME_MAP_PATH)) {
      return { success: true, map: {} };
    }
    const raw = await fs.readFile(EXCEL_FIELD_NAME_MAP_PATH, 'utf-8');
    const map = JSON.parse(raw) as Record<string, string>;
    return { success: true, map: map && typeof map === 'object' ? map : {} };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 한글→영문 필드명 사전에 항목 병합 후 저장.
 */
export async function writeExcelFieldNameMap(params: { entries: Record<string, string> }): Promise<{ success: boolean; error?: string }> {
  try {
    const { map: existing } = await readExcelFieldNameMap();
    const merged = { ...(existing ?? {}) };
    for (const [k, v] of Object.entries(params.entries ?? {})) {
      const raw = String(v ?? '').trim();
      if (!raw) continue;
      merged[k] = safeColumnName(raw);
    }
    await fs.mkdir(path.dirname(EXCEL_FIELD_NAME_MAP_PATH), { recursive: true });
    await fs.writeFile(EXCEL_FIELD_NAME_MAP_PATH, JSON.stringify(merged, null, 2), 'utf-8');
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const EXCEL_LAYER_SYSTEM_COLUMNS = new Set(['id', 'geom', 'parcel_address']);

export type ExcelDefineLayerFieldMeta = {
  define_field_name: string;
  define_field_kor_name: string;
  define_field_show_list?: boolean;
  define_field_show_search?: boolean;
  define_field_is_key?: boolean;
};

export type ExcelDefineLayerMeta = {
  exists: boolean;
  tableKorName?: string;
  tableGroup?: string;
  fields?: ExcelDefineLayerFieldMeta[];
};

/** defineLayer tables.json + fields/table_*.json 조회 (엑셀 위저드 자동입력용) */
async function loadExcelDefineLayerMeta(tableName: string): Promise<ExcelDefineLayerMeta> {
  const empty: ExcelDefineLayerMeta = { exists: false };
  try {
    const defineRes = await getDefineLayerTables();
    if (!defineRes.success || !Array.isArray(defineRes.tables)) return empty;
    const row = defineRes.tables.find(
      (r) => String((r as Record<string, unknown>).define_table_name ?? '').trim().toLowerCase() === tableName
    ) as Record<string, unknown> | undefined;
    if (!row) return empty;

    const tableKorName = String(row.define_table_kor_name ?? '').trim();
    const tableGroup = String(row.define_table_group ?? '').trim();
    const fields: ExcelDefineLayerFieldMeta[] = [];
    const fieldsPath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${tableName}.json`);
    if (fsSync.existsSync(fieldsPath)) {
      const raw = await fs.readFile(fieldsPath, 'utf-8');
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) {
        for (const f of parsed) {
          const name = String(f.define_field_name ?? '').trim();
          if (!name || EXCEL_LAYER_SYSTEM_COLUMNS.has(name.toLowerCase())) continue;
          const kor = String(f.define_field_kor_name ?? name).trim();
          const isKeyRaw = f.define_field_is_key;
          fields.push({
            define_field_name: name,
            define_field_kor_name: kor || name,
            define_field_show_list: Boolean(f.define_field_show_list),
            define_field_show_search: Boolean(f.define_field_show_search),
            define_field_is_key:
              isKeyRaw === true || String(isKeyRaw ?? '').toLowerCase() === 'true',
          });
        }
      }
    }
    return {
      exists: true,
      tableKorName: tableKorName || undefined,
      tableGroup: tableGroup || undefined,
      fields,
    };
  } catch {
    return empty;
  }
}

/**
 * layer 스키마에 동일 영문 테이블이 있는지와 컬럼·코멘트 목록 반환 (엑셀 재업로드 DIFF용).
 * 레이어 설정(defineLayer)에 동일 이름이 있으면 한글명·필드 메타도 함께 반환.
 */
export async function getExcelLayerTableColumnMeta(params: {
  tableName: string;
}): Promise<{
  success: boolean;
  exists?: boolean;
  normalizedTableName?: string;
  columns?: { name: string; comment: string | null }[];
  define?: ExcelDefineLayerMeta;
  error?: string;
}> {
  const tableName = safeTableName(params.tableName ?? '');
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const esc = tableName.replace(/'/g, "''");
  const define = await loadExcelDefineLayerMeta(tableName);
  try {
    const exRes = await db.execute(
      sql.raw(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables t
          WHERE t.table_schema = 'layer' AND t.table_name = '${esc}'
        ) AS ex`
      )
    );
    const exists = Boolean((exRes.rows as { ex?: boolean }[])[0]?.ex);
    if (!exists) {
      return { success: true, exists: false, normalizedTableName: tableName, columns: [], define };
    }
    const colRes = await db.execute(
      sql.raw(`SELECT a.attname::text AS name,
        col_description(a.attrelid, a.attnum) AS comment
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'layer' AND c.relname = '${esc}'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`)
    );
    const rows = colRes.rows as { name?: string; comment?: string | null }[];
    const columns = rows
      .map((r) => ({ name: String(r.name ?? ''), comment: r.comment != null ? String(r.comment) : null }))
      .filter((r) => r.name);
    return { success: true, exists: true, normalizedTableName: tableName, columns, define };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ExcelColumnDef = {
  define_field_name: string;
  define_field_kor_name: string;
  define_field_show_list?: boolean;
  define_field_show_search?: boolean;
  define_field_is_key?: boolean;
};

/**
 * 기존 엑셀 레이어 테이블에 컬럼 추가·삭제 (재업로드 시 사용자 선택 DIFF 반영).
 */
export async function applyExcelLayerTableSchemaDiff(params: {
  tableName: string;
  addColumns: ExcelColumnDef[];
  dropColumnNames: string[];
}): Promise<{ success: boolean; error?: string }> {
  const tableName = safeTableName(params.tableName ?? '');
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
  const fq = `layer.${quotedTable}`;
  try {
    for (const raw of params.dropColumnNames ?? []) {
      const c = safeColumnName(raw);
      if (!c || EXCEL_LAYER_SYSTEM_COLUMNS.has(c)) continue;
      await db.execute(sql.raw(`ALTER TABLE ${fq} DROP COLUMN IF EXISTS ${c}`));
    }
    for (const col of params.addColumns ?? []) {
      const c = safeColumnName(col.define_field_name);
      if (!c || EXCEL_LAYER_SYSTEM_COLUMNS.has(c)) continue;
      await db.execute(sql.raw(`ALTER TABLE ${fq} ADD COLUMN IF NOT EXISTS ${c} text`));
      const kor = escapePostgresStringLiteral(String(col.define_field_kor_name ?? col.define_field_name ?? c));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fq}.${c} IS '${kor}'`));
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ExcelRowInput = {
  attrs: Record<string, unknown>;
  parcels: Array<{ address?: string; x?: number; y?: number; geom?: string }>;
  mulgunjis?: Array<{ address?: string; x?: number; y?: number; geom?: string }>;
};

type ResolvedParcelGeom = {
  geomWkt: string | null;
  geomInputSrid: 4326 | 5181;
  parcelAddr: string;
};

/** 엑셀 geom WKT 좌표 크기로 입력 SRID 추정 (TM≈5181, 경위도≈4326) */
export function inferExcelGeomSrid(wkt: string): 4326 | 5181 {
  const nums = wkt.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!nums?.length) return 5181;
  for (const s of nums.slice(0, 12)) {
    const n = Math.abs(Number(s));
    if (!Number.isFinite(n)) continue;
    if (n > 1000) return 5181;
  }
  return 4326;
}

/** 저장 테이블은 항상 5181. 입력이 4326이면 변환, 5181이면 그대로. 그 외 EPSG는 미지원(자동 시 TM으로 오인 가능). */
export function resolveExcelGeomInputSrid(
  wkt: string,
  override?: 4326 | 5181 | 'auto' | null
): 4326 | 5181 {
  if (override === 4326 || override === 5181) return override;
  return inferExcelGeomSrid(wkt);
}

/** Excel 디노멀라이징 시 각 필지 주소(필지이름) 저장용 고정 컬럼명 */
const PARCEL_ADDRESS_COL = 'parcel_address';

const EMD_RI_SCHEMA = 'public_layer';
const EMD_RI_NAME_COLUMNS = ['adm_nm', 'name', 'emd_nm', 'ri_nm'];

/** 엑셀 업로드 PNU 파싱 결과 — `@/lib/excelUploadAddressNormalize` 와 동일 */
export type ParsedPnuParts = ExcelUploadParsedPnuParts;

/** PNU 폴백 .log 한 줄 (plain text, `|` 구분) */
function formatPnuFallbackLogLine(p: {
  rowTag: string;
  address: string;
  parsed: ExcelUploadParsedPnuParts | null;
  pnu: string | null;
  jijukFound: boolean;
  usedHangjeongToBeopjeong?: boolean;
  matchedRi?: string | null;
}): string {
  const parsePart = p.parsed
    ? `parse=ok | emd=${p.parsed.emdName} | ri=${p.parsed.riName} | mountain=${p.parsed.isMountain ? 'Y' : 'N'} | bonbun=${p.parsed.bonbun} | bubun=${p.parsed.bubun}`
    : 'parse=fail';
  const riFix =
    p.usedHangjeongToBeopjeong && p.parsed && p.matchedRi
      ? ` | riFix=${p.parsed.riName}→${p.matchedRi}`
      : '';
  const riFixOk =
    p.usedHangjeongToBeopjeong && p.jijukFound ? ' | riFixResult=ok' : '';
  return `${p.rowTag}${p.address} | ${parsePart}${riFix}${riFixOk} | pnu=${p.pnu ?? 'fail'} | jijuk=${p.jijukFound ? 'found' : 'not_found'}`;
}

export type ResolvePnuFromAddressResult = {
  pnu: string | null;
  originalRi: string | null;
  matchedRi: string | null;
  /** 원 리명 실패 후 법정리명으로 매칭됨 */
  usedHangjeongToBeopjeong: boolean;
};

export async function resolvePnuFromAddress(
  address: string
): Promise<ResolvePnuFromAddressResult> {
  const empty: ResolvePnuFromAddressResult = {
    pnu: null,
    originalRi: null,
    matchedRi: null,
    usedHangjeongToBeopjeong: false,
  };
  const parsed = parseAddressForPnu(address);
  if (!parsed) return empty;
  const { emdName, riName, bonbun, bubun, isMountain } = parsed;
  const esc = (v: string) => v.replace(/'/g, "''");
  let emdCd: string | null = null;
  for (const nameCol of EMD_RI_NAME_COLUMNS) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT "emd_cd" AS code FROM "${EMD_RI_SCHEMA}"."emd" WHERE "${nameCol}" = '${esc(emdName)}' LIMIT 1`
        )
      );
      const row = (res.rows as { code?: string }[])[0];
      if (row?.code) {
        emdCd = String(row.code).trim();
        break;
      }
    } catch {
      continue;
    }
  }
  if (!emdCd) {
    return { ...empty, originalRi: riName };
  }
  const riCandidates = riNameLookupCandidates(riName);
  let riCd: string | null = null;
  let matchedRi: string | null = null;
  for (const candidate of riCandidates) {
    for (const nameCol of EMD_RI_NAME_COLUMNS) {
      try {
        const res = await db.execute(
          sql.raw(
            `SELECT "ri_cd" AS code FROM "${EMD_RI_SCHEMA}"."ri" WHERE "ri_cd" LIKE '${esc(emdCd)}%' AND "${nameCol}" = '${esc(candidate)}' LIMIT 1`
          )
        );
        const row = (res.rows as { code?: string }[])[0];
        if (row?.code) {
          riCd = String(row.code).trim();
          matchedRi = candidate;
          break;
        }
      } catch {
        continue;
      }
    }
    if (riCd) break;
  }
  if (!riCd || !matchedRi) {
    return { ...empty, originalRi: riName };
  }
  return {
    pnu: buildPnu19(riCd, { bonbun, bubun, isMountain }),
    originalRi: riName,
    matchedRi,
    usedHangjeongToBeopjeong: matchedRi !== riName,
  };
}

export async function getPnuFromAddress(address: string): Promise<string | null> {
  return (await resolvePnuFromAddress(address)).pnu;
}

export async function getJijukGeomByPnu(pnu: string, geomSrid: number = 5181): Promise<string | null> {
  const esc = (v: string) => v.replace(/'/g, "''");
  const digits = String(pnu ?? '').replace(/\D/g, '');
  const candidates =
    digits.length === 19
      ? [
          digits,
          `${digits.slice(0, 10)}${digits[10] === '1' ? '2' : '1'}${digits.slice(11)}`,
        ]
      : digits.length === 18
        ? [`${digits.slice(0, 10)}1${digits.slice(10)}`, `${digits.slice(0, 10)}2${digits.slice(10)}`]
        : digits
          ? [digits]
          : [];

  const queryOne = async (key: string): Promise<string | null> => {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_SetSRID(geom, ${geomSrid})) AS wkt
         FROM ${EMD_RI_SCHEMA}.jijuk WHERE pnu = '${esc(key)}' LIMIT 1`
      )
    );
    const wkt = String((res.rows as { wkt?: string }[])[0]?.wkt ?? '').trim();
    return wkt || null;
  };

  try {
    for (const key of candidates) {
      const wkt = await queryOne(key);
      if (wkt) return wkt;
    }
    return null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[excelUploadService] getJijukGeomByPnu 오류:', msg);
    return null;
  }
}

/**
 * 단일 테이블(denormalize) 생성 및 Excel 유래 데이터 삽입.
 * - 테이블: id SERIAL PRIMARY KEY, geom, parcel_address + 각 column (text)
 * - separateJijukTable=false: 각 parcel당 1행(attrs 복제)
 * - separateJijukTable=true: 엑셀 행당 부모 1행(parcel_address=첫 필지, geom=자식 geom 합집합) + layer.{name}_jijuk 자식 N행
 */
export async function createTableFromExcel(params: {
  pathOrResult?: string;
  tableName: string;
  tableKorName: string;
  keyField: string;
  columns: ExcelColumnDef[];
  geometryType: 'Point' | 'Polygon';
  rows: ExcelRowInput[];
  /** true면 CREATE TABLE IF NOT EXISTS만 하고 TRUNCATE 생략 → 행 단위 추가 삽입용 */
  appendOnly?: boolean;
  /** true면 부모 1행 + 지적 전용 자식 테이블 `{table}_jijuk`에 필지별 1행 */
  separateJijukTable?: boolean;
  /** separateJijukTable 시 layer.{name}_jijuk 테이블 COMMENT (예: 한글레이어명_필지목록) */
  jijukTableComment?: string;
  /** true면 부모 1행 + 물건지 전용 자식 테이블 `{table}_mulgunji`에 물건지별 1행 */
  separateMulgunjiTable?: boolean;
  /** separateMulgunjiTable 시 layer.{name}_mulgunji 테이블 COMMENT (예: 한글레이어명_물건지) */
  mulgunjiTableComment?: string;
  /** 엑셀 행 번호(1-based) — PNU 폴백 .log 식별용 */
  excelRowNumber?: number;
  /** 키값 힌트 — PNU 폴백 .log 식별용 */
  rowKeyHint?: string;
  /**
   * parcels.geom WKT 입력 좌표계.
   * - auto(기본): 좌표 크기로 4326|5181 추정
   * - 4326: ST_Transform → 5181 저장
   * - 5181: 변환 없이 저장
   * 5179·5186 등 다른 TM은 미지원(자동이면 5181로 오인될 수 있음)
   */
  geomInputSrid?: 4326 | 5181 | 'auto';
}): Promise<{
  success: boolean;
  error?: string;
  rowCount?: number;
  polygonMatchedCount?: number;
  polygonNullCount?: number;
  pnuAttemptCount?: number;
  pnuOkCount?: number;
  /** 행정리→법정리로 맞춰 지적 매칭 성공한 건수 */
  hangjeongRiFixOkCount?: number;
}> {
  const tableName = safeTableName(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const keyField = safeColumnName(params.keyField);
  const columns = params.columns ?? [];
  const geometryType = params.geometryType ?? 'Point';
  const rows = params.rows ?? [];
  const appendOnly = params.appendOnly === true;
  const geomSridOverride = params.geomInputSrid ?? 'auto';
  const separateJijukTable = params.separateJijukTable === true;
  const jijukTableName = separateJijukTable ? safeTableName(`${tableName}_jijuk`) : null;
  const jijukTableComment =
    (params.jijukTableComment ?? `${params.tableKorName || tableName}_필지목록`).trim() || `${tableName}_필지목록`;
  const separateMulgunjiTable = params.separateMulgunjiTable === true;
  const mulgunjiTableName = separateMulgunjiTable ? safeTableName(`${tableName}_mulgunji`) : null;
  const mulgunjiTableComment =
    (params.mulgunjiTableComment ?? `${params.tableKorName || tableName}_물건지`).trim() || `${tableName}_물건지`;

  // 동일 영문명이 여러 Excel 열에 매핑되면 중복 컬럼 방지 (첫 번째만 사용)
  // id·geom·parcel_address 는 시스템 컬럼 — INSERT 컬럼 목록에서 제외 (geom은 parcels.geom)
  const colNames = Array.from(
    new Set(
      columns
        .map((c) => safeColumnName(c.define_field_name))
        .filter((c): c is string => !!c && !EXCEL_LAYER_SYSTEM_COLUMNS.has(c.toLowerCase()))
    )
  ) as string[];
  if (!colNames.includes(keyField)) return { success: false, error: 'keyField가 columns에 없습니다.' };

  try {
    const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
    const quotedJijuk = jijukTableName ? `"${jijukTableName.replace(/"/g, '""')}"` : '';
    const quotedMulgunji = mulgunjiTableName ? `"${mulgunjiTableName.replace(/"/g, '""')}"` : '';
    /** Point↔Polygon 재업로드를 위해 부모 geom은 항상 Geometry(제한 없음) */
    const geomType = 'Geometry';
    // 엑셀 업로드 결과 테이블은 jijuk과 동일하게 EPSG:5181(Korea 2000) 저장
    const geomSrid = 5181;
    const createParts = ['id SERIAL PRIMARY KEY', `geom geometry(${geomType}, ${geomSrid})`, `${PARCEL_ADDRESS_COL} text`];
    const seenCols = new Set<string>(['geom', PARCEL_ADDRESS_COL]);
    for (const col of columns) {
      const cname = safeColumnName(col.define_field_name);
      if (cname && !seenCols.has(cname)) {
        seenCols.add(cname);
        createParts.push(`${cname} text`);
      }
    }
    const createSql = `CREATE TABLE IF NOT EXISTS layer.${quotedTable} (${createParts.join(', ')})`;
    await db.execute(sql.raw(createSql));

    const fqTable = `layer.${quotedTable}`;
    // 기존 Point(또는 특정 타입) 컬럼이면 Geometry로 승격 — CREATE IF NOT EXISTS로는 타입이 안 바뀜
    try {
      const typRes = await db.execute(sql.raw(
        `SELECT UPPER(COALESCE(gc.type, '')) AS gtype
         FROM geometry_columns gc
         WHERE gc.f_table_schema = 'layer'
           AND gc.f_table_name = '${tableName.replace(/'/g, "''")}'
           AND gc.f_geometry_column = 'geom'
         LIMIT 1`
      ));
      const gtype = String((typRes.rows as Array<{ gtype?: string }>)?.[0]?.gtype ?? '').trim();
      if (gtype && gtype !== 'GEOMETRY') {
        await db.execute(sql.raw(
          `ALTER TABLE ${fqTable}
           ALTER COLUMN geom TYPE geometry(Geometry, ${geomSrid})
           USING CASE
             WHEN geom IS NULL THEN NULL
             ELSE ST_SetSRID(geom::geometry, ${geomSrid})
           END`
        ));
      }
    } catch {
      /* geometry_columns 없거나 ALTER 실패 시 INSERT에서 노출 */
    }
    // 기존 테이블(IF NOT EXISTS no-op)에도 columns에 있는 필드가 있도록 보장 (신규 키 등)
    for (const col of columns) {
      const cname = safeColumnName(col.define_field_name);
      if (!cname || cname === 'id' || cname === 'geom' || cname === PARCEL_ADDRESS_COL) continue;
      await db.execute(sql.raw(`ALTER TABLE ${fqTable} ADD COLUMN IF NOT EXISTS ${cname} text`));
    }
    const setColumnComment = async (colIdent: string, korLabel: string) => {
      const body = escapePostgresStringLiteral(korLabel);
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqTable}.${colIdent} IS '${body}'`));
    };
    await setColumnComment('id', 'id');
    await setColumnComment('geom', 'geom');
    await setColumnComment(PARCEL_ADDRESS_COL, '필지이름');
    const commentedCols = new Set<string>();
    for (const col of columns) {
      const cname = safeColumnName(col.define_field_name);
      if (!cname || commentedCols.has(cname)) continue;
      commentedCols.add(cname);
      const kor = String(col.define_field_kor_name ?? col.define_field_name ?? cname);
      await setColumnComment(cname, kor);
    }

    if (separateJijukTable && quotedJijuk) {
      const jijukCreate = `CREATE TABLE IF NOT EXISTS layer.${quotedJijuk} (
        id SERIAL PRIMARY KEY,
        parent_id integer NOT NULL REFERENCES layer.${quotedTable}(id) ON DELETE CASCADE,
        geom geometry(Geometry, ${geomSrid}),
        ${PARCEL_ADDRESS_COL} text
      )`;
      await db.execute(sql.raw(jijukCreate));
      const fqJijuk = `layer.${quotedJijuk}`;
      const jc = escapePostgresStringLiteral(jijukTableComment);
      await db.execute(sql.raw(`COMMENT ON TABLE ${fqJijuk} IS '${jc}'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqJijuk}.id IS 'id'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqJijuk}.parent_id IS '부모 행 id'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqJijuk}.geom IS 'geom'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqJijuk}.${PARCEL_ADDRESS_COL} IS '필지이름'`));
    }
    if (separateMulgunjiTable && quotedMulgunji) {
      const mulgunjiCreate = `CREATE TABLE IF NOT EXISTS layer.${quotedMulgunji} (
        id SERIAL PRIMARY KEY,
        parent_id integer NOT NULL REFERENCES layer.${quotedTable}(id) ON DELETE CASCADE,
        geom geometry(Geometry, ${geomSrid}),
        ${PARCEL_ADDRESS_COL} text
      )`;
      await db.execute(sql.raw(mulgunjiCreate));
      const fqMulgunji = `layer.${quotedMulgunji}`;
      const mc = escapePostgresStringLiteral(mulgunjiTableComment);
      await db.execute(sql.raw(`COMMENT ON TABLE ${fqMulgunji} IS '${mc}'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqMulgunji}.id IS 'id'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqMulgunji}.parent_id IS '부모 행 id'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqMulgunji}.geom IS 'geom'`));
      await db.execute(sql.raw(`COMMENT ON COLUMN ${fqMulgunji}.${PARCEL_ADDRESS_COL} IS '물건지주소'`));
    }

    // appendOnly가 아니면 기존 데이터 삭제 후 INSERT(전체 덮어쓰기)
    if (!appendOnly) {
      await db.execute(sql.raw(`TRUNCATE TABLE layer.${quotedTable} RESTART IDENTITY CASCADE`));
    }

    const pathOrResult = params.pathOrResult?.trim();
    const logPath =
      pathOrResult &&
      path.join(
        GGNR_DATA_DIR,
        path.dirname(pathOrResult.replace(/\//g, path.sep)),
        stripSpreadsheetExt(path.basename(pathOrResult)) + '.log'
      );
    const appendPnuLog = async (line: string) => {
      if (!logPath) return;
      try {
        await fs.appendFile(logPath, line + '\n');
      } catch (e) {
        console.error('[excelUploadService] PNU 로그 파일 쓰기 오류:', e);
      }
    };
    if (logPath && !appendOnly) {
      try {
        await fs.writeFile(logPath, `### Geocoding 실패 → PNU 폴백 로그 (${new Date().toISOString()})\n`, 'utf-8');
      } catch {
        // ignore
      }
    }

    let polygonMatchedCount = 0;
    let polygonNullCount = 0;
    let pnuAttemptCount = 0;
    let pnuOkCount = 0;
    let hangjeongRiFixOkCount = 0;
    const rowTag =
      params.excelRowNumber != null || params.rowKeyHint?.trim()
        ? `row=${params.excelRowNumber ?? '?'} key=${(params.rowKeyHint ?? '').trim() || '(없음)'} | `
        : '';

    // jijuk 테이블 좌표는 5181이나 컬럼 SRID가 0인 경우 있음 → 비교 시 geom에 5181 지정하여 동일 SRID로 연산
    const getJijukGeom = async (x: number, y: number, address?: string): Promise<string | null> => {
      const xNum = Number(x);
      const yNum = Number(y);
      const point5181 = `ST_Transform(ST_SetSRID(ST_MakePoint(${xNum}, ${yNum}), 4326), ${geomSrid})`;
      try {
        const res = await db.execute(sql.raw(
          `SELECT ST_AsText(geom) AS wkt FROM public_layer.jijuk WHERE ST_Intersects(ST_SetSRID(geom, ${geomSrid}), ${point5181}) LIMIT 1`
        ));
        const resRows = res.rows as Array<{ wkt?: string }>;
        const wkt = resRows[0]?.wkt ?? null;
        if (wkt) {
          console.log(`[excelUploadService] 지적 폴리곤 매칭 성공 (4326 x=${xNum}, y=${yNum}) → WKT 길이 ${wkt.length}`);
          return wkt;
        }
        console.log(`[excelUploadService] 지적 폴리곤 미매칭 (4326 x=${xNum}, y=${yNum}) ${address ? `주소: ${address.slice(0, 40)}...` : ''}`);
        return null;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[excelUploadService] getJijukGeom 오류 (x=${xNum}, y=${yNum}):`, msg);
        return null;
      }
    };

    // 파라미터 바인딩: $1=WKT, $2=입력 SRID(4326|5181), $3=parcel_address, $4..=value_001,... → 긴 WKT/텍스트로 인한 쿼리 절단 방지
    const geomCaseExpr = `CASE WHEN $1::text IS NULL THEN NULL WHEN $2::int = 4326 THEN ST_Transform(ST_GeomFromText($1::text, 4326), ${geomSrid}) ELSE ST_GeomFromText($1::text, 5181) END`;
    const colList = ['geom', PARCEL_ADDRESS_COL, ...colNames].join(', ');
    const valuePlaceholders = ['$3', ...colNames.map((_, i) => `$${4 + i}`)].join(', ');
    const insertText = `INSERT INTO layer.${quotedTable} (${colList}) VALUES (${geomCaseExpr}, ${valuePlaceholders})`;
    const insertParentReturning = `${insertText} RETURNING id`;

    const resolveOneParcel = async (parcel: {
      address?: string;
      x?: number;
      y?: number;
      geom?: string;
    }): Promise<ResolvedParcelGeom> => {
      let geomWkt: string | null = null;
      let geomInputSrid: 4326 | 5181 = 4326;
      if (parcel.geom) {
        geomWkt = String(parcel.geom);
        geomInputSrid = resolveExcelGeomInputSrid(geomWkt, geomSridOverride);
        if (geometryType === 'Polygon' && geomWkt.trim()) {
          polygonMatchedCount++;
        }
      } else if (parcel.x != null && parcel.y != null) {
        if (geometryType === 'Point') {
          geomWkt = `POINT(${Number(parcel.x)} ${Number(parcel.y)})`;
          geomInputSrid = 4326;
        } else {
          let wkt = await getJijukGeom(parcel.x, parcel.y, parcel.address);
          if (!wkt && parcel.address?.trim()) {
            pnuAttemptCount++;
            const parsed = parseAddressForPnu(parcel.address);
            const resolved = parsed ? await resolvePnuFromAddress(parcel.address) : null;
            const pnu = resolved?.pnu ?? null;
            if (pnu) wkt = await getJijukGeomByPnu(pnu, geomSrid);
            if (wkt) pnuOkCount++;
            if (wkt && resolved?.usedHangjeongToBeopjeong) hangjeongRiFixOkCount++;
            await appendPnuLog(
              formatPnuFallbackLogLine({
                rowTag,
                address: parcel.address,
                parsed,
                pnu,
                jijukFound: !!wkt,
                usedHangjeongToBeopjeong: resolved?.usedHangjeongToBeopjeong,
                matchedRi: resolved?.matchedRi,
              })
            );
          }
          if (wkt) {
            geomWkt = wkt;
            geomInputSrid = 5181;
            polygonMatchedCount++;
          } else {
            polygonNullCount++;
          }
        }
      } else if (geometryType === 'Polygon' && parcel.address?.trim()) {
        pnuAttemptCount++;
        const parsed = parseAddressForPnu(parcel.address);
        const resolved = parsed ? await resolvePnuFromAddress(parcel.address) : null;
        const pnu = resolved?.pnu ?? null;
        const wkt = pnu ? await getJijukGeomByPnu(pnu, geomSrid) : null;
        if (wkt) pnuOkCount++;
        if (wkt && resolved?.usedHangjeongToBeopjeong) hangjeongRiFixOkCount++;
        await appendPnuLog(
          formatPnuFallbackLogLine({
            rowTag,
            address: parcel.address,
            parsed,
            pnu,
            jijukFound: !!wkt,
            usedHangjeongToBeopjeong: resolved?.usedHangjeongToBeopjeong,
            matchedRi: resolved?.matchedRi,
          })
        );
        if (wkt) {
          geomWkt = wkt;
          geomInputSrid = 5181;
          polygonMatchedCount++;
        } else {
          polygonNullCount++;
        }
      }
      const parcelAddr = parcel.address != null ? String(parcel.address) : '';
      return { geomWkt, geomInputSrid, parcelAddr };
    };

    const geomWktsTo5181 = async (resolved: ResolvedParcelGeom[]): Promise<string[]> => {
      const out: string[] = [];
      for (const r of resolved) {
        if (!r.geomWkt) continue;
        if (r.geomInputSrid === 5181) {
          out.push(r.geomWkt);
          continue;
        }
        const tr = await pool.query(
          `SELECT ST_AsText(ST_Transform(ST_GeomFromText($1::text, 4326), $2::int)) AS wkt`,
          [r.geomWkt, geomSrid]
        );
        const w = tr.rows[0]?.wkt;
        if (w) out.push(String(w));
      }
      return out;
    };

    const mergeGeoms5181 = async (wkts5181: string[]): Promise<string | null> => {
      if (wkts5181.length === 0) return null;
      if (wkts5181.length === 1) return wkts5181[0]!;
      const esc = (w: string) => w.replace(/'/g, "''");
      const literals = wkts5181.map((w) => `ST_GeomFromText('${esc(w)}', ${geomSrid})`);
      const unionSql = `SELECT ST_AsText(ST_UnaryUnion(ST_Collect(ARRAY[${literals.join(', ')}]::geometry[]))) AS wkt`;
      const mr = await pool.query(unionSql);
      const mw = mr.rows[0]?.wkt;
      return mw != null ? String(mw) : null;
    };

    const joinParcelAddresses = (resolved: ResolvedParcelGeom[]): string => {
      return resolved
        .map((r) => String(r.parcelAddr ?? '').trim())
        .filter(Boolean)
        .join(', ');
    };

    const childGeomCase = `CASE WHEN $2::text IS NULL THEN NULL WHEN $3::int = 4326 THEN ST_Transform(ST_GeomFromText($2::text, 4326), ${geomSrid}) ELSE ST_GeomFromText($2::text, 5181) END`;
    const insertChildText =
      separateJijukTable && quotedJijuk
        ? `INSERT INTO layer.${quotedJijuk} (parent_id, geom, ${PARCEL_ADDRESS_COL}) VALUES ($1, ${childGeomCase}, $4)`
        : '';
    const insertMulgunjiText =
      separateMulgunjiTable && quotedMulgunji
        ? `INSERT INTO layer.${quotedMulgunji} (parent_id, geom, ${PARCEL_ADDRESS_COL}) VALUES ($1, ${childGeomCase}, $4)`
        : '';

    let insertCount = 0;
    for (const row of rows) {
      const attrs = row.attrs ?? {};
      const parcelList = Array.isArray(row.parcels) ? row.parcels : [];
      const toInsert = parcelList.length > 0 ? parcelList : [{ address: '' }];
      const mulgunjiList = Array.isArray(row.mulgunjis) ? row.mulgunjis : [];
      const toInsertMulgunji = mulgunjiList.length > 0 ? mulgunjiList : [];

      if (separateJijukTable && quotedJijuk) {
        const resolved: ResolvedParcelGeom[] = [];
        for (const parcel of toInsert) {
          resolved.push(await resolveOneParcel(parcel));
        }
        const wkts5181 = await geomWktsTo5181(resolved);
        const mergedWkt = await mergeGeoms5181(wkts5181);
        const mergedInputSrid: 4326 | 5181 = mergedWkt ? 5181 : 4326;
        const parentParcelAddr = joinParcelAddresses(resolved);
        const colValues = colNames.map((c) => (attrs[c] == null ? '' : String(attrs[c])));
        const parentParams = [mergedWkt, mergedInputSrid, parentParcelAddr, ...colValues];
        const pr = await pool.query(insertParentReturning, parentParams);
        const parentId = (pr.rows[0] as { id?: number } | undefined)?.id;
        insertCount += 1;
        if (parentId != null) {
          for (const r of resolved) {
            const qparams = [parentId, r.geomWkt, r.geomInputSrid, r.parcelAddr];
            await pool.query(insertChildText, qparams);
            insertCount += 1;
          }
          if (insertMulgunjiText) {
            for (const mg of toInsertMulgunji) {
              const r = await resolveOneParcel(mg);
              const qparams = [parentId, r.geomWkt, r.geomInputSrid, r.parcelAddr];
              await pool.query(insertMulgunjiText, qparams);
              insertCount += 1;
            }
          }
        }
        continue;
      }

      const resolved: ResolvedParcelGeom[] = [];
      for (const parcel of toInsert) {
        resolved.push(await resolveOneParcel(parcel));
      }
      const wkts5181 = await geomWktsTo5181(resolved);
      const mergedWkt = await mergeGeoms5181(wkts5181);
      const mergedInputSrid: 4326 | 5181 = mergedWkt ? 5181 : 4326;
      const parentParcelAddr = joinParcelAddresses(resolved);
      const colValues = colNames.map((c) => (attrs[c] == null ? '' : String(attrs[c])));
      const qparams = [mergedWkt, mergedInputSrid, parentParcelAddr, ...colValues];
      const pr = await pool.query(insertParentReturning, qparams);
      insertCount++;
      if (insertMulgunjiText) {
        const parentId = (pr.rows[0] as { id?: number } | undefined)?.id;
        if (parentId != null) {
          for (const mg of toInsertMulgunji) {
            const r = await resolveOneParcel(mg);
            const mgParams = [parentId, r.geomWkt, r.geomInputSrid, r.parcelAddr];
            await pool.query(insertMulgunjiText, mgParams);
            insertCount += 1;
          }
        }
      }
    }

    if (geometryType === 'Polygon' && (polygonMatchedCount > 0 || polygonNullCount > 0)) {
      console.log(`[excelUploadService] 폴리곤 매칭 결과: 성공 ${polygonMatchedCount}건, 미매칭(geom NULL) ${polygonNullCount}건`);
    }

    if (hangjeongRiFixOkCount > 0) {
      await appendPnuLog(
        `### 행정리→법정리 보정 후 지적 매칭 성공 ${hangjeongRiFixOkCount}건 (${new Date().toISOString()})`
      );
      console.log(
        `[excelUploadService] 행정리→법정리 보정 후 지적 매칭 성공 ${hangjeongRiFixOkCount}건`
      );
    }

    return {
      success: true,
      rowCount: insertCount,
      pnuAttemptCount,
      pnuOkCount,
      hangjeongRiFixOkCount,
      ...(geometryType === 'Polygon' && { polygonMatchedCount, polygonNullCount }),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[excelUploadService] createTableFromExcel 오류:', msg);
    return { success: false, error: msg };
  }
}

/**
 * 엑셀과 같은 폴더의 `.log`에 마법사 4단계 화면에 표시된 로그 전체를 기록한다.
 * createTableFromExcel 중 append된 PNU/폴백 줄이 있으면 파일 하단에 그대로 이어 붙인다.
 */
export async function writeExcelWizardLog(params: {
  pathOrResult: string;
  uiLines: string[];
}): Promise<{ success: boolean; error?: string }> {
  const pathOrResult = params.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };
  const relative = pathOrResult.replace(/\//g, path.sep);
  const absoluteDir = path.join(GGNR_DATA_DIR, path.dirname(relative));
  const base = stripSpreadsheetExt(path.basename(relative));
  const logPath = path.join(absoluteDir, `${base}.log`);

  let serverSection = '';
  try {
    serverSection = await fs.readFile(logPath, 'utf-8');
  } catch {
    /* 파일 없음 */
  }

  const ts = new Date().toISOString();
  let out = `# Excel 마법사 처리 로그 (${ts})\n\n## 마법사 화면(4단계) 로그\n\n`;
  out += params.uiLines.length > 0 ? params.uiLines.join('\n') : '(로그 없음)';
  if (serverSection.trim()) {
    const serverBody = serverSection
      .trim()
      .replace(/^#\s+Geocoding 실패/m, '### Geocoding 실패');
    out += `\n\n## 행 삽입 중 서버 기록 (Geocoding 실패·PNU 폴백 등)\n\n${serverBody}`;
  }

  try {
    await fs.mkdir(absoluteDir, { recursive: true });
    await fs.writeFile(logPath, out, 'utf-8');
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * Excel 유래 테이블에 대해 tables.json에 define_table_source: "excel" 항목 추가 및 fields 생성.
 */
export async function createDefineTableAndFieldsForExcel(params: {
  tableName: string;
  tableKorName: string;
  geometryType: 'Point' | 'Polygon';
  columns: ExcelColumnDef[];
  /** 레이어 그룹명 (tables.json define_table_group) */
  group?: string;
  /** 부모와 함께 등록할 지적 자식 테이블 (layer.{parent}_jijuk) */
  jijukChild?: { tableName: string; tableKorName: string };
  /** 부모와 함께 등록할 물건지 자식 테이블 (layer.{parent}_mulgunji) */
  mulgunjiChild?: { tableName: string; tableKorName: string };
}): Promise<{ success: boolean; error?: string }> {
  const tableName = safeTableName(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const groupVal = String(params.group ?? '').trim();

  try {
    let tables: Record<string, unknown>[] = [];
    try {
      const raw = await fs.readFile(DEFINE_LAYER_TABLES_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tables = parsed;
    } catch {
      // file missing
    }
    const existing = tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === tableName
    );
    if (!existing) {
      tables.push(
        reorderDefineLayerTableRow({
          define_table_name: tableName,
          define_table_kor_name: params.tableKorName || tableName,
          define_table_shp_type: params.geometryType === 'Point' ? 'POINT' : 'POLYGON',
          define_table_read_share: 'P',
          define_table_write_share: 'P',
          define_table_group: groupVal,
          define_table_idx: '0',
          define_table_etc: '',
          define_table_schema: 'layer',
          define_table_source: 'excel',
        })
      );
      await fs.mkdir(path.dirname(DEFINE_LAYER_TABLES_PATH), { recursive: true });
      await fs.writeFile(
        DEFINE_LAYER_TABLES_PATH,
        JSON.stringify(reorderDefineLayerTablesArray(tables), null, 2),
        'utf-8'
      );
    } else {
      (existing as Record<string, unknown>).define_table_source = 'excel';
      (existing as Record<string, unknown>).define_table_shp_type =
        params.geometryType === 'Point' ? 'POINT' : 'POLYGON';
      if (params.tableKorName?.trim()) {
        (existing as Record<string, unknown>).define_table_kor_name = params.tableKorName.trim();
      }
      if (groupVal && !String((existing as Record<string, unknown>).define_table_group ?? '').trim()) {
        (existing as Record<string, unknown>).define_table_group = groupVal;
      }
      await fs.writeFile(
        DEFINE_LAYER_TABLES_PATH,
        JSON.stringify(reorderDefineLayerTablesArray(tables), null, 2),
        'utf-8'
      );
    }

    const fieldsPath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${tableName}.json`);
    await fs.mkdir(path.dirname(fieldsPath), { recursive: true });
    const fieldList: Record<string, unknown>[] = [];
    let idx = 1;
    fieldList.push({
      define_field_name: 'id',
      define_field_kor_name: 'id',
      define_field_type: 'NUMBER',
      define_field_idx: idx++,
      define_field_is_required: false,
      define_field_show_search: false,
      define_field_show_list: true,
      define_field_show_detail: true,
      define_field_read_only: false,
      define_field_is_key: false,
      define_field_show_search_detail: false,
      define_field_max_length: '',
      define_field_sort_idx: '',
      define_field_sort_type: '',
      define_field_sel_list: '',
      define_field_sel_table: '',
      define_field_sel_query: '',
      define_field_sel_url: '',
      define_field_show_detail_list: false,
      define_field_sel_key_field: '',
      define_field_sel_label_field: '',
      define_field_default_value: '',
      define_field_show_title: false,
    });
    fieldList.push({
      define_field_name: 'geom',
      define_field_kor_name: 'geom',
      define_field_type: 'TEXT',
      define_field_idx: idx++,
      define_field_is_required: false,
      define_field_show_search: false,
      define_field_show_list: false,
      define_field_show_detail: true,
      define_field_read_only: false,
      define_field_is_key: false,
      define_field_show_search_detail: false,
      define_field_max_length: '',
      define_field_sort_idx: '',
      define_field_sort_type: '',
      define_field_sel_list: '',
      define_field_sel_table: '',
      define_field_sel_query: '',
      define_field_sel_url: '',
      define_field_show_detail_list: false,
      define_field_sel_key_field: '',
      define_field_sel_label_field: '',
      define_field_default_value: '',
      define_field_show_title: false,
    });
    fieldList.push({
      define_field_name: PARCEL_ADDRESS_COL,
      define_field_kor_name: '필지이름',
      define_field_type: 'TEXT',
      define_field_idx: idx++,
      define_field_is_required: false,
      define_field_show_search: true,
      define_field_show_list: true,
      define_field_show_detail: true,
      define_field_read_only: false,
      define_field_is_key: false,
      define_field_show_search_detail: false,
      define_field_max_length: '',
      define_field_sort_idx: '',
      define_field_sort_type: '',
      define_field_sel_list: '',
      define_field_sel_table: '',
      define_field_sel_query: '',
      define_field_sel_url: '',
      define_field_show_detail_list: false,
      define_field_sel_key_field: '',
      define_field_sel_label_field: '',
      define_field_default_value: '',
      define_field_show_title: false,
    });
    for (const col of params.columns ?? []) {
      fieldList.push({
        define_field_name: safeColumnName(col.define_field_name),
        define_field_kor_name: col.define_field_kor_name ?? col.define_field_name,
        define_field_type: 'TEXT',
        define_field_idx: idx++,
        define_field_is_required: false,
        define_field_show_search: col.define_field_show_search ?? false,
        define_field_show_list: col.define_field_show_list ?? true,
        define_field_show_detail: true,
        define_field_read_only: false,
        define_field_is_key: col.define_field_is_key ?? false,
        define_field_show_search_detail: false,
        define_field_max_length: '',
        define_field_sort_idx: '',
        define_field_sort_type: '',
        define_field_sel_list: '',
        define_field_sel_table: '',
        define_field_sel_query: '',
        define_field_sel_url: '',
        define_field_show_detail_list: false,
        define_field_sel_key_field: '',
        define_field_sel_label_field: '',
        define_field_default_value: '',
        define_field_show_title: false,
      });
    }
    await fs.writeFile(fieldsPath, JSON.stringify(fieldList, null, 2), 'utf-8');

    const jChild = params.jijukChild;
    if (jChild?.tableName) {
      const jName = safeTableName(jChild.tableName);
      if (jName) {
        let tablesJ: Record<string, unknown>[] = [];
        try {
          const rawJ = await fs.readFile(DEFINE_LAYER_TABLES_PATH, 'utf-8');
          const parsedJ = JSON.parse(rawJ);
          if (Array.isArray(parsedJ)) tablesJ = parsedJ;
        } catch {
          tablesJ = [];
        }
        const existingJ = tablesJ.find(
          (r) => String(r.define_table_name ?? '').trim().toLowerCase() === jName
        );
        const jKor = (jChild.tableKorName ?? `${params.tableKorName}_필지목록`).trim() || jName;
        if (!existingJ) {
          tablesJ.push(
            reorderDefineLayerTableRow({
              define_table_name: jName,
              define_table_kor_name: jKor,
              define_table_shp_type: params.geometryType === 'Point' ? 'POINT' : 'POLYGON',
              define_table_read_share: 'P',
              define_table_write_share: 'P',
              define_table_group: groupVal,
              define_table_idx: '0',
              define_table_etc: '',
              define_table_schema: 'layer',
              define_table_source: 'excel',
            })
          );
          await fs.mkdir(path.dirname(DEFINE_LAYER_TABLES_PATH), { recursive: true });
          await fs.writeFile(
            DEFINE_LAYER_TABLES_PATH,
            JSON.stringify(reorderDefineLayerTablesArray(tablesJ), null, 2),
            'utf-8'
          );
        }

        const jFieldsPath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${jName}.json`);
        await fs.mkdir(path.dirname(jFieldsPath), { recursive: true });
        let jIdx = 1;
        const jFields: Record<string, unknown>[] = [];
        const pushJ = (row: Record<string, unknown>) => {
          jFields.push({ ...row, define_field_idx: jIdx++ });
        };
        pushJ({
          define_field_name: 'id',
          define_field_kor_name: 'id',
          define_field_type: 'NUMBER',
          define_field_is_required: false,
          define_field_show_search: false,
          define_field_show_list: true,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        pushJ({
          define_field_name: 'parent_id',
          define_field_kor_name: '부모 id',
          define_field_type: 'NUMBER',
          define_field_is_required: true,
          define_field_show_search: false,
          define_field_show_list: true,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        pushJ({
          define_field_name: 'geom',
          define_field_kor_name: 'geom',
          define_field_type: 'TEXT',
          define_field_is_required: false,
          define_field_show_search: false,
          define_field_show_list: false,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        pushJ({
          define_field_name: PARCEL_ADDRESS_COL,
          define_field_kor_name: '필지이름',
          define_field_type: 'TEXT',
          define_field_is_required: false,
          define_field_show_search: true,
          define_field_show_list: true,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        await fs.writeFile(jFieldsPath, JSON.stringify(jFields, null, 2), 'utf-8');
      }
    }

    const mChild = params.mulgunjiChild;
    if (mChild?.tableName) {
      const mName = safeTableName(mChild.tableName);
      if (mName) {
        let tablesM: Record<string, unknown>[] = [];
        try {
          const rawM = await fs.readFile(DEFINE_LAYER_TABLES_PATH, 'utf-8');
          const parsedM = JSON.parse(rawM);
          if (Array.isArray(parsedM)) tablesM = parsedM;
        } catch {
          tablesM = [];
        }
        const existingM = tablesM.find(
          (r) => String(r.define_table_name ?? '').trim().toLowerCase() === mName
        );
        const mKor = (mChild.tableKorName ?? `${params.tableKorName}_물건지`).trim() || mName;
        if (!existingM) {
          tablesM.push(
            reorderDefineLayerTableRow({
              define_table_name: mName,
              define_table_kor_name: mKor,
              define_table_shp_type: params.geometryType === 'Point' ? 'POINT' : 'POLYGON',
              define_table_read_share: 'P',
              define_table_write_share: 'P',
              define_table_group: groupVal,
              define_table_idx: '0',
              define_table_etc: '',
              define_table_schema: 'layer',
              define_table_source: 'excel',
            })
          );
          await fs.mkdir(path.dirname(DEFINE_LAYER_TABLES_PATH), { recursive: true });
          await fs.writeFile(
            DEFINE_LAYER_TABLES_PATH,
            JSON.stringify(reorderDefineLayerTablesArray(tablesM), null, 2),
            'utf-8'
          );
        }

        const mFieldsPath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${mName}.json`);
        await fs.mkdir(path.dirname(mFieldsPath), { recursive: true });
        let mIdx = 1;
        const mFields: Record<string, unknown>[] = [];
        const pushM = (row: Record<string, unknown>) => {
          mFields.push({ ...row, define_field_idx: mIdx++ });
        };
        pushM({
          define_field_name: 'id',
          define_field_kor_name: 'id',
          define_field_type: 'NUMBER',
          define_field_is_required: false,
          define_field_show_search: false,
          define_field_show_list: true,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        pushM({
          define_field_name: 'parent_id',
          define_field_kor_name: '부모 id',
          define_field_type: 'NUMBER',
          define_field_is_required: true,
          define_field_show_search: false,
          define_field_show_list: true,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        pushM({
          define_field_name: 'geom',
          define_field_kor_name: 'geom',
          define_field_type: 'TEXT',
          define_field_is_required: false,
          define_field_show_search: false,
          define_field_show_list: false,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        pushM({
          define_field_name: PARCEL_ADDRESS_COL,
          define_field_kor_name: '물건지주소',
          define_field_type: 'TEXT',
          define_field_is_required: false,
          define_field_show_search: true,
          define_field_show_list: true,
          define_field_show_detail: true,
          define_field_read_only: false,
          define_field_is_key: false,
          define_field_show_search_detail: false,
          define_field_max_length: '',
          define_field_sort_idx: '',
          define_field_sort_type: '',
          define_field_sel_list: '',
          define_field_sel_table: '',
          define_field_sel_query: '',
          define_field_sel_url: '',
          define_field_show_detail_list: false,
          define_field_sel_key_field: '',
          define_field_sel_label_field: '',
          define_field_default_value: '',
          define_field_show_title: false,
        });
        await fs.writeFile(mFieldsPath, JSON.stringify(mFields, null, 2), 'utf-8');
      }
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer 레이어 및 스타일 생성 (Excel 테이블용).
 * jijukTableName 이 있으면 부모 발행·스타일 후 지적 자식 테이블도 동일 처리.
 */
export async function createGeoServerLayerForExcel(params: {
  tableName: string;
  geometryType: 'Point' | 'Polygon';
  /** layer.{parent}_jijuk 등 — define/DB가 이미 준비된 경우에만 의미 있음 */
  jijukTableName?: string | null;
  /** layer.{parent}_mulgunji 등 — define/DB가 이미 준비된 경우에만 의미 있음 */
  mulgunjiTableName?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const publishOne = async (rawName: string) => {
    const layerName = safeTableName(rawName);
    if (!layerName) return { success: false as const, error: 'tableName이 필요합니다.' };
    const layerRes = await createOrUpdateGeoServerLayer({ layerName });
    if (!layerRes.success) return { success: false as const, error: layerRes.error };
    const styleRes = await applyDefaultStyleToLayer({ layerName });
    if (!styleRes.success) return { success: false as const, error: styleRes.error };
    return { success: true as const };
  };

  try {
    const parent = await publishOne(params.tableName);
    if (!parent.success) return parent;
    const jRaw = params.jijukTableName?.trim();
    if (jRaw) {
      const jr = await publishOne(jRaw);
      if (!jr.success) return jr;
    }
    const mRaw = params.mulgunjiTableName?.trim();
    if (!mRaw) return { success: true };
    return publishOne(mRaw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** defineLayer fields에서 key 필드명(영문) 및 한글명 조회 */
function getKeyFieldFromDefine(tableName: string): { keyField: string; keyHeaderKor: string } | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fsSync.existsSync(filePath)) return null;
    const raw = fsSync.readFileSync(filePath, 'utf-8');
    const fields = JSON.parse(raw) as Array<{ define_field_name?: string; define_field_kor_name?: string; define_field_is_key?: boolean }>;
    const keyRow = Array.isArray(fields) ? fields.find((f) => f?.define_field_is_key === true || String(f?.define_field_is_key ?? '').toLowerCase() === 'true') : null;
    if (!keyRow?.define_field_name) return null;
    return {
      keyField: String(keyRow.define_field_name).trim(),
      keyHeaderKor: String(keyRow.define_field_kor_name ?? keyRow.define_field_name).trim(),
    };
  } catch {
    return null;
  }
}

export type CompareExcelResult = {
  success: boolean;
  error?: string;
  tableName?: string;
  keyField?: string;
  appendCount: number;
  conflictCount: number;
  removeCount: number;
  unchangedCount: number;
  conflicts: Array<{ key: string; diffFields: string[]; dbValues: Record<string, unknown>; excelValues: Record<string, unknown> }>;
  removes: Array<{ key: string; values: Record<string, unknown> }>;
};

/**
 * Excel 파일과 기존 테이블을 key 기준으로 비교.
 * remove 항목만 excel_sync_log에 기록 (append는 재처리 필요).
 */
export async function compareExcelWithTable(params: {
  pathOrResult: string;
  tableName: string;
  ehKey?: number;
  /** define/엑셀 헤더 행 수(1~3) */
  titleRowLines?: 1 | 2 | 3;
}): Promise<CompareExcelResult> {
  const empty: CompareExcelResult = { success: false, appendCount: 0, conflictCount: 0, removeCount: 0, unchangedCount: 0, conflicts: [], removes: [] };
  const pathOrResult = params?.pathOrResult?.trim();
  const tableName = safeTableName(params?.tableName ?? '');
  const ehKey = params?.ehKey;
  if (!pathOrResult || !tableName) return { ...empty, error: 'pathOrResult와 tableName이 필요합니다.' };

  const keyInfo = getKeyFieldFromDefine(tableName);
  if (!keyInfo) return { ...empty, error: 'defineLayer에 key 필드가 없습니다.' };

  const parseRes = await parseExcelFile({ pathOrResult, titleRowLines: params.titleRowLines });
  if (!parseRes.success || !parseRes.headers?.length || !parseRes.rows?.length) {
    return { ...empty, error: parseRes.error ?? 'Excel 파싱 실패' };
  }

  const { keyField, keyHeaderKor } = keyInfo;
  const headerIdx = parseRes.headers.indexOf(keyHeaderKor);
  if (headerIdx < 0) return { ...empty, error: `Excel에 key 컬럼 '${keyHeaderKor}'이 없습니다.` };

  const excelKeys = Array.from(new Set(parseRes.rows.map((r) => String(r[parseRes.headers![headerIdx]] ?? '').trim()).filter(Boolean)));
  let dbKeys: string[] = [];
  try {
    const res = await db.execute(sql.raw(
      `SELECT DISTINCT "${keyField}"::text AS k FROM layer."${tableName}"`
    ));
    dbKeys = (res.rows as Array<{ k: string }>).map((r) => String(r?.k ?? '').trim()).filter(Boolean);
  } catch {
    return { ...empty, error: '테이블 조회 실패' };
  }

  const excelSet = new Set(excelKeys);
  const dbSet = new Set(dbKeys);
  const appendKeys = excelKeys.filter((k) => !dbSet.has(k));
  const removeKeys = dbKeys.filter((k) => !excelSet.has(k));
  const conflictKeys = excelKeys.filter((k) => dbSet.has(k));

  const removeCount = removeKeys.length;
  const appendCount = appendKeys.length;
  const unchangedCount = conflictKeys.length;

  try {
    await db.execute(sql.raw(
      `DELETE FROM excel_sync_log WHERE esl_table_name = '${tableName}' AND esl_operation IS NULL`
    ));

    const ehKeyVal = ehKey != null ? ehKey : 'NULL';
    if (removeCount > 0) {
      for (const kv of removeKeys) {
        const safeKv = kv.replace(/'/g, "''");
        const ins = await db.execute(sql.raw(
          `INSERT INTO excel_sync_log (esl_eh_key, esl_table_name, esl_key_field, esl_key_value, esl_old_data, esl_new_data)
           SELECT ${ehKeyVal}, '${tableName}', '${keyField}', '${safeKv}',
             ${excelLayerRowJsonbSql('t')}, NULL
           FROM layer."${tableName}" t WHERE t."${keyField}"::text = '${safeKv}' LIMIT 1
           RETURNING esl_key`
        ));
        const eslKey = (ins.rows as Array<{ esl_key: number }>)[0]?.esl_key;
        if (eslKey != null) {
          await insertExcelSyncLogGeomFromLayer({
            eslKey,
            tableName,
            keyField,
            keyValue: kv,
            side: 'old',
          });
        }
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
  }

  try {
    await syncExcelSyncLogJsonGeomFromSideTable({ tableName, ehKey: ehKey ?? null });
  } catch {
    /* JSON 보강 실패는 비교 결과와 분리 */
  }

  return {
    success: true,
    tableName,
    keyField,
    appendCount,
    conflictCount: 0,
    removeCount,
    unchangedCount,
    conflicts: [],
    removes: removeKeys.slice(0, 500).map((key) => ({ key, values: {} })),
  };
}

const INTEGRITY_SKIP_ATTR_KEYS = new Set(['id', 'geom', 'ogc_fid', 'parcel_address']);
const EXCEL_GEOM_COMPARE_GRID_M = 0.05;

function normalizeAttrMap(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k);
    if (INTEGRITY_SKIP_ATTR_KEYS.has(key.toLowerCase())) continue;
    out[key] = v == null ? '' : String(v);
  }
  return out;
}

function diffAttrFields(
  dbAttrs: Record<string, unknown>,
  excelAttrs: Record<string, unknown>
): string[] {
  const keys = new Set([...Object.keys(dbAttrs), ...Object.keys(excelAttrs)]);
  const diffs: string[] = [];
  for (const k of keys) {
    if (INTEGRITY_SKIP_ATTR_KEYS.has(k.toLowerCase())) continue;
    const a = String(dbAttrs[k] ?? '');
    const b = String(excelAttrs[k] ?? '');
    if (a !== b) diffs.push(k);
  }
  return diffs;
}

type ExcelGeomFamily = 'point' | 'polygon' | 'line' | 'empty' | 'other';

function geomFamilyFromDbType(gtype: string | null | undefined): ExcelGeomFamily {
  if (!gtype?.trim()) return 'empty';
  const u = gtype.toUpperCase();
  if (u.includes('POINT')) return 'point';
  if (u.includes('POLYGON')) return 'polygon';
  if (u.includes('LINE')) return 'line';
  return 'other';
}

function geomFamilyFromUpload(gt: 'Point' | 'Polygon' | undefined): 'point' | 'polygon' | null {
  if (gt === 'Point') return 'point';
  if (gt === 'Polygon') return 'polygon';
  return null;
}

/** 좌표 없이 타입만 남길 때 — coordinates:[] 로 메타(_meta/hash)와 구분, 이력 상세에 표시됨 */
function geomTypeOnlyPlaceholder(typeLabel: string): Record<string, unknown> {
  return { type: typeLabel, coordinates: [] };
}

function uploadGeomTypeLabel(uploadFam: 'point' | 'polygon' | null): string | null {
  if (uploadFam === 'polygon') return 'Polygon';
  if (uploadFam === 'point') return 'Point';
  return null;
}

async function resolveJijukWktFromLonLat(lon: number, lat: number): Promise<string | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  try {
    const point5181 = `ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)`;
    const res = await db.execute(sql.raw(
      `SELECT ST_AsText(geom) AS wkt
       FROM public_layer.jijuk
       WHERE ST_Intersects(ST_SetSRID(geom, 5181), ${point5181})
       LIMIT 1`
    ));
    const wkt = (res.rows as Array<{ wkt?: string }>)[0]?.wkt;
    return wkt ? String(wkt) : null;
  } catch {
    return null;
  }
}

async function hashLonLatPoint5181(lon: number, lat: number): Promise<string | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  try {
    const res = await pool.query(
      `SELECT md5(encode(ST_AsBinary(ST_SnapToGrid(
         ST_Transform(ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326), 5181),
         $3::float8
       )), 'hex')) AS h`,
      [lon, lat, EXCEL_GEOM_COMPARE_GRID_M]
    );
    const h = (res.rows as Array<{ h?: string }>)[0]?.h;
    return h ? String(h) : null;
  } catch {
    return null;
  }
}

async function hashWkt5181(wkt: string): Promise<string | null> {
  const w = String(wkt ?? '').trim();
  if (!w) return null;
  try {
    const res = await pool.query(
      `SELECT md5(encode(ST_AsBinary(ST_SnapToGrid(ST_GeomFromText($1::text, 5181), $2::float8)), 'hex')) AS h`,
      [w, EXCEL_GEOM_COMPARE_GRID_M]
    );
    const h = (res.rows as Array<{ h?: string }>)[0]?.h;
    return h ? String(h) : null;
  } catch {
    return null;
  }
}

/**
 * 기존 테이블 정합성: 엑셀(지오코딩 완료) 행과 DB를 키·속성·도형으로 비교해 pending excel_sync_log 작성.
 * 본테이블은 변경하지 않는다.
 */
export async function prepareExcelIntegritySync(params: {
  tableName: string;
  keyField: string;
  rows: ExcelRowInput[];
  /** 이번 업로드 도형 모드 — Point↔Polygon 등 도형 타입 변경 감지에 사용 */
  geometryType?: 'Point' | 'Polygon';
  /**
   * 청크 업로드 시 전체 엑셀 키 목록.
   * 있으면 remove/append 판정에 사용하고, rows는 해당 배치만 처리.
   */
  excelKeysUniverse?: string[];
  /** 0-based 청크 인덱스 (첫 청크에서만 미결 discard) */
  chunkIndex?: number;
  /** 총 청크 수 (마지막 청크에서만 remove 로그 작성) */
  chunkTotal?: number;
}): Promise<
  CompareExcelResult & {
    columns: string[];
    appendKeys: string[];
  }
> {
  const empty = {
    success: false as const,
    appendCount: 0,
    conflictCount: 0,
    removeCount: 0,
    unchangedCount: 0,
    conflicts: [] as CompareExcelResult['conflicts'],
    removes: [] as CompareExcelResult['removes'],
    columns: [] as string[],
    appendKeys: [] as string[],
  };
  const tableName = safeTableName(params.tableName ?? '');
  const keyField = safeColumnName(params.keyField ?? '');
  const rows = params.rows ?? [];
  const geometryType = params.geometryType;
  const chunkIndex = Math.max(0, Number(params.chunkIndex) || 0);
  const chunkTotal = Math.max(1, Number(params.chunkTotal) || 1);
  const universeRaw = Array.isArray(params.excelKeysUniverse)
    ? params.excelKeysUniverse.map((k) => String(k ?? '').trim()).filter(Boolean)
    : null;
  const isChunked = universeRaw != null && universeRaw.length > 0;
  const isFirstChunk = !isChunked || chunkIndex === 0;
  const isLastChunk = !isChunked || chunkIndex >= chunkTotal - 1;
  if (!tableName || !keyField) {
    return { ...empty, error: 'tableName과 keyField가 필요합니다.' };
  }
  if (rows.length === 0) {
    return { ...empty, error: '비교할 엑셀 행이 없습니다.' };
  }

  try {
    // 이전 위저드 미결·미반영 의도 제거 (과거 이력에 묶인 확정 로그는 유지)
    if (isFirstChunk) {
      await discardExcelIntegrityReview({ tableName });
    }

    const dbRes = await db.execute(sql.raw(
      `SELECT (COALESCE(row_to_json(t.*)::jsonb, '{}'::jsonb) - 'geom') AS j
       FROM layer."${tableName}" t`
    ));
    const dbMap = new Map<string, Record<string, unknown>>();
    for (const row of dbRes.rows as Array<{ j: Record<string, unknown> }>) {
      const attrs = normalizeAttrMap(row.j);
      const kv = String(attrs[keyField] ?? '').trim();
      if (!kv) continue;
      if (!dbMap.has(kv)) dbMap.set(kv, attrs);
    }

    const dbGeomMeta = new Map<string, { gtype: string | null; ghash: string | null }>();
    try {
      const gRes = await db.execute(sql.raw(
        `SELECT t."${keyField}"::text AS k,
                CASE WHEN t.geom IS NULL THEN NULL ELSE GeometryType(t.geom) END AS gtype,
                CASE WHEN t.geom IS NULL THEN NULL
                     ELSE md5(encode(ST_AsBinary(ST_SnapToGrid(t.geom, ${EXCEL_GEOM_COMPARE_GRID_M})), 'hex'))
                END AS ghash
         FROM layer."${tableName}" t
         WHERE t."${keyField}" IS NOT NULL AND btrim(t."${keyField}"::text) <> ''`
      ));
      for (const r of gRes.rows as Array<{ k?: string; gtype?: string | null; ghash?: string | null }>) {
        const kv = String(r.k ?? '').trim();
        if (!kv || dbGeomMeta.has(kv)) continue;
        dbGeomMeta.set(kv, {
          gtype: r.gtype != null ? String(r.gtype) : null,
          ghash: r.ghash != null ? String(r.ghash) : null,
        });
      }
    } catch {
      /* geom 메타 조회 실패 시 속성 비교만 */
    }

    const excelMap = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const attrs = normalizeAttrMap((row.attrs ?? {}) as Record<string, unknown>);
      const kv = String(attrs[keyField] ?? '').trim();
      if (!kv) continue;
      if (!excelMap.has(kv)) excelMap.set(kv, attrs);
    }

    const excelKeysInChunk = [...excelMap.keys()];
    const excelKeysUniverse = isChunked ? [...new Set(universeRaw!)] : excelKeysInChunk;
    const dbKeys = [...dbMap.keys()];
    const excelSet = new Set(excelKeysUniverse);
    const dbSet = new Set(dbKeys);

    const appendKeysAll = excelKeysUniverse.filter((k) => !dbSet.has(k));
    const appendKeysThisChunk = appendKeysAll.filter((k) => excelMap.has(k));
    const removeKeys = isLastChunk ? dbKeys.filter((k) => !excelSet.has(k)) : [];
    const bothKeys = excelKeysInChunk.filter((k) => dbSet.has(k));

    const excelCoordsByKey = new Map<string, { x: number; y: number } | { wkt: string; srid?: number }>();
    const excelAddressByKey = new Map<string, string>();
    for (const row of rows) {
      const attrs = normalizeAttrMap((row.attrs ?? {}) as Record<string, unknown>);
      const kv = String(attrs[keyField] ?? '').trim();
      if (!kv) continue;
      const parcels = Array.isArray(row.parcels) ? row.parcels : [];
      const mulgunjis = Array.isArray(row.mulgunjis) ? row.mulgunjis : [];
      const candidates = [...parcels, ...mulgunjis];
      if (!excelAddressByKey.has(kv)) {
        const withAddr = candidates.find((p) => p?.address && String(p.address).trim());
        if (withAddr?.address) {
          excelAddressByKey.set(kv, String(withAddr.address).trim());
        }
      }
      if (excelCoordsByKey.has(kv)) continue;
      const withGeom = candidates.find((p) => p?.geom && String(p.geom).trim());
      if (withGeom?.geom) {
        const g = String(withGeom.geom).trim();
        if (/^(POINT|POLYGON|MULTI|LINESTRING)/i.test(g)) {
          excelCoordsByKey.set(kv, { wkt: g, srid: 5181 });
          continue;
        }
      }
      const withXy = candidates.find(
        (p) => p != null && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
      );
      if (withXy) {
        excelCoordsByKey.set(kv, { x: Number(withXy.x), y: Number(withXy.y) });
      }
    }

    /** 폴리곤 이력 미리보기: 경위도 교차 → 실패 시 주소→PNU→지적 (적재 경로와 동일) */
    const ensurePolygonPreviewWkt = async (kv: string) => {
      const coord = excelCoordsByKey.get(kv);
      if (coord && 'wkt' in coord && coord.wkt) return;

      if (coord && 'x' in coord) {
        const wkt = await resolveJijukWktFromLonLat(coord.x, coord.y);
        if (wkt) {
          excelCoordsByKey.set(kv, { wkt, srid: 5181 });
          return;
        }
      }

      const address = excelAddressByKey.get(kv)?.trim();
      if (!address) return;
      const pnu = await getPnuFromAddress(address);
      if (!pnu) return;
      const wkt = await getJijukGeomByPnu(pnu, 5181);
      if (wkt) excelCoordsByKey.set(kv, { wkt, srid: 5181 });
    };

    const attachNewGeom = async (eslKey: number, kv: string) => {
      if (geometryType === 'Polygon') {
        await ensurePolygonPreviewWkt(kv);
      }
      const coord = excelCoordsByKey.get(kv);
      if (!coord) return;
      if ('wkt' in coord && coord.wkt) {
        await insertExcelSyncLogGeomFromWkt({ eslKey, wkt: coord.wkt, srid: coord.srid });
      } else if ('x' in coord && 'y' in coord) {
        await insertExcelSyncLogGeomFromLonLat({ eslKey, lon: coord.x, lat: coord.y });
      }
    };

    const uploadFam = geomFamilyFromUpload(geometryType);

    const conflicts: CompareExcelResult['conflicts'] = [];
    let unchangedCount = 0;
    for (const kv of bothKeys) {
      const dbAttrs = dbMap.get(kv)!;
      const excelAttrs = excelMap.get(kv)!;
      const diffFields = diffAttrFields(dbAttrs, excelAttrs);
      const meta = dbGeomMeta.get(kv);
      const dbFam = geomFamilyFromDbType(meta?.gtype);
      let geomChanged = false;

      if (uploadFam && dbFam !== 'empty' && dbFam !== 'other' && uploadFam !== dbFam) {
        geomChanged = true;
      } else if (uploadFam === 'point' && dbFam === 'point') {
        const coord = excelCoordsByKey.get(kv);
        if (coord && 'x' in coord) {
          const nh = await hashLonLatPoint5181(coord.x, coord.y);
          if (nh && meta?.ghash && nh !== meta.ghash) geomChanged = true;
          else if (nh && !meta?.ghash) geomChanged = true;
        } else if (meta?.gtype) {
          /* 엑셀 좌표 없음 — 도형 비교 생략 */
        }
      } else if (uploadFam === 'polygon' && dbFam === 'polygon') {
        await ensurePolygonPreviewWkt(kv);
        const coord = excelCoordsByKey.get(kv);
        if (coord && 'wkt' in coord && coord.wkt) {
          const nh = await hashWkt5181(coord.wkt);
          if (nh && meta?.ghash && nh !== meta.ghash) geomChanged = true;
          else if (nh && !meta?.ghash) geomChanged = true;
        }
      } else if (dbFam === 'empty' && uploadFam) {
        // DB 무도형 + Point/Polygon 재업로드 → 좌표 유무와 관계없이 미결(타입 부여)
        geomChanged = true;
      }

      if (diffFields.length === 0 && !geomChanged) {
        unchangedCount += 1;
        continue;
      }

      const fields = [...diffFields];
      if (geomChanged && !fields.includes('geom')) fields.push('geom');

      const newTypeLabel = uploadGeomTypeLabel(uploadFam);
      const oldTypeLabel =
        dbFam === 'point'
          ? 'Point'
          : dbFam === 'polygon'
            ? 'Polygon'
            : dbFam === 'line'
              ? 'LineString'
              : dbFam === 'empty'
                ? null
                : (meta?.gtype ? String(meta.gtype).replace(/^ST_/i, '') : null);

      // 사이드 테이블에 실좌표가 있으면 이후 GeoJSON으로 덮어씀. 없으면 타입만 자리표시.
      const dbValues: Record<string, unknown> = { ...dbAttrs };
      const excelValues: Record<string, unknown> = { ...excelAttrs };
      if (geomChanged) {
        if (oldTypeLabel) {
          dbValues.geom = geomTypeOnlyPlaceholder(oldTypeLabel);
        } else if (dbFam === 'empty') {
          dbValues.geom = geomTypeOnlyPlaceholder('도형 없음');
        }
        if (newTypeLabel) {
          excelValues.geom = geomTypeOnlyPlaceholder(newTypeLabel);
        }
      }

      conflicts.push({
        key: kv,
        diffFields: fields,
        dbValues,
        excelValues,
      });
      const ins = await pool.query(
        `INSERT INTO excel_sync_log (esl_table_name, esl_key_field, esl_key_value, esl_old_data, esl_new_data)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         RETURNING esl_key`,
        [tableName, keyField, kv, JSON.stringify(dbValues), JSON.stringify(excelValues)]
      );
      const eslKey = Number((ins.rows as Array<{ esl_key: number }>)[0]?.esl_key);
      if (Number.isFinite(eslKey) && eslKey > 0) {
        await insertExcelSyncLogGeomFromLayer({ eslKey, tableName, keyField, keyValue: kv, side: 'old' });
        await attachNewGeom(eslKey, kv);
      }
    }

    for (const kv of appendKeysThisChunk) {
      const excelAttrs = excelMap.get(kv)!;
      const newTypeLabel = uploadGeomTypeLabel(uploadFam);
      const excelValues: Record<string, unknown> = { ...excelAttrs };
      if (newTypeLabel) {
        excelValues.geom = geomTypeOnlyPlaceholder(newTypeLabel);
      }
      const ins = await pool.query(
        `INSERT INTO excel_sync_log (esl_table_name, esl_key_field, esl_key_value, esl_old_data, esl_new_data)
         VALUES ($1, $2, $3, NULL, $4::jsonb)
         RETURNING esl_key`,
        [tableName, keyField, kv, JSON.stringify(excelValues)]
      );
      const eslKey = Number((ins.rows as Array<{ esl_key: number }>)[0]?.esl_key);
      if (Number.isFinite(eslKey) && eslKey > 0) {
        await attachNewGeom(eslKey, kv);
      }
    }

    const removes: CompareExcelResult['removes'] = [];
    for (const kv of removeKeys) {
      const dbAttrs = dbMap.get(kv)!;
      const meta = dbGeomMeta.get(kv);
      const dbFam = geomFamilyFromDbType(meta?.gtype);
      const hasOldGeom = !!(meta?.gtype || meta?.ghash);
      const dbValues: Record<string, unknown> = { ...dbAttrs };
      if (hasOldGeom) {
        const oldTypeLabel =
          dbFam === 'point'
            ? 'Point'
            : dbFam === 'polygon'
              ? 'Polygon'
              : dbFam === 'line'
                ? 'LineString'
                : (meta?.gtype ? String(meta.gtype).replace(/^ST_/i, '') : '도형 없음');
        dbValues.geom = geomTypeOnlyPlaceholder(oldTypeLabel);
      }
      removes.push({ key: kv, values: dbValues });
      const ins = await pool.query(
        `INSERT INTO excel_sync_log (esl_table_name, esl_key_field, esl_key_value, esl_old_data, esl_new_data)
         VALUES ($1, $2, $3, $4::jsonb, NULL)
         RETURNING esl_key`,
        [tableName, keyField, kv, JSON.stringify(dbValues)]
      );
      const eslKey = Number((ins.rows as Array<{ esl_key: number }>)[0]?.esl_key);
      if (Number.isFinite(eslKey) && eslKey > 0 && hasOldGeom) {
        await insertExcelSyncLogGeomFromLayer({ eslKey, tableName, keyField, keyValue: kv, side: 'old' });
      }
    }

    const colSet = new Set<string>();
    for (const a of excelMap.values()) Object.keys(a).forEach((k) => colSet.add(k));
    for (const a of dbMap.values()) Object.keys(a).forEach((k) => colSet.add(k));
    const columns = [keyField, ...[...colSet].filter((c) => c !== keyField)].slice(0, 40);

    // 누락 보강 (의도 표시 후 재조회 포함) + JSON에 GeoJSON 반영
    await fillPendingExcelSyncLogOldGeoms({ tableName, keyField });
    await fillPendingExcelSyncLogNewGeomsFromCoords({
      tableName,
      coordsByKey: Object.fromEntries(excelCoordsByKey),
    });
    await syncExcelSyncLogJsonGeomFromSideTable({ tableName });

    return {
      success: true,
      tableName,
      keyField,
      appendCount: appendKeysThisChunk.length,
      conflictCount: conflicts.length,
      removeCount: removeKeys.length,
      unchangedCount,
      conflicts: conflicts.slice(0, 500),
      removes: removes.slice(0, 500),
      columns,
      appendKeys: appendKeysAll,
    };
  } catch (e: unknown) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 정합성 모달 선택 반영: 삭제 → 충돌(엑셀) 재삽입 → 신규 삽입. 전체 TRUNCATE 없음.
 */
export async function applyExcelIntegritySync(params: {
  tableName: string;
  tableKorName: string;
  keyField: string;
  columns: ExcelColumnDef[];
  rows: ExcelRowInput[];
  geometryType: 'Point' | 'Polygon';
  conflictKeysUseExcel: string[];
  removeKeys: string[];
  conflictKeysKeepDb: string[];
  appendKeys?: string[];
  separateJijukTable?: boolean;
  separateMulgunjiTable?: boolean;
  jijukTableComment?: string;
  mulgunjiTableComment?: string;
  ehKey?: number;
}): Promise<{
  success: boolean;
  error?: string;
  insertedCount?: number;
  deletedCount?: number;
  updatedCount?: number;
  keptCount?: number;
}> {
  const tableName = safeTableName(params.tableName ?? '');
  const keyField = safeColumnName(params.keyField ?? '');
  if (!tableName || !keyField) {
    return { success: false, error: 'tableName과 keyField가 필요합니다.' };
  }

  const conflictUse = new Set((params.conflictKeysUseExcel ?? []).map(String));
  const removeSet = new Set((params.removeKeys ?? []).map(String));
  const keepDb = new Set((params.conflictKeysKeepDb ?? []).map(String));
  const appendSet = new Set((params.appendKeys ?? []).map(String));

  const rowByKey = new Map<string, ExcelRowInput>();
  for (const row of params.rows ?? []) {
    const kv = String((row.attrs ?? {})[keyField] ?? '').trim();
    if (kv && !rowByKey.has(kv)) rowByKey.set(kv, row);
  }

  // appendKeys 미전달 시: DB에 없는 키를 신규로 간주
  if (appendSet.size === 0) {
    try {
      const dbRes = await db.execute(sql.raw(
        `SELECT DISTINCT "${keyField}"::text AS k FROM layer."${tableName}"
         WHERE "${keyField}" IS NOT NULL AND btrim("${keyField}"::text) <> ''`
      ));
      const dbKeys = new Set(
        (dbRes.rows as Array<{ k: string }>).map((r) => String(r.k ?? '').trim()).filter(Boolean)
      );
      for (const k of rowByKey.keys()) {
        if (!dbKeys.has(k) && !conflictUse.has(k)) appendSet.add(k);
      }
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const deleteKeys = [...removeSet, ...conflictUse];
  let deletedCount = 0;
  try {
    for (const kv of deleteKeys) {
      const safeKv = kv.replace(/'/g, "''");
      const del = await db.execute(sql.raw(
        `DELETE FROM layer."${tableName}" WHERE "${keyField}"::text = '${safeKv}'`
      ));
      deletedCount += Number((del as { rowCount?: number }).rowCount ?? 0);
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  const upsertKeys = [...appendSet, ...conflictUse];
  const upsertRows = upsertKeys.map((k) => rowByKey.get(k)).filter(Boolean) as ExcelRowInput[];

  let insertedCount = 0;
  if (upsertRows.length > 0) {
    // 배치로 appendOnly 삽입 (첫 호출도 truncate 없이)
    const BATCH = 20;
    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const chunk = upsertRows.slice(i, i + BATCH);
      const res = await createTableFromExcel({
        tableName,
        tableKorName: params.tableKorName,
        keyField,
        columns: params.columns,
        geometryType: params.geometryType,
        rows: chunk,
        appendOnly: true,
        separateJijukTable: params.separateJijukTable,
        separateMulgunjiTable: params.separateMulgunjiTable,
        jijukTableComment: params.jijukTableComment,
        mulgunjiTableComment: params.mulgunjiTableComment,
      });
      if (!res.success) {
        return { success: false, error: res.error ?? '정합성 반영 삽입 실패' };
      }
      insertedCount += res.rowCount ?? 0;
    }
  }

  const ehKey = params.ehKey != null && Number.isFinite(params.ehKey) ? Math.trunc(params.ehKey) : null;
  const ehSql = ehKey != null ? String(ehKey) : 'NULL';
  const mark = async (keys: string[], op: string) => {
    for (const kv of keys) {
      const safeKv = kv.replace(/'/g, "''");
      await db.execute(sql.raw(
        `UPDATE excel_sync_log
         SET esl_operation = '${op}',
             esl_applied_at = NOW(),
             esl_eh_key = COALESCE(esl_eh_key, ${ehSql})
         WHERE esl_table_name = '${tableName}'
           AND esl_key_value = '${safeKv}'
           AND (
             esl_operation IS NULL
             OR (esl_operation IS NOT NULL AND esl_applied_at IS NULL)
           )`
      ));
    }
  };
  try {
    await mark([...appendSet], 'append');
    await mark([...conflictUse], 'conflict');
    await mark([...removeSet], 'remove');
    await mark([...keepDb], 'kept');
    // 남은 미결(동일·미선택 삭제 등) 정리
    await db.execute(sql.raw(
      `DELETE FROM excel_sync_log
       WHERE esl_table_name = '${tableName}' AND esl_operation IS NULL`
    ));
    // 반영 직후 레이어 geom → 이력 도형(new) 적재 (주소→지적 등 준비 시점 미적재 보완)
    if (ehKey != null) {
      await fillExcelSyncLogNewGeoms({ ehKey, tableName, keyField });
      await syncExcelSyncLogJsonGeomFromSideTable({ tableName, ehKey });
    }
  } catch {
    /* 로그 마킹 실패는 본 반영과 분리 */
  }

  return {
    success: true,
    insertedCount,
    deletedCount,
    updatedCount: conflictUse.size,
    keptCount: keepDb.size,
  };
}

const EXCEL_GEOM_BULK_BATCH_DEFAULT = 300;

/**
 * 저장된 엑셀/CSV에서 geom(WKT) 열을 읽어 서버에서 배치 INSERT.
 * 브라우저 행단위 HTTP를 피하기 위한 대용량 경로.
 */
export async function bulkLoadExcelGeomFromFile(params: {
  pathOrResult: string;
  tableName: string;
  tableKorName: string;
  keyField: string;
  columns: ExcelColumnDef[];
  geometryType: 'Point' | 'Polygon';
  geomHeader: string;
  fieldMappings: Array<{ originalHeader: string; headerEng: string }>;
  geomInputSrid?: 4326 | 5181 | 'auto';
  titleRowLines?: 1 | 2 | 3;
  batchSize?: number;
  jobId?: string;
  syntheticKeyField?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  rowCount?: number;
  totalRows?: number;
  polygonMatchedCount?: number;
  polygonNullCount?: number;
}> {
  const pathOrResult = params.pathOrResult?.trim();
  const geomHeader = params.geomHeader?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };
  if (!geomHeader) return { success: false, error: 'geomHeader가 필요합니다.' };

  const parseRes = await parseExcelFile({
    pathOrResult,
    titleRowLines: params.titleRowLines,
  });
  if (!parseRes.success || !parseRes.rows) {
    return { success: false, error: parseRes.error ?? '파일 파싱 실패' };
  }

  const fileRows = parseRes.rows;
  const batchSize = Math.min(1000, Math.max(50, Number(params.batchSize) || EXCEL_GEOM_BULK_BATCH_DEFAULT));
  const geomSrid = params.geomInputSrid ?? 'auto';
  const syntheticKey = params.syntheticKeyField ? safeColumnName(params.syntheticKeyField) : null;
  const mappings = params.fieldMappings ?? [];

  const log = (message: string) => {
    const jobId = params.jobId?.trim();
    if (!jobId) return;
    broadcastExcelWizardLog({ jobId, message, at: Date.now() });
  };

  log(`서버 geom bulk 시작: ${fileRows.length.toLocaleString('ko-KR')}행, 배치 ${batchSize}, SRID=${geomSrid}`);

  let totalInsert = 0;
  let polygonMatchedCount = 0;
  let polygonNullCount = 0;

  for (let i = 0; i < fileRows.length; i += batchSize) {
    const slice = fileRows.slice(i, i + batchSize);
    const excelRows: ExcelRowInput[] = slice.map((row, idx) => {
      const attrs: Record<string, unknown> = {};
      for (const m of mappings) {
        const eng = safeColumnName(m.headerEng);
        if (!eng || EXCEL_LAYER_SYSTEM_COLUMNS.has(eng)) continue;
        attrs[eng] = row[m.originalHeader];
      }
      if (syntheticKey) {
        attrs[syntheticKey] = `k${String(i + idx + 1).padStart(8, '0')}`;
      }
      const wkt = String(row[geomHeader] ?? '').trim();
      return {
        attrs,
        parcels: wkt ? [{ address: '', geom: wkt }] : [{ address: '' }],
        mulgunjis: [],
      };
    });

    const res = await createTableFromExcel({
      pathOrResult,
      tableName: params.tableName,
      tableKorName: params.tableKorName,
      keyField: params.keyField,
      columns: params.columns,
      geometryType: params.geometryType,
      rows: excelRows,
      appendOnly: i > 0,
      geomInputSrid: geomSrid,
    });
    if (!res.success) {
      log(`서버 geom bulk 실패 @${i + 1}: ${res.error ?? '알 수 없음'}`);
      return {
        success: false,
        error: res.error ?? 'bulk 삽입 실패',
        rowCount: totalInsert,
        totalRows: fileRows.length,
        polygonMatchedCount,
        polygonNullCount,
      };
    }
    totalInsert += res.rowCount ?? 0;
    polygonMatchedCount += res.polygonMatchedCount ?? 0;
    polygonNullCount += res.polygonNullCount ?? 0;

    const done = Math.min(i + batchSize, fileRows.length);
    if (i === 0 || done === fileRows.length || Math.floor(i / batchSize) % 5 === 0) {
      log(`서버 geom bulk 진행 ${done.toLocaleString('ko-KR')}/${fileRows.length.toLocaleString('ko-KR')} (삽입 ${totalInsert.toLocaleString('ko-KR')})`);
    }
  }

  log(`서버 geom bulk 완료: 삽입 ${totalInsert.toLocaleString('ko-KR')}건`);
  return {
    success: true,
    rowCount: totalInsert,
    totalRows: fileRows.length,
    polygonMatchedCount,
    polygonNullCount,
  };
}

const MAX_CSV_TABLE_EXPORT_ROWS = 100_000;

/**
 * layer / public_layer 테이블 전체를 CSV로 내보낸다.
 * geometry 컬럼은 ST_AsText(WKT)로 변환하며 셀 길이를 자르지 않는다.
 */
export async function exportLayerTableToCsv(params: {
  tableName: string;
  schema?: 'layer' | 'public_layer';
}): Promise<{ success: boolean; buffer?: Buffer; fileName?: string; error?: string }> {
  const rawName = (params?.tableName ?? '').trim();
  if (!rawName) return { success: false, error: 'tableName이 필요합니다.' };
  const schema = params?.schema === 'public_layer' ? 'public_layer' : 'layer';

  const { resolveLayerPhysicalRelName } = await import('./standardService');
  const physical = await resolveLayerPhysicalRelName(schema, rawName);
  if (!physical) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const esc = (s: string) => s.replace(/'/g, "''");
  const qIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(physical)}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name?: string }[])
      .map((r) => String(r?.name ?? '').trim())
      .filter(Boolean);
    if (columns.length === 0) return { success: false, error: '컬럼이 없습니다.' };

    const geomCols = new Set<string>();
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(physical)}'`
        )
      );
      for (const row of gcRes.rows as { name?: string }[]) {
        const n = String(row?.name ?? '').trim();
        if (n) geomCols.add(n);
      }
    } catch {
      /* geometry_columns 없음 */
    }

    const countRes = await db.execute(
      sql.raw(`SELECT COUNT(*)::int AS cnt FROM ${qIdent(schema)}.${qIdent(physical)}`)
    );
    const rowCount = Number((countRes.rows as { cnt?: number }[])[0]?.cnt ?? 0);
    if (rowCount > MAX_CSV_TABLE_EXPORT_ROWS) {
      return {
        success: false,
        error: `행이 너무 많습니다(${rowCount.toLocaleString('ko-KR')}). 최대 ${MAX_CSV_TABLE_EXPORT_ROWS.toLocaleString('ko-KR')}행까지 내보냅니다.`,
      };
    }

    const selectList = columns
      .map((c) => {
        const q = qIdent(c);
        if (geomCols.has(c)) return `ST_AsText(${q}) AS ${q}`;
        return q;
      })
      .join(', ');

    const dataRes = await db.execute(
      sql.raw(`SELECT ${selectList} FROM ${qIdent(schema)}.${qIdent(physical)}`)
    );
    const rawRows = (dataRes.rows ?? []) as Record<string, unknown>[];

    const sheetRows = rawRows.map((row) => {
      const out: Record<string, string | number | boolean> = {};
      for (const c of columns) {
        const v = row[c];
        if (v == null) out[c] = '';
        else if (typeof v === 'number' || typeof v === 'boolean') out[c] = v;
        else if (typeof v === 'string') out[c] = v;
        else if (v instanceof Date) out[c] = v.toISOString();
        else out[c] = String(v);
      }
      return out;
    });

    const ws =
      sheetRows.length > 0
        ? XLSX.utils.json_to_sheet(sheetRows)
        : XLSX.utils.aoa_to_sheet([columns]);
    const csvBody = XLSX.utils.sheet_to_csv(ws);
    const buffer = Buffer.from(`\uFEFF${csvBody}`, 'utf8');
    const safeFile = physical.replace(/[^a-zA-Z0-9_가-힣-]/g, '_');
    return { success: true, buffer, fileName: `${safeFile}.csv` };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
