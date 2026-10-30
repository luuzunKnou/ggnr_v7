'use client'

import { useEffect, useRef, useState } from 'react'
import type { MapBrowserEvent } from 'ol'
import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import { unByKey } from 'ol/Observable'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import tablesJson from '@/config/defineLayer/tables.json'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { call } from '@/lib/api'
import {
  compareFeaturesByGeometryStackOrder,
  isPointSymbolLayerName,
  markLayerGeomStack,
  type LayerStackKind,
} from '@/lib/mapLayerGeometryOrder'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import '../../../_mapComponents/config/projections'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  buildWtlNetSearchCql,
  getWtlNetLayerDef,
  isWtlNetZoneLayerKey,
  matchWtlNetLayerDefForTable,
  type WtlNetWmsSearchFilter,
} from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSources,
  type WtlNetMapSourceId,
} from './wtlNetworkMapSources'
import type { WtlNetworkRow } from './wtlNetworkTypes'

/** tables.json define_table_shp_type → 기하 쌓기 종류 (면→선→점→심볼) */
function stackKindFromDefineShpType(tableName: string): LayerStackKind {
  const table = String(tableName ?? '').trim().toLowerCase()
  if (!table) return 'POLYGON'
  if (isPointSymbolLayerName(table)) return 'SYMBOL'
  const rows = tablesJson as { define_table_name?: string; define_table_shp_type?: string }[]
  const row = rows.find(
    (r) => String(r.define_table_name ?? '').trim().toLowerCase() === table
  )
  const shp = String(row?.define_table_shp_type ?? '').trim().toUpperCase()
  if (shp === 'POINT') return 'POINT'
  if (shp === 'LINE') return 'LINE'
  if (shp === 'POLYGON') return 'POLYGON'
  return 'POLYGON'
}

/** 분할 div_query + 검색 CQL 결합 (재난시설 safetyFac CQL 패턴과 동일) */
function combineLayerCql(base: string | undefined, search: string | undefined): string | undefined {
  const parts = [base, search]
    .map((s) => String(s ?? '').trim())
    .filter((s) => s && s !== 'INCLUDE')
  if (parts.length === 0) return undefined
  if (parts.length === 1) return parts[0]
  return parts.map((p) => `(${p})`).join(' AND ')
}

function applyCqlToImageWms(layer: ImageLayer<ImageWMS>, cql: string | undefined) {
  const source = layer.getSource()
  if (!source) return
  // 이미 생성된 지하시설물 레이어도 긴 CQL은 POST로 보내도록 보장
  source.setImageLoadFunction(geoserverWmsImageLoadFunction)
  const prev = String((source.getParams() as { CQL_FILTER?: string })?.CQL_FILTER ?? '')
  const next = cql ? String(cql) : ''
  if (prev === next) return
  // undefined로 넘겨야 ImageWMS가 파라미터 제거 후 다시 요청함 (delete만 하면 갱신 누락)
  if (cql) source.updateParams({ CQL_FILTER: cql })
  else source.updateParams({ CQL_FILTER: undefined })
}

function selectionFeatures(map: OLMap, geom: unknown) {
  if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return []
  const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857'
  const features = new GeoJSON().readFeatures(
    {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: geom, properties: {} }],
    },
    { dataProjection: 'EPSG:4326', featureProjection: viewProj }
  )
  if (features.length === 0) return []
  const geomType = features[0].getGeometry()?.getType()
  if (geomType === 'Point' || geomType === 'MultiPoint') features[0].set('isRadarPoint', true)
  return features
}

export type WtlNetworkDetailRelatedLayer = {
  table: string
  ftrIdn: string
} | null

type Props = {
  enabledLayerKeys: ReadonlySet<string>
  /** 함께 보기일 때 그룹마다 켜진 레이어. 없으면 선택한 그룹 모두 enabledLayerKeys 사용 */
  layersBySource?: Readonly<Record<string, readonly string[]>>
  mapSources: ReadonlySet<WtlNetMapSourceId>
  /** 서버 listWtlNetMapSources로 확정된 출처 id */
  availableSourceIds: readonly string[]
  selected: WtlNetworkRow | null
  onSelect: (row: WtlNetworkRow) => void
  onExtentChange: (bbox3857: [number, number, number, number] | null) => void
  /** 화면 내 조회 시 이동 중 진행 중 요청 취소용 */
  onMapMoveStart?: () => void
  /** 검색 조건 → WMS CQL */
  searchFilter?: WtlNetWmsSearchFilter | null
  /** 시설 상세 연관 탭 — 전용 WMS (지하시설물·급수구역과 분리) */
  detailRelatedLayer?: WtlNetworkDetailRelatedLayer
}

