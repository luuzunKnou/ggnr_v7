'use client'

/**
 * 정비계획 저장소(예시 단계) — 처음에는 기존 정비계획(보고서 4장) 최종순위 50위까지를 확정 계획으로 넣고,
 * 새로 위험시설이 된 시설만 분석한다. 새로고침 전까지만 유지된다.
 */

import { useSyncExternalStore } from 'react'
import { createSmallPublicMockFacilities, type SmallPublicFacility } from '../smallPublicMock'
import { smallPublicEmdOfRi } from '../smallPublicRiEmd'
import { EVAL_ITEMS, SUPP_ITEMS, type SuppCode } from './smallPublicPlanMaster'
import { compMultiplier, parsePlanDate, suggestWorks, todayYmd } from './smallPublicPlanCalc'
import { SMALL_PUBLIC_PLAN_REPORT_NAME, SMALL_PUBLIC_PLAN_REPORT_ROWS } from './smallPublicPlanReportData'
import {
  currentVersion,
  type PlanParcel,
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

function analysisUnit(f: SmallPublicFacility, version: PlanVersion, by: string): PlanUnit {
  return {
    id: `plan-${f.id}`,
    facilityId: f.id,
    unitName: f.name,
    type: f.type,
    emd: f.emd,
    ri: f.ri,
    location: f.address,
    versions: [version],
    history: [{ at: version.createdAt, by, text: '분석 시작(추정)' }],
  }
}

/** 예시 필지 — 시연용 가상 필지(실제 분석에서는 주소 검색으로 채움) */
function samplePlanParcels(f: SmallPublicFacility): PlanParcel[] {
  const total = Math.max(20, Math.round((Number(f.length) || 10) * 2))
  const rate = compMultiplier().rate
  return [0.6, 0.4].map((share, k) => ({
    id: `pc-${f.id}-${k}`,
    pnu: '',
    jibun: `${f.ri} ${120 + k}`,
    landCategory: k === 0 ? '답' : '구',
    parcelAreaM2: null,
    inclAreaM2: Math.round(total * share),
    landPriceWon: k === 0 ? 24000 : null,
    landPriceYear: k === 0 ? '2025' : '',
    ownerType: k === 0 ? '개인' : '군유지',
    multiplier: rate,
    exclude: k === 1,
    source: 'MANUAL',
  }))
}

/** 예시로 넣는 기존 계획 범위 — 보고서 최종순위 이 순위까지만 */
const REPORT_SAMPLE_RANK_LIMIT = 50

const SAMPLE_BY = '울진군 건설과'

/** 예시 분석 1건 — 시설 자료로 1판을 만들고 입력값을 덮어쓴다. 저장한 예시는 이력에 저장 줄을 남긴다 */
function sampleAnalysisUnit(
  f: SmallPublicFacility,
  createdAt: string,
  patch: (v: PlanVersion) => Partial<PlanVersion>,
  savedAt: string | null
): PlanUnit {
  const base = newPlanVersion(f, SAMPLE_BY)
  const v: PlanVersion = { ...base, createdAt, ...patch(base) }
  const unit = analysisUnit(f, v, SAMPLE_BY)
  if (savedAt) unit.history.push({ at: savedAt, by: SAMPLE_BY, text: '저장(시험 자료)' })
  return unit
}

/**
 * 시험용 분석 3건 — 계산 점검용.
 * 봉평리 세천: 입력 완료(B/C 기본값, 주택침수·세입자 보조, 주민불편도 40명/ha).
 * 명도리 낙차공: 입력 완료(편익 5백만원 ÷ 사업비 → B/C 0.76, 주택 반파·부상, 가등급·부상).
 * 온정리 소교량: 입력 중(저감대책·주민불편도 미입력).
 */
function sampleAnalyses(facilities: SmallPublicFacility[], planned: Set<string>): PlanUnit[] {
  const pick = (name: string) => facilities.find((f) => f.name === name && f.candidate === '위험' && !planned.has(f.id))
  const out: PlanUnit[] = []
  const a = pick('봉평리_세천_002')
  if (a) {
    out.push(
      sampleAnalysisUnit(
        a,
        '2026-03-02 09:00',
        () => ({
          measure: '통수단면 확보를 위한 세천 정비공사 실시',
          parcels: samplePlanParcels(a),
          damageNone: a.damageEvents.length === 0,
          damageEvents: a.damageEvents.map((e) => ({
            id: e.id,
            occurredOn: e.occurredOn,
            itemCode: e.itemCode,
            qty: e.qty,
            overrideSupportIndex: e.overrideSupportIndex,
          })),
          population: 120,
          areaHa: 3,
        }),
        '2026-03-05 16:20'
      )
    )
  }
  const b = pick('명도리_낙차공_001')
  if (b) {
    out.push(
      sampleAnalysisUnit(
        b,
        '2026-04-01 10:00',
        () => ({
          measure: '시설물 기능 회복을 위한 하천시설물 재설치',
          compNone: true,
          bcBenefitWon: 5_000_000,
          damageNone: b.damageEvents.length === 0,
          damageEvents: b.damageEvents.map((e) => ({
            id: e.id,
            occurredOn: e.occurredOn,
            itemCode: e.itemCode,
            qty: e.qty,
            overrideSupportIndex: e.overrideSupportIndex,
          })),
          riskGrade: 'GA',
          riskCasualty: 'INJURY',
          riskDefault: false,
          population: 45,
          areaHa: 1.5,
          supp: { SUSTAIN: 1, POLICY: 1, PLAN: 0 },
          suppDefault: false,
        }),
        '2026-04-03 11:40'
      )
    )
  }
  const c = pick('온정리_소교량_010')
  if (c) {
    out.push(
      sampleAnalysisUnit(
        c,
        '2026-05-11 14:00',
        () => ({
          parcels: samplePlanParcels(c),
          damageNone: c.damageEvents.length === 0,
          damageEvents: c.damageEvents.map((e) => ({
            id: e.id,
            occurredOn: e.occurredOn,
            itemCode: e.itemCode,
            qty: e.qty,
            overrideSupportIndex: e.overrideSupportIndex,
          })),
        }),
        null
      )
    )
  }
  return out
}

/**
 * 예시 — 기존 계획(보고서 4장) 최종순위 50위까지와 시험용 분석 3건.
 * 기존 계획 시설명과 후보지 시설명이 같으면 시설에 연결한다(소교량은 보고서가 리 단위 통합이라 연결 안 됨).
 * 50위 밖 기존 계획에 연결되던 위험시설은 «분석 필요» 대상으로 남는다.
 */
function initialState(): State {
  const facilities = createSmallPublicMockFacilities()
  const facilityByName = new Map(facilities.map((f) => [f.name, f]))
  const emdByRi = new Map(facilities.map((f) => [f.ri, f.emd]))
  const units = SMALL_PUBLIC_PLAN_REPORT_ROWS.filter((row) => row[8] <= REPORT_SAMPLE_RANK_LIMIT).map((row) =>
    reportUnit(row, facilityByName, emdByRi)
  )
  const planned = new Set(units.map((u) => u.facilityId).filter(Boolean))
  units.push(...sampleAnalyses(facilities, planned))
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

  /** 계획에 없는 위험시설 분석 시작 — 1판 추정 */
  addUnit(f: SmallPublicFacility, by: string): PlanUnit {
    const s = getState()
    const unit = analysisUnit(f, newPlanVersion(f, by), by)
    setState({ ...s, units: [...s.units, unit] })
    return unit
  },

  /** 여러 위험시설을 한 번에 분석 대상으로 넣는다(이미 있는 시설은 건너뜀) */
  addUnits(list: SmallPublicFacility[], by: string): PlanUnit[] {
    const s = getState()
    const planned = new Set(s.units.map((u) => u.facilityId).filter(Boolean))
    const added: PlanUnit[] = []
    const next = [...s.units]
    for (const f of list) {
      if (f.candidate !== '위험' || planned.has(f.id)) continue
      const unit = analysisUnit(f, newPlanVersion(f, by), by)
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

  /** 분석 삭제 — 추정(검토 전) 분석만 */
  deleteUnit(unitId: string) {
    const s = getState()
    setState({
      ...s,
      units: s.units.filter((u) => !(u.id === unitId && currentVersion(u).origin === 'ANALYSIS' && currentVersion(u).status === 'DRAFT')),
    })
  },
}
