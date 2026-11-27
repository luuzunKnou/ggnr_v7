'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import type { Geometry } from 'ol/geom'
import Point from 'ol/geom/Point'
import { cn } from '@/lib/utils'
import { getLegendUrl } from '../../../_mapComponents/hooks/useFeatureIdentify'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { EquipmentFacilityInfoPreview } from './resolveEquipmentFacilityInfoPreview'

const PANEL_W = 260
/** 헤더+주소 대략 높이 — 실측 전 우하단 배치용 */
const PANEL_H_ESTIMATE = 72
const EDGE_PAD = 8
/** 포인트보다 살짝 위에 띄움 */
const ABOVE_GAP_PX = 14

function normalizeGeom(geom: unknown): object | null {
  if (!geom) return null
  if (typeof geom === 'object') return geom as object
  if (typeof geom === 'string') {
    try {
      const parsed = JSON.parse(geom) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as object) : null
    } catch {
      return null
    }
  }
  return null
}

/** GeoJSON(EPSG:4326) → 브라우저 화면 좌표 (지도 포인트) */
function geomToClientPoint(
  map: OLMap | null | undefined,
  geom: unknown
): { x: number; y: number } | null {
  if (!map) return null
  const geo = normalizeGeom(geom)
  if (!geo) return null
  try {
    const olGeom = new GeoJSON().readGeometry(geo, {
      dataProjection: 'EPSG:4326',
      featureProjection: map.getView().getProjection() ?? 'EPSG:3857',
    })
    if (!olGeom) return null
    let coord: number[] | null = null
    const geom = olGeom as Geometry
    if (geom instanceof Point) {
      coord = geom.getCoordinates()
    } else if (
      'getInteriorPoint' in geom &&
      typeof (geom as { getInteriorPoint: () => Point }).getInteriorPoint ===
        'function'
    ) {
      coord = (
        geom as { getInteriorPoint: () => Point }
      ).getInteriorPoint().getCoordinates()
    } else {
      const extent = geom.getExtent()
      if (extent && extent.length >= 4) {
        coord = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]
      }
    }
    if (!coord || coord.length < 2) return null
    const pixel = map.getPixelFromCoordinate([coord[0]!, coord[1]!])
    if (!pixel || pixel.length < 2) return null
    const el = map.getTargetElement()
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: rect.left + pixel[0]!,
      y: rect.top + pixel[1]!,
    }
  } catch {
    return null
  }
}

/**
 * 포인트 = 패널 우하단, 살짝 위.
 * left = pointX - width, top = pointY - height - gap
 */
function bottomRightAbovePoint(
  point: { x: number; y: number },
  panelW: number,
  panelH: number
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = point.x - panelW
  let top = point.y - panelH - ABOVE_GAP_PX
  const maxLeft = Math.max(EDGE_PAD, vw - panelW - EDGE_PAD)
  const maxTop = Math.max(EDGE_PAD, vh - panelH - EDGE_PAD)
  left = Math.min(maxLeft, Math.max(EDGE_PAD, left))
  top = Math.min(maxTop, Math.max(EDGE_PAD, top))
  return { top, left }
}

type Props = {
  preview: EquipmentFacilityInfoPreview
  onClose: () => void
}

/** 설비관리 리스트 — 시설정보 미리보기 플로팅 모달 (이동 없음) */
export function WtlFacilityInfoPreviewFloat({ preview, onClose }: Props) {
  const mapContext = useMapContext()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current ?? null
    const place = () => {
      const point = geomToClientPoint(map, preview.geom)
      if (!point) {
        setPos(null)
        return
      }
      const h = rootRef.current?.offsetHeight || PANEL_H_ESTIMATE
      const w = rootRef.current?.offsetWidth || PANEL_W
      setPos(bottomRightAbovePoint(point, w, h))
    }
    place()
    const raf = requestAnimationFrame(place)
    if (!map) {
      return () => cancelAnimationFrame(raf)
    }
    map.on('postrender', place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      map.un('postrender', place)
      window.removeEventListener('resize', place)
    }
  }, [mapContext?.mapInstanceRef, preview.geom])

  useLayoutEffect(() => {
    if (!pos || !rootRef.current) return
    const map = mapContext?.mapInstanceRef?.current ?? null
    const point = geomToClientPoint(map, preview.geom)
    if (!point) return
    const h = rootRef.current.offsetHeight || PANEL_H_ESTIMATE
    const w = rootRef.current.offsetWidth || PANEL_W
    const next = bottomRightAbovePoint(point, w, h)
    if (next.top !== pos.top || next.left !== pos.left) {
      setPos(next)
    }
  }, [pos, mapContext?.mapInstanceRef, preview.geom, preview.address, preview.siteName])

  if (typeof document === 'undefined') return null

  const legendSrc = getLegendUrl(preview.tableName)
  const siteName = String(preview.siteName ?? '').trim() || '—'
  const address = String(preview.address ?? '').trim() || '—'

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="시설정보 상세보기"
      title="시설정보 상세보기"
      className={cn(
        'pointer-events-auto fixed flex flex-col overflow-hidden',
        'standard-map-float-surface opacity-100!',
        // 지도(z-0) 위 · 리스트·확장 패널(z-10) 아래
        'z-5',
        !pos && 'invisible'
      )}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: PANEL_W,
        maxWidth: 'min(260px, calc(100vw - 1rem))',
      }}
    >
      <div
        className={cn(
          'standard-map-float-header cursor-default gap-1.5 py-1.5! text-[11px]!',
          'hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white/90'
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <img
            src={legendSrc}
            alt=""
            className="h-4 w-4 shrink-0 rounded border border-slate-200 object-contain dark:border-white/20"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <span
            className="standard-map-float-header-title min-w-0 truncate text-[11px]"
            title={siteName}
          >
            {siteName}
          </span>
        </span>
        <button
          type="button"
          title="닫기"
          aria-label="닫기"
          onClick={onClose}
          className="standard-map-float-header-close cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="px-2.5 py-1.5 text-[11px] leading-snug text-slate-700 dark:text-white/85">
        <p className="m-0 wrap-break-word" title={address}>
          {address}
        </p>
      </div>
    </div>,
    document.body
  )
}
