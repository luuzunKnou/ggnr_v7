import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

export { stationIncludesSggNm } from '@/lib/hrfcoClient';

/**
 * public_layer.sgg 의 시군구명 목록.
 * 조회 실패 시 빈 배열 (호출측에서 bbox만 적용하도록).
 */
export async function fetchPublicLayerSggNames(): Promise<string[]> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT trim(sgg_nm::text) AS sgg_nm
         FROM public_layer.sgg
         WHERE sgg_nm IS NOT NULL
           AND trim(sgg_nm::text) <> ''
         ORDER BY 1
         LIMIT 50`
      )
    );
    const names: string[] = [];
    for (const row of res.rows ?? []) {
      const n = String((row as { sgg_nm?: unknown }).sgg_nm ?? '').trim();
      if (n) names.push(n);
    }
    return names;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[flood] public_layer.sgg sgg_nm 조회 실패: ${msg}`);
    return [];
  }
}
