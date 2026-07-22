/**
 * defineLayer 기반 레이어 행 조회·수정 (국공유지, 도로점용 등 공통)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { getPnuFromAddress } from './excelUploadService';
import { getDefineTableKeyFieldName } from './standardService';

const DEFAULT_SCHEMA = 'layer';
const ALLOWED_SCHEMAS = new Set(['layer', 'public_layer', 'public']);
/** public_layer.jijuk — geometry_columns SRID=0, 실제 좌표는 EPSG:5181 */
const JIJUK_GEOM_SRID = 5181;
const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);

export type DefineFieldMeta = {
  field: string;
  label: string;
  type: string;
  readOnly: boolean;
  showDetail: boolean;
  idx: number;
};

function resolveSchema(raw?: string): string {
  const s = String(raw ?? '').trim() || DEFAULT_SCHEMA;
  return ALLOWED_SCHEMAS.has(s) ? s : DEFAULT_SCHEMA;
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function resolveLayerPhysicalRelName(schema: string, tableGuess: string): Promise<string | null> {
  const sch = String(schema ?? '').trim();
  const guess = String(tableGuess ?? '').trim();
  if (!sch || !guess) return null;
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT c.relname::text AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = '${esc(sch)}'
           AND c.relkind IN ('r', 'p', 'v', 'm')
           AND lower(c.relname) = lower('${esc(guess)}')
         ORDER BY c.relname
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { name?: string } | undefined;
    const name = row?.name != null ? String(row.name).trim() : '';
    return name || null;
  } catch {
    return null;
  }
}

function isTrueFlag(raw: unknown): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true';
}

function loadDefineFields(tableName: string): Record<string, unknown>[] {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveKeyField(tableName: string, override?: string): string | null {
  const custom = String(override ?? '').trim();
  if (custom) return custom;
  return getDefineTableKeyFieldName(tableName) ?? 'id';
}

/** defineLayer 필드 메타 (상세·수정 UI용) */
export function getEditableFieldDefinitions(params: {
  table: string;
  excludeFields?: string[];
}): DefineFieldMeta[] {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) return [];
  const exclude = new Set(
    (params.excludeFields ?? []).map((f) => String(f).trim().toLowerCase()).filter(Boolean)
  );
  const fields = loadDefineFields(table);
  return fields
    .map((raw) => {
      const field = String(raw.define_field_name ?? '').trim();
      if (!field) return null;
      const lower = field.toLowerCase();
      if (GEOM_COLUMN_NAMES.has(lower) || exclude.has(lower)) return null;
      const showDetail = isTrueFlag(raw.define_field_show_detail);
      const readOnly = isTrueFlag(raw.define_field_read_only);
      if (!showDetail) return null;
      const meta: DefineFieldMeta = {
        field,
        label: String(raw.define_field_kor_name ?? field).trim() || field,
        type: String(raw.define_field_type ?? 'text').trim().toLowerCase(),
        readOnly,
        showDetail,
        idx: parseInt(String(raw.define_field_idx ?? '999999'), 10) || 999999,
      };
      return meta;
    })
    .filter((x): x is DefineFieldMeta => x !== null)
    .sort((a, b) => (a.idx !== b.idx ? a.idx - b.idx : a.field.localeCompare(b.field)));
}

/** defineLayer + 실제 DB 컬럼 교집합 (define만 있고 DB에 없는 필드 제외) */
export async function getEditableFieldDefinitionsForTable(params: {
  table: string;
  schema?: string;
  excludeFields?: string[];
}): Promise<{ fields: DefineFieldMeta[]; error?: string }> {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  if (!tableGuess) return { fields: [], error: 'table이 필요합니다.' };

  const schema = resolveSchema(params?.schema);
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { fields: [], error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(schema, table);
  const columnSet = new Set(columns.map((c) => c.toLowerCase()));
  const fields = getEditableFieldDefinitions({
    table: tableGuess,
    excludeFields: params.excludeFields,
  }).filter((d) => columnSet.has(d.field.toLowerCase()));

  return { fields };
}

async function getTableColumns(schema: string, table: string): Promise<string[]> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema='${esc(schema)}' AND table_name='${esc(table)}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
}

function findColumnName(columns: string[], field: string): string | null {
  const lower = field.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower) ?? null;
}

