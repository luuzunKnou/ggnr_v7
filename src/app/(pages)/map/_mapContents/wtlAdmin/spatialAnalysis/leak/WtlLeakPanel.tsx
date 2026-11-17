'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { WtlOutageGate } from '../outage/wtlOutageSample'
import { useWtlLeakMapLayer } from './useWtlLeakMapLayer'
import {
  buildLeakHistory,
  type WtlLeakGate,
  type WtlLeakHistory,
  type WtlLeakResult,
  type WtlLeakSnap,
} from './wtlLeakSample'

type Props = {
  active?: boolean
  onHandoffToOutage?: (gates: WtlOutageGate[], label?: string) => void
}

export function WtlLeakPanel({ active = true, onHandoffToOutage }: Props) {
  const [history, setHistory] = useState<WtlLeakHistory[]>([])
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [result, setResult] = useState<WtlLeakResult | null>(null)
  const [snap, setSnap] = useState<WtlLeakSnap | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('지도에서 관로를 클릭하면 누수 위치에 스냅됩니다.')

  const selectedGate =
    selectedGateId && result ? result.gates.find((g) => g.id === selectedGateId) ?? null : null

  const applyResult = (nextSnap: WtlLeakSnap, next: WtlLeakResult) => {
    setSnap(nextSnap)
    setResult(next)
    setHistoryId(null)
    setSaved(false)
    setSelectedGateId(next.gates[0]?.id ?? null)
    setAnalyzing(false)
    setNotice(
      next.gates.length > 0
        ? `스냅 완료 · 잠글 제수변 ${next.gates.length}개 · 격리 관로 ${next.pipes.length}구간`
        : '스냅 완료 · 주변에 제수변이 없습니다.'
    )
  }

  useWtlLeakMapLayer({
    active,
    pickMode: true,
    result,
    selectedGateId,
    onSnap: (s, r) => {
      applyResult(s, r)
    },
    onSnapError: (msg) => {
      setAnalyzing(false)
      setNotice(msg)
    },
    onBusy: setAnalyzing,
    onSelectGate: (gate: WtlLeakGate) => {
      setSelectedGateId(gate.id)
      setNotice(`${gate.name} 선택 · ${gate.diameter} · ${gate.address}`)
    },
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
    const label = snap ? `누수분석 · 관로 #${snap.pipeId}` : '누수분석'
    onHandoffToOutage(gates, label)
  }

  const startNew = () => {
    setHistoryId(null)
    setSelectedGateId(null)
    setResult(null)
    setSnap(null)
    setSaved(false)
    setAnalyzing(false)
    setNotice('지도에서 관로를 클릭하면 누수 위치에 스냅됩니다.')
  }

  const loadHistory = (item: WtlLeakHistory) => {
    setHistoryId(item.id)
    setSaved(true)
    setSnap(item.result.snap)
    setResult(item.result)
    setSelectedGateId(item.result.gates[0]?.id ?? null)
    setNotice('')
  }

  const saveAnalysisResult = () => {
    if (!result || !snap) {
      setNotice('관로를 클릭해 분석한 뒤 저장할 수 있습니다.')
      return
    }
    const row = buildLeakHistory(result)
    setHistory((prev) => [row, ...prev])
    setHistoryId(row.id)
    setSaved(true)
    setNotice(`분석결과 저장 · 제수변 ${result.gates.length} · 관로 ${result.pipes.length}`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 max-h-[calc(50%-100px)] flex-1 flex-col overflow-hidden border-b border-border">
          <div className="shrink-0 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">분석 이력</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {history.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                분석결과 저장 후 이력이 표시됩니다.
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 font-medium text-muted-foreground">일시</th>
                    <th className="px-2 py-1 font-medium text-muted-foreground">위치</th>
                    <th className="w-[22%] px-2 py-1 font-medium text-muted-foreground">제수변</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'cursor-pointer border-b border-border hover:bg-primary/5',
                        historyId === item.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                      )}
                      onClick={() => loadHistory(item)}
                    >
                      <td className="truncate px-2 py-1 text-foreground">{item.at}</td>
                      <td className="truncate px-2 py-1 text-foreground">{item.label}</td>
                      <td className="truncate px-2 py-1 text-muted-foreground">{item.gateCount}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="shrink-0 border-b border-border px-3 py-1.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-foreground">
              {snap ? (
                <>
                  <span className="font-semibold">누수 스냅</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · 관로 #{snap.pipeId}
                    {result ? ` · 제수변 ${result.gates.length}개` : ''}
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
                <span className="text-muted-foreground">지도에서 관로를 클릭하세요</span>
              )}
            </p>
            {analyzing && (
              <span className="shrink-0 text-[10px] text-muted-foreground">분석 중…</span>
            )}
          </div>
          {notice && <p className="mt-1 truncate text-[10px] text-muted-foreground">{notice}</p>}
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
                          'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                      )}
                      onClick={() => {
                        setSelectedGateId(gate.id)
                        setNotice(`${gate.name} 선택 · ${gate.diameter} · ${gate.address}`)
                      }}
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
