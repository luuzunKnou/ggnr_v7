'use client'

import { useEffect, useMemo, useState } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useWtlSupplyPathMapLayer } from './useWtlSupplyPathMapLayer'
import { WtlSupplyBusyToast } from './WtlSupplyBusyToast'
import {
  WTL_SUPPLY_KINDS,
  type WtlSupplyPathResult,
  type WtlSupplySource,
  type WtlSupplySourceKind,
} from './wtlSupplySample'

type Props = {
  active?: boolean
}

/**
 * 송수경로 — 정수장·배수지에서 하류로 흐르는 물 흐름을 보여 준다 (제수변 조작 없음)
 */
export function WtlSupplyPathPanel({ active = true }: Props) {
  const [kind, setKind] = useState<WtlSupplySourceKind>('정수장')
  const [sources, setSources] = useState<WtlSupplySource[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [result, setResult] = useState<WtlSupplyPathResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  /** 순차 재생 중 여부 (초기·완료 후에는 전체 경로를 한 번에 보여 줌) */
  const [revealing, setRevealing] = useState(false)
  const [replayToken, setReplayToken] = useState(0)
  const [notice, setNotice] = useState('정수장 또는 배수지를 선택하면 송수경로가 표시됩니다.')
  /** 정수장에서 닿는 배수지 후보와 선택한 도착 배수지 */
  const [destinations, setDestinations] = useState<WtlSupplySource[]>([])
  const [destinationId, setDestinationId] = useState<string | null>(null)

  const filtered = useMemo(() => sources.filter((s) => s.kind === kind), [sources, kind])

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

  useWtlSupplyPathMapLayer({
    // 선 잇기(분기점에서 한 갈래씩 이어 하나의 선으로 그림)는 훅 기본값(켬)을 사용
    active,
    result,
    revealing: active && revealing,
    replayToken,
    onRevealDone: () => {
      setRevealing(false)
      setNotice('경로 재생을 마쳤습니다.')
    },
  })

  const analyze = async (sourceId: string, toId: string | null = null) => {
    setSelectedId(sourceId)
    setDestinationId(toId)
    // 출발 시설이 바뀌면(또는 전체 보기) 도착 배수지 후보를 새로 받음
    if (toId == null) setDestinations([])
    setAnalyzing(true)
    // 진행 중 안내는 지도 위 토스트(WtlSupplyBusyToast)로 표시
    setNotice('')
    try {
      const res = await call('', 'POST', {
        service: 'wtlSupplyPathService',
        action: 'analyzeWtlSupplyPath',
        params: { sourceId, ...(toId ? { destinationId: toId } : {}) },
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
      const next = body.result
      setResult(next)
      if (toId == null) setDestinations(next.destinations ?? [])
      setRevealing(false)
      const toName = toId ? destinations.find((d) => d.id === toId)?.name : null
      setNotice(`${next.source.name}${toName ? ` → ${toName}` : ''} · 관로 ${next.pipeCount}구간`)
    } catch {
      setResult(null)
      setNotice('송수경로 분석에 실패했습니다.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WtlSupplyBusyToast message={active && analyzing ? '송수경로를 탐색하는 중…' : null} />
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
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

        <div className="shrink-0 px-3 py-1.5">
          {notice && <p className="truncate text-[11px] text-muted-foreground">{notice}</p>}
          {selectedId && destinations.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="도착 배수지">
              <span className="text-[10px] text-muted-foreground">도착 배수지</span>
              {[{ id: null, name: '전체' }, ...destinations].map((d) => (
                <button
                  key={d.id ?? 'all'}
                  type="button"
                  disabled={analyzing}
                  aria-pressed={destinationId === d.id}
                  className={cn(
                    'rounded border px-1.5 py-0 text-[10px] font-medium leading-4 disabled:opacity-50',
                    destinationId === d.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-primary/5'
                  )}
                  onClick={() => {
                    if (destinationId === d.id) return
                    void analyze(selectedId, d.id)
                  }}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!result || analyzing}
            title={revealing ? '재생을 멈추고 전체 경로를 표시' : '정수장에서 하류로 물이 흐르는 모습을 재생'}
            className="rounded border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
            onClick={() => {
              if (revealing) {
                setRevealing(false)
                setNotice('경로 재생을 중지했습니다.')
              } else {
                setRevealing(true)
                setReplayToken((n) => n + 1)
                setNotice('경로를 재생합니다.')
              }
            }}
          >
            {revealing ? '■ 중지' : '▶ 경로 재생'}
          </button>
        </div>
      </div>
    </div>
  )
}
