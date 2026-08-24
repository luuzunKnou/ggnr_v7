/**
 * 울진 하천 공사대장 — layer.cons_data_as / cons_data_solo_as
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { tryFormatToYmd } from '@/lib/formatDateYmd';
import {
  DEFAULT_CONS_DATA_AS_CONS_CODE,
  incrementSuffixCode,
} from '@/lib/incrementSuffixCode';
import {
  assertSafeFileDataSegment,
  fileDataRelativeDir,
} from '@/lib/serviceFileData';
import {
  ensureServiceFileDataFolders,
  listServiceFileDataFiles,
  listServiceFileDataFolders,
} from './fileManagerService';
import {
  deleteTableRowByKey,
  insertTableRow,
  updateTableRowByKey,
} from './layerRowService';

const MAIN_TABLE = 'cons_data_as';
const SOLO_TABLE = 'cons_data_solo_as';
const DEFAULT_SCHEMA = 'layer';
const KEY_FIELD = 'cons_code';
const CHILD_PARENT_FIELD = 'cons_code';
/** solo 주소 대용 컬럼 (parcel_address/usage_loc 없음) */
const SOLO_ADDRESS_FIELD = 'remark';
const FILE_LAYER = 'cons_data_as';
/** 키 루트에 파일이 있을 때 UI 탭명 */
export const CONS_DATA_AS_ROOT_FOLDER_LABEL = '기타';
/** 신규 등록 시 자동으로 만들어 둘 첨부 하위폴더 */
const CONS_DATA_AS_DEFAULT_ATTACH_FOLDERS = ['도면', '조서'] as const;

const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);
const SEARCH_SCHEMAS = ['layer', 'public'] as const;
/** 대상 하천 검색용 — 하천구역·소하천구역이 없으면 하천기본계획(river_plan_as)도 사용 */
const RIVER_NAME_SOURCE_TABLES = ['river_d_as', 'river_s_as', 'river_plan_as'] as const;

const ATTR_FIELDS = [
  'cons_name',
  'cons_locat',
  'cons_volum',
  'river_name',
  'cont_date',
  'start_date',
  'done_date',
  'sdone_date',
  'busin_name',
  'ceo_name',
  'busin_phon',
  'busin_addr',
  'direct_pos',
  'direct_nam',
  'amount_pre',
  'amount_var',
  'amount_cha',
  'amount_aft',
  'reason',
  'descript',
] as const;

export type ConsDataAsGeom = {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
};

export type ConsDataAsParcelItem = {
  address: string;
  riverName?: string;
  remark?: string;
  pnu?: string;
  extent3857: [number, number, number, number] | null;
  /** GeoJSON geometry (EPSG:3857) — 지도에서 그린 필지(소구간) 도형 */
  geometry3857?: Record<string, unknown> | null;
};

export type ConsDataAsRow = {
  consCode: string;
  consName: string;
  consLocat: string;
  consVolum: string;
  riverName: string;
  contDate: string;
  startDate: string;
  doneDate: string;
  sdoneDate: string;
  businName: string;
  ceoName: string;
  businPhon: string;
  businAddr: string;
  directPos: string;
  directNam: string;
  amountPre: string;
  amountVar: string;
  amountCha: string;
  amountAft: string;
  reason: string;
  descript: string;
  geom: ConsDataAsGeom | null;
  parcels: ConsDataAsParcelItem[];
};

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function cell(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const ymd = tryFormatToYmd(s);
  return ymd ?? s;
}

const tableMetaCache = new Map<string, { tableName: string; schema: string } | null>();
const tableColumnsCache = new Map<string, string[]>();

async function resolveTableWithSchema(
  wantedLower: string
): Promise<{ tableName: string; schema: string } | null> {
  const cacheKey = wantedLower.toLowerCase();
  if (tableMetaCache.has(cacheKey)) {
    return tableMetaCache.get(cacheKey) ?? null;
  }
  const schemasIn = SEARCH_SCHEMAS.map((s) => `'${esc(s)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN (${schemasIn}) AND lower(table_name) = '${esc(wantedLower)}'
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) {
    tableMetaCache.set(cacheKey, null);
    return null;
  }
  const meta = {
    tableName: String(row.table_name).trim(),
    schema: String(row.table_schema ?? DEFAULT_SCHEMA).trim(),
  };
  tableMetaCache.set(cacheKey, meta);
  return meta;
}

async function getTableColumns(schema: string, table: string): Promise<string[]> {
  const cacheKey = `${schema}.${table}`.toLowerCase();
  const hit = tableColumnsCache.get(cacheKey);
  if (hit) return hit;
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
       ORDER BY ordinal_position`
    )
  );
  const cols = (res.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
  tableColumnsCache.set(cacheKey, cols);
  return cols;
}

