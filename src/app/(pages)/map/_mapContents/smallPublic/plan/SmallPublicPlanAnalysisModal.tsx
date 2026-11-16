'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, FileDown, Save, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { smallPublicBtnDanger, smallPublicBtnGhost, smallPublicBtnPrimary } from '../smallPublicConfig'
import type { SmallPublicFacility } from '../smallPublicMock'
import { latestInspectionOf, useSmallPublicStore } from '../smallPublicStore'
import { SmallPublicClassBadge, SmallPublicGradeBadge, smallPublicDateLabel } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { EVAL_ITEMS } from './smallPublicPlanMaster'
import {
  planEffect,
  planScaleText,
  planWorkloadM,
  rankPlans,
  summarizePlan,
  toMillion,
  yearLabel,
  type PlanRanked,
  type PlanStepKey,
} from './smallPublicPlanCalc'
import { downloadPlanAnalysisReport, planBasisRows } from './smallPublicPlanAnalysisReport'
import { smallPublicPlanActions } from './smallPublicPlanStore'
import { PlanStepCost, PlanStepEval, PlanStepWorks, type PlanStepProps } from './SmallPublicPlanSteps'
import { currentVersion, type PlanUnit, type PlanVersion } from './smallPublicPlanTypes'
import { PlanSection, PlanSourceBadge, PlanTableWrap, planTableClass, planText } from './smallPublicPlanUi'

const STEPS: { key: PlanStepKey; label: string; desc: string }[] = [
  { key: 'works', label: '정비내용', desc: '공종·수량 확인' },
  { key: 'cost', label: '사업비·보상', desc: '편입 필지·기타 금액' },
  { key: 'eval', label: '평가', desc: '기본적·부가적 평가' },
  { key: 'result', label: '결과', desc: '순위·산출근거 확인' },
]

type Props = SmallPublicModalOverlay & {
  unit: PlanUnit
  units: PlanUnit[]
  facility: SmallPublicFacility | null
  baseDate: string
  /** 명세서 1차년 연도 */
  startYear: number
  userName: string
  onClose: () => void
}

/** 입력이 남으면 정비내용부터. 모두 채워져 있으면 결과 */
function initialPlanStep(v: PlanVersion, onDate: string): PlanStepKey {
  return summarizePlan(v, onDate).missingCount === 0 ? 'result' : 'works'
}

/**
 * 새 위험시설 정비계획 분석 — 정비내용 → 사업비·보상 → 평가 → 결과(자동).
 * 피해이력은 시작할 때 후보지에서 가져오고, 분석에서 추가·수정할 수 있다.
 * 입력은 이 화면에만 두었다가 «저장»으로 계획에 넣는다. 추정 상태 분석은 삭제할 수 있다.
 * 정비계획 «분석»으로 연 미저장 건은 닫으면 목록에서 빼고, 이관으로 온 건은 닫아도 남긴다.
 * 목록에서 열 때: 입력이 남으면 정비내용부터, 다 채워져 있으면 결과로 연다.
 */
