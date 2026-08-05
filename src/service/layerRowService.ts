/**
 * defineLayer 기반 레이어 행 조회·수정 (국공유지, 도로점용 등 공통)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { extent3857CenterTo4326, fetchParcelJibunFromCoord } from '@/lib/vworldAddressServer';
import { getPnuFromAddress } from './excelUploadService';
import { getDefineTableKeyFieldName } from './standardService';
import { recordDataLog } from './dataLogService';

const DEFAULT_SCHEMA = 'layer';
const ALLOWED_SCHEMAS = new Set(['layer', 'public_layer', 'public']);
/** jijuk — geometry_columns SRID=0, 실제 좌표는 EPSG:5181 */
const JIJUK_GEOM_SRID = 5181;
const JIJUK_SCHEMA_CANDIDATES = ['layer', 'public_layer', 'public'] as const;
let jijukSchemaCache: string | null = null;
let jijukOrderColCache: string | null = null;
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

async function resolveJijukSchema(): Promise<string> {
  if (jijukSchemaCache) return jijukSchemaCache;
  const schemasIn = JIJUK_SCHEMA_CANDIDATES.map((s) => `'${esc(s)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema
       FROM information_schema.tables
       WHERE table_name = 'jijuk' AND table_schema IN (${schemasIn})
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 WHEN 'public_layer' THEN 1 ELSE 2 END
       LIMIT 1`
    )
  );
  const schema = String((res.rows?.[0] as { table_schema?: string } | undefined)?.table_schema ?? '').trim();
  jijukSchemaCache = schema || 'public_layer';
  return jijukSchemaCache;
}

