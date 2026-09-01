/**
 * StandardList용 서비스 (레이어 목록/테이블 데이터)
 * schema 파라미터로 layer / public_layer 구분 (기본값 layer)
 */
import { db, pool } from '@/database/db';
import { sql } from 'drizzle-orm';
import {
  KOREPS_PRICE_FILE_TABLE,
  KRAS_LAYER_CATALOG_SCHEMA,
} from '@/integrations/krasLayerSync.config';
import * as fs from 'fs';
import * as path from 'path';
import { identifyHitPriorityRank } from '@/lib/mapLayerGeometryOrder';
import { isFmsFacilityLayerTable } from '@/lib/fmsLinkage/fmsBinding';
import { fetchVworldCadastralGeomByPnu } from '@/lib/vworldCadastralGeom';
import { readDefineLayerCodes } from '@/lib/defineLayerCodeFiles';

const DEFAULT_SCHEMA = 'layer';
const ALLOWED_SCHEMAS = new Set(['layer', 'public_layer']);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function resolveSchema(raw?: string): string {
  const s = String(raw ?? '').trim() || DEFAULT_SCHEMA;
  return ALLOWED_SCHEMAS.has(s) ? s : DEFAULT_SCHEMA;
}

/**
 * 스키마 내 실제 릴레이션 이름(relname, 대소문자 보존)을 대소문자 무관하게 찾는다.
 * information_schema / geometry_columns / "schema"."Table" 인용 조회에 사용.
 */
export async function resolveLayerPhysicalRelName(schema: string, tableGuess: string): Promise<string | null> {
  const sch = String(schema ?? '').trim();
  const guess = String(tableGuess ?? '').trim();
  if (!sch || !guess) return null;
  const esc = (s: string) => s.replace(/'/g, "''");
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

/**
 * tables.json define_table_div_query를 SQL WHERE에 AND로 붙일 때 사용.
 * 관리자 설정값이지만 기본적인 인젝션 패턴만 차단.
 */
export function sanitizeDefineLayerRowFilter(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 800) return null;
  const probe = s.toLowerCase();
  if (
    /--|\/\*|\*\/|\bunion\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\btruncate\b|\bexec\b|\binto\b\s+outfile\b/i.test(
      probe
    )
  ) {
    return null;
  }
  if (s.includes(';')) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) return null;
  return s;
}

/**
 * 테이블 이름과 스키마로 행 조회.
 * spatialWkt/spatialSrid가 있으면 도형 내 데이터만 조회 (ST_Intersects).
 */
export async function getTableData(params: {
  table: string;
  schema?: string;
  limit?: number;
  offset?: number;
  spatialWkt?: string;
  spatialSrid?: number;
  /** define 분할 레이어 등: AND (조건) */
  rowFilter?: string;
} = { table: '' }) {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  if (!tableGuess) return { rows: [], total: 0 };

  const schema = resolveSchema(params?.schema).toLowerCase();
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { rows: [], total: 0 };

  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const spatialWkt = typeof params?.spatialWkt === 'string' ? params.spatialWkt.trim() : '';
  const spatialSrid = typeof params?.spatialSrid === 'number' ? params.spatialSrid : 5181;
  const rawRowFilter = String(params?.rowFilter ?? '').trim();
  let rowFilterSql: string | null = null;
  if (rawRowFilter) {
    rowFilterSql = sanitizeDefineLayerRowFilter(rawRowFilter);
    if (!rowFilterSql) return { rows: [], total: 0, error: '유효하지 않은 행 필터입니다.' };
  }

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");

  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
    if (columns.length === 0) return { rows: [], total: 0 };

    let geomCol: string | null = null;
    let tableSrid = 4326;
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name, srid FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
           LIMIT 1`
        )
      );
      const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
      if (gcRow?.name) {
        geomCol = String(gcRow.name).trim();
        tableSrid = gcRow.srid ?? 4326;
      }
    } catch {
      // no geometry column
    }

    const safeGeomCol = geomCol ? geomCol.replace(/"/g, '""') : '';
    const selectList = columns
      .map((c) => {
        if (geomCol && c === geomCol) {
          return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
        }
        return `"${c.replace(/"/g, '""')}"`;
      })
      .join(', ');

    const spatialPart =
      spatialWkt && geomCol
        ? (() => {
            const geomFromText = `ST_GeomFromText('${spatialWkt.replace(/'/g, "''")}', ${spatialSrid})`;
            const searchGeom =
              tableSrid !== spatialSrid ? `ST_Transform(${geomFromText}, ${tableSrid})` : geomFromText;
            return `ST_Intersects("${safeGeomCol}", ${searchGeom})`;
          })()
        : '';
    const filterPart = rowFilterSql ? `(${rowFilterSql})` : '';
    let whereClause = '';
    if (spatialPart && filterPart) whereClause = ` WHERE ${spatialPart} AND ${filterPart}`;
    else if (spatialPart) whereClause = ` WHERE ${spatialPart}`;
    else if (filterPart) whereClause = ` WHERE ${filterPart}`;

    /** 안전점검 시설물 — 접두 무시, 번호 속 연도(4자리) → 나머지 오름차순 (FMS 목록과 동일) */
    let orderClause = '';
    const facilNoCol = columns.find((c) => c.toLowerCase() === 'facil_no');
    if (isFmsFacilityLayerTable(table) && facilNoCol) {
      const safeFacilNo = facilNoCol.replace(/"/g, '""');
      orderClause = ` ORDER BY (substring("${safeFacilNo}" from '[0-9]{4}'))::integer ASC NULLS LAST, regexp_replace("${safeFacilNo}", '^[A-Za-z]+', '') ASC NULLS LAST`;
    }

    const [countRes, dataRes] = await Promise.all([
      db.execute(
        sql.raw(`SELECT COUNT(*) AS total FROM "${safeSchema}"."${safeTable}"${whereClause}`)
      ),
      db.execute(
        sql.raw(
          `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}"${whereClause}${orderClause} LIMIT ${limit} OFFSET ${offset}`
        )
      ),
    ]);

    const totalRow = countRes.rows?.[0] as { total?: string | number } | undefined;
    const total =
      totalRow?.total != null ? Math.max(0, parseInt(String(totalRow.total), 10) || 0) : 0;
    const rows = (dataRes.rows ?? []) as Record<string, unknown>[];
    return { rows, total };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], total: 0, error: msg };
  }
}

const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

/** 테이블 필드 설정에서 define_field_is_key === 'true' 인 필드명 반환 (첨부 폴더 키와 동일) */
export function getDefineTableKeyFieldName(tableName: string): string | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    const fields: Record<string, string>[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const keyField = Array.isArray(fields)
      ? fields.find((f) => defineFlagTrue(f?.define_field_is_key))
      : null;
    return keyField ? String(keyField.define_field_name ?? '').trim() || null : null;
  } catch {
    return null;
  }
}

function loadDefineFieldRows(tableName: string): Record<string, unknown>[] {
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

function defineFlagTrue(v: unknown): boolean {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

function defineFieldIdxNum(f: Record<string, unknown>): number {
  const n = parseInt(String(f.define_field_idx ?? '999999'), 10);
  return Number.isFinite(n) ? n : 999999;
}

function normalizeCodeKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

function loadDefineCodeLabelMap(tableName: string, fieldName: string): Map<string, string> {
  const tableField = `${tableName}__${fieldName}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const labels = new Map<string, string>();
  try {
    const parsed = readDefineLayerCodes(tableField);
    for (const row of parsed as { define_code_name?: string; define_code_kor_name?: string }[]) {
      const name = String(row?.define_code_name ?? '').trim();
      if (!name) continue;
      const kor = String(row?.define_code_kor_name ?? '').trim();
      const label = kor || name;
      const key = normalizeCodeKey(name);
      labels.set(key, label);
    }
  } catch {
    /* 코드 파일 없음·파싱 실패는 원본 값 유지 */
  }
  return labels;
}

function lookupDefineCodeLabel(tableName: string, fieldName: string, raw: string): string | undefined {
  const map = loadDefineCodeLabelMap(tableName, fieldName);
  return map.get(normalizeCodeKey(raw));
}

function formatIdentifyCellValue(
  tableName: string,
  fieldName: string | null | undefined,
  raw: unknown,
  codeFieldNames: Set<string>
): string {
  if (raw == null) return '';
  const v = String(raw).trim();
  if (!v || !fieldName) return v;
  if (!codeFieldNames.has(fieldName.trim().toLowerCase())) return v;
  return lookupDefineCodeLabel(tableName, fieldName, v) ?? v;
}

function codeFieldNameSet(tableName: string): Set<string> {
  const names = new Set<string>();
  for (const f of loadDefineFieldRows(tableName)) {
    if (String(f.define_field_type ?? '').trim().toUpperCase() !== 'CODE') continue;
    const name = String(f.define_field_name ?? '').trim().toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

function joinDefineShownValues(
  row: Record<string, unknown>,
  fields: Record<string, unknown>[],
  flag: 'define_field_show_title' | 'define_field_show_list',
  tableName: string
): string {
  const cols = fields
    .filter((f) => defineFlagTrue(f[flag]))
    .sort((a, b) => defineFieldIdxNum(a) - defineFieldIdxNum(b));
  const parts: string[] = [];
  for (const f of cols) {
    const name = String(f.define_field_name ?? '').trim();
    if (!name) continue;
    if (GEOM_COLUMN_NAMES.has(name.toLowerCase())) continue;
    const raw = rowVal(row, name);
    if (raw != null && typeof raw === 'object') continue;
    let v = rowPick(row, [name]);
    if (!v) continue;
    if (String(f.define_field_type ?? '').trim().toUpperCase() === 'CODE') {
      const mapped = lookupDefineCodeLabel(tableName, name, v);
      if (mapped) v = mapped;
    }
    parts.push(v);
  }
  const sep =
    tableName === 'sd_heat_mitigation_facility' && flag === 'define_field_show_title' ? ' - ' : ' ';
  return parts.join(sep);
}

function safetyFacOrderBySql(fields: Record<string, unknown>[], columns: string[]): string {
  const colByLower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  const sorts = fields
    .map((f) => {
      const name = String(f.define_field_name ?? '').trim();
      const idxRaw = String(f.define_field_sort_idx ?? '').trim();
      if (!name || !idxRaw) return null;
      const idx = parseInt(idxRaw, 10);
      if (!Number.isFinite(idx)) return null;
      const phys = colByLower.get(name.toLowerCase());
      if (!phys) return null;
      const dir =
        String(f.define_field_sort_type ?? 'ASC').trim().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const type = String(f.define_field_type ?? '').trim().toUpperCase();
      return { phys, idx, dir, type };
    })
    .filter((x): x is { phys: string; idx: number; dir: string; type: string } => x != null)
    .sort((a, b) => a.idx - b.idx);
  if (sorts.length === 0) return '';
  return (
    ' ORDER BY ' +
    sorts
      .map((s) => {
        const q = `"${s.phys.replace(/"/g, '""')}"`;
        if (s.type === 'NUMBER') {
          return `CASE WHEN btrim(${q}::text) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN btrim(${q}::text)::numeric END ${s.dir} NULLS LAST`;
        }
        return `${q} ${s.dir}`;
      })
      .join(', ')
  );
}

