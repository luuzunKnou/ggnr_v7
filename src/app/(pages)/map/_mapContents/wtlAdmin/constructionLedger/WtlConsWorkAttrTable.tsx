'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getConsLedgerVariant, type ConsLedgerKind } from '@/lib/consLedgerVariant'
import {
  getDefineFieldDisplayLabel,
  selectDefineLayerDetailFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { WTL_CONS_FIELD_LABEL, type WtlConsWork } from './wtlConsSample'

/** DB 컬럼명 → 공사 행 값 */
const WORK_FIELD_VALUE: Record<string, (work: WtlConsWork) => string> = {
  cons_code: (w) => w.consCode,
  cons_name: (w) => w.name,
  cons_locat: (w) => w.location,
  cons_volum: (w) => w.volume,
  amount_pre: (w) => w.amountPre,
  amount_var: (w) => w.amountVar,
  amount_cha: (w) => w.amountCha,
  amount_aft: (w) => w.amountAft,
  cont_date: (w) => w.contDate,
  start_date: (w) => w.startDate,
  done_date: (w) => w.doneDate,
  sdone_date: (w) => w.sdoneDate,
  busin_name: (w) => w.company,
  ceo_name: (w) => w.ceo,
  busin_addr: (w) => w.companyAddr,
  busin_phon: (w) => w.companyPhone,
  direct_pos: (w) => w.directorPos,
  direct_nam: (w) => w.directorName,
  reason: (w) => w.reason,
  descript: (w) => w.descript,
}

/** 같은 집합에 속한 연속 필드 → 1행 2열 */
const PAIR_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['amount_pre', 'amount_var', 'amount_cha', 'amount_aft']),
  new Set(['cont_date', 'start_date', 'done_date', 'sdone_date']),
  new Set(['direct_pos', 'direct_nam']),
]

const SKIP_DETAIL_NAMES = new Set(['ogc_fid', 'gid', 'id'])

type AttrItem = { name: string; label: string; value: string }

type LayoutBlock =
  | { type: 'row'; item: AttrItem }
  | { type: 'pair'; left: AttrItem; right: AttrItem }

function displayOrDash(value: string | undefined | null): string {
  const s = String(value ?? '').trim()
  return s || '—'
}

function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] border-b border-slate-100 text-[11px] last:border-b-0">
      <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{label}</div>
      <div className="break-words px-2 py-1.5 text-slate-800">{displayOrDash(value)}</div>
    </div>
  )
}

function AttrPairRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
}: {
  leftLabel: string
  leftValue: string
  rightLabel: string
  rightValue: string
}) {
  return (
    <div className="grid grid-cols-2 border-b border-slate-100 text-[11px] last:border-b-0">
      <div className="grid min-w-0 grid-cols-[96px_1fr] border-r border-slate-100">
        <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{leftLabel}</div>
        <div className="break-words px-2 py-1.5 text-slate-800">{displayOrDash(leftValue)}</div>
      </div>
      <div className="grid min-w-0 grid-cols-[96px_1fr]">
        <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{rightLabel}</div>
        <div className="break-words px-2 py-1.5 text-slate-800">{displayOrDash(rightValue)}</div>
      </div>
    </div>
  )
}

function pairGroupOf(name: string): ReadonlySet<string> | null {
  return PAIR_GROUPS.find((g) => g.has(name)) ?? null
}

function toAttrItem(field: DefineFieldLike, work: WtlConsWork): AttrItem | null {
  const name = String(field.define_field_name ?? '').trim()
  if (!name || SKIP_DETAIL_NAMES.has(name.toLowerCase())) return null
  const getter = WORK_FIELD_VALUE[name]
  if (!getter) return null
  return {
    name,
    label: getDefineFieldDisplayLabel(name, field.define_field_kor_name) || name,
    value: getter(work),
  }
}

/** define 상세 필드(idx 순) → 단건/2열 블록. 연속·동일 묶음이면 2열 */
export function buildWorkAttrLayout(fields: DefineFieldLike[], work: WtlConsWork): LayoutBlock[] {
  const items = fields
    .map((f) => toAttrItem(f, work))
    .filter((x): x is AttrItem => Boolean(x))
  const blocks: LayoutBlock[] = []
  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!
    const next = items[i + 1]
    const group = pairGroupOf(cur.name)
    if (next && group && group.has(next.name)) {
      blocks.push({ type: 'pair', left: cur, right: next })
      i += 1
      continue
    }
    blocks.push({ type: 'row', item: cur })
  }
  return blocks
}

