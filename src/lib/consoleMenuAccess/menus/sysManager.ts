import type { ConsoleMenuDef } from '../types';

export const SYS_MANAGER_CONSOLE_MENUS = [
  { id: 'userManager', label: '사용자관리' },
  { id: 'permissionFeature', label: '권한관리' },
  { id: 'accessRequestQueue', label: '권한신청 처리' },
  { id: 'uploadHistory', label: '데이터 업로드 이력' },
  { id: 'dataAccessLog', label: '데이터 접근기록' },
  { id: 'userMgmtHistory', label: '사용자 관리 이력' },
  { id: 'userAccessStats', label: '사용자 접속 통계' },
  { id: 'featureUsageStats', label: '기능별 사용현황 통계' },
] as const satisfies readonly ConsoleMenuDef[];

export type SysManagerConsoleMenuId = (typeof SYS_MANAGER_CONSOLE_MENUS)[number]['id'];
