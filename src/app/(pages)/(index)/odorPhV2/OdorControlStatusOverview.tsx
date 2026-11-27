'use client'

import { useMemo, type ReactNode } from 'react'
import { AlertTriangle, Fan, Siren, Wifi, WifiOff } from 'lucide-react'
import {
  mockPpmFromGrade,
  mockPointAbatementRunning,
  mockPointCommOnline,
  type OdorGradePointMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import {
  ODOR_LIVE_ACTION_HEX,
  ODOR_LIVE_SEVERITY_HEX,
  odorLiveSeverityFromGrade,
  odorLiveSeverityIsAccent,
  odorLiveSeverityLabel,
} from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import { useOdorLightChrome } from '@/app/(pages)/(index)/odorPhV2/OdorLightChromeContext'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import { cn } from '@/lib/utils'

export type OdorPointFocusPayload = {
  point: OdorGradePointMock
  sensorKey: string
  online: boolean
  running: boolean
}

type Props = {
  points: OdorGradePointMock[]
  className?: string
  /** 현재 선택 지점(카드 강조) */
  focusedSensorKey?: string | null
  /** 관제 지도 가동/중지 조작 반영 (sensorKey → running) */
  runningOverrides?: Record<string, boolean>
  /** 카드 선택/해제 — 우측 관제 지도 확대·저감 제어 바 */
  onPointFocus?: (payload: OdorPointFocusPayload | null) => void
}

function pointSensorKey(p: OdorGradePointMock): string {
  return p.id.startsWith('pt-') ? p.id.slice(3) : p.id
}

type PointRow = {
  point: OdorGradePointMock
  sensorKey: string
  running: boolean
  /** 통신 정상 여부 */
  online: boolean
  /** 경보·주의인데 저감 미가동(통신 정상일 때만) */
  gap: boolean
}

const ABATEMENT_LABEL = {
  running: '가동중',
  stopped: '대기',
} as const

/**
 * 대시보드 중앙 — «측정지점 현황» 상태 보드.
 * 카드 클릭 → 우측 관제 지도 확대 + 저감 제어 바.
 */
export function OdorControlStatusOverview({
  points,
  className,
  focusedSensorKey = null,
  runningOverrides,
  onPointFocus,
}: Props) {
  const selectPoint = (r: PointRow) => {
    if (focusedSensorKey === r.sensorKey) {
      onPointFocus?.(null)
      return
    }
    onPointFocus?.({
      point: r.point,
      sensorKey: r.sensorKey,
      online: r.online,
      running: r.running,
    })
  }

  const hasFocus = focusedSensorKey != null && focusedSensorKey !== ''

  const { alertRows, cautionRows, normalRows, total } = useMemo(() => {
    const toRow = (p: OdorGradePointMock): PointRow => {
      const sensorKey = pointSensorKey(p)
      const online = mockPointCommOnline(sensorKey, p.agency)
      const override = runningOverrides?.[sensorKey]
      const running =
        online &&
        (override !== undefined
          ? override
          : mockPointAbatementRunning(sensorKey, p.status))
      const gap = online && p.status !== 'normal' && !running
      return { point: p, sensorKey, running, online, gap }
    }
    const sortGapFirst = (a: PointRow, b: PointRow) => {
      if (a.gap !== b.gap) return a.gap ? -1 : 1
      return a.point.label.localeCompare(b.point.label, 'ko')
    }
    const alertRows = points.filter((p) => p.status === 'warning').map(toRow).sort(sortGapFirst)
    const cautionRows = points.filter((p) => p.status === 'caution').map(toRow).sort(sortGapFirst)
    const normalRows = points.filter((p) => p.status === 'normal').map(toRow)
    return {
      alertRows,
      cautionRows,
      normalRows,
      total: points.length,
    }
  }, [points, runningOverrides])

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-card',
        className
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
        {/* 남는 높이는 위·아래에 균등 분배 */}
        <div className="my-auto flex w-full flex-col gap-3">
          {alertRows.length > 0 ? (
            <NodeSection title="경보" tone="bad" count={alertRows.length}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {alertRows.map((r) => {
                  const selected = focusedSensorKey === r.sensorKey
                  return (
                    <StatusNode
                      key={r.point.id}
                      row={r}
                      pulse={!hasFocus || selected}
                      selected={selected}
                      dimmed={hasFocus && !selected}
                      onClick={() => selectPoint(r)}
                    />
                  )
                })}
              </div>
            </NodeSection>
          ) : null}

          {cautionRows.length > 0 ? (
            <NodeSection title="주의" tone="warn" count={cautionRows.length}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {cautionRows.map((r) => {
                  const selected = focusedSensorKey === r.sensorKey
                  return (
                    <StatusNode
                      key={r.point.id}
                      row={r}
                      selected={selected}
                      dimmed={hasFocus && !selected}
                      onClick={() => selectPoint(r)}
                    />
                  )
                })}
              </div>
            </NodeSection>
          ) : null}

          {normalRows.length > 0 ? (
            <NodeSection title="정상" tone="ok" count={normalRows.length}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {normalRows.map((r) => {
                  const selected = focusedSensorKey === r.sensorKey
                  return (
                    <StatusNode
                      key={r.point.id}
                      row={r}
                      selected={selected}
                      dimmed={hasFocus && !selected}
                      onClick={() => selectPoint(r)}
                    />
                  )
                })}
              </div>
            </NodeSection>
          ) : null}

          {total === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">표시할 지점이 없습니다.</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function NodeSection({
  title,
  tone,
  count,
  children,
}: {
  title: string
  tone: 'ok' | 'warn' | 'bad'
  count: number
  children: ReactNode
}) {
  const accent = odorLiveSeverityIsAccent(tone)
  const hex = ODOR_LIVE_SEVERITY_HEX[tone]
  /** 정상 원은 지도·범례와 동일 초록 (본문 무채 규칙과 분리) */
  const dotHex = tone === 'ok' ? '#22c55e' : hex
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: accent || tone === 'ok' ? dotHex : undefined }}
          aria-hidden
        />
        <h4
          className={cn('text-[13px] font-medium', !accent && 'text-muted-foreground')}
          style={accent ? { color: hex } : undefined}
        >
          {title}
          <span className="ml-1 font-normal tabular-nums">({count})</span>
        </h4>
      </div>
      {children}
    </section>
  )
}

