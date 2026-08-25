/**
 * 메모관리 — layer.memo* 테이블 CRUD
 */
import { db } from '@/database/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { usr } from '@/database/schema/usr';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { MEMO_KEY_FIELD, MEMO_SCHEMA, MEMO_TABLES } from '@/lib/memoConfig';
import {
  deleteTableRowByKey,
  insertTableRow,
  updateTableRowByKey,
} from './layerRowService';

const GEOM_COLUMNS = new Set(['geom', 'geometry', 'the_geom', 'shape']);

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function findColumn(columns: string[], name: string): string | null {
  const lower = name.toLowerCase();
  const exact = columns.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  // SHP/DBF 필드명 10자 제한 (memo_contents → memo_conte)
  if (lower.length > 10) {
    const trunc = lower.slice(0, 10);
    return columns.find((c) => c.toLowerCase() === trunc) ?? null;
  }
  return null;
}

/** memo_key 기본값(시퀀스)이 없을 때 MAX+1 채번 */
async function allocateMemoKey(
  schema: string,
  table: string,
  keyCol: string,
): Promise<number> {
  const res = await db.execute(
    sql.raw(
      `SELECT COALESCE(MAX(${quoteIdent(keyCol)})::bigint, 0) + 1 AS n
       FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
    ),
  );
  const n = Number((res.rows?.[0] as { n?: number | string } | undefined)?.n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** serial/identity/default 있으면 INSERT 시 키 생략 */
async function keyColumnHasDefault(
  schema: string,
  table: string,
  keyCol: string,
): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT
         (column_default IS NOT NULL OR COALESCE(is_identity, 'NO') = 'YES') AS has_def
       FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}'
         AND table_name = '${esc(table)}'
         AND column_name = '${esc(keyCol)}'
       LIMIT 1`,
    ),
  );
  const v = (res.rows?.[0] as { has_def?: boolean | string } | undefined)?.has_def;
  return v === true || v === 't' || v === 'true';
}

async function resolvePhysicalTable(tableGuess: string): Promise<{ schema: string; table: string } | null> {
  const guess = String(tableGuess ?? '').trim().toLowerCase();
  if (!guess) return null;
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema AS schema, table_name AS name
       FROM information_schema.tables
       WHERE table_schema = '${esc(MEMO_SCHEMA)}'
         AND lower(table_name) = '${esc(guess)}'
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { schema?: string; name?: string } | undefined;
  const schema = String(row?.schema ?? '').trim();
  const table = String(row?.name ?? '').trim();
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

async function resolveGeomColumn(schema: string, table: string, columns: string[]): Promise<string | null> {
  for (const c of columns) {
    if (GEOM_COLUMNS.has(c.toLowerCase())) return c;
  }
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name
         FROM geometry_columns
         WHERE f_table_schema='${esc(schema)}' AND f_table_name='${esc(table)}'
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { name?: string } | undefined;
    if (row?.name) return String(row.name).trim();
  } catch {
    // ignore
  }
  return null;
}

function notDeletedWhere(columns: string[]): string {
  const col = findColumn(columns, 'memo_is_del');
  if (!col) return '';
  return ` AND (COALESCE(${quoteIdent(col)}, false) = false)`;
}

function keywordWhere(columns: string[], keyword: string): string {
  const k = String(keyword ?? '').trim();
  if (!k) return '';
  const q = `'%' || '${esc(k)}' || '%'`;
  const parts: string[] = [];
  for (const field of ['memo_title', 'memo_contents']) {
    const col = findColumn(columns, field);
    if (col) parts.push(`${quoteIdent(col)}::text ILIKE ${q}`);
  }
  if (!parts.length) return '';
  return ` AND (${parts.join(' OR ')})`;
}

export type MemoListRow = {
  rowKey: string;
  tableName: string;
  tableLabel: string;
  memoKey: string;
  title: string;
  contents: string;
  createDate: string;
  createUser: string;
};

