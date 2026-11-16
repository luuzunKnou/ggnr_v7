'use client'

import { cn } from '@/lib/utils'
import {
  SMALL_PUBLIC_STATE_GRADES,
  smallPublicCheckGradeOf,
  smallPublicCheckItems,
  smallPublicGradeRuleText,
  smallPublicStateOf,
  type SmallPublicCheckForm,
  type SmallPublicCheckValues,
  type SmallPublicStateGrade,
} from './smallPublicCheckForms'
import { SmallPublicGradeBadge } from './smallPublicUi'

/** 점검항목(묶음)별 소계 — 상세 요약용 */
export function smallPublicCheckGroupScores(form: SmallPublicCheckForm, values: SmallPublicCheckValues) {
  return form.groups.map((g) => ({
    name: g.name,
    score: g.items.reduce((n, it) => n + (values[it.key]?.score ?? 0), 0),
    max: g.items.reduce((n, it) => n + it.max, 0),
  }))
}

/** 평가표 합계 — 모든 항목에 점수가 있어야 완성 */
export function smallPublicCheckTotal(form: SmallPublicCheckForm, values: SmallPublicCheckValues) {
  const items = smallPublicCheckItems(form)
  const filled = items.filter((it) => values[it.key] != null)
  const total = filled.reduce((n, it) => n + values[it.key]!.score, 0)
  const complete = filled.length === items.length
  /** 쓰지 않는 상태등급(사선 칸)에 걸린 항목 */
  const invalid = items.filter((it) => {
    const v = values[it.key]
    return v != null && it.disabled?.includes(v.state)
  })
  return { total, complete, invalid, grade: smallPublicCheckGradeOf(form, total) }
}

const HATCH =
  'bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,var(--border)_5px,var(--border)_6px)]'

/**
 * 위험도 평가표 — 양식(점검항목·세부사항·배점·A/B/C·점수)대로 그린다.
 * onChange 를 주면 입력 표(점수 칸 입력, A·B·C 칸 누르면 그 등급의 첫 점수), 없으면 보기 표.
 */
export function SmallPublicCheckSheet({
  form,
  values,
  onChange,
}: {
  form: SmallPublicCheckForm
  values: SmallPublicCheckValues
  onChange?: (next: SmallPublicCheckValues) => void
}) {
  const editable = Boolean(onChange)
  const { total, complete, grade } = smallPublicCheckTotal(form, values)
  /** 번호(1~)·묶음 첫 행 여부를 미리 매긴 행 목록 */
  const rows = form.groups.flatMap((g) => g.items.map((it, idx) => ({ group: g, it, first: idx === 0 })))

  const setScore = (key: string, raw: string) => {
    if (!onChange) return
    const next = { ...values }
    const digits = raw.replace(/[^\d]/g, '')
    if (digits === '') {
      delete next[key]
    } else {
      const score = Math.min(10, Number(digits))
      const state = smallPublicStateOf(form, score)
      if (state) next[key] = { score, state }
    }
    onChange(next)
  }

  const setState = (key: string, state: SmallPublicStateGrade) => {
    if (!onChange) return
    const cur = values[key]
    if (cur?.state === state) return
    onChange({ ...values, [key]: { score: form.stateRange[state][0], state } })
  }

  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-[11px] leading-snug">
        <colgroup>
          <col className="w-[6.75rem]" />
          <col />
          <col className="w-[2.25rem]" />
          {SMALL_PUBLIC_STATE_GRADES.map((s) => (
            <col key={s} className="w-[2.6rem]" />
          ))}
          <col className="w-[3rem]" />
        </colgroup>
        <thead className="bg-muted text-muted-foreground">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1 [&>th]:py-1 [&>th]:font-normal">
            <th rowSpan={2} className="border-r border-border">
              점검항목
            </th>
            <th rowSpan={2} className="border-r border-border">
              세부사항
            </th>
            <th rowSpan={2} className="border-r border-border">
              배점
            </th>
            <th colSpan={3} className="border-r border-border">
              상태등급
            </th>
            <th rowSpan={2}>점수</th>
          </tr>
          <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-border [&>th]:px-0.5 [&>th]:py-0.5 [&>th]:font-normal">
            {SMALL_PUBLIC_STATE_GRADES.map((s) => (
              <th key={s} className="leading-tight">
                {s}
                <span className="block text-[9px] opacity-70">
                  {form.stateRange[s][0]}~{form.stateRange[s][1]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-foreground/80">
          {rows.map(({ group: g, it, first }, rowIdx) => {
              const no = rowIdx + 1
              const v = values[it.key]
              const invalid = v != null && it.disabled?.includes(v.state)
              return (
                <tr key={it.key} className="border-b border-border">
                  {first ? (
                    <td
                      rowSpan={g.items.length}
                      className="whitespace-nowrap border-r border-border bg-muted/40 px-1 py-1 text-center"
                    >
                      {g.name}
                    </td>
                  ) : null}
                  <td className="truncate whitespace-nowrap border-r border-border px-1.5 py-1" title={`${no}) ${it.label}`}>
                    {no}) {it.label}
                  </td>
                  <td className="border-r border-border px-1 py-1 text-center tabular-nums">{it.max}</td>
                  {SMALL_PUBLIC_STATE_GRADES.map((s) => {
                    const off = it.disabled?.includes(s)
                    const on = v?.state === s
                    return (
                      <td
                        key={s}
                        className={cn(
                          'border-r border-border p-0 text-center',
                          off && HATCH,
                          on && (invalid ? 'bg-destructive/15' : 'bg-primary/10')
                        )}
                      >
                        {editable && !off ? (
                          <button
                            type="button"
                            onClick={() => setState(it.key, s)}
                            className="flex h-7 w-full items-center justify-center hover:bg-primary/5"
                            aria-label={`${no}번 ${s}`}
                            aria-pressed={on}
                          >
                            <span
                              className={cn(
                                'h-3.5 w-3.5 rounded-full border',
                                on ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                              )}
                            />
                          </button>
                        ) : on ? (
                          <span className={cn('font-semibold', invalid ? 'text-destructive' : 'text-primary')}>O</span>
                        ) : null}
                      </td>
                    )
                  })}
                  <td className={cn('px-1 py-0.5 text-center tabular-nums', invalid && 'text-destructive')}>
                    {editable ? (
                      <input
                        inputMode="numeric"
                        value={v ? String(v.score) : ''}
                        onChange={(e) => setScore(it.key, e.target.value)}
                        className={cn(
                          'h-6 w-full rounded border bg-background px-1 text-center text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25',
                          invalid ? 'border-destructive' : 'border-border'
                        )}
                        aria-label={`${no}번 점수`}
                      />
                    ) : (
                      (v?.score ?? '—')
                    )}
                  </td>
                </tr>
              )
            })}
        </tbody>
        <tfoot className="bg-muted/60">
          <tr>
            <td className="border-r border-border px-1 py-1 text-center text-muted-foreground">등급</td>
            <td colSpan={2} className="border-r border-border px-1.5 py-1">
              {complete ? <SmallPublicGradeBadge grade={grade} /> : <span className="text-muted-foreground">모든 항목을 채우면 정해집니다</span>}
            </td>
            <td colSpan={3} className="border-r border-border px-1 py-1 text-center text-muted-foreground">
              계
            </td>
            <td className="px-1 py-1 text-center font-semibold tabular-nums text-foreground">{total}</td>
          </tr>
        </tfoot>
      </table>
      <p className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
        점수기준 : {smallPublicGradeRuleText(form)} · {form.version}
      </p>
    </div>
  )
}
