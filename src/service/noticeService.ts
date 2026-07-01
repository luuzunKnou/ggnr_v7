/**
 * 공지사항(notice) API
 */
import { db } from '@/database/db';
import { notice } from '@/database/schema';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { fileDataRelativeDir } from '@/lib/serviceFileData';
import {
  deleteFileDataPath,
  relocateServiceFileDataKey,
} from '@/service/fileManagerService';

const NOTICE_FILE_LAYER = 'notice';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDateLabel(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = iso.slice(0, 10);
  return d.replace(/-/g, '.');
}

/** YYYY-MM-DD → timestamp (시작 00:00 / 종료 23:59:59.999) */
function parseDateInput(s: string | null | undefined, endOfDay: boolean): string | null {
  const t = emptyToNull(s);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return endOfDay ? `${t}T23:59:59.999` : `${t}T00:00:00.000`;
  }
  return t;
}

export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export type NoticeRow = typeof notice.$inferSelect;

export type NoticeListItem = {
  noticeKey: number;
  noticeTitle: string;
  noticeIsActive: boolean;
  noticeStartDate: string | null;
  noticeEndDate: string | null;
  noticeViewCnt: number;
  noticeCreateDate: string | null;
  noticeCreateUser: string | null;
  dateLabel: string;
  periodLabel: string;
};

function periodLabel(start: string | null, end: string | null): string {
  const s = formatDateLabel(start);
  const e = formatDateLabel(end);
  if (s === '-' && e === '-') return '-';
  if (s === '-') return `~ ${e}`;
  if (e === '-') return `${s} ~`;
  return `${s} ~ ${e}`;
}

function toListItem(row: NoticeRow): NoticeListItem {
  return {
    noticeKey: row.noticeKey,
    noticeTitle: row.noticeTitle,
    noticeIsActive: row.noticeIsActive,
    noticeStartDate: row.noticeStartDate,
    noticeEndDate: row.noticeEndDate,
    noticeViewCnt: row.noticeViewCnt,
    noticeCreateDate: row.noticeCreateDate,
    noticeCreateUser: row.noticeCreateUser,
    dateLabel: formatDateLabel(row.noticeCreateDate),
    periodLabel: periodLabel(row.noticeStartDate, row.noticeEndDate),
  };
}

/** 목록 조회 */
export async function list(
  params: { limit?: number; offset?: number; keyword?: string } = {}
) {
  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const keyword = emptyToNull(params?.keyword);

  const conditions = [eq(notice.noticeIsDel, false)];
  if (keyword) {
    conditions.push(
      or(
        ilike(notice.noticeTitle, `%${keyword}%`),
        ilike(notice.noticeContents, `%${keyword}%`)
      )!
    );
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(notice)
    .where(where)
    .orderBy(desc(notice.noticeCreateDate), desc(notice.noticeKey))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notice)
    .where(where);
  const total = countResult[0]?.count ?? 0;

  return { rows: rows.map(toListItem), total };
}

/** 접속 시 팝업용 — 현재 시각이 공지기간 내이고 공지여부 true */
export async function listActivePopups() {
  const rows = await db
    .select()
    .from(notice)
    .where(
      and(
        eq(notice.noticeIsDel, false),
        eq(notice.noticeIsActive, true),
        sql`${notice.noticeStartDate} <= now()`,
        sql`${notice.noticeEndDate} >= now()`
      )
    )
    .orderBy(desc(notice.noticeCreateDate), desc(notice.noticeKey));

  return rows.map((row) => ({
    noticeKey: row.noticeKey,
    noticeTitle: row.noticeTitle,
    noticeContents: row.noticeContents,
    noticeStartDate: row.noticeStartDate,
    noticeEndDate: row.noticeEndDate,
    periodLabel: periodLabel(row.noticeStartDate, row.noticeEndDate),
  }));
}

