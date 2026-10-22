'use client'

import { useEffect, useMemo, useState } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { WTL_NET_LAYER_DEFS } from '../networkMap/wtlNetworkLayerCatalog'
import type { WtlNetworkRow } from '../networkMap/wtlNetworkTypes'
import { wkt5181ToRing4326 } from '../spatialAnalysis/outage/wtlOutageGeom'
import { loadWtlConsProjects, shortYearDate, workAmountLabel } from './wtlConsSample'

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
}

type BuildingRow = {
  bldNm: string
  addr: string
  jibun: string
  platLoc: string
}

type CustomerRow = {
  id: string
  name: string
  address: string
  meterNo: string
}

type ConsRow = {
  id: string
  name: string
  location: string
  doneDate: string
  amount: string
}

/** 관망조회에 포함된 시설 레이어(수용가·업데이트 내역 제외) */
const FACILITY_LAYER_KEYS = WTL_NET_LAYER_DEFS.filter(
  (d) => d.table && d.key !== '급수전계량기' && d.key !== '상수 업데이트 내역'
).map((d) => d.key)

const CONS_LAYER_KEYS = ['상수 업데이트 내역'] as const

const TABS: { id: RelatedTab; label: string }[] = [
  { id: 'zone', label: '공사구역' },
  { id: 'facility', label: '관련시설' },
  { id: 'parcel', label: '관련필지' },
  { id: 'building', label: '관련건물' },
  { id: 'customer', label: '수용가' },
  { id: 'cons', label: '공사대장' },
]

type Props = {
  zones: ZoneMock[]
  zoneId: string | null
  onSelectZone: (id: string) => void
  activeZone: ZoneMock | null
}

