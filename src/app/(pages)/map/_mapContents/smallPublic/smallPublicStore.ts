'use client'

/**
 * 소규모 공공시설 — 후보지·안전점검(·정비계획)이 함께 쓰는 화면 캐시.
 * 자료의 기준은 DB(layer.spf_*)이며, 보고서·점검·후보지 삭제는 서버에 저장한 뒤 캐시를 맞춘다.
 * DB 테이블이 아직 없는 항목(후보지 평가 첨부, 피해이력, 안전자료, 정비계획 첨부)은 이 세션 메모리에만 둔다.
 */

import { useSyncExternalStore } from 'react'
import { call } from '@/lib/api'
import type { SmallPublicCandidate, SmallPublicClass } from './smallPublicConfig'
import {
  type SmallPublicCandidateEval,
  type SmallPublicDamageEvent,
  type SmallPublicFacility,
  type SmallPublicFile,
  type SmallPublicFileKind,
  type SmallPublicInspection,
  type SmallPublicSafetyDoc,
} from './smallPublicMock'
import type { SmallPublicInspectionReport } from './inspection/smallPublicInspectionReport'

type State = {
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  safetyDocs: SmallPublicSafetyDoc[]
  /** 안전점검 보고서 */
  reports: SmallPublicInspectionReport[]
  /** 시설별 부속·상위(세천↔소교량·낙차공) — 상세 로드 시 */
  relatedByFacilityId: Record<string, SmallPublicFacility[]>
  /** dbf 시드 로딩 중 */
  loading: boolean
  /** 시드 로드 완료(실패 포함) */
  ready: boolean
  /** 보고서·점검 저장·삭제 때마다 올라감 — 보고서 목록(건수)을 다시 읽는 신호 */
  reportsVersion: number
}

function emptyState(): State {
  return {
    facilities: [],
    inspections: [],
    candidateEvals: [],
    safetyDocs: [],
    reports: [],
    relatedByFacilityId: {},
    loading: true,
    ready: false,
    reportsVersion: 0,
  }
}

/** 시설마다 syncFacilityClass를 돌리면 O(n²)로 멈춘다 — 최근 점검·평가를 한 번에 모은 뒤 한 패스 */
function applyLatestClassBulk(
  facilities: SmallPublicFacility[],
  inspections: SmallPublicInspection[],
  candidateEvals: SmallPublicCandidateEval[]
): SmallPublicFacility[] {
  const latestInsp = new Map<string, SmallPublicInspection>()
  for (const i of inspections) {
    const cur = latestInsp.get(i.facilityId)
    if (!cur || i.date > cur.date || (i.date === cur.date && i.id > cur.id)) latestInsp.set(i.facilityId, i)
  }
  const latestEval = new Map<string, SmallPublicCandidateEval>()
  for (const e of candidateEvals) {
    const cur = latestEval.get(e.facilityId)
    if (!cur || e.date > cur.date || (e.date === cur.date && e.id > cur.id)) latestEval.set(e.facilityId, e)
  }
  const inspected2025 = new Set(inspections.filter((i) => i.date >= '2025').map((i) => i.facilityId))

  return facilities.map((f) => {
    let next: SmallPublicFacility = {
      ...f,
      parentFacId: f.parentFacId ?? null,
      parentFacName: f.parentFacName ?? '',
      inspectionTarget: f.candidate === '위험' || f.inspectionTarget,
    }
    next = {
      ...next,
      inspectionTarget: next.candidate === '위험' && (next.inspectionTarget || inspected2025.has(next.id)),
    }
    const ev = latestEval.get(next.id)
    if (ev?.result === '선정제외') {
      return next.candidate === '제외' ? next : { ...next, candidate: '제외' as SmallPublicCandidate }
    }
    const latest = latestInsp.get(next.id)
    const cls: SmallPublicClass | null = latest
      ? latest.classResult
      : next.candidate === '제외'
        ? '일반'
        : null
    if (!cls || next.candidate === cls) return next
    if (cls !== '위험') return { ...next, candidate: cls }
    return {
      ...next,
      candidate: cls,
      riskDate: next.riskDate || (latest?.date ?? ''),
      inspectionTarget: true,
    }
  })
}

function initialState(): State {
  return emptyState()
}

let listLoaded = false
const detailInflight = new Map<string, Promise<void>>()

type ListRowDto = {
  id: string
  mngNo: string
  name: string
  type: SmallPublicFacility['type']
  emd: string
  ri: string
  candidate: SmallPublicCandidate
  x: number | null
  y: number | null
  coords?: SmallPublicFacility['coords']
  grade: string
  classResult: string
  inspId: string
  inspDate: string
  evalExcluded: boolean
}

