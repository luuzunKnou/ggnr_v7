import {
  SERP_TYPE_LIST,
  SERP_TYPE_READ,
  SERP_TYPE_WRITE,
} from '@/database/schema/serp_map';
import { consolePermEng } from './registry';
import type { ConsoleAreaId, ConsoleMenuLevelSnapshot, ConsoleMenuPolicy } from './types';

export function resolveConsoleMenuPolicy(level: number | null | undefined): ConsoleMenuPolicy {
  const eff = level ?? 0;
  if (eff <= 0) return 'hidden';
  if (eff === SERP_TYPE_LIST) return 'block';
  if (eff === SERP_TYPE_READ) return 'read';
  return 'write';
}

export function getConsoleMenuLevel(
  snapshot: ConsoleMenuLevelSnapshot,
  area: ConsoleAreaId,
  menuId: string
): number {
  return snapshot[consolePermEng(area, menuId)] ?? 0;
}

export function getConsoleMenuPolicy(
  snapshot: ConsoleMenuLevelSnapshot,
  area: ConsoleAreaId,
  menuId: string
): ConsoleMenuPolicy {
  return resolveConsoleMenuPolicy(getConsoleMenuLevel(snapshot, area, menuId));
}

export function canConsoleMenuRead(policy: ConsoleMenuPolicy): boolean {
  return policy === 'read' || policy === 'write';
}

export function canConsoleMenuWrite(policy: ConsoleMenuPolicy): boolean {
  return policy === 'write';
}

/** 개발자 모드 콘솔 메뉴 중 하나라도 접근 가능하면 true */
export function hasAnyDevConsoleAccess(snapshot: ConsoleMenuLevelSnapshot): boolean {
  for (const [permEng, level] of Object.entries(snapshot)) {
    if (!permEng.startsWith('console:dev:')) continue;
    if ((level ?? 0) > 0) return true;
  }
  return false;
}

export { SERP_TYPE_LIST, SERP_TYPE_READ, SERP_TYPE_WRITE };
