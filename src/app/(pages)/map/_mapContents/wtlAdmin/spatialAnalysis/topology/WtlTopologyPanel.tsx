'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, ListChecks } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { refreshUndergroundFacilityWmsLayers } from '../../../../_mapComponents/layerFactory/undergroundFacilityLayerFactory'
import { refreshServiceWmsLayer } from '../../../../_mapComponents/layerFactory/serviceLayerFactory'
import { getWtlTopoEditApplyMode, wtlTopoEditModeLabel } from './wtlTopologyEditConfig'
import { useWtlTopologyEditTools } from './useWtlTopologyEditTools'
import { useWtlTopoMapPick } from './useWtlTopoMapPick'
import { WtlTopoEditToolbar, type WtlTopoMapTool, type WtlTopoToolbarAction } from './WtlTopoEditToolbar'
import { refreshWtlTopologyBackground, useWtlTopologyMapLayer } from './useWtlTopologyMapLayer'
import { WtlTopoMeetReview } from './WtlTopoMeetReview'
import { WtlTopoRequestModal } from './WtlTopoRequestModal'
import { WtlTopoRequestListPanel } from './WtlTopoRequestListPanel'
import {
  WTL_TOPO_ACTION_LABEL,
  WTL_TOPO_KIND_FILTERS,
  type WtlTopoChangeAction,
  type WtlTopoChangeRequest,
  type WtlTopoIssue,
  type WtlTopoKindFilter,
  type WtlTopoMeetPipeLine,
  type WtlTopoResult,
  WTL_TOPO_ADD_PIPE_KINDS,
  WTL_TOPO_ADD_FACILITY_KINDS,
  type WtlTopoAddPipeKindId,
  type WtlTopoAddFacilityKindId,
  type WtlTopoEditTarget,
  wtlTopoPipeKey,
} from './wtlTopologySample'

type Props = {
  active?: boolean
  /** 지도 왼쪽을 덮는 메뉴·패널 오른쪽 끝(px) — 지도 편집 도구모음 위치용 */
  mapLeftPx?: number
  /** 요청 목록을 그릴 상세 패널 자리 (셸이 목록 오른쪽에 만든다). 없으면 그리지 않는다 */
  detailHost?: HTMLElement | null
  /** 요청 목록 열림 상태를 셸에 알린다 — 셸이 상세 패널을 붙이고 지도 폭을 맞춘다 */
  onDetailOpenChange?: (open: boolean) => void
}

function refreshPipeLayers(map: Parameters<typeof refreshServiceWmsLayer>[0]) {
  refreshUndergroundFacilityWmsLayers(map)
  refreshServiceWmsLayer(map)
  refreshWtlTopologyBackground(map)
  requestAnimationFrame(() => {
    refreshUndergroundFacilityWmsLayers(map)
    refreshServiceWmsLayer(map)
    refreshWtlTopologyBackground(map)
  })
}

/** LineString/MultiLineString GeoJSON의 진행 방향을 뒤집는다 */
function reverseLineGeoJson(geo: object): object {
  const g = geo as { type?: string; coordinates?: unknown }
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    return { ...g, coordinates: [...g.coordinates].reverse() }
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return {
      ...g,
      coordinates: [...(g.coordinates as unknown[][])].reverse().map((part) => [...part].reverse()),
    }
  }
  return geo
}