async function resolveJijukOrderColumn(jijukSchema: string): Promise<string> {
  if (jijukOrderColCache) return jijukOrderColCache;
  const safeSchema = esc(jijukSchema);
  const res = await db.execute(
    sql.raw(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = '${safeSchema}' AND table_name = 'jijuk'
         AND column_name IN ('gid', 'ogc_fid', 'pnu')
       ORDER BY CASE column_name WHEN 'gid' THEN 0 WHEN 'ogc_fid' THEN 1 ELSE 2 END
       LIMIT 1`
    )
  );
  const col = String((res.rows?.[0] as { column_name?: string } | undefined)?.column_name ?? 'pnu').trim();
  jijukOrderColCache = col || 'pnu';
  return jijukOrderColCache;
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
  /** true면 show_detail=false 필드도 포함 (더보기로 표시·저장) */
  includeHiddenDetail?: boolean;
}): DefineFieldMeta[] {
  const table = String(params?.table ?? '').trim().toLowerCase();
  if (!table) return [];
  const exclude = new Set(
    (params.excludeFields ?? []).map((f) => String(f).trim().toLowerCase()).filter(Boolean)
  );
  const includeHidden = params.includeHiddenDetail === true;
  const fields = loadDefineFields(table);
  return fields
    .map((raw) => {
      const field = String(raw.define_field_name ?? '').trim();
      if (!field) return null;
      const lower = field.toLowerCase();
      if (GEOM_COLUMN_NAMES.has(lower) || exclude.has(lower)) return null;
      const showDetail = isTrueFlag(raw.define_field_show_detail);
      const readOnly = isTrueFlag(raw.define_field_read_only);
      if (!showDetail && !includeHidden) return null;
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
    .sort((a, b) => {
      // 기본 표시 필드를 먼저, 숨김(더보기) 필드는 뒤에
      if (a.showDetail !== b.showDetail) return a.showDetail ? -1 : 1;
      return a.idx !== b.idx ? a.idx - b.idx : a.field.localeCompare(b.field);
    });
}

/** defineLayer + 실제 DB 컬럼 교집합 (define만 있고 DB에 없는 필드 제외) */
export async function getEditableFieldDefinitionsForTable(params: {
  table: string;
  schema?: string;
  excludeFields?: string[];
  includeHiddenDetail?: boolean;
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
    includeHiddenDetail: params.includeHiddenDetail,
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
    return `${table}.${col}`;
  }
  return quoteIdent(raw);
}

function jijukGeom5181Sql(geomCol = 'geom'): string {
  return `ST_SetSRID(${geomColRef(geomCol)}, ${JIJUK_GEOM_SRID})`;
}

function jijukGeom3857Sql(geomCol = 'geom'): string {
  return `ST_Transform(${jijukGeom5181Sql(geomCol)}, 3857)`;
}

type JijukTableRef = {
  /** "schema"."table" */
  qualified: string;
  /** ORDER BY 용 PK (gid | ogc_fid 등) */
  orderCol: string;
};

/** 프로젝트 DB에 있는 지적(jijuk) 테이블 위치 해석 — public_layer 우선, 없으면 layer */
async function resolveJijukTableRef(): Promise<JijukTableRef | null> {
  for (const schema of JIJUK_SCHEMA_CANDIDATES) {
    const table = await resolveLayerPhysicalRelName(schema, 'jijuk');
    if (!table) continue;
    const columns = await getTableColumns(schema, table);
    const colSet = new Set(columns.map((c) => c.toLowerCase()));
    if (!colSet.has('geom')) continue;
    const orderCol = colSet.has('gid')
      ? 'gid'
      : colSet.has('ogc_fid')
        ? 'ogc_fid'
        : columns[0]!;
    return {
      qualified: `${quoteIdent(schema)}.${quoteIdent(table)}`,
      orderCol,
    };
  }
  return null;
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

async function fetchRowAttrsAsJson(params: {
  schema: string;
  table: string;
  keyCol: string;
  keyValue: string;
}): Promise<Record<string, unknown> | null> {
  const fq = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;
  const where = `${quoteIdent(params.keyCol)}::text = '${esc(params.keyValue)}'`;
  try {
    // geom 있으면 전체 GeoJSON으로 포함 (이력 상세용)
    const res = await db.execute(
      sql.raw(
        `SELECT (
           (COALESCE(row_to_json(t.*)::jsonb, '{}'::jsonb) - 'geom')
           || CASE
                WHEN t.geom IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('geom', ST_AsGeoJSON(t.geom)::jsonb)
              END
         ) AS j
         FROM ${fq} t
         WHERE ${where}
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { j?: Record<string, unknown> } | undefined;
    return row?.j && typeof row.j === 'object' ? row.j : null;
  } catch {
    // geom 컬럼 없는 테이블 등 — 속성만
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT COALESCE(row_to_json(t.*)::jsonb, '{}'::jsonb) AS j
           FROM ${fq} t
           WHERE ${where}
           LIMIT 1`
        )
      );
      const row = res.rows?.[0] as { j?: Record<string, unknown> } | undefined;
      return row?.j && typeof row.j === 'object' ? row.j : null;
    } catch {
      return null;
    }
  }
}

function safeLogUser(raw?: string | null): string | null {
  const s = String(raw ?? '').trim();
  return s || null;
}

/** defineLayer 허용 필드만 UPDATE */
export async function updateTableRowByKey(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  keyField?: string;
  changes: Record<string, unknown>;
  excludeFields?: string[];
  includeHiddenDetail?: boolean;
  geomWkt5181?: string | null;
  geomClear?: boolean;
  /** 이력 작업자 표시 문자열 */
  logUser?: string | null;
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
    includeHiddenDetail: params.includeHiddenDetail,
  });
  const editableFields = new Map(
    editableDefs.filter((d) => !d.readOnly && d.field.toLowerCase() !== keyField.toLowerCase()).map((d) => [d.field.toLowerCase(), d])
  );

  const keyCol = findColumnName(columns, keyField)!;
  const oldData = await fetchRowAttrsAsJson({
    schema,
    table,
    keyCol,
    keyValue,
  });

  const setParts: string[] = [];
  for (const [key, rawVal] of entries) {
    const col = findColumnName(columns, key);
    if (!col) continue;
    const def = editableFields.get(col.toLowerCase());
    if (!def) continue;
    const val = normalizeChangeValue(rawVal);
    const oldKey =
      oldData && Object.prototype.hasOwnProperty.call(oldData, col)
        ? col
        : Object.keys(oldData ?? {}).find((k) => k.toLowerCase() === col.toLowerCase());
    const oldVal = normalizeChangeValue(oldKey != null ? oldData?.[oldKey] : undefined);
    if (val === oldVal) continue;
    setParts.push(val == null ? `${quoteIdent(col)} = NULL` : `${quoteIdent(col)} = '${esc(val)}'`);
  }

  if (geomClear) {
    const geomCol = await resolveGeomColumn(schema, table);
    if (!geomCol) return { success: false, error: 'geometry 컬럼을 찾을 수 없습니다.' };
    const hadGeom = oldData != null && (oldData.geom != null || oldData.geometry != null);
    if (hadGeom) {
      setParts.push(`${quoteIdent(geomCol)} = NULL`);
    }
  } else if (geomWkt) {
    const geomCol = await resolveGeomColumn(schema, table);
    if (!geomCol) return { success: false, error: 'geometry 컬럼을 찾을 수 없습니다.' };
    // 동일 도형이면 UPDATE 생략 (WKT 왕복으로 이력에 잡히는 것 방지)
    let geomSame = false;
    try {
      const eqRes = await db.execute(
        sql.raw(
          `SELECT CASE
             WHEN ${quoteIdent(geomCol)} IS NULL THEN false
             ELSE ST_Equals(
               ${quoteIdent(geomCol)},
               ${geomSetExpr(geomWkt)}
             )
           END AS same
           FROM ${quoteIdent(schema)}.${quoteIdent(table)}
           WHERE ${quoteIdent(keyCol)}::text = '${esc(keyValue)}'
           LIMIT 1`
        )
      );
      geomSame = Boolean((eqRes.rows?.[0] as { same?: boolean } | undefined)?.same);
    } catch {
      geomSame = false;
    }
    if (!geomSame) {
      setParts.push(`${quoteIdent(geomCol)} = ${geomSetExpr(geomWkt)}`);
    }
  }

  if (setParts.length === 0) {
    // 속성·도형 실질 변경 없음 — 이력도 남기지 않음
    return { success: true };
  }

  const q = `UPDATE ${quoteIdent(schema)}.${quoteIdent(table)}
             SET ${setParts.join(', ')}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(keyValue)}'
             RETURNING ${quoteIdent(keyCol)}::text AS updated_key`;

  try {
    const res = await db.execute(sql.raw(q));
    const updated = res.rows?.[0] as { updated_key?: string } | undefined;
    if (!updated?.updated_key) return { success: false, error: '대상 행을 찾을 수 없습니다.' };

    const newData = await fetchRowAttrsAsJson({
      schema,
      table,
      keyCol,
      keyValue,
    });
    void recordDataLog({
      source: '시스템',
      type: '수정',
      user: safeLogUser(params.logUser),
      tableName: tableGuess,
      keyField,
      keyValue,
      oldData: oldData ?? undefined,
      newData: newData ?? undefined,
    }).catch(() => {});

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
  excludeFields?: string[],
  includeHiddenDetail?: boolean
): Map<string, DefineFieldMeta> {
  const editableDefs = getEditableFieldDefinitions({
    table: tableGuess,
    excludeFields,
    includeHiddenDetail,
  });
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
  includeHiddenDetail?: boolean;
  geomWkt5181?: string | null;
  logUser?: string | null;
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

  const editableFields = buildInsertEditableMap(
    tableGuess,
    keyField,
    params.excludeFields,
    params.includeHiddenDetail
  );
  const values = { ...(params?.values ?? {}) };
  const insertCols: string[] = [];
  const insertVals: string[] = [];

  const insertedColSet = new Set<string>();

  for (const [key, rawVal] of Object.entries(values)) {
    const col = findColumnName(columnMeta.map((c) => c.name), key);
    if (!col) continue;
    const def = editableFields.get(col.toLowerCase());
    if (!def) continue;
    const val = normalizeChangeValue(rawVal);
    insertCols.push(quoteIdent(col));
    insertVals.push(val == null ? 'NULL' : `'${esc(val)}'`);
    insertedColSet.add(col.toLowerCase());
  }

  const keyCol = findColumnName(columnMeta.map((c) => c.name), keyField);
  if (keyCol && !insertedColSet.has(keyCol.toLowerCase())) {
    let keyRaw = values[keyField] ?? values[keyCol];
    let keyVal = normalizeChangeValue(keyRaw);
    if ((keyVal == null || !String(keyVal).trim()) && (tableGuess === 'usage_data_as' || tableGuess === 'cons_data_as')) {
      if (tableGuess === 'usage_data_as') {
        const { getNextUsageDataAsConsCode } = await import('./usageDataAsService');
        const generated = await getNextUsageDataAsConsCode();
        if (!String(generated.consCode ?? '').trim()) {
          return { success: false, error: generated.error ?? '공사코드를 생성하지 못했습니다.' };
        }
        keyVal = generated.consCode;
      } else {
        const { getNextConsCode } = await import('./consDataAsService');
        const generated = await getNextConsCode();
        if (!String(generated.consCode ?? '').trim()) {
          return { success: false, error: generated.error ?? '공사코드를 생성하지 못했습니다.' };
        }
        keyVal = generated.consCode;
      }
      values[keyField] = keyVal;
    }
    if (keyVal != null && String(keyVal).trim()) {
      insertCols.push(quoteIdent(keyCol));
      insertVals.push(`'${esc(String(keyVal).trim())}'`);
      insertedColSet.add(keyCol.toLowerCase());
    }
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
      const keyCol = findColumnName(columnMeta.map((c) => c.name), keyField)!;
      const newData = await fetchRowAttrsAsJson({ schema, table, keyCol, keyValue });
      void recordDataLog({
        source: '시스템',
        type: '추가',
        user: safeLogUser(params.logUser),
        tableName: tableGuess,
        keyField,
        keyValue,
        newData: newData ?? undefined,
      }).catch(() => {});
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
    const keyCol = findColumnName(columnMeta.map((c) => c.name), keyField)!;
    const newData = await fetchRowAttrsAsJson({ schema, table, keyCol, keyValue });
    void recordDataLog({
      source: '시스템',
      type: '추가',
      user: safeLogUser(params.logUser),
      tableName: tableGuess,
      keyField,
      keyValue,
      newData: newData ?? undefined,
    }).catch(() => {});
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
  jimok?: unknown;
  area_sqm?: unknown;
  geometry?: unknown;
  xmin?: unknown;
  ymin?: unknown;
  xmax?: unknown;
  ymax?: unknown;
};

export type JijukParcelGeomDto = {
  address: string;
  pnu: string;
  /** 지목 — jijuk.jibun 끝 한글(예: 240답 → 답) */
  jimok?: string;
  /** 당초면적(㎡) — 필지 도형 ST_Area(5181) */
  areaSqm?: number;
  extent3857: [number, number, number, number] | null;
  geometry3857: Record<string, unknown> | null;
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

function hasSubstantialParcelDetail(value: string): boolean {
  if (!value) return false;
  if (/\d/.test(value)) return true;
  return /리(\s|$)/u.test(value);
}

function extractLotLabelFromJibun(jibunRaw: string, pnu: unknown): string {
  const fromPnu = formatLotFromPnuDigits(pnuDigitsOnly(pnu));
  if (fromPnu) return fromPnu;
  const stripped = formatAddressStripSidoSigungu(String(jibunRaw ?? '').trim());
  if (!stripped) return '';
  // «240답», «산7임», «1-1 답» → 지번만
  const lotJimok = stripped.match(/^(산?\d+(?:-\d+)?)[\s]*[가-힣]+$/u);
  if (lotJimok?.[1]) return lotJimok[1];
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const lot = tokens[tokens.length - 1] ?? '';
  return lot && /[\d-]/.test(lot) ? lot : stripped;
}

/**
 * public_layer.jijuk.jibun 은 지번+지목 결합 값이다.
 * 예: «240답», «산7임», «1-1 답», «0-22 구»
 */
function extractJimokFromJijukJibun(jibunRaw: unknown): string {
  const s = String(jibunRaw ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(?:산?\d+(?:-\d+)?)[\s]*([가-힣]+)$/u);
  return m?.[1]?.trim() ?? '';
}

function extractRiNameFromJibun(strippedJibun: string, emdName: string, lotPart: string): string {
  const tokens = String(strippedJibun ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";

  const emd = String(emdName ?? "").trim();
  const lot = String(lotPart ?? "").trim();

  for (const token of tokens) {
    if (emd && token === emd) continue;
    if (lot && token === lot) continue;
    if (/^산?\d+(?:-\d+)?$/u.test(token)) continue;
    if (/리$/u.test(token)) return token;
  }
  return "";
}

/** jijuk 행 → 주소검색과 동일 형식(시·군·구 제외, 읍·면·동·리 + 지번) */
function buildParcelAddressFromJijukRow(row: JijukParcelGeomRow): string {
  const jibunRaw = String(row.jibun ?? "").trim();
  const strippedJibun = jibunRaw ? formatAddressStripSidoSigungu(jibunRaw) : "";

  const emdName = String(row.emd_name ?? "").trim();
  const lotPart = extractLotLabelFromJibun(jibunRaw, row.pnu);
  let riName = String(row.ri_name ?? "").trim();
  if (!riName) {
    riName = extractRiNameFromJibun(strippedJibun, emdName, lotPart);
  }

  const parts: string[] = [];
  if (emdName) parts.push(emdName);
  if (riName && riName !== emdName) parts.push(riName);
  if (lotPart) {
    const assembled = parts.join(" ");
    if (!assembled.includes(lotPart)) parts.push(lotPart);
  }

  if (parts.length >= 2) return parts.join(" ");

  if (strippedJibun && hasSubstantialParcelDetail(strippedJibun)) {
    return strippedJibun;
  }

  if (parts.length === 1) return parts[0]!;

  if (strippedJibun) return strippedJibun;
  return lotPart || pnuDigitsOnly(row.pnu);
}

function pnuAdminCodes(pnu: unknown): { emdCd: string; liCd: string } {
  const digits = pnuDigitsOnly(pnu);
  return { emdCd: digits.slice(0, 8), liCd: digits.slice(0, 10) };
}

type AdminTableMeta = {
  emdSchema: string | null;
  emdNameExpr: string | null;
  emdCodeCol: string;
  riSchema: string | null;
  riCodeCol: string | null;
  riNameCol: string | null;
  riGeomCol: string | null;
  riGeomSrid: number;
};

function normalizedTableSrid5181(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return JIJUK_GEOM_SRID;
  return n;
}

/** geometry_columns SRID 기준 EPSG:5181 표현식 */
function geomExprTo5181Sql(qualifiedCol: string, catalogSrid: number): string {
  const srid = normalizedTableSrid5181(catalogSrid);
  if (srid === JIJUK_GEOM_SRID) return qualifiedCol;
  return `ST_Transform(ST_SetSRID(${qualifiedCol}, ${srid}), ${JIJUK_GEOM_SRID})`;
}

let adminTableMetaCache: AdminTableMeta | null = null;

async function resolveAdminTableMeta(): Promise<AdminTableMeta> {
  if (adminTableMetaCache) return adminTableMetaCache;

  const meta: AdminTableMeta = {
    emdSchema: null,
    emdNameExpr: null,
    emdCodeCol: 'emd_cd',
    riSchema: null,
    riCodeCol: null,
    riNameCol: null,
    riGeomCol: null,
    riGeomSrid: JIJUK_GEOM_SRID,
  };
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT table_schema::text AS table_schema, table_name::text AS table_name, column_name::text AS column_name
         FROM information_schema.columns
         WHERE table_schema IN ('public_layer', 'layer') AND table_name IN ('emd', 'ri')
         ORDER BY CASE table_schema WHEN 'public_layer' THEN 0 ELSE 1 END, table_name, ordinal_position`
      )
    );
    const colsByTable = new Map<string, Set<string>>();
    const schemaByTable = new Map<string, string>();
    for (const row of res.rows ?? []) {
      const schema = String((row as { table_schema?: string }).table_schema ?? '').trim();
      const table = String((row as { table_name?: string }).table_name ?? '').trim().toLowerCase();
      const col = String((row as { column_name?: string }).column_name ?? '').trim().toLowerCase();
      if (!schema || !table || !col) continue;
      if (!colsByTable.has(table)) colsByTable.set(table, new Set());
      colsByTable.get(table)!.add(col);
      if (!schemaByTable.has(table)) schemaByTable.set(table, schema);
    }

    const emdCols = colsByTable.get('emd');
    if (emdCols) {
      meta.emdSchema = schemaByTable.get('emd') ?? null;
      const emdNameParts: string[] = [];
      for (const col of ['emd_kor_nm', 'emd_nm', 'adm_nm', 'name']) {
        if (emdCols.has(col)) emdNameParts.push(`NULLIF(TRIM(${quoteIdent(col)}::text), '')`);
      }
      if (emdNameParts.length > 0) {
        meta.emdNameExpr = emdNameParts.length === 1 ? emdNameParts[0]! : `COALESCE(${emdNameParts.join(', ')})`;
      }
      for (const col of ['emd_cd', 'emd_code']) {
        if (emdCols.has(col)) {
          meta.emdCodeCol = col;
          break;
        }
      }
    }

    const riCols = colsByTable.get('ri');
    if (riCols) {
      meta.riSchema = schemaByTable.get('ri') ?? null;
      for (const col of ['ri_cd', 'li_cd']) {
        if (riCols.has(col)) {
          meta.riCodeCol = col;
          break;
        }
      }
      for (const col of ['ri_nm', 'li_kor_nm', 'li_nm', 'name', 'adm_nm']) {
        if (riCols.has(col)) {
          meta.riNameCol = col;
          break;
        }
      }
      const riSchema = schemaByTable.get('ri');
      if (riSchema) {
        const geomMeta = await resolveGeomColumnMeta(riSchema, 'ri', ['geom']);
        meta.riGeomCol = geomMeta?.col ?? 'geom';
        meta.riGeomSrid = geomMeta?.srid ?? JIJUK_GEOM_SRID;
      }
    }
  } catch {
    // ignore — 이름 조회만 생략
  }

  adminTableMetaCache = meta;
  return meta;
}

