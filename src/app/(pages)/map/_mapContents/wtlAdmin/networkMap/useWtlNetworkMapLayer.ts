'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import type { Map as OLMap } from 'ol'
import { unByKey } from 'ol/Observable'
import ImageLayer from 'ol/layer/Image'
import ImageWMS from 'ol/source/ImageWMS'
import tablesJson from '@/config/defineLayer/tables.json'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { call } from '@/lib/api'
import {
  clearMapLayerClickDetailHighlight,
  setMapLayerClickDetailHighlight,
} from '@/lib/mapLayerClickDetailHighlight'
import {
  isPointSymbolLayerName,
  markLayerGeomStack,
  type LayerStackKind,
} from '@/lib/mapLayerGeometryOrder'
import '../../../_mapComponents/config/projections'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  buildWtlNetSearchCql,
  matchWtlNetLayerDefForTable,
  type WtlNetWmsSearchFilter,
} from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSources,
  type WtlNetMapSourceId,
} from './wtlNetworkMapSources'
import type { WtlNetworkRow } from './wtlNetworkTypes'

/**
 * 좌·우 패널(view.padding)에 가려진 픽셀을 뺀 지도 범위.
 * calculateExtent(map size)는 캔버스 전체라 패널 뒤·화면 밖 시설까지 포함한다.
 */
function extentOfVisibleMap(map: OLMap): [number, number, number, number] | null {
  const size = map.getSize()
  if (!size || size.length < 2) return null
  const padding = map.getView().padding ?? [0, 0, 0, 0]
  const top = Math.max(0, padding[0] ?? 0)
  const right = Math.max(0, padding[1] ?? 0)
  const bottom = Math.max(0, padding[2] ?? 0)
  const left = Math.max(0, padding[3] ?? 0)
  const x2 = size[0] - right
  const y2 = size[1] - bottom
  if (x2 - left < 8 || y2 - top < 8) return null
  const sw = map.getCoordinateFromPixel([left, y2])
  const ne = map.getCoordinateFromPixel([x2, top])
  if (!sw || !ne) return null
  const minX = Math.min(sw[0], ne[0])
  const minY = Math.min(sw[1], ne[1])
  const maxX = Math.max(sw[0], ne[0])
  const maxY = Math.max(sw[1], ne[1])
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null
  return [minX, minY, maxX, maxY]
}

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
  /** hits: 클릭 지점 다중 피처(점→선→면 정렬). 목록 선택은 hits 없이 호출 */
  onSelect: (
    row: WtlNetworkRow,
    hits?: WtlNetworkRow[],
    screenAnchor?: { top: number; left: number } | null
  ) => void
  onExtentChange: (bbox3857: [number, number, number, number] | null) => void
  /** 화면 내 조회 시 이동 중 진행 중 요청 취소용 */
  onMapMoveStart?: () => void
  /** 검색 조건 → WMS CQL */
  searchFilter?: WtlNetWmsSearchFilter | null
  /** 시설 상세 연관 탭 — 전용 WMS (지하시설물과 분리) */
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
  /** 상세 연관(펌프·흡수정 등) 전용 WMS */
  const detailRelatedWmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const onSelectRef = useRef(onSelect)
  const onExtentRef = useRef(onExtentChange)
  const onMoveStartRef = useRef(onMapMoveStart)
  const keysRef = useRef(enabledLayerKeys)
  const sourcesRef = useRef(mapSources)
  const searchFilterRef = useRef(searchFilter)
  /** 측정·공간그리기·도형편집 등 지도 입력 중에는 레이어 클릭 선택 금지 */
  const drawBlocksClickRef = useRef(false)
  const suppressIdentifyUntilRef = useRef(mapContext?.suppressMapIdentifyUntilRef)
  suppressIdentifyUntilRef.current = mapContext?.suppressMapIdentifyUntilRef
  onSelectRef.current = onSelect
  onExtentRef.current = onExtentChange
  onMoveStartRef.current = onMapMoveStart
  keysRef.current = enabledLayerKeys
  sourcesRef.current = mapSources
  searchFilterRef.current = searchFilter
  drawBlocksClickRef.current = Boolean(
    mapContext?.spatialDrawRequest ||
      mapContext?.mapMeasureTool ||
      mapContext?.mapDrawInputSuspended ||
      mapContext?.layerRowGeomEdit
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
      onExtentRef.current(extentOfVisibleMap(map))
    }

    const moveStartKey = map.on('movestart', () => {
      onMoveStartRef.current?.()
    })
    const moveKey = map.on('moveend', publishExtent)
    publishExtent()

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (drawBlocksClickRef.current) return
      const suppressUntil = suppressIdentifyUntilRef.current?.current ?? 0
      if (suppressUntil > Date.now()) return
      const keys = [...keysRef.current]
      const sources = [...sourcesRef.current]
      if (keys.length === 0 || sources.length === 0) return
      const f = searchFilterRef.current
      void (async () => {
        try {
          const res = await call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkAtPoint',
            params: {
              x: evt.coordinate[0],
              y: evt.coordinate[1],
              layerKeys: keys,
              mapSources: sources,
              /** 클릭 버퍼(m, 3857). 작을수록 여백 좁음 */
              tolerance: 5,
              keyword: f?.keyword,
              yearFrom: f?.yearFrom,
              yearTo: f?.yearTo,
              diameterFrom: f?.diameterFrom,
              diameterTo: f?.diameterTo,
              materials: f?.materials ? [...f.materials] : undefined,
            },
          })
          const data = (res?.data ?? res) as
            | { row?: WtlNetworkRow | null; rows?: WtlNetworkRow[] }
            | undefined
          const rows = Array.isArray(data?.rows)
            ? data.rows.filter(Boolean)
            : data?.row
              ? [data.row]
              : []
          const row = rows[0] ?? data?.row ?? null
          if (row) {
            const oe = evt.originalEvent
            const screenAnchor =
              oe && 'clientX' in oe && 'clientY' in oe
                ? {
                    left: Math.round((oe as PointerEvent).clientX),
                    top: Math.round((oe as PointerEvent).clientY),
                  }
                : null
            onSelectRef.current(row, rows, screenAnchor)
          }
        } catch {
          /* ignore */
        }
      })()
    }
    const clickKey = map.on('singleclick', onClick as never)

    return () => {
      unByKey(moveStartKey)
      unByKey(moveKey)
      unByKey(clickKey)
      for (const layer of bySource.values()) map.removeLayer(layer)
      wmsBySourceRef.current = new Map()
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady, availableKey, availableSourceIds])

  /** 패널 너비가 바뀌면 moveend 없이 보이는 범위가 달라진다 */
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const publish = () => {
      onExtentRef.current(extentOfVisibleMap(map))
    }
    publish()
    const key = map.once('postrender', publish)
    return () => {
      unByKey(key)
    }
  }, [mapPaddingLeft, mapContext?.mapInstanceRef, mapContext?.mapReady])

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

  /** 선택 시 강조만 — 공통 선택자 레이어. 맵 이동(fit)하지 않음 */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const geom = selected?.geom ?? null
    if (geom == null) {
      clearMapLayerClickDetailHighlight(map, 'wtlNetwork')
      return
    }
    setMapLayerClickDetailHighlight(map, 'wtlNetwork', geom)
    return () => {
      clearMapLayerClickDetailHighlight(map, 'wtlNetwork')
    }
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
