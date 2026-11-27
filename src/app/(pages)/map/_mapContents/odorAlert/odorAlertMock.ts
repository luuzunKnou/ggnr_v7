import { buildDashboardGradeMock } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { MOCK_ODOR_SENSORS_FROM_DB } from '@/service/odorSensorMock'
import type { OdorAlertGrade, OdorAlertKind, OdorAckMode } from './odorAlertConfig'

export type OdorAlertRow = {
  id: string
  kind: OdorAlertKind
  grade: OdorAlertGrade | null
  sensorLabel: string
  sensorNm: string
  sensorKey: number | null
  agency: string
  emdNm: string
  lon: number | null
  lat: number | null
  occurredAt: string
  /** 인지(해제) 여부 */
  acked: boolean
  /** 정상 복귀 여부 — false면 미복귀 */
  recovered: boolean
  /** 제거설비 자동 가동 여부 (악취 경보) */
  scrubberAutoOn: boolean | null
  /** 장애: 마지막 수신 시각 */
  lastRecvAt: string | null
}

export type OdorAckHistoryRow = {
  id: string
  alertId: string
  sensorLabel: string
  mode: OdorAckMode
  reason: string
  actor: string
  at: string
  kind: OdorAlertKind
  grade: OdorAlertGrade | null
}

type AlertSeed = {
  sensorKey: number
  kind: OdorAlertKind
  grade: OdorAlertGrade | null
  occurredAt: string
  acked: boolean
  recovered: boolean
  scrubberAutoOn: boolean | null
  lastRecvAt: string | null
}

/** 대시보드2 센서 더미 중 경보 시나리오용 시드 */
const ALERT_SEEDS: AlertSeed[] = [
  {
    sensorKey: 1,
    kind: 'odor',
    grade: 5,
    occurredAt: '2026-11-16T10:11:00+09:00',
    acked: false,
    recovered: false,
    scrubberAutoOn: true,
    lastRecvAt: null,
  },
  {
    sensorKey: 16,
    kind: 'odor',
    grade: 4,
    occurredAt: '2026-11-16T11:05:00+09:00',
    acked: false,
    recovered: false,
    scrubberAutoOn: true,
    lastRecvAt: null,
  },
  {
    sensorKey: 4,
    kind: 'odor',
    grade: 4,
    occurredAt: '2026-11-16T08:55:00+09:00',
    acked: true,
    recovered: false,
    scrubberAutoOn: false,
    lastRecvAt: null,
  },
  {
    sensorKey: 17,
    kind: 'odor',
    grade: 3,
    occurredAt: '2026-11-16T10:42:00+09:00',
    acked: false,
    recovered: false,
    scrubberAutoOn: true,
    lastRecvAt: null,
  },
  {
    sensorKey: 7,
    kind: 'odor',
    grade: 3,
    occurredAt: '2026-11-16T09:18:00+09:00',
    acked: false,
    recovered: true,
    scrubberAutoOn: false,
    lastRecvAt: null,
  },
  {
    sensorKey: 10,
    kind: 'odor',
    grade: 3,
    occurredAt: '2026-11-15T22:05:00+09:00',
    acked: true,
    recovered: true,
    scrubberAutoOn: true,
    lastRecvAt: null,
  },
  {
    sensorKey: 12,
    kind: 'odor',
    grade: 3,
    occurredAt: '2026-11-15T14:12:00+09:00',
    acked: false,
    recovered: false,
    scrubberAutoOn: null,
    lastRecvAt: null,
  },
  {
    sensorKey: 3,
    kind: 'fault',
    grade: null,
    occurredAt: '2026-11-16T09:40:00+09:00',
    acked: false,
    recovered: false,
    scrubberAutoOn: null,
    lastRecvAt: '2026-11-16T09:08:00+09:00',
  },
  {
    sensorKey: 8,
    kind: 'fault',
    grade: null,
    occurredAt: '2026-11-16T07:20:00+09:00',
    acked: true,
    recovered: false,
    scrubberAutoOn: null,
    lastRecvAt: '2026-11-16T06:45:00+09:00',
  },
  {
    sensorKey: 15,
    kind: 'fault',
    grade: null,
    occurredAt: '2026-11-15T19:00:00+09:00',
    acked: false,
    recovered: true,
    scrubberAutoOn: null,
    lastRecvAt: '2026-11-15T18:28:00+09:00',
  },
]

