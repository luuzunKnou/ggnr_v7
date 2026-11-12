'use client'

import { useMemo, useState } from 'react'
import { SmallPublicAttrTable } from '../smallPublicUi'
import { planWorkloadM, rankPlans, toMillion, todayYmd, yearLabel, type PlanRanked } from './smallPublicPlanCalc'
import { useSmallPublicPlanStore } from './smallPublicPlanStore'
import { PlanStatusBadge } from './smallPublicPlanUi'

/** 시설이 들어간 정비계획(없으면 null)과 전체 계획 수 */
export function useSmallPublicPlanOfFacility(facilityId: string): { ranked: PlanRanked | null; total: number } {
  const { units } = useSmallPublicPlanStore()
  const [baseDate] = useState(todayYmd)
  const all = useMemo(() => rankPlans(units, baseDate), [units, baseDate])
  return { ranked: all.find((r) => r.unit.facilityId === facilityId) ?? null, total: all.length }
}

/** 후보지 상세 «정비계획» 탭 — 계획·상태·순위·단계·연차·사업량·사업비 */
export function SmallPublicPlanFacilitySummary({ ranked: r, total }: { ranked: PlanRanked; total: number }) {
  const v = r.version
  const workload = planWorkloadM(v)
  return (
    <SmallPublicAttrTable
      entries={[
        { key: 'plan', label: '계획', value: v.reported?.planName ?? '정비계획 분석', full: true },
        { key: 'status', label: '상태', value: <PlanStatusBadge status={v.status} /> },
        { key: 'rank', label: '우선순위', value: `${r.finalRank}위 / ${total}` },
        { key: 'phase', label: '단계', value: `${r.phase}단계` },
        { key: 'year', label: '연차', value: yearLabel(r.yearNo) },
        { key: 'workload', label: '사업량', value: workload ? `${Math.round(workload).toLocaleString('ko-KR')}m` : '—' },
        { key: 'cost', label: '사업비', value: `${toMillion(r.summary.cost.total)}백만원` },
        { key: 'score', label: '총점', value: `${r.summary.total}점` },
      ]}
    />
  )
}
