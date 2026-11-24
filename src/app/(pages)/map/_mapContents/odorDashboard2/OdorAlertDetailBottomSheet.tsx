'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { OdorAlertDetailPanel } from './panels/OdorAlertDetailPanel'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import {
  ODOR_DASHBOARD2_FLOAT_ALERT_WIDTH,
  ODOR_DASHBOARD2_FLOAT_RIGHT_INSET,
} from './odorDashboard2Config'
import type { OdorStationRow } from './odorDashboard2StationRows'

type Props = {
  alert: OdorAlertItem | null
  /** 상세 모달 left (지점목록 오른쪽) */
  leftPx: number
  /** 우측 inset — 미지정 시 대시보드 경보 패널 기준 */
  rightPx?: number
  /** 주의 경보 목록과 동일 bottom */
  bottomPx?: number
  stations?: OdorStationRow[]
  onClose: () => void
}

const EXIT_MS = 280
const DEFAULT_BOTTOM = 12
/** 우측 경보 패널과 간격 */
const RIGHT_GAP = 8

/**
 * 플로팅 대시보드 — 경보·지점 행 클릭 시 플로팅 모달 (아래→위 슬라이드).
 * left~right: 좌측 지점목록과 우측 주의경보 사이 폭.
 * 이미 열린 상태에서 다른 행 선택 시 애니메이션 없이 내용만 교체.
 */
export function OdorAlertDetailBottomSheet({
  alert,
  leftPx,
  rightPx: rightPxProp,
  bottomPx = DEFAULT_BOTTOM,
  stations = [],
  onClose,
}: Props) {
  const [mountedAlert, setMountedAlert] = useState<OdorAlertItem | null>(null)
  const [entered, setEntered] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(true)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (alert) {
      const alreadyOpen = wasOpenRef.current
      wasOpenRef.current = true
      setMountedAlert(alert)
      setBodyOpen(true)
      if (alreadyOpen) {
        setEntered(true)
        return
      }
      setEntered(false)
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntered(true))
      })
      return () => cancelAnimationFrame(id)
    }
    wasOpenRef.current = false
    setEntered(false)
    const t = window.setTimeout(() => setMountedAlert(null), EXIT_MS)
    return () => window.clearTimeout(t)
  }, [alert])

  if (typeof document === 'undefined' || !mountedAlert) return null

  const title = `${mountedAlert.sensorKorNm}(${mountedAlert.sensorNm})`
  const rightPx =
    rightPxProp ??
    ODOR_DASHBOARD2_FLOAT_RIGHT_INSET + ODOR_DASHBOARD2_FLOAT_ALERT_WIDTH + RIGHT_GAP
  const toggleBody = () => setBodyOpen((v) => !v)

  return createPortal(
    <div
      className={cn(
        'pointer-events-auto fixed flex flex-col overflow-hidden',
        MAP_LAYER_PANEL_SURFACE_CLASS,
        'opacity-100! bg-white dark:bg-black',
        /* 우측 메뉴(z-40)보다 아래 */
        'z-30',
        'transition-transform duration-300 ease-out',
        entered ? 'translate-y-0' : 'translate-y-full',
        bodyOpen ? 'h-[48vh]' : 'h-auto'
      )}
      style={{
        left: leftPx,
        bottom: bottomPx,
        right: rightPx,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="standard-map-float-header shrink-0 border-b border-slate-200 opacity-100 dark:border-white/10 dark:bg-white/20"
        title={`${title} — 더블클릭으로 접기/펼치기`}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, select, input, a')) return
          toggleBody()
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            className="inline-flex shrink-0 cursor-pointer items-center"
            title={bodyOpen ? '접기' : '펼치기'}
            onClick={toggleBody}
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-white/70',
                !bodyOpen && 'rotate-180'
              )}
              aria-hidden
            />
          </button>
          <span className="standard-map-float-header-title" title={title}>
            {title}
          </span>
        </div>
        <button
          type="button"
          className="standard-map-float-header-close inline-flex h-7 w-7 items-center justify-center"
          title="닫기"
          aria-label="닫기"
          onClick={onClose}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-col overflow-hidden transition-opacity duration-300 ease-out',
          bodyOpen
            ? 'min-h-0 flex-1 opacity-100'
            : 'pointer-events-none h-0 opacity-0'
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-2 opacity-100 dark:bg-black">
          <OdorAlertDetailPanel
            key={mountedAlert.id}
            alert={mountedAlert}
            layout="flex"
            stations={stations}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
