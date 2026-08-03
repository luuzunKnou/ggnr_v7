/**
 * Excel Upload History Service
 * - excel_upload_history CRUD
 * - excel_sync_log 행 로그 (덮어쓰기 전 스냅샷 → 업로드 후 확정)
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { db } from '@/database/db';
import { eh } from '@/database/schema/excel_upload_history';
import { sql, desc, eq } from 'drizzle-orm';
import {
  fillExcelSyncLogNewGeoms,
  fillPendingExcelSyncLogOldGeoms,
  syncExcelSyncLogJsonGeomFromSideTable,
  excelLayerRowJsonbSql,
} from '@/lib/syncLogGeom';
import { recordDataLogsFromSyncStyleRows } from './dataLogService';

function safeIdent(name: string): string {
  return String(name ?? '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
/** 로그 파일 최대 읽기 크기 (2MB) — 그 이상은 잘림 */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

export type ExcelHistoryRow = {
  ehKey: number;
  ehSourcePath: string | null;
  ehTableName: string | null;
  ehTableKorName: string | null;
  ehGroup: string | null;
  ehOldRowCount: number | null;
  ehRowCount: number | null;
  ehResult: string | null;
  ehContents: string | null;
  ehCreateDate: Date | string | null;
  ehCreateUser: number | null;
  ehGeocodingHeaderKor: string | null;
  ehGeocodingHeaderEng: string | null;
  ehGeometryType: string | null;
  /** excel_sync_log 집계 (이력 조회 버튼용) */
  appendCount?: number | null;
  conflictCount?: number | null;
  removeCount?: number | null;
  keptCount?: number | null;
};

/** 전체 교체(TRUNCATE+INSERT) 요약 — 용어: 신규 / 전체 교체 */
export function buildExcelReplaceSummary(
  oldCount: number | null | undefined,
  newCount: number | null | undefined,
): string {
  const oldN = oldCount == null ? null : Number(oldCount);
  const newN = newCount == null ? null : Number(newCount);
  if (oldN == null && newN == null) return '—';
  if (oldN == null || oldN === 0) {
    if (newN == null) return '신규';
    return `신규 ${newN.toLocaleString('ko-KR')}건`;
  }
  if (newN == null) {
    return `전체 교체 (이전 ${oldN.toLocaleString('ko-KR')})`;
  }
  return `전체 교체 (이전 ${oldN.toLocaleString('ko-KR')} → 현재 ${newN.toLocaleString('ko-KR')})`;
}

async function updateExcelHistoryContents(
  ehKey: number,
  contents: string,
): Promise<void> {
  await db
    .update(eh)
    .set({ ehContents: contents })
    .where(eq(eh.ehKey, ehKey));
}

async function refreshExcelHistoryReplaceContents(ehKey: number): Promise<void> {
  const rows = await db
    .select({
      oldCount: eh.ehOldRowCount,
      newCount: eh.ehRowCount,
    })
    .from(eh)
    .where(eq(eh.ehKey, ehKey))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await updateExcelHistoryContents(
    ehKey,
    buildExcelReplaceSummary(row.oldCount, row.newCount),
  );
}

