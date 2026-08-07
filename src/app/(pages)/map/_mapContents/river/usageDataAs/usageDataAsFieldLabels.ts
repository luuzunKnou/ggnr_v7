/**
 * 하천점용(usage_data_as) 상세·편집용 한글 필드명.
 * defineLayer 한글명과 분리 — 여기 값을 바꾸지 않으면 화면 라벨이 바뀌지 않는다.
 */
export const USAGE_DATA_AS_FIELD_LABELS: Record<string, string> = {
  gkey_code: '관리코드',
  cons_code: '공사코드',
  river_type: '하천유형',
  river_code: '하천코드',
  river_name: '하천명',
  perm_num: '허가번호',
  usage_pd: '점용기간',
  usage_name: '점용명',
  usage_loc: '점용장소',
  emd_code: '읍면동명',
  perm_area: '점용면적',
  ri_code: '리명',
  ledg_gbn: '구분',
  bobn: '본번',
  bubn: '부번',
  usage_purp: '점용목적',
  temp_area: '일시점용면적',
  descript: '비고',
  mng_cde: '관리코드',
  user_name: 'user_name',
};

export function labelForUsageDataAsField(field: string, fallback?: string): string {
  const key = String(field ?? '')
    .trim()
    .toLowerCase();
  if (!key) return fallback ?? '';
  return USAGE_DATA_AS_FIELD_LABELS[key] ?? fallback ?? field;
}
