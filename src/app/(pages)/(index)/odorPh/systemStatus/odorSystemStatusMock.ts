import { MOCK_ODOR_SENSORS_FROM_DB } from '@/service/odorSensorMock'
import { ODOR_SYSTEM_STATUS_INFRA_SITE_LONLAT } from '@/app/(pages)/map/_mapContents/odorSystemStatus/odorSystemStatusConfig'
import type { OdorCommGraph, OdorCommLink, OdorCommNode } from './odorSystemStatusTypes'

const ID = {
  ipsec: 'comm-ipsec',
  db: 'comm-db',
  utm: 'comm-utm',
  iot: 'comm-iot',
  master: 'comm-master',
  garam: 'comm-agency-garam',
  dio: 'comm-agency-dio',
} as const

/** 죽도 빗물펌프장 — Master·IoT·DB·AP */
const [INFRA_LON, INFRA_LAT] = ODOR_SYSTEM_STATUS_INFRA_SITE_LONLAT

function minutesAgoIso(nowMs: number, minutes: number): string {
  return new Date(nowMs - minutes * 60_000).toISOString()
}

/**
 * 목업 통신 목록 그래프.
 * 게이트웨이 없음 — 센서는 업체 직속(목록에는 미표시, 업체 클릭 시 우측 확장).
 * 전부 연결 정상 전제.
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
      lon: INFRA_LON,
      lat: INFRA_LAT,
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
      collectRate: 99,
      lon: INFRA_LON,
      lat: INFRA_LAT,
      detail: {
        runStatus: '정상 가동',
        redundancy: '이중화(Active-Standby)',
        collectTag: 'Full TAG · 10분 주기(1~30분 설정)',
        collectRateText: '99%',
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
      collectRate: 99,
      lon: INFRA_LON,
      lat: INFRA_LAT,
      detail: {
        runStatus: '정상 가동',
        redundancy: '이중화(Active-Standby)',
        collectTag: 'Full TAG · 10분 주기(1~30분 설정)',
        collectRateText: '99%',
      },
    },
    {
      id: ID.master,
      kind: 'master',
      label: 'TM/TC Master',
      parentId: ID.iot,
      lastRecvAt: minutesAgoIso(nowMs, 2),
      collectRate: 99,
      lon: INFRA_LON,
      lat: INFRA_LAT,
      detail: {
        runStatus: '정상 가동',
        redundancy: '이중화(Active-Standby)',
        collectTag: 'Full TAG · 10분 주기(1~30분 설정)',
        collectRateText: '99%',
      },
    },
    {
      id: ID.garam,
      kind: 'agency',
      label: '가람환경기술',
      parentId: ID.master,
      agency: '가람환경기술',
      lastRecvAt: minutesAgoIso(nowMs, 2),
      collectRate: 99,
    },
    {
      id: ID.dio,
      kind: 'agency',
      label: '디오솔류션',
      parentId: ID.master,
      agency: '디오솔류션',
      lastRecvAt: minutesAgoIso(nowMs, 2),
      collectRate: 99,
    },
  ]

  const links: OdorCommLink[] = [
    { id: 'l-ipsec-db', fromId: ID.ipsec, toId: ID.db },
    { id: 'l-db-utm', fromId: ID.db, toId: ID.utm },
    { id: 'l-utm-iot', fromId: ID.utm, toId: ID.iot },
    { id: 'l-iot-master', fromId: ID.iot, toId: ID.master },
    { id: 'l-master-garam', fromId: ID.master, toId: ID.garam },
    { id: 'l-master-dio', fromId: ID.master, toId: ID.dio },
  ]

  for (const s of MOCK_ODOR_SENSORS_FROM_DB) {
    const isDio = s.agency === '디오솔류션'
    const agencyId = isDio ? ID.dio : ID.garam
    const mins = (s.sensorKey % 4) + 1
    const id = `comm-sensor-${s.sensorKey}`
    const stationId = `PH-${String(s.sensorKey).padStart(3, '0')}`
    const h2sPpm = (0.2 + (s.sensorKey % 7) * 0.07).toFixed(2)
    const grade = Number(h2sPpm) >= 0.5 ? '2등급' : '1등급'
    nodes.push({
      id,
      kind: 'sensor',
      label: s.sensorKorNm,
      parentId: agencyId,
      lastRecvAt: minutesAgoIso(nowMs, mins),
      collectRate: 95 + (s.sensorKey % 5),
      agency: s.agency,
      sensorKey: s.sensorKey,
      sensorNm: s.sensorNm,
      stationId,
      lon: s.lon,
      lat: s.lat,
      detail: {
        runStatus: '정상',
        h2s: `${h2sPpm} ppm (${grade})`,
      },
    })
    links.push({
      id: `l-${agencyId}-${id}`,
      fromId: agencyId,
      toId: id,
    })
  }

  return { nodes, links, judgedAt }
}
