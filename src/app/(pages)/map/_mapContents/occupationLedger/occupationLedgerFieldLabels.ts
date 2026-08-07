/**
 * 공통 점용대장(water|road|public_occupationledger) 상세·편집용 한글 필드명.
 * defineLayer 한글명과 분리 — 여기 값을 바꾸지 않으면 화면 라벨이 바뀌지 않는다.
 */
export const OCCUPATION_LEDGER_FIELD_LABELS: Record<string, string> = {
  id: '키',
  work_name: '공사명',
  occup_place: '점용장소',
  occup_purpose: '점용목적',
  perm_start_date: '점용 시작일',
  perm_end_date: '점용 종료일',
  perm_area: '점용면적',
  permit_no: '허가번호',
  permit_date: '허가일자',
  occup_name: '신청자명',
  occup_phone: '신청자 전화번호',
  applicant_addr: '신청자 주소',
  manage_name: '담당자명',
  state: '상태',
  remark: '비고',
};

export function labelForOccupationLedgerField(field: string, fallback?: string): string {
  const key = String(field ?? '')
    .trim()
    .toLowerCase();
  if (!key) return fallback ?? '';
  return OCCUPATION_LEDGER_FIELD_LABELS[key] ?? fallback ?? field;
}
