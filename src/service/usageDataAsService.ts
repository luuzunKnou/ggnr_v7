/**
 * 울진 하천점용 — usage_data_as / usage_data_as_solo / usage_data_as_mgj
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { tryFormatToYmd } from '@/lib/formatDateYmd';
import { splitUsagePeriod } from '@/lib/usageDataAsFieldUtils';
import {
  DEFAULT_USAGE_DATA_AS_CONS_CODE,
  incrementSuffixCode,
} from '@/lib/incrementSuffixCode';
import {
  getEditableFieldDefinitionsForTable,
  resolveJijukParcelGeomsByAddresses,
  syncChildParcelsByParentId,
} from './layerRowService';
import { labelForUsageDataAsField } from '@/app/(pages)/map/_mapContents/river/usageDataAs/usageDataAsFieldLabels';

const MAIN_TABLE = 'usage_data_as';
const SOLO_TABLE = 'usage_data_as_solo';
const MGJ_TABLE = 'usage_data_as_mgj';
const DEFAULT_SCHEMA = 'layer';
const KEY_FIELD = 'cons_code';
const CHILD_PARENT_FIELD = 'cons_code';

const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);
const SEARCH_SCHEMAS = ['layer', 'public'] as const;

export type UsageDataAsListRow = {
  rowKey: string;
  name: string;
  place: string;
  startDate: string;
  endDate: string;
};

export type UsageDataAsExpiryNotifRow = {
  rowKey: string;
  name: string;
  endDate: string;
  daysRemaining: number;
};

const EXPIRY_NOTIF_DEFAULT_WITHIN_DAYS = 15;

export type UsageDataAsDetailAttr = {
  field: string;
  label: string;
  value: string;
  /** false면 기본 숨김(더보기로 표시) */
  showDetail?: boolean;
};

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
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) return null;
  return {
    tableName: String(row.table_name).trim(),
    schema: String(row.table_schema ?? DEFAULT_SCHEMA).trim(),
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

function findColumn(columns: string[], name: string): string | null {
  const lower = name.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower) ?? null;
}

function resolveAddressColumn(columns: string[]): string | null {
  return findColumn(columns, 'usage_loc') ?? findColumn(columns, 'parcel_address');
}

async function getChildAddressItems(params: {
  childTableName: string;
  parentKey: string;
}): Promise<{
  items: {
    address: string;
    extent3857: [number, number, number, number] | null;
    wmsRowKey?: { keyField: string; keyValue: string };
  }[];
  error?: string;
}> {
  const meta = await resolveTableWithSchema(params.childTableName);
  if (!meta) return { items: [] };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const parentCol = findColumn(cols, CHILD_PARENT_FIELD);
  const addressCol = resolveAddressColumn(cols);
  if (!parentCol || !addressCol) return { items: [] };

  const hasGeom = findColumn(cols, 'geom');
  const hasId = findColumn(cols, 'id');
  const hasOgcFid = findColumn(cols, 'ogc_fid');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const orderExpr = hasOgcFid
    ? quoteIdent('ogc_fid')
    : hasId
      ? quoteIdent('id')
      : quoteIdent(parentCol);
  const extentSelect = hasGeom
    ? `,
      ST_XMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmin,
      ST_YMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymin,
      ST_XMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmax,
      ST_YMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymax`
    : `,NULL::float8 AS xmin,NULL::float8 AS ymin,NULL::float8 AS xmax,NULL::float8 AS ymax`;
  const ogcFidSelect = hasOgcFid ? `, r.${quoteIdent('ogc_fid')}::text AS ogc_fid` : `, NULL::text AS ogc_fid`;

  const sqlText = `
    SELECT COALESCE(r.${quoteIdent(addressCol)}::text, '') AS addr ${extentSelect}${ogcFidSelect}
    FROM "${safeSchema}"."${safe}" r
    WHERE r.${quoteIdent(parentCol)}::text = '${esc(params.parentKey)}'
      AND COALESCE(r.${quoteIdent(addressCol)}::text, '') <> ''
    ORDER BY r.${orderExpr}`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const items = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const address = String(row.addr ?? '').trim();
      const xmin = Number(row.xmin);
      const ymin = Number(row.ymin);
      const xmax = Number(row.xmax);
      const ymax = Number(row.ymax);
      const extent3857: [number, number, number, number] | null =
        [xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))
          ? [xmin, ymin, xmax, ymax]
          : null;
      const ogcFid = String(row.ogc_fid ?? '').trim();
      const wmsRowKey = ogcFid ? { keyField: 'ogc_fid', keyValue: ogcFid } : undefined;
      return { address, extent3857, ...(wmsRowKey ? { wmsRowKey } : {}) };
    });
    return { items: items.filter((x) => x.address) };
  } catch (e: unknown) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 목록 정렬 — 점용시작일 최신순. 시작·종료 중 날짜로 못 쓰는 값(한글 등)은 맨 아래 */
