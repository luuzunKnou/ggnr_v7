'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SmallPublicCheckSheet } from '../SmallPublicCheckSheet'
import type { SmallPublicInspection } from '../smallPublicMock'
import {
  SmallPublicAttrTable,
  SmallPublicClassBadge,
  SmallPublicCrudBar,
  SmallPublicGradeBadge,
  smallPublicDateLabel,
} from '../smallPublicUi'

export type SmallPublicModalOverlay = { overlayLeftPx: number; overlayWidthPx: number }

/** 겹쳐 연 모달 — Esc 는 맨 위 모달만 닫는다 */
const modalStack: symbol[] = []

/** 목록·상세 패널 위를 덮는 모달 — 도로망도 유지보수·민원 모달과 같은 방식(위험도 평가·점검 등록·시설 등록 공용) */
export function SmallPublicModalShell({
  title,
  overlayLeftPx,
  overlayWidthPx,
  onClose,
  footer,
  children,
  bodyClassName,
  subtitle,
  size = 'md',
  showHeaderClose = false,
}: SmallPublicModalOverlay & {
  title: string
  onClose: () => void
  /** 없으면 하단 버튼 줄을 숨긴다(제목 X만 쓰는 보기 모달 등) */
  footer?: ReactNode
  children: ReactNode
  /** 본문 여백·스크롤을 바꿀 때(목록을 담는 모달 등) */
  bodyClassName?: string
  /** 제목 아래 한 줄 설명 */
  subtitle?: string
  /** sm·md·lg·xl = 고정 최대폭, half = 오버레이 폭의 절반·높은 모달, full = 화면 가득 */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'half' | 'full'
  /** 제목줄 오른쪽 X 닫기 */
  showHeaderClose?: boolean
}) {
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    const token = Symbol('modal')
    modalStack.push(token)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      modalStack.splice(modalStack.indexOf(token), 1)
    }
  }, [])

  if (overlayWidthPx <= 0 || typeof document === 'undefined') return null
  return createPortal(
    <div
      className={cn(
        'pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-hidden bg-black/50',
        size === 'full' || size === 'half' ? 'p-4' : 'p-6'
      )}
      style={{ left: overlayLeftPx, top: 0, width: overlayWidthPx, height: '100dvh' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className={cn(
          'relative flex max-h-[calc(100dvh-3rem)] w-full min-h-0 flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
          size === 'full' ? 'h-[calc(100dvh-2rem)] max-w-[1760px]' : '',
          size === 'half' ? 'h-[calc(100dvh-2rem)]' : '',
          size === 'sm'
            ? 'max-w-sm'
            : size === 'lg'
              ? 'max-w-3xl'
              : size === 'xl'
                ? 'max-w-5xl'
                : size === 'full' || size === 'half'
                  ? ''
                  : 'max-w-lg'
        )}
        style={size === 'half' ? { maxWidth: Math.max(360, Math.floor(overlayWidthPx * 0.5)) } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-[2] flex shrink-0 items-start gap-2 border-b border-border bg-background px-3 py-2">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-[12px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
              {title}
            </h3>
            {subtitle ? (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>
            ) : null}
          </div>
          {showHeaderClose ? (
            <button
              type="button"
              onClick={onClose}
              className="-mr-0.5 -mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className={bodyClassName ?? 'min-h-0 flex-1 overflow-y-auto px-3 py-2.5 scrollbar-thin'}>{children}</div>
        {footer != null ? (
          <div className="flex w-full shrink-0 items-center gap-1 border-t border-border bg-background px-3 py-1.5">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

/** 후보지 위험도평가 이력 → 점검 정보와 위험도 평가표 */
export function SmallPublicInspectionViewModal({
  inspection,
  onEdit,
  onDelete,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  inspection: SmallPublicInspection
  onEdit?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={`위험도 평가 ${inspection.date}`}
      showHeaderClose
      onClose={onClose}
      footer={
        <SmallPublicCrudBar
          bordered={false}
          className="px-0 py-0"
          onEdit={onEdit}
          onDelete={onDelete}
        />
      }
    >
      <SmallPublicAttrTable
        entries={[
          { key: 'date', label: '점검일', value: smallPublicDateLabel(inspection.date) },
          { key: 'inspector', label: '점검자', value: inspection.inspector || '—' },
          { key: 'score', label: '합계점수', value: `${inspection.score}점` },
          { key: 'grade', label: '등급', value: <SmallPublicGradeBadge grade={inspection.grade} /> },
          {
            key: 'class',
            label: '평가구분',
            value: <SmallPublicClassBadge candidate={inspection.classResult} />,
          },
          { key: 'remark', label: '기타의견', value: inspection.remark || '—', full: true },
        ]}
      />
      <div className="mt-3">
        <SmallPublicCheckSheet form={inspection.form} values={inspection.values} />
      </div>
    </SmallPublicModalShell>
  )
}
