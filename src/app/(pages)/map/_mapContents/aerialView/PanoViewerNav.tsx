'use client'

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  fileName: string
  index: number
  total: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onClose?: () => void
  className?: string
}

/**
 * 파노라마 하단 바 — 이전/다음·줌·닫기.
 * 주소검색·우측 메뉴와 겹치지 않도록 화면 하단 중앙에만 둔다.
 */
export function PanoViewerNav({
  fileName,
  index,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onClose,
  className,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
      } else if (e.key === 'Escape' && onClose) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrev, onNext, onClose])

  if (total <= 0 || index < 0) return null

  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10', className)}>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-3 pr-24">
        <div
          className={cn(
            'pointer-events-auto flex max-w-[min(100%,28rem)] items-center gap-0.5 rounded-md border border-slate-200',
            'bg-white px-1 py-1 shadow-sm'
          )}
        >
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className={cn(
              'inline-flex h-7 items-center gap-0.5 rounded px-2 text-[11px] text-slate-600',
              'hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35'
            )}
            title="이전 파일 (←)"
            aria-label="이전 파일"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            이전
          </button>

          <div className="min-w-0 flex-1 px-1.5 text-center">
            <p className="truncate text-[11px] font-medium leading-tight text-slate-800">{fileName}</p>
          </div>

          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className={cn(
              'inline-flex h-7 items-center gap-0.5 rounded px-2 text-[11px] text-slate-600',
              'hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35'
            )}
            title="다음 파일 (→)"
            aria-label="다음 파일"
          >
            다음
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          {onZoomOut || onZoomIn ? (
            <div className="mx-0.5 flex h-7 items-center gap-0.5 border-l border-slate-200 pl-1">
              {onZoomOut ? (
                <button
                  type="button"
                  onClick={onZoomOut}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-50"
                  title="축소"
                  aria-label="축소"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {onZoomIn ? (
                <button
                  type="button"
                  onClick={onZoomIn}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-50"
                  title="확대"
                  aria-label="확대"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded border-l border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              title="닫기 (Esc)"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
