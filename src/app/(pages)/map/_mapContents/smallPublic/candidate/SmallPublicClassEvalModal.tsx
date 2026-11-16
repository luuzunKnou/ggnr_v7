'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SMALL_PUBLIC_HATCH } from '../SmallPublicCheckSheet'
import { smallPublicBtnDanger, smallPublicBtnGhost, smallPublicBtnPrimary } from '../smallPublicConfig'
import type { SmallPublicInspection } from '../smallPublicMock'
import { SmallPublicAttrTable, SmallPublicClassBadge, SmallPublicGradeBadge, smallPublicDateLabel } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

const LEVEL_COLS = 3

/**
 * 일반시설·관리시설 구분 평가표 보기 — 위험도 평가표와 같은 모양.
 * 위험도 평가 항목은 그해 위험도 평가 등급, 시설 규모는 시설 연장으로 정해진 값.
 */
export function SmallPublicClassEvalModal({
  inspection: i,
  onEdit,
  onDelete,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  inspection: SmallPublicInspection
  onEdit?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  if (!i.classEval) return null
  const { form, values, total } = i.classEval
  const rows = form.items.map((item, idx) => ({
    item,
    no: idx + 1,
    first: idx === 0 || form.items[idx - 1]!.group !== item.group,
    span: form.items.filter((x) => x.group === item.group).length,
  }))
  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={`일반·관리 구분 평가 ${i.date.slice(0, 4)}년`}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button type="button" className={smallPublicBtnDanger} onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
              삭제
            </button>
          ) : null}
          {onEdit ? (
            <button type="button" className={smallPublicBtnPrimary} onClick={onEdit}>
              <Pencil className="h-3 w-3" />
              수정
            </button>
          ) : null}
          <button type="button" className={smallPublicBtnGhost} onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      <SmallPublicAttrTable
        entries={[
          { key: 'date', label: '위험도 평가일', value: smallPublicDateLabel(i.date) },
          { key: 'grade', label: '위험도 등급', value: <SmallPublicGradeBadge grade={i.grade} /> },
          { key: 'total', label: '합계점수', value: `${total}점` },
          { key: 'class', label: '평가구분', value: <SmallPublicClassBadge candidate={i.classResult} /> },
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
              const level = values[item.key] ?? 0
              return (
                <tr key={item.key} className="border-b border-border">
                  {first ? (
                    <td rowSpan={span} className="whitespace-nowrap border-r border-border bg-muted/40 px-1 py-1 text-center">
                      {item.group}
                    </td>
                  ) : null}
                  <td className="truncate whitespace-nowrap border-r border-border px-1.5 py-1" title={`${no}) ${item.label}`}>
                    {no}) {item.label}
                  </td>
                  <td className="border-r border-border px-1 py-1 text-center tabular-nums">10</td>
                  {Array.from({ length: LEVEL_COLS }, (_, k) => {
                    const lv = item.levels[k]
                    const on = lv != null && level === k
                    return (
                      <td
                        key={k}
                        className={cn(
                          'truncate border-r border-border px-0.5 py-1 text-center',
                          lv == null && SMALL_PUBLIC_HATCH,
                          on && 'bg-primary/10 text-primary'
                        )}
                        title={lv ? `${lv} ${item.scores[k]}점` : undefined}
                      >
                        {lv ?? ''}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1 text-center tabular-nums">{item.scores[level]}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-muted/60">
            <tr>
              <td className="border-r border-border px-1 py-1 text-center text-muted-foreground">평가 결과</td>
              <td colSpan={2} className="border-r border-border px-1.5 py-1">
                <SmallPublicClassBadge candidate={i.classResult} />
              </td>
              <td colSpan={LEVEL_COLS} className="border-r border-border px-1 py-1 text-center text-muted-foreground">
                계
              </td>
              <td className="px-1 py-1 text-center tabular-nums text-foreground">{total}</td>
            </tr>
          </tfoot>
        </table>
        <p className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
          구분 기준 : 일반시설 {form.threshold}점 미만 · 관리시설 {form.threshold}점 이상 · 위험도 평가 불량은 위험시설 · 위험도
          평가·규모는 자동 · {form.version}
          {form.note ? ` · ${form.note}` : ''}
        </p>
      </div>
    </SmallPublicModalShell>
  )
}
