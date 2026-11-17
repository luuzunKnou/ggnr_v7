/**
 * 정비계획 계산 — 사업비·보상비·평가 점수·완성도·순위·단계·연차 배분.
 * 기준값은 모두 기준 자료(smallPublicPlanMaster)에서 읽는다. 결과는 참고용 추정치.
 */

import type { SmallPublicFacility } from '../smallPublicMock'
import {
  COMP_MULTIPLIERS,
  DAMAGE_ITEMS,
  EVAL_BANDS,
  EVAL_ITEMS,
  RISK_CASUALTIES,
  RISK_GRADES,
  SUPP_ITEMS,
  SYSTEM_PARAMS,
  TIE_BREAK,
  UNIT_PRICES,
  damageGroupOf,
  damageSupportIndex,
  workTypeOf,
  type EvalItemCode,
  type PriceBasis,
  type UnitPrice,
} from './smallPublicPlanMaster'
import {
  currentVersion,
  type PlanSource,
  type PlanUnit,
  type PlanVersion,
  type PlanWorkItem,
} from './smallPublicPlanTypes'

export function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** «2020년12월31일»·«2020-12-31» → 2020-12-31 */
export function parsePlanDate(raw: string | null | undefined): string | null {
  const m = String(raw ?? '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
}

/** 원 → 백만원(소수 1자리) */
export function toMillion(won: number): string {
  return (Math.round(won / 100000) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/* ── 단가 ─────────────────────────────────────────────── */

const BASIS_PRIORITY: Record<PriceBasis, number> = { DESIGN: 0, NOTICE: 1, ESTIMATE: 2, PROVISIONAL: 3 }

/** 기준일에 유효한 단가 중 설계 > 고시 > 견적 > 임시 순. 유효한 행이 없으면 가장 최근 행 */
export function unitPriceFor(workCode: string, onDate: string): UnitPrice | null {
  const rows = UNIT_PRICES.filter((p) => p.workCode === workCode)
  const valid = rows.filter((p) => p.validFrom <= onDate && (!p.validTo || p.validTo >= onDate))
  const pool = valid.length > 0 ? valid : rows
  return (
    [...pool].sort(
      (a, b) => BASIS_PRIORITY[a.basis] - BASIS_PRIORITY[b.basis] || b.validFrom.localeCompare(a.validFrom)
    )[0] ?? null
  )
}

export function unitPriceById(id: string | null): UnitPrice | null {
  return UNIT_PRICES.find((p) => p.id === id) ?? null
}

/** 공종 금액 — 단가로 못 구하는 공종은 직접 금액, 없으면 null(미입력) */
export function workAmount(w: PlanWorkItem): number | null {
  if (workTypeOf(w.workCode)?.manualOnly) return w.manualAmountWon
  if (w.qty == null || w.unitPriceWon == null) return null
  return w.qty * w.unitPriceWon
}

/** 시설 유형·제원으로 공종·수량 제안(선형 시설은 전체 연장을 상한으로) */
export function suggestWorks(f: SmallPublicFacility, onDate: string): PlanWorkItem[] {
  const len = Number(f.length) || null
  const wid = Number(f.width) || null
  const make = (workCode: string, qty: number | null): PlanWorkItem => {
    const p = unitPriceFor(workCode, onDate)
    return {
      id: `w-${workCode}-${Math.random().toString(36).slice(2, 7)}`,
      workCode,
      qty,
      priceId: p?.id ?? null,
      unitPriceWon: p?.priceWon ?? null,
      manualAmountWon: null,
      source: 'AUTO',
    }
  }
  switch (f.type) {
    case '세천':
      return [make('RIVERBANK', len)]
    case '마을진입로':
    case '농로':
      return [make('REPAVE', len)]
    case '소교량':
      return [make('BRIDGE_REINSTALL', 1)]
    case '낙차공':
      return len ? [make('DROP_REINSTALL_L', len)] : [make('DROP_REINSTALL_EA', 1)]
    case '취입보':
      return [make('INTAKE_WEIR_H10', wid ?? len)]
  }
}

/* ── 사업비 ───────────────────────────────────────────── */

export function compMultiplier(): { rate: number; label: string } {
  if (SYSTEM_PARAMS.COMP_MULT_MODE === 'FIXED') {
    return { rate: SYSTEM_PARAMS.COMP_FIXED_MULT, label: `고정 ${SYSTEM_PARAMS.COMP_FIXED_MULT}배` }
  }
  const r = COMP_MULTIPLIERS.find((m) => m.region === SYSTEM_PARAMS.COMP_REGION_CODE)
  return {
    rate: r?.rate ?? SYSTEM_PARAMS.COMP_FIXED_MULT,
    label: r ? `${r.sido} ${r.region}권역 ${r.rate}` : `고정 ${SYSTEM_PARAMS.COMP_FIXED_MULT}배`,
  }
}

export type PlanCost = { work: number; comp: number; extra: number; total: number; missingWorks: number }

export function planCost(v: PlanVersion): PlanCost {
  let work = 0
  let missingWorks = 0
  for (const w of v.works) {
    const a = workAmount(w)
    if (a == null) missingWorks++
    else work += a
  }
  const comp = v.compNone
    ? 0
    : v.parcels.reduce((n, p) => n + (p.exclude ? 0 : p.inclAreaM2 * (p.landPriceWon ?? 0) * p.multiplier), 0)
  const extra = v.extras.reduce((n, x) => n + x.amountWon, 0)
  return { work, comp, extra, total: work + comp + extra, missingWorks }
}

/** 사업규모 — 기존 계획은 보고서 값, 분석은 정비 공종·수량을 보고서 형식으로(예: 호안정비 L=296m 소교량 재설치 1개소) */
export function planScaleText(v: PlanVersion): string {
  if (v.origin === 'REPORT') return v.reported?.scale ?? ''
  return v.works
    .map((w) => {
      const wt = workTypeOf(w.workCode)
      const name = (wt?.name ?? w.workCode).replace(/\([^)]*\)$/, '')
      if (w.qty == null) return name
      const q = w.qty.toLocaleString('ko-KR')
      return wt?.unit === 'm' ? `${name} L=${q}m` : `${name} ${q}${wt?.unit ?? ''}`
    })
    .join(' ')
}

/** 사업량(m) — 기존 계획은 보고서 값, 분석은 m 단위 공종 수량 합 */
export function planWorkloadM(v: PlanVersion): number {
  if (v.origin === 'REPORT') return v.reported?.workloadM ?? 0
  return v.works.reduce((n, w) => n + (workTypeOf(w.workCode)?.unit === 'm' ? (w.qty ?? 0) : 0), 0)
}


/* ── 평가 ─────────────────────────────────────────────── */

export type ScoreItem = { code: EvalItemCode; score: number | null; raw: string; source: PlanSource; formula: string }

function bandScore(item: 'BC' | 'INCONV' | 'ELAPSED', value: number): number {
  const band = EVAL_BANDS[item].find(
    (b) => (b.lower == null || value >= b.lower) && (b.upper == null || value < b.upper)
  )
  return band?.score ?? 0
}

/** 값이 들어간 구간 번호(화면 강조용) */
export function bandIndexOf(item: 'BC' | 'INCONV' | 'ELAPSED', value: number | null): number | null {
  if (value == null) return null
  const i = EVAL_BANDS[item].findIndex((b) => (b.lower == null || value >= b.lower) && (b.upper == null || value < b.upper))
  return i >= 0 ? i : null
}

export function yearsBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 24 * 3600 * 1000)
}