export async function getMemoList(params?: {
  table?: string;
  keyword?: string;
  limit?: number;
}): Promise<{ rows: MemoListRow[]; error?: string }> {
  const limit = Math.min(Math.max(parseInt(String(params?.limit ?? 200), 10) || 200, 1), 500);
  const keyword = String(params?.keyword ?? '').trim();
  const tableFilter = String(params?.table ?? '').trim().toLowerCase();

  const targets = MEMO_TABLES.filter((t) => !tableFilter || t.tableName === tableFilter);
  const rows: MemoListRow[] = [];

  for (const meta of targets) {
    const resolved = await resolvePhysicalTable(meta.tableName);
    if (!resolved) continue;

    const columns = await getTableColumns(resolved.schema, resolved.table);
    const keyCol = findColumn(columns, MEMO_KEY_FIELD);
    const titleCol = findColumn(columns, 'memo_title');
    const contentsCol = findColumn(columns, 'memo_contents');
    const dateCol = findColumn(columns, 'memo_create_date');
    const userCol = findColumn(columns, 'memo_create_user');
    if (!keyCol) continue;

    const selectParts = [
      `${quoteIdent(keyCol)}::text AS memo_key`,
      titleCol ? `${quoteIdent(titleCol)}::text AS memo_title` : `''::text AS memo_title`,
      contentsCol ? `${quoteIdent(contentsCol)}::text AS memo_contents` : `''::text AS memo_contents`,
      dateCol ? `${quoteIdent(dateCol)}::text AS memo_create_date` : `''::text AS memo_create_date`,
      userCol ? `${quoteIdent(userCol)}::text AS memo_create_user` : `''::text AS memo_create_user`,
    ];

    const orderCol = dateCol ?? keyCol;
    const q = `SELECT ${selectParts.join(', ')}
               FROM ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)}
               WHERE 1=1
               ${notDeletedWhere(columns)}
               ${keywordWhere(columns, keyword)}
               ORDER BY ${quoteIdent(orderCol)} DESC NULLS LAST
               LIMIT ${limit}`;

    try {
      const res = await db.execute(sql.raw(q));
      for (const r of res.rows ?? []) {
        const row = r as Record<string, unknown>;
        const memoKey = String(row.memo_key ?? '').trim();
        if (!memoKey) continue;
        rows.push({
          rowKey: `${meta.tableName}::${memoKey}`,
          tableName: meta.tableName,
          tableLabel: meta.label,
          memoKey,
          title: String(row.memo_title ?? '').trim() || '(제목 없음)',
          contents: String(row.memo_contents ?? '').trim(),
          createDate: formatToYmdOrText(row.memo_create_date),
          createUser: String(row.memo_create_user ?? '').trim(),
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { rows, error: msg };
    }
  }

  rows.sort((a, b) => {
    const da = a.createDate || '';
    const db = b.createDate || '';
    if (da !== db) return db.localeCompare(da);
    return b.memoKey.localeCompare(a.memoKey);
  });

  const names = await lookupUserDisplayNames(rows.map((r) => r.createUser));
  for (const row of rows) {
    const name = names.get(row.createUser);
    if (name) row.createUser = name;
  }

  return { rows: rows.slice(0, limit) };
}

export async function getMemoDetail(params?: {
  table?: string;
  memoKey?: string;
}): Promise<{
  tableName: string;
  memoKey: string;
  title: string;
  contents: string;
  createDate: string;
  createUser: string;
  createGroup: string;
  hasGeom: boolean;
  lon?: number | null;
  lat?: number | null;
  error?: string;
}> {
  const tableName = String(params?.table ?? '').trim().toLowerCase();
  const memoKey = String(params?.memoKey ?? '').trim();
  if (!tableName || !memoKey) {
    return {
      tableName: '',
      memoKey: '',
      title: '',
      contents: '',
      createDate: '',
      createUser: '',
      createGroup: '',
      hasGeom: false,
      error: 'table과 memoKey가 필요합니다.',
    };
  }

  const resolved = await resolvePhysicalTable(tableName);
  if (!resolved) {
    return {
      tableName,
      memoKey,
      title: '',
      contents: '',
      createDate: '',
      createUser: '',
      createGroup: '',
      hasGeom: false,
      error: '테이블을 찾을 수 없습니다.',
    };
  }

  const columns = await getTableColumns(resolved.schema, resolved.table);
  const keyCol = findColumn(columns, MEMO_KEY_FIELD);
  if (!keyCol) {
    return {
      tableName,
      memoKey,
      title: '',
      contents: '',
      createDate: '',
      createUser: '',
      createGroup: '',
      hasGeom: false,
      error: '키 컬럼을 찾을 수 없습니다.',
    };
  }

  const dataCols = columns.filter((c) => !GEOM_COLUMNS.has(c.toLowerCase()));
  const selectList = dataCols.map((c) => `${quoteIdent(c)} AS ${quoteIdent(c)}`).join(', ');
  const geomCol = await resolveGeomColumn(resolved.schema, resolved.table, columns);
  const geomSelect = geomCol
    ? `, CASE WHEN ${quoteIdent(geomCol)} IS NOT NULL THEN true ELSE false END AS has_geom`
    : `, false AS has_geom`;

  const q = `SELECT ${selectList}${geomSelect}
             FROM ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(memoKey)}'
             ${notDeletedWhere(columns)}
             LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(q));
    const row = (res.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!row) {
      return {
        tableName,
        memoKey,
        title: '',
        contents: '',
        createDate: '',
        createUser: '',
        createGroup: '',
        hasGeom: false,
        error: '메모를 찾을 수 없습니다.',
      };
    }

    const pick = (field: string) => {
      const col = findColumn(columns, field);
      if (!col) return '';
      return String(row[col] ?? '').trim();
    };

    const createUserRaw = pick('memo_create_user');
    const names = await lookupUserDisplayNames([createUserRaw]);
    const hasGeom = row.has_geom === true;
    let lon: number | null = null;
    let lat: number | null = null;
    if (hasGeom && geomCol) {
      try {
        const focus = await readMemoMapFocus({
          schema: resolved.schema,
          table: resolved.table,
          keyCol,
          geomCol,
          memoKey,
        });
        lon = focus.lon4326;
        lat = focus.lat4326;
      } catch {
        lon = null;
        lat = null;
      }
    }
    return {
      tableName,
      memoKey,
      title: pick('memo_title'),
      contents: pick('memo_contents'),
      createDate: formatToYmdOrText(pick('memo_create_date')),
      createUser: names.get(createUserRaw) || createUserRaw,
      createGroup: pick('memo_create_group'),
      hasGeom,
      lon,
      lat,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      tableName,
      memoKey,
      title: '',
      contents: '',
      createDate: '',
      createUser: '',
      createGroup: '',
      hasGeom: false,
      error: msg,
    };
  }
}

function parseGeoJsonGeometry(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'type' in (raw as object)) {
    return raw as Record<string, unknown>;
  }
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

async function readMemoMapFocus(params: {
  schema: string;
  table: string;
  keyCol: string;
  geomCol: string;
  memoKey: string;
}): Promise<{
  extent3857: [number, number, number, number] | null;
  geomGeoJson4326: Record<string, unknown> | null;
  lon4326: number | null;
  lat4326: number | null;
}> {
  const g = quoteIdent(params.geomCol);
  const q = `SELECT
               ST_X(ST_Transform(${g}, 3857))::float8 AS x,
               ST_Y(ST_Transform(${g}, 3857))::float8 AS y,
               ST_X(ST_Transform(${g}, 4326))::float8 AS lon,
               ST_Y(ST_Transform(${g}, 4326))::float8 AS lat,
               ST_AsGeoJSON(ST_Transform(${g}, 4326))::text AS g
             FROM ${quoteIdent(params.schema)}.${quoteIdent(params.table)}
             WHERE ${quoteIdent(params.keyCol)}::text = '${esc(params.memoKey)}'
               AND ${g} IS NOT NULL
             LIMIT 1`;
  const res = await db.execute(sql.raw(q));
  const row = res.rows?.[0] as { x?: unknown; y?: unknown; lon?: unknown; lat?: unknown; g?: unknown } | undefined;
  const x = Number(row?.x);
  const y = Number(row?.y);
  const lon = Number(row?.lon);
  const lat = Number(row?.lat);
  const extent3857 =
    Number.isFinite(x) && Number.isFinite(y) ? ([x, y, x, y] as [number, number, number, number]) : null;
  return {
    extent3857,
    geomGeoJson4326: parseGeoJsonGeometry(row?.g),
    lon4326: Number.isFinite(lon) ? lon : null,
    lat4326: Number.isFinite(lat) ? lat : null,
  };
}

export async function getMemoExtent3857(params?: { table?: string; memoKey?: string }) {
  const tableName = String(params?.table ?? '').trim().toLowerCase();
  const memoKey = String(params?.memoKey ?? '').trim();
  if (!tableName || !memoKey) {
    return { extent3857: null, geomGeoJson4326: null, error: 'table과 memoKey가 필요합니다.' };
  }

  const resolved = await resolvePhysicalTable(tableName);
  if (!resolved) return { extent3857: null, geomGeoJson4326: null, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(resolved.schema, resolved.table);
  const keyCol = findColumn(columns, MEMO_KEY_FIELD);
  const geomCol = await resolveGeomColumn(resolved.schema, resolved.table, columns);
  if (!keyCol || !geomCol) {
    return { extent3857: null, geomGeoJson4326: null, error: '위치 정보 컬럼을 찾을 수 없습니다.' };
  }

  try {
    return await readMemoMapFocus({
      schema: resolved.schema,
      table: resolved.table,
      keyCol,
      geomCol,
      memoKey,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { extent3857: null, geomGeoJson4326: null, error: msg };
  }
}

async function lookupUserDisplayNames(keys: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(keys.map((k) => String(k ?? '').trim()).filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const inList = unique.map((k) => `'${esc(k)}'`).join(',');
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT usr_id::text AS k, COALESCE(NULLIF(TRIM(usr_name), ''), usr_id)::text AS n
         FROM ${quoteIdent('public')}.${quoteIdent('usr')}
         WHERE usr_id::text IN (${inList})`
      )
    );
    for (const row of res.rows ?? []) {
      const r = row as { k?: string; n?: string };
      const k = String(r.k ?? '').trim();
      const n = String(r.n ?? '').trim();
      if (k && n) out.set(k, n);
    }
  } catch {
    // usr 조회 실패 시 아래 레거시 시도
  }
  const missing = unique.filter((k) => !out.has(k));
  if (missing.length === 0) return out;
  try {
    const missList = missing.map((k) => `'${esc(k)}'`).join(',');
    const res = await db.execute(
      sql.raw(
        `SELECT s.users_key::text AS k,
                COALESCE(NULLIF(TRIM(u.usr_name), ''), NULLIF(TRIM(s.users_id), ''), s.users_key::text) AS n
         FROM ${quoteIdent('public')}.${quoteIdent('users')} s
         LEFT JOIN ${quoteIdent('public')}.${quoteIdent('usr')} u ON u.usr_id::text = s.users_id::text
         WHERE s.users_key::text IN (${missList}) OR s.users_id::text IN (${missList})`
      )
    );
    for (const row of res.rows ?? []) {
      const r = row as { k?: string; n?: string };
      const k = String(r.k ?? '').trim();
      const n = String(r.n ?? '').trim();
      if (k && n) out.set(k, n);
    }
  } catch {
    // users/usr 조인 실패 시 키 그대로
  }
  return out;
}

