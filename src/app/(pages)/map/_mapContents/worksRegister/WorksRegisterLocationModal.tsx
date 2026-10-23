'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/app/shadcnComponents/ui/button'
import {
  AREA_SIZE_OPTIONS,
  createEmptyLocationConditions,
  EUP_MYEON_DONG,
  mockRecommendZones,
  OWNERSHIP_OPTIONS,
  ZONE_GROUPS,
  type IncludeMode,
  type LocationAnalysisConditions,
  type OwnershipKey,
  type RecommendedZone,
  type ZoneMode,
} from './worksRegisterAnalysisMock'
import type { WorksRegisterScopeArea } from './useWorksRegisterDrawSession'

type Phase = 'conditions' | 'results'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 발주 목록 패널 왼쪽 끝 (뷰포트 px) — 도로대장 속성조회와 동일 */
  overlayLeftPx: number
  /** 목록 + 상세 패널 너비 합 (px) */
  overlayWidthPx: number
  projectName?: string
  orderDept?: string
  constructionType?: string
  onApply: (
    area: WorksRegisterScopeArea & {
      recommendId: string
      name: string
    }
  ) => void
}

const inputCls =
  'w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200'

function Accordion({
  title,
  open,
  onToggle,
  hint,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-slate-50"
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-amber-500 transition-transform',
            open && 'rotate-180'
          )}
        />
        <span className="text-[11px] font-semibold text-slate-800">{title}</span>
        {hint && <span className="ml-auto max-w-[45%] truncate text-[9px] text-slate-400">{hint}</span>}
      </button>
      {open && <div className="border-t border-slate-100 px-2.5 py-2">{children}</div>}
    </section>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 py-0.5">
      <span className="text-[10px] font-medium text-slate-600">{label}</span>
      <div>{children}</div>
    </label>
  )
}

/**
 * 입지분석 — 발주 목록·상세 패널 영역만 덮는 오버레이 (도로대장 속성조회와 동일).
 * 지도는 가리지 않음.
 */
