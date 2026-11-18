'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import type { SmallPublicFacility } from '../smallPublicMock'
import { ensureSmallPublicSeed, useSmallPublicStore } from '../smallPublicStore'
import { applyConstructionToUnits } from '../budget/smallPublicBudgetCalc'
import { useSmallPublicBudgetStore } from '../budget/smallPublicBudgetStore'
import { exportSmallPublicPlanExcel } from './exportSmallPublicPlanExcel'
import { rankPlans, todayYmd } from './smallPublicPlanCalc'
import { smallPublicPlanActions, useSmallPublicPlanStore } from './smallPublicPlanStore'
import { canLinkToBudget, currentVersion, isPlanInAnalysis } from './smallPublicPlanTypes'
import { SmallPublicPlanAnalysisModal } from './SmallPublicPlanAnalysisModal'
import { SmallPublicPlanBudgetLinkModal } from './SmallPublicPlanBudgetLinkModal'
import { SmallPublicPlanFixedModal } from './SmallPublicPlanFixedModal'
import { SmallPublicPlanAnalyzePickModal } from './SmallPublicPlanModals'
import { SmallPublicPlanSheet, type SmallPublicPlanFilter } from './SmallPublicPlanSheet'

const MIN_WIDTH = 720

function subscribeResize(cb: () => void) {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

/** 브라우저 너비 */
function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1600)
}

const noopSubscribe = () => () => undefined

/** 브라우저에서만 true — 서버 렌더에서는 body 포털을 만들지 않는다 */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  /** 예산 계획 후 예산·공사 화면으로 전환 */
  onOpenBudget?: () => void
}

/**
 * 정비계획 — 지도 없이 사이드바 오른쪽을 꽉 채운 중기계획 명세서.
 * 레이어 관리 패널처럼 body 포털로 띄워 오른쪽 지도 메뉴를 덮고, 닫으면 다시 보인다.
 * 모달은 그 위(z 80)에 뜬다.
 * 추정·검토 행은 분석 모달, 확정 이후 행은 개요·결과 모달. «분석»은 새 위험시설·분석 중 시설을 골라 분석 모달.
 * 입력 완료 추정·확정 시설을 골라 «예산 계획»으로 예산 배정(1차). 예산·공사 준공 실적은 «정비된 부분»에 합쳐 보여 준다.
 */
