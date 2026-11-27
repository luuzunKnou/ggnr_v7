'use client'

import { X } from 'lucide-react'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  odorAlertBtnGhost,
  type OdorAlertGrade,
} from './odorAlertConfig'
import { formatOdorAlertTime, type OdorAckHistoryRow } from './odorAlertMock'

type Props = {
  rows: OdorAckHistoryRow[]
  onClose: () => void
}

export function OdorAlertHistoryPanel({ rows, onClose }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">확인(해제) 이력</h3>
          <p className="text-[10px] text-muted-foreground">누가·언제·단건/일괄·사유</p>
        </div>
        <button type="button" className={odorAlertBtnGhost} title="닫기" onClick={onClose}>
          <X className="h-3.5 w-3.5" aria-hidden />
          닫기
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <li className="py-8 text-center text-xs text-muted-foreground">이력이 없습니다.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px]"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-foreground">{row.sensorLabel}</span>
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {ODOR_ALERT_KIND_LABEL[row.kind]}
                </span>
                {row.grade != null && (
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {ODOR_ALERT_GRADE_LABEL[row.grade as OdorAlertGrade]}
                  </span>
                )}
                <span
                  className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                    row.mode === 'bulk'
                      ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                      : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                  }`}
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
  )
}
