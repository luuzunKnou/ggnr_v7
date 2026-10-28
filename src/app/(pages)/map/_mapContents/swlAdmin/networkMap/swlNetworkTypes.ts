import type { SwlNetGeomKind, SwlNetLayerKey } from './swlNetworkLayerCatalog'

export type SwlNetworkRow = {
  id: string
  layerKey: SwlNetLayerKey | string
  geomKind: SwlNetGeomKind
  name: string
  diameter: string
  material: string
  length: string
  year: string
  hjd: string
  attrs: Array<{ label: string; value: string }>
  geom?: GeoJSON.Geometry | null
}

export type SwlNetworkFilterMeta = {
  yearMin: number
  yearMax: number
  diameterMin: number
  diameterMax: number
  materials: string[]
}

export type SwlNetworkStatus = {
  byDiameter: { label: string; meters: number }[]
  byMaterial: { label: string; meters: number }[]
  byYear: { label: string; meters: number }[]
  facilities: { label: string; count: number }[]
}