const EMPTY_FILES: SmallPublicFile[] = []
const EMPTY_DAMAGE: SmallPublicDamageEvent[] = []
const SLIM_FORM_SHARED: SmallPublicInspection['form'] = {
  id: 'slim',
  facType: '소교량',
  version: '',
  effectiveFrom: '1970-01-01',
  stateRange: { A: [0, 3], B: [4, 6], C: [7, 10] },
  gradeRule: [{ grade: '보통' }],
  groups: [],
}
const EMPTY_VALUES: SmallPublicInspection['values'] = {}

/** 목록 API 슬림 행 → 스토어 Facility + 최근점검 스텁 */
function expandListRows(rows: ListRowDto[]): {
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
} {
  const facilities: SmallPublicFacility[] = []
  const inspections: SmallPublicInspection[] = []
  const candidateEvals: SmallPublicCandidateEval[] = []
  for (const r of rows) {
    let candidate = r.candidate
    if (r.evalExcluded) candidate = '제외'
    else if (r.classResult === '일반' || r.classResult === '관리' || r.classResult === '위험') {
      candidate = r.classResult
    }
    facilities.push({
      id: r.id,
      mngNo: r.mngNo,
      name: r.name,
      geomCode: '',
      type: r.type,
      emd: r.emd,
      ri: r.ri,
      address: '',
      startXy: '',
      endXy: '',
      riskRank: '',
      riskScore: '',
      benefitArea: '',
      riskDate: candidate === '위험' ? r.inspDate : '',
      surveyDate: '',
      surveyor: '',
      candidate,
      length: '',
      width: '',
      height: '',
      parentFacId: null,
      parentFacName: '',
      coords:
        r.coords ??
        (r.x != null && r.y != null ? ([r.x, r.y] as [number, number]) : null),
      planFiles: EMPTY_FILES,
      damageEvents: EMPTY_DAMAGE,
      inspectionTarget: candidate === '위험',
    })
    if (r.inspId) {
      inspections.push({
        id: r.inspId,
        facilityId: r.id,
        date: r.inspDate || '1970-01-01',
        inspector: '',
        score: 0,
        grade: (r.grade || '보통') as SmallPublicInspection['grade'],
        classResult: (r.classResult || '일반') as SmallPublicInspection['classResult'],
        classEval: null,
        reportId: null,
        remark: '',
        form: SLIM_FORM_SHARED,
        values: EMPTY_VALUES,
        file: null,
        classFile: null,
      })
    }
    if (r.evalExcluded) {
      candidateEvals.push({
        id: `excl-${r.id}`,
        facilityId: r.id,
        date: r.inspDate || '1970-01-01',
        evaluator: '',
        result: '선정제외',
        remark: '',
        file: null,
      })
    }
  }
  return { facilities, inspections, candidateEvals }
}

/** 목록 API 한 페이지 → 화면 Facility·최근점검 스텁 */
export function smallPublicFacilitiesFromListRows(rows: ListRowDto[]) {
  return expandListRows(rows)
}

/**
 * @deprecated 전체 목록 JSON 적재 제거 — 후보지는 listFacilities(page) 서버 페이징 사용
 */
export function ensureSmallPublicFacilityList(): Promise<void> {
  return Promise.resolve()
}

/** 목록 페이지 행을 스토어에 병합(선택·지도용). 전체 교체하지 않는다. */
export function mergeSmallPublicListPage(rows: ListRowDto[]) {
  const expanded = expandListRows(rows)
  const s = getState()
  const facMap = new Map(s.facilities.map((f) => [f.id, f]))
  for (const f of expanded.facilities) {
    const prev = facMap.get(f.id)
    facMap.set(f.id, prev ? { ...f, planFiles: prev.planFiles, damageEvents: prev.damageEvents } : f)
  }
  const inspKeep = s.inspections.filter((i) => !expanded.inspections.some((x) => x.facilityId === i.facilityId))
  const evalKeep = s.candidateEvals.filter((e) => !expanded.candidateEvals.some((x) => x.facilityId === e.facilityId))
  setState({
    ...s,
    facilities: [...facMap.values()],
    inspections: [...inspKeep, ...expanded.inspections],
    candidateEvals: [...evalKeep, ...expanded.candidateEvals],
    loading: false,
    ready: true,
  })
  listLoaded = true
}

