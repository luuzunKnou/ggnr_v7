'use client'

import { useEffect, useState } from 'react'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  odorAlertBtnGhost,
  odorAlertBtnPrimary,
  type OdorAlertGrade,
} from './odorAlertConfig'
import { formatOdorAlertTime } from './odorAlertMock'
import {
  clearOdorAlertPopup,
  pushMockNewOdorAlert,
  useOdorAlertStore,
} from './odorAlertStore'

const LOGIN_POPUP_KEY = 'odor_alert_login_popup_shown'

type Props = {
  /** true면 로그인 시·신규 경보 자동 팝업 활성 */
  enabled: boolean
}

/**
 * P21-06 — 로그인 시·신규 경보 발생 시 경보창 (목업)
 */
export function OdorAlertPopupHost({ enabled }: Props) {
  const { alerts, latestPopupAlertId } = useOdorAlertStore()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'login' | 'new'>('login')

  useEffect(() => {
    if (!enabled) return
    try {
      if (sessionStorage.getItem(LOGIN_POPUP_KEY) === '1') return
      sessionStorage.setItem(LOGIN_POPUP_KEY, '1')
    } catch {
      /* ignore */
    }
    setMode('login')
    setOpen(true)
  }, [enabled])

  useEffect(() => {
    if (!enabled || !latestPopupAlertId) return
    setMode('new')
    setOpen(true)
  }, [enabled, latestPopupAlertId])

  if (!enabled || !open) return null

  const unacked = alerts.filter((a) => !a.acked).slice(0, 5)
  const focus =
    mode === 'new' && latestPopupAlertId
      ? alerts.find((a) => a.id === latestPopupAlertId) ?? null
      : null

  const close = () => {
    setOpen(false)
    clearOdorAlertPopup()
  }

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-[70] w-[min(100vw-2rem,360px)]">
      <div className="rounded-lg border border-border bg-card p-3 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {mode === 'login' ? '미인지 경보 안내' : '신규 경보 발생'}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              {mode === 'login'
                ? '로그인 시 자동으로 표시됩니다. (목업)'
                : '신규 경보가 발생해 자동으로 표시됩니다. (목업)'}
            </p>
          </div>
          <button type="button" className={odorAlertBtnGhost} title="닫기" onClick={close}>
            닫기
          </button>
        </div>

        {focus && (
          <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px]">
            <div className="font-semibold text-foreground">{focus.sensorLabel}</div>
            <div className="text-muted-foreground">
              {ODOR_ALERT_KIND_LABEL[focus.kind]}
              {focus.grade != null ? ` · ${ODOR_ALERT_GRADE_LABEL[focus.grade as OdorAlertGrade]}` : ''}
              {' · '}
              {formatOdorAlertTime(focus.occurredAt)}
            </div>
          </div>
        )}

        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px]">
          {unacked.length === 0 ? (
            <li className="py-2 text-center text-muted-foreground">미인지 경보 없음</li>
          ) : (
            unacked.map((a) => (
              <li key={a.id} className="rounded border border-border/50 bg-muted/20 px-2 py-1">
                <span className="font-medium text-foreground">{a.sensorLabel}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {a.emdNm} · {formatOdorAlertTime(a.occurredAt)}
                </span>
              </li>
            ))
          )}
        </ul>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={odorAlertBtnGhost}
            title="신규 경보 시뮬레이션"
            onClick={() => {
              pushMockNewOdorAlert()
              setMode('new')
              setOpen(true)
            }}
          >
            신규 경보 시뮬
          </button>
          <button type="button" className={odorAlertBtnPrimary} title="확인" onClick={close}>
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
