'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileDown, FileText, Search } from 'lucide-react'
import * as XLSX from 'xlsx'
import { writeExcelWorkbookWithPledge } from '@/app/(pages)/_components/securityPledge/excelPledgeGate'
import type { OdorGradePointMock, OdorGradeStatus } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { cn } from '@/lib/utils'
import { ODOR_DASHBOARD2_STATION_PAGE_SIZE } from '../odorDashboard2Config'
import {
  buildOdorStationRows,
  odorStatusLabel,
  type OdorStationRow,
} from '../odorDashboard2StationRows'

type ScopeFilter = 'all' | 'warning'
type StatusFilter = OdorGradeStatus

type Props = {
  sensors: OdorSensorListItem[]
  points: OdorGradePointMock[]
  selectedSensorKey?: string | null
  onSelectStation?: (row: OdorStationRow | null) => void
  /** true면 제목 헤더 숨김 (플로팅 헤더 사용 시) */
  hideHeader?: boolean
  /** 플로팅 헤더에 엑셀·PDF 슬롯 전달 */
  onHeaderRightChange?: (node: ReactNode | null) => void
}

const STATUS_CHIPS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'normal', label: '정상' },
  { key: 'caution', label: '주의' },
  { key: 'warning', label: '경보' },
]

export function downloadStationExcel(rows: OdorStationRow[]) {
  const data = rows.map((r) => ({
    지점한글명: r.sensorKorNm,
    지점영문명: r.sensorNm,
    업체: r.agency,
    행정동: r.emdNm,
    상태: odorStatusLabel(r.status),
    등급: r.grade,
    '농도(ppm)': r.ppm,
    제거설비가동: r.abatementRunning ? '가동' : '정지',
    통신: r.online ? '정상' : '이상',
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '지점목록')
  const fileName = `악취_지점목록_${new Date().toISOString().slice(0, 10)}.xlsx`
  //		TODO : 악취 기능 연결 레이어 테이블의 SHP/엑셀(엑셀) 권한 적용 필요 (tableName·tableNames 전달)
  writeExcelWorkbookWithPledge(XLSX, wb, fileName, '악취 지점목록')
}

export function printStationPdf(rows: OdorStationRow[]) {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = rows
    .map(
      (r) =>
        `<tr>
          <td>${escape(r.sensorKorNm)}</td>
          <td>${escape(r.sensorNm)}</td>
          <td>${escape(r.agency)}</td>
          <td>${escape(r.emdNm)}</td>
          <td>${odorStatusLabel(r.status)}</td>
          <td>${r.ppm.toFixed(1)}</td>
          <td>${r.abatementRunning ? '가동' : '정지'}</td>
        </tr>`
    )
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>지점 목록</title>
    <style>
      body{font-family:'Malgun Gothic',sans-serif;font-size:11px;color:#0f172a;margin:24px}
      h1{font-size:16px;margin:0 0 12px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}
      th{background:#f1f5f9}
    </style></head><body>
    <h1>지점 목록 및 기기 상태</h1>
    <table>
      <thead><tr>
        <th>지점한글명</th><th>지점영문명</th><th>업체</th><th>행정동</th>
        <th>상태</th><th>농도(ppm)</th><th>제거설비</th>
      </tr></thead>
      <tbody>${body || '<tr><td colspan="7">데이터 없음</td></tr>'}</tbody>
    </table>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`
  const w = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

function ExportButtons({
  disabled,
  onExcel,
  onPdf,
  className,
}: {
  disabled: boolean
  onExcel: () => void
  onPdf: () => void
  className?: string
}) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)}>
      <button
        type="button"
        title="엑셀"
        onClick={onExcel}
        disabled={disabled}
        className="standard-detail-hdr-btn cursor-pointer disabled:opacity-50"
      >
        <FileDown className="h-3 w-3" aria-hidden />
        엑셀
      </button>
      <button
        type="button"
        title="PDF 인쇄"
        onClick={onPdf}
        disabled={disabled}
        className="standard-detail-hdr-btn cursor-pointer disabled:opacity-50"
      >
        <FileText className="h-3 w-3" aria-hidden />
        PDF
      </button>
    </div>
  )
}

/**
 * 대시보드2 — 지점 목록 및 기기 상태 (페이징·필터·검색·엑셀/PDF).
 */
export function OdorDeviceStatusPanel({
  sensors,
  points,
  selectedSensorKey = null,
  onSelectStation,
  hideHeader = false,
  onHeaderRightChange,
}: Props) {
  const rows = useMemo(() => buildOdorStationRows(sensors, points), [sensors, points])
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [statusOn, setStatusOn] = useState<Record<StatusFilter, boolean>>({
    normal: true,
    caution: true,
    warning: true,
  })
  const [emdFilter, setEmdFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [page, setPage] = useState(1)
  const searchWrapRef = useRef<HTMLDivElement | null>(null)
  const filteredRef = useRef<OdorStationRow[]>([])

  const emdOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.emdNm).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows])

  const suggestions = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    return rows
      .filter(
        (r) =>
          r.sensorKorNm.toLowerCase().includes(kw) ||
          r.sensorNm.toLowerCase().includes(kw)
      )
      .slice(0, 8)
  }, [rows, keyword])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (scope === 'warning' && r.status !== 'warning') return false
      if (!statusOn[r.status]) return false
      if (emdFilter !== 'all' && r.emdNm !== emdFilter) return false
      const kw = keyword.trim().toLowerCase()
      if (!kw) return true
      return (
        r.sensorKorNm.toLowerCase().includes(kw) ||
        r.sensorNm.toLowerCase().includes(kw) ||
        r.agency.toLowerCase().includes(kw) ||
        r.emdNm.toLowerCase().includes(kw)
      )
    })
  }, [rows, scope, statusOn, emdFilter, keyword])

  filteredRef.current = filtered

  const pageCount = Math.max(1, Math.ceil(filtered.length / ODOR_DASHBOARD2_STATION_PAGE_SIZE) || 1)
  const safePage = Math.min(page, pageCount)
  const paged = useMemo(() => {
    const start = (safePage - 1) * ODOR_DASHBOARD2_STATION_PAGE_SIZE
    return filtered.slice(start, start + ODOR_DASHBOARD2_STATION_PAGE_SIZE)
  }, [filtered, safePage])

  useEffect(() => {
    setPage(1)
  }, [scope, statusOn, emdFilter, keyword])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const exportExcel = () => downloadStationExcel(filteredRef.current)
  const exportPdf = () => printStationPdf(filteredRef.current)
  const exportDisabled = filtered.length === 0

  useEffect(() => {
    if (!onHeaderRightChange) return
    onHeaderRightChange(
      <ExportButtons
        disabled={exportDisabled}
        onExcel={exportExcel}
        onPdf={exportPdf}
      />
    )
    return () => onHeaderRightChange(null)
    // filtered length만 의존 — 콜백 안정성
    // eslint-disable-next-line react-hooks/exhaustive-deps -- export는 ref 경유
  }, [onHeaderRightChange, exportDisabled])

  const toggleStatus = (key: StatusFilter) => {
    setStatusOn((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      if (!next.normal && !next.caution && !next.warning) return prev
      return next
    })
  }

  const pickStation = (row: OdorStationRow) => {
    const same = selectedSensorKey === row.id
    onSelectStation?.(same ? null : row)
    setSuggestOpen(false)
  }

  const from =
    filtered.length === 0 ? 0 : (safePage - 1) * ODOR_DASHBOARD2_STATION_PAGE_SIZE + 1
  const to = Math.min(safePage * ODOR_DASHBOARD2_STATION_PAGE_SIZE, filtered.length)

  return (
    <section
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden',
        hideHeader ? null : 'border border-border p-2'
      )}
    >
      {!hideHeader ? (
        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
            지점 목록 및 기기 상태
          </h2>
          <ExportButtons
            disabled={exportDisabled}
            onExcel={exportExcel}
            onPdf={exportPdf}
          />
        </div>
      ) : null}

      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="shrink-0 text-[11px] text-muted-foreground">범위</span>
          <div className="standard-filter-chips">
            {(
              [
                { key: 'all' as const, label: '전체' },
                { key: 'warning' as const, label: '경보' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                title={opt.label}
                onClick={() => setScope(opt.key)}
                className={cn(
                  'standard-filter-chip cursor-pointer',
                  scope === opt.key && 'standard-filter-chip-active'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
          <span className="shrink-0 text-[11px] text-muted-foreground">상태</span>
          <div className="standard-filter-chips">
            {STATUS_CHIPS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                title={opt.label}
                onClick={() => toggleStatus(opt.key)}
                className={cn(
                  'standard-filter-chip cursor-pointer',
                  statusOn[opt.key] && 'standard-filter-chip-active'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          총{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {filtered.length.toLocaleString()}
          </span>
          개
        </div>
      </div>

      <div ref={searchWrapRef} className="relative mb-1.5 flex shrink-0 items-center gap-1.5">
        <label className="sr-only" htmlFor="odor-station-emd">
          행정동
        </label>
        <select
          id="odor-station-emd"
          title="행정동"
          value={emdFilter}
          onChange={(e) => setEmdFilter(e.target.value)}
          className="h-7 w-[7.5rem] shrink-0 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
        >
          <option value="all">행정동 전체</option>
          {emdOptions.map((emd) => (
            <option key={emd} value={emd}>
              {emd}
            </option>
          ))}
        </select>
        <div className="standard-search-wrap min-w-0 flex-1">
          <Search className="standard-search-icon" aria-hidden />
          <input
            type="search"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setSuggestOpen(true)
            }}
            onFocus={() => setSuggestOpen(true)}
            placeholder="지점 찾기 (한글명·영문명)"
            title="지점 찾기"
            className="standard-search-input focus:ring-0 focus:ring-offset-0"
            autoComplete="off"
          />
        </div>
        {suggestOpen && suggestions.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-40 overflow-auto rounded border border-border bg-background shadow-md">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  title={`${s.sensorKorNm}(${s.sensorNm})`}
                  className="flex w-full cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left text-[11px] hover:bg-muted/60"
                  onClick={() => pickStation(s)}
                >
                  <span className="font-medium text-foreground">
                    {s.sensorKorNm}
                    <span className="text-muted-foreground">({s.sensorNm})</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.agency} · {s.emdNm}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
        <div className="standard-list-scroll min-h-0 flex-1">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                <th className="standard-table-th standard-table-th-left">지점</th>
                <th className="standard-table-th standard-table-th-left w-[18%]">상태</th>
                <th className="standard-table-th standard-table-th-left w-[18%]">농도</th>
                <th className="standard-table-th standard-table-th-left w-[18%]">설비</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={4} className="standard-table-empty">
                    조건에 맞는 지점이 없습니다.
                  </td>
                </tr>
              ) : (
                paged.map((row) => {
                  const selected = selectedSensorKey === row.id
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      title={`${row.sensorKorNm} 선택`}
                      onClick={() => pickStation(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          pickStation(row)
                        }
                      }}
                      className={cn(
                        'standard-list-row cursor-pointer',
                        selected && 'standard-list-row-selected'
                      )}
                    >
                      <td className="standard-table-td-text" title={row.sensorKorNm}>
                        <span className="block truncate font-medium">{row.sensorKorNm}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {row.sensorNm} · {row.emdNm}
                        </span>
                      </td>
                      <td className="standard-table-td-compact">
                        <span
                          className={cn(
                            'inline-flex rounded px-1 py-0.5 text-[10px] font-medium',
                            row.status === 'normal' &&
                              'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                            row.status === 'caution' &&
                              'bg-orange-500/15 text-orange-700 dark:text-orange-300',
                            row.status === 'warning' &&
                              'bg-red-500/15 text-red-700 dark:text-red-300'
                          )}
                        >
                          {odorStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="standard-table-td-date tabular-nums">{row.ppm.toFixed(1)}</td>
                      <td className="standard-table-td-compact">
                        {row.abatementRunning ? '가동' : '정지'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer flex shrink-0 items-center justify-between gap-2">
          <span className="tabular-nums">
            {filtered.length === 0
              ? '0건'
              : `${from}–${to} / ${filtered.length.toLocaleString()}건`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="이전"
              disabled={safePage <= 1}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </button>
            <span className="px-1 text-[11px] text-muted-foreground">{safePage}페이지</span>
            <button
              type="button"
              title="다음"
              disabled={safePage >= pageCount}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