export function WtlConsRelatedTabs({ zones, zoneId, onSelectZone, activeZone }: Props) {
  const [tab, setTab] = useState<RelatedTab>('zone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facilities, setFacilities] = useState<WtlNetworkRow[]>([])
  const [parcels, setParcels] = useState<ParcelRow[]>([])
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [consRows, setConsRows] = useState<ConsRow[]>([])

  const wkt = activeZone?.geomWkt5181?.trim() || null

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

  useEffect(() => {
    if (!wkt || tab === 'zone') return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        if (tab === 'facility') {
          const res = await call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkByWkt5181',
            params: {
              wkt5181: wkt,
              layerKeys: FACILITY_LAYER_KEYS,
              mapSources: ['daejin'],
              limit: 600,
            },
          })
          const body = (res?.data ?? res) as { rows?: WtlNetworkRow[] }
          if (!cancelled) setFacilities(Array.isArray(body?.rows) ? body.rows : [])
          return
        }

        if (tab === 'parcel' || tab === 'building') {
          const res = await call('', 'POST', {
            service: 'layerRowService',
            action: 'listJijukParcelsByGeomWkt5181',
            params: { wkt5181: wkt, limit: 300 },
          })
          const body = (res?.data ?? res) as { parcels?: ParcelRow[]; error?: string }
          const nextParcels = Array.isArray(body?.parcels) ? body.parcels : []
          if (!cancelled) {
            setParcels(nextParcels)
            if (body?.error) setError(body.error)
          }
          if (tab === 'building') {
            if (nextParcels.length === 0) {
              if (!cancelled) setBuildings([])
              return
            }
            const bRes = await call('', 'POST', {
              service: 'mapAnalyseService',
              action: 'fetchBuildingLedgersForParcels',
              params: {
                parcels: nextParcels.slice(0, 40).map((p) => ({ pnu: p.pnu, jibun: p.address })),
              },
            })
            const bBody = (bRes?.data ?? bRes) as { ok?: boolean; rows?: BuildingRow[] }
            if (!cancelled) {
              setBuildings(bBody?.ok && Array.isArray(bBody.rows) ? bBody.rows : [])
            }
          }
          return
        }

        if (tab === 'customer') {
          const ring = wkt5181ToRing4326(wkt)
          if (ring.length < 3) {
            if (!cancelled) setCustomers([])
            return
          }
          const res = await call('', 'POST', {
            service: 'wtlOutageService',
            action: 'refreshWtlOutageZone',
            params: { ring },
          })
          const body = (res?.data ?? res) as {
            customers?: CustomerRow[]
            error?: string
          }
          if (!cancelled) {
            setCustomers(Array.isArray(body?.customers) ? body.customers : [])
            if (body?.error) setError(body.error)
          }
          return
        }

        if (tab === 'cons') {
          const res = await call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkByWkt5181',
            params: {
              wkt5181: wkt,
              layerKeys: [...CONS_LAYER_KEYS],
              mapSources: ['daejin', 'review'],
              limit: 200,
            },
          })
          const body = (res?.data ?? res) as { rows?: WtlNetworkRow[] }
          const fromNet = (Array.isArray(body?.rows) ? body.rows : []).map((r) => ({
            id: r.id,
            name: r.name,
            location: r.hjd || '—',
            doneDate: r.year !== '—' ? r.year : '—',
            amount: '—',
          }))
          /** DB 건이 없으면 샘플 공사 중 위치가 구역과 겹치는 느낌의 건 */
          const zoneLoc = activeZone?.location ?? ''
          const sample = loadWtlConsProjects()
            .flatMap((p) => p.works)
            .filter((w) => {
              if (!zoneLoc) return Boolean(w.geomWkt5181)
              return w.location.includes(zoneLoc.slice(0, 4)) || zoneLoc.includes(w.location.slice(0, 4))
            })
            .slice(0, 30)
            .map((w) => ({
              id: w.id,
              name: w.name,
              location: w.location || '—',
              doneDate: shortYearDate(w.doneDate || w.sdoneDate || ''),
              amount: workAmountLabel(w),
            }))
          if (!cancelled) setConsRows(fromNet.length > 0 ? fromNet : sample)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '조회에 실패했습니다.')
          if (tab === 'facility') setFacilities([])
          if (tab === 'parcel') setParcels([])
          if (tab === 'building') setBuildings([])
          if (tab === 'customer') setCustomers([])
          if (tab === 'cons') setConsRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [wkt, tab, activeZone?.location])

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="grid shrink-0 grid-cols-3 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'h-7 border-b-2 px-1 text-[10px] -mb-px',
              tab === item.id
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span className="ml-0.5 text-[9px] opacity-70">({counts[item.id]})</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5">
        {tab === 'zone' ? (
          <ZoneTable zones={zones} zoneId={zoneId} onSelectZone={onSelectZone} />
        ) : loading ? (
          <p className="py-8 text-center text-[11px] text-slate-400">공간조회 중…</p>
        ) : error && counts[tab] === 0 ? (
          <p className="py-8 text-center text-[11px] text-slate-400">{error}</p>
        ) : tab === 'facility' ? (
          <FacilityTable rows={facilities} />
        ) : tab === 'parcel' ? (
          <ParcelTable rows={parcels} />
        ) : tab === 'building' ? (
          <BuildingTable rows={buildings} />
        ) : tab === 'customer' ? (
          <CustomerTable rows={customers} />
        ) : (
          <ConsTable rows={consRows} />
        )}
      </div>
    </div>
  )
}

