'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type Station = { dist: number; elev: number }

export function lineFromGeometry(geom: GeoJSON.Geometry | null | undefined): [number, number][] | null {
  if (!geom) return null
  let ring: number[][] | undefined
  if (geom.type === 'LineString') ring = geom.coordinates
  else if (geom.type === 'MultiLineString') ring = geom.coordinates[0]
  else if (geom.type === 'Polygon') ring = geom.coordinates[0]
  else if (geom.type === 'MultiPolygon') ring = geom.coordinates[0]?.[0]
  if (!ring || ring.length < 2) return null
  return ring.map((c) => [c[0], c[1]] as [number, number])
}

function distMeters(a: [number, number], b: [number, number]) {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function sampleTerrain(line: [number, number][]) {
  const segLens = line.slice(1).map((pt, i) => distMeters(line[i], pt))
  const total = segLens.reduce((sum, n) => sum + n, 0)
  const count = 16
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    const elev = 214 + Math.sin(t * Math.PI) * 11 + Math.sin(t * Math.PI * 3) * 2.4
    return { dist: total * t, elev }
  })
}

function SectionFigure({ points, diameterMm }: { points: Station[]; diameterMm: number }) {
  const width = 680
  const height = 400
  const dx = 46
  const dy = -26
  const left = 120
  const right = 520
  const bottom = 348
  const cover = 96
  const radius = 36
  const elevs = points.map((p) => p.elev)
  const elevMin = Math.min(...elevs)
  const relief = Math.max(Math.max(...elevs) - elevMin, 1)
  const yOf = (elev: number) => 176 - ((elev - elevMin) / relief) * 88
  const groundAt = (x: number) => {
    const t = Math.min(1, Math.max(0, (x - left) / (right - left)))
    const idx = t * (points.length - 1)
    const i = Math.min(points.length - 2, Math.floor(idx))
    const f = idx - i
    return yOf(points[i].elev + (points[i + 1].elev - points[i].elev) * f)
  }
  const groundLine = points.map((p, i) => ({
    x: left + ((right - left) * i) / Math.max(points.length - 1, 1),
    y: yOf(p.elev),
  }))
  const cx = (left + right) / 2
  const ground = groundAt(cx)
  const cy = ground + cover + radius
  const move = (x: number, y: number) => ({ x: x + dx, y: y + dy })
  const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  const trenchHalf = 78
  const trenchBottom = cy + radius + 28
  const soilFront = [...groundLine, { x: right, y: bottom }, { x: left, y: bottom }]
  const soilBack = [...groundLine.map((p) => move(p.x, p.y)), move(right, bottom), move(left, bottom)]
  const top = [...groundLine, ...[...groundLine].reverse().map((p) => move(p.x, p.y))]
  const side = [groundLine[groundLine.length - 1], move(right, groundAt(right)), move(right, bottom), { x: right, y: bottom }]
  const trench = [
    { x: cx - trenchHalf, y: groundAt(cx - trenchHalf) },
    { x: cx + trenchHalf, y: groundAt(cx + trenchHalf) },
    { x: cx + trenchHalf, y: trenchBottom },
    { x: cx - trenchHalf, y: trenchBottom },
  ]
  const back = { x: cx + 22, y: cy - 12 }
  const len = Math.hypot(back.x - cx, back.y - cy) || 1
  const px = -(back.y - cy) / len
  const py = (back.x - cx) / len
  const nearL = { x: cx + px * radius, y: cy + py * radius }
  const nearR = { x: cx - px * radius, y: cy - py * radius }
  const farL = { x: back.x + px * radius, y: back.y + py * radius }
  const farR = { x: back.x - px * radius, y: back.y - py * radius }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="관로 단면도">
      <rect width={width} height={height} fill="#e7f3f6" />
      <polygon points={poly(soilBack)} fill="#b8956a" />
      <polygon points={poly(side)} fill="#c4a57a" />
      <polygon points={poly(soilFront)} fill="#e4d2b0" />
      <polygon points={poly(trench)} fill="#c9b48a" />
      <polygon points={poly(top)} fill="#7d9a58" />
      <circle cx={back.x} cy={back.y} r={radius} fill="#245868" />
      <polygon points={poly([nearL, farL, farR, nearR])} fill="#3d87a0" />
      <circle cx={cx} cy={cy} r={radius} fill="#e7f6f8" stroke="#1f5566" strokeWidth="8" />
      <circle cx={cx} cy={cy} r={radius - 8} fill="#f4fbfc" />
      <line x1={cx + radius + 16} x2={cx + radius + 16} y1={ground} y2={cy - radius} stroke="#3d5560" />
      <text x={cx + radius + 22} y={(ground + cy - radius) / 2} fill="#3d5560" fontSize="12">
        토피 1.2m
      </text>
      <text x={cx - 18} y={cy + radius + 18} fill="#1f5566" fontSize="12">
        {Math.round(diameterMm)}㎜
      </text>
      <text x={16} y={groundAt(left) + 4} fill="#3d5560" fontSize="12">
        지반고 {points[Math.floor(points.length / 2)]?.elev.toFixed(0)}m
      </text>
    </svg>
  )
}

export function SwlNetworkMapSectionModal({
  open,
  name,
  diameter,
  line,
  onClose,
}: {
  open: boolean
  name: string
  diameter: string
  line: [number, number][] | null
  onClose: () => void
}) {
  const points = open && line && line.length >= 2 ? sampleTerrain(line) : null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  const diameterMm = Number(String(diameter).replace(/[^\d.]/g, ''))

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-[min(760px,100%)] flex-col overflow-hidden rounded-md bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{name || '관로'} 단면도</div>
            <div className="text-[11px] text-muted-foreground">선택한 관로의 위치 · 예시 지형</div>
          </div>
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="닫기" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!line || line.length < 2 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              단면으로 볼 관로를 목록이나 지도에서 먼저 선택하세요.
            </p>
          ) : !points ? null : (
            <SectionFigure points={points} diameterMm={Number.isFinite(diameterMm) && diameterMm > 0 ? diameterMm : 300} />
          )}
        </div>
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          지표면은 예시 높이입니다. 원은 관이고, 지면에서 관 위까지가 토피 1.2m입니다.
        </div>
      </div>
    </div>,
    document.body
  )
}
