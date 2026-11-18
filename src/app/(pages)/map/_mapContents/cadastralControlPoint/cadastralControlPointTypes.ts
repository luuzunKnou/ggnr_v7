import { transform } from 'ol/proj'
import {
  getCadastralControlPointType,
  type CadastralControlPointType,
} from './cadastralControlPointConfig'

export type CadastralControlPoint = {
  id: string
  pointNo: string
  name: string
  type: CadastralControlPointType
  typeLabel: string
  kindRaw: string
  emd: string
  address: string
  landLoc: string
  placeNote: string
  x: number
  y: number
  crsSrc: string
  marker: string
  grade: string
  route: string
  doho: string
  crossK: string
  install: string
  installedAt: string
  survey: string
  surveyedAt: string
  geom5181: [number, number] | null
  coord3857: [number, number] | null
}

export function formatCoord(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function toMapCoord3857(geom5181: [number, number]): [number, number] {
  const [x, y] = transform(geom5181, 'EPSG:5181', 'EPSG:3857')
  return [x, y]
}

export function mapApiItem(row: {
  id?: string
  pointNo?: string
  name?: string
  kind?: string
  kindCode?: CadastralControlPointType
  landLoc?: string
  emd?: string
  address?: string
  x?: number
  y?: number
  crsSrc?: string
  marker?: string
  grade?: string
  route?: string
  doho?: string
  crossK?: string
  install?: string
  installedAt?: string
  survey?: string
  surveyedAt?: string
  geom5181?: [number, number] | null
}): CadastralControlPoint | null {
  const id = String(row.id ?? '').trim()
  if (!id) return null
  const gx = Number(row.geom5181?.[0])
  const gy = Number(row.geom5181?.[1])
  const hasGeom = Number.isFinite(gx) && Number.isFinite(gy)
  const geom5181: [number, number] | null = hasGeom ? [gx, gy] : null
  const type = (row.kindCode ?? 'traverse') as CadastralControlPointType
  const address = String(row.address ?? '').trim()
  const name = String(row.name ?? '').trim()
  const landLoc = String(row.landLoc ?? '').trim()
  return {
    id,
    pointNo: String(row.pointNo ?? id).trim() || id,
    name,
    type,
    typeLabel: getCadastralControlPointType(type).label,
    kindRaw: String(row.kind ?? '').trim(),
    emd: String(row.emd ?? '').trim(),
    address,
    landLoc,
    placeNote: address || name || landLoc,
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    crsSrc: String(row.crsSrc ?? '').trim(),
    marker: String(row.marker ?? '').trim(),
    grade: String(row.grade ?? '').trim(),
    route: String(row.route ?? '').trim(),
    doho: String(row.doho ?? '').trim(),
    crossK: String(row.crossK ?? '').trim(),
    install: String(row.install ?? '').trim(),
    installedAt: String(row.installedAt ?? '').trim(),
    survey: String(row.survey ?? '').trim(),
    surveyedAt: String(row.surveyedAt ?? '').trim(),
    geom5181,
    coord3857: geom5181 ? toMapCoord3857(geom5181) : null,
  }
}
