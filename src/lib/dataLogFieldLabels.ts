/**
 * 데이터 로그 속성 표시명 — define 한글명 / DB 컬럼 comment
 */
import * as fs from 'fs';
import * as path from 'path';

const DEFINE_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

/** defineLayer fields — 필드영문 → 한글명 */
export function loadDefineFieldKorMap(tableName: string): Map<string, string> {
  const map = new Map<string, string>();
  const safe = String(tableName ?? '').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  if (!safe) return map;
  const filePath = path.join(DEFINE_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return map;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return map;
    for (const row of parsed as Array<Record<string, unknown>>) {
      const eng = String(row.define_field_name ?? '').trim();
      const kor = String(row.define_field_kor_name ?? '').trim();
      if (!eng || !kor) continue;
      map.set(eng.toLowerCase(), kor);
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** DB 컬럼 comment — layer / public_layer / public */
export async function loadColumnCommentMap(tableName: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const tbl = String(tableName ?? '').trim();
  if (!tbl) return map;
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT a.attname::text AS col, pg_catalog.col_description(c.oid, a.attnum) AS comment
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('layer', 'public_layer', 'public')
        AND lower(c.relname) = lower(${tbl})
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND pg_catalog.col_description(c.oid, a.attnum) IS NOT NULL
        AND btrim(pg_catalog.col_description(c.oid, a.attnum)) <> ''
    `);
    for (const row of (res.rows as Array<{ col?: string; comment?: string }>) ?? []) {
      const col = String(row.col ?? '').trim();
      const comment = String(row.comment ?? '').trim();
      if (!col || !comment) continue;
      if (!map.has(col.toLowerCase())) map.set(col.toLowerCase(), comment);
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** 영문(한글) — 한글이 있고 영문과 다르면 괄호 병기 */
export function formatAttrDisplayName(
  engRaw: string,
  korMap: Map<string, string>,
  commentMap: Map<string, string>,
): string {
  const eng = engRaw.trim() || '(항목)';
  // 이미 병기된 경우 유지
  if (/\(.+\)\s*$/.test(eng) && !eng.startsWith('(')) return eng;
  const key = eng.toLowerCase();
  const fromDefine = korMap.get(key)?.trim() || '';
  const fromComment = commentMap.get(key)?.trim() || '';
  const kor = fromDefine || fromComment;
  if (!kor || kor.toLowerCase() === eng.toLowerCase()) return eng;
  return `${eng}(${kor})`;
}

export async function resolveFieldLabelMaps(tableName: string): Promise<{
  korMap: Map<string, string>;
  commentMap: Map<string, string>;
}> {
  const korMap = loadDefineFieldKorMap(tableName);
  const commentMap = await loadColumnCommentMap(tableName);
  return { korMap, commentMap };
}
