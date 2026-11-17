'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  FilePenLine,
  MapPinPlus,
  Pencil,
  Waypoints,
} from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { getWtlTopoEditApplyMode, wtlTopoEditModeLabel } from './wtlTopologyEditConfig'
import { useWtlTopologyEditTools, type WtlTopoEditTool } from './useWtlTopologyEditTools'
import { useWtlTopologyMapLayer } from './useWtlTopologyMapLayer'
import { WtlTopoRequestModal } from './WtlTopoRequestModal'
import {
  WTL_TOPO_ACTION_LABEL,
  WTL_TOPO_KIND_FILTERS,
  type WtlTopoChangeAction,
  type WtlTopoChangeRequest,
  type WtlTopoIssue,
  type WtlTopoKindFilter,
  type WtlTopoResult,
} from './wtlTopologySample'

type Props = {
  active?: boolean
}

function nowStamp() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function WtlTopologyPanel({ active = true }: Props) {
  const applyMode = getWtlTopoEditApplyMode()
  const applyLabel = wtlTopoEditModeLabel(applyMode)

  const [result, setResult] = useState<WtlTopoResult | null>(null)
  const [running, setRunning] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<WtlTopoKindFilter>('전체')
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [notice, setNotice] = useState('탭 진입 시 위상검증을 수행합니다.')
  const [editTool, setEditTool] = useState<WtlTopoEditTool>('idle')
  const [draftGeom, setDraftGeom] = useState<object | null>(null)
  const [requestAction, setRequestAction] = useState<WtlTopoChangeAction | null>(null)
  const [requests, setRequests] = useState<WtlTopoChangeRequest[]>([])
  const [busy, setBusy] = useState(false)
  const runSeqRef = useRef(0)

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

  useWtlTopologyMapLayer({
    active,
    result,
    selectedId,
    visibleIds: result ? visibleIds : null,
  })

  useWtlTopologyEditTools({
    active: active && editTool !== 'idle',
    tool: editTool,
    issue: selected,
    onDraftChange: setDraftGeom,
  })

  const runAnalyze = async () => {
    const seq = ++runSeqRef.current
    setRunning(true)
    setSelectedId(null)
    setEditTool('idle')
    setDraftGeom(null)
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
      const firstVisible = body.result.issues.find((i) => showHidden || !hiddenIds.has(i.id))
      if (firstVisible) setSelectedId(firstVisible.id)
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
  }

  const hideIssue = (id: string) => {
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
    if (!selected) return
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
      hideIssue(issue.id)
      void runAnalyze()
    } catch {
      pushRequest('flow_reverse', issue, memo, files, '실패', '요청 실패')
      setNotice('유수방향 반전 요청에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const doGeomSaveImmediate = async (
    issue: WtlTopoIssue,
    memo: string,
    files: WtlTopoChangeRequest['files']
  ) => {
    if (!draftGeom || !issue.table || issue.ogcFid == null) {
      setNotice('지도에서 도형을 수정한 뒤 저장하세요.')
      return
    }
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'updateWtlTopoGeom',
        params: { table: issue.table, ogcFid: issue.ogcFid, geojson: draftGeom },
      })
      const body = (res?.data ?? res) as { ok?: boolean; error?: string }
      if (!body.ok) {
        pushRequest('geom_edit', issue, memo, files, '실패', body.error)
        setNotice(body.error || '도형 수정에 실패했습니다.')
        return
      }
      pushRequest('geom_edit', issue, memo, files, '즉시반영')
      setEditTool('idle')
      setDraftGeom(null)
      setNotice(`도형 수정 완료 · ${issue.target}`)
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
    table: string
  ) => {
    if (!draftGeom) {
      setNotice('지도에 관로 또는 시설을 그린 뒤 저장하세요.')
      return
    }
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'insertWtlTopoFeature',
        params: { table, geojson: draftGeom },
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
    if (!selected || !requestAction) return
    const action = requestAction
    setRequestAction(null)

    if (applyMode === 'request' || action === 'data_request') {
      pushRequest(action, selected, payload.memo, payload.files, '요청')
      setNotice(`${WTL_TOPO_ACTION_LABEL[action]} 요청을 등록했습니다.`)
      if (action === 'flow_reverse' || action === 'data_request') {
        // 요청만 남기고 목록에서 숨길지 여부는 사용자 선택 — 숨기지 않음
      }
      setEditTool('idle')
      return
    }

    // immediate
    if (action === 'flow_reverse') {
      await doReverseImmediate(selected, payload.memo, payload.files)
      return
    }
    if (action === 'geom_edit') {
      await doGeomSaveImmediate(selected, payload.memo, payload.files)
      return
    }
    if (action === 'feature_add') {
      const table =
        editTool === 'draw_line'
          ? 'wtl_pipe_lm'
          : selected.table && !['wtl_pipe_lm', 'wtl_sply_ls'].includes(selected.table)
            ? selected.table
            : 'wtl_valv_ps'
      await doAddImmediate(selected, payload.memo, payload.files, table)
      return
    }
  }

  const startGeomEdit = () => {
    if (!selected) return
    setEditTool('modify')
    setNotice('지도에서 도형을 수정한 뒤 «저장»을 누르세요.')
  }

  const startAdd = (kind: 'draw_line' | 'draw_point') => {
    if (!selected) return
    setEditTool(kind)
    setNotice(
      kind === 'draw_line'
        ? '지도에 관로를 그린 뒤 «저장»을 누르세요.'
        : '지도에 시설 위치를 찍은 뒤 «저장»을 누르세요.'
    )
  }

  const canReverse =
    Boolean(selected) &&
    !busy &&
    (selected?.code === 'flow_reverse' || selected?.geomKind === 'line')
  const canGeomEdit = Boolean(selected?.table) && !busy
  const editing = editTool !== 'idle'
  const canSave =
    !busy &&
    !(
      applyMode === 'immediate' &&
      !draftGeom &&
      (editTool === 'modify' || editTool === 'draw_line' || editTool === 'draw_point')
    )
  const editLabel =
    editTool === 'modify' ? '도형 수정' : editTool === 'draw_line' ? '관로 추가' : '시설 추가'

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

        {/* 도구 툴바 */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="flex gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              disabled={!canReverse}
              className={toolBtn(false)}
              onClick={() => openRequest('flow_reverse')}
              title={`유수방향 반전 · ${applyLabel}`}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              <span>반전</span>
            </button>
            <button
              type="button"
              disabled={!canGeomEdit}
              className={toolBtn(editTool === 'modify')}
              onClick={() => startGeomEdit()}
              title="도형 수정"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              <span>수정</span>
            </button>
            <button
              type="button"
              disabled={!selected || busy}
              className={toolBtn(editTool === 'draw_line')}
              onClick={() => startAdd('draw_line')}
              title="관로 추가"
            >
              <Waypoints className="h-4 w-4" aria-hidden />
              <span>관로</span>
            </button>
            <button
              type="button"
              disabled={!selected || busy}
              className={toolBtn(editTool === 'draw_point')}
              onClick={() => startAdd('draw_point')}
              title="시설 추가"
            >
              <MapPinPlus className="h-4 w-4" aria-hidden />
              <span>시설</span>
            </button>
            <button
              type="button"
              disabled={!selected || busy}
              className={toolBtn(false)}
              onClick={() => openRequest('data_request')}
              title="데이터 수정요청"
            >
              <FilePenLine className="h-4 w-4" aria-hidden />
              <span>요청</span>
            </button>
          </div>

          {editing && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2">
              <p className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                <span className="font-semibold text-primary">편집 중</span>
                <span className="text-muted-foreground"> · {editLabel}</span>
              </p>
              <button
                type="button"
                disabled={!canSave}
                className="h-8 shrink-0 rounded-md bg-primary px-3.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
                onClick={() => {
                  if (editTool === 'modify') openRequest('geom_edit')
                  else openRequest('feature_add')
                }}
              >
                저장
              </button>
              <button
                type="button"
                className="h-8 shrink-0 rounded-md border border-border bg-background px-3.5 text-[11px] font-medium text-foreground hover:bg-muted"
                onClick={() => {
                  setEditTool('idle')
                  setDraftGeom(null)
                  setNotice('도형 편집을 취소했습니다.')
                }}
              >
                취소
              </button>
            </div>
          )}

          {!editing && (
            <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
              {selected ? (
                <>
                  선택 · <span className="font-medium text-foreground">{selected.target}</span>
                </>
              ) : (
                '목록에서 오류를 선택하세요'
              )}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">오류 목록</span>
            <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
              {filtered.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
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
                        className={cn(
                          'cursor-pointer border-b border-border hover:bg-primary/5',
                          selectedId === row.id &&
                            'bg-primary/[0.12] ring-1 ring-inset ring-primary/25',
                          hidden && 'opacity-60'
                        )}
                        onClick={() => {
                          setSelectedId(row.id)
                          setEditTool('idle')
                        }}
                      >
                        <td
                          className={cn(
                            'truncate px-2 py-1.5 font-medium',
                            row.kind === '접합확인필요' ? 'text-rose-700' : 'text-orange-700'
                          )}
                        >
                          {row.kind}
                        </td>
                        <td className="truncate px-2 py-1.5 text-foreground">{row.target}</td>
                        <td className="truncate px-2 py-1.5 text-muted-foreground">{row.detail}</td>
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

        {requests.length > 0 && (
          <div className="max-h-28 shrink-0 overflow-auto border-t border-border px-3 py-1.5">
            <p className="mb-1 text-[10px] font-semibold text-muted-foreground">
              수정·요청 이력 ({requests.length})
            </p>
            <ul className="space-y-0.5 text-[10px]">
              {requests.slice(0, 8).map((r) => (
                <li key={r.id} className="truncate text-foreground">
                  <span className="text-muted-foreground">{r.at}</span> · {r.actionLabel} ·{' '}
                  {r.issueTarget} · {r.status}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {requestAction && selected && (
        <WtlTopoRequestModal
          action={requestAction}
          issueTarget={selected.target}
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