function ZoneTable({
  zones,
  zoneId,
  onSelectZone,
}: {
  zones: ZoneMock[]
  zoneId: string | null
  onSelectZone: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        <span className="min-w-0 flex-[1.1] px-2 py-1.5">공사위치</span>
        <span className="min-w-0 flex-1 px-2 py-1.5">비고</span>
      </div>
      <ul>
        {zones.map((z, idx) => (
          <li key={z.id}>
            <button
              type="button"
              onClick={() => onSelectZone(z.id)}
              className={cn(
                'flex w-full items-center border-b border-slate-100 text-left text-[11px] last:border-b-0',
                zoneId === z.id || (!zoneId && idx === 0)
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-slate-800 hover:bg-slate-50'
              )}
            >
              <span className="min-w-0 flex-[1.1] truncate px-2 py-1.5" title={z.location}>
                {z.location}
              </span>
              <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-600" title={z.note}>
                {z.note}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FacilityTable({ rows }: { rows: WtlNetworkRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[11px] text-slate-400">교차하는 관련시설이 없습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        <span className="w-[5.5rem] shrink-0 px-2 py-1.5">구분</span>
        <span className="min-w-0 flex-1 px-2 py-1.5">관리번호</span>
        <span className="w-14 shrink-0 px-2 py-1.5">구경</span>
        <span className="w-14 shrink-0 px-2 py-1.5">연도</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center border-b border-slate-100 text-[11px] last:border-b-0"
          >
            <span className="w-[5.5rem] shrink-0 truncate px-2 py-1.5 text-slate-600" title={r.layerKey}>
              {r.layerKey}
            </span>
            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-800" title={r.name}>
              {r.name}
            </span>
            <span className="w-14 shrink-0 truncate px-2 py-1.5 text-slate-600">{r.diameter}</span>
            <span className="w-14 shrink-0 truncate px-2 py-1.5 text-slate-600">{r.year}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ParcelTable({ rows }: { rows: ParcelRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[11px] text-slate-400">교차하는 관련필지가 없습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        <span className="min-w-0 flex-1 px-2 py-1.5">지번</span>
        <span className="w-12 shrink-0 px-2 py-1.5">지목</span>
        <span className="w-16 shrink-0 px-2 py-1.5 text-right">면적</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.pnu || r.address}
            className="flex items-center border-b border-slate-100 text-[11px] last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-800" title={r.address}>
              {r.address || r.pnu}
            </span>
            <span className="w-12 shrink-0 truncate px-2 py-1.5 text-slate-600">{r.jimok || '—'}</span>
            <span className="w-16 shrink-0 truncate px-2 py-1.5 text-right tabular-nums text-slate-600">
              {r.areaSqm != null ? Math.round(r.areaSqm).toLocaleString('ko-KR') : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BuildingTable({ rows }: { rows: BuildingRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[11px] text-slate-400">교차하는 관련건물이 없습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        <span className="min-w-0 flex-1 px-2 py-1.5">건물명</span>
        <span className="min-w-0 flex-1 px-2 py-1.5">주소</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li
            key={`${r.bldNm}-${r.jibun}-${i}`}
            className="flex items-center border-b border-slate-100 text-[11px] last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-800" title={r.bldNm}>
              {r.bldNm || '—'}
            </span>
            <span
              className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-600"
              title={r.addr || r.platLoc || r.jibun}
            >
              {r.addr || r.platLoc || r.jibun || '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomerTable({ rows }: { rows: CustomerRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[11px] text-slate-400">교차하는 수용가가 없습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        <span className="min-w-0 flex-[0.9] px-2 py-1.5">수용가</span>
        <span className="min-w-0 flex-1 px-2 py-1.5">주소</span>
        <span className="w-[4.5rem] shrink-0 px-2 py-1.5">기물번호</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center border-b border-slate-100 text-[11px] last:border-b-0"
          >
            <span className="min-w-0 flex-[0.9] truncate px-2 py-1.5 text-slate-800" title={r.name}>
              {r.name}
            </span>
            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-600" title={r.address}>
              {r.address || '—'}
            </span>
            <span className="w-[4.5rem] shrink-0 truncate px-2 py-1.5 text-slate-600">{r.meterNo || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConsTable({ rows }: { rows: ConsRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[11px] text-slate-400">교차하는 공사대장이 없습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600">
        <span className="min-w-0 flex-1 px-2 py-1.5">공사명</span>
        <span className="w-[4.5rem] shrink-0 px-2 py-1.5">준공</span>
        <span className="w-[5.5rem] shrink-0 px-2 py-1.5 text-right">금액</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center border-b border-slate-100 text-[11px] last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-slate-800" title={r.name}>
              {r.name}
            </span>
            <span className="w-[4.5rem] shrink-0 truncate px-2 py-1.5 text-slate-600">{r.doneDate}</span>
            <span className="w-[5.5rem] shrink-0 truncate px-2 py-1.5 text-right text-slate-600">
              {r.amount}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
