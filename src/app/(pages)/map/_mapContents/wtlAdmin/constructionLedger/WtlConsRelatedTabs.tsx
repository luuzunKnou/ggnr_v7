'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Map as OLMap } from 'ol'
import type { Extent } from 'ol/extent'
import OlGeoJSON from 'ol/format/GeoJSON'
import WKT from 'ol/format/WKT'
import { call } from '@/lib/api'
import type { ConsLedgerKind } from '@/lib/consLedgerVariant'
import { ownGbnLabel } from '@/lib/privateLandAnalysisLayers'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { getRowValueByField } from '../../../_mapComponents/standard/defineLayerRowUtils'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'
import { getParcelExtent3857 } from '../../../_mapComponents/layerRowEdit/layerRowParcelUtils'
import { useLayerRowParcelHighlight } from '../../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight'
import type { LayerRowParcelItem } from '../../../_mapComponents/layerRowEdit/types'
import { WtlConsParcelListVariants } from './WtlConsParcelListVariants'
import { useWtlConsParcelOwnGbnLayer } from './useWtlConsParcelOwnGbnLayer'
import { getWtlNetLayerDef, WTL_NET_LAYER_DEFS, WTL_NET_ZONE_LAYER_KEYS } from '../networkMap/wtlNetworkLayerCatalog'
import { wtlNetKorNameForTable } from '../networkMap/wtlNetworkMapSources'
import type { WtlNetworkRow } from '../networkMap/wtlNetworkTypes'
import { wkt5181ToRing4326 } from '../spatialAnalysis/outage/wtlOutageGeom'
import { geom4326ToWkt5181, loadWtlConsIntersecting, type WtlConsGeom4326 } from './wtlConsLedgerApi'
import { shortYearDate, workAmountLabel, type WtlConsWork } from './wtlConsSample'
import {
  extentTouchesView,
  type WtlConsMapFocus,
  type WtlConsRelatedFacility,
} from './useWtlConsMapLayer'

export type ZoneMock = {
  id: string
  location: string
  note: string
  geomWkt5181: string | null
}

export type RelatedTab =
  | 'zone'
  | 'facility'
  | 'parcel'
  | 'building'
  | 'customer'
  | 'cons'

type ParcelRow = {
  address: string
  pnu: string
  jimok?: string
  /** 소유구분(개인·국유지 등) — 사유지분석 목록과 동일 */
  ownGbn?: string
  areaSqm?: number
  geometry3857?: Record<string, unknown> | null
}

type BuildingRow = {
  id: string
  kind?: 'building' | 'buildingGroup'
  pnu?: string
  bldNm: string
  jimok: string
  addr: string
  jibun: string
  platLoc: string
  geometry3857?: Record<string, unknown> | null
}

type CustomerRow = {
  id: string
  name: string
  address: string
  meterNo: string
  point?: [number, number] | null
}

type ConsRow = {
  id: string
  name: string
  location: string
  doneDate: string
  amount: string
  geom?: GeoJSON.Geometry | null
}

/** 관망조회 시설. 급수전계량기·업데이트 내역·급수구역·분구·블록은 제외 */
const FACILITY_LAYER_SKIP = new Set<string>([
  'wtl_meta_ps',
  'wtl_task_as',
  ...WTL_NET_ZONE_LAYER_KEYS,
])
const FACILITY_LAYER_KEYS = WTL_NET_LAYER_DEFS.filter(
  (d) => d.table && !FACILITY_LAYER_SKIP.has(d.key)
).map((d) => d.key)

function facilityStyleCode(row: WtlNetworkRow): string | null {
  const record = row.record
  if (!record || typeof record !== 'object') return null
  const raw =
    getRowValueByField(record, 'ftr_cde') ??
    record.ftr_cde ??
    record.FTR_CDE ??
    null
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
  return code || null
}

function facilitiesToMapItems(rows: WtlNetworkRow[]): WtlConsRelatedFacility[] {
  const items: WtlConsRelatedFacility[] = []
  for (const row of rows) {
    const geom = row.geom
    if (!geom || typeof geom !== 'object' || !('type' in geom)) continue
    const styleName = String(row.layerKey ?? '').trim()
    if (!styleName) continue
    items.push({
      id: row.id,
      geom: geom as unknown as Record<string, unknown>,
      projection: 'EPSG:4326',
      /** GeoServer 스타일명 — 관로 분할키(wtl_pipe_lm_saa003 등)와 동일 */
      styleName,
      styleCode: facilityStyleCode(row),
    })
  }
  return items
}

