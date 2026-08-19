/** 레이어 추가속성 jsonb 컬럼 — 기본 상세 속성에서 숨기고 Extra 화면에서만 사용 */

export const LAYER_EXTRA_FIELD_NAME = 'extra';

export function isLayerExtraFieldName(name: string | null | undefined): boolean {
  return String(name ?? '').trim().toLowerCase() === LAYER_EXTRA_FIELD_NAME;
}

/** 항목 설정 보기 분류 체크 해제 */
export function layerExtraDefineViewOff(): Record<string, boolean> {
  return {
    define_field_show_search: false,
    define_field_show_search_detail: false,
    define_field_show_title: false,
    define_field_show_list: false,
    define_field_show_detail_list: false,
    define_field_show_detail: false,
  };
}

export function buildLayerExtraDefineField(idx: number): Record<string, unknown> {
  return {
    define_field_name: LAYER_EXTRA_FIELD_NAME,
    define_field_kor_name: '추가속성',
    define_field_type: 'TEXT',
    define_field_idx: idx,
    define_field_is_required: false,
    define_field_read_only: false,
    define_field_is_key: false,
    define_field_max_length: '',
    define_field_sort_idx: '',
    define_field_sort_type: '',
    define_field_sel_list: '',
    define_field_sel_table: '',
    define_field_sel_query: '',
    define_field_sel_url: '',
    define_field_sel_key_field: '',
    define_field_sel_label_field: '',
    define_field_default_value: '',
    ...layerExtraDefineViewOff(),
  };
}
