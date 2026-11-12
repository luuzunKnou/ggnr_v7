'use client'

/**
 * 소규모 공공시설 — 후보지·안전점검(·정비계획)이 함께 쓰는 예시 자료 저장소.
 * 새로고침 전까지만 유지된다(서버 저장 전 화면 확인용).
 */

import { useSyncExternalStore } from 'react'
import type { SmallPublicClass } from './smallPublicConfig'
import {
  applySmallPublicPlanTransferDemo,
  createSmallPublicMockCandidateEvals,
  createSmallPublicMockFacilities,
  createSmallPublicMockInspections,
  createSmallPublicMockSafetyDocs,
  type SmallPublicCandidateEval,
  type SmallPublicDamageEvent,
  type SmallPublicFacility,
  type SmallPublicFile,
  type SmallPublicFileKind,
  type SmallPublicInspection,
  type SmallPublicSafetyDoc,
} from './smallPublicMock'
import {
  buildSmallPublicReportRows,
  smallPublicReportTitle,
  type SmallPublicInspectionReport,
  type SmallPublicReportRow,
} from './inspection/smallPublicInspectionReport'

type State = {
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  safetyDocs: SmallPublicSafetyDoc[]
  /** 안전점검 보고서 */
  reports: SmallPublicInspectionReport[]
}

const SAMPLE_AGENCY = '울진군 건설과'

function sampleReport(
  facilities: SmallPublicFacility[],
  inspections: SmallPublicInspection[],
  year: number
): SmallPublicInspectionReport {
  const baseDate = `${year}-01-02`
  return {
    id: `report-sample-${year}`,
    year,
    baseDate,
    title: smallPublicReportTitle(year),
    agency: SAMPLE_AGENCY,
    author: SAMPLE_AGENCY,
    summary: `${year}년 정기 안전점검 대상(일반·관리시설)과 위험시설 재점검 대상을 정리한다.`,
    createdAt: `${baseDate}T09:00:00`,
    rows: buildSmallPublicReportRows(facilities, inspections, baseDate),
    sample: true,
  }
}

/**
 * 예시 자료 — 일반·관리 시설은 자동 점검 대상이고, 2025년 이후 점검이 있는 위험시설만
 * 계속 점검 대상(예외)으로 둔다. 2025·2026년 보고서를 넣어 둔다.
 * «두천리_세천_004»는 2026년 점검에서 관리→위험으로 바꿔 정비계획 이관 예시에 쓴다.
 */
