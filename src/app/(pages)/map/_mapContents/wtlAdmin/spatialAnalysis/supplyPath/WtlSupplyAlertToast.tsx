'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchBarOffset } from '../../../../searchBarOffsetContext'

const AUTO_HIDE_MS = 2000

type Props = {
  /** 표시할 문구. null 이면 숨김 */
  message: string | null
  onDismiss: () => void
}

/**
 * 송수경로 탐색 실패 등 — 지도 영역 가운데 토스트
 * (FMS 시설 상세와 동일 파란 토스트 UI, 위치는 왼쪽 패널을 뺀 지도 중앙)
 */
export function WtlSupplyAlertToast({ message, onDismiss }: Props) {
  const { leftPx } = useSearchBarOffset()
  const [centerX, setCenterX] = useState(0)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!message) return
    // 왼쪽 패널을 뺀 지도 영역의 가운데 (WtlSupplyBusyToast·WtlOutageZoomHint 와 같은 기준)
    const update = () => {
      const mapLeft = Math.max(0, leftPx - 20)
      const mapRight = Math.max(mapLeft + 1, window.innerWidth - 16)
      setCenterX((mapLeft + mapRight) / 2)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [message, leftPx])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => onDismissRef.current(), AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [message])

  if (!message || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-200"
      style={{ top: '50%', left: centerX, transform: 'translate(-50%, -50%)' }}
    >
      <div
        className="pointer-events-none inline-block max-w-[min(420px,calc(100vw-2rem))] px-4 py-2 text-sm text-white shadow-md"
        style={{ backgroundColor: '#5191e4', borderRadius: 3 }}
        role="status"
      >
        {message}
      </div>
    </div>,
    document.body
  )
}
