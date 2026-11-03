'use client'

import { useEffect, useRef, useState } from 'react'
import type OLMap from 'ol/Map'
import type BaseLayer from 'ol/layer/Base'
import ImageLayer from 'ol/layer/Image'
import { boundingExtent, intersects, type Extent } from 'ol/extent'
import ImageCanvasSource from 'ol/source/ImageCanvas'
import { withBasePath } from '@/lib/basePath'
import { useMapContext } from '../../_mapComponents/MapContext'
import type { DetailWondoItem, DetailWondoShown } from './detailWondoConfig'
import { detailWondoCorners3857 } from './useDetailWondoFootprintLayer'

const LAYER_PROP = 'detailWondoImageLayer'
/** 원본 대비 이 배율보다 작게 그릴 때는 축소본 사용 */
const REDUCED_SCALE = 0.25
/** 끈 원도의 디코딩된 이미지를 최근 것부터 이만큼 보관 (원본 스캔이라 장당 메모리가 큼) */
const OFF_CACHE_MAX = 8

type Decoded = {
  image: HTMLImageElement
  reduced: HTMLCanvasElement | null
}

type Entry = {
  layer: ImageLayer<ImageCanvasSource>
  image: HTMLImageElement | null
  reduced: HTMLCanvasElement | null
}

function putOffCache(cache: Map<string, Decoded>, id: string, decoded: Decoded) {
  cache.delete(id)
  cache.set(id, decoded)
  while (cache.size > OFF_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest == null) break
    cache.delete(oldest)
  }
}

/** 지적도 아래(없으면 서비스 레이어 아래)에 원도를 깐다 */
function insertBelowCadastral(map: OLMap, layer: BaseLayer) {
  const collection = map.getLayers()
  const arr = collection.getArray()
  let idx = arr.findIndex((l) => l.get('cadastralLayer') === true)
  if (idx < 0) idx = arr.findIndex((l) => l.get('serviceLayer') === true)
  if (idx >= 0) collection.insertAt(idx, layer)
  else collection.push(layer)
}

function reducedOf(entry: Entry): HTMLCanvasElement | null {
  const img = entry.image
  if (!img) return null
  if (!entry.reduced) {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * REDUCED_SCALE))
    c.height = Math.max(1, Math.round(img.naturalHeight * REDUCED_SCALE))
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
    entry.reduced = c
  }
  return entry.reduced
}

/**
 * 원도 JPG를 네 모서리 좌표(회전 포함)대로 그리는 캔버스 소스.
 * 위왼쪽·위오른쪽·아래왼쪽 세 모서리로 이미지 픽셀 → 화면 픽셀 변환을 만든다.
 */
function createSource(item: DetailWondoItem, entry: Entry): ImageCanvasSource {
  const [tl, tr, , bl] = detailWondoCorners3857(item)
  const footprint: Extent = boundingExtent(detailWondoCorners3857(item))
  return new ImageCanvasSource({
    ratio: 1,
    canvasFunction: (extent, resolution, pixelRatio, size) => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(size[0])
      canvas.height = Math.round(size[1])
      const img = entry.image
      if (!img || !intersects(extent, footprint)) return canvas
      const ctx = canvas.getContext('2d')
      if (!ctx) return canvas

      const k = pixelRatio / resolution
      const px = (c: [number, number]) => [(c[0] - extent[0]) * k, (extent[3] - c[1]) * k]
      const [x0, y0] = px(tl)
      const [x1, y1] = px(tr)
      const [x2, y2] = px(bl)
      const w = img.naturalWidth
      const h = img.naturalHeight
      const scale = Math.hypot(x1 - x0, y1 - y0) / w
      const src = scale < REDUCED_SCALE ? (reducedOf(entry) ?? img) : img
      const sw = src === img ? w : (src as HTMLCanvasElement).width
      const sh = src === img ? h : (src as HTMLCanvasElement).height

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.setTransform((x1 - x0) / sw, (y1 - y0) / sw, (x2 - x0) / sh, (y2 - y0) / sh, x0, y0)
      ctx.drawImage(src, 0, 0)
      return canvas
    },
  })
}

type Options = {
  items: DetailWondoItem[]
  shown: DetailWondoShown[]
}

/** 표시 중인 원도마다 이미지 레이어 1개. 투명도는 레이어 opacity로 반영 */
export function useDetailWondoImageLayers({ items, shown }: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const entriesRef = useRef<Map<string, Entry>>(new Map())
  const offCacheRef = useRef<Map<string, Decoded>>(new Map())
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set())
  const [errorIds, setErrorIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!mapReady || !map) return
    const entries = entriesRef.current
    const offCache = offCacheRef.current
    const wanted = new Map(shown.map((s) => [s.id, s.opacity]))
    const byId = new Map(items.map((it) => [it.id, it]))

    for (const [id, entry] of entries) {
      if (wanted.has(id)) continue
      map.removeLayer(entry.layer)
      entries.delete(id)
      if (entry.image) putOffCache(offCache, id, { image: entry.image, reduced: entry.reduced })
      setLoadingIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }

    for (const [id, opacity] of wanted) {
      const existing = entries.get(id)
      if (existing) {
        existing.layer.setOpacity(opacity)
        continue
      }
      const item = byId.get(id)
      if (!item) continue
      const entry: Entry = { layer: new ImageLayer(), image: null, reduced: null }
      const source = createSource(item, entry)
      entry.layer.setSource(source)
      entry.layer.setOpacity(opacity)
      entry.layer.set(LAYER_PROP, true)
      entries.set(id, entry)
      insertBelowCadastral(map, entry.layer)

      const cached = offCache.get(id)
      if (cached) {
        offCache.delete(id)
        entry.image = cached.image
        entry.reduced = cached.reduced
        continue
      }

      setLoadingIds((prev) => new Set(prev).add(id))
      setErrorIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      const img = new Image()
      img.decoding = 'async'
      img.src = withBasePath(`/api/detail-wondo/image?id=${encodeURIComponent(id)}`)
      img
        .decode()
        .then(() => {
          if (entries.get(id) !== entry) {
            putOffCache(offCache, id, { image: img, reduced: null })
            return
          }
          entry.image = img
          source.changed()
        })
        .catch(() => {
          if (entries.get(id) !== entry) return
          setErrorIds((prev) => new Set(prev).add(id))
        })
        .finally(() => {
          setLoadingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        })
    }
  }, [items, shown, map, mapReady])

  useEffect(() => {
    const entries = entriesRef.current
    const offCache = offCacheRef.current
    return () => {
      for (const entry of entries.values()) map?.removeLayer(entry.layer)
      entries.clear()
      offCache.clear()
    }
  }, [map])

  return { loadingIds, errorIds }
}
