/**
 * Ser Service - ser 테이블(커스텀 기능) CRUD
 */
import { db } from '@/database/db';
import { ser } from '@/database/schema/ser';
import { asc, eq } from 'drizzle-orm';

export type SerItem = {
  ser_menu: string | null;
  ser_cat: string | null;
  ser_kor: string | null;
  ser_eng: string | null;
  ser_type: string | null;
  ser_work_type: string | null;
  ser_is_private: boolean | null;
  ser_has_contents: boolean | null;
  ser_has_file: boolean | null;
  ser_data_table: string | null;
  ser_data_query: string | null;
  ser_idx: number | null;
  ser_url: string | null;
  ser_is_del: boolean | null;
};

/** DB 행을 목록용 공통 형태로 변환 (snake_case) */
function rowToSerItem(row: {
  serEng: string;
  serMenu: string | null;
  serCat: string | null;
  serKor: string | null;
  serType: string | null;
  serWorkType: string | null;
  serIsPrivate: boolean | null;
  serHasContents: boolean | null;
  serHasFile: boolean | null;
  serDataTable: string | null;
  serDataQuery: string | null;
  serIdx: number | null;
  serUrl: string | null;
  serIsDel: boolean | null;
}): SerItem {
  return {
    ser_menu: row.serMenu,
    ser_cat: row.serCat,
    ser_kor: row.serKor,
    ser_eng: row.serEng ?? null,
    ser_type: row.serType,
    ser_work_type: row.serWorkType,
    ser_is_private: row.serIsPrivate,
    ser_has_contents: row.serHasContents,
    ser_has_file: row.serHasFile,
    ser_data_table: row.serDataTable,
    ser_data_query: row.serDataQuery,
    ser_idx: row.serIdx,
    ser_url: row.serUrl,
    ser_is_del: row.serIsDel,
  };
}

/**
 * ser 테이블에서 모든 커스텀 기능 목록 조회
 */
export async function getCustomSerList(_params?: unknown) {
  try {
    const rows = await db
      .select()
      .from(ser)
      .orderBy(asc(ser.serIdx), asc(ser.serEng));
    const data = rows.map(rowToSerItem);
    return { success: true, data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch ser list';
    return { success: false, error: message, data: [] };
  }
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}
function intOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function boolOrNull(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return Boolean(v);
}

/**
 * 커스텀 기능 추가 (ser 테이블 insert)
 */
export async function createSer(params: {
  ser_menu?: string | null;
  ser_cat?: string | null;
  ser_kor?: string | null;
  ser_eng?: string | null;
  ser_type?: string | null;
  ser_work_type?: string | null;
  ser_is_private?: boolean | null;
  ser_has_contents?: boolean | null;
  ser_has_file?: boolean | null;
  ser_data_table?: string | null;
  ser_data_query?: string | null;
  ser_idx?: number | null;
  ser_url?: string | null;
  ser_is_del?: boolean | null;
}) {
  const eng = strOrNull(params.ser_eng);
  if (!eng || !eng.trim()) {
    return { success: false, error: 'ser_eng is required (PK)' };
  }
  try {
    const [inserted] = await db
      .insert(ser)
      .values({
        serEng: eng,
        serMenu: strOrNull(params.ser_menu),
        serCat: strOrNull(params.ser_cat),
        serKor: strOrNull(params.ser_kor),
        serType: strOrNull(params.ser_type),
        serWorkType: strOrNull(params.ser_work_type),
        serIsPrivate: boolOrNull(params.ser_is_private),
        serHasContents: boolOrNull(params.ser_has_contents),
        serHasFile: boolOrNull(params.ser_has_file),
        serDataTable: strOrNull(params.ser_data_table),
        serDataQuery: strOrNull(params.ser_data_query),
        serIdx: intOrNull(params.ser_idx),
        serUrl: strOrNull(params.ser_url),
        serIsDel: boolOrNull(params.ser_is_del),
      })
      .returning();
    if (!inserted) throw new Error('Insert failed');
    return { success: true, data: rowToSerItem(inserted) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create ser';
    return { success: false, error: message };
  }
}

/**
 * 커스텀 기능 수정 (ser 테이블 update, ser_eng가 PK)
 */
export async function updateSer(params: {
  ser_eng: string;
  ser_menu?: string | null;
  ser_cat?: string | null;
  ser_kor?: string | null;
  ser_eng_new?: string | null;
  ser_type?: string | null;
  ser_work_type?: string | null;
  ser_is_private?: boolean | null;
  ser_has_contents?: boolean | null;
  ser_has_file?: boolean | null;
  ser_data_table?: string | null;
  ser_data_query?: string | null;
  ser_idx?: number | null;
  ser_url?: string | null;
  ser_is_del?: boolean | null;
}) {
  const id = params.ser_eng;
  if (typeof id !== 'string' || !id.trim()) {
    return { success: false, error: 'Invalid ser_eng' };
  }
  try {
    const [updated] = await db
      .update(ser)
      .set({
        ...(params.ser_menu !== undefined && { serMenu: strOrNull(params.ser_menu) }),
        ...(params.ser_cat !== undefined && { serCat: strOrNull(params.ser_cat) }),
        ...(params.ser_kor !== undefined && { serKor: strOrNull(params.ser_kor) }),
        ...(params.ser_eng_new !== undefined && params.ser_eng_new !== id && { serEng: strOrNull(params.ser_eng_new) ?? id }),
        ...(params.ser_type !== undefined && { serType: strOrNull(params.ser_type) }),
        ...(params.ser_work_type !== undefined && { serWorkType: strOrNull(params.ser_work_type) }),
        ...(params.ser_is_private !== undefined && { serIsPrivate: boolOrNull(params.ser_is_private) }),
        ...(params.ser_has_contents !== undefined && { serHasContents: boolOrNull(params.ser_has_contents) }),
        ...(params.ser_has_file !== undefined && { serHasFile: boolOrNull(params.ser_has_file) }),
        ...(params.ser_data_table !== undefined && { serDataTable: strOrNull(params.ser_data_table) }),
        ...(params.ser_data_query !== undefined && { serDataQuery: strOrNull(params.ser_data_query) }),
        ...(params.ser_idx !== undefined && { serIdx: intOrNull(params.ser_idx) }),
        ...(params.ser_url !== undefined && { serUrl: strOrNull(params.ser_url) }),
        ...(params.ser_is_del !== undefined && { serIsDel: boolOrNull(params.ser_is_del) }),
      })
      .where(eq(ser.serEng, id))
      .returning();
    if (!updated) return { success: false, error: 'Not found' };
    return { success: true, data: rowToSerItem(updated) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update ser';
    return { success: false, error: message };
  }
}

/**
 * 커스텀 기능 삭제 (ser 테이블 delete)
 */
export async function deleteSer(params: { ser_eng: string }) {
  const id = params.ser_eng;
  if (typeof id !== 'string' || !id.trim()) {
    return { success: false, error: 'Invalid ser_eng' };
  }
  try {
    const result = await db.delete(ser).where(eq(ser.serEng, id)).returning({ serEng: ser.serEng });
    if (result.length === 0) return { success: false, error: 'Not found' };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete ser';
    return { success: false, error: message };
  }
}
