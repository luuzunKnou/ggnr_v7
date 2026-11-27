import { Home, Monitor, MessagesSquare, ClipboardList } from 'lucide-react'
import type {
  AdminConsoleMenuGroup,
  AdminConsoleMenuItem,
} from '@/app/(pages)/_components/AdminConsoleLayout'

export const ODOR_INDEX_MENUS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'liveStatus', label: '실시간 통합 현황' },
  { id: 'controlMap', label: '관제 지도' },
  { id: 'alertList', label: '경보 목록' },
  { id: 'alertView2', label: '경보보기2' },
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
    menuIds: ['liveStatus', 'controlMap', 'alertList', 'alertView2'],
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
    case 'liveStatus':
      return '측정지점·등급·경보·통신을 한 화면에서 보는 실시간 통합 현황입니다'
    case 'controlMap':
      return '콘솔 안에서 센서·경계·주의·심각 지점을 관제합니다'
    case 'alertList':
      return '악취, 장애 경보 목록입니다'
    case 'alertView2':
      return '지도 경보 보기와 동일한 목업 목록·확인·이력입니다'
    case 'complaintManage':
      return '주민 악취 민원 접수·기한·지점 연계를 관리합니다. 조치는 조치내역에서 등록합니다.'
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
