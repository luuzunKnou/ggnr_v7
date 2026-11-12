'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { smallPublicBtnGhost, smallPublicBtnPrimary, smallPublicFieldClass } from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicSafetyDoc } from '../smallPublicMock'
import { smallPublicActions, smallPublicFileFromUpload } from '../smallPublicStore'
import { SmallPublicAttrTable, smallPublicAttachmentDisplayName } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 안전점검 등록 — 일자·작성 + 치수·안전·일반·현장 PDF(전부 또는 일부) */
export function SmallPublicSafetyDocFormModal({
  facility,
  initial = null,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  initial?: SmallPublicSafetyDoc | null
  onCancel: () => void
  onSaved: (doc: SmallPublicSafetyDoc) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [date, setDate] = useState(initial?.date ?? todayYmd())
  const [person, setPerson] = useState(initial?.person ?? '')
  const [remark, setRemark] = useState(initial?.remark ?? '')
  const [files, setFiles] = useState<SmallPublicFile[]>(initial?.files ?? [])
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    if (!date) return setError('일자를 넣으세요.')
    if (files.length === 0) return setError('PDF를 한 개 이상 올리세요.')
    const next: SmallPublicSafetyDoc = {
      id: initial?.id ?? `sd-${Date.now()}`,
      facilityId: facility.id,
      date,
      person: person.trim(),
      remark: remark.trim(),
      files,
      includes: initial?.includes ?? { risk: true, field: false, class: false },
    }
    smallPublicActions.saveSafetyDoc(next)
    onSaved(next)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={`${initial ? '안전점검 수정' : '안전점검 등록'} · ${facility.name}`}
      subtitle="치수·안전·일반·현장 PDF를 필요한 만큼 올립니다. 네 종류 전부이거나 일부만 있어도 됩니다."
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
              label: '일자',
              value: (
                <input type="date" className={smallPublicFieldClass} value={date} onChange={(e) => setDate(e.target.value)} />
              ),
            },
            {
              key: 'person',
              label: '작성',
              value: (
                <input
                  type="text"
                  className={smallPublicFieldClass}
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                  placeholder="작성자"
                />
              ),
            },
            {
              key: 'files',
              label: '첨부 PDF',
              full: true,
              value: (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <button type="button" className={smallPublicBtnGhost} onClick={() => fileRef.current?.click()}>
                    <Paperclip className="h-3 w-3" />
                    파일 추가
                  </button>
                  {files.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      치수·안전·일반·현장 중 있는 자료만 올리면 됩니다.
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {files.map((f) => (
                        <li key={f.id} className="flex items-center gap-1.5 text-[11px]">
                          <span className="min-w-0 flex-1 truncate text-foreground/80" title={f.name}>
                            {smallPublicAttachmentDisplayName(f.name, facility.name)}
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
                  )}
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
