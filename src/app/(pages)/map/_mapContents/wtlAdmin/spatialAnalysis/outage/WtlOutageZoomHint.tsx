'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { unByKey } from 'ol/Observable'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { useSearchBarOffset } from '../../../../searchBarOffsetContext'
import { isOutageOverlayScaleVisible } from './useWtlOutageMapLayer'

type Props = {
  active: boolean
  /** 안내 문구 (기본: 단수구역 열림·잠금) */
  message?: string
}

/** 축척 240m보다 축소되면 열림·잠금 대신 확대 안내 */
export function WtlOutageZoomHint({
  active,
  message = '열림·잠금이 보이는 축척까지 지도를 확대해 주세요',
}: Props) {
  const mapContext = useMapContext()
  const { leftPx } = useSearchBarOffset()
  const [show, setShow] = useState(false)
  const [centerX, setCenterX] = useState(0)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!active || !map || !mapContext?.mapReady) {
      setShow(false)
      return
    }
    const update = () => {
      setShow(!isOutageOverlayScaleVisible(map.getView().getZoom()))
    }
    update()
    const key = map.getView().on('change:resolution', update)
    return () => {
      unByKey(key)
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    if (!show) return
    const update = () => {
      const mapLeft = Math.max(0, leftPx - 20)
      const mapRight = Math.max(mapLeft + 1, window.innerWidth - 16)
      setCenterX((mapLeft + mapRight) / 2)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [show, leftPx])

  if (!show || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[45]"
      style={{ top: 16, left: centerX, transform: 'translateX(-50%)' }}
    >
      <div className="max-w-[min(420px,calc(100vw-2rem))] whitespace-nowrap rounded-[5px] border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow-md">
        {message}
      </div>
    </div>,
    document.body
  )
}
