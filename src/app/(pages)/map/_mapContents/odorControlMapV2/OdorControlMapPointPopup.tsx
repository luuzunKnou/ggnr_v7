'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { Map as OLMap } from 'ol'
import { fromLonLat } from 'ol/proj'
import { cn } from '@/lib/utils'
import { mockPpmFromGrade } from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import {
  ODOR_LIVE_GRADE_HEX,
  odorLiveSeverityFromGrade,
  odorLiveSeverityLabel,
  odorLiveSeverityTagStyle,
} from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import type { OdorControlMapPointInfo } from './odorControlMapPointTypes'

const PANEL_W = 240
const PANEL_H_EST = 132
const EDGE = 8
/** 지점 마커 위쪽 여백 — 클수록 팝업이 위로 */
const ABOVE = 25

type Props = {
  map: OLMap | null | undefined
  point: OdorControlMapPointInfo
  onClose: () => void
}

function placeAbove(
  x: number,
  y: number,
  w: number,
  h: number
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = x - w / 2
  let top = y - h - ABOVE
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE))
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - h - EDGE))
  return { top, left }
}

/** 관제 지도 — 측정지점 클릭 시 간략 정보 */
export function OdorControlMapPointPopup({ map, point, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const updatePos = () => {
    if (!map) return
    const coord = fromLonLat([point.lon, point.lat])
    const pixel = map.getPixelFromCoordinate(coord)
    const el = map.getTargetElement()
    if (!pixel || !el) return
    const rect = el.getBoundingClientRect()
    const h = rootRef.current?.offsetHeight || PANEL_H_EST
    const w = rootRef.current?.offsetWidth || PANEL_W
    setPos(
      placeAbove(rect.left + pixel[0]!, rect.top + pixel[1]!, w, h)
    )
  }

  useLayoutEffect(() => {
    updatePos()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- point/map
  }, [map, point.lon, point.lat, point.sensorKey])

  useEffect(() => {
    if (!map) return
    const onMove = () => updatePos()
    map.on('postrender', onMove)
    window.addEventListener('resize', onMove)
    return () => {
      map.un('postrender', onMove)
      window.removeEventListener('resize', onMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, point.lon, point.lat])

  const grade = point.grade
  const severity = odorLiveSeverityFromGrade(grade)
  const sevLabel = odorLiveSeverityLabel(grade)
  const ppm = mockPpmFromGrade(grade, Number(point.sensorKey) || 0)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="측정지점 정보"
      title="측정지점 정보"
      className={cn(
        'pointer-events-auto fixed z-[60] flex flex-col overflow-hidden',
        'standard-map-float-surface !opacity-100',
        !pos && 'invisible'
      )}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: PANEL_W,
        maxWidth: 'min(240px, calc(100vw - 1rem))',
      }}
    >
      <div className="standard-map-float-header cursor-default gap-1.5 !py-1.5 !text-[12px] hover:bg-slate-100 dark:hover:bg-white/10">
        <span
          className="standard-map-float-header-title min-w-0 flex-1 truncate"
          title={point.label}
        >
          {point.label}
        </span>
        <button
          type="button"
          title="닫기"
          aria-label="닫기"
          onClick={onClose}
          className="standard-map-float-header-close cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 py-2 text-[12px] text-slate-700 dark:text-white/85">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ backgroundColor: ODOR_LIVE_GRADE_HEX[grade] ?? '#64748b' }}
          >
            {grade}
          </span>
          <span
            className="inline-flex h-[18px] min-w-[36px] items-center justify-center rounded-full px-2 text-[12px] font-semibold"
            style={odorLiveSeverityTagStyle(severity)}
          >
            {sevLabel}
          </span>
          <span className="ml-auto tabular-nums font-semibold">{ppm} ppm</span>
        </div>
        <div className="grid grid-cols-[3.2rem_1fr] gap-x-1 gap-y-0.5 text-[12px] leading-snug">
          <span className="text-muted-foreground">지점번호</span>
          <span className="truncate font-medium">{point.sensorKey}</span>
          <span className="text-muted-foreground">위치</span>
          <span className="truncate">{point.emdNm || '—'}</span>
          <span className="text-muted-foreground">운영</span>
          <span className="truncate">{point.agency || '—'}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
