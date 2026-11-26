'use client'

/**
 * 정비계획 저장소(예시 단계) — 처음에는 기존 정비계획(보고서 4장) 최종순위 50위까지를 확정 계획으로 넣고,
 * 새로 위험시설이 된 시설만 분석한다. 새로고침 전까지만 유지된다.
 */

import { useSyncExternalStore } from 'react'
import { createSmallPublicMockFacilities, type SmallPublicFacility } from '../smallPublicMock'
import { smallPublicEmdOfRi } from '../smallPublicRiEmd'
import { EVAL_ITEMS, SUPP_ITEMS, type SuppCode } from './smallPublicPlanMaster'
import { parsePlanDate, suggestWorks, todayYmd } from './smallPublicPlanCalc'
import { SMALL_PUBLIC_PLAN_REPORT_NAME, SMALL_PUBLIC_PLAN_REPORT_ROWS } from './smallPublicPlanReportData'
import {
  currentVersion,
  type PlanUnit,
  type PlanVersion,
} from './smallPublicPlanTypes'

type State = {
  units: PlanUnit[]
  /** 후보지·안전점검 등에서 정비계획으로 넘긴 시설 — PlanShell이 받아 분석에 넣는다 */
  analyzeRequest: { facilityIds: string[]; seq: number } | null
}

/** 부가적 평가 기본값 — 기존 계획에서 가장 많은 값(지속성 1·정책성 0·계획성 0) */
const SUPP_DEFAULT: Record<SuppCode, 0 | 1> = { SUSTAIN: 1, POLICY: 0, PLAN: 0 }

function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 새 분석 1판 — 정비내용은 시설 자료로 제안, 재해위험도(나등급·인명피해 없음)·부가적 평가는 기본값,
 * 피해이력·주민불편도·필지는 담당자 입력.
 */
export function newPlanVersion(f: SmallPublicFacility, by: string): PlanVersion {
  const designatedOn = parsePlanDate(f.riskDate)
  const damageEvents = f.damageEvents.map((e) => ({
    id: e.id,
    occurredOn: e.occurredOn,
    itemCode: e.itemCode,
    qty: e.qty,
    overrideSupportIndex: e.overrideSupportIndex,
  }))
  return {
    origin: 'ANALYSIS',
    reported: null,
    done: null,
    versionNo: 1,
    status: 'DRAFT',
    createdAt: nowStamp(),
    createdBy: by,
    designatedOn,
    designatedSource: designatedOn ? 'AUTO' : 'MISSING',
    measure: '',
    works: suggestWorks(f, todayYmd()),
    details: [],
    compNone: false,
    parcels: [],
    extras: [],
    damageNone: damageEvents.length === 0,
    damageEvents,
    bcBenefitWon: null,
    riskGrade: 'NA',
    riskCasualty: 'NONE',
    riskDefault: true,
    population: null,
    areaHa: null,
    supp: { ...SUPP_DEFAULT },
    suppDefault: true,
  }
}

function riOf(name: string): string {
  return name.split('_')[0] ?? ''
}

/** 기존 계획 1건 — 보고서 표 값 */
function reportUnit(
  row: (typeof SMALL_PUBLIC_PLAN_REPORT_ROWS)[number],
  facilityByName: Map<string, SmallPublicFacility>,
  emdByRi: Map<string, string>
): PlanUnit {
  const [name, type, costMillion, yearNo, sc, total, baseRank, supp, finalRank, workloadM, scale, measure] = row
  const f = facilityByName.get(name)
  const ri = f?.ri ?? riOf(name)
  const v: PlanVersion = {
    origin: 'REPORT',
    reported: {
      planName: SMALL_PUBLIC_PLAN_REPORT_NAME,
      workloadM,
      costWon: costMillion * 1_000_000,
      totalScore: total,
      scores: Object.fromEntries(EVAL_ITEMS.map((i, k) => [i.code, sc[k] ?? 0])) as Record<(typeof EVAL_ITEMS)[number]['code'], number>,
      baseRank,
      finalRank,
      supp: supp ? (Object.fromEntries(SUPP_ITEMS.map((s, k) => [s.code, supp[k] ? 1 : 0])) as Record<SuppCode, 0 | 1>) : null,
      yearNo,
      scale,
      measure,
    },
    done: null,
    versionNo: 1,
    status: 'APPROVED',
    createdAt: '2020-12-31 00:00',
    createdBy: '울진군',
    designatedOn: f ? parsePlanDate(f.riskDate) : null,
    designatedSource: 'ACTUAL',
    measure,
    works: [],
    details: [],
    compNone: true,
    parcels: [],
    extras: [],
    damageNone: false,
    damageEvents: [],
    bcBenefitWon: null,
    riskGrade: null,
    riskCasualty: null,
    riskDefault: false,
    population: null,
    areaHa: null,
    supp: { SUSTAIN: null, POLICY: null, PLAN: null },
    suppDefault: false,
  }
  return {
    id: `plan-${name}`,
    facilityId: f?.id ?? '',
    unitName: name,
    type,
    emd: f?.emd ?? emdByRi.get(ri) ?? smallPublicEmdOfRi(ri),
    ri,
    location: f?.address ?? '',
    versions: [v],
    history: [{ at: v.createdAt, by: '울진군', text: `${SMALL_PUBLIC_PLAN_REPORT_NAME} 반영(확정)` }],
  }
}