/** 구분 칸은 테이블 키가 아니라 레이어 한글명 */
function facilityKindLabel(layerKey: string): string {
  return wtlNetKorNameForTable(layerKey) || layerKey
}

/** 이름 칸에 실제로 들어온 필드의 한글명. 관라벨 → 관리번호 → 행번호 순 */
const NAME_FIELD_LABEL: Record<string, string> = {
  pip_lbl: '관라벨',
  ftr_idn: '관리번호',
  ogc_fid: '행번호',
  gai_nam: '취수장명',
  pur_nam: '정수장명',
  srv_nam: '배수지명',
  prs_nam: '가압장명',
  met_num: '계량기기물번호',
  hom_num: '수용가번호',
}

const NAME_TITLE_ORDER = [
  '관라벨',
  '관리번호',
  '행번호',
  '취수장명',
  '정수장명',
  '배수지명',
  '가압장명',
  '계량기기물번호',
  '수용가번호',
]

function nameFieldsInOrder(layerKey: string): string[] {
  const expr =
    getWtlNetLayerDef(layerKey)?.nameExpr ??
    `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`
  const skip = new Set(['coalesce', 'nullif', 'trim', 'text'])
  const fields: string[] = []
  for (const match of expr.matchAll(/\b([a-z][a-z0-9_]*)\b/gi)) {
    const field = match[1].toLowerCase()
    if (skip.has(field) || fields.includes(field)) continue
    fields.push(field)
  }
  if (!fields.includes('ogc_fid')) fields.push('ogc_fid')
  return fields
}

function facilityNameTitle(row: WtlNetworkRow): string {
  const record = row.record ?? null
  for (const field of nameFieldsInOrder(row.layerKey)) {
    if (field === 'ogc_fid') return '행번호'
    const text = String(record ? (getRowValueByField(record, field) ?? '') : '').trim()
    if (text) return NAME_FIELD_LABEL[field] ?? '관리번호'
  }
  return '행번호'
}

function facilityNameHead(rows: WtlNetworkRow[]): string {
  const labels = [...new Set(rows.map(facilityNameTitle))]
  if (labels.length === 0) return '관리번호'
  if (labels.length === 1) return labels[0]!
  const ordered = NAME_TITLE_ORDER.filter((label) => labels.includes(label))
  const rest = labels.filter((label) => !ordered.includes(label))
  return [...ordered, ...rest].join(' · ')
}

const TABS: { id: RelatedTab; label: string }[] = [
  { id: 'zone', label: '공사위치' },
  { id: 'facility', label: '관련시설' },
  { id: 'parcel', label: '필지목록' },
  { id: 'building', label: '관련건물' },
  { id: 'customer', label: '수용가' },
  { id: 'cons', label: '공사이력' },
]

const geoJsonFormat = new OlGeoJSON()
const wktFormat = new WKT()

/**
 * 좌·우 패널(view.padding)에 가려진 픽셀을 뺀 지도 범위.
 * 관망조회 «화면에 보이는 시설만»과 동일.
 */
function extentOfVisibleMap(map: OLMap): Extent | null {
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

function geomIntersectsView(
  geom: Record<string, unknown> | GeoJSON.Geometry | null | undefined,
  dataProjection: string,
  viewExtent: Extent | null
): boolean {
  if (!viewExtent || !geom || typeof geom !== 'object' || !('type' in geom)) return false
  try {
    const geometry = geoJsonFormat.readGeometry(geom, {
      dataProjection,
      featureProjection: 'EPSG:3857',
    })
    // bbox끼리 비교하면 멀리 있는 큰 도형도 걸려 오탐 — 실제 교차만
    return geometry.intersectsExtent(viewExtent)
  } catch {
    return false
  }
}

function wkt5181IntersectsView(wkt: string | null | undefined, viewExtent: Extent | null): boolean {
  if (!viewExtent || !wkt?.trim()) return false
  try {
    const geometry = wktFormat.readGeometry(wkt, {
      dataProjection: 'EPSG:5181',
      featureProjection: 'EPSG:3857',
    })
    return geometry.intersectsExtent(viewExtent)
  } catch {
    return false
  }
}

/** 여러 공사위치 WKT(5181)를 한 검색 범위로 */
function collectWkt5181(wkts: Array<string | null | undefined>): string | null {
  const list = wkts.map((w) => String(w ?? '').trim()).filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]!
  return `GEOMETRYCOLLECTION(${list.join(',')})`
}

