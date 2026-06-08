import { eq, inArray } from 'drizzle-orm';
import db from '@/database/db';
import { ser } from '@/database/schema/ser';
import { serpMap } from '@/database/schema/serp_map';
import { sys } from '@/database/schema/sys';
import { syspMap } from '@/database/schema/sysp_map';
import { upMap } from '@/database/schema/up_map';
import { usrSerGrant } from '@/database/schema/usr_ser_grant';
import { usrSysGrant } from '@/database/schema/usr_sys_grant';
import { getServiceList, getSystemListAll } from '@/service/configService';
import {
  SERP_TYPE_LIST,
  SERP_TYPE_READ,
  SERP_TYPE_WRITE,
} from '@/database/schema/serp_map';

/** 슈퍼계정 su: 비공개 서비스·시스템 전부 허용 */
export function isSuperUser(usrId: string | null | undefined): boolean {
  return usrId === 'su';
}

export type UserAccessSnapshot = {
  usrId: string;
  permKeys: number[];
  /** 비공개 ser_eng → max 단계 (역할+개인 max) */
  privateSerLevel: Record<string, number>;
  /** 접근 가능한 비공개 sys_key (DB serial 문자열 또는 config sys_key) */
  privateSysKeys: string[];
};

export function serpTypeLabel(t: number): string {
  if (t >= 3) return '쓰기';
  if (t === 2) return '읽기';
  if (t === 1) return '버튼보기';
  return '없음';
}

export { SERP_TYPE_LIST, SERP_TYPE_READ, SERP_TYPE_WRITE };

/** 비공개 서비스에 필요한 최소 단계 */
export function canUsePrivateSer(level: number, need: 'list' | 'read' | 'write'): boolean {
  if (need === 'write') return level >= SERP_TYPE_WRITE;
  if (need === 'read') return level >= SERP_TYPE_READ;
  return level >= SERP_TYPE_LIST;
}

export async function loadUserAccess(usrId: string): Promise<UserAccessSnapshot> {
  if (isSuperUser(usrId)) {
    const privateSerRows = await db
      .select({ eng: ser.serEng })
      .from(ser)
      .where(eq(ser.serIsPrivate, true));
    const privateSerLevel: Record<string, number> = {};
    for (const r of privateSerRows) {
      if (r.eng) privateSerLevel[r.eng] = SERP_TYPE_WRITE;
    }
    for (const s of getServiceList().ser) {
      const e = s.ser_eng?.trim();
      if (e && s.ser_is_private === true) privateSerLevel[e] = SERP_TYPE_WRITE;
    }
    const allSys = await db.select({ k: sys.sysKey }).from(sys);
    const cfgKeys = getSystemListAll().systems.map((s) => s.sys_key?.trim()).filter(Boolean) as string[];
    const privateSysKeys = [...new Set([...allSys.map((r) => String(r.k)), ...cfgKeys])];
    return {
      usrId,
      permKeys: [],
      privateSerLevel,
      privateSysKeys,
    };
  }

  const permRows = await db
    .select({ k: upMap.permKey })
    .from(upMap)
    .where(eq(upMap.usrId, usrId));
  const permKeys = permRows.map((r) => r.k).filter((k): k is number => k != null);

  const privateSerRows = await db
    .select({ eng: ser.serEng })
    .from(ser)
    .where(eq(ser.serIsPrivate, true));

  const privateEngs = new Set(privateSerRows.map((r) => r.eng).filter(Boolean) as string[]);
  for (const s of getServiceList().ser) {
    const e = s.ser_eng?.trim();
    if (e && s.ser_is_private === true) privateEngs.add(e);
  }

  const privateSerLevel: Record<string, number> = {};
  for (const e of privateEngs) privateSerLevel[e] = 0;

  if (permKeys.length > 0) {
    const roleSer = await db
      .select({ serEng: serpMap.serEng, serpType: serpMap.serpType })
      .from(serpMap)
      .where(inArray(serpMap.permKey, permKeys));
    for (const r of roleSer) {
      if (!r.serEng) continue;
      const t = r.serpType ?? 0;
      privateSerLevel[r.serEng] = Math.max(privateSerLevel[r.serEng] ?? 0, t);
    }
  }

  const personalSer = await db
    .select()
    .from(usrSerGrant)
    .where(eq(usrSerGrant.usrId, usrId));
  for (const r of personalSer) {
    privateSerLevel[r.serEng] = Math.max(privateSerLevel[r.serEng] ?? 0, r.serpType);
  }

  const privateSysRows = await db
    .select({ k: sys.sysKey })
    .from(sys)
    .where(eq(sys.sysIsPrivate, true));
  const privateSysKeySet = new Set(privateSysRows.map((r) => String(r.k)));
  for (const s of getSystemListAll().systems) {
    const k = s.sys_key?.trim();
    if (k && s.sys_is_private === true) privateSysKeySet.add(k);
  }

  const allowedSys = new Set<string>();
  if (permKeys.length > 0) {
    const roleSys = await db
      .select({ sysKey: syspMap.sysKey })
      .from(syspMap)
      .where(inArray(syspMap.permKey, permKeys));
    for (const r of roleSys) {
      const sk = r.sysKey != null ? String(r.sysKey).trim() : '';
      if (sk && privateSysKeySet.has(sk)) allowedSys.add(sk);
    }
  }
  const personalSys = await db
    .select({ sysKey: usrSysGrant.sysKey })
    .from(usrSysGrant)
    .where(eq(usrSysGrant.usrId, usrId));
  for (const r of personalSys) {
    const sk = r.sysKey != null ? String(r.sysKey).trim() : '';
    if (sk && privateSysKeySet.has(sk)) allowedSys.add(sk);
  }

  return {
    usrId,
    permKeys,
    privateSerLevel,
    privateSysKeys: [...allowedSys],
  };
}

/** 공개 서비스 또는 비공개면 충분한 단계 */
export function effectiveSerLevel(
  snapshot: UserAccessSnapshot,
  serEng: string,
  serIsPrivate: boolean | null
): number {
  if (isSuperUser(snapshot.usrId)) return SERP_TYPE_WRITE;
  if (!serIsPrivate) return SERP_TYPE_WRITE;
  return snapshot.privateSerLevel[serEng] ?? 0;
}

export function canAccessSys(
  snapshot: UserAccessSnapshot,
  sysKey: string | number,
  sysIsPrivate: boolean | null
): boolean {
  if (isSuperUser(snapshot.usrId)) return true;
  if (!sysIsPrivate) return true;
  const k = String(sysKey).trim();
  return snapshot.privateSysKeys.includes(k);
}
