'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { AdminConsoleLayout } from '@/app/(pages)/_components/AdminConsoleLayout'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { IndexPageOdorPh } from '@/app/(pages)/(index)/odorPh/IndexPageOdorPh'
import { OdorIndexAlertContent } from '@/app/(pages)/(index)/odorPh/OdorIndexAlertContent'
import { OdorIndexControlMapContent } from '@/app/(pages)/(index)/odorPh/OdorIndexControlMapContent'
import { OdorIndexPlaceholderPanel } from '@/app/(pages)/(index)/odorPh/OdorIndexPlaceholderPanel'
import {
  ODOR_INDEX_MENUS,
  ODOR_INDEX_MENU_GROUPS,
  ODOR_INDEX_UNGROUPED_MENU_IDS,
  getOdorIndexMenuDescription,
  type OdorIndexMenuId,
} from '@/app/(pages)/(index)/odorPh/odorIndexMenus'
import { DevModeFooterTrigger } from '@/app/(pages)/(index)/dev-mode-footer-trigger'
import { OdorSidebarUserAccount } from '@/app/(pages)/(index)/odorPh/OdorSidebarUserAccount'
import { seedOdorIndexAlertNotifs } from '@/app/(pages)/(index)/odorPh/odorIndexAlertNotifSeed'

type Props = {
  title: string
  sensors: OdorSensorListItem[]
  footerAddr: string
  footerRss: string
  /** 서버 조회 기준 시각 (ISO). 없으면 클라이언트 마운트 시각 */
  queriedAt?: string
}

function formatQueryBaseTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

export function OdorIndexConsole({ title, sensors, footerAddr, footerRss, queriedAt }: Props) {
  const router = useRouter()
  const [selectMenuSignal, setSelectMenuSignal] = useState<{ menuId: string; nonce: number } | null>(
    null
  )
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    seedOdorIndexAlertNotifs()
  }, [])

  const goMenu = (menuId: OdorIndexMenuId) => {
    setSelectMenuSignal((prev) => ({ menuId, nonce: (prev?.nonce ?? 0) + 1 }))
  }

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    router.refresh()
    window.setTimeout(() => setRefreshing(false), 600)
  }

  return (
    <div className="flex h-svh max-h-svh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <AdminConsoleLayout
          className="h-full min-h-0"
          title={title}
          menus={ODOR_INDEX_MENUS}
          menuGroups={ODOR_INDEX_MENU_GROUPS}
          ungroupedMenuIds={ODOR_INDEX_UNGROUPED_MENU_IDS}
          defaultExpandAllGroups
          sidebarTogglePlacement="top"
          contentChrome="plain"
          stateStorageKey="odorIndexConsole"
          defaultMenuId="home"
          getDescription={getOdorIndexMenuDescription}
          selectMenuSignal={selectMenuSignal}
          renderSidebarBottom={({ collapsed }) => (
            <OdorSidebarUserAccount
              collapsed={collapsed}
              onOpenAlertNotif={() => goMenu('alertList')}
            />
          )}
          renderContent={(menuId) => {
            const id = menuId as OdorIndexMenuId
            let body: ReactNode = null
            switch (id) {
              case 'home':
                body = <IndexPageOdorPh sensors={sensors} onGoMenu={goMenu} />
                break
              case 'controlMap':
                body = <OdorIndexControlMapContent />
                break
              case 'alertList':
                body = <OdorIndexAlertContent />
                break
              case 'complaintManage':
                body = (
                  <OdorIndexPlaceholderPanel
                    title="민원 관리"
                    description="악취 관련 민원 접수·처리 현황을 관리하는 화면입니다."
                  />
                )
                break
              case 'actionHistory':
                body = (
                  <OdorIndexPlaceholderPanel
                    title="조치 내역"
                    description="민원·경보에 대한 현장 조치·처리 이력을 조회합니다."
                  />
                )
                break
              case 'reportView':
                body = (
                  <OdorIndexPlaceholderPanel
                    title="보고서 조회"
                    description="운영·점검 보고서를 조회하고 내려받습니다."
                  />
                )
                break
              case 'systemStatus':
                body = (
                  <OdorIndexPlaceholderPanel
                    title="시스템 상태•통신"
                    description="서버·센서 통신 상태와 시스템 가동 현황을 확인합니다."
                  />
                )
                break
              default:
                body = null
            }
            return (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                <div className="mb-1.5 flex shrink-0 items-center justify-end gap-1.5">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    조회 기준 시간: {formatQueryBaseTime(queriedAt)}
                  </p>
                  <button
                    type="button"
                    title="새로고침"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                      aria-hidden
                    />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
              </div>
            )
          }}
        />
      </div>
      <DevModeFooterTrigger className="mt-0 shrink-0 border-t border-slate-700 py-1.5">
        <div className="container mx-auto px-2 text-center text-[11px] leading-tight">
          <p className="text-slate-300">{footerAddr}</p>
          <p className="text-slate-400">{footerRss}</p>
        </div>
      </DevModeFooterTrigger>
    </div>
  )
}
