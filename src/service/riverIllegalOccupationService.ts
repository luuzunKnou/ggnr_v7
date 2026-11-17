/**
 * 불법점용 관리카드 — layer.illegal_usage_as
 */
import { sql } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  RIVER_ILLEGAL_MGMT_NO_DEFAULT,
  RIVER_ILLEGAL_MGMT_NO_DIGITS,
  RIVER_ILLEGAL_MGMT_NO_PREFIX,
  RIVER_ILLEGAL_OCCUPATION_SCHEMA,
  RIVER_ILLEGAL_OCCUPATION_TABLE,
} from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationConfig';
import {
  riverIllegalCardToDbRow,
  riverIllegalDbRowToCard,
} from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationDb';
import type { RiverIllegalOccupationCard } from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationModel';
import { isNewRiverIllegalOccupationId } from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationModel';
function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function resolveTable(): Promise<{ schema: string; table: string } | null> {
  const wanted = RIVER_ILLEGAL_OCCUPATION_TABLE.toLowerCase();
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN ('layer', 'public')
         AND lower(table_name) = '${esc(wanted)}'
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_name) return null;
  return {
    schema: String(row.table_schema ?? RIVER_ILLEGAL_OCCUPATION_SCHEMA).trim(),
    table: String(row.table_name).trim(),
  };
}

async function getColumns(schema: string, table: string): Promise<string[]> {
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

function findCol(columns: string[], name: string): string | null {
  const lower = name.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower) ?? null;
}

function resolvePkCol(columns: string[]): string | null {
  return findCol(columns, 'ogc_fid') ?? findCol(columns, 'id') ?? findCol(columns, 'gid');
}

function sqlLiteral(v: string | number | null): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  const t = String(v);
  if (t === '') return 'NULL';
  return `'${esc(t)}'`;
}

function geomUpdateSql(lonRaw: string, latRaw: string): string | null {
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return `ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)`;
}

type TableCtx = {
  schema: string;
  table: string;
  columns: string[];
  pkCol: string;
  hasGeom: boolean;
};

async function requireTable(): Promise<TableCtx | { missing: true; message: string }> {
  const meta = await resolveTable();
  if (!meta) {
    return {
      missing: true,
      message: '목록이 비어 있습니다. 데이터 적재 후 새로고침하세요.',
    };
  }
  const columns = await getColumns(meta.schema, meta.table);
  const pkCol = resolvePkCol(columns);
  if (!pkCol) {
    return {
      missing: true,
      message: `${meta.schema}.${meta.table}에 식별 키(ogc_fid/id)가 없습니다.`,
    };
  }
  return {
    schema: meta.schema,
    table: meta.table,
    columns,
    pkCol,
    hasGeom: Boolean(findCol(columns, 'geom')),
  };
}

function buildSelectSql(ctx: TableCtx): string {
  const qSchema = quoteIdent(ctx.schema);
  const qTable = quoteIdent(ctx.table);
  const qPk = quoteIdent(ctx.pkCol);
  const mgmtCol = findCol(ctx.columns, 'MGMT_NO') ?? findCol(ctx.columns, 'mgmt_no');
  const attrSelect = ctx.columns
    .filter((c) => c.toLowerCase() !== 'geom')
    .map((c) => `t.${quoteIdent(c)}`)
    .join(', ');
  const lonLat = ctx.hasGeom
    ? `,
      CASE WHEN t.geom IS NULL THEN NULL
           ELSE ST_X(ST_Transform(ST_PointOnSurface(t.geom), 4326))::float8 END AS _lon4326,
      CASE WHEN t.geom IS NULL THEN NULL
           ELSE ST_Y(ST_Transform(ST_PointOnSurface(t.geom), 4326))::float8 END AS _lat4326`
    : `, NULL::float8 AS _lon4326, NULL::float8 AS _lat4326`;
  // 최신 관리번호(숫자 큰 값)가 맨 위
  const orderBy = mgmtCol
    ? `ORDER BY CAST(NULLIF(regexp_replace(COALESCE(t.${quoteIdent(mgmtCol)}::text, ''), '^HCBJ_?', '', 'i'), '') AS bigint) DESC NULLS LAST, t.${qPk} DESC`
    : `ORDER BY t.${qPk} DESC`;
  return `
    SELECT ${attrSelect}${lonLat}, t.${qPk}::text AS _row_id
    FROM ${qSchema}.${qTable} t
    ${orderBy}`;
}

