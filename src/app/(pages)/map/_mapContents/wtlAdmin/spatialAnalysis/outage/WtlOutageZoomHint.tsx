'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn } from 'lucide-react'
import { unByKey } from 'ol/Observable'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { zoomFromScaleMeters } from '../../../../_mapComponents/hooks/mapScale'
import { mapTopHintPx } from '../../../../_mapComponents/mapTopHintLayout'
import { useSearchBarOffset } from '../../../../searchBarOffsetContext'
import {
  isOutageOverlayScaleVisible,
  OUTAGE_OVERLAY_MAX_SCALE_M,
} from './useWtlOutageMapLayer'

/** 경계에서 깜빡이지 않게 240m보다 살짝 확대 */
const OVERLAY_ZOOM_SCALE_MARGIN = 0.98

type Props = {
  active: boolean
  /**
   * 축척이 충분할 때 다음 행동 유도 문구를 쓸지
   * (단수: 잠금 없을 때 / 누수: 누수 위치 미선택일 때).
   */
  showLockHint?: boolean
  /** 축척이 멀 때 (기본: 단수구역 열림·잠금) */
  message?: string
  /** 축척 OK · 다음 행동 유도 (단수 잠금 / 누수 위치 클릭) */
  lockMessage?: string
  /**
   * 분석 실패·추가 잠금 유도 등. 축척 OK일 때 잠금 안내보다 우선.
   * (예: 이 제수변만 잠가서는 단수 구간이 생기지 않습니다…)
   */
  statusMessage?: string | null
}

/** 축척 240m보다 축소되면 확대 안내, 충분하면 분석 안내 → 잠금 안내 */
export function WtlOutageZoomHint({
  active,
  showLockHint = false,
  message = '열림·잠금이 보이는 축척까지 지도를 확대해 주세요',
  lockMessage = '지도에서 제수변을 잠그세요',
  statusMessage = null,
}: Props) {
  const mapContext = useMapContext()
  const { leftPx } = useSearchBarOffset()
  const [scaleOk, setScaleOk] = useState(false)
  const [centerX, setCenterX] = useState(0)
  const [mounted, setMounted] = useState(false)
  const hintTopPx = mapTopHintPx(Boolean(mapContext?.cadastralZoomHintVisible))

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!active || !map || !mapContext?.mapReady) {
      setScaleOk(false)
      return
    }
    const update = () => {
      setScaleOk(isOutageOverlayScaleVisible(map.getView().getZoom()))
    }
    update()
    const key = map.getView().on('change:resolution', update)
    return () => {
      unByKey(key)
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  const status = statusMessage?.trim() || ''
  const text = !active
    ? null
    : !scaleOk
      ? message
      : status
        ? status
        : showLockHint
          ? lockMessage
          : null
  const wrap = Boolean(status && scaleOk && text === status)
  /** «보이는 축척까지…» 안내일 때만 돋보기 — 잠금·상태 문구에는 없음 */
  const showZoomAction = Boolean(text && !scaleOk)

  const zoomToOverlayScale = () => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || scaleOk) return
    const view = map.getView()
    const targetZoom = zoomFromScaleMeters(
      OUTAGE_OVERLAY_MAX_SCALE_M * OVERLAY_ZOOM_SCALE_MARGIN
    )
    if (!Number.isFinite(targetZoom)) return
    const current = view.getZoom()
    if (current != null && current >= targetZoom) return
    view.animate({ zoom: targetZoom, duration: 400 })
  }

  useEffect(() => {
    if (!text) return
    const update = () => {
      const mapLeft = Math.max(0, leftPx - 20)
      const mapRight = Math.max(mapLeft + 1, window.innerWidth - 16)
      setCenterX((mapLeft + mapRight) / 2)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [text, leftPx])

  // SSR·하이드레이션 첫 패스는 null — document 분기는 서버/클라 불일치 유발
  if (!mounted || !text) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[45]"
      style={{ top: hintTopPx, left: centerX, transform: 'translateX(-50%)' }}
    >
      <div
        className={
          wrap
            ? 'flex max-w-[min(560px,calc(100vw-2rem))] items-center gap-1 rounded-[5px] border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[12px] font-medium leading-snug text-amber-900 shadow-md'
            : 'flex max-w-[min(420px,calc(100vw-2rem))] items-center gap-1 whitespace-nowrap rounded-[5px] border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow-md'
        }
      >
        <span className={wrap ? 'text-center' : undefined}>{text}</span>
        {showZoomAction ? (
          <button
            type="button"
            title="열림·잠금이 보이는 축척으로 확대"
            aria-label="열림·잠금이 보이는 축척으로 확대"
            className="pointer-events-auto inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-0.5 text-amber-900 hover:bg-amber-200/50"
            onClick={zoomToOverlayScale}
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