async function resolveCreatorLabels(): Promise<{ userName: string; groupName: string }> {
  const session = await auth();
  const usrId = String(session?.user?.id ?? '').trim();
  const sessionName = String(session?.user?.name ?? '').trim();

  if (usrId === 'su') {
    return { userName: sessionName || '슈퍼관리자', groupName: '시스템' };
  }

  if (usrId) {
    try {
      const [row] = await db
        .select({ usrName: usr.usrName, ugName: usr.ugName })
        .from(usr)
        .where(and(eq(usr.usrId, usrId), or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel))))
        .limit(1);
      if (row) {
        return {
          userName: String(row.usrName ?? '').trim() || sessionName || usrId,
          groupName: String(row.ugName ?? '').trim(),
        };
      }
    } catch {
      // 로그인 세션 이름만이라도 저장
    }
  }

  return { userName: sessionName || usrId, groupName: '' };
}

async function applyCreatorFields(params: {
  schema: string;
  table: string;
  columns: string[];
  keyCol: string;
  memoKey: string;
  userName: string;
  groupName: string;
}): Promise<void> {
  const userCol =
    params.columns.find((c) => c.toLowerCase() === 'memo_create_user') ??
    params.columns.find((c) => /create_user/i.test(c)) ??
    null;
  const groupCol =
    params.columns.find((c) => c.toLowerCase() === 'memo_create_group') ??
    params.columns.find((c) => /create_group/i.test(c)) ??
    null;
  const sets: string[] = [];
  if (userCol && params.userName) {
    sets.push(`${quoteIdent(userCol)} = '${esc(params.userName)}'`);
  }
  if (groupCol && params.groupName) {
    sets.push(`${quoteIdent(groupCol)} = '${esc(params.groupName)}'`);
  }
  if (sets.length === 0) return;
  await db.execute(
    sql.raw(
      `UPDATE ${quoteIdent(params.schema)}.${quoteIdent(params.table)}
       SET ${sets.join(', ')}
       WHERE ${quoteIdent(params.keyCol)}::text = '${esc(params.memoKey)}'`
    )
  );
}

