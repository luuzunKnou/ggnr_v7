'use client'

/**
 * =============================================================================
 * [공사대장 · 관련탭 UX 의도 — 임의로 바꾸지 말 것]
 * =============================================================================
 *
 * ■ 맵무브 흐름 (지도 훅 useWtlConsMapLayer 와 한 세트)
 * 1. 공사 선택 → 전체 줌아웃(맞춤)
 * 2. 공사위치 선택 → (전체가 작으면) 줌인 / 이미 가까우면 유지
 * 3. 관련시설·필지 등 클릭 → 맵무브·줌 없음(강조만)
 *
 * ■ 탭 6개 조회 범위 (필지·관련시설·건물·수용가·공사이력·공사위치 목록)
 * - «선택한 공사위치 1개»가 아님.
 * - «화면에 보이는 시설만» ON → 지금 지도에 겹치는 공사위치들의 합집합
 * - OFF → 해당 공사 공사위치 전체
 * - 공사위치 행 선택 = 줌·강조만. zoneId 를 지워 조회 범위를 바꾸지 말 것.
 * - 예: 화면에 공사위치 4개가 보이면 탭도 그 4개 기준 (고른 1개만 조회 금지)
 *
 * ■ «화면에 보이는 시설만» 체크
 * - UI는 공사이력 탭에서만 표시(다른 탭은 숨김, 로직 유지).
 * - 공사이력 진입 시 기본 ON, 이탈 시 OFF. ON/OFF 즉시 배지·목록 반영. 휠 중엔 moveend 후 갱신.
 *
 * ■ 관련시설 API areaWkts5181
 * - 구역 여러 개를 배열로 넣으면 서버가 AND(동시 교차) → 시설 전부 탈락.
 * - 합친 WKT(컬렉션) 1건으로 넣을 것.
 *
 * ■ 관련시설 아이콘 (wtlConsRelatedStyle)
 * - GeoServer 해당 레이어 SLD에 적힌 ExternalGraphic만 사용.
 * - ftr_cde 마다 아이콘 파일이 있는 게 아님 → `{layer}_{ftr_cde}.svg` 임의 조합 금지.
 * - SLD 조건에 코드가 있으면 styleCode로 고르고, 없으면 스타일 기본 심볼.
 *
 * 지도 맞춤 상세: useWtlConsMapLayer 파일 상단 주석.
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
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
import { shortYearDate, workAmountLabel, WTL_CONS_FIELD_LABEL, type WtlConsWork } from './wtlConsSample'
import { WtlConsHistoryFocusFloating } from './WtlConsHistoryFocusFloating'
import {
  extentOfVisibleMap,
  type WtlConsMapFocus,
  type WtlConsMapFocusTooltip,
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
  const lower: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    lower[k.toLowerCase()] = v
  }
  const raw =
    getRowValueByField(record, 'ftr_cde') ??
    record.ftr_cde ??
    record.FTR_CDE ??
    lower.ftr_cde ??
    null
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
  return code || null
}

/** GeoServer 스타일명 = layerKey (코드별 스타일명으로 치환하지 않음 — 파일 상단 아이콘 의도) */
function facilityStyleName(row: WtlNetworkRow): string {
  return String(row.layerKey ?? '').trim()
}

