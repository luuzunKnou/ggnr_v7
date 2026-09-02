import type { ConsoleMenuDef } from '../types';

/** 시스템 관리(관리자모드) 서브메뉴 — 캡쳐 목록 기준 */
export const SYS_MANAGER_CONSOLE_MENUS = [
  { id: 'signUpApprove', label: '사용자 가입 승인' },
  { id: 'userManager', label: '사용자관리' },
  { id: 'permissionFeature', label: '권한관리' },
  { id: 'accessRequestQueue', label: '권한 신청 처리' },
  { id: 'layerManager', label: '레이어 관리' },
  { id: 'dataHistoryManager', label: '데이터 이력관리' },
  { id: 'featureUsageStats', label: '기능별 사용현황' },
  { id: 'userAccessStats', label: '사용자 접속현황' },
  { id: 'userMgmtHistory', label: '사용자 관리 이력' },
  { id: 'userPermHistory', label: '사용자 권한 관리 이력' },
] as const satisfies readonly ConsoleMenuDef[];

export type SysManagerConsoleMenuId = (typeof SYS_MANAGER_CONSOLE_MENUS)[number]['id'];
