'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react'
import { buildDashboardGradeMock } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import {
  buildOdorStationRows,
  odorStatusLabel,
  type OdorStationRow,
} from '@/app/(pages)/map/_mapContents/odorDashboard2/odorDashboard2StationRows'
import { MOCK_ODOR_SENSORS_FROM_DB } from '@/service/odorSensorMock'
import { cn } from '@/lib/utils'
import { formatCommTime } from './odorSystemStatusJudge'
import type { OdorCommNodeView } from './odorSystemStatusTypes'
import { ODOR_COMM_STATUS_LABEL } from './odorSystemStatusTypes'

type Props = {
  /** 계통도에서 선택한 노드 (업체·인프라) */
  node: OdorCommNodeView
  /** 업체 목록에서 드릴인한 센서 */
  sensorDetail: OdorCommNodeView | null
  /** 업체 선택 시 하위 센서 목록 */
  agencySensors: OdorCommNodeView[]
  /** 기기 목록 선택 강조 */
  selectedSensorId?: string | null
  onSelectSensor: (sensor: OdorCommNodeView) => void
  onBackToAgencyList?: () => void
  onGoToStation?: (node: OdorCommNodeView) => void
  onClose: () => void
  className?: string
}

function AttrRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="standard-detail-attr-table">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <div className="standard-detail-attr-label standard-detail-attr-cell-border">
            {row.label}
          </div>
          <div className="standard-detail-attr-value standard-detail-attr-cell-border">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function CommStatusBadge({ status }: { status: OdorCommNodeView['status'] }) {
  return (
    <span
      className={cn(
        'standard-status-badge shrink-0',
        status === 'ok' && 'standard-status-badge-primary',
        status === 'delayed' && 'standard-status-badge-muted',
        status === 'disconnect' && 'standard-status-badge-ended'
      )}
    >
      {ODOR_COMM_STATUS_LABEL[status]}
    </span>
  )
}

/** 헤더 layer — 계층 구간 설명 */
function segmentDescription(
  node: OdorCommNodeView,
  sensorDetail: OdorCommNodeView | null
): string {
  if (sensorDetail) {
    return `${node.label} ↔ ${sensorDetail.label}`
  }
  if (node.detail?.peerLine) return node.detail.peerLine
  switch (node.kind) {
    case 'ipsec':
      return 'Ap 서버 ↔ 행정망'
    case 'db':
      return 'IPsec VPN ↔ DB 서버(악취정보)'
    case 'utm':
      return 'TM/TC Master ⇔ DB 서버'
    case 'iot':
      return 'VPN/UTM ↔ IoT 서버'
    case 'master':
      return 'IoT 서버 ↔ TM/TC Master'
    case 'agency':
      return `TM/TC Master ↔ ${node.label}`
    case 'sensor':
      return `${node.agency ?? '업체'} ↔ ${node.label}`
    default:
      return '구간'
  }
}

