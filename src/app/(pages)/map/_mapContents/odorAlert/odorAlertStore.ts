'use client'

/**
 * 경보 목업 저장소 — 새로고침 전까지만 유지
 */

import { useSyncExternalStore } from 'react'
import type { OdorAckMode, OdorAlertGrade } from './odorAlertConfig'
import {
  createOdorAckHistoryMock,
  createOdorAlertMockRows,
  type OdorAckHistoryRow,
  type OdorAlertRow,
} from './odorAlertMock'

type State = {
  alerts: OdorAlertRow[]
  history: OdorAckHistoryRow[]
  /** 팝업용 — 방금 추가된 신규 경보 id */
  latestPopupAlertId: string | null
}

function initialState(): State {
  return {
    alerts: createOdorAlertMockRows(),
    history: createOdorAckHistoryMock(),
    latestPopupAlertId: null,
  }
}

let state: State | null = null
const listeners = new Set<() => void>()
let histSeq = 100
let alertSeq = 100

function getState(): State {
  if (!state) state = initialState()
  return state
}

function setState(next: State) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOdorAlertStore(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function acknowledgeOdorAlerts(params: {
  alertIds: string[]
  reason: string
  mode: OdorAckMode
  actor?: string
}): void {
  const reason = params.reason.trim()
  if (!reason || params.alertIds.length === 0) return
  const actor = params.actor?.trim() || '목업사용자'
  const at = new Date().toISOString()
  const cur = getState()
  const idSet = new Set(params.alertIds)
  const nextAlerts = cur.alerts.map((a) => (idSet.has(a.id) ? { ...a, acked: true } : a))
  const added: OdorAckHistoryRow[] = []
  for (const id of params.alertIds) {
    const row = cur.alerts.find((a) => a.id === id)
    if (!row || row.acked) continue
    histSeq += 1
    added.push({
      id: `ah-${histSeq}`,
      alertId: row.id,
      sensorLabel: row.sensorLabel,
      mode: params.mode,
      reason,
      actor,
      at,
      kind: row.kind,
      grade: row.grade,
    })
  }
  setState({
    ...cur,
    alerts: nextAlerts,
    history: [...added, ...cur.history],
  })
}

/** 신규 경보 시뮬레이션 (자동 팝업용) */
export function pushMockNewOdorAlert(): string {
  const cur = getState()
  alertSeq += 1
  const id = `oa-new-${alertSeq}`
  const grade = (alertSeq % 2 === 0 ? 4 : 3) as OdorAlertGrade
  const row: OdorAlertRow = {
    id,
    kind: 'odor',
    grade,
    sensorLabel: `신규-${alertSeq}`,
    agency: '포항맑은물',
    emdNm: '장량동',
    occurredAt: new Date().toISOString(),
    acked: false,
    recovered: false,
    scrubberAutoOn: true,
    lastRecvAt: null,
  }
  setState({
    ...cur,
    alerts: [row, ...cur.alerts],
    latestPopupAlertId: id,
  })
  return id
}

export function clearOdorAlertPopup(): void {
  const cur = getState()
  if (!cur.latestPopupAlertId) return
  setState({ ...cur, latestPopupAlertId: null })
}

export function resetOdorAlertMockStore(): void {
  state = initialState()
  listeners.forEach((l) => l())
}
