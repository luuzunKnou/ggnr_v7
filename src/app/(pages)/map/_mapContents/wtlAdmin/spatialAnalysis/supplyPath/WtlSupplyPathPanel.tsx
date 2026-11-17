'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WtlOutageGate, WtlOutageResult } from '../outage/wtlOutageSample'
import { useWtlSupplyPathMapLayer } from './useWtlSupplyPathMapLayer'
import {
  WTL_SUPPLY_KINDS,
  type WtlSupplyGate,
  type WtlSupplyPathResult,
  type WtlSupplySource,
  type WtlSupplySourceKind,
} from './wtlSupplySample'

type Props = {
  active?: boolean
  onHandoffToOutage?: (gates: WtlOutageGate[], label?: string) => void
}

export function WtlSupplyPathPanel({ active = true, onHandoffToOutage }: Props) {
  const [kind, setKind] = useState<WtlSupplySourceKind>('정수장')
  const [sources, setSources] = useState<WtlSupplySource[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [result, setResult] = useState<WtlSupplyPathResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [replayToken, setReplayToken] = useState(0)
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [lockedGateIds, setLockedGateIds] = useState<string[]>([])
  const [outagePreview, setOutagePreview] = useState<WtlOutageResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [notice, setNotice] = useState('정수장 또는 배수지를 선택하세요.')
  const previewSeqRef = useRef(0)

  const filtered = useMemo(() => sources.filter((s) => s.kind === kind), [sources, kind])
  const pathGates = result?.gates ?? []
  const lockedGates = lockedGateIds
    .map((id) => pathGates.find((g) => g.id === id))
    .filter((g): g is WtlSupplyGate => Boolean(g))
  const selectedGate =
    selectedGateId ? pathGates.find((g) => g.id === selectedGateId) ?? null : null

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlSupplyPathService',
          action: 'listWtlSupplySources',
          params: {},
        })
        if (cancelled) return
        const body = (res?.data ?? res) as {
          sources?: WtlSupplySource[]
          error?: string
        }
        setSources(body.sources ?? [])
        if (body.error) setNotice(body.error)
        else if ((body.sources ?? []).length === 0) setNotice('등록된 정수장·배수지가 없습니다.')
      } catch {
        if (!cancelled) setNotice('시설 목록을 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const previewOutage = async (ids: string[]) => {
    if (ids.length === 0) {
      setOutagePreview(null)
      return
    }
    const seq = ++previewSeqRef.current
    setPreviewing(true)
    setNotice('유수방향으로 단수 관로를 추적하는 중…')
    try {
      const res = await call('', 'POST', {
        service: 'wtlOutageService',
        action: 'analyzeWtlOutage',
        params: { gateIds: ids },
      })
      if (seq !== previewSeqRef.current) return
      const body = (res?.data ?? res) as {
        result?: WtlOutageResult | null
        error?: string
      }
      if (body.error || !body.result) {
        setOutagePreview(null)
        setNotice(body.error || '단수 관로를 찾을 수 없습니다.')
        return
      }
      setOutagePreview(body.result)
      setNotice(
        `잠금 ${ids.length}개 · 단수관로 ${body.result.pipes.length}구간 · 수용가 ${body.result.customers.length}`
      )
    } catch {
      if (seq !== previewSeqRef.current) return
      setOutagePreview(null)
      setNotice('단수 관로 표시에 실패했습니다.')
    } finally {
      if (seq === previewSeqRef.current) setPreviewing(false)
    }
  }

  const lockGate = (gateId: string) => {
    setSelectedGateId(gateId)
    const next = lockedGateIds.includes(gateId) ? lockedGateIds : [...lockedGateIds, gateId]
    setLockedGateIds(next)
    void previewOutage(next)
  }

  const unlockGate = (gateId: string) => {
    setSelectedGateId(gateId)
    const next = lockedGateIds.filter((id) => id !== gateId)
    setLockedGateIds(next)
    if (next.length === 0) {
      setOutagePreview(null)
      setNotice('잠긴 제수변이 없습니다.')
      return
    }
    void previewOutage(next)
  }

  useWtlSupplyPathMapLayer({
    active,
    result,
    playing: active && playing,
    replayToken,
    lockedGateIds,
    selectedGateId,
    outagePreview,
    onSelectGate: (gate) => {
      setSelectedGateId(gate.id)
      setNotice(`${gate.name} 선택 · ${gate.diameter} · ${gate.address}`)
    },
    onLockGate: lockGate,
    onUnlockGate: unlockGate,
  })

  const analyze = async (sourceId: string) => {
    setSelectedId(sourceId)
    setAnalyzing(true)
    setLockedGateIds([])
    setSelectedGateId(null)
    setOutagePreview(null)
    setNotice('유수방향으로 송수경로를 추적하는 중…')
    try {
      const res = await call('', 'POST', {
        service: 'wtlSupplyPathService',
        action: 'analyzeWtlSupplyPath',
        params: { sourceId },
      })
      const body = (res?.data ?? res) as {
        result?: WtlSupplyPathResult | null
        error?: string
      }
      if (body.error || !body.result) {
        setResult(null)
        setNotice(body.error || '송수경로를 찾지 못했습니다.')
        return
      }
      const next = {
        ...body.result,
        gates: body.result.gates ?? [],
      }
      setResult(next)
      setPlaying(true)
      setReplayToken((n) => n + 1)
      setNotice(
        `${next.source.name} · 관로 ${next.pipeCount}구간 · 제수변 ${next.gates.length}개 · 열림/잠금으로 선택하세요`
      )
    } catch {
      setResult(null)
      setNotice('송수경로 분석에 실패했습니다.')
    } finally {
      setAnalyzing(false)
    }
  }

  const startNew = () => {
    setSelectedId(null)
    setResult(null)
    setPlaying(true)
    setSelectedGateId(null)
    setLockedGateIds([])
    setOutagePreview(null)
    setNotice('정수장 또는 배수지를 선택하세요.')
  }

  const handoffToOutage = () => {
    if (lockedGates.length === 0 || !onHandoffToOutage) return
    const gates: WtlOutageGate[] = lockedGates.map((g) => ({
      id: g.id,
      name: g.name,
      diameter: g.diameter,
      address: g.address,
      point: g.point,
    }))
    const label = result
      ? `송수경로 · ${result.source.name}`
      : '송수경로'
    onHandoffToOutage(gates, label)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 border-b border-border">
          {WTL_SUPPLY_KINDS.map((name) => (
            <button
              key={name}
              type="button"
              className={cn(
                'flex-1 py-1.5 text-center text-[11px] font-medium',
                kind === name
                  ? 'border-b-2 border-primary bg-primary/5 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setKind(name)}
            >
              {name}
              <span className="ml-1 text-[10px] tabular-nums opacity-80">
                {sources.filter((s) => s.kind === name).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex min-h-0 max-h-[calc(50%-80px)] flex-1 flex-col overflow-hidden border-b border-border">
          <div className="shrink-0 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">{kind} 목록</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loadingList ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">불러오는 중…</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                {kind}이(가) 없습니다.
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 font-medium text-muted-foreground">시설명</th>
                    <th className="w-[22%] px-2 py-1 font-medium text-muted-foreground">구분</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        'cursor-pointer border-b border-border hover:bg-primary/5',
                        selectedId === row.id &&
                          'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                      )}
                      onClick={() => {
                        if (!analyzing) void analyze(row.id)
                      }}
                    >
                      <td className="truncate px-2 py-1.5 text-foreground">{row.name}</td>
                      <td className="truncate px-2 py-1.5 text-muted-foreground">{row.kind}</td>
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
              {lockedGates.length > 0 ? (
                <>
                  <span className="font-semibold">잠금 {lockedGates.length}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {lockedGates.map((g) => g.name).join(', ')}
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
              ) : result ? (
                <span className="text-muted-foreground">
                  송수 관로 제수변 {pathGates.length}개 · 열림/잠금으로 선택
                </span>
              ) : (
                <span className="text-muted-foreground">시설을 선택하면 송수경로가 표시됩니다</span>
              )}
            </p>
            <button
              type="button"
              disabled={lockedGateIds.length === 0}
              className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              onClick={() => {
                if (selectedGateId && lockedGateIds.includes(selectedGateId)) {
                  unlockGate(selectedGateId)
                } else {
                  setLockedGateIds([])
                  setOutagePreview(null)
                  setNotice('모든 잠금을 해제했습니다.')
                }
              }}
            >
              {selectedGateId && lockedGateIds.includes(selectedGateId) ? '선택해제' : '잠금해제'}
            </button>
          </div>
          {notice && <p className="mt-1 truncate text-[10px] text-muted-foreground">{notice}</p>}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">잠긴 제수변</span>
            {lockedGates.length > 0 && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                {lockedGates.length}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {!result ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                정수장·배수지를 고른 뒤 송수 관로의 제수변을 잠그세요.
              </p>
            ) : pathGates.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                송수 관로에 붙은 제수변이 없습니다.
              </p>
            ) : lockedGates.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                지도에서 제수변을 잠그면 목록에 표시됩니다.
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
                  {lockedGates.map((gate) => (
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
            disabled={!result || analyzing}
            className="rounded border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? '일시정지' : '재생'}
          </button>
          <button
            type="button"
            disabled={!result || analyzing}
            className="rounded border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
            onClick={() => {
              setPlaying(true)
              setReplayToken((n) => n + 1)
              setNotice('흐름 애니메이션을 다시 재생합니다.')
            }}
          >
            다시재생
          </button>
          <button
            type="button"
            disabled={
              lockedGates.length === 0 || analyzing || previewing || !onHandoffToOutage
            }
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