/** 단건 조회 (조회수 +1) */
export async function get(params: { noticeKey: number; skipViewInc?: boolean }) {
  const key = Number(params?.noticeKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [row] = await db
    .select()
    .from(notice)
    .where(and(eq(notice.noticeKey, key), eq(notice.noticeIsDel, false)))
    .limit(1);
  if (!row) return null;

  if (!params?.skipViewInc) {
    await db
      .update(notice)
      .set({ noticeViewCnt: sql`${notice.noticeViewCnt} + 1` })
      .where(eq(notice.noticeKey, key));
  }

  return {
    ...row,
    dateLabel: formatDateLabel(row.noticeCreateDate),
    updateDateLabel: formatDateLabel(row.noticeUpdateDate),
    periodLabel: periodLabel(row.noticeStartDate, row.noticeEndDate),
    noticeViewCnt: params?.skipViewInc ? row.noticeViewCnt : row.noticeViewCnt + 1,
  };
}

async function requireWriter(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    const err = new Error('로그인이 필요합니다.') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return usrId;
}

function validateNoticePeriod(
  isActive: boolean,
  start: string | null,
  end: string | null
): void {
  if (!isActive) return;
  if (!start || !end) throw new Error('공지여부가 켜져 있으면 공지기간(시작·종료)을 입력하세요.');
  if (start > end) throw new Error('공지 종료일은 시작일 이후여야 합니다.');
}

/** 등록 */
export async function create(params: {
  noticeTitle: string;
  noticeContents?: string | null;
  noticeIsActive?: boolean;
  noticeStartDate?: string | null;
  noticeEndDate?: string | null;
  attachmentDraftKey?: string | null;
}) {
  const usrId = await requireWriter();
  const title = emptyToNull(params.noticeTitle);
  if (!title) throw new Error('제목을 입력하세요.');

  const isActive = !!params.noticeIsActive;
  const start = parseDateInput(params.noticeStartDate, false);
  const end = parseDateInput(params.noticeEndDate, true);
  validateNoticePeriod(isActive, start, end);

  const [inserted] = await db
    .insert(notice)
    .values({
      noticeTitle: title,
      noticeContents: emptyToNull(params.noticeContents),
      noticeIsActive: isActive,
      noticeStartDate: start,
      noticeEndDate: end,
      noticeCreateDate: nowIso(),
      noticeCreateUser: usrId,
      noticeUpdateDate: nowIso(),
      noticeUpdateUser: usrId,
    })
    .returning();

  if (!inserted) throw new Error('등록 실패');

  const draftKey = emptyToNull(params.attachmentDraftKey);
  if (draftKey) {
    try {
      await relocateServiceFileDataKey({
        layerName: NOTICE_FILE_LAYER,
        fromKey: draftKey,
        toKey: String(inserted.noticeKey),
      });
    } catch (e: unknown) {
      await db
        .update(notice)
        .set({
          noticeIsDel: true,
          noticeUpdateDate: nowIso(),
          noticeUpdateUser: usrId,
        })
        .where(eq(notice.noticeKey, inserted.noticeKey));
      throw e instanceof Error ? e : new Error('첨부파일 연결에 실패했습니다.');
    }
  }

  return inserted;
}

/** 수정 */
export async function update(params: {
  noticeKey: number;
  noticeTitle?: string;
  noticeContents?: string | null;
  noticeIsActive?: boolean;
  noticeStartDate?: string | null;
  noticeEndDate?: string | null;
}) {
  const usrId = await requireWriter();
  const key = Number(params.noticeKey);
  if (!Number.isInteger(key) || key < 1) throw new Error('잘못된 공지 키입니다.');

  const title = params.noticeTitle != null ? emptyToNull(params.noticeTitle) : undefined;
  if (title === null) throw new Error('제목을 입력하세요.');

  const [existing] = await db
    .select()
    .from(notice)
    .where(and(eq(notice.noticeKey, key), eq(notice.noticeIsDel, false)))
    .limit(1);
  if (!existing) throw new Error('게시글을 찾을 수 없습니다.');

  const isActive = params.noticeIsActive !== undefined ? !!params.noticeIsActive : existing.noticeIsActive;
  const start =
    params.noticeStartDate !== undefined
      ? parseDateInput(params.noticeStartDate, false)
      : existing.noticeStartDate;
  const end =
    params.noticeEndDate !== undefined
      ? parseDateInput(params.noticeEndDate, true)
      : existing.noticeEndDate;
  validateNoticePeriod(isActive, start, end);

  const [updated] = await db
    .update(notice)
    .set({
      ...(title != null ? { noticeTitle: title } : {}),
      ...(params.noticeContents !== undefined
        ? { noticeContents: emptyToNull(params.noticeContents) }
        : {}),
      ...(params.noticeIsActive !== undefined ? { noticeIsActive: isActive } : {}),
      ...(params.noticeStartDate !== undefined ? { noticeStartDate: start } : {}),
      ...(params.noticeEndDate !== undefined ? { noticeEndDate: end } : {}),
      noticeUpdateDate: nowIso(),
      noticeUpdateUser: usrId,
    })
    .where(and(eq(notice.noticeKey, key), eq(notice.noticeIsDel, false)))
    .returning();

  return updated ?? null;
}

/** 글쓰기 임시 첨부 → 저장된 공지 키로 이전 */
export async function adoptAttachmentDraft(params: { draftKey: string; noticeKey: number }) {
  await requireWriter();
  const draftKey = emptyToNull(params.draftKey);
  const noticeKey = Number(params.noticeKey);
  if (!draftKey || !Number.isInteger(noticeKey) || noticeKey < 1) {
    throw new Error('잘못된 첨부 이전 요청입니다.');
  }
  await relocateServiceFileDataKey({
    layerName: NOTICE_FILE_LAYER,
    fromKey: draftKey,
    toKey: String(noticeKey),
  });
  return { ok: true };
}

/** 글쓰기 취소 시 임시 첨부 폴더 삭제 */
export async function discardAttachmentDraft(params: { draftKey: string }) {
  await requireWriter();
  const draftKey = emptyToNull(params.draftKey);
  if (!draftKey) return { ok: true };
  const rel = fileDataRelativeDir(NOTICE_FILE_LAYER, draftKey);
  if (!rel) return { ok: true };
  await deleteFileDataPath({ relativePath: rel });
  return { ok: true };
}

/** 삭제 (soft) */
export async function remove(params: { noticeKey: number }) {
  const usrId = await requireWriter();
  const key = Number(params.noticeKey);
  if (!Number.isInteger(key) || key < 1) throw new Error('잘못된 공지 키입니다.');

  const [updated] = await db
    .update(notice)
    .set({
      noticeIsDel: true,
      noticeUpdateDate: nowIso(),
      noticeUpdateUser: usrId,
    })
    .where(eq(notice.noticeKey, key))
    .returning();

  return updated ?? null;
}