function isUsageListDateSortable(value: string): boolean {
  return tryFormatToYmd(String(value ?? '').trim()) !== null;
}

function isUsageListRowDateSortable(row: Pick<UsageDataAsListRow, 'startDate' | 'endDate'>): boolean {
  if (!isUsageListDateSortable(row.startDate)) return false;
  const end = String(row.endDate ?? '').trim();
  if (!end) return true;
  return isUsageListDateSortable(end);
}

function sortUsageDataAsListRows(rows: UsageDataAsListRow[]): UsageDataAsListRow[] {
  return [...rows].sort((a, b) => {
    const aOk = isUsageListRowDateSortable(a);
    const bOk = isUsageListRowDateSortable(b);
    if (aOk !== bOk) return aOk ? -1 : 1;

    if (aOk && bOk) {
      const startCmp = b.startDate.localeCompare(a.startDate);
      if (startCmp !== 0) return startCmp;
      const endA = a.endDate || '';
      const endB = b.endDate || '';
      if (endA !== endB) {
        if (!endA) return 1;
        if (!endB) return -1;
        return endB.localeCompare(endA);
      }
    }

    return b.rowKey.localeCompare(a.rowKey);
  });
}

function startOfLocalDayMs(raw: string | Date): number | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate()).getTime();
  }
  const ymd = tryFormatToYmd(String(raw ?? '').trim());
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function diffLocalCalendarDays(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 86_400_000);
}

/** 점용종료일이 N일 이내인 하천점용대장 알림 목록 */
export async function getUsageDataAsExpiryNotifications(params?: {
  withinDays?: number;
}): Promise<{ items: UsageDataAsExpiryNotifRow[]; error?: string }> {
  const withinDays = Math.max(
    1,
    Math.min(365, Math.trunc(Number(params?.withinDays ?? EXPIRY_NOTIF_DEFAULT_WITHIN_DAYS)))
  );
  const list = await getUsageDataAsList();
  if (list.error) return { items: [], error: list.error };

  const todayMs = startOfLocalDayMs(new Date());
  if (todayMs == null) return { items: [] };

  const items: UsageDataAsExpiryNotifRow[] = [];
  for (const row of list.rows) {
    const endYmd = tryFormatToYmd(String(row.endDate ?? '').trim());
    if (!endYmd) continue;
    const endMs = startOfLocalDayMs(endYmd);
    if (endMs == null) continue;
    const daysRemaining = diffLocalCalendarDays(todayMs, endMs);
    if (daysRemaining < 0 || daysRemaining > withinDays) continue;
    items.push({
      rowKey: row.rowKey,
      name: row.name || row.rowKey,
      endDate: endYmd,
      daysRemaining,
    });
  }

  items.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
    if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
    return a.rowKey.localeCompare(b.rowKey);
  });

  return { items };
}

