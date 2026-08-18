import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/database/db';
import { userLog } from '@/database/schema/user_log';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';

export const UL_CAT_USER = 'user';
export const UL_CAT_AUTH = 'auth';

type Params = Record<string, unknown>;

async function requireLoggedIn(): Promise<string> {
  const id = await getSessionUsrId();
  if (!id) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return id;
}

/** yyyyMMdd 또는 yyyy-MM-dd → Date (시작/끝) */
function parseDayBound(raw: unknown, endOfDay: boolean): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  if (endOfDay) return new Date(y, m, d, 23, 59, 59, 999);
  return new Date(y, m, d, 0, 0, 0, 0);
}

export async function recordUserLog(params: {
  ulCat: string;
  ulContents: string;
  ulType: string;
  ulUser: string;
  ulGroup?: string | null;
  ulWorkUser: string;
  ulDetail?: string | null;
  ulSubCat?: string | null;
}): Promise<{ ok: boolean; ulKey?: number }> {
  try {
    const [row] = await db
      .insert(userLog)
      .values({
        ulCat: params.ulCat,
        ulContents: params.ulContents,
        ulType: params.ulType,
        ulUser: params.ulUser,
        ulGroup: params.ulGroup ?? null,
        ulWorkUser: params.ulWorkUser,
        ulDetail: params.ulDetail ?? null,
        ulSubCat: params.ulSubCat ?? null,
        ulDate: new Date().toISOString(),
      })
      .returning({ ulKey: userLog.ulKey });
    return { ok: true, ulKey: row?.ulKey };
  } catch (e) {
    console.warn('[recordUserLog]', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

/** 사용자 관리 이력 목록 (ul_cat = user) */
export async function listUserMgmtHistory(p: Params = {}) {
  await requireLoggedIn();
  const page = Math.max(1, Number(p.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(p.pageSize) || 20));
  const keyword = p.keyword != null ? String(p.keyword).trim() : '';
  const start = parseDayBound(p.startDate, false);
  const end = parseDayBound(p.endDate, true);

  const conds: SQL[] = [eq(userLog.ulCat, UL_CAT_USER)];
  if (start) conds.push(gte(userLog.ulDate, start.toISOString()));
  if (end) conds.push(lte(userLog.ulDate, end.toISOString()));
  if (keyword) {
    const q = `%${keyword}%`;
    conds.push(
      or(
        ilike(userLog.ulContents, q),
        ilike(userLog.ulDetail, q),
        ilike(userLog.ulType, q),
        ilike(userLog.ulUser, q),
        ilike(userLog.ulWorkUser, q),
        ilike(userLog.ulGroup, q),
        ilike(usr.usrName, q)
      )!
    );
  }

  const where = and(...conds);

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(userLog)
    .leftJoin(usr, eq(userLog.ulUser, usr.usrId))
    .where(where);

  const total = Number(countRow?.c ?? 0);
  const offset = (page - 1) * pageSize;

  // data_log 등과 동일: naive UTC → Asia/Seoul 벽시계 문자열
  const rows = await db
    .select({
      ulKey: userLog.ulKey,
      ulCat: userLog.ulCat,
      ulContents: userLog.ulContents,
      ulDetail: userLog.ulDetail,
      ulType: userLog.ulType,
      ulUser: userLog.ulUser,
      ulGroup: userLog.ulGroup,
      ulWorkUser: userLog.ulWorkUser,
      ulDate: sql<string>`to_char(${userLog.ulDate} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')`,
      usrName: usr.usrName,
    })
    .from(userLog)
    .leftJoin(usr, eq(userLog.ulUser, usr.usrId))
    .where(where)
    .orderBy(desc(userLog.ulKey))
    .limit(pageSize)
    .offset(offset);

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
