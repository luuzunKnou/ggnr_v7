'use client'

import { useState } from 'react'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { OdorAlertDetailPanel } from '@/app/(pages)/(index)/odorPh/OdorAlertDetailPanel'
import { OdorAlertView2ListPanel } from '@/app/(pages)/map/_mapContents/odorAlertView2/OdorAlertView2ListPanel'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  type OdorAlertGrade,
} from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertConfig'
import { formatOdorAlertTime, type OdorAckHistoryRow } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertMock'
import { useOdorAlertStore } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertStore'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  onClose?: () => void
}

/**
 * Index 경보목록2 — 지도와 동일 standard 표 UI + P21 store
 */
export function OdorIndexAlertView2Content({ onClose }: Props) {
  const { history } = useOdorAlertStore()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailAlert, setDetailAlert] = useState<OdorAlertItem | null>(null)
  const [historyKw, setHistoryKw] = useState('')

  const filteredHistory = history.filter((r) => {
    const kw = historyKw.trim().toLowerCase()
    if (!kw) return true
    return [r.at, r.actor, r.sensorLabel, r.reason, r.mode]
      .join(' ')
      .toLowerCase()
      .includes(kw)
  })

  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
        <OdorAlertView2ListPanel
          onClose={() => onClose?.()}
          historyOpen={historyOpen}
          onToggleHistory={() => {
            setHistoryOpen((v) => !v)
            if (!historyOpen) setDetailAlert(null)
          }}
          selectedAlertId={detailAlert?.id ?? null}
          onSelectAlert={(alert) => {
            setDetailAlert(alert)
            setHistoryOpen(false)
          }}
        />
      </div>

      {historyOpen ? (
        <div className="flex min-h-0 w-[min(100%,360px)] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="standard-panel-header">
            <span className="standard-panel-title">해제(인지) 이력</span>
            <button
              type="button"
              title="닫기"
              className="standard-panel-close cursor-pointer"
              onClick={() => setHistoryOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="standard-search-wrap">
              <Search className="standard-search-icon" aria-hidden />
              <input
                type="search"
                value={historyKw}
                onChange={(e) => setHistoryKw(e.target.value)}
                placeholder="센서·사유·사용자 검색"
                title="검색"
                className="standard-search-input"
              />
            </div>
          </div>
          <div className="standard-list-scroll min-h-0 flex-1 p-2">
            <ul className="space-y-1.5">
              {filteredHistory.length === 0 ? (
                <li className="standard-detail-attr-empty">이력이 없습니다.</li>
              ) : (
                filteredHistory.map((row: OdorAckHistoryRow) => (
                  <li
                    key={row.id}
                    className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{row.sensorLabel}</span>
                      <span className="standard-status-badge standard-status-badge-muted">
                        {ODOR_ALERT_KIND_LABEL[row.kind]}
                      </span>
                      {row.grade != null ? (
                        <span className="standard-status-badge standard-status-badge-muted">
                          {ODOR_ALERT_GRADE_LABEL[row.grade as OdorAlertGrade]}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'standard-status-badge',
                          row.mode === 'bulk'
                            ? 'standard-status-badge-primary'
                            : 'standard-status-badge-muted'
                        )}
                      >
                        {row.mode === 'bulk' ? '일괄' : '단건'}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {row.actor} · {formatOdorAlertTime(row.at)}
                    </div>
                    <div className="mt-0.5">사유: {row.reason}</div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {detailAlert && !historyOpen ? (
        <div className="flex min-h-0 w-[min(100%,420px)] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="standard-panel-header">
            <span className="standard-panel-title truncate">{detailAlert.sensorKorNm}</span>
            <button
              type="button"
              title="닫기"
              className="standard-panel-close cursor-pointer"
              onClick={() => setDetailAlert(null)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="standard-detail-scroll">
            <OdorAlertDetailPanel alert={detailAlert} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
