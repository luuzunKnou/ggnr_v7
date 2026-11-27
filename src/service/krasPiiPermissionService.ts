/**
 * 사용자별 KRAS 개인정보 원문 열람 권한 — 목록·변경·세션 검사
 */
import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { kpp } from '@/database/schema/kras_pii_perm';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';
import { recordUserLog, UL_CAT_AUTH } from '@/service/userLogService';

type Params = Record<string, unknown>;

async function requireLoggedIn(): Promise<string> {
  const id = await getSessionUsrId();
  if (!id) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return id;
}

function isMissingKppTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const cause =
    e instanceof Error && e.cause instanceof Error
      ? e.cause.message
      : e instanceof Error && e.cause && typeof e.cause === 'object' && 'message' in e.cause
        ? String((e.cause as { message: unknown }).message)
        : '';
  const text = `${msg}\n${cause}`;
  return /kras_pii_perm|relation .* does not exist/i.test(text) && /does not exist/i.test(text);
}

/** 행 없음·테이블 없음 = 허용(기존 동작). su는 항상 허용 */
export async function isKrasPiiAllowedForUser(usrId: string | null | undefined): Promise<boolean> {
  const id = String(usrId ?? '').trim();
  if (!id) return false;
  if (id.toLowerCase() === 'su') return true;
  try {
    const [row] = await db
      .select({ kppAllowed: kpp.kppAllowed })
      .from(kpp)
      .where(eq(kpp.kppUsrId, id))
      .limit(1);
    if (!row) return true;
    return !!row.kppAllowed;
  } catch (e) {
    if (isMissingKppTable(e)) return true;
    console.warn('[kpp] isKrasPiiAllowedForUser', e instanceof Error ? e.message : e);
    return true;
  }
}

export async function isKrasPiiAllowedForSession(): Promise<boolean> {
  const id = await getSessionUsrId();
  return isKrasPiiAllowedForUser(id);
}

/** 부서 정렬: 관리자 → 개발자 → 나머지 가나다 */
function ugSortRank(name: string | null | undefined): number {
  const n = String(name ?? '').trim();
  if (n === '관리자') return 0;
  if (n === '개발자') return 1;
  return 2;
}

function compareUgName(a: string | null | undefined, b: string | null | undefined): number {
  const ra = ugSortRank(a);
  const rb = ugSortRank(b);
  if (ra !== rb) return ra - rb;
  return String(a ?? '')
    .trim()
    .localeCompare(String(b ?? '').trim(), 'ko');
}

/** 미삭제 사용자에 실제 존재하는 부서명 */
async function listActiveUgNames(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ ugName: usr.ugName })
    .from(usr)
    .where(
      and(
        sql`coalesce(${usr.usrIsDel}, false) = false`,
        isNotNull(usr.ugName),
        ne(usr.ugName, '')
      )
    );
  return rows
    .map((r) => String(r.ugName ?? '').trim())
    .filter(Boolean)
    .sort(compareUgName);
}

function buildUsrListWhere(ugName: string) {
  const conds = [sql`coalesce(${usr.usrIsDel}, false) = false`];
  if (ugName) conds.push(eq(usr.ugName, ugName));
  return and(...conds);
}

/** 부서 필터(또는 전체)에 해당하는 선택 가능 사용자 ID — su 제외 */
export async function listKrasPiiSelectableIds(p: Params = {}) {
  await requireLoggedIn();
  const ugName = p.ugName != null ? String(p.ugName).trim() : '';
  const where = buildUsrListWhere(ugName);
  const rows = await db
    .select({ usrId: usr.usrId })
    .from(usr)
    .where(and(where, sql`lower(${usr.usrId}) <> 'su'`))
    .orderBy(asc(usr.usrId));
  return {
    usrIds: rows.map((r) => r.usrId).filter(Boolean),
    ugName: ugName || null,
  };
}

