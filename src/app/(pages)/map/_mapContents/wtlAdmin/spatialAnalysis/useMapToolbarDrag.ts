'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

type Pos = { x: number; y: number }

/**
 * 지도 위 편집 도구모음을 손잡이로 끌어 옮기기 — 지도(host) 안으로만 제한.
 * minX: 지도 왼쪽을 덮는 메뉴·패널의 오른쪽 끝(host 기준 px) — 그 뒤로 숨지 않게 막음.
 * 도구모음은 지도 이벤트 차단용 네이티브 리스너(stopPropagation)를 쓰므로
 * React 핸들러 대신 손잡이에 네이티브 pointer 이벤트 + 포인터 캡처로 처리한다.
 * 손잡이 더블클릭: 기본 위치(가운데 위)로 되돌림.
 */
export function useMapToolbarDrag(
  host: HTMLElement | null | undefined,
  barRef: RefObject<HTMLDivElement | null>,
  /** 도구모음이 화면에 있을 때 true — 마운트될 때 리스너를 붙이기 위함 */
  enabled: boolean,
  /** 이보다 왼쪽(패널 뒤)으로는 옮기지 못함 */
  minX = 0
) {
  const handleRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)

  const clampPos = useCallback(
    (p: Pos): Pos => {
      const bar = barRef.current
      if (!host || !bar) return p
      const lo = Math.max(0, Math.min(minX, host.clientWidth - bar.offsetWidth))
      const maxX = Math.max(lo, host.clientWidth - bar.offsetWidth)
      const maxY = Math.max(0, host.clientHeight - bar.offsetHeight)
      return { x: Math.min(maxX, Math.max(lo, p.x)), y: Math.min(maxY, Math.max(0, p.y)) }
    },
    [host, barRef, minX]
  )

  useEffect(() => {
    const handle = handleRef.current
    const bar = barRef.current
    if (!enabled || !host || !handle || !bar) return
    let drag: { id: number; offX: number; offY: number } | null = null

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const r = bar.getBoundingClientRect()
      drag = { id: e.pointerId, offX: e.clientX - r.left, offY: e.clientY - r.top }
      handle.setPointerCapture(e.pointerId)
      handle.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      e.preventDefault()
      e.stopPropagation()
      const hr = host.getBoundingClientRect()
      setPos(clampPos({ x: e.clientX - hr.left - drag.offX, y: e.clientY - hr.top - drag.offY }))
    }
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      e.stopPropagation()
      drag = null
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      handle.style.cursor = ''
    }
    const onDbl = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setPos(null)
    }
    handle.addEventListener('pointerdown', onDown)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
    handle.addEventListener('dblclick', onDbl)
    return () => {
      handle.removeEventListener('pointerdown', onDown)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      handle.removeEventListener('dblclick', onDbl)
    }
  }, [enabled, host, barRef, clampPos])

  // 지도 크기·패널 폭(minX)이 바뀌면 다시 보이는 지도 안으로
  useEffect(() => {
    if (!enabled || !host || !pos) return
    const reclamp = () => setPos((p) => (p ? clampPos(p) : p))
    reclamp()
    const ro = new ResizeObserver(reclamp)
    ro.observe(host)
    return () => ro.disconnect()
  }, [enabled, host, pos != null, clampPos]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 옮긴 위치가 있으면 기본 가운데 정렬(translate)·top을 덮어씀 */
  const barStyle = (defaultLeft: number): CSSProperties =>
    pos
      ? { left: pos.x, top: pos.y, translate: 'none', transform: 'none' }
      : { left: defaultLeft }

  return { handleRef, barStyle, moved: pos != null }
}
