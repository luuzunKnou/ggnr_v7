/**
 * 공통 점용대장 — config 바인딩 테이블로 목록·상세·extent
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { tryFormatToYmd } from '@/lib/formatDateYmd';
import { splitUsagePeriod } from '@/lib/usageDataAsFieldUtils';
import { incrementSuffixCode } from '@/lib/incrementSuffixCode';
import {
  formatOccupationPermitNo,
  parseOccupationPermitNoSeq,
} from '@/lib/occupationPermitNo';
import {
  getOccupationLedgerBinding,
  OCCUPATION_LEDGER_PREFIXES,
  occupationLedgerPrefixToSystemKey,
  type OccupationLedgerBinding,
  type OccupationLedgerPrefix,
} from '@/lib/occupationLedgerBinding';
import {
  getEditableFieldDefinitionsForTable,
  resolveJijukParcelGeomsByAddresses,
  syncChildParcelsByParentId,
  buildChildOfParentWhereSql,
} from './layerRowService';
import { labelForOccupationLedgerField } from '@/app/(pages)/map/_mapContents/occupationLedger/occupationLedgerFieldLabels';
import {
  deriveOccupationPeriodState,
  OCCUPATION_PERIOD_STATE_ENDED,
} from '@/lib/occupationLedgerPeriodState';
import { sortOccupationLedgerListRows } from '@/lib/occupationLedgerListSort';
import { parseOccupPlacePartsForJijuk } from '@/lib/occupationLedgerOccupPlaceGeom';
import { riNameLookupCandidates, buildPnu19 } from '@/lib/excelUploadAddressNormalize';
import {
  getJijukGeomByPnu,
  resolvePnuFromParsedParts,
} from './excelUploadService';

const DEFAULT_SCHEMA = 'layer';
const GEOM_COLUMN_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);
const SEARCH_SCHEMAS = ['layer', 'public'] as const;

export type OccupationLedgerListRow = {
  rowKey: string;
  name: string;
  place: string;
  startDate: string;
  endDate: string;
  /** 점용 종료일 기준 진행중/종료 */
  status: string;
};

export type OccupationLedgerExpiryNotifRow = {
  rowKey: string;
  name: string;
  endDate: string;
  daysRemaining: number;
  prefix: OccupationLedgerPrefix;
  systemScope: 'river' | 'road' | 'build';
};

const EXPIRY_NOTIF_DEFAULT_WITHIN_DAYS = 15;

export type OccupationLedgerDetailAttr = {
  field: string;
  label: string;
  value: string;
  showDetail?: boolean;
  required?: boolean;
};

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
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