/** ri 테이블 코드 매칭 실패 시 bjd.tr_kor_nm 폴백 (예: 사계리) */
async function loadRiNamesFromBjdByLiCds(liCds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(liCds.filter((c) => c.length === 10 && !c.endsWith('00')))];
  if (uniq.length === 0) return out;

  const ingestBjdRows = (rows: unknown[], liCdHint?: string) => {
    for (const row of rows ?? []) {
      const code = String((row as { code?: string }).code ?? '').trim();
      const name = String((row as { name?: string }).name ?? '').trim();
      if (!name || !/리(\s|$)/u.test(name)) continue;
      if (code && uniq.includes(code)) {
        out.set(code, name);
        continue;
      }
      if (liCdHint && code.length >= 10) {
        const emd = liCdHint.slice(0, 8);
        const suffix = liCdHint.slice(8, 10);
        if (code.slice(0, 8) === emd && code.slice(8, 10) === suffix) {
          out.set(liCdHint, name);
        }
      }
    }
  };

  const inList = uniq.map((c) => `'${esc(c)}'`).join(', ');
  for (const schema of ['public_layer', 'layer'] as const) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT tr_cd::text AS code, NULLIF(TRIM(tr_kor_nm::text), '') AS name
           FROM ${quoteIdent(schema)}.${quoteIdent('bjd')}
           WHERE tr_cd::text IN (${inList})
             AND NULLIF(TRIM(tr_kor_nm::text), '') IS NOT NULL`
        )
      );
      ingestBjdRows(res.rows ?? []);
      if (out.size >= uniq.length) break;
    } catch {
      // try next schema
    }
  }

  const stillMissing = uniq.filter((c) => !out.has(c));
  if (stillMissing.length === 0) return out;

  for (const schema of ['public_layer', 'layer'] as const) {
    for (const liCd of stillMissing) {
      if (out.has(liCd)) continue;
      const emd = esc(liCd.slice(0, 8));
      const suffix = esc(liCd.slice(8, 10));
      try {
        const res = await db.execute(
          sql.raw(
            `SELECT tr_cd::text AS code, NULLIF(TRIM(tr_kor_nm::text), '') AS name
             FROM ${quoteIdent(schema)}.${quoteIdent('bjd')}
             WHERE SUBSTRING(tr_cd::text, 1, 8) = '${emd}'
               AND SUBSTRING(tr_cd::text, 9, 2) = '${suffix}'
               AND NULLIF(TRIM(tr_kor_nm::text), '') IS NOT NULL
             LIMIT 1`
          )
        );
        ingestBjdRows(res.rows ?? [], liCd);
      } catch {
        // try next
      }
    }
    if (stillMissing.every((c) => out.has(c))) break;
  }

  return out;
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

  if (uniqEmd.length > 0 && meta.emdNameExpr && meta.emdSchema) {
    const inList = uniqEmd.map((c) => `'${esc(c)}'`).join(', ');
    const emdCodeCol = quoteIdent(meta.emdCodeCol);
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ${emdCodeCol}::text AS code, ${meta.emdNameExpr} AS name
           FROM ${quoteIdent(meta.emdSchema)}.${quoteIdent('emd')}
           WHERE ${emdCodeCol}::text IN (${inList})`
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

  if (uniqLi.length > 0 && meta.riSchema && meta.riCodeCol && meta.riNameCol) {
    const codeCol = quoteIdent(meta.riCodeCol);
    const nameCol = quoteIdent(meta.riNameCol);
    const codeToName = new Map<string, string>();

    const ingestRiRows = (rows: unknown[]) => {
      for (const row of rows ?? []) {
        const code = String((row as { code?: string }).code ?? '').trim();
        const name = String((row as { name?: string }).name ?? '').trim();
        if (code && name) codeToName.set(code, name);
      }
    };

    const exactList = uniqLi.map((c) => `'${esc(c)}'`).join(', ');
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ${codeCol}::text AS code, NULLIF(TRIM(${nameCol}::text), '') AS name
           FROM ${quoteIdent(meta.riSchema)}.${quoteIdent('ri')}
           WHERE ${codeCol}::text IN (${exactList})`
        )
      );
      ingestRiRows(res.rows ?? []);
    } catch {
      // ignore
    }

    const emdPrefixes = [...new Set(uniqLi.map((li) => li.slice(0, 8)).filter((c) => c.length === 8))];
    if (emdPrefixes.length > 0) {
      const emdInList = emdPrefixes.map((c) => `'${esc(c)}'`).join(', ');
      try {
        const res = await db.execute(
          sql.raw(
            `SELECT ${codeCol}::text AS code, NULLIF(TRIM(${nameCol}::text), '') AS name
             FROM ${quoteIdent(meta.riSchema)}.${quoteIdent('ri')}
             WHERE SUBSTRING(${codeCol}::text, 1, 8) IN (${emdInList})
               AND NULLIF(TRIM(${nameCol}::text), '') IS NOT NULL`
          )
        );
        ingestRiRows(res.rows ?? []);
      } catch {
        // ignore
      }
    }

    for (const liCd of uniqLi) {
      if (codeToName.has(liCd)) {
        riNames.set(liCd, codeToName.get(liCd)!);
        continue;
      }
      const suffix = liCd.slice(8, 10);
      if (suffix === '00') continue;
      for (const [code, name] of codeToName) {
        if (code.length >= 10 && code.slice(0, 8) === liCd.slice(0, 8) && code.slice(8, 10) === suffix) {
          riNames.set(liCd, name);
          break;
        }
      }
    }

    const stillMissingRi = uniqLi.filter((li) => !riNames.has(li) && li.slice(8, 10) !== '00');
    if (stillMissingRi.length > 0 && meta.riSchema && meta.riCodeCol && meta.riNameCol) {
      const codeCol = quoteIdent(meta.riCodeCol);
      const nameCol = quoteIdent(meta.riNameCol);
      for (const liCd of stillMissingRi) {
        const emd = esc(liCd.slice(0, 8));
        const suffix = esc(liCd.slice(8, 10));
        try {
          const res = await db.execute(
            sql.raw(
              `SELECT ${codeCol}::text AS code, NULLIF(TRIM(${nameCol}::text), '') AS name
               FROM ${quoteIdent(meta.riSchema)}.${quoteIdent('ri')}
               WHERE SUBSTRING(${codeCol}::text, 1, 8) = '${emd}'
                 AND SUBSTRING(${codeCol}::text, 9, 2) = '${suffix}'
                 AND NULLIF(TRIM(${nameCol}::text), '') IS NOT NULL
               LIMIT 1`
            )
          );
          const row = res.rows?.[0] as { code?: string; name?: string } | undefined;
          const name = String(row?.name ?? '').trim();
          if (name) riNames.set(liCd, name);
        } catch {
          // ignore
        }
      }
    }
  }

  const missingLi = uniqLi.filter((li) => !riNames.has(li));
  if (missingLi.length > 0) {
    const bjdNames = await loadRiNamesFromBjdByLiCds(missingLi);
    for (const [code, name] of bjdNames) {
      if (!riNames.has(code)) riNames.set(code, name);
    }
  }

  return { emdNames, riNames };
}

/** PNU 코드 조회로 리명을 못 찾은 필지 — 도형 중심이 속한 ri 폴리곤에서 이름 보강 */
async function enrichJijukRowsWithRiNameBySpatial(rows: JijukParcelGeomRow[]): Promise<JijukParcelGeomRow[]> {
  const needSpatial = rows.filter((row) => {
    if (String(row.ri_name ?? "").trim()) return false;
    return pnuDigitsOnly(row.pnu).length >= 19;
  });
  if (needSpatial.length === 0) return rows;

  const meta = await resolveAdminTableMeta();
  if (!meta.riSchema || !meta.riNameCol) return rows;

  const jijukSchema = await resolveJijukSchema();
  const pnus = [
    ...new Set(
      needSpatial
        .map((row) => pnuDigitsOnly(row.pnu).slice(0, 19))
        .filter((p) => p.length === 19)
    ),
  ];
  if (pnus.length === 0) return rows;

  const riNameCol = quoteIdent(meta.riNameCol);
  const riGeomCol = quoteIdent(meta.riGeomCol ?? 'geom');
  const riGeom5181 = geomExprTo5181Sql(`r.${riGeomCol}`, meta.riGeomSrid);
  const jijukGeom5181 = jijukGeom5181Sql('j.geom');
  const spatialRiByPnu = new Map<string, string>();

  const chunkSize = 100;
  for (let i = 0; i < pnus.length; i += chunkSize) {
    const chunk = pnus.slice(i, i + chunkSize);
    const inList = chunk.map((p) => `'${esc(p)}'`).join(", ");
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT DISTINCT ON (pnu_digits)
             pnu_digits AS pnu,
             ri_nm
           FROM (
             SELECT
               SUBSTRING(REGEXP_REPLACE(j.pnu::text, '[^0-9]', '', 'g'), 1, 19) AS pnu_digits,
               NULLIF(TRIM(r.${riNameCol}::text), '') AS ri_nm,
               ST_Area(${riGeom5181}) AS ri_area
             FROM ${quoteIdent(jijukSchema)}.${quoteIdent("jijuk")} j
             INNER JOIN ${quoteIdent(meta.riSchema)}.${quoteIdent("ri")} r
               ON r.${riGeomCol} IS NOT NULL
              AND ST_Contains(
                ${riGeom5181},
                ST_PointOnSurface(${jijukGeom5181})
              )
             WHERE SUBSTRING(REGEXP_REPLACE(j.pnu::text, '[^0-9]', '', 'g'), 1, 19) IN (${inList})
               AND NULLIF(TRIM(r.${riNameCol}::text), '') IS NOT NULL
           ) matched
           WHERE ri_nm IS NOT NULL
           ORDER BY pnu_digits, ri_area ASC`
        )
      );
      for (const row of res.rows ?? []) {
        const pnu = String((row as { pnu?: string }).pnu ?? "").trim();
        const riNm = String((row as { ri_nm?: string }).ri_nm ?? "").trim();
        if (pnu && riNm) spatialRiByPnu.set(pnu, riNm);
      }
    } catch {
      // spatial 보강 실패 시 PNU·jibun 기반 결과만 사용
    }
  }

  if (spatialRiByPnu.size === 0) return rows;

  return rows.map((row) => {
    const pnu = pnuDigitsOnly(row.pnu).slice(0, 19);
    const spatialRi = pnu ? spatialRiByPnu.get(pnu) : undefined;
    if (!spatialRi || String(row.ri_name ?? "").trim()) return row;
    return { ...row, ri_name: spatialRi };
  });
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
    let enriched: JijukParcelGeomRow[] = rows.map((row) => {
      const { emdCd, liCd } = pnuAdminCodes(row.pnu);
      return {
        ...row,
        emd_name: emdNames.get(emdCd) ?? row.emd_name,
        ri_name: riNames.get(liCd) ?? row.ri_name,
      };
    });
    enriched = await enrichJijukRowsWithRiNameBySpatial(enriched);
    return enriched;
  } catch {
    return rows;
  }
}