/** 수정 폼용 원본 행 (geom 제외) */
export async function getTableRowForEdit(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  keyField?: string;
}): Promise<{ row: Record<string, string> | null; keyField: string | null; error?: string }> {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  const keyValue = String(params?.keyValue ?? '').trim();
  if (!tableGuess || !keyValue) return { row: null, keyField: null, error: 'table과 keyValue가 필요합니다.' };

  const schema = resolveSchema(params?.schema);
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { row: null, keyField: null, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(schema, table);
  if (!columns.length) return { row: null, keyField: null, error: '컬럼 정보를 찾을 수 없습니다.' };

  let keyField = resolveKeyField(tableGuess, params?.keyField);
  if (!keyField || !findColumnName(columns, keyField)) {
    const idCol = findColumnName(columns, 'id');
    keyField = idCol ?? keyField;
  }
  if (!keyField || !findColumnName(columns, keyField)) {
    return { row: null, keyField: null, error: '키 컬럼을 찾을 수 없습니다.' };
  }

  const keyCol = findColumnName(columns, keyField)!;
  const dataColumns = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
  const selectList = dataColumns.map((c) => `${quoteIdent(c)} AS ${quoteIdent(c)}`).join(', ');
  const q = `SELECT ${selectList}
             FROM ${quoteIdent(schema)}.${quoteIdent(table)}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(keyValue)}'
             LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(q));
    const raw = (res.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!raw) return { row: null, keyField, error: '데이터를 찾을 수 없습니다.' };
    const row: Record<string, string> = {};
    for (const col of dataColumns) {
      const val = raw[col];
      row[col] = val == null ? '' : String(val);
    }
    return { row, keyField };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { row: null, keyField, error: msg };
  }
}

function normalizeChangeValue(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

async function resolveGeomColumn(schema: string, table: string): Promise<string | null> {
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name
         FROM geometry_columns
         WHERE f_table_schema='${esc(schema)}' AND f_table_name='${esc(table)}'
         LIMIT 1`
      )
    );
    const row = gcRes.rows?.[0] as { name?: string } | undefined;
    const name = row?.name != null ? String(row.name).trim() : '';
    return name || null;
  } catch {
    return null;
  }
}

async function resolveGeomColumnMeta(
  schema: string,
  table: string,
  columns: string[]
): Promise<{ col: string; srid: number } | null> {
  const fromGc = await resolveGeomColumn(schema, table);
  if (fromGc) {
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT COALESCE(NULLIF(srid, 0), 5181) AS srid
           FROM geometry_columns
           WHERE f_table_schema='${esc(schema)}' AND f_table_name='${esc(table)}'
           LIMIT 1`
        )
      );
      const sridRaw = (gcRes.rows?.[0] as { srid?: number } | undefined)?.srid;
      const srid = Number(sridRaw);
      return { col: fromGc, srid: Number.isFinite(srid) && srid > 0 ? srid : 5181 };
    } catch {
      return { col: fromGc, srid: 5181 };
    }
  }
  for (const c of columns) {
    if (GEOM_COLUMN_NAMES.has(c.toLowerCase())) {
      return { col: c, srid: 5181 };
    }
  }
  return null;
}

function geomColRef(raw: string): string {
  if (raw.includes('.')) {
    const [table, col] = raw.split('.', 2);
    return `${quoteIdent(table)}.${quoteIdent(col)}`;
  }
  return quoteIdent(raw);
}

function jijukGeom5181Sql(geomCol = 'geom'): string {
  return `ST_SetSRID(${geomColRef(geomCol)}, ${JIJUK_GEOM_SRID})`;
}

function jijukGeom3857Sql(geomCol = 'geom'): string {
  return `ST_Transform(${jijukGeom5181Sql(geomCol)}, 3857)`;
}

function geomTo3857Sql(geomCol: string, tableSrid: number): string {
  const q = quoteIdent(geomCol);
  if (tableSrid === 3857) return q;
  return `ST_Transform(${q}, 3857)`;
}

/** 수정 모드 — 테이블명·PK 기준 DB geom → GeoJSON(EPSG:3857) */
export async function getTableRowGeomGeoJson3857(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  keyField?: string;
}): Promise<{ geometry: Record<string, unknown> | null; error?: string }> {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  const keyValue = String(params?.keyValue ?? '').trim();
  if (!tableGuess || !keyValue) return { geometry: null, error: 'table과 keyValue가 필요합니다.' };

  const schema = resolveSchema(params?.schema);
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { geometry: null, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(schema, table);
  if (!columns.length) return { geometry: null, error: '컬럼 정보를 찾을 수 없습니다.' };

  let keyField = resolveKeyField(tableGuess, params?.keyField);
  if (!keyField || !findColumnName(columns, keyField)) {
    keyField = findColumnName(columns, 'id') ?? keyField;
  }
  if (!keyField || !findColumnName(columns, keyField)) {
    return { geometry: null, error: '키 컬럼을 찾을 수 없습니다.' };
  }

  const geomMeta = await resolveGeomColumnMeta(schema, table, columns);
  if (!geomMeta) return { geometry: null, error: 'geometry 컬럼을 찾을 수 없습니다.' };

  const keyCol = findColumnName(columns, keyField)!;
  const geom3857 = geomTo3857Sql(geomMeta.col, geomMeta.srid);
  const q = `SELECT ST_AsGeoJSON(${geom3857})::json AS geometry
             FROM ${quoteIdent(schema)}.${quoteIdent(table)}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(keyValue)}'
               AND ${quoteIdent(geomMeta.col)} IS NOT NULL
             LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(q));
    const raw = res.rows?.[0] as { geometry?: unknown } | undefined;
    const geometry = raw?.geometry;
    if (geometry == null || typeof geometry !== 'object') {
      return { geometry: null, error: '저장된 도형이 없습니다.' };
    }
    return { geometry: geometry as Record<string, unknown> };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { geometry: null, error: msg };
  }
}

function geomSetExpr(wkt5181: string): string {
  return `ST_SetSRID(ST_GeomFromText('${esc(wkt5181.trim())}'), 5181)`;
}