function resolveBinding(params?: {
  serEng?: string;
  system?: string;
}): { binding: OccupationLedgerBinding; error?: undefined } | { binding?: undefined; error: string } {
  const binding = getOccupationLedgerBinding({
    serEng: params?.serEng,
    system: params?.system,
  });
  if (!binding) {
    return { error: '점용대장 서비스(occupationLedger*)를 확인할 수 없습니다.' };
  }
  return { binding };
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

/** 본표 키(ogc_fid). 허가번호·id 로 들어와도 본표 키로 맞춘다. 순번이 있으면 그 행만 쓴다. */
async function canonicalOccupationLedgerKey(
  binding: OccupationLedgerBinding,
  keyRaw: string
): Promise<string | null> {
  const key = String(keyRaw ?? '').trim();
  if (!key) return null;
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return null;
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(cols, binding.fields.keyField);
  const permitCol = findColumn(cols, 'permit_no');
  const idCol = findColumn(cols, 'id');
  if (!keyCol) return null;
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');

  const lookup = async (col: string): Promise<string | null> => {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ${quoteIdent(keyCol)}::text AS k
           FROM "${safeSchema}"."${safe}"
           WHERE ${quoteIdent(col)}::text = '${esc(key)}'
           LIMIT 1`
        )
      );
      const k = String((res.rows?.[0] as { k?: string } | undefined)?.k ?? '').trim();
      return k || null;
    } catch {
      return null;
    }
  };

  const byKey = await lookup(keyCol);
  if (byKey) return byKey;
  if (permitCol && permitCol.toLowerCase() !== keyCol.toLowerCase()) {
    const byPermit = await lookup(permitCol);
    if (byPermit) return byPermit;
  }
  if (idCol && idCol.toLowerCase() !== keyCol.toLowerCase()) {
    return lookup(idCol);
  }
  return null;
}

export async function resolveOccupationLedgerRowKey(params?: {
  key?: string;
  serEng?: string;
  system?: string;
}): Promise<{ key: string | null; error?: string }> {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { key: null, error: resolved.error };
  }
  const key = await canonicalOccupationLedgerKey(resolved.binding, String(params?.key ?? ''));
  return { key };
}

function resolveChildParentCol(columns: string[], hint: string): string | null {
  const ordered = [hint, 'permit_no', 'parent_id', 'cons_code', 'id']
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const name of ordered) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const found = findColumn(columns, name);
    if (found) return found;
  }
  return null;
}

function resolveChildAddressCol(columns: string[], hint: string): string | null {
  const ordered = [hint, 'occup_place', 'parcel_address', 'usage_loc']
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const name of ordered) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const found = findColumn(columns, name);
    if (found) return found;
  }
  return null;
}

async function getChildAddressItems(params: {
  childTableName: string;
  parentKey: string;
  parentField: string;
  addressField: string;
}): Promise<{
  items: {
    address: string;
    extent3857: [number, number, number, number] | null;
    wmsRowKey?: { keyField: string; keyValue: string };
  }[];
}> {
  const meta = await resolveTableWithSchema(params.childTableName);
  if (!meta) return { items: [] };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const parentCol = resolveChildParentCol(cols, params.parentField);
  const addressCol = resolveChildAddressCol(cols, params.addressField);
  if (!parentCol || !addressCol) return { items: [] };

  const hasGeom = findColumn(cols, 'geom');
  const hasOgcFid = findColumn(cols, 'ogc_fid');
  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const orderExpr = hasOgcFid ? quoteIdent('ogc_fid') : quoteIdent(parentCol);
  const extentSelect = hasGeom
    ? `,
      ST_XMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmin,
      ST_YMin(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymin,
      ST_XMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS xmax,
      ST_YMax(ST_Envelope(ST_Transform(r.${quoteIdent('geom')}, 3857)))::float8 AS ymax`
    : `,NULL::float8 AS xmin,NULL::float8 AS ymin,NULL::float8 AS xmax,NULL::float8 AS ymax`;
  const ogcFidSelect = hasOgcFid
    ? `, r.${quoteIdent('ogc_fid')}::text AS ogc_fid`
    : `, NULL::text AS ogc_fid`;

  const childOfParentSql = buildChildOfParentWhereSql({
    parentCol,
    parentId: params.parentKey,
    alias: 'r',
  });

  const sqlText = `
    SELECT COALESCE(r.${quoteIdent(addressCol)}::text, '') AS addr ${extentSelect}${ogcFidSelect}
    FROM "${safeSchema}"."${safe}" r
    WHERE ${childOfParentSql}
      AND COALESCE(r.${quoteIdent(addressCol)}::text, '') <> ''
    ORDER BY r.${orderExpr}`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const items = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const addressRaw = String(row.addr ?? '').trim();
      const address = formatAddressStripSidoSigungu(addressRaw) || addressRaw;
      const xmin = Number(row.xmin);
      const ymin = Number(row.ymin);
      const xmax = Number(row.xmax);
      const ymax = Number(row.ymax);
      const extent3857: [number, number, number, number] | null = [xmin, ymin, xmax, ymax].every(
        (v) => Number.isFinite(v)
      )
        ? [xmin, ymin, xmax, ymax]
        : null;
      const ogcFid = String(row.ogc_fid ?? '').trim();
      const wmsRowKey = ogcFid ? { keyField: 'ogc_fid', keyValue: ogcFid } : undefined;
      return { address, extent3857, ...(wmsRowKey ? { wmsRowKey } : {}) };
    });
    const seen = new Set<string>();
    const unique = items.filter((x) => {
      if (!x.address) return false;
      const key = x.address.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { items: unique };
  } catch {
    return { items: [] };
  }
}

function sortListRows(rows: OccupationLedgerListRow[]): OccupationLedgerListRow[] {
  return sortOccupationLedgerListRows(rows);
}

export async function getOccupationLedgerBindingInfo(params?: {
  serEng?: string;
  system?: string;
}) {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { success: false as const, error: resolved.error ?? '설정 없음' };
  }
  const b = resolved.binding;
  return {
    success: true as const,
    title: b.title,
    mainTable: b.mainTable,
    jijukTable: b.jijukTable,
    mgjTable: b.mgjTable,
    keyField: b.fields.keyField,
    editPresetKey: b.editPresetKey,
    wmsLayerIds: [b.mainTable, b.jijukTable, b.mgjTable],
  };
}

export async function getOccupationLedgerList(params?: {
  keyword?: string;
  serEng?: string;
  system?: string;
}): Promise<{ rows: OccupationLedgerListRow[]; error?: string; title?: string }> {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { rows: [], error: resolved.error };
  }
  const binding = resolved.binding;
  const keyword = String(params?.keyword ?? '').trim();
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return { rows: [], error: `${binding.mainTable} 테이블이 없습니다.`, title: binding.title };

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const f = binding.fields;
  const keyCol = findColumn(columns, f.keyField);
  const nameCol = findColumn(columns, f.nameField);
  const placeCol = findColumn(columns, f.placeField);
  const periodCol = f.periodField ? findColumn(columns, f.periodField) : null;
  const startCol = f.startField ? findColumn(columns, f.startField) : null;
  const endCol = f.endField ? findColumn(columns, f.endField) : null;
  if (!keyCol) return { rows: [], error: `${f.keyField} 컬럼이 없습니다.`, title: binding.title };

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;
  const nameExpr = nameCol ? `COALESCE(${q(nameCol)}::text, '')` : `''::text`;
  const placeExpr = placeCol ? `COALESCE(${q(placeCol)}::text, '')` : `''::text`;
  const periodExpr = periodCol ? `COALESCE(${q(periodCol)}::text, '')` : `''::text`;
  const startExpr = startCol ? `COALESCE(${q(startCol)}::text, '')` : `''::text`;
  const endExpr = endCol ? `COALESCE(${q(endCol)}::text, '')` : `''::text`;

  const searchCols = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
  const kwClause = keyword
    ? ` AND (${searchCols.map((c) => `COALESCE(${q(c)}::text, '') ILIKE '%${esc(keyword)}%'`).join(' OR ')})`
    : '';

  const sqlText = `
    SELECT
      COALESCE(${q(keyCol)}::text, '') AS "rowKey",
      ${nameExpr} AS "name",
      ${placeExpr} AS "place",
      ${periodExpr} AS "periodRaw",
      ${startExpr} AS "startRaw",
      ${endExpr} AS "endRaw"
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE COALESCE(${q(keyCol)}::text, '') <> '' ${kwClause}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      let startDate = tryFormatToYmd(String(row.startRaw ?? '')) ?? String(row.startRaw ?? '').trim();
      let endDate = tryFormatToYmd(String(row.endRaw ?? '')) ?? String(row.endRaw ?? '').trim();
      if (periodCol && String(row.periodRaw ?? '').trim()) {
        const { start, end } = splitUsagePeriod(String(row.periodRaw ?? ''));
        if (start) startDate = start;
        if (end) endDate = end;
      }
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        name: formatAddressStripSidoSigungu(String(row.name ?? '')),
        place: formatAddressStripSidoSigungu(String(row.place ?? '')),
        startDate,
        endDate,
        status: deriveOccupationPeriodState(endDate),
      };
    });
    return { rows: sortListRows(rows), title: binding.title };
  } catch (e: unknown) {
    return { rows: [], error: e instanceof Error ? e.message : String(e), title: binding.title };
  }
}

