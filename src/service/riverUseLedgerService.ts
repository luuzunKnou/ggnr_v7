/**
 * 하천점용
 * - ledger: river_use_ledger / _jijuk / _mulgunji (부과대장)
 * - usage: usage_data_as / usage_data_as_solo (울진 점용대장, 필지=cons_code 조인)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';

const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const SEARCH_SCHEMAS = ['public', 'layer'] as const;
const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);

const USAGE_FALLBACK_LABELS: Record<string, string> = {
  ogc_fid: 'ID',
  gkey_code: '관리키',
  cons_code: '공사코드',
  river_type: '하천구분',
  river_code: '하천코드',
  river_name: '하천명',
  usage_name: '점용명',
  usage_loc: '점용위치',
  emd_code: '읍면동코드',
  ri_code: '리코드',
  ledg_gbn: '대장구분',
  bobn: '본번',
  bubn: '부번',
  usage_purp: '점용목적',
  usage_pd: '점용기간',
  perm_area: '허가면적',
  temp_area: '일시사용면적',
  descript: '비고',
  mng_cde: '관리코드',
  perm_num: '허가번호',
  user_name: '점용자',
};

export type RiverUseLedgerVariant = 'ledger' | 'usage';

export type RiverUseLedgerConfig = {
  variant: RiverUseLedgerVariant;
  tableName: string;
  keyField: string;
  wmsLayerId: string;
  jijukLayerId: string | null;
  mulgunjiLayerId: string | null;
  /** layerRowEdit preset 키 */
  editPresetKey: 'riverUseLedger' | 'riverUsageData';
  /** 필지목록 편집(동기화) 가능 여부 — usage 는 cons_code 조인이라 읽기 전용 */
  parcelsEditable: boolean;
  /** 물건지 섹션 표시 */
  showMulgunji: boolean;
  listHeaders: { permitNo: string; spot: string; col3: string; col4: string };
};

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
      if (!field || !label) continue;
      if (label.toLowerCase() === field && USAGE_FALLBACK_LABELS[field]) {
        map[field] = USAGE_FALLBACK_LABELS[field];
      } else {
        map[field] = label;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function findCol(cols: string[], wanted: string): string | null {
  const lower = wanted.toLowerCase();
  return cols.find((c) => c.toLowerCase() === lower) ?? null;
}

async function resolveTableWithSchema(
  wantedLower: string,
  schemaPrefer: 'public' | 'layer' = 'public'
): Promise<{ tableName: string; schema: string } | null> {
  const schemasIn = SEARCH_SCHEMAS.map((s) => `'${esc(s)}'`).join(',');
  const prefer = schemaPrefer === 'layer' ? 'layer' : 'public';
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN (${schemasIn}) AND lower(table_name) = '${esc(wantedLower)}'
       ORDER BY CASE table_schema WHEN '${prefer}' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) return null;
  return {
    tableName: String(row.table_name).trim(),
    schema: String(row.table_schema ?? prefer).trim(),
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

async function getColumnCommentMap(schema: string, table: string): Promise<Record<string, string>> {
  const res = await db.execute(
    sql.raw(
      `SELECT a.attname AS column_name,
              pg_catalog.col_description(c.oid, a.attnum) AS comment
       FROM pg_attribute a
       JOIN pg_class c ON a.attrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = '${esc(schema)}' AND c.relname = '${esc(table)}'
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
  defineLabels: Record<string, string>,
  fallback?: Record<string, string>
): string {
  const key = field.toLowerCase();
  return dbComments[key] ?? defineLabels[key] ?? fallback?.[key] ?? field;
}

/** 테이블 존재로 모드 결정 — river_use_ledger 우선, 없으면 usage_data_as */
export async function resolveRiverUseLedgerVariant(): Promise<RiverUseLedgerVariant | null> {
  if (await resolveTableWithSchema('river_use_ledger')) return 'ledger';
  if (await resolveTableWithSchema('usage_data_as', 'layer')) return 'usage';
  return null;
}

export async function getRiverUseLedgerConfig(): Promise<RiverUseLedgerConfig | { error: string }> {
  const variant = await resolveRiverUseLedgerVariant();
  if (!variant) {
    return { error: '하천점용 테이블(river_use_ledger 또는 usage_data_as)이 없습니다.' };
  }
  if (variant === 'usage') {
    return {
      variant: 'usage',
      tableName: 'usage_data_as',
      keyField: 'ogc_fid',
      wmsLayerId: 'usage_data_as',
      jijukLayerId: 'usage_data_as_solo',
      mulgunjiLayerId: null,
      editPresetKey: 'riverUsageData',
      parcelsEditable: false,
      showMulgunji: false,
      listHeaders: {
        permitNo: '허가번호',
        spot: '점용위치',
        col3: '하천명',
        col4: '점용자',
      },
    };
  }
  return {
    variant: 'ledger',
    tableName: 'river_use_ledger',
    keyField: 'id',
    wmsLayerId: 'river_use_ledger',
    jijukLayerId: 'river_use_ledger_jijuk',
    mulgunjiLayerId: 'river_use_ledger_mulgunji',
    editPresetKey: 'riverUseLedger',
    parcelsEditable: true,
    showMulgunji: true,
    listHeaders: {
      permitNo: '부과번호',
      spot: '소재지',
      col3: '부과연도',
      col4: '부과일자',
    },
  };
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

/** 울진 필지목록 — usage_data_as_solo (부모 cons_code 조인) */
async function getUsageSoloParcelItems(params: {
  consCode: string;
}): Promise<{
  items: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const consCode = String(params.consCode ?? '').trim();
  if (!consCode) return { items: [] };

  const meta = await resolveTableWithSchema('usage_data_as_solo', 'layer');
  if (!meta) return { items: [] };
  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  if (!findCol(cols, 'cons_code')) return { items: [] };

  const addrCol = findCol(cols, 'usage_loc') ?? findCol(cols, 'parcel_address');
  const hasGeom = Boolean(findCol(cols, 'geom'));
  const orderCol = findCol(cols, 'ogc_fid') ?? findCol(cols, 'id') ?? findCol(cols, 'cons_code')!;
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');

  const addrSelect = addrCol
    ? `COALESCE(r.${quoteIdent(addrCol)}::text, '')`
    : `''::text`;
  const extentSelect = hasGeom
    ? `,
      ST_XMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmin,
      ST_YMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymin,
      ST_XMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmax,
      ST_YMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymax`
    : `,NULL::float8 AS xmin,NULL::float8 AS ymin,NULL::float8 AS xmax,NULL::float8 AS ymax`;

  const sqlText = `
    SELECT ${addrSelect} AS addr ${extentSelect}
    FROM "${safeSchema}"."${safe}" r
    WHERE COALESCE(r.${quoteIdent('cons_code')}::text, '') = '${esc(consCode)}'
    ORDER BY r.${quoteIdent(orderCol)}
    LIMIT 2000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const items = (res.rows ?? [])
      .map((r) => {
        const row = r as { addr?: unknown; xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown };
        const address = formatAddressStripSidoSigungu(String(row.addr ?? '').trim()) || '(위치 없음)';
        const xmin = Number(row.xmin);
        const ymin = Number(row.ymin);
        const xmax = Number(row.xmax);
        const ymax = Number(row.ymax);
        const extent3857: [number, number, number, number] | null =
          [xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v)) ? [xmin, ymin, xmax, ymax] : null;
        if (address === '(위치 없음)' && !extent3857) return null;
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
  permitNo: string;
  spot: string;
  /** ledger: 부과연도 / usage: 하천명 */
  col3: string;
  /** ledger: 부과일자 / usage: 점용자 */
  col4: string;
  /** 하위 호환 */
  year: string;
  date: string;
};

/**
 * 하천점용 목록
 */
export async function getRiverUseLedgerList(params?: {
  keyword?: string;
}): Promise<{
  rows: RiverUseLedgerListRow[];
  variant?: RiverUseLedgerVariant;
  error?: string;
}> {
  const keyword = String(params?.keyword ?? '').trim();
  const variant = await resolveRiverUseLedgerVariant();
  if (!variant) {
    return { rows: [], error: '하천점용 테이블(river_use_ledger 또는 usage_data_as)이 없습니다.' };
  }

  if (variant === 'usage') {
    return getUsageList(keyword);
  }
  return getLedgerList(keyword);
}

async function getLedgerList(keyword: string): Promise<{
  rows: RiverUseLedgerListRow[];
  variant: RiverUseLedgerVariant;
  error?: string;
}> {
  const meta = await resolveTableWithSchema('river_use_ledger');
  if (!meta) {
    return { rows: [], variant: 'ledger', error: 'river_use_ledger 테이블이 없습니다.' };
  }
  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const colLower = new Set(columns.map((c) => c.toLowerCase()));
  const hasCol = (name: string) => colLower.has(name.toLowerCase());

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;

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

  const permitNoExpr = hasCol('value_005')
    ? `COALESCE(${q('value_005')}::text, '')`
    : hasCol('ledger_row_key')
      ? `COALESCE(${q('ledger_row_key')}::text, '')`
      : `COALESCE(${q('id')}::text, '')`;

  const yearExpr = hasCol('value_002') ? `COALESCE(${q('value_002')}::text, '')` : `''::text`;
  const dateExpr = hasCol('value_007') ? `COALESCE(${q('value_007')}::text, '')` : `''::text`;

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
      ${yearExpr} AS "col3",
      ${dateExpr} AS "col4"
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE 1=1 ${kwClause}
    ORDER BY ${q('id')}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const col3 = String(row.col3 ?? '').trim();
      const col4 = formatToYmdOrText(row.col4);
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        permitNo: String(row.permitNo ?? '').trim(),
        spot: formatAddressStripSidoSigungu(row.spot),
        col3,
        col4,
        year: col3,
        date: col4,
      };
    });
    return { rows, variant: 'ledger' };
  } catch (e: unknown) {
    return { rows: [], variant: 'ledger', error: e instanceof Error ? e.message : String(e) };
  }
}

async function getUsageList(keyword: string): Promise<{
  rows: RiverUseLedgerListRow[];
  variant: RiverUseLedgerVariant;
  error?: string;
}> {
  const meta = await resolveTableWithSchema('usage_data_as', 'layer');
  if (!meta) {
    return { rows: [], variant: 'usage', error: 'usage_data_as 테이블이 없습니다.' };
  }
  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findCol(columns, 'ogc_fid') ?? findCol(columns, 'id');
  if (!keyCol) {
    return { rows: [], variant: 'usage', error: 'usage_data_as 에 ogc_fid 컬럼이 없습니다.' };
  }

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;

  const permitCol = findCol(columns, 'perm_num');
  const spotCol = findCol(columns, 'usage_loc');
  const riverCol = findCol(columns, 'river_name');
  const userCol = findCol(columns, 'user_name');
  const consCol = findCol(columns, 'cons_code');

  // 첫 필지 주소: solo 우선, 없으면 본문 usage_loc
  let firstSoloExpr = spotCol ? `COALESCE(${q(spotCol)}::text, '')` : `''::text`;
  const soloMeta = await resolveTableWithSchema('usage_data_as_solo', 'layer');
  if (soloMeta && consCol) {
    const sCols = await getTableColumns(soloMeta.schema, soloMeta.tableName);
    const sAddr = findCol(sCols, 'usage_loc');
    if (findCol(sCols, 'cons_code') && sAddr) {
      const safeS = soloMeta.tableName.replace(/"/g, '""');
      const safeSSchema = soloMeta.schema.replace(/"/g, '""');
      const sOrder = findCol(sCols, 'ogc_fid') ?? sAddr;
      firstSoloExpr = `COALESCE((
        SELECT ss.${quoteIdent(sAddr)}::text
        FROM "${safeSSchema}"."${safeS}" ss
        WHERE COALESCE(ss.${quoteIdent('cons_code')}::text, '') = COALESCE(${q(consCol)}::text, '')
          AND COALESCE(ss.${quoteIdent(sAddr)}::text, '') <> ''
        ORDER BY ss.${quoteIdent(sOrder)}
        LIMIT 1
      ), ${spotCol ? `COALESCE(${q(spotCol)}::text, '')` : `''`})`;
    }
  }

  const permitExpr = permitCol ? `COALESCE(${q(permitCol)}::text, '')` : `''::text`;
  const riverExpr = riverCol ? `COALESCE(${q(riverCol)}::text, '')` : `''::text`;
  const userExpr = userCol ? `COALESCE(${q(userCol)}::text, '')` : `''::text`;

  const searchCols = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
  const kwClause = keyword
    ? ` AND (${searchCols
        .map((c) => `COALESCE(${q(c)}::text, '') ILIKE '%${esc(keyword)}%'`)
        .join(' OR ')})`
    : '';

  const sqlText = `
    SELECT
      COALESCE(${q(keyCol)}::text, '') AS "rowKey",
      ${permitExpr} AS "permitNo",
      ${firstSoloExpr} AS "spot",
      ${riverExpr} AS "col3",
      ${userExpr} AS "col4"
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE 1=1 ${kwClause}
    ORDER BY ${q(keyCol)}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const col3 = String(row.col3 ?? '').trim();
      const col4 = String(row.col4 ?? '').trim();
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        permitNo: String(row.permitNo ?? '').trim(),
        spot: formatAddressStripSidoSigungu(row.spot),
        col3,
        col4,
        year: col3,
        date: col4,
      };
    });
    return { rows, variant: 'usage' };
  } catch (e: unknown) {
    return { rows: [], variant: 'usage', error: e instanceof Error ? e.message : String(e) };
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

  const variant = await resolveRiverUseLedgerVariant();
  if (!variant) return { extent3857: null, error: '하천점용 테이블이 없습니다.' };

  if (variant === 'usage') {
    return getUsageExtent(idRaw);
  }
  return getLedgerExtent(idRaw);
}

async function getLedgerExtent(
  idRaw: string
): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
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
      } catch {
        /* fallback */
      }
    }
  }

  const meta = await resolveTableWithSchema('river_use_ledger');
  if (!meta) return { extent3857: null, error: 'river_use_ledger 테이블이 없습니다.' };
  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  if (!findCol(cols, 'geom')) return { extent3857: null, error: 'geom 컬럼이 없습니다.' };

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

async function getUsageExtent(
  idRaw: string
): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const meta = await resolveTableWithSchema('usage_data_as', 'layer');
  if (!meta) return { extent3857: null, error: 'usage_data_as 테이블이 없습니다.' };
  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const keyCol = findCol(cols, 'ogc_fid') ?? findCol(cols, 'id');
  if (!keyCol) return { extent3857: null, error: 'ogc_fid 컬럼이 없습니다.' };

  const consCol = findCol(cols, 'cons_code');
  const soloMeta = await resolveTableWithSchema('usage_data_as_solo', 'layer');
  if (soloMeta && consCol && findCol(await getTableColumns(soloMeta.schema, soloMeta.tableName), 'geom')) {
    const safeP = tableName.replace(/"/g, '""');
    const safePSchema = schema.replace(/"/g, '""');
    const safeS = soloMeta.tableName.replace(/"/g, '""');
    const safeSSchema = soloMeta.schema.replace(/"/g, '""');
    const sCols = await getTableColumns(soloMeta.schema, soloMeta.tableName);
    const sOrder = findCol(sCols, 'ogc_fid') ?? findCol(sCols, 'cons_code')!;
    const jSql = `
      SELECT
        ST_XMin(box)::float8 AS xmin, ST_YMin(box)::float8 AS ymin,
        ST_XMax(box)::float8 AS xmax, ST_YMax(box)::float8 AS ymax
      FROM (
        SELECT ST_Envelope(ST_Transform(ss.${quoteIdent('geom')}, 3857))::box2d AS box
        FROM "${safeSSchema}"."${safeS}" ss
        WHERE COALESCE(ss.${quoteIdent('cons_code')}::text, '') = (
          SELECT COALESCE(p.${quoteIdent(consCol)}::text, '')
          FROM "${safePSchema}"."${safeP}" p
          WHERE p.${quoteIdent(keyCol)} = ${idRaw}::bigint
          LIMIT 1
        )
          AND ss.${quoteIdent('geom')} IS NOT NULL
        ORDER BY ss.${quoteIdent(sOrder)}
        LIMIT 1
      ) s WHERE box IS NOT NULL`;
    try {
      const jRes = await db.execute(sql.raw(jSql));
      const jRow = jRes.rows?.[0] as { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown } | undefined;
      const vals = [Number(jRow?.xmin), Number(jRow?.ymin), Number(jRow?.xmax), Number(jRow?.ymax)];
      if (vals.every((v) => Number.isFinite(v))) {
        return { extent3857: vals as [number, number, number, number] };
      }
    } catch {
      /* fallback */
    }
  }

  if (!findCol(cols, 'geom')) return { extent3857: null, error: 'geom 컬럼이 없습니다.' };
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const sqlText = `
    SELECT ST_XMin(box)::float8 AS xmin, ST_YMin(box)::float8 AS ymin,
           ST_XMax(box)::float8 AS xmax, ST_YMax(box)::float8 AS ymax
    FROM (
      SELECT ST_Extent(ST_Transform(t.${quoteIdent('geom')}, 3857))::box2d AS box
      FROM "${safeSchema}"."${safe}" t
      WHERE t.${quoteIdent(keyCol)} = ${idRaw}::bigint AND t.${quoteIdent('geom')} IS NOT NULL
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
  variant?: RiverUseLedgerVariant;
  error?: string;
}> {
  const idRaw = String(params?.id ?? '').trim();
  if (!/^-?\d+$/.test(idRaw)) {
    return { attributes: [], parcelItems: [], mulgunjiItems: [], error: '유효하지 않은 id입니다.' };
  }

  const variant = await resolveRiverUseLedgerVariant();
  if (!variant) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      error: '하천점용 테이블이 없습니다.',
    };
  }

  if (variant === 'usage') {
    return getUsageDetail(idRaw);
  }
  return getLedgerDetail(idRaw);
}

async function getLedgerDetail(idRaw: string): Promise<{
  attributes: RiverUseLedgerDetailAttr[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  mulgunjiItems: { address: string; extent3857: [number, number, number, number] | null }[];
  variant: RiverUseLedgerVariant;
  error?: string;
}> {
  const meta = await resolveTableWithSchema('river_use_ledger');
  if (!meta) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      variant: 'ledger',
      error: 'river_use_ledger 테이블이 없습니다.',
    };
  }
  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const dataColumns = columns.filter(
    (c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()) && c.toLowerCase() !== 'parcel_address'
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
      return {
        attributes: [],
        parcelItems: [],
        mulgunjiItems: [],
        variant: 'ledger',
        error: '해당 건을 찾을 수 없습니다.',
      };
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
      variant: 'ledger',
      ...(parcelResult.error || mulgunjiResult.error
        ? { error: [parcelResult.error, mulgunjiResult.error].filter(Boolean).join('; ') }
        : {}),
    };
  } catch (e: unknown) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      variant: 'ledger',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function getUsageDetail(idRaw: string): Promise<{
  attributes: RiverUseLedgerDetailAttr[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  mulgunjiItems: { address: string; extent3857: [number, number, number, number] | null }[];
  variant: RiverUseLedgerVariant;
  error?: string;
}> {
  const meta = await resolveTableWithSchema('usage_data_as', 'layer');
  if (!meta) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      variant: 'usage',
      error: 'usage_data_as 테이블이 없습니다.',
    };
  }
  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findCol(columns, 'ogc_fid') ?? findCol(columns, 'id');
  if (!keyCol) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      variant: 'usage',
      error: 'ogc_fid 컬럼이 없습니다.',
    };
  }

  const dataColumns = columns.filter(
    (c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()) && c.toLowerCase() !== keyCol.toLowerCase()
  );
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;
  const selectList = [...dataColumns, keyCol]
    .filter((c, i, arr) => arr.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i)
    .map((c) => `${q(c)} AS ${quoteIdent(c)}`)
    .join(',\n      ');

  const sqlText = `
    SELECT ${selectList}
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE ${quoteIdent(keyCol)} = ${idRaw}::bigint
    LIMIT 1`;

  const defineLabelMap = loadFieldLabelMap('usage_data_as');
  const dbCommentMap = await getColumnCommentMap(schema, tableName);

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return {
        attributes: [],
        parcelItems: [],
        mulgunjiItems: [],
        variant: 'usage',
        error: '해당 건을 찾을 수 없습니다.',
      };
    }

    const attributes: RiverUseLedgerDetailAttr[] = dataColumns.map((field) => ({
      field,
      label: resolveColumnLabel(field, dbCommentMap, defineLabelMap, USAGE_FALLBACK_LABELS),
      value: String(row[field] ?? '').trim() || '—',
    }));

    const consCode = String(row.cons_code ?? row.CONS_CODE ?? '').trim();
    const parcelResult = await getUsageSoloParcelItems({ consCode });

    return {
      attributes,
      parcelItems: parcelResult.items,
      mulgunjiItems: [],
      variant: 'usage',
      ...(parcelResult.error ? { error: parcelResult.error } : {}),
    };
  } catch (e: unknown) {
    return {
      attributes: [],
      parcelItems: [],
      mulgunjiItems: [],
      variant: 'usage',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 물건지 목록 sync — ledger 모드만
 */
export async function syncRiverUseLedgerMulgunjiByParentId(params: {
  parentId: string;
  items: Array<{ address: string; x4326?: number; y4326?: number }>;
}): Promise<{ success: boolean; error?: string }> {
  const variant = await resolveRiverUseLedgerVariant();
  if (variant === 'usage') {
    return { success: false, error: '점용대장 모드에서는 물건지 동기화를 지원하지 않습니다.' };
  }

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
    } catch {
      /* use default */
    }
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
