/**
 * 공통 점용대장 — config 바인딩 테이블로 목록·상세·extent
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { tryFormatToYmd } from '@/lib/formatDateYmd';
import { incrementSuffixCode } from '@/lib/incrementSuffixCode';
import {
  formatOccupationPermitNo,
  parseOccupationPermitNoSeq,
} from '@/lib/occupationPermitNo';
import {
  adaptOccupationLedgerBindingToColumns,
  getOccupationLedgerBinding,
  OCCUPATION_LEDGER_PREFIXES,
  occupationLedgerPrefixToSystemKey,
  type OccupationLedgerBinding,
  type OccupationLedgerPrefix,
} from '@/lib/occupationLedgerBinding';
import { splitUsagePeriod } from '@/lib/usageDataAsFieldUtils';
import {
  getEditableFieldDefinitionsForTable,
  resolveJijukParcelGeomsByAddresses,
  syncChildParcelsByParentId,
  buildChildOfParentWhereSql,
} from './layerRowService';
import { labelForOccupationLedgerField } from '@/app/(pages)/map/_mapContents/occupationLedger/occupationLedgerFieldLabels';
import {
  deriveOccupationPeriodState,
  isOpenEndedOccupationPeriod,
  OCCUPATION_PERIOD_STATE_ENDED,
  parseOccupationPeriodYmd,
} from '@/lib/occupationLedgerPeriodState';
import { sortOccupationLedgerListRows } from '@/lib/occupationLedgerListSort';
import { parseOccupPlacePartsForJijuk } from '@/lib/occupationLedgerOccupPlaceGeom';
import { riNameLookupCandidates, buildPnu19 } from '@/lib/excelUploadAddressNormalize';
import {
  getJijukGeomByPnu,
  resolvePnuFromParsedParts,
} from './excelUploadService';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

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
  /** 목록 열 값 (칸 이름 → 글자) */
  values?: Record<string, string>;
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
  /** 공통 칸 여부 */
  common?: boolean;
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

async function resolveBinding(params?: {
  serEng?: string;
  system?: string;
}): Promise<
  | { binding: OccupationLedgerBinding; error?: undefined }
  | { binding?: undefined; error: string }
> {
  const binding = getOccupationLedgerBinding({
    serEng: params?.serEng,
    system: params?.system,
  });
  if (!binding) {
    return { error: '점용대장 서비스(occupationLedger*)를 확인할 수 없습니다.' };
  }
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return { binding };
  const columns = await getTableColumns(meta.schema, meta.tableName);
  const jijukCache = new Map<string, boolean>();
  const jijukTableExists = (table: string): boolean => {
    // sync 콜백용 — 아래에서 await 로 미리 채움
    return jijukCache.get(table) === true;
  };
  for (const name of ['usage_data_as_solo', 'usage_data_solo_as']) {
    jijukCache.set(name, (await resolveTableWithSchema(name)) != null);
  }
  return {
    binding: adaptOccupationLedgerBindingToColumns(binding, columns, {
      jijukTableExists,
    }),
  };
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
  const permitCol = findColumn(cols, binding.fields.permitField);
  // 관리번호(ftr_idn)로 들어와도 찾음. 국공유지는 기존 id
  const idCol = findColumn(cols, binding.fields.mgmtField ?? 'id');
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
  // 고유키(ogc_fid)로 들어와도 찾음 (데이터 조회 등)
  const ogcCol = findColumn(cols, 'ogc_fid');
  if (ogcCol && ogcCol.toLowerCase() !== keyCol.toLowerCase() && /^\d+$/.test(key)) {
    const byOgc = await lookup(ogcCol);
    if (byOgc) return byOgc;
  }
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
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { key: null, error: resolved.error };
  }
  const key = await canonicalOccupationLedgerKey(resolved.binding, String(params?.key ?? ''));
  return { key };
}