function escCqlLiteral(s: string): string {
  return String(s).replace(/'/g, "''")
}

function buildFtrIdnCql(ftrIdn: string): string {
  const v = escCqlLiteral(String(ftrIdn).trim())
  return `strToLowerCase(ftr_idn)=strToLowerCase('${v}')`
}

export function useWtlNetworkMapLayer({
  enabledLayerKeys,
  layersBySource,
  mapSources,
  availableSourceIds,
  selected,
  onSelect,
  onExtentChange,
  onMapMoveStart,
  searchFilter = null,
  detailRelatedLayer = null,
}: Props) {
  const mapContext = useMapContext()
  const wmsBySourceRef = useRef<Map<WtlNetMapSourceId, ImageLayer<ImageWMS>>>(new Map())
  /** 급수구역 전용 WMS (지하시설물 목록 밖) */
  const zoneWmsByTableRef = useRef<Map<string, ImageLayer<ImageWMS>>>(new Map())
  /** 상세 연관(펌프·흡수정 등) 전용 WMS */
  const detailRelatedWmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const [radarActive, setRadarActive] = useState(false)
  const onSelectRef = useRef(onSelect)
  const onExtentRef = useRef(onExtentChange)
  const onMoveStartRef = useRef(onMapMoveStart)
  const keysRef = useRef(enabledLayerKeys)
  const sourcesRef = useRef(mapSources)
  /** 구역·단면 LINE 그리기 중에는 레이어 클릭 선택 금지 */
  const drawBlocksClickRef = useRef(false)
  onSelectRef.current = onSelect
  onExtentRef.current = onExtentChange
  onMoveStartRef.current = onMapMoveStart
  keysRef.current = enabledLayerKeys
  sourcesRef.current = mapSources
  drawBlocksClickRef.current = Boolean(
    mapContext?.spatialDrawRequest || mapContext?.mapDrawInputSuspended
  )

  const availableKey = availableSourceIds.join('\u0001')

  // WMS(출처별) + highlight — 서버가 내려준 가용 출처 기준으로 생성
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    if (availableSourceIds.length === 0) {
      wmsBySourceRef.current = new Map()
      return
    }

    const sourceDefs = getWtlNetMapSources().filter((s) =>
      availableSourceIds.includes(s.id)
    )
    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    const bySource = new Map<WtlNetMapSourceId, ImageLayer<ImageWMS>>()
    for (const src of sourceDefs) {
      const wms = new ImageLayer({
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: '',
            TRANSPARENT: true,
            FORMAT: 'image/png',
          },
          serverType: 'geoserver',
          ratio: 1,
          imageLoadFunction: geoserverWmsImageLoadFunction,
        }),
        zIndex: 880,
        visible: false,
      })
      wms.set('wtlNetworkWms', true)
      wms.set('wtlNetworkMapSource', src.id)
      map.addLayer(wms)
      bySource.set(src.id, wms)
    }
    wmsBySourceRef.current = bySource

    const publishExtent = () => {
      const size = map.getSize()
      const extent = size ? map.getView().calculateExtent(size) : null
      if (!extent || extent.length < 4) {
        onExtentRef.current(null)
        return
      }
      onExtentRef.current([extent[0], extent[1], extent[2], extent[3]])
    }

    const moveStartKey = map.on('movestart', () => {
      onMoveStartRef.current?.()
    })
    const moveKey = map.on('moveend', publishExtent)
    publishExtent()

    const clickKey = map.on('singleclick', async (evt: MapBrowserEvent<PointerEvent>) => {
      if (drawBlocksClickRef.current) return
      const keys = [...keysRef.current]
      const sources = [...sourcesRef.current]
      if (keys.length === 0 || sources.length === 0) return
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkAtPoint',
          params: {
            x: evt.coordinate[0],
            y: evt.coordinate[1],
            layerKeys: keys,
            mapSources: sources,
            tolerance: 12,
          },
        })
        const row = (res?.data ?? res)?.row as WtlNetworkRow | null | undefined
        if (row) onSelectRef.current(row)
      } catch {
        /* ignore */
      }
    })

    return () => {
      unByKey(moveStartKey)
      unByKey(moveKey)
      unByKey(clickKey)
      for (const layer of bySource.values()) map.removeLayer(layer)
      wmsBySourceRef.current = new Map()
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady, availableKey, availableSourceIds])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const source = new VectorSource()
    highlightSourceRef.current = source
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    })
    layer.set('wtlNetworkHighlight', true)
    insertLayerBelowServiceLayer(map, layer)
    return () => {
      map.removeLayer(layer)
      highlightSourceRef.current = null
      setRadarActive(false)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    if (!radarActive) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      highlightSourceRef.current?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [radarActive])

  // 출처(상수/대진) 관망 WMS는 쓰지 않음 — 지하시설물 패널만 표시(이중 등록 방지)
  useEffect(() => {
    for (const layer of wmsBySourceRef.current.values()) {
      const source = layer.getSource()
      layer.setVisible(false)
      source?.updateParams({ LAYERS: '', CQL_FILTER: undefined })
    }
  }, [availableKey, availableSourceIds, mapContext?.mapReady])

  const enabledKeysSig = [...enabledLayerKeys].sort().join('\u0001')
  const mapSourcesSig = [...mapSources].sort().join('\u0001')
  const searchFilterSig = JSON.stringify(searchFilter ?? null)
  const layersBySourceSig = layersBySource ? JSON.stringify(layersBySource) : ''

  /** 급수구역 — 관망조회 전용 WMS (지하시설물 목록에 넣지 않음) */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    const wantedTables = new Set<string>()
    for (const key of enabledLayerKeys) {
      if (!isWtlNetZoneLayerKey(key)) continue
      const table = String(getWtlNetLayerDef(key)?.table ?? '').trim().toLowerCase()
      if (table) wantedTables.add(table)
    }

    const byTable = zoneWmsByTableRef.current
    for (const table of wantedTables) {
      if (byTable.has(table)) continue
      const wms = new ImageLayer({
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: `${WORKSPACE}:${table}`,
            STYLES: table,
            TRANSPARENT: true,
            FORMAT: 'image/png',
          },
          serverType: 'geoserver',
          ratio: 1.5,
          imageLoadFunction: geoserverWmsImageLoadFunction,
        }),
        visible: true,
      })
      wms.set('wtlNetworkZoneWms', true)
      wms.set('layerTableName', table)
      markLayerGeomStack(wms, stackKindFromDefineShpType(table))
      map.addLayer(wms)
      byTable.set(table, wms)
    }

    for (const [table, layer] of [...byTable.entries()]) {
      if (wantedTables.has(table)) {
        if (!map.getLayers().getArray().includes(layer)) {
          map.addLayer(layer)
        }
        layer.setVisible(true)
        const def = matchWtlNetLayerDefForTable(table, enabledLayerKeys)
        const search = def ? buildWtlNetSearchCql(def, searchFilter) : 'INCLUDE'
        applyCqlToImageWms(layer, search === 'INCLUDE' ? undefined : search)
        layer.getSource()?.changed()
      } else {
        map.removeLayer(layer)
        byTable.delete(table)
      }
    }

    return () => {
      /* 키 변경 시 위에서 정리. 언마운트는 mapReady effect 정리에서 처리 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명 문자열로 안정화
  }, [enabledKeysSig, searchFilterSig, mapContext?.mapReady])

  // 관망조회 언마운트 시 급수구역 WMS 제거
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    return () => {
      if (!map) return
      for (const layer of zoneWmsByTableRef.current.values()) {
        map.removeLayer(layer)
      }
      zoneWmsByTableRef.current = new Map()
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  const detailRelatedTable = String(detailRelatedLayer?.table ?? '')
    .trim()
    .toLowerCase()
  const detailRelatedFtr = String(detailRelatedLayer?.ftrIdn ?? '').trim()
  const detailRelatedSig = detailRelatedTable && detailRelatedFtr
    ? `${detailRelatedTable}\0${detailRelatedFtr}`
    : ''

  /** 시설 상세 연관 탭 — 부모 ftr_idn CQL 전용 WMS */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const clearDetailRelated = () => {
      const prev = detailRelatedWmsRef.current
      if (prev) {
        map.removeLayer(prev)
        detailRelatedWmsRef.current = null
      }
    }

    if (!detailRelatedSig) {
      clearDetailRelated()
      return
    }

    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    const cql = buildFtrIdnCql(detailRelatedFtr)
    let layer = detailRelatedWmsRef.current
    const sameTable =
      layer != null &&
      String(layer.get('layerTableName') ?? '')
        .trim()
        .toLowerCase() === detailRelatedTable

    if (!sameTable) {
      clearDetailRelated()
      layer = new ImageLayer({
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: `${WORKSPACE}:${detailRelatedTable}`,
            STYLES: detailRelatedTable,
            TRANSPARENT: true,
            FORMAT: 'image/png',
            CQL_FILTER: cql,
          },
          serverType: 'geoserver',
          ratio: 1.5,
          imageLoadFunction: geoserverWmsImageLoadFunction,
        }),
        visible: true,
        zIndex: 45,
      })
      layer.set('wtlNetworkDetailRelatedWms', true)
      layer.set('layerTableName', detailRelatedTable)
      markLayerGeomStack(layer, stackKindFromDefineShpType(detailRelatedTable))
      map.addLayer(layer)
      detailRelatedWmsRef.current = layer
    } else if (layer) {
      applyCqlToImageWms(layer, cql)
      layer.setVisible(true)
      if (!map.getLayers().getArray().includes(layer)) {
        map.addLayer(layer)
      }
      layer.getSource()?.changed()
    }

    return () => {
      /* 시그니처 변경·언마운트 시 아래 cleanup에서 제거 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명 문자열로 안정화
  }, [detailRelatedSig, mapContext?.mapReady])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    return () => {
      const layer = detailRelatedWmsRef.current
      if (!map || !layer) return
      map.removeLayer(layer)
      detailRelatedWmsRef.current = null
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  /**
   * 지하시설물 WMS에 검색 CQL 적용.
   * 분할 레이어는 layerCqlFilter(div_query)와 AND.
   * Set/객체 deps 대신 서명 문자열로 무한 갱신 방지.
   */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const activeKeys = new Set<string>()
    if (layersBySource) {
      for (const sid of mapSources) {
        for (const k of layersBySource[sid] ?? []) activeKeys.add(k)
      }
    } else {
      for (const k of enabledLayerKeys) activeKeys.add(k)
    }

    const touched: ImageLayer<ImageWMS>[] = []
    for (const raw of map.getLayers().getArray()) {
      if (!raw.get('undergroundFacilityLayer')) continue
      const layer = raw as ImageLayer<ImageWMS>
      const tableName = String(layer.get('layerTableName') ?? '').trim()
      if (!tableName) continue
      const baseCql = String(layer.get('layerCqlFilter') ?? '').trim() || undefined
      const def = matchWtlNetLayerDefForTable(tableName, activeKeys)
      if (!def) continue
      const search = buildWtlNetSearchCql(def, searchFilter)
      const nextCql = combineLayerCql(baseCql, search === 'INCLUDE' ? undefined : search)
      applyCqlToImageWms(layer, nextCql)
      touched.push(layer)
    }

    return () => {
      for (const layer of touched) {
        const baseCql = String(layer.get('layerCqlFilter') ?? '').trim() || undefined
        applyCqlToImageWms(layer, baseCql)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명 문자열로 안정화
  }, [
    enabledKeysSig,
    mapSourcesSig,
    searchFilterSig,
    layersBySourceSig,
    mapContext?.mapReady,
  ])

  /** 선택 시 강조만 — 맵 이동(fit)하지 않음. 상세 모달은 Shell pickRow와 동일 */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = highlightSourceRef.current
    if (!map || !source) return
    source.clear()
    const features = selectionFeatures(map, selected?.geom)
    if (features.length === 0) {
      setRadarActive(false)
      return
    }
    source.addFeatures(features)
    setRadarActive(true)
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
