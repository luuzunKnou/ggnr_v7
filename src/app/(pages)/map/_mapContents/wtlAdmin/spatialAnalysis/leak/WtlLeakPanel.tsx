'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import {
  ANALYSIS_HISTORY_PAGE_SIZE,
  AnalysisHistoryPager,
} from '../AnalysisHistoryPager'
import type { WtlOutageGate } from '../outage/wtlOutageSample'
import { WtlOutageZoomHint } from '../outage/WtlOutageZoomHint'
import { useWtlLeakMapLayer } from './useWtlLeakMapLayer'
import { WtlLeakResultEdit, type LeakEditMode } from './WtlLeakResultEdit'
import {
  buildLeakHistory,
  LEAK_SEARCH_DEFAULT_M,
  leakHistoryGateText,
  type WtlLeakGate,
  type WtlLeakHistory,
  type WtlLeakResult,
  type WtlLeakSnap,
} from './wtlLeakSample'

type Props = {
  active?: boolean
  mapLeftPx?: number
  onHandoffToOutage?: (gates: WtlOutageGate[], label?: string) => void
}

export function WtlLeakPanel({ active = true, mapLeftPx = 0, onHandoffToOutage }: Props) {
  const mapContext = useMapContext()
  const { data: session } = useSession()
  const sessionAuthor = useMemo(
    () => ({
      userId: String(session?.user?.id ?? '').trim() || null,
      userName: String(session?.user?.name ?? '').trim() || null,
    }),
    [session?.user?.id, session?.user?.name]
  )
  const setMapFeatureIdentifyDisabled = mapContext?.setMapFeatureIdentifyDisabled
  const [history, setHistory] = useState<WtlLeakHistory[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [selectedPipeIndex, setSelectedPipeIndex] = useState<number | null>(null)
  const [gateFocusToken, setGateFocusToken] = useState(0)
  const [historyFitToken, setHistoryFitToken] = useState(0)
  const [result, setResult] = useState<WtlLeakResult | null>(null)
  const [snap, setSnap] = useState<WtlLeakSnap | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('해당 위치에서 가까운 관로에 맞춰 분석합니다.')
  const [hiddenPipeIndexes, setHiddenPipeIndexes] = useState<number[]>([])
  const [editMode, setEditMode] = useState<LeakEditMode>(null)

  // 따라 그리기 UI 비활성 — 잔여 follow 모드만 정리
  useEffect(() => {
    if (editMode === 'follow') setEditMode(null)
  }, [editMode])

  /** 분석 전·선 편집 중에는 속성조회 끔 (관로 클릭은 분석/편집만) */
  useEffect(() => {
    if (!setMapFeatureIdentifyDisabled) return
    if (!active) {
      setMapFeatureIdentifyDisabled(false)
      return
    }
    setMapFeatureIdentifyDisabled(result == null || editMode === 'line')
    return () => setMapFeatureIdentifyDisabled(false)
  }, [active, result, editMode, setMapFeatureIdentifyDisabled])

  // 다른 탭으로 나가면 분석 상태를 비워 다시 들어오면 새 분석 (분석 이력 목록은 유지)
  // — effect 대신 이전 값 비교로 렌더 중 초기화(React 권장 패턴)
  const [prevActive, setPrevActive] = useState(active)
  if (prevActive !== active) {
    setPrevActive(active)
    if (!active) {
      setHistoryId(null)
      setSelectedGateId(null)
      setSelectedPipeIndex(null)
      setResult(null)
      setSnap(null)
      setSaved(false)
      setAnalyzing(false)
      setEditMode(null)
      setHiddenPipeIndexes([])
      setNotice('해당 위치에서 가까운 관로에 맞춰 분석합니다.')
    }
  }

  const selectedGate =
    selectedGateId && result ? result.gates.find((g) => g.id === selectedGateId) ?? null : null

  /** 선택만(지도 이동 없음) — 지도에서 제수변을 눌렀을 때 */
  const selectGate = (gate: WtlLeakGate) => {
    setSelectedGateId(gate.id)
  }

  /** 선택 + 지도 이동 — 목록에서 제수변을 눌렀을 때 */
  const focusGate = (gate: WtlLeakGate) => {
    selectGate(gate)
    setGateFocusToken((n) => n + 1)
  }

  const applyResult = (nextSnap: WtlLeakSnap, next: WtlLeakResult) => {
    setSnap(nextSnap)
    setResult(next)
    setHistoryId(null)
    setSaved(false)
    setEditMode(null)
    setHiddenPipeIndexes([])
    // 분석 직후는 누수지점 펄스 — 제수변은 목록에서 고를 때 선택
    setSelectedGateId(null)
    setSelectedPipeIndex(null)
    setAnalyzing(false)
    setNotice(
      next.gates.length > 0
        ? '분석 완료'
        : next.truncated
          ? '탐색 한도 안에서 잠글 제수변을 찾지 못했습니다.'
          : '이어진 관로에 잠글 제수변이 없습니다. 관로가 끊겨 있는지 확인하세요.'
    )
  }

  useWtlLeakMapLayer({
    active,
    pickMode: !editMode,
    // 분석 결과가 있으면 지도 클릭으로 누수지점이 바뀌지 않게 막는다 — «새 분석» 후에만 다시 지정
    analyzeEnabled: !result,
    result,
    selectedGateId,
    selectedPipeIndex,
    gateFocusToken,
    historyFitToken,
    onSnap: (s, r) => {
      applyResult(s, r)
    },
    onSnapError: (msg) => {
      setAnalyzing(false)
      setNotice(msg)
    },
    onBusy: setAnalyzing,
    onSelectGate: (gate: WtlLeakGate) => {
      selectGate(gate)
    },
    onSelectPipe: setSelectedPipeIndex,
    hiddenPipeIndexes,
  })

  const handoffToOutage = () => {
    if (!result || result.gates.length === 0 || !onHandoffToOutage) return
    const gates: WtlOutageGate[] = result.gates.map((g) => ({
      id: g.id,
      name: g.name,
      diameter: g.diameter,
      address: g.address,
      point: g.point,
    }))
    const label = snap
      ? `누수분석 · ${snap.pipeTable === 'wtl_sply_ls' ? '급수관로' : '관로'} #${snap.pipeId}`
      : '누수분석'
    onHandoffToOutage(gates, label)
  }

  const startNew = () => {
    setHistoryId(null)
    setSelectedGateId(null)
    setSelectedPipeIndex(null)
    setResult(null)
    setSnap(null)
    setSaved(false)
    setAnalyzing(false)
    setEditMode(null)
    setHiddenPipeIndexes([])
    setNotice('해당 위치에서 가까운 관로에 맞춰 분석합니다.')
  }

  const updateEditedResult = (next: WtlLeakResult) => {
    setResult(next)
    setSaved(false)
    setSelectedGateId((id) => (id && next.gates.some((gate) => gate.id === id) ? id : null))
    setSelectedPipeIndex(null)
  }

  // 따라 그리기 UI 일시 비활성 — 훅·모드는 유지
  // const openFollowDraw = () => {
  //   if (!result) return
  //   setEditMode('follow')
  //   setNotice('따라 그리기 · 끝점을 끌어 늘이거나 줄입니다')
  // }

  const loadHistory = (item: WtlLeakHistory) => {
    setHistoryId(item.id)
    setHistoryFitToken((n) => n + 1)
    setSaved(true)
    setEditMode(null)
    setHiddenPipeIndexes([])
    setSnap(item.result.snap)
    setResult(item.result)
    setSelectedGateId(null)
    setSelectedPipeIndex(null)
    setNotice('')
  }

  const saveAnalysisResult = () => {
    if (!result || !snap) {
      setNotice('누수 위치를 지정해 분석한 뒤 저장할 수 있습니다.')
      return
    }
    const row = buildLeakHistory(result, sessionAuthor)
    setHistory((prev) => [row, ...prev])
    setHistoryPage(1)
    setHistoryId(row.id)
    setSaved(true)
    setNotice('분석결과 저장')
  }

  const historyPageCount = Math.max(1, Math.ceil(history.length / ANALYSIS_HISTORY_PAGE_SIZE))
  const historySafePage = Math.min(historyPage, historyPageCount)
  const historyPageItems = history.slice(
    (historySafePage - 1) * ANALYSIS_HISTORY_PAGE_SIZE,
    historySafePage * ANALYSIS_HISTORY_PAGE_SIZE
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WtlOutageZoomHint
        active={active}
        message="제수변이 보이는 축척까지 지도를 확대해 주세요"
        showLockHint={!snap}
        lockMessage="지도에서 누수 위치를 클릭하세요"
      />
      <WtlLeakResultEdit
        active={active}
        mapLeftPx={mapLeftPx}
        result={result}
        mode={editMode}
        onMode={setEditMode}
        onChange={updateEditedResult}
        onNotice={setNotice}
      />
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
                    <th className="w-[5.5rem] px-1.5 font-medium text-muted-foreground">위치</th>
                    <th className="w-[5rem] px-1.5 font-medium text-muted-foreground">제수변</th>
                    <th className="w-[4.75rem] px-1.5 font-medium text-muted-foreground">작성자</th>
                  </tr>
                </thead>
                <tbody>
                  {historyPageItems.map((item, rowIdx) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'h-7 cursor-pointer border-b border-border hover:bg-primary/5',
                        historyId === item.id && 'bg-primary/12 ring-1 ring-inset ring-primary/25',
                        historyPageItems.length >= ANALYSIS_HISTORY_PAGE_SIZE &&
                          rowIdx === historyPageItems.length - 1 &&
                          'border-b-0'
                      )}
                      onClick={() => loadHistory(item)}
                    >
                      <td className="whitespace-nowrap px-1.5 tabular-nums text-foreground">{item.at}</td>
                      <td
                        className="truncate whitespace-nowrap px-1.5 text-foreground"
                        title={item.label}
                      >
                        {item.label}
                      </td>
                      <td
                        className="truncate px-1.5 text-muted-foreground"
                        title={leakHistoryGateText(item)}
                      >
                        {leakHistoryGateText(item)}
                      </td>
                      <td
                        className="truncate px-1.5 text-muted-foreground"
                        title={item.createUserName || item.createUser || undefined}
                      >
                        {item.createUserName || item.createUser || '—'}
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
              {snap ? (
                <>
                  <span className="font-semibold">누수 위치</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {snap.pipeTable === 'wtl_sply_ls' ? '급수관로' : '관로'} #{snap.pipeId}
                    {result
                      ? ` · 제수변 ${result.gates.length}개 · 관로 ${result.pipes.length}구간`
                      : ''}
                  </span>
                </>
              ) : selectedGate ? (
                <>
                  <span className="font-semibold">{selectedGate.name}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {selectedGate.diameter} · {selectedGate.address}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">지도에서 누수 위치를 클릭하세요</span>
              )}
            </p>
            {analyzing ? (
              <span className="shrink-0 text-[10px] text-muted-foreground">분석 중…</span>
            ) : (
              <span className="invisible shrink-0 text-[10px]">분석 중…</span>
            )}
          </div>
          {result?.truncated ? (
            <p
              role="alert"
              className="mt-0.5 h-4 truncate text-[10px] font-medium leading-4 text-amber-800"
              title={`각 방향으로 관로 ${(result.searchM ?? LEAK_SEARCH_DEFAULT_M).toLocaleString()}m까지 탐색했습니다. 더 먼 제수변은 결과에 없을 수 있습니다.`}
            >
              각 방향으로 관로 {(result.searchM ?? LEAK_SEARCH_DEFAULT_M).toLocaleString()}m까지 탐색했습니다.
              더 먼 제수변은 결과에 없을 수 있습니다.
            </p>
          ) : (
            <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-muted-foreground">
              {notice || '\u00a0'}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">잠글 제수변</span>
            {result && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                {result.gates.length}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {!result ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                관로 클릭 후 격리에 필요한 제수변 목록이 표시됩니다.
              </p>
            ) : result.gates.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                주변에 잠글 제수변이 없습니다.
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-muted/50">
                  <tr className="border-b border-border">
                    <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">제수변</th>
                    <th className="w-[22%] px-2 py-1.5 font-medium text-muted-foreground">구경</th>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground">위치</th>
                  </tr>
                </thead>
                <tbody>
                  {result.gates.map((gate) => (
                    <tr
                      key={gate.id}
                      className={cn(
                        'cursor-pointer border-b border-border hover:bg-primary/5',
                        selectedGateId === gate.id &&
                          'bg-primary/12 ring-1 ring-inset ring-primary/25'
                      )}
                      onClick={() => focusGate(gate)}
                    >
                      <td className="truncate px-2 py-1.5 text-foreground">{gate.name}</td>
                      <td className="truncate px-2 py-1.5 text-foreground">{gate.diameter}</td>
                      <td className="truncate px-2 py-1.5 text-muted-foreground">{gate.address}</td>
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
            className="rounded border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted"
            onClick={startNew}
          >
            새 분석
          </button>
          <button
            type="button"
            disabled={!result || saved || analyzing}
            className="rounded bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
            onClick={saveAnalysisResult}
          >
            분석결과저장
          </button>
          {/* <button
            type="button"
            disabled={!result || analyzing}
            className={cn(
              'rounded border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40',
              editMode === 'follow'
                ? 'border-[#0f766e] bg-[#f3fbf8] text-[#0f766e]'
                : 'border-dashed border-[#0f766e] text-[#0f766e] hover:bg-[#f3fbf8]'
            )}
            onClick={openFollowDraw}
            title="끝점·분기 드래그로 결과 선 편집 (클릭 추가·제외 이전 방식)"
          >
            따라 그리기
          </button> */}
          <button
            type="button"
            disabled={!result || result.gates.length === 0 || analyzing || !onHandoffToOutage}
            className="ml-auto rounded bg-[#d7ebf1] px-2.5 py-1.5 text-[11px] font-semibold text-[#14607a] disabled:opacity-40"
            onClick={handoffToOutage}
          >
            단수구역 분석하기
          </button>
        </div>
      </div>
    </div>
  )
}
