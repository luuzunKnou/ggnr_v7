/**
 * 시스템 불편신고 (로컬 이력)
 */
import { db } from '@/database/db';
import {
  SF_STATUS_DRAFT,
  SF_STATUS_SUBMITTED,
  systemFeedback,
} from '@/database/schema/system_feedback';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isSuperUser } from '@/lib/auth/superUser';
import { rethrowWithPgCause } from '@/lib/rethrowWithPgCause';

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function nowIso(): string {
  return new Date().toISOString();
}

export type SystemFeedbackListItem = {
  sfKey: number;
  usrId: string;
  usrName: string;
  systemKey: string | null;
  serviceEng: string | null;
  serviceKor: string | null;
  status: string;
  gnmsSent: boolean;
  gnmsSentAt: string | null;
  gnmsError: string | null;
  sfCreateDate: string | null;
  dateLabel: string;
  preview: string;
};

export type SystemFeedbackDetail = SystemFeedbackListItem & {
  contentHtml: string | null;
};

function stripHtmlPreview(html: string | null | undefined, max = 80): string {
  const plain = String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '(내용 없음)';
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

function formatDateLabel(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = iso.slice(0, 16).replace('T', ' ');
  return d;
}

function toListItem(row: typeof systemFeedback.$inferSelect): SystemFeedbackListItem {
  return {
    sfKey: row.sfKey,
    usrId: row.usrId,
    usrName: row.usrName,
    systemKey: row.systemKey,
    serviceEng: row.serviceEng,
    serviceKor: row.serviceKor,
    status: row.status,
    gnmsSent: row.gnmsSent,
    gnmsSentAt: row.gnmsSentAt,
    gnmsError: row.gnmsError,
    sfCreateDate: row.sfCreateDate,
    dateLabel: formatDateLabel(row.sfCreateDate),
    preview: stripHtmlPreview(row.contentHtml),
  };
}

function toDetail(row: typeof systemFeedback.$inferSelect): SystemFeedbackDetail {
  return {
    ...toListItem(row),
    contentHtml: row.contentHtml,
  };
}

async function requireUsrId(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throw new Error('로그인이 필요합니다.');
  return usrId;
}

/** 작성용 초안 생성 (첨부·에디터 이미지 키) */
export async function createDraft(params: {
  usrName?: string;
  systemKey?: string | null;
  serviceEng?: string | null;
  serviceKor?: string | null;
} = {}) {
  const usrId = await requireUsrId();
  const usrName = emptyToNull(params.usrName) || usrId;
  const now = nowIso();
  try {
    const [row] = await db
      .insert(systemFeedback)
      .values({
        usrId,
        usrName,
        systemKey: emptyToNull(params.systemKey),
        serviceEng: emptyToNull(params.serviceEng),
        serviceKor: emptyToNull(params.serviceKor),
        contentHtml: '',
        status: SF_STATUS_DRAFT,
        gnmsSent: false,
        sfIsDel: false,
        sfCreateDate: now,
        sfCreateUser: usrId,
        sfUpdateDate: now,
        sfUpdateUser: usrId,
      })
      .returning();
    if (!row) throw new Error('초안 생성 실패');
    return { ok: true as const, data: toDetail(row) };
  } catch (e) {
    rethrowWithPgCause(e, '불편신고 초안 생성 실패');
  }
}

/** 제출 (내용 확정) */
export async function submit(params: {
  sfKey: number;
  usrName?: string;
  systemKey?: string | null;
  serviceEng?: string | null;
  serviceKor?: string | null;
  contentHtml?: string | null;
}) {
  const usrId = await requireUsrId();
  const sfKey = Number(params.sfKey);
  if (!Number.isFinite(sfKey) || sfKey <= 0) throw new Error('유효하지 않은 신고 키입니다.');

  const [existing] = await db
    .select()
    .from(systemFeedback)
    .where(and(eq(systemFeedback.sfKey, sfKey), eq(systemFeedback.sfIsDel, false)))
    .limit(1);
  if (!existing) throw new Error('신고를 찾을 수 없습니다.');
  if (existing.usrId !== usrId && !isSuperUser(usrId)) {
    throw new Error('권한이 없습니다.');
  }
  if (existing.status === SF_STATUS_SUBMITTED) {
    throw new Error('이미 제출된 신고입니다.');
  }

  const contentHtml = String(params.contentHtml ?? '').trim();
  if (!contentHtml || contentHtml === '<p></p>') {
    throw new Error('내용을 입력하세요.');
  }

  const now = nowIso();
  try {
    const [row] = await db
      .update(systemFeedback)
      .set({
        usrName: emptyToNull(params.usrName) || existing.usrName,
        systemKey: emptyToNull(params.systemKey) ?? existing.systemKey,
        serviceEng: emptyToNull(params.serviceEng),
        serviceKor: emptyToNull(params.serviceKor),
        contentHtml,
        status: SF_STATUS_SUBMITTED,
        sfUpdateDate: now,
        sfUpdateUser: usrId,
      })
      .where(eq(systemFeedback.sfKey, sfKey))
      .returning();
    if (!row) throw new Error('제출 실패');
    return { ok: true as const, data: toDetail(row) };
  } catch (e) {
    rethrowWithPgCause(e, '불편신고 제출 실패');
  }
}

/** GNMS 전송 결과 반영 */
export async function markGnmsResult(params: {
  sfKey: number;
  sent: boolean;
  error?: string | null;
}) {
  const usrId = await requireUsrId();
  const sfKey = Number(params.sfKey);
  if (!Number.isFinite(sfKey) || sfKey <= 0) throw new Error('유효하지 않은 신고 키입니다.');

  const [existing] = await db
    .select()
    .from(systemFeedback)
    .where(and(eq(systemFeedback.sfKey, sfKey), eq(systemFeedback.sfIsDel, false)))
    .limit(1);
  if (!existing) throw new Error('신고를 찾을 수 없습니다.');
  if (existing.usrId !== usrId && !isSuperUser(usrId)) {
    throw new Error('권한이 없습니다.');
  }

  const now = nowIso();
  const sent = Boolean(params.sent);
  try {
    const [row] = await db
      .update(systemFeedback)
      .set({
        gnmsSent: sent,
        gnmsSentAt: sent ? now : existing.gnmsSentAt,
        gnmsError: sent ? null : emptyToNull(params.error) || 'GNMS 전송 실패',
        sfUpdateDate: now,
        sfUpdateUser: usrId,
      })
      .where(eq(systemFeedback.sfKey, sfKey))
      .returning();
    if (!row) throw new Error('GNMS 결과 반영 실패');
    return { ok: true as const, data: toDetail(row) };
  } catch (e) {
    rethrowWithPgCause(e, 'GNMS 결과 반영 실패');
  }
}

/** 미제출 초안 삭제 */
export async function discardDraft(params: { sfKey: number }) {
  const usrId = await requireUsrId();
  const sfKey = Number(params.sfKey);
  if (!Number.isFinite(sfKey) || sfKey <= 0) throw new Error('유효하지 않은 신고 키입니다.');

  const [existing] = await db
    .select()
    .from(systemFeedback)
    .where(and(eq(systemFeedback.sfKey, sfKey), eq(systemFeedback.sfIsDel, false)))
    .limit(1);
  if (!existing) return { ok: true as const };
  if (existing.usrId !== usrId && !isSuperUser(usrId)) {
    throw new Error('권한이 없습니다.');
  }
  if (existing.status === SF_STATUS_SUBMITTED) {
    throw new Error('제출된 신고는 초안 삭제할 수 없습니다.');
  }

  const now = nowIso();
  try {
    await db
      .update(systemFeedback)
      .set({
        sfIsDel: true,
        sfUpdateDate: now,
        sfUpdateUser: usrId,
      })
      .where(eq(systemFeedback.sfKey, sfKey));
    return { ok: true as const };
  } catch (e) {
    rethrowWithPgCause(e, '불편신고 초안 삭제 실패');
  }
}

/** 목록 — 본인 / 슈퍼는 전체 (제출분만). 날짜·통합검색·페이징 */
export async function list(
  params: {
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
  } = {}
) {
  const usrId = await requireUsrId();
  let limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 50;
  if (limit > 200) limit = 200;
  const offset = typeof params.offset === 'number' && params.offset >= 0 ? params.offset : 0;

  const conditions = [
    eq(systemFeedback.sfIsDel, false),
    eq(systemFeedback.status, SF_STATUS_SUBMITTED),
  ];
  if (!isSuperUser(usrId)) {
    conditions.push(eq(systemFeedback.usrId, usrId));
  }

  const dateFrom = String(params.dateFrom ?? '').trim();
  const dateTo = String(params.dateTo ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    conditions.push(sql`(${systemFeedback.sfCreateDate})::date >= ${dateFrom}::date`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    conditions.push(sql`(${systemFeedback.sfCreateDate})::date <= ${dateTo}::date`);
  }

  const q = String(params.q ?? '').trim();
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(systemFeedback.serviceKor, like),
        ilike(systemFeedback.serviceEng, like),
        ilike(systemFeedback.contentHtml, like),
        ilike(systemFeedback.usrName, like),
        ilike(systemFeedback.usrId, like),
        ilike(systemFeedback.gnmsError, like)
      )!
    );
  }

  const where = and(...conditions);

  try {
    const [totalRow] = await db
      .select({ total: count() })
      .from(systemFeedback)
      .where(where);
    const total = Number(totalRow?.total ?? 0);

    const rows = await db
      .select()
      .from(systemFeedback)
      .where(where)
      .orderBy(desc(systemFeedback.sfCreateDate))
      .limit(limit)
      .offset(offset);
    return {
      ok: true as const,
      data: {
        items: rows.map(toListItem),
        total,
        limit,
        offset,
        isSuper: isSuperUser(usrId),
      },
    };
  } catch (e) {
    rethrowWithPgCause(e, '불편신고 목록 조회 실패');
  }
}

/** 단건 조회 */
export async function get(params: { sfKey: number }) {
  const usrId = await requireUsrId();
  const sfKey = Number(params.sfKey);
  if (!Number.isFinite(sfKey) || sfKey <= 0) throw new Error('유효하지 않은 신고 키입니다.');

  const [row] = await db
    .select()
    .from(systemFeedback)
    .where(and(eq(systemFeedback.sfKey, sfKey), eq(systemFeedback.sfIsDel, false)))
    .limit(1);
  if (!row) throw new Error('신고를 찾을 수 없습니다.');
  if (row.usrId !== usrId && !isSuperUser(usrId)) {
    throw new Error('권한이 없습니다.');
  }
  return { ok: true as const, data: toDetail(row) };
}
