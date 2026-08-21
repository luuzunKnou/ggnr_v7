import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { fmsIdentifierHeader } from '@/database/schema/fms_identifier_header';
import {
  FMS_FACILITY_TABLE_NAMES,
  FMS_INSPECTION_TABLE_NAMES,
  getFmsDataKindForIdentifier,
} from '@/lib/fmsLinkage/fmsBinding';

type CodeField = {
  colName: string;
  refName: string;
  codeDept: string;
};

async function findCodeFields(identifier: string): Promise<CodeField[]> {
  const rows = await db
    .select({
      colName: fmsIdentifierHeader.colName,
      refName: fmsIdentifierHeader.refName,
      codeDept: fmsIdentifierHeader.codeDept,
    })
    .from(fmsIdentifierHeader)
    .where(
      and(
        eq(fmsIdentifierHeader.identifier, identifier),
        isNotNull(fmsIdentifierHeader.refName),
        isNotNull(fmsIdentifierHeader.codeDept)
      )
    )
    .orderBy(asc(fmsIdentifierHeader.colOrder));

  const out: CodeField[] = [];
  for (const row of rows) {
    const colName = String(row.colName ?? '').trim();
    const refName = String(row.refName ?? '').trim();
    const codeDept = String(row.codeDept ?? '').trim();
    if (!colName || !refName || !codeDept) continue;
    out.push({ colName, refName, codeDept });
  }
  return out;
}

function buildSetClause(fields: CodeField[], includeAddrFull: boolean): string {
  const parts: string[] = [];
  if (includeAddrFull) {
    parts.push(
      "addr_full = CONCAT_WS(' ', target.addr_sido, target.addr_gugun, target.addr_dong, target.addr_detail)"
    );
  }
  for (const f of fields) {
    const col = f.colName.toLowerCase();
    const dept = f.codeDept;
    const ref = f.refName.replace(/'/g, "''");
    parts.push(`${col} = COALESCE((
      SELECT CASE
        WHEN '${dept}' = 'code1' THEN REPLACE(fc.data1, CHR(160), '')
        WHEN '${dept}' = 'code2' THEN REPLACE(fc.data2, CHR(160), '')
        WHEN '${dept}' = 'code3' THEN REPLACE(fc.data3, CHR(160), '')
      END
      FROM fms_linkage.fms_code fc
      WHERE fc.code_name = LOWER('${ref}')
      AND (
        ('${dept}' = 'code1' AND fc.code1 = target.${col}) OR
        ('${dept}' = 'code2' AND fc.code2 = target.${col}) OR
        ('${dept}' = 'code3' AND fc.code3 = target.${col})
      )
      LIMIT 1
    ), REGEXP_REPLACE(TRIM(target.${col}), '^\\^', ''))`);
  }
  return parts.join(',\n    ');
}

/** v6 updateCodeToKor — layer 시설물·점검 테이블 코드→한글 */
export async function updateFmsCodeToKor(identifier: string): Promise<void> {
  const id = String(identifier ?? '').trim();
  if (!id) return;

  const kind = getFmsDataKindForIdentifier(id);
  if (!kind) return;

  const fields = await findCodeFields(id);
  if (!fields.length) {
    console.info(`[fms-kor] ${id} — 코드 변환 대상 컬럼 없음`);
    return;
  }

  const tables =
    kind === 'facility' ? FMS_FACILITY_TABLE_NAMES : FMS_INSPECTION_TABLE_NAMES;
  const includeAddrFull = kind === 'facility';

  for (const tableName of tables) {
    const exists = await db.execute(
      sql.raw(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema='layer' AND table_name='${tableName}' LIMIT 1`
      )
    );
    if (!(exists.rows?.length ?? 0)) continue;

    const setClause = buildSetClause(fields, includeAddrFull);
    const sqlText = `UPDATE layer.${tableName} AS target SET ${setClause}`;
    await db.execute(sql.raw(sqlText));
    console.info(`[fms-kor] ${id} → layer.${tableName}`);
  }
}