/** 점용종료일이 N일 이내인 공통점용 알림 목록 (하천·도로·국공유지) */
export async function getOccupationLedgerExpiryNotifications(params?: {
  withinDays?: number;
}): Promise<{ items: OccupationLedgerExpiryNotifRow[]; error?: string }> {
  const withinDays = Math.max(
    1,
    Math.min(365, Math.trunc(Number(params?.withinDays ?? EXPIRY_NOTIF_DEFAULT_WITHIN_DAYS)))
  );
  const todayMs = startOfLocalDayMs(new Date());
  if (todayMs == null) return { items: [] };

  const items: OccupationLedgerExpiryNotifRow[] = [];
  const errors: string[] = [];
  for (const prefix of OCCUPATION_LEDGER_PREFIXES) {
    const binding = getOccupationLedgerBinding({ prefix });
    if (!binding) continue;
    const list = await getOccupationLedgerList({ serEng: binding.serEng });
    if (list.error) {
      if (/테이블이 없습니다/.test(list.error)) continue;
      errors.push(list.error);
      continue;
    }
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
        prefix,
        systemScope: occupationLedgerPrefixToSystemKey(prefix),
      });
    }
  }

  items.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
    if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
    if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
    return a.rowKey.localeCompare(b.rowKey);
  });

  return errors.length ? { items, error: errors.join(' | ') } : { items };
}

