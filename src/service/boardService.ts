/**
 * 자료실(board) API
 */
import { db } from '@/database/db';
import { board } from '@/database/schema';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { fileDataRelativeDir } from '@/lib/serviceFileData';
import {
  deleteFileDataPath,
  relocateServiceFileDataKey,
} from '@/service/fileManagerService';
import { rethrowWithPgCause } from '@/lib/rethrowWithPgCause';

const BOARD_FILE_LAYER = 'board';

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

export type BoardRow = typeof board.$inferSelect;

export type BoardListItem = {
  boardKey: number;
  boardTitle: string;
  boardViewCnt: number;
  boardCreateDate: string | null;
  boardCreateUser: string | null;
  dateLabel: string;
};

function toListItem(row: BoardRow): BoardListItem {
  return {
    boardKey: row.boardKey,
    boardTitle: row.boardTitle,
    boardViewCnt: row.boardViewCnt,
    boardCreateDate: row.boardCreateDate,
    boardCreateUser: row.boardCreateUser,
    dateLabel: formatDateLabel(row.boardCreateDate),
  };
}

/** 목록 조회 */
export async function list(params: { limit?: number; offset?: number; keyword?: string } = {}) {
  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;
  const keyword = emptyToNull(params?.keyword);

  const conditions = [eq(board.boardIsDel, false)];
  if (keyword) {
    conditions.push(
      or(ilike(board.boardTitle, `%${keyword}%`), ilike(board.boardContents, `%${keyword}%`))!
    );
  }
  const where = and(...conditions);

  try {
    const rows = await db
      .select()
      .from(board)
      .where(where)
      .orderBy(desc(board.boardCreateDate), desc(board.boardKey))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(board)
      .where(where);
    const total = countResult[0]?.count ?? 0;

    return { rows: rows.map(toListItem), total };
  } catch (e: unknown) {
    rethrowWithPgCause(e, '자료실 조회 실패');
  }
}

/** 단건 조회 (조회수 +1) */
export async function get(params: { boardKey: number; skipViewInc?: boolean }) {
  const key = Number(params?.boardKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [row] = await db
    .select()
    .from(board)
    .where(and(eq(board.boardKey, key), eq(board.boardIsDel, false)))
    .limit(1);
  if (!row) return null;

  if (!params?.skipViewInc) {
    await db
      .update(board)
      .set({ boardViewCnt: sql`${board.boardViewCnt} + 1` })
      .where(eq(board.boardKey, key));
  }

  return {
    ...row,
    dateLabel: formatDateLabel(row.boardCreateDate),
    updateDateLabel: formatDateLabel(row.boardUpdateDate),
    boardViewCnt: params?.skipViewInc ? row.boardViewCnt : row.boardViewCnt + 1,
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

/** 등록 */
export async function create(params: {
  boardTitle: string;
  boardContents?: string | null;
  attachmentDraftKey?: string | null;
}) {
  const usrId = await requireWriter();
  const title = emptyToNull(params.boardTitle);
  if (!title) throw new Error('제목을 입력하세요.');

  const [inserted] = await db
    .insert(board)
    .values({
      boardTitle: title,
      boardContents: emptyToNull(params.boardContents),
      boardCreateDate: nowIso(),
      boardCreateUser: usrId,
      boardUpdateDate: nowIso(),
      boardUpdateUser: usrId,
    })
    .returning();

  if (!inserted) throw new Error('등록 실패');

  const draftKey = emptyToNull(params.attachmentDraftKey);
  if (draftKey) {
    try {
      await relocateServiceFileDataKey({
        layerName: BOARD_FILE_LAYER,
        fromKey: draftKey,
        toKey: String(inserted.boardKey),
      });
    } catch (e: unknown) {
      await db
        .update(board)
        .set({
          boardIsDel: true,
          boardUpdateDate: nowIso(),
          boardUpdateUser: usrId,
        })
        .where(eq(board.boardKey, inserted.boardKey));
      throw e instanceof Error ? e : new Error('첨부파일 연결에 실패했습니다.');
    }
  }

  return inserted;
}

/** 수정 */
export async function update(params: {
  boardKey: number;
  boardTitle?: string;
  boardContents?: string | null;
}) {
  const usrId = await requireWriter();
  const key = Number(params.boardKey);
  if (!Number.isInteger(key) || key < 1) throw new Error('잘못된 게시 키입니다.');

  const title = params.boardTitle != null ? emptyToNull(params.boardTitle) : undefined;
  if (title === null) throw new Error('제목을 입력하세요.');

  const [updated] = await db
    .update(board)
    .set({
      ...(title != null ? { boardTitle: title } : {}),
      ...(params.boardContents !== undefined
        ? { boardContents: emptyToNull(params.boardContents) }
        : {}),
      boardUpdateDate: nowIso(),
      boardUpdateUser: usrId,
    })
    .where(and(eq(board.boardKey, key), eq(board.boardIsDel, false)))
    .returning();

  return updated ?? null;
}

/** 글쓰기 임시 첨부 → 저장된 게시 키로 이전 */
export async function adoptAttachmentDraft(params: { draftKey: string; boardKey: number }) {
  await requireWriter();
  const draftKey = emptyToNull(params.draftKey);
  const boardKey = Number(params.boardKey);
  if (!draftKey || !Number.isInteger(boardKey) || boardKey < 1) {
    throw new Error('잘못된 첨부 이전 요청입니다.');
  }
  await relocateServiceFileDataKey({
    layerName: BOARD_FILE_LAYER,
    fromKey: draftKey,
    toKey: String(boardKey),
  });
  return { ok: true };
}

/** 글쓰기 취소 시 임시 첨부 폴더 삭제 */
export async function discardAttachmentDraft(params: { draftKey: string }) {
  await requireWriter();
  const draftKey = emptyToNull(params.draftKey);
  if (!draftKey) return { ok: true };
  const rel = fileDataRelativeDir(BOARD_FILE_LAYER, draftKey);
  if (!rel) return { ok: true };
  await deleteFileDataPath({ relativePath: rel });
  return { ok: true };
}

/** 삭제 (soft) */
export async function remove(params: { boardKey: number }) {
  const usrId = await requireWriter();
  const key = Number(params.boardKey);
  if (!Number.isInteger(key) || key < 1) throw new Error('잘못된 게시 키입니다.');

  const [updated] = await db
    .update(board)
    .set({
      boardIsDel: true,
      boardUpdateDate: nowIso(),
      boardUpdateUser: usrId,
    })
    .where(eq(board.boardKey, key))
    .returning();

  return updated ?? null;
}
