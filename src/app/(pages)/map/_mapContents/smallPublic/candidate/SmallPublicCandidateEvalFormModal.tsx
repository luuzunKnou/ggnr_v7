'use client'

import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import {
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  smallPublicFieldClass,
} from '../smallPublicConfig'
import type { SmallPublicCandidateResult } from '../smallPublicCandidateForms'
import type { SmallPublicCandidateEval, SmallPublicFacility } from '../smallPublicMock'
import { smallPublicActions, smallPublicFileFromUpload } from '../smallPublicStore'
import { SmallPublicAttrTable } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 후보지 평가 등록·수정 — 첨부 파일 + 평가일·평가자·선정여부 */
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
  const [date, setDate] = useState(initial?.date ?? todayYmd())
  const [evaluator, setEvaluator] = useState(initial?.evaluator ?? '')
  const [result, setResult] = useState<SmallPublicCandidateResult>(initial?.result ?? '선정')
  const [remark, setRemark] = useState(initial?.remark ?? '')
  const [file, setFile] = useState(initial?.file ?? null)
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    if (!date) return setError('평가일을 넣으세요.')
    if (!file) return setError('평가 첨부파일을 올리세요.')
    const next: SmallPublicCandidateEval = {
      id: initial?.id ?? `ce-${Date.now()}`,
      facilityId: facility.id,
      date,
      evaluator: evaluator.trim(),
      result,
      remark: remark.trim(),
      file,
    }
    smallPublicActions.saveCandidateEval(next)
    onSaved(next)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={`${initial ? '후보지 평가 수정' : '후보지 평가 등록'} · ${facility.name}`}
      subtitle="평가표 파일을 올리고 평가일·평가자·선정여부를 함께 넣습니다."
      onClose={onCancel}
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
                        {file.name}
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
                      if (f) setFile(smallPublicFileFromUpload(f, 'candidate'))
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
