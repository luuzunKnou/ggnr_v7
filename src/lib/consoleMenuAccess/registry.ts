import {
  SERP_TYPE_LIST,
  SERP_TYPE_READ,
  SERP_TYPE_WRITE,
} from '@/database/schema/serp_map';
import { DEV_CONSOLE_MENUS } from './menus/dev';
import { SYS_MANAGER_CONSOLE_MENUS } from './menus/sysManager';
import type { ConsoleAreaDef, ConsoleAreaId } from './types';

export const CONSOLE_PERM_ENG_PREFIX = 'console:';

/** 영역별 콘솔 메뉴 정의 (공지·자료실은 추후 menus 추가) */
export const CONSOLE_MENU_AREAS: Record<ConsoleAreaId, ConsoleAreaDef> = {
  dev: { label: '개발자 모드', menus: DEV_CONSOLE_MENUS },
  sysManager: { label: '시스템 관리', menus: SYS_MANAGER_CONSOLE_MENUS },
  notice: { label: '공지사항', menus: [] },
  library: { label: '자료실', menus: [] },
};

export function consolePermEng(area: ConsoleAreaId, menuId: string): string {
  return `${CONSOLE_PERM_ENG_PREFIX}${area}:${menuId}`;
}

export function parseConsolePermEng(permEng: string): { area: ConsoleAreaId; menuId: string } | null {
  if (!permEng.startsWith(CONSOLE_PERM_ENG_PREFIX)) return null;
  const rest = permEng.slice(CONSOLE_PERM_ENG_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  const area = rest.slice(0, idx) as ConsoleAreaId;
  const menuId = rest.slice(idx + 1);
  if (!area || !menuId || !(area in CONSOLE_MENU_AREAS)) return null;
  return { area, menuId };
}

export function isConsolePermEng(permEng: string): boolean {
  return permEng.startsWith(CONSOLE_PERM_ENG_PREFIX);
}

export function getAllConsolePermEngs(): string[] {
  const out: string[] = [];
  for (const [area, def] of Object.entries(CONSOLE_MENU_AREAS) as [ConsoleAreaId, ConsoleAreaDef][]) {
    for (const m of def.menus) {
      out.push(consolePermEng(area, m.id));
    }
  }
  return out;
}

export function getConsoleMenuLabel(area: ConsoleAreaId, menuId: string): string {
  const m = CONSOLE_MENU_AREAS[area]?.menus.find((row) => row.id === menuId);
  return m?.label ?? menuId;
}

export function listConsoleMenuCatalog(): {
  area: ConsoleAreaId;
  areaLabel: string;
  menuId: string;
  menuLabel: string;
  permEng: string;
}[] {
  const rows: ReturnType<typeof listConsoleMenuCatalog> = [];
  for (const [area, def] of Object.entries(CONSOLE_MENU_AREAS) as [ConsoleAreaId, ConsoleAreaDef][]) {
    for (const m of def.menus) {
      rows.push({
        area,
        areaLabel: def.label,
        menuId: m.id,
        menuLabel: m.label,
        permEng: consolePermEng(area, m.id),
      });
    }
  }
  return rows;
}

export { SERP_TYPE_LIST, SERP_TYPE_READ, SERP_TYPE_WRITE };