/** 지도 이동용 extent — 점용 본표(geom)만. 필지·물건지 합치면 중심이 어긋남 */
export async function getOccupationLedgerExtent3857ByKey(params: {
  key?: string;
  serEng?: string;
  system?: string;
}): Promise<{ extent3857: [number, number, number, number] | null; error?: string }> {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { extent3857: null, error: resolved.error };
  }
  const binding = resolved.binding;
  const keyRaw =
    (await canonicalOccupationLedgerKey(binding, String(params?.key ?? ''))) ??
    String(params?.key ?? '').trim();
  if (!keyRaw) return { extent3857: null, error: '키가 필요합니다.' };

  const mainMeta = await resolveTableWithSchema(binding.mainTable);
  if (!mainMeta) {
    return { extent3857: null, error: '위치(도형)를 찾을 수 없습니다.' };
  }
  const cols = await getTableColumns(mainMeta.schema, mainMeta.tableName);
  const keyCol = findColumn(cols, binding.fields.keyField);
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

export async function getOccupationLedgerDetailByKey(params: {
  key?: string;
  serEng?: string;
  system?: string;
}): Promise<{
  attributes: OccupationLedgerDetailAttr[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  mgjItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: resolved.error };
  }
  const binding = resolved.binding;
  const keyRaw =
    (await canonicalOccupationLedgerKey(binding, String(params?.key ?? ''))) ??
    String(params?.key ?? '').trim();
  if (!keyRaw) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: '키가 필요합니다.' };
  }

  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) {
    return {
      attributes: [],
      parcelItems: [],
      mgjItems: [],
      error: `${binding.mainTable} 테이블이 없습니다.`,
    };
  }

  const fieldDefs = await getEditableFieldDefinitionsForTable({
    table: binding.mainTable,
    schema: DEFAULT_SCHEMA,
    excludeFields: ['ogc_fid', 'id', 'extra'],
    includeHiddenDetail: true,
  });
  if (fieldDefs.error) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: fieldDefs.error };
  }

  const { tableName, schema } = meta;
  const columns = await getTableColumns(schema, tableName);
  const keyCol = findColumn(columns, binding.fields.keyField);
  if (!keyCol) {
    return {
      attributes: [],
      parcelItems: [],
      mgjItems: [],
      error: `${binding.fields.keyField} 컬럼이 없습니다.`,
    };
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
    const endField = binding.fields.endField ?? 'perm_end_date';
    const endKey =
      Object.keys(row).find((k) => k.toLowerCase() === endField.toLowerCase()) ?? endField;
    const endRaw = row[endKey];
    const endYmd =
      tryFormatToYmd(endRaw) ?? (endRaw == null ? '' : String(endRaw).trim());
    const periodState = deriveOccupationPeriodState(endYmd);
    const addressFields = new Set(['occup_place', 'applicant_addr', 'work_name']);
    const attributes: OccupationLedgerDetailAttr[] = dataFields.map((field) => {
      const def = metaByField.get(field.toLowerCase());
      const fl = field.toLowerCase();
      const isState = fl === 'state';
      let value = isState
        ? periodState
        : row[field] == null
          ? ''
          : String(row[field]);
      if (!isState && addressFields.has(fl) && value) {
        value = formatAddressStripSidoSigungu(value) || value;
      }
      return {
        field,
        label: labelForOccupationLedgerField(field),
        value,
        showDetail: def?.showDetail !== false,
        required: def?.required === true,
      };
    });

    const permitKey =
      Object.keys(row).find((k) => k.toLowerCase() === 'permit_no') ?? 'permit_no';
    const childParentKey = String(row[permitKey] ?? '').trim();
    if (!childParentKey) {
      return { attributes, parcelItems: [], mgjItems: [] };
    }

    const [parcels, mgj] = await Promise.all([
      getChildAddressItems({
        childTableName: binding.jijukTable,
        parentKey: childParentKey,
        parentField: binding.fields.childParentField,
        addressField: binding.fields.childAddressField,
      }),
      getChildAddressItems({
        childTableName: binding.mgjTable,
        parentKey: childParentKey,
        parentField: binding.fields.childParentField,
        addressField: binding.fields.childAddressField,
      }),
    ]);

    return {
      attributes,
      parcelItems: parcels.items,
      mgjItems: mgj.items,
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

/**
 * 허가번호 다음 번호 — 허가시작일 연도 기준 «YYYY-NN».
 * 해당 연도 접두가 없으면 01, 해가 바뀌면 다시 01부터.
 */
export async function getNextOccupationLedgerPermitNo(params?: {
  year?: number;
  serEng?: string;
  system?: string;
  excludeKey?: string;
}): Promise<{ permitNo: string; error?: string }> {
  const year = Number(params?.year);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    return { permitNo: '', error: '시작일 연도가 필요합니다.' };
  }

  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { permitNo: '', error: resolved.error };
  }
  const binding = resolved.binding;
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) {
    return {
      permitNo: formatOccupationPermitNo(year, 1),
      error: `${binding.mainTable} 테이블이 없습니다.`,
    };
  }

  const cols = await getTableColumns(meta.schema, meta.tableName);
  const permitCol = findColumn(cols, 'permit_no');
  if (!permitCol) {
    return { permitNo: formatOccupationPermitNo(year, 1), error: 'permit_no 컬럼이 없습니다.' };
  }
  const keyCol = findColumn(cols, binding.fields.keyField);
  const exclude = String(params?.excludeKey ?? '').trim();

  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  const prefix = `${year}-`;
  const excludeClause =
    exclude && keyCol
      ? ` AND COALESCE(${quoteIdent(keyCol)}::text, '') <> '${esc(exclude)}'`
      : '';

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT COALESCE(${quoteIdent(permitCol)}::text, '') AS code
         FROM "${safeSchema}"."${safe}"
         WHERE COALESCE(${quoteIdent(permitCol)}::text, '') LIKE '${esc(prefix)}%'
         ${excludeClause}
         LIMIT 5000`
      )
    );
    let maxSeq = 0;
    for (const row of res.rows ?? []) {
      const code = String((row as { code?: string }).code ?? '').trim();
      const seq = parseOccupationPermitNoSeq(code, year);
      if (seq != null && seq > maxSeq) maxSeq = seq;
    }
    return { permitNo: formatOccupationPermitNo(year, maxSeq + 1) };
  } catch (e: unknown) {
    return {
      permitNo: formatOccupationPermitNo(year, 1),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 신규 미리보기용 — 이전 키(숫자)가 5면 6. ogc_fid·id 숫자 최대+1 */
export async function getNextOccupationLedgerKey(params?: {
  serEng?: string;
  system?: string;
}): Promise<{ key: string; error?: string }> {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { key: '', error: resolved.error };
  }
  const binding = resolved.binding;
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return { key: '1' };

  const cols = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(cols, binding.fields.keyField);
  const ogcCol = findColumn(cols, 'ogc_fid');
  if (!keyCol && !ogcCol) return { key: '1' };

  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  const maxParts: string[] = [];
  if (ogcCol) {
    maxParts.push(`COALESCE(MAX(${quoteIdent(ogcCol)}), 0)`);
  }
  if (keyCol) {
    maxParts.push(`COALESCE(
      MAX(
        CASE
          WHEN COALESCE(${quoteIdent(keyCol)}::text, '') ~ '^[0-9]+$'
          THEN (${quoteIdent(keyCol)}::text)::bigint
          ELSE 0
        END
      ),
      0
    )`);
  }

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT GREATEST(${maxParts.join(', ')}) + 1 AS n
         FROM "${safeSchema}"."${safe}"`
      )
    );
    const n = Number((res.rows?.[0] as { n?: string | number } | undefined)?.n ?? 1);
    if (!Number.isFinite(n) || n < 1) return { key: '1' };
    return { key: String(Math.floor(n)) };
  } catch {
    // 폴백: 접미사 증가
    if (!keyCol) return { key: '1' };
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT COALESCE(${quoteIdent(keyCol)}::text, '') AS k
           FROM "${safeSchema}"."${safe}"
           WHERE COALESCE(${quoteIdent(keyCol)}::text, '') <> ''
           ORDER BY ${quoteIdent(keyCol)} DESC
           LIMIT 200`
        )
      );
      const keys = (res.rows ?? [])
        .map((r) => String((r as { k?: string }).k ?? '').trim())
        .filter(Boolean);
      if (keys.length === 0) return { key: '1' };
      const next = incrementSuffixCode(keys[0]!);
      return { key: next && next !== keys[0] ? next : '1' };
    } catch {
      return { key: '1' };
    }
  }
}

/** 물건지 sync — *_occupationledger_mgj (필지와 동일하게 jijuk 폴리곤 저장) */
export async function syncOccupationLedgerMgjByKey(params: {
  key?: string;
  serEng?: string;
  system?: string;
  items?: Array<{ address: string; pnu?: string; x4326?: number; y4326?: number }>;
}): Promise<{ success: boolean; error?: string }> {
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { success: false, error: resolved.error ?? '점용대장 설정을 확인할 수 없습니다.' };
  }
  const binding = resolved.binding;
  const parentKey = String(params?.key ?? '').trim();
  if (!parentKey) return { success: false, error: '키가 필요합니다.' };

  const extraValues: Record<string, string> = {};
  const parentMeta = await resolveTableWithSchema(binding.mainTable);
  if (parentMeta) {
    const cols = await getTableColumns(parentMeta.schema, parentMeta.tableName);
    const permitCol = findColumn(cols, 'permit_no');
    const keyCol = findColumn(cols, binding.fields.keyField);
    if (permitCol && keyCol) {
      try {
        const res = await db.execute(
          sql.raw(
            `SELECT COALESCE(${quoteIdent(permitCol)}::text, '') AS p
             FROM "${parentMeta.schema.replace(/"/g, '""')}"."${parentMeta.tableName.replace(/"/g, '""')}"
             WHERE ${quoteIdent(keyCol)}::text = '${esc(parentKey)}'
             LIMIT 1`
          )
        );
        const p = String((res.rows?.[0] as { p?: string } | undefined)?.p ?? '').trim();
        if (p) extraValues.permit_no = p;
      } catch {
        /* ignore */
      }
    }
  }

  const childParentId = extraValues.permit_no;
  if (!childParentId) {
    return { success: false, error: '허가번호가 없어 물건지를 저장할 수 없습니다.' };
  }
  const items = (params.items ?? []).filter((it) => String(it?.address ?? '').trim());
  if (items.length === 0) {
    return syncChildParcelsByParentId({
      schema: DEFAULT_SCHEMA,
      childTableName: binding.mgjTable,
      childParentField: binding.fields.childParentField,
      childAddressField: binding.fields.childAddressField,
      parentId: childParentId,
      parcels: [],
      extraValues,
    });
  }

  const geomResolved = await resolveJijukParcelGeomsByAddresses({
    items: items.map((item) => ({
      address: String(item.address).trim(),
      pnu: String(item.pnu ?? '').trim() || undefined,
      lon: item.x4326,
      lat: item.y4326,
    })),
  });

  const parcels = items.map((item, index) => {
    const resolvedRow = geomResolved.parcels[index];
    return {
      address: String(item.address).trim(),
      pnu: String(resolvedRow?.pnu ?? item.pnu ?? '').trim() || undefined,
      lon: item.x4326,
      lat: item.y4326,
    };
  });

  const result = await syncChildParcelsByParentId({
    schema: DEFAULT_SCHEMA,
    childTableName: binding.mgjTable,
    childParentField: binding.fields.childParentField,
    childAddressField: binding.fields.childAddressField,
    parentId: childParentId,
    parcels,
    extraValues,
  });

  if (result.error) return { success: false, error: result.error };
  if (geomResolved.error) return { success: true, error: geomResolved.error };
  return { success: true };
}

export type OccupationLedgerGeomFillCounts = {
  filled: number;
  cleared: number;
  total: number;
};

async function resolveOccupPlaceGeomWkt5181(
  occupPlace: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  const raw = String(occupPlace ?? '').trim();
  if (!raw) return null;
  if (cache.has(raw)) return cache.get(raw) ?? null;
  const parts = parseOccupPlacePartsForJijuk(raw);
  if (parts.length === 0) {
    cache.set(raw, null);
    return null;
  }
  const wkts: string[] = [];
  for (const parsed of parts) {
    const partKey = [
      parsed.emdName,
      parsed.riName,
      parsed.bonbun,
      parsed.bubun,
      parsed.isMountain ? '2' : '1',
    ].join('|');
    let wkt: string | null;
    if (cache.has(partKey)) {
      wkt = cache.get(partKey) ?? null;
    } else {
      const pnu = await resolvePnuForOccupPlacePart(parsed);
      wkt = pnu ? String((await getJijukGeomByPnu(pnu, 5181)) ?? '').trim() || null : null;
      cache.set(partKey, wkt);
    }
    if (wkt) wkts.push(wkt);
  }
  if (wkts.length === 0) {
    cache.set(raw, null);
    return null;
  }
  const unioned = wkts.length === 1 ? wkts[0]! : await unionWkts5181(wkts);
  cache.set(raw, unioned);
  return unioned;
}

async function resolvePnuForOccupPlacePart(parsed: {
  emdName: string;
  riName: string;
  bonbun: string;
  bubun: string;
  isMountain: boolean;
}): Promise<string | null> {
  if (parsed.emdName) {
    const pnuRes = await resolvePnuFromParsedParts(parsed);
    const pnu = String(pnuRes.pnu ?? '').trim();
    if (pnu) return pnu;
  }
  const riCd = await resolveUniqueRiCdByName(parsed.riName);
  if (!riCd) return null;
  return buildPnu19(riCd, parsed);
}

async function resolveUniqueRiCdByName(riName: string): Promise<string | null> {
  const nameCols = ['ri_nm', 'adm_nm', 'name'] as const;
  const found = new Set<string>();
  for (const candidate of riNameLookupCandidates(riName)) {
    for (const col of nameCols) {
      try {
        const res = await db.execute(
          sql.raw(
            `SELECT DISTINCT "ri_cd" AS code
             FROM "public_layer"."ri"
             WHERE "${col}" = '${esc(candidate)}'`
          )
        );
        for (const row of (res.rows ?? []) as { code?: string }[]) {
          const code = String(row.code ?? '').trim();
          if (code) found.add(code);
        }
      } catch {
        continue;
      }
    }
    if (found.size === 1) return [...found][0]!;
    if (found.size > 1) return null;
  }
  return found.size === 1 ? [...found][0]! : null;
}

async function unionWkts5181(wkts: string[]): Promise<string | null> {
  const geoms = wkts
    .map(
      (w) => `ST_MakeValid(ST_SetSRID(ST_GeomFromText('${esc(w)}'), 5181))`
    )
    .join(', ');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(
           ST_Multi(
             ST_CollectionExtract(
               ST_MakeValid(ST_Union(ARRAY[${geoms}])),
               3
             )
           )
         ) AS wkt`
      )
    );
    const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim();
    return wkt || null;
  } catch {
    return null;
  }
}

