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

export { SERP_TYPE_LIST, SERP_TYPE_READ, SERP_TYPE_WRITE };
