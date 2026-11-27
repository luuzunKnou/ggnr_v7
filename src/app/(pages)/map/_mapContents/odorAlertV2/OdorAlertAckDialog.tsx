'use client'

import { useEffect, useState } from 'react'
import { odorAlertBtnGhost, odorAlertBtnPrimary, odorAlertFieldClass } from './odorAlertConfig'

type Props = {
  open: boolean
  title: string
  description: string
  onClose: () => void
  onConfirm: (reason: string) => void
}

export function OdorAlertAckDialog({ open, title, description, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="odor-ack-title"
        className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <h3 id="odor-ack-title" className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
        <label className="mt-3 block text-[11px] font-medium text-foreground">
          확인(해제) 사유
          <textarea
            className={`${odorAlertFieldClass} mt-1 h-20 resize-none py-1.5`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유를 입력하세요"
            title="확인(해제) 사유"
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={odorAlertBtnGhost} title="취소" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className={odorAlertBtnPrimary}
            title="확인(해제)"
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            확인(해제)
          </button>
        </div>
      </div>
    </div>
  )
}
