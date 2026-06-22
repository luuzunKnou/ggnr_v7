/**
 * 도로점용 — road_use_ledger (layer 스키마 없으면 public 스키마에서 자동 탐색)
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';

const ROAD_USE_LEDGER_COLUMN_COMMENTS: Record<string, string> = {
  id: 'id',
  geom: 'geom',
  parcel_address: '필지이름',
  use_no: '허가번호',
  use_permit_date: '허가일자',
  use_road_type: '도로종류',
  use_road_name: '노선명',
  use_addr: '점용장소',
  use_mgj: '물건지',
  use_why: '점용목적',
  use_lic_addr: '피허가자 주소',
  use_lic_tel: '피허가자 전화번호',
  use_lic_name: '피허가자명',
  use_area: '점용면적(m²)',
  use_start: '점용시작',
  use_end: '점용종료',
};

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** DB 실제 필드명 (스키마 정의와 일치) */
const COL = {
  id: 'id',
  parcelAddress: 'parcel_address',
  useNo: 'use_no',
  usePermitDate: 'use_permit_date',
  useRoadType: 'use_road_type',
  useRoadName: 'use_road_name',
  useAddr: 'use_addr',
  useMgj: 'use_mgj',
  useWhy: 'use_why',
  useLicAddr: 'use_lic_addr',
  useLicTel: 'use_lic_tel',
  useLicName: 'use_lic_name',
  useArea: 'use_area',
  useStart: 'use_start',
  useEnd: 'use_end',
} as const;

const REQUIRED_FOR_LIST = [
  COL.id,
  COL.useNo,
  COL.usePermitDate,
  COL.useAddr,
  COL.useArea,
  COL.useStart,
  COL.useEnd,
] as const;

const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);

/** 상세 패널 속성 순서 */
const DETAIL_ATTR_ORDER: readonly string[] = [
  COL.id,
  COL.useNo,
  COL.usePermitDate,
  COL.useRoadType,
  COL.useRoadName,
  COL.useAddr,
  COL.useMgj,
  COL.useWhy,
  COL.useLicAddr,
  COL.useLicTel,
  COL.useLicName,
  COL.useArea,
  COL.useStart,
  COL.useEnd,
];

const DATE_DETAIL_FIELDS: Set<string> = new Set([COL.usePermitDate, COL.useStart, COL.useEnd]);

function columnLabel(field: string): string {
  return ROAD_USE_LEDGER_COLUMN_COMMENTS[field] ?? field;
}

/**
 * road_use_ledger_jijuk 자식에서 parent_id=id 로 조인된 필지목록 조회
 * - 문자열 분해가 아니라 실제 자식 행만 반환
 */
