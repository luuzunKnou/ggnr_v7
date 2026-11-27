'use client'

import { useMemo } from 'react'
import type { OdorGradeCounts } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'

const GRADES = [1, 2, 3, 4, 5] as const

/** 트랙(마커 포함) 높이 — `|` 전체 높이 */
export const ODOR_GRADE_CHART_MIN_HEIGHT_PX = 22
/** 색 막대 높이 — `|`보다 살짝 낮춰 마커가 튀어 보이게 */
const ODOR_GRADE_BAR_HEIGHT_PX = 14

export const ODOR_GRADE_BAR_COLORS: Record<(typeof GRADES)[number], string> = {
  1: '#22c55e',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
}

/** `|` — 흰 본선 + 게이지형 일반 보더(슬레이트) */
const STICK_BORDER = '#0f172a'
const STICK_FILL = '#ffffff'

type Props = {
  counts: OdorGradeCounts
  total: number
  /**
   * 현재 값 `|` — 축 0~5 (등급 g 구간 = g-1 ~ g).
   * 미지정 시 건수 가중 평균 등급에 `|` 하나(등급마다 찍지 않음).
   */
  markerX?: number | null
}

/** 건수 가중 평균 등급 → 스택 x(0~5). 데이터 없으면 null */
function markerXFromCounts(counts: OdorGradeCounts): number | null {
  let sum = 0
  let n = 0
  for (const g of GRADES) {
    const c = counts[g] ?? 0
    sum += g * c
    n += c
  }
  if (n <= 0) return null
  return sum / n - 0.5
}

function Stick({ leftPct }: { leftPct: number }) {
  const clamped = Math.max(0, Math.min(100, leftPct))
  return (
    <span
      className="pointer-events-none absolute inset-y-0 z-10 -translate-x-1/2"
      style={{ left: `${clamped}%` }}
      aria-hidden
    >
      {/* 슬레이트 보더 */}
      <span
        className="absolute inset-y-0 left-1/2 w-[5px] -translate-x-1/2 rounded-[1px]"
        style={{ backgroundColor: STICK_BORDER }}
      />
      {/* 흰색 본선 */}
      <span
        className="absolute inset-y-[1px] left-1/2 w-[2px] -translate-x-1/2 rounded-[1px]"
        style={{ backgroundColor: STICK_FILL }}
      />
    </span>
  )
}

/**
 * 가로 등급 바 — 1~5 동일 폭 색 구간 + 흰색 `|`(슬레이트 보더).
 * 막대는 마커보다 낮아 `|`가 위·아래로 보이게 함.
 */
export function OdorGradeBarChart({ counts, total, markerX = null }: Props) {
  const safeTotal = Math.max(total, 1)

  const stickPct = useMemo(() => {
    const x =
      markerX != null && Number.isFinite(markerX)
        ? markerX
        : markerXFromCounts(counts)
    if (x == null || !Number.isFinite(x)) return null
    return (Math.max(0, Math.min(5, x)) / 5) * 100
  }, [counts, markerX])

  return (
    <div
      className="relative w-full shrink-0"
      style={{ height: ODOR_GRADE_CHART_MIN_HEIGHT_PX, minHeight: ODOR_GRADE_CHART_MIN_HEIGHT_PX }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      title={`전체 ${safeTotal}건`}
    >
      <div
        className="absolute left-0 right-0 top-1/2 flex -translate-y-1/2 overflow-hidden rounded-[5px]"
        style={{ height: ODOR_GRADE_BAR_HEIGHT_PX }}
      >
        {GRADES.map((g) => (
          <div
            key={g}
            className={cn('h-full min-w-0 flex-1')}
            style={{ backgroundColor: ODOR_GRADE_BAR_COLORS[g] }}
            title={`${g}등급 ${counts[g]}건`}
          />
        ))}
      </div>
      {stickPct != null ? <Stick leftPct={stickPct} /> : null}
    </div>
  )
}