type Tone = {
  tabWrap: string
  tabOn: string
  tabOff: string
  count: string
  body: string
  card: string
  head: string
  headPad: string
  row: string
  rowOn: string
  rowOff: string
  cell: string
  empty: string
}

const TONE_V0: Tone = {
  tabWrap: 'grid shrink-0 grid-cols-3 border-b border-border',
  tabOn: 'h-8 border-b-2 border-primary bg-primary/5 px-1 text-[11px] -mb-px font-semibold text-primary',
  tabOff: 'h-8 border-b-2 border-transparent px-1 text-[11px] -mb-px text-muted-foreground hover:bg-muted/40 hover:text-foreground',
  count: 'ml-0.5 text-[10px]',
  body: 'min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5',
  card: 'overflow-hidden rounded border border-slate-200',
  head: 'flex border-b border-slate-200 bg-slate-50 text-xs font-semibold text-foreground',
  headPad: 'px-2 py-1.5',
  row: 'flex w-full items-center border-b border-slate-100 text-left text-xs last:border-b-0',
  rowOn: 'bg-blue-50 text-blue-900',
  rowOff: 'text-foreground hover:bg-slate-50',
  cell: 'px-2 py-1.5',
  empty: 'py-8 text-center text-xs text-slate-400',
}

type Props = {
  zones: ZoneMock[]
  zoneId: string | null
  onSelectZone: (id: string) => void
  onFocus?: (focus: WtlConsMapFocus | null) => void
  /** 관련시설 도형 → 공사대장 전용 벡터(지하시설물 패널과 무관) */
  onRelatedFacilities?: (items: WtlConsRelatedFacility[]) => void
  /** «화면에 보이는 시설만» — 부모 지도 맞춤(맵무브) 억제용 */
  onOnlyInViewChange?: (onlyInView: boolean) => void
  /** 선택한 공사의 본표 도형. 필지·공사대장 겹침은 이 도형 기준 */
  workGeom4326?: WtlConsGeom4326 | null
  kind?: Extract<ConsLedgerKind, 'wtl' | 'swl'>
  consCode?: string | null
  activeZone: ZoneMock | null
  zoneLoading?: boolean
}