/**
 * 키 값으로 테이블에서 단일 행 조회 (URL dataKey 복원용).
 * 데이터 설정(define_field_is_key)에 지정된 키 필드로만 조회.
 */
export async function getTableRowByKey(params: {
  table: string;
  schema?: string;
  keyValue: string | number;
  rowFilter?: string;
}) {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  if (!tableGuess) return { row: null };
  const schema = resolveSchema(params?.schema).toLowerCase();
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { row: null };
  const keyValue = params?.keyValue;
  if (keyValue == null || keyValue === '') return { row: null };
  const rawRowFilter = String(params?.rowFilter ?? '').trim();
  let rowFilterSql: string | null = null;
  if (rawRowFilter) {
    rowFilterSql = sanitizeDefineLayerRowFilter(rawRowFilter);
    if (!rowFilterSql) return { row: null };
  }

  const keyFieldName = getDefineTableKeyFieldName(params?.table?.trim() || tableGuess);
  if (!keyFieldName) return { row: null };

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const escapedKey = String(keyValue).replace(/'/g, "''");
  const safeKeyCol = keyFieldName.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");

  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
    if (columns.length === 0 || !columns.includes(keyFieldName)) return { row: null };

    let geomCol: string | null = null;
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
           LIMIT 1`
        )
      );
      const gcRow = gcRes.rows?.[0] as { name?: string } | undefined;
      if (gcRow?.name) geomCol = String(gcRow.name).trim();
    } catch {
      // no geometry column
    }

    const safeGeomCol = geomCol ? geomCol.replace(/"/g, '""') : '';
    const selectList = columns
      .map((c) => {
        if (geomCol && c === geomCol) {
          return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
        }
        return `"${c.replace(/"/g, '""')}"`;
      })
      .join(', ');

    const keyCond = `"${safeKeyCol}" = '${escapedKey}'`;
    const whereSql = rowFilterSql ? ` WHERE ${keyCond} AND (${rowFilterSql})` : ` WHERE ${keyCond}`;
    const dataRes = await db.execute(
      sql.raw(`SELECT ${selectList} FROM "${safeSchema}"."${safeTable}"${whereSql} LIMIT 1`)
    );
    const row = (dataRes.rows?.[0] ?? null) as Record<string, unknown> | null;
    return { row };
  } catch {
    return { row: null };
  }
}
const TABLES_JSON_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

let _tablesJsonCache: Record<string, unknown>[] | null = null;
function getTablesJson(): Record<string, unknown>[] {
  if (_tablesJsonCache) return _tablesJsonCache;
  try {
    _tablesJsonCache = JSON.parse(fs.readFileSync(TABLES_JSON_PATH, 'utf-8'));
  } catch { _tablesJsonCache = []; }
  return _tablesJsonCache!;
}

function getTitleFieldName(tableName: string): string | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    const fields: Record<string, string>[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const titleField = fields.find((f) => f.define_field_show_title === 'true');
    return titleField ? String(titleField.define_field_name ?? '') : null;
  } catch { return null; }
}

/** define 필드 설정에서 컬럼명 → 한글 라벨 */
function getDefineFieldKorName(physicalTable: string, columnName: string): string | null {
  const safe = physicalTable.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  const col = String(columnName ?? '').trim().toLowerCase();
  if (!col) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const fields: Record<string, string>[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const row = fields.find((f) => String(f.define_field_name ?? '').trim().toLowerCase() === col);
    if (!row) return null;
    const kor = String(row.define_field_kor_name ?? '').trim();
    return kor || null;
  } catch {
    return null;
  }
}

function findFirstKeywordColumnMatch(
  row: Record<string, unknown>,
  textCols: string[],
  keywordLc: string,
  physicalTable: string
): { fieldName: string; valuePreview: string } | null {
  if (!keywordLc) return null;
  const maxLen = 56;
  const codeFields = codeFieldNameSet(physicalTable);
  for (const col of textCols) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === col.toLowerCase());
    if (!key) continue;
    const v = row[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    if (s.toLowerCase().includes(keywordLc)) {
      const mapped = formatIdentifyCellValue(physicalTable, col, s, codeFields);
      const preview = mapped.length > maxLen ? `${mapped.slice(0, maxLen)}…` : mapped;
      return { fieldName: col, valuePreview: preview };
    }
  }
  return null;
}

type IdentifyFeatureOut = {
  titleValue: string;
  data: Record<string, unknown>;
  keywordMatch?: { fieldName: string; fieldKorName?: string; valuePreview: string };
};

function attachKeywordMatchToFeatures(
  features: { titleValue: string; data: Record<string, unknown> }[],
  textCols: string[],
  keywordRaw: string,
  physicalTable: string
): IdentifyFeatureOut[] {
  const kw = keywordRaw.trim().toLowerCase();
  if (!kw) return features as IdentifyFeatureOut[];
  return features.map((feat) => {
    const hit = findFirstKeywordColumnMatch(feat.data, textCols, kw, physicalTable);
    if (!hit) return feat;
    const kor = getDefineFieldKorName(physicalTable, hit.fieldName);
    const out: IdentifyFeatureOut = { ...feat };
    out.keywordMatch = {
      fieldName: hit.fieldName,
      valuePreview: hit.valuePreview,
      ...(kor && kor !== hit.fieldName ? { fieldKorName: kor } : {}),
    };
    return out;
  });
}

function getTableKorName(tableName: string): string {
  const tables = getTablesJson();
  const k = String(tableName ?? '').trim().toLowerCase();
  const row = tables.find((r) => String(r.define_table_name ?? '').trim().toLowerCase() === k);
  return row ? String(row.define_table_kor_name ?? tableName) : tableName;
}

/** 지도 식별: 켜 둔 레이어 이름 → DB 물리 테이블 + 선택적 행 필터 (분할 레이어) */
function resolveIdentifyLayerTargets(
  names: string[],
  schema: string
): Array<{ displayName: string; physicalTable: string; rowFilter: string | null }> {
  const tables = getTablesJson();
  const schemaLc = schema.toLowerCase();
  const visibleLc = names.map((n) => String(n ?? '').trim().toLowerCase()).filter(Boolean);

  /** 이번에 켜 둔 분할이 하나라도 있으면 부모 레이어 이름은 중복 식별에서 제외 */
  const parentsWithVisibleSplitChild = new Set<string>();
  for (const displayName of visibleLc) {
    const row = tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === displayName
    );
    if (!row) continue;
    const rowSchema = String(row.define_table_schema ?? 'layer').trim().toLowerCase() || 'layer';
    if (rowSchema !== schemaLc) continue;
    const parent = String(row.define_table_parents_layer ?? '').trim().toLowerCase();
    const divQ = String(row.define_table_div_query ?? '').trim();
    if (parent && divQ) parentsWithVisibleSplitChild.add(parent);
  }

  const out: Array<{ displayName: string; physicalTable: string; rowFilter: string | null }> = [];
  for (const raw of names) {
    const displayName = String(raw ?? '').trim().toLowerCase();
    if (!displayName) continue;
    if (parentsWithVisibleSplitChild.has(displayName)) continue;

    const row = tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === displayName
    );
    if (!row) {
      out.push({ displayName, physicalTable: displayName, rowFilter: null });
      continue;
    }
    const rowSchema = String(row.define_table_schema ?? 'layer').trim().toLowerCase() || 'layer';
    if (rowSchema !== schemaLc) continue;
    const parent = String(row.define_table_parents_layer ?? '').trim();
    const divQ = String(row.define_table_div_query ?? '').trim();
    if (parent && divQ) {
      const rf = sanitizeDefineLayerRowFilter(divQ);
      if (!rf) continue;
      out.push({ displayName, physicalTable: parent.toLowerCase(), rowFilter: rf });
    } else {
      out.push({ displayName, physicalTable: displayName, rowFilter: null });
    }
  }
  return out;
}

/**
 * define_table_name → DB에 실제로 있는 물리 테이블명(소문자 기준).
 * 분할 레이어(define_table_parents_layer + div_query)는 부모 define 이름을 반환해 identify/getTableData와 동일.
 */
export function resolveDefineTablePhysicalBaseName(
  defineTableName: string,
  schema: string = DEFAULT_SCHEMA
): string {
  const displayName = String(defineTableName ?? '').trim().toLowerCase();
  if (!displayName) return '';
  const tables = getTablesJson();
  const schemaLc = resolveSchema(schema).toLowerCase();
  const row = tables.find(
    (r) => String(r.define_table_name ?? '').trim().toLowerCase() === displayName
  );
  if (!row) return displayName;
  const rowSchema = String(row.define_table_schema ?? 'layer').trim().toLowerCase() || 'layer';
  if (rowSchema !== schemaLc) return displayName;
  const parent = String(row.define_table_parents_layer ?? '').trim();
  const divQ = String(row.define_table_div_query ?? '').trim();
  if (parent && divQ && sanitizeDefineLayerRowFilter(divQ)) {
    return parent.toLowerCase();
  }
  return displayName;
}

/** identifyFeatures용 테이블 메타 캐시 (schema.table → geomCol, tableSrid, columns, geometry_columns.type). */
const identifyTableMetaCache = new Map<
  string,
  { geomCol: string; tableSrid: number; columns: string[]; geomTypeRaw: string | number | null }
>();

