/** 엑셀 레이어 시스템 컬럼 — 정합성 키로 사용 불가 (재적재 시 번호·값이 바뀜) */
export const EXCEL_LAYER_SYSTEM_COLS = new Set(['id', 'geom', 'parcel_address']);

/** 복합키 모드 기본 저장 컬럼명 (사용자가 UI에서 변경 가능) */
export const EXCEL_COMPOSITE_KEY_ENG = 'excel_sync_key';
export const EXCEL_COMPOSITE_KEY_KOR = '정합성키';
export const EXCEL_COMPOSITE_KEY_SEP = '|';

export type ExcelWizardKeyMode = 'single' | 'composite' | 'synthetic';

export function safeExcelColumnName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'col';
}

/** id·geom·parcel_address 등 시스템 컬럼은 키 후보에서 제외 */
export function isExcelSystemKeyColumn(headerEng: string): boolean {
  const n = safeExcelColumnName(headerEng).toLowerCase();
  return EXCEL_LAYER_SYSTEM_COLS.has(n);
}

/** 속성 컬럼·INSERT columns에서 제외 (geom은 parcels.geom 경로로만) */
export function isExcelSystemAttrField(headerEng: string, originalHeader?: string): boolean {
  if (isExcelSystemKeyColumn(headerEng)) return true;
  if (originalHeader != null && String(originalHeader).trim() !== '' && isExcelSystemKeyColumn(originalHeader)) {
    return true;
  }
  return false;
}

/** 키 구성 열 값들을 이어 붙여 비교용 키 문자열 생성 */
export function buildExcelCompositeKeyValue(parts: unknown[]): string {
  return parts.map((p) => String(p ?? '').trim()).join(EXCEL_COMPOSITE_KEY_SEP);
}