/** defineLayer 허용 필드만 UPDATE */
export async function updateTableRowByKey(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  keyField?: string;
  changes: Record<string, unknown>;
  excludeFields?: string[];
  geomWkt5181?: string | null;
  geomClear?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  const keyValue = String(params?.keyValue ?? '').trim();
  if (!tableGuess || !keyValue) return { success: false, error: 'table과 keyValue가 필요합니다.' };

  const changes = params?.changes ?? {};
  const entries = Object.entries(changes).filter(([k]) => String(k).trim());
  const geomWkt = String(params.geomWkt5181 ?? '').trim();
  const geomClear = params.geomClear === true;
  if (entries.length === 0 && !geomWkt && !geomClear) {
    return { success: false, error: '변경할 항목이 없습니다.' };
  }

  const schema = resolveSchema(params?.schema);
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(schema, table);
  if (!columns.length) return { success: false, error: '컬럼 정보를 찾을 수 없습니다.' };

  let keyField = resolveKeyField(tableGuess, params?.keyField);
  if (!keyField || !findColumnName(columns, keyField)) {
    keyField = findColumnName(columns, 'id') ?? keyField;
  }
  if (!keyField || !findColumnName(columns, keyField)) {
    return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };
  }

  const editableDefs = getEditableFieldDefinitions({
    table: tableGuess,
    excludeFields: params.excludeFields,
  });
  const editableFields = new Map(
    editableDefs.filter((d) => !d.readOnly && d.field.toLowerCase() !== keyField.toLowerCase()).map((d) => [d.field.toLowerCase(), d])
  );

  const setParts: string[] = [];
  for (const [key, rawVal] of entries) {
    const col = findColumnName(columns, key);
    if (!col) continue;
    const def = editableFields.get(col.toLowerCase());
    if (!def) continue;
    const val = normalizeChangeValue(rawVal);
    setParts.push(val == null ? `${quoteIdent(col)} = NULL` : `${quoteIdent(col)} = '${esc(val)}'`);
  }

  if (geomClear) {
    const geomCol = await resolveGeomColumn(schema, table);
    if (!geomCol) return { success: false, error: 'geometry 컬럼을 찾을 수 없습니다.' };
    setParts.push(`${quoteIdent(geomCol)} = NULL`);
  } else if (geomWkt) {
    const geomCol = await resolveGeomColumn(schema, table);
    if (!geomCol) return { success: false, error: 'geometry 컬럼을 찾을 수 없습니다.' };
    setParts.push(`${quoteIdent(geomCol)} = ${geomSetExpr(geomWkt)}`);
  }

  if (setParts.length === 0) return { success: false, error: '적용할 변경이 없습니다.' };

  const keyCol = findColumnName(columns, keyField)!;
  const q = `UPDATE ${quoteIdent(schema)}.${quoteIdent(table)}
             SET ${setParts.join(', ')}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(keyValue)}'
             RETURNING ${quoteIdent(keyCol)}::text AS updated_key`;

  try {
    const res = await db.execute(sql.raw(q));
    const updated = res.rows?.[0] as { updated_key?: string } | undefined;
    if (!updated?.updated_key) return { success: false, error: '대상 행을 찾을 수 없습니다.' };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

type ColumnMeta = {
  name: string;
  hasDefault: boolean;
  isNullable: boolean;
};

async function getColumnMetaList(schema: string, table: string): Promise<ColumnMeta[]> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name, column_default AS def, is_nullable AS nullable
       FROM information_schema.columns
       WHERE table_schema='${esc(schema)}' AND table_name='${esc(table)}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows as { name?: string; def?: string | null; nullable?: string }[])
    .map((r) => {
      const name = String(r?.name ?? '').trim();
      if (!name) return null;
      const def = r?.def != null ? String(r.def) : '';
      return {
        name,
        hasDefault: def.length > 0,
        isNullable: String(r?.nullable ?? '').toUpperCase() === 'YES',
      } satisfies ColumnMeta;
    })
    .filter((x): x is ColumnMeta => x != null);
}

function buildInsertEditableMap(
  tableGuess: string,
  keyField: string,
  excludeFields?: string[]
): Map<string, DefineFieldMeta> {
  const editableDefs = getEditableFieldDefinitions({ table: tableGuess, excludeFields });
  return new Map(
    editableDefs
      .filter((d) => !d.readOnly && d.field.toLowerCase() !== keyField.toLowerCase())
      .map((d) => [d.field.toLowerCase(), d])
  );
}

