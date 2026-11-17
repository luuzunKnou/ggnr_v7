'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx-js-style'
import { cn } from '@/lib/utils'

type Props = {
  url: string
  fileName: string
  sheetIndex: number
  onSheetIndexChange: (index: number) => void
  onSheetNamesReady?: (sheetNames: string[]) => void
}

const MAX_ROWS = 2000
const MAX_COLS = 100

type CellView = {
  text: string
  /** #RRGGBB */
  bg?: string
  /** #RRGGBB */
  color?: string
}

type SheetTable = {
  name: string
  rows: CellView[][]
  truncated: boolean
}

function cellToDisplay(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return ''
    return v.toLocaleString('ko-KR')
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/** Excel ARGB/RGB → #RRGGBB */
function excelColorToCss(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as { rgb?: string; theme?: number; indexed?: number }
  const rgb = String(o.rgb ?? '')
    .trim()
    .replace(/^#/, '')
  if (!rgb) return undefined
  // AARRGGBB or RRGGBB
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb.length === 6 ? rgb : ''
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return `#${hex.toUpperCase()}`
}

function extractCellStyle(cell: XLSX.CellObject | undefined): {
  bg?: string
  color?: string
} {
  if (!cell || typeof cell !== 'object') return {}
  const s = (cell as { s?: Record<string, unknown> }).s
  if (!s || typeof s !== 'object') return {}

  // xlsx-js-style read: s가 fill을 평탄화하거나 fill 객체를 둘 수 있음
  const fill = (s.fill as Record<string, unknown> | undefined) ?? s
  const fg =
    (fill.fgColor as unknown) ??
    (fill.bgColor as unknown) ??
    (s.fgColor as unknown)
  const bg = excelColorToCss(fg)

  const font = s.font as Record<string, unknown> | undefined
  const fontColor =
    excelColorToCss(font?.color) ??
    excelColorToCss(s.color) ??
    undefined

  return { bg, color: fontColor }
}

function sheetToTable(wb: XLSX.WorkBook, sheetName: string): SheetTable {
  const sheet = wb.Sheets[sheetName]
  if (!sheet) {
    return { name: sheetName, rows: [], truncated: false }
  }

  const ref = sheet['!ref']
  if (!ref) {
    return { name: sheetName, rows: [], truncated: false }
  }

  const range = XLSX.utils.decode_range(ref)
  let truncated = false
  const maxR = Math.min(range.e.r, range.s.r + MAX_ROWS - 1)
  const maxC = Math.min(range.e.c, range.s.c + MAX_COLS - 1)
  if (range.e.r - range.s.r + 1 > MAX_ROWS || range.e.c - range.s.c + 1 > MAX_COLS) {
    truncated = true
  }

  const rows: CellView[][] = []
  for (let R = range.s.r; R <= maxR; R++) {
    const row: CellView[] = []
    for (let C = range.s.c; C <= maxC; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = sheet[addr] as XLSX.CellObject | undefined
      let text = ''
      if (cell) {
        if (cell.w != null && String(cell.w).trim() !== '') {
          text = String(cell.w)
        } else {
          text = cellToDisplay(cell.v)
        }
      }
      const style = extractCellStyle(cell)
      row.push({ text, bg: style.bg, color: style.color })
    }
    rows.push(row)
  }

  // 완전 빈 행 제거(하단) — 미리보기 밀도
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => !c.text)) {
    rows.pop()
  }

  return { name: sheetName, rows, truncated }
}

/**
 * 엑셀 첨부 본문 — fetch 후 SheetJS 파싱, 시트 탭·읽기 전용 표.
 * 기본 흰 배경, 셀 스타일(배경·글자색) 있으면 반영.
 */
export function ServiceFileExcelPreviewStage({
  url,
  fileName,
  sheetIndex,
  onSheetIndexChange,
  onSheetNamesReady,
}: Props) {
  const [phase, setPhase] = useState<'loading' | 'error' | 'idle'>('loading')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [tables, setTables] = useState<SheetTable[]>([])

  const activeIndex = Math.min(
    Math.max(0, sheetIndex),
    Math.max(0, sheetNames.length - 1)
  )

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setPhase('loading')
      setErrorText(null)
      setSheetNames([])
      setTables([])
      try {
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) throw new Error(`파일을 불러오지 못했습니다. (${res.status})`)
        const buf = await res.arrayBuffer()
        if (cancelled) return
        const wb = XLSX.read(buf, {
          type: 'array',
          cellDates: true,
          cellStyles: true,
        })
        const names = (wb.SheetNames ?? []).filter((n) => String(n ?? '').trim())
        if (names.length === 0) {
          setPhase('error')
          setErrorText('시트를 찾을 수 없습니다.')
          onSheetNamesReady?.([])
          return
        }
        const nextTables = names.map((n) => sheetToTable(wb, n))
        setSheetNames(names)
        setTables(nextTables)
        setPhase('idle')
        onSheetNamesReady?.(names)
        onSheetIndexChange(0)
      } catch (e) {
        if (cancelled) return
        setPhase('error')
        setErrorText(e instanceof Error ? e.message : String(e))
        onSheetNamesReady?.([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, fileName])

  const active = tables[activeIndex] ?? null

  const colCount = useMemo(() => {
    if (!active) return 0
    let max = 0
    for (const r of active.rows) max = Math.max(max, r.length)
    return max
  }, [active])

  if (phase === 'loading') {
    return (
      <div className="flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-2 bg-white text-zinc-600">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <p className="text-xs">엑셀 불러오는 중…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-2 bg-white px-4 text-center">
        <p className="text-sm text-red-600">{errorText || '엑셀을 열 수 없습니다.'}</p>
        <p className="text-[11px] text-zinc-500">다운로드로 원본을 확인할 수 있습니다.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-white">
      {sheetNames.length > 1 ? (
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-2 py-1.5">
          {sheetNames.map((name, i) => (
            <button
              key={`${name}-${i}`}
              type="button"
              title={name}
              onClick={() => onSheetIndexChange(i)}
              className={cn(
                'max-w-[10rem] shrink-0 cursor-pointer truncate rounded px-2.5 py-1 text-[11px] transition-colors',
                i === activeIndex
                  ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300'
                  : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-900'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {active?.truncated ? (
        <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900/90">
          미리보기는 최대 {MAX_ROWS.toLocaleString()}행 × {MAX_COLS}열까지 표시합니다. (일부만 표시)
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {!active || active.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-zinc-500">표시할 셀이 없습니다.</p>
        ) : (
          <table className="border-collapse text-left text-[11px] text-zinc-900">
            <tbody>
              {active.rows.map((row, ri) => (
                <tr key={`r-${ri}`} className="border-b border-zinc-100">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] border-r border-zinc-200 bg-zinc-50 px-2 py-1 text-right text-[10px] font-normal tabular-nums text-zinc-400"
                  >
                    {ri + 1}
                  </th>
                  {Array.from({ length: colCount }, (_, ci) => {
                    const cell = row[ci]
                    const text = cell?.text ?? ''
                    return (
                      <td
                        key={`c-${ri}-${ci}`}
                        className="max-w-[16rem] truncate whitespace-nowrap border-r border-zinc-100 px-2 py-1"
                        title={text}
                        style={{
                          backgroundColor: cell?.bg || '#FFFFFF',
                          color: cell?.color || '#18181B',
                        }}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