/** 필지·물건지의 본표 고유키 연결 칸 — 설정한 칸만 (없으면 연결 없음) */
function resolveChildParentCol(columns: string[], hint: string): string | null {
  const ordered = [hint, 'cons_code', 'ftr_idn', 'id']
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

/** 주소 칸이 없으면 읍면동·리·지번 같은 칸을 이어 붙인 식 */
function childAddressSqlExpr(
  cols: string[],
  addressField: string,
  partFields: string[] | undefined,
  alias: string
): string | null {
  const addressCol = resolveChildAddressCol(cols, addressField);
  if (addressCol) return `COALESCE(${alias}.${quoteIdent(addressCol)}::text, '')`;
  const parts = (partFields ?? []).map((f) => findColumn(cols, f)).filter((c): c is string => Boolean(c));
  if (parts.length === 0) return null;
  return `BTRIM(concat_ws(' ', ${parts.map((c) => `NULLIF(BTRIM(${alias}.${quoteIdent(c)}::text), '')`).join(', ')}))`;
}

export type OccupationLedgerListColumnMeta = {
  field: string;
  label: string;
  /** 점용 시작·종료 칸 — 날짜 순 정렬 */
  edge?: 'start' | 'end';
};

/** 목록 열 — 필드 정의 «목록» 보기 칸(정의 순서), 실제 DB 칸만 */
async function resolveDefineListColumns(
  table: string,
  columns: string[],
  exclude: string[] = []
): Promise<OccupationLedgerListColumnMeta[]> {
  const defs = await getEditableFieldDefinitionsForTable({
    table,
    schema: DEFAULT_SCHEMA,
    includeHiddenDetail: true,
  });
  const skip = new Set(['ogc_fid', 'geom', 'extra', ...exclude.map((x) => x.toLowerCase())]);
  return [...defs.fields]
    .filter((d) => d.showList === true)
    .sort((a, b) => (a.idx !== b.idx ? a.idx - b.idx : a.field.localeCompare(b.field)))
    .map((d) => ({ col: findColumn(columns, d.field), label: d.label }))
    .filter((x): x is { col: string; label: string } => Boolean(x.col) && !skip.has(String(x.col).toLowerCase()))
    .map((x) => ({ field: x.col, label: labelForOccupationLedgerField(x.col, x.label) }));
}

function listValuesSqlExpr(alias: string, fields: string[]): string {
  if (fields.length === 0) return `'{}'::json`;
  return `json_build_object(${fields
    .map((f) => `'${esc(f)}', COALESCE(${alias}.${quoteIdent(f)}::text, '')`)
    .join(', ')})`;
}

function rowListValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = formatAddressStripSidoSigungu(String(v ?? '')) || String(v ?? '');
  }
  return out;
}

