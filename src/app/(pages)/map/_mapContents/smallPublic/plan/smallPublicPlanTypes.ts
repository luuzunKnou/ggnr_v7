import type { SmallPublicFacType } from '../smallPublicConfig'
import type { EvalItemCode, RiskCasualtyCode, RiskGradeCode, SuppCode } from './smallPublicPlanMaster'

/** 값 출처 — 자동 / 기본값 / 수기 / 실적 / 미입력 */
export type PlanSource = 'AUTO' | 'DEFAULT' | 'MANUAL' | 'ACTUAL' | 'MISSING'

export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  AUTO: '자동',
  DEFAULT: '기본값',
  MANUAL: '수기',
  ACTUAL: '실적',
  MISSING: '미입력',
}

export type PlanStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'IN_PROGRESS' | 'DONE'

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  DRAFT: '추정',
  REVIEW: '검토',
  APPROVED: '확정',
  IN_PROGRESS: '진행',
  DONE: '완료',
}

export const PLAN_STATUSES: PlanStatus[] = ['DRAFT', 'REVIEW', 'APPROVED', 'IN_PROGRESS', 'DONE']

/** 정비 공종·수량 — 단가는 적용 행 스냅샷(나중에 단가가 바뀌어도 이 판은 그대로) */
export type PlanWorkItem = {
  id: string
  workCode: string
  qty: number | null
  priceId: string | null
  unitPriceWon: number | null
  /** 선형개선 등 단가로 못 구하는 공종의 직접 금액 */
  manualAmountWon: number | null
  source: PlanSource
}

/** 부속 소교량·낙차공 개소별 규격 */
export type PlanWorkDetail = {
  id: string
  kind: 'BRIDGE' | 'DROP'
  name: string
  location: string
  l: number | null
  b: number | null
  costWon: number | null
}

/** 편입 필지 — 주소 검색으로 PNU·지목·필지면적·공시지가를 채우고, 보상비 = 편입면적 × 공시지가 × 보상배율 */
export type PlanParcel = {
  id: string
  pnu: string
  jibun: string
  landCategory: string
  /** 필지 전체 면적(조회 값) */
  parcelAreaM2: number | null
  inclAreaM2: number
  landPriceWon: number | null
  /** 공시지가 기준연도(조회 값) */
  landPriceYear: string
  /** 소유구분(사유지·군유지·국유지 등) — 국공유지는 보상 제외로 시작 */
  ownerType: string
  multiplier: number
  exclude: boolean
  source: PlanSource
}

export type PlanExtraKind = 'BUILDING_COMP' | 'BUSINESS_COMP' | 'DESIGN' | 'OTHER'

export const PLAN_EXTRA_LABEL: Record<PlanExtraKind, string> = {
  BUILDING_COMP: '건물보상',
  BUSINESS_COMP: '영업보상',
  DESIGN: '설계비',
  OTHER: '기타',
}

export type PlanExtra = { id: string; kind: PlanExtraKind; amountWon: number; note: string }

export type DamageEvent = {
  id: string
  occurredOn: string
  itemCode: string | null
  qty: number | null
  /** 세입자 보조처럼 실금액으로 지원기준지수(천원)를 바꿀 때 */
  overrideSupportIndex: number | null
}

/** REPORT = 기존 정비계획(보고서)에서 온 확정 계획 — 중간 평가 내용 없이 개요·결과만 / ANALYSIS = 새 위험시설 분석 */
export type PlanOrigin = 'REPORT' | 'ANALYSIS'

/** 기존 계획 결과값(보고서 표) */
export type PlanReported = {
  planName: string
  workloadM: number | null
  costWon: number
  totalScore: number
  scores: Record<EvalItemCode, number>
  baseRank: number
  finalRank: number
  /** 부가적 평가(지속성·정책성·계획성) — 표에 없으면 null */
  supp: Record<SuppCode, 0 | 1> | null
  /** 1~5차년, null = 5개년 이후(2단계) */
  yearNo: number | null
  scale: string
  measure: string
}

/** 한 판(버전)의 입력값 */
export type PlanVersion = {
  origin: PlanOrigin
  reported: PlanReported | null
  /** 정비된 부분(공사 실적) */
  done: { qty: number; costWon: number } | null
  versionNo: number
  status: PlanStatus
  createdAt: string
  createdBy: string
  designatedOn: string | null
  designatedSource: PlanSource
  /** 저감대책 — 담당자 입력(사업규모는 정비 공종에서 만든다) */
  measure: string
  works: PlanWorkItem[]
  details: PlanWorkDetail[]
  /** 보상 대상 없음(국공유지 등) */
  compNone: boolean
  parcels: PlanParcel[]
  extras: PlanExtra[]
  /** 피해 없음(0점) — 아니면 피해 항목·물량으로 지수 계산 */
  damageNone: boolean
  damageEvents: DamageEvent[]
  /** 비용-편익의 총편익(원) — null 이면 기존 계획 기준 기본 점수. B/C = 편익 ÷ 분석 사업비 */
  bcBenefitWon: number | null
  riskGrade: RiskGradeCode | null
  riskCasualty: RiskCasualtyCode | null
  /** 재해위험도를 기본값(나등급·인명피해 없음)으로 둔 상태 */
  riskDefault: boolean
  population: number | null
  areaHa: number | null
  supp: Record<SuppCode, 0 | 1 | null>
  /** 부가적 평가를 기본값(기존 계획에서 가장 많은 값)으로 둔 상태 */
  suppDefault: boolean
}

export type PlanHistory = { at: string; by: string; text: string }

export type PlanUnit = {
  id: string
  /** 연결된 후보지 시설(없으면 '') — 기존 계획에는 시설 자료가 없는 시설·소교량 통합 단위가 있다 */
  facilityId: string
  unitName: string
  type: SmallPublicFacType
  emd: string
  ri: string
  location: string
  /** 판 목록 — 마지막이 현재 판 */
  versions: PlanVersion[]
  history: PlanHistory[]
}

export function currentVersion(unit: PlanUnit): PlanVersion {
  return unit.versions[unit.versions.length - 1]!
}

/** 추정·검토는 분석 화면, 확정 이후는 개요·결과만 */
export function isPlanInAnalysis(v: PlanVersion): boolean {
  return v.status === 'DRAFT' || v.status === 'REVIEW'
}

/** 예산 계획 배정 — 추정·확정 이후 가능, 검토만 제외 */
export function canLinkToBudget(v: PlanVersion): boolean {
  return v.status !== 'REVIEW'
}
