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
}

export type WtlNetworkFilterMeta = {
  yearMin: number
  yearMax: number
  diameterMin: number
  diameterMax: number
  materials: string[]
}
