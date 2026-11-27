'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Paperclip, X } from 'lucide-react'
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
import {
  smallPublicInspectionFiles,
  type SmallPublicFacility,
  type SmallPublicFile,
  type SmallPublicInspection,
} from '../smallPublicMock'
import { deleteInspectionFile, smallPublicFileYear, uploadInspectionFiles } from '../smallPublicAttachmentApi'
import { smallPublicActions, smallPublicFileFromUpload, useSmallPublicStore } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicClassBadge,
  SmallPublicInlineFilePreview,
  SmallPublicPanelHeader,
  smallPublicAttachmentDisplayName,
  smallPublicSelectedRowClass,
  useSmallPublicFilePreview,
} from '../smallPublicUi'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'

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
  return smallPublicInspectionFiles(i)
}

/** 파일명으로 위험도·구분·현장조사 칸 나누기 — 못 맞추면 위험도 칸부터 채움 */
function slotFiles(files: SmallPublicFile[]): Pick<SmallPublicInspection, 'file' | 'classFile' | 'fieldFile'> {
  const find = (re: RegExp) => files.find((f) => re.test(f.name.replace(/\.[^.]+$/, ''))) ?? null
  const risk = find(/위험도/)
  const cls = find(/일반.?관리|구분/)
  const field = find(/현장조사/)
  const rest = files.filter((f) => f !== risk && f !== cls && f !== field)
  return {
    file: risk ?? rest.shift() ?? null,
    classFile: cls ?? rest.shift() ?? null,
    fieldFile: field ?? rest.shift() ?? null,
  }
}

/**
 * 점검 등록·수정 — 목록 옆 붙는 패널(후보지 상세와 동일).
 */
