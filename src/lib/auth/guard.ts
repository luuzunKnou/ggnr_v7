import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import db from '@/database/db';
import { ser } from '@/database/schema/ser';
import { loadUserAccess, effectiveSerLevel, canUsePrivateSer, SERP_TYPE_WRITE } from '@/lib/auth/access';
import { isSuperUser } from '@/lib/auth/access';
import { getServiceList } from '@/service/configService';

export async function getSessionUsrId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
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
