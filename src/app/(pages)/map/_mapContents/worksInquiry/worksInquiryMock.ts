/** 토목공사·지역개발공사 조회용 예시 자료 (실데이터 연동 전) */

import type { WorksInquirySerEng, WorksInquiryStatusCode } from './worksInquiryBinding'

export type WorksInquiryRow = {
  id: string
  serEng: WorksInquirySerEng
  name: string
  location: string
  startDate: string
  endDate: string
  status: WorksInquiryStatusCode
  statusLabel: string
  permitNo?: string
  applicant?: string
  workType?: string
  budget?: string
  contractor?: string
  supervisor?: string
  year?: string
  remark?: string
}

function row(partial: WorksInquiryRow): WorksInquiryRow {
  return partial
}

const ROWS: WorksInquiryRow[] = [
  row({
    id: 'cpi-1',
    serEng: 'civilPermitInquiry',
    name: '군도 12호선 확포장 시행허가',
    location: '영양읍 서부리 일원',
    startDate: '2025-03-12',
    endDate: '2027-03-11',
    status: 'inProgress',
    statusLabel: '진행',
    permitNo: '2025-허가-014',
    applicant: '영양군 건설안전과',
    workType: '도로공사',
    remark: '군도 선형 개량 및 확포장',
  }),
  row({
    id: 'cpi-2',
    serEng: 'civilPermitInquiry',
    name: '입암천 소하천 정비 시행허가',
    location: '입암면 산해리',
    startDate: '2024-06-01',
    endDate: '2026-05-31',
    status: 'inProgress',
    statusLabel: '진행',
    permitNo: '2024-허가-032',
    applicant: '영양군 건설안전과',
    workType: '하천공사',
    remark: '호안 및 하상 정비',
  }),
  row({
    id: 'cpi-3',
    serEng: 'civilPermitInquiry',
    name: '일월면 농지전용 허가',
    location: '일월면 용화리 245',
    startDate: '2023-04-18',
    endDate: '2025-04-17',
    status: 'expired',
    statusLabel: '만료',
    permitNo: '2023-허가-008',
    applicant: '영양군 농업정책과',
    workType: '농지전용',
    remark: '용수로 부지로 전용',
  }),
  row({
    id: 'cpi-4',
    serEng: 'civilPermitInquiry',
    name: '수비면 산지전용 허가',
    location: '수비면 신원리 산 12',
    startDate: '2022-09-01',
    endDate: '2024-08-31',
    status: 'done',
    statusLabel: '완료',
    permitNo: '2022-허가-021',
    applicant: '영양군 산림과',
    workType: '산지전용',
    remark: '임도 개설 완료',
  }),

  row({
    id: 'cch-1',
    serEng: 'civilConstructionHistory',
    name: '군도 12호선 확포장공사',
    location: '영양읍 서부리 ~ 현리',
    startDate: '2025-04-01',
    endDate: '2026-11-30',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '2,450,000,000원',
    contractor: '경북건설(주)',
    supervisor: '김토목',
    year: '2025',
    remark: '연장 1.8km 확포장',
  }),
  row({
    id: 'cch-2',
    serEng: 'civilConstructionHistory',
    name: '입암천 소하천 정비공사',
    location: '입암면 산해리',
    startDate: '2024-07-15',
    endDate: '2025-12-20',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '980,000,000원',
    contractor: '동해토건',
    supervisor: '박하천',
    year: '2024',
    remark: '호안블록 및 교량 접속부',
  }),
  row({
    id: 'cch-3',
    serEng: 'civilConstructionHistory',
    name: '청기면 배수로 설치공사',
    location: '청기면 상청리',
    startDate: '2023-03-10',
    endDate: '2023-11-28',
    status: 'done',
    statusLabel: '준공',
    budget: '420,000,000원',
    contractor: '영양종합건설',
    supervisor: '이준공',
    year: '2023',
    remark: 'L형 측구 1.2km',
  }),
  row({
    id: 'cch-4',
    serEng: 'civilConstructionHistory',
    name: '석보면 마을안길 포장공사',
    location: '석보면 원리',
    startDate: '2026-03-01',
    endDate: '2026-10-31',
    status: 'planned',
    statusLabel: '계획',
    budget: '310,000,000원',
    contractor: '미정',
    supervisor: '최계획',
    year: '2026',
    remark: '설계 중',
  }),

  row({
    id: 'rsw-1',
    serEng: 'rdcSmallWater',
    name: '수비면 관정 개발사업',
    location: '수비면 신원리',
    startDate: '2025-02-10',
    endDate: '2025-09-30',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '185,000,000원',
    contractor: '한수개발',
    supervisor: '정용수',
    year: '2025',
    remark: '농업용 관정 2공',
  }),
  row({
    id: 'rsw-2',
    serEng: 'rdcSmallWater',
    name: '석보면 급수시설 정비',
    location: '석보면 원리',
    startDate: '2024-04-01',
    endDate: '2024-11-15',
    status: 'done',
    statusLabel: '준공',
    budget: '96,000,000원',
    contractor: '영양설비',
    supervisor: '한급수',
    year: '2024',
    remark: '송수관 교체',
  }),
  row({
    id: 'rsw-3',
    serEng: 'rdcSmallWater',
    name: '일월면 소규모 용수원 개발',
    location: '일월면 용화리',
    startDate: '2026-04-01',
    endDate: '2026-10-31',
    status: 'planned',
    statusLabel: '계획',
    budget: '210,000,000원',
    contractor: '미정',
    supervisor: '오설계',
    year: '2026',
    remark: '용수원 조사 완료',
  }),

  row({
    id: 'rdw-1',
    serEng: 'rdcDroughtWater',
    name: '청기면 한발대비 관정 개설',
    location: '청기면 상청리',
    startDate: '2025-01-20',
    endDate: '2025-06-30',
    status: 'done',
    statusLabel: '준공',
    budget: '142,000,000원',
    contractor: '한수개발',
    supervisor: '강한발',
    year: '2025',
    remark: '가뭄 대비 비상 용수',
  }),
  row({
    id: 'rdw-2',
    serEng: 'rdcDroughtWater',
    name: '입암면 한해 대비 용수로',
    location: '입암면 산해리',
    startDate: '2025-09-01',
    endDate: '2026-04-30',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '268,000,000원',
    contractor: '동해토건',
    supervisor: '윤용수',
    year: '2025',
    remark: '비상 급수 연계',
  }),
  row({
    id: 'rdw-3',
    serEng: 'rdcDroughtWater',
    name: '영양읍 한발대비 저수조',
    location: '영양읍 현리',
    startDate: '2026-02-01',
    endDate: '2026-08-31',
    status: 'planned',
    statusLabel: '계획',
    budget: '175,000,000원',
    contractor: '미정',
    supervisor: '서대비',
    year: '2026',
    remark: '기존 관정 연계',
  }),

  row({
    id: 'rir-1',
    serEng: 'rdcIrrigationRepair',
    name: '일월면 용수로 긴급보수',
    location: '일월면 용화리',
    startDate: '2026-03-05',
    endDate: '2026-05-20',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '78,000,000원',
    contractor: '영양종합건설',
    supervisor: '배수리',
    year: '2026',
    remark: '동절기 파손 구간',
  }),
  row({
    id: 'rir-2',
    serEng: 'rdcIrrigationRepair',
    name: '수비면 보 긴급보수',
    location: '수비면 신원리',
    startDate: '2025-07-01',
    endDate: '2025-08-31',
    status: 'done',
    statusLabel: '준공',
    budget: '54,000,000원',
    contractor: '동해토건',
    supervisor: '문시설',
    year: '2025',
    remark: '호우 피해 복구',
  }),
  row({
    id: 'rir-3',
    serEng: 'rdcIrrigationRepair',
    name: '석보면 취입보 보수',
    location: '석보면 원리',
    startDate: '2024-05-10',
    endDate: '2024-07-15',
    status: 'done',
    statusLabel: '준공',
    budget: '63,000,000원',
    contractor: '경북건설(주)',
    supervisor: '장보수',
    year: '2024',
    remark: '콘크리트 박리 보수',
  }),

  row({
    id: 'rai-1',
    serEng: 'rdcAgriInfra',
    name: '청기면 경지정리 기반정비',
    location: '청기면 상청리',
    startDate: '2024-03-01',
    endDate: '2025-11-30',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '1,120,000,000원',
    contractor: '농기개발',
    supervisor: '채농업',
    year: '2024',
    remark: '용·배수로 및 농로',
  }),
  row({
    id: 'rai-2',
    serEng: 'rdcAgriInfra',
    name: '입암면 용수로 정비',
    location: '입암면 산해리',
    startDate: '2023-04-15',
    endDate: '2023-12-20',
    status: 'done',
    statusLabel: '준공',
    budget: '640,000,000원',
    contractor: '영양종합건설',
    supervisor: '노기반',
    year: '2023',
    remark: '콘크리트 용수로 2.1km',
  }),
  row({
    id: 'rai-3',
    serEng: 'rdcAgriInfra',
    name: '일월면 농로 포장',
    location: '일월면 용화리',
    startDate: '2026-03-15',
    endDate: '2026-10-31',
    status: 'planned',
    statusLabel: '계획',
    budget: '390,000,000원',
    contractor: '미정',
    supervisor: '표설계',
    year: '2026',
    remark: '폭 4m 농로',
  }),

  row({
    id: 'rrw-1',
    serEng: 'rdcResidentWish',
    name: '영양읍 마을안길 정비',
    location: '영양읍 서부리',
    startDate: '2025-05-01',
    endDate: '2025-10-31',
    status: 'done',
    statusLabel: '준공',
    budget: '85,000,000원',
    contractor: '영양종합건설',
    supervisor: '주민원',
    year: '2025',
    remark: '주민 건의 1순위',
  }),
  row({
    id: 'rrw-2',
    serEng: 'rdcResidentWish',
    name: '수비면 배수로 설치',
    location: '수비면 신원리',
    startDate: '2026-04-01',
    endDate: '2026-08-31',
    status: 'planned',
    statusLabel: '계획',
    budget: '72,000,000원',
    contractor: '미정',
    supervisor: '권숙원',
    year: '2026',
    remark: '침수 민원 구간',
  }),
  row({
    id: 'rrw-3',
    serEng: 'rdcResidentWish',
    name: '석보면 소교량 보수',
    location: '석보면 원리',
    startDate: '2025-08-01',
    endDate: '2026-03-31',
    status: 'inProgress',
    statusLabel: '공사중',
    budget: '118,000,000원',
    contractor: '동해토건',
    supervisor: '심교량',
    year: '2025',
    remark: '노후 소교량 1개소',
  }),
]

export function getWorksInquiryRows(serEng: WorksInquirySerEng): WorksInquiryRow[] {
  return ROWS.filter((r) => r.serEng === serEng)
}

export function getWorksInquiryRowById(
  serEng: WorksInquirySerEng,
  id: string
): WorksInquiryRow | null {
  return ROWS.find((r) => r.serEng === serEng && r.id === id) ?? null
}

export function searchWorksInquiryRows(
  serEng: WorksInquirySerEng,
  keyword: string
): WorksInquiryRow[] {
  const q = keyword.trim().toLowerCase()
  const rows = getWorksInquiryRows(serEng)
  if (!q) return rows
  return rows.filter((r) => {
    const hay = [
      r.name,
      r.location,
      r.statusLabel,
      r.permitNo,
      r.applicant,
      r.workType,
      r.contractor,
      r.supervisor,
      r.year,
      r.remark,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
