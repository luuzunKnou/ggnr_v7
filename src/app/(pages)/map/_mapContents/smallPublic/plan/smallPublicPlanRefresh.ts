'use client'

/**
 * 정비계획 목록 새로고침 신호 — 안전점검 이관처럼 정비계획 DB가 바뀌었을 때
 * 열려 있는 정비계획 화면이 다시 불러오도록 알린다.
 */
import { useSyncExternalStore } from 'react'

let seq = 0
const listeners = new Set<() => void>()

export function bumpSmallPublicPlanRefresh() {
  seq += 1
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSmallPublicPlanRefreshSeq(): number {
  return useSyncExternalStore(
    subscribe,
    () => seq,
    () => 0
  )
}
