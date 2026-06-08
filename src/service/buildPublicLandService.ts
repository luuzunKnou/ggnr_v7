/**
 * 국공유지 — layer.public_land
 * - 컬럼명이 환경마다 다를 수 있어 information_schema 기반으로 유추 매핑합니다.
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { formatToYmdOrText } from '@/lib/formatDateYmd';

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

type ColumnMap = {
  schema: string;
  key: string;
  /** 국유/공유 */
  ownershipType: string;
  /** 소재지 */
  address: string;
  /** 사용시작일 */
  useStart: string;
  /** 사용종료일 */
  useEnd: string;
  geom: string | null;
};

const TABLE_NAME = 'public_land';

const KEY_CANDIDATES = ['id', 'ogc_fid', 'gid', 'fid'] as const;
const GEOM_CANDIDATES = ['geom', 'geometry', 'the_geom', 'shape'] as const;

/**
 * 운영 DB `public_land` 컬럼 매핑 (사용자 제공 표 기준)
 * - parcel_address: 필지이름
 * - value_010: 국유/공유
 * - value_011: 소재지
 * - value_006: 사용시작일
 * - value_007: 사용종료일
 */
const FIXED = {
  ownershipType: ['value_010', 'value_008'],
  address: ['value_011'],
  useStart: ['value_006'],
  useEnd: ['value_007'],
} as const;

function pickFirstExisting(columns: Set<string>, candidates: readonly string[]): string | null {
  for (const c of candidates) {
    if (columns.has(c)) return c;
  }
  return null;
}

/** 통합 주소에서 앞의 두 토큰(시도·시군구 추정) 제거 */
function sqlStripSidoSgg(addrExpr: string): string {
  return `trim(both from regexp_replace(COALESCE(${addrExpr}, '')::text, '^[^\\s]+\\s+[^\\s]+\\s*', '', 'g'))`;
}

function stripSidoSggText(raw: string): string {
  return String(raw ?? '').trim().replace(/^[^\s]+\s+[^\s]+\s*/, '').trim();
}

type ColumnIndex = {
  byLower: Map<string, string>;
  lowers: Set<string>;
};

function buildColumnIndex(rawCols: string[]): ColumnIndex {
  const byLower = new Map<string, string>();
  for (const raw of rawCols) {
    const lower = raw.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, raw);
  }
  return { byLower, lowers: new Set([...byLower.keys()]) };
}

function pickFirstExistingFromIndex(idx: ColumnIndex, candidates: readonly string[]): string {
  for (const c of candidates) {
    const raw = idx.byLower.get(String(c).toLowerCase());
    if (raw) return raw;
  }
  return '';
}

async function resolveColumnMap(): Promise<ColumnMap | null> {
  const schemaRes = await db.execute(
    sql.raw(
      `SELECT table_schema AS schema
       FROM information_schema.tables
       WHERE table_name='${esc(TABLE_NAME)}'
       ORDER BY CASE
         WHEN table_schema='layer' THEN 0
         WHEN table_schema='public_layer' THEN 1
         WHEN table_schema='public' THEN 2
         ELSE 9
       END, table_schema
       LIMIT 1`
    )
  );
  const schemaRow = schemaRes.rows?.[0] as { schema?: string } | undefined;
  const schema = String(schemaRow?.schema ?? '').trim();
  if (!schema) return null;

  const colRes = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema='${esc(schema)}' AND table_name='${esc(TABLE_NAME)}'
       ORDER BY ordinal_position`
    )
  );
  const rawCols = (colRes.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
  if (rawCols.length === 0) return null;
  const idx = buildColumnIndex(rawCols);

  const key = pickFirstExistingFromIndex(idx, KEY_CANDIDATES) || rawCols[0];
  const ownershipType = pickFirstExistingFromIndex(idx, FIXED.ownershipType);
  const address = pickFirstExistingFromIndex(idx, FIXED.address);
  const useStart = pickFirstExistingFromIndex(idx, FIXED.useStart);
  const useEnd = pickFirstExistingFromIndex(idx, FIXED.useEnd);

  let geom: string | null = null;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name
         FROM geometry_columns
         WHERE f_table_schema='${esc(schema)}' AND f_table_name='${esc(TABLE_NAME)}'
         LIMIT 1`
      )
    );
    const gc = gcRes.rows?.[0] as { name?: string } | undefined;
    if (gc?.name) geom = String(gc.name).trim();
  } catch {
    // ignore
  }
  if (!geom) geom = pickFirstExistingFromIndex(idx, GEOM_CANDIDATES);

  return { schema, key, ownershipType, address, useStart, useEnd, geom };
}

