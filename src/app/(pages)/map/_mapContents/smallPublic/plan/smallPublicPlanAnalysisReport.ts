/**
 * 정비계획 분석 — 산출근거 표와 보고서(한글 문서 .hwpx) 내려받기.
 */

import { downloadHwpx, type HwpxBlock } from '../smallPublicHwpx'
import {
  DAMAGE_ITEMS,
  EVAL_CRITERIA,
  EVAL_ITEMS,
  SUPP_ITEMS,
  stdNoticeOf,
  workTypeOf,
} from './smallPublicPlanMaster'
import {
  damageFromYmd,
  damageRowCalc,
  planEffect,
  planScaleText,
  planWorkloadM,
  todayYmd,
  toMillion,
  unitPriceById,
  workAmount,
  yearLabel,
  type PlanRanked,
  type PlanSummary,
} from './smallPublicPlanCalc'
import { PLAN_EXTRA_LABEL, type PlanUnit, type PlanVersion } from './smallPublicPlanTypes'

/** 산출근거 한 줄 — 항목, 근거 법령·고시(여러 개면 줄마다 하나), 조항·표 */
export type PlanBasisRow = { group: string; item: string; laws: string[]; ref: string }

const LAW_RECOVERY = '자연재난조사 및 복구계획수립 요령(행정안전부훈령 제427호)'
const LAW_GUIDE = '자연재해위험개선지구 관리지침(행정안전부, 2017)'
const REPORT_CH4 = '울진군 소규모 공공시설 정비계획 보고서 4장'

function workLaws(workCode: string, priceId: string | null): string[] {
  const wt = workTypeOf(workCode)
  const p = unitPriceById(priceId)
  if (wt?.manualOnly) return [LAW_RECOVERY, '설계·견적 금액 직접 입력']
  if (!p || p.basis === 'PROVISIONAL') return [LAW_RECOVERY, `${REPORT_CH4} 사업비 역산 임시 단가`]
  const n = stdNoticeOf(p.noticeId)
  return [n ? `${n.agency} ${n.title}(${n.no ?? '번호 미상'})` : LAW_RECOVERY]
}

/** 산출근거 — 사업비·기본적 평가·부가적 평가·단계별 근거 법령·고시와 조항·표. 같은 공종은 한 줄 */
export function planBasisRows(v: PlanVersion): PlanBasisRow[] {
  const seen = new Set<string>()
  const works: PlanBasisRow[] = []
  for (const w of v.works) {
    if (seen.has(w.workCode)) continue
    seen.add(w.workCode)
    works.push({
      group: '사업비',
      item: (workTypeOf(w.workCode)?.name ?? w.workCode).replace(/\([^)]*\)$/, ''),
      laws: workLaws(w.workCode, w.priceId),
      ref: '보고서 4.2.1',
    })
  }
  return [
    ...(works.length ? works : [{ group: '사업비', item: '공사비', laws: [LAW_RECOVERY], ref: '보고서 4.2.1' }]),
    {
      group: '사업비',
      item: '보상비',
      laws: ['공익사업을 위한 토지 등의 취득 및 보상에 관한 법률', `${LAW_RECOVERY} 별표(보상배율)`],
      ref: '보고서 4.2.1',
    },
    ...EVAL_ITEMS.map((i) => ({
      group: '기본적 평가',
      item: `${i.name}(${i.max}점)`,
      laws:
        i.code === 'DAMAGE_IDX'
          ? [LAW_GUIDE, '국토교통부 자연재난 복구비용 산정기준(고시 제2026-90호) — 주택', '행정안전부 자연재난 복구비용 산정기준(고시 제2026-14호) — 구호금·세입자']
          : [LAW_GUIDE],
      ref: EVAL_CRITERIA[i.code].table,
    })),
    { group: '부가적 평가', item: '지속성·정책성·계획성', laws: [LAW_GUIDE], ref: '표 4.2.2-10~11' },
    {
      group: '단계·연차',
      item: '단계·명세서',
      laws: ['소규모 공공시설 안전관리 등에 관한 법률 시행규칙 별지 제3호서식'],
      ref: '보고서 4.3.1~4.3.2',
    },
  ]
}

const n0 = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

