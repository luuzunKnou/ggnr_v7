/**
 * Layer History Service
 * - layer_history / layer_detail_history CRUD
 */
import { db } from '@/database/db';
import { lh } from '@/database/schema/layer_history';
import { dh } from '@/database/schema/layer_detail_history';
import { sql } from 'drizzle-orm';
import { desc, eq } from 'drizzle-orm';

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
      lhCreateDate: new Date().toISOString().slice(0, 10),
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
