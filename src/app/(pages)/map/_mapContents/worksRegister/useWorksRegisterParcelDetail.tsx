'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/lib/api'
import {
  ParcelAnalysisAnalyzingModal,
  ParcelAnalysisResultModal,
} from '../parcelAnalysis/ParcelAnalysis.resultModal'
import {
  STATIC_PARCEL_ANALYSIS_GROUPS,
  STATIC_PARCEL_ITEM_IDS,
  useParcelAnalysisGroups,
} from '../parcelAnalysis/ParcelAnalysis.items'
import {
  EMPTY_PARCEL_ANALYSIS_RESULT,
  useParcelAnalysisResultSections,
  type ParcelAnalysisResult,
} from '../parcelAnalysis/parcelAnalysis.result'
import { executeParcelAnalysisPipeline } from '../parcelAnalysis/parcelAnalysis.run'
import {
  buildLargeAreaConfirmMessage,
  isLargeParcelAnalysisArea,
  type ParcelAnalysisArea,
} from '../parcelAnalysis/parcelAnalysis.types'
import type { WorksRegisterScope } from './worksRegisterMock'

/**
 * 사업구역 상세보기 — 필지분석 «분석하기»와 동일 파이프라인·결과 모달
 */
export function useWorksRegisterParcelDetail() {
  const [analyzing, setAnalyzing] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [result, setResult] = useState<ParcelAnalysisResult | null>(null)
  const [scopeAreaSqm, setScopeAreaSqm] = useState(0)
  const [mapCaptureConfig, setMapCaptureConfig] = useState({
    geoserverUrl: 'http://localhost:8080/geoserver',
    workspace: 'ggnr',
  })
  const runIdRef = useRef(0)

  const { groups, allItemIds, facilityLayerMap, facilityWmsLayerMap, catalogLoaded } =
    useParcelAnalysisGroups(true)

  const selectedIds = useMemo(() => {
    if (catalogLoaded && allItemIds.length > 0) return new Set(allItemIds)
    return new Set(STATIC_PARCEL_ITEM_IDS)
  }, [catalogLoaded, allItemIds])

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds])
  const analysisGroups = catalogLoaded && groups.length > 0 ? groups : STATIC_PARCEL_ANALYSIS_GROUPS
  const { sections } = useParcelAnalysisResultSections(
    selectedIdList,
    analysisGroups,
    facilityWmsLayerMap
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'getParcelAnalysisMapConfig',
          params: {},
        })
        const data = (res?.data ?? res) as { geoserverUrl?: string; workspace?: string } | undefined
        if (cancelled) return
        if (data?.geoserverUrl && data?.workspace) {
          setMapCaptureConfig({
            geoserverUrl: data.geoserverUrl,
            workspace: data.workspace,
          })
        }
      } catch {
        /* 기본값 유지 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const cancelAnalyze = useCallback(() => {
    runIdRef.current += 1
    setAnalyzing(false)
    setEnriching(false)
  }, [])

  const closeResult = useCallback(
    (opts?: { force?: boolean }) => {
      if (!opts?.force && enriching) {
        const ok = window.confirm('결과 보강을 중단하고 닫을까요?')
        if (!ok) return
        cancelAnalyze()
      }
      setDrawerOpen(false)
    },
    [enriching, cancelAnalyze]
  )

  const openDetail = useCallback(
    async (scope: WorksRegisterScope) => {
      if (!scope.wkt?.trim()) {
        window.alert(
          '상세 분석에 필요한 구역 도형이 없습니다. 구역 그리기로 범위를 지정한 뒤 다시 시도하세요.'
        )
        return
      }

      const areaLike: ParcelAnalysisArea = {
        method: 'draw',
        summaryLabel: scope.summaryLabel,
        targetLabel: scope.summaryLabel,
        wkt: scope.wkt,
        itemCount: selectedIds.size,
        areaSqm: scope.areaSqm,
      }
      if (isLargeParcelAnalysisArea(areaLike)) {
        const proceed = window.confirm(buildLargeAreaConfirmMessage(areaLike))
        if (!proceed) return
      }

      const runId = ++runIdRef.current
      setDrawerOpen(false)
      setAnalyzing(true)
      setEnriching(false)
      setAnalyzeError(null)
      setScopeAreaSqm(scope.areaSqm || 0)

      try {
        await executeParcelAnalysisPipeline({
          wkt5181: scope.wkt,
          selectedIds,
          facilityLayerMap,
          runId,
          isCancelled: () => runId !== runIdRef.current,
          onResult: (next, meta) => {
            if (runId !== runIdRef.current) return
            setResult(next)
            if (meta?.totalAreaSqm != null && meta.totalAreaSqm > 0) {
              setScopeAreaSqm(meta.totalAreaSqm)
            }
          },
          onError: (message) => {
            if (runId !== runIdRef.current) return
            setAnalyzeError(message)
          },
          onEnriching: (active) => {
            if (runId === runIdRef.current) setEnriching(active)
          },
          onBaseReady: () => {
            if (runId === runIdRef.current) {
              setAnalyzing(false)
              setDrawerOpen(true)
            }
          },
        })
      } finally {
        if (runId === runIdRef.current) setAnalyzing(false)
      }
    },
    [selectedIds, facilityLayerMap]
  )

  const detailModals = (
    <>
      <ParcelAnalysisAnalyzingModal open={analyzing && !drawerOpen} onCancel={cancelAnalyze} />
      <ParcelAnalysisResultModal
        open={drawerOpen}
        onClose={() => closeResult()}
        onForceClose={() => closeResult({ force: true })}
        sections={sections}
        result={result ?? EMPTY_PARCEL_ANALYSIS_RESULT}
        analyzeError={analyzeError}
        enriching={enriching}
        scopeAreaSqm={scopeAreaSqm}
        itemCount={(result ?? EMPTY_PARCEL_ANALYSIS_RESULT).itemCount}
        mapCaptureConfig={mapCaptureConfig}
      />
    </>
  )

  return { openDetail, detailModals, analyzing }
}
