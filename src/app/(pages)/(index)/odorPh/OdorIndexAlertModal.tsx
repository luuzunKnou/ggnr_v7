'use client'

import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { TriangleAlert } from 'lucide-react'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  type OdorAlertGrade,
} from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertConfig'
import { formatOdorAlertTime } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertMock'
import {
  acknowledgeOdorAlerts,
  useOdorAlertStore,
} from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertStore'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onClose: () => void
  onGoAlertList: () => void
}

/** Index 콘솔 — 악취 경보 플로팅 모달 (aside 포함 영역 우측 하단) */
export function OdorIndexAlertModal({ open, onClose, onGoAlertList }: Props) {
  const { data: session } = useSession()
  const { alerts } = useOdorAlertStore()

  const focus = useMemo(() => {
    const unacked = alerts.filter((a) => !a.acked)
    return unacked[0] ?? alerts[0] ?? null
  }, [alerts])

  if (!open) return null

  const actor =
    session?.user?.id === 'su'
      ? '슈퍼관리자'
      : String(session?.user?.name ?? session?.user?.id ?? '').trim() || '게스트'

  const handleAck = () => {
    if (focus && !focus.acked) {
      acknowledgeOdorAlerts({
        alertIds: [focus.id],
        reason: '경보 모달 확인(해제)',
        mode: 'single',
        actor,
      })
    }
    onClose()
  }

  const handleGoList = () => {
    onGoAlertList()
    onClose()
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-4 right-4 z-[80] w-[min(100%,22rem)]"
      role="dialog"
      aria-modal="true"
      aria-label="악취 경보 발생"
    >
      <div className="overflow-hidden rounded-md border border-border bg-background shadow-2xl">
        <div className="flex items-center gap-1.5 bg-red-600 px-3 py-2 text-sm font-semibold text-white">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          악취 경보 발생
        </div>

        <div className="space-y-1.5 px-3 py-2.5 text-[11px]">
          {focus ? (
            <>
              <div className="text-sm font-semibold text-foreground" title={focus.sensorLabel}>
                {focus.sensorLabel}
              </div>
              <div className="text-muted-foreground">
                {ODOR_ALERT_KIND_LABEL[focus.kind]}
                {focus.grade != null
                  ? ` · ${ODOR_ALERT_GRADE_LABEL[focus.grade as OdorAlertGrade]}`
                  : ''}
              </div>
              <div className="text-muted-foreground">
                {focus.agency} · {focus.emdNm}
              </div>
              <div className="tabular-nums text-muted-foreground">
                발생 {formatOdorAlertTime(focus.occurredAt)}
              </div>
              {focus.scrubberAutoOn != null ? (
                <div className="text-muted-foreground">
                  저감설비 {focus.scrubberAutoOn ? '자동가동' : '미가동'}
                </div>
              ) : null}
              {focus.acked ? (
                <div className="font-medium text-emerald-700 dark:text-emerald-300">확인됨</div>
              ) : (
                <div className="font-medium text-amber-700 dark:text-amber-300">미확인</div>
              )}
            </>
          ) : (
            <p className="py-3 text-center text-muted-foreground">표시할 경보가 없습니다.</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-t border-border bg-muted/20 px-2 py-2">
          <button
            type="button"
            title="경보 목록 이동"
            onClick={handleGoList}
            className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted/50"
          >
            경보 목록 이동
          </button>
          <button
            type="button"
            title="확인(해제)"
            onClick={handleAck}
            disabled={!focus || focus.acked}
            className={cn(
              'inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            확인(해제)
          </button>
        </div>
      </div>
    </div>
  )
}
