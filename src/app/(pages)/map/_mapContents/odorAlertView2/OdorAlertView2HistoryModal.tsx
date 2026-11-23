'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { MapDetailFloatingPanel } from '../../_mapComponents/MapDetailFloatingPanel'
import { useSearchBarOffset } from '../../searchBarOffsetContext'
import { cn } from '@/lib/utils'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  type OdorAlertGrade,
} from '../odorAlert/odorAlertConfig'
import { formatOdorAlertTime, type OdorAckHistoryRow } from '../odorAlert/odorAlertMock'
import { useOdorAlertStore } from '../odorAlert/odorAlertStore'

type Props = {
  open: boolean
  leftPx: number
  onClose: () => void
}

const PANEL_WIDTH = 'min(400px, calc(100vw - 2rem))'
const PANEL_MAX_HEIGHT = 'min(640px, 70vh)'
const LEFT_GAP = 8

/**
 * 경보목록2 — 해제(인지) 이력 플로팅 모달 (기존 View2 플로팅 UI 유지, P21-07)
 */
export function OdorAlertView2HistoryModal({ open, leftPx, onClose }: Props) {
  const { topPx: addressTopPx } = useSearchBarOffset()
  const { history } = useOdorAlertStore()
  const [keyword, setKeyword] = useState('')
  const [minimized, setMinimized] = useState(false)

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return history
    return history.filter((r) =>
      [r.at, r.actor, r.sensorLabel, r.reason, r.mode, ODOR_ALERT_KIND_LABEL[r.kind]]
        .join(' ')
        .toLowerCase()
        .includes(kw)
    )
  }, [history, keyword])

  if (!open) return null

  const top = addressTopPx
  const left = Math.max(8, leftPx + LEFT_GAP)

  return (
    <MapDetailFloatingPanel
      layer="경보목록2"
      title="해제(인지) 이력"
      onClose={onClose}
      minimized={minimized}
      onMinimizedChange={setMinimized}
      width={PANEL_WIDTH}
      maxHeight={PANEL_MAX_HEIGHT}
      defaultPosition={{ top, left }}
      variant="default"
      zLayer="detailFloating"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <p className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          누가·언제·단건/일괄·사유로 해제했는지 기록합니다
        </p>

        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="standard-search-wrap">
            <Search className="standard-search-icon" aria-hidden />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="센서·사유·사용자 검색"
              title="검색"
              className="standard-search-input"
            />
          </div>
        </div>

        <div className="standard-list-scroll min-h-0 flex-1">
          <ul className="space-y-1.5 p-2">
            {filtered.length === 0 ? (
              <li className="standard-detail-attr-empty">이력이 없습니다.</li>
            ) : (
              filtered.map((row: OdorAckHistoryRow) => (
                <li
                  key={row.id}
                  className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px]"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground">{row.sensorLabel}</span>
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
                  <div className="mt-0.5 text-foreground">사유: {row.reason}</div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="standard-list-footer">
          {filtered.length.toLocaleString()}건
          {keyword.trim() && filtered.length !== history.length
            ? ` / 전체 ${history.length.toLocaleString()}건`
            : ''}
        </div>
      </div>
    </MapDetailFloatingPanel>
  )
}
