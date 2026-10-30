'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, Scaling, X } from 'lucide-react'
import { call } from '@/lib/api'
import { CheckboxSelectDropdown } from './CheckboxSelectDropdown'
import type {
  WtlNetworkAxisMode,
  WtlNetworkDipFilterOption,
  WtlNetworkDipFilterOptions,
  WtlNetworkDipMatrix,
  WtlNetworkSaaMatrix,
  WtlNetworkStatusStats,
} from './wtlNetworkTypes'

function useRise(duration = 1600, resetKey = '') {
  const [progress, setProgress] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = rootRef.current
    let frame = 0
    let started = false
    setProgress(0)

    const play = () => {
      if (started) return
      started = true
      setProgress(0)
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        setProgress(1 - (1 - t) ** 3)
        if (t < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }

    if (!node) {
      play()
      return () => cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) play()
    })
    observer.observe(node)
    const fallback = window.setTimeout(play, 500)

    return () => {
      observer.disconnect()
      window.clearTimeout(fallback)
      cancelAnimationFrame(frame)
    }
  }, [duration, resetKey])

  return { progress, rootRef }
}

function risen(target: number, progress: number) {
  if (progress >= 1) return target
  return Math.round(target * progress)
}

function SectionTitle({
  children,
  onExpand,
}: {
  children: string
  onExpand?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-1.5 border-b border-border bg-muted/50 px-2 py-1 text-xs font-medium text-foreground">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="h-3 w-0.5 shrink-0 rounded-sm bg-primary" aria-hidden />
        <span className="truncate">{children}</span>
      </div>
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          className="cursor-pointer shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground/90"
          title="크게 보기"
          aria-label="크게 보기"
        >
          <Scaling className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function formatLength(meters: number) {
  if (meters >= 1000) {
    const km = meters / 1000
    const text = Number.isInteger(km) ? String(km) : km.toFixed(1)
    return `${text}㎞`
  }
  return `${meters}m`
}

function LengthTableBody({
  rows,
  progress,
  textClassName = 'text-xs',
}: {
  rows: { label: string; meters: number }[]
  progress: number
  textClassName?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-max min-w-full border-collapse text-center ${textClassName}`}>
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {rows.map((row) => (
              <th
                key={row.label}
                className="whitespace-nowrap border-l border-border px-2 py-1 font-medium text-foreground first:border-l-0"
              >
                {row.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {rows.map((row) => (
              <td
                key={row.label}
                className="whitespace-nowrap border-l border-border px-2 py-1 tabular-nums text-foreground first:border-l-0"
              >
                {formatLength(risen(row.meters, progress))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function LengthTable({
  title,
  rows,
  progress,
  onExpand,
}: {
  title: string
  rows: { label: string; meters: number }[]
  progress: number
  onExpand?: () => void
}) {
  if (rows.length === 0) return null
  return (
    <section className="shrink-0 overflow-hidden rounded border border-border bg-background">
      <SectionTitle onExpand={onExpand}>{title}</SectionTitle>
      <LengthTableBody rows={rows} progress={progress} />
    </section>
  )
}

function StatsExpandFloatingModal({
  open,
  onClose,
  title,
  children,
  defaultSize = { width: 720, height: 320 },
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  defaultSize?: { width: number; height: number }
}) {
  const [pos, setPos] = useState({ x: 80, y: 60 })
  const [size, setSize] = useState(defaultSize)
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null)
  const resizeRef = useRef<{ ox: number; oy: number; w: number; h: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setSize(defaultSize)
  }, [open, defaultSize.width, defaultSize.height])

  useEffect(() => {
    if (!open) return
    const onMove = (e: globalThis.MouseEvent) => {
      if (dragRef.current) {
        const d = dragRef.current
        setPos({
          x: Math.max(0, d.px + e.clientX - d.ox),
          y: Math.max(0, d.py + e.clientY - d.oy),
        })
      }
      if (resizeRef.current) {
        const r = resizeRef.current
        setSize({
          width: Math.max(420, r.w + e.clientX - r.ox),
          height: Math.max(240, r.h + e.clientY - r.oy),
        })
      }
    }
    const onUp = () => {
      dragRef.current = null
      resizeRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center justify-between gap-2 border-b border-border bg-muted/40 px-3"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y }
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'move'
        }}
      >
        <span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground/90"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">{children}</div>
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          resizeRef.current = { ox: e.clientX, oy: e.clientY, w: size.width, h: size.height }
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'se-resize'
        }}
        title="크기 조절"
        aria-label="크기 조절"
      />
    </div>,
    document.body
  )
}

const DIP_STICKY_LABEL_W = 140
const DIP_COL_W = 88
const DIP_METRIC_W = 118

function fmtMeters(n: number) {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtRatio(n: number) {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 관재질·계 가로 틀고정. 반투명 방지용 불투명 배경은 class(bg-slate-100 등)로 */
function dipStickyStyle(
  kind: 'label' | 'total',
  opts: { isHead?: boolean; isTotalRow?: boolean; top?: number } = {}
): CSSProperties {
  const w = kind === 'label' ? DIP_STICKY_LABEL_W : DIP_COL_W
  const { isHead = false, isTotalRow = false, top } = opts
  let zIndex = 3
  if (isHead) zIndex = 5
  if (isTotalRow) zIndex = kind === 'label' || kind === 'total' ? 6 : 4
  return {
    position: 'sticky',
    left: kind === 'label' ? 0 : DIP_STICKY_LABEL_W,
    ...(top != null ? { top } : {}),
    zIndex,
    minWidth: w,
    width: w,
    maxWidth: w,
    ...(kind === 'total'
      ? { boxShadow: 'inset -1px 0 0 0 var(--border)' }
      : {}),
  }
}

/** thead 모서리 — 대각선 분할 (행라벨 \ 열라벨) */
function DiagonalCornerLabel({
  rowLabel,
  colLabel,
}: {
  rowLabel: string
  colLabel: string
}) {
  return (
    <div
      className="relative h-[2.75rem] w-full overflow-hidden"
      title={`${rowLabel}\\${colLabel}`}
    >
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to top right, transparent calc(50% - 0.6px), var(--border) calc(50% - 0.6px), var(--border) calc(50% + 0.6px), transparent calc(50% + 0.6px))',
        }}
        aria-hidden
      />
      <span className="absolute bottom-1 left-1.5 text-[10px] font-medium leading-none text-foreground">
        {rowLabel}
      </span>
      <span className="absolute right-1.5 top-1 text-[10px] font-medium leading-none text-foreground">
        {colLabel}
      </span>
    </div>
  )
}

const EMPTY_MAP_SOURCES: string[] = []

type DipFilters = {
  /** null=전체, []=미선택, 값=부분 */
  pipeTables: string[] | null
  emdCodes: string[] | null
  years: string[] | null
  saaCodes: string[] | null
}

type SaaFilters = {
  pipeTables: string[] | null
  emdCodes: string[] | null
  years: string[] | null
  diameterFrom: number | null
  diameterTo: number | null
}

/** 전체↔부분↔미선택. 미선택([])을 전체로 되돌리지 않음 */
function toFilterValue(selected: string[], all: string[]): string[] | null {
  if (selected.length === 0) return []
  if (all.length > 0 && selected.length === all.length) return null
  return selected
}

function filterDisplayValue(stored: string[] | null, all: string[]): string[] {
  if (stored === null) return all
  return stored
}

function AxisMatrixTable({
  axis,
  matrix,
  filters,
  filterOptions,
  onFiltersChange,
}: {
  axis: WtlNetworkAxisMode
  matrix: WtlNetworkDipMatrix | null
  filters: DipFilters
  filterOptions: {
    pipeKinds: WtlNetworkDipFilterOption[]
    emds: WtlNetworkDipFilterOption[]
    years: WtlNetworkDipFilterOption[]
    saas: WtlNetworkDipFilterOption[]
  }
  onFiltersChange: (next: DipFilters) => void
}) {
  const isYear = axis === 'year'
  const setPipe = (pipeTables: string[] | null) => onFiltersChange({ ...filters, pipeTables })
  const setEmd = (emdCodes: string[] | null) => onFiltersChange({ ...filters, emdCodes })
  const setYears = (years: string[] | null) => onFiltersChange({ ...filters, years })
  const setSaa = (saaCodes: string[] | null) => onFiltersChange({ ...filters, saaCodes })

  const pipeAll = filterOptions.pipeKinds.map((o) => o.value)
  const emdAll = filterOptions.emds.map((o) => o.value)
  const yearAll = filterOptions.years.map((o) => o.value)
  const saaAll = filterOptions.saas.map((o) => o.value)

  const theadRef = useRef<HTMLTableSectionElement>(null)
  const [theadH, setTheadH] = useState(0)
  const [headerRow0H, setHeaderRow0H] = useState(0)
  const totalRow = matrix?.rows.find((r) => r.isTotal) ?? null
  const bodyRows = useMemo(
    () => (matrix?.rows ?? []).filter((r) => !r.isTotal),
    [matrix]
  )
  const serviceYears = matrix?.serviceYears ?? []

  useEffect(() => {
    const el = theadRef.current
    if (!el) {
      setTheadH(0)
      setHeaderRow0H(0)
      return
    }
    const measure = () => {
      setTheadH(el.getBoundingClientRect().height)
      const first = el.querySelector('tr')
      setHeaderRow0H(first ? first.getBoundingClientRect().height : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [matrix, axis])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">관로 종류</span>
          <CheckboxSelectDropdown
            placeholder="미선택"
            options={filterOptions.pipeKinds}
            value={filterDisplayValue(filters.pipeTables, pipeAll)}
            onChange={(v) => setPipe(toFilterValue(v, pipeAll))}
            title="관로 종류"
          />
        </div>
        <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">읍면동</span>
          <CheckboxSelectDropdown
            placeholder="미선택"
            options={filterOptions.emds}
            value={filterDisplayValue(filters.emdCodes, emdAll)}
            onChange={(v) => setEmd(toFilterValue(v, emdAll))}
            title="읍면동"
          />
        </div>
        {!isYear ? (
          <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
            <span className="standard-detail-hit-label text-[11px]">매설년도</span>
            <CheckboxSelectDropdown
              placeholder="미선택"
              options={filterOptions.years}
              value={filterDisplayValue(filters.years, yearAll)}
              onChange={(v) => setYears(toFilterValue(v, yearAll))}
              title="매설년도"
            />
          </div>
        ) : null}
        <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">관용도</span>
          <CheckboxSelectDropdown
            placeholder="미선택"
            options={filterOptions.saas}
            value={filterDisplayValue(filters.saaCodes, saaAll)}
            onChange={(v) => setSaa(toFilterValue(v, saaAll))}
            title="관용도"
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 pb-0.5 text-[11px] text-muted-foreground">
          <span>단위: m</span>
          <span>비율: (%)</span>
          {isYear ? <span>연령: 년</span> : null}
          <button
            type="button"
            disabled={!matrix || matrix.rows.length === 0}
            onClick={() => {
              if (!matrix || matrix.rows.length === 0) return
              void import('./exportWtlDipMatrixExcel').then(({ exportWtlDipMatrixExcel }) => {
                exportWtlDipMatrixExcel(matrix)
              })
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title="엑셀 다운로드"
          >
            <Download className="h-3 w-3 shrink-0" aria-hidden />
            엑셀 다운로드
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        {!matrix || matrix.rows.length === 0 ? (
          <p className="p-3 text-[11px] text-muted-foreground">표시할 자료가 없습니다.</p>
        ) : (
          <table
            className="border-separate border-spacing-0 text-center text-xs"
            style={{ width: 'max-content', minWidth: '100%' }}
          >
            <colgroup>
              <col style={{ width: DIP_STICKY_LABEL_W }} />
              <col style={{ width: DIP_COL_W }} />
              {matrix.columns.map((col) => (
                <col key={`c-${col}`} style={{ width: DIP_COL_W }} />
              ))}
              <col style={{ width: DIP_METRIC_W }} />
              <col style={{ width: DIP_METRIC_W }} />
              {isYear ? <col style={{ width: DIP_METRIC_W }} /> : null}
              <col style={{ width: DIP_METRIC_W }} />
            </colgroup>
            <thead ref={theadRef}>
              <tr>
                <th
                  className="sticky border-b border-border bg-slate-100 p-0 font-medium text-foreground"
                  style={dipStickyStyle('label', { isHead: true, top: 0 })}
                >
                  <DiagonalCornerLabel
                    rowLabel="관재질"
                    colLabel={isYear ? '연도' : '관경'}
                  />
                </th>
                <th
                  className="sticky border-b border-l border-border bg-slate-100 p-[6px] font-medium text-foreground"
                  style={dipStickyStyle('total', { isHead: true, top: 0 })}
                >
                  계
                </th>
                {matrix.columns.map((col) => (
                  <th
                    key={col}
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] font-medium text-foreground"
                    style={{
                      top: 0,
                      minWidth: DIP_COL_W,
                      width: DIP_COL_W,
                      maxWidth: DIP_COL_W,
                    }}
                  >
                    {col}
                  </th>
                ))}
                <th
                  className="sticky z-[4] whitespace-nowrap border-b border-l border-border bg-muted p-[6px] font-medium text-foreground"
                  style={{ top: 0, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                >
                  경년관 연장
                </th>
                <th
                  className="sticky z-[4] whitespace-nowrap border-b border-l border-border bg-muted p-[6px] font-medium text-foreground"
                  style={{ top: 0, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                >
                  경년관 비율(%)
                </th>
                {isYear ? (
                  <th
                    className="sticky z-[4] whitespace-nowrap border-b border-l border-border bg-muted p-[6px] font-medium text-foreground"
                    style={{ top: 0, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  >
                    연장가중 평균연령
                  </th>
                ) : null}
                <th
                  className="sticky z-[4] whitespace-nowrap border-b border-l border-border bg-muted p-[6px] font-medium text-foreground"
                  style={{ top: 0, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                >
                  비내식성 관로 비율(%)
                </th>
              </tr>
              {isYear ? (
                <tr>
                  <th
                    className="sticky border-b border-border bg-slate-100 p-[6px] font-medium text-foreground"
                    style={dipStickyStyle('label', { isHead: true, top: headerRow0H })}
                  >
                    사용연수
                  </th>
                  <th
                    className="sticky border-b border-l border-border bg-slate-100 p-[6px] font-medium text-foreground"
                    style={dipStickyStyle('total', { isHead: true, top: headerRow0H })}
                  />
                  {matrix.columns.map((col, idx) => (
                    <th
                      key={`age-${col}`}
                      className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums font-medium text-foreground"
                      style={{
                        top: headerRow0H,
                        minWidth: DIP_COL_W,
                        width: DIP_COL_W,
                        maxWidth: DIP_COL_W,
                      }}
                    >
                      {serviceYears[idx] != null ? serviceYears[idx] : ''}
                    </th>
                  ))}
                  <th
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px]"
                    style={{ top: headerRow0H, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  />
                  <th
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px]"
                    style={{ top: headerRow0H, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  />
                  <th
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px]"
                    style={{ top: headerRow0H, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  />
                  <th
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px]"
                    style={{ top: headerRow0H, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  />
                </tr>
              ) : null}
            </thead>
            <tbody>
              {totalRow ? (
                <tr className="font-semibold">
                  <th
                    scope="row"
                    className="border-b border-border bg-slate-100 p-[6px] text-left font-medium text-foreground"
                    style={dipStickyStyle('label', { isTotalRow: true, top: theadH })}
                  >
                    {totalRow.label}
                  </th>
                  <td
                    className="border-b border-l border-border bg-slate-100 p-[6px] tabular-nums text-foreground"
                    style={dipStickyStyle('total', { isTotalRow: true, top: theadH })}
                  >
                    {fmtMeters(totalRow.total)}
                  </td>
                  {matrix.columns.map((col) => (
                    <td
                      key={`total-${col}`}
                      className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums text-foreground"
                      style={{
                        top: theadH,
                        minWidth: DIP_COL_W,
                        width: DIP_COL_W,
                        maxWidth: DIP_COL_W,
                      }}
                    >
                      {fmtMeters(totalRow.lengths[col] ?? 0)}
                    </td>
                  ))}
                  <td
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums text-foreground"
                    style={{ top: theadH, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  >
                    {fmtMeters(totalRow.agedLength)}
                  </td>
                  <td
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums text-foreground"
                    style={{ top: theadH, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  >
                    {fmtRatio(totalRow.agedRatio)}
                  </td>
                  {isYear ? (
                    <td
                      className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums text-foreground"
                      style={{ top: theadH, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                    >
                      {totalRow.avgAge != null ? fmtRatio(totalRow.avgAge) : ''}
                    </td>
                  ) : null}
                  <td
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums text-foreground"
                    style={{ top: theadH, minWidth: DIP_METRIC_W, width: DIP_METRIC_W }}
                  >
                    {totalRow.nonCorrosionRatio != null
                      ? fmtRatio(totalRow.nonCorrosionRatio)
                      : ''}
                  </td>
                </tr>
              ) : null}
              {bodyRows.map((row) => (
                <tr key={row.mopCode}>
                  <th
                    scope="row"
                    className="border-b border-border bg-background p-[6px] text-left font-medium text-foreground"
                    style={dipStickyStyle('label')}
                  >
                    {row.label}
                  </th>
                  <td
                    className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground"
                    style={dipStickyStyle('total')}
                  >
                    {fmtMeters(row.total)}
                  </td>
                  {matrix.columns.map((col) => (
                    <td
                      key={`${row.mopCode}-${col}`}
                      className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground"
                      style={{ minWidth: DIP_COL_W, width: DIP_COL_W, maxWidth: DIP_COL_W }}
                    >
                      {fmtMeters(row.lengths[col] ?? 0)}
                    </td>
                  ))}
                  <td className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground">
                    {fmtMeters(row.agedLength)}
                  </td>
                  <td className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground">
                    {fmtRatio(row.agedRatio)}
                  </td>
                  {isYear ? (
                    <td className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground">
                      {row.avgAge != null ? fmtRatio(row.avgAge) : ''}
                    </td>
                  ) : null}
                  <td className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground">
                    {row.nonCorrosionRatio != null ? fmtRatio(row.nonCorrosionRatio) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/** 관용도별 확대 — mop × saa, 셀=연장 */
function SaaMatrixTable({
  matrix,
  filters,
  filterOptions,
  onFiltersChange,
}: {
  matrix: WtlNetworkSaaMatrix | null
  filters: SaaFilters
  filterOptions: {
    pipeKinds: WtlNetworkDipFilterOption[]
    emds: WtlNetworkDipFilterOption[]
    years: WtlNetworkDipFilterOption[]
  }
  onFiltersChange: (next: SaaFilters) => void
}) {
  const setPipe = (pipeTables: string[] | null) => onFiltersChange({ ...filters, pipeTables })
  const setEmd = (emdCodes: string[] | null) => onFiltersChange({ ...filters, emdCodes })
  const setYears = (years: string[] | null) => onFiltersChange({ ...filters, years })
  const pipeAll = filterOptions.pipeKinds.map((o) => o.value)
  const emdAll = filterOptions.emds.map((o) => o.value)
  const yearAll = filterOptions.years.map((o) => o.value)

  const theadRef = useRef<HTMLTableSectionElement>(null)
  const [theadH, setTheadH] = useState(0)
  const totalRow = matrix?.rows.find((r) => r.isTotal) ?? null
  const bodyRows = useMemo(
    () => (matrix?.rows ?? []).filter((r) => !r.isTotal),
    [matrix]
  )

  useEffect(() => {
    const el = theadRef.current
    if (!el) {
      setTheadH(0)
      return
    }
    const measure = () => setTheadH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [matrix])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">관로</span>
          <CheckboxSelectDropdown
            placeholder="미선택"
            options={filterOptions.pipeKinds}
            value={filterDisplayValue(filters.pipeTables, pipeAll)}
            onChange={(v) => setPipe(toFilterValue(v, pipeAll))}
            title="관로"
          />
        </div>
        <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">읍면동</span>
          <CheckboxSelectDropdown
            placeholder="미선택"
            options={filterOptions.emds}
            value={filterDisplayValue(filters.emdCodes, emdAll)}
            onChange={(v) => setEmd(toFilterValue(v, emdAll))}
            title="읍면동"
          />
        </div>
        <div className="flex max-w-[140px] flex-1 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">매설년도</span>
          <CheckboxSelectDropdown
            placeholder="미선택"
            options={filterOptions.years}
            value={filterDisplayValue(filters.years, yearAll)}
            onChange={(v) => setYears(toFilterValue(v, yearAll))}
            title="매설년도"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="standard-detail-hit-label text-[11px]">관경</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              className="standard-detail-input h-7 w-[4.5rem] px-1 text-[11px] tabular-nums"
              title="관경 최소"
              aria-label="관경 최소"
              placeholder="최소"
              value={filters.diameterFrom ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                onFiltersChange({
                  ...filters,
                  diameterFrom: raw === '' ? null : Number(raw),
                })
              }}
            />
            <span className="text-[11px] text-muted-foreground">~</span>
            <input
              type="number"
              inputMode="decimal"
              className="standard-detail-input h-7 w-[4.5rem] px-1 text-[11px] tabular-nums"
              title="관경 최대"
              aria-label="관경 최대"
              placeholder="최대"
              value={filters.diameterTo ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                onFiltersChange({
                  ...filters,
                  diameterTo: raw === '' ? null : Number(raw),
                })
              }}
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 pb-0.5 text-[11px] text-muted-foreground">
          <span>단위: m</span>
          <button
            type="button"
            disabled={!matrix || matrix.rows.length === 0}
            onClick={() => {
              if (!matrix || matrix.rows.length === 0) return
              void import('./exportWtlSaaMatrixExcel').then(({ exportWtlSaaMatrixExcel }) => {
                exportWtlSaaMatrixExcel(matrix)
              })
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title="엑셀 다운로드"
          >
            <Download className="h-3 w-3 shrink-0" aria-hidden />
            엑셀 다운로드
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        {!matrix || matrix.rows.length === 0 ? (
          <p className="p-3 text-[11px] text-muted-foreground">표시할 자료가 없습니다.</p>
        ) : (
          <table
            className="border-separate border-spacing-0 text-center text-xs"
            style={{ width: 'max-content', minWidth: '100%' }}
          >
            <colgroup>
              <col style={{ width: DIP_STICKY_LABEL_W }} />
              <col style={{ width: DIP_COL_W }} />
              {matrix.columns.map((col) => (
                <col key={`saa-c-${col}`} style={{ width: DIP_COL_W }} />
              ))}
            </colgroup>
            <thead ref={theadRef}>
              <tr>
                <th
                  className="sticky border-b border-border bg-slate-100 p-0 font-medium text-foreground"
                  style={dipStickyStyle('label', { isHead: true, top: 0 })}
                >
                  <DiagonalCornerLabel rowLabel="관재질" colLabel="관용도" />
                </th>
                <th
                  className="sticky border-b border-l border-border bg-slate-100 p-[6px] font-medium text-foreground"
                  style={dipStickyStyle('total', { isHead: true, top: 0 })}
                >
                  계
                </th>
                {matrix.columns.map((col) => (
                  <th
                    key={col}
                    className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] font-medium text-foreground"
                    style={{
                      top: 0,
                      minWidth: DIP_COL_W,
                      width: DIP_COL_W,
                      maxWidth: DIP_COL_W,
                    }}
                    title={col}
                  >
                    {matrix.columnLabels[col] ?? col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totalRow ? (
                <tr className="font-semibold">
                  <th
                    scope="row"
                    className="border-b border-border bg-slate-100 p-[6px] text-left font-medium text-foreground"
                    style={dipStickyStyle('label', { isTotalRow: true, top: theadH })}
                  >
                    {totalRow.label}
                  </th>
                  <td
                    className="border-b border-l border-border bg-slate-100 p-[6px] tabular-nums text-foreground"
                    style={dipStickyStyle('total', { isTotalRow: true, top: theadH })}
                  >
                    {fmtMeters(totalRow.total)}
                  </td>
                  {matrix.columns.map((col) => (
                    <td
                      key={`saa-total-${col}`}
                      className="sticky z-[4] border-b border-l border-border bg-muted p-[6px] tabular-nums text-foreground"
                      style={{
                        top: theadH,
                        minWidth: DIP_COL_W,
                        width: DIP_COL_W,
                        maxWidth: DIP_COL_W,
                      }}
                    >
                      {fmtMeters(totalRow.lengths[col] ?? 0)}
                    </td>
                  ))}
                </tr>
              ) : null}
              {bodyRows.map((row) => (
                <tr key={row.mopCode}>
                  <th
                    scope="row"
                    className="border-b border-border bg-background p-[6px] text-left font-medium text-foreground"
                    style={dipStickyStyle('label')}
                  >
                    {row.label}
                  </th>
                  <td
                    className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground"
                    style={dipStickyStyle('total')}
                  >
                    {fmtMeters(row.total)}
                  </td>
                  {matrix.columns.map((col) => (
                    <td
                      key={`${row.mopCode}-${col}`}
                      className="border-b border-l border-border bg-background p-[6px] tabular-nums text-foreground"
                      style={{ minWidth: DIP_COL_W, width: DIP_COL_W, maxWidth: DIP_COL_W }}
                    >
                      {fmtMeters(row.lengths[col] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const EMPTY_STATS: WtlNetworkStatusStats = {
  byDiameter: [],
  byMaterial: [],
  byYear: [],
  bySaa: [],
  facilityCounts: [],
}

type ExpandKind = 'byDiameter' | 'byMaterial' | 'byYear' | 'bySaa' | null

const EXPAND_META: Record<
  Exclude<ExpandKind, null>,
  { title: string; rowsKey: 'byDiameter' | 'byMaterial' | 'byYear' | 'bySaa' }
> = {
  byDiameter: { title: '관경별 관로 연장', rowsKey: 'byDiameter' },
  byMaterial: { title: '관재질별 관로 연장', rowsKey: 'byMaterial' },
  byYear: { title: '연도별 관로 연장', rowsKey: 'byYear' },
  bySaa: { title: '관용도별 관로 연장', rowsKey: 'bySaa' },
}

/** null = 전체(레거시 기본) */
const EMPTY_DIP_FILTERS: DipFilters = {
  pipeTables: null,
  emdCodes: null,
  years: null,
  saaCodes: null,
}

const EMPTY_SAA_FILTERS: SaaFilters = {
  pipeTables: null,
  emdCodes: null,
  years: null,
  diameterFrom: null,
  diameterTo: null,
}

const EMPTY_DIP_FILTER_OPTIONS: WtlNetworkDipFilterOptions = {
  pipeKinds: [],
  emds: [],
  years: [],
  saas: [],
}

/** 현황·확대 통계 — 선택 레이어 그룹(mapSources) remap 물리 테이블만 집계 */
export function WtlNetworkMapStatus({
  mapSources = EMPTY_MAP_SOURCES,
}: {
  mapSources?: string[]
}) {
  const [stats, setStats] = useState<WtlNetworkStatusStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(false)
  const [expandKind, setExpandKind] = useState<ExpandKind>(null)
  const [dipMatrix, setDipMatrix] = useState<WtlNetworkDipMatrix | null>(null)
  const [dipLoading, setDipLoading] = useState(false)
  const [dipFilters, setDipFilters] = useState(EMPTY_DIP_FILTERS)
  const [dipFilterOptions, setDipFilterOptions] =
    useState<WtlNetworkDipFilterOptions>(EMPTY_DIP_FILTER_OPTIONS)
  const [saaMatrix, setSaaMatrix] = useState<WtlNetworkSaaMatrix | null>(null)
  const [saaLoading, setSaaLoading] = useState(false)
  const [saaFilters, setSaaFilters] = useState(EMPTY_SAA_FILTERS)
  const [saaFilterOptions, setSaaFilterOptions] = useState({
    pipeKinds: [] as WtlNetworkDipFilterOption[],
    emds: [] as WtlNetworkDipFilterOption[],
    years: [] as WtlNetworkDipFilterOption[],
  })
  const { progress, rootRef } = useRise(1600, String(stats.byDiameter.length))
  const mapSourcesSig = [...mapSources].map(String).sort().join('\u0001')
  const mapSourcesParam = useMemo(
    () => mapSources.map(String).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명으로 안정화
    [mapSourcesSig]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkStatusStats',
          params: { mapSources: mapSourcesParam },
        })
        if (cancelled) return
        const data = (res?.data ?? res) as Partial<WtlNetworkStatusStats> | undefined
        setStats({
          byDiameter: Array.isArray(data?.byDiameter) ? data!.byDiameter : [],
          byMaterial: Array.isArray(data?.byMaterial) ? data!.byMaterial : [],
          byYear: Array.isArray(data?.byYear) ? data!.byYear : [],
          bySaa: Array.isArray(data?.bySaa) ? data!.bySaa : [],
          facilityCounts: Array.isArray(data?.facilityCounts) ? data!.facilityCounts : [],
        })
      } catch {
        if (!cancelled) setStats(EMPTY_STATS)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mapSourcesParam])

  const isAxisExpand = expandKind === 'byDiameter' || expandKind === 'byYear'
  const isSaaExpand = expandKind === 'bySaa'
  const axisMode: WtlNetworkAxisMode = expandKind === 'byYear' ? 'year' : 'dip'

  useEffect(() => {
    if (!isAxisExpand) return
    let cancelled = false
    setDipMatrix(null)
    setDipFilters(EMPTY_DIP_FILTERS)
    ;(async () => {
      try {
        const [optRes, emdRes] = await Promise.all([
          call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkStatusDipFilterOptions',
            params: { mapSources: mapSourcesParam },
          }),
          call('', 'POST', {
            service: 'devTestService',
            action: 'getEmdRiOptions',
            params: {},
          }),
        ])
        if (cancelled) return
        const opt = (optRes?.data ?? optRes) as Partial<WtlNetworkDipFilterOptions> | undefined
        const emdData = emdRes?.data ?? emdRes
        const emds: WtlNetworkDipFilterOption[] = Array.isArray(emdData?.emd)
          ? emdData.emd.map((o: { code?: string; name?: string }) => ({
              value: String(o.code ?? ''),
              label: String(o.name ?? o.code ?? ''),
            })).filter((o: WtlNetworkDipFilterOption) => o.value && o.label)
          : []
        setDipFilterOptions({
          pipeKinds: Array.isArray(opt?.pipeKinds) ? opt!.pipeKinds : [],
          emds,
          years: Array.isArray(opt?.years) ? opt!.years : [],
          saas: Array.isArray(opt?.saas) ? opt!.saas : [],
        })
      } catch {
        if (!cancelled) setDipFilterOptions(EMPTY_DIP_FILTER_OPTIONS)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [expandKind, isAxisExpand, mapSourcesParam])

  useEffect(() => {
    if (!isAxisExpand) return
    let cancelled = false
    setDipLoading(true)
    ;(async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action:
            axisMode === 'year'
              ? 'getWtlNetworkStatusYearMatrix'
              : 'getWtlNetworkStatusDipMatrix',
          params: {
            mapSources: mapSourcesParam,
            pipeTables: dipFilters.pipeTables,
            emdCodes: dipFilters.emdCodes,
            ...(axisMode === 'dip' ? { years: dipFilters.years } : {}),
            saaCodes: dipFilters.saaCodes,
          },
        })
        if (cancelled) return
        const data = (res?.data ?? res) as WtlNetworkDipMatrix | undefined
        setDipMatrix(
          data && Array.isArray(data.columns) && Array.isArray(data.rows) ? data : null
        )
      } catch {
        if (!cancelled) setDipMatrix(null)
      } finally {
        if (!cancelled) setDipLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [expandKind, isAxisExpand, axisMode, dipFilters, mapSourcesParam])

  useEffect(() => {
    if (!isSaaExpand) return
    let cancelled = false
    setSaaMatrix(null)
    setSaaFilters(EMPTY_SAA_FILTERS)
    ;(async () => {
      try {
        const [optRes, emdRes] = await Promise.all([
          call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkStatusDipFilterOptions',
            params: { mapSources: mapSourcesParam },
          }),
          call('', 'POST', {
            service: 'devTestService',
            action: 'getEmdRiOptions',
            params: {},
          }),
        ])
        if (cancelled) return
        const opt = (optRes?.data ?? optRes) as Partial<WtlNetworkDipFilterOptions> | undefined
        const emdData = emdRes?.data ?? emdRes
        const emds: WtlNetworkDipFilterOption[] = Array.isArray(emdData?.emd)
          ? emdData.emd
              .map((o: { code?: string; name?: string }) => ({
                value: String(o.code ?? ''),
                label: String(o.name ?? o.code ?? ''),
              }))
              .filter((o: WtlNetworkDipFilterOption) => o.value && o.label)
          : []
        setSaaFilterOptions({
          pipeKinds: Array.isArray(opt?.pipeKinds) ? opt!.pipeKinds : [],
          emds,
          years: Array.isArray(opt?.years) ? opt!.years : [],
        })
      } catch {
        if (!cancelled) {
          setSaaFilterOptions({ pipeKinds: [], emds: [], years: [] })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [expandKind, isSaaExpand, mapSourcesParam])

  useEffect(() => {
    if (!isSaaExpand) return
    let cancelled = false
    setSaaLoading(true)
    ;(async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkStatusSaaMatrix',
          params: {
            mapSources: mapSourcesParam,
            pipeTables: saaFilters.pipeTables,
            emdCodes: saaFilters.emdCodes,
            years: saaFilters.years,
            diameterFrom: saaFilters.diameterFrom,
            diameterTo: saaFilters.diameterTo,
          },
        })
        if (cancelled) return
        const data = (res?.data ?? res) as WtlNetworkSaaMatrix | undefined
        setSaaMatrix(
          data && Array.isArray(data.columns) && Array.isArray(data.rows) ? data : null
        )
      } catch {
        if (!cancelled) setSaaMatrix(null)
      } finally {
        if (!cancelled) setSaaLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [expandKind, isSaaExpand, saaFilters, mapSourcesParam])

  const empty =
    !loading &&
    stats.byDiameter.length === 0 &&
    stats.byMaterial.length === 0 &&
    stats.byYear.length === 0 &&
    stats.bySaa.length === 0 &&
    stats.facilityCounts.length === 0

  const expandMeta = expandKind ? EXPAND_META[expandKind] : null
  const expandRows = expandMeta ? stats[expandMeta.rowsKey] : []
  const modalOpen =
    isAxisExpand || isSaaExpand
      ? expandKind != null
      : expandKind != null && expandRows.length > 0

  return (
    <div
      ref={rootRef}
      className="min-h-0 flex-1 space-y-[13px] overflow-auto border-t border-border px-3 pb-2 pt-[13px]"
    >
      {loading ? (
        <p className="text-[11px] text-muted-foreground">현황 집계 중…</p>
      ) : empty ? (
        <p className="text-[11px] text-muted-foreground">현황을 집계할 자료가 없습니다.</p>
      ) : (
        <>
          <LengthTable
            title="관경별 관로 연장"
            rows={stats.byDiameter}
            progress={progress}
            onExpand={() => setExpandKind('byDiameter')}
          />
          <LengthTable
            title="관재질별 관로 연장"
            rows={stats.byMaterial}
            progress={progress}
            onExpand={() => setExpandKind('byMaterial')}
          />
          <LengthTable
            title="연도별 관로 연장"
            rows={stats.byYear}
            progress={progress}
            onExpand={() => setExpandKind('byYear')}
          />
          <LengthTable
            title="관용도별 관로 연장"
            rows={stats.bySaa}
            progress={progress}
            onExpand={() => setExpandKind('bySaa')}
          />
          {stats.facilityCounts.length > 0 && (
            <section className="shrink-0 overflow-hidden rounded border border-border bg-background">
              <SectionTitle>시설 개수</SectionTitle>
              <div className="grid grid-cols-3 gap-1 p-1.5">
                {stats.facilityCounts.map((item) => (
                  <div
                    key={item.label}
                    className="flex min-w-0 items-center justify-between gap-1 rounded border border-border px-1.5 py-1"
                  >
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{item.label}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                      {risen(item.count, progress).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <StatsExpandFloatingModal
            open={modalOpen}
            onClose={() => setExpandKind(null)}
            title={expandMeta?.title ?? ''}
            defaultSize={
              isAxisExpand || isSaaExpand
                ? { width: 1000, height: 640 }
                : { width: 720, height: 320 }
            }
          >
            {isAxisExpand ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {dipLoading && !dipMatrix ? (
                  <p className="text-[11px] text-muted-foreground">
                    {axisMode === 'year' ? '연도별' : '관경별'} 교차표 집계 중…
                  </p>
                ) : (
                  <AxisMatrixTable
                    axis={axisMode}
                    matrix={dipMatrix}
                    filters={dipFilters}
                    filterOptions={dipFilterOptions}
                    onFiltersChange={setDipFilters}
                  />
                )}
                {dipLoading && dipMatrix ? (
                  <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">필터 적용 중…</p>
                ) : null}
              </div>
            ) : isSaaExpand ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {saaLoading && !saaMatrix ? (
                  <p className="text-[11px] text-muted-foreground">관용도별 교차표 집계 중…</p>
                ) : (
                  <SaaMatrixTable
                    matrix={saaMatrix}
                    filters={saaFilters}
                    filterOptions={saaFilterOptions}
                    onFiltersChange={setSaaFilters}
                  />
                )}
                {saaLoading && saaMatrix ? (
                  <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">필터 적용 중…</p>
                ) : null}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <LengthTableBody rows={expandRows} progress={1} textClassName="text-sm" />
              </div>
            )}
          </StatsExpandFloatingModal>
        </>
      )}
    </div>
  )
}
