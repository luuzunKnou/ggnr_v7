/**
 * 클라이언트 전용 접근 판별 (DB 미사용). 서버 loadUserAccess 스냅샷과 조합해 사용.
 */

import { SERP_TYPE_LIST } from '@/database/schema/serp_map';

export type ClientAccessSnapshot = {
  privateSerLevel: Record<string, number>;
  privateSysKeys: string[];
};

export function canAccessPrivateSystem(
  snap: ClientAccessSnapshot,
  sysKey: string,
  sysIsPrivate: boolean | null | undefined
): boolean {
  if (sysIsPrivate !== true) return true;
  return snap.privateSysKeys.includes(String(sysKey).trim());
}

/** 사이드바 서비스: 공개면 항상 열림. 비공개면 단계별 */
export type SidebarSerPolicy = 'open' | 'hidden' | 'block';

export function sidebarServicePolicy(
  snap: ClientAccessSnapshot,
  serEng: string,
  configSerIsPrivate: boolean
): SidebarSerPolicy {
  const eng = serEng.trim();
  if (configSerIsPrivate !== true) return 'open';
  const level = snap.privateSerLevel[eng];
  const eff = level ?? 0;
  if (eff <= 0) return 'hidden';
  if (eff === SERP_TYPE_LIST) return 'block';
  return 'open';
}

export { SERP_TYPE_LIST };