/** 보고서 상세·시설 묶음을 스토어에 병합(전체 seed 대체) */
export function mergeSmallPublicReportBundle(payload: {
  report: SmallPublicInspectionReport
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
}) {
  const s = getState()
  const facMap = new Map(s.facilities.map((f) => [f.id, f]))
  for (const f of payload.facilities) {
    const prev = facMap.get(f.id)
    facMap.set(f.id, prev ? { ...f, planFiles: prev.planFiles, damageEvents: prev.damageEvents } : f)
  }
  const reportFacIds = new Set(payload.facilities.map((f) => f.id))
  const inspKeep = s.inspections.filter(
    (i) => i.reportId !== payload.report.id && !reportFacIds.has(i.facilityId)
  )
  const reports = s.reports.some((r) => r.id === payload.report.id)
    ? s.reports.map((r) => (r.id === payload.report.id ? payload.report : r))
    : [...s.reports, payload.report]
  setState({
    ...s,
    facilities: [...facMap.values()],
    inspections: [...inspKeep, ...payload.inspections],
    reports,
    loading: false,
    ready: true,
  })
  listLoaded = true
}

/** 후보지 행 선택 — 해당 시설 점검·평가 이력을 스토어에 병합 */
export function loadSmallPublicFacilityDetail(facilityId: string): Promise<void> {
  const id = String(facilityId ?? '').trim()
  if (!id) return Promise.resolve()
  const existing = detailInflight.get(id)
  if (existing) return existing
  const p = (async () => {
    try {
      const res = await call('', 'POST', {
        service: 'smallPublicService',
        action: 'getFacilityDetail',
        params: { facilityId: id },
      })
      const data = (res?.data ?? res) as {
        success?: boolean
        facility?: SmallPublicFacility
        inspections?: SmallPublicInspection[]
        candidateEvals?: SmallPublicCandidateEval[]
        relatedFacilities?: SmallPublicFacility[]
      }
      if (!data?.success || !data.facility) return
      const s = getState()
      const facility = data.facility
      const related = data.relatedFacilities ?? []
      const nextInspections = [
        ...s.inspections.filter((i) => i.facilityId !== id),
        ...(data.inspections ?? []),
      ]
      const nextEvals = [
        ...s.candidateEvals.filter((e) => e.facilityId !== id),
        ...(data.candidateEvals ?? []),
      ]
      const facMap = new Map(s.facilities.map((f) => [f.id, f]))
      facMap.set(id, {
        ...(facMap.get(id) ?? facility),
        ...facility,
        planFiles: facility.planFiles?.length
          ? facility.planFiles
          : (facMap.get(id)?.planFiles ?? facility.planFiles),
        damageEvents: facMap.get(id)?.damageEvents ?? facility.damageEvents,
      })
      for (const r of related) {
        const prev = facMap.get(r.id)
        facMap.set(r.id, prev ? { ...prev, ...r, planFiles: prev.planFiles, damageEvents: prev.damageEvents } : r)
      }
      const facilities = applyLatestClassBulk([...facMap.values()], nextInspections, nextEvals)
      setState({
        ...s,
        facilities,
        inspections: nextInspections,
        candidateEvals: nextEvals,
        relatedByFacilityId: { ...s.relatedByFacilityId, [id]: related },
      })
    } catch {
      /* 목록 행으로 상세를 유지 */
    } finally {
      detailInflight.delete(id)
    }
  })()
  detailInflight.set(id, p)
  return p
}

const inspectionFilesInflight = new Set<string>()

/** 점검 상세를 열 때 — 해당 점검의 첨부(연도 폴더)만 서버에서 가져와 붙인다 */
export async function loadSmallPublicInspectionFiles(inspection: SmallPublicInspection): Promise<void> {
  if (inspection.files || inspectionFilesInflight.has(inspection.id)) return
  inspectionFilesInflight.add(inspection.id)
  try {
    const res = await call('', 'POST', {
      service: 'smallPublicService',
      action: 'getInspectionFiles',
      params: { facilityId: inspection.facilityId, date: inspection.date },
    })
    const data = (res?.data ?? res) as {
      success?: boolean
      file?: SmallPublicFile | null
      classFile?: SmallPublicFile | null
      fieldFile?: SmallPublicFile | null
      files?: SmallPublicFile[]
    }
    if (!data || data.success === false) return
    const s = getState()
    setState({
      ...s,
      inspections: s.inspections.map((i) =>
        i.id === inspection.id && !i.files
          ? {
              ...i,
              file: data.file ?? null,
              classFile: data.classFile ?? null,
              fieldFile: data.fieldFile ?? null,
              files: data.files ?? [],
            }
          : i
      ),
    })
  } catch {
    /* 첨부 없이 표시 */
  } finally {
    inspectionFilesInflight.delete(inspection.id)
  }
}

let state: State | null = null
const listeners = new Set<() => void>()
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

export type SmallPublicActionFail = { success: false; error: string }

