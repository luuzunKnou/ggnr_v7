'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Search, Trash2, Wand2 } from 'lucide-react'
import { transform } from 'ol/proj'
import { cn } from '@/lib/utils'
import { fetchVworldOfficialLandPriceHistory } from '@/lib/vworldParcelLandClient'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { AddressSearchPanel } from '../../../_mapComponents/addressSearch/AddressSearchPanel'
import type { VWorldAddressItem } from '../../../_mapComponents/addressSearch/vworldAddressSearch'
import { fetchParcelTabData, resolveParcelIdentityLikeMapClick } from '../../../_mapComponents/landInfo/api'
import { smallPublicBtnGhost } from '../smallPublicConfig'
import type { SmallPublicFacility } from '../smallPublicMock'
import { useSmallPublicStore } from '../smallPublicStore'
import {
  DAMAGE_ITEMS,
  EVAL_BANDS,
  EVAL_CRITERIA,
  EVAL_ITEMS,
  RISK_CASUALTIES,
  RISK_GRADES,
  SUPP_ITEMS,
  SYSTEM_PARAMS,
  WORK_TYPES,
  WORK_TYPES_BY_FACILITY,
  workTypeOf,
  type EvalItemCode,
} from './smallPublicPlanMaster'
import {
  bandIndexOf,
  compMultiplier,
  damageFromYmd,
  damageIndex,
  damageRowCalc,
  planBcRatio,
  planScaleText,
  suggestWorks,
  toMillion,
  unitPriceById,
  unitPriceFor,
  workAmount,
  yearsBetween,
  type PlanSummary,
} from './smallPublicPlanCalc'
import { PLAN_EXTRA_LABEL, type PlanExtraKind, type PlanParcel, type PlanVersion, type PlanWorkDetail, type PlanWorkItem } from './smallPublicPlanTypes'
import {
  PlanBands,
  PlanChoice,
  PlanFormRow,
  PlanFormulaHint,
  PlanNumInput,
  PlanPriceBasisBadge,
  PlanSection,
  PlanSourceBadge,
  PlanTableWrap,
  planFieldClass,
  planTableClass,
  planText,
} from './smallPublicPlanUi'

export type PlanStepProps = {
  draft: PlanVersion
  update: (fn: (v: PlanVersion) => PlanVersion) => void
  readOnly: boolean
  facility: SmallPublicFacility | null
  baseDate: string
  summary: PlanSummary
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const mil = (won: number) => `${toMillion(won)}백만원`
const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}

/** 합계 줄 — 이름·금액을 한 줄로, 마지막(합계)만 강조 */
function TotalLine({ items }: { items: { label: string; value: string; strong?: boolean }[] }) {
  return (
    <div className={cn(planText.body, 'flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2')}>
      {items.map((it) => (
        <span key={it.label} className={cn('whitespace-nowrap', it.strong && 'ml-auto')}>
          <span className="text-muted-foreground">{it.label}</span>{' '}
          <span className={cn('tabular-nums', it.strong ? 'font-semibold text-primary' : 'text-foreground')}>{it.value}</span>
        </span>
      ))}
    </div>
  )
}

/* ── 정비내용 ─────────────────────────────────────────── */

function setWork(v: PlanVersion, id: string, patch: Partial<PlanWorkItem>): PlanVersion {
  return { ...v, works: v.works.map((w) => (w.id === id ? { ...w, ...patch, source: 'MANUAL' } : w)) }
}

/** 부속 시설 개략 사업비 — 소교량 재설치 단가, 낙차공은 L 기준 단가(없으면 개소 단가) */
function detailCost(kind: PlanWorkDetail['kind'], l: number | null, baseDate: string): number | null {
  if (kind === 'BRIDGE') return unitPriceFor('BRIDGE_REINSTALL', baseDate)?.priceWon ?? null
  if (l) {
    const p = unitPriceFor('DROP_REINSTALL_L', baseDate)?.priceWon
    return p ? Math.round(p * l) : null
  }
  return unitPriceFor('DROP_REINSTALL_EA', baseDate)?.priceWon ?? null
}

