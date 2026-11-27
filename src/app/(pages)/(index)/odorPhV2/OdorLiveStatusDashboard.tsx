'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import dynamic from 'next/dynamic'
import { AlertTriangle, Fan, Wifi, WifiOff } from 'lucide-react'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import {
  MOCK_ODOR_COMPLAINT_LINKS,
  buildDashboardGradeMock,
  buildTodayTrendMock,
  formatAlertTime,
  mockAbatementRunningCount,
  mockOverallCommRate,
  mockPpmFromGrade,
  mockPointAbatementRunning,
  mockPointCommOnline,
  odorComplaintStatusLabel,
  sumGradeGroup,
  type EmdGradeStatusMock,
  type OdorComplaintLinkMock,
  type OdorGradePointMock,
  type TodayTrendHourMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import type { OdorIndexMenuId } from '@/app/(pages)/(index)/odorPhV2/odorIndexMenus'
import {
  ODOR_LIVE_ACTION_HEX,
  ODOR_LIVE_SEVERITY_HEX,
  odorLiveSeverityColorStyle,
  odorLiveSeverityFromGrade,
  odorLiveSeverityIsAccent,
  odorLiveSeverityLabel,
  odorLiveSeverityTagStyle,
} from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import { OdorControlStatusOverview } from '@/app/(pages)/(index)/odorPhV2/OdorControlStatusOverview'
import { useOdorLightChrome } from '@/app/(pages)/(index)/odorPhV2/OdorLightChromeContext'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import { cn } from '@/lib/utils'

/** 관제 지도·도넛 — 첫 페인트 후 지연 마운트 (OL/차트 초기화 경합 완화) */
const OdorIndexMiniMap = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPhV2/OdorIndexMiniMap').then((m) => m.OdorIndexMiniMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-muted/20 text-[12px] text-muted-foreground">
        지도 로딩 중…
      </div>
    ),
  }
)

const OdorGradeDonutChart = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPhV2/OdorGradeDonutChart').then((m) => m.OdorGradeDonutChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[120px] items-center justify-center text-[12px] text-muted-foreground">
        분포 로딩 중…
      </div>
    ),
  }
)

function HeavyPanelPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-muted/20 text-[12px] text-muted-foreground">
      {label}
    </div>
  )
}

/** 지점 선택 무조작 시 전체보기로 복귀 */
const MAP_FOCUS_IDLE_MS = 30_000

type MapFocusState = {
  point: OdorGradePointMock
  sensorKey: string
  online: boolean
  running: boolean
}

type Props = {
  sensors: OdorSensorListItem[]
  /** 헤더 «조회 기준 시간»과 동일 — 선택 지점 오버레이 측정 시각 */
  queriedAt?: string
  onGoMenu?: (menuId: OdorIndexMenuId, opts?: { sensorKey?: string }) => void
}

function formatOverlayQueryTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

function Panel({
  title,
  hint,
  className,
  bodyClassName,
  style,
  children,
}: {
  title: ReactNode
  hint?: ReactNode
  className?: string
  bodyClassName?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const resolved = useResolvedThemeSafe()
  const lightChrome = useOdorLightChrome()
  const lightB = resolved === 'light' && lightChrome === 'b'
  return (
    <section
      style={style}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border',
        lightB
          ? 'border-zinc-300 bg-white shadow-sm'
          : 'border-border bg-card',
        className
      )}
    >
      <h3
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[13px] font-medium text-foreground',
          lightB ? 'border-zinc-200 bg-zinc-100/90' : 'border-border bg-muted/40'
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">{title}</span>
        {hint ? <span className="ml-auto shrink-0 text-[12px] font-normal text-muted-foreground">{hint}</span> : null}
      </h3>
      <div className={cn('min-h-0 flex-1 overflow-auto p-2.5', bodyClassName)}>{children}</div>
    </section>
  )
}

function buildTrendXLabels(endHour: number): number[] {
  if (endHour <= 0) return [0]
  if (endHour <= 4) return [0, endHour]
  const step = endHour <= 8 ? 2 : endHour <= 14 ? 3 : 6
  const labels: number[] = []
  for (let h = 0; h <= endHour; h += step) labels.push(h)
  const last = labels[labels.length - 1]!
  if (last !== endHour) {
    /** 끝 시각이 직전과 2시간 이하면 겹침 → 직전 라벨을 끝으로 교체 */
    if (endHour - last <= 2) labels[labels.length - 1] = endHour
    else labels.push(endHour)
  }
  return labels
}

