import type { WorksRegisterScope } from './worksRegisterMock'
import {
  type AnalyzeExtendedResponse,
} from '../parcelAnalysis/parcelAnalysis.result'
import { executeParcelAnalysisPipeline } from '../parcelAnalysis/parcelAnalysis.run'

export type ScopeOwnerPriceStat = {
  /** 소유자 종류(소유구분) */
  label: string
  areaSqm: number
  /** 면적×공시지가(원) */
  amountWon: number
}

export type ScopeOwnershipStat = {
  label: string
  parcelCount: number
  areaSqm: number
}

export type ScopeZoneStat = {
  label: string
  areaSqm: number
  parcelCount?: number
}

export type WorksRegisterScopeSummaryExtra = {
  areaSqm?: number
  parcelCount?: number
  landPriceByOwner?: ScopeOwnerPriceStat[]
  ownershipStats?: ScopeOwnershipStat[]
  zoneStats?: ScopeZoneStat[]
  /** 예: «영양읍 ○○리 123 외 4필지» */
  locationLabel?: string
}

/** 요약에 필요한 필지분석 항목 — 상세보기와 동일 로딩 경로 */
const SUMMARY_SELECTED_IDS = new Set([
  'parcel:land',
  'parcel:owner',
  'parcel:jimok',
  'parcel:landUse',
])