function analysisUnit(
  f: SmallPublicFacility,
  version: PlanVersion,
  by: string,
  opts?: { retainOnClose?: boolean }
): PlanUnit {
  const retainOnClose = Boolean(opts?.retainOnClose)
  return {
    id: `plan-${f.id}`,
    facilityId: f.id,
    unitName: f.name,
    type: f.type,
    emd: f.emd,
    ri: f.ri,
    location: f.address,
    retainOnClose,
    versions: [version],
    history: [
      {
        at: version.createdAt,
        by,
        text: retainOnClose ? '정비계획 이관(추정)' : '분석 시작(추정)',
      },
    ],
  }
}

/** 예시로 넣는 기존 계획 범위 — 보고서 최종순위 이 순위까지만 */
const REPORT_SAMPLE_RANK_LIMIT = 50

/** 정비계획 목록에서 빼는 시험·기존 계획 시설명 */
const EXCLUDED_PLAN_UNIT_NAMES = new Set(['봉평리_세천_002', '온정리_소교량_010', '명도리_낙차공_001'])

/**
 * 예시 — 기존 계획(보고서 4장) 최종순위 50위까지.
 * 기존 계획 시설명과 후보지 시설명이 같으면 시설에 연결한다(소교량은 보고서가 리 단위 통합이라 연결 안 됨).
 */
/** 프로토 — 명세서 작성 예시(정비된·중기 연차·효과·5개년 후). 정비율은 사업량으로 자동 계산 */
function applySheetProtoSamples(units: PlanUnit[]): PlanUnit[] {
  const samples: {
    match: (u: PlanUnit) => boolean
    done: { qty: number; costWon: number }
    midYears: { qty: number; costWon: number }[]
    after: { qty: number; costWon: number }
    sheetEffect: { people: number; farmHa: number; buildings: number }
  }[] = [
    {
      match: (u) => u.unitName === '온양리_마을진입로_007',
      done: { qty: 120, costWon: 80_000_000 },
      midYears: [
        { qty: 200, costWon: 150_000_000 },
        { qty: 180, costWon: 120_000_000 },
        { qty: 0, costWon: 0 },
        { qty: 100, costWon: 70_000_000 },
        { qty: 0, costWon: 0 },
      ],
      after: { qty: 50, costWon: 40_000_000 },
      sheetEffect: { people: 42, farmHa: 3.2, buildings: 4 },
    },
    {
      match: (u) => u.unitName === '정림리_마을진입로_017',
      done: { qty: 80, costWon: 45_000_000 },
      midYears: [
        { qty: 0, costWon: 0 },
        { qty: 220, costWon: 160_000_000 },
        { qty: 180, costWon: 130_000_000 },
        { qty: 0, costWon: 0 },
        { qty: 90, costWon: 65_000_000 },
      ],
      after: { qty: 0, costWon: 0 },
      sheetEffect: { people: 25, farmHa: 0, buildings: 1 },
    },
    {
      match: (u) => u.unitName === '구산리1_마을진입로_002',
      done: { qty: 0, costWon: 0 },
      midYears: [
        { qty: 150, costWon: 95_000_000 },
        { qty: 150, costWon: 95_000_000 },
        { qty: 100, costWon: 60_000_000 },
        { qty: 0, costWon: 0 },
        { qty: 0, costWon: 0 },
      ],
      after: { qty: 80, costWon: 55_000_000 },
      sheetEffect: { people: 18, farmHa: 1.5, buildings: 2 },
    },
    {
      match: (u) => u.unitName === '봉평리_마을진입로_038',
      done: { qty: 40, costWon: 25_000_000 },
      midYears: [
        { qty: 90, costWon: 55_000_000 },
        { qty: 0, costWon: 0 },
        { qty: 110, costWon: 70_000_000 },
        { qty: 70, costWon: 48_000_000 },
        { qty: 0, costWon: 0 },
      ],
      after: { qty: 30, costWon: 20_000_000 },
      sheetEffect: { people: 12, farmHa: 0.8, buildings: 0 },
    },
  ]

  return units.map((u) => {
    const sample = samples.find((s) => s.match(u))
    if (!sample) return u
    const cur = u.versions[u.versions.length - 1]!
    const next = {
      ...cur,
      done: sample.done,
      midYears: sample.midYears,
      after: sample.after,
      sheetEffect: sample.sheetEffect,
      sheetRates: null,
    }
    return {
      ...u,
      versions: [...u.versions.slice(0, -1), next],
      history: [...u.history, { at: nowStamp(), by: '프로토', text: '명세서 작성 예시' }],
    }
  })
}

