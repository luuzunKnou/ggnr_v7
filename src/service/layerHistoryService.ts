/**
 * Layer History Service
 * - layer_history / layer_detail_history CRUD
 */
import { db } from '@/database/db';
import { lh } from '@/database/schema/layer_history';
import { dh } from '@/database/schema/layer_detail_history';
import { sql } from 'drizzle-orm';
import { desc, eq } from 'drizzle-orm';

/** 작업일 — KST 기준 YYYY-MM-DD (UTC toISOString().slice(0,10)는 KST 오전에 전날로 기록됨) */
function todayWorkDateString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export type LayerHistoryRow = {
  lhKey: number;
  lhContents: string | null;
  lhSuccessCount: number | null;
  lhFailCount: number | null;
  lhCreateUser: number | null;
  lhCreateDate: string | null;
};

export type LayerDetailRow = {
  dhKey: number;
  dhLhKey: number | null;
  dhGroup: string | null;
  dhName: string | null;
  dhKorName: string | null;
  dhType: string | null;
  dhOldData: number | null;
  dhNewData: number | null;
  dhAppendCount: number | null;
  dhConflictCount: number | null;
  dhRemoveCount: number | null;
  dhContents: string | null;
  dhResult: string | null;
  dhShpPath: string | null;
};

/** 테이블별 수정 이력 (layer_detail_history + layer_history) */
export async function getLayerDetailHistoryByTable(params: {
  tableName: string;
  limit?: number;
}): Promise<{ success: boolean; data: LayerDetailHistoryByTableRow[]; error?: string }> {
  const tableName = params?.tableName?.trim();
  if (!tableName) return { success: false, data: [], error: 'tableName이 필요합니다.' };
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  try {
    const res = await db.execute(sql`
      SELECT
        dh.dh_key AS "dhKey",
        dh.dh_lh_key AS "dhLhKey",
        dh.dh_group AS "dhGroup",
        dh.dh_name AS "dhName",
        dh.dh_kor_name AS "dhKorName",
        dh.dh_type AS "dhType",
        dh.dh_old_data AS "dhOldData",
        dh.dh_new_data AS "dhNewData",
        dh.dh_append_count AS "dhAppendCount",
        dh.dh_conflict_count AS "dhConflictCount",
        dh.dh_remove_count AS "dhRemoveCount",
        dh.dh_contents AS "dhContents",
        dh.dh_result AS "dhResult",
        dh.dh_shp_path AS "dhShpPath",
        lh.lh_create_date AS "lhCreateDate",
        lh.lh_contents AS "lhContents"
      FROM layer_detail_history dh
      JOIN layer_history lh ON dh.dh_lh_key = lh.lh_key
      WHERE LOWER(dh.dh_name) = LOWER(${tableName})
      ORDER BY lh.lh_key DESC, dh.dh_key DESC
      LIMIT ${limit}
    `);
    return {
      success: true,
      data: (res.rows as LayerDetailHistoryByTableRow[]) ?? [],
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], error: msg };
  }
}

export type LayerDetailHistoryByTableRow = LayerDetailRow & {
  lhCreateDate: string | null;
  lhContents: string | null;
};

/** 이력 목록 조회 (페이징) */
export async function getLayerHistoryList(params?: {
  page?: number;
  limit?: number;
}): Promise<{ success: boolean; data: LayerHistoryRow[]; total: number; error?: string }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
  const offset = (page - 1) * limit;
  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(lh).orderBy(desc(lh.lhKey)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(lh),
    ]);
    const total = countRes[0]?.count ?? 0;
    return {
      success: true,
      data: rows.map((r) => ({
        lhKey: r.lhKey,
        lhContents: r.lhContents,
        lhSuccessCount: r.lhSuccessCount,
        lhFailCount: r.lhFailCount,
        lhCreateUser: r.lhCreateUser,
        lhCreateDate: r.lhCreateDate,
      })),
      total,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], total: 0, error: msg };
  }
}

/** 이력 상세 목록 조회 */
export async function getLayerDetailHistory(params: {
  lhKey: number;
}): Promise<{ success: boolean; data: LayerDetailRow[]; error?: string }> {
  const lhKey = params?.lhKey;
  if (!lhKey) return { success: false, data: [], error: 'lhKey가 필요합니다.' };
  try {
    const rows = await db.select().from(dh).where(eq(dh.dhLhKey, lhKey)).orderBy(dh.dhKey);
    return {
      success: true,
      data: rows.map((r) => ({
        dhKey: r.dhKey,
        dhLhKey: r.dhLhKey,
        dhGroup: r.dhGroup,
        dhName: r.dhName,
        dhKorName: r.dhKorName,
        dhType: r.dhType,
        dhOldData: r.dhOldData,
        dhNewData: r.dhNewData,
        dhAppendCount: r.dhAppendCount,
        dhConflictCount: r.dhConflictCount,
        dhRemoveCount: r.dhRemoveCount,
        dhContents: r.dhContents,
        dhResult: r.dhResult,
        dhShpPath: r.dhShpPath,
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, data: [], error: msg };
  }
}

/** 이력 1건 생성 → lhKey 반환 */
export async function createLayerHistory(params: {
  contents: string;
  successCount: number;
  failCount: number;
  createUser?: number;
}): Promise<{ success: boolean; lhKey?: number; error?: string }> {
  try {
    const rows = await db.insert(lh).values({
      lhContents: params.contents,
      lhSuccessCount: params.successCount,
      lhFailCount: params.failCount,
      lhCreateUser: params.createUser ?? null,
      lhCreateDate: todayWorkDateString(),
    }).returning({ lhKey: lh.lhKey });
    return { success: true, lhKey: rows[0]?.lhKey };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** 상세 이력 결과 업데이트 (대기→성공, 롤백 등) */
export async function updateDetailResult(params: {
  dhKey: number;
  result: string;
  contents?: string;
  newData?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!params?.dhKey) return { success: false, error: 'dhKey가 필요합니다.' };
  try {
    const updates: Record<string, unknown> = { dhResult: params.result };
    if (params.contents !== undefined) updates.dhContents = params.contents;
    if (params.newData !== undefined) updates.dhNewData = params.newData;
    await db.update(dh).set(updates).where(eq(dh.dhKey, params.dhKey));
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 상세 이력 여러 건 일괄 INSERT */
export async function createLayerDetailHistoryBatch(params: {
  lhKey: number;
  details: Array<{
    group?: string;
    name: string;
    korName?: string;
    type: string;
    oldData?: number;
    newData?: number;
    appendCount?: number;
    conflictCount?: number;
    removeCount?: number;
    contents?: string;
    result: string;
    shpPath?: string;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  if (!params.details?.length) return { success: true };
  try {
    const values = params.details.map((d) => ({
      dhLhKey: params.lhKey,
      dhGroup: d.group ?? null,
      dhName: d.name,
      dhKorName: d.korName ?? null,
      dhType: d.type,
      dhOldData: d.oldData ?? null,
      dhNewData: d.newData ?? null,
      dhAppendCount: d.appendCount ?? null,
      dhConflictCount: d.conflictCount ?? null,
      dhRemoveCount: d.removeCount ?? null,
      dhContents: d.contents ?? null,
      dhResult: d.result,
      dhShpPath: d.shpPath ?? null,
    }));
    await db.insert(dh).values(values);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