export function WtlConsRelatedTabs({
  zones,
  zoneId,
  onSelectZone,
  onFocus,
  onRelatedFacilities,
  onOnlyInViewChange,
  workGeom4326 = null,
  kind = 'wtl',
  consCode = null,
  activeZone,
  zoneLoading = false,
}: Props) {
  const tone = TONE_V0
  const mapContext = useMapContext()
  const [tab, setTab] = useState<RelatedTab>('zone')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [parcelIdx, setParcelIdx] = useState<number | null>(null)
  const [highlightParcel, setHighlightParcel] = useState<LayerRowParcelItem | null>(null)
  const [facilities, setFacilities] = useState<WtlNetworkRow[]>([])
  const [parcels, setParcels] = useState<ParcelRow[]>([])
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [consRows, setConsRows] = useState<ConsRow[]>([])
  /** 관망조회와 동일 — 탭 공통 «화면에 보이는 것만» */
  const [onlyInView, setOnlyInView] = useState(true)
  const [viewExtent, setViewExtent] = useState<Extent | null>(null)

  useEffect(() => {
    onOnlyInViewChange?.(onlyInView)
  }, [onlyInView, onOnlyInViewChange])

  const zoneWkt = activeZone?.geomWkt5181?.trim() || null
  const workWkt = useMemo(() => geom4326ToWkt5181(workGeom4326), [workGeom4326])
  /** 필지·건물은 공사 도형 기준. 없으면 선택한 공사위치로 넘긴다 */
  const parcelWkt = workWkt || zoneWkt

  /**
   * 공사이력 검색 범위 = 지금 지도 화면과 겹치는 공사위치(구역)만.
   * 공사 본표 전체를 쓰면 멀리 있는 대장까지 걸려 «촐괄…» 같은 오탐이 난다.
   */
  const consHistoryWkt = useMemo(() => {
    const inView = viewExtent
      ? zones.filter((z) => wkt5181IntersectsView(z.geomWkt5181, viewExtent))
      : []
    return collectWkt5181(inView.map((z) => z.geomWkt5181))
  }, [zones, viewExtent])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const refresh = () => setViewExtent(extentOfVisibleMap(map))
    refresh()
    map.on('moveend', refresh)
    map.getView().on('change:padding', refresh)
    return () => {
      map.un('moveend', refresh)
      map.getView().un('change:padding', refresh)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  const visibleZones = useMemo(() => {
    if (!onlyInView) return zones
    if (!viewExtent) return zones
    return zones.filter((z) => wkt5181IntersectsView(z.geomWkt5181, viewExtent))
  }, [onlyInView, viewExtent, zones])

  const visibleFacilities = useMemo(() => {
    if (!onlyInView) return facilities
    // 지도 extent 준비 전에는 전체 유지(탭 배지·목록이 0으로 고정되지 않게)
    if (!viewExtent) return facilities
    return facilities.filter((row) => geomIntersectsView(row.geom, 'EPSG:4326', viewExtent))
  }, [facilities, onlyInView, viewExtent])

  const visibleParcels = useMemo(() => {
    if (!onlyInView) return parcels
    if (!viewExtent) return parcels
    return parcels.filter((row) => geomIntersectsView(row.geometry3857, 'EPSG:3857', viewExtent))
  }, [onlyInView, parcels, viewExtent])

  const visibleBuildings = useMemo(() => {
    if (!onlyInView) return buildings
    if (!viewExtent) return buildings
    return buildings.filter((row) => geomIntersectsView(row.geometry3857, 'EPSG:3857', viewExtent))
  }, [buildings, onlyInView, viewExtent])

  const visibleCustomers = useMemo(() => {
    if (!onlyInView) return customers
    if (!viewExtent) return customers
    return customers.filter((row) => {
      if (!row.point) return false
      return geomIntersectsView(
        { type: 'Point', coordinates: row.point },
        'EPSG:4326',
        viewExtent
      )
    })
  }, [customers, onlyInView, viewExtent])

  const visibleConsRows = useMemo(() => {
    if (!onlyInView) return consRows
    if (!viewExtent) return consRows
    return consRows.filter((row) => geomIntersectsView(row.geom, 'EPSG:4326', viewExtent))
  }, [consRows, onlyInView, viewExtent])

  const visibleParcelSelectedIdx = useMemo(() => {
    if (parcelIdx == null) return null
    const target = parcels[parcelIdx]
    if (!target) return null
    const i = visibleParcels.findIndex(
      (row) => row.pnu === target.pnu && row.address === target.address
    )
    return i >= 0 ? i : null
  }, [parcelIdx, parcels, visibleParcels])

  /** 필지 탭은 소유구분 색 레이어 사용. 건물 등만 기존 파란 하이라이트 */
  useLayerRowParcelHighlight(tab === 'parcel' ? null : highlightParcel, 'blue')
  useWtlConsParcelOwnGbnLayer({
    active: tab === 'parcel',
    parcels: visibleParcels,
    selectedIdx: visibleParcelSelectedIdx,
  })

  /** 관련시설 탭일 때만 지도에 그림. 다른 탭·탭 진입 전에는 그리지 않음 */
  useEffect(() => {
    if (tab !== 'facility') {
      onRelatedFacilities?.([])
      return
    }
    onRelatedFacilities?.(facilitiesToMapItems(visibleFacilities))
  }, [visibleFacilities, onRelatedFacilities, tab])

  useEffect(() => {
    return () => onRelatedFacilities?.([])
  }, [onRelatedFacilities])

  useEffect(() => {
    if (!parcelWkt) {
      setParcels([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'layerRowService',
          action: 'listJijukParcelsByGeomWkt5181',
          params: { wkt5181: parcelWkt, limit: 500, clipToSearchGeom: true },
        })
        const body = (res?.data ?? res) as { parcels?: ParcelRow[]; error?: string }
        const baseParcels = (Array.isArray(body?.parcels) ? body.parcels : []).map((row) => ({
          address: row.address,
          pnu: row.pnu,
          jimok: row.jimok,
          areaSqm: row.areaSqm,
          geometry3857: row.geometry3857 ?? null,
        }))
        // 사유지분석과 동일 — PNU로 소유구분(own_gbn) 보강
        let byPnu: Record<string, string> = {}
        const pnus = baseParcels.map((row) => row.pnu).filter(Boolean)
        if (pnus.length > 0) {
          try {
            const ownRes = await call('', 'POST', {
              service: 'riverBasicPlanService',
              action: 'getJijukOwnGbnByPnus',
              params: { pnus },
            })
            const ownBody = (ownRes?.data ?? ownRes) as { byPnu?: Record<string, string> }
            byPnu = ownBody?.byPnu && typeof ownBody.byPnu === 'object' ? ownBody.byPnu : {}
          } catch {
            byPnu = {}
          }
        }
        const nextParcels = baseParcels.map((row) => ({
          ...row,
          ownGbn: ownGbnLabel(byPnu[row.pnu] || '미상'),
        }))
        if (!cancelled) setParcels(nextParcels)
      } catch {
        if (!cancelled) setParcels([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parcelWkt])

  /** 관련시설: 공사·범위가 있으면 탭 열기 전에 조회(카운트용). 지도 표시는 탭 ON일 때만 */
  useEffect(() => {
    setFacilities([])
    onRelatedFacilities?.([])
    if (!parcelWkt) return
    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkList',
          params: {
            areaWkts5181: [parcelWkt],
            layerKeys: FACILITY_LAYER_KEYS,
            withGeom: true,
            limit: 600,
          },
        })
        if (cancelled) return
        const body = (res?.data ?? res) as { rows?: WtlNetworkRow[] }
        setFacilities(Array.isArray(body?.rows) ? body.rows : [])
      } catch {
        if (!cancelled) setFacilities([])
      }
    })()
    return () => {
      cancelled = true
    }
    // onRelatedFacilities는 setState라 안정. deps에 넣으면 콜백 교체 시 목록이 비워질 수 있음
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parcelWkt만
  }, [parcelWkt])

  useEffect(() => {
    if (!parcelWkt) {
      setCustomers([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const ring = wkt5181ToRing4326(parcelWkt)
        if (ring.length < 3) {
          if (!cancelled) setCustomers([])
          return
        }
        const res = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'refreshWtlOutageZone',
          params: { ring },
        })
        if (cancelled) return
        const body = (res?.data ?? res) as { customers?: CustomerRow[] }
        setCustomers(
          (Array.isArray(body?.customers) ? body.customers : []).map((row) => ({
            id: row.id,
            name: row.name,
            address: row.address,
            meterNo: row.meterNo,
            point: row.point ?? null,
          }))
        )
      } catch {
        if (!cancelled) setCustomers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parcelWkt])

  useEffect(() => {
    const code = consCode?.trim() || ''
    if (!consHistoryWkt || !code) {
      setConsRows([])
      return
    }
    let cancelled = false
    void loadWtlConsIntersecting(kind, code, consHistoryWkt).then((result) => {
      if (cancelled) return
      // 화면 안 공사구역과 겹치는 다른 공사대장만
      setConsRows(
        result.rows
          .filter((row) => row.geom4326 && typeof row.geom4326 === 'object' && 'type' in row.geom4326)
          .map((row) => ({
            id: row.consCode,
            name: row.consName || row.consCode,
            location: row.consLocat || '—',
            doneDate: shortYearDate(row.doneDate || row.sdoneDate),
            amount: workAmountLabel({ amountAft: row.amountAft, amountPre: row.amountPre } as WtlConsWork),
            geom: row.geom4326,
          }))
      )
    })
    return () => {
      cancelled = true
    }
  }, [consHistoryWkt, kind, consCode])

  useEffect(() => {
    if (!parcelWkt) {
      setBuildings([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'listBuildingsIntersectingWkt5181',
          params: { wkt5181: parcelWkt },
        })
        const body = (res?.data ?? res) as {
          buildings?: Array<{
            key?: string
            kind?: 'building' | 'buildingGroup'
            name?: string
            address?: string
            pnu?: string
            jimok?: string
            geometry3857?: Record<string, unknown> | null
          }>
        }
        if (cancelled) return
        setBuildings(
          (Array.isArray(body?.buildings) ? body.buildings : []).map((row, index) => ({
            id: String(row.key ?? '').trim() || `building-${index}`,
            kind: row.kind,
            pnu: row.pnu,
            bldNm: String(row.name ?? '').trim() || (row.kind === 'buildingGroup' ? '건물군' : '건물'),
            jimok: String(row.jimok ?? '').trim(),
            addr: String(row.address ?? '').trim(),
            jibun: '',
            platLoc: '',
            geometry3857: row.geometry3857 ?? null,
          }))
        )
      } catch {
        if (!cancelled) setBuildings([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parcelWkt])

  /**
   * 탭 배지 = 공사 범위 조회 전체 건수(화면만 필터와 무관).
   * 목록·지도만 «화면에 보이는 것만»으로 걸러서, 탭을 안 눌러도 건수가 보이게 한다.
   */
  const counts = useMemo(
    () => ({
      zone: zones.length,
      facility: facilities.length,
      parcel: parcels.length,
      building: buildings.length,
      customer: customers.length,
      cons: consRows.length,
    }),
    [
      zones.length,
      facilities.length,
      parcels.length,
      buildings.length,
      customers.length,
      consRows.length,
    ]
  )

  const parcelItems = useMemo<LayerRowParcelItem[]>(
    () =>
      visibleParcels.map((row) => ({
        address: row.address || row.pnu || '—',
        pnu: row.pnu || undefined,
        geometry3857: row.geometry3857 ?? null,
        extent3857: null,
        showMapGeom: true,
      })),
    [visibleParcels]
  )

  const changeTab = (next: RelatedTab) => {
    if (next === tab) return
    setPickedId(null)
    setParcelIdx(null)
    setHighlightParcel(null)
    onFocus?.(null)
    setTab(next)
  }

  const panToParcel = (item: LayerRowParcelItem) => {
    // 화면만 ON + 이미 겹침 → 맵무브·줌 없음(목록 moveend 갱신 방지). 밖·전체만 맞춤.
    const map = mapContext?.mapInstanceRef?.current
    const extent = getParcelExtent3857(item)
    if (!map || !extent) return
    if (onlyInView && extentTouchesView(map, extent)) return
    const applyPadding = () => mapContext?.applyMapViewPaddingRef?.current?.()
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: applyPadding,
    })
  }

  const handleParcelClick = (item: LayerRowParcelItem, visibleIdx: number) => {
    onFocus?.(null)
    const visible = visibleParcels[visibleIdx]
    const resolvedIdx = visible
      ? parcels.findIndex((row) => row.pnu === visible.pnu && row.address === visible.address)
      : -1
    if (resolvedIdx < 0) return
    if (parcelIdx === resolvedIdx) {
      setParcelIdx(null)
      setHighlightParcel(null)
      return
    }
    setParcelIdx(resolvedIdx)
    setPickedId(null)
    setHighlightParcel(item)
    panToParcel(item)
  }

  const handleBuildingClick = (row: BuildingRow, index: number) => {
    const id = buildingRowId(row, index)
    onFocus?.(null)
    if (pickedId === id) {
      setPickedId(null)
      setHighlightParcel(null)
      return
    }
    setPickedId(id)
    setParcelIdx(null)
    const own = row.geometry3857
      ? {
          address: row.addr || row.bldNm || '—',
          pnu: row.pnu || undefined,
          geometry3857: row.geometry3857,
          extent3857: null,
          showMapGeom: true,
        }
      : null
    const parcel = own ? null : parcelForBuilding(row, parcels)
    const item = own ?? (parcel ? parcelToHighlightItem(parcel) : null)
    setHighlightParcel(item)
    if (item) panToParcel(item)
  }

  /** 같은 행을 다시 누르면 선택과 지도 강조를 끈다 */
  const toggleRow = (
    id: string,
    geom: Record<string, unknown> | GeoJSON.Geometry | null | undefined,
    projection: 'EPSG:4326' | 'EPSG:3857',
    style?: { styleName?: string; styleCode?: string | null }
  ) => {
    if (pickedId === id) {
      setPickedId(null)
      onFocus?.(null)
      return
    }
    setPickedId(id)
    if (!geom || typeof geom !== 'object' || !('type' in geom)) {
      onFocus?.(null)
      return
    }
    onFocus?.({
      geom: geom as unknown as Record<string, unknown>,
      projection,
      styleName: style?.styleName,
      styleCode: style?.styleCode,
      // 관련시설·수용가·공사이력: 화면만 ON → 강조만 / 전체(OFF) → 맵무브·줌
      // (실제 억제는 부모 suppressListFit. 체크 변경 직후에도 동일 규칙)
      skipFit: onlyInView,
    })
  }

  useEffect(() => {
    setPickedId(null)
    setParcelIdx(null)
    setHighlightParcel(null)
  }, [zoneId])

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className={tone.tabWrap}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? tone.tabOn : tone.tabOff}
            onClick={() => changeTab(item.id)}
          >
            {item.label}
            <span className={tone.count}>({counts[item.id]})</span>
          </button>
        ))}
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-border px-2 py-1.5 text-[11px] text-foreground">
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={onlyInView}
          onChange={(e) => setOnlyInView(e.target.checked)}
        />
        화면에 보이는 시설만 표시합니다
      </label>
      <div className={cn(tone.body, tab === 'parcel' && 'flex flex-col overflow-hidden')}>
        {tab === 'zone' ? (
          <ZoneTable
            tone={tone}
            zones={visibleZones}
            zoneId={zoneId}
            onSelectZone={onSelectZone}
            loading={zoneLoading}
          />
        ) : tab === 'facility' ? (
          <FacilityTable tone={tone} rows={visibleFacilities} pickedId={pickedId} onToggle={toggleRow} />
        ) : tab === 'parcel' ? (
          <WtlConsParcelListVariants
            parcels={visibleParcels}
            parcelItems={parcelItems}
            selectedIdx={visibleParcelSelectedIdx}
            onClick={handleParcelClick}
          />
        ) : tab === 'building' ? (
          <BuildingTable
            tone={tone}
            rows={visibleBuildings}
            pickedId={pickedId}
            onClick={handleBuildingClick}
          />
        ) : tab === 'customer' ? (
          <CustomerTable tone={tone} rows={visibleCustomers} pickedId={pickedId} onToggle={toggleRow} />
        ) : (
          <ConsTable tone={tone} rows={visibleConsRows} pickedId={pickedId} onToggle={toggleRow} />
        )}
      </div>
    </div>
  )
}

