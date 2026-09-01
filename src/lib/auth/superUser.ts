/** 슈퍼계정 — DB 권한과 무관하게 전체 허용. 클라이언트·서버 공용(DB import 금지). */
export const SUPER_USER_IDS = ['su', 'admin'] as const;

export type SuperUserId = (typeof SUPER_USER_IDS)[number];

export function isSuperUser(usrId: string | null | undefined): boolean {
  const id = String(usrId ?? '').trim();
  return (SUPER_USER_IDS as readonly string[]).includes(id);
}
