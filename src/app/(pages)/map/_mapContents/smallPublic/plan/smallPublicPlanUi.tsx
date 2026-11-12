'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRICE_BASIS_LABEL, type PriceBasis } from './smallPublicPlanMaster'
import { PLAN_SOURCE_LABEL, PLAN_STATUS_LABEL, type PlanSource, type PlanStatus } from './smallPublicPlanTypes'

/**
 * 분석 화면 글씨 체계
 * - caption 11: 단위·힌트·배지
 * - label 11 medium: 사이드·카드 구역명
 * - body 12: 본문·표·입력
 * - section 13 semibold: 구획·단계 제목
 * - kpi 14 semibold: 총점·순위 등 큰 숫자
 */
export const planText = {
  caption: 'text-[11px] font-normal leading-4',
  label: 'text-[11px] font-medium leading-4',
  body: 'text-[12px] font-normal leading-5',
  bodyEm: 'text-[12px] font-medium leading-5',
  section: 'text-[13px] font-semibold leading-5',
  kpi: 'text-[14px] font-semibold leading-none tabular-nums',
} as const

const SOURCE_CLASS: Record<PlanSource, string> = {
  AUTO: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300',
  DEFAULT: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  MANUAL: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300',
  ACTUAL: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
  MISSING: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
}

/** 값 출처 표시 — 자동·기본값·수기·실적·미입력 */
export function PlanSourceBadge({ source, className }: { source: PlanSource; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-px leading-tight',
        planText.caption,
        'font-medium',
        SOURCE_CLASS[source],
        className
      )}
    >
      {PLAN_SOURCE_LABEL[source]}
    </span>
  )
}

export function PlanPriceBasisBadge({ basis, title }: { basis: PriceBasis; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-px leading-tight',
        planText.caption,
        'font-medium',
        basis === 'PROVISIONAL'
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
      )}
    >
      {PRICE_BASIS_LABEL[basis]}
    </span>
  )
}

const STATUS_CLASS: Record<PlanStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  REVIEW: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  APPROVED: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  IN_PROGRESS: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  DONE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1 py-px text-[10px] font-medium leading-none',
        STATUS_CLASS[status]
      )}
    >
      {PLAN_STATUS_LABEL[status]}
    </span>
  )
}

/**
 * 계산 방법 안내 — «?»를 누르면 열리고, 다시 누르거나 바깥을 누르면 닫힘.
 * 카드·표 overflow에 잘리지 않도록 body 포털로 띄운다.
 */
export function PlanFormulaHint({ title, lines }: { title: string; lines: string[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const place = () => {
      const btn = btnRef.current
      const panel = panelRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const pw = panel?.offsetWidth ?? Math.min(640, window.innerWidth * 0.7)
      const ph = panel?.offsetHeight ?? 160
      let left = r.left
      let top = r.bottom + 6
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8)
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6)
      setPos({ top, left })
    }
    place()
    const id = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, lines, title])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground',
          open && 'bg-primary/10 text-primary'
        )}
        aria-label={`${title} 계산 방법 보기`}
        aria-expanded={open}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={title}
              className="fixed z-[100] w-max min-w-64 max-w-[min(40rem,calc(100vw-1rem))] whitespace-normal break-keep rounded-md border border-border bg-background p-3 text-left shadow-xl"
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
            >
              <p className={cn(planText.section, 'mb-1.5 text-foreground')}>{title}</p>
              <ul className="space-y-1">
                {lines.map((l) => (
                  <li key={l} className={cn(planText.body, 'flex gap-1.5 text-foreground/80')}>
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/** 분석 화면 구획 — 제목 줄은 슬레이트 톤(강조색과 겹치지 않게) */
export function PlanSection({
  title,
  actions,
  children,
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mb-2.5 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-slate-50 px-3 py-1.5 dark:bg-slate-900/40">
        <h4 className={cn(planText.section, 'flex min-w-0 flex-1 items-center gap-1 text-foreground')}>{title}</h4>
        {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div> : null}
      </div>
      <div className={cn(planText.body, 'px-3 py-2.5')}>{children}</div>
    </section>
  )
}

/** 고르는 버튼 묶음(라디오) — 한 줄 버튼, 보조 값(점수 등)은 같은 줄에 흐리게 */
export function PlanChoice<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: ReactNode; hint?: string }[]
  value: T | null
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex flex-wrap gap-1" role="radiogroup">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              planText.body,
              'inline-flex h-7 items-center gap-1 whitespace-nowrap rounded border px-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-foreground/80 hover:bg-muted/60'
            )}
          >
            {o.label}
            {o.hint ? <span className={cn(planText.caption, 'tabular-nums', on ? 'text-primary/70' : 'text-muted-foreground')}>{o.hint}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** 입력 줄 — 이름 | 입력 | 안내(오른쪽 칸에 맞춰 정렬) */
export function PlanFormRow({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,auto)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1">
      <span className={cn(planText.body, 'text-muted-foreground')}>{label}</span>
      <div className={cn(planText.body, 'flex min-w-0 flex-wrap items-center gap-1.5')}>{children}</div>
      <div className={cn(planText.body, 'min-w-0 text-muted-foreground')}>{note}</div>
    </div>
  )
}

/** 구간 점수 표시 — 지금 값이 들어간 구간을 파랗게 */
export function PlanBands({ bands, active }: { bands: { label: string; score: number }[]; active: number | null }) {
  return (
    <div className="flex flex-wrap gap-1">
      {bands.map((b, i) => (
        <span
          key={b.label}
          className={cn(
            planText.caption,
            'whitespace-nowrap rounded border px-1.5 py-0.5 tabular-nums',
            i === active ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground'
          )}
        >
          {b.label} · {b.score}점
        </span>
      ))}
    </div>
  )
}

/** 분석 화면 입력칸 */
export const planFieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-2 text-[12px] font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted/50 disabled:text-foreground/80'

/** 빈칸 = null 인 숫자 입력 */
export function PlanNumInput({
  value,
  onChange,
  disabled,
  className,
  step,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  className?: string
  step?: number
  placeholder?: string
  'aria-label'?: string
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      className={cn(planFieldClass, 'text-right tabular-nums', className)}
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value.trim()
        const n = Number(raw)
        onChange(raw === '' || !Number.isFinite(n) ? null : n)
      }}
    />
  )
}

/**
 * 분석 화면 표 — 바깥 테두리는 PlanTableWrap, 안은 가로 구분선만.
 * 선택 없는 표라 행 호버 없음.
 */
export const planTableClass = cn(
  'w-full border-collapse text-left text-[12px] font-normal',
  '[&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:align-middle [&_th]:font-medium [&_th]:text-muted-foreground',
  '[&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-middle [&_td]:font-normal',
  '[&_tbody_tr:last-child_td]:border-b-0'
)

/** 표 감싸기 — 바깥 테두리 한 겹, 좁으면 가로 스크롤 */
export function PlanTableWrap({ minWidth, children }: { minWidth: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-background scrollbar-thin">
      <div style={{ minWidth }}>{children}</div>
    </div>
  )
}
