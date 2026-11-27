'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, FileSpreadsheet, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { SmallPublicCrudBar } from '../smallPublicUi'
import {
  PLAN_DB_YEARS,
  planCellsOfRow,
  planRowLocation,
  planSheetCellsOf,
  planSheetMid,
  planSheetValuesOf,
  sumPlanSheetCells,
  type PlanDbPeriod,
  type PlanDbRow,
  type PlanQtyCost,
  type PlanSaveEntry,
  type PlanSheetCells,
  type PlanSheetValues,
} from './smallPublicPlanDb'

export type SmallPublicPlanFilter = { keyword: string; emd: string }

/** 저장 전 임시 입력 — baseline과 다른 칸만 배경 표시 */
type SheetDraft = {
  baseline: PlanSheetValues
  current: PlanSheetValues
}

type Props = {
  filter: SmallPublicPlanFilter
  onFilterChange: (patch: Partial<SmallPublicPlanFilter>) => void
  emdOptions: string[]
  periods: PlanDbPeriod[]
  planId: number | null
  onPlanChange: (planId: number) => void
  onRegisterPeriod: () => void
  /** 선택한 연도구간의 시작연도 — 연차 머리글 */
  startYear: number
  rows: PlanDbRow[]
  all: PlanDbRow[]
  loading: boolean
  loadError: string
  /** 저장 — 성공 여부를 돌려준다 */
  onSave: (entries: PlanSaveEntry[]) => Promise<boolean>
  onExport: () => void
  onClose: () => void
}

const qtyText = (n: number) => (n ? Math.round(n).toLocaleString('ko-KR') : '')
const costText = (mil: number) =>
  mil ? mil.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : ''
const rateText = (r: number | null) => (r == null || r === 0 ? '' : r.toFixed(1))
const numText = (n: number, digits = 0) => (n ? n.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '')

/** 숫자·소수점만 (점은 하나) */
function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot < 0) return cleaned
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '')
}

/** 호버·작성 표시 — 계 행과 같은 슬레이트 */
const planSheetMarkBg = 'bg-slate-100 dark:bg-slate-800'
const planSheetInputTdClass = cn('p-0 hover:bg-slate-100 dark:hover:bg-slate-800')
const planSheetInputClass =
  'h-6 w-full min-w-0 border-0 bg-transparent px-1 text-right tabular-nums outline-none focus:bg-slate-100 focus:ring-0 dark:focus:bg-slate-800'

const planSheetCols = (
  <colgroup>
    <col className="w-[170px]" />
    <col className="w-[110px]" />
    {Array.from({ length: 23 }, (_, i) => (
      <col key={i} />
    ))}
    <col className="w-[44px]" />
  </colgroup>
)

const planSheetTableClass = cn(
  'w-full table-fixed border-separate border-spacing-0 text-[11px]',
  '[&_th]:border-b [&_th]:border-r [&_th]:border-border [&_th]:bg-muted [&_th]:px-1 [&_th]:py-1 [&_th]:text-center [&_th]:font-semibold [&_th]:text-foreground/90',
  '[&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1.5',
  '[&_td.num]:text-right [&_td.num]:tabular-nums'
)

function seedDraft(r: PlanDbRow): SheetDraft {
  const values = planSheetValuesOf(r)
  return { baseline: values, current: values }
}

function cellsWithDraft(r: PlanDbRow, draft: SheetDraft | undefined): PlanSheetCells {
  return draft ? planSheetCellsOf(draft.current) : planCellsOfRow(r)
}

function isDirtyNum(a: number, b: number) {
  return a !== b
}

