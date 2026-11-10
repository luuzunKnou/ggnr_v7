/** 소규모 공공시설 — 조회용 예시 자료 (실데이터 연동 전) */

export type SmallPublicFacPayment = {
  seq: number
  kind: string
  date: string
  amount: number
  remark: string
}

export type SmallPublicFacDesignChange = {
  round: string
  date: string
  delta: number
  changedAmount: number
  reason: string
}

export type SmallPublicFacJoint = {
  seq: number
  company: string
  representative: string
  ratio: string
  shareType: string
  amount: number
  remark: string
}

export type SmallPublicFacSubcontract = {
  seq: number
  industry: string
  company: string
  representative: string
  date: string
  amount: number
  rate: string
}

export type SmallPublicFacContractInfo = {
  type: string
  plannedAmount: number | null
  firstContractAmount: number | null
  bidRate: string
  contractAmount: number
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

export type SmallPublicFacRow = {
  id: string
  office: string
  contractName: string
  contractAmount: number
  contractDate: string
  companyName: string
  contract: SmallPublicFacContractInfo
  payments: SmallPublicFacPayment[]
  paymentTotal: number
  balance: number
  designChanges: SmallPublicFacDesignChange[]
  jointContracts: SmallPublicFacJoint[]
  subcontracts: SmallPublicFacSubcontract[]
}

function listRow(params: {
  id: string
  contractName: string
  contractAmount: number
  contractDate: string
  companyName: string
}): SmallPublicFacRow {
  return {
    id: params.id,
    office: '본청',
    contractName: params.contractName,
    contractAmount: params.contractAmount,
    contractDate: params.contractDate,
    companyName: params.companyName,
    contract: {
      type: '공사',
      plannedAmount: null,
      firstContractAmount: null,
      bidRate: '',
      contractAmount: params.contractAmount,
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
    paymentTotal: params.contractAmount,
    balance: 0,
    designChanges: [],
    jointContracts: [],
    subcontracts: [],
  }
}

const ROWS: SmallPublicFacRow[] = [
  {
    id: 'spf-jungsam',
    office: '본청',
    contractName: '중삼의 소교량 재가설공사',
    contractAmount: 337_007_120,
    contractDate: '2020-03-31',
    companyName: '(주)대명토건',
    contract: {
      type: '공사',
      plannedAmount: 398_023_500,
      firstContractAmount: 345_277_350,
      bidRate: '86.74700%',
      contractAmount: 337_007_120,
      contractDate: '2020-03-31',
      startDate: '2020-03-31',
      competition: '제한경쟁',
      endDate: '2020-12-18',
      contractor: '(주)대명토건',
      representative: '이재훈',
      contractorAddress: '경상북도 경주시 안강읍 비화동길 29',
      reason: '',
      summary: '중삼의 소교량 재가설공사',
      contractOffice: '본청',
      contractDept: '재무과',
      superviseDept: '',
      supervisor: '',
    },
    payments: [
      { seq: 1, kind: '선금', date: '2020-05-08', amount: 118_600_000, remark: '' },
      { seq: 2, kind: '부분금', date: '2020-06-17', amount: 7_315_000, remark: '' },
      { seq: 3, kind: '부분금', date: '2020-07-13', amount: 19_745_000, remark: '' },
      { seq: 4, kind: '부분금', date: '2020-08-12', amount: 22_605_000, remark: '' },
      { seq: 5, kind: '부분금', date: '2020-09-11', amount: 4_620_000, remark: '' },
      { seq: 6, kind: '부분금', date: '2020-10-14', amount: 13_145_000, remark: '' },
      { seq: 7, kind: '부분금', date: '2020-11-18', amount: 6_160_000, remark: '' },
      { seq: 8, kind: '부분금', date: '2020-12-18', amount: 20_130_000, remark: '' },
      { seq: 9, kind: '부분금', date: '2020-12-29', amount: 124_687_120, remark: '' },
    ],
    paymentTotal: 337_007_120,
    balance: 0,
    designChanges: [
      {
        round: '1차',
        date: '2020-12-14',
        delta: 14_122_650,
        changedAmount: 359_400_000,
        reason: '현장여건을 반영한 설계 변경',
      },
      {
        round: '2차',
        date: '2020-12-24',
        delta: -22_392_880,
        changedAmount: 337_007_120,
        reason: '보험료등 정산',
      },
    ],
    jointContracts: [],
    subcontracts: [],
  },
  listRow({
    id: 'spf-togu',
    contractName: '청기면 토구리 소교량설치공사',
    contractAmount: 31_444_380,
    contractDate: '2020-03-20',
    companyName: '대영건설주식회사',
  }),
  listRow({
    id: 'spf-gagok-slope',
    contractName: '가곡리 소교량 및 사면정비공사',
    contractAmount: 22_897_950,
    contractDate: '2020-04-09',
    companyName: '(주)경북건설',
  }),
  listRow({
    id: 'spf-gagok',
    contractName: '가곡리 소교량 설치공사',
    contractAmount: 19_957_610,
    contractDate: '2020-03-30',
    companyName: '공덕건설(주)',
  }),
  listRow({
    id: 'spf-gumae',
    contractName: '구매2리 간이소교량 설치공사',
    contractAmount: 18_990_080,
    contractDate: '2020-07-21',
    companyName: '태경건설 주식회사',
  }),
  listRow({
    id: 'spf-jeo',
    contractName: '저리(본마을) 소교량 설치공사',
    contractAmount: 15_658_030,
    contractDate: '2020-06-04',
    companyName: '주식회사 대림',
  }),
  listRow({
    id: 'spf-daecheon',
    contractName: '대천리(샘실) 마을안길정비사업',
    contractAmount: 171_942_580,
    contractDate: '2020-11-10',
    companyName: '한반도건설 주식회사',
  }),
  listRow({
    id: 'spf-byeongok-pave',
    contractName: '병옥리 마을안길 포장 덧씌우기공사',
    contractAmount: 50_543_300,
    contractDate: '2020-04-20',
    companyName: '(주)대지원',
  }),
  listRow({
    id: 'spf-sangcheong',
    contractName: '상청2리 마을안길 정비공사',
    contractAmount: 44_824_410,
    contractDate: '2020-10-26',
    companyName: '주식회사 천지원',
  }),
  listRow({
    id: 'spf-hanok',
    contractName: '한옥집단마을 마을안길 정비사업',
    contractAmount: 28_958_300,
    contractDate: '2020-04-20',
    companyName: '(주)대지원',
  }),
  listRow({
    id: 'spf-gokgang',
    contractName: '곡강리 마을안길 아스콘포장공사',
    contractAmount: 28_910_520,
    contractDate: '2020-11-02',
    companyName: '(주)거성건설',
  }),
  listRow({
    id: 'spf-daecheon2',
    contractName: '영양읍 대천2리 마을안길 포장공사',
    contractAmount: 26_627_460,
    contractDate: '2020-11-02',
    companyName: '주식회사 천지원',
  }),
  listRow({
    id: 'spf-mujin',
    contractName: '무진리(망두들) 마을안길 정비공사',
    contractAmount: 25_706_610,
    contractDate: '2020-04-20',
    companyName: '정임건설 주식회사',
  }),
  listRow({
    id: 'spf-byeongok',
    contractName: '병옥리 마을안길 정비공사',
    contractAmount: 17_669_090,
    contractDate: '2020-07-29',
    companyName: '주식회사 천지원',
  }),
  listRow({
    id: 'spf-hanok-light',
    contractName: '한옥집단마을 마을안길 가로등 정비공사',
    contractAmount: 14_520_000,
    contractDate: '2020-10-26',
    companyName: '영양조명전기',
  }),
]

export function formatWon(amount: number | null | undefined): string {
  if (amount == null) return ''
  return `${amount.toLocaleString('ko-KR')}원`
}

export function formatWonList(amount: number): string {
  return amount.toLocaleString('ko-KR')
}

export function formatSignedWon(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('ko-KR')
  if (amount < 0) return `-${abs}원`
  return `${abs}원`
}

export function getSmallPublicFacRows(): SmallPublicFacRow[] {
  return ROWS
}

export function getSmallPublicFacRowById(id: string): SmallPublicFacRow | null {
  return ROWS.find((r) => r.id === id) ?? null
}

export function searchSmallPublicFacRows(keyword: string): SmallPublicFacRow[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return ROWS
  return ROWS.filter((r) => {
    const hay = [r.office, r.contractName, r.companyName, r.contractDate, formatWonList(r.contractAmount)]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