function toFiniteNumber(v: unknown): number | undefined {
  if (v == null || v === '' || v === '-') return undefined
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function ownerLabel(raw: unknown): string {
  const s = String(raw ?? '').trim()
  return s && s !== '-' ? s : '미상'
}

function formatArea(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}㎡`
}

function formatAmount(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

function parseFormattedAreaSqm(area: string | undefined): number {
  if (!area) return 0
  const n = Number(String(area).replace(/[^\d]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 화면 표시용 한 줄들 */
export function formatLandPriceStatLines(rows: ScopeOwnerPriceStat[] | undefined): string[] {
  if (!rows?.length) return []
  return rows.map(
    (r) => `${r.label} · ${formatArea(r.areaSqm)} · ${formatAmount(r.amountWon)}`
  )
}

export function formatOwnershipStatLines(rows: ScopeOwnershipStat[] | undefined): string[] {
  if (!rows?.length) return []
  return rows.map(
    (r) => `${r.label} · ${r.parcelCount.toLocaleString('ko-KR')}필지 · ${formatArea(r.areaSqm)}`
  )
}

export function formatZoneStatLines(rows: ScopeZoneStat[] | undefined): string[] {
  if (!rows?.length) return []
  return rows.map((r) => `${r.label} · ${formatArea(r.areaSqm)}`)
}

export function formatLocationLabel(mainAddr: string, totalParcels: number): string {
  const addr = mainAddr.trim()
  if (!addr) {
    return totalParcels > 0 ? `${totalParcels.toLocaleString('ko-KR')}필지` : ''
  }
  const others = Math.max(0, totalParcels - 1)
  if (others <= 0) return addr
  return `${addr} 외 ${others.toLocaleString('ko-KR')}필지`
}

/** 입지분석 후보(단일 값) → 요약 집계 형태 */
export function buildScopeSummaryFromLocationCandidate(input: {
  areaSqm: number
  address?: string
  ownership?: string
  zoneLabel?: string
  landPrice?: number
}): WorksRegisterScopeSummaryExtra {
  const areaSqm = Math.max(0, Number(input.areaSqm) || 0)
  const ownership = ownerLabel(input.ownership || '미상')
  const zone = String(input.zoneLabel ?? '').trim()
  const unit = toFiniteNumber(input.landPrice)
  const amountWon = unit != null && areaSqm > 0 ? Math.round(areaSqm * unit) : 0

  return {
    areaSqm: areaSqm || undefined,
    parcelCount: 1,
    landPriceByOwner:
      amountWon > 0 || areaSqm > 0
        ? [{ label: ownership, areaSqm, amountWon }]
        : undefined,
    ownershipStats: [{ label: ownership, parcelCount: 1, areaSqm }],
    zoneStats: zone ? [{ label: zone, areaSqm, parcelCount: 1 }] : undefined,
    locationLabel: formatLocationLabel(String(input.address ?? ''), 1),
  }
}

/**
 * 필지분석 원본 응답 → 사업구역 요약 집계
 * (소유·공시·용도 집계는 필지분석 점진 로딩 결과와 동일 출처)
 */
export function buildScopeSummaryFromAnalyzeData(
  data: AnalyzeExtendedResponse
): WorksRegisterScopeSummaryExtra {
  const out: WorksRegisterScopeSummaryExtra = {}
  const totalParcels = Number(data.parcelCount ?? 0) || 0
  const totalArea = Number(data.totalAreaSqm ?? 0) || 0
  if (totalArea > 0) out.areaSqm = totalArea
  if (totalParcels > 0) out.parcelCount = totalParcels

  if (Array.isArray(data.ownerStats) && data.ownerStats.length) {
    out.ownershipStats = data.ownerStats
      .map((r) => ({
        label: ownerLabel(r.label),
        parcelCount: Math.max(0, Number(r.count) || 0),
        areaSqm: Math.max(0, Number(r.areaSqm) || 0),
      }))
      .sort((a, b) => b.areaSqm - a.areaSqm)
  }

  const landRows = Array.isArray(data.landRows) ? data.landRows : []
  if (landRows.length) {
    const priceMap = new Map<string, { areaSqm: number; amountWon: number }>()
    for (const r of landRows) {
      const area = Math.max(0, Number(r.areaSqm) || 0)
      if (!area) continue
      const label = ownerLabel(r.ownerType)
      const unit = toFiniteNumber(r.publicPrice)
      const cur = priceMap.get(label) ?? { areaSqm: 0, amountWon: 0 }
      cur.areaSqm += area
      if (unit != null) cur.amountWon += Math.round(area * unit)
      priceMap.set(label, cur)
    }
    if (priceMap.size) {
      out.landPriceByOwner = [...priceMap.entries()]
        .map(([label, v]) => ({ label, areaSqm: v.areaSqm, amountWon: v.amountWon }))
        .sort((a, b) => b.amountWon - a.amountWon || b.areaSqm - a.areaSqm)
    }

    if (!out.ownershipStats?.length) {
      const ownMap = new Map<string, { parcelCount: number; areaSqm: number }>()
      for (const r of landRows) {
        const label = ownerLabel(r.ownerType)
        const cur = ownMap.get(label) ?? { parcelCount: 0, areaSqm: 0 }
        cur.parcelCount += 1
        cur.areaSqm += Math.max(0, Number(r.areaSqm) || 0)
        ownMap.set(label, cur)
      }
      out.ownershipStats = [...ownMap.entries()]
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.areaSqm - a.areaSqm)
    }

    let widest = landRows[0]
    let widestArea = -1
    for (const r of landRows) {
      const area = Math.max(0, Number(r.areaSqm) || 0)
      if (area > widestArea) {
        widestArea = area
        widest = r
      }
    }
    const mainAddr = String(widest?.jibun ?? '').trim()
    const location = formatLocationLabel(mainAddr, totalParcels || landRows.length)
    if (location) out.locationLabel = location
  }

  if (Array.isArray(data.landUseStats) && data.landUseStats.length) {
    out.zoneStats = data.landUseStats
      .map((r) => ({
        label: ownerLabel(r.zone),
        areaSqm: parseFormattedAreaSqm(r.area),
        parcelCount: Math.max(0, Number(r.count) || 0),
      }))
      .filter((r) => r.label !== '미상' || r.areaSqm > 0)
      .sort((a, b) => b.areaSqm - a.areaSqm)
  }

  return out
}

/**
 * 확정 WKT 요약 — 필지분석과 동일 파이프라인으로 집계
 */
export async function fetchWorksRegisterScopeSummary(
  wkt5181: string,
  options?: {
    runId?: number
    isCancelled?: () => boolean
    onProgress?: (extra: WorksRegisterScopeSummaryExtra) => void
  }
): Promise<WorksRegisterScopeSummaryExtra> {
  const wkt = String(wkt5181 ?? '').trim()
  if (!wkt) return {}

  const runId = options?.runId ?? 1
  const isCancelled = options?.isCancelled ?? (() => false)
  let latest: WorksRegisterScopeSummaryExtra = {}

  await executeParcelAnalysisPipeline({
    wkt5181: wkt,
    selectedIds: SUMMARY_SELECTED_IDS,
    facilityLayerMap: {},
    runId,
    isCancelled,
    onResult: () => {
      /* 요약은 onAnalyzeData 사용 */
    },
    onError: () => {
      /* 요약 실패 시 빈 값 유지 */
    },
    onEnriching: () => {},
    onAnalyzeData: (data) => {
      if (isCancelled()) return
      latest = buildScopeSummaryFromAnalyzeData(data)
      options?.onProgress?.(latest)
    },
  })

  return latest
}

/** scope에 요약 집계 병합 */
export function mergeScopeSummary(
  scope: WorksRegisterScope,
  extra: WorksRegisterScopeSummaryExtra
): WorksRegisterScope {
  return {
    ...scope,
    areaSqm: extra.areaSqm && extra.areaSqm > 0 ? extra.areaSqm : scope.areaSqm,
    parcelCount: extra.parcelCount ?? scope.parcelCount,
    landPriceByOwner: extra.landPriceByOwner?.length
      ? extra.landPriceByOwner
      : scope.landPriceByOwner,
    ownershipStats: extra.ownershipStats?.length
      ? extra.ownershipStats
      : scope.ownershipStats,
    zoneStats: extra.zoneStats?.length ? extra.zoneStats : scope.zoneStats,
    locationLabel: extra.locationLabel || scope.locationLabel,
  }
}