export function SmallPublicInspectionFormModal({
  facility,
  year,
  reportId,
  initial,
  onCancel,
  onSaved,
}: {
  facility: SmallPublicFacility
  year?: number
  reportId?: string
  initial: SmallPublicInspection | null
  onCancel: () => void
  onSaved: (inspection: SmallPublicInspection) => void
  /** @deprecated 호환용 */
  overlayLeftPx?: number
  overlayWidthPx?: number
}) {
  const { inspections } = useSmallPublicStore()
  const preview = useSmallPublicFilePreview()
  const fileRef = useRef<HTMLInputElement>(null)
  /** 이번에 새로 고른 파일(저장 때 서버 폴더에 올림) */
  const pendingRef = useRef(new Map<string, File>())
  /** 서버 폴더에 있던 파일 중 지우기로 한 것(저장 때 삭제) */
  const removedRef = useRef<SmallPublicFile[]>([])
  /** 사용자가 첨부를 만졌는지 — 안 만졌으면 늦게 도착한 서버 첨부 목록으로 갱신 */
  const touchedRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attrsOpen, setAttrsOpen] = useState(true)
  const [date, setDate] = useState(
    () => initial?.date ?? (year && !todayYmd().startsWith(String(year)) ? `${year}-01-01` : todayYmd())
  )
  const [inspector, setInspector] = useState(initial?.inspector ?? '')
  const [grade, setGrade] = useState<SmallPublicGrade>(initial?.grade ?? '보통')
  const [score, setScore] = useState(() =>
    initial?.score != null ? String(initial.score) : String(scoreOfGrade(initial?.grade ?? '보통'))
  )
  const [remark, setRemark] = useState(initial?.remark ?? '')
  const [files, setFiles] = useState<SmallPublicFile[]>(() => filesOfInspection(initial))
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    () => filesOfInspection(initial)[0]?.id ?? null
  )

  useEffect(() => {
    if (touchedRef.current || !initial?.files) return
    setFiles(initial.files)
  }, [initial?.files])

  useEffect(() => {
    if (files.length === 0) {
      setSelectedFileId(null)
      return
    }
    if (!selectedFileId || !files.some((f) => f.id === selectedFileId)) {
      setSelectedFileId(files[0]!.id)
    }
  }, [files, selectedFileId])

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? files[0] ?? null

  const prev = inspections
    .filter((i) => i.facilityId === facility.id && i.id !== initial?.id && i.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const autoClass = classFromGrade(grade, prev?.classResult ?? null)

  const removeFile = (file: SmallPublicFile) => {
    touchedRef.current = true
    if (pendingRef.current.has(file.id)) {
      pendingRef.current.delete(file.id)
      if (file.url) URL.revokeObjectURL(file.url)
    } else if (smallPublicFileYear(file)) {
      removedRef.current.push(file)
    }
    setFiles((prev) => prev.filter((x) => x.id !== file.id))
  }

  const save = async () => {
    if (saving) return
    if (!date) return setError('조사일을 넣으세요.')
    if (year && !date.startsWith(String(year))) return setError(`보고서 연도(${year}년) 안의 조사일을 넣으세요.`)
    const scoreNum = Number(score)
    if (!Number.isFinite(scoreNum)) return setError('평가점수를 숫자로 넣으세요.')
    if (files.length === 0) return setError('평가 첨부 PDF를 한 개 이상 올리세요.')
    const dup = inspections.some(
      (i) => i.facilityId === facility.id && i.date === date && i.id !== initial?.id
    )
    if (dup) return setError('같은 날 점검이 이미 있습니다.')
    const mngNo = String(facility.mngNo ?? '').trim()
    if (!mngNo || mngNo.startsWith('excl:')) return setError('관리번호가 없는 시설은 첨부를 저장할 수 없습니다.')

    /** 서버 폴더 {관리번호}/{점검연도}/ 에 올리고 지운 파일을 정리 — 후보지 상세·보고서도 같은 폴더를 읽는다 */
    setSaving(true)
    setError(null)
    let finalFiles = files
    try {
      for (const f of removedRef.current) await deleteInspectionFile(mngNo, f)
      removedRef.current = []
      const pendingFiles = files.filter((f) => pendingRef.current.has(f.id))
      if (pendingFiles.length > 0) {
        const uploaded = await uploadInspectionFiles(
          mngNo,
          date.slice(0, 4),
          pendingFiles.map((f) => pendingRef.current.get(f.id)!)
        )
        const byOrder = [...uploaded]
        finalFiles = files.map((f) => (pendingRef.current.has(f.id) ? (byOrder.shift() ?? f) : f))
        pendingFiles.forEach((f) => f.url && URL.revokeObjectURL(f.url))
        pendingRef.current.clear()
      }
    } catch (e) {
      setSaving(false)
      return setError(e instanceof Error ? e.message : '첨부 저장에 실패했습니다.')
    }
    setSaving(false)

    const form =
      initial?.form && Array.isArray(initial.form.groups) && initial.form.groups.length > 0
        ? initial.form
        : smallPublicCheckFormFor(facility.type, date)
    const next: SmallPublicInspection = {
      id: initial?.id ?? `insp-${Date.now()}`,
      facilityId: facility.id,
      date,
      reportId: initial?.reportId ?? reportId ?? null,
      inspector: inspector.trim(),
      score: scoreNum,
      grade,
      classResult: autoClass,
      classEval: null,
      remark: remark.trim(),
      form,
      values: {},
      ...slotFiles(finalFiles),
      files: finalFiles,
    }
    setSaving(true)
    const saved = await smallPublicActions.saveInspection(next)
    setSaving(false)
    if (!saved.success) return setError(saved.error)
    onSaved(saved.inspection)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader
        title={facility.name}
        onClose={onCancel}
        badge={
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground/80">
            {facility.type}
          </span>
        }
      />

      <section className="shrink-0 border-b border-border">
        <button
          type="button"
          onClick={() => setAttrsOpen((o) => !o)}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-semibold text-foreground/90"
        >
          {attrsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          속성정보
        </button>
        {attrsOpen ? (
          <div className="max-h-[48vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            <SmallPublicAttrTable
              stacked
              entries={[
                {
                  key: 'date',
                  label: '조사일',
                  value: (
                    <input
                      type="date"
                      className={cn(
                        smallPublicFieldClass,
                        initial && 'cursor-not-allowed bg-muted text-muted-foreground'
                      )}
                      value={date}
                      readOnly={!!initial}
                      title={initial ? '조사일은 수정할 수 없습니다.' : undefined}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  ),
                },
                {
                  key: 'inspector',
                  label: '조사자',
                  value: (
                    <input
                      type="text"
                      className={smallPublicFieldClass}
                      value={inspector}
                      onChange={(e) => setInspector(e.target.value)}
                      placeholder="조사자"
                    />
                  ),
                },
                {
                  key: 'score',
                  label: '평가점수',
                  value: (
                    <input
                      type="number"
                      inputMode="decimal"
                      className={cn(smallPublicFieldClass, 'tabular-nums')}
                      value={score}
                      onChange={(e) => setScore(e.target.value)}
                    />
                  ),
                },
                {
                  key: 'grade',
                  label: '평가등급',
                  value: (
                    <div className="flex flex-wrap items-center gap-1">
                      {SMALL_PUBLIC_GRADES.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGrade(g)}
                          className={cn(
                            'inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded border px-2 text-[11px]',
                            grade === g
                              ? 'border-foreground/40 bg-muted font-semibold text-foreground'
                              : 'border-border bg-background font-normal text-foreground/80 hover:bg-muted/50'
                          )}
                          aria-pressed={grade === g}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'class',
                  label: '평가구분',
                  value: (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <SmallPublicClassBadge candidate={autoClass} />
                      <span className="text-[10px] text-muted-foreground">평가등급에 따라 자동</span>
                    </div>
                  ),
                },
                {
                  key: 'remark',
                  label: '기타의견',
                  value: (
                    <textarea
                      className={cn(
                        smallPublicFieldClass,
                        'h-[3.25rem] min-h-[3.25rem] resize-y py-1.5 leading-relaxed'
                      )}
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      rows={2}
                    />
                  ),
                },
              ]}
            />
          </div>
        ) : null}
      </section>

      <div className="flex min-h-0 flex-1 flex-col px-3 py-2 text-xs">
        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-foreground/90">첨부 PDF</p>
          <LayerRowPanelButton onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
            파일 추가
          </LayerRowPanelButton>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? [])
              if (list.length) {
                touchedRef.current = true
                const added = list.map((f) => {
                  const item = smallPublicFileFromUpload(f, 'safety')
                  pendingRef.current.set(item.id, f)
                  return item
                })
                setFiles((prev) => [...prev, ...added])
                setSelectedFileId(added[0]!.id)
              }
              e.target.value = ''
            }}
          />
        </div>
        <div className="max-h-[28%] shrink-0 overflow-y-auto scrollbar-hide">
          {files.length === 0 ? (
            <div className="rounded border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
              위험도 평가 PDF를 올리세요.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[5px] border border-border">
              <ul className="divide-y divide-border text-[11px]">
                {files.map((file) => {
                  const active = selectedFile?.id === file.id
                  const label = smallPublicAttachmentDisplayName(file.name, facility.name)
                  return (
                    <li key={file.id} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setSelectedFileId(file.id)}
                        className={cn(
                          'min-w-0 flex-1 truncate px-2 py-1.5 text-left transition-colors',
                          active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                        )}
                        title={file.name}
                      >
                        {label}
                      </button>
                      <button
                        type="button"
                        className="mr-1 rounded p-0.5 text-destructive hover:bg-destructive/10"
                        title="제거"
                        aria-label="제거"
                        onClick={() => removeFile(file)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
          <SmallPublicInlineFilePreview
            file={selectedFile}
            emptyText="첨부를 올리거나 목록에서 선택하면 아래에 미리보기가 나타납니다."
            onOpenFull={
              selectedFile ? (page) => preview.open(selectedFile, files, { page }) : undefined
            }
          />
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center gap-2.5 border-t border-border px-3 py-1.5">
        {error ? <span className="mr-auto text-[11px] text-destructive">{error}</span> : <span className="mr-auto" />}
        <button type="button" className={smallPublicBtnPrimary} disabled={saving} onClick={() => void save()}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
          취소
        </button>
      </div>
      {preview.element}
    </div>
  )
}
