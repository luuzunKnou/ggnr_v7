'use client'

import { useState } from 'react'
import { OdorAlertListPanel } from '@/app/(pages)/map/_mapContents/odorAlert/OdorAlertListPanel'
import { OdorAlertHistoryPanel } from '@/app/(pages)/map/_mapContents/odorAlert/OdorAlertHistoryPanel'
import { useOdorAlertStore } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertStore'

type Props = {
  /** 닫기 시 홈 등으로 이동 */
  onClose?: () => void
}

/**
 * 경보보기2 — 지도 «경보 보기»와 동일 목업(목록·인지·이력).
 * 기존 Index «경보 목록» 초안 UI를 별도 메뉴로 유지.
 */
export function OdorIndexAlertView2Content({ onClose }: Props) {
  const { history } = useOdorAlertStore()
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          <OdorAlertListPanel
            onClose={() => onClose?.()}
            historyOpen={historyOpen}
            onOpenHistory={() => setHistoryOpen((v) => !v)}
            showAgencyFilter
          />
        </div>
        {historyOpen ? (
          <div className="flex min-h-0 w-[min(100%,360px)] shrink-0 flex-col overflow-hidden rounded-md border border-border">
            <OdorAlertHistoryPanel rows={history} onClose={() => setHistoryOpen(false)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
