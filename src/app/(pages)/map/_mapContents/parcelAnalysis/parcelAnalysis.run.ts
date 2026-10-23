import { call } from '@/lib/api'
import { toParcelAnalyzeUserError } from '@/lib/parcelAnalyzeUserError'
import {
  buildParcelAnalysisResult,
  runParcelAnalysisProgressiveLoad,
  type AnalyzeExtendedResponse,
  type ParcelAnalysisResult,
} from './parcelAnalysis.result'
import { delayForMinElapsed, PARCEL_ANALYZE_MIN_SPINNER_MS } from './parcelAnalysis.types'

export type ParcelAnalysisFacilityLayerMap = Record<
  string,
  Array<{ layerKey?: string; layerKorName?: string; geomType?: string; schema?: string }>
>

type RunParams = {
  wkt5181: string
  selectedIds: Set<string>
  facilityLayerMap: ParcelAnalysisFacilityLayerMap
  runId: number
  isCancelled: () => boolean
  onResult: (result: ParcelAnalysisResult, meta?: { totalAreaSqm?: number }) => void
  onError: (message: string | null) => void
  onEnriching: (active: boolean) => void
  /** 기본 집계 완료·결과 모달 열 시점 */
  onBaseReady?: () => void
  /** 원본 분석 데이터(점진 패치 포함) — 요약 카드 등 */
  onAnalyzeData?: (data: AnalyzeExtendedResponse) => void
}

/**
 * 필지분석 «분석하기»와 동일한 실행 흐름
 * analyzeParcels → 결과 모달 → 토지/소유/건축/용도/시설 점진 로딩
 */
export async function executeParcelAnalysisPipeline(params: RunParams): Promise<void> {
  const {
    wkt5181,
    selectedIds,
    facilityLayerMap,
    runId,
    isCancelled,
    onResult,
    onError,
    onEnriching,
    onBaseReady,
    onAnalyzeData,
  } = params

  const wkt = String(wkt5181 ?? '').trim()
  const itemCount = selectedIds.size
  const analyzeStartedAt = Date.now()
  let baseData: AnalyzeExtendedResponse | undefined
  let openDrawer = false

  try {
    const res = await call('', 'POST', {
      service: 'mapAnalyseService',
      action: 'analyzeParcels',
      params: { wkt5181: wkt },
    })
    if (isCancelled()) return

    baseData = (res?.data ?? res) as AnalyzeExtendedResponse | undefined
    if (!baseData || baseData.ok === false) {
      onError(toParcelAnalyzeUserError(baseData?.error || '분석 결과를 가져오지 못했습니다.'))
      onResult(buildParcelAnalysisResult(null, itemCount))
    } else {
      baseData = { ...baseData, wkt5181: wkt }
      onError(null)
      onAnalyzeData?.(baseData)
      onResult(buildParcelAnalysisResult(baseData, itemCount), {
        totalAreaSqm:
          typeof baseData.totalAreaSqm === 'number' && baseData.totalAreaSqm > 0
            ? baseData.totalAreaSqm
            : undefined,
      })
    }
    openDrawer = true
  } catch {
    if (isCancelled()) return
    onError('분석 요청 중 오류가 발생했습니다.')
    onResult(buildParcelAnalysisResult(null, itemCount))
    openDrawer = true
  } finally {
    await delayForMinElapsed(analyzeStartedAt, PARCEL_ANALYZE_MIN_SPINNER_MS)
    if (!isCancelled() && openDrawer) onBaseReady?.()
  }

  if (isCancelled() || !baseData?.ok) return

  const totalCount = Number(baseData.parcelCount ?? 0) || 0
  const totalAreaSqm = Number(baseData.totalAreaSqm ?? 0) || 0
  const needsLandRowPages =
    selectedIds.has('parcel:land') ||
    selectedIds.has('parcel:owner') ||
    selectedIds.has('parcel:jimok') ||
    selectedIds.has('building:ledger') ||
    selectedIds.has('parcel:landUse')

  let current: AnalyzeExtendedResponse = {
    ...baseData,
    wkt5181: wkt,
    landRows: [],
    landRowsProgress:
      needsLandRowPages && totalCount > 0
        ? { loaded: 0, total: totalCount, loading: true }
        : undefined,
  }
  onAnalyzeData?.(current)
  onResult(buildParcelAnalysisResult(current, itemCount), {
    totalAreaSqm: totalAreaSqm > 0 ? totalAreaSqm : undefined,
  })

  const applyPatch = (patch: Partial<AnalyzeExtendedResponse>) => {
    if (isCancelled()) return
    current = { ...current, ...patch }
    onAnalyzeData?.(current)
    onResult(buildParcelAnalysisResult(current, itemCount))
  }

  await runParcelAnalysisProgressiveLoad({
    runId,
    isCancelled,
    wkt5181: wkt,
    totalCount,
    totalAreaSqm,
    selectedIds,
    facilityLayerMap,
    onPatch: applyPatch,
    onEnriching: (active) => {
      if (!isCancelled()) onEnriching(active)
    },
  })
}
