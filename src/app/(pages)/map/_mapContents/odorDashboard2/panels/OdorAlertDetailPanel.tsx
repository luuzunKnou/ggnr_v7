'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, Settings } from 'lucide-react'
import {
  buildOdorAlertDetailMock,
  type MaintenanceRow,
  type TrendPoint,
  type TrendRange,
} from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'
import { downloadExcelWithPledge } from '@/app/(pages)/_components/securityPledge/excelPledgeGate'
import type { OdorStationRow } from '../odorDashboard2StationRows'
import {
  buildTrendCompareSeries,
  COMPARE_RANGE_FILE,
  COMPARE_RANGE_OPTIONS,
  type CompareRange,
} from '../odorDashboard2TrendCompareMock'
import { OdorDeviceSettingsModal } from './OdorDeviceSettingsModal'
import { OdorMultiStationPickModal } from './OdorMultiStationPickModal'

const OdorAlertPpmChart = dynamic(
  () => import('./OdorAlertPpmChart').then((m) => m.OdorAlertPpmChart),
  { ssr: false }
)

const OdorAlertTrendChart = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPh/OdorAlertTrendChart').then(
      (m) => m.OdorAlertTrendChart
    ),
  { ssr: false }
)

const OdorTrendCompareChart = dynamic(
  () => import('./OdorTrendCompareChart').then((m) => m.OdorTrendCompareChart),
  { ssr: false }
)

type ChartSectionTab = 'trend' | 'compare'

const TREND_TABS: Array<{ key: TrendRange; label: string }> = [
  { key: '24h', label: '24시간' },
  { key: 'week', label: '주간' },
  { key: 'month', label: '월간' },
]

const TREND_RANGE_FILE: Record<TrendRange, string> = {
  '24h': '24h',
  week: 'week',
  month: 'month',
}

function escapeCsvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** 경향 그래프 포인트 → CSV 다운로드 (UTF-8 BOM) */
function downloadTrendCsv(opts: {
  sensorKorNm: string
  sensorNm: string
  agency: string
  range: TrendRange
  thresholdPpm: number
  points: TrendPoint[]
}) {
  const rangeLabel = TREND_TABS.find((t) => t.key === opts.range)?.label ?? opts.range
  const lines = [
    `# 센서,${escapeCsvCell(opts.sensorKorNm)}`,
    `# 센서명,${escapeCsvCell(opts.sensorNm)}`,
    `# 업체,${escapeCsvCell(opts.agency)}`,
    `# 기간,${escapeCsvCell(rangeLabel)}`,
    `# 자동가동기준ppm,${opts.thresholdPpm.toFixed(1)}`,
    '시각,ppm,저감가동',
    ...opts.points.map(
      (p) =>
        `${escapeCsvCell(p.label)},${p.ppm.toFixed(1)},${p.running ? '가동' : '정지'}`
    ),
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const safeName = opts.sensorKorNm.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const fileName = `악취경향_${safeName}_${TREND_RANGE_FILE[opts.range]}.csv`
  //		TODO : 악취 기능 연결 레이어 테이블의 SHP/엑셀(엑셀) 권한 적용 필요 (tableName·tableNames 전달)
  downloadExcelWithPledge({
    data: blob,
    fileName,
    tableKorName: fileName.replace(/\.csv$/i, '') || '악취경향',
  })
}

const MAINT_PAGE_SIZE = 7

const SEARCH_INPUT_CLASS =
  'standard-search-input focus:border-primary focus:ring-0 focus:ring-offset-0'

type MaintSortKey = 'date' | 'category' | 'inspector' | 'content'
type SortDir = 'asc' | 'desc'

const MAINT_COLUMNS: Array<{ key: MaintSortKey; label: string; className: string }> = [
  { key: 'date', label: '일자', className: 'w-[96px] min-w-[96px]' },
  { key: 'category', label: '구분', className: 'w-[76px] min-w-[76px]' },
  { key: 'inspector', label: '점검자', className: 'w-[72px] min-w-[72px]' },
  { key: 'content', label: '내용', className: '' },
]

type Props = {
  alert: OdorAlertItem
  /** flex: 섹션을 flex로 나열 (하단 시트 등) */
  layout?: 'grid' | 'flex'
  /** 추이비교 다중 지점 선택용 목록 */
  stations?: OdorStationRow[]
}

function downloadCompareCsv(opts: {
  range: CompareRange
  thresholdPpm: number
  series: Array<{ label: string; points: TrendPoint[] }>
}) {
  const rangeLabel =
    COMPARE_RANGE_OPTIONS.find((t) => t.key === opts.range)?.label ?? opts.range
  const labels = opts.series[0]?.points.map((p) => p.label) ?? []
  const header = [
    '시각',
    ...opts.series.flatMap((s) => [`${s.label}_ppm`, `${s.label}_저감가동`]),
  ]
  const lines = [
    `# 기간,${escapeCsvCell(rangeLabel)}`,
    `# 자동가동기준ppm,${opts.thresholdPpm.toFixed(1)}`,
    header.map(escapeCsvCell).join(','),
    ...labels.map((label, i) => {
      const cells = [escapeCsvCell(label)]
      for (const s of opts.series) {
        const p = s.points[i]
        cells.push(p ? p.ppm.toFixed(1) : '')
        cells.push(p ? (p.running ? '가동' : '정지') : '')
      }
      return cells.join(',')
    }),
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const fileName = `악취추이비교_${COMPARE_RANGE_FILE[opts.range]}.csv`
  //		TODO : 악취 기능 연결 레이어 테이블의 SHP/엑셀(엑셀) 권한 적용 필요 (tableName·tableNames 전달)
  downloadExcelWithPledge({
    data: blob,
    fileName,
    tableKorName: fileName.replace(/\.csv$/i, '') || '악취추이비교',
  })
}

function compareMaint(a: MaintenanceRow, b: MaintenanceRow, key: MaintSortKey): number {
  return a[key].localeCompare(b[key], 'ko')
}

function Section({
  title,
  header,
  children,
  className,
  bodyClassName,
  action,
}: {
  title?: string
  /** 제목 자리 대체 (탭 등) — 지정 시 title·action 미사용 */
  header?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  action?: ReactNode
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded border border-border bg-background px-2 py-1.5',
        className
      )}
    >
      {header ? (
        <div className="mb-1 shrink-0">{header}</div>
      ) : (
        <div className="mb-1 flex shrink-0 items-center justify-between gap-1">
          {title ? (
            <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className={cn('min-h-0', bodyClassName)}>{children}</div>
    </section>
  )
}

function TrendLegend({ running }: { running: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-3 rounded-sm bg-emerald-500/30" aria-hidden />
        정상
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-3 rounded-sm border border-dashed border-border" aria-hidden />
        주의
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-3 rounded-sm bg-red-400/30" aria-hidden />
        경보
      </span>
      <span className="inline-flex items-center gap-1" title={running ? '가동' : '정지'}>
        <span
          className={cn(
            'inline-block h-2 w-2 rounded-full border',
            running ? 'border-emerald-500 bg-emerald-500' : 'border-slate-400 bg-background'
          )}
          aria-hidden
        />
        {running ? '가동' : '정지'}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-3 border-t border-dashed border-red-500" aria-hidden />
        자동가동 기준
      </span>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] leading-snug">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground" title={value}>
        {value}
      </span>
    </div>
  )
}

function pageMeta(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  const hasNext = safePage * pageSize < total
  return { pageCount, safePage, from, to, hasNext }
}

function MaintPager({
  total,
  page,
  onPageChange,
}: {
  total: number
  page: number
  onPageChange: (page: number) => void
}) {
  const { from, to, hasNext } = pageMeta(total, page, MAINT_PAGE_SIZE)
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
      <span className="text-[11px] text-muted-foreground">
        {total === 0 ? '0건' : `${from}–${to} / ${total.toLocaleString()}건`}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="이전"
          disabled={page <= 1}
          className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          이전
        </button>
        <span className="px-1.5 text-[11px] text-muted-foreground">{page}페이지</span>
        <button
          type="button"
          title="다음"
          disabled={!hasNext}
          className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(page + 1)}
        >
          다음
        </button>
      </div>
    </div>
  )
}

/** 경보 행 상세 — 2:1.5 격자 + 하단 유지관리(잔여 높이·검색·페이지) */
export function OdorAlertDetailPanel({
  alert,
  layout = 'grid',
  stations = [],
}: Props) {
  const isFlex = layout === 'flex'
  const detail = useMemo(() => buildOdorAlertDetailMock(alert), [alert])
  const currentStationId = useMemo(() => {
    if (alert.id.startsWith('st-')) return alert.id.slice(3)
    const byNm = stations.find(
      (s) => s.sensorNm === alert.sensorNm || s.sensorKorNm === alert.sensorKorNm
    )
    return byNm?.id ?? alert.id
  }, [alert, stations])
  const [chartTab, setChartTab] = useState<ChartSectionTab>('trend')
  const [trendRange, setTrendRange] = useState<TrendRange>('24h')
  const [compareRange, setCompareRange] = useState<CompareRange>('24h')
  const [compareStationIds, setCompareStationIds] = useState<string[]>([])
  const [pickOpen, setPickOpen] = useState(false)
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false)
  const [maintKeyword, setMaintKeyword] = useState('')
  const [maintPage, setMaintPage] = useState(1)
  /** null = 정렬 해제(원복, 원본 순서). 동일 컬럼 3클릭 시 null */
  const [maintSort, setMaintSort] = useState<{
    key: MaintSortKey
    dir: SortDir
  } | null>(null)

  useEffect(() => {
    setCompareStationIds([currentStationId])
    setChartTab('trend')
    setCompareRange('24h')
  }, [currentStationId])

  const compareStations = useMemo(() => {
    const byId = new Map(stations.map((s) => [s.id, s]))
    const ids =
      compareStationIds.length > 0 ? compareStationIds : [currentStationId]
    const picked = ids
      .map((id) => byId.get(id))
      .filter((s): s is OdorStationRow => Boolean(s))
    if (picked.length > 0) return picked
    const fallback = byId.get(currentStationId)
    if (fallback) return [fallback]
    return [
      {
        id: currentStationId,
        sensorKey: Number(currentStationId) || 0,
        sensorKorNm: alert.sensorKorNm,
        sensorNm: alert.sensorNm,
        agency: alert.agency,
        emdNm: alert.emdNm,
        lon: 0,
        lat: 0,
        grade: alert.grade,
        status: alert.grade >= 4 ? 'warning' : alert.grade === 3 ? 'caution' : 'normal',
        ppm: alert.ppm,
        abatementRunning: alert.abatementRunning,
        online: true,
      } satisfies OdorStationRow,
    ]
  }, [stations, compareStationIds, currentStationId, alert])

  const compareBundle = useMemo(
    () =>
      buildTrendCompareSeries({
        stations: compareStations,
        range: compareRange,
        thresholdPpm: detail.abatement.thresholdPpm,
      }),
    [compareStations, compareRange, detail.abatement.thresholdPpm]
  )

  const filteredMaint = useMemo(() => {
    const kw = maintKeyword.trim().toLowerCase()
    let list = detail.maintenance
    if (kw) {
      list = list.filter(
        (row) =>
          row.date.toLowerCase().includes(kw) ||
          row.category.toLowerCase().includes(kw) ||
          row.inspector.toLowerCase().includes(kw) ||
          row.content.toLowerCase().includes(kw)
      )
    }
    if (!maintSort) return list
    const sign = maintSort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => sign * compareMaint(a, b, maintSort.key))
  }, [detail.maintenance, maintKeyword, maintSort])

  const maintPageCount = pageMeta(filteredMaint.length, maintPage, MAINT_PAGE_SIZE).pageCount

  useEffect(() => {
    setMaintPage(1)
  }, [maintKeyword, maintSort, alert.id])

  useEffect(() => {
    if (maintPage > maintPageCount) setMaintPage(maintPageCount)
  }, [maintPage, maintPageCount])

  const pagedMaint = useMemo(() => {
    const start = (maintPage - 1) * MAINT_PAGE_SIZE
    return filteredMaint.slice(start, start + MAINT_PAGE_SIZE)
  }, [filteredMaint, maintPage])

  /** 1:초기방향 → 2:반대 → 3:원복(null). 일자는 초기 내림차순 */
  const toggleMaintSort = (key: MaintSortKey) => {
    const initialDir: SortDir = key === 'date' ? 'desc' : 'asc'
    const opposite: SortDir = initialDir === 'asc' ? 'desc' : 'asc'
    setMaintSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: initialDir }
      if (prev.dir === initialDir) return { key, dir: opposite }
      return null
    })
  }

  const commDot =
    detail.comm.rate >= 90 ? 'bg-emerald-500' : detail.comm.rate >= 80 ? 'bg-amber-400' : 'bg-red-500'

  const chartSectionTabs = (
    <div
      className="flex items-end gap-0 border-b border-border"
      role="tablist"
      aria-label="농도•경향·추이비교"
    >
      {(
        [
          { key: 'trend' as const, label: '농도•경향' },
          { key: 'compare' as const, label: '추이비교' },
        ] as const
      ).map((tab) => {
        const active = chartTab === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            title={tab.label}
            onClick={() => setChartTab(tab.key)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-2.5 pb-1.5 pt-0.5 text-[13px] font-semibold transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )

  const csvBtnClass =
    'inline-flex h-7 cursor-pointer items-center gap-0.5 rounded border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground'

  const rangeChipClass = (active: boolean) =>
    cn(
      'inline-flex h-7 cursor-pointer items-center rounded border px-1.5 text-[11px] font-medium transition-colors',
      active
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
    )

  const trendRangeActions = (
    <div className="flex flex-wrap items-center justify-between gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="shrink-0 text-[11px] text-muted-foreground">시간 범위</span>
        <div className="flex flex-wrap gap-0.5">
          {TREND_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              title={tab.label}
              onClick={() => setTrendRange(tab.key)}
              className={rangeChipClass(trendRange === tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        title="CSV 내보내기 — 그래프 데이터를 파일로 저장합니다"
        onClick={() =>
          downloadTrendCsv({
            sensorKorNm: detail.alert.sensorKorNm,
            sensorNm: detail.alert.sensorNm,
            agency: detail.alert.agency,
            range: trendRange,
            thresholdPpm: detail.abatement.thresholdPpm,
            points: detail.trends[trendRange],
          })
        }
        className={cn(csvBtnClass, 'shrink-0')}
      >
        <Download className="h-3 w-3 shrink-0" aria-hidden />
        CSV
      </button>
    </div>
  )

  const compareRangeActions = (
    <div className="flex flex-col gap-1">
      <div className="flex shrink-0">
        <button
          type="button"
          title="다중 측정 지점 선택"
          onClick={() => setPickOpen(true)}
          className="inline-flex h-7 cursor-pointer items-center rounded border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          다중 측정 지점 선택
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="shrink-0 text-[11px] text-muted-foreground">시간 범위</span>
          <div className="flex flex-wrap gap-0.5">
            {COMPARE_RANGE_OPTIONS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                title={tab.label}
                onClick={() => setCompareRange(tab.key)}
                className={rangeChipClass(compareRange === tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          title="CSV 내보내기"
          onClick={() =>
            downloadCompareCsv({
              range: compareRange,
              thresholdPpm: detail.abatement.thresholdPpm,
              series: compareBundle.series,
            })
          }
          className={cn(csvBtnClass, 'shrink-0')}
        >
          <Download className="h-3 w-3 shrink-0" aria-hidden />
          CSV
        </button>
      </div>
    </div>
  )

  const chartTabBody =
    chartTab === 'trend' ? (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
        <div className="shrink-0">{trendRangeActions}</div>
        <div className="shrink-0 rounded border border-border/60 px-1.5 py-1">
          <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">현재 농도</p>
          <OdorAlertPpmChart ppm={detail.alert.ppm} grade={detail.alert.grade} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
          <p className="shrink-0 text-[11px] font-medium text-muted-foreground">경향</p>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <OdorAlertTrendChart
              points={detail.trends[trendRange]}
              thresholdPpm={detail.abatement.thresholdPpm}
              zones={detail.zones}
              className="h-full min-h-[140px] w-full"
            />
          </div>
          <TrendLegend running={detail.abatement.running} />
        </div>
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
        <div className="shrink-0">{compareRangeActions}</div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <OdorTrendCompareChart
            series={compareBundle.series}
            thresholdPpm={detail.abatement.thresholdPpm}
            zones={compareBundle.zones}
          />
        </div>
        <TrendLegend running={detail.abatement.running} />
        <p className="shrink-0 text-[10px] text-muted-foreground">
          △ 저감 가동 시작 · ▽ 저감 가동 완료 · 가동 구간은 선이 더 굵게 표시됩니다
        </p>
      </div>
    )

  const deviceSettingsAction = (
    <button
      type="button"
      title="측정 기기 설정"
      onClick={() => setDeviceSettingsOpen(true)}
      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Settings className="h-3.5 w-3.5" aria-hidden />
    </button>
  )

  const deviceSettingsModal = (
    <OdorDeviceSettingsModal
      open={deviceSettingsOpen}
      agency={detail.device.agency || alert.agency}
      sensorLabel={detail.device.sensorKorNm}
      onClose={() => setDeviceSettingsOpen(false)}
    />
  )

  const deviceBlock = (
    <div className="space-y-1">
      <InfoRow label="센서" value={detail.device.sensorKorNm} />
      <InfoRow label="센서명" value={detail.device.sensorNm} />
      <InfoRow label="기기 종류" value={detail.device.kind} />
      <InfoRow label="모델" value={detail.device.model} />
      <InfoRow label="전원" value={detail.device.power} />
      <InfoRow label="고장 여부" value={detail.device.fault ? '고장' : '정상'} />
      <InfoRow label="읍면동" value={detail.device.emdNm} />
    </div>
  )

  const commBlock = (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 text-[12px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', commDot)}
            title={`통신 정상율 ${detail.comm.rate.toFixed(1)}%`}
            aria-label="통신 상태"
          />
          <span className="font-medium text-foreground">
            통신 {detail.comm.online ? '정상' : '불량'}
          </span>
        </div>
        <span className="tabular-nums text-muted-foreground">
          {detail.comm.rate.toFixed(1)}%
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{detail.comm.statusNote}</p>
    </div>
  )

  const abatementBlock = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[12px] text-muted-foreground">운전 상태</span>
        <span
          className={cn(
            'standard-filter-chip pointer-events-none',
            detail.abatement.running
              ? 'border-sky-500 bg-sky-500/15 text-sky-700 dark:border-sky-400 dark:bg-sky-400/20 dark:text-sky-300'
              : 'text-muted-foreground'
          )}
          title={detail.abatement.running ? '가동중' : '미가동'}
        >
          {detail.abatement.running ? '가동중' : '미가동'}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="shrink-0 pb-0.5 text-[12px] text-muted-foreground">가동 기준</span>
        <span
          className="text-[18px] font-semibold tabular-nums text-sky-600 dark:text-sky-400"
          title={`${detail.abatement.thresholdPpm.toFixed(1)} ppm`}
        >
          {detail.abatement.thresholdPpm.toFixed(1)}
          <span className="ml-0.5 text-[12px] font-normal text-sky-600/80 dark:text-sky-400/80">
            ppm
          </span>
        </span>
      </div>
    </div>
  )

  const maintBody = (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">통합검색</span>
        <div className="standard-search-wrap min-w-0 flex-1">
          <Search className="standard-search-icon" aria-hidden />
          <input
            type="search"
            value={maintKeyword}
            onChange={(e) => setMaintKeyword(e.target.value)}
            placeholder="통합검색"
            title="통합검색"
            className={SEARCH_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
        <div className="standard-list-scroll min-h-0 flex-1">
          <table className="w-full min-w-0 table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col style={{ width: 96 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 72 }} />
              <col />
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                {MAINT_COLUMNS.map((col) => {
                  const active = Boolean(maintSort && maintSort.key === col.key)
                  const dir = active ? maintSort!.dir : null
                  const initialDir: SortDir = col.key === 'date' ? 'desc' : 'asc'
                  const Icon = !active
                    ? ArrowUpDown
                    : dir === 'asc'
                      ? ArrowUp
                      : ArrowDown
                  const tight = col.key !== 'content'
                  const sortTitle = !active
                    ? `${col.label} 정렬`
                    : dir === initialDir
                      ? `${col.label} 방향 바꾸기`
                      : `${col.label} 정렬 해제`
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'standard-table-th standard-table-th-left border-r border-border last:border-r-0',
                        tight && 'max-w-none'
                      )}
                    >
                      <button
                        type="button"
                        title={sortTitle}
                        onClick={() => toggleMaintSort(col.key)}
                        className={cn(
                          'standard-sort-button standard-sort-button-left cursor-pointer',
                          active && 'standard-sort-button-active'
                        )}
                      >
                        <span className={tight ? 'whitespace-nowrap' : 'truncate'}>
                          {col.label}
                        </span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {pagedMaint.length === 0 ? (
                <tr>
                  <td colSpan={4} className="standard-table-empty">
                    이력이 없습니다.
                  </td>
                </tr>
              ) : (
                pagedMaint.map((row) => (
                  <tr key={row.id} className="standard-list-row">
                    <td
                      className="max-w-none whitespace-nowrap border-r border-border/60 px-1.5 py-1.5 align-middle tabular-nums leading-none"
                      title={row.date}
                    >
                      {row.date}
                    </td>
                    <td
                      className="max-w-none whitespace-nowrap border-r border-border/60 px-1.5 py-1.5 align-middle leading-none"
                      title={row.category}
                    >
                      {row.category}
                    </td>
                    <td
                      className="max-w-none whitespace-nowrap border-r border-border/60 px-1.5 py-1.5 align-middle leading-none"
                      title={row.inspector}
                    >
                      {row.inspector}
                    </td>
                    <td className="max-w-0 truncate px-1.5 py-1.5 align-middle leading-none" title={row.content}>
                      {row.content}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <MaintPager
          total={filteredMaint.length}
          page={maintPage}
          onPageChange={setMaintPage}
        />
      </div>
    </>
  )

  /** 플로팅 모달: 측정·통신·저감(상하) | 농도·경향 | 유지관리 */
  if (isFlex) {
    return (
      <div className="flex min-h-0 flex-1 gap-1.5 overflow-hidden">
        <div className="flex min-h-0 min-w-[11rem] max-w-[15rem] flex-[0.85] flex-col gap-1.5 overflow-hidden">
          <Section
            title="측정 기기"
            action={deviceSettingsAction}
            className="min-h-0 shrink-0"
            bodyClassName="flex flex-col gap-1.5"
          >
            {deviceBlock}
          </Section>
          <Section
            title="통신 정보"
            className="min-h-0 shrink-0"
            bodyClassName="flex flex-col gap-1"
          >
            {commBlock}
          </Section>
          <Section
            title="저감설비"
            className="min-h-0 flex-1"
            bodyClassName="flex flex-col gap-1.5 overflow-y-auto"
          >
            {abatementBlock}
          </Section>
        </div>

        <Section
          header={chartSectionTabs}
          className="min-h-0 min-w-0 flex-[1.15]"
          bodyClassName="flex min-h-0 flex-1 flex-col gap-1.5"
        >
          {chartTabBody}
        </Section>

        <Section
          title="유지관리 이력"
          className="min-h-0 min-w-0 flex-[1.35]"
          bodyClassName="flex min-h-0 flex-1 flex-col gap-1.5"
        >
          {maintBody}
        </Section>

        <OdorMultiStationPickModal
          open={pickOpen}
          stations={stations}
          currentStationId={currentStationId}
          selectedIds={
            compareStationIds.length > 0 ? compareStationIds : [currentStationId]
          }
          onConfirm={setCompareStationIds}
          onClose={() => setPickOpen(false)}
        />
        {deviceSettingsModal}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      <div className="grid shrink-0 grid-cols-[2fr_1.5fr] grid-rows-[auto_auto_auto] gap-1.5">
        <Section title="측정 기기" action={deviceSettingsAction}>
          {deviceBlock}
        </Section>
        <Section title="통신 정보">{commBlock}</Section>
        <Section title="저감설비" className="col-span-2">
          {abatementBlock}
        </Section>
      </div>

      <Section
        header={chartSectionTabs}
        className="min-h-0 flex-1"
        bodyClassName="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto"
      >
        {chartTabBody}
      </Section>

      <Section
        title="유지관리 이력"
        className="min-h-0 flex-1"
        bodyClassName="flex min-h-0 flex-1 flex-col gap-1.5"
      >
        {maintBody}
      </Section>

      <OdorMultiStationPickModal
        open={pickOpen}
        stations={stations}
        currentStationId={currentStationId}
        selectedIds={
          compareStationIds.length > 0 ? compareStationIds : [currentStationId]
        }
        onConfirm={setCompareStationIds}
        onClose={() => setPickOpen(false)}
      />
      {deviceSettingsModal}
    </div>
  )
}
