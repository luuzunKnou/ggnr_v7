'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from '../../../../searchBarOffsetContext'
import type { SectionDrawMode } from './useWtlNetworkSection'

const MODES: { id: SectionDrawMode; label: string }[] = [
  { id: 'free', label: '직선' },
  { id: 'roadWidth', label: '실폭도로' },
  { id: 'roadSeg', label: '도로구간' },
]

const PICK_TEXT: Record<SectionDrawMode, string> = {
  free: '두 점을 찍어 절단선을 그리세요.',
  roadWidth: '실폭도로를 가로질러 한 번 찍으세요.',
  roadSeg: '도로구간에 맞춰 두 점을 찍으세요.',
}

/** AddressInfoDetail max-w — 측정 전 폴백 */
const ADDRESS_INFO_PANEL_MAX_PX = 520

/** 호스트 기준 우측 여백 — 우클릭 패널(fixed)·우측 메뉴를 보이는 지도에서 뺌 */
function useGuideRightPadPx(
  host: HTMLElement | null,
  addressOpen: boolean,
  mapPaddingRight: number
): number {
  const [rightPad, setRightPad] = useState(mapPaddingRight)

  useEffect(() => {
    if (!host) {
      setRightPad(mapPaddingRight)
      return
    }
    let raf = 0
    let ro: ResizeObserver | null = null
    const sync = () => {
      const hostRect = host.getBoundingClientRect()
      let addressOverlap = 0
      if (addressOpen) {
        const panel = document.querySelector('[data-address-info-panel]')
        const panelW =
          panel instanceof HTMLElement
            ? Math.ceil(panel.getBoundingClientRect().width)
            : ADDRESS_INFO_PANEL_MAX_PX
        const panelLeft = window.innerWidth - panelW
        addressOverlap = Math.max(0, Math.ceil(hostRect.right - panelLeft))
        if (panel instanceof HTMLElement) ro?.observe(panel)
      }
      const next = Math.max(mapPaddingRight, addressOverlap)
      setRightPad((prev) => (prev === next ? prev : next))
    }
    const kick = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sync)
    }
    ro = new ResizeObserver(kick)
    ro.observe(host)
    kick()
    // 우클릭 패널 portal 마운트 직후 재측정
    const retry = addressOpen ? window.setTimeout(kick, 50) : 0
    window.addEventListener('resize', kick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (retry) window.clearTimeout(retry)
      ro?.disconnect()
      window.removeEventListener('resize', kick)
    }
  }, [host, addressOpen, mapPaddingRight])

  return rightPad
}

const PILL_SHELL =
  'pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background/95 py-1 pr-1 pl-3 text-[12px] leading-snug text-foreground shadow-md backdrop-blur'
const NOTICE_SHELL =
  'pointer-events-none whitespace-nowrap rounded-full border border-border/80 bg-background/95 px-2.5 py-0.5 text-[11px] font-medium leading-snug text-muted-foreground shadow-sm backdrop-blur-md'
const BTN_MUTED =
  'cursor-pointer rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
const BTN_PRIMARY =
  'rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground enabled:cursor-pointer'
const PILL_DIVIDER = 'h-3.5 w-px shrink-0 bg-border'
const ERROR_NOTICE =
  'pointer-events-none max-w-[300px] rounded-lg border border-destructive/30 bg-background/95 px-2.5 py-1 text-[11px] font-medium leading-snug text-destructive shadow-sm backdrop-blur-md'

type Props = {
  open: boolean
  drawMode: SectionDrawMode | null
  drawing: boolean
  /** 절단선 초안 확정 대기(적용 전) */
  pendingReady: boolean
  canUndoLast: boolean
  message: string
  onChoose: (mode: SectionDrawMode) => void
  onUndoLast: () => void
  onApply: () => void
  onRespecify: () => void
  onCancel: () => void
}

/**
 * 단면도 절단선 방식 — 지도 상단 고정 알약(사유지분석 톤).
 * 초안 확정 후 «선 되돌리기·적용·다시 지정·취소».
 * 좌·우 패널(사이드·우클릭 필지정보)을 빼고 보이는 지도 가운데에 둔다.
 */
export function WtlNetworkSectionDrawGuide({
  open,
  drawMode,
  drawing,
  pendingReady,
  canUndoLast,
  message,
  onChoose,
  onUndoLast,
  onApply,
  onRespecify,
  onCancel,
}: Props) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0
  const mapPaddingRight = mapContext?.mapPaddingRight ?? 0
  const addressOpen = mapContext?.addressInfoDetail != null
  const { inputBottomPx } = useSearchBarOffset()
  const topPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP
  const bannerHost = map?.getTargetElement()?.parentElement ?? null
  const rightPad = useGuideRightPadPx(bannerHost, addressOpen, mapPaddingRight)

  if (!open || !map || !bannerHost) return null

  const pickText = drawMode
    ? PICK_TEXT[drawMode]
    : '절단선 방식을 선택하세요.'
  const showPickCancel = (drawing || Boolean(drawMode)) && !pendingReady

  return createPortal(
    <div
      className="pointer-events-none absolute z-[15] flex flex-col items-center gap-1.5"
      style={{
        top: topPx,
        left: mapPaddingLeft,
        right: rightPad,
      }}
    >
      {!pendingReady ? (
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 p-0.5 shadow-md backdrop-blur">
          {MODES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChoose(t.id)}
              aria-pressed={drawMode === t.id}
              className={cn(
                'cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] transition-colors',
                drawMode === t.id
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {pendingReady ? (
        <>
          <div className={PILL_SHELL}>
            <button
              type="button"
              onClick={onUndoLast}
              disabled={!canUndoLast}
              className={BTN_MUTED}
            >
              선 되돌리기
            </button>
            <span className={PILL_DIVIDER} aria-hidden />
            <button type="button" onClick={onApply} className={BTN_PRIMARY}>
              적용
            </button>
            <button type="button" onClick={onRespecify} className={BTN_MUTED}>
              다시 지정
            </button>
            <button type="button" onClick={onCancel} className={BTN_MUTED}>
              취소
            </button>
          </div>
          <div className={NOTICE_SHELL}>절단선 지정됨 · 적용을 누르세요</div>
        </>
      ) : (
        <div className={cn(PILL_SHELL, !showPickCancel && 'pr-3')}>
          <span>{pickText}</span>
          {drawing && canUndoLast ? (
            <button type="button" onClick={onUndoLast} className={BTN_MUTED}>
              선 되돌리기
            </button>
          ) : null}
          {showPickCancel ? (
            <button type="button" onClick={onCancel} className={BTN_MUTED}>
              취소
            </button>
          ) : null}
        </div>
      )}
      {message ? <div className={ERROR_NOTICE}>{message}</div> : null}
    </div>,
    bannerHost
  )
}
