/** 레이어 추가속성 jsonb 컬럼 — 항목 설정에 넣지 않고 Extra 화면에서만 사용 */

export const LAYER_EXTRA_FIELD_NAME = 'extra';

export function isLayerExtraFieldName(name: string | null | undefined): boolean {
  return String(name ?? '').trim().toLowerCase() === LAYER_EXTRA_FIELD_NAME;
}
