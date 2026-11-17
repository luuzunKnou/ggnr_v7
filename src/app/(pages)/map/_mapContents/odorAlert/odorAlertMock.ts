import type { OdorAlertGrade, OdorAlertKind, OdorAckMode } from './odorAlertConfig'

export type OdorAlertRow = {
  id: string
  kind: OdorAlertKind
  grade: OdorAlertGrade | null
  sensorLabel: string
  agency: string
  emdNm: string
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

export function createOdorAlertMockRows(): OdorAlertRow[] {
  return [
    {
      id: 'oa-1',
      kind: 'odor',
      grade: 5,
      sensorLabel: '오천-09',
      agency: '동해환경',
      emdNm: '오천읍',
      occurredAt: '2026-11-16T10:11:00+09:00',
      acked: false,
      recovered: false,
      scrubberAutoOn: true,
      lastRecvAt: null,
    },
    {
      id: 'oa-2',
      kind: 'odor',
      grade: 4,
      sensorLabel: '해도-05',
      agency: '포항맑은물',
      emdNm: '해도동',
      occurredAt: '2026-11-16T11:05:00+09:00',
      acked: false,
      recovered: false,
      scrubberAutoOn: true,
      lastRecvAt: null,
    },
    {
      id: 'oa-3',
      kind: 'odor',
      grade: 4,
      sensorLabel: '연일-04',
      agency: '북구사업소',
      emdNm: '연일읍',
      occurredAt: '2026-11-16T08:55:00+09:00',
      acked: true,
      recovered: false,
      scrubberAutoOn: false,
      lastRecvAt: null,
    },
    {
      id: 'oa-4',
      kind: 'odor',
      grade: 3,
      sensorLabel: '장량동-03',
      agency: '포항맑은물',
      emdNm: '장량동',
      occurredAt: '2026-11-16T10:42:00+09:00',
      acked: false,
      recovered: false,
      scrubberAutoOn: true,
      lastRecvAt: null,
    },
    {
      id: 'oa-5',
      kind: 'odor',
      grade: 3,
      sensorLabel: '양덕-12',
      agency: '동해환경',
      emdNm: '양덕동',
      occurredAt: '2026-11-16T09:18:00+09:00',
      acked: false,
      recovered: true,
      scrubberAutoOn: false,
      lastRecvAt: null,
    },
    {
      id: 'oa-6',
      kind: 'odor',
      grade: 3,
      sensorLabel: '구룡포-01',
      agency: '구룡포관측',
      emdNm: '구룡포읍',
      occurredAt: '2026-11-15T22:05:00+09:00',
      acked: true,
      recovered: true,
      scrubberAutoOn: true,
      lastRecvAt: null,
    },
    {
      id: 'oa-7',
      kind: 'odor',
      grade: 3,
      sensorLabel: '상대-02',
      agency: '남구사업소',
      emdNm: '상대동',
      occurredAt: '2026-11-15T14:12:00+09:00',
      acked: false,
      recovered: false,
      scrubberAutoOn: null,
      lastRecvAt: null,
    },
    {
      id: 'oa-8',
      kind: 'fault',
      grade: null,
      sensorLabel: '흥해-07',
      agency: '영일만측정',
      emdNm: '흥해읍',
      occurredAt: '2026-11-16T09:40:00+09:00',
      acked: false,
      recovered: false,
      scrubberAutoOn: null,
      lastRecvAt: '2026-11-16T09:08:00+09:00',
    },
    {
      id: 'oa-9',
      kind: 'fault',
      grade: null,
      sensorLabel: '기계-02',
      agency: '북구사업소',
      emdNm: '기계면',
      occurredAt: '2026-11-16T07:20:00+09:00',
      acked: true,
      recovered: false,
      scrubberAutoOn: null,
      lastRecvAt: '2026-11-16T06:45:00+09:00',
    },
    {
      id: 'oa-10',
      kind: 'fault',
      grade: null,
      sensorLabel: '호미곶-01',
      agency: '동해환경',
      emdNm: '호미곶면',
      occurredAt: '2026-11-15T19:00:00+09:00',
      acked: false,
      recovered: true,
      scrubberAutoOn: null,
      lastRecvAt: '2026-11-15T18:28:00+09:00',
    },
  ]
}

export function createOdorAckHistoryMock(): OdorAckHistoryRow[] {
  return [
    {
      id: 'ah-1',
      alertId: 'oa-6',
      sensorLabel: '구룡포-01',
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
      sensorLabel: '연일-04',
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
      sensorLabel: '기계-02',
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
      sensorLabel: '장량동-03',
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
      sensorLabel: '해도-05',
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
      sensorLabel: '양덕-12',
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
