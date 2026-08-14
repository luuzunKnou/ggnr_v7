/**
 * 레이어 목록 SHP/CSV 다운로드 → 통합 data_log (작업분류: 저장)
 * public_layer 포함.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/database/db';
import { dl } from '@/database/schema/data_log';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';
import { recordDataLog } from './dataLogService';

/** 구분·출처에 저장 — 목록 «구분» 컬럼 / 필터에 노출 */
export const LAYER_LIST_CATEGORY = '레이어 관리(개발자모드)';

/** 세션 id + usr 테이블 → `usrId(usrName)` (이름 없으면 usrId만) */
async function resolveSessionLogUser(): Promise<string | null> {
  const usrId = await getSessionUsrId();
  if (!usrId) return null;
  try {
    const [row] = await db
      .select({ usrName: usr.usrName })
      .from(usr)
      .where(eq(usr.usrId, usrId))
      .limit(1);
    const name = String(row?.usrName ?? '').trim();
    if (name) return `${usrId}(${name})`;
    if (usrId === 'su') return `${usrId}(슈퍼관리자)`;
    return usrId;
  } catch {
    return usrId === 'su' ? `${usrId}(슈퍼관리자)` : usrId;
  }
}

export async function recordLayerDownloadLog(params: {
  tableName: string;
  format: 'SHP' | 'CSV';
  user?: string | null;
}): Promise<{ success: boolean; dlKey?: number; skipped?: boolean; error?: string }> {
  const tableName = String(params.tableName ?? '').trim();
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const format = params.format;
  const user = params.user?.trim() || (await resolveSessionLogUser()) || null;

  const result = await recordDataLog({
    source: LAYER_LIST_CATEGORY,
    type: '저장',
    user,
    serviceName: LAYER_LIST_CATEGORY,
    tableName,
    keyField: '형식',
    keyValue: format,
    contents: `${format} 다운로드`,
    allowPublicLayer: true,
  });

  // recordDataLog 기본값(그룹-레이어)이 남지 않도록 구분·출처를 재확정
  if (result.success && result.dlKey != null) {
    try {
      await db
        .update(dl)
        .set({
          dlServiceName: LAYER_LIST_CATEGORY,
          dlSource: LAYER_LIST_CATEGORY,
        })
        .where(eq(dl.dlKey, result.dlKey));
    } catch (e) {
      console.warn(
        '[recordLayerDownloadLog] category update',
        e instanceof Error ? e.message : e
      );
    }
  }

  return result;
}
