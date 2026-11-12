'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SMALL_PUBLIC_GRADES,
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  smallPublicFieldClass,
  type SmallPublicClass,
  type SmallPublicGrade,
} from '../smallPublicConfig'
import { smallPublicCheckFormFor } from '../smallPublicCheckForms'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions, smallPublicFileFromUpload, useSmallPublicStore } from '../smallPublicStore'
import { SmallPublicAttrTable, SmallPublicClassBadge, SmallPublicGradeBadge } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 등급 → 평가구분 — 불량·기존 위험은 위험, 보통 관리, 양호 일반 */
function classFromGrade(grade: SmallPublicGrade, prevClass: SmallPublicClass | null): SmallPublicClass {
  if (grade === '불량' || prevClass === '위험') return '위험'
  if (grade === '보통') return '관리'
  return '일반'
}

function scoreOfGrade(grade: SmallPublicGrade): number {
  if (grade === '양호') return 20
  if (grade === '보통') return 50
  return 80
}

function filesOfInspection(i: SmallPublicInspection | null): SmallPublicFile[] {
  if (!i) return []
  return [i.file, i.classFile].filter((f): f is SmallPublicFile => !!f)
}

/**
 * 점검 등록·수정 — 상세 보기와 같은 한 줄 속성표 + 내용 높이만큼 모달.
 */
export function SmallPublicInspectionFormModal({
  facility,
  year,
  reportId,
  initial,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  /** 보고서 연도 — 점검일은 이 연도 안에서만(보고서당 시설 점검 1건) */
  year?: number
  /** 보고서에서 등록하면 그 보고서 점검으로 */
  reportId?: string
  initial: SmallPublicInspection | null
  onCancel: () => void
  onSaved: (inspection: SmallPublicInspection) => void
}) {
  const { inspections } = useSmallPublicStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState(
    () => initial?.date ?? (year && !todayYmd().startsWith(String(year)) ? `${year}-01-01` : todayYmd())
  )
  const [inspector, setInspector] = useState(initial?.inspector ?? '')
  const [grade, setGrade] = useState<SmallPublicGrade>(initial?.grade ?? '보통')
  const [remark, setRemark] = useState(initial?.remark ?? '')
  const [files, setFiles] = useState<SmallPublicFile[]>(() => filesOfInspection(initial))

  const prev = inspections
    .filter((i) => i.facilityId === facility.id && i.id !== initial?.id && i.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const autoClass = classFromGrade(grade, prev?.classResult ?? null)
  const becomesLatest = !inspections.some(
    (i) => i.facilityId === facility.id && i.id !== initial?.id && i.date > date
  )
  const classChange = becomesLatest && autoClass !== facility.candidate ? autoClass : null

  const spec = [
    facility.length && `연장 ${facility.length}m`,
    facility.width && `폭 ${facility.width}m`,
    facility.height && `높이 ${facility.height}m`,
  ]
    .filter(Boolean)
    .join(' · ')
  const subtitle = [
    facility.type,
    [facility.emd, facility.ri].filter(Boolean).join(' '),
    spec || null,
  ]
    .filter(Boolean)
    .join(' · ')

  const save = () => {
    if (!date) return setError('점검일을 넣으세요.')
    if (year && !date.startsWith(String(year))) return setError(`보고서 연도(${year}년) 안의 점검일을 넣으세요.`)
    if (files.length === 0) return setError('평가 첨부 PDF를 한 개 이상 올리세요.')
    const dup = inspections.some(
      (i) => i.facilityId === facility.id && i.date === date && i.id !== initial?.id
    )
    if (dup) return setError('같은 날 점검이 이미 있습니다.')
    const form = initial?.form ?? smallPublicCheckFormFor(facility.type, date)
    const next: SmallPublicInspection = {
      id: initial?.id ?? `insp-${Date.now()}`,
      facilityId: facility.id,
      date,
      reportId: initial?.reportId ?? reportId ?? null,
      inspector: inspector.trim(),
      score: scoreOfGrade(grade),
      grade,
      classResult: autoClass,
      classEval: null,
      remark: remark.trim(),
      form,
      values: {},
      file: files[0] ?? null,
      classFile: files[1] ?? null,
    }
    smallPublicActions.saveInspection(next)
    onSaved(next)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={`${initial ? '점검 수정' : '점검 등록'} · ${facility.name}`}
      subtitle={subtitle || '위험도 평가 PDF와 점검일·점검자·등급을 넣습니다.'}
      showHeaderClose
      onClose={onCancel}
      bodyClassName="max-h-[min(60dvh,28rem)] overflow-y-auto px-3 py-2.5 scrollbar-thin"
      footer={
        <div className="flex w-full items-center gap-2.5">
          {error ? <span className="mr-auto text-[11px] text-destructive">{error}</span> : <span className="mr-auto" />}
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            저장
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5 text-[11px]">
        {classChange ? (
          <p className="rounded border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            저장하면 시설 구분이 {facility.candidate} → {classChange}(으)로 바뀝니다.
            {classChange === '위험' ? ' 위험시설은 정비계획 대상이 됩니다.' : ''}
          </p>
        ) : null}
        <SmallPublicAttrTable
          stacked
          entries={[
            {
              key: 'date',
              label: '점검일',
              value: (
                <input
                  type="date"
                  className={cn(smallPublicFieldClass, initial && 'cursor-not-allowed bg-muted text-muted-foreground')}
                  value={date}
                  readOnly={!!initial}
                  title={initial ? '점검일은 수정할 수 없습니다.' : undefined}
                  onChange={(e) => setDate(e.target.value)}
                />
              ),
            },
            {
              key: 'inspector',
              label: '점검자',
              value: (
                <input
                  type="text"
                  className={smallPublicFieldClass}
                  value={inspector}
                  onChange={(e) => setInspector(e.target.value)}
                  placeholder="점검자"
                />
              ),
            },
            {
              key: 'grade',
              label: '등급',
              value: (
                <div className="flex flex-wrap items-center gap-1">
                  {SMALL_PUBLIC_GRADES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(g)}
                      className={cn(
                        'inline-flex items-center rounded border px-1.5 py-0.5',
                        grade === g
                          ? 'border-primary bg-primary/10 ring-1 ring-inset ring-primary/30'
                          : 'border-border hover:bg-muted/50'
                      )}
                      aria-pressed={grade === g}
                    >
                      <SmallPublicGradeBadge grade={g} />
                    </button>
                  ))}
                </div>
              ),
            },
            {
              key: 'class',
              label: '평가구분',
              value: (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <SmallPublicClassBadge candidate={autoClass} />
                  <span className="text-[10px] text-muted-foreground">등급에 따라 자동</span>
                </span>
              ),
            },
            {
              key: 'files',
              label: '첨부 PDF',
              value: (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className={smallPublicBtnGhost} onClick={() => fileRef.current?.click()}>
                      <Paperclip className="h-3 w-3" />
                      파일 추가
                    </button>
                    {files.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">위험도 평가 PDF를 올리세요.</span>
                    ) : null}
                  </div>
                  {files.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {files.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px]"
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground/80" title={f.name}>
                            {f.name}
                          </span>
                          <button
                            type="button"
                            className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                            title="제거"
                            aria-label="제거"
                            onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? [])
                      if (list.length) setFiles((prev) => [...prev, ...list.map((f) => smallPublicFileFromUpload(f, 'safety'))])
                      e.target.value = ''
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'remark',
              label: '비고',
              value: (
                <input
                  type="text"
                  className={smallPublicFieldClass}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="선택"
                />
              ),
            },
          ]}
        />
      </div>
    </SmallPublicModalShell>
  )
}
