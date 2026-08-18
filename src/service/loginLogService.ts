import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/database/db';
import { loginLog } from '@/database/schema/login_log';
import { usr } from '@/database/schema/usr';

type Params = Record<string, unknown>;
export type LoginLogDateType = 'month' | 'week' | 'day';

const MAX_STAT_BUCKETS = 62;

/** 목록·통계 API 전용 — 정적 import 시 auth Edge 번들로 configService가 끌려감 */
async function requireLoggedIn(): Promise<string> {
  const { getSessionUsrId } = await import('@/lib/auth/guard');
  const id = await getSessionUsrId();
  if (!id) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return id;
}

/** auth 기록용 — Edge 안전 모듈로 분리. 목록 API와 같은 서비스명으로도 쓸 수 있게 재export */
export { recordLoginLog } from './loginLogRecord';

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

function parseYmdLocal(raw: unknown): { y: number; m: number; d: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  return {
    y: Number(s.slice(0, 4)),
    m: Number(s.slice(4, 6)),
    d: Number(s.slice(6, 8)),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** V6 DateHelper.createDateList 와 동일 라벨 (yy-MM / MM-dd) */
function createDateList(
  startRaw: unknown,
  endRaw: unknown,
  dateType: LoginLogDateType
): string[] {
  const start = parseYmdLocal(startRaw);
  const end = parseYmdLocal(endRaw);
  if (!start || !end) return [];

  const out: string[] = [];
  let y = start.y;
  let m = start.m;
  let d = start.d;

  const isAfterEnd = () =>
    y > end.y || (y === end.y && m > end.m) || (y === end.y && m === end.m && d > end.d);

  if (dateType === 'month') {
    while (!isAfterEnd() && out.length < MAX_STAT_BUCKETS) {
      out.push(`${String(y).slice(-2)}-${pad2(m)}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      d = 1;
    }
    return out;
  }

  if (dateType === 'week') {
    const cur = new Date(y, m - 1, d);
    const endDate = new Date(end.y, end.m - 1, end.d);
    while (cur <= endDate && out.length < MAX_STAT_BUCKETS) {
      out.push(`${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
      const day = cur.getDay();
      const add = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
      cur.setDate(cur.getDate() + add);
    }
    return out;
  }

  const cur = new Date(y, m - 1, d);
  const endDate = new Date(end.y, end.m - 1, end.d);
  while (cur <= endDate && out.length < MAX_STAT_BUCKETS) {
    out.push(`${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function truncExpr(dateType: LoginLogDateType) {
  const seoul = sql`(${loginLog.loginTime} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')`;
  if (dateType === 'month') {
    return sql`to_char(date_trunc('month', ${seoul}), 'YY-MM')`;
  }
  if (dateType === 'week') {
    return sql`to_char(date_trunc('week', ${seoul}), 'MM-DD')`;
  }
  return sql`to_char(date_trunc('day', ${seoul}), 'MM-DD')`;
}

function parseDateType(raw: unknown): LoginLogDateType {
  const s = String(raw ?? 'month').trim();
  if (s === 'week' || s === 'day' || s === 'month') return s;
  return 'month';
}

/** 기간별 합계(차트) + 사용자×기간 피벗 (V6 selectLoginLogData) */
export async function listLoginLogStats(p: Params = {}) {
  await requireLoggedIn();
  const dateType = parseDateType(p.dateType);
  const start = parseDayBound(p.startDate, false);
  const end = parseDayBound(p.endDate, true);
  if (!start || !end) {
    return { dateList: [], chartData: [], tableRows: [], truncated: false, dateType };
  }

  const dateListFull = createDateList(p.startDate, p.endDate, dateType);
  const truncated = dateListFull.length >= MAX_STAT_BUCKETS;
  const dateList = dateListFull;

  const bucket = truncExpr(dateType);
  const rangeConds = and(
    gte(loginLog.loginTime, start.toISOString()),
    lte(loginLog.loginTime, end.toISOString())
  );

  const chartRows = await db
    .select({
      label: sql<string>`${bucket}`,
      count: sql<number>`count(*)::int`,
    })
    .from(loginLog)
    .where(rangeConds)
    .groupBy(sql`${bucket}`)
    .orderBy(sql`${bucket}`);

  const chartMap = new Map<string, number>();
  for (const r of chartRows) {
    const label = String(r.label ?? '').trim();
    if (!label) continue;
    chartMap.set(label, Number(r.count ?? 0));
  }
  const chartData = dateList.map((label) => ({
    label,
    count: chartMap.get(label) ?? 0,
  }));

  const pivotRows = await db
    .select({
      loginUser: loginLog.loginUser,
      ugName: usr.ugName,
      usrName: usr.usrName,
      label: sql<string>`${bucket}`,
      count: sql<number>`count(*)::int`,
    })
    .from(loginLog)
    .leftJoin(usr, eq(loginLog.loginUser, usr.usrId))
    .where(rangeConds)
    .groupBy(loginLog.loginUser, usr.ugName, usr.usrName, sql`${bucket}`)
    .orderBy(loginLog.loginUser);

  const byUser = new Map<
    string,
    { loginUser: string; ugName: string | null; usrName: string | null; counts: Record<string, number> }
  >();
  for (const r of pivotRows) {
    const uid = String(r.loginUser ?? '').trim();
    if (!uid) continue;
    let row = byUser.get(uid);
    if (!row) {
      row = {
        loginUser: uid,
        ugName: r.ugName ?? null,
        usrName: r.usrName ?? null,
        counts: Object.fromEntries(dateList.map((d) => [d, 0])),
      };
      byUser.set(uid, row);
    }
    const label = String(r.label ?? '').trim();
    if (label && label in row.counts) {
      row.counts[label] = Number(r.count ?? 0);
    }
  }

  return {
    dateType,
    dateList,
    chartData,
    tableRows: Array.from(byUser.values()),
    truncated,
  };
}

/** 사용자 접속현황 목록 */
export async function listLoginLog(p: Params = {}) {
  await requireLoggedIn();
  const page = Math.max(1, Number(p.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(p.pageSize) || 20));
  const keyword = p.keyword != null ? String(p.keyword).trim() : '';
  const start = parseDayBound(p.startDate, false);
  const end = parseDayBound(p.endDate, true);

  const conds: SQL[] = [];
  if (start) conds.push(gte(loginLog.loginTime, start.toISOString()));
  if (end) conds.push(lte(loginLog.loginTime, end.toISOString()));
  if (keyword) {
    const q = `%${keyword}%`;
    conds.push(
      or(
        ilike(loginLog.loginUser, q),
        ilike(loginLog.loginIp, q),
        ilike(usr.usrName, q),
        ilike(usr.ugName, q),
        ilike(usr.utName, q)
      )!
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(loginLog)
    .leftJoin(usr, eq(loginLog.loginUser, usr.usrId))
    .where(where);

  const total = Number(countRow?.c ?? 0);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select({
      llKey: loginLog.llKey,
      loginUser: loginLog.loginUser,
      loginIp: loginLog.loginIp,
      loginTime: sql<string>`to_char(${loginLog.loginTime} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')`,
      usrName: usr.usrName,
      ugName: usr.ugName,
      utName: usr.utName,
    })
    .from(loginLog)
    .leftJoin(usr, eq(loginLog.loginUser, usr.usrId))
    .where(where)
    .orderBy(desc(loginLog.llKey))
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