function CellsReadonly({ c }: { c: PlanSheetCells }) {
  const mid = planSheetMid(c.years)
  return (
    <>
      <td className="num">{qtyText(c.totalQty)}</td>
      <td className="num">{costText(c.totalCost)}</td>
      <td className="num">{qtyText(c.doneQty)}</td>
      <td className="num">{costText(c.doneCost)}</td>
      <td className="num">{rateText(c.doneRate)}</td>
      <td className="num">{qtyText(mid.qty)}</td>
      <td className="num">{costText(mid.costMil)}</td>
      <td className="num">{rateText(c.midRate)}</td>
      {c.years.map((y, i) => (
        <Fragment key={i}>
          <td className="num">{qtyText(y.qty)}</td>
          <td className="num">{costText(y.costMil)}</td>
        </Fragment>
      ))}
      <td className="num">{numText(c.people)}</td>
      <td className="num">{numText(c.farmHa, 1)}</td>
      <td className="num">{numText(c.buildings)}</td>
      <td className="num">{qtyText(c.afterQty)}</td>
      <td className="num">{costText(c.afterCost)}</td>
    </>
  )
}

function SheetNumInput({
  inputKey,
  defaultValue,
  onCommit,
  ariaLabel,
  marked,
}: {
  inputKey: string
  defaultValue: string
  onCommit: (n: number) => void
  ariaLabel: string
  /** 저장 전·수정 중인 칸만 호버색 (저장 후 해제) */
  marked?: boolean
}) {
  return (
    <td className={cn(planSheetInputTdClass, marked && planSheetMarkBg)}>
      <input
        type="text"
        inputMode="decimal"
        className={planSheetInputClass}
        defaultValue={defaultValue}
        key={inputKey}
        onChange={(e) => {
          e.target.value = sanitizeDecimal(e.target.value)
          /* 입력 중에도 계·정비율이 바로 맞춰지도록 임시값 반영 */
          onCommit(Number(sanitizeDecimal(e.target.value)) || 0)
        }}
        onBlur={(e) => {
          onCommit(Number(sanitizeDecimal(e.target.value)) || 0)
        }}
        aria-label={ariaLabel}
      />
    </td>
  )
}

