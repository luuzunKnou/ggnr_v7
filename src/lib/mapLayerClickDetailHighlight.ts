import type { FeatureLike } from 'ol/Feature'
import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Stroke from 'ol/style/Stroke'
import Style, { type StyleFunction } from 'ol/style/Style'
import {
  compareFeaturesByGeometryStackOrder,
  GEOM_STACK_UI_ZINDEX_MIN,
  LAYER_GEOM_STACK_SKIP_KEY,
} from '@/lib/mapLayerGeometryOrder'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'

/** 맵 속성 키 — 관망·시설·기본 모달 공통 선택자 레이어 */
export const LAYER_CLICK_DETAIL_HIGHLIGHT_KEY = 'layerClickDetailHighlight'

export type MapLayerClickDetailHighlightOwner =
  | 'layerClickDetail'
  | 'wtlNetwork'
  | 'wtlFacility'

type MapEntry = {
  layer: VectorLayer<VectorSource>
  source: VectorSource
  byOwner: Map<MapLayerClickDetailHighlightOwner, unknown>
  /** 최근 갱신·포커스 순 (뒤가 최신) */
  mru: MapLayerClickDetailHighlightOwner[]
  pulsePhase: number
  rafId: number
}

const entries = new WeakMap<OLMap, MapEntry>()

function createSelectionStyle(getPulsePhase: () => number): StyleFunction {
  const base = createDataQuerySelectionRowHighlightStyle(getPulsePhase)
  return (feature: FeatureLike, resolution: number) => {
    const geomType = feature.getGeometry()?.getType()
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const t = Math.sin(getPulsePhase())
      const whiteOp = 0.6 + 0.35 * t
      const redOp = 0.5 + 0.3 * t
      return [
        new Style({
          stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteOp})`, width: 7 + t }),
        }),
        new Style({
          stroke: new Stroke({ color: `rgba(220, 38, 38, ${redOp})`, width: 4 + 0.8 * t }),
        }),
      ]
    }
    return base(feature, resolution)
  }
}

function normalizeGeom(geom: unknown): Record<string, unknown> | null {
  let g: unknown = geom
  if (typeof g === 'string') {
    try {
      g = JSON.parse(g)
    } catch {
      return null
    }
  }
  if (!g || typeof g !== 'object' || !('type' in g) || !('coordinates' in g)) {
    return null
  }
  return g as Record<string, unknown>
}

function selectionFeatures(map: OLMap, geom: unknown) {
  const normalized = normalizeGeom(geom)
  if (!normalized) return []
  const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857'
  const features = new GeoJSON().readFeatures(
    {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: normalized, properties: {} }],
    },
    { dataProjection: 'EPSG:4326', featureProjection: viewProj }
  )
  if (features.length === 0) return []
  const geomType = features[0]!.getGeometry()?.getType()
  if (geomType === 'Point' || geomType === 'MultiPoint') {
    features[0]!.set('isRadarPoint', true)
  }
  return features
}

function stopPulse(entry: MapEntry) {
  if (entry.rafId) {
    cancelAnimationFrame(entry.rafId)
    entry.rafId = 0
  }
}

function startPulse(entry: MapEntry) {
  if (entry.rafId) return
  const loop = () => {
    entry.pulsePhase += DATA_QUERY_SELECTION_PULSE_STEP
    entry.source.changed()
    entry.rafId = requestAnimationFrame(loop)
  }
  entry.rafId = requestAnimationFrame(loop)
}

function ensureEntry(map: OLMap): MapEntry {
  let entry = entries.get(map)
  if (entry) {
    const layers = map.getLayers().getArray()
    if (layers.includes(entry.layer)) return entry
    stopPulse(entry)
    entries.delete(map)
  }

  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    zIndex: GEOM_STACK_UI_ZINDEX_MIN,
    renderOrder: compareFeaturesByGeometryStackOrder,
    style: createSelectionStyle(() => {
      const e = entries.get(map)
      return e?.pulsePhase ?? 0
    }),
  })
  layer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
  layer.set(LAYER_CLICK_DETAIL_HIGHLIGHT_KEY, true)
  insertLayerBelowServiceLayer(map, layer)

  entry = {
    layer,
    source,
    byOwner: new Map(),
    mru: [],
    pulsePhase: 0,
    rafId: 0,
  }
  entries.set(map, entry)
  return entry
}

function touchMru(
  entry: MapEntry,
  owner: MapLayerClickDetailHighlightOwner
): void {
  entry.mru = entry.mru.filter((o) => o !== owner)
  entry.mru.push(owner)
}

function dropMru(
  entry: MapEntry,
  owner: MapLayerClickDetailHighlightOwner
): void {
  entry.mru = entry.mru.filter((o) => o !== owner)
}

function pickGeom(entry: MapEntry): unknown {
  for (let i = entry.mru.length - 1; i >= 0; i--) {
    const owner = entry.mru[i]
    if (owner != null && entry.byOwner.has(owner)) {
      return entry.byOwner.get(owner)
    }
  }
  for (const geom of entry.byOwner.values()) {
    return geom
  }
  return null
}

function publish(map: OLMap, entry: MapEntry) {
  entry.source.clear()
  const geom = pickGeom(entry)
  const features = selectionFeatures(map, geom)
  if (features.length === 0) {
    stopPulse(entry)
    return
  }
  entry.source.addFeatures(features)
  startPulse(entry)
}

/** 소유자 geom 등록 후 최근 갱신 1건만 표시 */
export function setMapLayerClickDetailHighlight(
  map: OLMap,
  owner: MapLayerClickDetailHighlightOwner,
  geom: unknown
): void {
  const entry = ensureEntry(map)
  const normalized = normalizeGeom(geom)
  if (!normalized) {
    entry.byOwner.delete(owner)
    dropMru(entry, owner)
  } else {
    entry.byOwner.set(owner, normalized)
    touchMru(entry, owner)
  }
  publish(map, entry)
}

/**
 * 이미 등록된 소유자를 최신으로 올림 (포커스·클릭만으로 하이라이트 복귀).
 * geom이 없으면 no-op.
 */
export function claimMapLayerClickDetailHighlight(
  map: OLMap,
  owner: MapLayerClickDetailHighlightOwner
): void {
  const entry = entries.get(map)
  if (!entry?.byOwner.has(owner)) return
  touchMru(entry, owner)
  publish(map, entry)
}

/** 해당 소유자만 해제. 남은 소유자가 있으면 그다음 최근 geom으로 복귀 */
export function clearMapLayerClickDetailHighlight(
  map: OLMap,
  owner: MapLayerClickDetailHighlightOwner
): void {
  const entry = entries.get(map)
  if (!entry) return
  if (!entry.byOwner.has(owner)) return
  entry.byOwner.delete(owner)
  dropMru(entry, owner)
  publish(map, entry)
}
