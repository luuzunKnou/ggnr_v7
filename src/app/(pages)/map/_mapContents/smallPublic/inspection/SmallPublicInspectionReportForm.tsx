'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { smallPublicBtnGhost, smallPublicBtnPrimary, smallPublicFieldClass } from '../smallPublicConfig'
import { smallPublicActions, useSmallPublicStore } from '../smallPublicStore'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'
import {
  buildSmallPublicReportRows,
  smallPublicReportStamp,
  smallPublicReportTitle,
  type SmallPublicInspectionReport,
} from './smallPublicInspectionReport'

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 보고서 추가·수정 — 추가할 때 지금 일반·관리 시설(계속 점검 시설 포함)을 대상으로 자동으로 넣는다.
 * 수정은 보고서 내용만 바꾸고 대상 목록은 그대로 둔다(대상은 상세에서 추가·빼기).
 */
export function SmallPublicInspectionReportForm({
  initial,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  initial: SmallPublicInspectionReport | null
  onCancel: () => void
  onSaved: (report: SmallPublicInspectionReport) => void
}) {
  const { facilities, inspections, reports } = useSmallPublicStore()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(initial?.year ?? thisYear)
  const [baseDate] = useState(() => initial?.baseDate ?? todayYmd())
  const [title, setTitle] = useState(initial?.title ?? smallPublicReportTitle(thisYear))
  const [agency, setAgency] = useState(initial?.agency ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(
    () => (initial ? initial.rows : buildSmallPublicReportRows(facilities, inspections, baseDate)),
    [initial, facilities, inspections, baseDate]
  )
  const count = (cls: string) => rows.filter((r) => r.prevClass === cls).length
  const extra = rows.length - count('일반') - count('관리')

  const save = () => {
    if (!title.trim()) return setError('제목을 넣으세요.')
    if (!initial && reports.some((r) => r.year === year) && !window.confirm(`${year}년 보고서가 이미 있습니다. 하나 더 만들까요?`)) return
    const next: SmallPublicInspectionReport = {
      ...(initial ?? { id: `report-${Date.now()}`, createdAt: smallPublicReportStamp(), rows }),
      year,
      baseDate,
      title: title.trim(),
      agency: agency.trim(),
      author: author.trim(),
      summary: summary.trim(),
    }
    smallPublicActions.saveReport(next)
    onSaved(next)
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
          ? '보고서 내용을 고칩니다. 점검 대상은 상세에서 추가·빼기 합니다.'
          : '지금 일반·관리 시설이 점검 대상으로 자동으로 들어갑니다.'
      }
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            {initial ? '저장' : '추가'}
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
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
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {y}년
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
        <p className="rounded border border-border bg-muted/40 px-2 py-1.5 text-[11px]">
          점검 대상 {rows.length}곳
          <span className="text-muted-foreground">
            {' '}
            (일반 {count('일반')} · 관리 {count('관리')}
            {extra ? ` · 계속 점검 ${extra}` : ''})
          </span>
        </p>
        {error ? (
          <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</p>
        ) : null}
      </div>
    </SmallPublicModalShell>
  )
}
