import { Home, Monitor, MessagesSquare, ClipboardList } from 'lucide-react'
import type {
  AdminConsoleMenuGroup,
  AdminConsoleMenuItem,
} from '@/app/(pages)/_components/AdminConsoleLayout'

export const ODOR_INDEX_MENUS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'controlMap', label: '관제 지도' },
  { id: 'alertList', label: '경보 목록' },
  { id: 'complaintManage', label: '민원 관리' },
  { id: 'actionHistory', label: '조치 내역' },
  { id: 'reportView', label: '보고서 조회' },
  { id: 'systemStatus', label: '시스템 상태•통신' },
] as const satisfies readonly AdminConsoleMenuItem[]

export type OdorIndexMenuId = (typeof ODOR_INDEX_MENUS)[number]['id']

/** 홈은 대분류 없이 단독 표시 (ungroupedMenuIds) */
export const ODOR_INDEX_UNGROUPED_MENU_IDS = ['home'] as const

export const ODOR_INDEX_MENU_GROUPS: readonly AdminConsoleMenuGroup[] = [
  {
    id: 'monitoring',
    label: '모니터링',
    icon: Monitor,
    menuIds: ['controlMap', 'alertList'],
  },
  {
    id: 'complaintHistory',
    label: '민원 이력',
    icon: MessagesSquare,
    menuIds: ['complaintManage', 'actionHistory'],
  },
  {
    id: 'reportInspect',
    label: '보고서•점검',
    icon: ClipboardList,
    menuIds: ['reportView', 'systemStatus'],
  },
]

export function getOdorIndexMenuDescription(menuId: string): string {
  switch (menuId as OdorIndexMenuId) {
    case 'home':
      return '하수악취 통합 현황 대시보드'
    case 'controlMap':
      return '관제 지도로 이동해 센서·경계·경보를 확인합니다'
    case 'alertList':
      return '악취·장애 경보를 목록으로 보고 인지(해제)합니다'
    case 'complaintManage':
      return '악취 관련 민원을 조회·관리합니다 (목업)'
    case 'actionHistory':
      return '민원·경보에 대한 조치 내역을 봅니다 (목업)'
    case 'reportView':
      return '운영 보고서를 조회합니다 (목업)'
    case 'systemStatus':
      return '시스템 상태와 통신 현황을 확인합니다 (목업)'
    default:
      return ''
  }
}
