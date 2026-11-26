'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { call } from '@/lib/api'
import { exportSmallPublicPlanExcel } from './exportSmallPublicPlanExcel'
import type { PlanDbPeriod, PlanDbRow, PlanSaveEntry, PlanSheetPayload } from './smallPublicPlanDb'
import { useSmallPublicPlanRefreshSeq } from './smallPublicPlanRefresh'
import { SmallPublicPlanPeriodModal } from './SmallPublicPlanPeriodModal'
import { SmallPublicPlanSheet, type SmallPublicPlanFilter } from './SmallPublicPlanSheet'

const MIN_WIDTH = 720

function subscribeResize(cb: () => void) {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1600)
}

const noopSubscribe = () => () => undefined

function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

type ServiceResult<T> = ({ success?: boolean; error?: string } & T) | undefined

async function callPlanService<T>(action: string, params: Record<string, unknown>): Promise<ServiceResult<T>> {
  const res = await call('', 'POST', { service: 'smallPublicPlanService', action, params })
  return (res?.data ?? res) as ServiceResult<T>
}

/**
 * 정비계획 — DB(정비계획·계획시설) 기준 중기 명세서. 시설명·위치는 관리번호로 시설/묶음에서 조회.
 */
export function SmallPublicPlanShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const width = Math.max(MIN_WIDTH, viewport - leftOffsetPx)
  const refreshSeq = useSmallPublicPlanRefreshSeq()

  const [periods, setPeriods] = useState<PlanDbPeriod[]>([])
  const [planId, setPlanId] = useState<number | null>(null)
  const [dbRows, setDbRows] = useState<PlanDbRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadSeq, setLoadSeq] = useState(0)
  const [filter, setFilter] = useState<SmallPublicPlanFilter>({ keyword: '', emd: '' })
  const [periodModalOpen, setPeriodModalOpen] = useState(false)
  const planIdRef = useRef<number | null>(null)

  useEffect(() => {
    onTotalWidthChange(width)
  }, [width, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  /** 연도구간(미지정 시 서버 기본)의 명세서를 불러온다 */
  const load = useCallback(async (requested: number | null): Promise<boolean> => {
    try {
      const data = await callPlanService<PlanSheetPayload>('getPlanSheet', requested == null ? {} : { planId: requested })
      if (!data || data.success === false || !Array.isArray(data.rows) || !Array.isArray(data.plans)) {
        setLoadError(data?.error ?? '응답 오류')
        setLoading(false)
        return false
      }
      planIdRef.current = data.planId
      setPeriods(data.plans)
      setPlanId(data.planId)
      setDbRows(data.rows)
      setLoadError('')
      setLoadSeq((s) => s + 1)
      setLoading(false)
      return true
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '요청 실패')
      setLoading(false)
      return false
    }
  }, [])

  /** 최초 진입·이관 직후 다시 불러오기 */
  useEffect(() => {
    void load(planIdRef.current)
  }, [load, refreshSeq])

  const handlePlanChange = useCallback(
    (next: number) => {
      setLoading(true)
      void load(next)
    },
    [load]
  )

  const handleSave = useCallback(
    async (entries: PlanSaveEntry[]): Promise<boolean> => {
      if (planId == null) return false
      try {
        const data = await callPlanService<object>('savePlanRows', { planId, entries })
        if (!data || data.success === false) return false
        await load(planId)
        return true
      } catch {
        return false
      }
    },
    [planId, load]
  )

  const handleRegisterPeriod = useCallback(
    async ({ startYear, endYear }: { startYear: number; endYear: number }) => {
      try {
        const data = await callPlanService<{ planId?: number }>('createPlanPeriod', { startYear, endYear })
        if (!data || data.success === false || data.planId == null) {
          window.alert(data?.error ?? '연도를 등록하지 못했습니다.')
          return
        }
        setLoading(true)
        await load(data.planId)
      } catch {
        window.alert('연도를 등록하지 못했습니다.')
      }
    },
    [load]
  )

  const startYear = useMemo(
    () => periods.find((p) => p.id === planId)?.startYear ?? new Date().getFullYear(),
    [periods, planId]
  )
  const emdOptions = useMemo(
    () =>
      [...new Set(dbRows.map((r) => r.emd).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [dbRows]
  )
  const rows = useMemo(() => {
    const q = filter.keyword.trim().toLowerCase()
    return dbRows
      .filter((r) => !filter.emd || r.emd === filter.emd)
      .filter((r) => !q || [r.name, r.ri, r.emd].join(' ').toLowerCase().includes(q))
  }, [dbRows, filter])

  return (
    <>
      {isClient
        ? createPortal(
            <div
              className="pointer-events-auto fixed inset-y-0 right-0 z-[55] flex flex-col border-l border-border bg-background shadow-lg"
              style={{ left: leftOffsetPx }}
            >
              <SmallPublicPlanSheet
                key={`${planId ?? 'none'}-${loadSeq}`}
                filter={filter}
                onFilterChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
                emdOptions={emdOptions}
                periods={periods}
                planId={planId}
                onPlanChange={handlePlanChange}
                onRegisterPeriod={() => setPeriodModalOpen(true)}
                startYear={startYear}
                rows={rows}
                all={dbRows}
                loading={loading}
                loadError={loadError}
                onSave={handleSave}
                onExport={() => {
                  /** 화면에서 고른 연도구간·읍면 그대로 내려받기 (연도구간은 불러온 명세서가 이미 그 구간) */
                  const target = filter.emd ? dbRows.filter((r) => r.emd === filter.emd) : dbRows
                  void exportSmallPublicPlanExcel(target, startYear, filter.emd).catch(() =>
                    window.alert('엑셀 파일을 만들지 못했습니다.')
                  )
                }}
                onClose={onClose}
              />
            </div>,
            document.body
          )
        : null}
      {periodModalOpen ? (
        <SmallPublicPlanPeriodModal
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={width}
          defaultStartYear={startYear}
          onClose={() => setPeriodModalOpen(false)}
          onRegister={(period) => void handleRegisterPeriod(period)}
        />
      ) : null}
    </>
  )
}