function toKeywordWhere(map: ColumnMap, keyword: string): string {
  const k = String(keyword ?? '').trim();
  if (!k) return '';
  const q = `'%' || '${esc(k)}' || '%'`;
  const parts: string[] = [];
  const add = (col: string) => {
    if (!col) return;
    parts.push(`${quoteIdent(col)}::text ILIKE ${q}`);
  };
  add(map.ownershipType);
  add(map.address);
  add(map.useStart);
  add(map.useEnd);
  return parts.length ? `WHERE (${parts.join(' OR ')})` : '';
}

export async function getPublicLandList(params?: { keyword?: string }) {
  try {
    const map = await resolveColumnMap();
    if (!map) return { rows: [], error: 'public_land 테이블을 찾을 수 없습니다.' };

    const where = toKeywordWhere(map, String(params?.keyword ?? ''));
    const selectCols: string[] = [];
    /** PostgreSQL은 따옴표 없는 alias를 소문자로 강제 폴딩 → camelCase 유지 위해 alias 모두 따옴표로 감싼다 */
    selectCols.push(`${quoteIdent(map.key)}::text AS "rowKey"`);
    selectCols.push(map.ownershipType ? `${quoteIdent(map.ownershipType)}::text AS "ownershipType"` : `''::text AS "ownershipType"`);
    selectCols.push(
      map.address
        ? `${sqlStripSidoSgg(`${quoteIdent(map.address)}::text`)} AS "address"`
        : `''::text AS "address"`
    );
    selectCols.push(map.useStart ? `${quoteIdent(map.useStart)}::text AS "useStart"` : `''::text AS "useStart"`);
    selectCols.push(map.useEnd ? `${quoteIdent(map.useEnd)}::text AS "useEnd"` : `''::text AS "useEnd"`);

    const orderBy =
      map.useEnd
        ? `ORDER BY
            CASE
              WHEN ${quoteIdent(map.useEnd)}::text ~ '^\\d{8}$'
                THEN to_date(${quoteIdent(map.useEnd)}::text, 'YYYYMMDD')
              WHEN ${quoteIdent(map.useEnd)}::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
                THEN to_date(${quoteIdent(map.useEnd)}::text, 'YYYY-MM-DD')
              ELSE NULL
            END ASC NULLS LAST,
            NULLIF(${quoteIdent(map.useEnd)}::text, '') ASC NULLS LAST`
        : `ORDER BY ${quoteIdent(map.key)}::text ASC`;
    const q = `SELECT ${selectCols.join(', ')}
               FROM ${quoteIdent(map.schema)}.${quoteIdent(TABLE_NAME)}
               ${where}
               ${orderBy}
               LIMIT 500`;
    const res = await db.execute(sql.raw(q));
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows: rows.map((r) => ({
        rowKey: String(r.rowKey ?? '').trim(),
        ownershipType: String(r.ownershipType ?? '').trim(),
        address: String(r.address ?? '').trim(),
        useStart: formatToYmdOrText(r.useStart),
        useEnd: formatToYmdOrText(r.useEnd),
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], error: msg };
  }
}

type PublicLandDetailAttr = { field: string; label: string; value: string };

const PUBLIC_LAND_LABELS: Record<string, string> = {
  id: 'id',
  parcel_address: '필지이름',
  feat_key: '입력키',
  value_008: '구분',
  value_010: '국유/공유',
  value_011: '소재지',
  value_012: '신청자',
  value_013: '신청자_2',
  value_006: '사용시작일',
  value_007: '사용종료일',
  value_015: '용도',
  value_016: '허가면적/공부면적(㎡)',
  value_017: '문서번호',
  value_018: '문서번호_2',
  value_019: '문서번호_3',
  value_020: '기타',
  value_021: '기타_2',
  value_022: '기타_3',
  value_023: '사용료부과2차',
  value_024: '사용료부과3차',
  value_025: '사용료부과4차',
  value_026: '사용료부과5차',
  value_027: '사용료부과5차_2',
};

const DATE_DETAIL_FIELDS = new Set(['value_006', 'value_007']);

async function resolveLayerTableNameByLower(tableLower: string): Promise<{ schema: string; table: string } | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema AS schema, table_name AS table
       FROM information_schema.tables
       WHERE lower(table_name) = '${esc(tableLower)}'
       ORDER BY CASE
         WHEN table_schema='layer' THEN 0
         WHEN table_schema='public_layer' THEN 1
         WHEN table_schema='public' THEN 2
         ELSE 9
       END, table_schema
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { schema?: string; table?: string } | undefined;
  const schema = String(row?.schema ?? '').trim();
  const table = String(row?.table ?? '').trim();
  if (!schema || !table) return null;
  return { schema, table };
}