export function SmallPublicPlanShell({ leftOffsetPx, onTotalWidthChange, onClose, onOpenBudget }: Props) {
  const { data: session } = useSession()
  const userName = session?.user?.name?.trim() || session?.user?.id || '미확인'
  const { facilities } = useSmallPublicStore()
  const { units, analyzeRequest } = useSmallPublicPlanStore()
  const { constructions } = useSmallPublicBudgetStore()
  useEffect(() => {
    void ensureSmallPublicSeed()
  }, [])
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const width = Math.max(MIN_WIDTH, viewport - leftOffsetPx)
  const [baseDate] = useState(todayYmd)
  const [startYear, setStartYear] = useState(() => new Date().getFullYear())
  const [openId, setOpenId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [budgetLinkOpen, setBudgetLinkOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<SmallPublicPlanFilter>({ keyword: '', emd: '', status: '' })
  const handledAnalyzeSeq = useRef(0)

  useEffect(() => {
    onTotalWidthChange(width)
  }, [width, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  /** 준공 공사 실적(정비된 부분)·공사 상태(진행·완료)를 합친 계획 */
  const applied = useMemo(() => applyConstructionToUnits(units, constructions), [units, constructions])
  const ranked = useMemo(() => rankPlans(applied, baseDate), [applied, baseDate])
  const emdOptions = useMemo(
    () => [...new Set(units.map((u) => u.emd))].sort((a, b) => a.localeCompare(b, 'ko')),
    [units]
  )
  const rows = useMemo(() => {
    const q = filter.keyword.trim().toLowerCase()
    return ranked
      .filter((r) => !filter.emd || r.unit.emd === filter.emd)
      .filter((r) => !filter.status || currentVersion(r.unit).status === filter.status)
      .filter((r) => !q || [r.unit.unitName, r.unit.ri, r.unit.emd].join(' ').toLowerCase().includes(q))
  }, [ranked, filter])

  const facilityById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities])
  const unitByFacility = useMemo(() => new Map(units.map((u) => [u.facilityId, u])), [units])

  /** 분석 대상 — 위험시설 중 정비계획에 없는 시설(분석 중인 시설은 명세서 행에서 연다) */
  const analysisTargets = useMemo(
    () => facilities.filter((f) => f.candidate === '위험' && !unitByFacility.has(f.id)),
    [facilities, unitByFacility]
  )

  const opened = openId ? (ranked.find((r) => r.unit.id === openId) ?? null) : null
  const overlay = { overlayLeftPx: leftOffsetPx, overlayWidthPx: width }

  const analyze = (f: SmallPublicFacility) => {
    const unit = smallPublicPlanActions.addUnit(f, userName)
    setPicking(false)
    setOpenId(unit.id)
  }

  const toggleSelect = (unitId: string) => {
    const r = ranked.find((x) => x.unit.id === unitId)
    if (!r || !canLinkToBudget(r)) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  const toggleSelectAllShown = () => {
    const linkable = rows.filter((r) => canLinkToBudget(r))
    const allOn = linkable.length > 0 && linkable.every((r) => selectedIds.has(r.unit.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allOn) {
        for (const r of linkable) next.delete(r.unit.id)
      } else {
        for (const r of linkable) next.add(r.unit.id)
      }
      return next
    })
  }

  const budgetLinkRows = useMemo(
    () =>
      ranked
        .filter((r) => selectedIds.has(r.unit.id) && canLinkToBudget(r))
        .map((r) => ({ ranked: r, defaultAmountWon: r.summary.cost.total })),
    [ranked, selectedIds]
  )

  const openBudgetLink = () => {
    if (budgetLinkRows.length === 0) {
      window.alert(
        '입력 완료된 추정·확정 시설을 먼저 선택하세요. (입력이 남은 추정·검토 중 시설은 예산 계획할 수 없습니다)'
      )
      return
    }
    setBudgetLinkOpen(true)
  }

  /** 안전점검 «정비계획 이관» — 시설을 모두 분석 목록에 넣고(닫아도 유지) 첫 건을 연다 */
  useEffect(() => {
    if (!analyzeRequest || analyzeRequest.seq === handledAnalyzeSeq.current) return
    handledAnalyzeSeq.current = analyzeRequest.seq
    const ids = analyzeRequest.facilityIds
    smallPublicPlanActions.clearAnalyzeRequest()
    setPicking(false)

    const toAdd: SmallPublicFacility[] = []
    let firstOpenId: string | null = null
    for (const facilityId of ids) {
      const existing = unitByFacility.get(facilityId)
      if (existing) {
        if (!firstOpenId) firstOpenId = existing.id
        continue
      }
      const f = facilityById.get(facilityId)
      if (!f || f.candidate !== '위험') continue
      toAdd.push(f)
    }
    const added = toAdd.length > 0 ? smallPublicPlanActions.addUnits(toAdd, userName) : []
    if (!firstOpenId && added[0]) firstOpenId = added[0].id
    if (firstOpenId) setOpenId(firstOpenId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seq만 트리거
  }, [analyzeRequest?.seq])

  return (
    <>
      {isClient
        ? createPortal(
            <div
              className="pointer-events-auto fixed inset-y-0 right-0 z-[55] flex flex-col border-l border-border bg-background shadow-lg"
              style={{ left: leftOffsetPx }}
            >
              <SmallPublicPlanSheet
                filter={filter}
                onFilterChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
                emdOptions={emdOptions}
                startYear={startYear}
                onStartYearChange={setStartYear}
                rows={rows}
                all={ranked}
                needAnalysis={analysisTargets.length}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAllShown={toggleSelectAllShown}
                onOpenBudgetLink={openBudgetLink}
                onOpen={setOpenId}
                onAnalyze={() => setPicking(true)}
                onExport={() => {
                  void exportSmallPublicPlanExcel(ranked, startYear).catch(() => window.alert('엑셀 파일을 만들지 못했습니다.'))
                }}
                onClose={onClose}
              />
            </div>,
            document.body
          )
        : null}

      {opened && isPlanInAnalysis(opened.version) ? (
        <SmallPublicPlanAnalysisModal
          key={`${opened.unit.id}-${opened.version.status}`}
          {...overlay}
          unit={opened.unit}
          units={units}
          facility={facilityById.get(opened.unit.facilityId) ?? null}
          baseDate={baseDate}
          startYear={startYear}
          userName={userName}
          onClose={() => setOpenId(null)}
        />
      ) : opened ? (
        <SmallPublicPlanFixedModal
          {...overlay}
          ranked={opened}
          facility={facilityById.get(opened.unit.facilityId) ?? null}
          startYear={startYear}
          onClose={() => setOpenId(null)}
        />
      ) : null}
      {picking ? (
        <SmallPublicPlanAnalyzePickModal {...overlay} facilities={analysisTargets} onCancel={() => setPicking(false)} onPicked={analyze} />
      ) : null}
      {budgetLinkOpen ? (
        <SmallPublicPlanBudgetLinkModal
          {...overlay}
          rows={budgetLinkRows}
          onCancel={() => setBudgetLinkOpen(false)}
          onDone={(budget, linkedCount) => {
            setBudgetLinkOpen(false)
            setSelectedIds(new Set())
            window.alert(`«${budget.title}»에 ${linkedCount}곳을 배정했습니다.`)
            onOpenBudget?.()
          }}
        />
      ) : null}
    </>
  )
}
