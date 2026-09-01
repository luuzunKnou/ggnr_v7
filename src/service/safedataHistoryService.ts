/**
 * 재난대응시설 이력 (public.safedata_history)
 */
import { db } from '@/database/db';
import { safedataHistory } from '@/database/schema/safedata_history';
import { auth } from '@/auth';
import { getSessionUsrId } from '@/lib/auth/guard';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

export type SafedataHistoryItem = {
  id: number;
  author: string;
  createdAt: string;
  content: string;
};

function formatCreatedAt(raw: unknown): string {
  if (raw == null) return '';
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '';
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const day = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(raw).trim();
  // "2026-08-25 16:41:00" | "2026-08-25T16:41:00.000Z" | "2026-08-25"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? s;
}

function mapRow(r: typeof safedataHistory.$inferSelect): SafedataHistoryItem {
  return {
    id: r.historyKey,
    author: String(r.createdBy ?? '').trim() || '—',
    createdAt: formatCreatedAt(r.createdAt),
    content: String(r.hisContents ?? '').trim(),
  };
}

async function resolveCreatedBy(clientHint?: string): Promise<string> {
  const hint = String(clientHint ?? '').trim();
  if (hint) return hint;
  try {
    const session = await auth();
    const name = String(session?.user?.name ?? '').trim();
    if (name) return name;
  } catch {
    /* ignore */
  }
  const usrId = (await getSessionUsrId())?.trim();
  return usrId || '미로그인';
}

/** 시설별 이력 목록 (최신순). search는 작성자·내용 부분일치 */
export async function listByFacility(params: {
  hisGubun?: string;
  ftrIdn?: string | number;
  search?: string;
  limit?: number;
}): Promise<{ success: boolean; data: SafedataHistoryItem[]; error?: string }> {
  const hisGubun = String(params?.hisGubun ?? '').trim();
  const ftrIdn = String(params?.ftrIdn ?? '').trim();
  if (!hisGubun || !ftrIdn) {
    return { success: false, data: [], error: 'hisGubun과 ftrIdn이 필요합니다.' };
  }
  const limit = Math.min(500, Math.max(1, params?.limit ?? 200));
  const searchRaw = String(params?.search ?? '').trim();
  const search = searchRaw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

  try {
    const where = and(
      eq(safedataHistory.hisGubun, hisGubun),
      eq(safedataHistory.ftrIdn, ftrIdn),
      search
        ? or(
            ilike(safedataHistory.createdBy, `%${search}%`),
            ilike(safedataHistory.hisContents, `%${search}%`)
          )
        : undefined
    );

    const rows = await db
      .select()
      .from(safedataHistory)
      .where(where)
      .orderBy(desc(safedataHistory.createdAt), desc(safedataHistory.historyKey))
      .limit(limit);

    return { success: true, data: rows.map(mapRow) };
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
  hisGubun?: string;
  ftrIdn?: string | number;
  contents?: string;
  createdBy?: string;
}): Promise<{ success: boolean; data?: SafedataHistoryItem; error?: string }> {
  const hisGubun = String(params?.hisGubun ?? '').trim();
  const ftrIdn = String(params?.ftrIdn ?? '').trim();
  const contents = String(params?.contents ?? '').trim();
  if (!hisGubun || !ftrIdn) {
    return { success: false, error: 'hisGubun과 ftrIdn이 필요합니다.' };
  }
  if (!contents) return { success: false, error: '내용을 입력해 주세요.' };

  try {
    const createdBy = await resolveCreatedBy(params?.createdBy);
    const rows = await db
      .insert(safedataHistory)
      .values({
        hisGubun,
        ftrIdn,
        hisContents: contents,
        createdBy,
      })
      .returning();
    const row = rows[0];
    if (!row) return { success: false, error: '저장에 실패했습니다.' };
    return { success: true, data: mapRow(row) };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 이력 내용 수정 (작성자·일시는 유지) */
export async function update(params: {
  id?: number;
  contents?: string;
}): Promise<{ success: boolean; data?: SafedataHistoryItem; error?: string }> {
  const id = Number(params?.id);
  const contents = String(params?.contents ?? '').trim();
  if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id가 필요합니다.' };
  if (!contents) return { success: false, error: '내용을 입력해 주세요.' };

  try {
    const rows = await db
      .update(safedataHistory)
      .set({ hisContents: contents })
      .where(eq(safedataHistory.historyKey, id))
      .returning();
    const row = rows[0];
    if (!row) return { success: false, error: '이력을 찾을 수 없습니다.' };
    return { success: true, data: mapRow(row) };
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
      .delete(safedataHistory)
      .where(eq(safedataHistory.historyKey, id))
      .returning({ historyKey: safedataHistory.historyKey });
    if (!deleted[0]) return { success: false, error: '이력을 찾을 수 없습니다.' };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 스키마 존재 확인용(선택) — 테이블 미생성 시 안내 */
export async function ping(): Promise<{ success: boolean; error?: string }> {
  try {
    await db.execute(sql`SELECT 1 FROM public.safedata_history LIMIT 1`);
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