async function getChildAddressItems(params: {
  childTableName: string;
  parentKey: string;
  parentField: string;
  addressField: string;
  addressPartFields?: string[];
  /** 연결 칸이 비어 있고 허가번호로만 묶인 예전 행도 포함 */
  legacyPermit?: string;
  /** 목록 열 칸 (필드 정의 «목록») */
  listFields?: string[];
}): Promise<{
  items: {
    address: string;
    extent3857: [number, number, number, number] | null;
    wmsRowKey?: { keyField: string; keyValue: string };
    listValues?: Record<string, string>;
  }[];
}> {
  const meta = await resolveTableWithSchema(params.childTableName);
  if (!meta) return { items: [] };

  const { tableName, schema } = meta;
  const cols = await getTableColumns(schema, tableName);
  const parentCol = resolveChildParentCol(cols, params.parentField);
  const addressExpr = childAddressSqlExpr(cols, params.addressField, params.addressPartFields, 'r');
  if (!parentCol || !addressExpr) return { items: [] };

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
    permitCol: findColumn(cols, 'permit_no'),
    permitValue: params.legacyPermit,
    alias: 'r',
  });

  const listFields = (params.listFields ?? [])
    .map((f) => findColumn(cols, f))
    .filter((c): c is string => Boolean(c));
  const sqlText = `
    SELECT ${addressExpr} AS addr ${extentSelect}${ogcFidSelect}, ${listValuesSqlExpr('r', listFields)} AS vals
    FROM "${safeSchema}"."${safe}" r
    WHERE ${childOfParentSql}
      AND ${addressExpr} <> ''
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
      return {
        address,
        extent3857,
        ...(wmsRowKey ? { wmsRowKey } : {}),
        listValues: rowListValues(row.vals),
      };
    });
    // 같은 주소라도 행(시설)이 다르면 각각 보여 준다 — 필지 상세가 행 단위
    const seen = new Set<string>();
    const unique = items.filter((x) => {
      if (!x.address) return false;
      const key = x.wmsRowKey?.keyValue ?? x.address.toLowerCase().replace(/\s+/g, ' ');
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
  const resolved = await resolveBinding(params);
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
    childParentField: b.fields.childParentField,
    childAddressField: b.fields.childAddressField,
    placeField: b.fields.placeField,
    permitField: b.fields.permitField,
    editPresetKey: b.editPresetKey,
    wmsLayerIds: [b.mainTable, b.jijukTable, b.mgjTable],
  };
}

export async function getOccupationLedgerList(params?: {
  keyword?: string;
  serEng?: string;
  system?: string;
}): Promise<{
  rows: OccupationLedgerListRow[];
  /** 목록 열 — 필드 정의 «목록» 칸 (상태는 따로 맨 앞). 정의가 없으면 점용명·점용장소·시작일·종료일 */
  columns?: OccupationLedgerListColumnMeta[];
  error?: string;
  title?: string;
}> {
  const resolved = await resolveBinding(params);
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
  const startCol = f.startField ? findColumn(columns, f.startField) : null;
  const endCol = f.endField ? findColumn(columns, f.endField) : null;
  const periodCol = f.periodField ? findColumn(columns, f.periodField) : null;
  if (!keyCol) return { rows: [], error: `${f.keyField} 컬럼이 없습니다.`, title: binding.title };

  const safe = tableName.replace(/"/g, '""');
  const safeSchema = schema.replace(/"/g, '""');
  const t = 't';
  const q = (name: string) => `${t}.${quoteIdent(name)}`;
  const nameExpr = nameCol ? `COALESCE(${q(nameCol)}::text, '')` : `''::text`;
  const placeExpr = placeCol ? `COALESCE(${q(placeCol)}::text, '')` : `''::text`;
  const startExpr = startCol ? `COALESCE(${q(startCol)}::text, '')` : `''::text`;
  const endExpr = endCol ? `COALESCE(${q(endCol)}::text, '')` : `''::text`;
  const periodExpr = periodCol ? `COALESCE(${q(periodCol)}::text, '')` : `''::text`;

  // 목록 열 — 필드 정의 «목록». 상태는 맨 앞 배지로 따로 보이므로 뺀다
  const defineColumns = await resolveDefineListColumns(binding.mainTable, columns, [f.stateField]);
  const fallbackColumns = [f.nameField, f.placeField, f.startField, f.endField, f.periodField]
    .map((x) => (x ? findColumn(columns, x) : null))
    .filter((c): c is string => Boolean(c))
    .map((c) => ({ field: c, label: labelForOccupationLedgerField(c) }));
  const listColumns: OccupationLedgerListColumnMeta[] = (
    defineColumns.length > 0 ? defineColumns : fallbackColumns
  ).map((c) => {
    const lower = c.field.toLowerCase();
    const edge =
      startCol && lower === startCol.toLowerCase()
        ? ('start' as const)
        : endCol && lower === endCol.toLowerCase()
          ? ('end' as const)
          : undefined;
    return edge ? { ...c, edge } : c;
  });

  const searchCols = columns.filter((c) => !GEOM_COLUMN_NAMES.has(c.toLowerCase()));
  const kwClause = keyword
    ? ` AND (${searchCols.map((c) => `COALESCE(${q(c)}::text, '') ILIKE '%${esc(keyword)}%'`).join(' OR ')})`
    : '';

  const sqlText = `
    SELECT
      COALESCE(${q(keyCol)}::text, '') AS "rowKey",
      ${nameExpr} AS "name",
      ${placeExpr} AS "place",
      ${startExpr} AS "startRaw",
      ${endExpr} AS "endRaw",
      ${periodExpr} AS "periodRaw",
      ${listValuesSqlExpr(t, listColumns.map((c) => c.field))} AS "vals"
    FROM "${safeSchema}"."${safe}" ${t}
    WHERE COALESCE(${q(keyCol)}::text, '') <> '' ${kwClause}
    LIMIT 5000`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const rows = (res.rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      // 시작·종료는 글자 그대로 (날짜·영구·허가일로부터 ○개월 등)
      let startDate = String(row.startRaw ?? '').trim();
      let endDate = String(row.endRaw ?? '').trim();
      // 울진 옛 점용기간(usage_pd) 한 칸 → 시작·종료 분리
      if (periodCol && !startCol && !endCol) {
        const split = splitUsagePeriod(String(row.periodRaw ?? ''));
        startDate = split.start;
        endDate = split.end;
      }
      return {
        rowKey: String(row.rowKey ?? '').trim(),
        name: formatAddressStripSidoSigungu(String(row.name ?? '')),
        place: formatAddressStripSidoSigungu(String(row.place ?? '')),
        startDate,
        endDate,
        status: deriveOccupationPeriodState(endDate),
        values: rowListValues(row.vals),
      };
    });
    return { rows: sortListRows(rows), columns: listColumns, title: binding.title };
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
      if (isOpenEndedOccupationPeriod(row.endDate)) continue;
      const endYmd = parseOccupationPeriodYmd(row.endDate, 'end');
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
  const resolved = await resolveBinding(params);
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

export type OccupationLedgerFieldMeta = {
  field: string;
  label: string;
  type: string;
  readOnly: boolean;
  required: boolean;
  showDetail: boolean;
  /** 공통 칸 여부 (하천·도로·국공유지가 같은 뜻으로 쓰는 칸) */
  common: boolean;
};

/** 공통 칸 표시 순서 */
function commonFieldOrder(binding: OccupationLedgerBinding): string[] {
  const f = binding.fields;
  return [
    f.mgmtField,
    f.permitField,
    f.permitDateField,
    f.nameField,
    f.placeField,
    f.purposeField,
    f.startField,
    f.endField,
    f.areaField,
    f.ownerNameField,
    f.ownerAddrField,
    f.stateField,
    f.remarkField,
  ].filter((x): x is string => Boolean(x));
}

/**
 * 본표 칸 목록 — 공통 칸(설정 순서) + 필드 정의의 나머지 칸. 실제 DB 칸만.
 * 필드 정의가 아직 옛 칸 이름이어도 공통 칸은 DB 칸 기준으로 보인다.
 */
async function resolveMainFieldList(
  binding: OccupationLedgerBinding,
  columns: string[]
): Promise<{ fields: OccupationLedgerFieldMeta[]; error?: string }> {
  const fieldDefs = await getEditableFieldDefinitionsForTable({
    table: binding.mainTable,
    schema: DEFAULT_SCHEMA,
    excludeFields: ['ogc_fid', 'id', 'extra'],
    includeHiddenDetail: true,
  });
  if (fieldDefs.error) return { fields: [], error: fieldDefs.error };
  const defByField = new Map(fieldDefs.fields.map((d) => [d.field.toLowerCase(), d]));
  const out: OccupationLedgerFieldMeta[] = [];
  const used = new Set<string>();
  for (const name of commonFieldOrder(binding)) {
    const col = findColumn(columns, name);
    if (!col || used.has(col.toLowerCase())) continue;
    used.add(col.toLowerCase());
    const def = defByField.get(col.toLowerCase());
    out.push({
      field: col,
      label: labelForOccupationLedgerField(col, def?.label),
      type: def?.type ?? 'text',
      readOnly: def?.readOnly === true,
      required: def?.required === true,
      // 필드 정의에 있으면 상세 표시 여부를 따르고, 아직 정의에 없는 공통 칸은 보인다
      showDetail: def ? def.showDetail !== false : true,
      common: true,
    });
  }
  for (const def of fieldDefs.fields) {
    const col = findColumn(columns, def.field);
    if (!col || used.has(col.toLowerCase())) continue;
    used.add(col.toLowerCase());
    out.push({
      field: col,
      label: labelForOccupationLedgerField(col, def.label),
      type: def.type,
      readOnly: def.readOnly,
      required: def.required,
      showDetail: def.showDetail,
      common: false,
    });
  }
  return { fields: out };
}

/** 등록 화면 칸 목록 (공통 칸 + 필드 정의) */
export async function getOccupationLedgerFieldList(params?: {
  serEng?: string;
  system?: string;
}): Promise<{ fields: OccupationLedgerFieldMeta[]; error?: string }> {
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) return { fields: [], error: resolved.error };
  const meta = await resolveTableWithSchema(resolved.binding.mainTable);
  if (!meta) return { fields: [], error: `${resolved.binding.mainTable} 테이블이 없습니다.` };
  const columns = await getTableColumns(meta.schema, meta.tableName);
  return resolveMainFieldList(resolved.binding, columns);
}

export async function getOccupationLedgerDetailByKey(params: {
  key?: string;
  serEng?: string;
  system?: string;
}): Promise<{
  attributes: OccupationLedgerDetailAttr[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  mgjItems: { address: string; extent3857: [number, number, number, number] | null }[];
  /** 필지·물건지 목록 열 — 각 테이블 필드 정의 «목록» (없으면 주소만) */
  parcelColumns?: OccupationLedgerListColumnMeta[];
  mgjColumns?: OccupationLedgerListColumnMeta[];
  /** 첨부파일 폴더 키 (본표 키 값) */
  fileKey?: string;
  error?: string;
}> {
  const resolved = await resolveBinding(params);
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

  const fieldList = await resolveMainFieldList(binding, columns);
  if (fieldList.error) {
    return { attributes: [], parcelItems: [], mgjItems: [], error: fieldList.error };
  }
  const dataFields = fieldList.fields.map((f) => f.field);
  // 공통 칸 링크용 — 필지 연결(국공유지 예전 허가번호)
  const permitSelect = findColumn(columns, binding.fields.permitField);
  if (permitSelect && !dataFields.some((f) => f.toLowerCase() === permitSelect.toLowerCase())) {
    dataFields.push(permitSelect);
  }
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

    const f = binding.fields;
    const metaByField = new Map(fieldList.fields.map((m) => [m.field.toLowerCase(), m]));
    const endField = f.endField ?? '';
    const endKey = Object.keys(row).find((k) => k.toLowerCase() === endField.toLowerCase());
    const endRaw = endKey ? row[endKey] : null;
    // 날짜 칸이던 시절 값(Date)도 글자로 맞춰 해석
    const endText =
      endRaw instanceof Date ? (tryFormatToYmd(endRaw) ?? '') : endRaw == null ? '' : String(endRaw).trim();
    const periodState = deriveOccupationPeriodState(endText);
    const addressFields = new Set(
      [f.placeField, f.ownerAddrField, f.nameField].filter(Boolean).map((x) => String(x).toLowerCase())
    );
    const stateLower = f.stateField.toLowerCase();
    const attributes: OccupationLedgerDetailAttr[] = fieldList.fields.map(({ field }) => {
      const def = metaByField.get(field.toLowerCase());
      const fl = field.toLowerCase();
      const isState = fl === stateLower;
      const cellRaw = row[field];
      let value = isState
        ? periodState
        : cellRaw == null
          ? ''
          : cellRaw instanceof Date
            ? (tryFormatToYmd(cellRaw) ?? '')
            : String(cellRaw);
      if (!isState && addressFields.has(fl) && value) {
        value = formatAddressStripSidoSigungu(value) || value;
      }
      return {
        field,
        label: def?.label ?? labelForOccupationLedgerField(field),
        value,
        showDetail: def?.showDetail !== false,
        required: def?.required === true,
        common: def?.common === true,
      };
    });

    // 필지·물건지는 본표 고유키로 연결. 허가번호로만 묶였던 예전 행(국공유지)은 허가번호로도 찾는다
    const permitKey = Object.keys(row).find((k) => k.toLowerCase() === f.permitField.toLowerCase());
    const legacyPermit = permitKey ? String(row[permitKey] ?? '').trim() : '';

    const childListColumns = async (table: string) => {
      const childMeta = await resolveTableWithSchema(table);
      if (!childMeta) return [];
      const childCols = await getTableColumns(childMeta.schema, childMeta.tableName);
      return resolveDefineListColumns(table, childCols, [f.childParentField]);
    };
    const [parcelColumns, mgjColumns] = await Promise.all([
      childListColumns(binding.jijukTable),
      childListColumns(binding.mgjTable),
    ]);

    const [parcels, mgj] = await Promise.all([
      getChildAddressItems({
        childTableName: binding.jijukTable,
        parentKey: keyRaw,
        parentField: f.childParentField,
        addressField: f.childAddressField,
        addressPartFields: f.childAddressPartFields,
        legacyPermit,
        listFields: parcelColumns.map((c) => c.field),
      }),
      getChildAddressItems({
        childTableName: binding.mgjTable,
        parentKey: keyRaw,
        parentField: f.childParentField,
        addressField: f.childAddressField,
        addressPartFields: f.childAddressPartFields,
        legacyPermit,
        listFields: mgjColumns.map((c) => c.field),
      }),
    ]);
    return {
      attributes,
      parcelItems: parcels.items,
      mgjItems: mgj.items,
      parcelColumns,
      mgjColumns,
      fileKey: keyRaw,
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
 * 필지·물건지 한 행 상세 — 필드 정의(상세 표시) 기준. 정의가 없으면 실제 칸 전부.
 * 받은 원천자료 칸을 그대로 쓰고, 보일 칸은 필드 정의로 정한다. extra(jsonb)가 있으면 뒤에 붙인다.
 */
/** 필지·물건지 편집 모달 칸 — 필드 정의 «상세보기» (실제 DB 칸만) */
export async function getOccupationLedgerChildFieldList(params?: {
  serEng?: string;
  system?: string;
  role?: 'jijuk' | 'mgj';
}): Promise<{ fields: OccupationLedgerFieldMeta[]; error?: string }> {
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) return { fields: [], error: resolved.error };
  const binding = resolved.binding;
  const tableWanted = params?.role === 'mgj' ? binding.mgjTable : binding.jijukTable;
  const meta = await resolveTableWithSchema(tableWanted);
  if (!meta) return { fields: [], error: `${tableWanted} 테이블이 없습니다.` };
  const columns = await getTableColumns(meta.schema, meta.tableName);
  const hidden = new Set(['ogc_fid', 'geom', 'extra', binding.fields.childParentField.toLowerCase()]);
  const defs = await getEditableFieldDefinitionsForTable({
    table: tableWanted,
    schema: DEFAULT_SCHEMA,
    excludeFields: [...hidden],
    includeHiddenDetail: true,
  });
  const fields: OccupationLedgerFieldMeta[] =
    defs.fields.length > 0
      ? defs.fields
          .filter((d) => d.showDetail)
          .map((d) => ({
            field: d.field,
            label: labelForOccupationLedgerField(d.field, d.label),
            type: String(d.type ?? 'text'),
            readOnly: d.readOnly === true,
            required: d.required === true,
            showDetail: true,
            common: false,
          }))
      : columns
          .filter((c) => !hidden.has(c.toLowerCase()) && !GEOM_COLUMN_NAMES.has(c.toLowerCase()))
          .map((c) => ({
            field: c,
            label: labelForOccupationLedgerField(c, c),
            type: 'text',
            readOnly: false,
            required: false,
            showDetail: true,
            common: false,
          }));
  return { fields };
}

export async function getOccupationLedgerChildDetail(params: {
  serEng?: string;
  system?: string;
  role?: 'jijuk' | 'mgj';
  ogcFid?: string | number;
}): Promise<{ attributes: OccupationLedgerDetailAttr[]; error?: string }> {
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) return { attributes: [], error: resolved.error };
  const binding = resolved.binding;
  const ogcFid = String(params?.ogcFid ?? '').trim();
  if (!/^\d+$/.test(ogcFid)) return { attributes: [], error: '필지 키가 필요합니다.' };
  const tableWanted = params?.role === 'mgj' ? binding.mgjTable : binding.jijukTable;
  const meta = await resolveTableWithSchema(tableWanted);
  if (!meta) return { attributes: [], error: `${tableWanted} 테이블이 없습니다.` };
  const columns = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(columns, 'ogc_fid');
  if (!keyCol) return { attributes: [], error: 'ogc_fid 컬럼이 없습니다.' };

  const hidden = new Set(['ogc_fid', 'geom', 'extra', binding.fields.childParentField.toLowerCase()]);
  // 필드 정의 «상세보기» 칸만. 정의 자체가 없는 테이블만 실제 칸 전부
  const defs = await getEditableFieldDefinitionsForTable({
    table: tableWanted,
    schema: DEFAULT_SCHEMA,
    excludeFields: [...hidden],
    includeHiddenDetail: true,
  });
  const fields: { field: string; label: string }[] =
    defs.fields.length > 0
      ? defs.fields
          .filter((d) => d.showDetail)
          .map((d) => ({ field: d.field, label: labelForOccupationLedgerField(d.field, d.label) }))
      : columns
          .filter((c) => !hidden.has(c.toLowerCase()) && !GEOM_COLUMN_NAMES.has(c.toLowerCase()))
          .map((c) => ({ field: c, label: labelForOccupationLedgerField(c, c) }));
  const extraCol = findColumn(columns, 'extra');
  const selectCols = [...fields.map((x) => x.field), ...(extraCol ? [extraCol] : [])];
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ${selectCols.length > 0 ? selectCols.map((c) => quoteIdent(c)).join(', ') : quoteIdent(keyCol)}
         FROM "${safeSchema}"."${safe}"
         WHERE ${quoteIdent(keyCol)} = ${Number(ogcFid)}
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { attributes: [], error: '해당 필지를 찾을 수 없습니다.' };
    const cellText = (v: unknown): string =>
      v == null ? '' : v instanceof Date ? (tryFormatToYmd(v) ?? '') : String(v);
    const attributes: OccupationLedgerDetailAttr[] = fields.map(({ field, label }) => ({
      field,
      label,
      value: cellText(row[field]),
    }));
    const extra = extraCol ? row[extraCol] : null;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
        attributes.push({ field: `extra.${k}`, label: k, value: cellText(v) });
      }
    }
    return { attributes };
  } catch (e: unknown) {
    return { attributes: [], error: e instanceof Error ? e.message : String(e) };
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

  const resolved = await resolveBinding(params);
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
  const permitCol = findColumn(cols, binding.fields.permitField);
  if (!permitCol) {
    return {
      permitNo: formatOccupationPermitNo(year, 1),
      error: `${binding.fields.permitField} 컬럼이 없습니다.`,
    };
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
/** 새 건 자동 채번 코드 — 연결 설정의 자동 채번 칸 마지막 번호 +1 (예: JY_000519 → JY_000520) */
export async function getNextOccupationLedgerAutoCode(params?: {
  serEng?: string;
  system?: string;
}): Promise<{ code: string; field?: string; error?: string }> {
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) return { code: '', error: resolved.error };
  const field = resolved.binding.autoCodeField;
  if (!field) return { code: '' };
  const meta = await resolveTableWithSchema(resolved.binding.mainTable);
  if (!meta) return { code: '', field, error: `${resolved.binding.mainTable} 테이블이 없습니다.` };
  const col = findColumn(await getTableColumns(meta.schema, meta.tableName), field);
  if (!col) return { code: '', field, error: `${field} 컬럼이 없습니다.` };
  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ${quoteIdent(col)}::text AS code
         FROM "${safeSchema}"."${safe}"
         WHERE COALESCE(${quoteIdent(col)}::text, '') <> ''
         ORDER BY
           (regexp_match(${quoteIdent(col)}::text, '([0-9]+)$'))[1]::bigint DESC NULLS LAST,
           ${quoteIdent(col)}::text DESC
         LIMIT 1`
      )
    );
    const last = String((res.rows?.[0] as { code?: string } | undefined)?.code ?? '').trim();
    return { code: last ? incrementSuffixCode(last) : (resolved.binding.autoCodeDefault ?? '1'), field: col };
  } catch (e: unknown) {
    return { code: '', field, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getNextOccupationLedgerKey(params?: {
  serEng?: string;
  system?: string;
}): Promise<{ key: string; error?: string }> {
  const resolved = await resolveBinding(params);
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
  const resolved = await resolveBinding(params);
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
    const permitCol = findColumn(cols, binding.fields.permitField);
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

  // 물건지는 본표 고유키로 연결 (허가번호는 있으면 함께 적음 — 예전 행 찾기용)
  const childParentId =
    (await canonicalOccupationLedgerKey(binding, parentKey)) ?? parentKey;
  const items = (params.items ?? []).filter((it) => String(it?.address ?? '').trim());
  if (items.length === 0) {
    return syncChildParcelsByParentId({
      schema: DEFAULT_SCHEMA,
      childTableName: binding.mgjTable,
      childParentField: binding.fields.childParentField,
      childAddressField: binding.fields.childAddressField,
      childAddressPartFields: binding.fields.childAddressPartFields,
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
    childAddressPartFields: binding.fields.childAddressPartFields,
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

/**
 * 본표 종료일(또는 점용기간 끝) 기준 — 오늘을 지나지 않았으면 진행중, 지났으면 종료.
 * 상태·종료 칸이 없으면 건너뛴다(옛 usage_pd 표 등).
 */
async function fillMainTableStateFromEndDate(
  binding: OccupationLedgerBinding
): Promise<OccupationLedgerStateFillCounts | { error: string }> {
  const empty = { inProgress: 0, ended: 0, total: 0 };
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return empty;
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(cols, binding.fields.keyField);
  const endCol = binding.fields.endField ? findColumn(cols, binding.fields.endField) : null;
  const periodCol = binding.fields.periodField
    ? findColumn(cols, binding.fields.periodField)
    : null;
  const stateCol = findColumn(cols, binding.fields.stateField);
  if (!keyCol || !stateCol) return empty;
  const dateCol = endCol ?? periodCol;
  if (!dateCol) return empty;
  const usePeriodSplit = !endCol && Boolean(periodCol);
  const safeSchema = meta.schema.replace(/"/g, '""');
  const safeTable = meta.tableName.replace(/"/g, '""');
  const res = await db.execute(
    sql.raw(
      `SELECT ${quoteIdent(keyCol)}::text AS k,
              ${quoteIdent(dateCol)} AS e
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
    const raw =
      row.e instanceof Date ? (tryFormatToYmd(row.e) ?? '') : String(row.e ?? '').trim();
    const endText = usePeriodSplit ? splitUsagePeriod(raw).end : raw;
    const state = deriveOccupationPeriodState(endText);
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

/** 하천점용 — 주소 칸은 usage_loc 우선, 없으면 바인딩 placeField */
async function resolveWaterPlaceFieldForGeomFill(
  binding: OccupationLedgerBinding
): Promise<string> {
  if (binding.serEng !== 'waterOccupationLedger') return binding.fields.placeField;
  const meta = await resolveTableWithSchema(binding.mainTable);
  if (!meta) return binding.fields.placeField;
  const cols = await getTableColumns(meta.schema, meta.tableName);
  return findColumn(cols, 'usage_loc') ?? binding.fields.placeField;
}

type LayerExtentBox = {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
};

/** 본표 도형 extent — GeoServer 선언 범위 갱신용 */
async function queryLayerGeomExtentBoxes(
  tableWanted: string
): Promise<{ native5181: LayerExtentBox; latLon4326: LayerExtentBox } | null> {
  const meta = await resolveTableWithSchema(tableWanted);
  if (!meta) return null;
  const cols = await getTableColumns(meta.schema, meta.tableName);
  const geomCol = findColumn(cols, 'geom');
  if (!geomCol) return null;
  const safeSchema = meta.schema.replace(/"/g, '""');
  const safeTable = meta.tableName.replace(/"/g, '""');
  const g = quoteIdent(geomCol);
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           ST_XMin(e5181) AS nminx, ST_YMin(e5181) AS nminy,
           ST_XMax(e5181) AS nmaxx, ST_YMax(e5181) AS nmaxy,
           ST_XMin(e4326) AS lminx, ST_YMin(e4326) AS lminy,
           ST_XMax(e4326) AS lmaxx, ST_YMax(e4326) AS lmaxy
         FROM (
           SELECT
             ST_Extent(ST_SetSRID(${g}, COALESCE(NULLIF(ST_SRID(${g}), 0), 5181))) AS e5181,
             ST_Extent(
               ST_Transform(
                 ST_SetSRID(${g}, COALESCE(NULLIF(ST_SRID(${g}), 0), 5181)),
                 4326
               )
             ) AS e4326
           FROM "${safeSchema}"."${safeTable}"
           WHERE ${g} IS NOT NULL AND NOT ST_IsEmpty(${g})
         ) t`
      )
    );
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const num = (k: string) => {
      const v = Number(row[k]);
      return Number.isFinite(v) ? v : null;
    };
    const nminx = num('nminx');
    const nminy = num('nminy');
    const nmaxx = num('nmaxx');
    const nmaxy = num('nmaxy');
    const lminx = num('lminx');
    const lminy = num('lminy');
    const lmaxx = num('lmaxx');
    const lmaxy = num('lmaxy');
    if (
      nminx == null ||
      nminy == null ||
      nmaxx == null ||
      nmaxy == null ||
      lminx == null ||
      lminy == null ||
      lmaxx == null ||
      lmaxy == null
    ) {
      return null;
    }
    const pad5181 = 2000;
    const padLon = 0.05;
    const padLat = 0.05;
    return {
      native5181: {
        minx: nminx - pad5181,
        miny: nminy - pad5181,
        maxx: nmaxx + pad5181,
        maxy: nmaxy + pad5181,
      },
      latLon4326: {
        minx: lminx - padLon,
        miny: lminy - padLat,
        maxx: lmaxx + padLon,
        maxy: lmaxy + padLat,
      },
    };
  } catch {
    return null;
  }
}

/**
 * 도형 대량 반영 후 GeoServer 레이어 범위를 DB extent로 맞춤.
 * 선언 범위(옛 울진 등) 밖 도형은 WMS가 빈 이미지로 나올 수 있다.
 * (recalculate= 옵션은 빈 범위로 깨지는 경우가 있어 DB 조회 값을 PUT)
 */
async function recalculateGeoServerFeatureTypeBounds(
  layerNames: string[]
): Promise<{ ok: boolean; detail?: string }> {
  const base = getGeoServerInternalBase().replace(/\/$/, '');
  const workspace = (process.env.GEOSERVER_WORKSPACE?.trim() || 'ggnr').replace(/\/$/, '');
  const user = process.env.GEOSERVER_USER ?? 'admin';
  const pass = process.env.GEOSERVER_PASSWORD ?? 'geoserver';
  const auth = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
  const project = String(process.env.GGNR_PROJECT ?? '').trim();
  const stores = ['postgres_layer', project ? `postgres_layer_${project}` : ''].filter(
    (s, i, arr) => Boolean(s) && arr.indexOf(s) === i
  );

  let anyOk = false;
  const errors: string[] = [];
  for (const name of layerNames) {
    const layer = String(name ?? '').trim().toLowerCase();
    if (!layer) continue;
    const boxes = await queryLayerGeomExtentBoxes(layer);
    if (!boxes) {
      errors.push(`${layer}: no geom extent`);
      continue;
    }
    const body = {
      featureType: {
        name: layer,
        nativeName: layer,
        enabled: true,
        srs: 'EPSG:5181',
        nativeBoundingBox: {
          minx: boxes.native5181.minx,
          maxx: boxes.native5181.maxx,
          miny: boxes.native5181.miny,
          maxy: boxes.native5181.maxy,
          crs: 'EPSG:5181',
        },
        latLonBoundingBox: {
          minx: boxes.latLon4326.minx,
          maxx: boxes.latLon4326.maxx,
          miny: boxes.latLon4326.miny,
          maxy: boxes.latLon4326.maxy,
          crs: 'EPSG:4326',
        },
      },
    };
    let layerOk = false;
    for (const store of stores) {
      try {
        const url =
          `${base}/rest/workspaces/${encodeURIComponent(workspace)}` +
          `/datastores/${encodeURIComponent(store)}` +
          `/featuretypes/${encodeURIComponent(layer)}.json`;
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          anyOk = true;
          layerOk = true;
          break;
        }
        errors.push(`${store}/${layer}:${res.status}`);
      } catch (e: unknown) {
        errors.push(`${store}/${layer}:${e instanceof Error ? e.message : 'fetch failed'}`);
      }
    }
    if (!layerOk && !errors.some((x) => x.startsWith(`${layer}:`) || x.includes(`/${layer}:`))) {
      errors.push(`${layer}: no store`);
    }
  }
  return { ok: anyOk, detail: errors.slice(0, 4).join('; ') || undefined };
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
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { main: empty, jijuk: empty, state: emptyState, error: resolved.error };
  }
  const binding = resolved.binding;
  const cache = new Map<string, string | null>();
  const mainPlaceField = await resolveWaterPlaceFieldForGeomFill(binding);
  const main = await fillTableGeomFromOccupPlace({
    tableWanted: binding.mainTable,
    keyField: binding.fields.keyField,
    placeField: mainPlaceField,
    cache,
  });
  if ('error' in main) {
    return { main: empty, jijuk: empty, state: emptyState, error: main.error };
  }
  const jijukPlace =
    binding.serEng === 'waterOccupationLedger'
      ? 'usage_loc'
      : binding.fields.childAddressField;
  const jijuk = await fillTableGeomFromOccupPlace({
    tableWanted: binding.jijukTable,
    keyField: 'ogc_fid',
    placeField: jijukPlace,
    cache,
  });
  // 필지 표·주소 칸이 없으면 본표만 반영하고 넘어간다
  const jijukCounts = 'error' in jijuk ? empty : jijuk;
  const state = await fillMainTableStateFromEndDate(binding);
  const stateCounts = 'error' in state ? emptyState : state;

  // 본표·필지 WMS 범위 — 영덕 등 선언범위 밖 도형이 보이도록
  await recalculateGeoServerFeatureTypeBounds([
    binding.mainTable,
    binding.jijukTable,
  ]);

  return { main, jijuk: jijukCounts, state: stateCounts };
}

/** 지도서버 레이어 범위만 다시 맞춤 (도형은 이미 들어간 뒤) */
export async function recalculateOccupationLedgerWmsBounds(params?: {
  serEng?: string;
  system?: string;
}): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveBinding(params);
  if (resolved.error || !resolved.binding) {
    return { success: false, error: resolved.error ?? '설정 없음' };
  }
  const r = await recalculateGeoServerFeatureTypeBounds([
    resolved.binding.mainTable,
    resolved.binding.jijukTable,
  ]);
  if (!r.ok) {
    return {
      success: false,
      error: r.detail
        ? `지도서버 범위 갱신 실패 (${r.detail})`
        : '지도서버 범위 갱신 실패',
    };
  }
  return { success: true };
}
