'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { SMALL_PUBLIC_HATCH } from '../SmallPublicCheckSheet'
import {
  SMALL_PUBLIC_GRADES,
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  smallPublicFieldClass,
  type SmallPublicGrade,
} from '../smallPublicConfig'
import {
  smallPublicCheckFormFor,
  smallPublicCheckGradeOf,
  smallPublicMockCheckValues,
} from '../smallPublicCheckForms'
import {
  smallPublicClassFormFor,
  smallPublicClassOf,
  smallPublicClassTotal,
  smallPublicClassValuesWithAuto,
  smallPublicDefaultClassValues,
  type SmallPublicClassValues,
} from '../smallPublicClassForms'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions } from '../smallPublicStore'
import { SmallPublicAttrTable, SmallPublicClassBadge, SmallPublicGradeBadge } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

const LEVEL_COLS = 3

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 일반·관리 구분 평가 등록·수정.
 * 그해 위험도 점검이 있으면 그 기록의 구분 평가를 고치고, 없으면 보통 등급 위험도 점검을 함께 만든다.
 */
export function SmallPublicClassEvalFormModal({
  facility,
  initial = null,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  initial?: SmallPublicInspection | null
  onCancel: () => void
  onSaved: (inspection: SmallPublicInspection) => void
}) {
  const [form] = useState(() => initial?.classEval?.form ?? smallPublicClassFormFor(facility.type))
  const [date, setDate] = useState(initial?.date ?? todayYmd())
  const [inspector, setInspector] = useState(initial?.inspector ?? '')
  const [grade, setGrade] = useState<SmallPublicGrade>(initial?.grade ?? '보통')
  const [values, setValues] = useState<SmallPublicClassValues>(() =>
    smallPublicClassValuesWithAuto(
      form,
      initial?.classEval?.values ?? smallPublicDefaultClassValues(form),
      initial?.grade ?? '보통',
      facility.length
    )
  )
  const [error, setError] = useState<string | null>(null)

  const filledValues = useMemo(
    () => smallPublicClassValuesWithAuto(form, values, grade, facility.length),
    [form, values, grade, facility.length]
  )
  const total = smallPublicClassTotal(form, filledValues)
  const classResult = smallPublicClassOf(form, filledValues, grade, facility.candidate === '위험' ? '위험' : null)
  const complete = form.items.every((i) => filledValues[i.key] != null)
  const rows = form.items.map((item, idx) => ({
    item,
    no: idx + 1,
    first: idx === 0 || form.items[idx - 1]!.group !== item.group,
    span: form.items.filter((x) => x.group === item.group).length,
  }))

  const setLevel = (key: string, level: number, auto?: string) => {
    if (auto) return
    setValues((prev) => ({ ...prev, [key]: level }))
  }

  const save = () => {
    if (!date) return setError('평가일을 넣으세요.')
    if (!complete) return setError('평가표의 모든 항목 등급을 고르세요.')
    const classEval = { form, values: filledValues, total }
    if (initial) {
      const next: SmallPublicInspection = {
        ...initial,
        date,
        inspector: inspector.trim(),
        grade,
        classResult,
        classEval,
      }
      smallPublicActions.saveInspection(next)
      onSaved(next)
      return
    }
    const checkForm = smallPublicCheckFormFor(facility.type, date)
    const mid = grade === '양호' ? 30 : grade === '불량' ? 80 : 50
    const checkValues = smallPublicMockCheckValues(checkForm, mid)
    const score = Object.values(checkValues).reduce((n, v) => n + v.score, 0)
    const next: SmallPublicInspection = {
      id: `insp-${Date.now()}`,
      facilityId: facility.id,
      date,
      inspector: inspector.trim(),
      score,
      grade: smallPublicCheckGradeOf(checkForm, score),
      classResult,
      classEval,
      remark: '',
      form: checkForm,
      values: checkValues,
      reportId: null,
      file: null,
      classFile: null,
    }
    // 위험도 등급을 사용자가 고른 값에 맞춤(자동 생성 점수의 등급과 다를 수 있음)
    next.grade = grade
    next.classResult = smallPublicClassOf(form, filledValues, grade, facility.candidate === '위험' ? '위험' : null)
    smallPublicActions.saveInspection(next)
    onSaved(next)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={`${initial ? '일반·관리 평가 수정' : '일반·관리 평가 등록'} · ${facility.name}`}
      subtitle="합계 50점 미만 일반 · 50점 이상 관리. 위험도 불량이거나 이미 위험시설이면 위험입니다."
      onClose={onCancel}
      footer={
        <div className="flex w-full items-center gap-2.5">
          <span className="mr-auto text-[11px] text-muted-foreground">
            합계 <span className="tabular-nums text-foreground">{total}</span>점
            {complete ? (
              <>
                {' '}
                · <SmallPublicClassBadge candidate={classResult} />
              </>
            ) : null}
          </span>
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            저장
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </div>
      }
    >
      <SmallPublicAttrTable
        entries={[
          {
            key: 'date',
            label: '평가일 *',
            value: (
              <input
                type="date"
                className={cn(smallPublicFieldClass, initial && 'cursor-not-allowed bg-muted text-muted-foreground')}
                value={date}
                readOnly={!!initial}
                title={initial ? '기존 점검일은 바꿀 수 없습니다.' : undefined}
                onChange={(e) => setDate(e.target.value)}
              />
            ),
          },
          {
            key: 'inspector',
            label: '평가자',
            value: (
              <input className={smallPublicFieldClass} value={inspector} onChange={(e) => setInspector(e.target.value)} />
            ),
          },
          {
            key: 'grade',
            label: '위험도 등급',
            value: (
              <select
                className={smallPublicFieldClass}
                value={grade}
                onChange={(e) => setGrade(e.target.value as SmallPublicGrade)}
              >
                {SMALL_PUBLIC_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            ),
          },
          {
            key: 'preview',
            label: '평가구분',
            value: complete ? <SmallPublicClassBadge candidate={classResult} /> : '—',
          },
        ]}
      />
      <div className="mt-3 overflow-hidden rounded-[5px] border border-border">
        <table className="w-full table-fixed border-collapse text-[11px] leading-snug">
          <colgroup>
            <col className="w-[6.75rem]" />
            <col />
            <col className="w-[2.25rem]" />
            {Array.from({ length: LEVEL_COLS }, (_, k) => (
              <col key={k} className="w-[4.75rem]" />
            ))}
            <col className="w-[3rem]" />
          </colgroup>
          <thead className="bg-muted text-muted-foreground">
            <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-border [&>th]:px-1 [&>th]:py-1 [&>th]:font-normal">
              <th>구분</th>
              <th>평가항목</th>
              <th>배점</th>
              <th colSpan={LEVEL_COLS}>평가 등급</th>
              <th className="border-r-0">점수</th>
            </tr>
          </thead>
          <tbody className="text-foreground/80">
            {rows.map(({ item, no, first, span }) => {
              const level = filledValues[item.key] ?? 0
              const score = item.scores[level] ?? 0
              return (
                <tr key={item.key} className="border-b border-border">
                  {first ? (
                    <td rowSpan={span} className="whitespace-nowrap border-r border-border bg-muted/40 px-1 py-1 text-center">
                      {item.group}
                    </td>
                  ) : null}
                  <td className="truncate whitespace-nowrap border-r border-border px-1.5 py-1" title={`${no}) ${item.label}`}>
                    {no}) {item.label}
                    {item.auto ? <span className="ml-1 text-[10px] text-muted-foreground">(자동)</span> : null}
                  </td>
                  <td className="border-r border-border px-1 py-1 text-center tabular-nums">10</td>
                  {Array.from({ length: LEVEL_COLS }, (_, k) => {
                    const lv = item.levels[k]
                    const on = lv != null && level === k
                    const disabled = item.auto != null || lv == null
                    return (
                      <td
                        key={k}
                        className={cn('border-r border-border p-0 text-center', lv == null && SMALL_PUBLIC_HATCH)}
                      >
                        {lv == null ? null : (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setLevel(item.key, k, item.auto)}
                            className={cn(
                              'flex h-7 w-full items-center justify-center truncate px-0.5 transition-colors',
                              disabled ? 'cursor-default' : 'hover:bg-muted/60',
                              on && 'bg-primary/10 text-primary'
                            )}
                            title={`${lv} ${item.scores[k]}점`}
                          >
                            {lv}
                          </button>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1 text-center tabular-nums">{score}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
          {form.version}
          {form.note ? ` · ${form.note}` : ''}
          {!initial ? ' · 위험도 점검 기록이 없으면 선택한 등급으로 함께 만듭니다.' : ''}
        </p>
      </div>
      {error ? (
        <p className="mt-2 rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</p>
      ) : null}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        위험도 등급 미리보기 <SmallPublicGradeBadge grade={grade} />
      </p>
    </SmallPublicModalShell>
  )
}
