'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Overlay from 'ol/Overlay'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../_mapComponents/MapContext'
import { detailWondoLabel, type DetailWondoItem } from './detailWondoConfig'

type Props = {
  coord3857: [number, number]
  items: DetailWondoItem[]
  checkedIds: Set<string>
  loadingIds: Set<string>
  onCheckedChange: (id: string, checked: boolean) => void
  onClose: () => void
}

/** 겹친 도곽을 클릭했을 때 그 위치에 뜨는 원도 선택 목록 */
export function DetailWondoPickPopup({
  coord3857,
  items,
  checkedIds,
  loadingIds,
  onCheckedChange,
  onClose,
}: Props) {
  const mapContext = useMapContext()
  const mapReady = Boolean(mapContext?.mapReady)
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = 'pointer-events-auto'
    return el
  })
  const overlayRef = useRef<Overlay | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!mapReady || !map) return
    const ov = new Overlay({ element: host, positioning: 'bottom-center', offset: [0, -12], stopEvent: true })
    map.addOverlay(ov)
    overlayRef.current = ov
    return () => {
      map.removeOverlay(ov)
      overlayRef.current = null
    }
  }, [mapReady, mapContext?.mapInstanceRef, host])

  useEffect(() => {
    overlayRef.current?.setPosition(coord3857)
  }, [coord3857, mapReady])

  return createPortal(
    <div className="flex w-[240px] flex-col items-center drop-shadow-[0_8px_18px_rgba(15,23,42,0.22)]">
      <div className="w-full overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
          <span className="text-xs font-semibold text-foreground">이 위치 원도 {items.length}장</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
            title="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="max-h-[240px] overflow-y-auto scrollbar-thin">
          {items.map((item) => {
            const on = checkedIds.has(item.id)
            return (
              <li key={item.id}>
                <label
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-white/10',
                    on && 'bg-blue-50 font-medium text-primary dark:bg-white/20'
                  )}
                  title={item.title || item.name}
                >
                  <span className="min-w-0 flex-1 truncate">{detailWondoLabel(item)}</span>
                  {item.category ? (
                    <span className="shrink-0 text-[10px] font-normal text-slate-400 dark:text-white/50">
                      {item.category}
                    </span>
                  ) : null}
                  {loadingIds.has(item.id) ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-400" />
                  ) : null}
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => onCheckedChange(item.id, e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-white/30"
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="-mt-px h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-background" />
    </div>,
    host
  )
}