async function wkt5181FromPoint3857(x: number, y: number): Promise<string | null> {
  const likely5181 = x > 50_000 && x < 1_000_000 && y > 50_000 && y < 1_000_000;
  const expr = likely5181
    ? `ST_SetSRID(ST_MakePoint(${x}, ${y}), 5181)`
    : `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), 5181)`;
  try {
    const res = await db.execute(sql.raw(`SELECT ST_AsText(${expr}) AS wkt`));
    const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim();
    return wkt || null;
  } catch {
    return null;
  }
}

export async function createMemo(params?: {
  table?: string;
  title?: string;
  contents?: string;
  createDate?: string;
  createUser?: string;
  createGroup?: string;
  pointX3857?: number;
  pointY3857?: number;
}): Promise<{ success: boolean; memoKey?: string; error?: string }> {
  const tableName = String(params?.table ?? '').trim().toLowerCase();
  if (!tableName) return { success: false, error: 'table이 필요합니다.' };

  const resolved = await resolvePhysicalTable(tableName);
  if (!resolved) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(resolved.schema, resolved.table);
  const keyCol = findColumn(columns, MEMO_KEY_FIELD);
  if (!keyCol) return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };

  const resolvedCreator = await resolveCreatorLabels();
  const userName =
    resolvedCreator.userName || String(params?.createUser ?? '').trim();
  const groupName =
    resolvedCreator.groupName || String(params?.createGroup ?? '').trim();

  const values: Record<string, unknown> = {};
  const put = (field: string, value: unknown) => {
    const col =
      field === 'memo_create_user'
        ? columns.find((c) => c.toLowerCase() === 'memo_create_user') ??
          columns.find((c) => /create_user/i.test(c)) ??
          findColumn(columns, field)
        : field === 'memo_create_group'
          ? columns.find((c) => c.toLowerCase() === 'memo_create_group') ??
            columns.find((c) => /create_group/i.test(c)) ??
            findColumn(columns, field)
          : findColumn(columns, field);
    if (!col) return;
    values[col] = value;
  };

  const keyHasDefault = await keyColumnHasDefault(resolved.schema, resolved.table, keyCol);
  if (!keyHasDefault) {
    values[keyCol] = await allocateMemoKey(resolved.schema, resolved.table, keyCol);
  }

  put('memo_title', params?.title ?? '');
  put('memo_contents', params?.contents ?? '');
  put('memo_create_date', params?.createDate || formatToYmdOrText(new Date()));
  if (userName) put('memo_create_user', userName);
  if (groupName) put('memo_create_group', groupName);
  put('memo_is_del', false);

  const x = Number(params?.pointX3857);
  const y = Number(params?.pointY3857);
  let geomWkt5181: string | null = null;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    geomWkt5181 = await wkt5181FromPoint3857(x, y);
  }

  const inserted = await insertTableRow({
    table: tableName,
    schema: MEMO_SCHEMA,
    keyField: MEMO_KEY_FIELD,
    values,
    allowPhysicalColumns: true,
    geomWkt5181,
  });
  if (!inserted.success) {
    return { success: false, error: inserted.error ?? '등록에 실패했습니다.' };
  }
  const memoKey = String(inserted.keyValue ?? '').trim();
  if (!memoKey) return { success: false, error: '등록 후 키를 확인하지 못했습니다.' };
  await applyCreatorFields({
    schema: resolved.schema,
    table: resolved.table,
    columns,
    keyCol,
    memoKey,
    userName,
    groupName,
  });
  return { success: true, memoKey };
}