function geomFromWkt5181Sql(wkt: string): string {
  return `ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromText('${esc(wkt)}'), 5181)),
      3
    )
  )`;
}

async function fillTableGeomFromOccupPlace(opts: {
  tableWanted: string;
  keyField: string;
  placeField: string;
  cache: Map<string, string | null>;
}): Promise<OccupationLedgerGeomFillCounts | { error: string }> {
  const meta = await resolveTableWithSchema(opts.tableWanted);
  if (!meta) {
    return { filled: 0, cleared: 0, total: 0 };
  }
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(cols, opts.keyField);
  const placeCol = findColumn(cols, opts.placeField);
  const geomCol = findColumn(cols, 'geom');
  if (!keyCol || !placeCol || !geomCol) {
    return { error: `${opts.tableWanted}에 키·점용장소·도형 칸이 없습니다.` };
  }
  const safeSchema = meta.schema.replace(/"/g, '""');
  const safeTable = meta.tableName.replace(/"/g, '""');
  const res = await db.execute(
    sql.raw(
      `SELECT ${quoteIdent(keyCol)}::text AS k,
              COALESCE(${quoteIdent(placeCol)}::text, '') AS p
       FROM "${safeSchema}"."${safeTable}"
       ORDER BY ${quoteIdent(keyCol)}`
    )
  );
  const rows = (res.rows ?? []) as { k?: string; p?: string }[];
  let filled = 0;
  let cleared = 0;
  for (const row of rows) {
    const id = String(row.k ?? '').trim();
    if (!id) continue;
    const wkt = await resolveOccupPlaceGeomWkt5181(String(row.p ?? ''), opts.cache);
    if (wkt) {
      await db.execute(
        sql.raw(
          `UPDATE "${safeSchema}"."${safeTable}"
           SET ${quoteIdent(geomCol)} = ${geomFromWkt5181Sql(wkt)}
           WHERE ${quoteIdent(keyCol)}::text = '${esc(id)}'`
        )
      );
      filled += 1;
    } else {
      await db.execute(
        sql.raw(
          `UPDATE "${safeSchema}"."${safeTable}"
           SET ${quoteIdent(geomCol)} = NULL
           WHERE ${quoteIdent(keyCol)}::text = '${esc(id)}'`
        )
      );
      cleared += 1;
    }
  }
  return { filled, cleared, total: rows.length };
}

export type OccupationLedgerStateFillCounts = {
  inProgress: number;
  ended: number;
  total: number;
};

/** 본표 종료일 기준 — 오늘을 지나지 않았으면 진행중, 지났으면 종료 */
async function fillMainTableStateFromEndDate(
  binding: OccupationLedgerBinding
): Promise<OccupationLedgerStateFillCounts | { error: string }> {
  const empty = { inProgress: 0, ended: 0, total: 0 };
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return empty;
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(cols, binding.fields.keyField);
  const endCol = findColumn(cols, binding.fields.endField ?? 'perm_end_date');
  const stateCol = findColumn(cols, 'state');
  if (!keyCol || !endCol || !stateCol) {
    return { error: `${binding.mainTable}에 키·종료일·상태 칸이 없습니다.` };
  }
  const safeSchema = meta.schema.replace(/"/g, '""');
  const safeTable = meta.tableName.replace(/"/g, '""');
  const res = await db.execute(
    sql.raw(
      `SELECT ${quoteIdent(keyCol)}::text AS k,
              ${quoteIdent(endCol)} AS e
       FROM "${safeSchema}"."${safeTable}"
       ORDER BY ${quoteIdent(keyCol)}`
    )
  );
  const rows = (res.rows ?? []) as { k?: string; e?: unknown }[];
  let inProgress = 0;
  let ended = 0;
  for (const row of rows) {
    const id = String(row.k ?? '').trim();
    if (!id) continue;
    const endYmd = tryFormatToYmd(row.e) ?? String(row.e ?? '').trim().slice(0, 10);
    const state = deriveOccupationPeriodState(endYmd);
    if (state === OCCUPATION_PERIOD_STATE_ENDED) ended += 1;
    else inProgress += 1;
    await db.execute(
      sql.raw(
        `UPDATE "${safeSchema}"."${safeTable}"
         SET ${quoteIdent(stateCol)} = '${esc(state)}'
         WHERE ${quoteIdent(keyCol)}::text = '${esc(id)}'`
      )
    );
  }
  return { inProgress, ended, total: rows.length };
}

/** 점용장소 → 지적 도형. 못 맞추면 도형을 비운다. 본표 상태는 종료일 기준으로 넣는다. */
export async function fillOccupationLedgerGeomFromOccupPlace(params?: {
  serEng?: string;
  system?: string;
}): Promise<{
  main: OccupationLedgerGeomFillCounts;
  jijuk: OccupationLedgerGeomFillCounts;
  state: OccupationLedgerStateFillCounts;
  error?: string;
}> {
  const empty = { filled: 0, cleared: 0, total: 0 };
  const emptyState = { inProgress: 0, ended: 0, total: 0 };
  const resolved = resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { main: empty, jijuk: empty, state: emptyState, error: resolved.error };
  }
  const binding = resolved.binding;
  const cache = new Map<string, string | null>();
  const main = await fillTableGeomFromOccupPlace({
    tableWanted: binding.mainTable,
    keyField: binding.fields.keyField,
    placeField: binding.fields.placeField,
    cache,
  });
  if ('error' in main) {
    return { main: empty, jijuk: empty, state: emptyState, error: main.error };
  }
  const jijuk = await fillTableGeomFromOccupPlace({
    tableWanted: binding.jijukTable,
    keyField: 'ogc_fid',
    placeField: binding.fields.childAddressField,
    cache,
  });
  if ('error' in jijuk) {
    return { main, jijuk: empty, state: emptyState, error: jijuk.error };
  }
  const state = await fillMainTableStateFromEndDate(binding);
  if ('error' in state) {
    return { main, jijuk, state: emptyState, error: state.error };
  }
  return { main, jijuk, state };
}