/** 사용자 목록 + KRAS 개인정보 허용 여부 (부서 필터) */
export async function listKrasPiiPermissions(p: Params = {}) {
  await requireLoggedIn();
  const ugName = p.ugName != null ? String(p.ugName).trim() : '';
  const page = Math.max(1, Number(p.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(p.pageSize) || 19));

  const where = buildUsrListWhere(ugName);

  try {
    const departments = await listActiveUgNames();
    const [countRow] = await db.select({ c: sql<number>`count(*)::int` }).from(usr).where(where);
    const total = Number(countRow?.c ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;

    const rows = await db
      .select({
        usrId: usr.usrId,
        usrName: usr.usrName,
        ugName: usr.ugName,
        kppAllowed: kpp.kppAllowed,
        kppAt: kpp.kppAt,
        kppBy: kpp.kppBy,
      })
      .from(usr)
      .leftJoin(kpp, eq(usr.usrId, kpp.kppUsrId))
      .where(where)
      .orderBy(
        sql`case
          when coalesce(${usr.ugName}, '') = '관리자' then 0
          when coalesce(${usr.ugName}, '') = '개발자' then 1
          else 2
        end`,
        asc(usr.ugName),
        sql`case when coalesce(${usr.usrIsManager}, false) then 0 else 1 end`,
        asc(usr.usrName),
        asc(usr.usrId)
      )
      .limit(pageSize)
      .offset(offset);

    return {
      rows: rows.map((r) => ({
        usrId: r.usrId,
        usrName: r.usrName,
        ugName: r.ugName,
        /** 행 없음 = 허용 */
        allowed: r.kppAllowed == null ? true : !!r.kppAllowed,
        kppAt: r.kppAt,
        kppBy: r.kppBy,
      })),
      departments,
      total,
      page,
      pageSize,
      totalPages,
    };
  } catch (e) {
    if (isMissingKppTable(e)) {
      let departments: string[] = [];
      try {
        departments = await listActiveUgNames();
      } catch {
        departments = [];
      }
      return {
        rows: [] as Array<{
          usrId: string;
          usrName: string | null;
          ugName: string | null;
          allowed: boolean;
          kppAt: string | null;
          kppBy: string | null;
        }>,
        departments,
        total: 0,
        page: 1,
        pageSize,
        totalPages: 1,
        message: '권한 테이블이 아직 없습니다. 스키마 적용 후 사용할 수 있습니다.',
      };
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

function parseAllowedFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

async function upsertKrasPiiAllowed(
  workUser: string,
  usrId: string,
  allowed: boolean,
  at: string
): Promise<{ usrId: string; ugName: string | null; usrName: string | null }> {
  const [target] = await db
    .select({ usrId: usr.usrId, ugName: usr.ugName, usrName: usr.usrName })
    .from(usr)
    .where(eq(usr.usrId, usrId))
    .limit(1);
  if (!target) throw Object.assign(new Error(`사용자를 찾을 수 없습니다: ${usrId}`), { status: 404 });

  try {
    await db
      .insert(kpp)
      .values({
        kppUsrId: usrId,
        kppAllowed: allowed,
        kppAt: at,
        kppBy: workUser,
      })
      .onConflictDoUpdate({
        target: kpp.kppUsrId,
        set: {
          kppAllowed: allowed,
          kppAt: at,
          kppBy: workUser,
        },
      });
  } catch (e) {
    if (isMissingKppTable(e)) {
      throw Object.assign(new Error('권한 테이블이 아직 없습니다. 스키마 적용 후 저장할 수 있습니다.'), {
        status: 503,
      });
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
  return target;
}

async function logKrasPiiChange(
  workUser: string,
  target: { usrId: string; ugName: string | null; usrName: string | null },
  allowed: boolean
) {
  await recordUserLog({
    ulCat: UL_CAT_AUTH,
    ulContents: 'KRAS 개인정보 원문 열람',
    ulType: allowed ? '허용' : '회수',
    ulUser: target.usrId,
    ulGroup: target.ugName ?? null,
    ulWorkUser: workUser,
    ulDetail: allowed
      ? `${target.usrName ?? target.usrId}: KRAS 개인정보 원문 열람 허용`
      : `${target.usrName ?? target.usrId}: KRAS 개인정보 원문 열람 회수`,
    ulSubCat: 'kras_pii',
  });
}

/** KRAS 개인정보 원문 열람 허용·회수 */
export async function setKrasPiiAllowed(p: Params = {}) {
  const workUser = await requireLoggedIn();
  const usrId = p.usrId != null ? String(p.usrId).trim() : '';
  if (!usrId) throw Object.assign(new Error('사용자 아이디가 필요합니다.'), { status: 400 });
  if (usrId.toLowerCase() === 'su') {
    throw Object.assign(new Error('슈퍼관리자 권한은 변경할 수 없습니다.'), { status: 400 });
  }
  const allowed = parseAllowedFlag(p.allowed);
  const at = new Date().toISOString();
  const target = await upsertKrasPiiAllowed(workUser, usrId, allowed, at);
  await logKrasPiiChange(workUser, target, allowed);
  return { ok: true, usrId, allowed };
}

/** KRAS 개인정보 원문 열람 일괄 허용·회수 */
export async function setKrasPiiAllowedBulk(p: Params = {}) {
  const workUser = await requireLoggedIn();
  const rawIds = Array.isArray(p.usrIds) ? p.usrIds : [];
  const usrIds = [
    ...new Set(
      rawIds
        .map((id) => String(id ?? '').trim())
        .filter((id) => id && id.toLowerCase() !== 'su')
    ),
  ];
  if (!usrIds.length) {
    throw Object.assign(new Error('적용할 사용자를 선택하세요.'), { status: 400 });
  }
  if (usrIds.length > 1000) {
    throw Object.assign(new Error('한 번에 1000명까지 적용할 수 있습니다.'), { status: 400 });
  }
  const allowed = parseAllowedFlag(p.allowed);
  const at = new Date().toISOString();
  const updated: string[] = [];
  for (const usrId of usrIds) {
    const target = await upsertKrasPiiAllowed(workUser, usrId, allowed, at);
    await logKrasPiiChange(workUser, target, allowed);
    updated.push(usrId);
  }
  return { ok: true, allowed, count: updated.length, usrIds: updated };
}
