/**
 * 정비계획 명세서 — layer.spf_plan_fac DB 행 모델·계산. 사업량 m, 사업비 백만원, 정비율 %.
 * DB에는 «정비된 부분»의 사업량·사업비 칸이 없어 전체 = 정비된 + 중기 + 5개년 후로 저장하고,
 * 읽을 때 정비된 부분 = 전체 − 중기 − 5개년 후 로 되돌린다.
 */

/** 중기 연차 수(1~5차년) */
export const PLAN_DB_YEARS = 5

export type PlanDbPeriod = { id: number; startYear: number; endYear: number }

export type PlanQtyCost = { qty: number; costMil: number }

/** 정비계획 목록 한 줄 — 시설명·위치는 관리번호(소교량은 묶음 관리번호)로 조회한 값 */
export type PlanDbRow = {
  id: number
  planId: number
  consCode: string
  /** 소교량 리 묶음 여부 */
  isBridgeGroup: boolean
  name: string
  type: string
  emd: string
  ri: string
  finalRank: number | null
  workloadM: number
  costMil: number
  after: PlanQtyCost
  years: PlanQtyCost[]
  people: number
  farmHa: number
  buildings: number
}

/** 서버가 내려주는 명세서 데이터 — 연도구간 목록과 선택된 구간의 정비계획 목록 */
export type PlanSheetPayload = {
  plans: PlanDbPeriod[]
  planId: number | null
  rows: PlanDbRow[]
}

/** 명세서에서 입력하는 값 묶음 */
export type PlanSheetValues = {
  midYears: PlanQtyCost[]
  done: PlanQtyCost
  after: PlanQtyCost
  effect: { people: number; farmHa: number; buildings: number }
}

/** 저장 요청 한 줄 */
export type PlanSaveEntry = {
  id: number
  midYears: PlanQtyCost[]
  done: PlanQtyCost
  after: PlanQtyCost
  effect: { people: number; farmHa: number; buildings: number }
}

export type PlanSheetCells = {
  totalQty: number
  totalCost: number
  doneQty: number
  doneCost: number
  doneRate: number | null
  midRate: number | null
  years: PlanQtyCost[]
  afterQty: number
  afterCost: number
  people: number
  farmHa: number
  buildings: number
}

const emptyYears = (): PlanQtyCost[] => Array.from({ length: PLAN_DB_YEARS }, () => ({ qty: 0, costMil: 0 }))

/** DB 행 → 입력값. 정비된 부분은 전체에서 중기·5개년 후를 뺀 나머지(음수는 0) */
export function planSheetValuesOf(row: PlanDbRow): PlanSheetValues {
  const midYears = emptyYears().map((_, i) => row.years[i] ?? { qty: 0, costMil: 0 })
  const mid = midYears.reduce((a, y) => ({ qty: a.qty + y.qty, costMil: a.costMil + y.costMil }), { qty: 0, costMil: 0 })
  return {
    midYears,
    done: {
      qty: Math.max(0, round(row.workloadM - mid.qty - row.after.qty)),
      costMil: Math.max(0, round(row.costMil - mid.costMil - row.after.costMil)),
    },
    after: row.after,
    effect: { people: row.people, farmHa: row.farmHa, buildings: row.buildings },
  }
}

/** 부동소수 오차 정리(소수 3자리) */
function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** 정비율(%) = 사업량 ÷ 전체 사업량 × 100, 소수 1자리 */
export function planRate(qty: number, totalQty: number): number | null {
  return totalQty > 0 ? Math.round((qty / totalQty) * 1000) / 10 : null
}

/** 입력값 → 명세서 한 줄 계산(전체 = 정비된 + 중기 + 5개년 후) */
export function planSheetCellsOf(v: PlanSheetValues): PlanSheetCells {
  const mid = planSheetMid(v.midYears)
  const totalQty = round(v.done.qty + mid.qty + v.after.qty)
  const totalCost = round(v.done.costMil + mid.costMil + v.after.costMil)
  return {
    totalQty,
    totalCost,
    doneQty: v.done.qty,
    doneCost: v.done.costMil,
    doneRate: planRate(v.done.qty, totalQty),
    midRate: planRate(mid.qty, totalQty),
    years: v.midYears,
    afterQty: v.after.qty,
    afterCost: v.after.costMil,
    people: v.effect.people,
    farmHa: v.effect.farmHa,
    buildings: v.effect.buildings,
  }
}

export function planCellsOfRow(row: PlanDbRow): PlanSheetCells {
  return planSheetCellsOf(planSheetValuesOf(row))
}

/** 중기 계(1~5차년 합) */
export function planSheetMid(years: PlanQtyCost[]): PlanQtyCost {
  return years.reduce((a, y) => ({ qty: a.qty + y.qty, costMil: a.costMil + y.costMil }), { qty: 0, costMil: 0 })
}

/** 여러 줄 합계(계) — 정비율은 합계 사업량으로 다시 계산 */
export function sumPlanSheetCells(list: PlanSheetCells[]): PlanSheetCells {
  const s = list.reduce<PlanSheetCells>(
    (a, c) => ({
      totalQty: a.totalQty + c.totalQty,
      totalCost: a.totalCost + c.totalCost,
      doneQty: a.doneQty + c.doneQty,
      doneCost: a.doneCost + c.doneCost,
      doneRate: null,
      midRate: null,
      years: a.years.map((y, i) => ({ qty: y.qty + (c.years[i]?.qty ?? 0), costMil: y.costMil + (c.years[i]?.costMil ?? 0) })),
      afterQty: a.afterQty + c.afterQty,
      afterCost: a.afterCost + c.afterCost,
      people: a.people + c.people,
      farmHa: a.farmHa + c.farmHa,
      buildings: a.buildings + c.buildings,
    }),
    {
      totalQty: 0,
      totalCost: 0,
      doneQty: 0,
      doneCost: 0,
      doneRate: null,
      midRate: null,
      years: emptyYears(),
      afterQty: 0,
      afterCost: 0,
      people: 0,
      farmHa: 0,
      buildings: 0,
    }
  )
  const mid = planSheetMid(s.years)
  return {
    ...s,
    totalQty: round(s.totalQty),
    totalCost: round(s.totalCost),
    doneRate: planRate(s.doneQty, s.totalQty),
    midRate: planRate(mid.qty, s.totalQty),
  }
}

/** 시설명·위치 칸 — 위치는 «읍면 리» */
export function planRowLocation(row: PlanDbRow): string {
  return [row.emd, row.ri].filter(Boolean).join(' ')
}
