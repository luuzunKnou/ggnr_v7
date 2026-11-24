'use client'

import type { CSSProperties } from 'react'
import { MessageSquareWarning } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAP_UI_Z_CLASS } from '@/lib/mapUiZIndex'

/** 민원관리 모달 목업 1건 */
const MOCK_COMPLAINT = {
  id: 'cmp-mock-1',
  title: '장량동 일대 악취 민원',
  place: '포항시 북구 장량동',
  sensorHint: '제동꽃집 인근',
  receivedAt: '2026-11-23 13:40',
  status: '접수',
  summary: '하수구 인근에서 심한 냄새가 난다는 신고. 현장 확인 요청.',
} as const

type Props = {
  open: boolean
  onClose: () => void
  className?: string
  style?: CSSProperties
  contentClassName?: string
}

/**
 * 대시보드2 — 민원관리 플로팅 모달 (목업).
 * 악취 경보 발생 모달 아래쪽에 배치.
 */
export function OdorComplaintManageModal({
  open,
  onClose,
  className,
  style,
  contentClassName,
}: Props) {
  if (!open) return null

  return (
    <div
      className={cn(
        'pointer-events-auto w-[min(100%,22rem)]',
        className ?? cn('fixed bottom-4 right-4', MAP_UI_Z_CLASS.nestedDialog)
      )}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label="민원관리 (목업)"
    >
      <div
        className={cn(
          'overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
          contentClassName
        )}
      >
        <div className="standard-map-float-header cursor-default py-2!">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <MessageSquareWarning className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="standard-map-float-header-title text-sm font-semibold">
              민원관리
            </span>
            <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              목업
            </span>
          </div>
        </div>

        <div className="space-y-1.5 px-3 py-2.5 text-[11px]">
          <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-200">
            이 화면은 목업입니다. 실제 민원 연동 전 미리보기용입니다.
          </p>
          <div className="text-sm font-semibold text-foreground" title={MOCK_COMPLAINT.title}>
            {MOCK_COMPLAINT.title}
          </div>
          <div className="text-muted-foreground">{MOCK_COMPLAINT.place}</div>
          <div className="text-muted-foreground">관련 지점 · {MOCK_COMPLAINT.sensorHint}</div>
          <div className="tabular-nums text-muted-foreground">
            접수 {MOCK_COMPLAINT.receivedAt}
          </div>
          <div className="font-medium text-amber-700 dark:text-amber-300">
            {MOCK_COMPLAINT.status}
          </div>
          <p className="text-foreground/90">{MOCK_COMPLAINT.summary}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-muted/20 px-2 py-2">
          <button
            type="button"
            title="나중에 보기"
            onClick={onClose}
            className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            나중에 보기
          </button>
          <button
            type="button"
            title="민원 목록 (목업)"
            onClick={onClose}
            className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted/50"
          >
            민원 목록
          </button>
          <button
            type="button"
            title="확인 (목업)"
            onClick={onClose}
            className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