function YearInputs({
  rowId,
  years,
  formKey,
  baselineYears,
  onYears,
}: {
  rowId: number
  years: PlanQtyCost[]
  formKey: number
  baselineYears?: PlanQtyCost[]
  onYears: (next: PlanQtyCost[]) => void
}) {
  return (
    <>
      {years.map((y, i) => {
        const base = baselineYears?.[i]
        return (
          <Fragment key={i}>
            <SheetNumInput
              inputKey={`q-${formKey}-${rowId}-${i}`}
              defaultValue={y.qty ? String(y.qty) : ''}
              ariaLabel={`${i + 1}년차 사업량`}
              marked={Boolean(base && isDirtyNum(y.qty, base.qty))}
              onCommit={(qty) => {
                onYears(years.map((x, yi) => ({ qty: yi === i ? qty : x.qty, costMil: x.costMil })))
              }}
            />
            <SheetNumInput
              inputKey={`c-${formKey}-${rowId}-${i}`}
              defaultValue={y.costMil ? String(y.costMil) : ''}
              ariaLabel={`${i + 1}년차 사업비(백만원)`}
              marked={Boolean(base && isDirtyNum(y.costMil, base.costMil))}
              onCommit={(mil) => {
                onYears(years.map((x, yi) => ({ qty: x.qty, costMil: yi === i ? mil : x.costMil })))
              }}
            />
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * 중기 정비계획 명세서 — DB 목록. 입력은 임시 반영, «저장» 시 DB 반영·입력 칸 배경 해제.
 */
export function SmallPublicPlanSheet({
  filter,
  onFilterChange,
  emdOptions,
  periods,
  planId,
  onPlanChange,
  onRegisterPeriod,
  startYear,
  rows,
  all,
  loading,
  loadError,
  onSave,
  onExport,
  onClose,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, SheetDraft>>({})
  const [formKey, setFormKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const draftsRef = useRef(drafts)
  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])
  const dirty = Object.keys(drafts).length > 0

  const patchDraft = useCallback((r: PlanDbRow, patch: (cur: PlanSheetValues) => PlanSheetValues) => {
    setDrafts((prev) => {
      const key = String(r.id)
      const existing = prev[key] ?? seedDraft(r)
      return { ...prev, [key]: { baseline: existing.baseline, current: patch(existing.current) } }
    })
  }, [])

  const cells = useMemo(
    () => rows.map((r) => ({ r, c: cellsWithDraft(r, drafts[String(r.id)]), draft: drafts[String(r.id)] })),
    [rows, drafts]
  )
  /** 상단·행 중기 계 — 임시 입력 포함해 즉시 합산 */
  const total = useMemo(() => sumPlanSheetCells(cells.map((x) => x.c)), [cells])
  const years = Array.from({ length: PLAN_DB_YEARS }, (_, i) => startYear + i)
  const kpi = useMemo(
    () => ({ count: all.length, total: all.reduce((n, r) => n + r.costMil, 0) }),
    [all]
  )

  const commitSave = useCallback(async () => {
    const latest = draftsRef.current
    const entries: PlanSaveEntry[] = Object.entries(latest).map(([id, d]) => ({ id: Number(id), ...d.current }))
    if (entries.length === 0) {
      window.alert('저장할 변경이 없습니다.')
      return
    }
    setSaving(true)
    const ok = await onSave(entries)
    setSaving(false)
    if (!ok) {
      window.alert('저장하지 못했습니다. 다시 시도해 주세요.')
      return
    }
    setDrafts({})
    setFormKey((k) => k + 1)
  }, [onSave])

  const handleSave = () => {
    /* 포커스 중 입력도 계·저장에 포함 */
    const el = document.activeElement
    if (el instanceof HTMLElement) el.blur()
    window.setTimeout(() => void commitSave(), 0)
  }

  const handleCancel = () => {
    if (dirty && !window.confirm('입력 중인 내용을 취소할까요?')) return
    setDrafts({})
    setFormKey((k) => k + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[12px] font-semibold">정비계획</span>
        <span className="text-[11px] text-muted-foreground">중기 정비계획 명세서 (단위: m, 백만원, %)</span>
        <div className="ml-auto flex items-center gap-1.5">
          <LayerRowPanelButton onClick={onRegisterPeriod} title="중기 연도구간 등록">
            <CalendarPlus className="h-3 w-3 shrink-0" aria-hidden />
            연도 등록
          </LayerRowPanelButton>
          <LayerRowPanelButton onClick={onExport} title="화면에서 선택한 연도구간·읍면 기준 엑셀">
            <FileSpreadsheet className="h-3 w-3 shrink-0" aria-hidden />
            엑셀
          </LayerRowPanelButton>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <select
          className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[11px]"
          value={filter.emd}
          onChange={(e) => onFilterChange({ emd: e.target.value })}
          aria-label="읍면"
        >
          <option value="">전체 읍면</option>
          {emdOptions.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          className="standard-filter-select h-8 w-[8.5rem] max-w-none text-[11px]"
          value={planId ?? ''}
          onChange={(e) => onPlanChange(Number(e.target.value))}
          aria-label="중기계획 연도"
          disabled={periods.length === 0}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.startYear}~{p.endYear}년
            </option>
          ))}
        </select>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={filter.keyword}
            onChange={(e) => onFilterChange({ keyword: e.target.value })}
            placeholder="시설명·리명 검색"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-x-4 text-[12px] text-muted-foreground">
          <span>
            대상 <span className="text-foreground">{kpi.count}곳</span>
          </span>
          <span>
            총사업비 <span className="tabular-nums text-foreground">{costText(kpi.total)}</span>
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full min-w-[1400px] flex-col">
              {/* 본문 세로 스크롤바 너비만큼 헤더에도 gutter 예약 → 세로선 정렬 */}
              <div className="shrink-0 overflow-y-auto border-b border-border [scrollbar-gutter:stable] scrollbar-thin">
                <table className={planSheetTableClass}>
                  {planSheetCols}
                  <thead>
                    <tr>
                      <th rowSpan={3}>시설명칭</th>
                      <th rowSpan={3}>위치</th>
                      <th colSpan={2} rowSpan={2}>
                        전체 정비계획
                      </th>
                      <th colSpan={3} rowSpan={2}>
                        정비된 부분
                      </th>
                      <th colSpan={3 + years.length * 2 + 3}>중기 정비계획</th>
                      <th colSpan={2} rowSpan={2}>
                        5개년 후 정비대상
                      </th>
                      <th rowSpan={3}>
                        우선
                        <br />
                        순위
                      </th>
                    </tr>
                    <tr>
                      <th colSpan={3}>계</th>
                      {years.map((y) => (
                        <th key={y} colSpan={2}>
                          {y}년
                        </th>
                      ))}
                      <th colSpan={3}>사업효과</th>
                    </tr>
                    <tr>
                      <th>사업량</th>
                      <th>사업비</th>
                      <th>사업량</th>
                      <th>사업비</th>
                      <th>정비율</th>
                      <th>사업량</th>
                      <th>사업비</th>
                      <th>정비율</th>
                      {years.map((y) => (
                        <Fragment key={y}>
                          <th>사업량</th>
                          <th>사업비</th>
                        </Fragment>
                      ))}
                      <th>
                        수혜자
                        <br />
                        (명)
                      </th>
                      <th>
                        농경지
                        <br />
                        (ha)
                      </th>
                      <th>
                        건물
                        <br />
                        (동)
                      </th>
                      <th>사업량</th>
                      <th>사업비</th>
                    </tr>
                    <tr className="font-semibold [&>td]:border-b-0 [&>td]:bg-slate-100 dark:[&>td]:bg-slate-800">
                      <td className="text-center">계</td>
                      <td className="text-center font-normal text-muted-foreground">{rows.length}곳</td>
                      <CellsReadonly c={total} />
                      <td />
                    </tr>
                  </thead>
                </table>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] scrollbar-thin">
                <table className={planSheetTableClass}>
                  {planSheetCols}
                  <tbody>
                    {loading || loadError || cells.length === 0 ? (
                      <tr>
                        <td colSpan={26} className="border-b-0 border-r-0 py-10 text-center text-muted-foreground">
                          {loading
                            ? '불러오는 중입니다.'
                            : loadError
                              ? `정비계획을 불러오지 못했습니다. (${loadError})`
                              : '조건에 맞는 정비계획이 없습니다. 안전점검에서 이관하면 작성중으로 추가됩니다.'}
                        </td>
                      </tr>
                    ) : (
                      cells.map(({ r, c, draft }) => {
                        const mid = planSheetMid(c.years)
                        const base = draft?.baseline
                        const cur = draft?.current
                        return (
                          <tr key={r.id}>
                            <td className="truncate" title={r.consCode}>
                              {r.name}
                            </td>
                            <td className="truncate text-muted-foreground">{planRowLocation(r)}</td>
                            <td className="num">{qtyText(c.totalQty)}</td>
                            <td className="num">{costText(c.totalCost)}</td>
                            <SheetNumInput
                              inputKey={`done-q-${formKey}-${r.id}`}
                              defaultValue={c.doneQty ? String(c.doneQty) : ''}
                              ariaLabel="정비된 사업량"
                              marked={Boolean(base && cur && isDirtyNum(cur.done.qty, base.done.qty))}
                              onCommit={(n) =>
                                patchDraft(r, (d) => ({ ...d, done: { qty: n, costMil: d.done.costMil } }))
                              }
                            />
                            <SheetNumInput
                              inputKey={`done-c-${formKey}-${r.id}`}
                              defaultValue={c.doneCost ? String(c.doneCost) : ''}
                              ariaLabel="정비된 사업비(백만원)"
                              marked={Boolean(base && cur && isDirtyNum(cur.done.costMil, base.done.costMil))}
                              onCommit={(mil) =>
                                patchDraft(r, (d) => ({ ...d, done: { qty: d.done.qty, costMil: mil } }))
                              }
                            />
                            <td className="num" title="정비된 사업량 ÷ 전체 사업량 × 100">
                              {rateText(c.doneRate)}
                            </td>
                            <td className="num">{qtyText(mid.qty)}</td>
                            <td className="num">{costText(mid.costMil)}</td>
                            <td className="num" title="중기 사업량 ÷ 전체 사업량 × 100">
                              {rateText(c.midRate)}
                            </td>
                            <YearInputs
                              rowId={r.id}
                              years={c.years}
                              formKey={formKey}
                              baselineYears={base?.midYears}
                              onYears={(next) => patchDraft(r, (d) => ({ ...d, midYears: next }))}
                            />
                            <SheetNumInput
                              inputKey={`eff-p-${formKey}-${r.id}`}
                              defaultValue={c.people ? String(c.people) : ''}
                              ariaLabel="수혜자(명)"
                              marked={Boolean(base && cur && isDirtyNum(cur.effect.people, base.effect.people))}
                              onCommit={(n) =>
                                patchDraft(r, (d) => ({ ...d, effect: { ...d.effect, people: n } }))
                              }
                            />
                            <SheetNumInput
                              inputKey={`eff-f-${formKey}-${r.id}`}
                              defaultValue={c.farmHa ? String(c.farmHa) : ''}
                              ariaLabel="농경지(ha)"
                              marked={Boolean(base && cur && isDirtyNum(cur.effect.farmHa, base.effect.farmHa))}
                              onCommit={(n) =>
                                patchDraft(r, (d) => ({ ...d, effect: { ...d.effect, farmHa: n } }))
                              }
                            />
                            <SheetNumInput
                              inputKey={`eff-b-${formKey}-${r.id}`}
                              defaultValue={c.buildings ? String(c.buildings) : ''}
                              ariaLabel="건물(동)"
                              marked={Boolean(
                                base && cur && isDirtyNum(cur.effect.buildings, base.effect.buildings)
                              )}
                              onCommit={(n) =>
                                patchDraft(r, (d) => ({ ...d, effect: { ...d.effect, buildings: n } }))
                              }
                            />
                            <SheetNumInput
                              inputKey={`after-q-${formKey}-${r.id}`}
                              defaultValue={c.afterQty ? String(c.afterQty) : ''}
                              ariaLabel="5개년 후 사업량"
                              marked={Boolean(base && cur && isDirtyNum(cur.after.qty, base.after.qty))}
                              onCommit={(n) =>
                                patchDraft(r, (d) => ({ ...d, after: { qty: n, costMil: d.after.costMil } }))
                              }
                            />
                            <SheetNumInput
                              inputKey={`after-c-${formKey}-${r.id}`}
                              defaultValue={c.afterCost ? String(c.afterCost) : ''}
                              ariaLabel="5개년 후 사업비(백만원)"
                              marked={Boolean(base && cur && isDirtyNum(cur.after.costMil, base.after.costMil))}
                              onCommit={(mil) =>
                                patchDraft(r, (d) => ({ ...d, after: { qty: d.after.qty, costMil: mil } }))
                              }
                            />
                            <td className="text-center tabular-nums">{r.finalRank ?? ''}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SmallPublicCrudBar
        leading={
          <span className="text-[11px] text-muted-foreground">
            총 {rows.length}건 · 입력 시 계·정비율이 바로 맞춰지고, 저장하면 DB에 반영됩니다.
          </span>
        }
        onSave={handleSave}
        onCancel={handleCancel}
        saveDisabled={!dirty || saving}
      />
    </div>
  )
}
