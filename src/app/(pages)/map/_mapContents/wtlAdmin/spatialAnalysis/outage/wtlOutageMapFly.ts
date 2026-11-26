import type { Map } from 'ol'
import { boundingExtent } from 'ol/extent'
import GeoJSON from 'ol/format/GeoJSON'
import { easeOut } from 'ol/easing'
import { prepareMapForPanelAwareNavigation } from '../../../../_mapComponents/config/mapAutoNavigation'
import { getViewProjectionCode, lonLatToView } from '../topology/topoMapProjection'
import type { WtlOutageResult } from './wtlOutageSample'

const FLY_ZOOM = 17
/** 목록→좌표 이동 애니메이션 길이(ms). 이동 후 속성조회 등 후속 작업 지연에 사용 */
export const OUTAGE_FLY_MS = 450
const FLY_MS = OUTAGE_FLY_MS
/** 탐색 범위 맞춤: 범위가 짧으면 충분히 확대(상한만 두고 줌은 fit이 범위 크기로 결정) */
const RESULT_FIT_MAX_ZOOM = 20
const RESULT_FIT_PADDING: [number, number, number, number] = [40, 40, 40, 40]

/** 목록 선택 강조 (수용가·도로명=점, 필지=면) */
export type WtlOutageSelectionHighlight =
  | {
      kind: 'point'
      point: [number, number]
      /** wtl_meta_ps 레이어 스타일용 */
      ogcFid?: number
      meterNo?: string
    }
  | {
      kind: 'polygon'
      geometry4326: Record<string, unknown>
      /** 필지 PNU — 있으면 지적(jijuk) 레이어 스타일로 그 필지만 표시 */
      pnu?: string
    }

/** 수용가·도로명·필지 목록 클릭 시 해당 좌표로 이동 */
export function flyToOutageLonLat(
  map: Map | null | undefined,
  lon: number | null | undefined,
  lat: number | null | undefined,
  applyMapViewPadding?: (() => void) | null,
  /** 이 줌 이상으로 확대(기본 FLY_ZOOM) — 제수변 열림·잠금이 보이는 축척 등 */
  minZoom?: number
): void {
  if (!map || lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return
  const run = () => {
    prepareMapForPanelAwareNavigation(map, applyMapViewPadding)
    const view = map.getView()
    // 이동 시점의 지도 좌표계(3857, 카카오 배경이면 5181)로 변환
    const center = lonLatToView([lon, lat], getViewProjectionCode(map))
    view.cancelAnimations()
    const currentZoom = view.getZoom()
    const targetZoom = Math.max(
      Number.isFinite(currentZoom) ? (currentZoom as number) : 0,
      Math.max(FLY_ZOOM, Number.isFinite(minZoom) ? (minZoom as number) : FLY_ZOOM)
    )
    const resolution = view.getResolutionForZoom(targetZoom)
    view.animate({
      center,
      resolution,
      duration: FLY_MS,
      easing: easeOut,
    })
  }

  window.setTimeout(() => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run)
      })
    })
  }, 80)
}

/** 분석 이력·결과 범위로 지도 맞춤 */
export function fitOutageResult(
  map: Map | null | undefined,
  result: WtlOutageResult | null | undefined,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map || !result) return
  /** 경위도 — 맞춤 시점에 지도 좌표로 변환 */
  const pts: [number, number][] = []
  const rings =
    result.rings && result.rings.length > 0
      ? result.rings
      : result.ring.length >= 3
        ? [result.ring]
        : []
  for (const ring of rings) {
    for (const c of ring) {
      if (c.length < 2) continue
      pts.push([Number(c[0]), Number(c[1])])
    }
  }
  for (const line of result.pipes) {
    for (const c of line) {
      if (c.length < 2) continue
      pts.push([Number(c[0]), Number(c[1])])
    }
  }
  if (pts.length === 0) return

  const run = () => {
    prepareMapForPanelAwareNavigation(map, applyMapViewPadding)
    const proj = getViewProjectionCode(map)
    map.getView().fit(boundingExtent(pts.map((p) => lonLatToView(p, proj))), {
      padding: RESULT_FIT_PADDING,
      maxZoom: RESULT_FIT_MAX_ZOOM,
      duration: FLY_MS,
    })
  }

  window.setTimeout(() => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run)
      })
    })
  }, 80)
}

/** 필지 GeoJSON(4326) 범위로 지도 맞춤 */
export function fitOutageGeometry4326(
  map: Map | null | undefined,
  geometry4326: Record<string, unknown> | null | undefined,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map || !geometry4326) return
  try {
    const features = new GeoJSON().readFeatures(
      { type: 'Feature', geometry: geometry4326, properties: {} },
      { dataProjection: 'EPSG:4326', featureProjection: getViewProjectionCode(map) }
    )
    const geom = features[0]?.getGeometry()
    if (!geom) return
    const extent = geom.getExtent()
    if (!extent || extent.some((n) => !Number.isFinite(n))) return
    const run = () => {
      prepareMapForPanelAwareNavigation(map, applyMapViewPadding)
      map.getView().fit(extent, {
        padding: [80, 80, 80, 80],
        maxZoom: 19,
        duration: FLY_MS,
      })
    }
    window.setTimeout(() => {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run)
        })
      })
    }, 80)
  } catch {
    /* ignore bad geom */
  }
}
