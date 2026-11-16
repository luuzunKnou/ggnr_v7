'use client'

/**
 * 소규모 공공시설 — 후보지·안전점검 두 메뉴가 함께 쓰는 예시 자료 저장소.
 * 새로고침 전까지만 유지된다(서버 저장 전 화면 확인용).
 */

import { useSyncExternalStore } from 'react'
import {
  createSmallPublicMockFacilities,
  createSmallPublicMockInspections,
  type SmallPublicFacility,
  type SmallPublicFile,
  type SmallPublicInspection,
} from './smallPublicMock'

type State = {
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
}

/**
 * 예시 자료 — 2025년 이후 정기점검이 있는 시설만 처음부터 안전점검 대상으로 둔다
 * (현장조사 결과만 있는 시설은 안전점검 «시설 등록»에서 골라 넣는 예시).
 */
function initialState(): State {
  const facilities = createSmallPublicMockFacilities()
  const inspections = createSmallPublicMockInspections(facilities)
  const inspected = new Set(inspections.filter((i) => i.date >= '2025').map((i) => i.facilityId))
  return {
    facilities: facilities.map((f) => ({ ...f, inspectionTarget: inspected.has(f.id) })),
    inspections,
  }
}

let state: State | null = null
const listeners = new Set<() => void>()
let newFacilitySeq = 0

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

export function useSmallPublicStore(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** 화면에서 고른 파일 — 이 세션 동안 미리보기·내려받기용 주소를 만든다 */
export function smallPublicFileFromUpload(file: File): SmallPublicFile {
  return {
    id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    url: URL.createObjectURL(file),
  }
}

export function inspectionsOfFacility(
  inspections: SmallPublicInspection[],
  facilityId: string
): SmallPublicInspection[] {
  return inspections
    .filter((i) => i.facilityId === facilityId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

/** 시설의 위험도등급·점수 = 가장 최근 점검 */
export function latestInspectionOf(
  inspections: SmallPublicInspection[],
  facilityId: string
): SmallPublicInspection | null {
  return inspectionsOfFacility(inspections, facilityId)[0] ?? null
}

export const smallPublicActions = {
  updateFacility(id: string, patch: Partial<SmallPublicFacility>) {
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })
  },

  saveInspection(next: SmallPublicInspection) {
    const s = getState()
    const exists = s.inspections.some((i) => i.id === next.id)
    setState({
      ...s,
      inspections: exists
        ? s.inspections.map((i) => (i.id === next.id ? next : i))
        : [...s.inspections, next],
    })
  },

  deleteInspection(id: string) {
    const s = getState()
    setState({ ...s, inspections: s.inspections.filter((i) => i.id !== id) })
  },

  addPlanFiles(facilityId: string, files: SmallPublicFile[]) {
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.map((f) =>
        f.id === facilityId ? { ...f, planFiles: [...f.planFiles, ...files] } : f
      ),
    })
  },

  removePlanFile(facilityId: string, fileId: string) {
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.map((f) =>
        f.id === facilityId ? { ...f, planFiles: f.planFiles.filter((p) => p.id !== fileId) } : f
      ),
    })
  },

  /** 후보지 «후보지 등록» — 새 시설. 관리번호는 저장 때 임시 번호(신규-0001…)로 붙임 */
  addFacility(
    draft: Omit<SmallPublicFacility, 'id' | 'mngNo' | 'planFiles' | 'inspectionTarget'>
  ): SmallPublicFacility {
    const s = getState()
    newFacilitySeq += 1
    const mngNo = `신규-${String(newFacilitySeq).padStart(4, '0')}`
    const facility: SmallPublicFacility = { ...draft, id: mngNo, mngNo, planFiles: [], inspectionTarget: false }
    setState({ ...s, facilities: [...s.facilities, facility] })
    return facility
  },

  /** 안전점검 «시설 등록» — 후보지 시설을 점검 대상으로 */
  registerInspectionTargets(ids: string[]) {
    const s = getState()
    const set = new Set(ids)
    setState({
      ...s,
      facilities: s.facilities.map((f) => (set.has(f.id) ? { ...f, inspectionTarget: true } : f)),
    })
  },
}
