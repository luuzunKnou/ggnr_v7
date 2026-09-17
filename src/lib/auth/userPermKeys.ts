import { eq, inArray } from 'drizzle-orm';
import db from '@/database/db';
import { gpMap } from '@/database/schema/gp_map';
import { tpMap } from '@/database/schema/tp_map';
import { upMap } from '@/database/schema/up_map';
import { usr } from '@/database/schema/usr';

/** 사용자 개인·부서·팀 역할을 합친 권한 키 (중복 제거) */
export async function loadEffectivePermKeys(usrId: string): Promise<number[]> {
  const id = String(usrId ?? '').trim();
  if (!id) return [];

  const keySet = new Set<number>();

  const personal = await db
    .select({ k: upMap.permKey })
    .from(upMap)
    .where(eq(upMap.usrId, id));
  for (const r of personal) {
    if (r.k != null) keySet.add(r.k);
  }

  const [userRow] = await db
    .select({ ugName: usr.ugName, utName: usr.utName })
    .from(usr)
    .where(eq(usr.usrId, id))
    .limit(1);
  if (!userRow) return [...keySet];

  const ugName = String(userRow.ugName ?? '').trim();
  const utName = String(userRow.utName ?? '').trim();

  if (ugName) {
    const dept = await db
      .select({ k: gpMap.permKey })
      .from(gpMap)
      .where(eq(gpMap.ugName, ugName));
    for (const r of dept) {
      if (r.k != null) keySet.add(r.k);
    }
  }
  if (utName) {
    const team = await db
      .select({ k: tpMap.permKey })
      .from(tpMap)
      .where(eq(tpMap.utName, utName));
    for (const r of team) {
      if (r.k != null) keySet.add(r.k);
    }
  }

  return [...keySet];
}

/** 권한 키 배열만 조회할 때 inArray용 (빈 배열이면 null) */
export function asPermKeyList(keys: number[]): number[] | null {
  const out = keys.filter((k) => Number.isInteger(k) && k > 0);
  return out.length > 0 ? out : null;
}

export { inArray };
