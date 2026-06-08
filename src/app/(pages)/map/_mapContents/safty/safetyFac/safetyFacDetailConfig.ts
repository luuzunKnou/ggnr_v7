/** 재난대응시설 상세 패널: 테이블별 표시 순서·한글 라벨 (DB 컬럼명 대소문자 무시 매칭) */

export type SafetyFacDetailField = { field: string; labelKo: string };

export const SAFETY_FAC_TABLE_DETAIL_FIELDS: Record<string, SafetyFacDetailField[]> = {
  sd_cold_wave_shelter: [
    { field: 'reare_fclt_no', labelKo: '쉼터시설번호' },
    { field: 'fclt_type', labelKo: '시설유형 중분류' },
    { field: 'reare_nm', labelKo: '쉼터명칭' },
    { field: 'daddr', labelKo: '상세주소' },
    { field: 'utztn_psblty_tnop', labelKo: '이용가능인원' },
    { field: 'mdfcn_hr', labelKo: '수정시간' },
    { field: 'rmrk', labelKo: '비고' },
    { field: 'rona_daddr', labelKo: '도로명상세주소' },
    { field: 'wkdy_oper_bgng_hr', labelKo: '평일운영시작시간' },
    { field: 'wkdy_oper_end_hr', labelKo: '평일운영종료시간' },
    { field: 'lot', labelKo: '경도' },
    { field: 'lat', labelKo: '위도' },
    { field: 'sndy_oper_bgng_hr', labelKo: '일요일운영시작시간' },
    { field: 'sndy_oper_end_hr', labelKo: '일요일운영종료시간' },
    { field: 'stdy_oper_bgng_hr', labelKo: '토요일운영시작시간' },
    { field: 'stdy_oper_end_hr', labelKo: '토요일운영종료시간' },
    { field: 'lhldy_oper_bgng_hr', labelKo: '공휴일운영시작시간' },
    { field: 'lhldy_oper_end_hr', labelKo: '공휴일운영종료시간' },
    { field: 'fclty_sclas', labelKo: '시설유형 소분류' },
    { field: 'yr', labelKo: '연도' },
    { field: 'inpt_hr', labelKo: '입력시간' },
  ],
  sd_heat_wave_shelter: [
    { field: 'rstr_fclty_no', labelKo: '쉼터시설번호' },
    { field: 'year', labelKo: '년도' },
    { field: 'arcd', labelKo: '지역코드' },
    { field: 'fclty_ty', labelKo: '시설유형 중분류' },
    { field: 'rstr_nm', labelKo: '쉼터명칭' },
    { field: 'dtl_adres', labelKo: '상세주소' },
    { field: 'ar', labelKo: '면적' },
    { field: 'use_psbl_nmpr', labelKo: '이용가능인원' },
    { field: 'colr_hold_elefn', labelKo: '냉방기보유선풍기' },
    { field: 'colr_hold_arcndtn', labelKo: '냉방기보유에어컨' },
    { field: 'chck_matter_night_opn_at', labelKo: '점검사항야간개방여부' },
    { field: 'inpt_time', labelKo: '입력시간' },
    { field: 'modf_time', labelKo: '수정시간' },
    { field: 'rm', labelKo: '비고' },
    { field: 'rn_dtl_adres', labelKo: '도로명상세주소' },
    { field: 'chck_matter_wkend_hday_opn_at', labelKo: '점검사항주말휴일개방여부' },
    { field: 'mngdpt_cd', labelKo: '관리부서코드' },
    { field: 'chck_matter_stayng_psbl_at', labelKo: '점검사항숙박가능여부' },
    { field: 'xcord', labelKo: 'X좌표' },
    { field: 'ycord', labelKo: 'Y좌표' },
    { field: 'lo', labelKo: '경도' },
    { field: 'la', labelKo: '위도' },
    { field: 'dtl_position', labelKo: '위치상세' },
    { field: 'wkday_oper_begin_time', labelKo: '평일운영시작시간' },
    { field: 'wkday_oper_end_time', labelKo: '평일운영종료시간' },
    { field: 'wkend_hday_oper_begin_time', labelKo: '주말휴일운영시작시간' },
    { field: 'wkend_hday_oper_end_time', labelKo: '주말휴일운영종료시간' },
    { field: 'fclty_sclas', labelKo: '시설유형 소분류' },
  ],
  sd_heat_mitigation_facility: [
    { field: 'mng_no', labelKo: '관리번호' },
    { field: 'rgn_cd', labelKo: '지역코드' },
    { field: 'stdg_cd', labelKo: '법정동코드' },
    { field: 'dong_cd', labelKo: '행정동코드' },
    { field: 'instl_dt', labelKo: '설치일시' },
    { field: 'prdct_fbctn_bzenty', labelKo: '제품제작업체' },
    { field: 'instl_bzenty', labelKo: '설치업체' },
    { field: 'whol_hgt', labelKo: '전체높이' },
    { field: 'fbrc_nm', labelKo: '원단명' },
    { field: 'yr', labelKo: '연도' },
    { field: 'lot', labelKo: '경도' },
    { field: 'lat', labelKo: '위도' },
    { field: 'open_dmrs', labelKo: '펼침지름' },
    { field: 'shlt_type_cd', labelKo: '그늘막유형코드' },
    { field: 'use_yn', labelKo: '사용여부' },
    { field: 'fclt_knd_se_cd', labelKo: '시설종류구분코드' },
    { field: 'area', labelKo: '면적' },
    { field: 'len', labelKo: '길이' },
    { field: 'atpsr', labelKo: '분사압' },
    { field: 'injqty', labelKo: '분사량' },
    { field: 'time_jet_hr', labelKo: '1회분사시간' },
    { field: 'addr', labelKo: '주소' },
  ],
};

function pickAttr(attrs: Record<string, unknown>, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(attrs, field)) return attrs[field];
  const lk = field.toLowerCase();
  for (const rk of Object.keys(attrs)) {
    if (rk.toLowerCase() === lk) return attrs[rk];
  }
  return undefined;
}

function formatAttrVal(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** 상세 패널용 행 목록. 정의된 테이블은 지정 순서·라벨만, 그 외는 컬럼명 알파벳 순 */
export function buildSafetyFacDetailRows(
  table: string,
  attrs: Record<string, unknown>
): { label: string; value: string }[] {
  const spec = SAFETY_FAC_TABLE_DETAIL_FIELDS[table];
  if (spec?.length) {
    return spec.map(({ field, labelKo }) => ({
      label: labelKo,
      value: formatAttrVal(pickAttr(attrs, field)),
    }));
  }
  return Object.keys(attrs)
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map((k) => ({ label: k, value: formatAttrVal(attrs[k]) }));
}