function findColumn(columns: string[], name: string): string | null {
  const lower = name.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower) ?? null;
}

function normalizeGeom(raw: unknown): ConsDataAsGeom | null {
  if (raw == null) return null;
  let obj: { type?: string; coordinates?: unknown } | null = null;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as { type?: string; coordinates?: unknown };
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    obj = raw as { type?: string; coordinates?: unknown };
  }
  if (!obj?.type || !Array.isArray(obj.coordinates)) return null;
  if (obj.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: obj.coordinates as ConsDataAsGeom['coordinates'] };
  }
  if (obj.type === 'Polygon') {
    return {
      type: 'MultiPolygon',
      coordinates: [obj.coordinates as [number, number][][]],
    };
  }
  return null;
}

function emptyRow(consCode: string): ConsDataAsRow {
  return {
    consCode,
    consName: '',
    consLocat: '',
    consVolum: '',
    riverName: '',
    contDate: '',
    startDate: '',
    doneDate: '',
    sdoneDate: '',
    businName: '',
    ceoName: '',
    businPhon: '',
    businAddr: '',
    directPos: '',
    directNam: '',
    amountPre: '',
    amountVar: '',
    amountCha: '',
    amountAft: '',
    reason: '',
    descript: '',
    geom: null,
    parcels: [],
  };
}

function mapDbRow(row: Record<string, unknown>, consCode: string): Omit<ConsDataAsRow, 'parcels'> {
  return {
    consCode,
    consName: cell(row.cons_name),
    consLocat: cell(row.cons_locat),
    consVolum: cell(row.cons_volum),
    riverName: cell(row.river_name),
    contDate: cell(row.cont_date),
    startDate: cell(row.start_date),
    doneDate: cell(row.done_date),
    sdoneDate: cell(row.sdone_date),
    businName: cell(row.busin_name),
    ceoName: cell(row.ceo_name),
    businPhon: cell(row.busin_phon),
    businAddr: cell(row.busin_addr),
    directPos: cell(row.direct_pos),
    directNam: cell(row.direct_nam),
    amountPre: cell(row.amount_pre),
    amountVar: cell(row.amount_var),
    amountCha: cell(row.amount_cha),
    amountAft: cell(row.amount_aft),
    reason: cell(row.reason),
    descript: cell(row.descript),
    geom: normalizeGeom(row.geom_geojson ?? row.geom),
  };
}