async function getRoadUseLedgerParcelsByParentId(parentId: string): Promise<{
  parcels: string[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const jijukMeta = await resolveTableWithSchema('road_use_ledger_jijuk');
  const jijukTable = jijukMeta?.tableName ?? null;
  const jijukSchema = jijukMeta?.schema ?? 'layer';
  if (!jijukTable) {
    return { parcels: [], parcelItems: [], error: 'road_use_ledger_jijuk 테이블이 없습니다.' };
  }

  const jCols = await getTableColumns(jijukSchema, jijukTable);
  const jLower = new Set(jCols.map((c) => c.toLowerCase()));
  const hasParentId = jLower.has('parent_id');
  const hasParcelAddress = jLower.has(COL.parcelAddress.toLowerCase());
  if (!hasParentId || !hasParcelAddress) {
    return {
      parcels: [],
      parcelItems: [],
      error: 'road_use_ledger_jijuk 필수 컬럼(parent_id, parcel_address)이 없습니다.',
    };
  }

  const hasId = jLower.has('id');
  const hasGeom = jLower.has('geom');
  const safeJijuk = jijukTable.replace(/"/g, '""');
  const safeJijukSchema = jijukSchema.replace(/"/g, '""');
  const oq = (name: string) => quoteIdent(name);
  const orderExpr = hasId ? oq('id') : oq(COL.parcelAddress);
  const extentSelect = hasGeom
    ? `,
      ST_XMin(ST_Envelope(ST_Transform(jj.${oq('geom')}, 3857)))::float8 AS xmin,
      ST_YMin(ST_Envelope(ST_Transform(jj.${oq('geom')}, 3857)))::float8 AS ymin,
      ST_XMax(ST_Envelope(ST_Transform(jj.${oq('geom')}, 3857)))::float8 AS xmax,
      ST_YMax(ST_Envelope(ST_Transform(jj.${oq('geom')}, 3857)))::float8 AS ymax`
    : `,
      NULL::float8 AS xmin,
      NULL::float8 AS ymin,
      NULL::float8 AS xmax,
      NULL::float8 AS ymax`;
  const sqlText = `
    SELECT
      COALESCE(jj.${oq(COL.parcelAddress)}::text, '') AS addr
      ${extentSelect}
    FROM "${safeJijukSchema}"."${safeJijuk}" jj
    WHERE jj.${oq('parent_id')} = ${parentId}::bigint
      AND COALESCE(jj.${oq(COL.parcelAddress)}::text, '') <> ''
    ORDER BY jj.${orderExpr}`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const parcelItems = (res.rows ?? [])
      .map((r) => {
        const row = r as {
          addr?: unknown;
          xmin?: unknown;
          ymin?: unknown;
          xmax?: unknown;
          ymax?: unknown;
        };
        const address = formatAddressStripSidoSigungu(String(row.addr ?? '').trim());
        if (!address) return null;
        const xmin = Number(row.xmin);
        const ymin = Number(row.ymin);
        const xmax = Number(row.xmax);
        const ymax = Number(row.ymax);
        const extent3857: [number, number, number, number] | null =
          [xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))
            ? [xmin, ymin, xmax, ymax]
            : null;
        return { address, extent3857 };
      })
      .filter((x): x is { address: string; extent3857: [number, number, number, number] | null } => Boolean(x));
    const parcels = parcelItems.map((p) => p.address);
    return { parcels, parcelItems };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { parcels: [], parcelItems: [], error: msg };
  }
}

export type RoadUseLedgerDetailAttr = {
  field: string;
  label: string;
  value: string;
};

/**
 * 도로점용 1건 상세 — 속성 + 필지목록(road_use_ledger_jijuk 조인)
 */
export async function getRoadUseLedgerDetailById(params: {
  id?: string;
}): Promise<{
  attributes: RoadUseLedgerDetailAttr[];
  parcels: string[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const idRaw = String(params?.id ?? '').trim();
  if (!/^-?\d+$/.test(idRaw)) {
    return { attributes: [], parcels: [], parcelItems: [], error: '유효하지 않은 id입니다.' };
  }

  const tblMeta = await resolveTableWithSchema('road_use_ledger');
  if (!tblMeta) {
    return { attributes: [], parcels: [], parcelItems: [], error: 'road_use_ledger 테이블이 없습니다.' };
  }
  const { tableName, schema: tblSchema } = tblMeta;

  const columns = await getTableColumns(tblSchema, tableName);
  const colErr = validateColumns(columns);
  if (colErr) {
    return { attributes: [], parcels: [], parcelItems: [], error: colErr };
  }

  const colLower = new Set(columns.map((c) => c.toLowerCase()));
  if (!colLower.has(COL.id.toLowerCase())) {
    return { attributes: [], parcels: [], parcelItems: [], error: 'id 컬럼이 없습니다.' };
  }

  const dataColumns = columns.filter(
    (c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase())
  );
  const safeTbl = tableName.replace(/"/g, '""');
  const safeTblSchema = tblSchema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;
  const iq = quoteIdent(COL.id);
  const selectList = dataColumns.map((c) => `${q(c)} AS ${quoteIdent(c)}`).join(',\n      ');

  const sqlText = `
    SELECT
      ${selectList}
    FROM "${safeTblSchema}"."${safeTbl}" ${t}
    WHERE ${iq} = ${idRaw}::bigint
    LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { attributes: [], parcels: [], parcelItems: [], error: '해당 건을 찾을 수 없습니다.' };
    }

    const getVal = (field: string): unknown => {
      const k = Object.keys(row).find((rk) => rk.toLowerCase() === field.toLowerCase());
      return k != null ? row[k] : undefined;
    };

    const parcelResult = await getRoadUseLedgerParcelsByParentId(idRaw);
    const parcels = parcelResult.parcels;
    const parcelItems = parcelResult.parcelItems;
    const firstParcel = String(parcels[0] ?? '').trim();

    const attributes: RoadUseLedgerDetailAttr[] = [];
    for (const field of DETAIL_ATTR_ORDER) {
      if (!colLower.has(field.toLowerCase())) continue;
      const raw = getVal(field);
      const value = field === COL.useAddr
        ? formatAddressStripSidoSigungu(firstParcel || String(raw ?? '').trim()) || '—'
        : DATE_DETAIL_FIELDS.has(field)
        ? formatToYmdOrText(raw) || '—'
        : String(raw ?? '').trim() || '—';
      attributes.push({ field, label: columnLabel(field), value });
    }

    return {
      attributes,
      parcels,
      parcelItems,
      ...(parcelResult.error ? { error: parcelResult.error } : {}),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { attributes: [], parcels: [], parcelItems: [], error: msg };
  }
}

/** layer 스키마를 먼저 확인하고 없으면 public 스키마에서 탐색 */
async function resolveLayerTableName(wantedLower: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema IN ('layer', 'public') AND lower(table_name) = '${esc(wantedLower)}'
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_name?: string } | undefined;
  return row?.table_name != null && String(row.table_name).trim() !== ''
    ? String(row.table_name).trim()
    : null;
}

/** layer 또는 public 스키마에서 테이블의 실제 스키마를 함께 반환 */
async function resolveTableWithSchema(wantedLower: string): Promise<{ tableName: string; schema: string } | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN ('layer', 'public') AND lower(table_name) = '${esc(wantedLower)}'
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) return null;
  return { tableName: String(row.table_name).trim(), schema: String(row.table_schema ?? 'public').trim() };
}

async function getTableColumns(schema: string, table: string): Promise<string[]> {
  const safeSchema = esc(schema);
  const safeTable = esc(table);
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema = '${safeSchema}' AND table_name = '${safeTable}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
}

function validateColumns(columns: string[]): string | null {
  const lower = new Set(columns.map((c) => c.toLowerCase()));
  const missing = REQUIRED_FOR_LIST.filter((r) => !lower.has(r.toLowerCase()));
  if (missing.length > 0) {
    return `road_use_ledger 필수 컬럼이 없습니다: ${missing.join(', ')}`;
  }
  return null;
}

async function resolveGeometryColumn(schema: string, table: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT f_geometry_column::text AS g
       FROM geometry_columns
       WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
       LIMIT 1`
    )
  );
  const g = (res.rows?.[0] as { g?: string } | undefined)?.g;
  return g != null && String(g).trim() !== '' ? String(g).trim() : null;
}

/**
 * 도로점용 1건 도형 범위(EPSG:3857) — 목록 클릭 시 지도 이동용
 */
export async function getRoadUseLedgerExtent3857ById(params: {
  id?: string;
}): Promise<{
  extent3857: [number, number, number, number] | null;
  error?: string;
}> {
  const idRaw = String(params?.id ?? '').trim();
  if (!/^-?\d+$/.test(idRaw)) {
    return { extent3857: null, error: '유효하지 않은 id입니다.' };
  }

  const tblMeta = await resolveTableWithSchema('road_use_ledger');
  if (!tblMeta) {
    return { extent3857: null, error: 'road_use_ledger 테이블이 없습니다.' };
  }
  const { tableName, schema: tblSchema } = tblMeta;

  const columns = await getTableColumns(tblSchema, tableName);
  const colLower = new Set(columns.map((c) => c.toLowerCase()));
  if (!colLower.has(COL.id.toLowerCase())) {
    return { extent3857: null, error: 'id 컬럼이 없습니다.' };
  }

  // 1순위: road_use_ledger_jijuk 첫 필지(가장 위 id) 위치
  const jijukMeta2 = await resolveTableWithSchema('road_use_ledger_jijuk');
  if (jijukMeta2) {
    const { tableName: jijukTableName, schema: jijukSchema2 } = jijukMeta2;
    const jCols = await getTableColumns(jijukSchema2, jijukTableName);
    const jLower = new Set(jCols.map((c) => c.toLowerCase()));
    const hasParentId = jLower.has('parent_id');
    const hasGeom = jLower.has('geom');
    if (hasParentId && hasGeom) {
      const safeJijuk = jijukTableName.replace(/"/g, '""');
      const safeJijukSchema2 = jijukSchema2.replace(/"/g, '""');
      const jOrder = jLower.has('id') ? quoteIdent('id') : quoteIdent('parent_id');
      const jSql = `
        SELECT
          ST_XMin(box)::float8 AS xmin,
          ST_YMin(box)::float8 AS ymin,
          ST_XMax(box)::float8 AS xmax,
          ST_YMax(box)::float8 AS ymax
        FROM (
          SELECT ST_Envelope(ST_Transform(jj.${quoteIdent('geom')}, 3857))::box2d AS box
          FROM "${safeJijukSchema2}"."${safeJijuk}" jj
          WHERE jj.${quoteIdent('parent_id')} = ${idRaw}::bigint AND jj.${quoteIdent('geom')} IS NOT NULL
          ORDER BY jj.${jOrder}
          LIMIT 1
        ) s
        WHERE box IS NOT NULL`;
      try {
        const jRes = await db.execute(sql.raw(jSql));
        const jRow = jRes.rows?.[0] as
          | { xmin?: number | string; ymin?: number | string; xmax?: number | string; ymax?: number | string }
          | undefined;
        const jxmin = Number(jRow?.xmin);
        const jymin = Number(jRow?.ymin);
        const jxmax = Number(jRow?.xmax);
        const jymax = Number(jRow?.ymax);
        if ([jxmin, jymin, jxmax, jymax].every((v) => Number.isFinite(v))) {
          return { extent3857: [jxmin, jymin, jxmax, jymax] };
        }
      } catch {
        // fallback to parent geom query below
      }
    }
  }

  let geomCol = await resolveGeometryColumn(tblSchema, tableName);
  if (!geomCol && colLower.has('geom')) geomCol = 'geom';
  if (!geomCol) {
    return { extent3857: null, error: 'geometry 컬럼을 찾을 수 없습니다.' };
  }

  const safeTbl = tableName.replace(/"/g, '""');
  const safeTblSchema = tblSchema.replace(/"/g, '""');
  const gq = quoteIdent(geomCol);
  const iq = quoteIdent(COL.id);

  const sqlText = `
    SELECT
      ST_XMin(box)::float8 AS xmin,
      ST_YMin(box)::float8 AS ymin,
      ST_XMax(box)::float8 AS xmax,
      ST_YMax(box)::float8 AS ymax
    FROM (
      SELECT ST_Extent(ST_Transform(t.${gq}, 3857))::box2d AS box
      FROM "${safeTblSchema}"."${safeTbl}" t
      WHERE t.${iq} = ${idRaw}::bigint AND t.${gq} IS NOT NULL
    ) sub
    WHERE box IS NOT NULL`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as
      | { xmin?: number | string; ymin?: number | string; xmax?: number | string; ymax?: number | string }
      | undefined;
    const xmin = Number(row?.xmin);
    const ymin = Number(row?.ymin);
    const xmax = Number(row?.xmax);
    const ymax = Number(row?.ymax);
    if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) {
      return { extent3857: null, error: '해당 건의 위치(도형)를 찾을 수 없습니다.' };
    }
    return { extent3857: [xmin, ymin, xmax, ymax] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { extent3857: null, error: msg };
  }
}

export type RoadUseLedgerListRow = {
  rowKey: string;
  permitNo: string;
  spotWithoutSidoSgg: string;
  /** 물건지(시도·시군구 제거). 컬럼 없으면 빈 문자열 */
  propertySpot: string;
  area: string;
  useStart: string;
  useEnd: string;
};

/**
 * 도로점용 ledger 목록 (layer.road_use_ledger 전용)
 */
export async function getRoadUseLedgerList(params?: {
  keyword?: string;
}): Promise<{
  rows: RoadUseLedgerListRow[];
  hasUseMgjColumn: boolean;
  error?: string;
}> {
  const keyword = String(params?.keyword ?? '').trim();
  const listTblMeta = await resolveTableWithSchema('road_use_ledger');
  if (!listTblMeta) {
    return {
      rows: [],
      hasUseMgjColumn: false,
      error: 'road_use_ledger 테이블이 없습니다.',
    };
  }
  const { tableName, schema: listTblSchema } = listTblMeta;

  const columns = await getTableColumns(listTblSchema, tableName);
  const colErr = validateColumns(columns);
  if (colErr) {
    return { rows: [], hasUseMgjColumn: false, error: colErr };
  }

  const colLower = new Set(columns.map((c) => c.toLowerCase()));
  const hasCol = (name: string) => colLower.has(name.toLowerCase());
  const hasUseMgjColumn = hasCol(COL.useMgj);

  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;

  const jijukListMeta = await resolveTableWithSchema('road_use_ledger_jijuk');
  let firstJijukParcelExpr = `''::text`;
  if (jijukListMeta) {
    const { tableName: jijukTableName, schema: jijukListSchema } = jijukListMeta;
    const jijukCols = await getTableColumns(jijukListSchema, jijukTableName);
    const jijukLower = new Set(jijukCols.map((c) => c.toLowerCase()));
    const hasParentId = jijukLower.has('parent_id');
    const hasParcelAddress = jijukLower.has(COL.parcelAddress.toLowerCase());
    if (hasParentId && hasParcelAddress) {
      const safeJijuk = jijukTableName.replace(/"/g, '""');
      const safeJijukListSchema = jijukListSchema.replace(/"/g, '""');
      const orderField = jijukLower.has('id') ? quoteIdent('id') : quoteIdent(COL.parcelAddress);
      firstJijukParcelExpr = `COALESCE((
        SELECT jj.${quoteIdent(COL.parcelAddress)}::text
        FROM "${safeJijukListSchema}"."${safeJijuk}" jj
        WHERE jj.${quoteIdent('parent_id')} = ${q(COL.id)}::bigint
          AND COALESCE(jj.${quoteIdent(COL.parcelAddress)}::text, '') <> ''
        ORDER BY jj.${orderField}
        LIMIT 1
      ), '')`;
    }
  }

  const spotSourceExpr = `COALESCE(NULLIF(${firstJijukParcelExpr}, ''), ${q(COL.useAddr)}::text, '')`;
  const spotExpr = spotSourceExpr;
  const propertySpotExpr = hasUseMgjColumn
    ? `COALESCE(${q(COL.useMgj)}::text, '')`
    : `''::text`;
  const permitNoExpr = `COALESCE(${q(COL.useNo)}::text, '')`;
  const permitDateExpr = `COALESCE(${q(COL.usePermitDate)}::text, '')`;
  const areaExpr = `COALESCE(${q(COL.useArea)}::text, '')`;
  const startExpr = `COALESCE(${q(COL.useStart)}::text, '')`;
  const endExpr = `COALESCE(${q(COL.useEnd)}::text, '')`;

  const searchParts: string[] = [];
  const addSearch = (name: string, expr: string) => {
    if (hasCol(name)) searchParts.push(expr);
  };
  addSearch(COL.parcelAddress, `COALESCE(${q(COL.parcelAddress)}::text, '')`);
  searchParts.push(permitNoExpr, permitDateExpr);
  addSearch(COL.useRoadType, `COALESCE(${q(COL.useRoadType)}::text, '')`);
  addSearch(COL.useRoadName, `COALESCE(${q(COL.useRoadName)}::text, '')`);
  searchParts.push(`COALESCE(${q(COL.useAddr)}::text, '')`);
  if (hasUseMgjColumn) searchParts.push(`COALESCE(${q(COL.useMgj)}::text, '')`);
  addSearch(COL.useWhy, `COALESCE(${q(COL.useWhy)}::text, '')`);
  addSearch(COL.useLicAddr, `COALESCE(${q(COL.useLicAddr)}::text, '')`);
  addSearch(COL.useLicTel, `COALESCE(${q(COL.useLicTel)}::text, '')`);
  addSearch(COL.useLicName, `COALESCE(${q(COL.useLicName)}::text, '')`);
  searchParts.push(areaExpr, startExpr, endExpr);

  const kwClause = keyword
    ? ` AND (${searchParts.map((e) => `${e} ILIKE '%${esc(keyword)}%'`).join(' OR ')})`
    : '';

  const safeTbl = tableName.replace(/"/g, '""');
  const safeListTblSchema = listTblSchema.replace(/"/g, '""');

  const sqlText = `
    SELECT
      COALESCE(${q(COL.id)}::text, '') AS "rowKey",
      ${permitNoExpr} AS "permitNo",
      ${spotExpr} AS "spotWithoutSidoSgg",
      ${propertySpotExpr} AS "propertySpot",
      ${areaExpr} AS "area",
      ${startExpr} AS "useStart",
      ${endExpr} AS "useEnd"
    FROM "${safeListTblSchema}"."${safeTbl}" ${t}
    WHERE 1=1 ${kwClause}
    ORDER BY ${q(COL.id)}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        permitNo: String(row.permitNo ?? '').trim(),
        spotWithoutSidoSgg: formatAddressStripSidoSigungu(row.spotWithoutSidoSgg),
        propertySpot: formatAddressStripSidoSigungu(row.propertySpot),
        area: String(row.area ?? '').trim(),
        useStart: formatToYmdOrText(row.useStart),
        useEnd: formatToYmdOrText(row.useEnd),
      };
    });
    return { rows, hasUseMgjColumn };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], hasUseMgjColumn: false, error: msg };
  }
}

type AnalyzeStepStatus = 'pass' | 'conditional' | 'fail';

type AnalyzeStep = {
  key: string;
  title: string;
  status: AnalyzeStepStatus;
  items: string[];
  deadlineHint?: string;
  legalRefs: string[];
};

function toFiniteNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeParcels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  return String(raw ?? '')
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isLikelyJibun(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  // 최소한 숫자(본번/부번) 포함 및 5자 이상을 지번 형식으로 판단
  return s.length >= 5 && /\d/.test(s);
}

export async function analyzeRoadUseParcels(params?: {
  applicationType?: 'new' | 'change' | 'extend';
  occupancyType?: 'general' | 'excavation' | 'connection';
  useStart?: string;
  useEnd?: string;
  occupancyParcels?: string[] | string;
  propertyParcels?: string[] | string;
  requestedAreaM2?: number | string;
  landPricePerM2?: number | string;
  previousAnnualFee?: number | string;
  occupancyCount?: number | string;
  occupancyLengthM?: number | string;
  pipeDiameterM?: number | string;
  discountCategory?: 'none' | 'public' | 'residential' | 'smallBiz';
  requestInstallments?: boolean;
  safetyPlan?: boolean;
  trafficPlan?: boolean;
  restorationPlan?: boolean;
  consultationPrepared?: boolean;
  isDevelopmentRestrictionZone?: boolean;
  isUrbanArea?: boolean;
  isChildProtectionZone?: boolean;
  isRoadZoneIncluded?: boolean;
  isOverlappedWithExistingPermit?: boolean;
  ownerConsentSecured?: boolean;
  rightSecured?: boolean;
  designDrawingAttached?: boolean;
  structureCalculationAttached?: boolean;
  buriedUtilityConsulted?: boolean;
  excavationLengthM?: number | string;
  excavationWidthM?: number | string;
  recentlyPavedRestriction?: boolean;
  rightSideConnection?: boolean;
  distanceSatisfied?: boolean;
  laneStandardSatisfied?: boolean;
  drainagePlan?: boolean;
  medianPlan?: boolean;
  startConstructionWithinOneYear?: boolean;
}): Promise<{
  summary: {
    judgement: '적합' | '조건부적합' | '불가';
    totalParcels: number;
    validParcels: number;
    invalidParcels: number;
    supplementCount: number;
    consultationCount: number;
  };
  validation: {
    invalidOccupancyParcels: string[];
    invalidPropertyParcels: string[];
  };
  steps: AnalyzeStep[];
  fee: {
    baseFee: number;
    discountAmount: number;
    adjustedFee: number;
    installmentInterest: number;
    vat: number;
    finalFee: number;
  };
  error?: string;
}> {
  const applicationType = params?.applicationType ?? 'new';
  const occupancyType = params?.occupancyType ?? 'general';
  const useStart = String(params?.useStart ?? '').trim();
  const useEnd = String(params?.useEnd ?? '').trim();
  const occupancyParcels = normalizeParcels(params?.occupancyParcels);
  const propertyParcels = normalizeParcels(params?.propertyParcels);
  const invalidOccupancyParcels = occupancyParcels.filter((p) => !isLikelyJibun(p));
  const invalidPropertyParcels = propertyParcels.filter((p) => !isLikelyJibun(p));
  const validOccupancyParcels = occupancyParcels.filter((p) => isLikelyJibun(p));
  const validPropertyParcels = propertyParcels.filter((p) => isLikelyJibun(p));
  const validParcels = [...validOccupancyParcels, ...validPropertyParcels];
  const totalParcels = occupancyParcels.length + propertyParcels.length;

  if (validOccupancyParcels.length === 0 || validPropertyParcels.length === 0) {
    return {
      summary: {
        judgement: '불가',
        totalParcels,
        validParcels: validParcels.length,
        invalidParcels: invalidOccupancyParcels.length + invalidPropertyParcels.length,
        supplementCount: 2,
        consultationCount: 0,
      },
      validation: { invalidOccupancyParcels, invalidPropertyParcels },
      steps: [],
      fee: {
        baseFee: 0,
        discountAmount: 0,
        adjustedFee: 0,
        installmentInterest: 0,
        vat: 0,
        finalFee: 0,
      },
      error: '점용대상필지와 물건지 필지의 유효 지번이 각각 1건 이상 필요합니다.',
    };
  }

  const startTs = useStart ? Date.parse(useStart) : NaN;
  const endTs = useEnd ? Date.parse(useEnd) : NaN;
  const hasValidPeriod = Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs;
  const durationDays = hasValidPeriod ? Math.floor((endTs - startTs) / 86400000) + 1 : 0;

  const safetyPlan = Boolean(params?.safetyPlan);
  const trafficPlan = Boolean(params?.trafficPlan);
  const restorationPlan = Boolean(params?.restorationPlan);
  const consultationPrepared = Boolean(params?.consultationPrepared);
  const requestInstallments = Boolean(params?.requestInstallments);
  const isDevelopmentRestrictionZone = Boolean(params?.isDevelopmentRestrictionZone);
  const isUrbanArea = Boolean(params?.isUrbanArea);
  const isChildProtectionZone = Boolean(params?.isChildProtectionZone);
  const isRoadZoneIncluded = Boolean(params?.isRoadZoneIncluded);
  const isOverlappedWithExistingPermit = Boolean(params?.isOverlappedWithExistingPermit);
  const ownerConsentSecured = Boolean(params?.ownerConsentSecured);
  const rightSecured = Boolean(params?.rightSecured);
  const designDrawingAttached = Boolean(params?.designDrawingAttached);
  const structureCalculationAttached = Boolean(params?.structureCalculationAttached);
  const buriedUtilityConsulted = Boolean(params?.buriedUtilityConsulted);
  const recentlyPavedRestriction = Boolean(params?.recentlyPavedRestriction);
  const rightSideConnection = Boolean(params?.rightSideConnection);
  const distanceSatisfied = Boolean(params?.distanceSatisfied);
  const laneStandardSatisfied = Boolean(params?.laneStandardSatisfied);
  const drainagePlan = Boolean(params?.drainagePlan);
  const medianPlan = Boolean(params?.medianPlan);
  const startConstructionWithinOneYear = Boolean(params?.startConstructionWithinOneYear);
  const excavationLengthM = Math.max(0, toFiniteNumber(params?.excavationLengthM));
  const excavationWidthM = Math.max(0, toFiniteNumber(params?.excavationWidthM));

  const requiredSupplements: string[] = [];
  if (!hasValidPeriod) requiredSupplements.push('점용 시작일/종료일 확인');
  if (occupancyType === 'excavation' && !safetyPlan) requiredSupplements.push('안전관리계획서');
  if (occupancyType === 'excavation' && !trafficPlan) requiredSupplements.push('교통소통대책');
  if (!restorationPlan) requiredSupplements.push('원상복구계획');
  if (invalidOccupancyParcels.length > 0) requiredSupplements.push('일부 점용대상필지 지번 형식 보완');
  if (invalidPropertyParcels.length > 0) requiredSupplements.push('일부 물건지 필지 지번 형식 보완');
  if (!isRoadZoneIncluded) requiredSupplements.push('도로구역 포함 여부 확인');
  if (!ownerConsentSecured) requiredSupplements.push('토지소유자 동의서');
  if (!rightSecured) requiredSupplements.push('권원 확보 증빙');
  if (!designDrawingAttached) requiredSupplements.push('설계도면');
  if (!buriedUtilityConsulted && occupancyType === 'excavation') requiredSupplements.push('주요지하매설물 협의');
  if (occupancyType === 'connection' && !rightSideConnection) requiredSupplements.push('우측연결 기준 검토');
  if (occupancyType === 'connection' && !distanceSatisfied) requiredSupplements.push('이격거리 검토자료');
  if (occupancyType === 'connection' && !laneStandardSatisfied) requiredSupplements.push('변속/부가차로 기준 검토자료');
  if (occupancyType === 'connection' && !drainagePlan) requiredSupplements.push('배수시설 계획');
  if (occupancyType === 'connection' && !medianPlan) requiredSupplements.push('분리대 설치계획');
  if (!startConstructionWithinOneYear) requiredSupplements.push('1년 내 착공계획 확인');

  const needsConsultation = occupancyType !== 'general';
  const consultationItems: string[] = [];
  if (occupancyType === 'excavation') {
    consultationItems.push('주요지하매설물 관리자 협의');
  }
  if (occupancyType === 'connection') {
    consultationItems.push('경찰서/도시군 계획 협의');
  }
  if (isChildProtectionZone) consultationItems.push('어린이보호구역 내 시설장 협의');
  if (isDevelopmentRestrictionZone) consultationItems.push('개발제한구역 행위제한 별도 확인');
  if (needsConsultation && !consultationPrepared) {
    requiredSupplements.push('외부기관 협의자료');
  }

  const permitMaxYears = occupancyType === 'general' ? 3 : 10;
  const permitPeriodInvalid = hasValidPeriod && durationDays > permitMaxYears * 365;

  const areaM2 = Math.max(0, toFiniteNumber(params?.requestedAreaM2));
  const landPricePerM2 = Math.max(0, toFiniteNumber(params?.landPricePerM2));
  const previousAnnualFee = Math.max(0, toFiniteNumber(params?.previousAnnualFee));
  const occupancyCount = Math.max(0, toFiniteNumber(params?.occupancyCount));
  const occupancyLengthM = Math.max(0, toFiniteNumber(params?.occupancyLengthM));
  const pipeDiameterM = Math.max(0, toFiniteNumber(params?.pipeDiameterM));
  const rate = occupancyType === 'connection' ? 0.02 : occupancyType === 'excavation' ? 0.04 : 0.05;
  const areaFee = Math.round(areaM2 * landPricePerM2 * rate);
  const countFee = Math.round(occupancyCount * 2750);
  const lengthFee = Math.round(occupancyLengthM * 1150);
  const diameterSurcharge = pipeDiameterM > 0 ? Math.round(pipeDiameterM * 1000) : 0;
  const baseFee = areaFee + countFee + lengthFee + diameterSurcharge;

  const discountCategory = params?.discountCategory ?? 'none';
  const discountRate =
    discountCategory === 'public' || discountCategory === 'residential'
      ? 1
      : discountCategory === 'smallBiz'
      ? 0.1
      : 0;
  const discountAmount = Math.round(baseFee * discountRate);
  let adjustedFee = Math.max(0, baseFee - discountAmount);
  if (previousAnnualFee > 0 && adjustedFee > previousAnnualFee * 1.1) {
    adjustedFee = Math.round(previousAnnualFee * 1.1);
  }
  const installmentInterest = requestInstallments && adjustedFee > 500000 ? Math.round(adjustedFee * 0.0281) : 0;
  const vat = Math.round(adjustedFee * 0.1);
  const finalFee = adjustedFee + installmentInterest + vat;

  const intakeStatus: AnalyzeStepStatus = requiredSupplements.length === 0 ? 'pass' : 'conditional';
  const reviewStatus: AnalyzeStepStatus =
    permitPeriodInvalid || (needsConsultation && !consultationPrepared) || recentlyPavedRestriction
      ? 'conditional'
      : 'pass';
  const permitStatus: AnalyzeStepStatus = permitPeriodInvalid ? 'fail' : 'pass';
  const chargeStatus: AnalyzeStepStatus =
    areaFee <= 0 && countFee <= 0 && lengthFee <= 0 ? 'conditional' : 'pass';
  const postStatus: AnalyzeStepStatus = restorationPlan ? 'pass' : 'conditional';

  const steps: AnalyzeStep[] = [
    {
      key: 'intake',
      title: '접수/보완',
      status: intakeStatus,
      items:
        intakeStatus === 'pass'
          ? ['필수 입력사항이 충족되어 접수 가능']
          : [`보완 필요: ${requiredSupplements.join(', ')}`],
      deadlineHint: intakeStatus === 'pass' ? '접수 가능' : '보완요구 8근무시간 이내 통지 기준',
      legalRefs: ['민원 접수/보완 p65~69', '민원처리법 제22조'],
    },
    {
      key: 'review',
      title: '기준심사',
      status: reviewStatus,
      items: [
        `점용유형: ${occupancyType === 'general' ? '일반점용' : occupancyType === 'excavation' ? '굴착수반' : '연결허가'}`,
        ...(consultationItems.length > 0 ? consultationItems : ['일반점용으로 외부 협의요건 낮음']),
        isUrbanArea ? '도시지역 계획 적합성 검토 대상' : '비도시지역 기준 검토',
        isOverlappedWithExistingPermit ? '기존 허가구간 중복 여부 조정 필요' : '기존 허가중복 없음',
        recentlyPavedRestriction ? '준공 후 굴착 제한구간 여부 확인 필요' : '굴착 제한구간 아님',
      ],
      deadlineHint: '외부기관 협의 및 기준심사',
      legalRefs: ['기준심사 p69~99', '도로법 시행령 별표2'],
    },
    {
      key: 'permit',
      title: '허가처리',
      status: permitStatus,
      items: permitPeriodInvalid
        ? [`허가기간 한도(${permitMaxYears}년) 초과 가능성`]
        : [
            `허가기간 검토 한도: ${permitMaxYears}년`,
            `민원 종결유형 추천: ${applicationType === 'new' ? '허가' : applicationType === 'change' ? '변경허가' : '연장허가'}`,
            structureCalculationAttached ? '구조계산서 제출 확인' : '구조계산서 검토 필요',
          ],
      deadlineHint: '허가증 교부/공고/통보 절차',
      legalRefs: ['허가처리 p101~114', '도로법 제61조'],
    },
    {
      key: 'charge',
      title: '부과징수',
      status: chargeStatus,
      items:
        chargeStatus === 'pass'
          ? [
              `면적산식: ${areaM2.toLocaleString()}㎡ × ${landPricePerM2.toLocaleString()}원 × 요율 ${rate}`,
              `개수산식: ${occupancyCount.toLocaleString()}개 × 2,750원`,
              `길이산식: ${occupancyLengthM.toLocaleString()}m × 1,150원`,
              pipeDiameterM > 0 ? `관경 가산: ${pipeDiameterM.toLocaleString()}m 반영` : '관경 가산 없음',
              requestInstallments ? '분할납부 신청 반영' : '일시납 기준',
            ]
          : ['면적/개수/길이 중 과금 기초값이 없어 금액은 참고치로 산정됨'],
      deadlineHint: '이의신청 60일, 반환신청 60일/통지 30일',
      legalRefs: ['부과징수 p119~148', '도로법 시행령 제69조/제71조'],
    },
    {
      key: 'post',
      title: '사후관리',
      status: postStatus,
      items: [
        restorationPlan ? '원상복구 계획 확인' : '원상복구 계획 보완 필요',
        '권리의무 승계 발생 시 2개월 내 신고',
      ],
      deadlineHint: '만료·취소 시 원상회복 및 사후관리',
      legalRefs: ['사후관리 p155~160', '도로법 제73조/제106조'],
    },
  ];

  const hasFail = steps.some((s) => s.status === 'fail');
  const hasConditional = steps.some((s) => s.status === 'conditional');
  const judgement: '적합' | '조건부적합' | '불가' = hasFail ? '불가' : hasConditional ? '조건부적합' : '적합';

  return {
    summary: {
      judgement,
      totalParcels,
      validParcels: validParcels.length,
      invalidParcels: invalidOccupancyParcels.length + invalidPropertyParcels.length,
      supplementCount: requiredSupplements.length,
      consultationCount: consultationItems.length,
    },
    validation: { invalidOccupancyParcels, invalidPropertyParcels },
    steps,
    fee: {
      baseFee,
      discountAmount,
      adjustedFee,
      installmentInterest,
      vat,
      finalFee,
    },
  };
}
