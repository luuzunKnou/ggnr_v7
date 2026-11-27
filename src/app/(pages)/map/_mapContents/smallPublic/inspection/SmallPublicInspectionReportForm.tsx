'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { smallPublicBtnGhost, smallPublicBtnPrimary, smallPublicFieldClass } from '../smallPublicConfig'
import { smallPublicActions } from '../smallPublicStore'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'
import {
  smallPublicReportStamp,
  smallPublicReportTitle,
  type SmallPublicInspectionReport,
} from './smallPublicInspectionReport'

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 보고서 추가·수정 — DB(안전점검 보고서)에 저장한다. 연도마다 보고서는 하나.
 * 추가하면 서버가 지금 일반·관리 시설과 지난해 보고서의 위험(계속 점검) 시설을 대상으로 자동으로 넣는다.
 * 수정은 보고서 내용만 바꾸고 대상 목록은 그대로 둔다(대상은 상세에서 추가).
 */
export function SmallPublicInspectionReportForm({
  initial,
  existingYears = [],
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  initial: SmallPublicInspectionReport | null
  /** 이미 보고서가 있는 연도 — 추가할 때 고를 수 없다 */
  existingYears?: number[]
  onCancel: () => void
  onSaved: (report: SmallPublicInspectionReport) => void
}) {
  const thisYear = new Date().getFullYear()
  const yearChoices = useMemo(() => {
    const list = new Set<number>([thisYear + 1, thisYear, thisYear - 1, thisYear - 2, thisYear - 3])
    existingYears.forEach((y) => list.add(y))
    if (initial) list.add(initial.year)
    return [...list].sort((a, b) => b - a)
  }, [existingYears, initial, thisYear])
  const taken = (y: number) => existingYears.includes(y) && y !== initial?.year
  const [year, setYear] = useState(() => {
    if (initial) return initial.year
    return yearChoices.find((y) => y <= thisYear + 1 && !existingYears.includes(y)) ?? thisYear
  })
  const [baseDate] = useState(() => initial?.baseDate ?? todayYmd())
  const [title, setTitle] = useState(initial?.title ?? smallPublicReportTitle(year))
  const [agency, setAgency] = useState(initial?.agency ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    if (!title.trim()) return setError('제목을 넣으세요.')
    if (taken(year)) return setError(`${year}년 보고서가 이미 있습니다.`)
    setSaving(true)
    setError(null)
    const res = await smallPublicActions.saveReport({
      id: initial?.id,
      year,
      baseDate,
      title: title.trim(),
      agency: agency.trim(),
      author: author.trim(),
      summary: summary.trim(),
    })
    setSaving(false)
    if (!res.success) return setError(res.error)
    onSaved({
      ...(initial ?? { createdAt: smallPublicReportStamp(), rows: [] }),
      id: res.reportId,
      year,
      baseDate,
      title: title.trim(),
      agency: agency.trim(),
      author: author.trim(),
      summary: summary.trim(),
    })
  }

  const label = (text: string, required?: boolean) => (
    <span className="mb-0.5 block text-[11px] text-muted-foreground">
      {text}
      {required ? <span className="text-destructive"> *</span> : null}
    </span>
  )

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={initial ? '보고서 수정' : '보고서 추가'}
      subtitle={
        initial
          ? '보고서 내용을 고칩니다. 점검 대상은 상세에서 추가합니다.'
          : '지금 일반·관리 시설과 지난해 위험시설 재점검 대상이 자동으로 들어갑니다.'
      }
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={smallPublicBtnPrimary} onClick={() => void save()} disabled={saving}>
            {saving ? '저장 중…' : initial ? '저장' : '추가'}
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel} disabled={saving}>
            취소
          </button>
        </>
      }
    >
      <div className="space-y-2">
        <label className="block w-32">
          {label('연도', true)}
          <select
            className={smallPublicFieldClass}
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value)
              if (title === smallPublicReportTitle(year)) setTitle(smallPublicReportTitle(y))
              setYear(y)
            }}
          >
            {yearChoices.map((y) => (
              <option key={y} value={y} disabled={taken(y)}>
                {y}년{taken(y) ? ' (작성됨)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {label('제목', true)}
          <input className={smallPublicFieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            {label('점검 기관')}
            <input className={smallPublicFieldClass} value={agency} onChange={(e) => setAgency(e.target.value)} />
          </label>
          <label className="block">
            {label('작성자')}
            <input className={smallPublicFieldClass} value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
        </div>
        <label className="block">
          {label('개요')}
          <textarea
            className={cn(smallPublicFieldClass, 'h-20 resize-none py-1')}
            value={summary}
            placeholder="점검 목적·범위·일정 등"
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        {initial ? (
          <p className="rounded border border-border bg-muted/40 px-2 py-1.5 text-[11px]">
            점검 대상 {initial.rows.length}곳
          </p>
        ) : null}
        {error ? (
          <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</p>
        ) : null}
      </div>
    </SmallPublicModalShell>
  )
}