/** smallPublicService 호출 — 실패(예외·success:false)는 모두 {success:false,error} 로 돌려준다 */
async function callSmallPublic<T extends { success: true }>(
  action: string,
  params: Record<string, unknown>
): Promise<T | SmallPublicActionFail> {
  try {
    const res = await call('', 'POST', { service: 'smallPublicService', action, params })
    const data = (res?.data ?? res) as (T | SmallPublicActionFail) | undefined
    if (!data || data.success === false) {
      return { success: false, error: (data as SmallPublicActionFail | undefined)?.error ?? '요청에 실패했습니다.' }
    }
    return data
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '요청에 실패했습니다.' }
  }
}

/** 보고서 목록(건수)을 다시 읽도록 신호만 올린다 */
function bumpReportsVersion() {
  const s = getState()
  setState({ ...s, reportsVersion: s.reportsVersion + 1 })
}

/** 서버에 저장된 점검 한 건을 캐시에 반영(임시 id 는 서버 id 로 교체) — 최근 점검이면 시설 구분도 맞춤 */
function cacheSavedInspection(next: SmallPublicInspection, replaceId: string) {
  const s = getState()
  const base = s.inspections.filter((i) => i.id !== replaceId && i.id !== next.id)
  /** 같은 보고서·같은 시설의 기존 건(서버가 덮어쓴 건)은 한 건으로 합친다 */
  const inspections = [
    ...base.filter((i) => !(i.facilityId === next.facilityId && i.reportId && i.reportId === next.reportId)),
    next,
  ]
  const saved = { ...s, inspections, reportsVersion: s.reportsVersion + 1 }
  const isLatest = latestInspectionOf(inspections, next.facilityId)?.id === next.id
  setState(isLatest ? { ...saved, facilities: syncFacilityClass(saved, next.facilityId) } : saved)
}

