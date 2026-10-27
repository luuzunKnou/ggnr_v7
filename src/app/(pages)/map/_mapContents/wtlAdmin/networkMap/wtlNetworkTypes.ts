import type { WtlNetGeomKind, WtlNetLayerKey } from './wtlNetworkLayerCatalog'

export type WtlNetworkRow = {
  id: string
  layerKey: WtlNetLayerKey | string
  geomKind: WtlNetGeomKind
  name: string
  diameter: string
  material: string
  length: string
  year: string
  status: string
  hjd: string
  attrs: Array<{ label: string; value: string }>
  geom?: GeoJSON.Geometry | null
  /** 상세 모달 — DB 행(geom 제외). 필드 설정·코드 한글화용 */
  record?: Record<string, unknown> | null
  /** table_{name}.json 조회 키 (물리 테이블명) */
  fieldsTable?: string | null
  /** 분할 레이어 시 부모 테이블 등 코드 폴백 */
  fieldsTableFallback?: string | null
}

export type WtlNetworkFilterMeta = {
  yearMin: number
  yearMax: number
  diameterMin: number
  diameterMax: number
  materials: string[]
}
