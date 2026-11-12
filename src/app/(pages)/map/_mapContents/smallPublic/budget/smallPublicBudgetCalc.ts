import type { SmallPublicFacType } from '../smallPublicConfig'
import { currentVersion, type PlanStatus, type PlanUnit } from '../plan/smallPublicPlanTypes'
import type { BudgetAlloc, BudgetItem, Construction, ConstructionStatus } from './smallPublicBudgetTypes'

export const allocExecWon = (a: BudgetAlloc) => a.execs.reduce((n, e) => n + e.amountWon, 0)
export const budgetAllocWon = (b: BudgetItem) => b.allocs.reduce((n, a) => n + a.amountWon, 0)
export const budgetExecWon = (b: BudgetItem) => b.allocs.reduce((n, a) => n + allocExecWon(a), 0)

/** 집행률(%) — 예산 0이면 null */
export function execRate(execWon: number, amountWon: number): number | null {
  return amountWon > 0 ? Math.round((execWon / amountWon) * 1000) / 10 : null
}

export function wonText(won: number | null | undefined): string {
  return won == null ? '' : `${won.toLocaleString('ko-KR')}원`
}

/** 백만원(소수 1자리) */
export function millionText(won: number): string {
  return (Math.round(won / 100_000) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** 공사 연도 — 착공일, 없으면 연결 예산 연도 */
export function constructionYear(c: Construction, budgets: BudgetItem[]): number | null {
  const y = Number(c.startDate.slice(0, 4))
  if (y) return y
  return budgets.find((b) => b.id === c.budgetId)?.fiscalYear ?? null
}

/** 준공 공사 실적 — 정비계획 시설별 시공 사업량·실제 공사비 합 */
export function doneByPlanUnit(constructions: Construction[]): Map<string, { qty: number; costWon: number }> {
  const map = new Map<string, { qty: number; costWon: number }>()
  for (const c of constructions) {
    if (c.status !== 'DONE') continue
    for (const f of c.facilities) {
      const prev = map.get(f.planUnitId) ?? { qty: 0, costWon: 0 }
      map.set(f.planUnitId, { qty: prev.qty + (f.doneQty ?? 0), costWon: prev.costWon + (f.actualCostWon ?? 0) })
    }
  }
  return map
}

/**
 * 공사 실적을 정비계획에 합친다 — 준공 공사의 사업량·공사비는 «정비된 부분»으로,
 * 확정 계획의 상태는 준공 공사가 있으면 완료, 진행 공사가 있으면 진행으로 보여 준다.
 */
export function applyConstructionToUnits(units: PlanUnit[], constructions: Construction[]): PlanUnit[] {
  const done = doneByPlanUnit(constructions)
  const statusOf = new Map<string, PlanStatus>()
  for (const c of constructions) {
    if (c.status !== 'DONE' && c.status !== 'ONGOING') continue
    for (const f of c.facilities) {
      if (c.status === 'DONE') statusOf.set(f.planUnitId, 'DONE')
      else if (!statusOf.has(f.planUnitId)) statusOf.set(f.planUnitId, 'IN_PROGRESS')
    }
  }
  if (done.size === 0 && statusOf.size === 0) return units
  return units.map((u) => {
    const d = done.get(u.id)
    const st = statusOf.get(u.id)
    const v = currentVersion(u)
    if (!d && !st) return u
    if (v.status === 'DRAFT' || v.status === 'REVIEW') return u
    const next = { ...v, done: d ?? v.done, status: st ?? v.status }
    return { ...u, versions: [...u.versions.slice(0, -1), next] }
  })
}

export type BudgetYearStats = {
  amountWon: number
  allocWon: number
  execWon: number
  remainWon: number
  rate: number | null
  constructions: Record<ConstructionStatus, number>
  byEmd: { label: string; execWon: number }[]
  byType: { label: SmallPublicFacType; execWon: number }[]
}

/** 연도 현황 — 예산·배정·집행·잔액, 공사 건수, 읍면별·유형별 집행 */
export function budgetYearStats(
  year: number,
  budgets: BudgetItem[],
  constructions: Construction[],
  unitById: Map<string, PlanUnit>
): BudgetYearStats {
  const list = budgets.filter((b) => b.fiscalYear === year)
  const amountWon = list.reduce((n, b) => n + b.amountWon, 0)
  const allocWon = list.reduce((n, b) => n + budgetAllocWon(b), 0)
  const execWon = list.reduce((n, b) => n + budgetExecWon(b), 0)
  const emd = new Map<string, number>()
  const type = new Map<SmallPublicFacType, number>()
  for (const b of list) {
    for (const a of b.allocs) {
      const u = unitById.get(a.planUnitId)
      const won = allocExecWon(a)
      if (!u || !won) continue
      const e = u.emd || (u.ri ? `${u.ri}(읍면 확인)` : '미상')
      emd.set(e, (emd.get(e) ?? 0) + won)
      type.set(u.type, (type.get(u.type) ?? 0) + won)
    }
  }
  const counts: Record<ConstructionStatus, number> = { PLANNED: 0, ONGOING: 0, DONE: 0, CANCELED: 0 }
  for (const c of constructions) if (constructionYear(c, budgets) === year) counts[c.status] += 1
  const sortDesc = <T extends { execWon: number }>(rows: T[]) => rows.sort((x, y) => y.execWon - x.execWon)
  return {
    amountWon,
    allocWon,
    execWon,
    remainWon: amountWon - execWon,
    rate: execRate(execWon, amountWon),
    constructions: counts,
    byEmd: sortDesc([...emd].map(([label, w]) => ({ label, execWon: w }))),
    byType: sortDesc([...type].map(([label, w]) => ({ label, execWon: w }))),
  }
}

/** 등록된 예산 연도 + 올해 */
export function budgetYears(budgets: BudgetItem[]): number[] {
  const set = new Set(budgets.map((b) => b.fiscalYear))
  set.add(new Date().getFullYear())
  return [...set].sort((a, b) => b - a)
}
