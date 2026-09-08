import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSidoNameByPrefix } from '@/lib/sidoCodes';

export type PublicLayerAddressPrefixes = {
  sidoName: string;
  sggName: string;
};

/** public_layer.sgg 시군구명 목록 */
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
  } catch {
    return [];
  }
}

/** 목록·상세 주소 접두 제거용 — sgg 1행 + adm_sect_c→시도명 */
export async function fetchPublicLayerAddressPrefixes(): Promise<PublicLayerAddressPrefixes> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT trim(sgg_nm::text) AS sgg_nm,
                trim(adm_sect_c::text) AS adm_sect_c
         FROM public_layer.sgg
         WHERE sgg_nm IS NOT NULL
           AND trim(sgg_nm::text) <> ''
         LIMIT 1`
      )
    );
    const row = (res.rows?.[0] ?? null) as { sgg_nm?: unknown; adm_sect_c?: unknown } | null;
    if (!row) return { sidoName: '', sggName: '' };
    const sggName = String(row.sgg_nm ?? '').trim();
    const admSectC = String(row.adm_sect_c ?? '').trim();
    const sidoName = getSidoNameByPrefix(admSectC.slice(0, 2));
    return { sidoName, sggName };
  } catch {
    return { sidoName: '', sggName: '' };
  }
}