export function createOdorAlertMockRows(): OdorAlertRow[] {
  const byKey = new Map(MOCK_ODOR_SENSORS_FROM_DB.map((s) => [s.sensorKey, s]))
  const { points } = buildDashboardGradeMock(
    MOCK_ODOR_SENSORS_FROM_DB.map((s) => ({
      sensorKey: s.sensorKey,
      agency: s.agency,
      sensorNm: s.sensorNm,
      sensorKorNm: s.sensorKorNm,
      lon: s.lon,
      lat: s.lat,
    }))
  )
  const emdByKey = new Map(
    points.map((p) => {
      const key = p.id.startsWith('pt-') ? Number(p.id.slice(3)) : Number(p.id)
      return [key, p.emdNm] as const
    })
  )

  return ALERT_SEEDS.flatMap((seed, i) => {
    const s = byKey.get(seed.sensorKey)
    if (!s) return []
    return [
      {
        id: `oa-${i + 1}`,
        kind: seed.kind,
        grade: seed.grade,
        sensorLabel: s.sensorKorNm,
        sensorNm: s.sensorNm,
        sensorKey: s.sensorKey,
        agency: s.agency,
        emdNm: emdByKey.get(s.sensorKey) ?? '—',
        lon: s.lon,
        lat: s.lat,
        occurredAt: seed.occurredAt,
        acked: seed.acked,
        recovered: seed.recovered,
        scrubberAutoOn: seed.scrubberAutoOn,
        lastRecvAt: seed.lastRecvAt,
      } satisfies OdorAlertRow,
    ]
  })
}

export function createOdorAckHistoryMock(): OdorAckHistoryRow[] {
  const rows = createOdorAlertMockRows()
  const label = (id: string) => rows.find((r) => r.id === id)?.sensorLabel ?? id
  return [
    {
      id: 'ah-1',
      alertId: 'oa-6',
      sensorLabel: label('oa-6'),
      mode: 'single',
      reason: '현장 확인 후 정상 범위',
      actor: '김하수',
      at: '2026-11-15T22:40:00+09:00',
      kind: 'odor',
      grade: 3,
    },
    {
      id: 'ah-2',
      alertId: 'oa-3',
      sensorLabel: label('oa-3'),
      mode: 'bulk',
      reason: '오전 일괄 인지(순찰 예정)',
      actor: '이맑은',
      at: '2026-11-16T09:10:00+09:00',
      kind: 'odor',
      grade: 4,
    },
    {
      id: 'ah-3',
      alertId: 'oa-9',
      sensorLabel: label('oa-9'),
      mode: 'single',
      reason: '통신 장비 점검 요청',
      actor: '박관측',
      at: '2026-11-16T08:05:00+09:00',
      kind: 'fault',
      grade: null,
    },
    /** Index «본인 이력» 데모 — 슈퍼관리자·목업사용자 로그인 시 노출 */
    {
      id: 'ah-4',
      alertId: 'oa-4',
      sensorLabel: label('oa-4'),
      mode: 'single',
      reason: '현장 순찰 후 인지',
      actor: '슈퍼관리자',
      at: '2026-11-16T11:20:00+09:00',
      kind: 'odor',
      grade: 3,
    },
    {
      id: 'ah-5',
      alertId: 'oa-2',
      sensorLabel: label('oa-2'),
      mode: 'bulk',
      reason: '일괄 인지 처리',
      actor: '슈퍼관리자',
      at: '2026-11-16T10:50:00+09:00',
      kind: 'odor',
      grade: 4,
    },
    {
      id: 'ah-6',
      alertId: 'oa-5',
      sensorLabel: label('oa-5'),
      mode: 'single',
      reason: '농도 하향 확인',
      actor: '목업사용자',
      at: '2026-11-16T09:45:00+09:00',
      kind: 'odor',
      grade: 3,
    },
  ]
}

export function formatOdorAlertTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}
