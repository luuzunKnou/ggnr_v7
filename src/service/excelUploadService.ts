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
import { getLatestExcelHistoryByTables } from './excelHistoryService';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const DEFINE_LAYER_TABLES_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');
const DEFINE_LAYER_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const EXCEL_FIELD_NAME_MAP_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'excelFieldNameMap.json');

function safeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'layer_table';
}

function safeColumnName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'col';
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
 * Excel 파일 파싱. 첫 시트만 사용, 첫 행을 헤더로.
 */
export async function parseExcelFile(params: { pathOrResult: string }): Promise<ParseExcelResult> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };

  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { success: false, error: '파일을 찾을 수 없습니다.' };
  } catch {
    return { success: false, error: '파일을 찾을 수 없습니다.' };
  }

  try {
    const buf = await fs.readFile(absolutePath);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheetNames = wb.SheetNames;
    const sheetCount = sheetNames.length;
    const hasSingleSheet = sheetCount === 1;

    if (sheetCount === 0) return { success: false, error: '시트가 없습니다.', sheetCount, hasSingleSheet: false };

    const firstSheetName = sheetNames[0];
    const ws = wb.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    if (!data || data.length === 0) {
      return { success: false, error: '데이터가 없습니다.', sheetCount, hasSingleSheet };
    }

    const headerRow = data[0] as unknown[];
    const headerStrings = headerRow.map((c) => String(c ?? '').trim());
    const hasSingleHeader = true;

    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i] as unknown[];
      const obj: Record<string, unknown> = {};
      headerStrings.forEach((h, j) => {
        const key = h || `col_${j}`;
        obj[key] = row[j] ?? '';
      });
      rows.push(obj);
    }

    const samples: Record<string, unknown[]> = {};
    headerStrings.forEach((h, j) => {
      const key = h || `col_${j}`;
      samples[key] = rows.slice(0, 3).map((r) => r[key]);
    });

    return {
      success: true,
      sheetCount,
      hasSingleSheet,
      hasSingleHeader,
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
 * service_data/excel_data 내 .xlsx 파일 목록 및 테이블/레이어/define 상태.
 */
export async function getExlStatusList(params?: { relativePath?: string }): Promise<{ success: boolean; rows?: ExlStatusRow[]; path?: string; error?: string }> {
  const baseExcel = path.join(GGNR_DATA_DIR, 'service_data', 'excel_data');
  const relativePath = (params?.relativePath ?? 'service_data/excel_data').trim().replace(/^[/\\]+/, '');
  const dir = relativePath ? path.join(GGNR_DATA_DIR, relativePath) : baseExcel;
  if (!dir.startsWith(baseExcel)) {
    return { success: true, rows: [], path: baseExcel };
  }

  try {
    await fs.mkdir(path.join(GGNR_DATA_DIR, 'service_data', 'excel_data'), { recursive: true });
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
      const ext = path.extname(e.name).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.xls') continue;
      const fullPath = path.join(dir, e.name);
      const st = await fs.stat(fullPath).catch(() => null);
      entries.push({ name: e.name, mtime: st?.mtime ?? new Date(0) });
    }
  } catch {
    return { success: true, rows: [], path: dir };
  }

  const pathOrResultPrefix = relativePath ? `${relativePath.replace(/\\/g, '/')}/` : 'service_data/excel_data/';
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
      if (t.schema === 'layer') layerTableSet.add(t.table);
    }
  }

  const defineRes = await getDefineLayerTables();
  const defineTableSet = new Set<string>();
  if (defineRes.success && Array.isArray(defineRes.tables)) {
    for (const row of defineRes.tables) {
      const name = String(row.define_table_name ?? '').trim();
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
      layer: layerNames.includes(tableName),
      style: styleNames.includes(tableName),
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
        if (t.schema === 'layer') layerTableSet.add(t.table);
      }
    }

    const historyRes = await getLatestExcelHistoryByTables();
    const historyMap = historyRes.success ? historyRes.map : {};

    const rows: ExcelDataStatusRow[] = tables.map((row) => {
      const tableName = String(row.define_table_name ?? '').trim();
      const korName = String(row.define_table_kor_name ?? '').trim();
      const latest = historyMap[tableName];
      return {
        tableName,
        tableKorName: korName || tableName,
        table: layerTableSet.has(tableName),
        layer: layerNames.includes(tableName),
        style: styleNames.includes(tableName),
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
    const merged = { ...(existing ?? {}), ...(params.entries ?? {}) };
    await fs.mkdir(path.dirname(EXCEL_FIELD_NAME_MAP_PATH), { recursive: true });
    await fs.writeFile(EXCEL_FIELD_NAME_MAP_PATH, JSON.stringify(merged, null, 2), 'utf-8');
    return { success: true };
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

export type ExcelRowInput = {
  attrs: Record<string, unknown>;
  parcels: Array<{ address?: string; x?: number; y?: number; geom?: string }>;
};

/** Excel 디노멀라이징 시 각 필지 주소(필지이름) 저장용 고정 컬럼명 */
const PARCEL_ADDRESS_COL = 'parcel_address';

const EMD_RI_SCHEMA = 'public_layer';
const EMD_RI_NAME_COLUMNS = ['adm_nm', 'name', 'emd_nm', 'ri_nm'];
const BONBUN_LEN = 4;
const BUBUN_LEN = 4;

export type ParsedPnuParts = {
  emdName: string;
  riName: string;
  bonbun: string;
  bubun: string;
};

export function parseAddressForPnu(address: string): ParsedPnuParts | null {
  let s = String(address ?? '').trim();
  if (!s) return null;
  s = s.replace(/번지/g, '').trim();
  s = s.replace(/\s*산\s*/g, ' ').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 5) return null;
  const emdName = parts[2].trim();
  const riName = parts[3].trim();
  const rest = parts.slice(4).join(' ');
  const addrParts = rest.split('-').map((p) => p.trim());
  const bonbunRaw = (addrParts[0] ?? '0').replace(/\D/g, '') || '0';
  const bubunRaw = (addrParts[1] ?? '0').replace(/\D/g, '') || '0';
  const bonbun = bonbunRaw.padStart(BONBUN_LEN, '0').slice(-BONBUN_LEN);
  const bubun = bubunRaw.padStart(BUBUN_LEN, '0').slice(-BUBUN_LEN);
  return { emdName, riName, bonbun, bubun };
}

export async function getPnuFromAddress(address: string): Promise<string | null> {
  const parsed = parseAddressForPnu(address);
  if (!parsed) return null;
  const { emdName, riName, bonbun, bubun } = parsed;
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
  if (!emdCd) return null;
  let riCd: string | null = null;
  for (const nameCol of EMD_RI_NAME_COLUMNS) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT "ri_cd" AS code FROM "${EMD_RI_SCHEMA}"."ri" WHERE "ri_cd" LIKE '${esc(emdCd)}%' AND "${nameCol}" = '${esc(riName)}' LIMIT 1`
        )
      );
      const row = (res.rows as { code?: string }[])[0];
      if (row?.code) {
        riCd = String(row.code).trim();
        break;
      }
    } catch {
      continue;
    }
  }
  if (!riCd) return null;
  return riCd + bonbun + bubun;
}

export async function getJijukGeomByPnu(pnu: string, geomSrid: number = 5181): Promise<string | null> {
  const esc = (v: string) => v.replace(/'/g, "''");
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_SetSRID(geom, ${geomSrid})) AS wkt,
                ST_GeometryType(ST_SetSRID(geom, ${geomSrid})) AS gtype
         FROM ${EMD_RI_SCHEMA}.jijuk WHERE pnu = '${esc(pnu)}' LIMIT 1`
      )
    );
    const row = (res.rows as { wkt?: string; gtype?: string }[])[0];
    if (!row?.wkt) return null;
    return row.wkt;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[excelUploadService] getJijukGeomByPnu 오류:', msg);
    return null;
  }
}