function rowToCard(row: Record<string, unknown>): RiverIllegalOccupationCard {
  const id = String(row._row_id ?? row.ogc_fid ?? row.id ?? '').trim();
  const card = riverIllegalDbRowToCard(row, id || `row-${Math.random().toString(36).slice(2)}`);
  if (!card.lon.trim() && row._lon4326 != null) card.lon = String(row._lon4326);
  if (!card.lat.trim() && row._lat4326 != null) card.lat = String(row._lat4326);
  return card;
}

/**
 * 다음 관리번호 — HCBJ_ + 숫자(자릿수 유지). 테이블·컬럼 없으면 기본값.
 */
export async function nextMgmtNo(): Promise<{ mgmtNo: string; warning?: string }> {
  const ctx = await requireTable();
  if ('missing' in ctx) {
    return { mgmtNo: RIVER_ILLEGAL_MGMT_NO_DEFAULT, warning: ctx.message };
  }
  const mgmtCol = findCol(ctx.columns, 'MGMT_NO') ?? findCol(ctx.columns, 'mgmt_no');
  if (!mgmtCol) {
    return {
      mgmtNo: RIVER_ILLEGAL_MGMT_NO_DEFAULT,
      warning: 'MGMT_NO 컬럼이 없어 기본 관리번호를 씁니다.',
    };
  }
  const qSchema = quoteIdent(ctx.schema);
  const qTable = quoteIdent(ctx.table);
  const qMgmt = quoteIdent(mgmtCol);
  const prefix = esc(RIVER_ILLEGAL_MGMT_NO_PREFIX);
  try {
    // HCBJ_000474 · HCBJ000474 모두 숫자 max+1 → HCBJ_######
    const res = await db.execute(
      sql.raw(`
        SELECT ${qMgmt}::text AS code
        FROM ${qSchema}.${qTable}
        WHERE ${qMgmt}::text ~* '^${prefix}_?[0-9]+$'
        ORDER BY CAST(regexp_replace(${qMgmt}::text, '^${prefix}_?', '', 'i') AS bigint) DESC
        LIMIT 1`)
    );
    const last = String((res.rows?.[0] as { code?: string } | undefined)?.code ?? '').trim();
    if (!last) {
      const pad = '0'.repeat(Math.max(0, RIVER_ILLEGAL_MGMT_NO_DIGITS - 1));
      return { mgmtNo: `${RIVER_ILLEGAL_MGMT_NO_PREFIX}_${pad}1` };
    }
    const digits = last.replace(new RegExp(`^${RIVER_ILLEGAL_MGMT_NO_PREFIX}_?`, 'i'), '');
    const next = BigInt(digits) + BigInt(1);
    const padLen = Math.max(digits.length, RIVER_ILLEGAL_MGMT_NO_DIGITS);
    return {
      mgmtNo: `${RIVER_ILLEGAL_MGMT_NO_PREFIX}_${String(next).padStart(padLen, '0')}`,
    };
  } catch (e: unknown) {
    return {
      mgmtNo: RIVER_ILLEGAL_MGMT_NO_DEFAULT,
      warning: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 목록 — 테이블 없으면 빈 목록 + warning */
export async function list(_params?: { keyword?: string }): Promise<{
  items: RiverIllegalOccupationCard[];
  warning?: string;
}> {
  const ctx = await requireTable();
  if ('missing' in ctx) return { items: [], warning: ctx.message };

  try {
    const res = await db.execute(sql.raw(buildSelectSql(ctx)));
    const items = (res.rows ?? []).map((r) => rowToCard(r as Record<string, unknown>));
    return { items };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { items: [], warning: msg };
  }
}

export async function get(params: { id: string }): Promise<{
  item: RiverIllegalOccupationCard | null;
  error?: string;
}> {
  const id = String(params?.id ?? '').trim();
  if (!id || isNewRiverIllegalOccupationId(id)) return { item: null };

  const ctx = await requireTable();
  if ('missing' in ctx) return { item: null, error: ctx.message };

  const qSchema = quoteIdent(ctx.schema);
  const qTable = quoteIdent(ctx.table);
  const qPk = quoteIdent(ctx.pkCol);
  const attrSelect = ctx.columns
    .filter((c) => c.toLowerCase() !== 'geom')
    .map((c) => `t.${quoteIdent(c)}`)
    .join(', ');
  const lonLat = ctx.hasGeom
    ? `,
      CASE WHEN t.geom IS NULL THEN NULL
           ELSE ST_X(ST_Transform(ST_PointOnSurface(t.geom), 4326))::float8 END AS _lon4326,
      CASE WHEN t.geom IS NULL THEN NULL
           ELSE ST_Y(ST_Transform(ST_PointOnSurface(t.geom), 4326))::float8 END AS _lat4326`
    : `, NULL::float8 AS _lon4326, NULL::float8 AS _lat4326`;

  try {
    const res = await db.execute(
      sql.raw(`
        SELECT ${attrSelect}${lonLat}, t.${qPk}::text AS _row_id
        FROM ${qSchema}.${qTable} t
        WHERE t.${qPk}::text = '${esc(id)}'
        LIMIT 1`)
    );
    const row = res.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { item: null };
    return { item: rowToCard(row) };
  } catch (e: unknown) {
    return { item: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildWritePairs(
  ctx: TableCtx,
  card: RiverIllegalOccupationCard
): { cols: string[]; values: string[] } {
  const dbRow = riverIllegalCardToDbRow(card);
  const cols: string[] = [];
  const values: string[] = [];
  const skip = new Set([ctx.pkCol.toLowerCase(), 'geom', 'geometry', 'the_geom', 'shape']);

  for (const [key, val] of Object.entries(dbRow)) {
    const col = findCol(ctx.columns, key);
    if (!col || skip.has(col.toLowerCase())) continue;
    cols.push(col);
    values.push(sqlLiteral(val));
  }

  // lon/lat 속성 컬럼이 있으면 함께
  for (const name of ['lon', 'lat'] as const) {
    const col = findCol(ctx.columns, name);
    if (!col || skip.has(col.toLowerCase())) continue;
    if (cols.some((c) => c.toLowerCase() === col.toLowerCase())) continue;
    cols.push(col);
    values.push(sqlLiteral(card[name] || null));
  }

  if (ctx.hasGeom) {
    const geomExpr = geomUpdateSql(card.lon, card.lat);
    if (geomExpr) {
      cols.push(findCol(ctx.columns, 'geom')!);
      values.push(geomExpr);
    }
  }

  return { cols, values };
}

/** 저장 — 신규 insert / 기존 update. id 반환 */
export async function save(params: {
  card: RiverIllegalOccupationCard;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const card = params?.card;
  if (!card) return { success: false, error: 'card가 필요합니다.' };
  if (!String(card.serialNo ?? '').trim()) {
    return { success: false, error: '연번을 입력하세요.' };
  }
  let mgmtNo = String(card.mgmtNo ?? '').trim();
  if (!mgmtNo) {
    const next = await nextMgmtNo();
    mgmtNo = next.mgmtNo;
    card.mgmtNo = mgmtNo;
  }
  if (!/^HCBJ_\d+$/i.test(mgmtNo)) {
    return { success: false, error: '관리번호 형식이 올바르지 않습니다. (예: HCBJ_000001)' };
  }

  const ctx = await requireTable();
  if ('missing' in ctx) return { success: false, error: ctx.message };

  const mgmtCol = findCol(ctx.columns, 'MGMT_NO') ?? findCol(ctx.columns, 'mgmt_no');
  if (mgmtCol && isNewRiverIllegalOccupationId(card.id)) {
    const qSchema0 = quoteIdent(ctx.schema);
    const qTable0 = quoteIdent(ctx.table);
    const qMgmt0 = quoteIdent(mgmtCol);
    const dup = await db.execute(
      sql.raw(`
        SELECT 1 FROM ${qSchema0}.${qTable0}
        WHERE ${qMgmt0}::text = '${esc(mgmtNo)}'
        LIMIT 1`)
    );
    if ((dup.rows?.length ?? 0) > 0) {
      return { success: false, error: `관리번호 ${mgmtNo} 가 이미 있습니다.` };
    }
  }

  const qSchema = quoteIdent(ctx.schema);
  const qTable = quoteIdent(ctx.table);
  const qPk = quoteIdent(ctx.pkCol);
  const { cols, values } = buildWritePairs(ctx, { ...card, mgmtNo });

  if (cols.length === 0) {
    return { success: false, error: '저장할 컬럼이 레이어에 없습니다. SHP 속성명을 확인하세요.' };
  }

  try {
    if (isNewRiverIllegalOccupationId(card.id)) {
      const sqlText = `
        INSERT INTO ${qSchema}.${qTable} (${cols.map(quoteIdent).join(', ')})
        VALUES (${values.join(', ')})
        RETURNING ${qPk}::text AS id`;
      const res = await db.execute(sql.raw(sqlText));
      const id = String((res.rows?.[0] as { id?: string } | undefined)?.id ?? '').trim();
      if (!id) return { success: false, error: '저장 후 식별값을 받지 못했습니다.' };
      const { scheduleRiverIllegalOccupationPdfCacheRefresh } = await import(
        './riverIllegalOccupationPdfService'
      );
      scheduleRiverIllegalOccupationPdfCacheRefresh(id);
      return { success: true, id };
    }

    const id = String(card.id).trim();
    const sets = cols.map((c, i) => `${quoteIdent(c)} = ${values[i]}`).join(', ');
    const sqlText = `
      UPDATE ${qSchema}.${qTable}
      SET ${sets}
      WHERE ${qPk}::text = '${esc(id)}'
      RETURNING ${qPk}::text AS id`;
    const res = await db.execute(sql.raw(sqlText));
    const outId = String((res.rows?.[0] as { id?: string } | undefined)?.id ?? '').trim();
    if (!outId) return { success: false, error: '수정 대상을 찾지 못했습니다.' };
    const { scheduleRiverIllegalOccupationPdfCacheRefresh } = await import(
      './riverIllegalOccupationPdfService'
    );
    scheduleRiverIllegalOccupationPdfCacheRefresh(outId);
    return { success: true, id: outId };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 일부 필드만 갱신(위치도 자동 생성 등) */
export async function patch(params: {
  id: string;
  patch: Partial<Omit<RiverIllegalOccupationCard, 'id' | 'status' | 'statusTotals'>> & {
    status?: RiverIllegalOccupationCard['status'];
    statusTotals?: RiverIllegalOccupationCard['statusTotals'];
  };
}): Promise<{ success: boolean; error?: string }> {
  const id = String(params?.id ?? '').trim();
  if (!id || isNewRiverIllegalOccupationId(id)) {
    return { success: false, error: '잘못된 식별값입니다.' };
  }
  const got = await get({ id });
  if (!got.item) return { success: false, error: got.error ?? '대상을 찾지 못했습니다.' };
  const merged: RiverIllegalOccupationCard = {
    ...got.item,
    ...params.patch,
    id,
    status: params.patch.status ?? got.item.status,
    statusTotals: params.patch.statusTotals ?? got.item.statusTotals,
  };
  const res = await save({ card: merged });
  return { success: res.success, error: res.error };
}

export async function remove(params: { id: string }): Promise<{ success: boolean; error?: string }> {
  const id = String(params?.id ?? '').trim();
  if (!id || isNewRiverIllegalOccupationId(id)) {
    return { success: false, error: '잘못된 식별값입니다.' };
  }
  const ctx = await requireTable();
  if ('missing' in ctx) return { success: false, error: ctx.message };

  const before = await get({ id });
  const mgmtNo = String(before.item?.mgmtNo ?? '').trim();

  const qSchema = quoteIdent(ctx.schema);
  const qTable = quoteIdent(ctx.table);
  const qPk = quoteIdent(ctx.pkCol);
  try {
    await db.execute(
      sql.raw(`DELETE FROM ${qSchema}.${qTable} WHERE ${qPk}::text = '${esc(id)}'`)
    );
    if (mgmtNo) {
      const { scheduleRiverIllegalOccupationPdfCacheRemove } = await import(
        './riverIllegalOccupationPdfService'
      );
      scheduleRiverIllegalOccupationPdfCacheRemove(mgmtNo);
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 사진 변경 등 — 단건 PDF 캐시 재생성 (백그라운드) */
export async function refreshPdfCache(params: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  const id = String(params?.id ?? '').trim();
  if (!id || isNewRiverIllegalOccupationId(id)) {
    return { success: false, error: '잘못된 식별값입니다.' };
  }
  try {
    const { scheduleRiverIllegalOccupationPdfCacheRefresh } = await import(
      './riverIllegalOccupationPdfService'
    );
    scheduleRiverIllegalOccupationPdfCacheRefresh(id);
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 관리카드 목록 진입 시 — 없는 PDF 캐시를 서버 디스크에 미리 생성 (백그라운드).
 * 브라우저 새로고침과 무관하게 데이터 폴더에 남음.
 */
export async function warmPdfCache(): Promise<{ success: boolean; error?: string }> {
  try {
    const { scheduleWarmRiverIllegalOccupationPdfCacheAll } = await import(
      './riverIllegalOccupationPdfService'
    );
    scheduleWarmRiverIllegalOccupationPdfCacheAll();
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 전체 PDF 버튼 — 준비중/완료 폴링용 */
export async function getPdfCacheStatus(): Promise<{
  success: boolean;
  running: boolean;
  ready: boolean;
  total: number;
  cached: number;
  missing: number;
  error: string | null;
  bulkReady: boolean;
}> {
  const { getRiverIllegalOccupationPdfCacheWarmStatus } = await import(
    './riverIllegalOccupationPdfService'
  );
  const s = await getRiverIllegalOccupationPdfCacheWarmStatus();
  return { success: true, ...s };
}