function nowStamp() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function WtlTopologyPanel({
  active = true,
  mapLeftPx = 0,
  detailHost = null,
  onDetailOpenChange,
}: Props) {
  const mapContext = useMapContext()
  const { data: session } = useSession()
  const applyMode = getWtlTopoEditApplyMode(session?.user?.id)
  const applyLabel = wtlTopoEditModeLabel(applyMode)

  const [result, setResult] = useState<WtlTopoResult | null>(null)
  const [running, setRunning] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<WtlTopoKindFilter>('전체')
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [notice, setNotice] = useState('탭 진입 시 위상검증을 수행합니다.')
  /** 지도 도구모음 모드 (수정·관로·시설·지도에서 고르는 방향 반전) */
  const [editTool, setEditTool] = useState<WtlTopoMapTool>('idle')
  const [draftGeom, setDraftGeom] = useState<object | null>(null)
  /** 도형 수정 대상 — 선택한 오류의 관로·시설, 없으면 지도에서 클릭해 고른다 */
  const [modifyTarget, setModifyTarget] = useState<WtlTopoEditTarget | null>(null)
  const [facilityKind, setFacilityKind] = useState<WtlTopoAddFacilityKindId>('sa200')
  /** 우측 수정·요청 목록 패널 열림 */
  const [historyOpen, setHistoryOpen] = useState(false)
  // 셸에 열림 상태 전달 (탭을 벗어나면 셸이 상세를 숨긴다)
  useEffect(() => {
    onDetailOpenChange?.(historyOpen)
  }, [historyOpen, onDetailOpenChange])
  useEffect(() => () => onDetailOpenChange?.(false), [onDetailOpenChange])
  /** 관로 추가: 종류(테이블·용도코드)와 방향(그린 순서 그대로 / 반대) */
  const [addPipeKind, setAddPipeKind] = useState<WtlTopoAddPipeKindId>('saa004')
  const [addPipeReverse, setAddPipeReverse] = useState(false)
  /** 관로 종류별 실제 레이어 선 색 (용도코드 또는 'wtl_sply_ls' → 색) */
  const [addPipeColors, setAddPipeColors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!active) return
    let cancelled = false
    call('', 'POST', { service: 'wtlTopologyService', action: 'getWtlTopoAddPipeColors', params: {} })
      .then((res) => {
        const body = (res?.data ?? res) as { colors?: Record<string, string> }
        if (!cancelled && body?.colors) setAddPipeColors(body.colors)
      })
      .catch(() => {
        // 색을 못 받으면 기본 편집색으로 그린다
      })
    return () => {
      cancelled = true
    }
  }, [active])
  const addPipeKindDef =
    WTL_TOPO_ADD_PIPE_KINDS.find((k) => k.id === addPipeKind) ?? WTL_TOPO_ADD_PIPE_KINDS[0]
  const addPipeColor = addPipeColors[addPipeKindDef.saaCde ?? addPipeKindDef.table]
  const [requestAction, setRequestAction] = useState<WtlTopoChangeAction | null>(null)
  const [requests, setRequests] = useState<WtlTopoChangeRequest[]>([])
  /** 아직 처리되지 않은 요청(반영요청 후 반영 전, 상태 «요청») 건수 */
  const pendingCount = useMemo(() => requests.filter((r) => r.status === '요청').length, [requests])
  const [busy, setBusy] = useState(false)
  const [meetOpen, setMeetOpen] = useState(false)
  const [meetLoading, setMeetLoading] = useState(false)
  const [meetPipes, setMeetPipes] = useState<WtlTopoMeetPipeLine[]>([])
  const [meetChecked, setMeetChecked] = useState<Set<string>>(() => new Set())
  /** 접합점 검토 목록에서 마우스를 올린 관로 (지도 강조용) */
  const [meetHoverKey, setMeetHoverKey] = useState<string | null>(null)
  const [meetSavePending, setMeetSavePending] = useState(false)
  const runSeqRef = useRef(0)
  const meetLoadSeqRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  const selectIssue = (id: string) => {
    // 이미 선택된 오류를 다시 고르면 진행 중인 편집을 유지한다
    if (id === selectedId) return
    setSelectedId(id)
    setEditTool('idle')
    setDraftGeom(null)
    setModifyTarget(null)
  }

  /** 오류 목록 행 클릭 — 선택된 행을 다시 누르면 선택을 해제한다 (지도에 전체 오류 원이 다시 보임) */
  const toggleIssueRow = (id: string) => {
    if (id !== selectedId) {
      selectIssue(id)
      return
    }
    setSelectedId(null)
    setEditTool('idle')
    setDraftGeom(null)
    setModifyTarget(null)
  }

  const selected = useMemo(
    () => result?.issues.find((i) => i.id === selectedId) ?? null,
    [result, selectedId]
  )

  const filtered = useMemo(() => {
    if (!result) return []
    return result.issues.filter((i) => {
      if (kindFilter !== '전체' && i.kind !== kindFilter) return false
      if (!showHidden && hiddenIds.has(i.id)) return false
      return true
    })
  }, [result, kindFilter, showHidden, hiddenIds])

  const visibleIds = useMemo(() => new Set(filtered.map((i) => i.id)), [filtered])

  const meetHighlight = useMemo(() => {
    if (!meetOpen || meetPipes.length === 0) return null
    // 체크한 관로는 지도에서 바로 뒤집어 보여 준다(미리보기 버튼 없음). 체크 해제 시 원래 방향.
    return {
      pipes: meetPipes,
      checkedKeys: meetChecked,
      preview: true,
      hoverKey: meetHoverKey,
      // 지도에서 관로를 하나씩 고를 때는 고를 때마다 화면이 움직이지 않게 한다
      noFit: editTool === 'flip',
    }
  }, [meetOpen, meetPipes, meetChecked, meetHoverKey, editTool])

  const selectedLine = useMemo(() => {
    if (!selected?.line || selected.line.length < 2) return null
    // 접합점 다중 관로가 떠 있으면 그쪽 화살표를 쓰고, 여기선 샘플 선은 생략
    if (meetHighlight && meetHighlight.pipes.length > 0) return null
    return selected.line
  }, [selected?.line, meetHighlight])

  useWtlTopologyMapLayer({
    active,
    result,
    selectedId,
    visibleIds: result ? visibleIds : null,
    meetHighlight,
    selectedLine,
    onSelectIssue: selectIssue,
    // 그리기·수정 중 지도 클릭이 오류 원을 눌러도 선택이 바뀌어 편집이 꺼지지 않게 한다
    suspendIssueClick: editTool !== 'idle',
  })

  useEffect(() => {
    if (!selectedId || !listRef.current) return
    const row = listRef.current.querySelector(
      `[data-topo-issue="${CSS.escape(selectedId)}"]`
    )
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  useWtlTopologyEditTools({
    active: active && editTool !== 'idle' && editTool !== 'flip',
    tool: editTool === 'flip' ? 'idle' : editTool,
    reverseLine: editTool === 'draw_line' && addPipeReverse,
    // 관로 추가 중에는 고른 종류의 실제 레이어 색으로 그린다
    lineColor: editTool === 'draw_line' ? addPipeColor : undefined,
    target: modifyTarget,
    onDraftChange: setDraftGeom,
  })

  /** 지도 클릭으로 대상 고르기 — 수정 대상이 없을 때, 또는 방향 반전 모드 */
  const onMapPick = (t: WtlTopoEditTarget | null) => {
    if (editTool === 'flip') {
      // 미스(빈 곳)는 속성조회와 공존 — 안내만 내지 않음
      if (!t || t.geomKind !== 'line' || !t.line || t.line.length < 2) {
        return
      }
      const key = wtlTopoPipeKey(t.table, t.ogcFid)
      setMeetOpen(true)
      if (meetPipes.some((p) => wtlTopoPipeKey(p.table, p.ogcFid) === key)) {
        // 이미 고른 관로를 다시 클릭하면 목록에서 뺀다
        setMeetPipes((prev) => prev.filter((p) => wtlTopoPipeKey(p.table, p.ogcFid) !== key))
        setMeetChecked((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
        setNotice(`${t.label} 선택을 해제했습니다.`)
        return
      }
      setMeetPipes((prev) => [
        ...prev,
        { table: t.table, ogcFid: t.ogcFid, line: t.line!, color: t.color, recommended: false },
      ])
      setMeetChecked((prev) => new Set(prev).add(key))
      setNotice(`${t.label} 선택 · 지도에 반전된 방향으로 보입니다.`)
      return
    }
    if (editTool === 'modify' && !modifyTarget) {
      // 미스(빈 곳)는 속성조회와 공존 — 안내만 내지 않음
      if (!t) return
      setModifyTarget(t)
      setNotice(`${t.label} · 꼭짓점(시설은 위치)을 끌어 수정한 뒤 저장하세요.`)
    }
  }
  useWtlTopoMapPick({
    active: active && (editTool === 'flip' || (editTool === 'modify' && !modifyTarget)),
    pipesOnly: editTool === 'flip',
    onPick: onMapPick,
  })

  /** 기록·요청에 남길 대상 — 선택한 오류가 없으면 지도 편집 대상으로 */
  const actionIssue: WtlTopoIssue = selected ?? {
    id: 'map-edit',
    kind: '유수방향 확인필요',
    code: 'flow_reverse',
    target:
      editTool === 'modify' && modifyTarget
        ? modifyTarget.label
        : editTool === 'flip'
          ? '지도에서 고른 관로'
          : editTool === 'draw_line'
            ? '관로 추가'
            : editTool === 'draw_point'
              ? '시설 추가'
              : '지도 편집',
    detail: '',
    point: [0, 0],
  }

  const runAnalyze = async () => {
    const seq = ++runSeqRef.current
    setRunning(true)
    setSelectedId(null)
    setEditTool('idle')
    setDraftGeom(null)
    setModifyTarget(null)
    resetMeetReview()
    setNotice('위상검증을 수행하는 중…')
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'analyzeWtlTopology',
        params: {},
      })
      if (seq !== runSeqRef.current) return
      const body = (res?.data ?? res) as {
        result?: WtlTopoResult | null
        error?: string
      }
      if (body.error || !body.result) {
        setResult(null)
        setNotice(body.error || '위상검증에 실패했습니다.')
        return
      }
      setResult(body.result)
      const c = body.result.counts
      setNotice(
        `완료 ${body.result.at} · 전체 ${c.total} · 접합 ${c.orphan} · 양방향만남 ${c.flowMeet} · 역방향 ${c.flowReverse} · ${applyLabel}`
      )
    } catch {
      if (seq !== runSeqRef.current) return
      setResult(null)
      setNotice('위상검증 요청에 실패했습니다.')
    } finally {
      if (seq === runSeqRef.current) setRunning(false)
    }
  }

  useEffect(() => {
    if (!active) return
    void runAnalyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 탭 진입 시 1회
  }, [active])

  const resetMeetReview = () => {
    setMeetOpen(false)
    setMeetLoading(false)
    setMeetPipes([])
    setMeetChecked(new Set())
    setMeetHoverKey(null)
    setMeetSavePending(false)
  }

  const loadMeetPipes = async (issue: WtlTopoIssue) => {
    const related =
      issue.relatedPipes && issue.relatedPipes.length > 0
        ? issue.relatedPipes
        : issue.table && issue.ogcFid != null
          ? [{ table: issue.table, ogcFid: issue.ogcFid, recommended: true }]
          : []
    const seq = ++meetLoadSeqRef.current
    setMeetOpen(true)
    setMeetLoading(true)
    setMeetPipes([])
    const initial = new Set<string>()
    for (const p of related) {
      if (p.recommended || issue.code === 'flow_reverse') {
        initial.add(wtlTopoPipeKey(p.table, p.ogcFid))
      }
    }
    setMeetChecked(initial)
    if (related.length === 0) {
      if (seq === meetLoadSeqRef.current) {
        setMeetLoading(false)
        setNotice('접합점 유입 관로 정보가 없습니다.')
      }
      return
    }
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'loadWtlTopoPipeLines',
        params: { pipes: related },
      })
      if (seq !== meetLoadSeqRef.current) return
      const body = (res?.data ?? res) as {
        pipes?: {
          table: string
          ogcFid: number
          ftrIdn?: string | null
          line: [number, number][]
          color?: string
        }[]
        error?: string
      }
      const lines = body.pipes ?? []
      const recommended = new Set(
        related.filter((p) => p.recommended).map((p) => wtlTopoPipeKey(p.table, p.ogcFid))
      )
      setMeetPipes(
        lines.map((p) => ({
          ...p,
          recommended: recommended.has(wtlTopoPipeKey(p.table, p.ogcFid)),
        }))
      )
      if (lines.length === 0) setNotice(body.error || '관로 도형을 불러오지 못했습니다.')
      else if (issue.code === 'flow_reverse') {
        setNotice('관로 1개 · 체크하면 지도에 반전된 방향이 보입니다. 확인 후 저장하세요.')
      } else setNotice(`접합점 관로 ${lines.length}개 · 반전할 관로를 체크하면 지도에 바로 보입니다. 확인 후 저장`)
    } catch {
      if (seq !== meetLoadSeqRef.current) return
      setMeetPipes([])
      setNotice('접합점 관로 조회에 실패했습니다.')
    } finally {
      if (seq === meetLoadSeqRef.current) setMeetLoading(false)
    }
  }

  useEffect(() => {
    // 지도에서 관로를 고르는 중에는 검토 목록을 그쪽이 쓴다
    if (editTool === 'flip') return
    if (!selected || (selected.code !== 'flow_meet' && selected.code !== 'flow_reverse')) {
      resetMeetReview()
      return
    }
    void loadMeetPipes(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 선택 이슈 변경 시
  }, [selected?.id, selected?.code])

  const pushRequest = (
    action: WtlTopoChangeAction,
    issue: WtlTopoIssue,
    memo: string,
    files: WtlTopoChangeRequest['files'],
    status: WtlTopoChangeRequest['status'],
    message?: string
  ) => {
    const row: WtlTopoChangeRequest = {
      id: `req-${Date.now()}`,
      at: nowStamp(),
      action,
      actionLabel: WTL_TOPO_ACTION_LABEL[action],
      issueId: issue.id,
      issueTarget: issue.target,
      memo,
      files,
      applyMode: applyMode,
      status,
      message,
    }
    setRequests((prev) => [row, ...prev])
    setHistoryOpen(true)
  }

  const hideIssue = (id: string) => {
    // 오류 없이 지도에서 편집한 경우(map-edit)는 숨길 오류가 없다
    if (id === 'map-edit') return
    setHiddenIds((prev) => new Set(prev).add(id))
    if (selectedId === id) setSelectedId(null)
    setNotice('항목을 숨겼습니다. «숨김 포함»으로 다시 볼 수 있습니다.')
  }

  const unhideIssue = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const openRequest = (action: WtlTopoChangeAction) => {
    setRequestAction(action)
  }

  const doReverseImmediate = async (issue: WtlTopoIssue, memo: string, files: WtlTopoChangeRequest['files']) => {
    if (!issue.table || issue.ogcFid == null) {
      pushRequest('flow_reverse', issue, memo, files, '실패', '관로 정보가 없습니다.')
      setNotice('반전할 관로 정보가 없습니다.')
      return
    }
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'reverseWtlTopoPipe',
        params: { table: issue.table, ogcFid: issue.ogcFid },
      })
      const body = (res?.data ?? res) as { ok?: boolean; error?: string }
      if (!body.ok) {
        pushRequest('flow_reverse', issue, memo, files, '실패', body.error)
        setNotice(body.error || '유수방향 반전에 실패했습니다.')
        return
      }
      pushRequest('flow_reverse', issue, memo, files, '즉시반영')
      setNotice(`유수방향 반전 완료 · ${issue.target}`)
      refreshPipeLayers(mapContext?.mapInstanceRef?.current)
      hideIssue(issue.id)
      void runAnalyze()
    } catch {
      pushRequest('flow_reverse', issue, memo, files, '실패', '요청 실패')
      setNotice('유수방향 반전 요청에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const doMeetReverseImmediate = async (
    issue: WtlTopoIssue,
    memo: string,
    files: WtlTopoChangeRequest['files']
  ) => {
    const pipes = meetPipes
      .filter((p) => meetChecked.has(wtlTopoPipeKey(p.table, p.ogcFid)))
      .map((p) => ({ table: p.table, ogcFid: p.ogcFid }))
    if (pipes.length === 0) {
      setNotice('반전할 관로를 선택하세요.')
      return
    }
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'reverseWtlTopoPipes',
        params: { pipes },
      })
      const body = (res?.data ?? res) as { ok?: boolean; reversed?: number; error?: string }
      if (!body.ok) {
        pushRequest('flow_reverse', issue, memo, files, '실패', body.error)
        setNotice(body.error || '선택 관로 반전에 실패했습니다.')
        return
      }
      pushRequest(
        'flow_reverse',
        issue,
        memo,
        files,
        '즉시반영',
        `${body.reversed ?? pipes.length}건 반전`
      )
      setNotice(`접합점 관로 ${body.reversed ?? pipes.length}건 반전 완료 · ${issue.target}`)
      refreshPipeLayers(mapContext?.mapInstanceRef?.current)
      resetMeetReview()
      hideIssue(issue.id)
      void runAnalyze()
    } catch {
      pushRequest('flow_reverse', issue, memo, files, '실패', '요청 실패')
      setNotice('선택 관로 반전 요청에 실패했습니다.')
    } finally {
      setBusy(false)
      setMeetSavePending(false)
    }
  }

  const doGeomSaveImmediate = async (
    issue: WtlTopoIssue,
    memo: string,
    files: WtlTopoChangeRequest['files']
  ) => {
    const target = modifyTarget
    if (!draftGeom || !target) {
      setNotice('지도에서 도형을 수정한 뒤 저장하세요.')
      return
    }
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'updateWtlTopoGeom',
        params: { table: target.table, ogcFid: target.ogcFid, geojson: draftGeom },
      })
      const body = (res?.data ?? res) as { ok?: boolean; error?: string }
      if (!body.ok) {
        pushRequest('geom_edit', issue, memo, files, '실패', body.error)
        setNotice(body.error || '도형 수정에 실패했습니다.')
        return
      }
      pushRequest('geom_edit', issue, memo, files, '즉시반영', target.label)
      setEditTool('idle')
      setDraftGeom(null)
      setModifyTarget(null)
      setNotice(`도형 수정 완료 · ${target.label}`)
      refreshPipeLayers(mapContext?.mapInstanceRef?.current)
      void runAnalyze()
    } catch {
      pushRequest('geom_edit', issue, memo, files, '실패')
      setNotice('도형 수정 요청에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const doAddImmediate = async (
    issue: WtlTopoIssue,
    memo: string,
    files: WtlTopoChangeRequest['files'],
    table: string,
    saaCde?: string,
    ftrCde?: string
  ) => {
    if (!draftGeom) {
      setNotice('지도에 관로 또는 시설을 그린 뒤 저장하세요.')
      return
    }
    // 관로는 선택한 방향으로 저장한다 (반대 방향이면 좌표 순서를 뒤집음)
    const geojson =
      editTool === 'draw_line' && addPipeReverse ? reverseLineGeoJson(draftGeom) : draftGeom
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'insertWtlTopoFeature',
        params: { table, geojson, saaCde, ftrCde },
      })
      const body = (res?.data ?? res) as { ok?: boolean; error?: string; ogcFid?: number }
      if (!body.ok) {
        pushRequest('feature_add', issue, memo, files, '실패', body.error)
        setNotice(body.error || '추가에 실패했습니다. 반영요청으로 남겨 주세요.')
        return
      }
      pushRequest('feature_add', issue, memo, files, '즉시반영', `ogc_fid=${body.ogcFid}`)
      setEditTool('idle')
      setDraftGeom(null)
      setNotice(`추가 완료 · ${table} #${body.ogcFid}`)
      refreshPipeLayers(mapContext?.mapInstanceRef?.current)
      void runAnalyze()
    } catch {
      pushRequest('feature_add', issue, memo, files, '실패')
      setNotice('추가 요청에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const handleRequestSubmit = async (payload: {
    memo: string
    files: WtlTopoChangeRequest['files']
  }) => {
    if (!requestAction) return
    const action = requestAction
    const issue = actionIssue
    setRequestAction(null)

    if (applyMode === 'request' || action === 'data_request') {
      const addKind = WTL_TOPO_ADD_PIPE_KINDS.find((k) => k.id === addPipeKind)
      const facKind = WTL_TOPO_ADD_FACILITY_KINDS.find((k) => k.id === facilityKind)
      const meetNote =
        meetSavePending && meetChecked.size > 0
          ? `선택 ${meetChecked.size}건: ${[...meetChecked].join(', ')}`
          : action === 'feature_add' && editTool === 'draw_line' && addKind
            ? `관로 종류 ${addKind.label} · 방향 ${addPipeReverse ? '그린 순서의 반대' : '그린 순서'}`
            : action === 'feature_add' && editTool === 'draw_point' && facKind
              ? `시설 종류 ${facKind.label}`
              : action === 'geom_edit' && modifyTarget
                ? modifyTarget.label
                : undefined
      pushRequest(action, issue, payload.memo, payload.files, '요청', meetNote)
      setNotice(`${WTL_TOPO_ACTION_LABEL[action]} 요청을 등록했습니다.`)
      setMeetSavePending(false)
      if (editTool === 'flip') resetMeetReview()
      setEditTool('idle')
      setDraftGeom(null)
      setModifyTarget(null)
      return
    }

    // immediate
    if (action === 'flow_reverse') {
      if (meetSavePending) {
        await doMeetReverseImmediate(issue, payload.memo, payload.files)
        return
      }
      await doReverseImmediate(issue, payload.memo, payload.files)
      return
    }
    if (action === 'geom_edit') {
      await doGeomSaveImmediate(issue, payload.memo, payload.files)
      return
    }
    if (action === 'feature_add') {
      if (editTool === 'draw_line') {
        const kind =
          WTL_TOPO_ADD_PIPE_KINDS.find((k) => k.id === addPipeKind) ?? WTL_TOPO_ADD_PIPE_KINDS[0]
        await doAddImmediate(issue, payload.memo, payload.files, kind.table, kind.saaCde)
        return
      }
      const fac =
        WTL_TOPO_ADD_FACILITY_KINDS.find((k) => k.id === facilityKind) ?? WTL_TOPO_ADD_FACILITY_KINDS[0]
      await doAddImmediate(issue, payload.memo, payload.files, fac.table, undefined, fac.ftrCde)
      return
    }
  }

  const cancelEdit = (msg = '편집을 취소했습니다.') => {
    if (editTool === 'flip') resetMeetReview()
    setEditTool('idle')
    setDraftGeom(null)
    setModifyTarget(null)
    setNotice(msg)
  }

  const startModify = () => {
    setEditTool('modify')
    setDraftGeom(null)
    // 선택한 오류에 관로·시설이 있으면 그것을, 없으면 지도에서 클릭해 고른다
    if (selected?.table && selected.ogcFid != null) {
      const target: WtlTopoEditTarget = {
        table: selected.table,
        ogcFid: selected.ogcFid,
        label: selected.target,
        geomKind: selected.line && selected.line.length >= 2 ? 'line' : 'point',
        line: selected.line,
        point: selected.point,
      }
      setModifyTarget(target)
      setNotice(`${target.label} · 꼭짓점(시설은 위치)을 끌어 수정한 뒤 저장하세요.`)
    } else {
      setModifyTarget(null)
      setNotice('지도에서 수정할 관로·시설을 클릭하세요.')
    }
  }

  const startAdd = (kind: 'draw_line' | 'draw_point') => {
    setEditTool(kind)
    setDraftGeom(null)
    setModifyTarget(null)
    if (kind === 'draw_line') setAddPipeReverse(false)
    setNotice(
      kind === 'draw_line'
        ? '관로 종류를 고르고 지도에 그린 뒤(더블클릭으로 끝), 화살표로 방향을 확인하고 저장하세요.'
        : '시설 종류를 고르고 지도에 위치를 찍은 뒤 저장하세요.'
    )
  }

  const startFlipPick = () => {
    // 오류 선택과 섞이지 않게 선택을 풀고, 검토 목록을 지도 선택용으로 비운다
    setSelectedId(null)
    resetMeetReview()
    setEditTool('flip')
    setDraftGeom(null)
    setModifyTarget(null)
    setMeetOpen(true)
    setNotice('반전할 관로를 지도에서 클릭하세요. 다시 클릭하면 선택이 풀립니다.')
  }

  const onToolbarAction = (action: WtlTopoToolbarAction) => {
    switch (action) {
      case 'modify':
        if (editTool === 'modify') cancelEdit()
        else startModify()
        return
      case 'draw_line':
      case 'draw_point':
        if (editTool === action) cancelEdit()
        else startAdd(action)
        return
      case 'flip':
        if (editTool === 'flip') cancelEdit()
        else startFlipPick()
        return
      case 'request':
        openRequest('data_request')
        return
      case 'reverse_dir':
        setAddPipeReverse((v) => !v)
        return
      case 'repick':
        // 고친 내용은 버리고 지도에서 다른 대상을 고른다
        setModifyTarget(null)
        setDraftGeom(null)
        setNotice('지도에서 수정할 관로·시설을 클릭하세요.')
        return
      case 'save':
        if (editTool === 'flip') openMeetSave()
        else if (editTool === 'modify') openRequest('geom_edit')
        else if (editTool === 'draw_line' || editTool === 'draw_point') openRequest('feature_add')
        return
      case 'cancel':
        cancelEdit()
        return
    }
  }

  const canReverse =
    Boolean(selected) &&
    !busy &&
    (selected?.code === 'flow_reverse' ||
      selected?.code === 'flow_meet' ||
      selected?.geomKind === 'line')

  const openReverseOrMeet = () => {
    if (!selected) return
    if (selected.code === 'flow_meet' || selected.code === 'flow_reverse') {
      void loadMeetPipes(selected)
      return
    }
    openRequest('flow_reverse')
  }

  const openMeetSave = () => {
    if (meetChecked.size === 0) {
      setNotice('반전할 관로를 선택하세요.')
      return
    }
    setMeetSavePending(true)
    openRequest('flow_reverse')
  }
  const canSave =
    !busy &&
    (editTool === 'flip'
      ? meetChecked.size > 0
      : editTool === 'modify'
        ? Boolean(modifyTarget) && (applyMode !== 'immediate' || Boolean(draftGeom))
        : applyMode !== 'immediate' || Boolean(draftGeom))

  const toolbarStatus =
    editTool === 'modify'
      ? modifyTarget
        ? `${modifyTarget.label} · 끌어서 수정`
        : '지도에서 수정할 관로·시설을 클릭하세요'
      : editTool === 'draw_line'
        ? draftGeom
          ? '화살표로 방향을 확인한 뒤 저장하세요'
          : '지도에 관로를 그리세요 (더블클릭으로 끝)'
        : editTool === 'draw_point'
          ? draftGeom
            ? '위치를 확인한 뒤 저장하세요'
            : '지도에 시설 위치를 찍으세요'
          : editTool === 'flip'
            ? meetChecked.size > 0
              ? `${meetChecked.size}개 선택 · 다시 클릭하면 해제`
              : '반전할 관로를 지도에서 클릭하세요'
            : ''

  const toolBtn = (active: boolean) =>
    cn(
      'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors',
      'disabled:pointer-events-none disabled:opacity-35',
      active
        ? 'bg-primary text-primary-foreground shadow-sm'
        : 'bg-transparent text-foreground hover:bg-muted'
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1">
            {WTL_TOPO_KIND_FILTERS.map((name) => {
              const count =
                name === '전체'
                  ? result?.counts.total ?? 0
                  : name === '접합확인필요'
                    ? result?.counts.orphan ?? 0
                    : (result?.counts.flowMeet ?? 0) + (result?.counts.flowReverse ?? 0)
              return (
                <button
                  key={name}
                  type="button"
                  className={cn(
                    'h-7 min-w-0 flex-1 truncate rounded-md px-1 text-[11px] font-medium transition-colors',
                    kindFilter === name
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  onClick={() => setKindFilter(name)}
                >
                  {name}
                  {result ? ` ${count}` : ''}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <label className="inline-flex items-center gap-1.5 text-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-border"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              숨김 포함
              {hiddenIds.size > 0 && <span className="tabular-nums">({hiddenIds.size})</span>}
            </label>
            <span className="ml-auto tabular-nums">{applyLabel}</span>
            {running && <span>검증 중…</span>}
          </div>
          {notice && <p className="truncate text-[10px] text-muted-foreground">{notice}</p>}
        </div>

        {/* 오류 기반 반전 · 요청 목록 (편집 도구는 지도 위 도구모음) */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="flex gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              disabled={!canReverse}
              className={toolBtn(
                meetOpen &&
                  editTool !== 'flip' &&
                  (selected?.code === 'flow_meet' || selected?.code === 'flow_reverse')
              )}
              onClick={() => openReverseOrMeet()}
              title={
                selected?.code === 'flow_meet' || selected?.code === 'flow_reverse'
                  ? '관로 선택·반전'
                  : `유수방향 반전 · ${applyLabel}`
              }
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              <span>반전</span>
            </button>
            <button
              type="button"
              aria-expanded={historyOpen}
              className={toolBtn(historyOpen)}
              onClick={() => setHistoryOpen((v) => !v)}
              title={
                pendingCount > 0
                  ? `수정·요청 목록 열기/닫기 · 미처리 요청 ${pendingCount}건`
                  : '수정·요청 목록 열기/닫기'
              }
              aria-label={`요청 목록, 미처리 ${pendingCount}건`}
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              {/* 미처리(반영요청 후 아직 반영 안 됨) 건수 — 있으면 강조 */}
              <span>
                요청 목록(
                <span className={cn('tabular-nums', pendingCount > 0 && !historyOpen && 'font-bold text-amber-700')}>
                  {pendingCount}
                </span>
                )
              </span>
            </button>
          </div>

          <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
            {selected ? (
              <>
                선택 · <span className="font-medium text-foreground">{selected.target}</span>
                {selected.code === 'flow_meet' || selected.code === 'flow_reverse'
                  ? ' · 아래에서 반전할 관로를 체크해 방향을 확인하세요'
                  : null}
              </>
            ) : (
              '목록에서 오류를 선택하세요 · 수정·추가는 지도 위 도구모음에서 할 수 있습니다'
            )}
          </p>
        </div>

        {meetOpen &&
          (editTool === 'flip' ||
            selected?.code === 'flow_meet' ||
            selected?.code === 'flow_reverse') && (
          <WtlTopoMeetReview
            heading={
              editTool === 'flip'
                ? '지도에서 고른 관로'
                : selected?.code === 'flow_reverse'
                  ? '유수방향 검토'
                  : '접합점 검토'
            }
            countLabel={
              editTool === 'flip' || selected?.code === 'flow_reverse'
                ? `관로 ${meetPipes.length}개`
                : undefined
            }
            subtypeLabel={
              editTool === 'flip'
                ? undefined
                : selected?.meetSubtypeLabel ??
                  (selected?.code === 'flow_reverse' ? '역방향' : undefined)
            }
            emptyText={
              editTool === 'flip' ? '지도에서 반전할 관로를 클릭하세요.' : undefined
            }
            pipes={meetPipes}
            checkedKeys={meetChecked}
            loading={meetLoading}
            busy={busy}
            applyLabel={applyLabel}
            hoverKey={meetHoverKey}
            onHover={setMeetHoverKey}
            onToggle={(key) => {
              setMeetChecked((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }}
            onSave={openMeetSave}
            onCancel={() => {
              if (editTool === 'flip') {
                cancelEdit('지도에서 고른 관로 반전을 취소했습니다.')
                return
              }
              resetMeetReview()
              setNotice('접합점 검토를 닫았습니다.')
            }}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">오류 목록</span>
            <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
              {filtered.length}
            </span>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
            {running && !result ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                위상검증을 수행하는 중…
              </p>
            ) : !result ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                검증 결과가 없습니다.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                표시할 오류가 없습니다.
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b border-border">
                    <th className="w-[24%] px-2 py-1 font-medium text-muted-foreground">구분</th>
                    <th className="w-[26%] px-2 py-1 font-medium text-muted-foreground">대상</th>
                    <th className="px-2 py-1 font-medium text-muted-foreground">내용</th>
                    <th className="w-[14%] px-1 py-1 font-medium text-muted-foreground"> </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const hidden = hiddenIds.has(row.id)
                    return (
                      <tr
                        key={row.id}
                        data-topo-issue={row.id}
                        className={cn(
                          'cursor-pointer border-b border-border hover:bg-primary/5',
                          selectedId === row.id &&
                            'bg-primary/[0.12] ring-1 ring-inset ring-primary/25',
                          hidden && 'opacity-60'
                        )}
                        onClick={() => toggleIssueRow(row.id)}
                      >
                        <td
                          className={cn(
                            'truncate px-2 py-1.5 font-medium',
                            row.kind === '접합확인필요' ? 'text-rose-700' : 'text-orange-700'
                          )}
                          title={
                            row.meetSubtypeLabel
                              ? `${row.kind} · ${row.meetSubtypeLabel}`
                              : row.code === 'flow_reverse'
                                ? `${row.kind} · 역방향`
                                : row.kind
                          }
                        >
                          {row.kind}
                        </td>
                        <td className="truncate px-2 py-1.5 text-foreground" title={row.target}>
                          {row.target}
                        </td>
                        <td className="truncate px-2 py-1.5 text-muted-foreground" title={row.detail}>
                          {row.detail}
                        </td>
                        <td className="px-1 py-1.5">
                          <button
                            type="button"
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (hidden) unhideIssue(row.id)
                              else hideIssue(row.id)
                            }}
                          >
                            {hidden ? '해제' : '숨김'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>

      {active &&
        historyOpen &&
        detailHost &&
        createPortal(
        <WtlTopoRequestListPanel
          requests={requests}
          hasIssue={(id) => Boolean(result?.issues.some((i) => i.id === id))}
          onSelectIssue={(id) => {
            setHiddenIds((prev) => {
              if (!prev.has(id)) return prev
              const next = new Set(prev)
              next.delete(id)
              return next
            })
            selectIssue(id)
          }}
          onClose={() => setHistoryOpen(false)}
        />,
          detailHost
        )}

      <WtlTopoEditToolbar
        active={active}
        mapLeftPx={mapLeftPx}
        tool={editTool}
        busy={busy}
        canSave={canSave}
        status={toolbarStatus}
        saveLabel={applyMode === 'immediate' ? '저장' : '요청'}
        pipeKind={addPipeKind}
        pipeColor={addPipeColor}
        pipeReverse={addPipeReverse}
        hasDraft={Boolean(draftGeom)}
        facilityKind={facilityKind}
        modifyTargetLabel={modifyTarget?.label ?? null}
        flipCount={meetChecked.size}
        onAction={onToolbarAction}
        onPipeKind={setAddPipeKind}
        onFacilityKind={setFacilityKind}
      />

      {requestAction && (
        <WtlTopoRequestModal
          action={requestAction}
          issueTarget={actionIssue.target}
          applyModeLabel={applyLabel}
          onClose={() => setRequestAction(null)}
          onSubmit={(payload) => {
            void handleRequestSubmit(payload)
          }}
        />
      )}
    </div>
  )
}