function StatusNode({
  row,
  pulse = false,
  selected = false,
  dimmed = false,
  onClick,
}: {
  row: PointRow
  pulse?: boolean
  selected?: boolean
  /** 다른 지점 선택 중 — 톤다운 */
  dimmed?: boolean
  onClick?: () => void
}) {
  const { point, gap, online, running, sensorKey } = row
  const resolved = useResolvedThemeSafe()
  const lightChrome = useOdorLightChrome()
  const lightB = resolved === 'light' && lightChrome === 'b'
  const severity = odorLiveSeverityFromGrade(point.grade)
  const isAlert = severity === 'bad'
  const accent = odorLiveSeverityIsAccent(severity)
  const hex = ODOR_LIVE_SEVERITY_HEX[severity]
  const label = odorLiveSeverityLabel(point.grade)
  const ppm = mockPpmFromGrade(point.grade, Number.parseInt(sensorKey, 10) || 0)
  /** 가동중은 초록, 미가동은 주의색 — 태그 대신 아이콘+라벨 */
  const abatementHex = running ? '#22c55e' : ODOR_LIVE_SEVERITY_HEX.warn
  /** 통신은 정상/오류를 초록·빨강으로 직관 표시 (등급 무채 규칙과 분리) */
  const commHex = online ? '#22c55e' : ODOR_LIVE_SEVERITY_HEX.bad

  const cardStyle = (() => {
    if (isAlert) {
      const borderPct = lightB ? 82 : 78
      const bgPct = lightB ? 18 : 16
      return {
        borderColor: `color-mix(in srgb, ${hex} ${borderPct}%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${hex} ${bgPct}%, transparent)`,
      }
    }
    if (accent) {
      const borderPct = lightB ? 58 : 42
      const bgPct = lightB ? 12 : 8
      return {
        borderColor: `color-mix(in srgb, ${hex} ${borderPct}%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${hex} ${bgPct}%, transparent)`,
      }
    }
    if (lightB) {
      /* 정상 — 초록 대신 회색·흰 계열 (주의·경보만 색 강조) */
      return {
        borderColor: selected ? '#d4d4d8' : '#e4e4e7',
        backgroundColor: selected ? '#f4f4f5' : '#fafafa',
      }
    }
    /* A·다크 — 기존 무채 ok 틴트 */
    return {
      borderColor: `color-mix(in srgb, ${hex} ${selected ? 48 : 30}%, transparent)`,
      backgroundColor: `color-mix(in srgb, ${hex} ${selected ? 14 : 8}%, transparent)`,
    }
  })()

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex min-h-[108px] cursor-pointer flex-col justify-center gap-2.5 rounded-lg border px-3 py-4 text-left transition-[opacity,filter] duration-150',
        'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
        /* 다크만 두꺼운 테두리 — 라이트는 1px + 틴트로 구분 */
        isAlert &&
          resolved !== 'light' &&
          'border-2 shadow-[0_0_0_1px_color-mix(in_srgb,#ef4444_35%,transparent)]',
        selected && 'z-[1]',
        dimmed && 'opacity-45 saturate-50 hover:opacity-70'
      )}
      style={cardStyle}
      aria-pressed={selected}
    >
      {/* 경보 — 우상단 사이렌 (점과 구분) */}
      {pulse ? (
        <span
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center"
          title="경보"
          aria-hidden
        >
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40"
            style={{ backgroundColor: hex }}
          />
          <span
            className="relative inline-flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-card"
            style={{
              color: '#fff',
              backgroundColor: hex,
            }}
          >
            <Siren className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-2 pr-1">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
          {point.label}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium"
          style={
            isAlert
              ? {
                  color: hex,
                  backgroundColor: `color-mix(in srgb, ${hex} 28%, transparent)`,
                }
              : accent
                ? {
                    color: hex,
                    backgroundColor: `color-mix(in srgb, ${hex} 16%, transparent)`,
                  }
                : {
                    color: 'var(--muted-foreground)',
                    backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 12%, transparent)',
                  }
          }
        >
          {point.grade}등급·{label}
        </span>
      </div>
      <div className="truncate text-[12px] text-muted-foreground">
        <span className="tabular-nums">{ppm.toFixed(1)}ppm</span>
        {` · ${point.emdNm}`}
        {point.agency ? ` · ${point.agency}` : ''}
      </div>
      <div className="flex h-[18px] items-center justify-between gap-2 leading-none">
        <div className="min-w-0 truncate">
          {!online ? (
            <span
              className="inline-flex h-[18px] max-w-full items-center gap-1 truncate text-[12px] font-normal leading-none"
              style={{ color: ODOR_LIVE_SEVERITY_HEX.bad }}
              title="통신 오류로 저감 제어 불가"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden />
              제어 불가
            </span>
          ) : gap ? (
            <span
              className="inline-flex h-[18px] max-w-full items-center gap-1 truncate text-[12px] font-normal leading-none"
              style={{ color: ODOR_LIVE_ACTION_HEX }}
              title="주의·경보인데 저감 대기 — 가동 필요"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden />
              가동 필요
            </span>
          ) : (
            <span
              className="inline-flex h-[18px] max-w-full items-center gap-1 truncate text-[12px] font-normal leading-none"
              style={{ color: abatementHex }}
              title={running ? ABATEMENT_LABEL.running : ABATEMENT_LABEL.stopped}
            >
              <Fan
                className={cn('h-3 w-3 shrink-0', running && 'animate-spin')}
                style={running ? { animationDuration: '2.4s' } : undefined}
                strokeWidth={2.2}
                aria-hidden
              />
              {running ? ABATEMENT_LABEL.running : ABATEMENT_LABEL.stopped}
            </span>
          )}
        </div>
        <span
          className="inline-flex h-[18px] w-3 shrink-0 items-center justify-center"
          style={{ color: commHex }}
          title={online ? '통신 정상' : '통신 오류'}
          aria-label={online ? '통신 정상' : '통신 오류'}
        >
          {online ? (
            <Wifi className="h-3 w-3" strokeWidth={2.2} aria-hidden />
          ) : (
            <WifiOff className="h-3 w-3" strokeWidth={2.2} aria-hidden />
          )}
        </span>
      </div>
    </button>
  )
}
