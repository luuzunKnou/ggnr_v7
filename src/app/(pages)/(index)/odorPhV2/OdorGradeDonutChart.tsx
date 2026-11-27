'use client'

import { useMemo } from 'react'
import {
  gradeH2sPpmLabel,
  gradeHintKo,
  type OdorGrade,
  type OdorGradeCounts,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { odorLiveSeverityLabel } from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import { cn } from '@/lib/utils'

/** 하수관로 악취관리 등급기준 표식 (환경부 지침 2020 · 서울시 공개표) */
const GRADE_BAR_HEX: Record<OdorGrade, string> = {
  1: '#4e80bb',
  2: '#76923b',
  3: '#febf00',
  4: '#e46b09',
  5: '#fd0000',
}

const GRADES = [1, 2, 3, 4, 5] as const

type Props = {
  counts: OdorGradeCounts
  total: number
}

/**
 * 악취 등급 분포 — 가로 누적 막대 + 등급별 건수.
 * (기존 도넛 export명 유지)
 */
export function OdorGradeDonutChart({ counts, total }: Props) {
  const segments = useMemo(() => {
    return GRADES.map((g) => {
      const n = counts[g] ?? 0
      const pct = total > 0 ? (n / total) * 100 : 0
      return { grade: g, n, pct }
    }).filter((s) => s.n > 0)
  }, [counts, total])

  return (
    <div className="flex h-full min-h-0 flex-col px-0.5 py-1">
      <div className="flex shrink-0 flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">측정지점</span>
          <span className="text-xl font-extrabold tabular-nums tracking-tight text-foreground">
            {total}
            <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">개</span>
          </span>
        </div>

        {total <= 0 ? (
          <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-border text-[12px] text-muted-foreground">
            데이터 없음
          </div>
        ) : (
          <div
            className="flex h-10 w-full gap-[2px] overflow-hidden rounded-md border border-border/60 bg-card dark:bg-foreground/45"
            role="img"
            aria-label="악취 등급 분포 누적 막대"
          >
            {segments.map((s) => (
              <div
                key={s.grade}
                title={`${s.grade}등급(${gradeH2sPpmLabel(s.grade)}) · ${odorLiveSeverityLabel(s.grade)} ${s.n}개 (${Math.round(s.pct)}%) · ${gradeHintKo(s.grade)}`}
                className="h-full min-w-[3px] transition-[width]"
                style={{
                  width: `${s.pct}%`,
                  backgroundColor: GRADE_BAR_HEX[s.grade],
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 막대 ↔ 범례 간격 + 하단 여백을 범례가 균등 분배 */}
      <ul className="mt-5 flex min-h-0 flex-1 flex-col justify-evenly overflow-hidden pb-0.5">
        {GRADES.map((g) => {
          const n = counts[g] ?? 0
          const pct = total > 0 ? Math.round((n / total) * 100) : 0
          return (
            <li
              key={g}
              className={cn(
                'flex items-center gap-2 text-[12px]',
                n <= 0 && 'opacity-45'
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: GRADE_BAR_HEX[g] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {g}등급({gradeH2sPpmLabel(g)}) · {odorLiveSeverityLabel(g)}
              </span>
              <span className="shrink-0 tabular-nums font-normal text-foreground">
                {n}
                <span className="ml-1 font-normal text-muted-foreground">({pct}%)</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="shrink-0 pt-1 text-right text-[12px] text-muted-foreground/80">
        하수관로 악취 관리 지침(2020.3, 환경부) 기준
      </p>
    </div>
  )
}
