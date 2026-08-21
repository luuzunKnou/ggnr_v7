import { FMS_FACILITY_COLUMNS, FMS_INSPECTION_COLUMNS } from '@/lib/fmsLinkage/parseDelimited';

/** BASTB_MASTER 기본 한글명 — fms_identifier_header 보정·상세 UI fallback */
export const FMS_FACILITY_HEADER_LABELS: Record<string, string> = {
  facil_no: '시설물번호',
  facil_nm: '시설물명',
  mng_no: '관리번호',
  mng_main_cd: '관리주체코드',
  permit_org_cd: '인허가기관코드',
  facil_owner: '소유자명',
  route_class: '노선구분코드',
  route_detail: '노선세부코드',
  facil_class: '시설물종별',
  facil_gbn: '시설물구분',
  facil_kind: '시설물종류',
  facil_desc_cd: '시설물상세종류코드',
  addr_sido: '주소_시도',
  addr_gugun: '주소_구군',
  addr_dong: '주소_동',
  addr_detail: '주소_기타',
  cpl_ymd: '준공일자',
  temp_ymd: '임시사용승인일',
  rsp_to_ymd: '하자담보책임만료일자',
  design_ymd_from: '설계기간부터',
  design_ymd_to: '설계기간까지',
  designer_nm: '설계자명',
  const_ymd_from: '공사기간부터',
  const_ymd_to: '공사기간까지',
  constractor_cd: '시공자코드',
  constractor_nm: '시공자명',
  const_amt: '총공사비',
  spv_ymd_from: '감리기간부터',
  spv_ymd_to: '감리기간까지',
  supervisor_nm: '감리자명',
  const_order_cd: '공사발주자코드',
  const_order_nm: '공사발주자명',
  const_nm: '공사명',
  const_spvsr_nm: '공사감독자명',
  dsn_book_st_yn: '설계도서보관여부',
  eq_dsn_app_yn: '내진설계적용여부',
  gam_reason_cd: '감리비대상사유코드',
  whl_pht_file_ct: '전경사진파일명',
  etc_pht_file_ct: '정측면기타사진파일명',
  upper_no: '상위시설물번호',
  lnk_facil_no: '연계기관 시설물번호',
  etc_remark: '비고',
  addr_full: '주소',
};

/** MANTB_DIGN_RESULT 기본 한글명 */
export const FMS_INSPECTION_HEADER_LABELS: Record<string, string> = {
  facil_no: '시설물번호',
  dign_seq: '점검진단순번',
  start_ymd: '시작일자',
  end_ymd: '종료일자',
  dign_gbn: '점검진단구분',
  regular_gbn: '정기점검구분',
  rep_engineer_nm: '책임기술자명',
  dign_amt: '점검진단금액',
  state_grade: '상태평가등급',
  dign_content: '주요점검진단결과',
  amend_content: '주요보수보강안',
  wrt_ymd: '작성일자',
  wrt_person_nm: '작성자명',
};

export function facilityHeaderColumnOrder(): readonly string[] {
  return FMS_FACILITY_COLUMNS;
}

export function inspectionHeaderColumnOrder(): readonly string[] {
  return FMS_INSPECTION_COLUMNS;
}

export function defaultHeaderLabels(
  identifier: 'BASTB_MASTER' | 'MANTB_DIGN_RESULT'
): Record<string, string> {
  return identifier === 'BASTB_MASTER'
    ? FMS_FACILITY_HEADER_LABELS
    : FMS_INSPECTION_HEADER_LABELS;
}

export function defaultHeaderColumnOrder(
  identifier: 'BASTB_MASTER' | 'MANTB_DIGN_RESULT'
): readonly string[] {
  return identifier === 'BASTB_MASTER'
    ? facilityHeaderColumnOrder()
    : inspectionHeaderColumnOrder();
}

/** fms_code 한글화 대상 (ref_name / code_dept). 신규 DB 시드용 */
export const FMS_HEADER_CODE_FIELDS: Record<string, { refName: string; codeDept: string }> = {
  mng_main_cd: { refName: 'org_code', codeDept: 'code1' },
  permit_org_cd: { refName: 'permit_org_cd', codeDept: 'code1' },
  route_class: { refName: 'route_cd', codeDept: 'code1' },
  route_detail: { refName: 'route_cd', codeDept: 'code2' },
  facil_gbn: { refName: 'facil_gbn', codeDept: 'code1' },
  facil_kind: { refName: 'facil_kind', codeDept: 'code2' },
  facil_desc_cd: { refName: 'facil_law_cd', codeDept: 'code3' },
  addr_sido: { refName: 'addr_sido', codeDept: 'code1' },
  constractor_cd: { refName: 'constractor_cd', codeDept: 'code1' },
  const_order_cd: { refName: 'const_order_cd', codeDept: 'code1' },
  gam_reason_cd: { refName: 'gam_reason_cd', codeDept: 'code1' },
  dign_gbn: { refName: 'dign_gbn', codeDept: 'code1' },
  regular_gbn: { refName: 'regular_gbn', codeDept: 'code1' },
  state_grade: { refName: 'state_grade', codeDept: 'code1' },
};
