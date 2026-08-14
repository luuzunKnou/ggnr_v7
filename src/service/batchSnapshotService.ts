/**
 * 회차(batch) 단위 테이블 전체 스냅샷 저장·복원.
 * - 저장: 확정 직후 layer/public_layer 테이블 전체 dump
 * - 복원: 스냅샷으로 테이블 통째 교체 + data_log «되돌리기» 기록
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { usr } from '@/database/schema/usr';
import { eq } from 'drizzle-orm';
import { recordDataLog } from './dataLogService';

function escapeSqlLiteral(v: string): string {
  return v.replace(/'/g, "''");
}

function isSafeSqlIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function safeTableIdent(name: string): string {
  return String(name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
}

async function resolveOperatorLabel(): Promise<string | null> {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return null;
    const [row] = await db.select().from(usr).where(eq(usr.usrId, usrId)).limit(1);
    const name = row?.usrName?.trim();
    return name ? `${usrId}(${name})` : usrId;
  } catch {
    return null;
  }
}

/** 스냅샷 테이블 존재 여부 */
async function snapshotTablesReady(): Promise<boolean> {
  try {
    const res = await db.execute(sql.raw(
      `SELECT 1 AS ok
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'data_batch_snapshot'
       LIMIT 1`
    ));
    return ((res.rows as unknown[]) ?? []).length > 0;
  } catch {
    return false;
  }
}

