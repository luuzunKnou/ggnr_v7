'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WtlOutageHandoffSeed } from '../wtlSpatialHandoff'
import { WtlOutageGeomEdit } from './WtlOutageGeomEdit'
import { WtlOutageSmsModal } from './WtlOutageSmsModal'
import { useWtlOutageMapLayer } from './useWtlOutageMapLayer'
import type { LonLat } from './wtlOutageGeom'
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
}

function statusClass(status: string) {
  if (status === '종료') return 'text-slate-500'
  if (status === '분석완료' || status === '설정완료') return 'text-emerald-700'
  if (status === '문자발송 완료') return 'text-amber-700'
  if (status === '단수중') return 'text-rose-700'
  return 'text-foreground'
}

export function WtlOutagePanel({
  active = true,
  handoffSeed = null,
  onHandoffConsumed,
}: Props) {
  const [history, setHistory] = useState<WtlOutageHistory[]>([])
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null)
  const [lockedGateIds, setLockedGateIds] = useState<string[]>([])
  const [gateById, setGateById] = useState<Map<string, WtlOutageGate>>(() => new Map())
  const [result, setResult] = useState<WtlOutageResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [targetTab, setTargetTab] = useState<TargetTab>('수용가')
  const [smsOpen, setSmsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [geomMapEditing, setGeomMapEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const previewSeqRef = useRef(0)
  const handoffDoneRef = useRef<number | null>(null)
  const onHandoffConsumedRef = useRef(onHandoffConsumed)
  onHandoffConsumedRef.current = onHandoffConsumed

  const rememberGate = (gate: WtlOutageGate) => {
    setGateById((prev) => {
      const old = prev.get(gate.id)
      if (old && old.point[0] === gate.point[0] && old.point[1] === gate.point[1] && old.name === gate.name) {
        return prev
      }
      const next = new Map(prev)
      next.set(gate.id, gate)
      return next
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

  const selectedGate = selectedGateId ? gateById.get(selectedGateId) ?? null : null
  const lockedGates = lockedGateIds
    .map((id) => gateById.get(id))
    .filter((g): g is WtlOutageGate => Boolean(g))

  /** 잠금 변경 시 단수 관로·면 미리보기 (이력 저장 없음). 성공 시 result 반환 */
  const previewOutage = async (ids: string[]): Promise<WtlOutageResult | null> => {
    if (ids.length === 0) {
      setResult(null)
      return null
    }
    const seq = ++previewSeqRef.current
    setAnalyzing(true)
    setNotice('유수방향으로 단수 관로를 추적하는 중…')
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
      }
      if (body.gates?.length) rememberGates(body.gates)
      if (body.error || !body.result) {
        setResult(null)
        setNotice(body.error || '단수 관로를 찾을 수 없습니다.')
        return null
      }
      setResult(body.result)
      setNotice(
        `잠금 ${ids.length}개 · 단수관로 ${body.result.pipes.length}구간 · 수용가 ${body.result.customers.length}`
      )
      return body.result
    } catch {
      if (seq !== previewSeqRef.current) return null
      setResult(null)
      setNotice('단수 관로 표시에 실패했습니다.')
      return null
    } finally {
      if (seq === previewSeqRef.current) setAnalyzing(false)
    }
  }

  /** 누수분석에서 넘어온 제수변으로 단수 미리보기 + 이력 생성 */
  useEffect(() => {
    if (!handoffSeed || handoffSeed.gates.length === 0) return
    if (handoffDoneRef.current === handoffSeed.seq) return
    handoffDoneRef.current = handoffSeed.seq

    const gates = handoffSeed.gates
    const ids = gates.map((g) => g.id)
    const reason = handoffSeed.label?.trim() || '누수분석'

    rememberGates(gates)
    setLockedGateIds(ids)
    setSelectedGateId(ids[0] ?? null)
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
      const row = buildOutageHistory(gates, analyzed)
      row.reason = reason
      setHistory((prev) => [row, ...prev])
      setHistoryId(row.id)
      setSaved(true)
      setNotice(
        `누수분석 → 단수구역 · 제수변 ${gates.length} · 관로 ${analyzed.pipes.length} · 수용가 ${analyzed.customers.length}`
      )
      onHandoffConsumedRef.current?.(handoffSeed.seq)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handoffSeed.seq만 트리거
  }, [handoffSeed?.seq])

  const lockGate = (gateId?: string | null) => {
    const id = gateId ?? selectedGateId
    if (!id) return
    setSelectedGateId(id)
    setHistoryId(null)
    setSaved(false)
    const next = lockedGateIds.includes(id) ? lockedGateIds : [...lockedGateIds, id]
    setLockedGateIds(next)
    void previewOutage(next)
  }

  const unlockGate = (gateId?: string | null) => {
    const id = gateId ?? selectedGateId
    if (!id) {
      setLockedGateIds([])
      setResult(null)
      setHistoryId(null)
      setSaved(false)
      setNotice('모든 잠금을 해제했습니다.')
      return
    }
    setSelectedGateId(id)
    setHistoryId(null)
    setSaved(false)
    const next = lockedGateIds.filter((row) => row !== id)
    setLockedGateIds(next)
    if (next.length === 0) {
      setResult(null)
      setNotice('잠긴 제수변이 없습니다.')
      return
    }
    void previewOutage(next)
  }

  useWtlOutageMapLayer({
    active,
    pickMode: !geomMapEditing,
    lockedGateIds,
    selectedGateId,
    result,
    hideZone: geomMapEditing,
    onVisibleGates: rememberGates,
    onSelectGate: (gate) => {
      rememberGate(gate)
      setSelectedGateId(gate.id)
      setNotice(`${gate.name} 선택 · 열림/잠금으로 여러 제수변을 잠글 수 있습니다.`)
    },
    onLockGate: (id) => lockGate(id),
    onUnlockGate: (id) => unlockGate(id),
  })

  const customers = result?.customers ?? []
  const smsTargets = useMemo(() => customers.filter((c) => c.phone.trim()), [customers])
  const currentHistory = history.find((h) => h.id === historyId) ?? null
  const nextStatus = currentHistory ? nextOutageStatus(currentHistory.status) : null

  const patchHistory = (id: string | null, patch: Partial<WtlOutageHistory>) => {
    if (!id) return
    setHistory((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
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
    setSelectedGateId(null)
    setLockedGateIds([])
    setResult(null)
    setSaved(false)
    setGeomMapEditing(false)
    setNotice('제수변 위 잠금으로 여러 개를 선택할 수 있습니다.')
  }

  const loadHistory = (item: WtlOutageHistory) => {
    const ids = parseOutageGateIds(item.gateId)
    setHistoryId(item.id)
    setSaved(true)
    setGeomMapEditing(false)
    setSelectedGateId(ids[0] ?? null)
    setLockedGateIds(ids)
    setResult(item.result)
    setGateById((prev) => {
      const next = new Map(prev)
      // 이력에 좌표가 없으면 기존 캐시만 사용
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
    setNotice('')
  }

  /** 잠금 미리보기 결과를 세션 이력에 저장 → 이후 도형편집 가능 */
  const saveAnalysisResult = () => {
    if (!result || lockedGates.length === 0) {
      setNotice('잠금 미리보기가 있을 때 저장할 수 있습니다.')
      return
    }
    const row = buildOutageHistory(lockedGates, result)
    setHistory((prev) => [row, ...prev])
    setHistoryId(row.id)
    setSaved(true)
    setNotice(
      `분석결과 저장 · 제수변 ${lockedGates.length} · 관로 ${result.pipes.length} · 수용가 ${result.customers.length} · 이어서 도형편집을 할 수 있습니다.`
    )
  }

  const applyEditedZone = (
    ring: LonLat[],
    customers: WtlOutageResult['customers'],
    addresses: WtlOutageResult['addresses']
  ) => {
    if (!result) return
    const next: WtlOutageResult = { ...result, ring, customers, addresses }
    setResult(next)
    if (historyId) {
      patchHistory(historyId, {
        result: next,
        householdCount: customers.filter((c) => c.phone.trim()).length || customers.length,
      })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 이력 · 결과 5:5 */}
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
                    <th className="w-[18%] px-2 py-1 font-medium text-muted-foreground">제수변</th>
                    <th className="w-[22%] px-2 py-1 font-medium text-muted-foreground">사유</th>
                    <th className="w-[16%] px-2 py-1 font-medium text-muted-foreground">상태</th>
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
                      <td className="truncate px-2 py-1 text-foreground">{item.gateName}</td>
                      <td className="truncate px-2 py-1 text-muted-foreground">{item.reason || '—'}</td>
                      <td className={cn('px-2 py-1', statusClass(item.status))}>{item.status}</td>
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
                  <span className="text-muted-foreground"> · {lockedGates.map((g) => g.name).join(', ')}</span>
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
                <span className="text-muted-foreground">지도에서 제수변을 잠그세요</span>
              )}
            </p>
            <button
              type="button"
              disabled={lockedGateIds.length === 0}
              className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              onClick={() =>
                unlockGate(selectedGateId && lockedGateIds.includes(selectedGateId) ? selectedGateId : null)
              }
            >
              {selectedGateId && lockedGateIds.includes(selectedGateId) ? '선택해제' : '잠금해제'}
            </button>
          </div>
          {notice && <p className="mt-1 truncate text-[10px] text-muted-foreground">{notice}</p>}
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
                onClick={() => setTargetTab(name)}
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

          <div className="min-h-0 flex-1 overflow-auto">
        {!result ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            제수변 잠금 후 대상 목록이 표시됩니다.
          </p>
        ) : targetTab === '필지' ? (
          result.parcels.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              필지 레이어가 없어 목록이 비어 있습니다.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">지번</th>
                  <th className="w-[20%] px-2 py-1.5 font-medium text-muted-foreground">지목</th>
                  <th className="w-[24%] px-2 py-1.5 font-medium text-muted-foreground">면적</th>
                </tr>
              </thead>
              <tbody>
                {result.parcels.map((row) => (
                  <tr key={row.id} className="border-b border-border">
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
              <thead className="sticky top-0 bg-muted/50">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">도로명주소</th>
                  <th className="w-[36%] px-2 py-1.5 font-medium text-muted-foreground">지번</th>
                </tr>
              </thead>
              <tbody>
                {result.addresses.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="truncate px-2 py-1.5 text-foreground">{row.road}</td>
                    <td className="truncate px-2 py-1.5 text-muted-foreground">{row.jibun}</td>
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
            <thead className="sticky top-0 bg-muted/50">
              <tr className="border-b border-border">
                <th className="w-[18%] px-2 py-1.5 font-medium text-muted-foreground">수용가</th>
                <th className="px-2 py-1.5 font-medium text-muted-foreground">주소</th>
                <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">연락처</th>
              </tr>
            </thead>
            <tbody>
              {result.customers.map((row) => (
                <tr key={row.id} className="border-b border-border">
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
            className="rounded border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted"
            onClick={startNew}
          >
            새 분석
          </button>
          {!saved ? (
            <button
              type="button"
              disabled={!result || lockedGates.length === 0 || analyzing}
              className="rounded bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
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
              className="rounded border border-border px-2 py-1.5 text-[11px] font-medium hover:bg-muted"
              onClick={() => {
                patchHistory(historyId, { status: nextStatus })
                setNotice(`상태를 «${nextStatus}»으로 올렸습니다.`)
              }}
            >
              → {nextStatus}
            </button>
          )}
          <button
            type="button"
            disabled={!result}
            className="ml-auto rounded bg-[#d7ebf1] px-2.5 py-1.5 text-[11px] font-semibold text-[#14607a] disabled:opacity-40"
            onClick={() => setSmsOpen(true)}
          >
            문자발송{result ? ` ${smsTargets.length}` : ''}
          </button>
        </div>
      </div>

      {smsOpen && result && (
        <WtlOutageSmsModal
          customers={result.customers}
          defaultTitle={currentHistory?.smsTitle ?? '[의성군] 단수 안내'}
          defaultReason={currentHistory?.reason ?? ''}
          defaultStart={currentHistory?.startAt.replace(' ', 'T') ?? ''}
          defaultEnd={currentHistory?.endAt.replace(' ', 'T') ?? ''}
          onClose={() => setSmsOpen(false)}
          onSaveSettings={(payload) => {
            patchHistory(historyId, {
              ...applySmsFields(payload),
              status: '설정완료',
            })
            setSmsOpen(false)
            setNotice(`설정저장 · 선택 ${payload.count}명`)
          }}
          onSend={(payload) => {
            patchHistory(historyId, {
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