function facilitiesToMapItems(rows: WtlNetworkRow[]): WtlConsRelatedFacility[] {
  const items: WtlConsRelatedFacility[] = []
  for (const row of rows) {
    const geom = row.geom
    if (!geom || typeof geom !== 'object' || !('type' in geom)) continue
    const styleName = facilityStyleName(row)
    if (!styleName) continue
    items.push({
      id: row.id,
      geom: geom as unknown as Record<string, unknown>,
      projection: 'EPSG:4326',
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
  /** «화면에 보이는 시설만» — 부모(Shell)가 소유. 목록 필터·맵무브 억제 동기 */
  onlyInView: boolean
  onOnlyInViewChange: (onlyInView: boolean) => void
  /** 선택한 공사의 본표 도형. 필지·공사대장 겹침은 이 도형 기준 */
  workGeom4326?: WtlConsGeom4326 | null
  kind?: Extract<ConsLedgerKind, 'wtl' | 'swl'>
  consCode?: string | null
  activeZone: ZoneMock | null
  zoneLoading?: boolean
  /** 공사이력 정보박스 «조회» → 해당 공사 패널 */
  onOpenHistoryWork?: (consCode: string) => void
  /** 외부에서 관련탭 강제(조회 후 공사위치 등) */
  tabLand?: { tab: RelatedTab; token: number } | null
}

export function WtlConsRelatedTabs({
  zones,
  zoneId,
  onSelectZone,
  onFocus,
  onRelatedFacilities,
  onlyInView,
  onOnlyInViewChange,
  workGeom4326 = null,
  kind = 'wtl',
  consCode = null,
  activeZone: _activeZone,
  zoneLoading = false,
  onOpenHistoryWork,
  tabLand = null,
}: Props) {
  void _activeZone // 선택=줌·강조만. 탭 조회 범위에는 쓰지 않음
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
  const [viewExtent, setViewExtent] = useState<Extent | null>(null)
  /** 공사이력 드래그 상세 창 */
  const [historyFocus, setHistoryFocus] = useState<WtlConsMapFocus | null>(null)

  const workWkt = useMemo(() => geom4326ToWkt5181(workGeom4326), [workGeom4326])

  /** 지도 화면 범위 — 이동·줌·패널 패딩 변경 시 즉시 반영(체크 ON 카운트용) */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const view = map.getView()
    let raf = 0
    const refresh = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        const next = extentOfVisibleMap(map)
        setViewExtent((prev) => {
          if (!next) return null
          if (
            prev &&
            prev[0] === next[0] &&
            prev[1] === next[1] &&
            prev[2] === next[2] &&
            prev[3] === next[3]
          ) {
            return prev
          }
          return next as Extent
        })
      })
    }
    const onPadding = (evt: { key?: string }) => {
      if (evt.key === 'padding') refresh()
    }
    refresh()
    // 줌·드래그 중에는 갱신하지 않음 — 휠 조작 중 목록/조회가 끼어들면 맵이 다시 맞춰지는 것처럼 보임
    map.on('moveend', refresh)
    view.on('propertychange', onPadding)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      map.un('moveend', refresh)
      view.un('propertychange', onPadding)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  // 체크 ON으로 돌아올 때 현재 화면 범위로 한 번 더 맞춤
  useEffect(() => {
    if (!onlyInView) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const next = extentOfVisibleMap(map)
    setViewExtent(next ? (next as Extent) : null)
  }, [onlyInView, mapContext?.mapInstanceRef, mapContext?.mapReady])

  /**
   * 탭 조회·목록 기준 공사위치 (파일 상단 UX 의도).
   * ON → 화면 겹침 구역 / OFF → 공사 전체 구역. 행 선택(zoneId)과 무관.
   */
  const visibleZones = useMemo(() => {
    if (!onlyInView) return zones
    if (!viewExtent) return zones
    return zones.filter((z) => wkt5181IntersectsView(z.geomWkt5181, viewExtent))
  }, [onlyInView, viewExtent, zones])

  const scopeWktList = useMemo(
    () =>
      visibleZones
        .map((z) => z.geomWkt5181?.trim())
        .filter((w): w is string => Boolean(w)),
    [visibleZones]
  )

  /**
   * 조회 WKT: 화면(또는 전체) 공사위치 합집합.
   * 구역 데이터가 아예 없을 때만 공사 본표로 대체. 화면 안 0건이면 null(빈 목록).
   */
  const scopeWktLive = useMemo(() => {
    const fromZones = collectWkt5181(scopeWktList)
    if (fromZones) return fromZones
    if (zones.length === 0) return workWkt
    return null
  }, [scopeWktList, workWkt, zones.length])

  /**
   * 수용가용 개별 WKT 목록(링 변환). 관련시설 API에는 넣지 않음 —
   * 배열로 넘기면 서버가 AND(모든 구역에 동시 교차)로 묶어 시설이 전부 탈락함.
   */
  const customerWktsLive = useMemo(() => {
    if (scopeWktList.length > 0) return scopeWktList
    if (zones.length === 0 && workWkt) return [workWkt]
    return [] as string[]
  }, [scopeWktList, zones.length, workWkt])

  const [parcelWkt, setParcelWkt] = useState<string | null>(scopeWktLive)
  const [customerAreaWkts, setCustomerAreaWkts] = useState<string[]>(customerWktsLive)
  const [consHistoryWkt, setConsHistoryWkt] = useState<string | null>(() =>
    collectWkt5181(scopeWktList)
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextParcel = scopeWktLive
      const nextCust = customerWktsLive
      const nextCons = collectWkt5181(scopeWktList)
      setParcelWkt((prev) => (prev === nextParcel ? prev : nextParcel))
      setCustomerAreaWkts((prev) =>
        prev.length === nextCust.length && prev.every((w, i) => w === nextCust[i])
          ? prev
          : nextCust
      )
      setConsHistoryWkt((prev) => (prev === nextCons ? prev : nextCons))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [scopeWktLive, customerWktsLive, scopeWktList])

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

  /**
   * 관련시설·필지·건물·공사이력과 동일 범위(parcelWkt = 화면 공사위치 합집합 1건).
   * areaWkts 배열 복수 전달 금지(서버 AND → 변류 등 시설 전부 탈락).
   */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parcelWkt만
  }, [parcelWkt])

  /** 수용가: 구역 WKT마다 조회 후 id 합침(컬렉션 ring 변환 불가) */
  useEffect(() => {
    if (customerAreaWkts.length === 0) {
      setCustomers([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const merged = new Map<string, CustomerRow>()
        for (const wkt of customerAreaWkts) {
          const ring = wkt5181ToRing4326(wkt)
          if (ring.length < 3) continue
          const res = await call('', 'POST', {
            service: 'wtlOutageService',
            action: 'refreshWtlOutageZone',
            params: { ring },
          })
          if (cancelled) return
          const body = (res?.data ?? res) as { customers?: CustomerRow[] }
          for (const row of Array.isArray(body?.customers) ? body.customers : []) {
            const id = String(row.id ?? '').trim()
            if (!id || merged.has(id)) continue
            merged.set(id, {
              id: row.id,
              name: row.name,
              address: row.address,
              meterNo: row.meterNo,
              point: row.point ?? null,
            })
          }
        }
        if (!cancelled) setCustomers([...merged.values()])
      } catch {
        if (!cancelled) setCustomers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [customerAreaWkts])

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

  /** 탭 배지 = 목록과 동일. onlyInView·viewExtent 변경 시 매 렌더 재계산 */
  const counts = {
    zone: visibleZones.length,
    facility: visibleFacilities.length,
    parcel: visibleParcels.length,
    building: visibleBuildings.length,
    customer: visibleCustomers.length,
    cons: visibleConsRows.length,
  }

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
    setHistoryFocus(null)
    onFocus?.(null)
    // 공사이력: 체크 보이며 기본 ON. 다른 탭: 숨김 + OFF(조용히 ON 잔류 방지)
    if (next === 'cons') onOnlyInViewChange(true)
    else if (onlyInView) onOnlyInViewChange(false)
    setTab(next)
  }

  const panToParcel = (item: LayerRowParcelItem) => {
    // 화면만 ON → 맵 고정(목록·카운트가 viewExtent에 묶여 있어 움직이면 결과가 흔들림)
    if (onlyInView) return
    const map = mapContext?.mapInstanceRef?.current
    const extent = getParcelExtent3857(item)
    if (!map || !extent) return
    const applyPadding = () => mapContext?.applyMapViewPaddingRef?.current?.()
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: applyPadding,
    })
  }

  /** 필지·건물도 mapFocus 로 올려 본표·공사위치 반짝이를 끈다(탭 간 배타) */
  const focusFromHighlight = (id: string, item: LayerRowParcelItem | null) => {
    const geom = item?.geometry3857
    if (!geom || typeof geom !== 'object' || !('type' in geom)) {
      onFocus?.(null)
      return
    }
    onFocus?.({
      id,
      geom: geom as Record<string, unknown>,
      projection: 'EPSG:3857',
      skipFit: onlyInView,
    })
  }

  const handleParcelClick = (item: LayerRowParcelItem, visibleIdx: number) => {
    const visible = visibleParcels[visibleIdx]
    const resolvedIdx = visible
      ? parcels.findIndex((row) => row.pnu === visible.pnu && row.address === visible.address)
      : -1
    if (resolvedIdx < 0) return
    if (parcelIdx === resolvedIdx) {
      setParcelIdx(null)
      setHighlightParcel(null)
      onFocus?.(null)
      return
    }
    setParcelIdx(resolvedIdx)
    setPickedId(null)
    setHighlightParcel(item)
    focusFromHighlight(`parcel:${item.pnu ?? resolvedIdx}`, item)
    panToParcel(item)
  }

  const handleBuildingClick = (row: BuildingRow, index: number) => {
    const id = buildingRowId(row, index)
    if (pickedId === id) {
      setPickedId(null)
      setHighlightParcel(null)
      onFocus?.(null)
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
    focusFromHighlight(`building:${id}`, item)
    if (item) panToParcel(item)
  }

  /** 같은 행을 다시 누르면 선택과 지도 강조를 끈다 */
  const toggleRow = (
    id: string,
    geom: Record<string, unknown> | GeoJSON.Geometry | null | undefined,
    projection: 'EPSG:4326' | 'EPSG:3857',
    style?: { styleName?: string; styleCode?: string | null },
    tooltip?: WtlConsMapFocusTooltip | null
  ) => {
    if (pickedId === id) {
      setPickedId(null)
      setHistoryFocus(null)
      onFocus?.(null)
      return
    }
    setPickedId(id)
    if (!geom || typeof geom !== 'object' || !('type' in geom)) {
      setHistoryFocus(null)
      onFocus?.(null)
      return
    }
    const nextFocus: WtlConsMapFocus = {
      id,
      geom: geom as unknown as Record<string, unknown>,
      projection,
      styleName: style?.styleName,
      styleCode: style?.styleCode,
      // 화면만 ON → 맵 고정·강조만(목록 흔들림 방지). OFF → 맞춤 허용
      skipFit: onlyInView,
      tooltip: tooltip ?? null,
    }
    setHistoryFocus(tooltip?.consCode ? nextFocus : null)
    onFocus?.(nextFocus)
  }

  useEffect(() => {
    setPickedId(null)
    setParcelIdx(null)
    setHighlightParcel(null)
    setHistoryFocus(null)
  }, [zoneId])

  useEffect(() => {
    if (tab !== 'cons') setHistoryFocus(null)
  }, [tab])

  /** 공사이력 «조회» 등 — 관련탭을 지정 탭(기본 공사위치)으로 */
  useEffect(() => {
    if (!tabLand) return
    const next = tabLand.tab
    setPickedId(null)
    setParcelIdx(null)
    setHighlightParcel(null)
    setHistoryFocus(null)
    onFocus?.(null)
    if (next !== 'cons' && onlyInView) onOnlyInViewChange(false)
    setTab(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabLand.token
  }, [tabLand?.token])

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
      {tab === 'cons' ? (
        <label className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-border px-2 py-1.5 text-[11px] text-foreground">
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={onlyInView}
            onChange={(e) => onOnlyInViewChange(e.target.checked)}
          />
          화면에 보이는 시설만 표시합니다
        </label>
      ) : null}
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
      {kind === 'wtl' || kind === 'swl' ? (
        <WtlConsHistoryFocusFloating
          kind={kind}
          focus={historyFocus}
          onOpenWork={onOpenHistoryWork}
          onClose={() => {
            setPickedId(null)
            setHistoryFocus(null)
            onFocus?.(null)
          }}
        />
      ) : null}
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
  style?: { styleName?: string; styleCode?: string | null },
  tooltip?: WtlConsMapFocusTooltip | null
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
        {/* 속성명+값 2칸을 헤더 «속성» 하나로 병합 */}
        <span className={cn('min-w-0 flex-[2]', tone.headPad)}>속성</span>
        <span className={cn('w-14 shrink-0', tone.headPad)}>연도</span>
      </div>
      <ul>
        {rows.map((r) => {
          const attrLabel = facilityNameTitle(r)
          const attrValue = String(r.name ?? '').trim() || '—'
          return (
            <li key={r.id}>
              <button
                type="button"
                className={cn(tone.row, pickedId === r.id ? tone.rowOn : tone.rowOff)}
                onClick={() =>
                  onToggle(r.id, r.geom, 'EPSG:4326', {
                    styleName: facilityStyleName(r),
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
                <span
                  className={cn('w-[4.25rem] shrink-0 truncate text-slate-500', tone.cell)}
                  title={attrLabel}
                >
                  {attrLabel}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', tone.cell)} title={attrValue}>
                  {attrValue}
                </span>
                <span className={cn('w-14 shrink-0 truncate text-slate-600', tone.cell)}>{r.year}</span>
              </button>
            </li>
          )
        })}
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
              onClick={() => {
                onToggle(r.id, r.geom, 'EPSG:4326', undefined, {
                  consCode: r.id,
                  title: r.name || r.id || '공사이력',
                  summary: [
                    { label: WTL_CONS_FIELD_LABEL.name, value: r.name || '—' },
                    { label: WTL_CONS_FIELD_LABEL.location, value: r.location || '—' },
                    { label: WTL_CONS_FIELD_LABEL.doneDate, value: r.doneDate || '—' },
                    { label: WTL_CONS_FIELD_LABEL.amountAft, value: r.amount || '—' },
                  ],
                })
              }}
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
