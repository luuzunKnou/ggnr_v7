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
    sensorNm: `NEW-${alertSeq}`,
    sensorKey: null,
    agency: '가람환경기술',
    emdNm: '장량동',
    lon: null,
    lat: null,
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

type CommDisconnectNode = {
  id: string
  label: string
  agency?: string
  sensorNm?: string
  sensorKey?: number | null
  lon?: number | null
  lat?: number | null
  lastRecvAt: string | null
  status: 'ok' | 'delayed' | 'disconnect'
  kind: string
}

/**
 * 통신계통도 두절 센서 → 장애(fault) 경보 upsert.
 * 복구(정상·지연)된 계통 경보는 recovered=true 처리.
 */
export function syncOdorCommDisconnectFaults(nodes: CommDisconnectNode[]): void {
  const cur = getState()
  const disconnect = nodes.filter((n) => n.kind === 'sensor' && n.status === 'disconnect')
  const activeIds = new Set(disconnect.map((n) => `oa-comm-${n.id}`))
  const byId = new Map(cur.alerts.map((a) => [a.id, a]))
  let changed = false
  let latestPopup: string | null = cur.latestPopupAlertId
  const next = [...cur.alerts]

  for (const n of disconnect) {
    const id = `oa-comm-${n.id}`
    const existing = byId.get(id)
    if (existing) {
      if (existing.recovered || existing.lastRecvAt !== n.lastRecvAt) {
        const idx = next.findIndex((a) => a.id === id)
        if (idx >= 0) {
          next[idx] = {
            ...existing,
            recovered: false,
            lastRecvAt: n.lastRecvAt,
            occurredAt: existing.recovered ? new Date().toISOString() : existing.occurredAt,
          }
          changed = true
          if (existing.recovered) latestPopup = id
        }
      }
      continue
    }
    alertSeq += 1
    const row: OdorAlertRow = {
      id,
      kind: 'fault',
      grade: null,
      sensorLabel: n.label,
      sensorNm: n.sensorNm ?? n.label,
      sensorKey: n.sensorKey ?? null,
      agency: n.agency ?? '통신계통',
      emdNm: '—',
      lon: n.lon ?? null,
      lat: n.lat ?? null,
      occurredAt: new Date().toISOString(),
      acked: false,
      recovered: false,
      scrubberAutoOn: null,
      lastRecvAt: n.lastRecvAt,
    }
    next.unshift(row)
    byId.set(id, row)
    latestPopup = id
    changed = true
  }

  for (let i = 0; i < next.length; i++) {
    const a = next[i]
    if (!a.id.startsWith('oa-comm-')) continue
    if (activeIds.has(a.id)) continue
    if (!a.recovered) {
      next[i] = { ...a, recovered: true }
      changed = true
    }
  }

  if (!changed) return
  setState({
    ...cur,
    alerts: next,
    latestPopupAlertId: latestPopup,
  })
}