/**
 * 단일 테이블(denormalize) 생성 및 Excel 유래 데이터 삽입.
 * - 테이블: id SERIAL PRIMARY KEY, geom geometry(Geometry, 4326), + 각 column (text)
 * - 각 row의 각 parcel당 1행 삽입, attrs denormalize
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
}): Promise<{ success: boolean; error?: string; rowCount?: number; polygonMatchedCount?: number; polygonNullCount?: number }> {
  const tableName = safeTableName(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const keyField = safeColumnName(params.keyField);
  const columns = params.columns ?? [];
  const geometryType = params.geometryType ?? 'Point';
  const rows = params.rows ?? [];
  const appendOnly = params.appendOnly === true;

  // 동일 영문명이 여러 Excel 열에 매핑되면 중복 컬럼 방지 (첫 번째만 사용)
  const colNames = Array.from(
    new Set(columns.map((c) => safeColumnName(c.define_field_name)).filter(Boolean))
  ) as string[];
  if (!colNames.includes(keyField)) return { success: false, error: 'keyField가 columns에 없습니다.' };

  try {
    const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
    const geomType = geometryType === 'Point' ? 'Point' : 'Geometry';
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
    // appendOnly가 아니면 기존 데이터 삭제 후 INSERT(전체 덮어쓰기)
    if (!appendOnly) {
      await db.execute(sql.raw(`TRUNCATE TABLE layer.${quotedTable}`));
    }

    const pathOrResult = params.pathOrResult?.trim();
    const logPath =
      pathOrResult &&
      path.join(
        GGNR_DATA_DIR,
        path.dirname(pathOrResult.replace(/\//g, path.sep)),
        path.basename(pathOrResult).replace(/\.xlsx?$/i, '') + '.log'
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
        await fs.writeFile(logPath, `# Geocoding 실패 → PNU 폴백 로그 (${new Date().toISOString()})\n`, 'utf-8');
      } catch {
        // ignore
      }
    }

    let polygonMatchedCount = 0;
    let polygonNullCount = 0;

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

    let insertCount = 0;
    for (const row of rows) {
      const attrs = row.attrs ?? {};
      const parcelList = Array.isArray(row.parcels) ? row.parcels : [];
      const toInsert = parcelList.length > 0 ? parcelList : [{ address: '' }];
      for (const parcel of toInsert) {
        let geomWkt: string | null = null;
        let geomInputSrid: 4326 | 5181 = 4326;
        if (parcel.geom) {
          geomWkt = String(parcel.geom);
          geomInputSrid = 4326;
        } else if (parcel.x != null && parcel.y != null) {
          if (geometryType === 'Point') {
            geomWkt = `POINT(${Number(parcel.x)} ${Number(parcel.y)})`;
            geomInputSrid = 4326;
          } else {
            let wkt = await getJijukGeom(parcel.x, parcel.y, parcel.address);
            if (!wkt && parcel.address?.trim()) {
              const parsed = parseAddressForPnu(parcel.address);
              const pnu = parsed ? await getPnuFromAddress(parcel.address) : null;
              if (pnu) wkt = await getJijukGeomByPnu(pnu, geomSrid);
              const parseStr = parsed ? `parse=ok emd=${parsed.emdName} ri=${parsed.riName} bonbun=${parsed.bonbun} bubun=${parsed.bubun}` : 'parse=fail';
              const pnuStr = pnu ?? 'pnu=fail';
              const jijukStr = wkt ? 'jijuk=found' : 'jijuk=not_found';
              await appendPnuLog(`${parcel.address} | ${parseStr} | pnu=${pnuStr} | ${jijukStr}`);
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
          const parsed = parseAddressForPnu(parcel.address);
          const pnu = parsed ? await getPnuFromAddress(parcel.address) : null;
          const wkt = pnu ? await getJijukGeomByPnu(pnu, geomSrid) : null;
          const parseStr = parsed ? `parse=ok emd=${parsed.emdName} ri=${parsed.riName} bonbun=${parsed.bonbun} bubun=${parsed.bubun}` : 'parse=fail';
          const pnuStr = pnu ?? 'pnu=fail';
          const jijukStr = wkt ? 'jijuk=found' : 'jijuk=not_found';
          await appendPnuLog(`${parcel.address} | ${parseStr} | pnu=${pnuStr} | ${jijukStr}`);
          if (wkt) {
            geomWkt = wkt;
            geomInputSrid = 5181;
            polygonMatchedCount++;
          } else {
            polygonNullCount++;
          }
        }
        const parcelAddr = parcel.address != null ? String(parcel.address) : '';
        const colValues = colNames.map((c) => (attrs[c] == null ? '' : String(attrs[c])));
        const params = [geomWkt, geomInputSrid, parcelAddr, ...colValues];
        await pool.query(insertText, params);
        insertCount++;
      }
    }

    if (geometryType === 'Polygon' && (polygonMatchedCount > 0 || polygonNullCount > 0)) {
      console.log(`[excelUploadService] 폴리곤 매칭 결과: 성공 ${polygonMatchedCount}건, 미매칭(geom NULL) ${polygonNullCount}건`);
    }

    return {
      success: true,
      rowCount: insertCount,
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
  const base = path.basename(relative).replace(/\.xlsx?$/i, '');
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
    out += `\n\n---\n\n## 행 삽입 중 서버 기록 (Geocoding 실패·PNU 폴백 등)\n\n${serverSection.trim()}`;
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
}): Promise<{ success: boolean; error?: string }> {
  const tableName = safeTableName(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };

  try {
    let tables: Record<string, unknown>[] = [];
    try {
      const raw = await fs.readFile(DEFINE_LAYER_TABLES_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tables = parsed;
    } catch {
      // file missing
    }
    const existing = tables.find((r) => String(r.define_table_name ?? '').trim() === tableName);
    if (!existing) {
      tables.push(
        reorderDefineLayerTableRow({
          define_table_name: tableName,
          define_table_kor_name: params.tableKorName || tableName,
          define_table_shp_type: params.geometryType === 'Point' ? 'POINT' : 'POLYGON',
          define_table_read_share: 'P',
          define_table_write_share: 'P',
          define_table_group: '',
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
      define_field_type: 'integer',
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
      define_field_type: 'text',
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
      define_field_type: 'text',
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
        define_field_type: 'text',
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
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer 레이어 및 스타일 생성 (Excel 테이블용).
 */
