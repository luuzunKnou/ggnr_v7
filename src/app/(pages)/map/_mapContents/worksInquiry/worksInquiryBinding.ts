/** 토목공사·지역개발공사 조회 메뉴 — ser_eng 목록·제목·조회 유형 */

export const WORKS_INQUIRY_SER_ENGS = [
  'civilPermitInquiry',
  'civilConstructionHistory',
  'rdcSmallWater',
  'rdcDroughtWater',
  'rdcIrrigationRepair',
  'rdcAgriInfra',
  'rdcResidentWish',
] as const

export type WorksInquirySerEng = (typeof WORKS_INQUIRY_SER_ENGS)[number]

export type WorksInquiryKind = 'permit' | 'works'

export type WorksInquiryBinding = {
  serEng: WorksInquirySerEng
  title: string
  detailTitle: string
  kind: WorksInquiryKind
}

const BINDINGS: Record<WorksInquirySerEng, WorksInquiryBinding> = {
  civilPermitInquiry: {
    serEng: 'civilPermitInquiry',
    title: '인허가 조회',
    detailTitle: '인허가 상세',
    kind: 'permit',
  },
  civilConstructionHistory: {
    serEng: 'civilConstructionHistory',
    title: '공사이력',
    detailTitle: '공사이력 상세',
    kind: 'works',
  },
  rdcSmallWater: {
    serEng: 'rdcSmallWater',
    title: '소규모 용수',
    detailTitle: '소규모 용수 상세',
    kind: 'works',
  },
  rdcDroughtWater: {
    serEng: 'rdcDroughtWater',
    title: '한발대비 용수개설',
    detailTitle: '한발대비 용수개설 상세',
    kind: 'works',
  },
  rdcIrrigationRepair: {
    serEng: 'rdcIrrigationRepair',
    title: '수리시설 긴급보수',
    detailTitle: '수리시설 긴급보수 상세',
    kind: 'works',
  },
  rdcAgriInfra: {
    serEng: 'rdcAgriInfra',
    title: '농업기반정비',
    detailTitle: '농업기반정비 상세',
    kind: 'works',
  },
  rdcResidentWish: {
    serEng: 'rdcResidentWish',
    title: '소규모 주민숙원',
    detailTitle: '소규모 주민숙원 상세',
    kind: 'works',
  },
}

export function isWorksInquirySerEng(serEng: string): serEng is WorksInquirySerEng {
  return (WORKS_INQUIRY_SER_ENGS as readonly string[]).includes(serEng)
}

export function isWorksInquiryOpenedToken(token: string): boolean {
  return isWorksInquirySerEng(String(token ?? '').trim())
}

export function findOpenedWorksInquirySerEng(openedTokens: string[]): WorksInquirySerEng | null {
  for (const t of openedTokens) {
    const s = String(t ?? '').trim()
    if (isWorksInquirySerEng(s)) return s
  }
  return null
}

export function getWorksInquiryBinding(serEng: string | null | undefined): WorksInquiryBinding | null {
  const eng = String(serEng ?? '').trim()
  if (!isWorksInquirySerEng(eng)) return null
  return BINDINGS[eng]
}

export type WorksInquiryStatusCode = 'planned' | 'inProgress' | 'done' | 'expired'

export function worksInquiryStatusClass(code: WorksInquiryStatusCode): string {
  switch (code) {
    case 'inProgress':
      return 'bg-sky-50 text-sky-700 ring-sky-200'
    case 'done':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    case 'expired':
      return 'bg-amber-50 text-amber-800 ring-amber-200'
    case 'planned':
    default:
      return 'bg-slate-50 text-slate-600 ring-slate-200'
  }
}