function initialState(): State {
  const base = createSmallPublicMockFacilities()
  /** 2025·2026년 예시 점검은 그해 예시 보고서에서 한 점검으로 둔다 */
  let inspections = createSmallPublicMockInspections(base).map((i) => {
    const y = i.date.slice(0, 4)
    return y === '2025' || y === '2026' ? { ...i, reportId: `report-sample-${y}` } : i
  })
  let facilities = base.map((f) => ({ ...f, inspectionTarget: f.candidate === '위험' }))
  const demo = applySmallPublicPlanTransferDemo(facilities, inspections)
  facilities = demo.facilities
  inspections = demo.inspections
  const inspected = new Set(inspections.filter((i) => i.date >= '2025').map((i) => i.facilityId))
  facilities = facilities.map((f) => ({
    ...f,
    inspectionTarget: f.candidate === '위험' && (f.inspectionTarget || inspected.has(f.id)),
  }))
  const candidateEvals = createSmallPublicMockCandidateEvals(facilities)
  const safetyDocs = createSmallPublicMockSafetyDocs(facilities)
  let seeded: State = {
    facilities,
    inspections,
    candidateEvals,
    safetyDocs,
    reports: [sampleReport(facilities, inspections, 2025), sampleReport(facilities, inspections, 2026)],
  }
  /** 후보지 평가·최근 점검과 시설 구분을 맞춤(세천 예시 선정제외 모순 방지) */
  for (const f of seeded.facilities) {
    seeded = { ...seeded, facilities: syncFacilityClass(seeded, f.id) }
  }
  return {
    ...seeded,
    reports: [sampleReport(seeded.facilities, seeded.inspections, 2025), sampleReport(seeded.facilities, seeded.inspections, 2026)],
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
export function smallPublicFileFromUpload(file: File, kind: SmallPublicFileKind = 'other'): SmallPublicFile {
  return {
    id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    url: URL.createObjectURL(file),
    kind,
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

export function candidateEvalsOfFacility(
  evals: SmallPublicCandidateEval[],
  facilityId: string
): SmallPublicCandidateEval[] {
  return evals
    .filter((e) => e.facilityId === facilityId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export function safetyDocsOfFacility(docs: SmallPublicSafetyDoc[], facilityId: string): SmallPublicSafetyDoc[] {
  return docs
    .filter((d) => d.facilityId === facilityId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

/**
 * 시설 구분 다시 맞추기 — 최근 후보지 평가가 선정제외면 제외, 그 밖에는 최근 점검의 평가구분.
 * 위험이 되면 위험시설 지정일(비어 있을 때)을 점검일로 채우고 계속 점검 대상으로 둔다.
 */
function syncFacilityClass(s: State, facilityId: string): SmallPublicFacility[] {
  const latestEval = candidateEvalsOfFacility(s.candidateEvals, facilityId)[0]
  const latest = latestInspectionOf(s.inspections, facilityId)
  return s.facilities.map((f) => {
    if (f.id !== facilityId) return f
    if (latestEval?.result === '선정제외') return f.candidate === '제외' ? f : { ...f, candidate: '제외' }
    const cls: SmallPublicClass | null = latest ? latest.classResult : f.candidate === '제외' ? '일반' : null
    if (!cls || f.candidate === cls) return f
    if (cls !== '위험') return { ...f, candidate: cls }
    return { ...f, candidate: cls, riskDate: f.riskDate || (latest?.date ?? ''), inspectionTarget: true }
  })
}

function patchFacility(facilityId: string, patch: (f: SmallPublicFacility) => SmallPublicFacility) {
  const s = getState()
  setState({
    ...s,
    facilities: s.facilities.map((f) => (f.id === facilityId ? patch(f) : f)),
  })
}

export const smallPublicActions = {
  updateFacility(id: string, patch: Partial<SmallPublicFacility>) {
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })
  },

  /** 시설 삭제 — 점검·후보지 평가·안전자료도 함께 지우고 보고서 대상에서도 뺀다 */
  deleteFacility(id: string) {
    const s = getState()
    setState({
      facilities: s.facilities.filter((f) => f.id !== id),
      inspections: s.inspections.filter((i) => i.facilityId !== id),
      candidateEvals: s.candidateEvals.filter((e) => e.facilityId !== id),
      safetyDocs: s.safetyDocs.filter((d) => d.facilityId !== id),
      reports: s.reports.map((r) => ({ ...r, rows: r.rows.filter((x) => x.facilityId !== id) })),
    })
  },

  /** 저장한 점검이 그 시설의 최근 점검이면 평가구분을 시설 구분에 반영 */
  saveInspection(next: SmallPublicInspection) {
    const s = getState()
    const exists = s.inspections.some((i) => i.id === next.id)
    const inspections = exists
      ? s.inspections.map((i) => (i.id === next.id ? next : i))
      : [...s.inspections, next]
    const saved = { ...s, inspections }
    const isLatest = latestInspectionOf(inspections, next.facilityId)?.id === next.id
    setState(isLatest ? { ...saved, facilities: syncFacilityClass(saved, next.facilityId) } : saved)
  },

  /** 최근 점검을 지우면 그 이전 점검의 평가구분으로 되돌림 */
  deleteInspection(id: string) {
    const s = getState()
    const target = s.inspections.find((i) => i.id === id)
    const removed = { ...s, inspections: s.inspections.filter((i) => i.id !== id) }
    const wasLatest = target ? latestInspectionOf(s.inspections, target.facilityId)?.id === id : false
    setState(target && wasLatest ? { ...removed, facilities: syncFacilityClass(removed, target.facilityId) } : removed)
  },

  /** 후보지 평가 저장 — 최근 평가면 선정·선정제외를 시설 구분에 반영 */
  saveCandidateEval(next: SmallPublicCandidateEval) {
    const s = getState()
    const exists = s.candidateEvals.some((e) => e.id === next.id)
    const candidateEvals = exists
      ? s.candidateEvals.map((e) => (e.id === next.id ? next : e))
      : [...s.candidateEvals, next]
    const saved = { ...s, candidateEvals }
    const isLatest = candidateEvalsOfFacility(candidateEvals, next.facilityId)[0]?.id === next.id
    setState(isLatest ? { ...saved, facilities: syncFacilityClass(saved, next.facilityId) } : saved)
  },

  deleteCandidateEval(id: string) {
    const s = getState()
    const target = s.candidateEvals.find((e) => e.id === id)
    const removed = { ...s, candidateEvals: s.candidateEvals.filter((e) => e.id !== id) }
    const wasLatest = target ? candidateEvalsOfFacility(s.candidateEvals, target.facilityId)[0]?.id === id : false
    setState(target && wasLatest ? { ...removed, facilities: syncFacilityClass(removed, target.facilityId) } : removed)
  },

  saveSafetyDoc(next: SmallPublicSafetyDoc) {
    const s = getState()
    const exists = s.safetyDocs.some((d) => d.id === next.id)
    setState({
      ...s,
      safetyDocs: exists ? s.safetyDocs.map((d) => (d.id === next.id ? next : d)) : [...s.safetyDocs, next],
    })
  },

  deleteSafetyDoc(id: string) {
    const s = getState()
    setState({ ...s, safetyDocs: s.safetyDocs.filter((d) => d.id !== id) })
  },

  addPlanFiles(facilityId: string, files: SmallPublicFile[]) {
    patchFacility(facilityId, (f) => ({ ...f, planFiles: [...f.planFiles, ...files.map((x) => ({ ...x, kind: 'other' as const }))] }))
  },

  removePlanFile(facilityId: string, fileId: string) {
    patchFacility(facilityId, (f) => ({ ...f, planFiles: f.planFiles.filter((p) => p.id !== fileId) }))
  },

  saveDamageEvent(facilityId: string, event: SmallPublicDamageEvent) {
    patchFacility(facilityId, (f) => {
      const exists = f.damageEvents.some((e) => e.id === event.id)
      return {
        ...f,
        damageEvents: exists
          ? f.damageEvents.map((e) => (e.id === event.id ? event : e))
          : [...f.damageEvents, event],
      }
    })
  },

  deleteDamageEvent(facilityId: string, eventId: string) {
    patchFacility(facilityId, (f) => ({ ...f, damageEvents: f.damageEvents.filter((e) => e.id !== eventId) }))
  },

  /** 후보지 «후보지 등록» — 새 시설. 관리번호는 저장 때 임시 번호(신규-0001…)로 붙임 */
  addFacility(
    draft: Omit<SmallPublicFacility, 'id' | 'mngNo' | 'planFiles' | 'damageEvents' | 'inspectionTarget'>
  ): SmallPublicFacility {
    const s = getState()
    newFacilitySeq += 1
    const mngNo = `신규-${String(newFacilitySeq).padStart(4, '0')}`
    const facility: SmallPublicFacility = {
      ...draft,
      id: mngNo,
      mngNo,
      planFiles: [],
      damageEvents: [],
      inspectionTarget: false,
    }
    setState({ ...s, facilities: [...s.facilities, facility] })
    return facility
  },

  /** 보고서 추가·수정 */
  saveReport(next: SmallPublicInspectionReport) {
    const s = getState()
    const exists = s.reports.some((r) => r.id === next.id)
    setState({ ...s, reports: exists ? s.reports.map((r) => (r.id === next.id ? next : r)) : [...s.reports, next] })
  },

  deleteReport(id: string) {
    const s = getState()
    setState({ ...s, reports: s.reports.filter((r) => r.id !== id) })
  },

  /** 보고서에 대상 밖 시설(위험시설 재점검 등) 추가 — 다음 보고서에도 들어가도록 계속 점검 대상으로 둔다 */
  addReportRow(reportId: string, row: SmallPublicReportRow) {
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.map((f) => (f.id === row.facilityId ? { ...f, inspectionTarget: true } : f)),
      reports: s.reports.map((r) =>
        r.id === reportId && !r.rows.some((x) => x.facilityId === row.facilityId) ? { ...r, rows: [...r.rows, row] } : r
      ),
    })
  },
}