export async function createGeoServerLayerForExcel(params: {
  tableName: string;
  geometryType: 'Point' | 'Polygon';
}): Promise<{ success: boolean; error?: string }> {
  const layerName = safeTableName(params.tableName);
  if (!layerName) return { success: false, error: 'tableName이 필요합니다.' };
  try {
    const layerRes = await createOrUpdateGeoServerLayer({ layerName });
    if (!layerRes.success) return { success: false, error: layerRes.error };
    const styleRes = await applyDefaultStyleToLayer({ layerName });
    if (!styleRes.success) return { success: false, error: styleRes.error };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** defineLayer fields에서 key 필드명(영문) 및 한글명 조회 */
function getKeyFieldFromDefine(tableName: string): { keyField: string; keyHeaderKor: string } | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '');
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
}): Promise<CompareExcelResult> {
  const empty: CompareExcelResult = { success: false, appendCount: 0, conflictCount: 0, removeCount: 0, unchangedCount: 0, conflicts: [], removes: [] };
  const pathOrResult = params?.pathOrResult?.trim();
  const tableName = safeTableName(params?.tableName ?? '');
  const ehKey = params?.ehKey;
  if (!pathOrResult || !tableName) return { ...empty, error: 'pathOrResult와 tableName이 필요합니다.' };

  const keyInfo = getKeyFieldFromDefine(tableName);
  if (!keyInfo) return { ...empty, error: 'defineLayer에 key 필드가 없습니다.' };

  const parseRes = await parseExcelFile({ pathOrResult });
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
        await db.execute(sql.raw(
          `INSERT INTO excel_sync_log (esl_eh_key, esl_table_name, esl_key_field, esl_key_value, esl_old_data, esl_new_data)
           SELECT ${ehKeyVal}, '${tableName}', '${keyField}', '${safeKv}', row_to_json(t.*)::jsonb, NULL
           FROM layer."${tableName}" t WHERE t."${keyField}"::text = '${safeKv}' LIMIT 1`
        ));
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
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
