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
  getOccupationLedgerBinding,
  type OccupationLedgerBinding,
} from '@/lib/occupationLedgerBinding';
import {
  getEditableFieldDefinitionsForTable,
  resolveJijukParcelGeomsByAddresses,
  syncChildParcelsByParentId,
} from './layerRowService';
import { labelForOccupationLedgerField } from '@/app/(pages)/map/_mapContents/occupationLedger/occupationLedgerFieldLabels';
import { deriveOccupationPeriodState } from '@/lib/occupationLedgerPeriodState';

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

export type OccupationLedgerDetailAttr = {
  field: string;
  label: string;
  value: string;
  showDetail?: boolean;
};

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
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
  const parentCol = findColumn(cols, params.parentField);
  const addressCol = findColumn(cols, params.addressField);
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
      const extent3857: [number, number, number, number] | null = [xmin, ymin, xmax, ymax].every(
        (v) => Number.isFinite(v)
      )
        ? [xmin, ymin, xmax, ymax]
        : null;
      const ogcFid = String(row.ogc_fid ?? '').trim();
      const wmsRowKey = ogcFid ? { keyField: 'ogc_fid', keyValue: ogcFid } : undefined;
      return { address, extent3857, ...(wmsRowKey ? { wmsRowKey } : {}) };
    });
    return { items: items.filter((x) => x.address) };
  } catch {
    return { items: [] };
  }
}

function sortListRows(rows: OccupationLedgerListRow[]): OccupationLedgerListRow[] {
  return [...rows].sort((a, b) => {
    const aStart = tryFormatToYmd(a.startDate) ?? '';
    const bStart = tryFormatToYmd(b.startDate) ?? '';
    if (aStart && bStart && aStart !== bStart) return bStart.localeCompare(aStart);
    if (aStart && !bStart) return -1;
    if (!aStart && bStart) return 1;
    return b.rowKey.localeCompare(a.rowKey);
  });
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
        name: String(row.name ?? '').trim(),
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
  const keyRaw = String(params?.key ?? '').trim();
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
  const keyRaw = String(params?.key ?? '').trim();
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
    excludeFields: ['ogc_fid'],
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
    const attributes: OccupationLedgerDetailAttr[] = dataFields.map((field) => {
      const def = metaByField.get(field.toLowerCase());
      const isState = field.toLowerCase() === 'state';
      return {
        field,
        label: labelForOccupationLedgerField(field),
        value: isState
          ? periodState
          : row[field] == null
            ? ''
            : String(row[field]),
        showDetail: def?.showDetail !== false,
      };
    });

    const [parcels, mgj] = await Promise.all([
      getChildAddressItems({
        childTableName: binding.jijukTable,
        parentKey: keyRaw,
        parentField: binding.fields.childParentField,
        addressField: binding.fields.childAddressField,
      }),
      getChildAddressItems({
        childTableName: binding.mgjTable,
        parentKey: keyRaw,
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
  if (!meta) return { key: 'OCC-0001', error: undefined };

  const cols = await getTableColumns(meta.schema, meta.tableName);
  const keyCol = findColumn(cols, binding.fields.keyField);
  if (!keyCol) return { key: 'OCC-0001' };

  const safe = meta.tableName.replace(/"/g, '""');
  const safeSchema = meta.schema.replace(/"/g, '""');
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
    if (keys.length === 0) return { key: 'OCC-0001' };
    const next = incrementSuffixCode(keys[0]!);
    return { key: next && next !== keys[0] ? next : 'OCC-0001' };
  } catch {
    return { key: 'OCC-0001' };
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

  const items = (params.items ?? []).filter((it) => String(it?.address ?? '').trim());
  if (items.length === 0) {
    return syncChildParcelsByParentId({
      schema: DEFAULT_SCHEMA,
      childTableName: binding.mgjTable,
      childParentField: binding.fields.childParentField,
      childAddressField: binding.fields.childAddressField,
      parentId: parentKey,
      parcels: [],
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
    };
  });

  const result = await syncChildParcelsByParentId({
    schema: DEFAULT_SCHEMA,
    childTableName: binding.mgjTable,
    childParentField: binding.fields.childParentField,
    childAddressField: binding.fields.childAddressField,
    parentId: parentKey,
    parcels,
  });

  if (result.error) return { success: false, error: result.error };
  if (geomResolved.error) return { success: true, error: geomResolved.error };
  return { success: true };
}
