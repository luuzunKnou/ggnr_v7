import type { Dispatch, SetStateAction } from 'react'
import type { CadastralControlPointType } from './cadastralControlPointConfig'
import { CADASTRAL_CONTROL_POINT_WMS_LAYER_ID } from './cadastralControlPointLayerId'

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void
type SetCqlByLayer = Dispatch<SetStateAction<Record<string, string> | null>>

const KIND_BY_TYPE: Record<CadastralControlPointType, string> = {
  triangulation: '삼각점',
  triangulationAux: '삼각보조점',
  traverse: '도근점',
}

export function ensureCadastralControlPointWms(setVisibleLayerNames?: SetVisible | null): void {
  if (!setVisibleLayerNames) return
  const lid = CADASTRAL_CONTROL_POINT_WMS_LAYER_ID.toLowerCase()
  setVisibleLayerNames((prev) => {
    if (prev.has(lid)) return prev
    const next = new Set(prev)
    next.add(lid)
    return next
  })
}

export function clearCadastralControlPointWms(setVisibleLayerNames?: SetVisible | null): void {
  if (!setVisibleLayerNames) return
  const lid = CADASTRAL_CONTROL_POINT_WMS_LAYER_ID.toLowerCase()
  setVisibleLayerNames((prev) => {
    if (!prev.has(lid)) return prev
    const next = new Set(prev)
    next.delete(lid)
    return next
  })
}

export function syncCadastralControlPointKindCql(
  setServiceWmsCqlByLayer: SetCqlByLayer | null | undefined,
  typeFilter: CadastralControlPointType | ''
): void {
  if (!setServiceWmsCqlByLayer) return
  const lid = CADASTRAL_CONTROL_POINT_WMS_LAYER_ID.toLowerCase()
  if (!typeFilter) {
    setServiceWmsCqlByLayer((prev) => {
      if (!prev || !(lid in prev)) return prev
      const next = { ...prev }
      delete next[lid]
      return Object.keys(next).length ? next : null
    })
    return
  }
  const kind = KIND_BY_TYPE[typeFilter]
  const cql = `kind='${kind.replace(/'/g, "''")}'`
  setServiceWmsCqlByLayer((prev) => {
    const next = { ...(prev ?? {}) }
    if (next[lid] === cql) return prev
    next[lid] = cql
    return next
  })
}

export function clearCadastralControlPointKindCql(
  setServiceWmsCqlByLayer: SetCqlByLayer | null | undefined
): void {
  syncCadastralControlPointKindCql(setServiceWmsCqlByLayer, '')
}
