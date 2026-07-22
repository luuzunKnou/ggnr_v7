export type SelectedLayer = {
  rowKey: string
  schema: string
  tableName: string
  korName: string
}

export type LayerManagerRow = {
  rowKey: string
  define_table_schema: string
  define_table_source: string
  define_table_group: string
  define_table_name: string
  define_table_kor_name: string
  define_table_idx: string
  define_table_shp_type: string
  define_table_read_share: string
  define_table_write_share: string
}

/** 레이어 관리 › 레이어 설정 탭에 기존 매니저를 임베드할 때 사용 */
export type LayerDefineEmbedProps = {
  embedded?: boolean
  fixedTableKey?: string | null
  fixedSchema?: string | null
  /** true면 키(define_field_is_key) 컬럼만 편집 가능하고 나머지는 읽기전용으로 표시 */
  keyFieldOnly?: boolean
}
