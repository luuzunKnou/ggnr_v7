/** 발주관리 — 목록·등록 폼용 예시/프론트 상태 자료 */

export const WORKS_REGISTER_NEW_ID = 'wr-new'

export type WorksRegisterPayment = {
  seq: number
  kind: string
  date: string
  amount: string
  remark: string
}

export type WorksRegisterDesignChange = {
  round: string
  date: string
  delta: string
  changedAmount: string
  reason: string
}

export type WorksRegisterJoint = {
  seq: number
  company: string
  representative: string
  ratio: string
  shareType: string
  amount: string
  remark: string
}

export type WorksRegisterSubcontract = {
  seq: number
  industry: string
  company: string
  representative: string
  date: string
  amount: string
  rate: string
}

export type WorksRegisterContractInfo = {
  type: string
  plannedAmount: string
  firstContractAmount: string
  bidRate: string
  contractAmount: string
  contractDate: string
  startDate: string
  competition: string
  endDate: string
  contractor: string
  representative: string
  contractorAddress: string
  reason: string
  summary: string
  contractOffice: string
  contractDept: string
  superviseDept: string
  supervisor: string
}

export type WorksRegisterProjectDesign = {
  projectName: string
  designNo: string
  designAmount: string
  startDate: string
  endDate: string
  designer: string
  representative: string
  summary: string
  remark: string
}

/** 상세설계 도서(도면·내역 등) 한 행 */
export type WorksRegisterDesignDocument = {
  seq: number
  /** 도서구분: 위치도·평면도·내역서 등 */
  kind: string
  title: string
  drawNo: string
  date: string
  fileName: string
  remark: string
}

/** 상세설계(실시설계) */
export type WorksRegisterDetailDesign = {
  /** 기본설계 / 실시설계 등 */
  designType: string
  designNo: string
  designAmount: string
  startDate: string
  endDate: string
  designer: string
  representative: string
  approver: string
  approveDate: string
  summary: string
  remark: string
  documents: WorksRegisterDesignDocument[]
}

/** 사업구역 (그리기·입지분석) */
export type WorksRegisterScopeOwnerPriceStat = {
  label: string
  areaSqm: number
  amountWon: number
}

export type WorksRegisterScopeOwnershipStat = {
  label: string
  parcelCount: number
  areaSqm: number
}

export type WorksRegisterScopeZoneStat = {
  label: string
  areaSqm: number
  parcelCount?: number
}

export type WorksRegisterScope = {
  method: 'draw' | 'location'
  wkt: string
  summaryLabel: string
  areaSqm: number
  parcelCount?: number
  /** 공시지가 — 소유자 종류별 면적·금액 */
  landPriceByOwner?: WorksRegisterScopeOwnerPriceStat[]
  /** 소유구분 — 소유구분별 필지수·면적 */
  ownershipStats?: WorksRegisterScopeOwnershipStat[]
  /** 용도지역 — 해당 종류·면적 */
  zoneStats?: WorksRegisterScopeZoneStat[]
  /** 위치 — «최대면적 필지주소 외 N필지» */
  locationLabel?: string
  recommendName?: string
}

export type WorksRegisterWarranty = {
  period: string
  startDate: string
  endDate: string
  content: string
  remark: string
}

export type WorksRegisterRecord = {
  id: string
  office: string
  contractName: string
  contractAmount: number
  contractDate: string
  companyName: string
  projectDesign: WorksRegisterProjectDesign
  detailDesign: WorksRegisterDetailDesign
  scope: WorksRegisterScope | null
  contract: WorksRegisterContractInfo
  payments: WorksRegisterPayment[]
  paymentTotal: string
  balance: string
  designChanges: WorksRegisterDesignChange[]
  jointContracts: WorksRegisterJoint[]
  subcontracts: WorksRegisterSubcontract[]
  warranty: WorksRegisterWarranty
}

export type WorksRegisterListRow = {
  id: string
  office: string
  contractName: string
  contractAmount: number
  contractDate: string
  companyName: string
}