async function getTableColumns(schema: string, table: string): Promise<string[]> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema='${esc(schema)}' AND table_name='${esc(table)}'
       ORDER BY ordinal_position`
    )
  );
  return (res.rows as { name?: string }[])
    .map((r) => String(r?.name ?? '').trim())
    .filter(Boolean);
}

async function getPublicLandParcelsByParentId(parentId: string): Promise<{
  parcels: string[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  const child = await resolveLayerTableNameByLower('public_land_jijuk');
  if (!child) return { parcels: [], parcelItems: [], error: 'public_land_jijuk 테이블을 찾을 수 없습니다.' };

  const cols = await getTableColumns(child.schema, child.table);
  const lower = new Set(cols.map((c) => c.toLowerCase()));
  if (!lower.has('parent_id') || !lower.has('parcel_address')) {
    return {
      parcels: [],
      parcelItems: [],
      error: 'public_land_jijuk 필수 컬럼(parent_id, parcel_address)이 없습니다.',
    };
  }

  const hasGeom = lower.has('geom');
  const hasId = lower.has('id');
  const safeSchema = child.schema.replace(/"/g, '""');
  const safeTable = child.table.replace(/"/g, '""');
  const oq = (name: string) => quoteIdent(name);
  const orderExpr = hasId ? oq('id') : oq('parcel_address');
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
      ${sqlStripSidoSgg(`jj.${oq('parcel_address')}::text`)} AS addr
      ${extentSelect}
    FROM "${safeSchema}"."${safeTable}" jj
    WHERE jj.${oq('parent_id')}::text = '${esc(parentId)}'
      AND COALESCE(jj.${oq('parcel_address')}::text, '') <> ''
    ORDER BY jj.${orderExpr}`;

  try {
    const res = await db.execute(sql.raw(sqlText));
    const parcelItems = (res.rows ?? [])
      .map((r) => {
        const row = r as { addr?: unknown; xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown };
        const address = String(row.addr ?? '').trim();
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
    return { parcels: parcelItems.map((p) => p.address), parcelItems };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { parcels: [], parcelItems: [], error: msg };
  }
}

export async function getPublicLandDetailById(params?: { id?: string }): Promise<{
  attributes: PublicLandDetailAttr[];
  parcels: string[];
  parcelItems: { address: string; extent3857: [number, number, number, number] | null }[];
  error?: string;
}> {
  try {
    const map = await resolveColumnMap();
    if (!map) return { attributes: [], parcels: [], parcelItems: [], error: 'public_land 테이블을 찾을 수 없습니다.' };
    const id = String(params?.id ?? '').trim();
    if (!id) return { attributes: [], parcels: [], parcelItems: [], error: 'id가 필요합니다.' };

    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name
         FROM information_schema.columns
         WHERE table_schema='${esc(map.schema)}' AND table_name='${esc(TABLE_NAME)}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name?: string }[])
      .map((r) => String(r?.name ?? '').trim())
      .filter(Boolean);
    if (columns.length === 0) return { attributes: [], parcels: [], parcelItems: [], error: '컬럼 정보를 찾을 수 없습니다.' };

    const selectCols = columns.map((c) => `${quoteIdent(c)} AS ${quoteIdent(c)}`).join(', ');
    const q = `SELECT ${selectCols}
               FROM ${quoteIdent(map.schema)}.${quoteIdent(TABLE_NAME)}
               WHERE ${quoteIdent(map.key)}::text = '${esc(id)}'
               LIMIT 1`;
    const res = await db.execute(sql.raw(q));
    const row = (res.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!row) return { attributes: [], parcels: [], parcelItems: [], error: '상세 데이터를 찾을 수 없습니다.' };

    const geomLower = String(map.geom ?? '').toLowerCase();
    const attributes: PublicLandDetailAttr[] = [];
    for (const col of columns) {
      const lower = col.toLowerCase();
      if (lower === geomLower) continue;
      if (lower === 'parcel_address') continue;
      if (lower === 'value_017' || lower === 'value_018' || lower === 'value_019') continue;
      const raw = row[col];
      const value = DATE_DETAIL_FIELDS.has(lower)
        ? formatToYmdOrText(raw) || '—'
        : String(raw ?? '').trim() || '—';
      attributes.push({
        field: col,
        label: PUBLIC_LAND_LABELS[lower] ?? col,
        value,
      });
    }

    const parcelResult = await getPublicLandParcelsByParentId(id);
    if (parcelResult.parcelItems.length > 0) {
      return {
        attributes,
        parcels: parcelResult.parcels,
        parcelItems: parcelResult.parcelItems,
        ...(parcelResult.error ? { error: parcelResult.error } : {}),
      };
    }

    const parcelCol = columns.find((c) => c.toLowerCase() === 'parcel_address');
    const parcelRaw = parcelCol ? String(row[parcelCol] ?? '').trim() : '';
    const parcels = parcelRaw
      ? parcelRaw
          .split(/[\n,]/g)
          .map((x) => stripSidoSggText(x))
          .filter(Boolean)
      : [];
    const uniqueParcels = [...new Set(parcels)];
    const extRes = await getPublicLandExtent3857ById({ id });
    const extent = extRes.extent3857 ?? null;
    const parcelItems = uniqueParcels.map((address) => ({ address, extent3857: extent }));

    return {
      attributes,
      parcels: uniqueParcels,
      parcelItems,
      ...(parcelResult.error ? { error: parcelResult.error } : {}),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { attributes: [], parcels: [], parcelItems: [], error: msg };
  }
}

export async function getPublicLandExtent3857ById(params?: { id?: string }) {
  try {
    const map = await resolveColumnMap();
    if (!map) return { extent3857: null, error: 'public_land 테이블을 찾을 수 없습니다.' };
    if (!map.geom) return { extent3857: null, error: 'public_land geometry 컬럼을 찾을 수 없습니다.' };
    const id = String(params?.id ?? '').trim();
    if (!id) return { extent3857: null, error: 'id가 필요합니다.' };

    const q = `SELECT ST_Extent(ST_Transform(${quoteIdent(map.geom)}, 3857)) AS ext
               FROM ${quoteIdent(map.schema)}.${quoteIdent(TABLE_NAME)}
               WHERE ${quoteIdent(map.key)}::text = '${esc(id)}'
               LIMIT 1`;
    const res = await db.execute(sql.raw(q));
    const row = res.rows?.[0] as { ext?: string | null } | undefined;
    const box = row?.ext ? String(row.ext) : '';
    const m = /BOX\(([-\d.]+)\s+([-\d.]+),([-\d.]+)\s+([-\d.]+)\)/.exec(box);
    if (!m) return { extent3857: null };
    const xmin = Number(m[1]);
    const ymin = Number(m[2]);
    const xmax = Number(m[3]);
    const ymax = Number(m[4]);
    if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) return { extent3857: null };
    return { extent3857: [xmin, ymin, xmax, ymax] as [number, number, number, number] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { extent3857: null, error: msg };
  }
}