function TodayTrendChart({
  hours,
  nowHour,
}: {
  hours: TodayTrendHourMock[]
  nowHour: number | null
}) {
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null)

  /** 0시~현재 시까지만. X축도 그 구간으로 늘려 가로를 채움 */
  const pastHours = useMemo(() => {
    if (nowHour == null) return [] as TodayTrendHourMock[]
    return hours.filter((x) => x.hour <= nowHour)
  }, [hours, nowHour])

  const sumAl = pastHours.reduce((s, x) => s + x.alertCount, 0)
  const maxAl = Math.max(...pastHours.map((x) => x.alertCount), 1)
  const peak =
    pastHours.length > 0
      ? pastHours.reduce((a, b) => (b.alertCount > a.alertCount ? b : a), pastHours[0]!)
      : hours[0]!
  const last = pastHours[pastHours.length - 1] ?? hours[0]!
  const endHour = pastHours[pastHours.length - 1]?.hour ?? 0
  const W = 280
  const H = 140
  const pad = { t: 10, r: 10, b: 22, l: 28 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const xAtHour = (h: number) =>
    endHour <= 0 ? pad.l + iw : pad.l + (h / endHour) * iw
  const yAl = (v: number) => pad.t + ih - (v / maxAl) * ih
  const maxPpm = Math.max(...pastHours.map((x) => x.avgPpm), 1)
  const yPpm = (v: number) => pad.t + ih - (v / maxPpm) * ih
  const lineAl =
    pastHours.length > 0
      ? pastHours
          .map(
            (x, i) =>
              `${i ? 'L' : 'M'}${xAtHour(x.hour).toFixed(1)} ${yAl(x.alertCount).toFixed(1)}`
          )
          .join(' ')
      : ''
  const areaAl =
    pastHours.length > 0
      ? `${lineAl} L${xAtHour(endHour).toFixed(1)} ${(pad.t + ih).toFixed(1)} L${xAtHour(pastHours[0]!.hour).toFixed(1)} ${(pad.t + ih).toFixed(1)} Z`
      : ''
  const linePpm =
    pastHours.length > 0
      ? pastHours
          .map(
            (x, i) =>
              `${i ? 'L' : 'M'}${xAtHour(x.hour).toFixed(1)} ${yPpm(x.avgPpm).toFixed(1)}`
          )
          .join(' ')
      : ''
  /** maxAl=1이면 [0,1,1]이 되어 key 중복 → 유일화 */
  const yTicks = [...new Set([0, Math.ceil(maxAl / 2), maxAl])]
  const xLabels = buildTrendXLabels(endHour)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      <div className="flex shrink-0 gap-2">
        {(
          [
            { l: '오늘 경보', v: sumAl, u: '건', split: false },
            {
              l: '집중 시간',
              v: `${peak.hour}시`,
              u: `${peak.alertCount}건`,
              /** 시각·건수는 단위가 아니라 서로 다른 값 → 간격 넓힘 */
              split: true,
            },
            { l: '현재 평균 H₂S', v: last.avgPpm, u: 'ppm', split: false },
          ] as const
        ).map((t) => (
          <div
            key={t.l}
            className="flex min-h-[58px] flex-1 flex-col justify-center rounded-md bg-muted/50 px-2.5 py-2.5"
          >
            <div className="text-[12px] text-muted-foreground">{t.l}</div>
            <div className="mt-1 text-base font-extrabold tracking-tight text-foreground">
              {t.v}
              <small
                className={cn(
                  'text-[12px] font-medium text-muted-foreground',
                  t.split ? 'ml-2' : 'ml-0.5'
                )}
              >
                {t.u}
              </small>
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-evenly overflow-hidden">
        <div
          className="relative mx-auto w-full max-h-[min(100%,260px)] min-h-0 flex-1"
          style={{ aspectRatio: `${W} / ${H}`, maxHeight: '100%' }}
        >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          aria-label="오늘의 경보·H₂S 추이"
        >
          {yTicks.map((v) => (
            <line
              key={`g-${v}`}
              x1={pad.l}
              y1={yAl(v)}
              x2={W - pad.r}
              y2={yAl(v)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {yTicks.map((v) => (
            <text
              key={`yt-${v}`}
              x={pad.l - 4}
              y={yAl(v) + 3}
              textAnchor="end"
              fill="var(--muted-foreground)"
              fontSize={9}
            >
              {v}
            </text>
          ))}
          {xLabels.map((h) => (
            <text
              key={`xt-${h}`}
              x={xAtHour(h)}
              y={H - 6}
              textAnchor={h === 0 ? 'start' : h === endHour ? 'end' : 'middle'}
              fill="var(--muted-foreground)"
              fontSize={9}
            >
              {h}시
            </text>
          ))}
          {areaAl ? (
            <path
              d={areaAl}
              fill={`color-mix(in srgb, ${ODOR_LIVE_SEVERITY_HEX.bad} 22%, transparent)`}
              stroke="none"
            />
          ) : null}
          {lineAl ? (
            <path
              d={lineAl}
              fill="none"
              stroke={ODOR_LIVE_SEVERITY_HEX.bad}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {linePpm ? (
            <path
              d={linePpm}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              opacity={0.85}
            />
          ) : null}
          {pastHours.map((x) => (
            <circle
              key={x.hour}
              cx={xAtHour(x.hour)}
              cy={yAl(x.alertCount)}
              r={3.5}
              fill={ODOR_LIVE_SEVERITY_HEX.bad}
              stroke="var(--card)"
              strokeWidth={1.5}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                const box = e.currentTarget.ownerSVGElement?.parentElement
                if (!box) return
                const rct = box.getBoundingClientRect()
                const cr = e.currentTarget.getBoundingClientRect()
                setTip({
                  text: `${x.hour}시 · 경보 ${x.alertCount}건 · 평균 ${x.avgPpm}ppm`,
                  left: Math.min(rct.width - 8, Math.max(8, cr.left - rct.left + 8)),
                  top: Math.max(8, cr.top - rct.top - 28),
                })
              }}
              onMouseLeave={() => setTip(null)}
            />
          ))}
        </svg>
        {tip ? (
          <div
            className="pointer-events-none absolute z-[3] whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-[12px] shadow"
            style={{ left: tip.left, top: tip.top }}
          >
            {tip.text}
          </div>
        ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-5 px-2 pb-0.5 text-[12px] font-normal text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-0.5 w-3 rounded-sm"
              style={{ backgroundColor: ODOR_LIVE_SEVERITY_HEX.bad }}
            />
            경보 건수
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-3.5 border-t border-dashed border-slate-400" />
            평균 H₂S
          </span>
        </div>
      </div>
    </div>
  )
}

const tagBaseClass =
  'inline-flex h-[18px] min-w-[36px] shrink-0 items-center justify-center rounded-full px-2 text-center text-[12px] font-normal leading-none'

const COMPLAINT_STATUS_TONE: Record<
  OdorComplaintLinkMock['status'],
  'ok' | 'warn' | 'bad'
> = {
  접수: 'bad',
  처리중: 'warn',
  완료: 'ok',
}

/** 이상 지점 모드 우측 — 민원 현황 */
function ComplaintLinkPanel({
  items,
  onGoComplaint,
}: {
  items: OdorComplaintLinkMock[]
  onGoComplaint?: () => void
}) {
  const rows = useMemo(
    () =>
      [...items].sort((a, b) => {
        const rank = { 접수: 0, 처리중: 1, 완료: 2 } as const
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      }),
    [items]
  )
  const openCount = rows.filter((r) => r.status !== '완료').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 border-b border-border/50 px-2.5 py-2 text-[12px]">
        <span className="font-normal text-foreground">당일·최근 {rows.length}건</span>
        {openCount > 0 ? (
          <span className="font-normal text-red-400">미완료 {openCount}</span>
        ) : (
          <span className="font-normal text-emerald-400">미완료 없음</span>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((c) => {
          const tone = COMPLAINT_STATUS_TONE[c.status]
          return (
            <li key={c.id}>
              <button
                type="button"
                title="민원 관리로"
                onClick={() => onGoComplaint?.()}
                className="flex w-full cursor-pointer items-center gap-2 border-b border-border/50 px-2.5 py-2 text-left hover:bg-muted/40"
              >
                <span className={tagBaseClass} style={odorLiveSeverityTagStyle(tone)}>
                  {odorComplaintStatusLabel(c.status)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-normal text-foreground">{c.title}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {c.emdNm}
                    {c.sensorLabel ? ` · ${c.sensorLabel}` : ''}
                    {' · '}
                    {formatAlertTime(c.receivedAt).slice(5)}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 시안 G P01 — 실시간 통합 현황 풀패널 (KPI + 3열×2행 고정) */
export function OdorLiveStatusDashboard({ sensors, queriedAt, onGoMenu }: Props) {
  const resolved = useResolvedThemeSafe()
  const lightChrome = useOdorLightChrome()
  const lightB = resolved === 'light' && lightChrome === 'b'
  const { gradeCounts, points, emdStatuses, deviceTotal } = useMemo(
    () => buildDashboardGradeMock(sensors),
    [sensors]
  )
  /** 측정지점 카드 선택 시 우측 관제 지도 확대 + 저감 제어 바 */
  const [mapFocus, setMapFocus] = useState<MapFocusState | null>(null)
  /** 관제 지도 가동/중지 — 카드 표시에 반영 (세션 내 목업 오버라이드) */
  const [runningOverrides, setRunningOverrides] = useState<Record<string, boolean>>({})
  /** 조작 시 idle 타이머 연장용 (값 자체는 의미 없음) */
  const [focusIdleTick, setFocusIdleTick] = useState(0)
  const bumpMapFocusIdle = useCallback(() => {
    setFocusIdleTick((n) => n + 1)
  }, [])
  const clearMapFocus = useCallback(() => setMapFocus(null), [])
  const setFocusedRunning = useCallback((sensorKey: string, running: boolean) => {
    setRunningOverrides((m) =>
      m[sensorKey] === running ? m : { ...m, [sensorKey]: running }
    )
    setMapFocus((prev) =>
      prev && prev.sensorKey === sensorKey ? { ...prev, running } : prev
    )
  }, [])
  const groups = sumGradeGroup(gradeCounts)
  /** 선택 시 해당 지점으로 fit — 선택 중에는 사용자 줌·팬 비활성 */
  const focusMapPoints = useMemo(
    () => (mapFocus ? [mapFocus.point] : points),
    [mapFocus, points]
  )
  const focusEmdStatuses = useMemo((): EmdGradeStatusMock[] => {
    if (!mapFocus) return emdStatuses
    return [
      {
        emdCd: '',
        emdNm: mapFocus.point.emdNm,
        status: mapFocus.point.status,
      },
    ]
  }, [mapFocus, emdStatuses])
  const abatement = mockAbatementRunningCount(deviceTotal)
  const commRate = mockOverallCommRate(sensors)
  const trendHours = useMemo(() => buildTodayTrendMock(7), [])
  /** SSR hydration 방지 — 마운트 후 현재 시 (차트·패널 힌트 공유) */
  const [nowHour, setNowHour] = useState<number | null>(null)
  /** false면 KPI·측정지점만 — 미니맵/도넛은 idle 후 마운트 */
  const [heavyReady, setHeavyReady] = useState(false)
  useEffect(() => {
    const tick = () => setNowHour(new Date().getHours())
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    let cancelled = false
    let idleId: number | undefined
    let timeoutId: number | undefined
    const enable = () => {
      if (!cancelled) setHeavyReady(true)
    }
    const raf = window.requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(enable, { timeout: 450 })
      } else {
        timeoutId = window.setTimeout(enable, 120)
      }
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      if (idleId != null) window.cancelIdleCallback?.(idleId)
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [])
  /** 선택 유지 중 무조작이면 전체보기(선택 해제) */
  useEffect(() => {
    if (!mapFocus) return
    const id = window.setTimeout(clearMapFocus, MAP_FOCUS_IDLE_MS)
    return () => window.clearTimeout(id)
  }, [mapFocus, focusIdleTick, clearMapFocus])
  const trendRangeHint =
    nowHour == null ? '—' : nowHour === 0 ? '0시 기준' : `0~${nowHour}시 기준`
  /** 등급 분포는 실시간 스냅샷 — 힌트는 집계 시각, 고시 근거는 차트 하단 */
  const gradeDataHint = nowHour == null ? '—' : `오늘 ${nowHour}시 기준`
  const complaintItems = MOCK_ODOR_COMPLAINT_LINKS

  /** KPI 상단 띠 — 정상은 초록 유지, 본문 숫자는 무채 강조 규칙과 분리 */
  const KPI_STRIPE_HEX: Record<'ok' | 'warn' | 'bad', string> = {
    ok: '#22c55e',
    warn: ODOR_LIVE_SEVERITY_HEX.warn,
    bad: ODOR_LIVE_SEVERITY_HEX.bad,
  }

  const kpis: Array<{ label: string; value: number | string; unit: string; tone?: 'ok' | 'warn' | 'bad' }> = [
    { label: '측정지점', value: deviceTotal, unit: '개' },
    { label: '정상', value: groups.normal, unit: '개', tone: 'ok' },
    { label: '주의(3등급)', value: groups.caution, unit: '개', tone: 'warn' },
    { label: '경보(4·5)', value: groups.warning, unit: '개', tone: 'bad' },
    { label: '저감 가동', value: abatement, unit: '대' },
    { label: '통신율', value: commRate, unit: '%' },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      <div
        className="grid shrink-0 gap-2.5"
        style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            className={cn(
              'relative box-border flex min-w-0 flex-col justify-center overflow-hidden rounded-lg border px-3.5',
              lightB
                ? 'border-zinc-300 bg-white shadow-sm'
                : 'border-border bg-card'
            )}
            style={{ height: 80, minHeight: 80 }}
          >
            {k.tone ? (
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ backgroundColor: KPI_STRIPE_HEX[k.tone] }}
              />
            ) : null}
            <div className="truncate text-[12px] text-muted-foreground">{k.label}</div>
            <div
              className={cn(
                'mt-1 text-2xl font-extrabold tracking-tight',
                (!k.tone || !odorLiveSeverityIsAccent(k.tone)) && 'text-foreground'
              )}
              style={
                k.tone && odorLiveSeverityIsAccent(k.tone)
                  ? odorLiveSeverityColorStyle(k.tone)
                  : undefined
              }
            >
              {k.value}
              <small className="ml-0.5 text-[12px] font-medium text-muted-foreground">{k.unit}</small>
            </div>
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 gap-2.5 overflow-hidden"
        style={{
          gridTemplateColumns: 'minmax(200px, 0.85fr) minmax(0, 2.2fr) minmax(240px, 1fr)',
          /** 하단(오늘의 동향) 여백이 과하지 않게 소폭만 키움 */
          gridTemplateRows: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
          gridTemplateAreas: `
            "grade map recent"
            "trend map alarm"
          `,
        }}
      >
        <Panel
          title="악취 등급 분포"
          hint={gradeDataHint}
          className="min-h-0"
          style={{ gridArea: 'grade' }}
          bodyClassName="overflow-hidden"
        >
          {heavyReady ? (
            <OdorGradeDonutChart counts={gradeCounts} total={deviceTotal} />
          ) : (
            <HeavyPanelPlaceholder label="분포 준비 중…" />
          )}
        </Panel>

        <Panel
          title="시간대별 경보"
          hint={trendRangeHint}
          className="min-h-0"
          style={{ gridArea: 'trend' }}
          bodyClassName="flex flex-col overflow-hidden p-2"
        >
          <TodayTrendChart hours={trendHours} nowHour={nowHour} />
        </Panel>

        <Panel
          title="측정지점 현황"
          className="min-h-0 min-w-0"
          style={{ gridArea: 'map' }}
          bodyClassName="flex flex-col overflow-hidden p-0"
        >
          <div
            className="relative min-h-0 flex-1"
            onPointerDownCapture={() => {
              if (mapFocus) bumpMapFocusIdle()
            }}
          >
            <OdorControlStatusOverview
              points={points}
              focusedSensorKey={mapFocus?.sensorKey ?? null}
              runningOverrides={runningOverrides}
              onPointFocus={(payload) => setMapFocus(payload)}
              className="h-full w-full"
            />
          </div>
        </Panel>

        <Panel
            title={
              mapFocus ? (
                <span className="min-w-0 truncate text-sky-300">{mapFocus.point.label}</span>
              ) : (
                '관제 지도'
              )
            }
            hint={
              <button
                type="button"
                title={mapFocus ? '자세히 보기' : '지도에서 보기'}
                onClick={() => {
                  if (mapFocus) bumpMapFocusIdle()
                  onGoMenu?.('controlMap', {
                    sensorKey: mapFocus?.sensorKey || undefined,
                  })
                }}
                className="h-6 shrink-0 cursor-pointer text-[12px] font-normal text-muted-foreground hover:text-foreground hover:underline"
              >
                {mapFocus ? '자세히 보기 →' : '지도에서 보기 →'}
              </button>
            }
            className="min-h-0 min-w-0"
            style={{ gridArea: 'recent' }}
            bodyClassName="flex flex-col overflow-hidden p-0"
          >
            <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border/60 px-2 py-1 text-[12px] font-normal">
              <span
                className="inline-flex items-center gap-1 font-normal"
                style={{ color: '#22c55e' }}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                정상
              </span>
              <span
                className="inline-flex items-center gap-1 font-normal"
                style={odorLiveSeverityColorStyle('warn')}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                주의
              </span>
              <span
                className="inline-flex items-center gap-1 font-normal"
                style={odorLiveSeverityColorStyle('bad')}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                경보
              </span>
            </div>
            <div
              className="relative min-h-0 flex-1"
              onPointerDownCapture={() => {
                if (mapFocus) bumpMapFocusIdle()
              }}
            >
              {heavyReady ? (
                <OdorIndexMiniMap
                  key={mapFocus?.sensorKey ?? 'overview'}
                  embedded
                  interactive={!mapFocus}
                  points={focusMapPoints}
                  emdStatuses={focusEmdStatuses}
                  highlightSensorKey={mapFocus?.sensorKey ?? null}
                  showOpenMapButton={false}
                  pulseAlertPoints={
                    mapFocus ? mapFocus.point.status === 'warning' : true
                  }
                  fitMaxZoom={mapFocus ? 18 : 15}
                  fitBufferMeters={mapFocus ? 45 : 200}
                  onPointClick={(sensorKey) => {
                    const hit = points.find((p) => {
                      const key = p.id.startsWith('pt-') ? p.id.slice(3) : p.id
                      return key === sensorKey
                    })
                    if (!hit) {
                      onGoMenu?.('controlMap', { sensorKey: sensorKey || undefined })
                      return
                    }
                    const online = mockPointCommOnline(sensorKey, hit.agency)
                    const override = runningOverrides[sensorKey]
                    const running =
                      online &&
                      (override !== undefined
                        ? override
                        : mockPointAbatementRunning(sensorKey, hit.status))
                    setMapFocus({
                      point: hit,
                      sensorKey,
                      online,
                      running,
                    })
                  }}
                  className="h-full w-full rounded-none border-0"
                />
              ) : (
                <HeavyPanelPlaceholder label="지도 준비 중…" />
              )}
              {mapFocus ? (
                <>
                  <div className="pointer-events-none absolute left-2 top-2 z-[2] max-w-[min(100%-1rem,280px)] rounded-md border border-border/80 bg-card/95 px-2.5 py-2 shadow-md backdrop-blur-sm">
                    {(() => {
                      const p = mapFocus.point
                      const ppm = mockPpmFromGrade(
                        p.grade,
                        Number.parseInt(mapFocus.sensorKey, 10) || 0
                      )
                      const severity = odorLiveSeverityFromGrade(p.grade)
                      const gradeLabel = odorLiveSeverityLabel(p.grade)
                      const gap =
                        mapFocus.online && p.status !== 'normal' && !mapFocus.running
                      const abatementHex = mapFocus.running
                        ? '#22c55e'
                        : ODOR_LIVE_SEVERITY_HEX.warn
                      const commHex = mapFocus.online
                        ? '#22c55e'
                        : ODOR_LIVE_SEVERITY_HEX.bad
                      return (
                        <div className="flex flex-col gap-1.5 text-[12px] leading-none">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">시각</span>
                            <span className="tabular-nums text-foreground">
                              {formatOverlayQueryTime(queriedAt)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">H₂S</span>
                            <span className="tabular-nums text-foreground">
                              {ppm.toFixed(1)} ppm
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">등급</span>
                            <span
                              className="tabular-nums"
                              style={{
                                color: odorLiveSeverityIsAccent(severity)
                                  ? ODOR_LIVE_SEVERITY_HEX[severity]
                                  : undefined,
                              }}
                            >
                              {p.grade}등급·{gradeLabel}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">통신</span>
                            <span
                              className="inline-flex items-center gap-1"
                              style={{ color: commHex }}
                            >
                              {mapFocus.online ? (
                                <Wifi className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                              ) : (
                                <WifiOff className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                              )}
                              {mapFocus.online ? '정상' : '오류'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">저감</span>
                            {!mapFocus.online ? (
                              <span
                                className="inline-flex items-center gap-1"
                                style={{ color: ODOR_LIVE_SEVERITY_HEX.bad }}
                              >
                                <AlertTriangle
                                  className="h-3 w-3"
                                  strokeWidth={2.2}
                                  aria-hidden
                                />
                                제어 불가
                              </span>
                            ) : gap ? (
                              <span
                                className="inline-flex items-center gap-1"
                                style={{ color: ODOR_LIVE_ACTION_HEX }}
                              >
                                <AlertTriangle
                                  className="h-3 w-3"
                                  strokeWidth={2.2}
                                  aria-hidden
                                />
                                가동 필요
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1"
                                style={{ color: abatementHex }}
                              >
                                <Fan
                                  className={cn(
                                    'h-3 w-3',
                                    mapFocus.running && 'animate-spin'
                                  )}
                                  style={
                                    mapFocus.running
                                      ? { animationDuration: '2.4s' }
                                      : undefined
                                  }
                                  strokeWidth={2.2}
                                  aria-hidden
                                />
                                {mapFocus.running ? '가동중' : '대기'}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                  <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[2] flex items-center gap-1.5 border-t border-border/70 bg-card/95 px-2 py-1 shadow-[0_-6px_16px_rgba(0,0,0,0.25)] backdrop-blur-sm">
                    <button
                      type="button"
                      disabled={!mapFocus.online || mapFocus.running}
                      title={
                        !mapFocus.online
                          ? '통신오류 · 제어 불가'
                          : mapFocus.running
                            ? '가동중'
                            : '저감설비 가동'
                      }
                      onClick={() => setFocusedRunning(mapFocus.sensorKey, true)}
                      className={cn(
                        'h-7 flex-1 rounded text-[12px] font-bold',
                        !mapFocus.online
                          ? 'cursor-not-allowed border border-border bg-muted/30 text-muted-foreground opacity-60'
                          : mapFocus.running
                            ? 'cursor-default border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'cursor-pointer border border-border bg-muted/40 text-foreground hover:bg-emerald-500/20 hover:text-emerald-300'
                      )}
                    >
                      가동
                    </button>
                    <button
                      type="button"
                      disabled={!mapFocus.online || !mapFocus.running}
                      title={
                        !mapFocus.online
                          ? '통신오류 · 제어 불가'
                          : !mapFocus.running
                            ? '대기'
                            : '저감설비 중지'
                      }
                      onClick={() => setFocusedRunning(mapFocus.sensorKey, false)}
                      className={cn(
                        'h-7 flex-1 rounded text-[12px] font-bold',
                        !mapFocus.online
                          ? 'cursor-not-allowed border border-border bg-muted/30 text-muted-foreground opacity-60'
                          : !mapFocus.running
                            ? 'cursor-default border border-red-500/40 bg-red-500/15 text-red-300'
                            : 'cursor-pointer border border-border bg-muted/40 text-foreground hover:bg-red-500/20 hover:text-red-300'
                      )}
                    >
                      중지
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </Panel>
        <Panel
          title="민원 현황"
          hint={
            <button
              type="button"
              title="자세히 보기"
              className="h-6 shrink-0 cursor-pointer text-[12px] font-normal text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => onGoMenu?.('complaintManage')}
            >
              자세히 보기 →
            </button>
          }
          className="min-h-0"
          style={{ gridArea: 'alarm' }}
          bodyClassName="overflow-hidden p-0"
        >
          <ComplaintLinkPanel
            items={complaintItems}
            onGoComplaint={() => onGoMenu?.('complaintManage')}
          />
        </Panel>
      </div>
    </div>
  )
}