export function WorksRegisterLocationModal({
  open,
  onOpenChange,
  overlayLeftPx,
  overlayWidthPx,
  projectName,
  orderDept,
  constructionType,
  onApply,
}: Props) {
  const [phase, setPhase] = useState<Phase>('conditions')
  const [cond, setCond] = useState<LocationAnalysisConditions>(() => createEmptyLocationConditions())
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(
    () => new Set(['region', 'price', 'owner', 'zone'])
  )
  const [openZoneGroups, setOpenZoneGroups] = useState<Set<string>>(
    () => new Set(ZONE_GROUPS.map((g) => g.id))
  )
  const [results, setResults] = useState<RecommendedZone[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleClose = () => {
    onOpenChange(false)
    setPhase('conditions')
  }

  useEffect(() => {
    if (!open) {
      setPhase('conditions')
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 시 Esc만
  }, [open])

  if (!open || overlayWidthPx <= 0 || typeof document === 'undefined') {
    return null
  }

  const toggleBlock = (id: string) => {
    setOpenBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleZoneGroup = (id: string) => {
    setOpenZoneGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setOwnership = (key: OwnershipKey, patch: Partial<{ checked: boolean; mode: IncludeMode }>) => {
    setCond((prev) => ({
      ...prev,
      ownership: { ...prev.ownership, [key]: { ...prev.ownership[key], ...patch } },
    }))
  }

  const setZone = (id: string, patch: Partial<{ checked: boolean; mode: ZoneMode }>) => {
    setCond((prev) => ({
      ...prev,
      zones: { ...prev.zones, [id]: { ...prev.zones[id], ...patch } },
    }))
  }

  const handleSearch = () => {
    const list = mockRecommendZones(cond)
    setResults(list)
    setSelectedId(list[0]?.id ?? null)
    setPhase('results')
  }

  const handleApply = () => {
    const z = results.find((r) => r.id === selectedId)
    if (!z) return
    const areaSqm = z.areaM2
    onApply({
      method: 'location',
      wkt: z.wkt5181 ?? '',
      summaryLabel: z.name,
      areaSqm: Number(z.areaM2) || 0,
      recommendId: z.id,
      name: z.name,
      recommendName: z.name,
      address: z.address,
      ownership: z.ownership,
      zoneLabel: z.zoneLabel,
      landPrice: Number(z.landPrice),
    })
    handleClose()
  }

  const summary = [projectName, orderDept, constructionType].filter(Boolean).join(' · ')

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="입지분석"
      onClick={handleClose}
    >
      <div
        className="relative flex w-full max-h-[calc(100dvh-5rem)] min-h-0 flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-4 py-2.5 pr-10">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">입지분석</p>
            {summary ? (
              <p className="truncate text-[10px] text-slate-500" title={summary}>
                {summary}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-2 top-2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3 text-xs">
          {phase === 'conditions' && (
            <>
              <p className="text-[9px] text-slate-400">
                *데이터양에 따라 검색 속도가 오래 걸릴 수 있습니다. 오른쪽 지도는 그대로 볼 수
                있습니다.
              </p>
              <p className="text-[10px] font-semibold text-teal-700">사업개요</p>
              <Accordion
                title="사업지역"
                open={openBlocks.has('region')}
                onToggle={() => toggleBlock('region')}
              >
                <div className="space-y-1.5">
                  <FieldRow label="읍면동">
                    <div className="grid grid-cols-2 gap-1">
                      <select
                        className={inputCls}
                        value={cond.eupMyeonDong}
                        onChange={(e) => setCond((p) => ({ ...p, eupMyeonDong: e.target.value }))}
                      >
                        {EUP_MYEON_DONG.map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                      </select>
                      <select
                        className={inputCls}
                        value={cond.eupDetail}
                        onChange={(e) => setCond((p) => ({ ...p, eupDetail: e.target.value }))}
                      >
                        <option value="전체">전체</option>
                      </select>
                    </div>
                  </FieldRow>
                  <FieldRow label="사업면적">
                    <select
                      className={inputCls}
                      value={cond.areaSize}
                      onChange={(e) => setCond((p) => ({ ...p, areaSize: e.target.value }))}
                    >
                      {AREA_SIZE_OPTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </FieldRow>
                </div>
              </Accordion>

              <p className="pt-1 text-[10px] font-semibold text-teal-700">분석조건</p>
              <Accordion
                title="공시지가"
                open={openBlocks.has('price')}
                onToggle={() => toggleBlock('price')}
                hint="*데이터 없을 시 정보를 찾을 수 없습니다."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={cond.landPriceEnabled}
                      onChange={(e) =>
                        setCond((p) => ({ ...p, landPriceEnabled: e.target.checked }))
                      }
                    />
                    공시지가
                  </label>
                  <input
                    className={cn(inputCls, 'w-28 tabular-nums')}
                    value={cond.landPrice}
                    disabled={!cond.landPriceEnabled}
                    onChange={(e) => setCond((p) => ({ ...p, landPrice: e.target.value }))}
                    placeholder="원/㎡"
                    inputMode="numeric"
                  />
                  {(['gte', 'lte'] as const).map((dir) => (
                    <label
                      key={dir}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-600"
                    >
                      <input
                        type="radio"
                        name="landPriceDir"
                        checked={cond.landPriceDir === dir}
                        disabled={!cond.landPriceEnabled}
                        onChange={() => setCond((p) => ({ ...p, landPriceDir: dir }))}
                      />
                      {dir === 'gte' ? '이상' : '이하'}
                    </label>
                  ))}
                </div>
              </Accordion>

              <Accordion
                title="사유지구분"
                open={openBlocks.has('owner')}
                onToggle={() => toggleBlock('owner')}
              >
                <ul className="space-y-1">
                  {OWNERSHIP_OPTIONS.map(({ key, label }) => {
                    const row = cond.ownership[key]
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center gap-2 border-b border-slate-50 py-1 last:border-0"
                      >
                        <label className="inline-flex min-w-[4.5rem] items-center gap-1 text-[11px] text-slate-700">
                          <input
                            type="checkbox"
                            checked={row.checked}
                            onChange={(e) => setOwnership(key, { checked: e.target.checked })}
                          />
                          {label}
                        </label>
                        {(['include', 'exclude'] as const).map((mode) => (
                          <label
                            key={mode}
                            className="inline-flex items-center gap-1 text-[10px] text-slate-600"
                          >
                            <input
                              type="radio"
                              name={`own-${key}`}
                              checked={row.mode === mode}
                              disabled={!row.checked}
                              onChange={() => setOwnership(key, { mode })}
                            />
                            {mode === 'include' ? '포함' : '제외'}
                          </label>
                        ))}
                      </li>
                    )
                  })}
                </ul>
              </Accordion>

              <Accordion
                title="용도지역"
                open={openBlocks.has('zone')}
                onToggle={() => toggleBlock('zone')}
              >
                <div className="space-y-1">
                  {ZONE_GROUPS.map((group) => {
                    const gOpen = openZoneGroups.has(group.id)
                    return (
                      <div key={group.id} className="rounded border border-slate-100">
                        <button
                          type="button"
                          onClick={() => toggleZoneGroup(group.id)}
                          className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-slate-50"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 text-amber-500 transition-transform',
                              gOpen && 'rotate-180'
                            )}
                          />
                          <span className="text-[10px] font-semibold text-slate-700">
                            {group.label}
                          </span>
                        </button>
                        {gOpen && (
                          <ul className="border-t border-slate-100 px-2 py-1">
                            {group.items.map((item) => {
                              const row = cond.zones[item.id]
                              return (
                                <li
                                  key={item.id}
                                  className="flex flex-wrap items-center gap-1.5 border-b border-slate-50 py-1 last:border-0"
                                >
                                  <label className="inline-flex min-w-[7.5rem] flex-1 items-center gap-1 text-[10px] text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={row.checked}
                                      onChange={(e) =>
                                        setZone(item.id, { checked: e.target.checked })
                                      }
                                    />
                                    {item.label}
                                  </label>
                                  {(['include', 'conflict', 'exclude'] as const).map((mode) => (
                                    <label
                                      key={mode}
                                      className="inline-flex items-center gap-0.5 text-[9px] text-slate-600"
                                    >
                                      <input
                                        type="radio"
                                        name={`zone-${item.id}`}
                                        checked={row.mode === mode}
                                        disabled={!row.checked}
                                        onChange={() => setZone(item.id, { mode })}
                                      />
                                      {mode === 'include'
                                        ? '포함'
                                        : mode === 'conflict'
                                          ? '저촉'
                                          : '제외'}
                                    </label>
                                  ))}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Accordion>
            </>
          )}

          {phase === 'results' && (
            <>
              <p className="text-[10px] text-slate-500">
                조건에 맞는 추천 구역입니다. (예시 · 지도 표출은 후속)
              </p>
              <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
                {results.map((z) => {
                  const selected = selectedId === z.id
                  return (
                    <li key={z.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(z.id)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 px-2.5 py-2 text-left',
                          selected ? 'bg-primary/10' : 'hover:bg-slate-50'
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-800">{z.name}</span>
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[9px] font-semibold',
                              selected ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            {selected ? '선택' : '후보'}
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-500">{z.address}</span>
                        <span className="text-[10px] tabular-nums text-slate-600">
                          {z.areaM2.toLocaleString('ko-KR')}㎡ ·{' '}
                          {z.landPrice.toLocaleString('ko-KR')}원/㎡ · {z.ownership} · {z.zoneLabel}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5">
          {phase === 'conditions' ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleClose}
              >
                닫기
              </Button>
              <Button type="button" size="sm" className="h-7 text-xs" onClick={handleSearch}>
                추천 조회
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPhase('conditions')}
              >
                조건 수정
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={!selectedId}
                onClick={handleApply}
              >
                이 구역으로 적용
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
