import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSidoNameByPrefix } from '@/lib/sidoCodes';

export type PublicLayerAddressPrefixes = {
  sidoName: string;
  sggName: string;
};

async function listSggColumns(): Promise<Set<string>> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public_layer' AND table_name = 'sgg'`
      )
    );
    const set = new Set<string>();
    for (const row of res.rows ?? []) {
      const name = String((row as { column_name?: unknown }).column_name ?? '')
        .trim()
        .toLowerCase();
      if (name) set.add(name);
    }
    return set;
  } catch {
    return new Set();
  }
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function resolveSggNameCodeCols(): Promise<{
  nameCol: string | null;
  codeCol: string | null;
}> {
  const cols = await listSggColumns();
  const pick = (...candidates: string[]) => candidates.find((c) => cols.has(c)) ?? null;
  return {
    nameCol: pick('sgg_nm', 'name', 'sig_kor_nm', 'kor_nm'),
    codeCol: pick('adm_sect_c', 'adm_sect_cd', 'bjcd', 'sgg_cd', 'sig_cd'),
  };
}

/** public_layer.sgg 시군구명 목록 */
export async function fetchPublicLayerSggNames(): Promise<string[]> {
  try {
    const { nameCol } = await resolveSggNameCodeCols();
    if (!nameCol) return [];
    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT trim(${quoteIdent(nameCol)}::text) AS sgg_nm
         FROM public_layer.sgg
         WHERE ${quoteIdent(nameCol)} IS NOT NULL
           AND trim(${quoteIdent(nameCol)}::text) <> ''
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

/** 목록·상세 주소 접두 제거용 — sgg 1행 + 코드→시도명 */
export async function fetchPublicLayerAddressPrefixes(): Promise<PublicLayerAddressPrefixes> {
  try {
    const { nameCol, codeCol } = await resolveSggNameCodeCols();
    if (!nameCol) return { sidoName: '', sggName: '' };
    const codeSelect = codeCol
      ? `trim(${quoteIdent(codeCol)}::text) AS adm_sect_c`
      : `''::text AS adm_sect_c`;
    const res = await db.execute(
      sql.raw(
        `SELECT trim(${quoteIdent(nameCol)}::text) AS sgg_nm,
                ${codeSelect}
         FROM public_layer.sgg
         WHERE ${quoteIdent(nameCol)} IS NOT NULL
           AND trim(${quoteIdent(nameCol)}::text) <> ''
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
