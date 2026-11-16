'use client'

import { useState } from 'react'
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

type Props = {
  title: string
  sensors: OdorSensorListItem[]
  footerAddr: string
  footerRss: string
}

export function OdorIndexConsole({ title, sensors, footerAddr, footerRss }: Props) {
  const [selectMenuSignal, setSelectMenuSignal] = useState<{ menuId: string; nonce: number } | null>(
    null
  )

  const goMenu = (menuId: OdorIndexMenuId) => {
    setSelectMenuSignal((prev) => ({ menuId, nonce: (prev?.nonce ?? 0) + 1 }))
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
            <OdorSidebarUserAccount collapsed={collapsed} />
          )}
          renderContent={(menuId) => {
            const id = menuId as OdorIndexMenuId
            switch (id) {
              case 'home':
                return <IndexPageOdorPh sensors={sensors} onGoMenu={goMenu} />
              case 'controlMap':
                return <OdorIndexControlMapContent />
              case 'alertList':
                return <OdorIndexAlertContent />
              case 'complaintManage':
                return (
                  <OdorIndexPlaceholderPanel
                    title="민원 관리"
                    description="악취 관련 민원 접수·처리 현황을 관리하는 화면입니다."
                  />
                )
              case 'actionHistory':
                return (
                  <OdorIndexPlaceholderPanel
                    title="조치 내역"
                    description="민원·경보에 대한 현장 조치·처리 이력을 조회합니다."
                  />
                )
              case 'reportView':
                return (
                  <OdorIndexPlaceholderPanel
                    title="보고서 조회"
                    description="운영·점검 보고서를 조회하고 내려받습니다."
                  />
                )
              case 'systemStatus':
                return (
                  <OdorIndexPlaceholderPanel
                    title="시스템 상태•통신"
                    description="서버·센서 통신 상태와 시스템 가동 현황을 확인합니다."
                  />
                )
              default:
                return null
            }
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
