'use client'

import type { SmallPublicFacility } from '../smallPublicMock'
import { SmallPublicAttrTable, SmallPublicClassBadge, smallPublicDateLabel } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { EVAL_ITEMS, SUPP_ITEMS } from './smallPublicPlanMaster'
import { planScaleText, planWorkloadM, toMillion, yearLabel, type PlanRanked } from './smallPublicPlanCalc'
import { PLAN_STATUS_LABEL } from './smallPublicPlanTypes'
import { PlanSection } from './smallPublicPlanUi'

const num = (n: number | null | undefined, unit = '') => (n == null ? '—' : `${n.toLocaleString('ko-KR')}${unit}`)

/**
 * 확정 이후 계획 — 개요와 결과만. 기존 정비계획(보고서)은 중간 평가 내용이 없어 분석 단계를 보여 주지 않는다.
 */
export function SmallPublicPlanFixedModal({
  ranked: r,
  facility: f,
  startYear,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  ranked: PlanRanked
  facility: SmallPublicFacility | null
  startYear: number
  onClose: () => void
}) {
  const v = r.version
  const rep = v.reported
  const s = r.summary
  const workload = planWorkloadM(v)
  const spec = f ? [f.length && `연장 ${f.length}m`, f.width && `폭 ${f.width}m`, f.height && `높이 ${f.height}m`].filter(Boolean).join(' · ') : ''

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={`${r.unit.unitName} 정비계획`}
      subtitle={`${PLAN_STATUS_LABEL[v.status]} · ${rep?.planName ?? ''}`}
      showHeaderClose
      onClose={onClose}
    >
      <div className="text-xs">
        <PlanSection title="개요">
          <SmallPublicAttrTable
            entries={[
              { key: 'type', label: '유형', value: r.unit.type },
              { key: 'class', label: '현재 구분', value: f ? <SmallPublicClassBadge candidate={f.candidate} /> : '시설 자료 없음' },
              { key: 'loc', label: '위치', value: r.unit.location || [r.unit.emd, r.unit.ri].filter(Boolean).join(' '), full: true },
              { key: 'spec', label: '제원', value: spec || '—' },
              { key: 'designated', label: '위험시설 지정일', value: smallPublicDateLabel(v.designatedOn ?? '') || '—' },
              { key: 'scale', label: '사업규모', value: planScaleText(v) || '—', full: true },
              { key: 'measure', label: '저감대책', value: rep?.measure || v.measure || '—', full: true },
            ]}
          />
        </PlanSection>
        <PlanSection title="결과">
          <SmallPublicAttrTable
            entries={[
              { key: 'rank', label: '우선순위', value: `기초 ${r.baseRank}위 · 최종 ${r.finalRank}위` },
              { key: 'phase', label: '단계·연차', value: `${r.phase}단계 · ${yearLabel(r.yearNo, startYear)}` },
              { key: 'cost', label: '사업비', value: `${toMillion(s.cost.total)}백만원` },
              { key: 'workload', label: '사업량', value: num(workload || null, 'm') },
              { key: 'total', label: '총점', value: `${s.total}점` },
              {
                key: 'supp',
                label: '부가적 평가',
                value: rep?.supp ? SUPP_ITEMS.map((x) => `${x.name} ${rep.supp![x.code]}`).join(' · ') : '—',
              },
              ...EVAL_ITEMS.map((i) => ({
                key: i.code,
                label: i.name,
                value: s.scores[i.code].score == null ? '—' : `${s.scores[i.code].score} / ${i.max}점`,
              })),
              {
                key: 'done',
                label: '정비된 부분',
                value: v.done ? `${num(v.done.qty, 'm')} · ${toMillion(v.done.costWon)}백만원` : '없음',
                full: true,
              },
            ]}
          />
        </PlanSection>
      </div>
    </SmallPublicModalShell>
  )
}
