import { USAGE_DATA_AS_WMS_LAYER_ID } from '../river/usageDataAs/usageDataAsLayerId'
import {
  getAllUseFeeWmsLayerIds,
  getUseFeeWmsLayerId,
} from './useFeeLayerId'
import { getForeignUseFeeWmsLayerIds } from '@/lib/useFeeBinding'

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void

type FeeLayerOpts = {
  serEng?: string | null
  system?: string | null
}

/** 울진 하천점용 본표 */
export const USE_FEE_ULJIN_OCCUPATION_WMS_LAYER_ID = USAGE_DATA_AS_WMS_LAYER_ID
/** 공통 하천·도로·국공유지 점용 본표 */
export const USE_FEE_WATER_OCCUPATION_WMS_LAYER_ID = 'water_occupationledger'
export const USE_FEE_ROAD_OCCUPATION_WMS_LAYER_ID = 'road_occupationledger'
export const USE_FEE_PUBLIC_OCCUPATION_WMS_LAYER_ID = 'public_occupationledger'

export type UseFeeOccupationLedgerTarget = {
  layerId: string
  label: string
}

function normalizeSystemKey(system?: string | null): string {
  return String(system ?? '').trim().toLowerCase()
}

function feeLayerOpts(
  systemOrOpts?: string | null | FeeLayerOpts,
  maybeSystem?: string | null
): FeeLayerOpts {
  if (systemOrOpts != null && typeof systemOrOpts === 'object') return systemOrOpts
  return { system: (systemOrOpts as string | null | undefined) ?? maybeSystem }
}

/**
 * 점사용료 상단 점용 레이어 버튼 — 시스템별 라벨·레이어.
 * 울진도 라벨은 «하천점용»(레이어만 usage_data_as).
 */
export function getUseFeeOccupationLedgerTarget(opts: {
  system?: string | null
  serEng?: string | null
  isUljinRiver?: boolean
}): UseFeeOccupationLedgerTarget {
  const sys = normalizeSystemKey(
    opts.system ??
      (String(opts.serEng ?? '').includes('road')
        ? 'road'
        : String(opts.serEng ?? '').includes('public')
          ? 'build'
          : 'river')
  )
  if (sys === 'road') {
    return { layerId: USE_FEE_ROAD_OCCUPATION_WMS_LAYER_ID, label: '도로점용' }
  }
  if (sys === 'build') {
    return { layerId: USE_FEE_PUBLIC_OCCUPATION_WMS_LAYER_ID, label: '국공유지점용' }
  }
  return {
    layerId: opts.isUljinRiver
      ? USE_FEE_ULJIN_OCCUPATION_WMS_LAYER_ID
      : USE_FEE_WATER_OCCUPATION_WMS_LAYER_ID,
    label: '하천점용',
  }
}

export function toggleUseFeeWmsLayer(
  setVisibleLayerNames?: SetVisible | null,
  systemOrOpts?: string | null | FeeLayerOpts
): void {
  if (!setVisibleLayerNames) return
  const lid = getUseFeeWmsLayerId(feeLayerOpts(systemOrOpts)).toLowerCase()
  setVisibleLayerNames((prev) => {
    const next = new Set(prev)
    if (next.has(lid)) next.delete(lid)
    else next.add(lid)
    return next
  })
}

/** 점사용료 패널 오픈 시 — 본표 WMS 켜기 */
export function ensureUseFeeWmsLayer(
  setVisibleLayerNames?: SetVisible | null,
  systemOrOpts?: string | null | FeeLayerOpts
): void {
  if (!setVisibleLayerNames) return
  const lid = getUseFeeWmsLayerId(feeLayerOpts(systemOrOpts)).toLowerCase()
  setVisibleLayerNames((prev) => {
    if (prev.has(lid)) return prev
    const next = new Set(prev)
    next.add(lid)
    return next
  })
}

export function isUseFeeWmsVisible(
  visibleLayerNames?: Set<string> | null,
  systemOrOpts?: string | null | FeeLayerOpts
): boolean {
  if (!visibleLayerNames) return false
  return visibleLayerNames.has(getUseFeeWmsLayerId(feeLayerOpts(systemOrOpts)).toLowerCase())
}

/** 점사용료 WMS 전부 끄기 (패널 종료·점용 패널과 교차 정리) */
export function clearUseFeeWmsLayer(setVisibleLayerNames?: SetVisible | null): void {
  if (!setVisibleLayerNames) return
  const ids = getAllUseFeeWmsLayerIds().map((id) => id.toLowerCase())
  setVisibleLayerNames((prev) => {
    let changed = false
    const next = new Set(prev)
    for (const lid of ids) {
      if (next.delete(lid)) changed = true
    }
    return changed ? next : prev
  })
}

/** 시스템 전환 시 — 다른 시스템 점사용료 WMS만 끄기 */
export function clearForeignUseFeeWmsLayers(
  setVisibleLayerNames?: SetVisible | null,
  system?: string | null
): void {
  if (!setVisibleLayerNames) return
  const ids = getForeignUseFeeWmsLayerIds(system).map((id) => id.toLowerCase())
  if (ids.length === 0) return
  setVisibleLayerNames((prev) => {
    let changed = false
    const next = new Set(prev)
    for (const lid of ids) {
      if (next.delete(lid)) changed = true
    }
    return changed ? next : prev
  })
}

export function toggleUseFeeOccupationLedgerWmsLayer(
  setVisibleLayerNames: SetVisible | null | undefined,
  target: UseFeeOccupationLedgerTarget
): void {
  if (!setVisibleLayerNames) return
  const lid = target.layerId.toLowerCase()
  setVisibleLayerNames((prev) => {
    const next = new Set(prev)
    if (next.has(lid)) next.delete(lid)
    else next.add(lid)
    return next
  })
}

export function isUseFeeOccupationLedgerWmsVisible(
  visibleLayerNames: Set<string> | null | undefined,
  target: UseFeeOccupationLedgerTarget
): boolean {
  if (!visibleLayerNames) return false
  return visibleLayerNames.has(target.layerId.toLowerCase())
}

/** 점사용료 패널 종료 시 — 목록에서 켤 수 있는 점용대장 본표만 끄기 */
export function clearUseFeeOccupationLedgerWmsLayers(
  setVisibleLayerNames?: SetVisible | null
): void {
  if (!setVisibleLayerNames) return
  const ids = [
    USE_FEE_ULJIN_OCCUPATION_WMS_LAYER_ID,
    USE_FEE_WATER_OCCUPATION_WMS_LAYER_ID,
    USE_FEE_ROAD_OCCUPATION_WMS_LAYER_ID,
    USE_FEE_PUBLIC_OCCUPATION_WMS_LAYER_ID,
  ].map((id) => id.toLowerCase())
  setVisibleLayerNames((prev) => {
    let changed = false
    const next = new Set(prev)
    for (const lid of ids) {
      if (next.delete(lid)) changed = true
    }
    return changed ? next : prev
  })
}