const jijukParcelSelectSql = (geomCol: string, fromQualified: string) => `
  SELECT
    j.pnu::text AS pnu,
    j.jibun::text AS jibun,
    -- jibun = 지번+지목(예: 240답, 산7임, 1-1 답). 지목은 끝 한글
    NULLIF(TRIM(SUBSTRING(j.jibun::text FROM '(?:산?[0-9]+(?:-[0-9]+)?)[[:space:]]*([가-힣]+)$')), '') AS jimok,
    ROUND(ST_Area(${jijukGeom5181Sql(geomCol)})::numeric, 2)::float8 AS area_sqm,
    ST_AsGeoJSON(${jijukGeom3857Sql(geomCol)})::json AS geometry,
    ST_XMin(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS xmin,
    ST_YMin(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS ymin,
    ST_XMax(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS xmax,
    ST_YMax(ST_Envelope(${jijukGeom3857Sql(geomCol)}))::float8 AS ymax
  FROM ${fromQualified} j
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

function mapJijukRowToParcelGeom(row: JijukParcelGeomRow): JijukParcelGeomDto | null {
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
  // SQL 파싱 실패·구형 응답 대비 — jibun에서 지목 재추출
  const jimok =
    String(row.jimok ?? '').trim() || extractJimokFromJijukJibun(row.jibun);
  const areaSqmRaw = Number(row.area_sqm);
  const areaSqm = Number.isFinite(areaSqmRaw) && areaSqmRaw > 0 ? areaSqmRaw : undefined;
  return {
    address: address || pnu,
    pnu,
    ...(jimok ? { jimok } : {}),
    ...(areaSqm != null ? { areaSqm } : {}),
    extent3857,
    geometry3857,
  };
}

/** PNU상 리 구역인데 주소에 리명이 빠진 경우 (예: 북면 360-1 vs 북면 사계리 360-1) */
function parcelAddressMissingRiName(row: JijukParcelGeomRow, address: string): boolean {
  const liCd = pnuAdminCodes(row.pnu).liCd;
  if (liCd.length < 10 || liCd.slice(8, 10) === '00') return false;
  const stripped = formatAddressStripSidoSigungu(String(address ?? '').trim());
  if (!stripped) return false;
  return !/리(\s|$)/u.test(stripped);
}

/** jijuk 필지 주소 — DB 보강 후에도 리명 누락 시 VWorld 역지오코딩으로 주소검색과 동일 형식 보강 */
async function finalizeJijukParcelGeom(
  row: JijukParcelGeomRow,
  mapped: JijukParcelGeomDto
): Promise<JijukParcelGeomDto> {
  if (!parcelAddressMissingRiName(row, mapped.address)) return mapped;

  const coord = extent3857CenterTo4326(mapped.extent3857);
  if (!coord) return mapped;

  const jibun = await fetchParcelJibunFromCoord(coord.lon, coord.lat);
  if (!jibun) return mapped;

  const normalized = formatAddressStripSidoSigungu(jibun);
  if (!normalized || !/리(\s|$)/u.test(normalized)) return mapped;

  return { ...mapped, address: normalized };
}

async function mapJijukRowsToParcelGeoms(rows: JijukParcelGeomRow[]): Promise<JijukParcelGeomDto[]> {
  const out: JijukParcelGeomDto[] = [];
  for (const row of rows) {
    const mapped = mapJijukRowToParcelGeom(row);
    if (!mapped) continue;
    out.push(await finalizeJijukParcelGeom(row, mapped));
  }
  return out;
}

/** 주소·PNU(및 선택 좌표)로 jijuk 필지 도형 조회 — jibun 문자열 비교 없음 */
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
  const jijukRef = await resolveJijukTableRef();
  if (!jijukRef) {
    return {
      parcels: items.map((item) => ({
        address: String(item.address ?? '').trim(),
        pnu: pnuDigitsOnly(item.pnu ?? item.address),
        extent3857: null,
        geometry3857: null,
      })),
      error: 'jijuk 테이블을 찾을 수 없습니다.',
    };
  }

  for (const item of items) {
    const address = String(item.address ?? '').trim();
    const lon = item.lon;
    const lat = item.lat;
    const hasPoint =
      typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat);

    const selectSql = jijukParcelSelectSql('j.geom', jijukRef.qualified);
    const orderSql = `j.${quoteIdent(jijukRef.orderCol)}`;

    const runQuery = async (whereSql: string) => {
      const queryStr = `${selectSql} AND ${whereSql} ORDER BY ${orderSql} LIMIT 1`;
      const res = await db.execute(sql.raw(queryStr));
      const enriched = await enrichJijukRowsWithAdminNames([(res.rows?.[0] ?? {}) as JijukParcelGeomRow]);
      const mapped = mapJijukRowToParcelGeom(enriched[0] ?? {});
      if (!mapped) return null;
      return finalizeJijukParcelGeom(enriched[0] ?? {}, mapped);
    };

    try {
      let mapped: ReturnType<typeof mapJijukRowToParcelGeom> = null;

      if (hasPoint) {
        const point5181 = `ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${JIJUK_GEOM_SRID})`;
        mapped = await runQuery(`ST_Intersects(${jijukGeom5181Sql('j.geom')}, ${point5181})`);
      }

      if (!mapped?.geometry3857) {
        const pnuDigits = await resolvePnuDigitsFromInput(address, item.pnu);
        const pnuWhere = pnuDigits ? buildJijukPnuMatchWhereSql(pnuDigits) : null;
        if (pnuWhere) {
          mapped = await runQuery(pnuWhere);
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

/** 도형(WKT 5181)과 면적으로 겹치는 jijuk 필지 (경계 접합·선 접촉만 제외) */
export async function listJijukParcelsByGeomWkt5181(params: {
  wkt5181: string;
  limit?: number;
}): Promise<{
  parcels: JijukParcelGeomDto[];
  error?: string;
}> {
  const wkt = String(params?.wkt5181 ?? '').trim();
  if (!wkt) return { parcels: [], error: 'wkt5181이 필요합니다.' };

  const jijukRef = await resolveJijukTableRef();
  if (!jijukRef) return { parcels: [], error: 'jijuk 테이블을 찾을 수 없습니다.' };

  const limit = Math.min(Math.max(Math.floor(params?.limit ?? 500), 1), 1000);
  const searchGeom = `ST_SetSRID(ST_GeomFromText('${esc(wkt)}'), ${JIJUK_GEOM_SRID})`;
  const jijukGeom = jijukGeom5181Sql('j.geom');

  const intersectGeom = `ST_Intersection(${jijukGeom}, ${searchGeom})`;

  const queryStr = `
    ${jijukParcelSelectSql('j.geom', jijukRef.qualified)}
      AND ${jijukGeom} && ${searchGeom}
      AND ST_Intersects(${jijukGeom}, ${searchGeom})
      AND ST_Dimension(${intersectGeom}) = 2
      AND ST_Area(${intersectGeom}) > 0.01
    ORDER BY j.${quoteIdent(jijukRef.orderCol)}
    LIMIT ${limit}`;

  try {
    const res = await db.execute(sql.raw(queryStr));
    const enriched = await enrichJijukRowsWithAdminNames((res.rows ?? []) as JijukParcelGeomRow[]);
    const parcels = await mapJijukRowsToParcelGeoms(enriched as JijukParcelGeomRow[]);
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
      const jijukRef = await resolveJijukTableRef();
      if (jijukRef) {
        subtractExpr = `(SELECT ${jijukGeom5181Sql('j.geom')} FROM ${jijukRef.qualified} j WHERE j.geom IS NOT NULL AND ${pnuWhere} ORDER BY j.${quoteIdent(jijukRef.orderCol)} LIMIT 1)`;
      }
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
  /** 주소 컬럼 (미지정 시 parcel_address → usage_loc 순 탐색) */
  childAddressField?: string;
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
  const addressFieldHint = String(params?.childAddressField ?? '').trim();
  const addressCol =
    (addressFieldHint ? findColumnName(childCols, addressFieldHint) : null) ??
    findColumnName(childCols, 'parcel_address') ??
    findColumnName(childCols, 'usage_loc');
  if (!parentCol || !addressCol) {
    return { success: false, error: '자식 테이블에 부모키·주소(usage_loc/parcel_address) 컬럼이 필요합니다.' };
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

    const jijukRef = geomCol ? await resolveJijukTableRef() : null;

    for (const row of parcelRows) {
      const addr = row.address;
      const pnuDigits = await resolvePnuDigitsFromInput(addr, row.pnu);
      const pnuWhere = pnuDigits ? buildJijukPnuMatchWhereSql(pnuDigits) : null;
      const geomInsert =
        geomCol && pnuWhere && jijukRef
          ? `(SELECT j.geom FROM ${jijukRef.qualified} j
              WHERE j.geom IS NOT NULL AND ${pnuWhere}
              ORDER BY j.${quoteIdent(jijukRef.orderCol)}
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

/** PK 기준 행 삭제 (자식 테이블 선삭제) */
export async function deleteTableRowByKey(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  keyField?: string;
  /** @deprecated childTableNames 사용 권장 */
  childTableName?: string;
  childTableNames?: string[];
  childParentField?: string;
  logUser?: string | null;
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
    const oldData = await fetchRowAttrsAsJson({
      schema,
      table,
      keyCol,
      keyValue,
    });

    const childTableGuesses = [
      ...(Array.isArray(params.childTableNames) ? params.childTableNames : []),
      ...(params.childTableName ? [params.childTableName] : []),
    ]
      .map((name) => String(name ?? "").trim().toLowerCase())
      .filter(Boolean);
    const uniqueChildTables = [...new Set(childTableGuesses)];
    const parentField = String(params?.childParentField ?? 'parent_id').trim() || 'parent_id';

    for (const childTableGuess of uniqueChildTables) {
      const childTable = await resolveLayerPhysicalRelName(schema, childTableGuess);
      if (!childTable) continue;
      const childCols = await getTableColumns(schema, childTable);
      const parentCol = findColumnName(childCols, parentField);
      if (!parentCol) continue;
      await db.execute(
        sql.raw(
          `DELETE FROM ${quoteIdent(schema)}.${quoteIdent(childTable)}
           WHERE ${quoteIdent(parentCol)}::text = '${esc(keyValue)}'`
        )
      );
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

    void recordDataLog({
      source: '시스템',
      type: '삭제',
      user: safeLogUser(params.logUser),
      tableName: tableGuess,
      keyField,
      keyValue,
      oldData: oldData ?? undefined,
    }).catch(() => {});

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