function pnuDigits(value: string | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

function parcelForBuilding(row: BuildingRow, parcels: ParcelRow[]): ParcelRow | null {
  const pnu = pnuDigits(row.pnu)
  if (pnu) {
    const byPnu = parcels.find((parcel) => pnuDigits(parcel.pnu) === pnu && parcel.geometry3857)
    if (byPnu) return byPnu
  }
  const lot = row.jibun?.trim()
  if (!lot || lot === '-') return null
  return (
    parcels.find((parcel) => {
      if (!parcel.geometry3857) return false
      const address = (parcel.address || '').replace(/\s+/g, ' ').trim()
      return address === lot || address.endsWith(` ${lot}`)
    }) ?? null
  )
}

function parcelToHighlightItem(parcel: ParcelRow): LayerRowParcelItem {
  return {
    address: parcel.address || parcel.pnu || '—',
    pnu: parcel.pnu || undefined,
    geometry3857: parcel.geometry3857 ?? null,
    extent3857: null,
    showMapGeom: true,
  }
}

function buildingRowId(row: BuildingRow, index: number) {
  return row.id || `${row.bldNm}-${row.jibun}-${index}`
}

type RowToggle = (
  id: string,
  geom: Record<string, unknown> | GeoJSON.Geometry | null | undefined,
  projection: 'EPSG:4326' | 'EPSG:3857',
  style?: { styleName?: string; styleCode?: string | null }
) => void

function ZoneTable({
  tone,
  zones,
  zoneId,
  onSelectZone,
  loading = false,
}: {
  tone: Tone
  zones: ZoneMock[]
  zoneId: string | null
  onSelectZone: (id: string) => void
  loading?: boolean
}) {
  return (
    <div className={tone.card}>
      <div className={tone.head}>
        <span className={cn('min-w-0 flex-[1.1]', tone.headPad)}>공사위치</span>
        <span className={cn('min-w-0 flex-1', tone.headPad)}>비고</span>
      </div>
      <ul>
        {zones.length === 0 ? (
          <li className={tone.empty}>{loading ? '공사위치를 불러오는 중…' : '공사위치가 없습니다.'}</li>
        ) : null}
        {zones.map((z) => {
          const on = zoneId === z.id
          return (
            <li key={z.id}>
              <button
                type="button"
                onClick={() => onSelectZone(z.id)}
                className={cn(tone.row, on ? tone.rowOn : tone.rowOff)}
              >
                <span className={cn('min-w-0 flex-[1.1] truncate', tone.cell)} title={z.location}>
                  {z.location}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-slate-600', tone.cell)} title={z.note}>
                  {z.note}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function FacilityTable({
  tone,
  rows,
  pickedId,
  onToggle,
}: {
  tone: Tone
  rows: WtlNetworkRow[]
  pickedId: string | null
  onToggle: RowToggle
}) {
  if (rows.length === 0) {
    return <p className={tone.empty}>교차하는 관련시설이 없습니다.</p>
  }
  return (
    <div className={tone.card}>
      <div className={tone.head}>
        <span className={cn('w-[5.5rem] shrink-0', tone.headPad)}>구분</span>
        <span className={cn('min-w-0 flex-1', tone.headPad)}>{facilityNameHead(rows)}</span>
        <span className={cn('w-14 shrink-0', tone.headPad)}>구경</span>
        <span className={cn('w-14 shrink-0', tone.headPad)}>연도</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={cn(tone.row, pickedId === r.id ? tone.rowOn : tone.rowOff)}
              onClick={() =>
                onToggle(r.id, r.geom, 'EPSG:4326', {
                  styleName: String(r.layerKey ?? '').trim(),
                  styleCode: facilityStyleCode(r),
                })
              }
            >
              <span
                className={cn('w-[5.5rem] shrink-0 truncate text-slate-600', tone.cell)}
                title={facilityKindLabel(r.layerKey)}
              >
                {facilityKindLabel(r.layerKey)}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', tone.cell)} title={r.name}>
                {r.name}
              </span>
              <span className={cn('w-14 shrink-0 truncate text-slate-600', tone.cell)}>{r.diameter}</span>
              <span className={cn('w-14 shrink-0 truncate text-slate-600', tone.cell)}>{r.year}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BuildingTable({
  tone,
  rows,
  pickedId,
  onClick,
}: {
  tone: Tone
  rows: BuildingRow[]
  pickedId: string | null
  onClick: (row: BuildingRow, index: number) => void
}) {
  if (rows.length === 0) {
    return <p className={tone.empty}>교차하는 관련건물이 없습니다.</p>
  }
  return (
    <div className={tone.card}>
      <div className={tone.head}>
        <span className={cn('w-20 shrink-0', tone.headPad)}>건물명</span>
        <span className={cn('w-10 shrink-0', tone.headPad)}>지목</span>
        <span className={cn('min-w-0 flex-1', tone.headPad)}>주소</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={buildingRowId(r, i)}>
            <button
              type="button"
              className={cn(tone.row, pickedId === buildingRowId(r, i) ? tone.rowOn : tone.rowOff)}
              onClick={() => onClick(r, i)}
            >
              <span className={cn('w-20 shrink-0 truncate', tone.cell)} title={r.bldNm}>
                {r.bldNm || '—'}
              </span>
              <span className={cn('w-10 shrink-0 truncate text-slate-600', tone.cell)} title={r.jimok || '—'}>
                {r.jimok || '—'}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-slate-600', tone.cell)} title={r.addr || r.platLoc || r.jibun}>
                {r.addr || r.platLoc || r.jibun || '—'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomerTable({
  tone,
  rows,
  pickedId,
  onToggle,
}: {
  tone: Tone
  rows: CustomerRow[]
  pickedId: string | null
  onToggle: RowToggle
}) {
  if (rows.length === 0) {
    return <p className={tone.empty}>교차하는 수용가가 없습니다.</p>
  }
  return (
    <div className={tone.card}>
      <div className={tone.head}>
        <span className={cn('min-w-0 flex-[0.9]', tone.headPad)}>수용가</span>
        <span className={cn('min-w-0 flex-1', tone.headPad)}>주소</span>
        <span className={cn('w-[4.5rem] shrink-0', tone.headPad)}>기물번호</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={cn(tone.row, pickedId === r.id ? tone.rowOn : tone.rowOff)}
              onClick={() => onToggle(r.id, r.point ? { type: 'Point', coordinates: r.point } : null, 'EPSG:4326')}
            >
              <span className={cn('min-w-0 flex-[0.9] truncate', tone.cell)} title={r.name}>
                {r.name}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-slate-600', tone.cell)} title={r.address}>
                {r.address || '—'}
              </span>
              <span className={cn('w-[4.5rem] shrink-0 truncate text-slate-600', tone.cell)}>{r.meterNo || '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConsTable({
  tone,
  rows,
  pickedId,
  onToggle,
}: {
  tone: Tone
  rows: ConsRow[]
  pickedId: string | null
  onToggle: RowToggle
}) {
  if (rows.length === 0) {
    return <p className={tone.empty}>교차하는 공사이력이 없습니다.</p>
  }
  return (
    <div className={tone.card}>
      <div className={tone.head}>
        <span className={cn('min-w-0 flex-1', tone.headPad)}>공사명</span>
        <span className={cn('w-[4.5rem] shrink-0', tone.headPad)}>준공</span>
        <span className={cn('w-[5.5rem] shrink-0 text-right', tone.headPad)}>금액</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={cn(tone.row, pickedId === r.id ? tone.rowOn : tone.rowOff)}
              onClick={() => onToggle(r.id, r.geom, 'EPSG:4326')}
            >
              <span className={cn('min-w-0 flex-1 truncate', tone.cell)} title={r.name}>
                {r.name}
              </span>
              <span className={cn('w-[4.5rem] shrink-0 truncate text-slate-600', tone.cell)}>{r.doneDate}</span>
              <span className={cn('w-[5.5rem] shrink-0 truncate text-right text-slate-600', tone.cell)}>{r.amount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