/**
 * 클릭 좌표 기준으로 여러 테이블에서 교차 도형을 검색.
 * params.x, params.y: 클릭 좌표 (EPSG:3857)
 * params.buffer: 버퍼 크기 (미터 단위, 기본 10)
 * params.tables: 켜 둔 레이어 이름 배열 (분할 레이어 이름 포함, tables.json 기준으로 물리 테이블·필터 해석)
 * params.srid: 좌표 SRID (기본 3857)
 */
export async function identifyFeatures(params: {
  x: number;
  y: number;
  buffer?: number;
  tables: string[];
  srid?: number;
  schema?: string;
}) {
  const { x, y, tables, srid = 3857 } = params;
  const buffer = typeof params.buffer === 'number' && params.buffer >= 0 ? params.buffer : 10;
  const schema = resolveSchema(params.schema).toLowerCase();

  if (!Array.isArray(tables) || tables.length === 0) return { results: [] };
  if (typeof x !== 'number' || typeof y !== 'number') return { results: [] };

  const targets = resolveIdentifyLayerTargets(tables, schema);
  if (targets.length === 0) return { results: [] };

  // 지도 클릭 데이터 목록 로그 (서버)
  console.log(
    `[FeatureIdentify] buffer=${buffer > 0 ? `${buffer.toFixed(1)}m` : '없음'} — 클릭 좌표 (${x.toFixed(1)}, ${y.toFixed(1)}) — ${targets.length}개 타깃 검색 중...`
  );

  const safeSchema = schema.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");
  const results: {
    tableName: string;
    korName: string;
    titleField: string | null;
    /** define 분할 레이어(부모+CQL) 조회 결과 — UI에서 부모보다 우선 표시 */
    isSplitLayer: boolean;
    features: { titleValue: string; data: Record<string, unknown> }[];
    /** 정렬용 — 응답에서는 제거 (점→선→면 우선) */
    identifyGeomRank: number;
  }[] = [];
  const queries: string[] = [];

  await Promise.all(
    targets.map(async ({ displayName, physicalTable, rowFilter }) => {
      const tableLower = physicalTable;
      const resolvedRel = await resolveLayerPhysicalRelName(schema, tableLower);
      if (!resolvedRel) return;
      const safeTable = resolvedRel.replace(/"/g, '""');
      if (!safeTable) return;

      const cacheKey = `${schema}.${resolvedRel}`;
      let geomCol: string;
      let tableSrid: number;
      let columns: string[];
      let geomTypeRaw: string | number | null = null;

      try {
        const cached = identifyTableMetaCache.get(cacheKey);
        if (cached) {
          geomCol = cached.geomCol;
          tableSrid = cached.tableSrid;
          columns = cached.columns;
          geomTypeRaw = cached.geomTypeRaw ?? null;
        } else {
          const gcRes = await db.execute(
            sql.raw(
              `SELECT f_geometry_column AS name, srid, type FROM geometry_columns
               WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
               LIMIT 1`
            )
          );
          const gcRow = gcRes.rows?.[0] as
            | { name?: string; srid?: number; type?: string | number }
            | undefined;
          if (!gcRow?.name) return;
          geomCol = String(gcRow.name).trim();
          tableSrid = Number(gcRow.srid);
          geomTypeRaw = gcRow.type ?? null;

          // geometry_columns srid=0/누락 시 실제 도형 SRID로 보정 (점사용료 등)
          if (!Number.isFinite(tableSrid) || tableSrid <= 0) {
            const safeGeomForProbe = geomCol.replace(/"/g, '""');
            try {
              const sridProbe = await db.execute(
                sql.raw(
                  `SELECT ST_SRID("${safeGeomForProbe}")::int AS s
                   FROM "${safeSchema}"."${safeTable}"
                   WHERE "${safeGeomForProbe}" IS NOT NULL
                   LIMIT 1`
                )
              );
              const probed = Number((sridProbe.rows?.[0] as { s?: number } | undefined)?.s);
              tableSrid = Number.isFinite(probed) && probed > 0 ? probed : 5181;
            } catch {
              tableSrid = 5181;
            }
          }

          const colRes = await db.execute(
            sql.raw(
              `SELECT column_name AS name FROM information_schema.columns
               WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(resolvedRel)}'
               ORDER BY ordinal_position`
            )
          );
          columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
          if (columns.length === 0) return;
          identifyTableMetaCache.set(cacheKey, { geomCol, tableSrid, columns, geomTypeRaw });
        }

        // 캐시에 srid=0이 남아 있으면 재보정
        if (!Number.isFinite(tableSrid) || tableSrid <= 0) {
          const safeGeomForProbe = geomCol.replace(/"/g, '""');
          try {
            const sridProbe = await db.execute(
              sql.raw(
                `SELECT ST_SRID("${safeGeomForProbe}")::int AS s
                 FROM "${safeSchema}"."${safeTable}"
                 WHERE "${safeGeomForProbe}" IS NOT NULL
                 LIMIT 1`
              )
            );
            const probed = Number((sridProbe.rows?.[0] as { s?: number } | undefined)?.s);
            tableSrid = Number.isFinite(probed) && probed > 0 ? probed : 5181;
          } catch {
            tableSrid = 5181;
          }
          identifyTableMetaCache.set(cacheKey, { geomCol, tableSrid, columns, geomTypeRaw });
        }

        const safeGeomCol = geomCol.replace(/"/g, '""');
        const point = `ST_SetSRID(ST_MakePoint(${x}, ${y}), ${srid})`;
        const transformed = tableSrid !== srid
          ? `ST_Transform(${point}, ${tableSrid})`
          : point;
        const searchGeom = buffer > 0 ? `ST_Buffer(${transformed}, ${buffer})` : transformed;

        const selectList = columns
          .map((c) => {
            if (c === geomCol) return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
            return `"${c.replace(/"/g, '""')}"`;
          })
          .join(', ');

        const spatialWhere = `ST_Intersects("${safeGeomCol}", ${searchGeom})`;
        const whereSql = rowFilter
          ? ` WHERE ${spatialWhere} AND (${rowFilter})`
          : ` WHERE ${spatialWhere}`;
        /** 동일 테이블 내 다중 히트: 점 → 선 → 면 (ST_GeometryType 기준) */
        const orderByGeomHitPriority = ` ORDER BY (
          CASE ST_GeometryType("${safeGeomCol}")
            WHEN 'ST_Point' THEN 0
            WHEN 'ST_MultiPoint' THEN 0
            WHEN 'ST_LineString' THEN 1
            WHEN 'ST_MultiLineString' THEN 1
            WHEN 'ST_Polygon' THEN 2
            WHEN 'ST_MultiPolygon' THEN 2
            ELSE 3
          END
        ) ASC`;
        const queryStr = `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}"${whereSql}${orderByGeomHitPriority} LIMIT 50`;
        queries.push(`[${displayName}→${physicalTable} SRID:${tableSrid}] ${queryStr}`);

        const dataRes = await db.execute(sql.raw(queryStr));
        const rawFeatures = (dataRes.rows ?? []) as Record<string, unknown>[];
        if (rawFeatures.length > 0) {
          const korName = getTableKorName(displayName);
          const titleField = getTitleFieldName(physicalTable);
          const features = mapRowsToIdentifyFeatures(rawFeatures, physicalTable, columns, geomCol);
          results.push({
            tableName: displayName,
            korName,
            titleField,
            isSplitLayer: rowFilter != null,
            features,
            identifyGeomRank: identifyHitPriorityRank(geomTypeRaw),
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        queries.push(`[${displayName}] ERROR: ${msg}`);
      }
    })
  );

  /** 레이어 간 순서: 점 레이어 → 선 → 면, 그다음 분할 레이어 우선, 한글명 */
  results.sort((a, b) => {
    if (a.identifyGeomRank !== b.identifyGeomRank) return a.identifyGeomRank - b.identifyGeomRank;
    const da = a.isSplitLayer ? 0 : 1;
    const db = b.isSplitLayer ? 0 : 1;
    if (da !== db) return da - db;
    return a.korName.localeCompare(b.korName, 'ko');
  });

  const resultsOut = results.map(({ identifyGeomRank: _rank, ...rest }) => rest);

  // 결과 요약 로그 (서버, 쿼리/결과는 위 루프에서 logQueryAndResult로 출력됨)
  if (resultsOut.length > 0) {
    const total = resultsOut.reduce((s, r) => s + r.features.length, 0);
    console.log(`[FeatureIdentify] ${total}건 발견 (${resultsOut.length}개 레이어)`);
    for (const r of resultsOut) {
      console.log(`[FeatureIdentify]   └ ${r.tableName}: ${r.features.length}건`);
    }
  } else {
    console.log('[FeatureIdentify] 해당 위치에 도형 없음');
  }

  return { results: resultsOut, queries };
}

/**
 * define 레이어 물리 테이블에서 PK(기본 ogc_fid)로 1건 조회.
 * identifyFeatures와 동일한 컬럼 목록·geom은 WGS84 GeoJSON(`ST_AsGeoJSON(ST_Transform(geom_col,4326))::json`).
 * 도로대장 목록 선택 등 지도 식별과 속성 스키마를 맞출 때 사용.
 */
export async function getLayerTableRowByOgcFid(params: {
  schema?: string;
  /** 물리 테이블명 */
  table: string;
  ogcFid: number | string;
  /** PK 컬럼 (기본 ogc_fid) */
  pkColumn?: string;
}): Promise<{ row: Record<string, unknown> | null }> {
  const schema = resolveSchema(params.schema).toLowerCase();
  const tableLower = String(params.table ?? '').trim().toLowerCase();
  const pkCol = String(params.pkColumn ?? 'ogc_fid').trim() || 'ogc_fid';
  const ogcFid = Math.floor(Number(params.ogcFid));
  if (!tableLower || !Number.isFinite(ogcFid) || ogcFid <= 0) {
    return { row: null };
  }

  const resolvedRel = await resolveLayerPhysicalRelName(schema, tableLower);
  if (!resolvedRel) return { row: null };

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = resolvedRel.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");
  const cacheKey = `${schema}.${resolvedRel}`;

  let geomCol: string;
  let columns: string[];

  try {
    const cached = identifyTableMetaCache.get(cacheKey);
    if (cached) {
      geomCol = cached.geomCol;
      columns = cached.columns;
    } else {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name, srid, type FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
           LIMIT 1`
        )
      );
      const gcRow = gcRes.rows?.[0] as
        | { name?: string; srid?: number; type?: string | number }
        | undefined;
      if (!gcRow?.name) return { row: null };
      geomCol = String(gcRow.name).trim();
      const tableSrid = gcRow.srid ?? 4326;
      const geomTypeRaw = gcRow.type ?? null;

      const colRes = await db.execute(
        sql.raw(
          `SELECT column_name AS name FROM information_schema.columns
           WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(resolvedRel)}'
           ORDER BY ordinal_position`
        )
      );
      columns = (colRes.rows as { name: string }[])
        .map((r) => String(r?.name ?? '').trim())
        .filter(Boolean);
      if (columns.length === 0) return { row: null };
      identifyTableMetaCache.set(cacheKey, { geomCol, tableSrid, columns, geomTypeRaw });
    }

    const safeGeomCol = geomCol.replace(/"/g, '""');
    const safePk = pkCol.replace(/"/g, '""');

    const selectList = columns
      .map((c) => {
        if (c === geomCol) {
          return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
        }
        return `"${c.replace(/"/g, '""')}"`;
      })
      .join(', ');

    const queryStr = `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}" WHERE "${safePk}" = ${ogcFid} LIMIT 1`;
    const dataRes = await db.execute(sql.raw(queryStr));
    const raw = dataRes.rows?.[0] as Record<string, unknown> | undefined;
    if (!raw) return { row: null };
    return { row: raw };
  } catch {
    return { row: null };
  }
}

/**
 * 주소정보 패널용: public_layer.jijuk에서 클릭 좌표(3857) 포함 필지 1건 조회.
 * 테이블/스키마/컬럼(geom)/좌표계(5181) 고정, 쿼리 1회만 실행.
 */
export async function getJijukParcelAtPoint(params: { x: number; y: number }) {
  const { x, y } = params;
  if (typeof x !== 'number' || typeof y !== 'number') return { results: [] };

  const schema = 'public_layer';
  const tableName = 'jijuk';
  const geomCol = 'geom';
  const tableSrid = 5181;
  const srid = 3857;

  const point = `ST_SetSRID(ST_MakePoint(${x}, ${y}), ${srid})`;
  const pointInTable = `ST_Transform(${point}, ${tableSrid})`;
  const queryStr = `SELECT "gid", "pnu", "jibun", "bchk", ST_AsGeoJSON(ST_Transform("${geomCol}", 4326))::json AS "${geomCol}" FROM "${schema}"."${tableName}" WHERE ST_Intersects("${geomCol}", ${pointInTable}) LIMIT 50`;

  try {
    const dataRes = await db.execute(sql.raw(queryStr));
    const rawFeatures = (dataRes.rows ?? []) as Record<string, unknown>[];
    const korName = getTableKorName(tableName);
    const titleField = getTitleFieldName(tableName);
    const features = rawFeatures.map((row) => {
      let titleValue = '';
      if (titleField) {
        const key = Object.keys(row).find((k) => k.toLowerCase() === titleField.toLowerCase());
        titleValue = key ? String(row[key] ?? '') : '';
      }
      if (!titleValue) {
        const fallback = Object.keys(row).find((k) => k.toLowerCase() === 'jibun');
        titleValue = fallback ? String(row[fallback] ?? '') : '';
      }
      return { titleValue, data: row };
    });
    return {
      results: rawFeatures.length > 0 ? [{ tableName, korName, titleField, features }] : [],
    };
  } catch {
    return { results: [] };
  }
}

function parseGeoJsonGeomField(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  let geom: unknown = value;
  if (typeof value === 'string') {
    try {
      geom = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return null;
  return geom as Record<string, unknown>;
}

function pnuCandidates(digits: string): string[] {
  if (digits.length === 19) {
    return [digits, `${digits.slice(0, 10)}${digits[10] === '1' ? '2' : '1'}${digits.slice(11)}`];
  }
  if (digits.length === 18) {
    return [`${digits.slice(0, 10)}1${digits.slice(10)}`, `${digits.slice(0, 10)}2${digits.slice(10)}`];
  }
  return digits ? [digits] : [];
}

async function getJijukGeomGeoJson4326ByPnu(pnu: string): Promise<Record<string, unknown> | null> {
  const esc = (v: string) => v.replace(/'/g, "''");
  const digits = String(pnu ?? '').replace(/\D/g, '');
  for (const key of pnuCandidates(digits)) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geom
           FROM public_layer.jijuk
           WHERE pnu = '${esc(key)}'
           LIMIT 1`
        )
      );
      const geom = parseGeoJsonGeomField((res.rows?.[0] as { geom?: unknown } | undefined)?.geom);
      if (geom) return geom;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * 우클릭 필지 하이라이트 — 로컬 jijuk 우선, 없으면 VWorld 연속지적 폴백.
 */
export async function getParcelHighlightGeom(params: {
  x?: number;
  y?: number;
  pnu?: string;
}): Promise<{ pnu: string | null; geometry4326: Record<string, unknown> | null }> {
  let resolvedPnu = String(params.pnu ?? '').replace(/\D/g, '').slice(0, 19) || null;

  if (typeof params.x === 'number' && typeof params.y === 'number') {
    const atPoint = await getJijukParcelAtPoint({ x: params.x, y: params.y });
    const jijuk = atPoint.results?.find((r) => String(r?.tableName ?? '').trim() === 'jijuk');
    const row = jijuk?.features?.[0]?.data as Record<string, unknown> | undefined;
    if (row) {
      const rowPnu = String(row.pnu ?? '').replace(/\D/g, '').slice(0, 19);
      if (rowPnu) resolvedPnu = rowPnu;
      const geom = parseGeoJsonGeomField(row.geom);
      if (geom && resolvedPnu) return { pnu: resolvedPnu, geometry4326: geom };
    }
  }

  if (!resolvedPnu) return { pnu: null, geometry4326: null };

  const localGeom = await getJijukGeomGeoJson4326ByPnu(resolvedPnu);
  if (localGeom) return { pnu: resolvedPnu, geometry4326: localGeom };

  const fromVworld = await fetchVworldCadastralGeomByPnu(resolvedPnu);
  if (fromVworld?.geometry4326) {
    return { pnu: fromVworld.pnu, geometry4326: fromVworld.geometry4326 };
  }

  return { pnu: resolvedPnu, geometry4326: null };
}

/**
 * 현재 지도 bbox(기본 EPSG:3857)와 교차하는 public_layer.jijuk 필지 목록.
 */
export async function getJijukParcelsInBbox(params: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  srid?: number;
  limit?: number;
}) {
  const { minX, minY, maxX, maxY } = params;
  if (![minX, minY, maxX, maxY].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { parcels: [] as Array<Record<string, unknown>> };
  }
  const srid = typeof params.srid === 'number' && Number.isFinite(params.srid) ? params.srid : 3857;
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 120), 1), 300);

  const schema = 'public_layer';
  const tableName = 'jijuk';
  const geomCol = 'geom';
  const tableSrid = 5181;

  /** DB마다 PK가 gid / ogc_fid 로 다름 — 없으면 pnu 정렬 */
  let orderCol = 'pnu';
  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = '${schema}' AND table_name = '${tableName}'
           AND column_name IN ('gid', 'ogc_fid', 'pnu')
         ORDER BY CASE column_name WHEN 'gid' THEN 0 WHEN 'ogc_fid' THEN 1 ELSE 2 END
         LIMIT 1`
      )
    );
    const col = String(
      (colRes.rows?.[0] as { column_name?: string } | undefined)?.column_name ?? ''
    ).trim();
    if (col) orderCol = col;
  } catch {
    /* keep pnu */
  }

  const envelope = `ST_MakeEnvelope(${minX}, ${minY}, ${maxX}, ${maxY}, ${srid})`;
  const envelopeInTable = `ST_Transform(${envelope}, ${tableSrid})`;
  const safeGeomCol = geomCol.replace(/"/g, '""');
  const safeOrderCol = orderCol.replace(/"/g, '""');
  const idSelect =
    orderCol === 'pnu' ? `"pnu"` : `"${safeOrderCol}" AS "gid", "pnu"`;
  const queryStr = `SELECT ${idSelect}, "jibun", "bchk", ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}" FROM "${schema}"."${tableName}" WHERE "${safeGeomCol}" && ${envelopeInTable} AND ST_Intersects("${safeGeomCol}", ${envelopeInTable}) ORDER BY "${safeOrderCol}" LIMIT ${limit}`;

  try {
    const dataRes = await db.execute(sql.raw(queryStr));
    const rows = (dataRes.rows ?? []) as Record<string, unknown>[];
    return { parcels: rows };
  } catch {
    return { parcels: [] as Array<Record<string, unknown>> };
  }
}

function formatOfficialLandPriceLabel(priceNum: number | null): string {
  if (priceNum == null || !Number.isFinite(priceNum)) return '-';
  return `${priceNum.toLocaleString('ko-KR')}원/㎡`;
}

function parseOfficialLandPriceNum(raw: unknown): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/,/g, '');
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * KOREPS 공시지가 파일 테이블(land_linkage.koreps00039)에서 PNU별 최신 1건.
 * 테이블 없거나 조회 실패 시 빈 맵 — 호출측에서 브이월드 fallback.
 */
export async function getLatestOfficialLandPricesByPnus(params: { pnus?: string[] }) {
  const pnus = [
    ...new Set(
      (Array.isArray(params?.pnus) ? params.pnus : [])
        .map((p) => String(p ?? '').trim())
        .filter(Boolean)
    ),
  ];
  type PriceEntry = { priceNum: number | null; priceLabel: string };
  const empty = { prices: {} as Record<string, PriceEntry> };
  if (!pnus.length) return empty;

  const schema = KRAS_LAYER_CATALOG_SCHEMA;
  const table = KOREPS_PRICE_FILE_TABLE;
  try {
    const existsRes = await pool.query<{ c: string | null }>(
      `select to_regclass($1) as c`,
      [`${schema}.${table}`]
    );
    if (!existsRes.rows[0]?.c) return empty;

    const { rows } = await pool.query<{ pnu: string; pnilp: string | null }>(
      `SELECT DISTINCT ON (btrim(pnu))
         btrim(pnu) AS pnu,
         btrim(pnilp) AS pnilp
       FROM ${schema}.${table}
       WHERE btrim(pnu) = ANY($1::text[])
       ORDER BY btrim(pnu),
         btrim(base_year) DESC NULLS LAST,
         btrim(stdmt) DESC NULLS LAST,
         btrim(pann_ymd) DESC NULLS LAST`,
      [pnus]
    );

    const prices: Record<string, PriceEntry> = {};
    for (const row of rows) {
      const pnu = String(row.pnu ?? '').trim();
      if (!pnu) continue;
      const priceNum = parseOfficialLandPriceNum(row.pnilp);
      prices[pnu] = {
        priceNum,
        priceLabel: formatOfficialLandPriceLabel(priceNum),
      };
    }
    return { prices };
  } catch {
    return empty;
  }
}

/**
 * 도형(WKT) 내에 포함된 레이어별 건수 조회.
 * 레이어 목록 도형(사각형/다각형/원형) 그리기 후, 해당 도형과 교차하는 레이어만 반환.
 * params.wkt: WKT 문자열 (SRID는 params.srid)
 * params.srid: WKT 좌표계 (기본 5181). 지도에서 3857로 그렸다면 클라이언트에서 5181로 변환 후 전달 권장.
 * params.layerTargets: 표시용 이름(name) + DB 테이블(table) + 선택 rowFilter
 * params.schema: 스키마 (기본 layer)
 */
export async function getLayersInGeometry(params: {
  wkt: string;
  srid?: number;
  layerTargets: Array<{ name: string; table: string; rowFilter?: string | null }>;
  schema?: string;
}) {
  const wkt = typeof params.wkt === 'string' ? params.wkt.trim() : '';
  const srid = typeof params.srid === 'number' ? params.srid : 5181;
  const targets = Array.isArray(params.layerTargets) ? params.layerTargets : [];
  const schema = resolveSchema(params.schema).toLowerCase();
  const esc = (s: string) => s.replace(/'/g, "''");

  if (!wkt || targets.length === 0) return { layers: [] as { tableName: string; count: number }[] };

  const results: { tableName: string; count: number }[] = [];

  await Promise.all(
    targets.map(async (t) => {
      const displayName = String(t.name ?? '').trim();
      const tableLower = String(t.table ?? '').trim().toLowerCase();
      const rawRf = String(t.rowFilter ?? '').trim();
      let rowFilterSql: string | null = null;
      if (rawRf) {
        rowFilterSql = sanitizeDefineLayerRowFilter(rawRf);
        if (!rowFilterSql) return;
      }
      const resolvedRel = await resolveLayerPhysicalRelName(schema, tableLower);
      if (!resolvedRel) return;
      const safeTable = resolvedRel.replace(/"/g, '""');
      const safeSchema = schema.replace(/"/g, '""');
      if (!safeTable || !displayName) return;

      try {
        const gcRes = await db.execute(
          sql.raw(
            `SELECT f_geometry_column AS name, srid FROM geometry_columns
             WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
             LIMIT 1`
          )
        );
        const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
        if (!gcRow?.name) return;
        const geomCol = String(gcRow.name).trim();
        const tableSrid = gcRow.srid ?? 4326;
        const safeGeomCol = geomCol.replace(/"/g, '""');

        const geomFromText = `ST_GeomFromText('${wkt.replace(/'/g, "''")}', ${srid})`;
        const searchGeom =
          tableSrid !== srid ? `ST_Transform(${geomFromText}, ${tableSrid})` : geomFromText;

        const spatialPart = `ST_Intersects("${safeGeomCol}", ${searchGeom})`;
        const whereSql = rowFilterSql
          ? ` WHERE ${spatialPart} AND (${rowFilterSql})`
          : ` WHERE ${spatialPart}`;
        const queryStr = `SELECT COUNT(*) AS cnt FROM "${safeSchema}"."${safeTable}"${whereSql}`;
        const countRes = await db.execute(sql.raw(queryStr));
        const row = countRes.rows?.[0] as { cnt?: string | number } | undefined;
        const count = row?.cnt != null ? Math.max(0, parseInt(String(row.cnt), 10) || 0) : 0;
        if (count > 0) results.push({ tableName: displayName, count });
      } catch {
        // skip table on error
      }
    })
  );

  return { layers: results };
}

function mapRowsToIdentifyFeatures(
  rawFeatures: Record<string, unknown>[],
  physicalTable: string,
  columns: string[],
  geomCol: string
): { titleValue: string; data: Record<string, unknown> }[] {
  const titleField = getTitleFieldName(physicalTable);
  const nonGeomCols = columns.filter((c) => c !== geomCol);
  const codeFields = codeFieldNameSet(physicalTable);
  return rawFeatures.map((row) => {
    let titleValue = '';
    if (titleField) {
      const key = Object.keys(row).find((k) => k.toLowerCase() === titleField.toLowerCase());
      titleValue = formatIdentifyCellValue(
        physicalTable,
        titleField,
        key ? row[key] : null,
        codeFields
      );
    }
    if (!titleValue && nonGeomCols.length > 0) {
      const fallbackCol = nonGeomCols[0];
      const fallback = Object.keys(row).find((k) => k.toLowerCase() === fallbackCol.toLowerCase());
      titleValue = formatIdentifyCellValue(
        physicalTable,
        fallbackCol,
        fallback ? row[fallback] : null,
        codeFields
      );
    }
    return { titleValue, data: row };
  });
}

/**
 * 시설관리 도형검색: WKT와 교차하는 피처를 지도 식별(identify)과 동일한 results 형태로 반환.
 */
export async function searchDefineLayersByGeometry(params: {
  wkt: string;
  srid?: number;
  tables: string[];
  schema?: string;
  limitPerLayer?: number;
}) {
  const wkt = typeof params.wkt === 'string' ? params.wkt.trim() : '';
  const srid = typeof params.srid === 'number' ? params.srid : 5181;
  const schema = resolveSchema(params.schema).toLowerCase();
  const tables = Array.isArray(params.tables)
    ? params.tables.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
    : [];
  let limitPerLayer =
    typeof params.limitPerLayer === 'number' && params.limitPerLayer > 0
      ? Math.floor(params.limitPerLayer)
      : 50;
  limitPerLayer = Math.min(100, limitPerLayer);

  if (!wkt || tables.length === 0) return { results: [] };

  const targets = resolveIdentifyLayerTargets(tables, schema);
  if (targets.length === 0) return { results: [] };

  const safeSchema = schema.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");

  type LayerOut = {
    tableName: string;
    korName: string;
    titleField: string | null;
    isSplitLayer: boolean;
    features: { titleValue: string; data: Record<string, unknown> }[];
    identifyGeomRank: number;
  };
  const results: LayerOut[] = [];

  await Promise.all(
    targets.map(async ({ displayName, physicalTable, rowFilter }) => {
      const tableLower = physicalTable;
      const resolvedRel = await resolveLayerPhysicalRelName(schema, tableLower);
      if (!resolvedRel) return;
      const safeTable = resolvedRel.replace(/"/g, '""');
      if (!safeTable) return;

      const cacheKey = `${schema}.${resolvedRel}`;
      let geomCol: string;
      let tableSrid: number;
      let columns: string[];
      let geomTypeRaw: string | number | null = null;

      try {
        const cached = identifyTableMetaCache.get(cacheKey);
        if (cached) {
          geomCol = cached.geomCol;
          tableSrid = cached.tableSrid;
          columns = cached.columns;
          geomTypeRaw = cached.geomTypeRaw ?? null;
        } else {
          const gcRes = await db.execute(
            sql.raw(
              `SELECT f_geometry_column AS name, srid, type FROM geometry_columns
               WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
               LIMIT 1`
            )
          );
          const gcRow = gcRes.rows?.[0] as
            | { name?: string; srid?: number; type?: string | number }
            | undefined;
          if (!gcRow?.name) return;
          geomCol = String(gcRow.name).trim();
          tableSrid = gcRow.srid ?? 4326;
          geomTypeRaw = gcRow.type ?? null;

          const colRes = await db.execute(
            sql.raw(
              `SELECT column_name AS name FROM information_schema.columns
               WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(resolvedRel)}'
               ORDER BY ordinal_position`
            )
          );
          columns = (colRes.rows as { name: string }[])
            .map((r) => String(r?.name ?? '').trim())
            .filter(Boolean);
          if (columns.length === 0) return;
          identifyTableMetaCache.set(cacheKey, { geomCol, tableSrid, columns, geomTypeRaw });
        }

        const safeGeomCol = geomCol.replace(/"/g, '""');
        const geomFromText = `ST_GeomFromText('${wkt.replace(/'/g, "''")}', ${srid})`;
        const searchGeom =
          tableSrid !== srid ? `ST_Transform(${geomFromText}, ${tableSrid})` : geomFromText;

        const spatialWhere = `ST_Intersects("${safeGeomCol}", ${searchGeom})`;
        const whereSql = rowFilter
          ? ` WHERE ${spatialWhere} AND (${rowFilter})`
          : ` WHERE ${spatialWhere}`;

        const orderByGeomHitPriority = ` ORDER BY (
          CASE ST_GeometryType("${safeGeomCol}")
            WHEN 'ST_Point' THEN 0
            WHEN 'ST_MultiPoint' THEN 0
            WHEN 'ST_LineString' THEN 1
            WHEN 'ST_MultiLineString' THEN 1
            WHEN 'ST_Polygon' THEN 2
            WHEN 'ST_MultiPolygon' THEN 2
            ELSE 3
          END
        ) ASC`;

        const selectList = columns
          .map((c) => {
            if (c === geomCol) {
              return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
            }
            return `"${c.replace(/"/g, '""')}"`;
          })
          .join(', ');

        const queryStr = `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}"${whereSql}${orderByGeomHitPriority} LIMIT ${limitPerLayer}`;
        const dataRes = await db.execute(sql.raw(queryStr));
        const rawFeatures = (dataRes.rows ?? []) as Record<string, unknown>[];
        if (rawFeatures.length === 0) return;

        const korName = getTableKorName(displayName);
        const titleField = getTitleFieldName(physicalTable);
        const features = mapRowsToIdentifyFeatures(rawFeatures, physicalTable, columns, geomCol);
        results.push({
          tableName: displayName,
          korName,
          titleField,
          isSplitLayer: rowFilter != null,
          features,
          identifyGeomRank: identifyHitPriorityRank(geomTypeRaw),
        });
      } catch {
        /* skip */
      }
    })
  );

  results.sort((a, b) => {
    if (a.identifyGeomRank !== b.identifyGeomRank) return a.identifyGeomRank - b.identifyGeomRank;
    const da = a.isSplitLayer ? 0 : 1;
    const db = b.isSplitLayer ? 0 : 1;
    if (da !== db) return da - db;
    return a.korName.localeCompare(b.korName, 'ko');
  });

  return {
    results: results.map(({ identifyGeomRank: _r, ...rest }) => rest),
  };
}

const KEYWORD_SEARCH_MAX_COLS = 14;
const KEYWORD_MAX_LEN = 120;

/**
 * 시설관리 통합검색: 키워드가 속성 텍스트에 포함되는 행을 레이어별로 조회(identify results 형태).
 */
export async function searchDefineLayersByKeyword(params: {
  keyword: string;
  tables: string[];
  schema?: string;
  limitPerLayer?: number;
}) {
  const keywordRaw = String(params.keyword ?? '').trim();
  const schema = resolveSchema(params.schema).toLowerCase();
  const tables = Array.isArray(params.tables)
    ? params.tables.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
    : [];
  let limitPerLayer =
    typeof params.limitPerLayer === 'number' && params.limitPerLayer > 0
      ? Math.floor(params.limitPerLayer)
      : 25;
  limitPerLayer = Math.min(80, limitPerLayer);

  if (!keywordRaw || keywordRaw.length > KEYWORD_MAX_LEN || tables.length === 0) {
    return { results: [] };
  }

  const kwEsc = keywordRaw.replace(/'/g, "''");
  const targets = resolveIdentifyLayerTargets(tables, schema);
  if (targets.length === 0) return { results: [] };

  const safeSchema = schema.replace(/"/g, '""');
  const esc = (s: string) => s.replace(/'/g, "''");

  type LayerOutKw = {
    tableName: string;
    korName: string;
    titleField: string | null;
    isSplitLayer: boolean;
    features: IdentifyFeatureOut[];
    identifyGeomRank: number;
  };
  const results: LayerOutKw[] = [];

  await Promise.all(
    targets.map(async ({ displayName, physicalTable, rowFilter }) => {
      const tableLower = physicalTable;
      const resolvedRel = await resolveLayerPhysicalRelName(schema, tableLower);
      if (!resolvedRel) return;
      const safeTable = resolvedRel.replace(/"/g, '""');
      if (!safeTable) return;

      const cacheKey = `${schema}.${resolvedRel}`;
      let geomCol: string;
      let columns: string[];
      let geomTypeRaw: string | number | null = null;

      try {
        const cached = identifyTableMetaCache.get(cacheKey);
        if (cached) {
          geomCol = cached.geomCol;
          columns = cached.columns;
          geomTypeRaw = cached.geomTypeRaw ?? null;
        } else {
          const gcRes = await db.execute(
            sql.raw(
              `SELECT f_geometry_column AS name, srid, type FROM geometry_columns
               WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
               LIMIT 1`
            )
          );
          const gcRow = gcRes.rows?.[0] as
            | { name?: string; srid?: number; type?: string | number }
            | undefined;
          if (!gcRow?.name) return;
          geomCol = String(gcRow.name).trim();
          const tableSridNew = gcRow.srid ?? 4326;
          geomTypeRaw = gcRow.type ?? null;

          const colRes = await db.execute(
            sql.raw(
              `SELECT column_name AS name FROM information_schema.columns
               WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(resolvedRel)}'
               ORDER BY ordinal_position`
            )
          );
          columns = (colRes.rows as { name: string }[])
            .map((r) => String(r?.name ?? '').trim())
            .filter(Boolean);
          if (columns.length === 0) return;
          identifyTableMetaCache.set(cacheKey, {
            geomCol,
            tableSrid: tableSridNew,
            columns,
            geomTypeRaw,
          });
        }

        const safeGeomCol = geomCol.replace(/"/g, '""');
        const dataCols = columns.filter((c) => c !== geomCol);
        const textCols = dataCols.slice(0, KEYWORD_SEARCH_MAX_COLS);
        if (textCols.length === 0) return;

        const orSql = textCols
          .map((c) => {
            const qc = c.replace(/"/g, '""');
            return `strpos(lower("${qc}"::text), lower('${kwEsc}')) > 0`;
          })
          .join(' OR ');

        const whereKeyword = `(${orSql})`;
        const whereSql = rowFilter
          ? ` WHERE ${whereKeyword} AND (${rowFilter})`
          : ` WHERE ${whereKeyword}`;

        const orderByGeomHitPriority = ` ORDER BY (
          CASE ST_GeometryType("${safeGeomCol}")
            WHEN 'ST_Point' THEN 0
            WHEN 'ST_MultiPoint' THEN 0
            WHEN 'ST_LineString' THEN 1
            WHEN 'ST_MultiLineString' THEN 1
            WHEN 'ST_Polygon' THEN 2
            WHEN 'ST_MultiPolygon' THEN 2
            ELSE 3
          END
        ) ASC`;

        const selectList = columns
          .map((c) => {
            if (c === geomCol) {
              return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
            }
            return `"${c.replace(/"/g, '""')}"`;
          })
          .join(', ');

        const queryStr = `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}"${whereSql}${orderByGeomHitPriority} LIMIT ${limitPerLayer}`;
        const dataRes = await db.execute(sql.raw(queryStr));
        const rawFeatures = (dataRes.rows ?? []) as Record<string, unknown>[];
        if (rawFeatures.length === 0) return;

        const korName = getTableKorName(displayName);
        const titleField = getTitleFieldName(physicalTable);
        const baseFeatures = mapRowsToIdentifyFeatures(rawFeatures, physicalTable, columns, geomCol);
        const features = attachKeywordMatchToFeatures(baseFeatures, textCols, keywordRaw, physicalTable);
        results.push({
          tableName: displayName,
          korName,
          titleField,
          isSplitLayer: rowFilter != null,
          features,
          identifyGeomRank: identifyHitPriorityRank(geomTypeRaw),
        });
      } catch {
        /* skip */
      }
    })
  );

  results.sort((a, b) => {
    if (a.identifyGeomRank !== b.identifyGeomRank) return a.identifyGeomRank - b.identifyGeomRank;
    const da = a.isSplitLayer ? 0 : 1;
    const db = b.isSplitLayer ? 0 : 1;
    if (da !== db) return da - db;
    return a.korName.localeCompare(b.korName, 'ko');
  });

  return {
    results: results.map(({ identifyGeomRank: _r, ...rest }) => rest),
  };
}

/**
 * 테이블 전체 건수만 조회 (레이어 펼치기 전 배지 표시용)
 */
export async function getTableCount(params: {
  table: string;
  schema?: string;
  rowFilter?: string;
} = { table: '' }) {
  const tableGuess = String(params?.table ?? '').trim().toLowerCase();
  if (!tableGuess) return { total: 0 };

  const schema = resolveSchema(params?.schema).toLowerCase();
  const table = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!table) return { total: 0 };

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const rawRowFilter = String(params?.rowFilter ?? '').trim();
  let rowFilterSql: string | null = null;
  if (rawRowFilter) {
    rowFilterSql = sanitizeDefineLayerRowFilter(rawRowFilter);
    if (!rowFilterSql) return { total: 0 };
  }
  const whereSql = rowFilterSql ? ` WHERE (${rowFilterSql})` : '';

  try {
    const countRes = await db.execute(
      sql.raw(`SELECT COUNT(*) AS total FROM "${safeSchema}"."${safeTable}"${whereSql}`)
    );
    const totalRow = countRes.rows?.[0] as { total?: string | number } | undefined;
    const total =
      totalRow?.total != null ? Math.max(0, parseInt(String(totalRow.total), 10) || 0) : 0;
    return { total };
  } catch (e: unknown) {
    return { total: 0 };
  }
}

/** 재난대응시설 패널: subtype별 layer 스키마 물리 테이블 */
const SAFETY_FACILITY_DISPLAY: Record<
  string,
  {
    nameKeys: string[];
    addressKeys: string[];
    phoneKeys?: string[];
    lonKeys?: string[];
    latKeys?: string[];
  }
> = {
  sd_cold_wave_shelter: {
    nameKeys: ['reare_nm'],
    addressKeys: ['rona_daddr'],
    lonKeys: ['lot'],
    latKeys: ['lat'],
  },
  sd_heat_wave_shelter: {
    nameKeys: ['rstr_nm'],
    addressKeys: ['rn_dtl_adres'],
    lonKeys: ['lo', 'xcord'],
    latKeys: ['la', 'ycord'],
  },
  sd_heat_mitigation_facility: {
    nameKeys: ['jibun_addr', 'fbrc_nm', 'instl_bzenty'],
    addressKeys: ['addr'],
    lonKeys: ['lot'],
    latKeys: ['lat'],
  },
  sd_earthquake_outdoor_evac_site: {
    nameKeys: ['vt_acmdfclty_nm'],
    addressKeys: ['eqk_acmdfclty_adres', 'dtl_adres', 'rn_dtl_adres'],
    phoneKeys: ['telno'],
    lonKeys: ['lo'],
    latKeys: ['la'],
  },
  sd_tsunami_emergency_evac_site: {
    nameKeys: ['shnt_place_nm'],
    addressKeys: ['shnt_place_dtl_position', 'rn_dtl_adres'],
    lonKeys: ['lo'],
    latKeys: ['la'],
  },
  // sd_civil_defense_shelter: {
  //   nameKeys: ['fclt_nm'],
  //   addressKeys: ['fclt_addr_rona', 'fclt_addr_lotno'],
  //   phoneKeys: ['mng_inst_telno'],
  // },
  sd_mois_displaced_temp_housing: {
    nameKeys: ['vt_acmdfclty_nm'],
    addressKeys: ['dtl_adres', 'rn_dtl_adres', 'korean_ctprvn_nm', 'sgg_rn'],
    phoneKeys: ['telno'],
    lonKeys: ['lo', 'lot'],
    latKeys: ['la', 'lat'],
  },
  radiation_shelter: {
    nameKeys: ['ftn_nm'],
    addressKeys: ['addr'],
  },
  water_play_sign: {
    addressKeys: ['addr'],
  },
};

function rowVal(row: Record<string, unknown>, k: string): unknown {
  if (row[k] !== undefined && row[k] !== null) return row[k];
  const lk = k.toLowerCase();
  for (const rk of Object.keys(row)) {
    if (rk.toLowerCase() === lk) return row[rk];
  }
  return undefined;
}

function rowPick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rowVal(row, k);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

const GEOM_COLUMN_NAMES = new Set([
  'geom',
  'geometry',
  'the_geom',
  'wkb_geometry',
  'shape',
  'geojson',
]);

function stripGeomRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (GEOM_COLUMN_NAMES.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function parseCoord(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

function pickLonLat(
  row: Record<string, unknown>,
  spec: (typeof SAFETY_FACILITY_DISPLAY)[string] | undefined
): { lon?: number; lat?: number } {
  const lonKeys = spec?.lonKeys ?? ['lo', 'lot', 'lon', 'xcord', 'longitude'];
  const latKeys = spec?.latKeys ?? ['la', 'lat', 'ycord', 'latitude'];
  let lon: number | undefined;
  let lat: number | undefined;
  for (const k of lonKeys) {
    const n = parseCoord(rowVal(row, k));
    if (n != null) {
      lon = n;
      break;
    }
  }
  for (const k of latKeys) {
    const n = parseCoord(rowVal(row, k));
    if (n != null) {
      lat = n;
      break;
    }
  }
  return { lon, lat };
}

function pickGeomJsonFromRow(row: Record<string, unknown>): unknown {
  for (const [k, v] of Object.entries(row)) {
    if (!GEOM_COLUMN_NAMES.has(k.toLowerCase())) continue;
    if (v == null) continue;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return v;
      }
    }
    return v;
  }
  return undefined;
}

function formatSafetyFacilityRow(
  subtype: string,
  table: string,
  row: Record<string, unknown>,
  rowIndex: number,
  spec: (typeof SAFETY_FACILITY_DISPLAY)[string] | undefined,
  fields: Record<string, unknown>[]
): {
  subtype: string;
  table: string;
  id: string;
  name: string;
  address: string;
  phone?: string;
  lon?: number;
  lat?: number;
  geomJson?: unknown;
} {
  const nameFromDefine = joinDefineShownValues(row, fields, 'define_field_show_title', table);
  const listFromDefine = joinDefineShownValues(row, fields, 'define_field_show_list', table);
  // 폭염저감: 목록 제목은 지번주소 (show_title 법정동·관리번호는 상세 헤더용으로 유지)
  const name =
    table === 'sd_heat_mitigation_facility'
      ? rowPick(row, ['jibun_addr']) ||
        rowPick(row, spec?.nameKeys ?? []) ||
        nameFromDefine ||
        '(이름 없음)'
      : nameFromDefine ||
        rowPick(row, spec?.nameKeys ?? []) ||
        rowPick(row, ['vt_acmdfclty_nm', 'nm', 'name', 'fclty_nm', 'title']);
  const address =
    listFromDefine ||
    rowPick(row, spec?.addressKeys ?? []) ||
    rowPick(row, ['addr', 'adres', 'address', 'dtl_adres']);
  const phone = rowPick(row, spec?.phoneKeys ?? ['telno', 'tel', 'phone', 'mng_inst_telno']);
  const keyName = getDefineTableKeyFieldName(table);
  const keyVal = keyName ? rowPick(row, [keyName]) : '';
  const ogc = rowVal(row, 'ogc_fid');
  const id =
    keyVal ||
    (ogc != null && String(ogc).trim() !== '' ? String(ogc).trim() : '') ||
    `${table}-${rowIndex}`;
  const { lon, lat } = pickLonLat(row, spec);
  const geomJson = pickGeomJsonFromRow(row);
  return {
    subtype,
    table,
    id,
    name: name || '(이름 없음)',
    address: address || '—',
    ...(phone ? { phone } : {}),
    ...(lon != null && lat != null ? { lon, lat } : {}),
    ...(geomJson != null ? { geomJson } : {}),
  };
}

async function fetchSafetyFacRows(opts: {
  schema: string;
  table: string;
  searchRaw: string;
  wkt5181?: string;
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const { schema, table, searchRaw, limit } = opts;
  const wkt5181 = String(opts.wkt5181 ?? '').trim();
  const esc = (s: string) => s.replace(/'/g, "''");
  const safeSchema = schema.replace(/"/g, '""');
  const resolvedRel = await resolveLayerPhysicalRelName(schema, table);
  if (!resolvedRel) return [];
  const safeTable = resolvedRel.replace(/"/g, '""');

  const colRes = await db.execute(
    sql.raw(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(resolvedRel)}'
       ORDER BY ordinal_position`
    )
  );
  const columns = (colRes.rows as { name: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
  if (columns.length === 0) return [];

  let geomCol: string | null = null;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
         LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string } | undefined;
    if (gcRow?.name) geomCol = String(gcRow.name).trim();
  } catch {
    /* no geom */
  }

  const dataCols = columns.filter((c) => !geomCol || c !== geomCol);
  const textCols = [...dataCols];
  const selectList = dataCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
  const safeGeom = geomCol ? geomCol.replace(/"/g, '""') : '';
  const geomSelect = geomCol
    ? `${selectList ? ', ' : ''}ST_AsGeoJSON(ST_Transform("${safeGeom}", 4326))::json AS "${safeGeom}"`
    : '';
  const fullSelect = `${selectList}${geomSelect}`;
  const fromSql = sql.raw(`"${safeSchema}"."${safeTable}"`);
  const orderSql = safetyFacOrderBySql(loadDefineFieldRows(table), dataCols);

  const whereParts: ReturnType<typeof sql>[] = [];
  if (searchRaw && textCols.length > 0) {
    const conds = textCols.map((c) =>
      sql`strpos(lower(${sql.raw(`"${c.replace(/"/g, '""')}"`)}::text), lower(${searchRaw})) > 0`
    );
    whereParts.push(sql`(${sql.join(conds, sql` OR `)})`);
  }
  if (wkt5181 && geomCol) {
    const g = sql.raw(`"${geomCol.replace(/"/g, '""')}"`);
    whereParts.push(
      sql`${g} IS NOT NULL AND ST_Intersects(ST_Transform(${g}, 5181), ST_SetSRID(ST_GeomFromText(${wkt5181}), 5181))`
    );
  }

  let dataRes;
  if (whereParts.length > 0) {
    const whereSql = sql.join(whereParts, sql` AND `);
    dataRes = await db.execute(
      sql`SELECT ${sql.raw(fullSelect)} FROM ${fromSql} WHERE ${whereSql}${sql.raw(orderSql)} LIMIT ${limit}`
    );
  } else {
    dataRes = await db.execute(
      sql`SELECT ${sql.raw(fullSelect)} FROM ${fromSql}${sql.raw(orderSql)} LIMIT ${limit}`
    );
  }

  return (dataRes.rows ?? []) as Record<string, unknown>[];
}

export type SafetyFacilityListItem = {
  subtype: string;
  table: string;
  id: string;
  name: string;
  address: string;
  phone?: string;
  lon?: number;
  lat?: number;
  /** geom 제외 원본 컬럼 — 상세 패널 표시용 */
  detailAttrs: Record<string, unknown>;
  /** WGS84 GeoJSON — 지도 붉은 강조용 */
  geomJson?: unknown;
};

/**
 * 재난대응시설 패널: 선택한 subtype별 layer 테이블에서 행 조회 (geom 컬럼 제외, 부분 문자열 검색).
 */
export async function listSafetyFacilities(params: {
  requests: { subtype: string; table: string }[];
  search?: string;
  wkt5181?: string;
  limitPerTable?: number;
  schema?: string;
}): Promise<{ items: SafetyFacilityListItem[]; error?: string }> {
  const schema = resolveSchema(params?.schema).toLowerCase();
  let limitPerTable = Number(params?.limitPerTable);
  if (!Number.isFinite(limitPerTable) || limitPerTable < 1) limitPerTable = 150;
  limitPerTable = Math.min(300, Math.floor(limitPerTable));
  const searchRaw = String(params?.search ?? '').trim();
  const wkt5181 = String(params?.wkt5181 ?? '').trim();
  const items: SafetyFacilityListItem[] = [];
  const requests = Array.isArray(params?.requests) ? params.requests : [];

  for (const req of requests) {
    const subtype = String(req?.subtype ?? '').trim();
    const table = String(req?.table ?? '').trim().toLowerCase();
    if (!subtype || !table) continue;
    try {
      const rows = await fetchSafetyFacRows({
        schema,
        table,
        searchRaw,
        ...(wkt5181 ? { wkt5181 } : {}),
        limit: limitPerTable,
      });
      const spec = SAFETY_FACILITY_DISPLAY[table];
      const fields = loadDefineFieldRows(table);
      rows.forEach((row, idx) => {
        const formatted = formatSafetyFacilityRow(subtype, table, row, idx, spec, fields);
        items.push({
          ...formatted,
          detailAttrs: stripGeomRow(row),
        });
      });
    } catch {
      /* 테이블 없음 등은 건너뜀 */
    }
  }

  return { items };
}

// ─── 재난시설 관련 건물군 레이어 조회 ───────────────────────────────────────

/** 건물·도로 레이어는 public_layer (tables.json define_table_schema) */
const SAFETY_FAC_BLDG_SCHEMA = 'public_layer';

export type SafetyFacRelatedBuildingResult = {
  bldgGroup: number;
  bldgGroupEntrance: number;
  building: number;
  buildingEntrance: number;
  eqbManSn: string | null;
  bulManNo: string | null;
  /** 건물 출입구 CQL용 — 해당 건물군 소속 건물 bul_man_no 목록 */
  bulManNos: string[];
};

async function resolveGeomMeta(
  schema: string,
  physicalTable: string
): Promise<{ geomCol: string; srid: number } | null> {
  const esc = (s: string) => s.replace(/'/g, "''");
  const gcRes = await db.execute(
    sql.raw(
      `SELECT f_geometry_column AS name, srid FROM geometry_columns
       WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(physicalTable)}'
       LIMIT 1`
    )
  );
  const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
  if (!gcRow?.name) return null;
  let srid = Number(gcRow.srid);
  const geomCol = String(gcRow.name).trim();
  if (!Number.isFinite(srid) || srid <= 0) {
    try {
      const safeGeom = geomCol.replace(/"/g, '""');
      const safeSch = schema.replace(/"/g, '""');
      const safeTbl = physicalTable.replace(/"/g, '""');
      const probe = await db.execute(
        sql.raw(
          `SELECT ST_SRID("${safeGeom}")::int AS s
           FROM "${safeSch}"."${safeTbl}"
           WHERE "${safeGeom}" IS NOT NULL
           LIMIT 1`
        )
      );
      const probed = Number((probe.rows?.[0] as { s?: number } | undefined)?.s);
      srid = Number.isFinite(probed) && probed > 0 ? probed : 5181;
    } catch {
      srid = 5181;
    }
  }
  return { geomCol, srid };
}

/** 재난시설–건물군 매칭: 시설 좌표 기준 허용 거리(m). 경계·약간 이탈 포함 */
const SAFETY_FAC_BLDG_GROUP_NEAR_M = 5;

/** WGS84 lon/lat → 테이블 SRID 점 SQL (identify와 동일 패턴) */
function safetyFacPointSql(lon: number, lat: number, tableSrid: number): string {
  const point4326 = `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
  return tableSrid === 4326 ? point4326 : `ST_Transform(${point4326}, ${tableSrid})`;
}

/** 시설 점과 geom 간 거리(m) — 테이블 SRID가 미터 단위가 아니면 5181로 변환 */
function safetyFacWithinMetersSql(
  geomCol: string,
  pointSql: string,
  tableSrid: number,
  meters: number
): string {
  if (tableSrid === 4326) {
    return `ST_DWithin(${geomCol}::geography, ${pointSql}::geography, ${meters})`;
  }
  if (tableSrid === 5181 || tableSrid === 5179 || tableSrid === 5186) {
    return `ST_DWithin(${geomCol}, ${pointSql}, ${meters})`;
  }
  return `ST_DWithin(ST_Transform(${geomCol}, 5181), ST_Transform(${pointSql}, 5181), ${meters})`;
}

/** eqb_man_sn 이 0이면 bul_man_no FK 사용 */
function isEqbManSnZero(v: string | null | undefined): boolean {
  if (v == null || v === '') return false;
  const s = String(v).trim();
  if (s === '0') return true;
  const n = Number(s);
  return Number.isFinite(n) && n === 0;
}

/**
 * 시설 좌표(lon, lat) 기준으로 관련 건물군·출입구·건물·건물출입구 건수를 조회한다.
 * - 건물군: 시설 좌표 ±5m 이내 (ST_DWithin)
 * - eqb_man_sn 이 0이면 bul_man_no 를 FK로 사용
 * - 건물군 출입구·건물: 건물군 eqb_man_sn (또는 0일 때 bul_man_no) FK
 * - 건물 출입구: 해당 건물들의 bul_man_no FK
 */
export async function getSafetyFacRelatedBuildingLayers(params: {
  lon: number;
  lat: number;
  schema?: string;
}): Promise<SafetyFacRelatedBuildingResult> {
  const sch =
    String(params.schema ?? '').trim() === 'layer'
      ? 'layer'
      : SAFETY_FAC_BLDG_SCHEMA;

  const empty: SafetyFacRelatedBuildingResult = {
    bldgGroup: 0,
    bldgGroupEntrance: 0,
    building: 0,
    buildingEntrance: 0,
    eqbManSn: null,
    bulManNo: null,
    bulManNos: [],
  };

  try {
    const mstRel = await resolveLayerPhysicalRelName(sch, 'tl_sgco_rnadr_mst');
    if (!mstRel) return empty;
    const mstMeta = await resolveGeomMeta(sch, mstRel);
    if (!mstMeta) return empty;

    const safeSch = sch.replace(/"/g, '""');
    const safeMst = mstRel.replace(/"/g, '""');
    const safeGeom = mstMeta.geomCol.replace(/"/g, '""');
    const pointSql = safetyFacPointSql(params.lon, params.lat, mstMeta.srid);
    const nearSql = safetyFacWithinMetersSql(
      `"${safeGeom}"`,
      pointSql,
      mstMeta.srid,
      SAFETY_FAC_BLDG_GROUP_NEAR_M
    );
    const distanceOrderSql =
      mstMeta.srid === 4326
        ? `ST_Distance("${safeGeom}"::geography, ${pointSql}::geography)`
        : mstMeta.srid === 5181 || mstMeta.srid === 5179 || mstMeta.srid === 5186
          ? `ST_Distance("${safeGeom}", ${pointSql})`
          : `ST_Distance(ST_Transform("${safeGeom}", 5181), ST_Transform(${pointSql}, 5181))`;

    // 1. 시설 좌표 ±5m 이내 건물군 — 복수일 때 가장 가까운 1건 FK 사용
    const bldgGroupRows = await db.execute(
      sql.raw(
        `SELECT COUNT(*) AS cnt
         FROM "${safeSch}"."${safeMst}"
         WHERE "${safeGeom}" IS NOT NULL
           AND ${nearSql}`
      )
    );
    const bldgGroupCnt = parseInt(String((bldgGroupRows.rows?.[0] as { cnt?: string })?.cnt ?? '0'), 10) || 0;

    let bldgGroupRow: { eqb_man_sn?: string | null; bul_man_no?: string | null } | undefined;
    if (bldgGroupCnt > 0) {
      const nearestRows = await db.execute(
        sql.raw(
          `SELECT "eqb_man_sn"::text AS eqb_man_sn, "bul_man_no"::text AS bul_man_no
           FROM "${safeSch}"."${safeMst}"
           WHERE "${safeGeom}" IS NOT NULL
             AND ${nearSql}
           ORDER BY ${distanceOrderSql}
           LIMIT 1`
        )
      );
      bldgGroupRow = nearestRows.rows?.[0] as typeof bldgGroupRow;
    }
    const eqbManSn =
      bldgGroupCnt > 0
        ? String(bldgGroupRow?.eqb_man_sn ?? '').trim() || null
        : null;
    const mstBulManNo =
      bldgGroupCnt > 0
        ? String(bldgGroupRow?.bul_man_no ?? '').trim() || null
        : null;

    const fkByBulManNo = isEqbManSnZero(eqbManSn);
    const fkValue = fkByBulManNo ? mstBulManNo : eqbManSn;

    if (!fkValue) {
      return { ...empty, bldgGroup: bldgGroupCnt, eqbManSn, bulManNo: mstBulManNo };
    }

    const escVal = fkValue.replace(/'/g, "''");
    const fkColumn = fkByBulManNo ? 'bul_man_no' : 'eqb_man_sn';

    // 2. 건물군 출입구
    const entrcRel = await resolveLayerPhysicalRelName(sch, 'tl_spbd_entrc');
    let bldgGroupEntranceCnt = 0;
    if (entrcRel) {
      const safeEntrc = entrcRel.replace(/"/g, '""');
      const entranceRows = await db.execute(
        sql.raw(
          `SELECT COUNT(*) AS cnt FROM "${safeSch}"."${safeEntrc}"
           WHERE "${fkColumn}"::text = '${escVal}'`
        )
      );
      bldgGroupEntranceCnt =
        parseInt(String((entranceRows.rows?.[0] as { cnt?: string })?.cnt ?? '0'), 10) || 0;
    }

    // 3. 건물
    const dongRel = await resolveLayerPhysicalRelName(sch, 'tl_sgco_rnadr_dong');
    let buildingCnt = 0;
    let bulManNo: string | null = fkByBulManNo ? mstBulManNo : null;
    let bulManNos: string[] = fkByBulManNo && mstBulManNo ? [mstBulManNo] : [];
    if (dongRel) {
      const safeDong = dongRel.replace(/"/g, '""');
      const buildingRows = await db.execute(
        sql.raw(
          `SELECT COUNT(*) AS cnt,
                  MIN("bul_man_no"::text) AS bul_man_no,
                  array_agg(DISTINCT "bul_man_no"::text) FILTER (WHERE "bul_man_no" IS NOT NULL) AS bul_man_nos
           FROM "${safeSch}"."${safeDong}"
           WHERE "${fkColumn}"::text = '${escVal}'`
        )
      );
      const bRow = buildingRows.rows?.[0] as {
        cnt?: string;
        bul_man_no?: string | null;
        bul_man_nos?: string[] | string | null;
      };
      buildingCnt = parseInt(String(bRow?.cnt ?? '0'), 10) || 0;
      if (!fkByBulManNo) {
        bulManNo =
          buildingCnt > 0 ? String(bRow?.bul_man_no ?? '').trim() || null : null;
        const rawNos = bRow?.bul_man_nos;
        if (Array.isArray(rawNos)) {
          bulManNos = rawNos.map((v) => String(v).trim()).filter(Boolean);
        } else if (typeof rawNos === 'string') {
          bulManNos = rawNos
            .replace(/^\{|\}$/g, '')
            .split(',')
            .map((v) => v.trim().replace(/^"|"$/g, ''))
            .filter(Boolean);
        }
      } else if (buildingCnt > 0) {
        const fromDong = String(bRow?.bul_man_no ?? '').trim();
        if (fromDong) {
          bulManNo = fromDong;
          bulManNos = [fromDong];
        }
      }
    }

    // 4. 건물 출입구 — 해당 건물 bul_man_no
    let buildingEntranceCnt = 0;
    if (dongRel && bulManNos.length > 0) {
      const dongEntrcRel = await resolveLayerPhysicalRelName(sch, 'tl_spbd_entrc_dong');
      if (dongEntrcRel) {
        const safeDong = dongRel.replace(/"/g, '""');
        const safeDongEntrc = dongEntrcRel.replace(/"/g, '""');
        const bldgEntrcWhere = fkByBulManNo
          ? `e."bul_man_no"::text = '${escVal}'`
          : `e."bul_man_no"::text IN (
               SELECT d."bul_man_no"::text FROM "${safeSch}"."${safeDong}" d
               WHERE d."eqb_man_sn"::text = '${escVal}'
                 AND d."bul_man_no" IS NOT NULL
             )`;
        const bldgEntrcRows = await db.execute(
          sql.raw(
            `SELECT COUNT(*) AS cnt FROM "${safeSch}"."${safeDongEntrc}" e
             WHERE ${bldgEntrcWhere}`
          )
        );
        buildingEntranceCnt =
          parseInt(String((bldgEntrcRows.rows?.[0] as { cnt?: string })?.cnt ?? '0'), 10) || 0;
      }
    }

    return {
      bldgGroup: bldgGroupCnt,
      bldgGroupEntrance: bldgGroupEntranceCnt,
      building: buildingCnt,
      buildingEntrance: buildingEntranceCnt,
      eqbManSn,
      bulManNo,
      bulManNos,
    };
  } catch (e) {
    console.error('[getSafetyFacRelatedBuildingLayers]', e);
    return empty;
  }
}
