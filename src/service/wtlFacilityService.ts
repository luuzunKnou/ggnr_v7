/**
 * 시설관리 — tables.json 그룹·layer 테이블 목록·전 필드 키워드 검색
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import db from '@/database/db';

export type WtlFacilitySource = {
  group: string;
  tableName: string;
  schema: string;
  korName: string;
};

export type WtlFacilityRow = {
  id: string;
  ogcFid: number | null;
  name: string;
  record: Record<string, unknown>;
  geom: unknown | null;
  tableName: string;
  fieldsTable: string;
  fieldsTableFallback: string | null;
  /** 관망 연관탭용 정규화 키 (wtl_pres_ps 등) */
  relatedParentKey: string;
  layerKey: string;
};

type TablesJsonRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
};

const TABLES_JSON_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'tables.json'
);
const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

const GEOM_COLS = new Set(['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape']);

/** pg json/text → GeoJSON geometry (목록 클릭·지도 이동용) */
function parseGeom(raw: unknown): GeoJSON.Geometry | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as GeoJSON.Geometry;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as GeoJSON.Geometry;
    } catch {
      return null;
    }
  }
  return null;
}

function resolveGeomColumn(physicalCols: string[]): string | null {
  for (const c of physicalCols) {
    if (GEOM_COLS.has(c.toLowerCase())) return c;
  }
  return null;
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function loadTablesJson(): TablesJsonRow[] {
  try {
    const raw = fs.readFileSync(TABLES_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TablesJsonRow[]) : [];
  } catch {
    return [];
  }
}

function loadDefineFieldRows(tableName: string): Record<string, unknown>[] {
  const safe = String(tableName ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  if (!safe) return [];
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** d_/c/wwtl_ 접두 제거 → 논리 wtl_* 키 */
export function normalizeFacilityRelatedParentKey(tableName: string): string {
  let t = String(tableName ?? '')
    .trim()
    .toLowerCase();
  if (!t) return '';
  if (t.startsWith('d_')) t = t.slice(2);
  if (t.startsWith('c') && t.slice(1).startsWith('wtl_')) t = t.slice(1);
  if (t.startsWith('w') && t.slice(1).startsWith('wtl_')) t = t.slice(1);
  return t;
}

function resolveFieldsTable(physical: string): {
  fieldsTable: string;
  fieldsTableFallback: string | null;
} {
  const phys = String(physical ?? '')
    .trim()
    .toLowerCase();
  const logical = normalizeFacilityRelatedParentKey(phys);
  const candidates = [phys, logical].filter(Boolean);
  let primary = phys;
  for (const c of candidates) {
    if (loadDefineFieldRows(c).length > 0) {
      primary = c;
      break;
    }
  }
  const fallback =
    candidates.find((c) => c.toLowerCase() !== primary.toLowerCase()) ?? null;
  return { fieldsTable: primary, fieldsTableFallback: fallback };
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const sch = String(schema ?? 'layer')
    .trim()
    .toLowerCase() || 'layer';
  const tbl = String(table ?? '')
    .trim()
    .toLowerCase();
  if (!tbl) return false;
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = '${esc(sch)}' AND lower(table_name) = '${esc(tbl)}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

async function listPhysicalColumns(schema: string, table: string): Promise<string[]> {
  const sch = String(schema ?? 'layer')
    .trim()
    .toLowerCase() || 'layer';
  const tbl = String(table ?? '')
    .trim()
    .toLowerCase();
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema = '${esc(sch)}' AND lower(table_name) = '${esc(tbl)}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows ?? [])
    .map((r) => String((r as { name?: string }).name ?? '').trim())
    .filter(Boolean);
}

function pickTitleField(fields: Record<string, unknown>[]): string | null {
  const title = fields.find(
    (f) => String(f.define_field_show_title ?? '').toLowerCase() === 'true'
  );
  const name = asStr(title?.define_field_name);
  return name || null;
}

function resolveColumnCase(physicalCols: string[], fieldName: string): string | null {
  const want = fieldName.toLowerCase();
  const hit = physicalCols.find((c) => c.toLowerCase() === want);
  return hit ?? null;
}

/**
 * 한글명과 일치하는 tables.json 행 → 그룹별 소스 (그룹 중복 시 첫 행)
 */
export async function listFacilitySources(params: {
  korName?: string;
} = {}): Promise<{ sources: WtlFacilitySource[] }> {
  const kor = String(params.korName ?? '').trim();
  if (!kor) return { sources: [] };
  const rows = loadTablesJson();
  const seen = new Set<string>();
  const sources: WtlFacilitySource[] = [];
  for (const row of rows) {
    if (String(row.define_table_kor_name ?? '').trim() !== kor) continue;
    const group = String(row.define_table_group ?? '').trim();
    const tableName = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase();
    if (!tableName) continue;
    const groupKey = group || '(미분류)';
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);
    const schema =
      String(row.define_table_schema ?? '')
        .trim()
        .toLowerCase() || 'layer';
    sources.push({
      group: groupKey,
      tableName,
      schema,
      korName: kor,
    });
  }
  return { sources };
}

/**
 * 선택 테이블 행 목록. keyword가 있으면 define_field 전 컬럼(또는 물리 텍스트 컬럼) ILIKE.
 */
export async function listFacilityRows(params: {
  table?: string;
  schema?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{
  rows: WtlFacilityRow[];
  total: number;
  table: string;
  fieldsTable: string;
  fieldsTableFallback: string | null;
}> {
  const table = String(params.table ?? '')
    .trim()
    .toLowerCase();
  const schema =
    String(params.schema ?? 'layer')
      .trim()
      .toLowerCase() || 'layer';
  const keyword = String(params.keyword ?? '').trim();
  const limit = Math.max(1, Math.min(Number(params.limit) || 500, 2000));
  const offset = Math.max(0, Number(params.offset) || 0);

  const empty = {
    rows: [] as WtlFacilityRow[],
    total: 0,
    table,
    fieldsTable: table,
    fieldsTableFallback: null as string | null,
  };
  if (!table) return empty;
  if (!(await tableExists(schema, table))) return empty;

  const physicalCols = await listPhysicalColumns(schema, table);
  if (physicalCols.length === 0) return empty;

  const { fieldsTable, fieldsTableFallback } = resolveFieldsTable(table);
  const defineFields = loadDefineFieldRows(fieldsTable);
  const titleField = pickTitleField(defineFields);
  const titleCol = titleField ? resolveColumnCase(physicalCols, titleField) : null;
  const ftrCol = resolveColumnCase(physicalCols, 'ftr_idn');
  const ogcCol = resolveColumnCase(physicalCols, 'ogc_fid');
  const geomCol = resolveGeomColumn(physicalCols);

  const nameExpr = titleCol
    ? `COALESCE(NULLIF(trim(t."${titleCol.replace(/"/g, '""')}"::text),''), ${
        ftrCol
          ? `NULLIF(trim(t."${ftrCol.replace(/"/g, '""')}"::text),'')`
          : 'NULL'
      }, ${ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"::text` : `''`})`
    : ftrCol
      ? `COALESCE(NULLIF(trim(t."${ftrCol.replace(/"/g, '""')}"::text),''), ${
          ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"::text` : `''`
        })`
      : ogcCol
        ? `t."${ogcCol.replace(/"/g, '""')}"::text`
        : `''`;

  const wheres: string[] = ['TRUE'];
  if (keyword) {
    const like = `%${esc(keyword)}%`;
    const searchCols = new Set<string>();
    for (const f of defineFields) {
      const fn = asStr(f.define_field_name);
      if (!fn || GEOM_COLS.has(fn.toLowerCase())) continue;
      const col = resolveColumnCase(physicalCols, fn);
      if (col) searchCols.add(col);
    }
    if (searchCols.size === 0) {
      for (const c of physicalCols) {
        if (GEOM_COLS.has(c.toLowerCase())) continue;
        searchCols.add(c);
      }
    }
    const parts = [...searchCols].map(
      (c) => `COALESCE(t."${c.replace(/"/g, '""')}"::text,'') ILIKE '${like}'`
    );
    if (parts.length > 0) wheres.push(`(${parts.join(' OR ')})`);
  }

  const whereSql = wheres.join(' AND ');
  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const geomQuoted = geomCol ? geomCol.replace(/"/g, '""') : '';
  const geomSel = geomCol
    ? `ST_AsGeoJSON(ST_Transform(t."${geomQuoted}", 4326))::json`
    : `NULL`;
  const recordSel = geomCol
    ? `(to_jsonb(t) - '${esc(geomCol)}')`
    : `to_jsonb(t)`;
  const relatedParentKey = normalizeFacilityRelatedParentKey(table);

  const countRes = await db.execute(
    sql.raw(
      `SELECT count(*)::int AS c FROM "${safeSchema}"."${safeTable}" t WHERE ${whereSql}`
    )
  );
  const total = Number((countRes.rows?.[0] as { c?: number } | undefined)?.c ?? 0) || 0;

  const dataRes = await db.execute(
    sql.raw(
      `SELECT
         ${ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"` : 'NULL'} AS "ogcFid",
         (${nameExpr}) AS name,
         ${geomSel} AS geom,
         ${recordSel} AS record
       FROM "${safeSchema}"."${safeTable}" t
       WHERE ${whereSql}
       ORDER BY ${ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"` : '1'}
       LIMIT ${limit} OFFSET ${offset}`
    )
  );

  const rows: WtlFacilityRow[] = [];
  for (const raw of dataRes.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const ogcFid =
      r.ogcFid != null && Number.isFinite(Number(r.ogcFid)) ? Number(r.ogcFid) : null;
    let record: Record<string, unknown> = {};
    if (r.record && typeof r.record === 'object' && !Array.isArray(r.record)) {
      record = r.record as Record<string, unknown>;
    } else if (typeof r.record === 'string') {
      try {
        const parsed = JSON.parse(r.record);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          record = parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
    }
    const name = asStr(r.name) || (ogcFid != null ? String(ogcFid) : '');
    rows.push({
      id: `${table}:${ogcFid ?? name}`,
      ogcFid,
      name,
      record,
      geom: parseGeom(r.geom),
      tableName: table,
      fieldsTable,
      fieldsTableFallback,
      relatedParentKey,
      layerKey: relatedParentKey || table,
    });
  }

  return { rows, total, table, fieldsTable, fieldsTableFallback };
}

/**
 * 지도 클릭(EPSG:3857) — 선택 테이블에서 최근접 시설 1건.
 * 측정·그리기 중에는 클라이언트가 호출하지 않음.
 */
export async function getFacilityAtPoint(params: {
  x?: number;
  y?: number;
  table?: string;
  schema?: string;
  /** 미터 단위 대략 버퍼 (3857) */
  tolerance?: number;
} = {}): Promise<{ row: WtlFacilityRow | null }> {
  const table = String(params.table ?? '')
    .trim()
    .toLowerCase();
  const schema =
    String(params.schema ?? 'layer')
      .trim()
      .toLowerCase() || 'layer';
  const x = Number(params.x);
  const y = Number(params.y);
  if (!table || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { row: null };
  }
  if (!(await tableExists(schema, table))) return { row: null };

  const physicalCols = await listPhysicalColumns(schema, table);
  if (physicalCols.length === 0) return { row: null };
  const geomCol = resolveGeomColumn(physicalCols);
  if (!geomCol) return { row: null };

  const { fieldsTable, fieldsTableFallback } = resolveFieldsTable(table);
  const defineFields = loadDefineFieldRows(fieldsTable);
  const titleField = pickTitleField(defineFields);
  const titleCol = titleField ? resolveColumnCase(physicalCols, titleField) : null;
  const ftrCol = resolveColumnCase(physicalCols, 'ftr_idn');
  const ogcCol = resolveColumnCase(physicalCols, 'ogc_fid');
  const tol = Math.max(1, Number(params.tolerance) || 12);

  const nameExpr = titleCol
    ? `COALESCE(NULLIF(trim(t."${titleCol.replace(/"/g, '""')}"::text),''), ${
        ftrCol
          ? `NULLIF(trim(t."${ftrCol.replace(/"/g, '""')}"::text),'')`
          : 'NULL'
      }, ${ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"::text` : `''`})`
    : ftrCol
      ? `COALESCE(NULLIF(trim(t."${ftrCol.replace(/"/g, '""')}"::text),''), ${
          ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"::text` : `''`
        })`
      : ogcCol
        ? `t."${ogcCol.replace(/"/g, '""')}"::text`
        : `''`;

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');
  const geomQuoted = geomCol.replace(/"/g, '""');
  const relatedParentKey = normalizeFacilityRelatedParentKey(table);

  const dataRes = await db.execute(
    sql.raw(
      `SELECT
         ${ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"` : 'NULL'} AS "ogcFid",
         (${nameExpr}) AS name,
         ST_AsGeoJSON(ST_Transform(t."${geomQuoted}", 4326))::json AS geom,
         (to_jsonb(t) - '${esc(geomCol)}') AS record,
         ST_Distance(
           ST_Transform(t."${geomQuoted}", 3857),
           ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857)
         ) AS dist
       FROM "${safeSchema}"."${safeTable}" t
       WHERE t."${geomQuoted}" IS NOT NULL
         AND ST_DWithin(
           ST_Transform(t."${geomQuoted}", 3857),
           ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857),
           ${tol}
         )
       ORDER BY dist
       LIMIT 1`
    )
  );

  const r = dataRes.rows?.[0] as Record<string, unknown> | undefined;
  if (!r) return { row: null };

  const ogcFid =
    r.ogcFid != null && Number.isFinite(Number(r.ogcFid)) ? Number(r.ogcFid) : null;
  let record: Record<string, unknown> = {};
  if (r.record && typeof r.record === 'object' && !Array.isArray(r.record)) {
    record = r.record as Record<string, unknown>;
  } else if (typeof r.record === 'string') {
    try {
      const parsed = JSON.parse(r.record);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  const name = asStr(r.name) || (ogcFid != null ? String(ogcFid) : '');
  return {
    row: {
      id: `${table}:${ogcFid ?? name}`,
      ogcFid,
      name,
      record,
      geom: parseGeom(r.geom),
      tableName: table,
      fieldsTable,
      fieldsTableFallback,
      relatedParentKey,
      layerKey: relatedParentKey || table,
    },
  };
}