function initialState(): State {
  const facilities = createSmallPublicMockFacilities()
  const facilityByName = new Map(facilities.map((f) => [f.name, f]))
  const emdByRi = new Map(facilities.map((f) => [f.ri, f.emd]))
  const units = applySheetProtoSamples(
    SMALL_PUBLIC_PLAN_REPORT_ROWS.filter(
      (row) => row[8] <= REPORT_SAMPLE_RANK_LIMIT && !EXCLUDED_PLAN_UNIT_NAMES.has(String(row[0]))
    ).map((row) => reportUnit(row, facilityByName, emdByRi))
  )
  return { units, analyzeRequest: null }
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

export function useSmallPublicPlanStore(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}

function updateUnit(id: string, fn: (u: PlanUnit) => PlanUnit) {
  const s = getState()
  setState({ ...s, units: s.units.map((u) => (u.id === id ? fn(u) : u)) })
}

function replaceCurrent(u: PlanUnit, v: PlanVersion): PlanVersion[] {
  return [...u.versions.slice(0, -1), v]
}

export const smallPublicPlanActions = {
  /** 후보지 상세 → 정비계획 화면으로 넘길 시설(위험·미포함) */
  requestAnalyze(facilityId: string) {
    smallPublicPlanActions.requestAnalyzeMany([facilityId])
  },

  /** 안전점검 이관 등 — 여러 시설을 한 번에 넘긴다 */
  requestAnalyzeMany(facilityIds: string[]) {
    const ids = [...new Set(facilityIds.map((id) => id.trim()).filter(Boolean))]
    if (ids.length === 0) return
    const s = getState()
    setState({
      ...s,
      analyzeRequest: { facilityIds: ids, seq: (s.analyzeRequest?.seq ?? 0) + 1 },
    })
  },

  /** PlanShell이 요청을 처리한 뒤 비운다 */
  clearAnalyzeRequest() {
    const s = getState()
    if (!s.analyzeRequest) return
    setState({ ...s, analyzeRequest: null })
  },

  /** 정비계획 «분석»으로 시작 — 1판 추정. 미저장 닫기 시 목록에서 뺌 */
  addUnit(f: SmallPublicFacility, by: string): PlanUnit {
    const s = getState()
    const unit = analysisUnit(f, newPlanVersion(f, by), by, { retainOnClose: false })
    setState({ ...s, units: [...s.units, unit] })
    return unit
  },

  /**
   * 안전점검 이관 등 — 여러 위험시설을 한 번에 분석 대상으로 넣는다(이미 있는 시설은 건너뜀).
   * 이관 건은 미저장 닫아도 목록에 남긴다.
   */
  addUnits(list: SmallPublicFacility[], by: string): PlanUnit[] {
    const s = getState()
    const planned = new Set(s.units.map((u) => u.facilityId).filter(Boolean))
    const added: PlanUnit[] = []
    const next = [...s.units]
    for (const f of list) {
      if (f.candidate !== '위험' || planned.has(f.id)) continue
      const unit = analysisUnit(f, newPlanVersion(f, by), by, { retainOnClose: true })
      next.push(unit)
      added.push(unit)
      planned.add(f.id)
    }
    if (added.length > 0) setState({ ...s, units: next })
    return added
  },

  /** 저장 — 추정 상태만 */
  saveVersion(unitId: string, v: PlanVersion, by: string, text: string) {
    updateUnit(unitId, (u) => ({
      ...u,
      versions: replaceCurrent(u, v),
      history: [...u.history, { at: nowStamp(), by, text }],
    }))
  },

  /** 중기 1~5년차 사업량·사업비 직접 입력 */
  setMidYears(unitId: string, midYears: { qty: number; costWon: number }[]) {
    updateUnit(unitId, (u) => {
      const cur = currentVersion(u)
      return {
        ...u,
        versions: replaceCurrent(u, { ...cur, midYears }),
      }
    })
  },

  /** 정비된 부분(사업량·사업비) */
  setDone(unitId: string, done: { qty: number; costWon: number }) {
    updateUnit(unitId, (u) => {
      const cur = currentVersion(u)
      return {
        ...u,
        versions: replaceCurrent(u, { ...cur, done }),
      }
    })
  },

  /** 5개년 후 정비대상 */
  setAfter(unitId: string, after: { qty: number; costWon: number }) {
    updateUnit(unitId, (u) => {
      const cur = currentVersion(u)
      return {
        ...u,
        versions: replaceCurrent(u, { ...cur, after }),
      }
    })
  },

  /** 사업효과(수혜자·농경지·건물) */
  setSheetEffect(unitId: string, sheetEffect: { people: number; farmHa: number; buildings: number }) {
    updateUnit(unitId, (u) => {
      const cur = currentVersion(u)
      return {
        ...u,
        versions: replaceCurrent(u, { ...cur, sheetEffect }),
      }
    })
  },

  /**
   * 명세서 저장 — 입력값을 반영하고 작성중(DRAFT)으로 둔다.
   * 확정·기존 계획도 저장하면 작성중으로 바뀐다. 정비율은 사업량으로 자동 계산.
   */
  saveSheetDrafts(
    entries: {
      unitId: string
      midYears: { qty: number; costWon: number }[]
      done: { qty: number; costWon: number }
      after: { qty: number; costWon: number }
      sheetEffect: { people: number; farmHa: number; buildings: number }
    }[],
    by: string
  ) {
    if (entries.length === 0) return
    const byId = new Map(entries.map((e) => [e.unitId, e]))
    const s = getState()
    setState({
      ...s,
      units: s.units.map((u) => {
        const e = byId.get(u.id)
        if (!e) return u
        const cur = currentVersion(u)
        const next = {
          ...cur,
          midYears: e.midYears,
          done: e.done,
          after: e.after,
          sheetEffect: e.sheetEffect,
          sheetRates: null,
          status: 'DRAFT' as const,
        }
        return {
          ...u,
          versions: replaceCurrent(u, next),
          history: [...u.history, { at: nowStamp(), by, text: '정비계획 명세서 저장(작성중)' }],
        }
      }),
    })
  },

  /** 명세서 적용 — 작성중(추정)을 확정으로 */
  applyUnits(unitIds: string[], by: string) {
    const idSet = new Set(unitIds)
    const s = getState()
    setState({
      ...s,
      units: s.units.map((u) => {
        if (!idSet.has(u.id)) return u
        const cur = currentVersion(u)
        if (cur.status !== 'DRAFT') return u
        const next = { ...cur, status: 'APPROVED' as const }
        return {
          ...u,
          versions: replaceCurrent(u, next),
          history: [...u.history, { at: nowStamp(), by, text: '정비계획 명세서 적용(확정)' }],
        }
      }),
    })
  },

  /** 분석 삭제 — 추정(검토 전) 분석만 */
  deleteUnit(unitId: string) {
    const s = getState()
    setState({
      ...s,
      units: s.units.filter((u) => !(u.id === unitId && currentVersion(u).origin === 'ANALYSIS' && currentVersion(u).status === 'DRAFT')),
    })
  },
}
