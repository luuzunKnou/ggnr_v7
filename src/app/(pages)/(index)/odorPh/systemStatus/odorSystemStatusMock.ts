import { MOCK_ODOR_SENSORS_FROM_DB } from '@/service/odorSensorMock'
import type { OdorCommGraph, OdorCommLink, OdorCommNode } from './odorSystemStatusTypes'

const ID = {
  ipsec: 'comm-ipsec',
  db: 'comm-db',
  utm: 'comm-utm',
  iot: 'comm-iot',
  master: 'comm-master',
  garam: 'comm-agency-garam',
  dio: 'comm-agency-dio',
  gwGaram: 'comm-gw-garam',
  gwDio: 'comm-gw-dio',
} as const

function minutesAgoIso(nowMs: number, minutes: number): string {
  return new Date(nowMs - minutes * 60_000).toISOString()
}

/**
 * 목업 계통도.
 * 센서는 데이터만 두고 계통도에는 그리지 않음(업체 클릭 시 우측 확장).
 */
export function createOdorSystemStatusGraph(nowMs: number = Date.now()): OdorCommGraph {
  const judgedAt = new Date(nowMs).toISOString()
  const nodes: OdorCommNode[] = [
    {
      id: ID.ipsec,
      kind: 'ipsec',
      label: 'IPsec VPN',
      parentId: null,
      lastRecvAt: minutesAgoIso(nowMs, 1),
      collectRate: 99,
      detail: {
        peerLine: 'Ap 서버 ↔ 행정망',
        runStatus: '정상',
      },
    },
    {
      id: ID.db,
      kind: 'db',
      label: 'DB 서버(악취정보)',
      parentId: ID.ipsec,
      lastRecvAt: minutesAgoIso(nowMs, 1),
      collectRate: 87.5,
      detail: {
        runStatus: '정상 가동',
        redundancy: '이중화(Active-Standby)',
        collectTag: 'Full TAG · 10분 주기(1~30분 설정)',
        collectRateText: '87.5%',
      },
    },
    {
      id: ID.utm,
      kind: 'utm',
      label: 'VPN / 방화벽(UTM)',
      parentId: ID.db,
      lastRecvAt: minutesAgoIso(nowMs, 1),
      collectRate: 99,
      detail: {
        runStatus: '정상',
        tunnel: 'F/W+IPS+VPN',
        linkSystem: '하수관망관리시스템',
        peerLine: 'TM/TC Master ⇔ DB 서버',
      },
    },
    {
      id: ID.iot,
      kind: 'iot',
      label: 'IoT 서버',
      parentId: ID.utm,
      lastRecvAt: minutesAgoIso(nowMs, 2),
      collectRate: 92,
      detail: {
        runStatus: '정상 가동',
        redundancy: '이중화(Active-Standby)',
        collectTag: 'Full TAG · 10분 주기(1~30분 설정)',
        collectRateText: '92%',
      },
    },
    {
      id: ID.master,
      kind: 'master',
      label: 'TM/TC Master',
      parentId: ID.iot,
      lastRecvAt: minutesAgoIso(nowMs, 2),
      collectRate: 87.5,
      detail: {
        runStatus: '정상 가동',
        redundancy: '이중화(Active-Standby)',
        collectTag: 'Full TAG · 10분 주기(1~30분 설정)',
        collectRateText: '87.5%',
      },
    },
    {
      id: ID.garam,
      kind: 'agency',
      label: '가람환경기술',
      parentId: ID.master,
      agency: '가람환경기술',
      lastRecvAt: minutesAgoIso(nowMs, 3),
      collectRate: 94,
    },
    {
      id: ID.dio,
      kind: 'agency',
      label: '디오솔류션',
      parentId: ID.master,
      agency: '디오솔류션',
      lastRecvAt: minutesAgoIso(nowMs, 4),
      collectRate: 91,
    },
    {
      id: ID.gwGaram,
      kind: 'gateway',
      label: 'Gateway GW-1',
      parentId: ID.garam,
      agency: '가람환경기술',
      gatewayId: 'GW-1',
      gatewayLabel: 'Gateway GW-1',
      lastRecvAt: minutesAgoIso(nowMs, 3),
      collectRate: 94,
      detail: {
        runStatus: '정상',
        backhaul: 'LTE-M',
        acceptPoints: '15개',
        radioLink: '사설 LoRA 1:15',
      },
    },
    {
      id: ID.gwDio,
      kind: 'gateway',
      label: 'Gateway GW-2',
      parentId: ID.dio,
      agency: '디오솔류션',
      gatewayId: 'GW-2',
      gatewayLabel: 'Gateway GW-2',
      lastRecvAt: minutesAgoIso(nowMs, 4),
      collectRate: 91,
      detail: {
        runStatus: '정상',
        backhaul: 'LTE-M',
        acceptPoints: '2개',
        radioLink: '사설 LoRA 1:2',
      },
    },
  ]

  const links: OdorCommLink[] = [
    { id: 'l-ipsec-db', fromId: ID.ipsec, toId: ID.db },
    { id: 'l-db-utm', fromId: ID.db, toId: ID.utm },
    { id: 'l-utm-iot', fromId: ID.utm, toId: ID.iot },
    { id: 'l-iot-master', fromId: ID.iot, toId: ID.master },
    { id: 'l-master-garam', fromId: ID.master, toId: ID.garam },
    { id: 'l-master-dio', fromId: ID.master, toId: ID.dio },
    { id: 'l-garam-gw', fromId: ID.garam, toId: ID.gwGaram },
    { id: 'l-dio-gw', fromId: ID.dio, toId: ID.gwDio },
  ]

  /** sensorKey → 미수신 분 (없으면 1~5분 정상) */
  const delayByKey: Record<number, number> = {
    3: 14,
    8: 22,
    12: 38,
    15: 45,
    16: 18,
    17: 55,
  }

  const garamSensors = MOCK_ODOR_SENSORS_FROM_DB.filter((s) => s.agency === '가람환경기술')
  const dioSensors = MOCK_ODOR_SENSORS_FROM_DB.filter((s) => s.agency === '디오솔류션')

  // gateway acceptPoints / radioLink를 실센서 수에 맞춤
  const gwGaram = nodes.find((n) => n.id === ID.gwGaram)
  if (gwGaram?.detail) {
    const abnormal = garamSensors.filter((s) => (delayByKey[s.sensorKey] ?? 0) >= 30).length
    gwGaram.detail.acceptPoints = `${garamSensors.length}개 (이상 ${abnormal})`
    gwGaram.detail.radioLink = `사설 LoRA 1:${garamSensors.length}`
  }
  const gwDio = nodes.find((n) => n.id === ID.gwDio)
  if (gwDio?.detail) {
    const abnormal = dioSensors.filter((s) => (delayByKey[s.sensorKey] ?? 0) >= 30).length
    gwDio.detail.acceptPoints = `${dioSensors.length}개 (이상 ${abnormal})`
    gwDio.detail.radioLink = `사설 LoRA 1:${dioSensors.length}`
  }

  for (const s of MOCK_ODOR_SENSORS_FROM_DB) {
    const isDio = s.agency === '디오솔류션'
    const gwId = isDio ? ID.gwDio : ID.gwGaram
    const gwLabel = isDio ? 'GW-2' : 'GW-1'
    const mins = delayByKey[s.sensorKey] ?? ((s.sensorKey % 5) + 1)
    const collectRate =
      mins >= 30
        ? Math.max(0, 40 - (mins - 30))
        : mins >= 10
          ? 70 + (s.sensorKey % 10)
          : 90 + (s.sensorKey % 10)
    const id = `comm-sensor-${s.sensorKey}`
    const stationId = `PH-${String(s.sensorKey).padStart(3, '0')}`
    const h2sPpm = (0.2 + (s.sensorKey % 7) * 0.07).toFixed(2)
    const grade = mins >= 30 ? '통신불량' : Number(h2sPpm) >= 0.5 ? '2등급' : '1등급'
    nodes.push({
      id,
      kind: 'sensor',
      label: s.sensorKorNm,
      parentId: gwId,
      lastRecvAt: minutesAgoIso(nowMs, mins),
      collectRate,
      agency: s.agency,
      gatewayId: gwLabel,
      gatewayLabel: isDio ? 'Gateway GW-2' : 'Gateway GW-1',
      sensorKey: s.sensorKey,
      sensorNm: s.sensorNm,
      stationId,
      lon: s.lon,
      lat: s.lat,
      detail: {
        runStatus: mins >= 30 ? '두절' : mins >= 10 ? '지연' : '정상',
        h2s: `${h2sPpm} ppm (${grade})`,
      },
    })
    links.push({
      id: `l-${gwId}-${id}`,
      fromId: gwId,
      toId: id,
    })
  }

  return { nodes, links, judgedAt }
}
