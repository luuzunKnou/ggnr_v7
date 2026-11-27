'use client'

import { useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import {
  DEFAULT_ODOR_MAP_LAYER_VISIBILITY,
  type OdorMapLayerVisibility,
} from '@/app/(pages)/(index)/odorPhV2/OdorIndexMiniMap'
import {
  buildDashboardGradeMock,
  gradeSeverityLabel,
  mockPpmFromGrade,
  type OdorGradePointMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { cn } from '@/lib/utils'

const OdorIndexMiniMap = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPhV2/OdorIndexMiniMap').then((m) => m.OdorIndexMiniMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[240px] flex-1 items-center justify-center bg-muted/20 text-xs text-muted-foreground">
        지도 로딩 중…
      </div>
    ),
  }
)

type Props = {
  sensors: OdorSensorListItem[]
}

function pointSensorKey(p: OdorGradePointMock): string {
  return p.id.startsWith('pt-') ? p.id.slice(3) : p.id
}

function mockComm(p: OdorGradePointMock): '정상' | '지연' | '두절' {
  const n = Number(pointSensorKey(p)) || p.label.length
  if (n % 17 === 0) return '두절'
  if (n % 11 === 0) return '지연'
  return '정상'
}

function mockRun(p: OdorGradePointMock): boolean {
  const n = Number(pointSensorKey(p)) || p.label.length
  return n % 3 !== 0
}

function GradeBadge({ grade }: { grade: number }) {
  const colors: Record<number, string> = {
    1: 'bg-blue-600',
    2: 'bg-green-500',
    3: 'bg-yellow-400 text-stone-900',
    4: 'bg-orange-500',
    5: 'bg-red-500',
  }
  return (
    <span
      className={cn(
        'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
        colors[grade] ?? 'bg-slate-500'
      )}
    >
      {grade}
    </span>
  )
}