export const smallPublicActions = {
  updateFacility(id: string, patch: Partial<SmallPublicFacility>) {
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })
  },

  /** 시설 삭제(DB) — 점검·후보지 평가·보고서 대상도 함께 지운다. 정비계획에 있는 시설은 서버가 거절 */
  async deleteFacility(id: string): Promise<{ success: true } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true }>('deleteFacility', { facilityId: id })
    if (!res.success) return res
    const s = getState()
    setState({
      ...s,
      facilities: s.facilities.filter((f) => f.id !== id),
      inspections: s.inspections.filter((i) => i.facilityId !== id),
      candidateEvals: s.candidateEvals.filter((e) => e.facilityId !== id),
      safetyDocs: s.safetyDocs.filter((d) => d.facilityId !== id),
      reports: s.reports.map((r) => ({ ...r, rows: r.rows.filter((x) => x.facilityId !== id) })),
      reportsVersion: s.reportsVersion + 1,
    })
    return { success: true }
  },

  /** 점검 저장(DB spf_check) — 보고서에 연결해 저장하고, 최근 점검이면 평가구분을 시설 구분에 반영 */
  async saveInspection(
    next: SmallPublicInspection
  ): Promise<{ success: true; inspection: SmallPublicInspection } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true; inspectionId: string; reportId: string }>('saveInspection', {
      inspectionId: next.id,
      facilityId: next.facilityId,
      reportId: next.reportId,
      date: next.date,
      inspector: next.inspector,
      score: next.score,
      grade: next.grade,
      classResult: next.classResult,
      remark: next.remark,
    })
    if (!res.success) return res
    const saved: SmallPublicInspection = { ...next, id: res.inspectionId, reportId: res.reportId }
    cacheSavedInspection(saved, next.id)
    return { success: true, inspection: saved }
  },

  /** 점검 삭제(DB) — 최근 점검을 지우면 그 이전 점검의 평가구분으로 되돌림 */
  async deleteInspection(id: string): Promise<{ success: true } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true }>('deleteInspection', { inspectionId: id })
    if (!res.success) return res
    const s = getState()
    const target = s.inspections.find((i) => i.id === id)
    const removed = { ...s, inspections: s.inspections.filter((i) => i.id !== id), reportsVersion: s.reportsVersion + 1 }
    const wasLatest = target ? latestInspectionOf(s.inspections, target.facilityId)?.id === id : false
    setState(target && wasLatest ? { ...removed, facilities: syncFacilityClass(removed, target.facilityId) } : removed)
    return { success: true }
  },

  /**
   * 후보지 평가 저장(DB spf_eval) — 시설당 평가일 연도마다 한 건. 파일은 호출 측이 후보지_{연도}/ 에 먼저 올린다.
   * 최근 평가면 선정·선정제외를 시설 구분에 반영
   */
  async saveCandidateEval(
    next: SmallPublicCandidateEval
  ): Promise<{ success: true; eval: SmallPublicCandidateEval } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true; evalId: string }>('saveCandidateEval', {
      evalId: next.id,
      facilityId: next.facilityId,
      date: next.date,
      evaluator: next.evaluator,
      result: next.result,
      remark: next.remark,
    })
    if (!res.success) return res
    const saved: SmallPublicCandidateEval = { ...next, id: res.evalId }
    const s = getState()
    const candidateEvals = [...s.candidateEvals.filter((e) => e.id !== next.id && e.id !== saved.id), saved]
    const state = { ...s, candidateEvals }
    const isLatest = candidateEvalsOfFacility(candidateEvals, saved.facilityId)[0]?.id === saved.id
    setState(isLatest ? { ...state, facilities: syncFacilityClass(state, saved.facilityId) } : state)
    return { success: true, eval: saved }
  },

  /** 후보지 평가 삭제(DB) — 서버가 그 연도의 후보지_{연도}/ 첨부 폴더도 지운다 */
  async deleteCandidateEval(id: string): Promise<{ success: true } | SmallPublicActionFail> {
    const s0 = getState()
    const target = s0.candidateEvals.find((e) => e.id === id)
    /** 파일만 있고 DB 평가가 없는 건(file: 로 시작)은 화면 표시용 — 서버 호출 없이 캐시에서만 뺀다(파일은 호출 측이 지움) */
    if (/^\d+$/.test(id)) {
      const res = await callSmallPublic<{ success: true }>('deleteCandidateEval', { evalId: id })
      if (!res.success) return res
    }
    const s = getState()
    const removed = { ...s, candidateEvals: s.candidateEvals.filter((e) => e.id !== id) }
    const wasLatest = target ? candidateEvalsOfFacility(s.candidateEvals, target.facilityId)[0]?.id === id : false
    setState(target && wasLatest ? { ...removed, facilities: syncFacilityClass(removed, target.facilityId) } : removed)
    return { success: true }
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

  /** 서버 저장 결과 반영 — id(관리번호) 기준 upsert */
  upsertFacility(facility: SmallPublicFacility) {
    const s = getState()
    const exists = s.facilities.some((f) => f.id === facility.id)
    setState({
      ...s,
      facilities: exists
        ? s.facilities.map((f) =>
            f.id === facility.id
              ? { ...f, ...facility, planFiles: f.planFiles, damageEvents: f.damageEvents }
              : f
          )
        : [...s.facilities, { ...facility, planFiles: facility.planFiles ?? [], damageEvents: facility.damageEvents ?? [] }],
    })
  },

  /**
   * 보고서 추가·수정(DB spf_report). 추가하면 서버가 대상 시설을 자동으로 넣는다.
   * 저장 후 보고서 본문(대상 목록)은 화면이 상세를 다시 읽어 채운다.
   */
  async saveReport(input: {
    id?: string
    year: number
    baseDate: string
    title: string
    agency: string
    author: string
    summary: string
  }): Promise<{ success: true; reportId: string } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true; reportId: string }>('saveReport', {
      reportId: input.id,
      year: input.year,
      baseDate: input.baseDate,
      title: input.title,
      agency: input.agency,
      author: input.author,
      summary: input.summary,
    })
    if (!res.success) return res
    const s = getState()
    setState({
      ...s,
      reports: s.reports.map((r) =>
        r.id === res.reportId
          ? {
              ...r,
              year: input.year,
              baseDate: input.baseDate,
              title: input.title,
              agency: input.agency,
              author: input.author,
              summary: input.summary,
            }
          : r
      ),
      reportsVersion: s.reportsVersion + 1,
    })
    return { success: true, reportId: res.reportId }
  },

  /** 보고서 삭제(DB) — 점검이 있는 보고서는 서버가 거절 */
  async deleteReport(id: string): Promise<{ success: true } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true }>('deleteReport', { reportId: id })
    if (!res.success) return res
    const s = getState()
    setState({ ...s, reports: s.reports.filter((r) => r.id !== id), reportsVersion: s.reportsVersion + 1 })
    return { success: true }
  },

  /** 보고서에 대상 밖 시설(위험시설 재점검 등) 추가(DB spf_report_target) — 화면이 상세를 다시 읽는다 */
  async addReportRow(reportId: string, facilityId: string): Promise<{ success: true } | SmallPublicActionFail> {
    const res = await callSmallPublic<{ success: true }>('addReportTarget', { reportId, facilityId })
    if (!res.success) return res
    bumpReportsVersion()
    return { success: true }
  },
}
