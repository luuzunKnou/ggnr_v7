'use client'

import { ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCommTime } from './odorSystemStatusJudge'
import type { OdorCommNodeView } from './odorSystemStatusTypes'
import { ODOR_COMM_STATUS_LABEL } from './odorSystemStatusTypes'

type Props = {
  /** 계통도에서 선택한 노드 (업체·인프라·게이트웨이) */
  node: OdorCommNodeView
  /** 업체 목록에서 드릴인한 센서 */
  sensorDetail: OdorCommNodeView | null
  /** 업체 선택 시 하위 센서 목록 */
  agencySensors: OdorCommNodeView[]
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

function StatusBadge({ status }: { status: OdorCommNodeView['status'] }) {
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
    const gw = sensorDetail.gatewayId ?? sensorDetail.gatewayLabel ?? 'GW'
    return `${gw} ↔ ${sensorDetail.label}`
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
    case 'gateway':
      return `${node.agency ?? '업체'} ↔ ${node.gatewayLabel ?? node.label}`
    case 'sensor':
      return `${node.gatewayId ?? 'GW'} ↔ ${node.label}`
    default:
      return '구간'
  }
}

export function OdorSystemStatusExpandPanel({
  node,
  sensorDetail,
  agencySensors,
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
      ? `${node.label} · 센서 목록`
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
    if (node.kind === 'gateway') {
      return [
        { label: '게이트웨이', value: node.gatewayLabel ?? node.label },
        { label: '상태', value: d?.runStatus ?? ODOR_COMM_STATUS_LABEL[node.status] },
        { label: '백홈링', value: d?.backhaul ?? 'LTE-M' },
        { label: '수용 측정점', value: d?.acceptPoints ?? '—' },
        { label: '링크', value: d?.radioLink ?? '—' },
      ]
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
              title="센서 목록으로"
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

      <div className="standard-detail-scroll">
        {showSensor ? (
          <SensorDetailBody node={sensorDetail} onGoToStation={onGoToStation} />
        ) : null}

        {!showSensor && node.kind === 'agency' ? (
          <AgencySensorList sensors={agencySensors} onSelectSensor={onSelectSensor} />
        ) : null}

        {!showSensor && detailRows ? (
          <section className="standard-detail-section-block-first">
            <div className="standard-detail-section-body !px-0">
              <AttrRows rows={detailRows} />
            </div>
          </section>
        ) : null}
      </div>
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
    { label: '통신', value: d?.runStatus ?? ODOR_COMM_STATUS_LABEL[node.status] },
    { label: '연결 GW', value: node.gatewayId ?? '—' },
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
        <StatusBadge status={node.status} />
      </div>
      <div className="standard-detail-section-body !px-0">
        <AttrRows rows={rows} />
      </div>
      {onGoToStation && node.sensorKey != null ? (
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

function AgencySensorList({
  sensors,
  onSelectSensor,
}: {
  sensors: OdorCommNodeView[]
  onSelectSensor: (sensor: OdorCommNodeView) => void
}) {
  if (sensors.length === 0) {
    return <p className="standard-detail-attr-empty">등록된 센서가 없습니다.</p>
  }

  return (
    <ul className="overflow-hidden rounded border border-border">
      {sensors.map((s) => (
        <li key={s.id} className="border-b border-border last:border-b-0">
          <button
            type="button"
            title={s.label}
            onClick={() => onSelectSensor(s)}
            className="standard-list-row standard-map-float-row-hover flex w-full cursor-pointer items-center gap-1.5 border-b-0 px-2 py-1.5 text-left"
          >
            <StatusBadge status={s.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {s.label}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {s.stationId ?? s.sensorNm ?? ''}
                {s.detail?.h2s ? ` · ${s.detail.h2s}` : ''}
              </span>
            </span>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </button>
        </li>
      ))}
    </ul>
  )
}