function Tag({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'off'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        tone === 'ok' && 'bg-emerald-500/20 text-emerald-400',
        tone === 'warn' && 'bg-amber-500/15 text-amber-300',
        tone === 'bad' && 'bg-red-500/15 text-red-300',
        tone === 'off' && 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

/** 시안 G P10 — 관제 지도 풀패널 (기존 OL 항공·읍면동 지도) */
export function OdorIndexControlMapContent({ sensors }: Props) {
  const { points, emdStatuses } = useMemo(() => buildDashboardGradeMock(sensors), [sensors])
  const [query, setQuery] = useState('')
  const [alertOnly, setAlertOnly] = useState(false)
  const [showPoints, setShowPoints] = useState(true)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const layerVisibility = useMemo<OdorMapLayerVisibility>(() => {
    if (!showPoints) {
      return { normal: false, caution: false, warning: false, abatement: false }
    }
    if (alertOnly) {
      return { ...DEFAULT_ODOR_MAP_LAYER_VISIBILITY, normal: false }
    }
    return DEFAULT_ODOR_MAP_LAYER_VISIBILITY
  }, [alertOnly, showPoints])

  const filteredPoints = useMemo(() => {
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

  const sideList = useMemo(
    () =>
      [...points]
        .filter((p) => p.grade >= 3)
        .sort((a, b) => b.grade - a.grade || a.label.localeCompare(b.label, 'ko')),
    [points]
  )

  const selectPoint = (p: OdorGradePointMock) => {
    setFocusKey(pointSensorKey(p))
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2.5 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-2">
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => setShowPoints(e.target.checked)}
              className="cursor-pointer"
            />
            측정지점
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-60">
            <input type="checkbox" disabled className="cursor-not-allowed" />
            하수관망 (예정)
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-60">
            <input type="checkbox" disabled className="cursor-not-allowed" />
            시설물 (예정)
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="지점명·번호 검색"
            className="h-7 w-40 rounded border border-border bg-background px-2 text-[11px]"
          />
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={alertOnly}
              onChange={(e) => setAlertOnly(e.target.checked)}
              className="cursor-pointer"
            />
            3~5등급만
          </label>
          <div className="flex-1" />
          <div className="inline-flex overflow-hidden rounded border border-border text-[11px]">
            <button
              type="button"
              title="지도"
              onClick={() => setViewMode('map')}
              className={cn(
                'cursor-pointer px-2.5 py-1',
                viewMode === 'map' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-background text-muted-foreground'
              )}
            >
              지도
            </button>
            <button
              type="button"
              title="목록"
              onClick={() => setViewMode('list')}
              className={cn(
                'cursor-pointer px-2.5 py-1',
                viewMode === 'list' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-background text-muted-foreground'
              )}
            >
              목록
            </button>
          </div>
        </div>

        {viewMode === 'map' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap gap-2.5 border-b border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              <span className="text-emerald-600 dark:text-emerald-400">● 정상(1·2등급)</span>
              <span className="text-amber-600 dark:text-amber-400">● 주의(3등급)</span>
              <span className="text-red-600 dark:text-red-400">● 심각(4·5등급)</span>
            </div>
            <div className="relative min-h-0 flex-1">
              <OdorIndexMiniMap
                embedded
                interactive
                showOpenMapButton={false}
                points={filteredPoints}
                emdStatuses={emdStatuses}
                layerVisibility={layerVisibility}
                highlightSensorKey={focusKey}
                onPointClick={(key) => setFocusKey(key)}
                className="h-full w-full rounded-none border-0"
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="sticky top-0 bg-muted/50 text-[10px] text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold">지점</th>
                  <th className="px-2 py-1.5 font-semibold">위치</th>
                  <th className="px-2 py-1.5 font-semibold">H₂S</th>
                  <th className="px-2 py-1.5 font-semibold">악취등급</th>
                  <th className="px-2 py-1.5 font-semibold">구간</th>
                  <th className="px-2 py-1.5 font-semibold">저감</th>
                  <th className="px-2 py-1.5 font-semibold">통신</th>
                </tr>
              </thead>
              <tbody>
                {filteredPoints.map((p) => {
                  const key = pointSensorKey(p)
                  const sev = gradeSeverityLabel(p.grade)
                  const ppm = mockPpmFromGrade(p.grade, Number(key) || 0)
                  const comm = mockComm(p)
                  const run = mockRun(p)
                  return (
                    <tr
                      key={p.id}
                      onClick={() => selectPoint(p)}
                      className={cn(
                        'cursor-pointer border-b border-border/50 hover:bg-muted/40',
                        focusKey === key && 'bg-sky-500/10'
                      )}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 text-[11px]">
                        <b>{key}</b>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[11px]">{p.label}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[11px] tabular-nums">{ppm}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[11px]">
                        <span className="inline-flex items-center gap-1">
                          <GradeBadge grade={p.grade} />
                          <span className="text-[10px] text-muted-foreground">{p.grade}등급</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <Tag tone={sev === '심각' ? 'bad' : sev === '주의' ? 'warn' : 'ok'}>{sev}</Tag>
                      </td>
                      <td className="px-2 py-1.5">
                        <Tag tone={run ? 'ok' : 'off'}>{run ? '가동중' : '미가동'}</Tag>
                      </td>
                      <td className="px-2 py-1.5">
                        <Tag tone={comm === '정상' ? 'ok' : comm === '지연' ? 'warn' : 'bad'}>{comm}</Tag>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <h3 className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 text-[13px] font-semibold">
          악취등급 주의·심각
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">{sideList.length}곳</span>
        </h3>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {sideList.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted-foreground">주의·심각 지점 없음</div>
          ) : (
            sideList.map((p) => {
              const key = pointSensorKey(p)
              const sev = gradeSeverityLabel(p.grade)
              const ppm = mockPpmFromGrade(p.grade, Number(key) || 0)
              const comm = mockComm(p)
              const run = mockRun(p)
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  onClick={() => {
                    setViewMode('map')
                    selectPoint(p)
                  }}
                  className={cn(
                    'mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md border-b border-border/50 px-1 py-2 text-left hover:bg-muted/40',
                    focusKey === key && 'bg-sky-500/15 outline outline-1 outline-sky-500/50'
                  )}
                >
                  <GradeBadge grade={p.grade} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold">
                      {key} · {p.label}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {ppm}ppm · {p.emdNm} · {comm} · {run ? '가동중' : '가동 필요'}
                    </div>
                  </div>
                  <Tag tone={sev === '심각' ? 'bad' : 'warn'}>
                    {p.grade}등급 · {sev}
                  </Tag>
                </button>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
