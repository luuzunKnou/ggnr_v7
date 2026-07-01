import { userHasSerAccess } from '@/lib/auth/guard';

/** file_data/notice, file_data/board — 게시판 첨부 */
export const BOARD_FILE_SER_ENG = new Set(['notice', 'board']);

export function isBoardFileSerEng(serEng: string): boolean {
  return BOARD_FILE_SER_ENG.has(serEng.trim());
}

/** 공지·자료실: 읽기 공개, 쓰기(업로드·삭제)는 로그인 필요 */
export async function userCanAccessServiceFileData(
  usrId: string | null,
  serEng: string,
  need: 'read' | 'write'
): Promise<boolean> {
  const ser = serEng.trim();
  if (isBoardFileSerEng(ser)) {
    if (need === 'read') return true;
    return !!usrId;
  }
  if (!usrId) return false;
  return userHasSerAccess(usrId, ser, need);
}
