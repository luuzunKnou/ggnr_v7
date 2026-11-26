'use client'

import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import {
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  smallPublicFieldClass,
} from '../smallPublicConfig'
import type { SmallPublicCandidateResult } from '../smallPublicCandidateForms'
import type { SmallPublicCandidateEval, SmallPublicFacility, SmallPublicFile } from '../smallPublicMock'
import {
  deleteSmallPublicFile,
  smallPublicFileScope,
  smallPublicFileYear,
  uploadSmallPublicFiles,
} from '../smallPublicAttachmentApi'
import { smallPublicActions, smallPublicFileFromUpload } from '../smallPublicStore'
import { SmallPublicAttrTable, smallPublicAttachmentDisplayName } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 후보지 평가 등록·수정 — 첨부 파일 + 평가일·평가자·선정여부.
 * 시설당 평가일 연도마다 한 건(5년 주기 등)이며, 첨부는 {관리번호}/후보지_{평가연도}/ 에 저장해
 * 같은 해 안전점검_{연도}/ 와 섞이지 않는다. 기존 평가는 평가일(연도)을 바꿀 수 없다.
 */
export function SmallPublicCandidateEvalFormModal({
  facility,
  initial = null,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  initial?: SmallPublicCandidateEval | null
  onCancel: () => void
  onSaved: (ev: SmallPublicCandidateEval) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  /** 이 세션에서 새로 고른 파일(저장 시 서버 폴더로 올림) */
  const pendingRef = useRef<File | null>(null)
  /** 평가 이력이 DB에 있는 수정이면 평가일은 고정 */
  const dateLocked = Boolean(initial && /^\d+$/.test(initial.id) && initial.date)
  const [date, setDate] = useState(initial?.date || todayYmd())
  const [evaluator, setEvaluator] = useState(initial?.evaluator ?? '')
  const [result, setResult] = useState<SmallPublicCandidateResult>(initial?.result ?? '선정')
  const [remark, setRemark] = useState(initial?.remark ?? '')
  const [file, setFile] = useState<SmallPublicFile | null>(initial?.file ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('평가일을 넣으세요.')
    if (!file) return setError('평가 첨부파일을 올리세요.')
    const mngNo = String(facility.mngNo ?? '').trim()
    if (!mngNo || mngNo.startsWith('excl:')) return setError('관리번호가 없는 시설은 평가를 저장할 수 없습니다.')

    setSaving(true)
    setError(null)
    const year = date.slice(0, 4)
    let finalFile = file
    let uploaded: SmallPublicFile | null = null
    try {
      const pending = pendingRef.current
      if (pending) {
        uploaded = (await uploadSmallPublicFiles({ mngNo, scope: 'candidate', year, files: [pending], kind: 'candidate' }))[0] ?? null
        if (!uploaded) throw new Error('첨부 업로드에 실패했습니다.')
        finalFile = uploaded
      }
      const next: SmallPublicCandidateEval = {
        id: initial?.id ?? `ce-${Date.now()}`,
        facilityId: facility.id,
        date,
        evaluator: evaluator.trim(),
        result,
        remark: remark.trim(),
        file: finalFile,
      }
      const r = await smallPublicActions.saveCandidateEval(next)
      if (!r.success) {
        if (uploaded) await deleteSmallPublicFile(mngNo, uploaded).catch(() => undefined)
        setSaving(false)
        return setError(r.error)
      }
      /** 파일을 바꾼 경우 이전 후보지 첨부는 정리(예전 루트 파일은 그대로 둔다) */
      const old = initial?.file
      if (uploaded && old && old.name !== uploaded.name && smallPublicFileScope(old) === 'candidate' && smallPublicFileYear(old) === year) {
        await deleteSmallPublicFile(mngNo, old).catch(() => undefined)
      }
      if (pending && file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url)
      pendingRef.current = null
      onSaved(r.eval)
    } catch (e) {
      if (uploaded) await deleteSmallPublicFile(mngNo, uploaded).catch(() => undefined)
      setSaving(false)
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.')
    }
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={`${initial ? '후보지 평가 수정' : '후보지 평가 등록'} · ${facility.name}`}
      subtitle="평가표 파일을 올리고 평가일·평가자·선정여부를 함께 넣습니다. 평가는 연도마다 한 건입니다."
      onClose={onCancel}
      footer={
        <div className="flex w-full items-center gap-2.5">
          {error ? <span className="mr-auto text-[11px] text-destructive">{error}</span> : <span className="mr-auto" />}
          <button type="button" className={smallPublicBtnPrimary} onClick={() => void save()} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel} disabled={saving}>
            취소
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <SmallPublicAttrTable
          entries={[
            {
              key: 'date',
              label: '평가일',
              value: (
                <input
                  type="date"
                  className={smallPublicFieldClass}
                  value={date}
                  disabled={dateLocked}
                  title={dateLocked ? '등록된 평가의 평가일은 바꿀 수 없습니다.' : undefined}
                  onChange={(e) => setDate(e.target.value)}
                />
              ),
            },
            {
              key: 'evaluator',
              label: '평가자',
              value: (
                <input
                  type="text"
                  className={smallPublicFieldClass}
                  value={evaluator}
                  onChange={(e) => setEvaluator(e.target.value)}
                  placeholder="평가자"
                />
              ),
            },
            {
              key: 'result',
              label: '선정여부',
              value: (
                <div className="inline-flex gap-2.5" role="group" aria-label="선정여부">
                  {(['선정', '선정제외'] as const).map((r) => {
                    const on = result === r
                    return (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setResult(r)}
                        className={on ? smallPublicBtnPrimary : smallPublicBtnGhost}
                      >
                        {r}
                      </button>
                    )
                  })}
                </div>
              ),
            },
            {
              key: 'file',
              label: '첨부파일',
              full: true,
              value: (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <button type="button" className={smallPublicBtnGhost} onClick={() => fileRef.current?.click()}>
                      <Paperclip className="h-3 w-3" />
                      {file ? '파일 바꾸기' : '파일 선택'}
                    </button>
                    {file ? (
                      <span className="min-w-0 truncate text-[11px] text-foreground/80" title={file.name}>
                        {smallPublicAttachmentDisplayName(file.name, facility.name)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">평가표 PDF·이미지</span>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) {
                        if (file?.url?.startsWith('blob:')) URL.revokeObjectURL(file.url)
                        pendingRef.current = f
                        setFile(smallPublicFileFromUpload(f, 'candidate'))
                      }
                      e.target.value = ''
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'remark',
              label: '비고',
              full: true,
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
