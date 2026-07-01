/**
 * 메모관리 — layer.memo* 테이블 CRUD
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { getSessionUsrId } from '@/lib/auth/guard';
import { MEMO_KEY_FIELD, MEMO_SCHEMA, MEMO_TABLES } from '@/lib/memoConfig';

const GEOM_COLUMNS = new Set(['geom', 'geometry', 'the_geom', 'shape']);

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function findColumn(columns: string[], name: string): string | null {
  const lower = name.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower) ?? null;
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

    return {
      tableName,
      memoKey,
      title: pick('memo_title'),
      contents: pick('memo_contents'),
      createDate: formatToYmdOrText(pick('memo_create_date')),
      createUser: pick('memo_create_user'),
      createGroup: pick('memo_create_group'),
      hasGeom: row.has_geom === true,
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

export async function getMemoExtent3857(params?: { table?: string; memoKey?: string }) {
  const tableName = String(params?.table ?? '').trim().toLowerCase();
  const memoKey = String(params?.memoKey ?? '').trim();
  if (!tableName || !memoKey) return { extent3857: null, error: 'table과 memoKey가 필요합니다.' };

  const resolved = await resolvePhysicalTable(tableName);
  if (!resolved) return { extent3857: null, error: '테이블을 찾을 수 없습니다.' };

  const columns = await getTableColumns(resolved.schema, resolved.table);
  const keyCol = findColumn(columns, MEMO_KEY_FIELD);
  const geomCol = await resolveGeomColumn(resolved.schema, resolved.table, columns);
  if (!keyCol || !geomCol) return { extent3857: null, error: '위치 정보 컬럼을 찾을 수 없습니다.' };

  const q = `SELECT ST_Extent(ST_Expand(ST_Transform(${quoteIdent(geomCol)}, 3857), 80)) AS ext
             FROM ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(memoKey)}'
               AND ${quoteIdent(geomCol)} IS NOT NULL
             LIMIT 1`;

  try {
    const res = await db.execute(sql.raw(q));
    const row = res.rows?.[0] as { ext?: string | null } | undefined;
    const box = row?.ext ? String(row.ext) : '';
    const m = /BOX\(([-\d.]+)\s+([-\d.]+),([-\d.]+)\s+([-\d.]+)\)/.exec(box);
    if (!m) return { extent3857: null, error: '저장된 위치가 없습니다.' };
    const nums = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (!nums.every((v) => Number.isFinite(v))) return { extent3857: null, error: '위치 좌표를 해석하지 못했습니다.' };
    return { extent3857: nums as [number, number, number, number] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { extent3857: null, error: msg };
  }
}

async function resolveUserKeys(usrId: string | null): Promise<{ userKey: string | null; groupKey: string | null }> {
  if (!usrId) return { userKey: null, groupKey: null };
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT users_key::text AS user_key, users_group::text AS group_key
         FROM ${quoteIdent('public')}.${quoteIdent('users')}
         WHERE users_id::text = '${esc(usrId)}'
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { user_key?: string; group_key?: string } | undefined;
    return {
      userKey: row?.user_key ? String(row.user_key).trim() : null,
      groupKey: row?.group_key ? String(row.group_key).trim() : null,
    };
  } catch {
    return { userKey: null, groupKey: null };
  }
}

function geomExprFrom3857Point(x: number, y: number): string {
  return `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), 5181)`;
}

export async function createMemo(params?: {
  table?: string;
  title?: string;
  contents?: string;
  createDate?: string;
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

  const usrId = await getSessionUsrId();
  const { userKey, groupKey } = await resolveUserKeys(usrId);

  const insertCols: string[] = [];
  const insertVals: string[] = [];

  const setText = (field: string, value: string | null | undefined) => {
    const col = findColumn(columns, field);
    if (!col) return;
    const v = value == null ? '' : String(value).trim();
    insertCols.push(quoteIdent(col));
    insertVals.push(v ? `'${esc(v)}'` : 'NULL');
  };

  setText('memo_title', params?.title);
  setText('memo_contents', params?.contents);
  setText('memo_create_date', params?.createDate || formatToYmdOrText(new Date()));
  if (userKey) setText('memo_create_user', userKey);
  if (groupKey) setText('memo_create_group', groupKey);

  const delCol = findColumn(columns, 'memo_is_del');
  if (delCol) {
    insertCols.push(quoteIdent(delCol));
    insertVals.push('false');
  }

  const x = Number(params?.pointX3857);
  const y = Number(params?.pointY3857);
  const geomCol = await resolveGeomColumn(resolved.schema, resolved.table, columns);
  if (geomCol && Number.isFinite(x) && Number.isFinite(y)) {
    insertCols.push(quoteIdent(geomCol));
    insertVals.push(geomExprFrom3857Point(x, y));
  }

  if (insertCols.length === 0) return { success: false, error: '저장할 값이 없습니다.' };

  const q = `INSERT INTO ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)} (${insertCols.join(', ')})
             VALUES (${insertVals.join(', ')})
             RETURNING ${quoteIdent(keyCol)}::text AS new_key`;

  try {
    const res = await db.execute(sql.raw(q));
    const newKey = String((res.rows?.[0] as { new_key?: string })?.new_key ?? '').trim();
    if (!newKey) return { success: false, error: '등록 후 키를 확인하지 못했습니다.' };
    return { success: true, memoKey: newKey };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
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
  const keyCol = findColumn(columns, MEMO_KEY_FIELD);
  if (!keyCol) return { success: false, error: '키 컬럼을 찾을 수 없습니다.' };

  const sets: string[] = [];
  const setText = (field: string, value: string | undefined) => {
    const col = findColumn(columns, field);
    if (!col || value === undefined) return;
    sets.push(`${quoteIdent(col)} = '${esc(String(value))}'`);
  };

  if (params?.title !== undefined) setText('memo_title', params.title);
  if (params?.contents !== undefined) setText('memo_contents', params.contents);
  if (params?.createDate !== undefined) setText('memo_create_date', params.createDate);

  const geomCol = await resolveGeomColumn(resolved.schema, resolved.table, columns);
  if (geomCol && params?.clearGeom) {
    sets.push(`${quoteIdent(geomCol)} = NULL`);
  } else if (geomCol && params?.pointX3857 != null && params?.pointY3857 != null) {
    const x = Number(params.pointX3857);
    const y = Number(params.pointY3857);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      sets.push(`${quoteIdent(geomCol)} = ${geomExprFrom3857Point(x, y)}`);
    }
  }

  if (!sets.length) return { success: false, error: '변경할 항목이 없습니다.' };

  const q = `UPDATE ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)}
             SET ${sets.join(', ')}
             WHERE ${quoteIdent(keyCol)}::text = '${esc(memoKey)}'`;

  try {
    await db.execute(sql.raw(q));
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
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

  const q = delCol
    ? `UPDATE ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)}
       SET ${quoteIdent(delCol)} = true
       WHERE ${quoteIdent(keyCol)}::text = '${esc(memoKey)}'`
    : `DELETE FROM ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)}
       WHERE ${quoteIdent(keyCol)}::text = '${esc(memoKey)}'`;

  try {
    await db.execute(sql.raw(q));
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

export async function listAvailableMemoTables(): Promise<{ tables: { tableName: string; label: string }[] }> {
  const out: { tableName: string; label: string }[] = [];
  for (const meta of MEMO_TABLES) {
    const resolved = await resolvePhysicalTable(meta.tableName);
    if (resolved) out.push({ tableName: meta.tableName, label: meta.label });
  }
  return { tables: out };
}
