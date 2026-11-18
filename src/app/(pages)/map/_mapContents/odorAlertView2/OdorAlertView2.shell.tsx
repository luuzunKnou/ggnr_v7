'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { OdorIndexAlertContent } from '@/app/(pages)/(index)/odorPh/OdorIndexAlertContent'
import { ODOR_ALERT_VIEW2_SER_ENG } from './odorAlertView2Config'

const MIN_WIDTH = 720

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function subscribeResize(cb: () => void) {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1600)
}

const noopSubscribe = () => () => undefined

function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

/**
 * 경보보기2 — 지도 영역 풀패널. Index «경보 목록» 목업 UI.
 */
export function OdorAlertView2Shell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const width = Math.max(MIN_WIDTH, viewport - leftOffsetPx)

  useEffect(() => {
    onTotalWidthChange(width)
  }, [width, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  if (!isClient) return null

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-y-0 right-0 z-[55] flex min-h-0 flex-col border-l border-border bg-background shadow-lg"
      style={{ left: leftOffsetPx }}
      data-ser-eng={ODOR_ALERT_VIEW2_SER_ENG}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[12px] font-semibold">경보보기2</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <OdorIndexAlertContent />
      </div>
    </div>,
    document.body
  )
}
