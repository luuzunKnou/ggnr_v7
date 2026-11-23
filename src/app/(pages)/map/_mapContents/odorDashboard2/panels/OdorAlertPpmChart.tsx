'use client'

import { useMemo } from 'react'
import type { OdorGrade } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { GRADE_MAX_PPM } from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'
import {
  ODOR_GRADE_BAR_COLORS,
  OdorGradeBarChart,
} from './OdorGradeBarChart'

/** ppm → 가로 stacked 축(0~5). g등급 구간 (g-1)~g */
function ppmToStackX(ppm: number): number {
  const bounds = [
    0,
    GRADE_MAX_PPM[1],
    GRADE_MAX_PPM[2],
    GRADE_MAX_PPM[3],
    GRADE_MAX_PPM[4],
    GRADE_MAX_PPM[5],
  ]
  for (let g = 1; g <= 5; g++) {
    const lo = bounds[g - 1]!
    const hi = bounds[g]!
    if (ppm <= hi || g === 5) {
      const t = hi > lo ? Math.min(1, Math.max(0, (ppm - lo) / (hi - lo))) : 0
      return g - 1 + t
    }
  }
  return 5
}

type Props = {
  ppm: number
  grade: OdorGrade
}

/**
 * 가로 Stacked Bar(등급색 동일 폭) + 현재 ppm `|` 마커 하나.
 */
export function OdorAlertPpmChart({ ppm, grade }: Props) {
  const markerX = useMemo(() => Math.max(0, Math.min(5, ppmToStackX(ppm))), [ppm])

  const emptyCounts = useMemo(
    () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }) as const,
    []
  )

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className="text-[12px] font-semibold"
          style={{ color: ODOR_GRADE_BAR_COLORS[grade] }}
        >
          {grade}등급
        </span>
        <span
          className="text-[18px] font-semibold tabular-nums text-orange-500 dark:text-orange-400"
          title={`현재 ${ppm.toFixed(1)} ppm`}
        >
          {ppm.toFixed(1)}
          <span className="ml-0.5 text-[12px] font-normal text-orange-500/80 dark:text-orange-400/80">
            ppm
          </span>
        </span>
      </div>
      <OdorGradeBarChart counts={emptyCounts} total={1} markerX={markerX} />
    </div>
  )
}