/** 피해 집계 시작일 — 기준일에서 최근 N년(설정값) */
export function damageFromYmd(baseDate: string): string {
  const from = new Date(baseDate)
  from.setFullYear(from.getFullYear() - SYSTEM_PARAMS.DAMAGE_LOOKBACK_YEARS)
  return from.toISOString().slice(0, 10)
}

export type DamageRowCalc = {
  supportIndex: number | null
  weight: number | null
  /** 이 줄 피해이력지수 = 지원기준지수(천원) × 물량 × 가중치 */
  index: number | null
  /** 계산에서 빠진 이유 */
  skip: '' | '발생일 필요' | '집계 기간 밖' | '항목 필요' | '물량 필요'
}

/** 피해 내역 한 줄 계산 */
export function damageRowCalc(e: PlanVersion['damageEvents'][number], baseDate: string): DamageRowCalc {
  const item = DAMAGE_ITEMS.find((d) => d.code === e.itemCode && d.active)
  const supportIndex = item ? (e.overrideSupportIndex ?? damageSupportIndex(item)) : null
  const weight = item ? damageGroupOf(item.group).weight : null
  const skip: DamageRowCalc['skip'] = !item
    ? '항목 필요'
    : e.qty == null
      ? '물량 필요'
      : !e.occurredOn
        ? '발생일 필요'
        : e.occurredOn < damageFromYmd(baseDate) || e.occurredOn > baseDate
          ? '집계 기간 밖'
          : ''
  return { supportIndex, weight, index: skip ? null : supportIndex! * e.qty! * weight!, skip }
}

