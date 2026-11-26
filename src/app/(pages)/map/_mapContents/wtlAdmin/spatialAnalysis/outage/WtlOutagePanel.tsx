'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { containsCoordinate } from 'ol/extent'
import { transform } from 'ol/proj'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type {
  IdentifyLayerResult,
  IdentifyPopupState,
} from '../../../../_mapComponents/hooks/useFeatureIdentify'
import { clearMapLayerClickDetailHighlight } from '@/lib/mapLayerClickDetailHighlight'
import {
  getViewProjectionCode,
  lonLatToView,
  viewToLonLat,
} from '../topology/topoMapProjection'
import {
  ANALYSIS_HISTORY_PAGE_SIZE,
  AnalysisHistoryPager,
} from '../AnalysisHistoryPager'
import type { WtlOutageHandoffSeed } from '../wtlSpatialHandoff'
import { WtlOutageGeomEdit } from './WtlOutageGeomEdit'
import { WtlOutageResultEdit, type OutageEditMode } from './WtlOutageResultEdit'
import { WtlOutageSmsModal } from './WtlOutageSmsModal'
import { WtlOutageHwpxModal } from './WtlOutageHwpxModal'
import {
  isOutageOverlayScaleVisible,
  OUTAGE_OVERLAY_MAX_SCALE_M,
  useWtlOutageMapLayer,
} from './useWtlOutageMapLayer'
import { zoomFromScaleMeters } from '../../../../_mapComponents/hooks/mapScale'
import { WtlOutageZoomHint } from './WtlOutageZoomHint'
import type { LonLat } from './wtlOutageGeom'
import {
  fitOutageGeometry4326,
  fitOutageResult,
  flyToOutageLonLat,
  OUTAGE_FLY_MS,
  type WtlOutageSelectionHighlight,
} from './wtlOutageMapFly'
import {
  buildOutageHistory,
  nextOutageStatus,
  parseOutageGateIds,
  type WtlOutageGate,
  type WtlOutageHistory,
  type WtlOutageResult,
} from './wtlOutageSample'

type TargetTab = '수용가' | '도로명주소' | '필지'

type Props = {
  active?: boolean
  handoffSeed?: WtlOutageHandoffSeed | null
  onHandoffConsumed?: (seq: number) => void
  /** 지도 좌측 메뉴 폭(px) — 편집 도구모음 가운데 정렬용 */
  mapLeftPx?: number
}

function statusClass(status: string) {
  if (status === '종료') return 'text-slate-500'
  if (status === '분석완료' || status === '설정완료') return 'text-emerald-700'
  if (status === '문자발송 완료') return 'text-amber-700'
  if (status === '단수중') return 'text-rose-700'
  return 'text-foreground'
}

/** 지도 상단용 — 단수 구간 미생성. 패널 notice와 문구를 나누어 중복하지 않음 */
function outageNoIsolationBanner(lockCount: number): string {
  return lockCount === 1
    ? '이 제수변만 잠가서는 단수 구간이 생기지 않습니다.'
    : '잠근 제수변으로는 단수 구간이 생기지 않습니다.'
}