/** defineLayer 로드 실패 시 — 기존 고정 순서 */
function fallbackLayout(work: WtlConsWork): LayoutBlock[] {
  const L = WTL_CONS_FIELD_LABEL
  return [
    { type: 'row', item: { name: 'cons_name', label: L.name, value: work.name } },
    { type: 'row', item: { name: 'cons_locat', label: L.location, value: work.location } },
    { type: 'row', item: { name: 'cons_volum', label: L.volume, value: work.volume } },
    {
      type: 'pair',
      left: { name: 'amount_pre', label: L.amountPre, value: work.amountPre },
      right: { name: 'amount_var', label: L.amountVar, value: work.amountVar },
    },
    {
      type: 'pair',
      left: { name: 'amount_cha', label: L.amountCha, value: work.amountCha },
      right: { name: 'amount_aft', label: L.amountAft, value: work.amountAft },
    },
    {
      type: 'pair',
      left: { name: 'cont_date', label: L.contDate, value: work.contDate },
      right: { name: 'start_date', label: L.startDate, value: work.startDate },
    },
    {
      type: 'pair',
      left: { name: 'done_date', label: L.doneDate, value: work.doneDate },
      right: { name: 'sdone_date', label: L.sdoneDate, value: work.sdoneDate },
    },
    { type: 'row', item: { name: 'busin_name', label: L.company, value: work.company } },
    { type: 'row', item: { name: 'ceo_name', label: L.ceo, value: work.ceo } },
    { type: 'row', item: { name: 'busin_addr', label: L.companyAddr, value: work.companyAddr } },
    { type: 'row', item: { name: 'busin_phon', label: L.companyPhone, value: work.companyPhone } },
    {
      type: 'pair',
      left: { name: 'direct_pos', label: L.directorPos, value: work.directorPos },
      right: { name: 'direct_nam', label: L.directorName, value: work.directorName },
    },
    { type: 'row', item: { name: 'reason', label: L.reason, value: work.reason } },
    { type: 'row', item: { name: 'descript', label: L.descript, value: work.descript } },
  ]
}

function useConsDetailFields(tableName: string) {
  const [fields, setFields] = useState<DefineFieldLike[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const name = tableName.trim()
    if (!name) {
      setFields([])
      setLoading(false)
      return
    }
    setLoading(true)
    void fetch(`/api/config/defineLayer/fields/${encodeURIComponent(name)}`)
      .then((r) => r.json() as Promise<{ success?: boolean; data?: DefineFieldLike[] } | DefineFieldLike[]>)
      .then((body) => {
        if (cancelled) return
        const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
        setFields(selectDefineLayerDetailFields(raw))
      })
      .catch(() => {
        if (!cancelled) setFields([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tableName])

  return { fields, loading }
}

type Props = {
  work: WtlConsWork
  kind?: ConsLedgerKind
  /** 급수구역 등 본표 아래 추가 블록 */
  footer?: ReactNode
}

/**
 * 공사정보 속성 표 — defineLayer show_detail·idx·한글명 연동.
 * 사업비·날짜·감독관은 연속이면 2열 유지.
 */
export function WtlConsWorkAttrTable({ work, kind = 'wtl', footer }: Props) {
  const tableName = getConsLedgerVariant(kind).mainTable
  const { fields, loading } = useConsDetailFields(tableName)

  const blocks = useMemo(() => {
    const fromDefine = buildWorkAttrLayout(fields, work)
    if (fromDefine.length > 0) return fromDefine
    if (loading) return []
    return fallbackLayout(work)
  }, [fields, work, loading])

  return (
    <div className="overflow-hidden rounded border border-slate-200">
      {loading && blocks.length === 0 ? (
        <p className="px-2 py-3 text-center text-[11px] text-slate-400">속성 불러오는 중…</p>
      ) : (
        blocks.map((block, index) =>
          block.type === 'pair' ? (
            <AttrPairRow
              key={`p-${block.left.name}-${block.right.name}-${index}`}
              leftLabel={block.left.label}
              leftValue={block.left.value}
              rightLabel={block.right.label}
              rightValue={block.right.value}
            />
          ) : (
            <AttrRow
              key={`r-${block.item.name}-${index}`}
              label={block.item.label}
              value={block.item.value}
            />
          )
        )
      )}
      {footer}
    </div>
  )
}
