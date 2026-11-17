/**
 * 시설관리 — tables.json 그룹·layer 테이블 목록·전 필드 키워드 검색
 * CODE 필드는 한글명(define_code_kor_name) 매칭 → 코드 IN (V6 통합검색과 동일)
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import { buildCodeKeywordInClauses } from '@/lib/defineLayerCodeKeyword';

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
const ADMIN_TABS_JSON_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'wtlAdmin',
  'adminTabs.json'
);

type AdminTabsJson = {
  wtlFacility?: unknown;
  wtlEquipment?: unknown;
  wtlHistory?: unknown;
};

/** 탭 라벨 배열 정규화 */
function normalizeTabLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const label = String(item ?? '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** adminTabs.json — 빌드 후 파일만 고쳐도 반영 (fs 런타임 읽기) */
function readAdminTabsJson(): AdminTabsJson {
  try {
    const raw = fs.readFileSync(ADMIN_TABS_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as AdminTabsJson;
  } catch {
    return {};
  }
}

/**
 * 탭별 tables.json 후보 중 DB에 실제 테이블이 하나라도 있으면 활성.
 * (1) 레이어 등록(tables.json) (2) DB 존재 — 둘 다 충족
 */
async function resolveEnabledTabs(
  tabs: string[],
  mode: 'facility' | 'equipment'
): Promise<string[]> {
  const labels = normalizeTabLabels(tabs);
  if (labels.length === 0) return [];
  const tagged: Array<{ tab: string; schema: string; tableName: string }> = [];
  for (const tab of labels) {
    const candidates =
      mode === 'equipment'
        ? buildEquipmentLayerGroupCandidates(tab)
        : buildFacilityLayerGroupCandidates(tab);
    for (const c of candidates) {
      tagged.push({ tab, schema: c.schema, tableName: c.tableName });
    }
  }
  if (tagged.length === 0) return [];
  const existing = await existingSchemaTableKeys(tagged);
  const enabled = new Set<string>();
  for (const row of tagged) {
    if (existing.has(`${row.schema}.${row.tableName}`)) enabled.add(row.tab);
  }
  return labels.filter((t) => enabled.has(t));
}

/** 시설관리 탭 종류 (adminTabs.json wtlFacility) + DB·레이어 활성 목록 */
export async function listFacilityTabs(): Promise<{
  tabs: string[];
  enabledTabs: string[];
}> {
  const tabs = normalizeTabLabels(readAdminTabsJson().wtlFacility);
  const enabledTabs = await resolveEnabledTabs(tabs, 'facility');
  return { tabs, enabledTabs };
}

/** 설비관리 탭 종류 (adminTabs.json wtlEquipment) + DB·레이어 활성 목록 */
export async function listEquipmentTabs(): Promise<{
  tabs: string[];
  enabledTabs: string[];
}> {
  const tabs = normalizeTabLabels(readAdminTabsJson().wtlEquipment);
  const enabledTabs = await resolveEnabledTabs(tabs, 'equipment');
  return { tabs, enabledTabs };
}

/** 이력관리 탭 종류 (adminTabs.json wtlHistory) — 설비와 동일 레이어 그룹 해석 */
export async function listHistoryTabs(): Promise<{
  tabs: string[];
  enabledTabs: string[];
}> {
  const tabs = normalizeTabLabels(readAdminTabsJson().wtlHistory);
  const enabledTabs = await resolveEnabledTabs(tabs, 'equipment');
  return { tabs, enabledTabs };
}

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

export type WtlFacilityLayerGroupOption = {
  group: string;
  tableName: string;
  schema: string;
  defineTableGroup: string;
};

function korNameForDefineTable(tableName: string): string | null {
  const want = String(tableName ?? '')
    .trim()
    .toLowerCase();
  if (!want) return null;
  for (const row of loadTablesJson()) {
    if (
      String(row.define_table_name ?? '')
        .trim()
        .toLowerCase() !== want
    ) {
      continue;
    }
    const kor = String(row.define_table_kor_name ?? '').trim();
    if (kor) return kor;
  }
  return null;
}

/** tables.json 후보 (시설: 그룹=define_table_group) */
function buildFacilityLayerGroupCandidates(
  tableName: string
): WtlFacilityLayerGroupOption[] {
  const kor = korNameForDefineTable(tableName);
  if (!kor) return [];
  const seen = new Set<string>();
  const out: WtlFacilityLayerGroupOption[] = [];
  for (const row of loadTablesJson()) {
    if (String(row.define_table_kor_name ?? '').trim() !== kor) continue;
    const group = String(row.define_table_group ?? '').trim() || '(미분류)';
    const name = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase();
    if (!name || seen.has(group)) continue;
    seen.add(group);
    out.push({
      group,
      tableName: name,
      schema:
        String(row.define_table_schema ?? '')
          .trim()
          .toLowerCase() || 'layer',
      defineTableGroup: group,
    });
  }
  return out;
}

/**
 * tables.json 후보 (설비: 탭 한글명과 동일한 레이어들의 define_table_group 모음).
 * 시설과 동일 — 그룹 키=define_table_group, 그룹 중복 시 첫 테이블.
 */
function buildEquipmentLayerGroupCandidates(
  tableName: string
): WtlFacilityLayerGroupOption[] {
  return buildFacilityLayerGroupCandidates(tableName);
}

/** information_schema — schema.table 키 집합 */
async function existingSchemaTableKeys(
  candidates: Array<{ schema: string; tableName: string }>
): Promise<Set<string>> {
  const uniq = new Map<string, { schema: string; tableName: string }>();
  for (const c of candidates) {
    const schema =
      String(c.schema ?? 'layer')
        .trim()
        .toLowerCase() || 'layer';
    const tableName = String(c.tableName ?? '')
      .trim()
      .toLowerCase();
    if (!tableName) continue;
    uniq.set(`${schema}.${tableName}`, { schema, tableName });
  }
  if (uniq.size === 0) return new Set();
  const orSql = [...uniq.values()]
    .map(
      (c) =>
        `(table_schema = '${esc(c.schema)}' AND lower(table_name) = '${esc(c.tableName)}')`
    )
    .join(' OR ');
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema AS s, lower(table_name) AS t
       FROM information_schema.tables
       WHERE ${orSql}`
    )
  );
  const out = new Set<string>();
  for (const row of res.rows ?? []) {
    const s = String((row as { s?: string }).s ?? '')
      .trim()
      .toLowerCase();
    const t = String((row as { t?: string }).t ?? '')
      .trim()
      .toLowerCase();
    if (s && t) out.add(`${s}.${t}`);
  }
  return out;
}

/**
 * 레이어 그룹 select 옵션 — tables.json 후보 중 DB에 실제 존재하는 테이블만.
 * mode: facility | equipment — 모두 그룹=define_table_group (탭 한글명 동일 레이어 모음)
 */
export async function listFacilityLayerGroups(params: {
  tableName?: string;
  mode?: 'facility' | 'equipment';
} = {}): Promise<{ options: WtlFacilityLayerGroupOption[] }> {
  const tableName = String(params.tableName ?? '')
    .trim()
    .toLowerCase();
  if (!tableName) return { options: [] };
  const mode = params.mode === 'equipment' ? 'equipment' : 'facility';
  const candidates =
    mode === 'equipment'
      ? buildEquipmentLayerGroupCandidates(tableName)
      : buildFacilityLayerGroupCandidates(tableName);
  if (candidates.length === 0) return { options: [] };
  const existing = await existingSchemaTableKeys(candidates);
  const options = candidates.filter((c) =>
    existing.has(`${c.schema}.${c.tableName}`)
  );
  return { options };
}

/**
 * 선택 테이블 행 목록.
 * keyword: define_field 전 컬럼 ILIKE + CODE 필드는 한글명 매칭 코드 IN.
 */
export type WtlFacilityListSortSpec = {
  field: string;
  dir: 'asc' | 'desc';
};

export async function listFacilityRows(params: {
  table?: string;
  schema?: string;
  keyword?: string;
  /** EPSG:5181 위치 도형(읍면동·리·급수블록). 있으면 ST_Within */
  areaWkts5181?: string[] | null;
  /** thead 다중 정렬 — 물리 컬럼만 허용 */
  sorts?: WtlFacilityListSortSpec[] | null;
  /** 관리번호 완전 일치. 펌프·흡수정에서 가압장·정수장 1건 조회 */
  ftrIdn?: string | null;
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
  const ftrIdn = String(params.ftrIdn ?? '').trim();
  const areaWkts = (params.areaWkts5181 ?? [])
    .map((w) => String(w ?? '').trim())
    .filter(Boolean);
  const limit = Math.max(1, Math.min(Number(params.limit) || 500, 2000));
  const offset = Math.max(0, Number(params.offset) || 0);
  const rawSorts = Array.isArray(params.sorts) ? params.sorts : [];

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
  if (ftrIdn) {
    if (!ftrCol) {
      wheres.push('FALSE');
    } else {
      const fq = ftrCol.replace(/"/g, '""');
      wheres.push(
        `lower(trim(t."${fq}"::text)) = lower(trim('${esc(ftrIdn)}'))`
      );
    }
  }
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
    const parts: string[] = [
      ...buildCodeKeywordInClauses({
        fieldsTable,
        defineFields,
        keyword,
        esc,
        resolveCol: (fn) => resolveColumnCase(physicalCols, fn),
        skipField: (fnLc) => GEOM_COLS.has(fnLc),
      }),
      ...[...searchCols].map(
        (c) => `COALESCE(t."${c.replace(/"/g, '""')}"::text,'') ILIKE '${like}'`
      ),
    ];
    if (parts.length > 0) wheres.push(`(${parts.join(' OR ')})`);
  }

  if (areaWkts.length > 0) {
    if (!geomCol) {
      wheres.push('FALSE');
    } else {
      const gq = geomCol.replace(/"/g, '""');
      for (const wkt of areaWkts) {
        // 관망조회와 동일: ST_Within — 경계만 맞닿은 도형 제외
        wheres.push(
          `ST_Within(t."${gq}", ST_Transform(ST_GeomFromText('${esc(wkt)}', 5181), ST_SRID(t."${gq}")))`
        );
      }
    }
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

  const orderParts: string[] = [];
  const seenSortCols = new Set<string>();
  for (const s of rawSorts) {
    const field = String(s?.field ?? '').trim();
    if (!field || GEOM_COLS.has(field.toLowerCase())) continue;
    const col = resolveColumnCase(physicalCols, field);
    if (!col || seenSortCols.has(col.toLowerCase())) continue;
    seenSortCols.add(col.toLowerCase());
    const dir = String(s?.dir ?? '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    orderParts.push(`t."${col.replace(/"/g, '""')}" ${dir} NULLS LAST`);
    if (orderParts.length >= 5) break;
  }
  if (ogcCol && !seenSortCols.has(ogcCol.toLowerCase())) {
    orderParts.push(`t."${ogcCol.replace(/"/g, '""')}" ASC`);
  }
  const orderSql = orderParts.length > 0 ? orderParts.join(', ') : '1';

  const dataRes = await db.execute(
    sql.raw(
      `SELECT
         ${ogcCol ? `t."${ogcCol.replace(/"/g, '""')}"` : 'NULL'} AS "ogcFid",
         (${nameExpr}) AS name,
         ${geomSel} AS geom,
         ${recordSel} AS record
       FROM "${safeSchema}"."${safeTable}" t
       WHERE ${whereSql}
       ORDER BY ${orderSql}
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
