'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { useSearchBarOffset } from '../../../../searchBarOffsetContext'

type Props = {
  /** 표시할 문구. null 이면 숨김 */
  message: string | null
}

/** 송수경로 탐색 등 진행 중일 때 지도 화면 위쪽 가운데에 띄우는 스피너 토스트 */
export function WtlSupplyBusyToast({ message }: Props) {
  const { leftPx } = useSearchBarOffset()
  const [centerX, setCenterX] = useState(0)

  useEffect(() => {
    if (!message) return
    // 왼쪽 패널을 뺀 지도 영역의 가운데 (WtlOutageZoomHint 와 같은 기준)
    const update = () => {
      const mapLeft = Math.max(0, leftPx - 20)
      const mapRight = Math.max(mapLeft + 1, window.innerWidth - 16)
      setCenterX((mapLeft + mapRight) / 2)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [message, leftPx])

  if (!message || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[45]"
      style={{ top: 16, left: centerX, transform: 'translateX(-50%)' }}
    >
      <div
        role="status"
        aria-live="polite"
        className="flex max-w-[min(420px,calc(100vw-2rem))] items-center gap-2 whitespace-nowrap rounded-[5px] border border-sky-200 bg-white/95 px-3 py-1.5 text-[12px] font-medium text-sky-900 shadow-md"
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600" aria-hidden />
        {message}
      </div>
    </div>,
    document.body
  )
}