export async function updateMemo(params?: {
  table?: string;
  memoKey?: string;
  title?: string;
  contents?: string;
  createDate?: string;
  pointX3857?: number;
  pointY3857?: number;
  clearGeom?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const tableName = String(params?.table ?? '').trim().toLowerCase();
  const memoKey = String(params?.memoKey ?? '').trim();
  if (!tableName || !memoKey) return { success: false, error: 'table과 memoKey가 필요합니다.' };

  const resolved = await resolvePhysicalTable(tableName);
  if (!resolved) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(resolved.schema, resolved.table);
  if (!findColumn(columns, MEMO_KEY_FIELD)) {
    return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };
  }

  const changes: Record<string, unknown> = {};
  const put = (field: string, value: unknown) => {
    const col = findColumn(columns, field);
    if (!col) return;
    changes[col] = value;
  };

  if (params?.title !== undefined) put('memo_title', params.title);
  if (params?.contents !== undefined) put('memo_contents', params.contents);
  if (params?.createDate !== undefined) {
    const d = String(params.createDate ?? '').trim();
    put('memo_create_date', d || null);
  }

  let geomWkt5181: string | null = null;
  const geomClear = params?.clearGeom === true;
  if (!geomClear && params?.pointX3857 != null && params?.pointY3857 != null) {
    const x = Number(params.pointX3857);
    const y = Number(params.pointY3857);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      geomWkt5181 = await wkt5181FromPoint3857(x, y);
    }
  }

  const updated = await updateTableRowByKey({
    table: tableName,
    schema: MEMO_SCHEMA,
    keyField: MEMO_KEY_FIELD,
    keyValue: memoKey,
    changes,
    allowPhysicalColumns: true,
    geomWkt5181,
    geomClear,
  });
  if (!updated.success) {
    return { success: false, error: updated.error ?? '수정에 실패했습니다.' };
  }
  return { success: true };
}