/** 피해이력지수 — 최근 N년 발생분 줄 지수의 합. 피해 없음은 0, 계산된 줄이 없으면 미입력 */
export function damageIndex(v: PlanVersion, baseDate: string): number | null {
  if (v.damageNone) return 0
  const rows = v.damageEvents.map((e) => damageRowCalc(e, baseDate)).filter((r) => r.index != null)
  return rows.length ? rows.reduce((n, r) => n + r.index!, 0) : null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** B/C = 편익 ÷ 분석 사업비(소수 2자리). 편익을 넣지 않았거나 사업비가 0이면 null */
export function planBcRatio(v: PlanVersion): number | null {
  if (v.bcBenefitWon == null) return null
  const cost = planCost(v).total
  return cost > 0 ? Math.round((v.bcBenefitWon / cost) * 100) / 100 : null
}

function evaluateBc(v: PlanVersion): ScoreItem {
  if (v.bcBenefitWon == null) {
    return {
      code: 'BC',
      score: SYSTEM_PARAMS.BC_DEFAULT_SCORE,
      raw: '기존 계획 기준',
      source: 'DEFAULT',
      formula: `편익 미입력 시 기본 ${SYSTEM_PARAMS.BC_DEFAULT_SCORE}점`,
    }
  }
  const ratio = planBcRatio(v)
  if (ratio == null) {
    return { code: 'BC', score: null, raw: '—', source: 'MISSING', formula: '사업비가 있어야 B/C를 계산합니다' }
  }
  return {
    code: 'BC',
    score: bandScore('BC', ratio),
    raw: `편익 ${toMillion(v.bcBenefitWon)} ÷ 사업비 ${toMillion(planCost(v).total)}백만원 = B/C ${ratio}`,
    source: 'MANUAL',
    formula: 'B/C = 편익 ÷ 사업비, 구간 점수',
  }
}

export function evaluate(v: PlanVersion, baseDate: string): Record<EvalItemCode, ScoreItem> {
  const max = (code: EvalItemCode) => EVAL_ITEMS.find((i) => i.code === code)!.max

  const bc = evaluateBc(v)

  const idx = damageIndex(v, baseDate)
  const damageMax = max('DAMAGE_IDX')
  const damage: ScoreItem =
    idx == null
      ? { code: 'DAMAGE_IDX', score: null, raw: '—', source: 'MISSING', formula: '피해이력을 넣거나 «피해 없음»을 고르세요' }
      : {
          code: 'DAMAGE_IDX',
          score: round1(Math.min(damageMax, (idx / SYSTEM_PARAMS.DAMAGE_DIVISOR) * damageMax)),
          raw: v.damageNone ? '피해 없음' : `지수 ${round1(idx).toLocaleString('ko-KR')}`,
          source: v.damageNone ? 'MANUAL' : 'AUTO',
          formula: `min(${damageMax}, 지수 ÷ ${SYSTEM_PARAMS.DAMAGE_DIVISOR.toLocaleString('ko-KR')} × ${damageMax}), 최근 ${SYSTEM_PARAMS.DAMAGE_LOOKBACK_YEARS}년`,
        }

  const grade = RISK_GRADES.find((g) => g.code === v.riskGrade)
  const cas = RISK_CASUALTIES.find((c) => c.code === (v.riskCasualty ?? 'NONE'))!
  const risk: ScoreItem = grade
    ? {
        code: 'RISK',
        score: Math.min(max('RISK'), grade.score + cas.score),
        raw: `${grade.name} · 인명피해 ${cas.name}`,
        source: v.riskDefault ? 'DEFAULT' : 'MANUAL',
        formula: '위험등급(가20·나10·다5) + 인명피해(사망10·부상5), 최대 30',
      }
    : { code: 'RISK', score: null, raw: '—', source: 'MISSING', formula: '위험등급을 고르세요' }

  const density = v.population != null && v.areaHa ? v.population / v.areaHa : null
  const inconv: ScoreItem =
    density != null
      ? {
          code: 'INCONV',
          score: bandScore('INCONV', density),
          raw: `${round1(density)}명/ha`,
          source: 'AUTO',
          formula: '거주인구 ÷ 영향 면적(명/ha) 구간 점수',
        }
      : { code: 'INCONV', score: null, raw: '—', source: 'MISSING', formula: '거주인구와 영향 면적을 넣으세요' }

  const years = v.designatedOn ? yearsBetween(v.designatedOn, baseDate) : null
  const elapsed: ScoreItem =
    years != null
      ? {
          code: 'ELAPSED',
          score: bandScore('ELAPSED', years),
          raw: `${round1(years)}년`,
          source: 'AUTO',
          formula: '위험시설 지정일부터 경과년수 구간 점수',
        }
      : { code: 'ELAPSED', score: null, raw: '—', source: 'MISSING', formula: '위험시설 지정일을 넣으세요' }

  return { BC: bc, DAMAGE_IDX: damage, RISK: risk, INCONV: inconv, ELAPSED: elapsed }
}

export type PlanStepKey = 'works' | 'cost' | 'eval' | 'result'

export type PlanCheck = { step: PlanStepKey; label: string; done: boolean }

/** 완성도 — 단계별 필수 입력 */
export function planChecks(v: PlanVersion, baseDate: string): PlanCheck[] {
  const scores = evaluate(v, baseDate)
  const cost = planCost(v)
  return [
    { step: 'works', label: '정비 공종', done: v.works.length > 0 },
    { step: 'works', label: '공종 금액(수량·단가 또는 직접 금액)', done: v.works.length > 0 && cost.missingWorks === 0 },
    {
      step: 'cost',
      label: '보상 필지 또는 «보상 없음»',
      done: v.compNone || (v.parcels.length > 0 && v.parcels.every((p) => p.exclude || p.landPriceWon != null)),
    },
    ...EVAL_ITEMS.map((i) => ({
      step: 'eval' as const,
      label: i.name,
      done: scores[i.code].source !== 'MISSING',
    })),
    ...SUPP_ITEMS.map((s) => ({ step: 'eval' as const, label: `부가적 평가 ${s.name}`, done: v.supp[s.code] != null })),
  ]
}

export type PlanSummary = {
  scores: Record<EvalItemCode, ScoreItem>
  total: number
  provisional: boolean
  cost: PlanCost
  checks: PlanCheck[]
  completeness: number
  missingCount: number
}

/** 기존 계획 — 보고서 결과값 그대로(중간 평가 내용 없음) */
function summarizeReported(v: PlanVersion): PlanSummary {
  const r = v.reported
  const scores = Object.fromEntries(
    EVAL_ITEMS.map((i) => [
      i.code,
      { code: i.code, score: r?.scores[i.code] ?? null, raw: '기존 계획', source: 'ACTUAL', formula: '기존 정비계획 결과값' },
    ])
  ) as Record<EvalItemCode, ScoreItem>
  const cost = r?.costWon ?? 0
  return {
    scores,
    total: r?.totalScore ?? 0,
    provisional: false,
    cost: { work: cost, comp: 0, extra: 0, total: cost, missingWorks: 0 },
    checks: [],
    completeness: 100,
    missingCount: 0,
  }
}

export function summarizePlan(v: PlanVersion, baseDate: string): PlanSummary {
  if (v.origin === 'REPORT') return summarizeReported(v)
  const scores = evaluate(v, baseDate)
  const items = Object.values(scores)
  const checks = planChecks(v, baseDate)
  const done = checks.filter((c) => c.done).length
  return {
    scores,
    total: round1(items.reduce((n, s) => n + (s.score ?? 0), 0)),
    provisional: items.some((s) => s.source === 'MISSING'),
    cost: planCost(v),
    checks,
    completeness: Math.round((done / checks.length) * 100),
    missingCount: checks.length - done,
  }
}

/**
 * 사업효과(자동) — 수혜자 = 주민불편도 거주인구, 건물 = 피해이력 주택 동·세대.
 * 농경지는 피해이력 항목에서 뺐으므로 명세서 칸만 두고 값은 비운다.
 */
export function planEffect(v: PlanVersion): { people: number | null; farmHa: number | null; buildings: number | null } {
  if (v.origin === 'REPORT') return { people: null, farmHa: null, buildings: null }
  const houses = v.damageEvents.filter((e) => e.itemCode?.startsWith('HOUSE_')).reduce((n, e) => n + (e.qty ?? 0), 0)
  return { people: v.population, farmHa: null, buildings: houses || null }
}

/* ── 순위·단계·연차 ──────────────────────────────────── */

export type PlanRanked = {
  unit: PlanUnit
  version: PlanVersion
  summary: PlanSummary
  baseRank: number
  finalRank: number
  phase: 1 | 2
  /** 1~5차년, null = 5개년 이후, undefined = 분석 중(검토 후 배분) */
  yearNo: number | null | undefined
}

/** 총점 내림차순, 동점은 재해위험도 > 피해이력지수 > 주민불편도 > 경과년수 > B/C(4장 4.2.2) */
function compareScore(a: PlanSummary, b: PlanSummary): number {
  if (b.total !== a.total) return b.total - a.total
  for (const t of TIE_BREAK) {
    if (t.item === 'DAMAGE_AREA') continue
    const d = (b.scores[t.item].score ?? 0) - (a.scores[t.item].score ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 순위 — 기존 계획은 보고서의 기초·최종순위와 연차를 그대로 쓴다.
 * 분석 중 시설은 군 전체 총점 비교로 예상 기초순위를 내고(앞선 계획 수 + 1), 최종순위 조정 규칙은 확인 전이라 기초순위를 쓴다.
 * 단계는 기존 계획은 연차가 있으면 1단계, 분석 중은 순위 컷(설정값).
 */
export function rankPlans(units: PlanUnit[], baseDate: string, override?: { unitId: string; version: PlanVersion }) {
  const rows = units.map((unit) => {
    const version = override && override.unitId === unit.id ? override.version : currentVersion(unit)
    return { unit, version, summary: summarizePlan(version, baseDate) }
  })
  const ranked = rows.map((r): PlanRanked => {
    const rep = r.version.origin === 'REPORT' ? r.version.reported : null
    if (rep) {
      return { ...r, baseRank: rep.baseRank, finalRank: rep.finalRank, phase: rep.yearNo != null ? 1 : 2, yearNo: rep.yearNo }
    }
    const ahead = rows.filter((o) => o !== r && compareScore(o.summary, r.summary) < 0).length
    const baseRank = ahead + 1
    return { ...r, baseRank, finalRank: baseRank, phase: baseRank <= SYSTEM_PARAMS.PHASE1_RANK_CUT ? 1 : 2, yearNo: undefined }
  })
  return ranked.sort(
    (a, b) =>
      a.finalRank - b.finalRank ||
      Number(a.version.origin === 'ANALYSIS') - Number(b.version.origin === 'ANALYSIS') ||
      a.unit.unitName.localeCompare(b.unit.unitName, 'ko')
  )
}

export function yearLabel(yearNo: number | null | undefined, startYear?: number): string {
  if (yearNo === undefined) return '검토 후 배분'
  if (yearNo == null) return '5개년 이후'
  return startYear ? `${startYear + yearNo - 1}년(${yearNo}차)` : `${yearNo}차년`
}

/* ── 중기계획 명세서 ─────────────────────────────────── */

export type PlanSheetCells = {
  totalQty: number
  totalCost: number
  doneQty: number
  doneCost: number
  /** 중기 1~5차년 사업량·사업비(남은 부분을 배분한 연차에 모두) */
  years: { qty: number; cost: number }[]
  afterQty: number
  afterCost: number
  people: number
  farmHa: number
  buildings: number
}

/** 명세서 한 줄 값 — 사업량 m, 사업비 원 */
export function planSheetCells(r: PlanRanked): PlanSheetCells {
  const v = r.version
  const totalQty = planWorkloadM(v)
  const totalCost = r.summary.cost.total
  const doneQty = v.done?.qty ?? 0
  const doneCost = v.done?.costWon ?? 0
  const years = Array.from({ length: SYSTEM_PARAMS.PLAN_PERIOD_YEARS }, () => ({ qty: 0, cost: 0 }))
  const remainQty = Math.max(0, totalQty - doneQty)
  const remainCost = Math.max(0, totalCost - doneCost)
  let afterQty = 0
  let afterCost = 0
  if (r.yearNo != null) years[r.yearNo - 1] = { qty: remainQty, cost: remainCost }
  else if (r.yearNo === null) {
    afterQty = remainQty
    afterCost = remainCost
  }
  const effect = planEffect(v)
  return {
    totalQty,
    totalCost,
    doneQty,
    doneCost,
    years,
    afterQty,
    afterCost,
    people: effect.people ?? 0,
    farmHa: effect.farmHa ?? 0,
    buildings: effect.buildings ?? 0,
  }
}

/** 여러 줄 합계(계) */
export function sumPlanSheetCells(list: PlanSheetCells[]): PlanSheetCells {
  const zero: PlanSheetCells = {
    totalQty: 0,
    totalCost: 0,
    doneQty: 0,
    doneCost: 0,
    years: Array.from({ length: SYSTEM_PARAMS.PLAN_PERIOD_YEARS }, () => ({ qty: 0, cost: 0 })),
    afterQty: 0,
    afterCost: 0,
    people: 0,
    farmHa: 0,
    buildings: 0,
  }
  return list.reduce(
    (a, c) => ({
      totalQty: a.totalQty + c.totalQty,
      totalCost: a.totalCost + c.totalCost,
      doneQty: a.doneQty + c.doneQty,
      doneCost: a.doneCost + c.doneCost,
      years: a.years.map((y, i) => ({ qty: y.qty + c.years[i]!.qty, cost: y.cost + c.years[i]!.cost })),
      afterQty: a.afterQty + c.afterQty,
      afterCost: a.afterCost + c.afterCost,
      people: a.people + c.people,
      farmHa: a.farmHa + c.farmHa,
      buildings: a.buildings + c.buildings,
    }),
    zero
  )
}

/** 중기 계(1~5차년 합) */
export function planSheetMid(c: PlanSheetCells): { qty: number; cost: number } {
  return c.years.reduce((a, y) => ({ qty: a.qty + y.qty, cost: a.cost + y.cost }), { qty: 0, cost: 0 })
}

/** 정비율(%) = 사업량 ÷ 전체 정비계획 사업량 */
export function planRate(qty: number, totalQty: number): number | null {
  return totalQty > 0 ? Math.round((qty / totalQty) * 1000) / 10 : null
}