export function OdorSystemStatusExpandPanel({
  node,
  sensorDetail,
  agencySensors,
  selectedSensorId = null,
  onSelectSensor,
  onBackToAgencyList,
  onGoToStation,
  onClose,
  className,
}: Props) {
  const showSensor = sensorDetail != null
  const view = showSensor ? sensorDetail : node
  const d = view.detail
  const segment = segmentDescription(node, sensorDetail)
  const title = showSensor
    ? sensorDetail.label
    : node.kind === 'agency'
      ? `${node.label} · 기기 목록`
      : node.label

  const detailRows = ((): Array<{ label: string; value: string }> | null => {
    if (showSensor) return null
    if (node.kind === 'ipsec') {
      return [
        { label: '구간', value: d?.peerLine ?? 'Ap 서버 ↔ 행정망' },
        { label: '상태', value: d?.runStatus ?? ODOR_COMM_STATUS_LABEL[node.status] },
      ]
    }
    if (node.kind === 'db' || node.kind === 'iot' || node.kind === 'master') {
      return [
        { label: '상태', value: d?.runStatus ?? '정상 가동' },
        { label: '구성', value: d?.redundancy ?? '이중화(Active-Standby)' },
        {
          label: '수집 TAG',
          value: d?.collectTag ?? 'Full TAG · 10분 주기(1~30분 설정)',
        },
        {
          label: '수집율',
          value:
            d?.collectRateText ??
            (node.collectRate == null
              ? '—'
              : `${Number.isInteger(node.collectRate) ? node.collectRate : node.collectRate.toFixed(1)}%`),
        },
      ]
    }
    if (node.kind === 'utm') {
      const rows = [
        { label: '상태', value: d?.runStatus ?? '정상' },
        { label: '터널', value: d?.tunnel ?? 'F/W+IPS+VPN' },
        { label: '연계', value: d?.linkSystem ?? '하수관망관리시스템' },
      ]
      if (d?.peerLine) rows.push({ label: '구간', value: d.peerLine })
      return rows
    }
    return null
  })()

  return (
    <div className={cn('standard-panel-root', className)}>
      <div className="standard-panel-header">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {showSensor && onBackToAgencyList ? (
            <button
              type="button"
              title="기기 목록으로"
              onClick={onBackToAgencyList}
              className="standard-panel-close cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          <div className="standard-detail-float-heading">
            <span className="standard-detail-float-layer" title={segment}>
              {segment}
            </span>
            <span className="standard-detail-float-title-below" title={title}>
              {title}
            </span>
          </div>
        </div>
        <button
          type="button"
          title="확장 닫기"
          aria-label="확장 닫기"
          onClick={onClose}
          className="standard-panel-close cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {!showSensor && node.kind === 'agency' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AgencyDeviceList
            agency={node.agency ?? node.label}
            agencySensors={agencySensors}
            selectedSensorId={selectedSensorId}
            onSelectSensor={onSelectSensor}
          />
        </div>
      ) : (
        <div className="standard-detail-scroll">
          {showSensor ? (
            <SensorDetailBody node={sensorDetail} onGoToStation={onGoToStation} />
          ) : null}

          {!showSensor && detailRows ? (
            <section className="standard-detail-section-block-first space-y-2">
              <div className="standard-detail-section-body !px-0">
                <AttrRows rows={detailRows} />
              </div>
              {onGoToStation && node.lon != null && node.lat != null ? (
                <button
                  type="button"
                  title="지점으로 이동"
                  onClick={() => onGoToStation(node)}
                  className="standard-detail-hdr-btn-save mb-1 mr-1 inline-flex cursor-pointer items-center gap-1"
                >
                  <MapPin className="h-3 w-3" aria-hidden />
                  지점으로 이동
                </button>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function SensorDetailBody({
  node,
  onGoToStation,
}: {
  node: OdorCommNodeView
  onGoToStation?: (node: OdorCommNodeView) => void
}) {
  const d = node.detail
  const rows = [
    { label: '지점명', value: node.label },
    { label: '지점ID', value: node.stationId ?? '—' },
    { label: '센서명', value: node.sensorNm ?? '—' },
    { label: '통신', value: d?.runStatus ?? ODOR_COMM_STATUS_LABEL[node.status] },
    { label: 'H2S', value: d?.h2s ?? '—' },
    { label: '최종 수신', value: formatCommTime(node.lastRecvAt) },
    {
      label: '미수신',
      value: node.minutesSinceRecv == null ? '—' : `${node.minutesSinceRecv}분`,
    },
  ]

  return (
    <section className="standard-detail-section-block-first space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="standard-panel-title min-w-0 truncate" title={node.label}>
          {node.label}
        </span>
        <CommStatusBadge status={node.status} />
      </div>
      <div className="standard-detail-section-body !px-0">
        <AttrRows rows={rows} />
      </div>
      {onGoToStation && node.lon != null && node.lat != null ? (
        <button
          type="button"
          title="지점으로 이동"
          onClick={() => onGoToStation(node)}
          className="standard-detail-hdr-btn-save mb-1 mr-1 inline-flex cursor-pointer items-center gap-1"
        >
          <MapPin className="h-3 w-3" aria-hidden />
          지점으로 이동
        </button>
      ) : null}
    </section>
  )
}

/** 대시보드2 «지점 목록 및 기기 상태»와 동일 열·검색·더미 */
function AgencyDeviceList({
  agency,
  agencySensors,
  selectedSensorId = null,
  onSelectSensor,
}: {
  agency: string
  agencySensors: OdorCommNodeView[]
  selectedSensorId?: string | null
  onSelectSensor: (sensor: OdorCommNodeView) => void
}) {
  const [emdFilter, setEmdFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const searchWrapRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(() => {
    const sensors = MOCK_ODOR_SENSORS_FROM_DB.filter((s) => s.agency === agency).map((s) => ({
      sensorKey: s.sensorKey,
      agency: s.agency,
      sensorNm: s.sensorNm,
      sensorKorNm: s.sensorKorNm,
      lon: s.lon,
      lat: s.lat,
      lastRecvAt: null as string | null,
    }))
    const { points } = buildDashboardGradeMock(sensors)
    return buildOdorStationRows(sensors, points)
  }, [agency])

  const byKey = useMemo(() => {
    const m = new Map<number, OdorCommNodeView>()
    for (const s of agencySensors) {
      if (s.sensorKey != null) m.set(s.sensorKey, s)
    }
    return m
  }, [agencySensors])

  const emdOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.emdNm).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows])

  const suggestions = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    return rows
      .filter(
        (r) =>
          r.sensorKorNm.toLowerCase().includes(kw) ||
          r.sensorNm.toLowerCase().includes(kw)
      )
      .slice(0, 8)
  }, [rows, keyword])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (emdFilter !== 'all' && r.emdNm !== emdFilter) return false
      const kw = keyword.trim().toLowerCase()
      if (!kw) return true
      return (
        r.sensorKorNm.toLowerCase().includes(kw) ||
        r.sensorNm.toLowerCase().includes(kw) ||
        r.agency.toLowerCase().includes(kw) ||
        r.emdNm.toLowerCase().includes(kw)
      )
    })
  }, [rows, emdFilter, keyword])

  useEffect(() => {
    setEmdFilter('all')
    setKeyword('')
    setSuggestOpen(false)
  }, [agency])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (row: OdorStationRow) => {
    const node = byKey.get(row.sensorKey)
    if (node) onSelectSensor(node)
    setSuggestOpen(false)
  }

  if (rows.length === 0) {
    return (
      <p className="standard-detail-attr-empty flex flex-1 items-center justify-center px-2">
        등록된 기기가 없습니다.
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={searchWrapRef}
        className="relative flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1.5"
      >
        <label className="sr-only" htmlFor="odor-sys-agency-emd">
          행정동
        </label>
        <select
          id="odor-sys-agency-emd"
          title="행정동"
          value={emdFilter}
          onChange={(e) => setEmdFilter(e.target.value)}
          className="h-7 w-[6.5rem] shrink-0 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
        >
          <option value="all">행정동 전체</option>
          {emdOptions.map((emd) => (
            <option key={emd} value={emd}>
              {emd}
            </option>
          ))}
        </select>
        <div className="standard-search-wrap min-w-0 flex-1">
          <Search className="standard-search-icon" aria-hidden />
          <input
            type="search"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setSuggestOpen(true)
            }}
            onFocus={() => setSuggestOpen(true)}
            placeholder="지점 찾기 (한글명·영문명)"
            title="지점 찾기"
            className="standard-search-input focus:ring-0 focus:ring-offset-0"
            autoComplete="off"
          />
        </div>
        {suggestOpen && suggestions.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-40 overflow-auto rounded border border-border bg-background shadow-md">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  title={`${s.sensorKorNm}(${s.sensorNm})`}
                  className="flex w-full cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left text-[11px] hover:bg-muted/60"
                  onClick={() => pick(s)}
                >
                  <span className="font-medium text-foreground">
                    {s.sensorKorNm}
                    <span className="text-muted-foreground">({s.sensorNm})</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.agency} · {s.emdNm}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="standard-list-scroll min-h-0 flex-1">
        <table className="standard-list-table">
          <thead className="standard-table-thead">
            <tr>
              <th className="standard-table-th standard-table-th-left">지점</th>
              <th className="standard-table-th standard-table-th-left w-[18%]">상태</th>
              <th className="standard-table-th standard-table-th-left w-[18%]">농도</th>
              <th className="standard-table-th standard-table-th-left w-[14%]">설비</th>
              <th className="standard-table-th !w-6 px-0.5">
                <span className="sr-only">상세</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="standard-table-empty">
                  조건에 맞는 기기가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const node = byKey.get(row.sensorKey)
                const selected = node != null && selectedSensorId === node.id
                return (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  title={`${row.sensorKorNm} 상세`}
                  onClick={() => pick(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      pick(row)
                    }
                  }}
                  className={cn(
                    'standard-list-row cursor-pointer',
                    selected && 'standard-list-row-selected'
                  )}
                >
                  <td className="standard-table-td-text" title={row.sensorKorNm}>
                    <span className="block truncate font-medium">{row.sensorKorNm}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {row.sensorNm} · {row.emdNm}
                    </span>
                  </td>
                  <td className="standard-table-td-compact">
                    <span
                      className={cn(
                        'inline-flex rounded px-1 py-0.5 text-[10px] font-medium',
                        row.status === 'normal' &&
                          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                        row.status === 'caution' &&
                          'bg-orange-500/15 text-orange-700 dark:text-orange-300',
                        row.status === 'warning' &&
                          'bg-red-500/15 text-red-700 dark:text-red-300'
                      )}
                    >
                      {odorStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="standard-table-td-date tabular-nums">{row.ppm.toFixed(1)}</td>
                  <td className="standard-table-td-compact">
                    {row.abatementRunning ? '가동' : '정지'}
                  </td>
                  <td className="standard-table-td-compact !w-6 px-0.5 text-center">
                    <ChevronRight
                      className="mx-auto h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden
                    />
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