/** layer 스키마 테이블 행 수 (TRUNCATE 직전 이전 건수용) */
export async function countExcelLayerRows(params: {
  tableName: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const tableName = safeIdent(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  try {
    const res = await db.execute(sql.raw(
      `SELECT count(*)::int AS cnt FROM layer."${tableName}"`
    ));
    const count = Number((res.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    return { success: true, count };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** Excel 이력 1건 생성 (도형 대상 컬럼 한글/영문·도형타입 저장 → 다음 업로드 시 자동 불러오기용) */
export async function createExcelHistory(params: {
  sourcePath?: string;
  tableName: string;
  tableKorName?: string;
  group?: string;
  oldRowCount?: number;
  rowCount?: number;
  result?: string;
  contents?: string;
  createUser?: number;
  geocodingHeaderKor?: string;
  geocodingHeaderEng?: string;
  geometryType?: string;
}): Promise<{ success: boolean; ehKey?: number; error?: string }> {
  try {
    const oldRowCount =
      params.oldRowCount != null && Number.isFinite(Number(params.oldRowCount))
        ? Math.max(0, Math.trunc(Number(params.oldRowCount)))
        : null;
    const rowCount =
      params.rowCount != null && Number.isFinite(Number(params.rowCount))
        ? Math.max(0, Math.trunc(Number(params.rowCount)))
        : null;
    const contents =
      params.contents?.trim() ||
      buildExcelReplaceSummary(oldRowCount, rowCount);

    const rows = await db
      .insert(eh)
      .values({
        ehSourcePath: params.sourcePath ?? null,
        ehTableName: params.tableName,
        ehTableKorName: params.tableKorName ?? null,
        ehGroup: params.group ?? null,
        ehOldRowCount: oldRowCount,
        ehRowCount: rowCount,
        ehResult: params.result ?? null,
        ehContents: contents,
        // timestamp without tz: UTC 벽시계로 저장 → 조회 시 Seoul 변환
        ehCreateDate: sql`(timezone('UTC', now()))::timestamp`,
        ehCreateUser: params.createUser ?? null,
        ehGeocodingHeaderKor: params.geocodingHeaderKor ?? null,
        ehGeocodingHeaderEng: params.geocodingHeaderEng ?? null,
        ehGeometryType: params.geometryType ?? null,
      })
      .returning({ ehKey: eh.ehKey });
    return { success: true, ehKey: rows[0]?.ehKey };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** 정합성 반영 요약 — 이력 목록 «업데이트 내용» */
export function buildExcelIntegritySummary(counts: {
  append?: number;
  conflict?: number;
  remove?: number;
  kept?: number;
}): string {
  const parts: string[] = [];
  const a = Number(counts.append ?? 0);
  const c = Number(counts.conflict ?? 0);
  const r = Number(counts.remove ?? 0);
  const k = Number(counts.kept ?? 0);
  if (a > 0) parts.push(`추가 ${a.toLocaleString('ko-KR')}건`);
  if (c > 0) parts.push(`변경 ${c.toLocaleString('ko-KR')}건`);
  if (r > 0) parts.push(`삭제 ${r.toLocaleString('ko-KR')}건`);
  if (k > 0) parts.push(`유지 ${k.toLocaleString('ko-KR')}건`);
  return parts.length > 0 ? parts.join(' · ') : '변경 없음';
}

/**
 * 정합성 적용 성공 후: 미연결 확정 로그(esl_eh_key IS NULL)를 이력에 묶고
 * 요약·현재 행수·data_log를 갱신한다. (이력은 적용 성공 뒤에만 생성)
 */
export async function attachExcelIntegritySyncToHistory(params: {
  ehKey: number;
  tableName: string;
  logUser?: string | null;
  /** 로그 연결 실패·집계 0일 때 목록 요약용 (마법사에서 넘긴 선택 건수) */
  fallbackCounts?: {
    append?: number;
    conflict?: number;
    remove?: number;
    kept?: number;
  };
}): Promise<{
  success: boolean;
  appendCount?: number;
  conflictCount?: number;
  removeCount?: number;
  keptCount?: number;
  attachedCount?: number;
  error?: string;
}> {
  const ehKey = Math.trunc(Number(params.ehKey));
  const tableName = safeIdent(params.tableName);
  if (!Number.isFinite(ehKey) || ehKey <= 0) {
    return { success: false, error: 'ehKey가 필요합니다.' };
  }
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };

  try {
    // 미연결 확정 로그를 이력에 묶음 (적용 직후·이력 생성 시각 근처)
    const upd = await db.execute(sql.raw(
      `UPDATE excel_sync_log esl
       SET esl_eh_key = ${ehKey}
       FROM excel_upload_history h
       WHERE h.eh_key = ${ehKey}
         AND esl.esl_table_name = '${tableName}'
         AND esl.esl_eh_key IS NULL
         AND esl.esl_operation IS NOT NULL
         AND (
           (esl.esl_applied_at IS NOT NULL
             AND esl.esl_applied_at >= COALESCE(h.eh_create_date, NOW()) - interval '2 hours'
             AND esl.esl_applied_at <= COALESCE(h.eh_create_date, NOW()) + interval '2 hours')
           OR (esl.esl_applied_at IS NULL
             AND esl.esl_created_at IS NOT NULL
             AND esl.esl_created_at >= COALESCE(h.eh_create_date, NOW()) - interval '2 hours'
             AND esl.esl_created_at <= COALESCE(h.eh_create_date, NOW()) + interval '2 hours')
           OR (esl.esl_applied_at IS NOT NULL
             AND esl.esl_applied_at >= NOW() - interval '2 hours')
         )
       RETURNING esl.esl_key`
    ));
    let attachedCount = (upd.rows as unknown[])?.length ?? 0;

    // 아직 미연결이면 같은 테이블·미배정 확정 로그를 한 번 더 묶음 (시각 조건 완화)
    if (attachedCount === 0) {
      const upd2 = await db.execute(sql.raw(
        `UPDATE excel_sync_log
         SET esl_eh_key = ${ehKey}
         WHERE esl_table_name = '${tableName}'
           AND esl_eh_key IS NULL
           AND esl_operation IS NOT NULL
           AND esl_applied_at IS NOT NULL
           AND esl_applied_at >= NOW() - interval '24 hours'
           AND NOT EXISTS (
             SELECT 1 FROM excel_upload_history h2
             WHERE h2.eh_key <> ${ehKey}
               AND h2.eh_table_name = '${tableName}'
               AND h2.eh_create_date > (
                 SELECT eh_create_date FROM excel_upload_history WHERE eh_key = ${ehKey}
               )
           )
         RETURNING esl_key`
      ));
      attachedCount = (upd2.rows as unknown[])?.length ?? 0;
    }

    const agg = await db.execute(sql.raw(
      `SELECT
         count(*) FILTER (WHERE esl_operation = 'append')::int AS append_cnt,
         count(*) FILTER (WHERE esl_operation = 'conflict')::int AS conflict_cnt,
         count(*) FILTER (WHERE esl_operation = 'remove')::int AS remove_cnt,
         count(*) FILTER (WHERE esl_operation = 'kept')::int AS kept_cnt
       FROM excel_sync_log
       WHERE esl_eh_key = ${ehKey}`
    ));
    const row = (agg.rows as Array<{
      append_cnt: number;
      conflict_cnt: number;
      remove_cnt: number;
      kept_cnt: number;
    }>)[0];
    let appendCount = Number(row?.append_cnt ?? 0);
    let conflictCount = Number(row?.conflict_cnt ?? 0);
    let removeCount = Number(row?.remove_cnt ?? 0);
    let keptCount = Number(row?.kept_cnt ?? 0);

    const linkedTotal = appendCount + conflictCount + removeCount + keptCount;
    const fb = params.fallbackCounts;
    if (linkedTotal === 0 && fb) {
      appendCount = Number(fb.append ?? 0);
      conflictCount = Number(fb.conflict ?? 0);
      removeCount = Number(fb.remove ?? 0);
      keptCount = Number(fb.kept ?? 0);
    }

    await updateExcelHistoryContents(
      ehKey,
      buildExcelIntegritySummary({
        append: appendCount,
        conflict: conflictCount,
        remove: removeCount,
        kept: keptCount,
      })
    );

    const cnt = await countExcelLayerRows({ tableName });
    if (cnt.success && cnt.count != null) {
      await db.update(eh).set({ ehRowCount: cnt.count }).where(eq(eh.ehKey, ehKey));
    }

    await syncExcelSyncLogJsonGeomFromSideTable({ tableName, ehKey });
    await mirrorExcelEhKeyToDataLog({
      ehKey,
      tableName,
      logUser: params.logUser,
    });

    return {
      success: true,
      appendCount,
      conflictCount,
      removeCount,
      keptCount,
      attachedCount,
    };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 목록에 남은 «정합성 반영» 자리표시를 로그 집계·연결로 건수 문구로 고침 */
export async function repairExcelHistoryIntegrityContents(params?: {
  limit?: number;
}): Promise<{ success: boolean; repaired?: number; error?: string }> {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(params?.limit ?? 50))));
  try {
    const rows = await db.execute(sql.raw(
      `SELECT eh_key, eh_table_name
       FROM excel_upload_history
       WHERE eh_contents = '정합성 반영'
         AND eh_table_name IS NOT NULL
         AND btrim(eh_table_name) <> ''
       ORDER BY eh_key DESC
       LIMIT ${limit}`
    ));
    let repaired = 0;
    for (const r of (rows.rows as Array<{ eh_key: number; eh_table_name: string }>) ?? []) {
      const ehKey = Number(r.eh_key);
      const tableName = String(r.eh_table_name ?? '').trim();
      if (!Number.isFinite(ehKey) || !tableName) continue;
      const res = await attachExcelIntegritySyncToHistory({ ehKey, tableName });
      if (res.success) repaired += 1;
    }
    return { success: true, repaired };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 정합성 취소·중도 종료 시 미결(미적용) 비교 로그만 삭제 */
export async function clearPendingExcelSyncLogs(params: {
  tableName: string;
}): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
  const tableName = safeIdent(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  try {
    const del = await db.execute(sql.raw(
      `DELETE FROM excel_sync_log
       WHERE esl_table_name = '${tableName}' AND esl_operation IS NULL
       RETURNING esl_key`
    ));
    return { success: true, deletedCount: (del.rows as unknown[])?.length ?? 0 };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** SyncDetailModal 호환 — 미결 키 목록 */
export async function getSyncLogPendingKeys(params: {
  ehKey?: number;
  dhKey?: number;
  tableName?: string;
  fieldFilters?: string[];
  opFilters?: string[];
}): Promise<{ success: boolean; keys: number[]; error?: string }> {
  const built = buildExcelSyncWhere({
    ehKey: params.ehKey,
    dhKey: params.dhKey,
    tableName: params.tableName,
    tab: 'pending',
    opFilters: params.opFilters,
  });
  if (built.error) return { success: false, keys: [], error: built.error };
  try {
    const res = await db.execute(sql.raw(
      `SELECT esl_key FROM excel_sync_log WHERE ${built.where} ORDER BY esl_key`
    ));
    const keys = (res.rows as Array<{ esl_key: number }>).map((r) => Number(r.esl_key));
    return { success: true, keys };
  } catch (e: unknown) {
    return { success: false, keys: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * SyncDetailModal 호환 — 미결 → Excel 반영(의도).
 * intentOnly=true(기본 위저드): DB 레이어는 건드리지 않고 operation만 기록(applied_at NULL).
 * intentOnly=false: 레이어 직접 반영은 지원하지 않음(위저드 commit / applyExcelIntegritySync 사용).
 */
export async function applySyncEntries(params: {
  slKeys: number[];
  ehKey?: number;
  dhKey?: number;
  intentOnly?: boolean;
}): Promise<{
  success: boolean;
  appendedCount: number;
  updatedCount: number;
  removedCount: number;
  error?: string;
}> {
  const slKeys = (params?.slKeys ?? [])
    .map((k) => Math.trunc(Number(k)))
    .filter((k) => Number.isFinite(k) && k > 0);
  if (!slKeys.length) {
    return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: 'slKeys가 필요합니다.' };
  }
  if (params.intentOnly === false) {
    return {
      success: false,
      appendedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      error: '엑셀 레이어 직접 반영은 위저드 완료(정합성 확정)에서 처리합니다.',
    };
  }
  const ehKey = params.ehKey ?? params.dhKey;
  const ehSql = ehKey != null && Number.isFinite(Number(ehKey)) ? String(Math.trunc(Number(ehKey))) : 'NULL';
  try {
    const keyList = slKeys.join(', ');
    const logRes = await db.execute(sql.raw(
      `SELECT esl_key, esl_old_data, esl_new_data
       FROM excel_sync_log
       WHERE esl_key IN (${keyList}) AND esl_operation IS NULL
       ORDER BY esl_key`
    ));
    const logs = logRes.rows as Array<{
      esl_key: number;
      esl_old_data: Record<string, unknown> | null;
      esl_new_data: Record<string, unknown> | null;
    }>;
    let appendedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    for (const log of logs) {
      const hasOld = log.esl_old_data != null && Object.keys(log.esl_old_data).length > 0;
      const hasNew = log.esl_new_data != null && Object.keys(log.esl_new_data).length > 0;
      let op: string | null = null;
      if (!hasOld && hasNew) {
        op = 'append';
        appendedCount++;
      } else if (hasOld && hasNew) {
        op = 'conflict';
        updatedCount++;
      } else if (hasOld && !hasNew) {
        op = 'remove';
        removedCount++;
      }
      if (!op) continue;
      await db.execute(sql.raw(
        `UPDATE excel_sync_log
         SET esl_operation = '${op}',
             esl_applied_at = NULL,
             esl_eh_key = COALESCE(esl_eh_key, ${ehSql})
         WHERE esl_key = ${log.esl_key}`
      ));
    }
    return { success: true, appendedCount, updatedCount, removedCount };
  } catch (e: unknown) {
    return {
      success: false,
      appendedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** SyncDetailModal 호환 — 미결을 유지(kept) 의도로 표시 */
export async function keepSyncEntries(params: {
  slKeys: number[];
  ehKey?: number;
  dhKey?: number;
  intentOnly?: boolean;
}): Promise<{ success: boolean; keptCount: number; error?: string }> {
  const slKeys = (params?.slKeys ?? [])
    .map((k) => Math.trunc(Number(k)))
    .filter((k) => Number.isFinite(k) && k > 0);
  if (!slKeys.length) return { success: false, keptCount: 0, error: 'slKeys가 필요합니다.' };
  const ehKey = params.ehKey ?? params.dhKey;
  const ehSql = ehKey != null && Number.isFinite(Number(ehKey)) ? String(Math.trunc(Number(ehKey))) : 'NULL';
  const appliedSql = params.intentOnly === false ? 'NOW()' : 'NULL';
  try {
    const keyList = slKeys.join(', ');
    const res = await db.execute(sql.raw(
      `UPDATE excel_sync_log
       SET esl_operation = 'kept',
           esl_applied_at = ${appliedSql},
           esl_eh_key = COALESCE(esl_eh_key, ${ehSql})
       WHERE esl_key IN (${keyList}) AND esl_operation IS NULL
       RETURNING esl_key`
    ));
    return { success: true, keptCount: (res.rows as unknown[])?.length ?? 0 };
  } catch (e: unknown) {
    return { success: false, keptCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** SyncDetailModal 호환 — 미반영 의도 취소 → 다시 미결 */
export async function clearSyncIntents(params: {
  slKeys: number[];
}): Promise<{ success: boolean; clearedCount: number; error?: string }> {
  const slKeys = (params?.slKeys ?? [])
    .map((k) => Math.trunc(Number(k)))
    .filter((k) => Number.isFinite(k) && k > 0);
  if (!slKeys.length) return { success: false, clearedCount: 0, error: 'slKeys가 필요합니다.' };
  try {
    const keyList = slKeys.join(', ');
    const res = await db.execute(sql.raw(
      `UPDATE excel_sync_log
       SET esl_operation = NULL, esl_applied_at = NULL
       WHERE esl_key IN (${keyList})
         AND esl_operation IS NOT NULL
         AND esl_applied_at IS NULL
       RETURNING esl_key`
    ));
    return { success: true, clearedCount: (res.rows as unknown[])?.length ?? 0 };
  } catch (e: unknown) {
    return { success: false, clearedCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 위저드: 테이블의 의도·미결 현황 (닫을 때 확정/취소 판단) */
export async function getExcelIntegrityIntentSummary(params: {
  tableName: string;
}): Promise<{
  success: boolean;
  pendingCount: number;
  appendKeys: string[];
  conflictKeys: string[];
  removeKeys: string[];
  keptKeys: string[];
  error?: string;
}> {
  const tableName = safeIdent(params.tableName);
  if (!tableName) {
    return {
      success: false,
      pendingCount: 0,
      appendKeys: [],
      conflictKeys: [],
      removeKeys: [],
      keptKeys: [],
      error: 'tableName이 필요합니다.',
    };
  }
  try {
    const pendingRes = await db.execute(sql.raw(
      `SELECT count(*)::int AS cnt FROM excel_sync_log
       WHERE esl_table_name = '${tableName}'
         AND esl_eh_key IS NULL
         AND esl_operation IS NULL`
    ));
    const pendingCount = Number((pendingRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    const intentRes = await db.execute(sql.raw(
      `SELECT esl_operation, esl_key_value
       FROM excel_sync_log
       WHERE esl_table_name = '${tableName}'
         AND esl_eh_key IS NULL
         AND esl_operation IS NOT NULL
         AND esl_applied_at IS NULL`
    ));
    const appendKeys: string[] = [];
    const conflictKeys: string[] = [];
    const removeKeys: string[] = [];
    const keptKeys: string[] = [];
    for (const row of intentRes.rows as Array<{ esl_operation: string; esl_key_value: string }>) {
      const kv = String(row.esl_key_value ?? '').trim();
      if (!kv) continue;
      if (row.esl_operation === 'append') appendKeys.push(kv);
      else if (row.esl_operation === 'conflict') conflictKeys.push(kv);
      else if (row.esl_operation === 'remove') removeKeys.push(kv);
      else if (row.esl_operation === 'kept') keptKeys.push(kv);
    }
    return { success: true, pendingCount, appendKeys, conflictKeys, removeKeys, keptKeys };
  } catch (e: unknown) {
    return {
      success: false,
      pendingCount: 0,
      appendKeys: [],
      conflictKeys: [],
      removeKeys: [],
      keptKeys: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 위저드 취소: 미결 + 미반영 의도 모두 삭제 */
export async function discardExcelIntegrityReview(params: {
  tableName: string;
}): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
  const tableName = safeIdent(params.tableName);
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  try {
    const del = await db.execute(sql.raw(
      `DELETE FROM excel_sync_log
       WHERE esl_table_name = '${tableName}'
         AND (
           esl_operation IS NULL
           OR (esl_operation IS NOT NULL AND esl_applied_at IS NULL)
         )
       RETURNING esl_key`
    ));
    return { success: true, deletedCount: (del.rows as unknown[])?.length ?? 0 };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Excel 이력 목록 조회 (페이징) */
export async function getExcelHistoryList(params?: {
  page?: number;
  limit?: number;
}): Promise<{ success: boolean; data: ExcelHistoryRow[]; total: number; error?: string }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
  const offset = (page - 1) * limit;
  try {
    const [rows, countRes] = await Promise.all([
      db.execute(sql.raw(
        `SELECT
           eh.eh_key,
           eh.eh_source_path,
           eh.eh_table_name,
           eh.eh_table_kor_name,
           eh.eh_group,
           eh.eh_old_row_count,
           eh.eh_row_count,
           eh.eh_result,
           eh.eh_contents,
           to_char(
             eh.eh_create_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul',
             'YYYY-MM-DD HH24:MI:SS'
           ) AS eh_create_date,
           eh.eh_create_user,
           eh.eh_geocoding_header_kor,
           eh.eh_geocoding_header_eng,
           eh.eh_geometry_type,
           COALESCE(agg.append_cnt, 0)::int AS append_count,
           COALESCE(agg.conflict_cnt, 0)::int AS conflict_count,
           COALESCE(agg.remove_cnt, 0)::int AS remove_count,
           COALESCE(agg.kept_cnt, 0)::int AS kept_count
         FROM excel_upload_history eh
         LEFT JOIN LATERAL (
           SELECT
             count(*) FILTER (WHERE esl.esl_operation = 'append') AS append_cnt,
             count(*) FILTER (WHERE esl.esl_operation = 'conflict') AS conflict_cnt,
             count(*) FILTER (WHERE esl.esl_operation = 'remove') AS remove_cnt,
             count(*) FILTER (WHERE esl.esl_operation = 'kept') AS kept_cnt
           FROM excel_sync_log esl
           WHERE esl.esl_eh_key = eh.eh_key
         ) agg ON true
         ORDER BY eh.eh_key DESC
         LIMIT ${limit} OFFSET ${offset}`
      )),
      db.select({ count: sql<number>`count(*)::int` }).from(eh),
    ]);
    const total = countRes[0]?.count ?? 0;
    const data = ((rows.rows as Array<Record<string, unknown>>) ?? []).map((r) => ({
      ehKey: Number(r.eh_key),
      ehSourcePath: (r.eh_source_path as string | null) ?? null,
      ehTableName: (r.eh_table_name as string | null) ?? null,
      ehTableKorName: (r.eh_table_kor_name as string | null) ?? null,
      ehGroup: (r.eh_group as string | null) ?? null,
      ehOldRowCount: r.eh_old_row_count != null ? Number(r.eh_old_row_count) : null,
      ehRowCount: r.eh_row_count != null ? Number(r.eh_row_count) : null,
      ehResult: (r.eh_result as string | null) ?? null,
      ehContents: (r.eh_contents as string | null) ?? null,
      ehCreateDate: (r.eh_create_date as Date | string | null) ?? null,
      ehCreateUser: r.eh_create_user != null ? Number(r.eh_create_user) : null,
      ehGeocodingHeaderKor: (r.eh_geocoding_header_kor as string | null) ?? null,
      ehGeocodingHeaderEng: (r.eh_geocoding_header_eng as string | null) ?? null,
      ehGeometryType: (r.eh_geometry_type as string | null) ?? null,
      appendCount: Number(r.append_count ?? 0),
      conflictCount: Number(r.conflict_count ?? 0),
      removeCount: Number(r.remove_count ?? 0),
      keptCount: Number(r.kept_count ?? 0),
    }));
    return { success: true, data, total };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], total: 0, error: msg };
  }
}

/** 테이블별 최신 이력 1건 (eh_table_name 기준, eh_create_date 내림). 도형 대상 컬럼·도형타입 포함 → 다음 업로드 시 자동 불러오기용 */
export async function getLatestExcelHistoryByTables(): Promise<{
  success: boolean;
  map: Record<string, {
    sourcePath: string | null;
    createDate: Date | string | null;
    geocodingHeaderKor: string | null;
    geocodingHeaderEng: string | null;
    geometryType: string | null;
  }>;
  error?: string;
}> {
  try {
    const rows = await db
      .select({
        ehTableName: eh.ehTableName,
        ehSourcePath: eh.ehSourcePath,
        ehCreateDate: eh.ehCreateDate,
        ehGeocodingHeaderKor: eh.ehGeocodingHeaderKor,
        ehGeocodingHeaderEng: eh.ehGeocodingHeaderEng,
        ehGeometryType: eh.ehGeometryType,
      })
      .from(eh)
      .orderBy(eh.ehTableName, desc(eh.ehCreateDate));
    const map: Record<string, {
      sourcePath: string | null;
      createDate: Date | string | null;
      geocodingHeaderKor: string | null;
      geocodingHeaderEng: string | null;
      geometryType: string | null;
    }> = {};
    for (const r of rows) {
      const name = r.ehTableName ?? '';
      if (name && !map[name]) {
        map[name] = {
          sourcePath: r.ehSourcePath ?? null,
          createDate: r.ehCreateDate ?? null,
          geocodingHeaderKor: r.ehGeocodingHeaderKor ?? null,
          geocodingHeaderEng: r.ehGeocodingHeaderEng ?? null,
          geometryType: r.ehGeometryType ?? null,
        };
      }
    }
    return { success: true, map };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, map: {}, error: msg };
  }
}

/** 테이블명으로 해당 테이블의 최신 이력 1건 조회 (재업로드 시 도형대상 컬럼·도형타입 등 자동 불러오기용). API 호출 시 params: { tableName } */
export async function getLatestExcelHistoryByTable(params: { tableName?: string }): Promise<{
  success: boolean;
  data: ExcelHistoryRow | null;
  error?: string;
}> {
  const tableName = params?.tableName?.trim();
  if (!tableName) {
    return { success: true, data: null };
  }
  try {
    const rows = await db
      .select()
      .from(eh)
      .where(eq(eh.ehTableName, tableName))
      .orderBy(desc(eh.ehCreateDate))
      .limit(1);
    const r = rows[0];
    if (!r) return { success: true, data: null };
    return {
      success: true,
      data: {
        ehKey: r.ehKey,
        ehSourcePath: r.ehSourcePath,
        ehTableName: r.ehTableName,
        ehTableKorName: r.ehTableKorName,
        ehGroup: r.ehGroup,
        ehOldRowCount: r.ehOldRowCount ?? null,
        ehRowCount: r.ehRowCount,
        ehResult: r.ehResult,
        ehContents: r.ehContents,
        ehCreateDate: r.ehCreateDate,
        ehCreateUser: r.ehCreateUser,
        ehGeocodingHeaderKor: r.ehGeocodingHeaderKor ?? null,
        ehGeocodingHeaderEng: r.ehGeocodingHeaderEng ?? null,
        ehGeometryType: r.ehGeometryType ?? null,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: null, error: msg };
  }
}

/**
 * 이력의 엑셀 경로와 동일 폴더·동일 basename의 `.log` 내용을 읽는다.
 * writeExcelWizardLog 와 같은 경로 규칙.
 */
export async function getExcelHistoryLog(params: {
  sourcePath?: string;
}): Promise<{
  success: boolean;
  content?: string;
  logPath?: string;
  truncated?: boolean;
  error?: string;
}> {
  const sourcePath = params?.sourcePath?.trim();
  if (!sourcePath) {
    return { success: false, error: '파일 경로가 없습니다.' };
  }

  const relative = sourcePath.replace(/\//g, path.sep).replace(/^[/\\]+/, '');
  const absoluteDir = path.join(GGNR_DATA_DIR, path.dirname(relative));
  const base = path.basename(relative).replace(/\.xlsx?$/i, '');
  const logAbs = path.resolve(absoluteDir, `${base}.log`);
  const dataRoot = path.resolve(GGNR_DATA_DIR);
  const relToRoot = path.relative(dataRoot, logAbs);
  if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    return { success: false, error: '허용되지 않은 경로입니다.' };
  }

  const logRelative = relToRoot.replace(/\\/g, '/');

  try {
    const stat = await fs.stat(logAbs);
    if (!stat.isFile()) {
      return { success: false, logPath: logRelative, error: '로그 파일이 없습니다.' };
    }
    const buf = await fs.readFile(logAbs);
    const truncated = buf.length > MAX_LOG_BYTES;
    const slice = truncated ? buf.subarray(0, MAX_LOG_BYTES) : buf;
    let content = slice.toString('utf-8');
    if (truncated) {
      content += `\n\n… (이하 생략: 파일이 ${MAX_LOG_BYTES}바이트를 초과합니다)`;
    }
    return { success: true, content, logPath: logRelative, truncated };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { success: false, logPath: logRelative, error: '로그 파일이 없습니다.' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, logPath: logRelative, error: msg };
  }
}

/**
 * 덮어쓰기(TRUNCATE) 직전: 기존 테이블 행을 excel_sync_log 미결로 스냅샷.
 * old 속성·도형을 남긴 뒤 TRUNCATE 해도 비교·remove 확정이 가능하다.
 */
export async function captureExcelSyncLogBeforeOverwrite(params: {
  tableName: string;
  keyField: string;
}): Promise<{ success: boolean; capturedCount?: number; error?: string }> {
  const tableName = safeIdent(params.tableName);
  const keyField = safeIdent(params.keyField);
  if (!tableName || !keyField) {
    return { success: false, error: 'tableName과 keyField가 필요합니다.' };
  }
  try {
    await db.execute(sql.raw(
      `DELETE FROM excel_sync_log
       WHERE esl_table_name = '${tableName}' AND esl_operation IS NULL`
    ));
    const ins = await db.execute(sql.raw(
      `INSERT INTO excel_sync_log (esl_table_name, esl_key_field, esl_key_value, esl_old_data, esl_new_data)
       SELECT '${tableName}', '${keyField}', t."${keyField}"::text,
         ${excelLayerRowJsonbSql('t')},
         NULL
       FROM layer."${tableName}" t
       WHERE t."${keyField}" IS NOT NULL
         AND btrim(t."${keyField}"::text) <> ''
       RETURNING esl_key`
    ));
    const capturedCount = (ins.rows as unknown[])?.length ?? 0;
    if (capturedCount > 0) {
      await fillPendingExcelSyncLogOldGeoms({ tableName, keyField });
      await syncExcelSyncLogJsonGeomFromSideTable({ tableName });
    }
    return { success: true, capturedCount };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function mirrorExcelEhKeyToDataLog(params: {
  ehKey: number;
  tableName: string;
  /** usrId(usrName) 형식 */
  logUser?: string | null;
}): Promise<void> {
  try {
    const batchKey = `excel:${params.ehKey}`;
    const already = await db.execute(sql.raw(
      `SELECT 1 AS ok FROM data_log WHERE dl_batch_key = '${batchKey.replace(/'/g, "''")}' LIMIT 1`
    ));
    if ((already.rows as unknown[])?.length) return;

    let logUser = String(params.logUser ?? '').trim() || null;
    let group: string | null = null;
    let tableKorName: string | null = null;
    {
      const metaRes = await db.execute(sql.raw(
        `SELECT
           COALESCE(u.usr_id, eh.eh_create_user::text) AS usr_id,
           COALESCE(u.usr_name, '') AS usr_name,
           NULLIF(btrim(eh.eh_group), '') AS eh_group,
           NULLIF(btrim(eh.eh_table_kor_name), '') AS eh_kor
         FROM excel_upload_history eh
         LEFT JOIN usr u ON u.usr_id = eh.eh_create_user::text
         WHERE eh.eh_key = ${params.ehKey}
         LIMIT 1`
      ));
      const urow = (metaRes.rows as Array<{
        usr_id?: string;
        usr_name?: string;
        eh_group?: string | null;
        eh_kor?: string | null;
      }>)?.[0];
      if (!logUser) {
        const id = String(urow?.usr_id ?? '').trim();
        const name = String(urow?.usr_name ?? '').trim();
        if (id && name) logUser = `${id}(${name})`;
        else if (id) logUser = id;
      }
      group = String(urow?.eh_group ?? '').trim() || null;
      tableKorName = String(urow?.eh_kor ?? '').trim() || null;
    }

    const res = await db.execute(sql.raw(
      `SELECT esl_key, esl_key_field, esl_key_value, esl_operation, esl_old_data, esl_new_data
       FROM excel_sync_log
       WHERE esl_eh_key = ${params.ehKey}
         AND esl_operation IS NOT NULL
         AND esl_operation <> 'kept'`
    ));
    const { fetchExcelSyncLogGeomAsGeoJson, fetchLayerGeomAsGeoJson } = await import('@/lib/syncLogGeom');
    const rawRows = res.rows as Array<{
      esl_key: number;
      esl_key_field: string;
      esl_key_value: string;
      esl_operation: string;
      esl_old_data: Record<string, unknown> | null;
      esl_new_data: Record<string, unknown> | null;
    }>;

    const isGeomMetaOnly = (g: unknown): boolean => {
      if (g == null || typeof g !== 'object' || Array.isArray(g)) return false;
      const o = g as Record<string, unknown>;
      if ('coordinates' in o || 'geometries' in o) return false;
      return typeof o.hash === 'string' || o._meta === true;
    };

    const stripOrReplaceGeomMeta = (
      data: Record<string, unknown> | null,
      full: unknown | null,
    ): void => {
      if (!data) return;
      if (full != null) {
        data.geom = full;
      } else if (data.__rollback_geom != null && !isGeomMetaOnly(data.__rollback_geom)) {
        data.geom = data.__rollback_geom;
      } else if (isGeomMetaOnly(data.geom)) {
        delete data.geom;
      }
      delete data.__rollback_geom;
    };

    const rows = [];
    for (const r of rawRows) {
      const oldData = r.esl_old_data && typeof r.esl_old_data === 'object'
        ? { ...r.esl_old_data }
        : null;
      const newData = r.esl_new_data && typeof r.esl_new_data === 'object'
        ? { ...r.esl_new_data }
        : null;
      const [oldG, newG] = await Promise.all([
        fetchExcelSyncLogGeomAsGeoJson(r.esl_key, 'old'),
        fetchExcelSyncLogGeomAsGeoJson(r.esl_key, 'new'),
      ]);
      stripOrReplaceGeomMeta(oldData, oldG);
      let resolvedNew = newG;
      // new 전용 도형이 없고 메타만 있으면 반영 후 레이어 좌표로 보강
      if (
        resolvedNew == null
        && newData
        && isGeomMetaOnly(newData.geom)
        && (r.esl_operation === 'append' || r.esl_operation === 'conflict')
      ) {
        resolvedNew = await fetchLayerGeomAsGeoJson({
          tableName: params.tableName,
          keyField: r.esl_key_field,
          keyValue: r.esl_key_value,
        });
      }
      stripOrReplaceGeomMeta(newData, resolvedNew);
      rows.push({
        keyField: r.esl_key_field,
        keyValue: r.esl_key_value,
        operation: r.esl_operation,
        oldData,
        newData,
      });
    }
    if (rows.length === 0) return;
    await recordDataLogsFromSyncStyleRows({
      source: 'Excel 업로드',
      tableName: params.tableName,
      tableKorName,
      group,
      batchKey,
      serviceName: 'Excel 업로드',
      user: logUser,
      rows,
    });
  } catch (e) {
    console.warn(
      '[mirrorExcelEhKeyToDataLog]',
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * 업로드·배치 이력 생성 후: 미결 스냅샷과 현재 테이블을 비교해
 * append / conflict / remove 로 확정한다. 동일(unchanged) 미결은 삭제한다.
 * 스냅샷이 없으면(신규 테이블) 현재 행 전체를 append 로 기록한다.
 * 확정 결과는 통합 data_log 에도 반영한다.
 */
export async function finalizeExcelSyncLogsAfterUpload(params: {
  ehKey: number;
  tableName: string;
  keyField: string;
  /** usrId(usrName) — 통합 data_log 작업자 */
  logUser?: string | null;
}): Promise<{
  success: boolean;
  appendCount?: number;
  conflictCount?: number;
  removeCount?: number;
  unchangedSkipped?: number;
  error?: string;
}> {
  const ehKey = Math.trunc(Number(params.ehKey));
  const tableName = safeIdent(params.tableName);
  const keyField = safeIdent(params.keyField);
  const logUser = params.logUser?.trim() || null;
  if (!Number.isFinite(ehKey) || ehKey <= 0) {
    return { success: false, error: 'ehKey가 필요합니다.' };
  }
  if (!tableName || !keyField) {
    return { success: false, error: 'tableName과 keyField가 필요합니다.' };
  }

  try {
    const pendingRes = await db.execute(sql.raw(
      `SELECT count(*)::int AS cnt FROM excel_sync_log
       WHERE esl_table_name = '${tableName}' AND esl_operation IS NULL`
    ));
    const pendingCount = (pendingRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;

    if (pendingCount === 0) {
      const appendIns = await db.execute(sql.raw(
        `INSERT INTO excel_sync_log (
           esl_eh_key, esl_table_name, esl_key_field, esl_key_value,
           esl_old_data, esl_new_data, esl_operation, esl_applied_at
         )
         SELECT ${ehKey}, '${tableName}', '${keyField}', t."${keyField}"::text,
           NULL,
           ${excelLayerRowJsonbSql('t')},
           'append',
           NOW()
         FROM layer."${tableName}" t
         WHERE t."${keyField}" IS NOT NULL
           AND btrim(t."${keyField}"::text) <> ''
         RETURNING esl_key`
      ));
      const appendCount = (appendIns.rows as unknown[])?.length ?? 0;
      if (appendCount > 0) {
        await fillExcelSyncLogNewGeoms({ ehKey, tableName, keyField });
        await syncExcelSyncLogJsonGeomFromSideTable({ tableName, ehKey });
      }
      await mirrorExcelEhKeyToDataLog({ ehKey, tableName, logUser });
      await refreshExcelHistoryReplaceContents(ehKey);
      return { success: true, appendCount, conflictCount: 0, removeCount: 0, unchangedSkipped: 0 };
    }

    // 현재 테이블에 있는 키: new_data 채움 (geom GeoJSON 포함)
    await db.execute(sql.raw(
      `UPDATE excel_sync_log esl
       SET esl_new_data = ${excelLayerRowJsonbSql('t')}
       FROM layer."${tableName}" t
       WHERE esl.esl_table_name = '${tableName}'
         AND esl.esl_operation IS NULL
         AND esl.esl_old_data IS NOT NULL
         AND t."${keyField}"::text = esl.esl_key_value`
    ));

    // 속성 동일 → 미결 삭제 (용량 절감)
    const delUnchanged = await db.execute(sql.raw(
      `DELETE FROM excel_sync_log
       WHERE esl_table_name = '${tableName}'
         AND esl_operation IS NULL
         AND esl_old_data IS NOT NULL
         AND esl_new_data IS NOT NULL
         AND esl_old_data = esl_new_data
       RETURNING esl_key`
    ));
    const unchangedSkipped = (delUnchanged.rows as unknown[])?.length ?? 0;

    // 변경(conflict)
    const conflictRes = await db.execute(sql.raw(
      `UPDATE excel_sync_log
       SET esl_eh_key = ${ehKey},
           esl_operation = 'conflict',
           esl_applied_at = NOW()
       WHERE esl_table_name = '${tableName}'
         AND esl_operation IS NULL
         AND esl_old_data IS NOT NULL
         AND esl_new_data IS NOT NULL
         AND esl_old_data IS DISTINCT FROM esl_new_data
       RETURNING esl_key`
    ));
    const conflictCount = (conflictRes.rows as unknown[])?.length ?? 0;

    // 삭제(remove): 새 테이블에 키 없음
    const removeRes = await db.execute(sql.raw(
      `UPDATE excel_sync_log
       SET esl_eh_key = ${ehKey},
           esl_operation = 'remove',
           esl_applied_at = NOW()
       WHERE esl_table_name = '${tableName}'
         AND esl_operation IS NULL
         AND esl_old_data IS NOT NULL
         AND esl_new_data IS NULL
       RETURNING esl_key`
    ));
    const removeCount = (removeRes.rows as unknown[])?.length ?? 0;

    // 추가(append): 스냅샷에 없던 현재 키
    const appendIns = await db.execute(sql.raw(
      `INSERT INTO excel_sync_log (
         esl_eh_key, esl_table_name, esl_key_field, esl_key_value,
         esl_old_data, esl_new_data, esl_operation, esl_applied_at
       )
       SELECT ${ehKey}, '${tableName}', '${keyField}', t."${keyField}"::text,
         NULL,
         ${excelLayerRowJsonbSql('t')},
         'append',
         NOW()
       FROM layer."${tableName}" t
       WHERE t."${keyField}" IS NOT NULL
         AND btrim(t."${keyField}"::text) <> ''
         AND NOT EXISTS (
           SELECT 1 FROM excel_sync_log esl
           WHERE esl.esl_table_name = '${tableName}'
             AND esl.esl_eh_key = ${ehKey}
             AND esl.esl_key_value = t."${keyField}"::text
         )
         AND NOT EXISTS (
           SELECT 1 FROM excel_sync_log esl2
           WHERE esl2.esl_table_name = '${tableName}'
             AND esl2.esl_operation IS NULL
             AND esl2.esl_key_value = t."${keyField}"::text
         )
       RETURNING esl_key`
    ));
    const appendCount = (appendIns.rows as unknown[])?.length ?? 0;

    // 남은 미결 정리 (예외 잔여)
    await db.execute(sql.raw(
      `DELETE FROM excel_sync_log
       WHERE esl_table_name = '${tableName}' AND esl_operation IS NULL`
    ));

    await fillExcelSyncLogNewGeoms({ ehKey, tableName, keyField });
    await syncExcelSyncLogJsonGeomFromSideTable({ tableName, ehKey });

    await mirrorExcelEhKeyToDataLog({ ehKey, tableName, logUser });

    await refreshExcelHistoryReplaceContents(ehKey);

    return {
      success: true,
      appendCount,
      conflictCount,
      removeCount,
      unchangedSkipped,
    };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ───────── Excel 이력 조회 (SyncDetailModal 호환, sl_* 별칭) ───────── */

type ExcelSyncTab = 'all' | 'pending' | 'update' | 'kept' | 'append' | 'remove';

function buildExcelSyncWhere(params: {
  ehKey?: number;
  tableName?: string;
  strictEhKey?: boolean;
  /** SyncDetailModal이 dhKey 자리에 ehKey를 넣을 때 호환 */
  dhKey?: number;
  strictDhKey?: boolean;
  tab?: ExcelSyncTab;
  opFilters?: string[];
}): { where: string; error?: string } {
  const ehKey = Math.trunc(Number(params.ehKey ?? params.dhKey ?? 0));
  const strict = params.strictEhKey === true || params.strictDhKey === true;
  const tableName = String(params.tableName ?? '').trim().toLowerCase();
  if ((!Number.isFinite(ehKey) || ehKey <= 0) && !tableName) {
    return { where: '', error: 'ehKey 또는 tableName이 필요합니다.' };
  }
  let where: string;
  if (Number.isFinite(ehKey) && ehKey > 0 && strict) {
    where = `esl_eh_key = ${ehKey}`;
  } else if (Number.isFinite(ehKey) && ehKey > 0 && tableName) {
    where = `esl_eh_key = ${ehKey} AND LOWER(esl_table_name) = '${tableName.replace(/'/g, "''")}'`;
  } else if (Number.isFinite(ehKey) && ehKey > 0) {
    where = `esl_eh_key = ${ehKey}`;
  } else {
    // 위저드(이력 미배정): 이번 비교·의도만. 과거 확정 로그(eh_key 있음)는 제외
    where = `LOWER(esl_table_name) = '${tableName.replace(/'/g, "''")}' AND esl_eh_key IS NULL`;
  }

  const tab = params.tab;
  if (tab && tab !== 'all') {
    if (tab === 'pending') where += ` AND esl_operation IS NULL`;
    else if (tab === 'update') where += ` AND esl_operation = 'conflict'`;
    else if (tab === 'kept') where += ` AND esl_operation = 'kept'`;
    else if (tab === 'append') where += ` AND esl_operation = 'append'`;
    else if (tab === 'remove') where += ` AND esl_operation = 'remove'`;
  }

  const ops = (params.opFilters ?? []).map((o) => String(o).trim()).filter(Boolean);
  if (ops.length > 0) {
    const parts: string[] = [];
    if (ops.includes('new')) {
      parts.push(`(esl_operation = 'append' OR (esl_operation IS NULL AND esl_old_data IS NULL AND esl_new_data IS NOT NULL))`);
    }
    if (ops.includes('pending_conflict')) {
      parts.push(`(esl_operation IS NULL AND esl_old_data IS NOT NULL AND esl_new_data IS NOT NULL)`);
    }
    if (ops.includes('changed') || ops.includes('conflict')) {
      parts.push(`(esl_operation = 'conflict')`);
    }
    if (ops.includes('delete')) {
      parts.push(`(esl_operation = 'remove' OR (esl_operation IS NULL AND esl_old_data IS NOT NULL AND esl_new_data IS NULL))`);
    }
    if (ops.includes('kept')) parts.push(`(esl_operation = 'kept')`);
    if (ops.includes('kept_new')) {
      parts.push(`(esl_operation = 'kept' AND esl_old_data IS NULL AND esl_new_data IS NOT NULL)`);
    }
    if (ops.includes('kept_conflict')) {
      parts.push(`(esl_operation = 'kept' AND esl_old_data IS NOT NULL AND esl_new_data IS NOT NULL)`);
    }
    if (ops.includes('kept_delete')) {
      parts.push(`(esl_operation = 'kept' AND esl_old_data IS NOT NULL AND esl_new_data IS NULL)`);
    }
    if (parts.length) where += ` AND (${parts.join(' OR ')})`;
  }
  return { where };
}

/** SyncDetailModal 호환 — getSyncLogs */
export async function getSyncLogs(params: {
  ehKey?: number;
  dhKey?: number;
  tableName?: string;
  strictEhKey?: boolean;
  strictDhKey?: boolean;
  tab?: ExcelSyncTab;
  page?: number;
  limit?: number;
  light?: boolean;
  includeCounts?: boolean;
  includeTotal?: boolean;
  countOnly?: boolean;
  fieldFilters?: string[];
  opFilters?: string[];
}): Promise<{
  success: boolean;
  rows: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  limit?: number;
  counts?: {
    all: number;
    pending: number;
    updated: number;
    kept: number;
    append: number;
    remove: number;
    rolledBack: number;
  };
  error?: string;
}> {
  const built = buildExcelSyncWhere(params);
  if (built.error) return { success: false, rows: [], error: built.error };
  const { where } = built;
  const usePaging = params.page != null && params.limit != null && params.limit > 0;
  const pageNum = usePaging ? Math.max(1, Math.floor(params.page!)) : 1;
  const pageSize = usePaging ? Math.min(500, Math.max(1, Math.floor(params.limit!))) : 0;
  const offset = usePaging ? (pageNum - 1) * pageSize : 0;

  try {
    if (params.countOnly) {
      const totalRes = await db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM excel_sync_log WHERE ${where}`
      ));
      const total = (totalRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
      return {
        success: true,
        rows: [],
        total,
        ...(usePaging ? { page: pageNum, limit: pageSize || 50 } : {}),
      };
    }

    const light = params.light !== false;
    /** light: 대량 GeoJSON 제외, type/hash 메타 geom은 목록 «도형 변경» 표시용으로 유지 */
    const lightGeomSql = (col: 'esl_old_data' | 'esl_new_data') =>
      `CASE
         WHEN ${col} IS NULL THEN NULL
         WHEN ${col}->'geom' IS NULL THEN (${col} - 'geom')
         WHEN (${col}->'geom' ? 'coordinates') OR (${col}->'geom' ? 'geometries') THEN
           (${col} - 'geom') || jsonb_build_object(
             'geom',
             jsonb_build_object('type', COALESCE(${col}->'geom'->>'type', 'Geometry'))
           )
         ELSE ${col}
       END`;
    const selectCols = light
      ? `esl_key AS sl_key,
         esl_eh_key AS sl_dh_key,
         esl_table_name AS sl_table_name,
         esl_key_field AS sl_key_field,
         esl_key_value AS sl_key_value,
         esl_operation AS sl_operation,
         ${lightGeomSql('esl_old_data')} AS sl_old_data,
         ${lightGeomSql('esl_new_data')} AS sl_new_data,
         esl_applied_at AS sl_applied_at,
         COALESCE(esl_rolled_back, false) AS sl_rolled_back,
         esl_rolled_back_at AS sl_rolled_back_at,
         esl_created_at AS sl_created_at`
      : `esl_key AS sl_key,
         esl_eh_key AS sl_dh_key,
         esl_table_name AS sl_table_name,
         esl_key_field AS sl_key_field,
         esl_key_value AS sl_key_value,
         esl_operation AS sl_operation,
         esl_old_data AS sl_old_data,
         esl_new_data AS sl_new_data,
         esl_applied_at AS sl_applied_at,
         COALESCE(esl_rolled_back, false) AS sl_rolled_back,
         esl_rolled_back_at AS sl_rolled_back_at,
         esl_created_at AS sl_created_at`;

    const orderBy = `CASE WHEN esl_operation IS NULL THEN 0 WHEN esl_operation = 'kept' THEN 2 ELSE 1 END, esl_key_value, esl_key`;
    const limitSql = usePaging ? ` LIMIT ${pageSize} OFFSET ${offset}` : '';
    const res = await db.execute(sql.raw(
      `SELECT ${selectCols} FROM excel_sync_log WHERE ${where} ORDER BY ${orderBy}${limitSql}`
    ));
    const rows = (res.rows as Array<Record<string, unknown>>) ?? [];

    let total: number | undefined;
    if (params.includeTotal !== false) {
      const totalRes = await db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM excel_sync_log WHERE ${where}`
      ));
      total = (totalRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    }

    let counts:
      | {
          all: number;
          pending: number;
          updated: number;
          kept: number;
          append: number;
          remove: number;
          rolledBack: number;
        }
      | undefined;
    if (params.includeCounts) {
      const base = buildExcelSyncWhere({
        ehKey: params.ehKey,
        dhKey: params.dhKey,
        tableName: params.tableName,
        strictEhKey: params.strictEhKey,
        strictDhKey: params.strictDhKey,
      });
      if (!base.error) {
        const countRes = await db.execute(sql.raw(
          `SELECT
             count(*)::int AS all_cnt,
             count(*) FILTER (WHERE esl_operation IS NULL)::int AS pending,
             count(*) FILTER (WHERE esl_operation = 'conflict')::int AS updated,
             count(*) FILTER (WHERE esl_operation = 'kept')::int AS kept,
             count(*) FILTER (WHERE esl_operation = 'append')::int AS append,
             count(*) FILTER (WHERE esl_operation = 'remove')::int AS remove,
             count(*) FILTER (WHERE esl_rolled_back = true)::int AS rolled_back
           FROM excel_sync_log WHERE ${base.where}`
        ));
        const c = (countRes.rows as Array<Record<string, number>>)[0] ?? {};
        counts = {
          all: Number(c.all_cnt ?? 0),
          pending: Number(c.pending ?? 0),
          updated: Number(c.updated ?? 0),
          kept: Number(c.kept ?? 0),
          append: Number(c.append ?? 0),
          remove: Number(c.remove ?? 0),
          rolledBack: Number(c.rolled_back ?? 0),
        };
      }
    }

    return {
      success: true,
      rows,
      ...(total != null ? { total } : {}),
      ...(usePaging ? { page: pageNum, limit: pageSize } : {}),
      ...(counts ? { counts } : {}),
    };
  } catch (e: unknown) {
    return { success: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** SyncDetailModal 호환 — getSyncLogDetail */
export async function getSyncLogDetail(params: {
  slKey: number;
}): Promise<{ success: boolean; row?: Record<string, unknown>; error?: string }> {
  const slKey = Math.trunc(Number(params?.slKey ?? 0));
  if (!Number.isFinite(slKey) || slKey <= 0) {
    return { success: false, error: 'slKey가 필요합니다.' };
  }
  try {
    const res = await db.execute(sql.raw(
      `SELECT
         esl_key AS sl_key,
         esl_eh_key AS sl_dh_key,
         esl_table_name AS sl_table_name,
         esl_key_field AS sl_key_field,
         esl_key_value AS sl_key_value,
         esl_operation AS sl_operation,
         esl_old_data AS sl_old_data,
         esl_new_data AS sl_new_data,
         esl_applied_at AS sl_applied_at,
         COALESCE(esl_rolled_back, false) AS sl_rolled_back,
         esl_rolled_back_at AS sl_rolled_back_at,
         esl_created_at AS sl_created_at
       FROM excel_sync_log
       WHERE esl_key = ${slKey}
       LIMIT 1`
    ));
    const row = (res.rows as Array<Record<string, unknown>>)[0];
    if (!row) return { success: false, error: '항목을 찾을 수 없습니다.' };

    const { fetchExcelSyncLogGeomAsGeoJson, fetchLayerGeomAsGeoJson } = await import('@/lib/syncLogGeom');

    const asObj = (v: unknown): Record<string, unknown> | null => {
      if (v == null) return null;
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v) as unknown;
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { ...(parsed as Record<string, unknown>) }
            : null;
        } catch {
          return null;
        }
      }
      if (typeof v === 'object' && !Array.isArray(v)) {
        return { ...(v as Record<string, unknown>) };
      }
      return null;
    };

    let oldData = asObj(row.sl_old_data);
    let newData = asObj(row.sl_new_data);
    const [oldG, newG] = await Promise.all([
      fetchExcelSyncLogGeomAsGeoJson(slKey, 'old'),
      fetchExcelSyncLogGeomAsGeoJson(slKey, 'new'),
    ]);

    if (oldG != null) {
      if (!oldData) oldData = {};
      oldData.geom = oldG;
    } else if (oldData || row.sl_old_data != null || String(row.sl_operation ?? '') === 'remove') {
      const tableName = String(row.sl_table_name ?? '');
      const keyField = String(row.sl_key_field ?? '');
      const keyValue = String(row.sl_key_value ?? '');
      const layerG = await fetchLayerGeomAsGeoJson({ tableName, keyField, keyValue });
      if (layerG != null) {
        if (!oldData) oldData = {};
        oldData.geom = layerG;
      }
    }

    if (newG != null) {
      if (!newData) newData = {};
      newData.geom = newG;
    }

    row.sl_old_data = oldData;
    row.sl_new_data = newData;
    return { success: true, row };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** SyncDetailModal 호환 — getSyncLogFieldNames */
export async function getSyncLogFieldNames(params: {
  tableName?: string;
  ehKey?: number;
  dhKey?: number;
}): Promise<{ success: boolean; fields: string[]; error?: string }> {
  const built = buildExcelSyncWhere({
    ehKey: params.ehKey,
    dhKey: params.dhKey,
    tableName: params.tableName,
    strictEhKey: true,
    strictDhKey: true,
  });
  if (built.error) return { success: false, fields: [], error: built.error };
  try {
    const res = await db.execute(sql.raw(
      `SELECT DISTINCT k AS field
       FROM excel_sync_log esl
       CROSS JOIN LATERAL (
         SELECT jsonb_object_keys(COALESCE(esl.esl_old_data, '{}'::jsonb) || COALESCE(esl.esl_new_data, '{}'::jsonb)) AS k
       ) keys
       WHERE ${built.where}
         AND k NOT IN ('geom', 'geometry', 'the_geom', 'shape')
       ORDER BY field
       LIMIT 200`
    ));
    const fields = ((res.rows as Array<{ field?: string }>) ?? [])
      .map((r) => String(r.field ?? '').trim())
      .filter((k) => k && !k.startsWith('__'));
    return { success: true, fields };
  } catch (e: unknown) {
    return { success: false, fields: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** SyncDetailModal 호환 — getSyncLogOpOptions */
export async function getSyncLogOpOptions(params: {
  ehKey?: number;
  dhKey?: number;
  tableName?: string;
  strictEhKey?: boolean;
  strictDhKey?: boolean;
}): Promise<{ success: boolean; options: Array<{ id: string; label: string }>; error?: string }> {
  const built = buildExcelSyncWhere({
    ehKey: params.ehKey,
    dhKey: params.dhKey,
    tableName: params.tableName,
    strictEhKey: params.strictEhKey ?? true,
    strictDhKey: params.strictDhKey ?? true,
  });
  if (built.error) return { success: false, options: [], error: built.error };
  try {
    const res = await db.execute(sql.raw(
      `SELECT
         count(*) FILTER (
           WHERE esl_operation = 'append'
              OR (esl_operation IS NULL AND esl_old_data IS NULL AND esl_new_data IS NOT NULL)
         )::int AS n_new,
         count(*) FILTER (
           WHERE esl_operation IS NULL AND esl_old_data IS NOT NULL AND esl_new_data IS NOT NULL
         )::int AS n_pending_conflict,
         count(*) FILTER (WHERE esl_operation = 'conflict')::int AS n_changed,
         count(*) FILTER (
           WHERE esl_operation = 'remove'
              OR (esl_operation IS NULL AND esl_old_data IS NOT NULL AND esl_new_data IS NULL)
         )::int AS n_delete,
         count(*) FILTER (
           WHERE esl_operation = 'kept' AND esl_old_data IS NULL AND esl_new_data IS NOT NULL
         )::int AS n_kept_new,
         count(*) FILTER (
           WHERE esl_operation = 'kept' AND esl_old_data IS NOT NULL AND esl_new_data IS NOT NULL
         )::int AS n_kept_conflict,
         count(*) FILTER (
           WHERE esl_operation = 'kept' AND esl_old_data IS NOT NULL AND esl_new_data IS NULL
         )::int AS n_kept_delete
       FROM excel_sync_log
       WHERE ${built.where}`
    ));
    const row = (res.rows as Array<Record<string, number>>)[0] ?? {};
    const candidates: Array<{ id: string; label: string; count: number }> = [
      { id: 'new', label: '신규', count: Number(row.n_new ?? 0) },
      { id: 'pending_conflict', label: '충돌', count: Number(row.n_pending_conflict ?? 0) },
      { id: 'changed', label: '변경', count: Number(row.n_changed ?? 0) },
      { id: 'delete', label: '삭제', count: Number(row.n_delete ?? 0) },
      { id: 'kept_new', label: '미추가', count: Number(row.n_kept_new ?? 0) },
      { id: 'kept_conflict', label: '유지', count: Number(row.n_kept_conflict ?? 0) },
      { id: 'kept_delete', label: '미삭제', count: Number(row.n_kept_delete ?? 0) },
    ];
    return {
      success: true,
      options: candidates.filter((c) => c.count > 0).map(({ id, label }) => ({ id, label })),
    };
  } catch (e: unknown) {
    return { success: false, options: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** SyncDetailModal 호환 — getTitleFieldName */
export async function getTitleFieldName(params: {
  tableName: string;
}): Promise<{ success: boolean; titleField: string | null; error?: string }> {
  const tableName = params?.tableName?.trim();
  if (!tableName) return { success: false, titleField: null, error: 'tableName이 필요합니다.' };
  try {
    const fsSync = await import('node:fs');
    const pathMod = await import('node:path');
    const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    const filePath = pathMod.join(
      process.cwd(),
      'src',
      'config',
      'defineLayer',
      'fields',
      `table_${safe}.json`
    );
    if (!fsSync.existsSync(filePath)) return { success: true, titleField: null };
    const fields: Record<string, string>[] = JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
    const titleField = Array.isArray(fields)
      ? fields.find((f) => String(f?.define_field_show_title ?? '').toLowerCase() === 'true')
      : null;
    const name = titleField ? String(titleField.define_field_name ?? '').trim() || null : null;
    return { success: true, titleField: name };
  } catch (e: unknown) {
    return { success: false, titleField: null, error: e instanceof Error ? e.message : String(e) };
  }
}
