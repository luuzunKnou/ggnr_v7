import { inArray } from 'drizzle-orm';
import db from '@/database/db';
import { serpMap } from '@/database/schema/serp_map';
import { getAllConsolePermEngs, isConsolePermEng } from '@/lib/consoleMenuAccess/registry';
import { SERP_TYPE_WRITE } from '@/database/schema/serp_map';
import { isSuperUser } from '@/lib/auth/superUser';
import { loadEffectivePermKeys } from '@/lib/auth/userPermKeys';

/** serp_map + 개인·부서·팀 역할 기준 콘솔 메뉴(permEng) 단계 */
export async function loadConsoleMenuLevels(usrId: string): Promise<Record<string, number>> {
  const allEngs = getAllConsolePermEngs();
  const levels: Record<string, number> = {};
  for (const e of allEngs) levels[e] = 0;

  if (isSuperUser(usrId)) {
    for (const e of allEngs) levels[e] = SERP_TYPE_WRITE;
    return levels;
  }

  const permKeys = await loadEffectivePermKeys(usrId);

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

  return levels;
}
