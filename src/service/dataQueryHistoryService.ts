/**
 * 데이터 조회 상세 — 피처(행)별 점검·보수·이상발생·준공 이력
 */
import { db } from '@/database/db';
import { dqh } from '@/database/schema/data_query_history';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  isDataQueryHistoryType,
  type DataQueryHistoryType,
} from '@/lib/dataQueryHistoryTypes';
import { and, desc, eq } from 'drizzle-orm';

export type { DataQueryHistoryType };
export { DATA_QUERY_HISTORY_TYPES } from '@/lib/dataQueryHistoryTypes';

export type DataQueryHistoryRow = {
  id: number;
  date: string;
  type: DataQueryHistoryType;
  title: string;
  description: string;
  author: string;
};

function todayKstYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function toYmd(raw: unknown): string {
  if (raw == null) return '';
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(raw);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? s;
}

function mapRow(r: typeof dqh.$inferSelect): DataQueryHistoryRow | null {
  const typeRaw = String(r.dqhType ?? '').trim();
  if (!isDataQueryHistoryType(typeRaw)) return null;
  return {
    id: r.dqhKey,
    date: toYmd(r.dqhDate) || toYmd(r.dqhCreateDate),
    type: typeRaw,
    title: String(r.dqhTitle ?? '').trim(),
    description: String(r.dqhContents ?? '').trim(),
    author: String(r.dqhAuthor ?? '').trim(),
  };
}

/** 행별 이력 목록 (최신 일자·키 순) */
export async function listByRow(params: {
  table?: string;
  rowKey?: string | number;
  limit?: number;
}): Promise<{ success: boolean; data: DataQueryHistoryRow[]; error?: string }> {
  const table = String(params?.table ?? '').trim().toLowerCase();
  const rowKey = String(params?.rowKey ?? '').trim();
  if (!table || !rowKey) {
    return { success: false, data: [], error: 'table과 rowKey가 필요합니다.' };
  }
  const limit = Math.min(200, Math.max(1, params?.limit ?? 100));
  try {
    const rows = await db
      .select()
      .from(dqh)
      .where(and(eq(dqh.dqhTable, table), eq(dqh.dqhRowKey, rowKey)))
      .orderBy(desc(dqh.dqhDate), desc(dqh.dqhKey))
      .limit(limit);
    const data = rows.map(mapRow).filter((x): x is DataQueryHistoryRow => x != null);
    return { success: true, data };
  } catch (e: unknown) {
    return {
      success: false,
      data: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 이력 1건 추가 */
export async function create(params: {
  table?: string;
  rowKey?: string | number;
  date?: string;
  type?: string;
  title?: string;
  contents?: string;
  author?: string;
}): Promise<{ success: boolean; id?: number; error?: string }> {
  const table = String(params?.table ?? '').trim().toLowerCase();
  const rowKey = String(params?.rowKey ?? '').trim();
  const typeRaw = String(params?.type ?? '').trim();
  const title = String(params?.title ?? '').trim();
  const contents = String(params?.contents ?? '').trim();
  const author = String(params?.author ?? '').trim();
  const date = toYmd(params?.date) || todayKstYmd();

  if (!table || !rowKey) return { success: false, error: 'table과 rowKey가 필요합니다.' };
  if (!isDataQueryHistoryType(typeRaw)) {
    return { success: false, error: '유형은 점검·보수·이상발생·준공 중 하나여야 합니다.' };
  }
  if (!title) return { success: false, error: '제목이 필요합니다.' };

  try {
    const usrId = await getSessionUsrId();
    const rows = await db
      .insert(dqh)
      .values({
        dqhTable: table,
        dqhRowKey: rowKey,
        dqhDate: date,
        dqhType: typeRaw,
        dqhTitle: title,
        dqhContents: contents || null,
        dqhAuthor: author || null,
        dqhCreateUser: usrId?.trim() || null,
        dqhCreateDate: todayKstYmd(),
      })
      .returning({ dqhKey: dqh.dqhKey });
    return { success: true, id: rows[0]?.dqhKey };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 이력 수정 */
export async function update(params: {
  id?: number;
  date?: string;
  type?: string;
  title?: string;
  contents?: string;
  author?: string;
}): Promise<{ success: boolean; error?: string }> {
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id가 필요합니다.' };

  const typeRaw = String(params?.type ?? '').trim();
  const title = String(params?.title ?? '').trim();
  const contents = String(params?.contents ?? '').trim();
  const author = String(params?.author ?? '').trim();
  const date = toYmd(params?.date) || todayKstYmd();

  if (!isDataQueryHistoryType(typeRaw)) {
    return { success: false, error: '유형은 점검·보수·이상발생·준공 중 하나여야 합니다.' };
  }
  if (!title) return { success: false, error: '제목이 필요합니다.' };

  try {
    const updated = await db
      .update(dqh)
      .set({
        dqhDate: date,
        dqhType: typeRaw,
        dqhTitle: title,
        dqhContents: contents || null,
        dqhAuthor: author || null,
      })
      .where(eq(dqh.dqhKey, id))
      .returning({ dqhKey: dqh.dqhKey });
    if (!updated[0]) return { success: false, error: '이력을 찾을 수 없습니다.' };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 이력 삭제 */
export async function remove(params: {
  id?: number;
}): Promise<{ success: boolean; error?: string }> {
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id가 필요합니다.' };
  try {
    const deleted = await db
      .delete(dqh)
      .where(eq(dqh.dqhKey, id))
      .returning({ dqhKey: dqh.dqhKey });
    if (!deleted[0]) return { success: false, error: '이력을 찾을 수 없습니다.' };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
