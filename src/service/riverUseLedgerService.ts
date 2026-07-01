/**
 * 하천점용 — river_use_ledger / river_use_ledger_jijuk / river_use_ledger_mulgunji
 * 테이블은 public 스키마에 있다고 가정 (layer 스키마에도 있으면 자동 탐색)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';

const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

/** define layer fields JSON 에서 field → 한글명 매핑 로드 */
function loadFieldLabelMap(tableName: string): Record<string, string> {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const item of parsed as Record<string, unknown>[]) {
      const field = String(item.define_field_name ?? '').trim().toLowerCase();
      const label = String(item.define_field_kor_name ?? '').trim();
      if (field && label) map[field] = label;
    }
    return map;
  } catch {
    return {};
  }
}

const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);
const HIDDEN_DETAIL_FIELDS = new Set(['parcel_address']);
const SEARCH_SCHEMAS = ['public', 'layer'] as const;

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function resolveTableWithSchema(
  wantedLower: string
): Promise<{ tableName: string; schema: string } | null> {
  const schemasIn = SEARCH_SCHEMAS.map((s) => `'${esc(s)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN (${schemasIn}) AND lower(table_name) = '${esc(wantedLower)}'
       ORDER BY CASE table_schema WHEN 'public' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) return null;
  return {
    tableName: String(row.table_name).trim(),
    schema: String(row.table_schema ?? 'public').trim(),
  };
}

async function getTableColumns(schema: string, table: string): Promise<string[]> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
}

/** DB 컬럼 코멘트(pgAdmin Comment) → 한글 속성명 */
async function getColumnCommentMap(schema: string, table: string): Promise<Record<string, string>> {
  const safeSchema = esc(schema);
  const safeTable = esc(table);
  const res = await db.execute(
    sql.raw(
      `SELECT a.attname AS column_name,
              pg_catalog.col_description(c.oid, a.attnum) AS comment
       FROM pg_attribute a
       JOIN pg_class c ON a.attrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = '${safeSchema}' AND c.relname = '${safeTable}'
         AND a.attnum > 0 AND NOT a.attisdropped`
    )
  );
  const map: Record<string, string> = {};
  for (const r of res.rows ?? []) {
    const row = r as { column_name?: string; comment?: string | null };
    const col = String(row.column_name ?? '').trim().toLowerCase();
    const comment = String(row.comment ?? '').trim();
    if (col && comment) map[col] = comment;
  }
  return map;
}

function resolveColumnLabel(
  field: string,
  dbComments: Record<string, string>,
  defineLabels: Record<string, string>
): string {
  const key = field.toLowerCase();
  return dbComments[key] ?? defineLabels[key] ?? field;
}

async function getChildItems(params: {
  childTableName: string;
  parentId: string;
}): Promise<{
  items: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const meta = await resolveTableWithSchema(params.childTableName);
  if (!meta) return { items: [] };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const lower = new Set(cols.map((c) => c.toLowerCase()));
  if (!lower.has('parent_id') || !lower.has('parcel_address')) return { items: [] };

  const hasGeom = lower.has('geom');
  const hasId = lower.has('id');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const orderExpr = hasId ? quoteIdent('id') : quoteIdent('parcel_address');
  const extentSelect = hasGeom
    ? `,
      ST_XMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmin,
      ST_YMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymin,
      ST_XMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmax,
      ST_YMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymax`
    : `,NULL::float8 AS xmin,NULL::float8 AS ymin,NULL::float8 AS xmax,NULL::float8 AS ymax`;

  const sqlText = `
    SELECT COALESCE(r.${quoteIdent('parcel_address')}::text, '') AS addr ${extentSelect}
    FROM "${safeSchema}"."${safe}" r
    WHERE r.${quoteIdent('parent_id')} = ${esc(params.parentId)}::bigint
      AND COALESCE(r.${quoteIdent('parcel_address')}::text, '') <> ''
    ORDER BY r.${orderExpr}`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const items = (res.rows ?? [])
      .map((r) => {
        const row = r as { addr?: unknown; xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown };
        const address = formatAddressStripSidoSigungu(String(row.addr ?? '').trim());
        if (!address) return null;
        const xmin = Number(row.xmin);
        const ymin = Number(row.ymin);
        const xmax = Number(row.xmax);
        const ymax = Number(row.ymax);
        const extent3857: [number, number, number, number] | null =
          [xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v)) ? [xmin, ymin, xmax, ymax] : null;
        return { address, extent3857 };
      })
      .filter(
        (x): x is { address: string; extent3857: [number, number, number, number] | null } => x != null
      );
    return { items };
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type RiverUseLedgerDetailAttr = {
  field: string;
  label: string;
  value: string;
};

export type RiverUseLedgerListRow = {
  rowKey: string;
  /** 부과번호 등 허가 식별값 */
  permitNo: string;
  /** 첫 번째 필지 주소 (jijuk) */
  spot: string;
  /** 부과연도 */
  year: string;
  /** 부과일자 */
  date: string;
};

/**
 * 하천점용 목록 (river_use_ledger)
 */
export async function getRiverUseLedgerList(params?: {
  keyword?: string;
}): Promise<{
  rows: RiverUseLedgerListRow[];
  error?: string;
}> {
  const keyword = String(params?.keyword ?? '').trim();
  const meta = await resolveTableWithSchema('river_use_ledger');
  if (!meta) {
    return { rows: [], error: 'river_use_ledger 테이블이 없습니다.' };
  }
  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const colLower = new Set(columns.map((c) => c.toLowerCase()));
  const hasCol = (name: string) => colLower.has(name.toLowerCase());

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;

  // jijuk 첫 필지주소
  const jijukMeta = await resolveTableWithSchema('river_use_ledger_jijuk');
  let firstJijukExpr = `''::text`;
  if (jijukMeta) {
    const jCols = await getTableColumns(jijukMeta.schema, jijukMeta.tableName);
    const jLower = new Set(jCols.map((c) => c.toLowerCase()));
    if (jLower.has('parent_id') && jLower.has('parcel_address')) {
      const safeJ = jijukMeta.tableName.replace(/"/g, '""');
      const safeJSchema = jijukMeta.schema.replace(/"/g, '""');
      const jOrder = jLower.has('id') ? quoteIdent('id') : quoteIdent('parcel_address');
      firstJijukExpr = `COALESCE((
        SELECT jj.${quoteIdent('parcel_address')}::text
        FROM "${safeJSchema}"."${safeJ}" jj
        WHERE jj.${quoteIdent('parent_id')} = ${q('id')}::bigint
          AND COALESCE(jj.${quoteIdent('parcel_address')}::text, '') <> ''
        ORDER BY jj.${jOrder}
        LIMIT 1
      ), '')`;
    }
  }

  // 부과번호: value_005, ledger_row_key 순서로 시도
  const permitNoExpr = hasCol('value_005')
    ? `COALESCE(${q('value_005')}::text, '')`
    : hasCol('ledger_row_key')
    ? `COALESCE(${q('ledger_row_key')}::text, '')`
    : `COALESCE(${q('id')}::text, '')`;

  const yearExpr = hasCol('value_002') ? `COALESCE(${q('value_002')}::text, '')` : `''::text`;
  const dateExpr = hasCol('value_007') ? `COALESCE(${q('value_007')}::text, '')` : `''::text`;

  // 검색 대상 컬럼 수집
  const searchCols = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
  const kwClause = keyword
    ? ` AND (${searchCols
        .map((c) => `COALESCE(${q(c)}::text, '') ILIKE '%${esc(keyword)}%'`)
        .join(' OR ')})`
    : '';

  const sqlText = `
    SELECT
      COALESCE(${q('id')}::text, '') AS "rowKey",
      ${permitNoExpr} AS "permitNo",
      ${firstJijukExpr} AS "spot",
      ${yearExpr} AS "year",
      ${dateExpr} AS "date"
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE 1=1 ${kwClause}
    ORDER BY ${q('id')}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        permitNo: String(row.permitNo ?? '').trim(),
        spot: formatAddressStripSidoSigungu(row.spot),
        year: String(row.year ?? '').trim(),
        date: formatToYmdOrText(row.date),
      };
    });
    return { rows };
  } catch (e: unknown) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 하천점용 1건 도형 범위(EPSG:3857)
 */
