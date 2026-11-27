'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { OdorScadaPaletteSwitch } from '@/app/(pages)/(index)/odorPhV2/OdorScadaPaletteSwitch'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import {
  buildDashboardGradeMock,
  mockPpmFromGrade,
  type OdorGradePointMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import {
  odorLiveSeverityFromGrade,
  odorLiveSeverityLabel,
  odorLiveSeverityTagStyle,
  ODOR_LIVE_GRADE_HEX,
} from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import { cn } from '@/lib/utils'

type Props = {
  sensors: OdorSensorListItem[]
  focusKey: string | null
  onFocusKeyChange: (key: string | null) => void
  alertOnly: boolean
  onAlertOnlyChange: (v: boolean) => void
  showPoints: boolean
  onShowPointsChange: (v: boolean) => void
  onClose: () => void
  /** 좌측 «경보 보기»로 전환 */
  onOpenAlert?: () => void
}

function pointSensorKey(p: OdorGradePointMock): string {
  return p.id.startsWith('pt-') ? p.id.slice(3) : p.id
}

function GradeBadge({ grade }: { grade: number }) {
  return (
    <span
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
      style={{ backgroundColor: ODOR_LIVE_GRADE_HEX[grade as 1 | 2 | 3 | 4 | 5] ?? '#64748b' }}
    >
      {grade}
    </span>
  )
}

/** 관제 지도 — 좌측 사이드 패널 (본지도는 레이아웃에서 유지) */
export function OdorControlMapPanel({
  sensors,
  focusKey,
  onFocusKeyChange,
  alertOnly,
  onAlertOnlyChange,
  showPoints,
  onShowPointsChange,
  onClose,
  onOpenAlert,
}: Props) {
  const { points } = useMemo(() => buildDashboardGradeMock(sensors), [sensors])
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list')

  const sideList = useMemo(() => {
    const q = query.trim()
    let list = [...points].filter((p) => p.grade >= 3)
    if (alertOnly) list = list.filter((p) => p.grade >= 3)
    if (q) {
      list = list.filter(
        (p) =>
          p.label.includes(q) ||
          p.emdNm.includes(q) ||
          p.agency.includes(q) ||
          pointSensorKey(p).includes(q)
      )
    }
    return list.sort((a, b) => b.grade - a.grade || a.label.localeCompare(b.label, 'ko'))
  }, [points, query, alertOnly])

  const tableRows = useMemo(() => {
    const q = query.trim()
    let list = points
    if (alertOnly) list = list.filter((p) => p.grade >= 3)
    if (q) {
      list = list.filter(
        (p) =>
          p.label.includes(q) ||
          p.emdNm.includes(q) ||
          p.agency.includes(q) ||
          pointSensorKey(p).includes(q)
      )
    }
    return list
  }, [points, query, alertOnly])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="text-sm font-semibold">관제 지도</span>
        <div className="flex items-center gap-1.5">
          <OdorScadaPaletteSwitch />
          <button
            type="button"
            title="닫기"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <label className="inline-flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => onShowPointsChange(e.target.checked)}
              className="cursor-pointer"
            />
            측정지점
          </label>
          <label className="inline-flex items-center gap-1 opacity-60">
            <input type="checkbox" disabled className="cursor-not-allowed" />
            하수관망 (예정)
          </label>
          <label className="inline-flex items-center gap-1 opacity-60">
            <input type="checkbox" disabled className="cursor-not-allowed" />
            시설물 (예정)
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="지점명·번호 검색"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[12px]"
          />
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={alertOnly}
              onChange={(e) => onAlertOnlyChange(e.target.checked)}
              className="cursor-pointer"
            />
            3~5등급만
          </label>
        </div>
        <div className="inline-flex overflow-hidden rounded border border-border text-[12px]">
          <button
            type="button"
            title="주의·심각 목록"
            onClick={() => setViewMode('list')}
            className={cn(
              'cursor-pointer px-2.5 py-1',
              viewMode === 'list'
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'bg-background text-muted-foreground'
            )}
          >
            주의·심각
          </button>
          <button
            type="button"
            title="전체 목록"
            onClick={() => setViewMode('table')}
            className={cn(
              'cursor-pointer px-2.5 py-1',
              viewMode === 'table'
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'bg-background text-muted-foreground'
            )}
          >
            전체
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {viewMode === 'list' ? (
          <div className="p-2">
            <div className="mb-1.5 px-1 text-[12px] text-muted-foreground">
              악취등급 주의·심각 <span className="font-medium text-foreground">{sideList.length}곳</span>
            </div>
            {sideList.length === 0 ? (
              <div className="px-1 py-3 text-xs text-muted-foreground">주의·심각 지점 없음</div>
            ) : (
              sideList.map((p) => {
                const key = pointSensorKey(p)
                const sev = odorLiveSeverityLabel(p.grade)
                const ppm = mockPpmFromGrade(p.grade, Number(key) || 0)
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    onClick={() => onFocusKeyChange(key)}
                    className={cn(
                      'mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md border-b border-border/50 px-1 py-2 text-left hover:bg-muted/40',
                      focusKey === key && 'bg-sky-500/15 outline outline-1 outline-sky-500/50'
                    )}
                  >
                    <GradeBadge grade={p.grade} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold">
                        {key} · {p.label}
                      </div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {ppm}ppm · {p.emdNm}
                      </div>
                    </div>
                    <span
                      className="inline-flex h-[18px] min-w-[36px] shrink-0 items-center justify-center rounded-full px-2 text-center text-[12px] font-semibold"
                      style={odorLiveSeverityTagStyle(odorLiveSeverityFromGrade(p.grade))}
                    >
                      {sev}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="sticky top-0 bg-muted/50 text-[12px] text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">지점</th>
                <th className="px-2 py-1.5 font-semibold">위치</th>
                <th className="px-2 py-1.5 font-semibold">등급</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p) => {
                const key = pointSensorKey(p)
                return (
                  <tr
                    key={p.id}
                    onClick={() => onFocusKeyChange(key)}
                    className={cn(
                      'cursor-pointer border-b border-border/50 hover:bg-muted/40',
                      focusKey === key && 'bg-sky-500/10'
                    )}
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 text-[12px] font-semibold">{key}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-[12px]">{p.label}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1">
                        <GradeBadge grade={p.grade} />
                        <span className="text-[12px] text-muted-foreground">{p.grade}등급</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {onOpenAlert ? (
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            title="경보 보기"
            onClick={onOpenAlert}
            className="flex h-8 w-full cursor-pointer items-center justify-center rounded-md border border-border bg-muted/40 text-[12px] font-semibold text-foreground hover:bg-muted"
          >
            경보 보기
          </button>
        </div>
      ) : null}
    </div>
  )
}
