'use client'

import { useCallback, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { DetailAttrRow, DetailAttrTable } from '../../_mapComponents/layerRowEdit'
import { statusBadgeClass, statusLabel, type GcpInspectItem, type GcpInspection } from './gcpDummyData'

type Props = {
  open: boolean
  onClose: () => void
  inspection: GcpInspection | null
  item: GcpInspectItem | null
  overlayLeftPx: number
  overlayWidthPx: number
}

export function GcpInspectHistoryDialog({
  open,
  onClose,
  inspection,
  item,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const titleId = useId()
  const close = useCallback(() => onClose(), [onClose])
  const label = item ? statusLabel(item.status) : '—'

  useEffect(() => {
    if (!open || overlayWidthPx <= 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, overlayWidthPx, close])

  if (!open || overlayWidthPx <= 0 || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={close}
    >
      <div
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            점검 내용
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
          {!inspection || !item ? (
            <p className="py-4 text-center text-xs text-muted-foreground">이력을 찾을 수 없습니다.</p>
          ) : (
            <DetailAttrTable>
              <DetailAttrRow label="점검일자" valueClassName="tabular-nums">
                {inspection.inspectDate}
              </DetailAttrRow>
              <DetailAttrRow label="상태">
                <span
                  className={cn(
                    'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                    statusBadgeClass(label)
                  )}
                >
                  {label}
                </span>
              </DetailAttrRow>
              <DetailAttrRow label="담당자">{inspection.inspector || '—'}</DetailAttrRow>
              <DetailAttrRow label="점검 내용" isLast valueClassName="whitespace-pre-wrap break-all">
                {item.note.trim() ? item.note : '—'}
              </DetailAttrRow>
            </DetailAttrTable>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={close}
          >
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
