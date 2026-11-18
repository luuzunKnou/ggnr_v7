/**
 * 시설 이력 (public.data_history)
 * 서비스 키는 기존 UI 호환을 위해 safedataHistoryService 유지
 */
import { db } from '@/database/db';
import { dataHistory } from '@/database/schema/data_history';
import { auth } from '@/auth';
import { getSessionUsrId } from '@/lib/auth/guard';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

export type SafedataHistoryItem = {
  id: number;
  author: string;
  createdAt: string;
  content: string;
  /** 업체 */
  agency: string;
  /** 확장 속성 (JSONB) */
  extra: Record<string, unknown> | null;
};

function normalizeHisExtra(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeHisExtra(parsed);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    if (v == null) continue;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) continue;
      out[key] = s;
      continue;
    }
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

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

function mapRow(r: typeof dataHistory.$inferSelect): SafedataHistoryItem {
  return {
    id: r.historyKey,
    author: String(r.createdBy ?? '').trim() || '—',
    createdAt: formatCreatedAt(r.createdAt),
    content: String(r.hisContents ?? '').trim(),
    agency: String(r.agency ?? '').trim(),
    extra: normalizeHisExtra(r.hisExtra),
  };
}

function parseCreatedAtInput(raw?: string): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
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

/** 시설별 이력 목록 (최신순). search는 작성자·내용·업체 부분일치 */
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
      eq(dataHistory.hisGubun, hisGubun),
      eq(dataHistory.ftrIdn, ftrIdn),
      search
        ? or(
            ilike(dataHistory.createdBy, `%${search}%`),
            ilike(dataHistory.hisContents, `%${search}%`),
            ilike(dataHistory.agency, `%${search}%`)
          )
        : undefined
    );

    const rows = await db
      .select()
      .from(dataHistory)
      .where(where)
      .orderBy(desc(dataHistory.createdAt), desc(dataHistory.historyKey))
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
  agency?: string;
  extra?: Record<string, unknown> | null;
  createdBy?: string;
  createdAt?: string;
}): Promise<{ success: boolean; data?: SafedataHistoryItem; error?: string }> {
  const hisGubun = String(params?.hisGubun ?? '').trim();
  const ftrIdn = String(params?.ftrIdn ?? '').trim();
  const contents = String(params?.contents ?? '').trim();
  const agency = String(params?.agency ?? '').trim();
  const hasExtra = params != null && Object.prototype.hasOwnProperty.call(params, 'extra');
  const hisExtra = hasExtra ? normalizeHisExtra(params.extra) : null;
  if (!hisGubun || !ftrIdn) {
    return { success: false, error: 'hisGubun과 ftrIdn이 필요합니다.' };
  }
  if (!contents) return { success: false, error: '내용을 입력해 주세요.' };

  const createdAt = parseCreatedAtInput(params?.createdAt);
  if (params?.createdAt != null && String(params.createdAt).trim() && !createdAt) {
    return { success: false, error: '작성일시 형식이 올바르지 않습니다.' };
  }

  try {
    const createdBy = await resolveCreatedBy(params?.createdBy);
    const rows = await db
      .insert(dataHistory)
      .values({
        hisGubun,
        ftrIdn,
        hisContents: contents,
        agency: agency || null,
        hisExtra: hasExtra ? hisExtra : null,
        createdBy,
        ...(createdAt ? { createdAt } : {}),
      })
      .returning();
    const row = rows[0];
    if (!row) return { success: false, error: '저장에 실패했습니다.' };
    return { success: true, data: mapRow(row) };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 이력 수정 (내용·작성자·작성일시·확장속성) */
export async function update(params: {
  id?: number;
  contents?: string;
  agency?: string;
  extra?: Record<string, unknown> | null;
  createdBy?: string;
  createdAt?: string;
}): Promise<{ success: boolean; data?: SafedataHistoryItem; error?: string }> {
  const id = Number(params?.id);
  const contents = String(params?.contents ?? '').trim();
  const createdBy = String(params?.createdBy ?? '').trim();
  const agency = String(params?.agency ?? '').trim();
  const hasExtra = params != null && Object.prototype.hasOwnProperty.call(params, 'extra');
  if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id가 필요합니다.' };
  if (!contents) return { success: false, error: '내용을 입력해 주세요.' };
  if (!createdBy) return { success: false, error: '작성자를 입력해 주세요.' };

  const createdAt = parseCreatedAtInput(params?.createdAt);
  if (!createdAt) return { success: false, error: '작성일시를 입력해 주세요.' };

  try {
    const rows = await db
      .update(dataHistory)
      .set({
        hisContents: contents,
        agency: agency || null,
        createdBy,
        createdAt,
        ...(hasExtra ? { hisExtra: normalizeHisExtra(params.extra) } : {}),
      })
      .where(eq(dataHistory.historyKey, id))
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
      .delete(dataHistory)
      .where(eq(dataHistory.historyKey, id))
      .returning({ historyKey: dataHistory.historyKey });
    if (!deleted[0]) return { success: false, error: '이력을 찾을 수 없습니다.' };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 스키마 존재 확인용(선택) — 테이블 미생성 시 안내 */
export async function ping(): Promise<{ success: boolean; error?: string }> {
  try {
    await db.execute(sql`SELECT 1 FROM public.data_history LIMIT 1`);
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
