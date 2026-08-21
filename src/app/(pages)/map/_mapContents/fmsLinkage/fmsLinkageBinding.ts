/** 안전점검 목록 컬럼·상세 식별자 (화면 라벨) */

export const FMS_LIST_TITLE = '안전점검';

export const FMS_LIST_COLUMNS = [
  { key: 'facilNo', label: '시설물번호' },
  { key: 'facilKind', label: '시설물종류' },
  { key: 'facilNm', label: '시설명' },
  { key: 'facilOwner', label: '소유자명' },
] as const;

export const FMS_EMPTY_LIST_MESSAGE = '연계된 시설물이 없습니다.';

export const FMS_INSPECTION_TITLE = '점검진단실적';
export const FMS_EMPTY_INSPECTION_MESSAGE = '점검진단실적이 없습니다.';
