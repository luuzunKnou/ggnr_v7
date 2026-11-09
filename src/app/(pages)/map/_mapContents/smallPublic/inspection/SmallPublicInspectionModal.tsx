'use client'

import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { SmallPublicCheckSheet } from '../SmallPublicCheckSheet'
import { smallPublicBtnGhost } from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import {
  SmallPublicAttrTable,
  SmallPublicFileRow,
  SmallPublicGradeBadge,
  smallPublicDateLabel,
  useSmallPublicFilePreview,
} from '../smallPublicUi'

export type SmallPublicModalOverlay = { overlayLeftPx: number; overlayWidthPx: number }

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
}: SmallPublicModalOverlay & {
  title: string
  onClose: () => void
  footer: ReactNode
  children: ReactNode
  /** 본문 여백·스크롤을 바꿀 때(목록을 담는 모달 등) */
  bodyClassName?: string
  /** 제목 아래 한 줄 설명 */
  subtitle?: string
  /** sm = 시설 고르기처럼 작은 모달, lg = 평가표 입력처럼 넓은 모달 */
  size?: 'sm' | 'md' | 'lg'
}) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (overlayWidthPx <= 0 || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-8"
      style={{ left: overlayLeftPx, top: 0, width: overlayWidthPx, height: '100dvh' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className={cn(
          'relative flex max-h-[calc(100dvh-4rem)] w-full flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
          size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-3xl' : 'max-w-lg'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-3 py-2">
          <h3 id={titleId} className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
          {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className={bodyClassName ?? 'min-h-0 flex-1 overflow-y-auto px-3 py-2.5 scrollbar-hide'}>{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5">{footer}</div>
      </div>
    </div>,
    document.body
  )
}

/** 후보지 위험도평가 이력 → 점검 정보와 점검표(입력 점검에 첨부된 경우만) */
export function SmallPublicInspectionViewModal({
  inspection,
  facility,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  inspection: SmallPublicInspection
  facility: SmallPublicFacility
  onClose: () => void
}) {
  const preview = useSmallPublicFilePreview()
  /** 연계 점검은 점검표를 못 받을 수 있어 일단 보이지 않음 */
  const sheet = inspection.source === '입력' ? inspection.sheet : null
  const group = sheet ? [sheet, ...facility.planFiles] : []
  return (
    <>
      <SmallPublicModalShell
        {...overlay}
        size={inspection.form && inspection.values ? 'lg' : 'md'}
        title={`위험도 평가 ${inspection.date}`}
        onClose={onClose}
        footer={
          <button type="button" className={smallPublicBtnGhost} onClick={onClose}>
            닫기
          </button>
        }
      >
        <SmallPublicAttrTable
          entries={[
            { key: 'date', label: '점검일', value: smallPublicDateLabel(inspection.date) },
            { key: 'inspector', label: '점검자', value: inspection.inspector || '—' },
            { key: 'score', label: '합계점수', value: `${inspection.score}점` },
            { key: 'grade', label: '등급', value: <SmallPublicGradeBadge grade={inspection.grade} /> },
            { key: 'source', label: '구분', value: inspection.source },
            { key: 'remark', label: '기타의견', value: inspection.remark || '—', full: true },
          ]}
        />
        {inspection.form && inspection.values ? (
          <>
            <p className="mb-1 mt-3 text-[11px] font-semibold text-foreground/90">위험도 평가표</p>
            <SmallPublicCheckSheet form={inspection.form} values={inspection.values} />
          </>
        ) : null}
        {sheet ? (
          <>
            <p className="mb-1 mt-3 text-[11px] font-semibold text-foreground/90">원본 점검표</p>
            <SmallPublicFileRow
              file={sheet}
              onPreview={() => preview.open(sheet, group)}
              onDownload={() => preview.download(sheet)}
            />
          </>
        ) : null}
      </SmallPublicModalShell>
      {preview.element}
    </>
  )
}
