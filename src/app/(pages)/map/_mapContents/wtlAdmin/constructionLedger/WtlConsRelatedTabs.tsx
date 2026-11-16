'use client'

import { useEffect, useMemo, useState } from 'react'
import { call } from '@/lib/api'
import type { ConsLedgerKind } from '@/lib/consLedgerVariant'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { getRowValueByField } from '../../../_mapComponents/standard/defineLayerRowUtils'
import { prepareMapForPanelAwareNavigation } from '../../../_mapComponents/config/mapAutoNavigation'
import { getParcelExtent3857 } from '../../../_mapComponents/layerRowEdit/layerRowParcelUtils'
import { useLayerRowParcelHighlight } from '../../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight'
import type { LayerRowParcelItem } from '../../../_mapComponents/layerRowEdit/types'
import { UsageDataAsAddressList } from '../../river/usageDataAs/UsageDataAsAddressList'
import { getWtlNetLayerDef, WTL_NET_LAYER_DEFS, WTL_NET_ZONE_LAYER_KEYS } from '../networkMap/wtlNetworkLayerCatalog'
import { wtlNetKorNameForTable } from '../networkMap/wtlNetworkMapSources'
import type { WtlNetworkRow } from '../networkMap/wtlNetworkTypes'
import { wkt5181ToRing4326 } from '../spatialAnalysis/outage/wtlOutageGeom'
import { geom4326ToWkt5181, loadWtlConsIntersecting, type WtlConsGeom4326 } from './wtlConsLedgerApi'
import { shortYearDate, workAmountLabel, type WtlConsWork } from './wtlConsSample'
import type { WtlConsMapFocus } from './useWtlConsMapLayer'

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
  { id: 'zone', label: '공사구역' },
  { id: 'facility', label: '관련시설' },
  { id: 'parcel', label: '필지목록' },
  { id: 'building', label: '관련건물' },
  { id: 'customer', label: '수용가' },
  { id: 'cons', label: '공사대장' },
]

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
  useLayerRowParcelHighlight(highlightParcel, 'blue')
  const [facilities, setFacilities] = useState<WtlNetworkRow[]>([])
  const [parcels, setParcels] = useState<ParcelRow[]>([])
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [consRows, setConsRows] = useState<ConsRow[]>([])

  const zoneWkt = activeZone?.geomWkt5181?.trim() || null
  const workWkt = useMemo(() => geom4326ToWkt5181(workGeom4326), [workGeom4326])
  /** 필지·건물은 공사 도형 기준. 없으면 선택한 공사위치로 넘긴다 */
  const parcelWkt = workWkt || zoneWkt

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
        const nextParcels = (Array.isArray(body?.parcels) ? body.parcels : []).map((row) => ({
          address: row.address,
          pnu: row.pnu,
          jimok: row.jimok,
          areaSqm: row.areaSqm,
          geometry3857: row.geometry3857 ?? null,
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

  useEffect(() => {
    if (!parcelWkt) {
      setFacilities([])
      setCustomers([])
      return
    }
    let cancelled = false
    void (async () => {
      const [facilityRes, customerRes] = await Promise.allSettled([
        call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkList',
          params: {
            areaWkts5181: [parcelWkt],
            layerKeys: FACILITY_LAYER_KEYS,
            withGeom: true,
            limit: 600,
          },
        }),
        (async () => {
          const ring = wkt5181ToRing4326(parcelWkt)
          if (ring.length < 3) return { customers: [] as CustomerRow[] }
          return call('', 'POST', {
            service: 'wtlOutageService',
            action: 'refreshWtlOutageZone',
            params: { ring },
          })
        })(),
      ])
      if (cancelled) return
      if (facilityRes.status === 'fulfilled') {
        const body = (facilityRes.value?.data ?? facilityRes.value) as { rows?: WtlNetworkRow[] }
        setFacilities(Array.isArray(body?.rows) ? body.rows : [])
      } else {
        setFacilities([])
      }
      if (customerRes.status === 'fulfilled') {
        const body = (customerRes.value?.data ?? customerRes.value) as { customers?: CustomerRow[] }
        setCustomers(
          (Array.isArray(body?.customers) ? body.customers : []).map((row) => ({
            id: row.id,
            name: row.name,
            address: row.address,
            meterNo: row.meterNo,
            point: row.point ?? null,
          }))
        )
      } else {
        setCustomers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parcelWkt])

  useEffect(() => {
    const code = consCode?.trim() || ''
    if (!parcelWkt || !code) {
      setConsRows([])
      return
    }
    let cancelled = false
    void loadWtlConsIntersecting(kind, code, parcelWkt).then((result) => {
      if (cancelled) return
      setConsRows(
        result.rows.map((row) => ({
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
  }, [parcelWkt, kind, consCode])

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

  const counts = useMemo(
    () => ({
      zone: zones.length,
      facility: facilities.length,
      parcel: parcels.length,
      building: buildings.length,
      customer: customers.length,
      cons: consRows.length,
    }),
    [zones.length, facilities.length, parcels.length, buildings.length, customers.length, consRows.length]
  )


  const parcelItems = useMemo<LayerRowParcelItem[]>(
    () =>
      parcels.map((row) => ({
        address: row.address || row.pnu || '—',
        pnu: row.pnu || undefined,
        geometry3857: row.geometry3857 ?? null,
        extent3857: null,
        showMapGeom: true,
      })),
    [parcels]
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
    const map = mapContext?.mapInstanceRef?.current
    const extent = getParcelExtent3857(item)
    if (!map || !extent) return
    const center: [number, number] = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]
    const applyPadding = () => mapContext?.applyMapViewPaddingRef?.current?.()
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          prepareMapForPanelAwareNavigation(map, applyPadding)
          map.getView().animate({ center, duration: 450 })
        })
      })
    })
  }

  const handleParcelClick = (item: LayerRowParcelItem, idx: number) => {
    onFocus?.(null)
    if (parcelIdx === idx) {
      setParcelIdx(null)
      setHighlightParcel(null)
      return
    }
    setParcelIdx(idx)
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
    projection: 'EPSG:4326' | 'EPSG:3857'
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
    onFocus?.({ geom: geom as Record<string, unknown>, projection })
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
      <div className={cn(tone.body, tab === 'parcel' && 'flex flex-col overflow-hidden')}>
        {tab === 'zone' ? (
          <ZoneTable tone={tone} zones={zones} zoneId={zoneId} onSelectZone={onSelectZone} loading={zoneLoading} />
        ) : tab === 'facility' ? (
          <FacilityTable tone={tone} rows={facilities} pickedId={pickedId} onToggle={toggleRow} />
        ) : tab === 'parcel' ? (
          <UsageDataAsAddressList
            className="mt-0 min-h-0 flex-1"
            fillHeight
            title="필지목록"
            hideTitle
            isEditing={false}
            items={parcelItems}
            selectedIdx={parcelIdx}
            onClick={handleParcelClick}
            clickTitle="클릭 시 위치 이동 및 선택"
            emptyHintView="교차하는 필지가 없습니다."
          />
        ) : tab === 'building' ? (
          <BuildingTable tone={tone} rows={buildings} pickedId={pickedId} onClick={handleBuildingClick} />
        ) : tab === 'customer' ? (
          <CustomerTable tone={tone} rows={customers} pickedId={pickedId} onToggle={toggleRow} />
        ) : (
          <ConsTable tone={tone} rows={consRows} pickedId={pickedId} onToggle={toggleRow} />
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
  projection: 'EPSG:4326' | 'EPSG:3857'
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
          <li className={tone.empty}>{loading ? '공사구역을 불러오는 중…' : '공사구역이 없습니다.'}</li>
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
              onClick={() => onToggle(r.id, r.geom, 'EPSG:4326')}
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
    return <p className={tone.empty}>교차하는 공사대장이 없습니다.</p>
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