/** 보고서 내용 — 결과 요약·정비내용·사업비와 보상·평가·산출근거 */
export function planAnalysisReportBlocks(unit: PlanUnit, v: PlanVersion, summary: PlanSummary, me: PlanRanked, baseDate: string): HwpxBlock[] {
  const effect = planEffect(v)
  const workload = planWorkloadM(v)
  const kv = (rows: [string, string][]): HwpxBlock => ({
    kind: 'table',
    widths: [24, 76],
    head: ['구분', '내용'],
    rows: rows.map(([k, val]) => [{ text: k, bold: true }, val]),
  })
  const blocks: HwpxBlock[] = [
    { kind: 'title', text: `${unit.unitName} 정비계획 분석 보고서` },
    { kind: 'meta', text: `${unit.type} · ${[unit.emd, unit.ri].filter(Boolean).join(' ') || unit.location} · 기준일 ${baseDate} · 작성일 ${todayYmd()}` },

    { kind: 'heading', text: '1. 결과 요약' },
    kv([
      ['총점', `${summary.total}점 / 100점${summary.provisional ? ' (입력 덜 됨 — 잠정)' : ''}`],
      ['예상 순위', `기초 ${me.baseRank}위 · 최종 ${me.finalRank}위`],
      ['단계·연차', `${me.phase}단계 · ${yearLabel(me.yearNo)}`],
      ['사업비', `${toMillion(summary.cost.total)}백만원 (공사 ${toMillion(summary.cost.work)} · 보상 ${toMillion(summary.cost.comp)} · 기타 ${toMillion(summary.cost.extra)})`],
      ['사업량', workload ? `${Math.round(workload).toLocaleString('ko-KR')}m` : '—'],
      ['사업효과', `수혜자 ${n0(effect.people)}명 · 건물 ${n0(effect.buildings)}동`],
      ['입력 완성도', `${summary.completeness}%${summary.missingCount ? ` (입력 필요 ${summary.missingCount}건)` : ''}`],
    ]),

    { kind: 'heading', text: '2. 정비내용' },
    kv([
      ['사업규모', planScaleText(v) || '—'],
      ['저감대책', v.measure.trim() || '—'],
    ]),
    v.works.length
      ? {
          kind: 'table',
          widths: [40, 18, 22, 20],
          head: ['공종', '수량', '단가(원)', '금액(백만원)'],
          align: ['left', 'right', 'right', 'right'],
          rows: v.works.map((w) => {
            const wt = workTypeOf(w.workCode)
            const a = workAmount(w)
            return [wt?.name ?? w.workCode, `${n0(w.qty, 1)}${wt?.unit ?? ''}`, wt?.manualOnly ? '직접 금액' : n0(w.unitPriceWon), a != null ? toMillion(a) : '—']
          }),
        }
      : { kind: 'para', text: '정비 공종이 없습니다.' },
  ]

  if (v.details.length) {
    blocks.push({
      kind: 'table',
      widths: [12, 32, 26, 10, 10, 10],
      head: ['구분', '부속 시설', '위치', 'L(m)', 'B(m)', '사업비(백만원)'],
      align: ['center', 'left', 'left', 'right', 'right', 'right'],
      rows: v.details.map((d) => [d.kind === 'BRIDGE' ? '소교량' : '낙차공', d.name || '—', d.location || '—', n0(d.l, 1), n0(d.b, 1), d.costWon != null ? toMillion(d.costWon) : '—']),
    })
  }

  blocks.push({ kind: 'heading', text: '3. 사업비·보상' })
  if (v.compNone) blocks.push({ kind: 'para', text: '보상할 필지가 없습니다(보상비 0).' })
  else if (v.parcels.length === 0) blocks.push({ kind: 'para', text: '편입 필지가 입력되지 않았습니다.' })
  else {
    blocks.push({
      kind: 'table',
      widths: [27, 8, 9, 12, 12, 17, 15],
      head: ['지번', '지목', '소유', '필지면적(㎡)', '편입면적(㎡)', '공시지가(원/㎡)', '보상비(백만원)'],
      align: ['left', 'center', 'center', 'right', 'right', 'right', 'right'],
      rows: v.parcels.map((p) => [
        p.jibun.replace(/^경상북도\s*/, '').replace(/^울진군\s*/, ''),
        p.landCategory || '—',
        p.ownerType || '—',
        n0(p.parcelAreaM2, 1),
        n0(p.inclAreaM2, 1),
        `${n0(p.landPriceWon)}${p.landPriceYear ? `\n(${p.landPriceYear}년)` : ''}`,
        p.exclude ? '보상 제외' : toMillion(p.inclAreaM2 * (p.landPriceWon ?? 0) * p.multiplier),
      ]),
    })
  }
  if (v.extras.length) {
    blocks.push({
      kind: 'table',
      widths: [20, 25, 55],
      head: ['기타 금액', '금액(백만원)', '비고'],
      align: ['center', 'right', 'left'],
      rows: v.extras.map((x) => [PLAN_EXTRA_LABEL[x.kind], toMillion(x.amountWon), x.note || '—']),
    })
  }

  blocks.push(
    { kind: 'heading', text: '4. 평가' },
    {
      kind: 'table',
      widths: [24, 48, 14, 14],
      head: ['항목', '입력값', '점수', '배점'],
      align: ['left', 'left', 'right', 'right'],
      rows: [
        ...EVAL_ITEMS.map((i) => [i.name, summary.scores[i.code].raw, String(summary.scores[i.code].score ?? '미입력'), String(i.max)]),
        [{ text: '합계', bold: true }, '', { text: `${summary.total}`, bold: true, align: 'right' as const }, '100'],
      ],
    }
  )
  if (!v.damageNone && v.damageEvents.length) {
    blocks.push(
      { kind: 'note', text: `피해 내역 (집계 기간 ${damageFromYmd(baseDate)} ~ ${baseDate}, 줄 지수 = 지원기준지수 × 물량 × 가중치)` },
      {
        kind: 'table',
        widths: [14, 34, 12, 15, 10, 15],
        head: ['발생일', '피해 항목', '물량', '지원기준지수(천원)', '가중치', '지수'],
        align: ['center', 'left', 'right', 'right', 'right', 'right'],
        rows: v.damageEvents.map((e) => {
          const item = DAMAGE_ITEMS.find((d) => d.code === e.itemCode)
          const c = damageRowCalc(e, baseDate)
          return [e.occurredOn || '—', item?.name ?? '—', `${n0(e.qty, 1)}${item?.unit ?? ''}`, n0(c.supportIndex, 4), n0(c.weight, 1), c.skip || n0(c.index, 1)]
        }),
      }
    )
  }
  blocks.push(
    { kind: 'note', text: '부가적 평가 (점수에 더하지 않고 순위 조정에 씀)' },
    {
      kind: 'table',
      widths: [16, 36, 36, 12],
      head: ['항목', '1 — 이럴 때', '0 — 이럴 때', '선택'],
      align: ['center', 'left', 'left', 'center'],
      rows: SUPP_ITEMS.map((s) => [s.name, s.oneWhen, s.zeroWhen, String(v.supp[s.code] ?? '—')]),
    },

    { kind: 'heading', text: '5. 산출근거' },
    {
      kind: 'table',
      widths: [24, 58, 18],
      head: ['항목', '근거 법령·고시', '조항·표'],
      rows: planBasisRows(v).reduce<(string[] | { group: string })[]>((acc, r, i, all) => {
        if (i === 0 || all[i - 1]!.group !== r.group) acc.push({ group: r.group })
        acc.push([r.item, r.laws.join('\n'), r.ref])
        return acc
      }, []),
    },
    { kind: 'note', text: '법령·고시 기준 개략 산정이며 참고용입니다. 실제 사업비·보상비는 실시설계와 감정평가로 확정합니다.' }
  )
  return blocks
}

export async function downloadPlanAnalysisReport(unit: PlanUnit, v: PlanVersion, summary: PlanSummary, me: PlanRanked, baseDate: string): Promise<void> {
  const title = `${unit.unitName} 정비계획 분석 보고서`
  downloadHwpx(`정비계획분석_${unit.unitName}_${todayYmd().replace(/-/g, '')}.hwpx`, title, planAnalysisReportBlocks(unit, v, summary, me, baseDate))
}
