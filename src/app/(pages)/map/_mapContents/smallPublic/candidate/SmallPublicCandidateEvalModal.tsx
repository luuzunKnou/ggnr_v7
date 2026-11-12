'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { smallPublicBtnDanger, smallPublicBtnGhost } from '../smallPublicConfig'
import type { SmallPublicCandidateEval, SmallPublicFacility } from '../smallPublicMock'
import { SmallPublicAttrTable, SmallPublicCandidateResultBadge, smallPublicDateLabel } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

/** 후보지 평가 보기 — 평가일·평가자·선정여부·첨부 요약 */
export function SmallPublicCandidateEvalModal({
  facility,
  evaluation: e,
  onEdit,
  onDelete,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  evaluation: SmallPublicCandidateEval
  onEdit?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={`후보지 평가 ${e.date}`}
      subtitle={facility.name}
      onClose={onClose}
      footer={
        <>
          {onEdit ? (
            <button type="button" className={smallPublicBtnGhost} onClick={onEdit}>
              <Pencil className="h-3 w-3" />
              수정
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" className={smallPublicBtnDanger} onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
              삭제
            </button>
          ) : null}
          <button type="button" className={smallPublicBtnGhost} onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      <div className="p-3">
        <SmallPublicAttrTable
          entries={[
            { key: 'date', label: '평가일', value: smallPublicDateLabel(e.date) },
            { key: 'evaluator', label: '평가자', value: e.evaluator || '—' },
            { key: 'result', label: '선정여부', value: <SmallPublicCandidateResultBadge result={e.result} /> },
            { key: 'file', label: '첨부파일', value: e.file?.name ?? '—', full: true },
            { key: 'remark', label: '비고', value: e.remark || '—', full: true },
          ]}
        />
      </div>
    </SmallPublicModalShell>
  )
}
