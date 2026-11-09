'use client'

import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { smallPublicBtnGhost, smallPublicBtnPrimary, smallPublicFieldClass } from '../smallPublicConfig'
import {
  smallPublicCheckFormFor,
  type SmallPublicCheckForm,
  type SmallPublicCheckValues,
} from '../smallPublicCheckForms'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions, smallPublicFileFromUpload, useSmallPublicStore } from '../smallPublicStore'
import { SmallPublicFileRow, useSmallPublicFilePreview } from '../smallPublicUi'
import { SmallPublicCheckSheet, smallPublicCheckTotal } from '../SmallPublicCheckSheet'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'

type Draft = {
  date: string
  inspector: string
  values: SmallPublicCheckValues
  remark: string
  sheet: SmallPublicFile | null
}

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 점검 등록·수정 모달(입력 점검) — 시설 유형의 위험도 평가표 양식대로 항목 점수를 넣으면 합계·등급이 정해진다.
 * 저장할 때 쓴 양식을 기록에 복사해 두므로, 나중에 양식이 바뀌어도 이 기록은 이 양식대로 보인다.
 * 수정할 때는 그 기록의 양식(복사본)을 그대로 쓴다.
 */
export function SmallPublicInspectionFormModal({
  facility,
  initial,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  initial: SmallPublicInspection | null
  onCancel: () => void
  onSaved: (inspection: SmallPublicInspection) => void
}) {
  const { inspections } = useSmallPublicStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preview = useSmallPublicFilePreview()
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => ({
    date: initial?.date ?? todayYmd(),
    inspector: initial?.inspector ?? '',
    values: initial?.values ?? {},
    remark: initial?.remark ?? '',
    sheet: initial?.sheet ?? null,
  }))
  const [form] = useState<SmallPublicCheckForm>(
    () => initial?.form ?? smallPublicCheckFormFor(facility.type, initial?.date ?? todayYmd())
  )
  const { total, complete, invalid, grade } = smallPublicCheckTotal(form, draft.values)

  const save = () => {
    if (!draft.date) return setError('점검일을 넣으세요.')
    if (!complete) return setError('평가표의 모든 항목에 점수를 넣으세요.')
    if (invalid.length > 0) return setError('사선 칸(쓰지 않는 상태등급)에 해당하는 점수가 있습니다. 점수를 고치세요.')
    const dup = inspections.some(
      (i) => i.facilityId === facility.id && i.date === draft.date && i.id !== initial?.id
    )
    if (dup) return setError('같은 날 점검이 이미 있습니다.')
    const next: SmallPublicInspection = {
      id: initial?.id ?? `insp-${Date.now()}`,
      facilityId: facility.id,
      date: draft.date,
      inspector: draft.inspector.trim(),
      source: initial?.source ?? '입력',
      score: total,
      grade,
      remark: draft.remark.trim(),
      sheet: draft.sheet,
      form,
      values: draft.values,
    }
    smallPublicActions.saveInspection(next)
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
      size="lg"
      title={`${initial ? '점검 수정' : '점검 등록'} · ${facility.name}`}
      subtitle={`소규모 공공시설 위험도 평가표(${facility.type}) — 항목마다 점수를 넣거나 A·B·C 칸을 누르면 합계와 등급이 정해집니다.`}
      onClose={onCancel}
      footer={
        <>
          <span className="mr-auto text-[11px] text-muted-foreground">
            계 <span className="font-semibold tabular-nums text-foreground">{total}</span>점
            {complete ? ` · ${grade}` : ''}
          </span>
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            저장
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="space-y-2.5">
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-2">
          <label className="block">
            {label('점검일', !initial)}
            <input
              type="date"
              className={cn(smallPublicFieldClass, initial && 'cursor-not-allowed bg-muted text-muted-foreground')}
              value={draft.date}
              readOnly={!!initial}
              title={initial ? '점검일은 수정할 수 없습니다.' : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            />
          </label>
          <label className="block">
            {label('점검자')}
            <input
              className={smallPublicFieldClass}
              value={draft.inspector}
              onChange={(e) => setDraft((d) => ({ ...d, inspector: e.target.value }))}
            />
          </label>
          <div>
            {label('위치')}
            <p className="flex h-7 items-center truncate text-[11px] text-foreground/80" title={facility.address}>
              {[facility.emd, facility.ri].filter(Boolean).join(' ')}
              {facility.length ? ` · 연장 ${facility.length}m` : ''}
            </p>
          </div>
        </div>

        <SmallPublicCheckSheet
          form={form}
          values={draft.values}
          onChange={(values) => setDraft((d) => ({ ...d, values }))}
        />

        <label className="block">
          {label('기타의견')}
          <textarea
            className={cn(smallPublicFieldClass, 'h-16 resize-none py-1')}
            value={draft.remark}
            onChange={(e) => setDraft((d) => ({ ...d, remark: e.target.value }))}
          />
        </label>
        <div>
          {label('원본 점검표 첨부(선택)')}
          {draft.sheet ? (
            <SmallPublicFileRow
              file={draft.sheet}
              onPreview={() => draft.sheet && preview.open(draft.sheet)}
              onDownload={() => draft.sheet && preview.download(draft.sheet)}
              onRemove={() => setDraft((d) => ({ ...d, sheet: null }))}
            />
          ) : (
            <button
              type="button"
              className={cn(smallPublicBtnGhost, 'w-full justify-center')}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-3 w-3" />
              스캔본 등 파일 선택
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setDraft((d) => ({ ...d, sheet: smallPublicFileFromUpload(file) }))
              e.target.value = ''
            }}
          />
        </div>
        {error ? (
          <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {preview.element}
    </SmallPublicModalShell>
  )
}
