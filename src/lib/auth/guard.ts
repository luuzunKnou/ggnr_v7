import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import db from '@/database/db';
import { ser } from '@/database/schema/ser';
import { loadUserAccess, effectiveSerLevel, canUsePrivateSer, SERP_TYPE_WRITE } from '@/lib/auth/access';
import { isSuperUser } from '@/lib/auth/access';
import { hasAnyDevConsoleAccess } from '@/lib/consoleMenuAccess/client';
import { loadConsoleMenuLevels } from '@/lib/consoleMenuAccess/server';
import { getServiceList } from '@/service/configService';

export async function getSessionUsrId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** 지도 점검 도구(로그·수동 연계 등) — 슈퍼관리자 또는 개발 콘솔 권한 */
export async function requireMapAdminToolsAccess(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (isSuperUser(usrId)) return usrId;
  const levels = await loadConsoleMenuLevels(usrId);
  if (hasAnyDevConsoleAccess(levels)) return usrId;
  throw Object.assign(new Error('Forbidden'), { status: 403 });
}

/** 비공개 서비스에 대해 최소 단계 충족 여부 */
export async function userHasSerAccess(
  usrId: string,
  serEng: string,
  need: 'list' | 'read' | 'write'
): Promise<boolean> {
  if (isSuperUser(usrId)) return true;
  const rows = await db
    .select({ priv: ser.serIsPrivate })
    .from(ser)
    .where(eq(ser.serEng, serEng))
    .limit(1);
  const cfgPrivate = getServiceList().ser.some(
    (s) => s.ser_eng?.trim() === serEng.trim() && s.ser_is_private === true
  );
  const isPrivate = rows[0]?.priv === true || cfgPrivate;
  const snap = await loadUserAccess(usrId);
  const level = effectiveSerLevel(snap, serEng, isPrivate);
  if (!isPrivate) {
    if (need === 'write') return level >= SERP_TYPE_WRITE;
    return true;
  }
  return canUsePrivateSer(level, need);
}
