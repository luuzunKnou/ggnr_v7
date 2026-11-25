'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react'
import {
  buildOdorAlertDetailMock,
  type MaintenanceRow,
  type TrendPoint,
  type TrendRange,
} from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { downloadExcelWithPledge } from '@/app/(pages)/_components/securityPledge/excelPledgeGate'
import { cn } from '@/lib/utils'

const OdorAlertPpmChart = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPh/OdorAlertPpmChart').then((m) => m.OdorAlertPpmChart),
  { ssr: false }
)

const OdorAlertTrendChart = dynamic(
  () =>
    import('@/app/(pages)/(index)/odorPh/OdorAlertTrendChart').then(
      (m) => m.OdorAlertTrendChart
    ),
  { ssr: false }
)

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
  { key: 'date', label: '일자', className: 'w-[18%]' },
  { key: 'category', label: '구분', className: 'w-[20%]' },
  { key: 'inspector', label: '점검자', className: 'w-[16%]' },
  { key: 'content', label: '내용', className: '' },
]

type Props = {
  alert: OdorAlertItem
}

function compareMaint(a: MaintenanceRow, b: MaintenanceRow, key: MaintSortKey): number {
  return a[key].localeCompare(b[key], 'ko')
}

function Section({
  title,
  children,
  className,
  bodyClassName,
  action,
}: {
  title: string
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
      <div className="mb-1 flex shrink-0 items-center justify-between gap-1">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {action}
      </div>
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
export function OdorAlertDetailPanel({ alert }: Props) {
  const detail = useMemo(() => buildOdorAlertDetailMock(alert), [alert])
  const [trendRange, setTrendRange] = useState<TrendRange>('24h')
  const [maintKeyword, setMaintKeyword] = useState('')
  const [maintPage, setMaintPage] = useState(1)
  const [maintSort, setMaintSort] = useState<{ key: MaintSortKey; dir: SortDir }>({
    key: 'date',
    dir: 'desc',
  })

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

  const toggleMaintSort = (key: MaintSortKey) => {
    setMaintSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const commDot =
    detail.comm.rate >= 90 ? 'bg-emerald-500' : detail.comm.rate >= 80 ? 'bg-amber-400' : 'bg-red-500'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      {/* 상단 2행 × 2열 (약 2 : 1.5) — 행 높이는 내용물 기준 */}
      <div className="grid shrink-0 grid-cols-[2fr_1.5fr] grid-rows-[auto_auto] gap-1.5">
        <Section title="현재 농도">
          <OdorAlertPpmChart ppm={detail.alert.ppm} grade={detail.alert.grade} />
        </Section>

        <Section title="측정 기기">
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
            <InfoRow label="센서" value={detail.device.sensorKorNm} />
            <InfoRow label="센서명" value={detail.device.sensorNm} />
            <InfoRow label="모델" value={detail.device.model} />
            <InfoRow label="읍면동" value={detail.device.emdNm} />
          </div>
        </Section>

        <Section
          title="경향"
          bodyClassName="flex flex-col gap-1"
          action={
            <div className="flex items-center gap-1">
              <div className="flex gap-0.5">
                {TREND_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    title={tab.label}
                    onClick={() => setTrendRange(tab.key)}
                    className={cn(
                      'inline-flex h-7 cursor-pointer items-center rounded border px-1.5 text-[11px] font-medium transition-colors',
                      trendRange === tab.key
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
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
                className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                <Download className="h-3 w-3 shrink-0" aria-hidden />
                CSV
              </button>
            </div>
          }
        >
          <OdorAlertTrendChart
            points={detail.trends[trendRange]}
            thresholdPpm={detail.abatement.thresholdPpm}
            zones={detail.zones}
          />
          <TrendLegend running={detail.abatement.running} />
        </Section>

        <Section title="저감설비">
          <div className="space-y-1.5">
            <InfoRow
              label="운전 상태"
              value={detail.abatement.running ? '가동' : '미가동'}
            />
            <InfoRow
              label="가동 기준"
              value={`${detail.abatement.thresholdPpm.toFixed(1)} ppm`}
            />
          </div>
        </Section>
      </div>

      <Section
        title="유지관리 이력"
        className="min-h-0 flex-1"
        bodyClassName="flex min-h-0 flex-1 flex-col gap-1.5"
      >
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
            <table className="standard-list-table w-full">
              <thead className="standard-table-thead">
                <tr>
                  {MAINT_COLUMNS.map((col) => {
                    const active = maintSort.key === col.key
                    const Icon = !active
                      ? ArrowUpDown
                      : maintSort.dir === 'asc'
                        ? ArrowUp
                        : ArrowDown
                    return (
                      <th
                        key={col.key}
                        className={cn(
                          'standard-table-th standard-table-th-left border-r border-border last:border-r-0',
                          col.className
                        )}
                      >
                        <button
                          type="button"
                          title={`${col.label} 정렬`}
                          onClick={() => toggleMaintSort(col.key)}
                          className={cn(
                            'standard-sort-button standard-sort-button-left cursor-pointer',
                            active && 'standard-sort-button-active'
                          )}
                        >
                          <span className="truncate">{col.label}</span>
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
                        className="standard-table-td-compact border-r border-border/60 tabular-nums"
                        title={row.date}
                      >
                        {row.date}
                      </td>
                      <td
                        className="standard-table-td-compact border-r border-border/60"
                        title={row.category}
                      >
                        {row.category}
                      </td>
                      <td
                        className="standard-table-td-compact border-r border-border/60"
                        title={row.inspector}
                      >
                        {row.inspector}
                      </td>
                      <td className="standard-table-td-compact" title={row.content}>
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
      </Section>
    </div>
  )
}