export async function deleteMemo(params?: {
  table?: string;
  memoKey?: string;
}): Promise<{ success: boolean; error?: string }> {
  const tableName = String(params?.table ?? '').trim().toLowerCase();
  const memoKey = String(params?.memoKey ?? '').trim();
  if (!tableName || !memoKey) return { success: false, error: 'table과 memoKey가 필요합니다.' };

  const resolved = await resolvePhysicalTable(tableName);
  if (!resolved) return { success: false, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(resolved.schema, resolved.table);
  const keyCol = findColumn(columns, MEMO_KEY_FIELD);
  const delCol = findColumn(columns, 'memo_is_del');
  if (!keyCol) return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };

  if (delCol) {
    const updated = await updateTableRowByKey({
      table: tableName,
      schema: MEMO_SCHEMA,
      keyField: MEMO_KEY_FIELD,
      keyValue: memoKey,
      changes: { [delCol]: true },
      allowPhysicalColumns: true,
      logType: '삭제',
    });
    if (!updated.success) {
      return { success: false, error: updated.error ?? '삭제에 실패했습니다.' };
    }
    return { success: true };
  }

  return deleteTableRowByKey({
    table: tableName,
    schema: MEMO_SCHEMA,
    keyField: MEMO_KEY_FIELD,
    keyValue: memoKey,
  });
}

export async function listAvailableMemoTables(): Promise<{ tables: { tableName: string; label: string }[] }> {
  const out: { tableName: string; label: string }[] = [];
  for (const meta of MEMO_TABLES) {
    const resolved = await resolvePhysicalTable(meta.tableName);
    if (resolved) out.push({ tableName: meta.tableName, label: meta.label });
  }
  return { tables: out };
}
