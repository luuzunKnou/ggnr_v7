'use client'

import { useState } from 'react'
import { OdorAlertListPanel } from '@/app/(pages)/map/_mapContents/odorAlert/OdorAlertListPanel'
import { OdorAlertHistoryPanel } from '@/app/(pages)/map/_mapContents/odorAlert/OdorAlertHistoryPanel'
import { useOdorAlertStore } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertStore'
import { withBasePath } from '@/lib/basePath'

/** Index 콘솔용 경보 목록 — 지도 패널과 동일 목업 스토어 */
export function OdorIndexAlertContent() {
  const { history } = useOdorAlertStore()
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-border">
        <OdorAlertListPanel
          historyOpen={historyOpen}
          onOpenHistory={() => setHistoryOpen((v) => !v)}
          onClose={() => {
            try {
              window.localStorage.setItem('odorIndexConsole:selectedMenu', 'home')
            } catch {
              /* ignore */
            }
            window.location.assign(withBasePath('/'))
          }}
        />
      </div>
      {historyOpen && (
        <div className="flex w-[min(100%,360px)] shrink-0 flex-col overflow-hidden rounded border border-border">
          <OdorAlertHistoryPanel rows={history} onClose={() => setHistoryOpen(false)} />
        </div>
      )}
    </div>
  )
}
