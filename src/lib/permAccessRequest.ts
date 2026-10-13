/** 권한 신청 승인 시 자동 생성 권한의 비고 — 공통(역할) 권한과 구분 */

export const ACCESS_REQUEST_PERM_ETC = '권한신청 승인으로 자동 생성';

export function isAccessRequestPermEtc(permEtc: string | null | undefined): boolean {
  return String(permEtc ?? '').trim() === ACCESS_REQUEST_PERM_ETC;
}