export function WtlOutagePanel({
  active = true,
  handoffSeed = null,
  onHandoffConsumed,
  mapLeftPx = 0,
}: Props) {
  const { data: session } = useSession()
  const sessionAuthor = useMemo(
    () => ({
      userId: String(session?.user?.id ?? '').trim() || null,
      userName: String(session?.user?.name ?? '').trim() || null,
    }),
    [session?.user?.id, session?.user?.name]
  )
  const [history, setHistory] = useState<WtlOutageHistory[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [lockedGateIds, setLockedGateIds] = useState<string[]>([])
  const [gateById, setGateById] = useState<Map<string, WtlOutageGate>>(() => new Map())
  const [result, setResult] = useState<WtlOutageResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [targetTab, setTargetTab] = useState<TargetTab>('수용가')
  /** 수용가·도로명·필지 목록에서 고른 행 */
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [selectionHighlight, setSelectionHighlight] = useState<WtlOutageSelectionHighlight | null>(null)
  const targetFetchSeqRef = useRef(0)
  const [smsOpen, setSmsOpen] = useState(false)
  const [hwpxOpen, setHwpxOpen] = useState(false)
  /** 제수변 번호(ogc_fid) 찾기 */
  const [gateQuery, setGateQuery] = useState('')
  const [gateSearching, setGateSearching] = useState(false)
  const [gateMatches, setGateMatches] = useState<WtlOutageGate[]>([])
  const [hiddenPipeIndexes, setHiddenPipeIndexes] = useState<number[]>([])
  const [notice, setNotice] = useState('')
  /** 지도 상단 — 단수 구간 미생성 짧은 안내(패널 notice와 분리) */
  const [mapStatusBanner, setMapStatusBanner] = useState<string | null>(null)
  /** 지도 클릭으로 고른 행 — 목록에서 보이게 스크롤 */
  const [scrollToTargetId, setScrollToTargetId] = useState<string | null>(null)
  const targetListRef = useRef<HTMLDivElement>(null)
  const [geomMapEditing, setGeomMapEditing] = useState(false)
  const [editMode, setEditMode] = useState<OutageEditMode>(null)
  const [saved, setSaved] = useState(false)
  const previewSeqRef = useRef(0)
  const handoffDoneRef = useRef<number | null>(null)
  /** 단수구역 최초 진입 시 가까운 제수변 이동 — 모드 끌 때 초기화 */
  const entryFlyDoneRef = useRef(false)
  const onHandoffConsumedRef = useRef(onHandoffConsumed)
  onHandoffConsumedRef.current = onHandoffConsumed
  const mapContext = useMapContext()

  const fitToResult = (next: WtlOutageResult | null | undefined) => {
    fitOutageResult(
      mapContext?.mapInstanceRef?.current,
      next,
      mapContext?.applyMapViewPaddingRef?.current
    )
  }

  const flyToPoint = (point?: [number, number] | null) => {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      setNotice('위치 정보가 없어 이동할 수 없습니다. 다시 분석·저장하면 위치가 포함됩니다.')
      return
    }
    flyToOutageLonLat(
      mapContext?.mapInstanceRef?.current,
      point[0],
      point[1],
      mapContext?.applyMapViewPaddingRef?.current
    )
  }

  const clearTargetSelection = () => {
    targetFetchSeqRef.current += 1
    setSelectedTargetId(null)
    setSelectionHighlight(null)
  }

  /**
   * 수용가 목록 → 위치 이동 후 속성조회(레이어 클릭 상세).
   * 단수 전용 펄스 대신 공통 속성조회 펄스/패널을 쓴다.
   */
  const openCustomerAttributeIdentify = (
    point: [number, number],
    meta?: { ogcFid?: number; meterNo?: string }
  ) => {
    const map = mapContext?.mapInstanceRef?.current
    const setIdentifyPopup = mapContext?.setMapSplitIdentifyPopup
    if (!map || !setIdentifyPopup) {
      setNotice('지도를 준비 중입니다. 잠시 후 다시 선택하세요.')
      return
    }
    setNotice('')
    /** 대기 중 식별·공통 펄스만 정리(속성조회 공통 닫기 API는 건드리지 않음). 이동 후 새 식별로 연다 */
    setIdentifyPopup(null)
    clearMapLayerClickDetailHighlight(map, 'layerClickDetail')
    flyToPoint(point)
    /** flyToOutageLonLat 시작 지연(80) + 애니메이션 + 여유 — 이동 끝난 뒤 식별·패널 앵커 */
    const seq = ++targetFetchSeqRef.current
    window.setTimeout(() => {
      if (seq !== targetFetchSeqRef.current) return
      const mapNow = mapContext?.mapInstanceRef?.current
      if (!mapNow || !setIdentifyPopup) return
      const viewProj = getViewProjectionCode(mapNow)
      const coord = transform(point, 'EPSG:4326', viewProj) as [number, number]
      const zoom = mapNow.getView().getZoom() ?? 16
      const buffer = 300_000 * Math.pow(0.54, zoom)
      void call('', 'POST', {
        service: 'standardService',
        action: 'identifyFeatures',
        params: {
          x: coord[0],
          y: coord[1],
          buffer,
          tables: ['wtl_meta_ps'],
          schema: 'layer',
        },
      })
        .then((res: unknown) => {
          if (seq !== targetFetchSeqRef.current) return
          const data = (res as { data?: { results?: IdentifyLayerResult[] } })?.data ?? res
          let results: IdentifyLayerResult[] = Array.isArray(
            (data as { results?: IdentifyLayerResult[] })?.results
          )
            ? ((data as { results: IdentifyLayerResult[] }).results ?? [])
            : []
          if (results.length === 0) {
            setNotice('계량기 속성을 찾지 못했습니다.')
            return
          }
          const wantFid =
            meta?.ogcFid != null && Number.isFinite(meta.ogcFid) ? Math.trunc(meta.ogcFid) : null
          const wantMeter = meta?.meterNo?.trim()
          if (wantFid != null || wantMeter) {
            results = results.map((layer) => {
              const physical = String(layer.physicalTable ?? layer.tableName ?? '')
                .trim()
                .toLowerCase()
              if (
                physical !== 'wtl_meta_ps' &&
                String(layer.tableName).toLowerCase() !== 'wtl_meta_ps'
              ) {
                return layer
              }
              const matched = layer.features.filter((f) => {
                const d = f.data ?? {}
                if (wantFid != null) {
                  const fid = Number(d.ogc_fid ?? d.ogcFid)
                  if (Number.isFinite(fid) && Math.trunc(fid) === wantFid) return true
                }
                if (wantMeter) {
                  const m = String(d.met_num ?? d.meterNo ?? '').trim()
                  if (m && m === wantMeter) return true
                }
                return false
              })
              return matched.length > 0 ? { ...layer, features: matched } : layer
            })
            results = results.filter((l) => l.features.length > 0)
            if (results.length === 0) {
              setNotice('계량기 속성을 찾지 못했습니다.')
              return
            }
          }
          const popup: IdentifyPopupState = { coordinate: coord, results }
          setIdentifyPopup(popup)
        })
        .catch(() => {
          if (seq !== targetFetchSeqRef.current) return
          setNotice('계량기 속성 조회에 실패했습니다.')
        })
    }, 80 + OUTAGE_FLY_MS + 80)
  }

  /** 도로명: wtl_meta_ps 점 + 강조. 필지: 면 조회 후 강조. 수용가: 속성조회로 대체 */
  const toggleTargetRow = (
    id: string,
    point: [number, number] | null | undefined,
    kind: 'customer' | 'point' | 'parcel',
    meta?: { ogcFid?: number; meterNo?: string },
    /** 지도에서 직접 고른 경우 — 이미 보고 있는 위치라 이동·식별 재요청 없음 */
    fromMap = false
  ) => {
    if (selectedTargetId === id) {
      clearTargetSelection()
      return
    }
    setSelectedTargetId(id)
    if (kind === 'customer') {
      // 단수 전용 펄스 없음 — 지도 클릭은 속성조회만, 목록은 이동 후 속성조회
      setSelectionHighlight(null)
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        setNotice('위치 정보가 없어 속성을 열 수 없습니다. 다시 분석·저장하면 위치가 포함됩니다.')
        return
      }
      if (!fromMap) openCustomerAttributeIdentify(point, meta)
      return
    }
    if (kind === 'point') {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        setSelectionHighlight(null)
        setNotice('위치 정보가 없어 이동할 수 없습니다. 다시 분석·저장하면 위치가 포함됩니다.')
        return
      }
      setSelectionHighlight({
        kind: 'point',
        point,
        ogcFid: meta?.ogcFid,
        meterNo: meta?.meterNo,
      })
      if (!fromMap) flyToPoint(point)
      return
    }

    const seq = ++targetFetchSeqRef.current
    setSelectionHighlight(null)
    const pnu = id.replace(/^p-/, '').replace(/\D/g, '').slice(0, 19)
    const params: { pnu?: string; x?: number; y?: number } = {}
    if (pnu.length >= 19) params.pnu = pnu
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      const [x, y] = transform(point, 'EPSG:4326', 'EPSG:3857')
      params.x = x
      params.y = y
    }
    if (!params.pnu && (params.x == null || params.y == null)) {
      setNotice('필지 위치를 찾을 수 없습니다.')
      return
    }
    setNotice('필지 경계를 불러오는 중…')
    void call('', 'POST', {
      service: 'standardService',
      action: 'getParcelHighlightGeom',
      params,
    })
      .then((res: unknown) => {
        if (seq !== targetFetchSeqRef.current) return
        const payload =
          (res as { data?: { geometry4326?: Record<string, unknown> | null } })?.data ?? res
        const geometry4326 = (payload as { geometry4326?: Record<string, unknown> | null })
          ?.geometry4326
        if (!geometry4326 || typeof geometry4326 !== 'object') {
          setSelectionHighlight(null)
          setNotice('필지 경계를 찾을 수 없습니다.')
          return
        }
        setSelectionHighlight({ kind: 'polygon', geometry4326, pnu: params.pnu })
        fitOutageGeometry4326(
          mapContext?.mapInstanceRef?.current,
          geometry4326,
          mapContext?.applyMapViewPaddingRef?.current
        )
        setNotice('')
      })
      .catch(() => {
        if (seq !== targetFetchSeqRef.current) return
        setSelectionHighlight(null)
        setNotice('필지 경계 조회에 실패했습니다.')
      })
  }

  const rememberGates = (gates: WtlOutageGate[]) => {
    if (gates.length === 0) return
    setGateById((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const gate of gates) {
        const old = next.get(gate.id)
        if (old && old.point[0] === gate.point[0] && old.point[1] === gate.point[1]) continue
        next.set(gate.id, gate)
        changed = true
      }
      return changed ? next : prev
    })
  }

  const lockedGates = lockedGateIds
    .map((id) => gateById.get(id))
    .filter((g): g is WtlOutageGate => Boolean(g))

  /** 잠금 변경 시 단수 관로·면 미리보기 (이력 저장 없음). 성공 시 result 반환 */
  const previewOutage = async (ids: string[]): Promise<WtlOutageResult | null> => {
    if (ids.length === 0) {
      setResult(null)
      clearTargetSelection()
      return null
    }
    const seq = ++previewSeqRef.current
    setAnalyzing(true)
    setMapStatusBanner(null)
    setNotice('밸브에 맞닿은 출구 관로 진행방향으로 추적하는 중…')
    try {
      const res = await call('', 'POST', {
        service: 'wtlOutageService',
        action: 'analyzeWtlOutage',
        params: { gateIds: ids },
      })
      if (seq !== previewSeqRef.current) return null
      const body = (res?.data ?? res) as {
        result?: WtlOutageResult | null
        gates?: WtlOutageGate[]
        error?: string
        errorCode?: string
      }
      if (body.gates?.length) rememberGates(body.gates)
      if (body.error || !body.result) {
        setResult(null)
        clearTargetSelection()
        setMapStatusBanner(
          body.errorCode === 'no_isolation' ? outageNoIsolationBanner(ids.length) : null
        )
        setNotice(body.error || '단수 관로를 찾을 수 없습니다.')
        return null
      }
      setResult(body.result)
      setEditMode(null)
      clearTargetSelection()
      setMapStatusBanner(null)
      fitToResult(body.result)
      setNotice(
        `잠금 ${ids.length}개 · 단수관로 ${body.result.pipes.length}구간 · 수용가 ${body.result.customers.length} · 필지 ${body.result.parcels.length}` +
          (body.result.meterlessBuildingCount
            ? ` · 계량기 없는 건물군 +${body.result.meterlessBuildingCount}`
            : '')+
          (body.result.zoneBasis === 'meter' && body.result.meterCount === 0
            ? ' · 단수 대상 수용가 없음(끊긴 관로에 물린 계량기 없음)'
            : '')
      )
      return body.result
    } catch {
      if (seq !== previewSeqRef.current) return null
      setResult(null)
      setMapStatusBanner(null)
      setNotice('단수 관로 표시에 실패했습니다.')
      return null
    } finally {
      if (seq === previewSeqRef.current) setAnalyzing(false)
    }
  }

  /** 세션 이력에만 저장 (brief: 세션 이력만 유지). 작성자는 로그인 세션 */
  const saveToSessionHistory = (
    gates: WtlOutageGate[],
    analyzed: WtlOutageResult,
    reason = ''
  ): WtlOutageHistory => {
    const row = { ...buildOutageHistory(gates, analyzed, sessionAuthor), reason }
    setHistory((prev) => [row, ...prev])
    setHistoryPage(1)
    setHistoryId(row.id)
    setSaved(true)
    return row
  }

  /** 누수분석에서 넘어온 제수변으로 단수 미리보기 + 세션 이력 저장 */
  useEffect(() => {
    if (!handoffSeed || handoffSeed.gates.length === 0) return
    if (handoffDoneRef.current === handoffSeed.seq) return
    handoffDoneRef.current = handoffSeed.seq

    const gates = handoffSeed.gates
    const ids = gates.map((g) => g.id)
    const reason = handoffSeed.label?.trim() || '누수분석'

    rememberGates(gates)
    setLockedGateIds(ids)
    setHistoryId(null)
    setSaved(false)
    setGeomMapEditing(false)
    setSmsOpen(false)

    void (async () => {
      const analyzed = await previewOutage(ids)
      if (!analyzed) {
        setNotice('누수분석 제수변으로 단수 분석에 실패했습니다.')
        onHandoffConsumedRef.current?.(handoffSeed.seq)
        return
      }
      saveToSessionHistory(gates, analyzed, reason)
      setNotice(
        `누수분석 → 단수구역 · 제수변 ${gates.length} · 관로 ${analyzed.pipes.length} · 수용가 ${analyzed.customers.length} · 필지 ${analyzed.parcels.length}`
      )
      onHandoffConsumedRef.current?.(handoffSeed.seq)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handoffSeed.seq만 트리거
  }, [handoffSeed?.seq])

  /** 다른 탭으로 나가면 잠금·분석 결과를 비워 다시 들어오면 새 분석 */
  useEffect(() => {
    if (active) return
    entryFlyDoneRef.current = false
    setHistoryId(null)
    setLockedGateIds([])
    setResult(null)
    clearTargetSelection()
    setSaved(false)
    setGeomMapEditing(false)
    setHiddenPipeIndexes([])
    setSmsOpen(false)
    setAnalyzing(false)
    setNotice('')
    setMapStatusBanner(null)
  }, [active])

  /**
   * 최초 진입: 주변에 제수변이 안 보이면 가장 가까운 제수변으로 이동하고
   * 열림·잠금이 보이는 축척까지 확대. 이미 보이면 이동 생략.
   */
  useEffect(() => {
    if (!active || entryFlyDoneRef.current) return
    if (handoffSeed?.seq) return
    if (lockedGateIds.length > 0 || result || historyId) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const view = map.getView()
    const center = view.getCenter()
    if (!center || center.length < 2) return

    entryFlyDoneRef.current = true
    const viewProj = getViewProjectionCode(map)
    const [lon, lat] = viewToLonLat([center[0], center[1]], viewProj)
    const overlayMinZoom = zoomFromScaleMeters(OUTAGE_OVERLAY_MAX_SCALE_M) + 1

    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'findNearestWtlOutageGate',
          params: { lon, lat },
        })
        const gate = (((res?.data ?? res) as { rows?: WtlOutageGate[] })?.rows ?? []).find(
          (g) => g?.id && Array.isArray(g.point) && g.point.length >= 2
        )
        if (!gate) {
          setNotice('근처에 제수변을 찾지 못했습니다. 지도를 옮겨 제수변을 찾아 잠그세요.')
          return
        }
        rememberGates([gate])
        const size = map.getSize()
        const extent = size ? view.calculateExtent(size) : null
        const gateView = lonLatToView(gate.point, viewProj)
        const inView = extent ? containsCoordinate(extent, gateView) : false
        const scaleOk = isOutageOverlayScaleVisible(view.getZoom())
        if (inView && scaleOk) {
          setNotice('지도에서 제수변 위 열림·잠금으로 잠그세요.')
          return
        }
        flyToOutageLonLat(
          map,
          gate.point[0],
          gate.point[1],
          mapContext?.applyMapViewPaddingRef?.current,
          overlayMinZoom
        )
        setNotice(`${gate.name} 위치로 이동 · 열림/잠금으로 잠글 수 있습니다.`)
      } catch {
        setNotice('가까운 제수변을 찾지 못했습니다. 지도를 확대해 제수변을 잠그세요.')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입 1회
  }, [active, mapContext?.mapReady, handoffSeed?.seq, lockedGateIds.length, result, historyId])

  const lockGate = (gateId?: string | null) => {
    const id = gateId
    if (!id) return
    // 잠금이 바뀌면 단수 범위가 달라지므로 수용가 선택 강조(펄스)는 끈다
    clearTargetSelection()
    setHistoryId(null)
    setSaved(false)
    const next = lockedGateIds.includes(id) ? lockedGateIds : [...lockedGateIds, id]
    setLockedGateIds(next)
    void previewOutage(next)
  }

  const unlockGate = (gateId?: string | null) => {
    const id = gateId
    // 선택해제·잠금해제(밸브 열기) 시 수용가 선택 강조(펄스) 종료
    clearTargetSelection()
    if (!id) {
      setLockedGateIds([])
      setResult(null)
      setHistoryId(null)
      setSaved(false)
      setMapStatusBanner(null)
      setNotice('모든 잠금을 해제했습니다.')
      return
    }
    setHistoryId(null)
    setSaved(false)
    const next = lockedGateIds.filter((row) => row !== id)
    setLockedGateIds(next)
    if (next.length === 0) {
      setResult(null)
      setMapStatusBanner(null)
      setNotice('잠긴 제수변이 없습니다.')
      return
    }
    void previewOutage(next)
  }

  /** 찾은 제수변으로 이동 — 열림·잠금 버튼이 보이는 축척까지 확대하고 선택 */
  const goToGate = (gate: WtlOutageGate) => {
    rememberGates([gate])
    flyToOutageLonLat(
      mapContext?.mapInstanceRef?.current,
      gate.point[0],
      gate.point[1],
      mapContext?.applyMapViewPaddingRef?.current,
      // 축척 240m보다 한 단계 더 확대해 경계에서 버튼이 깜빡이지 않게
      zoomFromScaleMeters(OUTAGE_OVERLAY_MAX_SCALE_M) + 1
    )
    setNotice(`${gate.name} 위치로 이동 · 열림/잠금으로 잠글 수 있습니다.`)
  }

  const searchGate = async () => {
    const query = gateQuery.trim()
    if (!query) {
      setNotice('제수변 번호를 입력하세요.')
      return
    }
    setGateSearching(true)
    setGateMatches([])
    try {
      const res = await call('', 'POST', {
        service: 'wtlOutageService',
        action: 'findWtlOutageGates',
        params: { query },
      })
      const rows = (((res?.data ?? res) as { rows?: WtlOutageGate[] })?.rows ?? []).filter(
        (g) => g?.id && Array.isArray(g.point) && g.point.length >= 2
      )
      if (rows.length === 0) {
        setNotice(`번호 «${query}» 제수변을 찾지 못했습니다.`)
        return
      }
      const exact = rows.filter((g) => g.name === query)
      if (exact.length === 1 || rows.length === 1) {
        goToGate(exact[0] ?? rows[0]!)
        return
      }
      setGateMatches(rows)
      setNotice(`«${query}» 제수변 ${rows.length}건 · 목록에서 고르세요.`)
    } catch {
      setNotice('제수변 찾기에 실패했습니다.')
    } finally {
      setGateSearching(false)
    }
  }

  useWtlOutageMapLayer({
    active,
    pickMode: !geomMapEditing && !editMode,
    lockedGateIds,
    result,
    selectionHighlight,
    hideZone: geomMapEditing,
    hiddenPipeIndexes,
    onVisibleGates: rememberGates,
    onLockGate: (id) => lockGate(id),
    onUnlockGate: (id) => unlockGate(id),
    onSelectCustomer: (customerId) => {
      const row = result?.customers.find((c) => c.id === customerId)
      if (!row) return
      setTargetTab('수용가')
      toggleTargetRow(
        row.id,
        row.point,
        'customer',
        { ogcFid: row.ogcFid, meterNo: row.meterNo !== '—' ? row.meterNo : undefined },
        true
      )
      setScrollToTargetId(row.id)
    },
  })

  useEffect(() => {
    if (!result || !active) setEditMode(null)
  }, [result, active])

  // 결과가 사라지면(모든 잠금 해제 등) 남은 선택 강조도 정리
  useEffect(() => {
    if (!result) clearTargetSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- result 유무만 트리거
  }, [result])

  // 지도에서 고른 수용가 행을 목록에서 보이게
  useEffect(() => {
    if (!scrollToTargetId) return
    const id = scrollToTargetId
    const frame = requestAnimationFrame(() => {
      const rows = targetListRef.current?.querySelectorAll<HTMLElement>('[data-target-row]') ?? []
      for (const row of rows) {
        if (row.dataset.targetRow === id) {
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          break
        }
      }
      setScrollToTargetId(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollToTargetId, targetTab])

  const customers = result?.customers ?? []
  const smsTargets = useMemo(() => customers.filter((c) => c.phone.trim()), [customers])
  const currentHistory = history.find((h) => h.id === historyId) ?? null
  const historyPageCount = Math.max(1, Math.ceil(history.length / ANALYSIS_HISTORY_PAGE_SIZE))
  const historySafePage = Math.min(historyPage, historyPageCount)
  const historyPageItems = history.slice(
    (historySafePage - 1) * ANALYSIS_HISTORY_PAGE_SIZE,
    historySafePage * ANALYSIS_HISTORY_PAGE_SIZE
  )

  const nextStatus = currentHistory ? nextOutageStatus(currentHistory.status) : null

  const patchHistoryLocal = (id: string | null, patch: Partial<WtlOutageHistory>) => {
    if (!id) return
    setHistory((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const persistHistoryPatch = (id: string | null, patch: Partial<WtlOutageHistory>) => {
    patchHistoryLocal(id, patch)
  }

  const applySmsFields = (payload: {
    title: string
    reason: string
    startAt: string
    endAt: string
    count: number
  }) => ({
    reason: payload.reason,
    startAt: payload.startAt.replace('T', ' '),
    endAt: payload.endAt.replace('T', ' '),
    smsTitle: payload.title,
    householdCount: payload.count,
  })

  const startNew = () => {
    setHistoryId(null)
    setLockedGateIds([])
    setResult(null)
    clearTargetSelection()
    setSaved(false)
    setGeomMapEditing(false)
    setMapStatusBanner(null)
    setNotice('제수변 위 잠금으로 여러 개를 선택할 수 있습니다.')
  }

  const clearHistorySelection = () => {
    setHistoryId(null)
    setLockedGateIds([])
    setResult(null)
    clearTargetSelection()
    setSaved(false)
    setGeomMapEditing(false)
    setMapStatusBanner(null)
    setNotice('이력 선택을 해제했습니다.')
  }

  const loadHistory = (item: WtlOutageHistory) => {
    if (historyId === item.id) {
      clearHistorySelection()
      return
    }
    const ids = parseOutageGateIds(item.gateId)
    setHistoryId(item.id)
    setSaved(true)
    setGeomMapEditing(false)
    setLockedGateIds(ids)
    setResult(item.result)
    setEditMode(null)
    clearTargetSelection()
    setGateById((prev) => {
      const next = new Map(prev)
      for (const id of ids) {
        if (!next.has(id)) {
          next.set(id, {
            id,
            name: item.gateName.split(',')[ids.indexOf(id)]?.trim() || id,
            diameter: '—',
            address: '—',
            point: item.result.ring[0] ?? [0, 0],
          })
        }
      }
      return next
    })
    fitToResult(item.result)
    setNotice('')
  }

  /** 잠금 미리보기 결과를 세션 이력에 저장 → 이후 도형편집 가능 */
  const saveAnalysisResult = () => {
    if (!result || lockedGates.length === 0) {
      setNotice('잠금 미리보기가 있을 때 저장할 수 있습니다.')
      return
    }
    saveToSessionHistory(lockedGates, result)
    setNotice(
      `분석결과 저장 · 제수변 ${lockedGates.length} · 관로 ${result.pipes.length} · 수용가 ${result.customers.length} · 필지 ${result.parcels.length} · 이어서 도형편집을 할 수 있습니다.`
    )
  }

  /** 지도 도구모음(그리기·지우기·버퍼)으로 바뀐 단수 결과 반영 */
  const updateEditedResult = (next: WtlOutageResult) => {
    setResult(next)
    clearTargetSelection()
    if (historyId) {
      persistHistoryPatch(historyId, {
        result: next,
        householdCount: next.customers.filter((c) => c.phone.trim()).length || next.customers.length,
      })
    }
  }

  const applyEditedZone = (
    ring: LonLat[],
    customers: WtlOutageResult['customers'],
    addresses: WtlOutageResult['addresses'],
    parcels: WtlOutageResult['parcels']
  ) => {
    if (!result) return
    // 읍면동리 적용 — 면 전체를 그 경계로 교체(구멍 없음)
    const next: WtlOutageResult = { ...result, ring, rings: [ring], polygons: [[ring]], customers, addresses, parcels }
    setResult(next)
    clearTargetSelection()
    if (historyId) {
      persistHistoryPatch(historyId, {
        result: next,
        householdCount: customers.filter((c) => c.phone.trim()).length || customers.length,
      })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WtlOutageZoomHint
        active={active}
        showLockHint={lockedGateIds.length === 0}
        statusMessage={
          lockedGateIds.length > 0 && !result && !analyzing ? mapStatusBanner : null
        }
      />
      <WtlOutageResultEdit
        active={active && !geomMapEditing}
        mapLeftPx={mapLeftPx}
        result={result}
        mode={editMode}
        onMode={setEditMode}
        onChange={updateEditedResult}
        onNotice={setNotice}
      />
      {/* 이력 · 결과 5:5 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 제목+헤더+8행+페이지바 ≈ 20rem — 한 페이지 8건이 잘리지 않게 */}
        <div className="flex h-[min(50%,20rem)] min-h-[20rem] shrink-0 flex-col overflow-hidden border-b border-border">
          <div className="flex h-8 shrink-0 items-center px-3">
            <span className="text-[11px] font-semibold text-foreground">분석 이력</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {history.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                분석결과 저장 후 이력이 표시됩니다.
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[11px]">
                <thead className="bg-muted">
                  <tr className="h-7 border-b border-border">
                    <th className="w-[7.25rem] px-1.5 font-medium text-muted-foreground">일시</th>
                    <th className="w-[5rem] px-1.5 font-medium text-muted-foreground">제수변</th>
                    <th className="px-2 font-medium text-muted-foreground">사유</th>
                    <th className="w-[4.75rem] px-1.5 font-medium text-muted-foreground">작성자</th>
                    <th className="w-[4.75rem] px-1.5 font-medium text-muted-foreground">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {historyPageItems.map((item, rowIdx) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'h-7 cursor-pointer border-b border-border hover:bg-primary/5',
                        historyId === item.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25',
                        historyPageItems.length >= ANALYSIS_HISTORY_PAGE_SIZE &&
                          rowIdx === historyPageItems.length - 1 &&
                          'border-b-0'
                      )}
                      onClick={() => loadHistory(item)}
                    >
                      <td className="whitespace-nowrap px-1.5 tabular-nums text-foreground">{item.at}</td>
                      <td className="truncate px-1.5 text-foreground" title={item.gateName || undefined}>
                        {item.gateName}
                      </td>
                      <td
                        className="truncate px-2 text-muted-foreground"
                        title={item.reason?.trim() ? item.reason : undefined}
                      >
                        {item.reason || '—'}
                      </td>
                      <td
                        className="truncate px-1.5 text-muted-foreground"
                        title={item.createUserName || item.createUser || undefined}
                      >
                        {item.createUserName || item.createUser || '—'}
                      </td>
                      <td className={cn('whitespace-nowrap px-1.5', statusClass(item.status))}>
                        {item.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {history.length > 0 && (
            <AnalysisHistoryPager
              page={historySafePage}
              total={history.length}
              onPageChange={setHistoryPage}
            />
          )}
        </div>

        <div className="flex h-[3.25rem] shrink-0 flex-col justify-center border-b border-border px-3">
          <div className="flex h-6 min-w-0 items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-foreground">
              {lockedGates.length > 0 ? (
                <>
                  <span className="font-semibold">잠금 {lockedGates.length}</span>
                  <span className="text-muted-foreground"> · {lockedGates.map((g) => g.name).join(', ')}</span>
                </>
              ) : (
                <span className="text-muted-foreground">잠금 없음</span>
              )}
            </p>
            <button
              type="button"
              disabled={lockedGateIds.length === 0}
              className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              onClick={() => unlockGate(null)}
            >
              잠금해제
            </button>
          </div>
          {/* 제수변 관리번호 찾기 — 개발용(필요할 때 주석 해제). 서비스 findWtlOutageGates는 유지
          <form
            className="mt-1.5 flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              void searchGate()
            }}
          >
            <label htmlFor="wtl-outage-gate-search" className="sr-only">
              제수변 번호
            </label>
            <input
              id="wtl-outage-gate-search"
              value={gateQuery}
              onChange={(e) => setGateQuery(e.target.value)}
              placeholder="제수변 번호로 찾기 (예: 3560)"
              inputMode="numeric"
              className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={gateSearching}
              className="h-6 shrink-0 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-40"
            >
              {gateSearching ? '찾는 중…' : '찾기'}
            </button>
          </form>
          {gateMatches.length > 0 && (
            <div className="mt-1 flex max-h-16 flex-wrap gap-1 overflow-auto">
              {gateMatches.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-primary/5"
                  title={`${g.diameter} · ${g.address}`}
                  onClick={() => {
                    setGateMatches([])
                    goToGate(g)
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )} */}
          <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-muted-foreground">
            {notice || '\u00a0'}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 border-b border-border">
            {(['수용가', '도로명주소', '필지'] as const).map((name) => (
              <button
                key={name}
                type="button"
                className={cn(
                  'flex-1 py-1.5 text-center text-[11px] font-medium',
                  targetTab === name
                    ? 'border-b-2 border-primary bg-primary/5 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => {
                  setTargetTab(name)
                  clearTargetSelection()
                }}
              >
                {name}
                {result && (
                  <span className="ml-1 text-[10px] tabular-nums opacity-80">
                    {name === '수용가'
                      ? result.customers.length
                      : name === '도로명주소'
                        ? result.addresses.length
                        : result.parcels.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div ref={targetListRef} className="min-h-0 flex-1 overflow-auto">
        {!result ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            제수변 잠금 후 대상 목록이 표시됩니다.
          </p>
        ) : targetTab === '필지' ? (
          result.parcels.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              범위 안 필지가 없습니다.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">지번</th>
                  <th className="w-[20%] px-2 py-1.5 font-medium text-muted-foreground">지목</th>
                  <th className="w-[24%] px-2 py-1.5 font-medium text-muted-foreground">면적</th>
                </tr>
              </thead>
              <tbody>
                {result.parcels.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'cursor-pointer border-b border-border hover:bg-primary/5',
                      selectedTargetId === row.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                    )}
                    onClick={() => toggleTargetRow(row.id, row.point, 'parcel')}
                  >
                    <td className="px-2 py-1.5 text-foreground">{row.jibun}</td>
                    <td className="px-2 py-1.5 text-foreground">{row.jimok}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{row.area}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : targetTab === '도로명주소' ? (
          result.addresses.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              범위 안 도로명주소가 없습니다.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">도로명</th>
                  <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">지번</th>
                  <th className="w-[22%] px-2 py-1.5 font-medium text-muted-foreground">수용가번호</th>
                </tr>
              </thead>
              <tbody>
                {result.addresses.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'cursor-pointer border-b border-border hover:bg-primary/5',
                      selectedTargetId === row.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                    )}
                    onClick={() =>
                      toggleTargetRow(row.id, row.point, 'point', { ogcFid: row.ogcFid })
                    }
                  >
                    <td className="truncate px-2 py-1.5 text-foreground">{row.road}</td>
                    <td className="truncate px-2 py-1.5 text-muted-foreground">{row.jibun}</td>
                    <td className="truncate px-2 py-1.5 text-foreground">
                      {row.customerNo || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : result.customers.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            범위 안 수용가가 없습니다.
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[11px]">
            <thead className="sticky top-0 bg-muted">
              <tr className="border-b border-border">
                <th className="w-[18%] px-2 py-1.5 font-medium text-muted-foreground">수용가</th>
                <th className="px-2 py-1.5 font-medium text-muted-foreground">주소</th>
                <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">연락처</th>
              </tr>
            </thead>
            <tbody>
              {result.customers.map((row) => (
                <tr
                  key={row.id}
                  data-target-row={row.id}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-primary/5',
                    selectedTargetId === row.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                  )}
                  onClick={() =>
                    toggleTargetRow(row.id, row.point, 'customer', {
                      ogcFid: row.ogcFid,
                      meterNo: row.meterNo !== '—' ? row.meterNo : undefined,
                    })
                  }
                >
                  <td className="truncate px-2 py-1.5 text-foreground">{row.name}</td>
                  <td className="truncate px-2 py-1.5 text-muted-foreground">{row.address}</td>
                  <td className="truncate px-2 py-1.5 text-foreground">{row.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="rounded border border-border inline-flex h-7 items-center px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
            onClick={startNew}
          >
            새 분석
          </button>
          {!saved ? (
            <button
              type="button"
              disabled={!result || lockedGates.length === 0 || analyzing}
              className="rounded bg-primary inline-flex h-7 items-center px-2.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
              onClick={saveAnalysisResult}
            >
              분석결과저장
            </button>
          ) : (
            <WtlOutageGeomEdit
              enabled={Boolean(result)}
              result={result}
              onApplyZone={applyEditedZone}
              onNotice={setNotice}
              onMapEditingChange={setGeomMapEditing}
            />
          )}
          {nextStatus && (
            <button
              type="button"
              className="rounded border border-border inline-flex h-7 items-center px-2 text-[11px] font-medium hover:bg-muted"
              onClick={() => {
                persistHistoryPatch(historyId, { status: nextStatus })
                setNotice(`상태를 «${nextStatus}»으로 올렸습니다.`)
              }}
            >
              → {nextStatus}
            </button>
          )}
          <button
            type="button"
            disabled={!result || analyzing}
            className="ml-auto rounded border border-border inline-flex h-7 items-center px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40"
            onClick={() => setHwpxOpen(true)}
            title="단수 알림문(HWPX) 다운로드"
          >
            한글 다운로드
          </button>
          <button
            type="button"
            disabled={!result}
            className="rounded bg-[#d7ebf1] inline-flex h-7 items-center px-2.5 text-[11px] font-semibold text-[#14607a] disabled:opacity-40"
            onClick={() => setSmsOpen(true)}
          >
            문자발송{result ? ` ${smsTargets.length}` : ''}
          </button>
        </div>
      </div>


      {hwpxOpen && result && (
        <WtlOutageHwpxModal
          result={result}
          defaultTitle={currentHistory?.smsTitle ?? '[의성군] 단수 안내'}
          defaultReason={currentHistory?.reason ?? ''}
          defaultStart={currentHistory?.startAt.replace(' ', 'T') ?? ''}
          defaultEnd={currentHistory?.endAt.replace(' ', 'T') ?? ''}
          onClose={() => setHwpxOpen(false)}
          onDone={(fields, info) => {
            persistHistoryPatch(historyId, {
              smsTitle: fields.title,
              reason: fields.reason,
              startAt: fields.startAt.replace('T', ' '),
              endAt: fields.endAt.replace('T', ' '),
            })
            setHwpxOpen(false)
            setNotice(`한글 다운로드 · ${info.fileName}${info.areas ? ` · 대상지역 ${info.areas}` : ''}`)
          }}
        />
      )}
      {smsOpen && result && (
        <WtlOutageSmsModal
          customers={result.customers}
          defaultTitle={currentHistory?.smsTitle ?? '[의성군] 단수 안내'}
          defaultReason={currentHistory?.reason ?? ''}
          defaultStart={currentHistory?.startAt.replace(' ', 'T') ?? ''}
          defaultEnd={currentHistory?.endAt.replace(' ', 'T') ?? ''}
          onClose={() => setSmsOpen(false)}
          onSaveSettings={(payload) => {
            persistHistoryPatch(historyId, {
              ...applySmsFields(payload),
              status: '설정완료',
            })
            setSmsOpen(false)
            setNotice(`설정저장 · 선택 ${payload.count}명`)
          }}
          onSend={(payload) => {
            persistHistoryPatch(historyId, {
              ...applySmsFields(payload),
              status: '문자발송 완료',
            })
            setSmsOpen(false)
            setNotice(`문자발송 완료 · ${payload.count}명`)
          }}
        />
      )}
    </div>
  )
}
