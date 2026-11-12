'use client'

/**
 * 예산·공사 저장소(예시 단계) — 기존 정비계획 1차년 상위 시설로 2025년(준공)·2026년(진행·계획) 예시를 만든다.
 * 새로고침 전까지만 유지된다.
 */

import { useSyncExternalStore } from 'react'
import { SMALL_PUBLIC_PLAN_REPORT_ROWS } from '../plan/smallPublicPlanReportData'
import type {
  BudgetAlloc,
  BudgetExec,
  BudgetItem,
  Construction,
  ConstructionFacility,
  ConstructionFile,
} from './smallPublicBudgetTypes'

type State = { budgets: BudgetItem[]; constructions: Construction[] }

let seq = 0
export function newBudgetId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

const round1000 = (won: number) => Math.round(won / 1000) * 1000

function initialState(): State {
  const rows = SMALL_PUBLIC_PLAN_REPORT_ROWS.filter((r) => r[3] === 1)
    .slice()
    .sort((a, b) => a[8] - b[8])
    .slice(0, 8)
    .map((r) => ({ unitId: `plan-${r[0]}`, costWon: r[2] * 1_000_000, qty: r[9] }))
  if (rows.length < 8) return { budgets: [], constructions: [] }
  const [r0, r1, r2, r3, r4, r5, r6, r7] = rows as [
    (typeof rows)[number],
    (typeof rows)[number],
    (typeof rows)[number],
    (typeof rows)[number],
    (typeof rows)[number],
    (typeof rows)[number],
    (typeof rows)[number],
    (typeof rows)[number],
  ]

  const exec = (id: string, execDate: string, amountWon: number, memo: string): BudgetExec => ({
    id,
    execDate,
    amountWon: round1000(amountWon),
    memo,
  })
  /** 준공 — 선금 30%, 준공금 나머지(실제 공사비 = 계획의 95%) */
  const doneExecs = (key: string, costWon: number, start: string, end: string): BudgetExec[] => {
    const actual = round1000(costWon * 0.95)
    const advance = round1000(actual * 0.3)
    return [exec(`${key}-1`, start, advance, '선금'), exec(`${key}-2`, end, actual - advance, '준공금')]
  }
  const alloc = (id: string, r: (typeof rows)[number], execs: BudgetExec[]): BudgetAlloc => ({
    id,
    planUnitId: r.unitId,
    yearNo: 1,
    amountWon: r.costWon,
    execs,
  })

  const budgetBase = (amountWon: number, period: string, code: string) => ({
    orderOrg: '경상북도 울진군',
    orderPeriod: period,
    budgetCode: code,
    deptName: '건설과',
    manager: '담당자',
    phone: '054-789-0000',
    supplyWon: round1000(amountWon * 0.72),
    materialWon: round1000(amountWon * 0.28),
    otherWon: 0,
  })

  const budgets: BudgetItem[] = [
    {
      id: 'bud-2025-county',
      fiscalYear: 2025,
      fundSource: 'COUNTY',
      title: '소규모 공공시설 정비사업',
      amountWon: 300_000_000,
      ...budgetBase(300_000_000, '2025/01', 'B25-COUNTY-01'),
      allocs: [
        alloc('al-2025-1', r0, doneExecs('ex-2025-1', r0.costWon, '2025-04-15', '2025-11-20')),
        alloc('al-2025-2', r1, doneExecs('ex-2025-2', r1.costWon, '2025-04-15', '2025-11-20')),
      ],
    },
    {
      id: 'bud-2025-prov',
      fiscalYear: 2025,
      fundSource: 'PROVINCIAL',
      title: '소규모 공공시설 정비 도비보조',
      amountWon: 300_000_000,
      ...budgetBase(300_000_000, '2025/01', 'B25-PROV-01'),
      allocs: [alloc('al-2025-3', r2, doneExecs('ex-2025-3', r2.costWon, '2025-05-02', '2025-12-10'))],
    },
    {
      id: 'bud-2026-county',
      fiscalYear: 2026,
      fundSource: 'COUNTY',
      title: '소규모 공공시설 정비사업',
      amountWon: 400_000_000,
      ...budgetBase(400_000_000, '2026/01', 'B26-COUNTY-01'),
      allocs: [
        alloc('al-2026-1', r3, [exec('ex-2026-1', '2026-04-20', r3.costWon * 0.3, '선금')]),
        alloc('al-2026-2', r4, [exec('ex-2026-2', '2026-04-20', r4.costWon * 0.3, '선금')]),
        alloc('al-2026-3', r5, []),
        alloc('al-2026-4', r6, []),
      ],
    },
    {
      id: 'bud-2026-prov',
      fiscalYear: 2026,
      fundSource: 'PROVINCIAL',
      title: '소규모 공공시설 정비 도비보조',
      amountWon: 600_000_000,
      ...budgetBase(600_000_000, '2026/01', 'B26-PROV-01'),
      allocs: [alloc('al-2026-5', r7, [exec('ex-2026-3', '2026-05-12', r7.costWon * 0.3, '선금')])],
    },
  ]

  const doneFac = (r: (typeof rows)[number]): ConstructionFacility => ({
    planUnitId: r.unitId,
    doneQty: r.qty,
    actualCostWon: round1000(r.costWon * 0.95),
  })
  const plannedFac = (r: (typeof rows)[number]): ConstructionFacility => ({ planUnitId: r.unitId, doneQty: null, actualCostWon: null })
  const sampleFile = (id: string, kind: ConstructionFile['kind'], name: string): ConstructionFile => ({
    id,
    name,
    kind,
    uploadedAt: '2025-11-28',
  })

  const conMeta = (contractWon: number | null, contractDate: string, loc: string) => ({
    office: '본청',
    orderDept: '건설과',
    estimatedWon: contractWon,
    initialContractWon: contractWon,
    bidRate: contractWon ? 95 : null,
    totalContractWon: contractWon,
    contractDate,
    contractMethod: '수의1인견적',
    contractorRep: '',
    location: loc,
    contractReason:
      '추정가격 2억원 이하인 공사로서 「건설산업기본법」 제2조제5호에 따른 종합공사 또는 같은 조 제6호에 따른 전문공사(지방계약법 시행령)',
    superviseDept: '건설과',
    supervisor: '',
  })

  const constructions: Construction[] = [
    {
      id: 'con-2025-1',
      name: '온양리·정림리 마을진입로 정비공사',
      budgetId: 'bud-2025-county',
      contractor: '울진종합건설',
      contractWon: round1000((r0.costWon + r1.costWon) * 0.95),
      designWon: r0.costWon + r1.costWon,
      startDate: '2025-04-01',
      endDate: '2025-10-31',
      completedOn: '2025-10-28',
      status: 'DONE',
      ...conMeta(round1000((r0.costWon + r1.costWon) * 0.95), '2025-03-28', '경상북도 울진군 울진읍'),
      contractorRep: '김울진',
      facilities: [doneFac(r0), doneFac(r1)],
      files: [
        sampleFile('cf-1', 'DESIGN', '온양리·정림리_실시설계서.pdf'),
        sampleFile('cf-2', 'CONTRACT', '온양리·정림리_공사계약서.pdf'),
        sampleFile('cf-3', 'COMPLETION', '온양리·정림리_준공검사조서.pdf'),
      ],
    },
    {
      id: 'con-2025-2',
      name: '부구리 소교량 정비공사',
      budgetId: 'bud-2025-prov',
      contractor: '북면토건',
      contractWon: round1000(r2.costWon * 0.95),
      designWon: r2.costWon,
      startDate: '2025-05-01',
      endDate: '2025-11-30',
      completedOn: '2025-11-25',
      status: 'DONE',
      ...conMeta(round1000(r2.costWon * 0.95), '2025-04-28', '경상북도 울진군 북면'),
      contractorRep: '이북면',
      facilities: [doneFac(r2)],
      files: [sampleFile('cf-4', 'CONTRACT', '부구리소교량_공사계약서.pdf')],
    },
    {
      id: 'con-2026-1',
      name: '구산리·봉평리 마을진입로 정비공사',
      budgetId: 'bud-2026-county',
      contractor: '평해건설',
      contractWon: round1000((r3.costWon + r4.costWon) * 0.95),
      designWon: r3.costWon + r4.costWon,
      startDate: '2026-04-06',
      endDate: '2026-12-15',
      completedOn: '',
      status: 'ONGOING',
      ...conMeta(round1000((r3.costWon + r4.costWon) * 0.95), '2026-04-01', '경상북도 울진군 평해읍'),
      contractorRep: '박평해',
      facilities: [plannedFac(r3), plannedFac(r4)],
      files: [sampleFile('cf-5', 'CONTRACT', '구산리·봉평리_공사계약서.pdf')],
    },
    {
      id: 'con-2026-2',
      name: '연지리 세천 정비공사',
      budgetId: 'bud-2026-prov',
      contractor: '울진종합건설',
      contractWon: round1000(r7.costWon * 0.95),
      designWon: r7.costWon,
      startDate: '2026-05-04',
      endDate: '2027-03-31',
      completedOn: '',
      status: 'ONGOING',
      ...conMeta(round1000(r7.costWon * 0.95), '2026-04-30', '경상북도 울진군 근남면'),
      contractorRep: '김울진',
      facilities: [plannedFac(r7)],
      files: [],
    },
    {
      id: 'con-2026-3',
      name: '고성리 농로·온양리 마을진입로 정비공사',
      budgetId: 'bud-2026-county',
      contractor: '',
      contractWon: null,
      designWon: r5.costWon + r6.costWon,
      startDate: '',
      endDate: '',
      completedOn: '',
      status: 'PLANNED',
      ...conMeta(null, '', '경상북도 울진군'),
      facilities: [plannedFac(r5), plannedFac(r6)],
      files: [],
    },
  ]
  return { budgets, constructions }
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

export function useSmallPublicBudgetStore(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}

function updateBudget(id: string, fn: (b: BudgetItem) => BudgetItem) {
  const s = getState()
  setState({ ...s, budgets: s.budgets.map((b) => (b.id === id ? fn(b) : b)) })
}

function updateAlloc(budgetId: string, allocId: string, fn: (a: BudgetAlloc) => BudgetAlloc) {
  updateBudget(budgetId, (b) => ({ ...b, allocs: b.allocs.map((a) => (a.id === allocId ? fn(a) : a)) }))
}

function updateConstruction(id: string, fn: (c: Construction) => Construction) {
  const s = getState()
  setState({ ...s, constructions: s.constructions.map((c) => (c.id === id ? fn(c) : c)) })
}

export const smallPublicBudgetActions = {
  /** 예산 등록·수정(배정은 그대로) */
  saveBudget(item: Omit<BudgetItem, 'allocs'>) {
    const s = getState()
    const exists = s.budgets.some((b) => b.id === item.id)
    setState({
      ...s,
      budgets: exists
        ? s.budgets.map((b) => (b.id === item.id ? { ...b, ...item } : b))
        : [...s.budgets, { ...item, allocs: [] }],
    })
  },

  /** 예산 삭제 — 배정·집행도 함께 지우고, 이 예산을 쓰던 공사는 예산 연결만 끊는다 */
  deleteBudget(id: string) {
    const s = getState()
    setState({
      budgets: s.budgets.filter((b) => b.id !== id),
      constructions: s.constructions.map((c) => (c.budgetId === id ? { ...c, budgetId: null } : c)),
    })
  },

  saveAlloc(budgetId: string, alloc: Omit<BudgetAlloc, 'execs'>) {
    updateBudget(budgetId, (b) => {
      const exists = b.allocs.some((a) => a.id === alloc.id)
      return {
        ...b,
        allocs: exists
          ? b.allocs.map((a) => (a.id === alloc.id ? { ...a, ...alloc } : a))
          : [...b.allocs, { ...alloc, execs: [] }],
      }
    })
  },

  deleteAlloc(budgetId: string, allocId: string) {
    updateBudget(budgetId, (b) => ({ ...b, allocs: b.allocs.filter((a) => a.id !== allocId) }))
  },

  addExecs(list: { budgetId: string; allocId: string; exec: BudgetExec }[]) {
    for (const x of list) updateAlloc(x.budgetId, x.allocId, (a) => ({ ...a, execs: [...a.execs, x.exec] }))
  },

  deleteExec(budgetId: string, allocId: string, execId: string) {
    updateAlloc(budgetId, allocId, (a) => ({ ...a, execs: a.execs.filter((e) => e.id !== execId) }))
  },

  /** 공사 등록·수정(첨부는 그대로) */
  saveConstruction(c: Omit<Construction, 'files'>) {
    const s = getState()
    const exists = s.constructions.some((x) => x.id === c.id)
    setState({
      ...s,
      constructions: exists
        ? s.constructions.map((x) => (x.id === c.id ? { ...x, ...c } : x))
        : [...s.constructions, { ...c, files: [] }],
    })
  },

  deleteConstruction(id: string) {
    const s = getState()
    setState({ ...s, constructions: s.constructions.filter((c) => c.id !== id) })
  },

  /** 준공 처리 — 준공일·시설별 시공 사업량·실제 공사비 */
  completeConstruction(id: string, completedOn: string, facilities: ConstructionFacility[]) {
    updateConstruction(id, (c) => ({ ...c, completedOn, facilities, status: 'DONE' }))
  },

  addConstructionFiles(id: string, files: ConstructionFile[]) {
    updateConstruction(id, (c) => ({ ...c, files: [...c.files, ...files] }))
  },

  removeConstructionFile(id: string, fileId: string) {
    updateConstruction(id, (c) => ({ ...c, files: c.files.filter((f) => f.id !== fileId) }))
  },
}