function parseAmount(raw: string): number {
  const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function emptyProjectDesign(projectName = ''): WorksRegisterProjectDesign {
  return {
    projectName,
    designNo: '',
    designAmount: '',
    startDate: '',
    endDate: '',
    designer: '',
    representative: '',
    summary: '',
    remark: '',
  }
}

function emptyDetailDesign(): WorksRegisterDetailDesign {
  return {
    designType: '실시설계',
    designNo: '',
    designAmount: '',
    startDate: '',
    endDate: '',
    designer: '',
    representative: '',
    approver: '',
    approveDate: '',
    summary: '',
    remark: '',
    documents: [],
  }
}

function emptyWarranty(): WorksRegisterWarranty {
  return {
    period: '',
    startDate: '',
    endDate: '',
    content: '',
    remark: '',
  }
}

function listOnly(params: {
  id: string
  contractName: string
  contractAmount: number
  contractDate: string
  companyName: string
}): WorksRegisterRecord {
  const amount = formatAmountComma(String(params.contractAmount))
  return {
    id: params.id,
    office: '본청',
    contractName: params.contractName,
    contractAmount: params.contractAmount,
    contractDate: params.contractDate,
    companyName: params.companyName,
    projectDesign: emptyProjectDesign(params.contractName),
    detailDesign: emptyDetailDesign(),
    scope: null,
    contract: {
      type: '공사',
      plannedAmount: '',
      firstContractAmount: '',
      bidRate: '',
      contractAmount: amount,
      contractDate: params.contractDate,
      startDate: '',
      competition: '',
      endDate: '',
      contractor: params.companyName,
      representative: '',
      contractorAddress: '',
      reason: '',
      summary: params.contractName,
      contractOffice: '본청',
      contractDept: '',
      superviseDept: '',
      supervisor: '',
    },
    payments: [],
    paymentTotal: amount,
    balance: '0',
    designChanges: [],
    jointContracts: [],
    subcontracts: [],
    warranty: emptyWarranty(),
  }
}

const INITIAL_ROWS: WorksRegisterRecord[] = [
  listOnly({
    id: 'wr-jungsam',
    contractName: '중삼의 소교량 재가설공사',
    contractAmount: 337_007_120,
    contractDate: '2020-03-31',
    companyName: '(주)대명토건',
  }),
  listOnly({
    id: 'wr-togu',
    contractName: '청기면 토구리 소교량설치공사',
    contractAmount: 31_444_380,
    contractDate: '2020-03-20',
    companyName: '대영건설주식회사',
  }),
  listOnly({
    id: 'wr-gagok-slope',
    contractName: '가곡리 소교량 및 사면정비공사',
    contractAmount: 22_897_950,
    contractDate: '2020-04-09',
    companyName: '(주)경북건설',
  }),
  listOnly({
    id: 'wr-gagok',
    contractName: '가곡리 소교량 설치공사',
    contractAmount: 19_957_610,
    contractDate: '2020-03-30',
    companyName: '공덕건설(주)',
  }),
  listOnly({
    id: 'wr-gumae',
    contractName: '구매2리 간이소교량 설치공사',
    contractAmount: 18_990_080,
    contractDate: '2020-07-21',
    companyName: '태경건설 주식회사',
  }),
  listOnly({
    id: 'wr-jeo',
    contractName: '저리(본마을) 소교량 설치공사',
    contractAmount: 15_658_030,
    contractDate: '2020-06-04',
    companyName: '주식회사 대림',
  }),
  listOnly({
    id: 'wr-daecheon',
    contractName: '대천리(샘실) 마을안길정비사업',
    contractAmount: 171_942_580,
    contractDate: '2020-11-10',
    companyName: '한반도건설 주식회사',
  }),
  listOnly({
    id: 'wr-byeongok-pave',
    contractName: '병옥리 마을안길 포장 덧씌우기공사',
    contractAmount: 50_543_300,
    contractDate: '2020-04-20',
    companyName: '(주)대지원',
  }),
  listOnly({
    id: 'wr-sangcheong',
    contractName: '상청2리 마을안길 정비공사',
    contractAmount: 44_824_410,
    contractDate: '2020-10-26',
    companyName: '주식회사 천지원',
  }),
  listOnly({
    id: 'wr-hanok',
    contractName: '한옥집단마을 마을안길 정비사업',
    contractAmount: 28_958_300,
    contractDate: '2020-04-20',
    companyName: '(주)대지원',
  }),
  listOnly({
    id: 'wr-gokgang',
    contractName: '곡강리 마을안길 아스콘포장공사',
    contractAmount: 28_910_520,
    contractDate: '2020-11-02',
    companyName: '(주)거성건설',
  }),
  listOnly({
    id: 'wr-daecheon2',
    contractName: '영양읍 대천2리 마을안길 포장공사',
    contractAmount: 26_627_460,
    contractDate: '2020-11-02',
    companyName: '주식회사 천지원',
  }),
  listOnly({
    id: 'wr-mujin',
    contractName: '무진리(망두들) 마을안길 정비공사',
    contractAmount: 25_706_610,
    contractDate: '2020-04-20',
    companyName: '정임건설 주식회사',
  }),
  listOnly({
    id: 'wr-byeongok',
    contractName: '병옥리 마을안길 정비공사',
    contractAmount: 17_669_090,
    contractDate: '2020-07-29',
    companyName: '주식회사 천지원',
  }),
  listOnly({
    id: 'wr-hanok-light',
    contractName: '한옥집단마을 마을안길 가로등 정비공사',
    contractAmount: 14_520_000,
    contractDate: '2020-10-26',
    companyName: '영양조명전기',
  }),
]

/** 목록 배지 다양화용 — 일부 행에 단계 진행 예시 */
function withDemoStageProgress(rows: WorksRegisterRecord[]): WorksRegisterRecord[] {
  return rows.map((r, i) => {
    const designDone = {
      ...r.projectDesign,
      designNo: `D-2020-${String(i + 1).padStart(2, '0')}`,
      designAmount: formatAmountComma(String(Math.round(r.contractAmount * 1.05))),
      designer: '설계사무소',
      endDate: '2020-02-28',
    }
    const detailDone: WorksRegisterDetailDesign = {
      ...emptyDetailDesign(),
      designType: '실시설계',
      designNo: `SD-2020-${String(i + 1).padStart(2, '0')}`,
      designAmount: formatAmountComma(String(Math.round(r.contractAmount * 0.08))),
      startDate: '2020-01-05',
      endDate: '2020-02-28',
      designer: '설계사무소',
      representative: '홍길동',
      approver: '건설과장',
      approveDate: '2020-03-05',
      summary: `${r.contractName} 실시설계`,
      documents: [
        {
          seq: 1,
          kind: '위치도',
          title: '사업위치도',
          drawNo: 'DW-01',
          date: '2020-02-20',
          fileName: '',
          remark: '',
        },
        {
          seq: 2,
          kind: '평면도',
          title: '계획평면도',
          drawNo: 'DW-02',
          date: '2020-02-20',
          fileName: '',
          remark: '',
        },
        {
          seq: 3,
          kind: '내역서',
          title: '공사비내역서',
          drawNo: 'BOQ-01',
          date: '2020-02-25',
          fileName: '',
          remark: '',
        },
      ],
    }

    if (i === 0) {
      return {
        ...r,
        projectDesign: designDone,
        detailDesign: detailDone,
        contract: { ...r.contract, startDate: '2020-04-10', endDate: '2020-11-30' },
        payments: [
          { seq: 1, kind: '기성', date: '2020-08-01', amount: formatAmountComma('100000000'), remark: '' },
        ],
        warranty: {
          period: '2년',
          startDate: '2020-12-01',
          endDate: '2022-11-30',
          content: '',
          remark: '',
        },
      }
    }
    if (i === 1) {
      return {
        ...r,
        projectDesign: designDone,
        detailDesign: detailDone,
        contract: { ...r.contract, startDate: '2020-04-01', endDate: '2020-09-30' },
        payments: [
          { seq: 1, kind: '선금', date: '2020-04-15', amount: formatAmountComma('5000000'), remark: '' },
        ],
      }
    }
    if (i === 2 || i === 3) {
      return {
        ...r,
        projectDesign: designDone,
        detailDesign: detailDone,
        contract: { ...r.contract, startDate: '2020-05-01' },
        payments: [
          { seq: 1, kind: '선금', date: '2020-05-10', amount: formatAmountComma('3000000'), remark: '' },
        ],
      }
    }
    if (i === 4) {
      return {
        ...r,
        projectDesign: {
          ...r.projectDesign,
          designNo: '',
          designAmount: '',
          designer: '',
          endDate: '',
          startDate: '2020-06-01',
        },
        detailDesign: emptyDetailDesign(),
        contract: {
          ...r.contract,
          contractDate: '',
          contractAmount: '',
          contractor: '',
        },
        contractAmount: 0,
        contractDate: '',
        companyName: '',
      }
    }
    return { ...r, projectDesign: designDone, detailDesign: detailDone }
  })
}

export function getInitialWorksRegisterRows(): WorksRegisterRecord[] {
  return withDemoStageProgress(INITIAL_ROWS).map((r) => ({
    ...r,
    projectDesign: { ...r.projectDesign },
    detailDesign: {
      ...(r.detailDesign ?? emptyDetailDesign()),
      documents: (r.detailDesign?.documents ?? []).map((d) => ({ ...d })),
    },
    scope: r.scope ? { ...r.scope } : null,
    contract: { ...r.contract },
    payments: r.payments.map((p) => ({ ...p })),
    designChanges: r.designChanges.map((c) => ({ ...c })),
    jointContracts: r.jointContracts.map((j) => ({ ...j })),
    subcontracts: r.subcontracts.map((s) => ({ ...s })),
    warranty: { ...(r.warranty ?? emptyWarranty()) },
  }))
}

export function createEmptyWorksRegisterRecord(): WorksRegisterRecord {
  return {
    id: WORKS_REGISTER_NEW_ID,
    office: '본청',
    contractName: '',
    contractAmount: 0,
    contractDate: '',
    companyName: '',
    projectDesign: emptyProjectDesign(),
    detailDesign: emptyDetailDesign(),
    scope: null,
    contract: {
      type: '공사',
      plannedAmount: '',
      firstContractAmount: '',
      bidRate: '',
      contractAmount: '',
      contractDate: '',
      startDate: '',
      competition: '',
      endDate: '',
      contractor: '',
      representative: '',
      contractorAddress: '',
      reason: '',
      summary: '',
      contractOffice: '본청',
      contractDept: '',
      superviseDept: '',
      supervisor: '',
    },
    payments: [],
    paymentTotal: '',
    balance: '',
    designChanges: [],
    jointContracts: [],
    subcontracts: [],
    warranty: emptyWarranty(),
  }
}

export function recordToListRow(record: WorksRegisterRecord): WorksRegisterListRow {
  return {
    id: record.id,
    office: record.office || record.contract.contractOffice || '본청',
    contractName: record.contractName || record.contract.summary || '(제목 없음)',
    contractAmount: record.contractAmount || parseAmount(record.contract.contractAmount),
    contractDate: record.contractDate || record.contract.contractDate,
    companyName: record.companyName || record.contract.contractor,
  }
}

export function syncRecordListFields(record: WorksRegisterRecord): WorksRegisterRecord {
  const amount = parseAmount(record.contract.contractAmount)
  const name = record.contract.summary.trim() || record.contractName.trim() || '(제목 없음)'
  const company = record.contract.contractor.trim() || record.companyName
  const date = record.contract.contractDate.trim() || record.contractDate
  const office = record.contract.contractOffice.trim() || record.office || '본청'
  return {
    ...record,
    office,
    contractName: name,
    contractAmount: amount,
    contractDate: date,
    companyName: company,
  }
}

export function formatWonList(amount: number): string {
  return amount.toLocaleString('ko-KR')
}

/** 금액 문자열 → 콤마 표시 (마이너스 허용) */
export function formatAmountComma(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const negative = s.startsWith('-')
  const digits = s.replace(/[^\d]/g, '')
  if (!digits) return negative ? '-' : ''
  const withComma = Number(digits).toLocaleString('ko-KR')
  return negative ? `-${withComma}` : withComma
}

/** 입력값에서 숫자만 남겨 콤마 포맷으로 반환 */
export function normalizeAmountInput(raw: string): string {
  return formatAmountComma(raw)
}

export function searchWorksRegisterRows(
  rows: WorksRegisterRecord[],
  keyword: string
): WorksRegisterListRow[] {
  const list = rows.map(recordToListRow)
  const q = keyword.trim().toLowerCase()
  if (!q) return list
  return list.filter((r) => {
    const hay = [r.office, r.contractName, r.companyName, r.contractDate, formatWonList(r.contractAmount)]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

export function nextWorksRegisterId(): string {
  return `wr-${Date.now()}`
}

export type WorksRegisterStageId =
  | 'projectDesign'
  | 'detailDesign'
  | 'contract'
  | 'construction'
  | 'completion'
  | 'warranty'

export type WorksRegisterStageStatus = 'done' | 'active' | 'pending'

export const WORKS_REGISTER_STAGE_ORDER: WorksRegisterStageId[] = [
  'projectDesign',
  'detailDesign',
  'contract',
  'construction',
  'completion',
  'warranty',
]

export const WORKS_REGISTER_STAGE_LABEL: Record<WorksRegisterStageId, string> = {
  projectDesign: '사업설계',
  detailDesign: '상세설계',
  contract: '발주·계약',
  construction: '착공·시공',
  completion: '준공',
  warranty: '하자보수',
}

export const WORKS_REGISTER_STATUS_LABEL: Record<WorksRegisterStageStatus, string> = {
  done: '진행완료',
  active: '진행중',
  pending: '대기중',
}

function hasText(...values: Array<string | undefined | null>): boolean {
  return values.some((v) => String(v ?? '').trim() !== '')
}

export function resolveWorksRegisterStageStatus(
  record: WorksRegisterRecord,
  stage: WorksRegisterStageId
): WorksRegisterStageStatus {
  const pd = record.projectDesign
  const dd = record.detailDesign ?? emptyDetailDesign()
  const c = record.contract
  const w = record.warranty

  switch (stage) {
    case 'projectDesign': {
      if (hasText(pd.designNo, pd.designAmount, pd.endDate, pd.designer) || record.scope) return 'done'
      if (hasText(pd.projectName, pd.startDate, pd.summary, pd.remark, pd.representative)) return 'active'
      return 'pending'
    }
    case 'detailDesign': {
      if (
        (hasText(dd.designNo, dd.designAmount, dd.endDate, dd.approveDate) &&
          hasText(dd.designer)) ||
        dd.documents.length > 0
      ) {
        return 'done'
      }
      if (
        hasText(
          dd.designType,
          dd.designNo,
          dd.designAmount,
          dd.startDate,
          dd.designer,
          dd.summary,
          dd.approver
        )
      ) {
        return 'active'
      }
      return 'pending'
    }
    case 'contract': {
      if (hasText(c.contractDate) && hasText(c.contractAmount, c.contractor)) return 'done'
      if (
        hasText(
          c.type,
          c.plannedAmount,
          c.firstContractAmount,
          c.bidRate,
          c.competition,
          c.summary,
          c.contractor
        ) ||
        record.jointContracts.length > 0 ||
        record.subcontracts.length > 0
      ) {
        return 'active'
      }
      return 'pending'
    }
    case 'construction': {
      if (hasText(c.startDate) && (record.payments.length > 0 || record.designChanges.length > 0)) {
        return 'done'
      }
      if (hasText(c.startDate) || record.payments.length > 0 || record.designChanges.length > 0) {
        return 'active'
      }
      return 'pending'
    }
    case 'completion': {
      if (hasText(c.endDate)) return 'done'
      if (hasText(record.paymentTotal, record.balance) && hasText(c.contractAmount)) return 'active'
      return 'pending'
    }
    case 'warranty': {
      if (hasText(w.endDate) || (hasText(w.period) && hasText(w.startDate))) return 'done'
      if (hasText(w.period, w.startDate, w.content, w.remark)) return 'active'
      return 'pending'
    }
  }
}

export type WorksRegisterListStatus = {
  stage: WorksRegisterStageId | null
  status: WorksRegisterStageStatus
  /** 목록 배지 문구 */
  label: string
}

/** 가장 앞선 단계 기준으로 목록용 상태 배지 */
export function resolveWorksRegisterListStatus(record: WorksRegisterRecord): WorksRegisterListStatus {
  const statuses = WORKS_REGISTER_STAGE_ORDER.map((s) => resolveWorksRegisterStageStatus(record, s))
  if (statuses.every((s) => s === 'done')) {
    return { stage: 'warranty', status: 'done', label: '진행완료' }
  }
  let furthest = -1
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i] !== 'pending') furthest = i
  }
  if (furthest < 0) {
    return { stage: null, status: 'pending', label: '대기중' }
  }
  const stage = WORKS_REGISTER_STAGE_ORDER[furthest]
  const status = statuses[furthest]
  return {
    stage,
    status,
    label: WORKS_REGISTER_STAGE_LABEL[stage],
  }
}
