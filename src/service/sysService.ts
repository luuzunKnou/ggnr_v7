/**
 * Sys Service - sys 테이블(커스텀 시스템) CRUD
 */
import { db } from '@/database/db';
import { sys } from '@/database/schema/sys';
import { asc, eq } from 'drizzle-orm';

/** DB 행을 목록용 공통 형태로 변환 (snake_case, serviceList/layerList 빈 배열) */
function rowToSystemItem(row: {
  sysKey: number;
  sysKor: string | null;
  sysEng: string | null;
  sysImg: string | null;
  sysIdx: number | null;
  sysCol: string | null;
  sysLink: string | null;
  sysDetail: string | null;
}) {
  return {
    sys_key: String(row.sysKey),
    sys_kor: row.sysKor ?? '',
    sys_eng: row.sysEng ?? '',
    sys_detail: row.sysDetail ?? '',
    sys_img: row.sysImg ?? '',
    sys_idx: row.sysIdx ?? 0,
    sys_col: row.sysCol ?? '',
    sys_link: row.sysLink ?? '',
    serviceList: [] as string[],
    layerList: [] as string[],
  };
}

/**
 * sys 테이블에서 모든 커스텀 시스템 목록 조회
 */
export async function getCustomSystems(_params?: unknown) {
  try {
    const rows = await db
      .select()
      .from(sys)
      .orderBy(asc(sys.sysIdx), asc(sys.sysKey));
    const data = rows.map(rowToSystemItem);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch systems', data: [] };
  }
}

/** 레거시: getAllSystems → getCustomSystems와 동일 */
export async function getAllSystems(params?: unknown) {
  return getCustomSystems(params);
}

/** varchar 컬럼용: 문자열 또는 null (숫자 등이 넘어와도 문자열로 변환) */
function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}
/** integer 컬럼용: 숫자 또는 null */
function intOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * 커스텀 시스템 추가 (sys 테이블 insert)
 */
export async function createSystem(params: {
  sys_kor?: string;
  sys_eng?: string;
  sys_img?: string;
  sys_idx?: number;
  sys_col?: string;
  sys_link?: string;
  sys_detail?: string;
}) {
  try {
    const [inserted] = await db
      .insert(sys)
      .values({
        sysKor: strOrNull(params.sys_kor),
        sysEng: strOrNull(params.sys_eng),
        sysImg: strOrNull(params.sys_img),
        sysIdx: intOrNull(params.sys_idx),
        sysCol: strOrNull(params.sys_col),
        sysLink: strOrNull(params.sys_link),
        sysDetail: strOrNull(params.sys_detail),
      })
      .returning();
    if (!inserted) throw new Error('Insert failed');
    return { success: true, data: rowToSystemItem(inserted) };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create system' };
  }
}

/**
 * 커스텀 시스템 수정 (sys 테이블 update, sys_key는 PK 숫자)
 */
export async function updateSystem(params: {
  sys_key: string; // PK (숫자 문자열)
  sys_kor?: string;
  sys_eng?: string;
  sys_img?: string;
  sys_idx?: number;
  sys_col?: string;
  sys_link?: string;
  sys_detail?: string;
}) {
  const id = Number(params.sys_key);
  if (Number.isNaN(id)) return { success: false, error: 'Invalid sys_key' };
  try {
    const [updated] = await db
      .update(sys)
      .set({
        ...(params.sys_kor !== undefined && { sysKor: strOrNull(params.sys_kor) }),
        ...(params.sys_eng !== undefined && { sysEng: strOrNull(params.sys_eng) }),
        ...(params.sys_img !== undefined && { sysImg: strOrNull(params.sys_img) }),
        ...(params.sys_idx !== undefined && { sysIdx: intOrNull(params.sys_idx) }),
        ...(params.sys_col !== undefined && { sysCol: strOrNull(params.sys_col) }),
        ...(params.sys_link !== undefined && { sysLink: strOrNull(params.sys_link) }),
        ...(params.sys_detail !== undefined && { sysDetail: strOrNull(params.sys_detail) }),
      })
      .where(eq(sys.sysKey, id))
      .returning();
    if (!updated) return { success: false, error: 'Not found' };
    return { success: true, data: rowToSystemItem(updated) };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update system' };
  }
}

/**
 * 커스텀 시스템 삭제 (sys 테이블 delete)
 */
export async function deleteSystem(params: { sys_key: string }) {
  const id = Number(params.sys_key);
  if (Number.isNaN(id)) return { success: false, error: 'Invalid sys_key' };
  try {
    const result = await db.delete(sys).where(eq(sys.sysKey, id)).returning({ sysKey: sys.sysKey });
    if (result.length === 0) return { success: false, error: 'Not found' };
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete system' };
  }
}
