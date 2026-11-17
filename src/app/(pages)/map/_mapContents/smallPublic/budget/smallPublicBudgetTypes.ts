import type { SmallPublicFile } from '../smallPublicMock'

/** 재원 — 정비사업 재원 구분은 담당 부서 확인 전이라 기본 4가지 */
export type FundSource = 'NATIONAL' | 'PROVINCIAL' | 'COUNTY' | 'OTHER'

export const FUND_SOURCES: FundSource[] = ['NATIONAL', 'PROVINCIAL', 'COUNTY', 'OTHER']

export const FUND_SOURCE_LABEL: Record<FundSource, string> = {
  NATIONAL: '국비',
  PROVINCIAL: '도비',
  COUNTY: '군비',
  OTHER: '기타',
}

/** 집행 — 배정 1건에 여러 번 */
export type BudgetExec = {
  id: string
  execDate: string
  amountWon: number
  memo: string
}

/** 배정 — 예산을 정비계획 시설·연차에 연결 */
export type BudgetAlloc = {
  id: string
  planUnitId: string
  /** 정비계획 연차(1~5), null = 5개년 이후·미배분 */
  yearNo: number | null
  amountWon: number
  execs: BudgetExec[]
}

export type BudgetItem = {
  id: string
  fiscalYear: number
  fundSource: FundSource
  title: string
  amountWon: number
  /** 발주·예산 근거(발주계획 화면과 같은 기본정보) */
  orderOrg: string
  orderPeriod: string
  budgetCode: string
  deptName: string
  manager: string
  phone: string
  /** 예산 규모 — 도급·관급·기타(합계는 amountWon) */
  supplyWon: number
  materialWon: number
  otherWon: number
  allocs: BudgetAlloc[]
}

export type ConstructionStatus = 'PLANNED' | 'ONGOING' | 'DONE' | 'CANCELED'

export const CONSTRUCTION_STATUSES: ConstructionStatus[] = ['PLANNED', 'ONGOING', 'DONE', 'CANCELED']

export const CONSTRUCTION_STATUS_LABEL: Record<ConstructionStatus, string> = {
  PLANNED: '계획',
  ONGOING: '진행',
  DONE: '준공',
  CANCELED: '취소',
}

/** 공사 대상 시설 — 시공 사업량·실제 공사비는 준공 때 넣는다 */
export type ConstructionFacility = {
  planUnitId: string
  doneQty: number | null
  actualCostWon: number | null
}

export type ConstructionFileKind = 'DESIGN' | 'CONTRACT' | 'COMPLETION' | 'PHOTO' | 'OTHER'

export const CONSTRUCTION_FILE_KINDS: ConstructionFileKind[] = ['DESIGN', 'CONTRACT', 'COMPLETION', 'PHOTO', 'OTHER']

export const CONSTRUCTION_FILE_LABEL: Record<ConstructionFileKind, string> = {
  DESIGN: '설계서',
  CONTRACT: '계약서',
  COMPLETION: '준공서류',
  PHOTO: '사진',
  OTHER: '기타',
}

export type ConstructionFile = Omit<SmallPublicFile, 'kind'> & { kind: ConstructionFileKind; uploadedAt: string }

export type Construction = {
  id: string
  name: string
  budgetId: string | null
  contractor: string
  contractWon: number | null
  designWon: number | null
  startDate: string
  endDate: string
  completedOn: string
  status: ConstructionStatus
  /** 계약 기본정보(공사대장·근거자료) */
  office: string
  orderDept: string
  estimatedWon: number | null
  initialContractWon: number | null
  bidRate: number | null
  totalContractWon: number | null
  contractDate: string
  contractMethod: string
  contractorRep: string
  location: string
  contractReason: string
  superviseDept: string
  supervisor: string
  facilities: ConstructionFacility[]
  files: ConstructionFile[]
}