async function resolveLayerFq(tableName: string): Promise<{
  schema: string;
  table: string;
  fq: string;
  typeReg: string;
} | null> {
  const bare = safeTableIdent(tableName.includes('.') ? tableName.split('.').pop()! : tableName);
  if (!bare || !isSafeSqlIdent(bare)) return null;

  try {
    const res = await db.execute(sql.raw(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema IN ('layer', 'public_layer', 'public')
         AND lower(table_name) = lower('${escapeSqlLiteral(bare)}')
       ORDER BY CASE table_schema
         WHEN 'layer' THEN 1
         WHEN 'public_layer' THEN 2
         ELSE 3
       END
       LIMIT 1`
    ));
    const row = (res.rows as Array<{ table_schema?: string; table_name?: string }>)[0];
    if (!row?.table_schema || !row?.table_name) return null;
    const schema = row.table_schema;
    const table = row.table_name;
    if (!isSafeSqlIdent(schema) || !isSafeSqlIdent(table)) return null;
    return {
      schema,
      table,
      fq: `${quoteIdent(schema)}.${quoteIdent(table)}`,
      typeReg: `${quoteIdent(schema)}.${quoteIdent(table)}`,
    };
  } catch {
    return null;
  }
}

export type BatchSnapshotMeta = {
  dbsKey: number;
  batchKey: string;
  tableName: string;
  tableKorName: string | null;
  group: string | null;
  keyField: string;
  rowCount: number;
  source: string | null;
  user: string | null;
  date: string | null;
};

/** 회차 키로 스냅샷 메타 조회 */
export async function getBatchSnapshotByBatchKey(params: {
  batchKey?: string;
}): Promise<{ success: boolean; data?: BatchSnapshotMeta | null; error?: string }> {
  const batchKey = String(params.batchKey ?? '').trim();
  if (!batchKey) {
    return { success: false, error: 'batchKey가 필요합니다.' };
  }
  if (!(await snapshotTablesReady())) {
    return { success: true, data: null };
  }
  try {
    const res = await db.execute(sql.raw(
      `SELECT
         dbs_key,
         dbs_batch_key,
         dbs_table_name,
         dbs_table_kor_name,
         dbs_group,
         dbs_key_field,
         dbs_row_count,
         dbs_source,
         dbs_user,
         to_char(
           dbs_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul',
           'YYYY-MM-DD HH24:MI:SS'
         ) AS dbs_date
       FROM public.data_batch_snapshot
       WHERE dbs_batch_key = '${escapeSqlLiteral(batchKey)}'
       LIMIT 1`
    ));
    const row = (res.rows as Array<{
      dbs_key: number;
      dbs_batch_key: string;
      dbs_table_name: string;
      dbs_table_kor_name: string | null;
      dbs_group: string | null;
      dbs_key_field: string;
      dbs_row_count: number | null;
      dbs_source: string | null;
      dbs_user: string | null;
      dbs_date: string | null;
    }>)[0];
    if (!row) return { success: true, data: null };
    return {
      success: true,
      data: {
        dbsKey: Number(row.dbs_key),
        batchKey: row.dbs_batch_key,
        tableName: row.dbs_table_name,
        tableKorName: row.dbs_table_kor_name,
        group: row.dbs_group,
        keyField: row.dbs_key_field,
        rowCount: Number(row.dbs_row_count ?? 0),
        source: row.dbs_source,
        user: row.dbs_user,
        date: row.dbs_date,
      },
    };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 회차 확정 직후 — 대상 테이블 전체 스냅샷.
 * 동일 batchKey가 이미 있으면 건너뛴다.
 */
export async function captureBatchSnapshot(params: {
  batchKey: string;
  tableName: string;
  keyField: string;
  user?: string | null;
  source?: string | null;
  group?: string | null;
  tableKorName?: string | null;
}): Promise<{
  success: boolean;
  skipped?: boolean;
  dbsKey?: number;
  rowCount?: number;
  error?: string;
  code?: 'not_ready' | 'invalid' | 'capture_failed';
}> {
  const batchKey = String(params.batchKey ?? '').trim();
  const tableName = safeTableIdent(params.tableName);
  const keyField = safeTableIdent(params.keyField);
  if (!batchKey || !tableName || !keyField) {
    return { success: false, code: 'invalid', error: 'batchKey, tableName, keyField가 필요합니다.' };
  }
  if (!isSafeSqlIdent(keyField)) {
    return { success: false, code: 'invalid', error: 'keyField가 올바르지 않습니다.' };
  }
  if (!(await snapshotTablesReady())) {
    return {
      success: false,
      code: 'not_ready',
      error: 'data_batch_snapshot 테이블이 없습니다. 스키마 적용 후 재시도하세요.',
    };
  }

  const layer = await resolveLayerFq(tableName);
  if (!layer) {
    return { success: false, code: 'invalid', error: `대상 테이블을 찾을 수 없습니다: ${tableName}` };
  }

  try {
    const exists = await db.execute(sql.raw(
      `SELECT dbs_key FROM public.data_batch_snapshot
       WHERE dbs_batch_key = '${escapeSqlLiteral(batchKey)}'
       LIMIT 1`
    ));
    if (((exists.rows as unknown[]) ?? []).length > 0) {
      return {
        success: true,
        skipped: true,
        dbsKey: Number((exists.rows as Array<{ dbs_key: number }>)[0]?.dbs_key),
      };
    }

    const user =
      String(params.user ?? '').trim() || (await resolveOperatorLabel()) || null;
    const source = String(params.source ?? '').trim() || null;
    const group = String(params.group ?? '').trim() || null;
    const tableKorName = String(params.tableKorName ?? '').trim() || null;

    const insHead = await db.execute(sql.raw(
      `INSERT INTO public.data_batch_snapshot (
         dbs_batch_key, dbs_table_name, dbs_table_kor_name, dbs_group,
         dbs_key_field, dbs_row_count, dbs_source, dbs_user, dbs_date
       ) VALUES (
         '${escapeSqlLiteral(batchKey)}',
         '${escapeSqlLiteral(layer.table)}',
         ${tableKorName ? `'${escapeSqlLiteral(tableKorName)}'` : 'NULL'},
         ${group ? `'${escapeSqlLiteral(group)}'` : 'NULL'},
         '${escapeSqlLiteral(keyField)}',
         0,
         ${source ? `'${escapeSqlLiteral(source)}'` : 'NULL'},
         ${user ? `'${escapeSqlLiteral(user)}'` : 'NULL'},
         (timezone('UTC', now()))::timestamp
       )
       RETURNING dbs_key`
    ));
    const dbsKey = Number((insHead.rows as Array<{ dbs_key: number }>)[0]?.dbs_key);
    if (!Number.isFinite(dbsKey) || dbsKey <= 0) {
      return { success: false, code: 'capture_failed', error: '스냅샷 헤더 생성 실패' };
    }

    const qKey = quoteIdent(keyField);
    const hasGeomCol = await db.execute(sql.raw(
      `SELECT 1 AS ok
       FROM information_schema.columns
       WHERE table_schema = '${escapeSqlLiteral(layer.schema)}'
         AND table_name = '${escapeSqlLiteral(layer.table)}'
         AND lower(column_name) = 'geom'
       LIMIT 1`
    ));
    const withGeom = ((hasGeomCol.rows as unknown[]) ?? []).length > 0;
    const geomExpr = withGeom ? 't.geom' : 'NULL::geometry';

    const insRows = await db.execute(sql.raw(
      `INSERT INTO public.data_batch_snapshot_row (
         dbsr_dbs_key, dbsr_key_value, dbsr_data, dbsr_geom
       )
       SELECT
         ${dbsKey},
         t.${qKey}::text,
         (COALESCE(row_to_json(t.*)::jsonb, '{}'::jsonb) - 'geom'),
         ${geomExpr}
       FROM ${layer.fq} t
       WHERE t.${qKey} IS NOT NULL
         AND btrim(t.${qKey}::text) <> ''
       RETURNING dbsr_key`
    ));
    const rowCount = ((insRows.rows as unknown[]) ?? []).length;

    await db.execute(sql.raw(
      `UPDATE public.data_batch_snapshot
       SET dbs_row_count = ${rowCount}
       WHERE dbs_key = ${dbsKey}`
    ));

    return { success: true, dbsKey, rowCount };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[captureBatchSnapshot]', msg);
    return { success: false, code: 'capture_failed', error: msg };
  }
}

/**
 * 회차 스냅샷으로 테이블 통째 복원.
 */
export async function restoreBatchSnapshot(params: {
  batchKey?: string;
  dbsKey?: number;
}): Promise<{
  success: boolean;
  restoredCount?: number;
  dlKey?: number;
  error?: string;
  code?: 'not_found' | 'not_ready' | 'restore_failed' | 'invalid';
}> {
  if (!(await snapshotTablesReady())) {
    return {
      success: false,
      code: 'not_ready',
      error: 'data_batch_snapshot 테이블이 없습니다. 스키마 적용 후 재시도하세요.',
    };
  }

  let dbsKey = params.dbsKey != null ? Math.trunc(Number(params.dbsKey)) : 0;
  const batchKeyParam = String(params.batchKey ?? '').trim();

  try {
    if ((!Number.isFinite(dbsKey) || dbsKey <= 0) && batchKeyParam) {
      const meta = await getBatchSnapshotByBatchKey({ batchKey: batchKeyParam });
      if (!meta.success) {
        return { success: false, code: 'restore_failed', error: meta.error };
      }
      if (!meta.data) {
        return { success: false, code: 'not_found', error: '해당 회차 스냅샷이 없습니다.' };
      }
      dbsKey = meta.data.dbsKey;
    }
    if (!Number.isFinite(dbsKey) || dbsKey <= 0) {
      return { success: false, code: 'invalid', error: 'batchKey 또는 dbsKey가 필요합니다.' };
    }

    const headRes = await db.execute(sql.raw(
      `SELECT
         dbs_key, dbs_batch_key, dbs_table_name, dbs_table_kor_name,
         dbs_group, dbs_key_field, dbs_source, dbs_user
       FROM public.data_batch_snapshot
       WHERE dbs_key = ${dbsKey}
       LIMIT 1`
    ));
    const head = (headRes.rows as Array<{
      dbs_key: number;
      dbs_batch_key: string;
      dbs_table_name: string;
      dbs_table_kor_name: string | null;
      dbs_group: string | null;
      dbs_key_field: string;
      dbs_source: string | null;
      dbs_user: string | null;
    }>)[0];
    if (!head) {
      return { success: false, code: 'not_found', error: '스냅샷을 찾을 수 없습니다.' };
    }

    const keyField = String(head.dbs_key_field ?? '').trim();
    if (!isSafeSqlIdent(keyField)) {
      return { success: false, code: 'invalid', error: '스냅샷 키 필드가 올바르지 않습니다.' };
    }

    const layer = await resolveLayerFq(head.dbs_table_name);
    if (!layer) {
      return {
        success: false,
        code: 'restore_failed',
        error: `대상 테이블을 찾을 수 없습니다: ${head.dbs_table_name}`,
      };
    }

    const hasGeomCol = await db.execute(sql.raw(
      `SELECT 1 AS ok
       FROM information_schema.columns
       WHERE table_schema = '${escapeSqlLiteral(layer.schema)}'
         AND table_name = '${escapeSqlLiteral(layer.table)}'
         AND lower(column_name) = 'geom'
       LIMIT 1`
    ));
    const withGeom = ((hasGeomCol.rows as unknown[]) ?? []).length > 0;

    // 통째 교체
    await db.execute(sql.raw(`DELETE FROM ${layer.fq}`));

    const ins = await db.execute(sql.raw(
      `INSERT INTO ${layer.fq}
       SELECT (jsonb_populate_record(NULL::${layer.typeReg}, r.dbsr_data)).*
       FROM public.data_batch_snapshot_row r
       WHERE r.dbsr_dbs_key = ${dbsKey}
       RETURNING 1`
    ));
    let restoredCount = ((ins.rows as unknown[]) ?? []).length;

    if (withGeom) {
      const qKey = quoteIdent(keyField);
      await db.execute(sql.raw(
        `UPDATE ${layer.fq} t
         SET geom = r.dbsr_geom
         FROM public.data_batch_snapshot_row r
         WHERE r.dbsr_dbs_key = ${dbsKey}
           AND t.${qKey}::text = r.dbsr_key_value`
      ));
    }

    // 시퀀스(ogc_fid 등) 보정 — 실패해도 복원은 성공 처리
    try {
      const seqRes = await db.execute(sql.raw(
        `SELECT column_name, column_default
         FROM information_schema.columns
         WHERE table_schema = '${escapeSqlLiteral(layer.schema)}'
           AND table_name = '${escapeSqlLiteral(layer.table)}'
           AND column_default LIKE 'nextval(%'`
      ));
      for (const col of (seqRes.rows as Array<{ column_name?: string; column_default?: string }>) ?? []) {
        const colName = String(col.column_name ?? '').trim();
        const def = String(col.column_default ?? '');
        const m = def.match(/nextval\('([^']+)'::regclass\)/i) || def.match(/nextval\('([^']+)'\)/i);
        if (!colName || !m?.[1] || !isSafeSqlIdent(colName)) continue;
        const seqName = m[1].replace(/"/g, '');
        await db.execute(sql.raw(
          `SELECT setval(
             '${escapeSqlLiteral(seqName)}'::regclass,
             COALESCE((SELECT MAX(${quoteIdent(colName)}) FROM ${layer.fq}), 1),
             true
           )`
        ));
      }
    } catch {
      /* ignore */
    }

    const operator = (await resolveOperatorLabel()) || head.dbs_user;
    const sourceRaw = String(head.dbs_source ?? '').trim();
    const logSource =
      sourceRaw.includes('Excel')
        ? ('Excel 업로드' as const)
        : sourceRaw.includes('SHP')
          ? ('SHP 업로드' as const)
          : ('시스템' as const);

    const logged = await recordDataLog({
      source: logSource,
      type: '되돌리기',
      user: operator,
      serviceName: '회차 복원',
      tableName: head.dbs_table_name,
      tableKorName: head.dbs_table_kor_name,
      group: head.dbs_group,
      keyField,
      keyValue: `batch:${head.dbs_batch_key}`,
      contents: `회차 복원 | ${head.dbs_batch_key} | ${restoredCount}행`,
      batchKey: head.dbs_batch_key,
      details: [
        {
          item: '회차스냅샷',
          before: '현재',
          after: head.dbs_batch_key,
          colName: 'batch_snapshot',
        },
      ],
    });

    return {
      success: true,
      restoredCount,
      dlKey: logged.dlKey,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[restoreBatchSnapshot]', msg);
    return { success: false, code: 'restore_failed', error: msg };
  }
}