export async function getRiverUseLedgerExtent3857ById(params: {
  id?: string;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const idRaw = String(params?.id ?? '').trim();
  if (!/^-?\d+$/.test(idRaw)) return { extent3857: null, error: '유효하지 않은 id입니다.' };

  // 1순위: jijuk 첫 필지 geom
  const jijukMeta = await resolveTableWithSchema('river_use_ledger_jijuk');
  if (jijukMeta) {
    const jCols = await getTableColumns(jijukMeta.schema, jijukMeta.tableName);
    const jLower = new Set(jCols.map((c) => c.toLowerCase()));
    if (jLower.has('parent_id') && jLower.has('geom')) {
      const safeJ = jijukMeta.tableName.replace(/"/g, '""');
      const safeJSchema = jijukMeta.schema.replace(/"/g, '""');
      const jOrder = jLower.has('id') ? quoteIdent('id') : quoteIdent('parent_id');
      const jSql = `
        SELECT
          ST_XMin(box)::float8 AS xmin, ST_YMin(box)::float8 AS ymin,
          ST_XMax(box)::float8 AS xmax, ST_YMax(box)::float8 AS ymax
        FROM (
          SELECT ST_Envelope(ST_Transform(jj.${quoteIdent('geom')}, 3857))::box2d AS box
          FROM "${safeJSchema}"."${safeJ}" jj
          WHERE jj.${quoteIdent('parent_id')} = ${idRaw}::bigint AND jj.${quoteIdent('geom')} IS NOT NULL
          ORDER BY jj.${jOrder} LIMIT 1
        ) s WHERE box IS NOT NULL`;
      try {
        const jRes = await db.execute(sql.raw(jSql));
        const jRow = jRes.rows?.[0] as { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown } | undefined;
        const [jxmin, jymin, jxmax, jymax] = [Number(jRow?.xmin), Number(jRow?.ymin), Number(jRow?.xmax), Number(jRow?.ymax)];
        if ([jxmin, jymin, jxmax, jymax].every((v) => Number.isFinite(v))) {
          return { extent3857: [jxmin, jymin, jxmax, jymax] };
        }
      } catch { /* fallback */ }
    }
  }

  // 2순위: 메인 테이블 geom
  const meta = await resolveTableWithSchema('river_use_ledger');
  if (!meta) return { extent3857: null, error: 'river_use_ledger 테이블이 없습니다.' };
  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const colLower = new Set(cols.map((c) => c.toLowerCase()));
  if (!colLower.has('geom')) return { extent3857: null, error: 'geom 컬럼이 없습니다.' };

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const sqlText = `
    SELECT ST_XMin(box)::float8 AS xmin, ST_YMin(box)::float8 AS ymin,
           ST_XMax(box)::float8 AS xmax, ST_YMax(box)::float8 AS ymax
    FROM (
      SELECT ST_Extent(ST_Transform(t.${quoteIdent('geom')}, 3857))::box2d AS box
      FROM "${safeSchema}"."${safe}" t
      WHERE t.${quoteIdent('id')} = ${idRaw}::bigint AND t.${quoteIdent('geom')} IS NOT NULL
    ) sub WHERE box IS NOT NULL`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown } | undefined;
    const [xmin, ymin, xmax, ymax] = [Number(row?.xmin), Number(row?.ymin), Number(row?.xmax), Number(row?.ymax)];
    if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) {
      return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
    }
    return { extent3857: [xmin, ymin, xmax, ymax] };
  } catch (e: unknown) {
    return { extent3857: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 하천점용 1건 상세 — 속성 + 필지목록 + 물건지목록
 */
export async function getRiverUseLedgerDetailById(params: {
  id?: string;
}): Promise<{
  attributes: RiverUseLedgerDetailAttr[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  mulgunjiItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const idRaw = String(params?.id ?? '').trim();
  if (!/^-?\d+$/.test(idRaw)) {
    return { attributes: [], parcelItems: [], mulgunjiItems: [], error: '유효하지 않은 id입니다.' };
  }

  const meta = await resolveTableWithSchema('river_use_ledger');
  if (!meta) {
    return { attributes: [], parcelItems: [], mulgunjiItems: [], error: 'river_use_ledger 테이블이 없습니다.' };
  }
  const { tableName, schema } = meta;

  const columns = await getTableColumns(schema, tableName);
  const dataColumns = columns.filter(
    (c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()) && !HIDDEN_DETAIL_FIELDS.has(c.toLowerCase())
  );
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;
  const selectList = dataColumns.map((c) => `${q(c)} AS ${quoteIdent(c)}`).join(',\n      ');

  const sqlText = `
    SELECT ${selectList}
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE ${quoteIdent('id')} = ${idRaw}::bigint
    LIMIT 1`;

  const defineLabelMap = loadFieldLabelMap('river_use_ledger');
  const dbCommentMap = await getColumnCommentMap(schema, tableName);

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { attributes: [], parcelItems: [], mulgunjiItems: [], error: '해당 건을 찾을 수 없습니다.' };
    }

    const attributes: RiverUseLedgerDetailAttr[] = dataColumns.map((field) => ({
      field,
      label: resolveColumnLabel(field, dbCommentMap, defineLabelMap),
      value: String(row[field] ?? '').trim() || '—',
    }));

    const [parcelResult, mulgunjiResult] = await Promise.all([
      getChildItems({ childTableName: 'river_use_ledger_jijuk', parentId: idRaw }),
      getChildItems({ childTableName: 'river_use_ledger_mulgunji', parentId: idRaw }),
    ]);

    return {
      attributes,
      parcelItems: parcelResult.items,
      mulgunjiItems: mulgunjiResult.items,
      ...(parcelResult.error || mulgunjiResult.error
        ? { error: [parcelResult.error, mulgunjiResult.error].filter(Boolean).join('; ') }
        : {}),
    };
  } catch (e: unknown) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 물건지 목록 sync — river_use_ledger_mulgunji 테이블에 주소 저장
 * items에 point4326 좌표가 있으면 POINT geometry도 함께 저장
 */
export async function syncRiverUseLedgerMulgunjiByParentId(params: {
  parentId: string;
  items: Array<{ address: string; x4326?: number; y4326?: number }>;
}): Promise<{ success: boolean; error?: string }> {
  const parentId = String(params?.parentId ?? '').trim();
  if (!parentId) return { success: false, error: 'parentId가 필요합니다.' };

  const meta = await resolveTableWithSchema('river_use_ledger_mulgunji');
  if (!meta) return { success: false, error: 'river_use_ledger_mulgunji 테이블이 없습니다.' };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const lower = new Set(cols.map((c) => c.toLowerCase()));
  if (!lower.has('parent_id') || !lower.has('parcel_address')) {
    return { success: false, error: 'river_use_ledger_mulgunji 에 parent_id·parcel_address 컬럼이 필요합니다.' };
  }

  const hasGeom = lower.has('geom');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const items = (params.items ?? []).filter((it) => String(it?.address ?? '').trim());

  // SRID 조회
  let geomSrid = 5181;
  if (hasGeom) {
    try {
      const sridRes = await db.execute(
        sql.raw(
          `SELECT srid FROM geometry_columns
           WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(tableName)}' AND f_geometry_column = 'geom'
           LIMIT 1`
        )
      );
      const sridRow = sridRes.rows?.[0] as { srid?: unknown } | undefined;
      const s = Number(sridRow?.srid);
      if (Number.isFinite(s) && s > 0) geomSrid = s;
    } catch { /* use default */ }
  }

  try {
    await db.execute(
      sql.raw(
        `DELETE FROM "${safeSchema}"."${safe}" WHERE ${quoteIdent('parent_id')}::text = '${esc(parentId)}'`
      )
    );

    for (const item of items) {
      const addr = String(item.address).trim();
      if (!addr) continue;
      const hasCoord =
        hasGeom &&
        typeof item.x4326 === 'number' &&
        typeof item.y4326 === 'number' &&
        Number.isFinite(item.x4326) &&
        Number.isFinite(item.y4326);

      const colArr = [quoteIdent('parent_id'), quoteIdent('parcel_address')];
      const valArr = [`'${esc(parentId)}'`, `'${esc(addr)}'`];
      if (hasCoord) {
        colArr.push(quoteIdent('geom'));
        const x = item.x4326 as number;
        const y = item.y4326 as number;
        valArr.push(`ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326), ${geomSrid})`);
      }
      await db.execute(
        sql.raw(
          `INSERT INTO "${safeSchema}"."${safe}" (${colArr.join(', ')}) VALUES (${valArr.join(', ')})`
        )
      );
    }

    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