/** 목록 (프로토: 점용명·장소·시작·종료) */
export async function getUsageDataAsList(params?: {
  keyword?: string;
}): Promise<{ rows: UsageDataAsListRow[]; error?: string }> {
  const keyword = String(params?.keyword ?? '').trim();
  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) return { rows: [], error: `${MAIN_TABLE} 테이블이 없습니다.` };

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findColumn(columns, KEY_FIELD);
  const nameCol = findColumn(columns, 'usage_name');
  const placeCol = findColumn(columns, 'usage_loc');
  const periodCol = findColumn(columns, 'usage_pd');
  if (!keyCol) return { rows: [], error: `${KEY_FIELD} 컬럼이 없습니다.` };

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;
  const nameExpr = nameCol ? `COALESCE(${q(nameCol)}::text, '')` : `''::text`;
  const placeExpr = placeCol ? `COALESCE(${q(placeCol)}::text, '')` : `''::text`;
  const periodExpr = periodCol ? `COALESCE(${q(periodCol)}::text, '')` : `''::text`;

  const searchCols = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
  const kwClause = keyword
    ? ` AND (${searchCols.map((c) => `COALESCE(${q(c)}::text, '') ILIKE '%${esc(keyword)}%'`).join(' OR ')})`
    : '';

  const sqlText = `
    SELECT
      COALESCE(${q(keyCol)}::text, '') AS "rowKey",
      ${nameExpr} AS "name",
      ${placeExpr} AS "place",
      ${periodExpr} AS "periodRaw"
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE COALESCE(${q(keyCol)}::text, '') <> '' ${kwClause}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const { start, end } = splitUsagePeriod(String(row.periodRaw ?? ''));
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        name: String(row.name ?? '').trim(),
        place: formatAddressStripSidoSigungu(String(row.place ?? '')),
        startDate: start,
        endDate: end,
      };
    });
    return { rows: sortUsageDataAsListRows(rows) };
  } catch (e: unknown) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 지도 이동용 extent — 점용 본표(geom)만. 필지·물건지 합치면 중심이 어긋남 */
export async function getUsageDataAsExtent3857ByKey(params: {
  key?: string;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const keyRaw = String(params?.key ?? '').trim();
  if (!keyRaw) return { extent3857: null, error: '키가 필요합니다.' };

  const mainMeta = await resolveTableWithSchema(MAIN_TABLE);
  if (!mainMeta) {
    return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
  }
  const cols = await getTableColumns(mainMeta.schema, mainMeta.tableName);
  const keyCol = findColumn(cols, KEY_FIELD);
  const geomCol = findColumn(cols, 'geom');
  if (!keyCol || !geomCol) {
    return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
  }

  const safe = mainMeta.tableName.replace(/"/g, '""');
  const safeSchema = mainMeta.schema.replace(/"/g, '""');
  const sqlText = `
    SELECT ST_XMin(ext)::float8 AS xmin, ST_YMin(ext)::float8 AS ymin,
           ST_XMax(ext)::float8 AS xmax, ST_YMax(ext)::float8 AS ymax
    FROM (
      SELECT ST_Extent(ST_Transform(t.${quoteIdent(geomCol)}, 3857))::box2d AS ext
      FROM "${safeSchema}"."${safe}" t
      WHERE t.${quoteIdent(keyCol)}::text = '${esc(keyRaw)}'
        AND t.${quoteIdent(geomCol)} IS NOT NULL
    ) s
    WHERE ext IS NOT NULL`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown } | undefined;
    const coords = [Number(row?.xmin), Number(row?.ymin), Number(row?.xmax), Number(row?.ymax)];
    if (!coords.every((v) => Number.isFinite(v))) {
      return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
    }
    return { extent3857: coords as [number, number, number, number] };
  } catch (e: unknown) {
    return { extent3857: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 — defineLayer 필드 + 필지·물건지 */
export async function getUsageDataAsDetailByKey(params: {
  key?: string;
}): Promise<{
  attributes: UsageDataAsDetailAttr[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  mgjItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const keyRaw = String(params?.key ?? '').trim();
  if (!keyRaw) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: '키가 필요합니다.' };
  }

  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: `${MAIN_TABLE} 테이블이 없습니다.` };
  }

  const fieldDefs = await getEditableFieldDefinitionsForTable({
    table: MAIN_TABLE,
    schema: DEFAULT_SCHEMA,
    excludeFields: ['ogc_fid', 'gkey_code', 'river_code', 'mng_cde', 'user_name'],
    includeHiddenDetail: true,
  });
  if (fieldDefs.error) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: fieldDefs.error };
  }

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findColumn(columns, KEY_FIELD);
  if (!keyCol) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: `${KEY_FIELD} 컬럼이 없습니다.` };
  }

  const dataFields = fieldDefs.fields.map((f) => f.field).filter((f) => findColumn(columns, f));
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const selectList =
    dataFields.length > 0
      ? dataFields.map((c) => `${quoteIdent(c)} AS ${quoteIdent(c)}`).join(', ')
      : `${quoteIdent(keyCol)} AS ${quoteIdent(keyCol)}`;
  const sqlText = `
    SELECT ${selectList}
    FROM "${safeSchema}"."${safe}"
    WHERE ${quoteIdent(keyCol)}::text = '${esc(keyRaw)}'
    LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { attributes: [], parcelItems: [], mgjItems: [], error: '해당 건을 찾을 수 없습니다.' };
    }

    const metaByField = new Map(fieldDefs.fields.map((f) => [f.field.toLowerCase(), f]));
    const attributes: UsageDataAsDetailAttr[] = dataFields.map((field) => {
      const def = metaByField.get(field.toLowerCase());
      return {
        field,
        label: labelForUsageDataAsField(field),
        value: String(row[field] ?? '').trim() || '—',
        showDetail: def?.showDetail !== false,
      };
    });

    const [parcelResult, mgjResult] = await Promise.all([
      getChildAddressItems({ childTableName: SOLO_TABLE, parentKey: keyRaw }),
      getChildAddressItems({ childTableName: MGJ_TABLE, parentKey: keyRaw }),
    ]);

    return {
      attributes,
      parcelItems: parcelResult.items,
      mgjItems: mgjResult.items,
      ...(parcelResult.error || mgjResult.error
        ? { error: [parcelResult.error, mgjResult.error].filter(Boolean).join('; ') }
        : {}),
    };
  } catch (e: unknown) {
    return {
      attributes: [],
      parcelItems: [],
      mgjItems: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 신규 등록용 — 전체 목록 마지막 공사코드 +1 (예: JY_000519 → JY_000520) */
export async function getNextUsageDataAsConsCode(): Promise<{ consCode: string; error?: string }> {
  const meta = await resolveTableWithSchema(MAIN_TABLE);
  if (!meta) return { consCode: DEFAULT_USAGE_DATA_AS_CONS_CODE, error: `${MAIN_TABLE} 테이블이 없습니다.` };

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findColumn(columns, KEY_FIELD);
  if (!keyCol) {
    return { consCode: DEFAULT_USAGE_DATA_AS_CONS_CODE, error: `${KEY_FIELD} 컬럼이 없습니다.` };
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
    if (!last) return { consCode: DEFAULT_USAGE_DATA_AS_CONS_CODE };
    return { consCode: incrementSuffixCode(last) };
  } catch (e: unknown) {
    return {
      consCode: DEFAULT_USAGE_DATA_AS_CONS_CODE,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 물건지 sync — usage_data_as_mgj (solo와 동일하게 jijuk 필지 폴리곤 저장) */
export async function syncUsageDataAsMgjByConsCode(params: {
  consCode: string;
  items: Array<{ address: string; pnu?: string; x4326?: number; y4326?: number }>;
}): Promise<{ success: boolean; error?: string }> {
  const consCode = String(params?.consCode ?? '').trim();
  if (!consCode) return { success: false, error: 'consCode가 필요합니다.' };

  const items = (params.items ?? []).filter((it) => String(it?.address ?? '').trim());
  if (items.length === 0) {
    return syncChildParcelsByParentId({
      schema: DEFAULT_SCHEMA,
      childTableName: MGJ_TABLE,
      childParentField: CHILD_PARENT_FIELD,
      childAddressField: 'usage_loc',
      parentId: consCode,
      parcels: [],
    });
  }

  const resolved = await resolveJijukParcelGeomsByAddresses({
    items: items.map((item) => ({
      address: String(item.address).trim(),
      pnu: String(item.pnu ?? '').trim() || undefined,
      lon: item.x4326,
      lat: item.y4326,
    })),
  });

  const parcels = items.map((item, index) => {
    const resolvedRow = resolved.parcels[index];
    return {
      address: String(item.address).trim(),
      pnu: String(resolvedRow?.pnu ?? item.pnu ?? '').trim() || undefined,
    };
  });

  const result = await syncChildParcelsByParentId({
    schema: DEFAULT_SCHEMA,
    childTableName: MGJ_TABLE,
    childParentField: CHILD_PARENT_FIELD,
    childAddressField: 'usage_loc',
    parentId: consCode,
    parcels,
  });

  if (result.error) return { success: false, error: result.error };
  if (resolved.error) {
    return { success: true, error: resolved.error };
  }
  return { success: true };
}