export function SmallPublicPlanAnalysisModal({ unit, units, facility: f, baseDate, startYear, userName, onClose, ...overlay }: Props) {
  const { inspections } = useSmallPublicStore()
  const saved = currentVersion(unit)
  const [draft, setDraft] = useState<PlanVersion>(() => structuredClone(saved))
  const [dirty, setDirty] = useState(false)
  const [step, setStep] = useState<PlanStepKey>(() => initialPlanStep(saved, baseDate))
  const readOnly = saved.status !== 'DRAFT'

  const update = (fn: (v: PlanVersion) => PlanVersion) => {
    if (readOnly) return
    setDraft(fn)
    setDirty(true)
  }

  const summary = useMemo(() => summarizePlan(draft, baseDate), [draft, baseDate])
  const ranked = useMemo(
    () => rankPlans(units, baseDate, { unitId: unit.id, version: draft }),
    [units, baseDate, unit.id, draft]
  )
  const savedRanked = useMemo(() => rankPlans(units, baseDate), [units, baseDate])
  const me = ranked.find((r) => r.unit.id === unit.id)!
  const mePrev = savedRanked.find((r) => r.unit.id === unit.id)!
  const latest = f ? latestInspectionOf(inspections, f.id) : null
  const everSaved = unit.history.some((h) => h.text.startsWith('저장'))

  const save = () => {
    smallPublicPlanActions.saveVersion(unit.id, draft, userName, `저장 (총점 ${summary.total}, 사업비 ${toMillion(summary.cost.total)}백만원)`)
    setDirty(false)
  }

  const close = () => {
    /**
     * 정비계획 «분석»으로 새로 연 추정만 — 한 번도 저장하지 않고 닫으면 목록에서 뺀다.
     * 안전점검 이관(retainOnClose)은 이미 목록에 넘긴 건이므로 닫아도 남긴다.
     */
    const discardIfUnsaved =
      saved.status === 'DRAFT' && saved.origin === 'ANALYSIS' && !everSaved && !unit.retainOnClose
    if (discardIfUnsaved) {
      if (dirty && !window.confirm('저장하지 않으면 목록에 남지 않습니다. 닫을까요?')) return
      smallPublicPlanActions.deleteUnit(unit.id)
      onClose()
      return
    }
    if (dirty && !window.confirm('저장하지 않은 입력이 있습니다. 닫을까요?')) return
    onClose()
  }

  const remove = () => {
    if (!window.confirm(`«${unit.unitName}» 분석을 삭제할까요? 입력한 내용이 모두 지워집니다.`)) return
    smallPublicPlanActions.deleteUnit(unit.id)
    onClose()
  }

  const download = () => {
    void downloadPlanAnalysisReport(unit, draft, summary, me, baseDate).catch(() => window.alert('보고서를 만들지 못했습니다.'))
  }

  const stepIdx = STEPS.findIndex((s) => s.key === step)
  const missingByStep = (key: PlanStepKey) => summary.checks.filter((c) => c.step === key && !c.done).length
  const stepProps: PlanStepProps = { draft, update, readOnly, facility: f, baseDate, summary }
  const spec = facilitySpec(f)

  return (
    <SmallPublicModalShell
      {...overlay}
      size="full"
      title={`${unit.unitName} 정비계획 분석`}
      showHeaderClose
      onClose={close}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <div className="flex w-full items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button type="button" className={smallPublicBtnGhost} onClick={download}>
              <FileDown className="h-3 w-3" />
              보고서
            </button>
            <span className={cn(planText.body, 'hidden text-destructive lg:inline')}>
              ※ 개략 산정값이며 참고용입니다. 실제 사업비·보상과는 다를 수 있습니다.
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button type="button" className={smallPublicBtnGhost} disabled={stepIdx === 0} onClick={() => setStep(STEPS[stepIdx - 1]!.key)}>
              <ChevronLeft className="h-3 w-3" />
              이전
            </button>
            <button type="button" className={smallPublicBtnGhost} disabled={stepIdx === STEPS.length - 1} onClick={() => setStep(STEPS[stepIdx + 1]!.key)}>
              다음
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button type="button" className={smallPublicBtnPrimary} disabled={readOnly || !dirty} onClick={save}>
              <Save className="h-3 w-3" />
              저장
            </button>
            {saved.status === 'DRAFT' ? (
              <button type="button" className={smallPublicBtnDanger} onClick={remove}>
                <Trash2 className="h-3 w-3" />
                삭제
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/15 px-3 py-4 scrollbar-hide">
          <div>
            <p className={cn(planText.label, 'mb-1.5 px-1 text-muted-foreground')}>시설 정보</p>
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <table className="w-full table-fixed border-collapse text-[12px] font-normal [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-middle [&_th]:font-medium [&_th]:text-muted-foreground [&_tr:last-child_td]:border-b-0 [&_tr:last-child_th]:border-b-0">
                <colgroup>
                  <col className="w-[5.25rem]" />
                  <col />
                </colgroup>
                <tbody>
                  <InfoRow label="시설명" value={<span className="font-medium">{unit.unitName}</span>} />
                  <InfoRow label="유형" value={unit.type} />
                  <InfoRow
                    label="위치"
                    nowrap
                    value={f?.address || unit.location || [unit.emd, unit.ri].filter(Boolean).join(' ') || '—'}
                  />
                  <InfoRow label="제원" value={spec || '—'} />
                  <InfoRow label="평가구분" value={f ? <SmallPublicClassBadge candidate={f.candidate} /> : '—'} />
                  <InfoRow
                    label="평가일"
                    value={latest ? <span className="tabular-nums">{smallPublicDateLabel(latest.date)}</span> : '—'}
                  />
                  <InfoRow label="등급" value={latest ? <SmallPublicGradeBadge grade={latest.grade} /> : '—'} />
                  <InfoRow label="지정일" value={<span className="tabular-nums">{smallPublicDateLabel(draft.designatedOn ?? '') || '—'}</span>} />
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className={cn(planText.label, 'mb-1.5 px-1 text-muted-foreground')}>분석 순서</p>
            <ol aria-label="분석 단계">
              {STEPS.map((s, i) => {
                const miss = s.key === 'result' ? 0 : missingByStep(s.key)
                const on = s.key === step
                const done = s.key !== 'result' && miss === 0
                return (
                  <li key={s.key} className="relative">
                    {i < STEPS.length - 1 ? <span className="absolute left-[1.1rem] top-7 h-[calc(100%-1.25rem)] w-px bg-border" aria-hidden /> : null}
                    <button
                      type="button"
                      onClick={() => setStep(s.key)}
                      className={cn('relative flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors', on ? 'bg-primary/10' : 'hover:bg-muted')}
                    >
                      <span
                        className={cn(
                          planText.caption,
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border tabular-nums',
                          on
                            ? 'border-primary bg-primary font-medium text-primary-foreground'
                            : done
                              ? 'border-emerald-500 bg-emerald-500 font-medium text-white'
                              : 'border-border bg-background text-muted-foreground'
                        )}
                      >
                        {!on && done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block', planText.bodyEm, on ? 'text-primary' : 'text-foreground')}>{s.label}</span>
                        <span className={cn(planText.caption, 'block', miss > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                          {miss > 0 ? `입력 필요 ${miss}건` : s.desc}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
          {dirty ? (
            <p
              className={cn(
                planText.caption,
                'mt-auto space-y-0.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
              )}
            >
              <span className="block">저장하지 않은 입력이 있습니다.</span>
              <span className="block">«저장»을 누르세요.</span>
            </p>
          ) : null}
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto bg-muted/10 px-5 py-4 scrollbar-thin">
          <h3 className={cn(planText.section, 'mb-3 text-foreground')}>
            {stepIdx + 1}. {STEPS[stepIdx]!.label}
          </h3>
          {step === 'works' ? <PlanStepWorks {...stepProps} /> : null}
          {step === 'cost' ? <PlanStepCost {...stepProps} /> : null}
          {step === 'eval' ? <PlanStepEval {...stepProps} /> : null}
          {step === 'result' ? (
            <PlanStepResult {...stepProps} unit={unit} me={me} mePrev={mePrev} ranked={ranked} startYear={startYear} />
          ) : null}
        </div>

        <aside className="w-64 shrink-0 space-y-2 overflow-y-auto border-l border-border bg-muted/15 px-3 py-4 scrollbar-hide">
          <p className={cn(planText.label, 'px-1 text-muted-foreground')}>계산 결과</p>
          <SideCard label="총점">
            <div className="flex items-baseline gap-1">
              <span className={cn(planText.kpi, 'text-primary')}>{summary.total}</span>
              <span className={cn(planText.body, 'text-muted-foreground')}>/ 100점</span>
              {summary.provisional ? (
                <span className={cn(planText.caption, 'ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300')}>
                  잠정
                </span>
              ) : null}
            </div>
            <Bar value={summary.total} max={100} />
          </SideCard>
          <SideCard label="예상 순위">
            <div className="flex items-baseline gap-1.5">
              <span className={planText.kpi}>{me.finalRank}위</span>
              <span className={cn(planText.body, 'text-muted-foreground')}>/ {ranked.length}곳</span>
              <RankDelta from={mePrev.finalRank} to={me.finalRank} />
            </div>
            <p className={cn(planText.body, 'mt-1.5 text-muted-foreground')}>
              {me.phase}단계 · {yearLabel(me.yearNo, startYear)}
            </p>
          </SideCard>
          <SideCard label="사업비">
            <p className="flex items-baseline gap-1">
              <span className={planText.kpi}>{toMillion(summary.cost.total)}</span>
              <span className={cn(planText.body, 'text-muted-foreground')}>백만원</span>
            </p>
            <dl className={cn(planText.body, 'mt-1.5 space-y-0.5')}>
              {(
                [
                  ['공사비', summary.cost.work],
                  ['보상비', summary.cost.comp],
                  ['기타', summary.cost.extra],
                ] as const
              ).map(([k, won]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{toMillion(won)}</dd>
                </div>
              ))}
            </dl>
          </SideCard>
          <SideCard label="항목별 점수">
            <div className="space-y-2">
              {EVAL_ITEMS.map((i) => {
                const sc = summary.scores[i.code]
                return (
                  <div key={i.code}>
                    <div className={cn(planText.body, 'flex items-baseline justify-between')}>
                      <span className="text-foreground/80">{i.name}</span>
                      <span className="tabular-nums">
                        <span className={cn(sc.score == null ? 'text-destructive' : 'font-medium')}>{sc.score ?? '—'}</span>
                        <span className="text-muted-foreground">/{i.max}</span>
                      </span>
                    </div>
                    <Bar value={sc.score ?? 0} max={i.max} thin />
                  </div>
                )
              })}
            </div>
          </SideCard>
          <SideCard label="입력 완성도">
            <div className={cn(planText.body, 'flex items-baseline justify-between')}>
              <span className={planText.kpi}>{summary.completeness}%</span>
              {summary.missingCount ? (
                <span className="text-destructive">입력 필요 {summary.missingCount}건</span>
              ) : (
                <span className="text-emerald-600">모두 입력</span>
              )}
            </div>
            <Bar value={summary.completeness} max={100} />
          </SideCard>
        </aside>
      </div>
    </SmallPublicModalShell>
  )
}

function facilitySpec(f: SmallPublicFacility | null): string {
  return f ? [f.length && `연장 ${f.length}m`, f.width && `폭 ${f.width}m`, f.height && `높이 ${f.height}m`].filter(Boolean).join(' · ') : ''
}

function InfoRow({ label, value, nowrap }: { label: string; value: ReactNode; nowrap?: boolean }) {
  return (
    <tr>
      <th className="align-top">{label}</th>
      <td className={cn(nowrap ? 'truncate whitespace-nowrap' : 'break-keep [overflow-wrap:anywhere]')} title={typeof value === 'string' ? value : undefined}>
        {value}
      </td>
    </tr>
  )
}

function SideCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <p className={cn(planText.label, 'border-b border-border bg-muted/50 px-3 py-1.5 text-muted-foreground')}>{label}</p>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}

function Bar({ value, max, thin }: { value: number; max: number; thin?: boolean }) {
  return (
    <div className={cn('mt-1.5 overflow-hidden rounded-full bg-muted', thin ? 'h-1' : 'h-1.5')}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  )
}

function RankDelta({ from, to }: { from: number; to: number }) {
  if (from === to) return null
  const up = to < from
  return (
    <span className={cn(planText.body, 'inline-flex items-center', up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
      {Math.abs(from - to)}
    </span>
  )
}

/* ── 결과(자동) ───────────────────────────────────────── */

const num = (n: number | null | undefined, unit = '') => (n == null ? '—' : `${n.toLocaleString('ko-KR')}${unit}`)

function PlanStepResult({
  draft,
  summary,
  facility,
  unit,
  me,
  mePrev,
  ranked,
  startYear,
}: PlanStepProps & {
  unit: PlanUnit
  me: PlanRanked
  mePrev: PlanRanked
  ranked: PlanRanked[]
  startYear: number
}) {
  const effect = planEffect(draft)
  const workload = planWorkloadM(draft)
  const basis = planBasisRows(draft)
  const groups = basis.reduce<{ group: string; rows: typeof basis }[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && last.group === r.group) last.rows.push(r)
    else acc.push({ group: r.group, rows: [r] })
    return acc
  }, [])

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {[
          ['총점', `${summary.total}점${summary.provisional ? ' (잠정)' : ''}`],
          ['예상 순위', `${me.finalRank}위 / ${ranked.length}곳`],
          ['단계·연차', `${me.phase}단계 · ${yearLabel(me.yearNo, startYear)}`],
          ['사업비', `${toMillion(summary.cost.total)}백만원`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-background px-3 py-2">
            <p className={cn(planText.label, 'text-muted-foreground')}>{k}</p>
            <p className={cn(planText.kpi, 'truncate')}>{v}</p>
          </div>
        ))}
      </div>

      <PlanSection title="개요">
        <PlanTableWrap minWidth={480}>
          <table
            className={cn(
              planTableClass,
              'table-fixed [&_th]:border-r [&_th]:bg-muted [&_th]:text-left'
            )}
          >
            <colgroup>
              <col className="w-[7rem]" />
              <col />
              <col className="w-[7rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th>시설명</th>
                <td className="font-medium">{unit.unitName}</td>
                <th>유형</th>
                <td>{unit.type}</td>
              </tr>
              <tr>
                <th>위치</th>
                <td>{facility?.address || unit.location || [unit.emd, unit.ri].filter(Boolean).join(' ') || '—'}</td>
                <th>위험시설 지정일</th>
                <td className="tabular-nums">{smallPublicDateLabel(draft.designatedOn ?? '') || '—'}</td>
              </tr>
              <tr>
                <th>제원</th>
                <td colSpan={3}>{facilitySpec(facility) || '—'}</td>
              </tr>
              <tr>
                <th>사업규모</th>
                <td colSpan={3}>{planScaleText(draft) || <span className="text-destructive">정비 공종 미입력</span>}</td>
              </tr>
              <tr>
                <th>저감대책</th>
                <td colSpan={3} className="break-keep">
                  {draft.measure.trim() || '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </PlanTableWrap>
      </PlanSection>

      <PlanSection title="평가 점수">
        <PlanTableWrap minWidth={580}>
          <table className={cn(planTableClass, 'table-fixed')}>
            <colgroup>
              <col className="w-[9rem]" />
              <col />
              <col className="w-[6.5rem]" />
              <col className="w-[5.5rem]" />
            </colgroup>
            <thead>
              <tr>
                <th>항목</th>
                <th>입력값</th>
                <th className="text-right">점수</th>
                <th className="text-center">출처</th>
              </tr>
            </thead>
            <tbody>
              {EVAL_ITEMS.map((i) => {
                const s = summary.scores[i.code]
                return (
                  <tr key={i.code}>
                    <td>{i.name}</td>
                    <td className="truncate text-muted-foreground" title={s.raw}>
                      {s.raw}
                    </td>
                    <td className={cn('text-right tabular-nums', s.score == null && 'text-destructive')}>
                      {s.score ?? '미입력'} <span className="text-muted-foreground">/ {i.max}</span>
                    </td>
                    <td className="text-center">
                      <PlanSourceBadge source={s.source} />
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-muted/30 font-medium">
                <td colSpan={2} className="text-right">
                  합계
                </td>
                <td className="text-right tabular-nums">{summary.total}점</td>
                <td />
              </tr>
            </tbody>
          </table>
        </PlanTableWrap>
        <p className={cn(planText.body, 'mt-2 text-muted-foreground')}>
          사업량 {workload ? `${Math.round(workload).toLocaleString('ko-KR')}m` : '—'} · 수혜자 {num(effect.people, '명')} · 건물{' '}
          {num(effect.buildings, '동')} · 순위 변동 {mePrev.finalRank === me.finalRank ? '없음' : `${mePrev.finalRank}위 → ${me.finalRank}위`}
        </p>
      </PlanSection>

      <PlanSection title="산출근거">
        <PlanTableWrap minWidth={640}>
          <table className={cn(planTableClass, 'table-fixed [&_td]:align-top [&_td]:leading-5')}>
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[58%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr>
                <th>항목</th>
                <th>근거 법령·고시</th>
                <th>조항·표</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.group}>
                  <tr className="bg-muted/40">
                    <td colSpan={3} className={cn(planText.bodyEm, '!py-1.5 text-foreground')}>
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr key={`${r.item}-${i}`}>
                      <td className={cn(planText.bodyEm, 'break-keep')}>{r.item}</td>
                      <td className="break-keep [overflow-wrap:anywhere]">
                        {r.laws.map((law) => (
                          <span key={law} className="block">
                            {law}
                          </span>
                        ))}
                      </td>
                      <td className="break-keep tabular-nums text-foreground/80">{r.ref}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </PlanTableWrap>
      </PlanSection>

      <PlanSection title={`변경 이력 (${unit.history.length})`}>
        <ul className={cn(planText.body, 'space-y-1')}>
          {[...unit.history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`} className="grid grid-cols-[8.5rem_7rem_minmax(0,1fr)] gap-2">
              <span className="tabular-nums text-muted-foreground">{h.at}</span>
              <span className="truncate text-muted-foreground">{h.by}</span>
              <span className="truncate">{h.text}</span>
            </li>
          ))}
        </ul>
      </PlanSection>
    </>
  )
}
