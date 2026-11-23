'use client'

import { useMemo, type CSSProperties } from 'react'
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
import { MAP_UI_Z_CLASS } from '@/lib/mapUiZIndex'

/** 목록·상세 연동용 — 모달에서 보고 있던 경보 */
export type OdorAlertModalFocus = {
  storeAlertId: string
  sensorLabel: string
  agency: string
  emdNm: string
  occurredAt: string
  grade: OdorAlertGrade | null
  acked: boolean
  scrubberAutoOn: boolean | null
}

type Props = {
  open: boolean
  onClose: () => void
  onGoAlertList: (focus: OdorAlertModalFocus | null) => void
  /** 기본: 우측 하단. 지도 대시보드 등에서 위치 덮어쓰기 */
  className?: string
  style?: CSSProperties
  /** 카드 surface (radius 등) */
  contentClassName?: string
}

/** Index 콘솔 — 악취 경보 플로팅 모달 (기본: aside 포함 영역 우측 하단) */
export function OdorIndexAlertModal({
  open,
  onClose,
  onGoAlertList,
  className,
  style,
  contentClassName,
}: Props) {
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

  const toFocus = (): OdorAlertModalFocus | null => {
    if (!focus) return null
    return {
      storeAlertId: focus.id,
      sensorLabel: focus.sensorLabel,
      agency: focus.agency,
      emdNm: focus.emdNm,
      occurredAt: focus.occurredAt,
      grade: focus.grade,
      acked: focus.acked,
      scrubberAutoOn: focus.scrubberAutoOn,
    }
  }

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
    onGoAlertList(toFocus())
    onClose()
  }

  return (
    <div
      className={cn(
        'pointer-events-auto w-[min(100%,22rem)]',
        className ?? cn('fixed bottom-4 right-4', MAP_UI_Z_CLASS.nestedDialog)
      )}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label="악취 경보 발생"
    >
      <div
        className={cn(
          'overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
          contentClassName
        )}
      >
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

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-muted/20 px-2 py-2">
          <button
            type="button"
            title="나중에 보기"
            onClick={onClose}
            className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            나중에 보기
          </button>
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
