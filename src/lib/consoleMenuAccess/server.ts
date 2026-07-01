import { eq, inArray } from 'drizzle-orm';
import db from '@/database/db';
import { serpMap } from '@/database/schema/serp_map';
import { upMap } from '@/database/schema/up_map';
import { usrSerGrant } from '@/database/schema/usr_ser_grant';
import { getAllConsolePermEngs, isConsolePermEng } from '@/lib/consoleMenuAccess/registry';
import { SERP_TYPE_WRITE } from '@/database/schema/serp_map';

/** serp_map·usr_ser_grant 기준 콘솔 메뉴(permEng) 단계 */
export async function loadConsoleMenuLevels(usrId: string): Promise<Record<string, number>> {
  const allEngs = getAllConsolePermEngs();
  const levels: Record<string, number> = {};
  for (const e of allEngs) levels[e] = 0;

  if (usrId === 'su') {
    for (const e of allEngs) levels[e] = SERP_TYPE_WRITE;
    return levels;
  }

  const permRows = await db
    .select({ k: upMap.permKey })
    .from(upMap)
    .where(eq(upMap.usrId, usrId));
  const permKeys = permRows.map((r) => r.k).filter((k): k is number => k != null);

  if (permKeys.length > 0) {
    const roleSer = await db
      .select({ serEng: serpMap.serEng, serpType: serpMap.serpType })
      .from(serpMap)
      .where(inArray(serpMap.permKey, permKeys));
    for (const r of roleSer) {
      if (!r.serEng || !isConsolePermEng(r.serEng)) continue;
      const t = r.serpType ?? 0;
      levels[r.serEng] = Math.max(levels[r.serEng] ?? 0, t);
    }
  }

  const personalSer = await db
    .select({ serEng: usrSerGrant.serEng, serpType: usrSerGrant.serpType })
    .from(usrSerGrant)
    .where(eq(usrSerGrant.usrId, usrId));
  for (const r of personalSer) {
    if (!r.serEng || !isConsolePermEng(r.serEng)) continue;
    levels[r.serEng] = Math.max(levels[r.serEng] ?? 0, r.serpType);
  }

  return levels;
}