export function PlanStepWorks({ draft, update, readOnly, facility, baseDate }: PlanStepProps) {
  const preferred = facility ? WORK_TYPES_BY_FACILITY[facility.type] : []
  const others = WORK_TYPES.filter((w) => !preferred.includes(w.code))
  const workTotal = draft.works.reduce((n, w) => n + (workAmount(w) ?? 0), 0)
  const needsDetails = draft.works.some((w) => w.workCode.startsWith('BRIDGE') || w.workCode.startsWith('DROP'))
  const scale = planScaleText(draft)

  const addWork = (code: string) => {
    if (!code) return
    const p = unitPriceFor(code, baseDate)
    update((v) => ({
      ...v,
      works: [
        ...v.works,
        { id: uid('w'), workCode: code, qty: null, priceId: p?.id ?? null, unitPriceWon: p?.priceWon ?? null, manualAmountWon: null, source: 'MANUAL' },
      ],
    }))
  }

  return (
    <>
      <PlanSection title="사업 개요">
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[12px]">
          <span className="text-muted-foreground">사업규모</span>
          <span className={cn('flex min-h-7 items-center', !scale && 'text-muted-foreground')}>{scale || '정비 공종을 넣으면 자동으로 채워집니다.'}</span>
          <span className="text-muted-foreground">저감대책</span>
          <input
            className={planFieldClass}
            value={draft.measure}
            disabled={readOnly}
            onChange={(e) => update((v) => ({ ...v, measure: e.target.value }))}
            aria-label="저감대책"
          />
        </div>
      </PlanSection>

      <PlanSection
        title={
          <>
            정비 공종·수량
            <PlanFormulaHint
              title="정비 공종·수량"
              lines={[
                '시설 유형별 공종을 제안합니다(세천 호안정비, 진입로·농로 재포장, 소교량·낙차공 재설치 등).',
                '선형 시설은 시설 전체 연장을 수량 상한으로 넣습니다.',
                '금액 = 수량 × 단가. 선형개선은 단가가 없어 금액을 직접 넣습니다.',
              ]}
            />
          </>
        }
        actions={
          readOnly ? null : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={smallPublicBtnGhost}
                disabled={!facility}
                onClick={() => {
                  if (!facility) return
                  if (draft.works.length > 0 && !window.confirm('지금 공종을 지우고 제안 공종으로 바꿀까요?')) return
                  update((v) => ({ ...v, works: suggestWorks(facility, baseDate) }))
                }}
              >
                <Wand2 className="h-3 w-3" />
                제안대로 다시
              </button>
              <select className={cn(planFieldClass, 'h-7 w-44 shrink-0')} value="" onChange={(e) => addWork(e.target.value)} aria-label="공종 추가">
                <option value="">+ 공종 추가</option>
                <optgroup label={`${facility?.type ?? ''} 공종`}>
                  {preferred.map((c) => (
                    <option key={c} value={c}>
                      {workTypeOf(c)?.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="그 밖의 공종">
                  {others.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          )
        }
      >
        <PlanTableWrap minWidth={640}>
          <table className={cn(planTableClass, 'table-fixed')}>
            <colgroup>
              <col />
              <col className="w-[8.5rem]" />
              <col className="w-[7.5rem]" />
              <col className="w-[7rem]" />
              <col className="w-[5.5rem]" />
              {readOnly ? null : <col className="w-9" />}
            </colgroup>
            <thead>
              <tr>
                <th>공종</th>
                <th className="text-right">수량</th>
                <th className="text-right">단가(원)</th>
                <th className="text-right">금액</th>
                <th className="text-center">출처</th>
                {readOnly ? null : <th />}
              </tr>
            </thead>
            <tbody>
              {draft.works.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    공종이 없습니다. «+ 공종 추가»로 넣으세요.
                  </td>
                </tr>
              ) : (
                draft.works.map((w) => {
                  const wt = workTypeOf(w.workCode)
                  const price = unitPriceById(w.priceId)
                  const amount = workAmount(w)
                  return (
                    <tr key={w.id}>
                      <td>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{wt?.name ?? w.workCode}</span>
                          {wt?.manualOnly ? null : price ? <PlanPriceBasisBadge basis={price.basis} title={price.note} /> : null}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <PlanNumInput value={w.qty} disabled={readOnly} onChange={(qty) => update((v) => setWork(v, w.id, { qty }))} />
                          <span className="w-7 shrink-0 text-[11px] text-muted-foreground">{wt?.unit}</span>
                        </div>
                      </td>
                      <td>
                        {wt?.manualOnly ? (
                          <PlanNumInput
                            value={w.manualAmountWon}
                            disabled={readOnly}
                            placeholder="금액 입력"
                            onChange={(manualAmountWon) => update((v) => setWork(v, w.id, { manualAmountWon }))}
                          />
                        ) : (
                          <span className="block text-right tabular-nums">{w.unitPriceWon?.toLocaleString('ko-KR') ?? '—'}</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{amount != null ? mil(amount) : <span className="text-destructive">미입력</span>}</td>
                      <td className="text-center">
                        <PlanSourceBadge source={amount == null ? 'MISSING' : w.source} />
                      </td>
                      {readOnly ? null : (
                        <td className="text-center">
                          <DeleteButton label="공종 삭제" onClick={() => update((v) => ({ ...v, works: v.works.filter((x) => x.id !== w.id) }))} />
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </PlanTableWrap>
        <div className="mt-2">
          <TotalLine items={[{ label: '공사비 합계', value: mil(workTotal), strong: true }]} />
        </div>
      </PlanSection>

      {needsDetails ? <DetailSection draft={draft} update={update} readOnly={readOnly} baseDate={baseDate} /> : null}
    </>
  )
}

/** 시설 이름·위치로 후보지 시설 찾기 */
function FacilityLookup({
  kind,
  value,
  disabled,
  onPick,
  onText,
}: {
  kind: PlanWorkDetail['kind']
  value: string
  disabled?: boolean
  onPick: (f: SmallPublicFacility) => void
  onText: (text: string) => void
}) {
  const { facilities } = useSmallPublicStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const type = kind === 'BRIDGE' ? '소교량' : '낙차공'
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    return facilities
      .filter((f) => f.type === type)
      .filter((f) => !q || [f.name, f.ri, f.emd, f.address].join(' ').toLowerCase().includes(q))
      .slice(0, 30)
  }, [facilities, type, value])

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 2 })
  }

  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => {
      if (e.type === 'scroll' && listRef.current?.contains(e.target as Node)) return
      setPos(null)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos])

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        className={cn(planFieldClass, 'pl-7')}
        value={value}
        disabled={disabled}
        placeholder={`${type} 이름·리명 검색`}
        onFocus={place}
        onBlur={() => setTimeout(() => setPos(null), 150)}
        onChange={(e) => {
          onText(e.target.value)
          place()
        }}
      />
      {/* 표는 가로 스크롤 상자 안이라 목록이 잘리므로 화면 위 고정 위치(분석 모달보다 위)에 띄운다 */}
      {pos && matches.length > 0
        ? createPortal(
            <ul
              ref={listRef}
              className="fixed z-[90] max-h-64 w-[26rem] overflow-auto rounded-md border border-border bg-background py-1 shadow-lg"
              style={{ left: pos.left, top: pos.top }}
            >
              {matches.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPick(f)
                      setPos(null)
                    }}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-muted-foreground">{[f.emd, f.ri].filter(Boolean).join(' ')}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {f.length ? `L ${f.length}m` : ''} {f.width ? `B ${f.width}m` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body
          )
        : null}
    </div>
  )
}

function DetailSection({ draft, update, readOnly, baseDate }: Pick<PlanStepProps, 'draft' | 'update' | 'readOnly' | 'baseDate'>) {
  const set = (id: string, patch: Partial<PlanWorkDetail>) =>
    update((v) => ({ ...v, details: v.details.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  return (
    <PlanSection
      title="부속 시설(소교량·낙차공)"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className={smallPublicBtnGhost}
            onClick={() =>
              update((v) => ({
                ...v,
                details: [
                  ...v.details,
                  {
                    id: uid('d'),
                    kind: v.works.some((w) => w.workCode.startsWith('DROP')) ? 'DROP' : 'BRIDGE',
                    name: '',
                    location: '',
                    l: null,
                    b: null,
                    costWon: null,
                  },
                ],
              }))
            }
          >
            <Plus className="h-3 w-3" />
            부속 시설 추가
          </button>
        )
      }
    >
      <PlanTableWrap minWidth={760}>
        <table className={cn(planTableClass, 'table-fixed')}>
          <colgroup>
            <col className="w-[6rem]" />
            <col />
            <col className="w-[11rem]" />
            <col className="w-[5rem]" />
            <col className="w-[5rem]" />
            <col className="w-[8rem]" />
            {readOnly ? null : <col className="w-9" />}
          </colgroup>
          <thead>
            <tr>
              <th>구분</th>
              <th>시설</th>
              <th>위치</th>
              <th className="text-right">L(m)</th>
              <th className="text-right">B(m)</th>
              <th className="text-right">사업비(원)</th>
              {readOnly ? null : <th />}
            </tr>
          </thead>
          <tbody>
            {draft.details.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  부속 시설이 없습니다.
                </td>
              </tr>
            ) : (
              draft.details.map((d) => (
                <tr key={d.id}>
                  <td>
                    <select
                      className={planFieldClass}
                      value={d.kind}
                      disabled={readOnly}
                      onChange={(e) => {
                        const kind = e.target.value as PlanWorkDetail['kind']
                        set(d.id, { kind, costWon: detailCost(kind, d.l, baseDate) })
                      }}
                    >
                      <option value="BRIDGE">소교량</option>
                      <option value="DROP">낙차공</option>
                    </select>
                  </td>
                  <td className="overflow-visible">
                    <FacilityLookup
                      kind={d.kind}
                      value={d.name}
                      disabled={readOnly}
                      onText={(name) => set(d.id, { name })}
                      onPick={(f) => {
                        const l = Number(f.length) || null
                        set(d.id, {
                          name: f.name,
                          location: [f.emd, f.ri].filter(Boolean).join(' ') || f.address,
                          l,
                          b: Number(f.width) || null,
                          costWon: detailCost(d.kind, l, baseDate),
                        })
                      }}
                    />
                  </td>
                  <td>
                    <input className={planFieldClass} value={d.location} disabled={readOnly} onChange={(e) => set(d.id, { location: e.target.value })} />
                  </td>
                  <td>
                    <PlanNumInput value={d.l} disabled={readOnly} onChange={(l) => set(d.id, { l, costWon: detailCost(d.kind, l, baseDate) })} />
                  </td>
                  <td>
                    <PlanNumInput value={d.b} disabled={readOnly} onChange={(b) => set(d.id, { b })} />
                  </td>
                  <td>
                    <PlanNumInput value={d.costWon} disabled={readOnly} onChange={(costWon) => set(d.id, { costWon })} />
                  </td>
                  {readOnly ? null : (
                    <td className="text-center">
                      <DeleteButton label="부속 시설 삭제" onClick={() => update((v) => ({ ...v, details: v.details.filter((x) => x.id !== d.id) }))} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </PlanTableWrap>
    </PlanSection>
  )
}

/* ── 사업비·보상 ──────────────────────────────────────── */

type Row = Record<string, unknown> | undefined

const firstText = (row: Row, keys: string[]) => {
  for (const k of keys) {
    const v = row?.[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

const toPositive = (text: string): number | null => {
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 국·공유지 — 보상 제외로 시작 */
const isPublicLand = (ownerType: string) => /국유|도유|군유|시유|공유지|국공유/.test(ownerType)

/** 표에서 보기 좋게 — «경상북도 울진군 »은 뗀다 */
const shortJibun = (jibun: string) => jibun.replace(/^경상북도\s*/, '').replace(/^울진군\s*/, '')

/**
 * 주소 검색 결과 → 필지번호 → 지목·필지면적·소유구분·공시지가.
 * 필지정보 화면과 같은 연계 자료를 쓴다. 토지특성이 비면 토지소유 자료에서 지목·면적을,
 * 공시지가는 연계 자료의 최신 개별공시지가, 없으면 연도별 개별공시지가의 최신 값을 쓴다.
 */
async function lookupParcel(item: VWorldAddressItem, vworldKey: string): Promise<Partial<PlanParcel>> {
  const coordinate3857 = transform([item.point.x, item.point.y], 'EPSG:4326', 'EPSG:3857') as [number, number]
  const jibun = (item.jibunAddress ?? item.address ?? '').trim()
  const { pnu } = await resolveParcelIdentityLikeMapClick({ coordinate3857, vworldKey, addressHint: jibun })
  if (!pnu) return { jibun }
  const [tab, history] = await Promise.all([
    fetchParcelTabData({ pnu, vworldKey }).catch(() => null),
    fetchVworldOfficialLandPriceHistory({ pnu, vworldKey }).catch(() => []),
  ])
  const ch = tab?.characteristics?.[0] as Row
  const pos = tab?.possessions?.[0] as Row
  const pr = tab?.prices?.[0] as Row
  const tabPrice = toPositive(firstText(pr, ['pblntfPclnd']))
  const latest = history.find((h) => h.price != null && h.price > 0)
  const ld = firstText(pos, ['ldCodeNm']) || firstText(ch, ['ldCodeNm'])
  const lot = firstText(pos, ['mnnmSlno']) || firstText(ch, ['mnnmSlno'])
  return {
    pnu,
    jibun: ld && lot ? `${ld} ${lot}` : jibun,
    landCategory: firstText(ch, ['lndcgrCodeNm', 'jimok']) || firstText(pos, ['lndcgrCodeNm', 'jimok']),
    parcelAreaM2: toPositive(firstText(ch, ['lndpclAr', 'area'])) ?? toPositive(firstText(pos, ['lndpclAr', 'area'])),
    ownerType: firstText(pos, ['posesnSeCodeNm']),
    landPriceWon: tabPrice ?? latest?.price ?? null,
    landPriceYear: tabPrice ? firstText(pr, ['stdrYear']) : (latest?.year ?? ''),
  }
}

export function PlanStepCost({ draft, update, readOnly, summary }: PlanStepProps) {
  const vworldKey = useMapContext()?.vworldApiKey ?? ''
  const [loading, setLoading] = useState(false)
  const [searchKey, setSearchKey] = useState(0)
  const mult = compMultiplier()
  const { cost } = summary

  const setParcel = (id: string, patch: Partial<PlanParcel>) =>
    update((v) => ({ ...v, parcels: v.parcels.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

  const addFromAddress = async (item: VWorldAddressItem) => {
    const id = uid('pc')
    const base: PlanParcel = {
      id,
      pnu: '',
      jibun: (item.jibunAddress ?? item.address ?? '').trim(),
      landCategory: '',
      parcelAreaM2: null,
      inclAreaM2: 0,
      landPriceWon: null,
      landPriceYear: '',
      ownerType: '',
      multiplier: mult.rate,
      exclude: false,
      source: 'MANUAL',
    }
    update((v) => ({ ...v, parcels: [...v.parcels, base] }))
    setSearchKey((k) => k + 1)
    setLoading(true)
    try {
      const found = await lookupParcel(item, vworldKey)
      setParcel(id, {
        ...found,
        inclAreaM2: found.parcelAreaM2 ?? 0,
        exclude: isPublicLand(found.ownerType ?? ''),
        source: found.pnu ? 'AUTO' : 'MANUAL',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mb-3">
        <TotalLine
          items={[
            { label: '공사비', value: mil(cost.work) },
            { label: '보상비', value: mil(cost.comp) },
            { label: '기타', value: mil(cost.extra) },
            { label: '사업비 합계', value: mil(cost.total), strong: true },
          ]}
        />
      </div>

      <PlanSection
        title={
          <>
            편입 필지·보상비
            <PlanFormulaHint
              title="보상비 계산"
              lines={[
                '보상비 = 편입면적(㎡) × 공시지가(원/㎡) × 보상배율',
                `보상배율: ${mult.label}(재난 복구계획 요령 별표)`,
                '공시지가는 필지정보 화면과 같은 연계 자료의 최신 개별공시지가입니다(기준연도 표시).',
                '실제 보상은 감정평가로 정하며 여기 값은 개략 산정입니다.',
              ]}
            />
          </>
        }
        actions={
          readOnly ? null : (
            <label className="inline-flex items-center gap-1.5 text-[12px] text-foreground/80">
              <input type="checkbox" className="h-3.5 w-3.5" checked={draft.compNone} onChange={(e) => update((v) => ({ ...v, compNone: e.target.checked }))} />
              보상 없음
            </label>
          )
        }
      >
        {draft.compNone ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">보상할 필지가 없습니다(보상비 0).</p>
        ) : (
          <>
            {readOnly ? null : (
              <div className="mb-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={cn(planText.bodyEm, 'text-foreground')}>필지 주소 검색</span>
                  {loading ? (
                    <span className={cn(planText.body, 'inline-flex items-center gap-1 text-muted-foreground')}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      필지 정보 조회 중
                    </span>
                  ) : (
                    <span className={cn(planText.caption, 'text-muted-foreground')}>주소를 고르면 편입 필지에 추가됩니다</span>
                  )}
                </div>
                <AddressSearchPanel
                  key={searchKey}
                  vworldApiKey={vworldKey}
                  layout="field"
                  placeholder="예: 울진군 북면 두천리 617-1"
                  onSelect={(item) => void addFromAddress(item)}
                />
              </div>
            )}
            <PlanTableWrap minWidth={860}>
              <table className={cn(planTableClass, 'table-fixed')}>
                <colgroup>
                  <col />
                  <col className="w-[4rem]" />
                  <col className="w-[4.5rem]" />
                  <col className="w-[6.5rem]" />
                  <col className="w-[7rem]" />
                  <col className="w-[8.5rem]" />
                  <col className="w-[4.5rem]" />
                  <col className="w-[6.5rem]" />
                  {readOnly ? null : <col className="w-9" />}
                </colgroup>
                <thead>
                  <tr>
                    <th>지번</th>
                    <th>지목</th>
                    <th>소유</th>
                    <th className="text-right">필지면적(㎡)</th>
                    <th className="text-right">편입면적(㎡)</th>
                    <th className="text-right">공시지가(원/㎡)</th>
                    <th className="text-center">보상 제외</th>
                    <th className="text-right">보상비</th>
                    {readOnly ? null : <th />}
                  </tr>
                </thead>
                <tbody>
                  {draft.parcels.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted-foreground">
                        편입 필지가 없습니다. 위 «필지 주소 검색»으로 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    draft.parcels.map((p) => {
                      const comp = p.exclude ? 0 : p.inclAreaM2 * (p.landPriceWon ?? 0) * p.multiplier
                      return (
                        <tr key={p.id} className={cn(p.exclude && 'text-muted-foreground')}>
                          <td className="truncate" title={[p.jibun, p.pnu && `필지번호 ${p.pnu}`].filter(Boolean).join('\n')}>
                            {shortJibun(p.jibun) || '—'}
                          </td>
                          <td className="truncate">{p.landCategory || '—'}</td>
                          <td className="truncate">{p.ownerType || '—'}</td>
                          <td className="text-right tabular-nums">{num(p.parcelAreaM2, 1)}</td>
                          <td>
                            <PlanNumInput value={p.inclAreaM2} disabled={readOnly} onChange={(n) => setParcel(p.id, { inclAreaM2: n ?? 0 })} />
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <PlanNumInput
                                value={p.landPriceWon}
                                disabled={readOnly}
                                placeholder="직접 입력"
                                onChange={(landPriceWon) => setParcel(p.id, { landPriceWon, landPriceYear: '' })}
                              />
                              {p.landPriceYear ? (
                                <span className="shrink-0 text-[11px] text-muted-foreground" title="공시지가 기준연도">
                                  {p.landPriceYear}년
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={p.exclude}
                              disabled={readOnly}
                              onChange={(e) => setParcel(p.id, { exclude: e.target.checked })}
                            />
                          </td>
                          <td className="text-right tabular-nums">{mil(comp)}</td>
                          {readOnly ? null : (
                            <td className="text-center">
                              <DeleteButton label="필지 삭제" onClick={() => update((v) => ({ ...v, parcels: v.parcels.filter((x) => x.id !== p.id) }))} />
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </PlanTableWrap>
          </>
        )}
      </PlanSection>

      <PlanSection
        title="기타 금액"
        actions={
          readOnly ? null : (
            <button
              type="button"
              className={smallPublicBtnGhost}
              onClick={() => update((v) => ({ ...v, extras: [...v.extras, { id: uid('x'), kind: 'DESIGN', amountWon: 0, note: '' }] }))}
            >
              <Plus className="h-3 w-3" />
              금액 추가
            </button>
          )
        }
      >
        {draft.extras.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">기타 금액이 없습니다.</p>
        ) : (
          <PlanTableWrap minWidth={520}>
            <table className={cn(planTableClass, 'table-fixed')}>
              <colgroup>
                <col className="w-[8rem]" />
                <col className="w-[10rem]" />
                <col />
                {readOnly ? null : <col className="w-9" />}
              </colgroup>
              <thead>
                <tr>
                  <th>구분</th>
                  <th className="text-right">금액(원)</th>
                  <th>비고</th>
                  {readOnly ? null : <th />}
                </tr>
              </thead>
              <tbody>
                {draft.extras.map((x) => {
                  const set = (patch: Partial<typeof x>) =>
                    update((v) => ({ ...v, extras: v.extras.map((e) => (e.id === x.id ? { ...e, ...patch } : e)) }))
                  return (
                    <tr key={x.id}>
                      <td>
                        <select className={planFieldClass} value={x.kind} disabled={readOnly} onChange={(e) => set({ kind: e.target.value as PlanExtraKind })}>
                          {(Object.keys(PLAN_EXTRA_LABEL) as PlanExtraKind[]).map((k) => (
                            <option key={k} value={k}>
                              {PLAN_EXTRA_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <PlanNumInput value={x.amountWon} disabled={readOnly} onChange={(n) => set({ amountWon: n ?? 0 })} />
                      </td>
                      <td>
                        <input className={planFieldClass} value={x.note} disabled={readOnly} onChange={(e) => set({ note: e.target.value })} />
                      </td>
                      {readOnly ? null : (
                        <td className="text-center">
                          <DeleteButton label="금액 삭제" onClick={() => update((v) => ({ ...v, extras: v.extras.filter((e) => e.id !== x.id) }))} />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </PlanTableWrap>
        )}
      </PlanSection>
    </>
  )
}

/* ── 평가 ─────────────────────────────────────────────── */

/** 피해이력지수 ? — 점수 산정식만 */
function damageFormulaLines(): string[] {
  return [`피해이력지수 / ${SYSTEM_PARAMS.DAMAGE_DIVISOR.toLocaleString('ko-KR')} × 25`]
}

/** 평가 항목 카드 — 제목 줄(이름·배점·점수·출처), 아래 입력 줄 */
function EvalCard({ code, summary, children }: { code: EvalItemCode; summary: PlanSummary; children: ReactNode }) {
  const item = EVAL_ITEMS.find((i) => i.code === code)!
  const s = summary.scores[code]
  const hintLines = code === 'DAMAGE_IDX' ? damageFormulaLines() : EVAL_CRITERIA[code].rule.split(' · ')
  return (
    <section className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-slate-50 px-3 py-1.5 dark:bg-slate-900/40">
        <p className={cn(planText.section, 'flex min-w-0 flex-1 items-center gap-1.5')}>
          {item.name}
          <span className={cn(planText.caption, 'text-muted-foreground')}>배점 {item.max}점</span>
          <PlanFormulaHint title={`${item.name} 산정기준(${EVAL_CRITERIA[code].table})`} lines={hintLines} />
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <PlanSourceBadge source={s.source} />
          <p className={cn(planText.body, 'w-16 text-right tabular-nums')}>
            <span className={cn('font-semibold', s.score == null ? 'text-destructive' : 'text-primary')}>{s.score ?? '—'}</span>
            <span className="text-muted-foreground"> / {item.max}</span>
          </p>
        </div>
      </div>
      <div className="space-y-0.5 px-3 py-2">{children}</div>
    </section>
  )
}

const bandsOf = (item: 'BC' | 'INCONV' | 'ELAPSED', unit: string) =>
  EVAL_BANDS[item].map((b) => ({
    label: b.lower == null ? `${b.upper}${unit} 미만` : b.upper == null ? `${b.lower}${unit} 이상` : `${b.lower}~${b.upper}${unit}`,
    score: b.score,
  }))

export function PlanStepEval({ draft, update, readOnly, summary, baseDate, facility }: PlanStepProps) {
  const density = draft.population != null && draft.areaHa ? draft.population / draft.areaHa : null
  const years = draft.designatedOn ? yearsBetween(draft.designatedOn, baseDate) : null
  const bcRatio = planBcRatio(draft)

  return (
    <>
      <div className="space-y-2.5">
        <EvalCard code="BC" summary={summary}>
          <PlanFormRow
            label="평가 방식"
            note={
              draft.bcBenefitWon != null ? (
                <span className="text-amber-700 dark:text-amber-400">기존 계획은 모두 15점이라 편익을 넣으면 점수가 같거나 낮아집니다.</span>
              ) : null
            }
          >
            <PlanChoice
              disabled={readOnly}
              value={draft.bcBenefitWon == null ? 'default' : 'benefit'}
              onChange={(v) => update((d) => ({ ...d, bcBenefitWon: v === 'default' ? null : (d.bcBenefitWon ?? 0) }))}
              options={[
                { value: 'default', label: '기존 계획 기준', hint: '15점' },
                { value: 'benefit', label: '편익 입력(B/C 계산)' },
              ]}
            />
          </PlanFormRow>
          {draft.bcBenefitWon != null ? (
            <>
              <PlanFormRow label="편익">
                <PlanNumInput
                  className="w-28"
                  value={draft.bcBenefitWon / 1_000_000}
                  disabled={readOnly}
                  onChange={(n) => update((d) => ({ ...d, bcBenefitWon: Math.round((n ?? 0) * 1_000_000) }))}
                />
                <span className="text-muted-foreground">백만원</span>
                <PlanFormulaHint
                  title="편익"
                  lines={[
                    '사업으로 줄어드는 피해액을 사업 기간 전체로 합한 값입니다(경제성 분석 자료의 총편익).',
                    '비용은 이 분석의 사업비(공사비·보상비·기타)를 그대로 씁니다.',
                    'B/C = 편익 ÷ 사업비, 구간 점수로 바꿉니다.',
                  ]}
                />
              </PlanFormRow>
              <PlanFormRow label="비용(사업비)">
                <span className="w-28 text-right tabular-nums">{toMillion(summary.cost.total)}</span>
                <span className="text-muted-foreground">백만원 · 자동</span>
              </PlanFormRow>
              <PlanFormRow label="B/C" note={<PlanBands bands={bandsOf('BC', '')} active={bandIndexOf('BC', bcRatio)} />}>
                <span className="w-28 text-right tabular-nums">{bcRatio ?? '—'}</span>
              </PlanFormRow>
            </>
          ) : null}
        </EvalCard>

        <EvalCard code="DAMAGE_IDX" summary={summary}>
          <p className={cn(planText.body, 'mb-2 text-muted-foreground')}>
            후보지에서 가져온 피해이력을 바탕으로, 빠진 건은 이 화면에서 추가·수정할 수 있습니다.
          </p>
          <PlanFormRow label="피해 여부">
            <PlanChoice
              disabled={readOnly}
              value={draft.damageNone ? 'NONE' : 'HAS'}
              onChange={(v) =>
                update((d) => ({
                  ...d,
                  damageNone: v === 'NONE',
                  damageEvents: v === 'NONE' ? [] : d.damageEvents,
                }))
              }
              options={[
                { value: 'HAS' as const, label: '피해 있음' },
                { value: 'NONE' as const, label: '피해 없음(0점)' },
              ]}
            />
          </PlanFormRow>
          {!draft.damageNone ? (
            <DamageEventEditor draft={draft} update={update} readOnly={readOnly} baseDate={baseDate} summary={summary} />
          ) : null}
        </EvalCard>

        <EvalCard code="RISK" summary={summary}>
          <PlanFormRow label="위험등급">
            <PlanChoice
              disabled={readOnly}
              value={draft.riskGrade}
              onChange={(riskGrade) => update((d) => ({ ...d, riskGrade, riskDefault: false }))}
              options={RISK_GRADES.map((g) => ({ value: g.code, label: g.name, hint: `${g.score}점` }))}
            />
          </PlanFormRow>
          <PlanFormRow label="인명피해">
            <PlanChoice
              disabled={readOnly}
              value={draft.riskCasualty ?? 'NONE'}
              onChange={(riskCasualty) => update((d) => ({ ...d, riskCasualty, riskDefault: false }))}
              options={RISK_CASUALTIES.map((c) => ({ value: c.code, label: c.name, hint: c.score ? `+${c.score}점` : '' }))}
            />
          </PlanFormRow>
        </EvalCard>

        <EvalCard code="INCONV" summary={summary}>
          <PlanFormRow label="거주인구·면적" note={<PlanBands bands={bandsOf('INCONV', '명')} active={bandIndexOf('INCONV', density)} />}>
            <PlanNumInput
              className="w-24"
              value={draft.population}
              disabled={readOnly}
              onChange={(population) => update((d) => ({ ...d, population }))}
              aria-label="거주인구"
            />
            <span className="text-muted-foreground">명 ÷</span>
            <PlanNumInput className="w-20" value={draft.areaHa} disabled={readOnly} onChange={(areaHa) => update((d) => ({ ...d, areaHa }))} aria-label="영향 면적" />
            <span className="text-muted-foreground">ha =</span>
            <span className="w-20 tabular-nums">{density == null ? '—' : `${Math.round(density * 10) / 10}명/ha`}</span>
          </PlanFormRow>
        </EvalCard>

        <EvalCard code="ELAPSED" summary={summary}>
          <PlanFormRow label="위험시설 지정일">
            <input
              type="date"
              className={cn(planFieldClass, 'w-36')}
              value={draft.designatedOn ?? ''}
              disabled={readOnly}
              onChange={(e) => update((d) => ({ ...d, designatedOn: e.target.value || null, designatedSource: e.target.value ? 'MANUAL' : 'MISSING' }))}
            />
          </PlanFormRow>
          <PlanFormRow label="경과년수" note={<PlanBands bands={bandsOf('ELAPSED', '년')} active={bandIndexOf('ELAPSED', years)} />}>
            <span className="w-36 tabular-nums">{years == null ? '—' : `${Math.round(years * 10) / 10}년`}</span>
          </PlanFormRow>
        </EvalCard>

        <section className="overflow-hidden rounded-md border border-border bg-background">
          <div className="flex min-h-9 items-center gap-1.5 border-b border-border bg-slate-50 px-3 py-1.5 dark:bg-slate-900/40">
            <p className={planText.section}>부가적 평가</p>
            <PlanFormulaHint
              title="부가적 평가(보고서 표 4.2.2-10)"
              lines={[
                '점수에 더하지 않고 기초순위를 조정하는 데 씁니다.',
                '추진가능성(지속성 × 정책성)과 계획성이 1이면 순위를 올리고 0이면 내립니다.',
                '처음 값은 기존 계획에서 항목별로 가장 많은 값(지속성 1·정책성 0·계획성 0)입니다.',
              ]}
            />
          </div>
          <div className="p-3">
            <PlanTableWrap minWidth={640}>
              <table className={cn(planTableClass, 'table-fixed')}>
                <colgroup>
                  <col className="w-[5.5rem]" />
                  <col />
                  <col />
                  <col className="w-[7rem]" />
                  <col className="w-[5.5rem]" />
                </colgroup>
                <thead>
                  <tr>
                    <th>항목</th>
                    <th className="text-center">1</th>
                    <th className="text-center">0</th>
                    <th className="text-center">선택</th>
                    <th className="text-center">출처</th>
                  </tr>
                </thead>
                <tbody>
                  {SUPP_ITEMS.map((s) => {
                    const picked = draft.supp[s.code]
                    return (
                      <tr key={s.code}>
                        <td className="font-medium">{s.name}</td>
                        <td className={cn(picked === 1 ? 'font-medium text-primary' : 'text-muted-foreground')}>{s.oneWhen}</td>
                        <td className={cn(picked === 0 ? 'font-medium text-primary' : 'text-muted-foreground')}>{s.zeroWhen}</td>
                        <td className="text-center">
                          <PlanChoice
                            disabled={readOnly}
                            value={picked}
                            onChange={(n) => update((d) => ({ ...d, supp: { ...d.supp, [s.code]: n }, suppDefault: false }))}
                            options={[
                              { value: 1 as const, label: '1' },
                              { value: 0 as const, label: '0' },
                            ]}
                          />
                        </td>
                        <td className="text-center">
                          <PlanSourceBadge source={picked == null ? 'MISSING' : draft.suppDefault ? 'DEFAULT' : 'MANUAL'} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </PlanTableWrap>
          </div>
        </section>
      </div>
    </>
  )
}

/** 피해 내역 — 분석 초안에 넣고 추가·수정·삭제. 지수·점수는 입력값으로 계산 */
function DamageEventEditor({
  draft,
  update,
  readOnly,
  baseDate,
  summary,
}: {
  draft: PlanVersion
  update: PlanStepProps['update']
  readOnly: boolean
  baseDate: string
  summary: PlanSummary
}) {
  const from = damageFromYmd(baseDate)
  const events = draft.damageEvents
  const total = damageIndex(draft, baseDate)
  const max = EVAL_ITEMS.find((i) => i.code === 'DAMAGE_IDX')!.max
  const score = summary.scores.DAMAGE_IDX.score
  const activeItems = DAMAGE_ITEMS.filter((d) => d.active)

  const patchEvent = (id: string, patch: Partial<(typeof events)[number]>) => {
    update((d) => ({
      ...d,
      damageNone: false,
      damageEvents: d.damageEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  }

  const addEvent = () => {
    update((d) => ({
      ...d,
      damageNone: false,
      damageEvents: [
        ...d.damageEvents,
        { id: uid('dmg'), occurredOn: '', itemCode: null, qty: null, overrideSupportIndex: null },
      ],
    }))
  }

  const removeEvent = (id: string) => {
    update((d) => {
      const damageEvents = d.damageEvents.filter((e) => e.id !== id)
      return { ...d, damageEvents, damageNone: damageEvents.length === 0 ? d.damageNone : false }
    })
  }

  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn(planText.body, 'text-muted-foreground')}>
          피해 내역 <span className="tabular-nums">(집계 {from} ~ {baseDate})</span>
        </span>
        {!readOnly ? (
          <button type="button" className={cn(smallPublicBtnGhost, 'ml-auto')} onClick={addEvent}>
            <Plus className="h-3 w-3" />
            피해 추가
          </button>
        ) : null}
      </div>
      <PlanTableWrap minWidth={980}>
        <table className={cn(planTableClass, 'table-fixed')}>
          <colgroup>
            <col className="w-[8.5rem]" />
            <col className="w-[12rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[9.5rem]" />
            <col className="w-[4rem]" />
            <col />
            {!readOnly ? <col className="w-[2.75rem]" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th>발생일</th>
              <th>피해 항목</th>
              <th className="text-right">물량</th>
              <th className="whitespace-nowrap text-right">지원기준지수(천원)</th>
              <th className="text-right">가중치</th>
              <th className="whitespace-nowrap text-right">피해이력지수</th>
              {!readOnly ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="py-4 text-center text-muted-foreground">
                  피해 내역이 없습니다. «피해 추가»로 넣거나 «피해 없음»을 고르세요.
                </td>
              </tr>
            ) : (
              events.map((e) => {
                const item = DAMAGE_ITEMS.find((d) => d.code === e.itemCode)
                const calc = damageRowCalc(e, baseDate)
                return (
                  <tr key={e.id}>
                    <td>
                      {readOnly ? (
                        <span className="tabular-nums">{e.occurredOn || '—'}</span>
                      ) : (
                        <input
                          type="date"
                          className={cn(planFieldClass, 'w-full')}
                          value={e.occurredOn || ''}
                          onChange={(ev) => patchEvent(e.id, { occurredOn: ev.target.value })}
                          aria-label="발생일"
                        />
                      )}
                    </td>
                    <td>
                      {readOnly ? (
                        item?.name ?? '—'
                      ) : (
                        <select
                          className={cn(planFieldClass, 'w-full')}
                          value={e.itemCode ?? ''}
                          onChange={(ev) => patchEvent(e.id, { itemCode: ev.target.value || null })}
                          aria-label="피해 항목"
                        >
                          <option value="">항목 선택</option>
                          {activeItems.map((d) => (
                            <option key={d.code} value={d.code}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="text-right">
                      {readOnly ? (
                        <span className="whitespace-nowrap tabular-nums">
                          {e.qty ?? '—'}
                          {item ? <span className="ml-1 text-[11px] text-muted-foreground">{item.unit}</span> : null}
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          <PlanNumInput
                            className="w-14 shrink-0"
                            value={e.qty}
                            onChange={(qty) => patchEvent(e.id, { qty })}
                            aria-label="물량"
                          />
                          {item ? (
                            <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                              {item.unit}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{num(calc.supportIndex, 4)}</td>
                    <td className="text-right tabular-nums">{num(calc.weight, 1)}</td>
                    <td className={cn('text-right tabular-nums', calc.skip && 'text-amber-700 dark:text-amber-400')}>
                      {calc.skip ? calc.skip : num(calc.index, 1)}
                    </td>
                    {!readOnly ? (
                      <td className="text-center">
                        <DeleteButton onClick={() => removeEvent(e.id)} label="피해 삭제" />
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </PlanTableWrap>
      <div className={cn(planText.body, 'rounded-md bg-muted/40 px-3 py-2 tabular-nums')}>
        {total == null ? (
          <span className="text-muted-foreground">계산된 피해 내역이 없습니다. 발생일·항목·물량을 모두 넣어야 계산됩니다.</span>
        ) : (
          <>
            <span className="text-muted-foreground">
              피해이력지수 / {SYSTEM_PARAMS.DAMAGE_DIVISOR.toLocaleString('ko-KR')} × {max} ={' '}
            </span>
            <span className="font-semibold text-primary">{score}점</span>
          </>
        )}
      </div>
    </div>
  )
}