/** defineLayer 허용 필드만 INSERT */
export async function insertTableRow(params: {
  table: string;
  schema?: string;
  keyField?: string;
  values: Record<string, unknown>;
  excludeFields?: string[];
  geomWkt5181?: string | null;
}): Promise<{ success: boolean; keyValue?: string; error?: string }> {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  if (!tableGuess) return { success: false, error: 'table이 필요합니다.' };

  const schema = resolveSchema(params?.schema);
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const columnMeta = await getColumnMetaList(schema, table);
  if (!columnMeta.length) return { success: false, error: '컬럼 정보를 찾을 수 없습니다.' };

  let keyField = resolveKeyField(tableGuess, params?.keyField);
  if (!keyField || !findColumnName(columnMeta.map((c) => c.name), keyField)) {
    keyField = findColumnName(columnMeta.map((c) => c.name), 'id') ?? keyField;
  }
  if (!keyField || !findColumnName(columnMeta.map((c) => c.name), keyField)) {
    return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };
  }

  const editableFields = buildInsertEditableMap(tableGuess, keyField, params.excludeFields);
  const values = params?.values ?? {};
  const insertCols: string[] = [];
  const insertVals: string[] = [];

  for (const [key, rawVal] of Object.entries(values)) {
    const col = findColumnName(columnMeta.map((c) => c.name), key);
    if (!col) continue;
    const def = editableFields.get(col.toLowerCase());
    if (!def) continue;
    const val = normalizeChangeValue(rawVal);
    insertCols.push(quoteIdent(col));
    insertVals.push(val == null ? 'NULL' : `'${esc(val)}'`);
  }

  const geomWkt = String(params.geomWkt5181 ?? '').trim();
  if (geomWkt) {
    const geomCol = await resolveGeomColumn(schema, table);
    if (!geomCol) return { success: false, error: 'geometry 컬럼을 찾을 수 없습니다.' };
    insertCols.push(quoteIdent(geomCol));
    insertVals.push(geomSetExpr(geomWkt));
  }

  if (insertCols.length === 0) {
    const q = `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} DEFAULT VALUES
               RETURNING ${quoteIdent(findColumnName(columnMeta.map((c) => c.name), keyField)!)}::text AS new_key`;
    try {
      const res = await db.execute(sql.raw(q));
      const row = res.rows?.[0] as { new_key?: string } | undefined;
      const keyValue = row?.new_key != null ? String(row.new_key).trim() : '';
      if (!keyValue) return { success: false, error: '등록 후 키를 확인하지 못했습니다.' };
      return { success: true, keyValue };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  const q = `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} (${insertCols.join(', ')})
             VALUES (${insertVals.join(', ')})
             RETURNING ${quoteIdent(findColumnName(columnMeta.map((c) => c.name), keyField)!)}::text AS new_key`;

  try {
    const res = await db.execute(sql.raw(q));
    const row = res.rows?.[0] as { new_key?: string } | undefined;
    const keyValue = row?.new_key != null ? String(row.new_key).trim() : '';
    if (!keyValue) return { success: false, error: '등록 후 키를 확인하지 못했습니다.' };
    return { success: true, keyValue };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

type JijukParcelGeomRow = {
  pnu?: unknown;
  jibun?: unknown;
  emd_name?: unknown;
  ri_name?: unknown;
  geometry?: unknown;
  xmin?: unknown;
  ymin?: unknown;
  xmax?: unknown;
  ymax?: unknown;
};

function pnuDigitsOnly(pnu: unknown): string {
  return String(pnu ?? '').replace(/\D/g, '');
}

function formatLotFromPnuDigits(pnuDigits: string): string {
  if (pnuDigits.length >= 19) {
    const landType = pnuDigits[10];
    const bon = pnuDigits.slice(11, 15).replace(/^0+/, '') || '0';
    const bub = pnuDigits.slice(15, 19).replace(/^0+/, '') || '0';
    const prefix = landType === '2' ? '산' : '';
    if (bub !== '0') return `${prefix}${bon}-${bub}`;
    return `${prefix}${bon}`;
  }
  if (pnuDigits.length >= 18) {
    const bon = pnuDigits.slice(10, 14).replace(/^0+/, '') || '0';
    const bub = pnuDigits.slice(14, 18).replace(/^0+/, '') || '0';
    if (bub !== '0') return `${bon}-${bub}`;
    return bon;
  }
  return '';
}

function formatJibunLabel(jibunRaw: string, pnu: unknown): string {
  const jibun = String(jibunRaw ?? '').trim();
  if (jibun && !/(특별|광역|시|군|구)(\s|$)/u.test(jibun) && !/(읍|면|동|리)(\s)/u.test(jibun)) {
    return jibun;
  }
  if (jibun) {
    const stripped = formatAddressStripSidoSigungu(jibun);
    if (stripped && !/(읍|면|동|리)(\s)/u.test(stripped)) return stripped;
    if (stripped && /(\d|-)/.test(stripped)) {
      const tokens = stripped.split(/\s+/);
      const lot = tokens[tokens.length - 1];
      if (lot && /[\d-]/.test(lot)) return lot;
    }
  }
  return formatLotFromPnuDigits(pnuDigitsOnly(pnu));
}

function buildParcelAddressFromJijukRow(row: JijukParcelGeomRow): string {
  const emdName = String(row.emd_name ?? '').trim();
  const riName = String(row.ri_name ?? '').trim();
  const jibunPart = formatJibunLabel(String(row.jibun ?? ''), row.pnu);
  const parts: string[] = [];
  if (emdName) parts.push(emdName);
  if (riName) parts.push(riName);
  if (jibunPart) parts.push(jibunPart);
  if (parts.length > 0) return parts.join(' ');
  const fallback = formatAddressStripSidoSigungu(String(row.jibun ?? '').trim());
  return fallback;
}

function pnuAdminCodes(pnu: unknown): { emdCd: string; liCd: string } {
  const digits = pnuDigitsOnly(pnu);
  return { emdCd: digits.slice(0, 8), liCd: digits.slice(0, 10) };
}

type AdminTableMeta = {
  emdNameExpr: string | null;
  riCodeCol: string | null;
  riNameCol: string | null;
};

let adminTableMetaCache: AdminTableMeta | null = null;

async function resolveAdminTableMeta(): Promise<AdminTableMeta> {
  if (adminTableMetaCache) return adminTableMetaCache;

  const meta: AdminTableMeta = { emdNameExpr: null, riCodeCol: null, riNameCol: null };
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT table_name::text AS table_name, column_name::text AS column_name
         FROM information_schema.columns
         WHERE table_schema = 'public_layer' AND table_name IN ('emd', 'ri')`
      )
    );
    const emdCols = new Set<string>();
    const riCols = new Set<string>();
    for (const row of res.rows ?? []) {
      const table = String((row as { table_name?: string }).table_name ?? '').trim().toLowerCase();
      const col = String((row as { column_name?: string }).column_name ?? '').trim().toLowerCase();
      if (table === 'emd') emdCols.add(col);
      if (table === 'ri') riCols.add(col);
    }

    const emdNameParts: string[] = [];
    for (const col of ['emd_kor_nm', 'emd_nm', 'adm_nm', 'name']) {
      if (emdCols.has(col)) emdNameParts.push(`NULLIF(TRIM(${quoteIdent(col)}::text), '')`);
    }
    if (emdNameParts.length > 0) {
      meta.emdNameExpr = emdNameParts.length === 1 ? emdNameParts[0]! : `COALESCE(${emdNameParts.join(', ')})`;
    }

    for (const col of ['li_cd', 'ri_cd']) {
      if (riCols.has(col)) {
        meta.riCodeCol = col;
        break;
      }
    }
    for (const col of ['ri_nm', 'name', 'adm_nm']) {
      if (riCols.has(col)) {
        meta.riNameCol = col;
        break;
      }
    }
  } catch {
    // ignore — 이름 조회만 생략
  }

  adminTableMetaCache = meta;
  return meta;
}

async function loadAdminNamesByPnuCodes(
  emdCds: string[],
  liCds: string[]
): Promise<{ emdNames: Map<string, string>; riNames: Map<string, string> }> {
  const emdNames = new Map<string, string>();
  const riNames = new Map<string, string>();
  const uniqEmd = [...new Set(emdCds.filter((c) => c.length === 8))];
  const uniqLi = [...new Set(liCds.filter((c) => c.length === 10))];
  if (uniqEmd.length === 0 && uniqLi.length === 0) return { emdNames, riNames };

  const meta = await resolveAdminTableMeta();

  if (uniqEmd.length > 0 && meta.emdNameExpr) {
    const inList = uniqEmd.map((c) => `'${esc(c)}'`).join(', ');
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT emd_cd::text AS code, ${meta.emdNameExpr} AS name
           FROM public_layer.emd
           WHERE emd_cd::text IN (${inList})`
        )
      );
      for (const row of res.rows ?? []) {
        const code = String((row as { code?: string }).code ?? '').trim();
        const name = String((row as { name?: string }).name ?? '').trim();
        if (code && name) emdNames.set(code, name);
      }
    } catch {
      // 이름 조회 실패 시 jibun/PNU만 사용
    }
  }

  if (uniqLi.length > 0 && meta.riCodeCol && meta.riNameCol) {
    const inList = uniqLi.map((c) => `'${esc(c)}'`).join(', ');
    const codeCol = quoteIdent(meta.riCodeCol);
    const nameCol = quoteIdent(meta.riNameCol);
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ${codeCol}::text AS code, NULLIF(TRIM(${nameCol}::text), '') AS name
           FROM public_layer.ri
           WHERE ${codeCol}::text IN (${inList})`
        )
      );
      for (const row of res.rows ?? []) {
        const code = String((row as { code?: string }).code ?? '').trim();
        const name = String((row as { name?: string }).name ?? '').trim();
        if (code && name) riNames.set(code, name);
      }
    } catch {
      // ignore
    }
  }

  return { emdNames, riNames };
}

/** PNU → 대지위치(읍·면·동·리) + 지번(본·부번). 건축물대장 주소 폴백용 */
export async function resolvePlatLocAndLotByPnus(
  pnus: string[]
): Promise<Map<string, { platLoc: string; jibunLot: string }>> {
  const out = new Map<string, { platLoc: string; jibunLot: string }>();
  const unique = [...new Set(pnus.map((p) => String(p ?? '').trim()).filter((p) => /^\d{19}$/.test(p)))];
  if (!unique.length) return out;

  const emdCds: string[] = [];
  const liCds: string[] = [];
  for (const pnu of unique) {
    const { emdCd, liCd } = pnuAdminCodes(pnu);
    if (emdCd) emdCds.push(emdCd);
    if (liCd) liCds.push(liCd);
  }
  const { emdNames, riNames } = await loadAdminNamesByPnuCodes(emdCds, liCds);

  for (const pnu of unique) {
    const { emdCd, liCd } = pnuAdminCodes(pnu);
    const platLoc = [emdNames.get(emdCd) ?? '', riNames.get(liCd) ?? '']
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
    const jibunLot = formatLotFromPnuDigits(pnuDigitsOnly(pnu));
    out.set(pnu, { platLoc, jibunLot });
  }
  return out;
}

async function enrichJijukRowsWithAdminNames(rows: JijukParcelGeomRow[]): Promise<JijukParcelGeomRow[]> {
  if (rows.length === 0) return rows;
  try {
    const emdCds: string[] = [];
    const liCds: string[] = [];
    for (const row of rows) {
      const { emdCd, liCd } = pnuAdminCodes(row.pnu);
      if (emdCd) emdCds.push(emdCd);
      if (liCd) liCds.push(liCd);
    }
    const { emdNames, riNames } = await loadAdminNamesByPnuCodes(emdCds, liCds);
    return rows.map((row) => {
      const { emdCd, liCd } = pnuAdminCodes(row.pnu);
      return {
        ...row,
        emd_name: emdNames.get(emdCd) ?? row.emd_name,
        ri_name: riNames.get(liCd) ?? row.ri_name,
      };
    });
  } catch {
    return rows;
  }
}

const jijukParcelSelectSql = (geomCol: string) => `
  SELECT
    j.pnu::text AS pnu,
    j.jibun::text AS jibun,
    ST_AsGeoJSON(${jijukGeom3857Sql(geomCol)})::json AS geometry,
    ST_XMin(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS xmin,
    ST_YMin(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS ymin,
    ST_XMax(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS xmax,
    ST_YMax(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS ymax
  FROM public_layer.jijuk j
  WHERE j.geom IS NOT NULL`;

function buildJijukPnuMatchWhereSql(pnuDigits: string): string | null {
  const digits = pnuDigitsOnly(pnuDigits);
  if (digits.length < 18) return null;
  const pnuExpr = `REGEXP_REPLACE(j.pnu::text, '[^0-9]', '', 'g')`;
  if (digits.length >= 19) {
    return `${pnuExpr} = '${esc(digits.slice(0, 19))}'`;
  }
  const admin = esc(digits.slice(0, 10));
  const lot = esc(digits.slice(10, 18));
  return `(SUBSTRING(${pnuExpr}, 1, 10) = '${admin}' AND SUBSTRING(${pnuExpr}, 12, 8) = '${lot}')`;
}

async function resolvePnuDigitsFromInput(address: string, explicitPnu?: string): Promise<string | null> {
  const fromExplicit = pnuDigitsOnly(explicitPnu);
  if (fromExplicit.length >= 18) return fromExplicit;
  const fromAddress = pnuDigitsOnly(address);
  if (fromAddress.length >= 18) return fromAddress;
  const pnu = await getPnuFromAddress(address);
  return pnu ? pnuDigitsOnly(pnu) : null;
}

function mapJijukRowToParcelGeom(row: JijukParcelGeomRow): {
  address: string;
  pnu: string;
  extent3857: [number, number, number, number] | null;
  geometry3857: Record<string, unknown> | null;
} | null {
  const address = buildParcelAddressFromJijukRow(row);
  const pnu = pnuDigitsOnly(row.pnu);
  if (!address && !pnu) return null;
  const xmin = Number(row.xmin);
  const ymin = Number(row.ymin);
  const xmax = Number(row.xmax);
  const ymax = Number(row.ymax);
  const extent3857: [number, number, number, number] | null =
    [xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v)) ? [xmin, ymin, xmax, ymax] : null;
  const geometry = row.geometry;
  const geometry3857 =
    geometry != null && typeof geometry === 'object' ? (geometry as Record<string, unknown>) : null;
  return { address: address || pnu, pnu, extent3857, geometry3857 };
}

/** 주소·PNU(및 선택 좌표)로 public_layer.jijuk 필지 도형 조회 — jibun 문자열 비교 없음 */
export async function resolveJijukParcelGeomsByAddresses(params: {
  items: Array<{ address: string; lon?: number; lat?: number; pnu?: string }>;
}): Promise<{
  parcels: Array<{
    address: string;
    pnu: string;
    extent3857: [number, number, number, number] | null;
    geometry3857: Record<string, unknown> | null;
  }>;
  error?: string;
}> {
  const items = Array.isArray(params.items) ? params.items : [];
  const parcels: Array<{
    address: string;
    pnu: string;
    extent3857: [number, number, number, number] | null;
    geometry3857: Record<string, unknown> | null;
  }> = [];

  for (const item of items) {
    const address = String(item.address ?? '').trim();
    const lon = item.lon;
    const lat = item.lat;
    const hasPoint =
      typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat);

    const selectSql = jijukParcelSelectSql('j.geom');

    const runQuery = async (whereSql: string, orderSql: string) => {
      const queryStr = `${selectSql} AND ${whereSql} ORDER BY ${orderSql} LIMIT 1`;
      const res = await db.execute(sql.raw(queryStr));
      const enriched = await enrichJijukRowsWithAdminNames([(res.rows?.[0] ?? {}) as JijukParcelGeomRow]);
      return mapJijukRowToParcelGeom(enriched[0] ?? {});
    };

    try {
      let mapped: ReturnType<typeof mapJijukRowToParcelGeom> = null;

      if (hasPoint) {
        const point5181 = `ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${JIJUK_GEOM_SRID})`;
        mapped = await runQuery(`ST_Intersects(${jijukGeom5181Sql('j.geom')}, ${point5181})`, 'j.gid');
      }

      if (!mapped?.geometry3857) {
        const pnuDigits = await resolvePnuDigitsFromInput(address, item.pnu);
        const pnuWhere = pnuDigits ? buildJijukPnuMatchWhereSql(pnuDigits) : null;
        if (pnuWhere) {
          mapped = await runQuery(pnuWhere, 'j.gid');
        }
      }

      parcels.push(
        mapped
          ? { ...mapped, address: mapped.address || address }
          : { address, pnu: pnuDigitsOnly(item.pnu ?? address), extent3857: null, geometry3857: null }
      );
    } catch {
      parcels.push({ address, pnu: pnuDigitsOnly(item.pnu ?? address), extent3857: null, geometry3857: null });
    }
  }

  return { parcels };
}

/** 도형(WKT 5181)과 면적으로 겹치는 public_layer.jijuk 필지 (경계 접합·선 접촉만 제외) */
export async function listJijukParcelsByGeomWkt5181(params: {
  wkt5181: string;
  limit?: number;
}): Promise<{
  parcels: Array<{
    address: string;
    pnu: string;
    extent3857: [number, number, number, number] | null;
    geometry3857: Record<string, unknown> | null;
  }>;
  error?: string;
}> {
  const wkt = String(params?.wkt5181 ?? '').trim();
  if (!wkt) return { parcels: [], error: 'wkt5181이 필요합니다.' };

  const limit = Math.min(Math.max(Math.floor(params?.limit ?? 500), 1), 1000);
  const searchGeom = `ST_SetSRID(ST_GeomFromText('${esc(wkt)}'), ${JIJUK_GEOM_SRID})`;
  const jijukGeom = jijukGeom5181Sql('j.geom');

  const intersectGeom = `ST_Intersection(${jijukGeom}, ${searchGeom})`;

  const queryStr = `
    ${jijukParcelSelectSql('j.geom')}
      AND ${jijukGeom} && ${searchGeom}
      AND ST_Intersects(${jijukGeom}, ${searchGeom})
      AND ST_Dimension(${intersectGeom}) = 2
      AND ST_Area(${intersectGeom}) > 1.0
    ORDER BY j.gid
    LIMIT ${limit}`;

  try {
    const res = await db.execute(sql.raw(queryStr));
    const enriched = await enrichJijukRowsWithAdminNames((res.rows ?? []) as JijukParcelGeomRow[]);
    const parcels = enriched
      .map((r) => mapJijukRowToParcelGeom(r as JijukParcelGeomRow))
      .filter(
        (x): x is {
          address: string;
          pnu: string;
          extent3857: [number, number, number, number] | null;
          geometry3857: Record<string, unknown> | null;
        } => x != null
      );
    return { parcels };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { parcels: [], error: msg };
  }
}

/** 부모 도형(WKT 5181)에서 필지 영역 제외 — 필지목록 삭제 시 부모 도형 갱신 */
export async function subtractParcelFromParentWkt5181(params: {
  parentWkt5181: string;
  subtractGeoJson3857?: Record<string, unknown> | null;
  subtractPnu?: string;
}): Promise<{ wkt5181: string | null; cleared: boolean; error?: string }> {
  const parentWkt = String(params?.parentWkt5181 ?? '').trim();
  if (!parentWkt) return { wkt5181: null, cleared: true, error: 'parentWkt5181이 필요합니다.' };

  let subtractExpr: string | null = null;
  const geoJson = params?.subtractGeoJson3857;
  if (geoJson != null && typeof geoJson === 'object') {
    const jsonEsc = esc(JSON.stringify(geoJson));
    subtractExpr = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${jsonEsc}'), 3857), ${JIJUK_GEOM_SRID})`;
  } else {
    const pnuDigits = pnuDigitsOnly(params?.subtractPnu);
    const pnuWhere = pnuDigits ? buildJijukPnuMatchWhereSql(pnuDigits) : null;
    if (pnuWhere) {
      subtractExpr = `(SELECT ${jijukGeom5181Sql('j.geom')} FROM public_layer.jijuk j WHERE j.geom IS NOT NULL AND ${pnuWhere} ORDER BY j.gid LIMIT 1)`;
    }
  }
  if (!subtractExpr) {
    return { wkt5181: parentWkt, cleared: false, error: '제외할 필지 도형을 찾지 못했습니다.' };
  }

  const parentGeom = `ST_SetSRID(ST_GeomFromText('${esc(parentWkt)}'), ${JIJUK_GEOM_SRID})`;
  const queryStr = `
    SELECT
      CASE
        WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL
        ELSE ST_AsText(g)
      END AS wkt5181,
      (g IS NULL OR ST_IsEmpty(g)) AS cleared
    FROM (
      SELECT ST_CollectionExtract(
        ST_Difference(ST_MakeValid(${parentGeom}), ST_MakeValid(${subtractExpr})),
        3
      ) AS g
    ) q`;

  try {
    const res = await db.execute(sql.raw(queryStr));
    const row = res.rows?.[0] as { wkt5181?: string | null; cleared?: boolean | string } | undefined;
    const wkt5181 = row?.wkt5181 != null ? String(row.wkt5181).trim() : null;
    const cleared = row?.cleared === true || row?.cleared === 't' || !wkt5181;
    return { wkt5181: cleared ? null : wkt5181, cleared };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { wkt5181: null, cleared: false, error: msg };
  }
}

/** 자식 jijuk 테이블 필지목록 전체 교체 (parent_id 기준) */
export async function syncChildParcelsByParentId(params: {
  schema?: string;
  childTableName: string;
  childParentField?: string;
  parentId: string;
  /** @deprecated addresses 대신 parcels 사용 */
  addresses?: string[];
  parcels?: Array<{ address: string; pnu?: string }>;
}): Promise<{ success: boolean; error?: string }> {
  const childTableGuess = String(params?.childTableName ?? '').trim().toLowerCase();
  const parentId = String(params?.parentId ?? '').trim();
  if (!childTableGuess || !parentId) {
    return { success: false, error: 'childTableName과 parentId가 필요합니다.' };
  }

  const schema = resolveSchema(params?.schema);
  const childTable = await resolveLayerPhysicalRelName(schema, childTableGuess);
  if (!childTable) return { success: false, error: '자식 테이블을 찾을 수 없습니다.' };

  const childCols = await getTableColumns(schema, childTable);
  const parentField = String(params?.childParentField ?? 'parent_id').trim() || 'parent_id';
  const parentCol = findColumnName(childCols, parentField);
  const addressCol = findColumnName(childCols, 'parcel_address');
  if (!parentCol || !addressCol) {
    return { success: false, error: '자식 테이블에 parent_id·parcel_address 컬럼이 필요합니다.' };
  }

  const geomCol = findColumnName(childCols, 'geom');
  const parcelRows = Array.isArray(params.parcels)
    ? params.parcels
        .map((p) => ({
          address: String(p?.address ?? '').trim(),
          pnu: String(p?.pnu ?? '').trim(),
        }))
        .filter((p) => p.address)
    : Array.isArray(params.addresses)
      ? params.addresses.map((a) => ({ address: String(a ?? '').trim(), pnu: '' })).filter((p) => p.address)
      : [];

  try {
    await db.execute(
      sql.raw(
        `DELETE FROM ${quoteIdent(schema)}.${quoteIdent(childTable)}
         WHERE ${quoteIdent(parentCol)}::text = '${esc(parentId)}'`
      )
    );

    for (const row of parcelRows) {
      const addr = row.address;
      const pnuDigits = await resolvePnuDigitsFromInput(addr, row.pnu);
      const pnuWhere = pnuDigits ? buildJijukPnuMatchWhereSql(pnuDigits) : null;
      const geomInsert =
        geomCol && pnuWhere
          ? `(SELECT j.geom FROM public_layer.jijuk j
              WHERE j.geom IS NOT NULL AND ${pnuWhere}
              ORDER BY j.gid
              LIMIT 1)`
          : null;
      const cols = [quoteIdent(parentCol), quoteIdent(addressCol)];
      const vals = [`'${esc(parentId)}'`, `'${esc(addr)}'`];
      if (geomCol && geomInsert) {
        cols.push(quoteIdent(geomCol));
        vals.push(geomInsert);
      }
      await db.execute(
        sql.raw(
          `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(childTable)} (${cols.join(', ')})
           VALUES (${vals.join(', ')})`
        )
      );
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** PK 기준 행 삭제 (자식 jijuk 테이블 선삭제) */
export async function deleteTableRowByKey(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  keyField?: string;
  childTableName?: string;
  childParentField?: string;
}): Promise<{ success: boolean; error?: string }> {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  const keyValue = String(params?.keyValue ?? '').trim();
  if (!tableGuess || !keyValue) return { success: false, error: 'table과 keyValue가 필요합니다.' };

  const schema = resolveSchema(params?.schema);
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(schema, table);
  if (!columns.length) return { success: false, error: '컬럼 정보를 찾을 수 없습니다.' };

  let keyField = resolveKeyField(tableGuess, params?.keyField);
  if (!keyField || !findColumnName(columns, keyField)) {
    keyField = findColumnName(columns, 'id') ?? keyField;
  }
  if (!keyField || !findColumnName(columns, keyField)) {
    return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };
  }
  const keyCol = findColumnName(columns, keyField)!;

  try {
    const childTableGuess = String(params?.childTableName ?? '').trim().toLowerCase();
    if (childTableGuess) {
      const childTable = await resolveLayerPhysicalRelName(schema, childTableGuess);
      if (childTable) {
        const childCols = await getTableColumns(schema, childTable);
        const parentField = String(params?.childParentField ?? 'parent_id').trim() || 'parent_id';
        const parentCol = findColumnName(childCols, parentField);
        if (parentCol) {
          await db.execute(
            sql.raw(
              `DELETE FROM ${quoteIdent(schema)}.${quoteIdent(childTable)}
               WHERE ${quoteIdent(parentCol)}::text = '${esc(keyValue)}'`
            )
          );
        }
      }
    }

    const res = await db.execute(
      sql.raw(
        `DELETE FROM ${quoteIdent(schema)}.${quoteIdent(table)}
         WHERE ${quoteIdent(keyCol)}::text = '${esc(keyValue)}'
         RETURNING ${quoteIdent(keyCol)}::text AS deleted_key`
      )
    );
    const deleted = res.rows?.[0] as { deleted_key?: string } | undefined;
    if (!deleted?.deleted_key) return { success: false, error: '삭제할 데이터를 찾을 수 없습니다.' };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