/** 목록 (키·이름·위치·하천·도형) */
export async function listRows(params?: {
  keyword?: string;
}): Promise<{ rows: ConsDataAsRow[]; error?: string }> {
  try {
    const keyword = String(params?.keyword ?? '').trim();
    const meta = await resolveTableWithSchema(MAIN_TABLE);
    if (!meta) return { rows: [], error: `${MAIN_TABLE} 테이블이 없습니다.` };

    const { tableName, schema } = meta;
    const columns = await getTableColumns(schema, tableName);
    const keyCol = findColumn(columns, KEY_FIELD);
    if (!keyCol) return { rows: [], error: `${KEY_FIELD} 컬럼이 없습니다.` };

    const geomCol = findColumn(columns, 'geom');
    const safe = tableName.replace(/"/g, '""');
    const safeSchema = schema.replace(/"/g, '""');
    const t = 't';
    const q = (name: string) => `${t}.${quoteIdent(name)}`;

    const attrSelect = ATTR_FIELDS.map((f) => {
      const col = findColumn(columns, f);
      return col
        ? `COALESCE(${q(col)}::text, '') AS ${quoteIdent(f)}`
        : `''::text AS ${quoteIdent(f)}`;
    }).join(',\n      ');

    const geomSelect = geomCol
      ? `ST_AsGeoJSON(ST_Transform(${q(geomCol)}, 4326))::json AS geom_geojson`
      : `NULL::json AS geom_geojson`;

    const searchCols = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
    const kwClause = keyword
      ? ` AND (${searchCols.map((c) => `COALESCE(${q(c)}::text, '') ILIKE '%${esc(keyword)}%'`).join(' OR ')})`
      : '';

    const sqlText = `
    SELECT
      COALESCE(${q(keyCol)}::text, '') AS cons_code,
      ${attrSelect},
      ${geomSelect}
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE COALESCE(${q(keyCol)}::text, '') <> '' ${kwClause}
    ORDER BY ${q(keyCol)}::text DESC
    LIMIT 5000`;

    const res = await db.execute(sql.raw(sqlText));
    const rows: ConsDataAsRow[] = (res.rows ?? [])
      .map((r) => {
        const row = r as Record<string, unknown>;
        const consCode = cell(row.cons_code);
        if (!consCode) return null;
        return { ...mapDbRow(row, consCode), parcels: [] as ConsDataAsParcelItem[] };
      })
      .filter((x): x is ConsDataAsRow => x != null);
    return { rows };
  } catch (e: unknown) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 1건 — includeParcelGeometry false면 필지 속성·extent만 (목록 클릭 성능) */
export async function getDetailByConsCode(params: {
  consCode?: string;
  /** 기본 true — 상세 편집용. false면 필지 GeoJSON 생략 */
  includeParcelGeometry?: boolean;
}): Promise<{ row: ConsDataAsRow | null; error?: string }> {
  const consCode = String(params?.consCode ?? '').trim();
  if (!consCode) return { row: null, error: '공사코드가 필요합니다.' };
  const includeParcelGeometry = params?.includeParcelGeometry !== false;

  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) return { row: null, error: `${MAIN_TABLE} 테이블이 없습니다.` };

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findColumn(columns, KEY_FIELD);
  if (!keyCol) return { row: null, error: `${KEY_FIELD} 컬럼이 없습니다.` };

  const geomCol = findColumn(columns, 'geom');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');

  const attrSelect = ATTR_FIELDS.map((f) => {
    const col = findColumn(columns, f);
    return col
      ? `COALESCE(${quoteIdent(col)}::text, '') AS ${quoteIdent(f)}`
      : `''::text AS ${quoteIdent(f)}`;
  }).join(',\n      ');

  const geomSelect = geomCol
    ? `ST_AsGeoJSON(ST_Transform(${quoteIdent(geomCol)}, 4326))::json AS geom_geojson`
    : `NULL::json AS geom_geojson`;

  const sqlText = `
    SELECT
      COALESCE(${quoteIdent(keyCol)}::text, '') AS cons_code,
      ${attrSelect},
      ${geomSelect}
    FROM "${safeSchema}"."${safe}"
    WHERE ${quoteIdent(keyCol)}::text = '${esc(consCode)}'
    LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { row: null, error: '해당 건을 찾을 수 없습니다.' };
    const parcels = await listParcelsByConsCode({
      consCode,
      includeGeometry: includeParcelGeometry,
    });
    return {
      row: {
        ...mapDbRow(row, consCode),
        parcels: parcels.items,
      },
      ...(parcels.error ? { error: parcels.error } : {}),
    };
  } catch (e: unknown) {
    return { row: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 필지(solo) 목록 */
export async function listParcelsByConsCode(params: {
  consCode?: string;
  /** 기본 false — GeoJSON 생략. 상세 편집 시에만 true */
  includeGeometry?: boolean;
}): Promise<{ items: ConsDataAsParcelItem[]; error?: string }> {
  const consCode = String(params?.consCode ?? '').trim();
  if (!consCode) return { items: [] };
  const includeGeometry = params?.includeGeometry === true;

  const meta = await resolveTableWithSchema(SOLO_TABLE);
  if (!meta) return { items: [] };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const parentCol = findColumn(cols, CHILD_PARENT_FIELD);
  if (!parentCol) return { items: [] };

  const remarkCol = findColumn(cols, SOLO_ADDRESS_FIELD);
  const soloCodeCol = findColumn(cols, 'solo_code');
  const riverNameCol = findColumn(cols, 'river_name');
  const hasGeom = findColumn(cols, 'geom');
  const hasOgcFid = findColumn(cols, 'ogc_fid');
  const hasId = findColumn(cols, 'id');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const orderExpr = hasOgcFid
    ? quoteIdent('ogc_fid')
    : hasId
      ? quoteIdent('id')
      : quoteIdent(parentCol);

  const remarkExpr = remarkCol
    ? `NULLIF(TRIM(COALESCE(r.${quoteIdent(remarkCol)}::text, '')), '')`
    : `NULL::text`;
  const soloExpr = soloCodeCol
    ? `NULLIF(TRIM(COALESCE(r.${quoteIdent(soloCodeCol)}::text, '')), '')`
    : `NULL::text`;
  const riverExpr = riverNameCol
    ? `NULLIF(TRIM(COALESCE(r.${quoteIdent(riverNameCol)}::text, '')), '')`
    : `NULL::text`;

  const extentSelect = hasGeom
    ? `,
      ST_XMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmin,
      ST_YMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymin,
      ST_XMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmax,
      ST_YMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymax,
      (r.${quoteIdent('geom')} IS NOT NULL) AS has_geom
      ${
        includeGeometry
          ? `, ST_AsGeoJSON(ST_Transform(r.${quoteIdent('geom')}, 3857))::text AS geom3857`
          : `, NULL::text AS geom3857`
      }`
    : `,NULL::float8 AS xmin,NULL::float8 AS ymin,NULL::float8 AS xmax,NULL::float8 AS ymax,false AS has_geom,NULL::text AS geom3857`;

  const sqlText = `
    SELECT
      COALESCE(${remarkExpr}, ${soloExpr}, ${riverExpr}, '') AS addr,
      COALESCE(${riverExpr}, '') AS river_name,
      COALESCE(${remarkExpr}, '') AS remark
      ${extentSelect}
    FROM "${safeSchema}"."${safe}" r
    WHERE r.${quoteIdent(parentCol)}::text = '${esc(consCode)}'
    ORDER BY r.${orderExpr}`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const items = (res.rows ?? [])
      .map((r) => {
        const row = r as Record<string, unknown>;
        const riverName = String(row.river_name ?? '').trim();
        const remark = String(row.remark ?? '').trim();
        const address = String(row.addr ?? '').trim() || riverName || remark;
        const xmin = Number(row.xmin);
        const ymin = Number(row.ymin);
        const xmax = Number(row.xmax);
        const ymax = Number(row.ymax);
        const extent3857: [number, number, number, number] | null = [
          xmin,
          ymin,
          xmax,
          ymax,
        ].every((v) => Number.isFinite(v))
          ? [xmin, ymin, xmax, ymax]
          : null;
        let geometry3857: Record<string, unknown> | null = null;
        const geom3857Raw = row.geom3857;
        if (includeGeometry && typeof geom3857Raw === 'string' && geom3857Raw.trim()) {
          try {
            geometry3857 = JSON.parse(geom3857Raw) as Record<string, unknown>;
          } catch {
            geometry3857 = null;
          }
        }
        return {
          address,
          riverName,
          remark,
          extent3857,
          ...(geometry3857 ? { geometry3857 } : {}),
        };
      })
      .filter(
        (x) =>
          x.address ||
          x.riverName ||
          x.remark ||
          x.geometry3857 ||
          x.extent3857
      );
    return { items };
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 지도 이동용 extent — 단일 공사 */
export async function getExtent3857ByConsCode(params: {
  consCode?: string;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const keyRaw = String(params?.consCode ?? '').trim();
  if (!keyRaw) return { extent3857: null, error: '공사코드가 필요합니다.' };

  const geomSelects: string[] = [];
  for (const table of [MAIN_TABLE, SOLO_TABLE]) {
    const meta = await resolveTableWithSchema(table);
    if (!meta) continue;
    const cols = await getTableColumns(meta.schema, meta.tableName);
    const keyCol =
      table === MAIN_TABLE
        ? findColumn(cols, KEY_FIELD)
        : findColumn(cols, CHILD_PARENT_FIELD);
    const geomCol = findColumn(cols, 'geom');
    if (!keyCol || !geomCol) continue;
    const safe = meta.tableName.replace(/"/g, '""');
    const safeSchema = meta.schema.replace(/"/g, '""');
    geomSelects.push(
      `SELECT ST_Transform(t.${quoteIdent(geomCol)}, 3857) AS g
       FROM "${safeSchema}"."${safe}" t
       WHERE t.${quoteIdent(keyCol)}::text = '${esc(keyRaw)}' AND t.${quoteIdent(geomCol)} IS NOT NULL`
    );
  }

  if (geomSelects.length === 0) {
    return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
  }

  const sqlText = `
    SELECT ST_XMin(ext)::float8 AS xmin, ST_YMin(ext)::float8 AS ymin,
           ST_XMax(ext)::float8 AS xmax, ST_YMax(ext)::float8 AS ymax
    FROM (
      SELECT ST_Extent(g)::box2d AS ext
      FROM (${geomSelects.join(' UNION ALL ')}) u
      WHERE g IS NOT NULL
    ) s
    WHERE ext IS NOT NULL`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as {
      xmin?: unknown;
      ymin?: unknown;
      xmax?: unknown;
      ymax?: unknown;
    } | undefined;
    const coords = [Number(row?.xmin), Number(row?.ymin), Number(row?.xmax), Number(row?.ymax)];
    if (!coords.every((v) => Number.isFinite(v))) {
      return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
    }
    return { extent3857: coords as [number, number, number, number] };
  } catch (e: unknown) {
    return { extent3857: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 메뉴 진입 시 — 공사대장 레이어 전체 extent */
export async function getLayerExtent3857(): Promise<{
  extent3857: [number, number, number, number] | null;
  error?: string;
}> {
  try {
    const geomSelects: string[] = [];
    for (const table of [MAIN_TABLE, SOLO_TABLE]) {
      const meta = await resolveTableWithSchema(table);
      if (!meta) continue;
      const cols = await getTableColumns(meta.schema, meta.tableName);
      const geomCol = findColumn(cols, 'geom');
      if (!geomCol) continue;
      const safe = meta.tableName.replace(/"/g, '""');
      const safeSchema = meta.schema.replace(/"/g, '""');
      geomSelects.push(
        `SELECT ST_Transform(t.${quoteIdent(geomCol)}, 3857) AS g
         FROM "${safeSchema}"."${safe}" t
         WHERE t.${quoteIdent(geomCol)} IS NOT NULL`
      );
    }
    if (geomSelects.length === 0) {
      return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
    }
    const sqlText = `
      SELECT ST_XMin(ext)::float8 AS xmin, ST_YMin(ext)::float8 AS ymin,
             ST_XMax(ext)::float8 AS xmax, ST_YMax(ext)::float8 AS ymax
      FROM (
        SELECT ST_Extent(g)::box2d AS ext
        FROM (${geomSelects.join(' UNION ALL ')}) u
        WHERE g IS NOT NULL
      ) s
      WHERE ext IS NOT NULL`;
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as {
      xmin?: unknown;
      ymin?: unknown;
      xmax?: unknown;
      ymax?: unknown;
    } | undefined;
    const coords = [Number(row?.xmin), Number(row?.ymin), Number(row?.xmax), Number(row?.ymax)];
    if (!coords.every((v) => Number.isFinite(v))) {
      return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
    }
    return { extent3857: coords as [number, number, number, number] };
  } catch (e: unknown) {
    return { extent3857: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 신규 공사코드 */
export async function getNextConsCode(): Promise<{ consCode: string; error?: string }> {
  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) {
    return { consCode: DEFAULT_CONS_DATA_AS_CONS_CODE, error: `${MAIN_TABLE} 테이블이 없습니다.` };
  }

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findColumn(columns, KEY_FIELD);
  if (!keyCol) {
    return { consCode: DEFAULT_CONS_DATA_AS_CONS_CODE, error: `${KEY_FIELD} 컬럼이 없습니다.` };
  }

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const sqlText = `
    SELECT ${quoteIdent(keyCol)}::text AS code
    FROM "${safeSchema}"."${safe}"
    WHERE COALESCE(${quoteIdent(keyCol)}::text, '') <> ''
    ORDER BY
      (regexp_match(${quoteIdent(keyCol)}::text, '([0-9]+)$'))[1]::bigint DESC NULLS LAST,
      ${quoteIdent(keyCol)}::text DESC
    LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const last = String((res.rows?.[0] as { code?: string } | undefined)?.code ?? '').trim();
    if (!last) return { consCode: DEFAULT_CONS_DATA_AS_CONS_CODE };
    return { consCode: incrementSuffixCode(last) };
  } catch (e: unknown) {
    return {
      consCode: DEFAULT_CONS_DATA_AS_CONS_CODE,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 하천구역·소하천구역·하천기본계획 중 한 테이블에서 하천명 DISTINCT 조회 SQL (테이블·컬럼 없으면 null) */
async function riverZoneNameSelectSql(table: string, keyword: string): Promise<string | null> {
  const meta = await resolveTableWithSchema(table);
  if (!meta) return null;
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const riverCol = findColumn(cols, 'river_name');
  if (!riverCol) return null;
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  const kw = keyword ? ` AND ${quoteIdent(riverCol)}::text ILIKE '%${esc(keyword)}%'` : '';
  return `SELECT DISTINCT TRIM(${quoteIdent(riverCol)}::text) AS river_name
    FROM "${safeSchema}"."${safe}"
    WHERE COALESCE(TRIM(${quoteIdent(riverCol)}::text), '') <> ''${kw}`;
}

/** 대상 하천 검색 — 하천구역·소하천구역 ∪ 하천기본계획의 하천명 목록 */
export async function listRiverNamesFromZones(params?: {
  keyword?: string;
}): Promise<{ rivers: string[]; error?: string }> {
  const keyword = String(params?.keyword ?? '').trim();
  const selects = (
    await Promise.all(RIVER_NAME_SOURCE_TABLES.map((t) => riverZoneNameSelectSql(t, keyword)))
  ).filter((s): s is string => Boolean(s));

  if (selects.length === 0) {
    return { rivers: [], error: '하천명 목록을 조회할 레이어를 찾을 수 없습니다.' };
  }

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT river_name
         FROM (${selects.join(' UNION ALL ')}) u
         ORDER BY river_name
         LIMIT 200`
      )
    );
    const rivers = (res.rows ?? [])
      .map((r) => String((r as { river_name?: unknown }).river_name ?? '').trim())
      .filter(Boolean);
    return { rivers };
  } catch (e: unknown) {
    return { rivers: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 필지(solo) 동기화 — 지적 주소검색 대신 하천명·비고 텍스트를 직접 입력받고,
 * 지도에서 그린 도형(geomWkt5181, 있으면)을 geom 컬럼에 함께 저장한다.
 */
async function syncSoloParcels(params: {
  consCode: string;
  parcels: Array<{
    address?: string;
    riverName?: string;
    remark?: string;
    geomWkt5181?: string | null;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  const consCode = String(params.consCode ?? '').trim();
  if (!consCode) return { success: false, error: '공사코드가 필요합니다.' };

  const items = (params.parcels ?? [])
    .map((it) => ({
      riverName: String(it?.riverName ?? '').trim(),
      // remark 미지정 시(구버전 address 기반 값) address 로 대체
      remark: String(it?.remark ?? it?.address ?? '').trim(),
      geomWkt5181:
        typeof it?.geomWkt5181 === 'string' && it.geomWkt5181.trim()
          ? it.geomWkt5181.trim()
          : null,
    }))
    .filter((it) => it.riverName || it.remark || it.geomWkt5181);

  const meta = await resolveTableWithSchema(SOLO_TABLE);
  if (!meta) return { success: false, error: `${SOLO_TABLE} 테이블이 없습니다.` };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const parentCol = findColumn(cols, CHILD_PARENT_FIELD);
  if (!parentCol) return { success: false, error: '자식 테이블에 부모키 컬럼이 없습니다.' };
  const remarkCol = findColumn(cols, SOLO_ADDRESS_FIELD);
  const riverNameCol = findColumn(cols, 'river_name');
  const geomCol = findColumn(cols, 'geom');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');

  try {
    await db.execute(
      sql.raw(
        `DELETE FROM "${safeSchema}"."${safe}" WHERE ${quoteIdent(parentCol)}::text = '${esc(consCode)}'`
      )
    );

    for (const item of items) {
      const insertCols = [quoteIdent(parentCol)];
      const insertVals = [`'${esc(consCode)}'`];
      if (remarkCol) {
        insertCols.push(quoteIdent(remarkCol));
        insertVals.push(`'${esc(item.remark)}'`);
      }
      if (riverNameCol) {
        insertCols.push(quoteIdent(riverNameCol));
        insertVals.push(`'${esc(item.riverName)}'`);
      }
      if (geomCol && item.geomWkt5181) {
        insertCols.push(quoteIdent(geomCol));
        // 필지 도형은 폴리곤 1개씩 그리므로 컬럼 타입(MULTIPOLYGON)에 맞춰 ST_Multi로 감싼다
        insertVals.push(
          `ST_Multi(ST_SetSRID(ST_GeomFromText('${esc(item.geomWkt5181)}'), 5181))`
        );
      }
      await db.execute(
        sql.raw(
          `INSERT INTO "${safeSchema}"."${safe}" (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`
        )
      );
    }

    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 공사구간 전체 도형(cons_data_as.geom) 재계산 — 필지(cons_data_solo_as) 도형들의 합집합.
 * 원본 데이터(shp 임포트)도 이 관계를 그대로 따르므로, 공사구간 전체 도형은 따로 그리지 않고
 * 필지별로 그린 도형을 합쳐 자동으로 채운다. 도형 있는 필지가 하나도 없으면 전체 도형도 비운다.
 */
async function recomputeConsMainGeomFromParcels(consCode: string): Promise<void> {
  try {
    const mainMeta = await resolveTableWithSchema(MAIN_TABLE);
    if (!mainMeta) return;
    const mainCols = await getTableColumns(mainMeta.schema, mainMeta.tableName);
    const mainGeomCol = findColumn(mainCols, 'geom');
    const mainKeyCol = findColumn(mainCols, KEY_FIELD);
    if (!mainGeomCol || !mainKeyCol) return;

    const soloMeta = await resolveTableWithSchema(SOLO_TABLE);
    if (!soloMeta) return;
    const soloCols = await getTableColumns(soloMeta.schema, soloMeta.tableName);
    const soloParentCol = findColumn(soloCols, CHILD_PARENT_FIELD);
    const soloGeomCol = findColumn(soloCols, 'geom');
    if (!soloParentCol || !soloGeomCol) return;

    const safeMainSchema = mainMeta.schema.replace(/"/g, '""');
    const safeMainTable = mainMeta.tableName.replace(/"/g, '""');
    const safeSoloSchema = soloMeta.schema.replace(/"/g, '""');
    const safeSoloTable = soloMeta.tableName.replace(/"/g, '""');

    await db.execute(
      sql.raw(
        `UPDATE "${safeMainSchema}"."${safeMainTable}" m
         SET ${quoteIdent(mainGeomCol)} = sub.union_geom
         FROM (
           SELECT ST_Multi(ST_Union(${quoteIdent(soloGeomCol)})) AS union_geom
           FROM "${safeSoloSchema}"."${safeSoloTable}"
           WHERE ${quoteIdent(soloParentCol)}::text = '${esc(consCode)}' AND ${quoteIdent(soloGeomCol)} IS NOT NULL
         ) sub
         WHERE m.${quoteIdent(mainKeyCol)}::text = '${esc(consCode)}'`
      )
    );
  } catch (e) {
    // 전체 도형 자동 반영 실패는 저장 자체를 막지 않음
    console.error('[consDataAsService] recomputeConsMainGeomFromParcels failed', e);
  }
}

/** 저장(신규·수정) + solo 동기화 */
export async function saveRow(params: {
  consCode?: string;
  isNew?: boolean;
  values?: Record<string, unknown>;
  parcels?: Array<{
    address?: string;
    riverName?: string;
    remark?: string;
    geomWkt5181?: string | null;
  }>;
}): Promise<{ success: boolean; consCode?: string; error?: string }> {
  const values = { ...(params.values ?? {}) };
  let consCode = String(params.consCode ?? values.cons_code ?? '').trim();
  const isNew = params.isNew === true || !consCode;

  if (isNew) {
    if (!consCode) {
      const next = await getNextConsCode();
      consCode = next.consCode;
      if (!consCode) return { success: false, error: next.error ?? '공사코드를 생성하지 못했습니다.' };
    }
    values.cons_code = consCode;
    const inserted = await insertTableRow({
      table: MAIN_TABLE,
      schema: DEFAULT_SCHEMA,
      keyField: KEY_FIELD,
      values,
      includeHiddenDetail: true,
    });
    if (!inserted.success) {
      return { success: false, error: inserted.error ?? '등록에 실패했습니다.' };
    }
    consCode = String(inserted.keyValue ?? consCode).trim();
    try {
      await ensureServiceFileDataFolders({
        layerName: FILE_LAYER,
        keyValue: consCode,
        folders: [...CONS_DATA_AS_DEFAULT_ATTACH_FOLDERS],
      });
    } catch {
      // 폴더 미리 생성 실패는 저장 자체를 막지 않음
    }
  } else {
    const updated = await updateTableRowByKey({
      table: MAIN_TABLE,
      schema: DEFAULT_SCHEMA,
      keyField: KEY_FIELD,
      keyValue: consCode,
      changes: values,
      includeHiddenDetail: true,
    });
    if (!updated.success) {
      return { success: false, error: updated.error ?? '수정에 실패했습니다.' };
    }
  }

  if (Array.isArray(params.parcels)) {
    const sync = await syncSoloParcels({ consCode, parcels: params.parcels });
    if (!sync.success) {
      return { success: false, consCode, error: sync.error ?? '필지 동기화에 실패했습니다.' };
    }
    await recomputeConsMainGeomFromParcels(consCode);
    if (sync.error) return { success: true, consCode, error: sync.error };
  }

  return { success: true, consCode };
}

/** 삭제(본문 + solo) */
export async function deleteRow(params: {
  consCode?: string;
}): Promise<{ success: boolean; error?: string }> {
  const consCode = String(params?.consCode ?? '').trim();
  if (!consCode) return { success: false, error: '공사코드가 필요합니다.' };
  return deleteTableRowByKey({
    table: MAIN_TABLE,
    schema: DEFAULT_SCHEMA,
    keyField: KEY_FIELD,
    keyValue: consCode,
    childTableNames: [SOLO_TABLE],
    childParentField: CHILD_PARENT_FIELD,
  });
}

/** 첨부 하위폴더 탭 목록 (루트 파일 있으면 «기타») */
export async function listAttachmentFolders(params: {
  consCode?: string;
}): Promise<{ folders: string[]; error?: string }> {
  const consCode = String(params?.consCode ?? '').trim();
  if (!consCode) return { folders: [], error: '공사코드가 필요합니다.' };
  if (!assertSafeFileDataSegment(consCode)) {
    return { folders: [], error: '유효하지 않은 공사코드입니다.' };
  }

  try {
    const { folders, hasRootFiles } = await listServiceFileDataFolders({
      layerName: FILE_LAYER,
      keyValue: consCode,
    });
    const out = [...folders];
    if (hasRootFiles && !out.includes(CONS_DATA_AS_ROOT_FOLDER_LABEL)) {
      out.push(CONS_DATA_AS_ROOT_FOLDER_LABEL);
    }
    out.sort((a, b) => {
      if (a === CONS_DATA_AS_ROOT_FOLDER_LABEL) return 1;
      if (b === CONS_DATA_AS_ROOT_FOLDER_LABEL) return -1;
      return a.localeCompare(b, 'ko');
    });
    return { folders: out };
  } catch (e: unknown) {
    return { folders: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 첨부 파일 목록 (folder=«기타» → 루트) */
export async function listAttachmentFiles(params: {
  consCode?: string;
  folder?: string;
}): Promise<{ files: { name: string; size: number; modified?: string }[]; error?: string }> {
  const consCode = String(params?.consCode ?? '').trim();
  if (!consCode) return { files: [], error: '공사코드가 필요합니다.' };
  const folderRaw = String(params?.folder ?? '').trim();
  const subfolder =
    !folderRaw || folderRaw === CONS_DATA_AS_ROOT_FOLDER_LABEL ? undefined : folderRaw;

  if (subfolder && !assertSafeFileDataSegment(subfolder)) {
    return { files: [], error: '유효하지 않은 폴더명입니다.' };
  }

  try {
    const files = await listServiceFileDataFiles({
      layerName: FILE_LAYER,
      keyValue: consCode,
      subfolder,
    });
    return { files };
  } catch (e: unknown) {
    return { files: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 다운로드 상대경로 헬퍼 (UI용 문서화) */
export function attachmentRelativePath(consCode: string, folder: string, fileName: string): string | null {
  const sub =
    !folder || folder === CONS_DATA_AS_ROOT_FOLDER_LABEL ? undefined : folder;
  const dir = fileDataRelativeDir(FILE_LAYER, consCode, sub);
  if (!dir) return null;
  return `${dir}/${fileName}`;
}

export function emptyConsDataAsRow(consCode = ''): ConsDataAsRow {
  return emptyRow(consCode);
}
