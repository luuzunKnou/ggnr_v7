'use client'

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../_mapComponents/standard/ServiceFileImagePreview'
import { buildServiceFilePreviewItem } from '../../_mapComponents/standard/serviceFilePreviewItems'
import { getStateGradeBadgeClass } from '../fmsLinkage/stateGradeBadge'
import {
  SMALL_PUBLIC_CLASS_BADGE,
  SMALL_PUBLIC_FAC_TYPES,
  type SmallPublicCandidate,
  type SmallPublicFacType,
} from './smallPublicConfig'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicInspection } from './smallPublicMock'

export function SmallPublicPanelHeader({
  title,
  onClose,
  actions,
  badge,
}: {
  title: string
  onClose: () => void
  actions?: ReactNode
  badge?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {badge}
        <span className="truncate text-sm font-semibold text-foreground" title={title}>
          {title}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** 시설 유형 — 한 줄 6칸 구분 막대, 고른 유형만 흰 칸으로 떠 보임 */
export function SmallPublicTypeTabs({
  value,
  onChange,
}: {
  value: SmallPublicFacType
  onChange: (type: SmallPublicFacType) => void
}) {
  return (
    <div className="shrink-0 px-3 pt-2.5">
      <div className="grid grid-cols-6 gap-0.5 rounded-lg bg-muted p-1" role="tablist" aria-label="시설 유형">
        {SMALL_PUBLIC_FAC_TYPES.map((t) => {
          const active = value === t
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t)}
              className={cn(
                'h-7 min-w-0 truncate rounded px-0.5 text-center text-[11px] transition-colors',
                active
                  ? 'bg-background font-semibold text-primary shadow-sm ring-1 ring-border'
                  : 'font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground'
              )}
            >
              {t}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 목록에서 고른 행 — 왼쪽 파란 띠 + 진한 바탕으로 눈에 띄게 */
export const smallPublicSelectedRowClass =
  'bg-primary/15 shadow-[inset_3px_0_0_0_var(--primary)] hover:bg-primary/20'

/** 고른 행이 목록 밖에 있으면 보이는 곳까지 스크롤 */
export function useSmallPublicScrollSelectedIntoView(
  containerRef: RefObject<HTMLElement | null>,
  selectedId: string | null
) {
  useEffect(() => {
    if (!selectedId) return
    const row = containerRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [containerRef, selectedId])
}

const dash = (s: string | null | undefined) => (String(s ?? '').trim() ? String(s) : '—')

/** 속성 표 일자 — «2020-12-30»·«2020년12월30일» 등을 «2020년 12월 30일»로. 알아볼 수 없으면 그대로 */
export function smallPublicDateLabel(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s) return '—'
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!m) return s
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`
}

export type SmallPublicAttrKey =
  | 'mngNo'
  | 'name'
  | 'geomCode'
  | 'type'
  | 'emd'
  | 'ri'
  | 'address'
  | 'startXy'
  | 'endXy'
  | 'riskRank'
  | 'riskScore'
  | 'benefitArea'
  | 'riskDate'
  | 'surveyDate'
  | 'surveyor'
  | 'candidate'
  | 'length'
  | 'width'
  | 'height'

/**
 * 시설 속성 19개 — 후보지·안전점검 상세 공용.
 * 위험도등급·점수·현장조사일자·현장조사자는 가장 최근 점검(연계·입력 모두, 없으면 자료 값)으로 자동.
 * edit 에 넣은 항목만 입력칸으로 바뀐다.
 */
export function smallPublicFacilityAttrEntries(
  f: SmallPublicFacility,
  latest: { grade: string; score: number; date: string; inspector: string } | null,
  edit?: Partial<Record<SmallPublicAttrKey, ReactNode>>
): { key: string; label: string; value: ReactNode; full?: boolean }[] {
  const grade = latest?.grade ?? f.riskRank
  const score = latest ? String(latest.score) : f.riskScore
  const surveyDate = latest?.date || f.surveyDate
  const surveyor = latest?.inspector || f.surveyor
  /** 수정 중에도 칸 배치가 바뀌지 않도록 보기 글자 길이로 전체 행 여부를 정함 */
  const row = (key: SmallPublicAttrKey, label: string, view: ReactNode, full?: boolean) => ({
    key,
    label,
    value: edit?.[key] ?? view,
    full: full || (typeof view === 'string' && smallPublicIsLongAttrText(view)),
  })
  return [
    row('mngNo', '관리번호', dash(f.mngNo)),
    row('name', '시설명', dash(f.name)),
    row('geomCode', '도형코드', dash(f.geomCode)),
    row('type', '유형', f.type),
    row('emd', '읍면명', dash(f.emd)),
    row('ri', '리명', dash(f.ri)),
    row('address', '주소', dash(f.address), true),
    row('startXy', '시점좌표', dash(f.startXy), true),
    row('endXy', '종점좌표', dash(f.endXy), true),
    row('riskRank', '위험도등급', grade ? <SmallPublicGradeBadge grade={grade} /> : '—'),
    row('riskScore', '위험도점수', score ? `${score}점` : '—'),
    row('benefitArea', '수혜지역', dash(f.benefitArea)),
    row('riskDate', '위험시설지정일', smallPublicDateLabel(f.riskDate), true),
    row('surveyDate', '현장조사일자', smallPublicDateLabel(surveyDate)),
    row('surveyor', '현장조사자', dash(surveyor)),
    row('candidate', '후보지', <SmallPublicClassBadge candidate={f.candidate} />),
    row('length', '연장(m)', dash(f.length)),
    row('width', '폭(m)', dash(f.width)),
    row('height', '높이(m)', dash(f.height)),
  ]
}

/** FMS 안전점검 목록 필터와 같은 칩 */
export function SmallPublicChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value || '__all__'}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[10px] font-medium leading-tight transition-colors',
              active
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export type SmallPublicSortDir = 'asc' | 'desc'
export type SmallPublicSortSpec<K extends string> = { key: K; dir: SmallPublicSortDir }
export type SmallPublicSortState<K extends string> = {
  sorts: SmallPublicSortSpec<K>[]
  toggle: (key: K) => void
  initialDir: (key: K) => SmallPublicSortDir
}

/** 점용 목록과 같은 다중 정렬: 클릭마다 추가(기본 방향) → 반대 방향 → 해제 */
export function useSmallPublicSort<K extends string>(
  initialDir: (key: K) => SmallPublicSortDir
): SmallPublicSortState<K> {
  const [sorts, setSorts] = useState<SmallPublicSortSpec<K>[]>([])
  const toggle = (key: K) => {
    const initial = initialDir(key)
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (idx < 0) return [...prev, { key, dir: initial }]
      if (prev[idx].dir === initial) {
        const next = [...prev]
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' }
        return next
      }
      return prev.filter((_, i) => i !== idx)
    })
  }
  return { sorts, toggle, initialDir }
}

/** 빈 값은 방향과 무관하게 맨 아래, 동점은 들어온 순서(기본 정렬) 유지 */
export function smallPublicSortRows<T, K extends string>(
  rows: T[],
  sorts: SmallPublicSortSpec<K>[],
  valueOf: (row: T, key: K) => string | number | null | undefined
): T[] {
  if (sorts.length === 0) return rows
  return [...rows].sort((a, b) => {
    for (const { key, dir } of sorts) {
      const av = valueOf(a, key)
      const bv = valueOf(b, key)
      const aEmpty = av == null || av === ''
      const bEmpty = bv == null || bv === ''
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) continue
        return aEmpty ? 1 : -1
      }
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'ko')
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
    }
    return 0
  })
}

export function SmallPublicSortTh<K extends string>({
  sortKey,
  label,
  sort,
  align = 'left',
  className,
}: {
  sortKey: K
  label: string
  sort: SmallPublicSortState<K>
  align?: 'left' | 'center'
  className?: string
}) {
  const spec = sort.sorts.find((s) => s.key === sortKey)
  const Icon = !spec ? ArrowUpDown : spec.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={cn(align === 'center' ? 'text-center' : 'text-left', className)}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className={cn(
          'inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-muted',
          spec ? 'text-primary' : 'text-foreground/90'
        )}
        title={
          !spec
            ? `${label} 정렬 추가`
            : spec.dir === sort.initialDir(sortKey)
              ? `${label} 방향 바꾸기`
              : `${label} 정렬 해제`
        }
      >
        <span className="truncate">{label}</span>
        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>
    </th>
  )
}

export function SmallPublicGradeBadge({ grade }: { grade: string | null | undefined }) {
  const g = String(grade ?? '').trim()
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-[2.5rem] items-center justify-center rounded px-1.5 text-[10px] font-semibold',
        g === '불량' ? SMALL_PUBLIC_CLASS_BADGE.위험 : getStateGradeBadgeClass(g)
      )}
    >
      {g || '—'}
    </span>
  )
}

/** 점검 이력 표 — FMS 안전점검 «점검진단실적» 표와 같은 모양, 최신 순 */
export function SmallPublicInspectionTable({
  rows,
  selectedId,
  onRowClick,
  emptyText,
}: {
  rows: SmallPublicInspection[]
  selectedId?: string | null
  onRowClick: (id: string) => void
  emptyText: string
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
        {emptyText}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
        <colgroup>
          <col className="w-[5.75rem]" />
          <col className="w-[3rem]" />
          <col />
          <col className="w-[3rem]" />
          <col className="w-[3.75rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>점검일</th>
            <th>구분</th>
            <th>점검자</th>
            <th className="text-right">점수</th>
            <th className="text-center">등급</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const active = selectedId === i.id
            return (
              <tr
                key={i.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => onRowClick(i.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onRowClick(i.id)
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-border transition-colors last:border-b-0',
                  active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                )}
              >
                <td className="truncate px-1.5 py-1 tabular-nums text-foreground/80">{i.date}</td>
                <td className="truncate px-1.5 py-1 text-foreground/80">{i.source}</td>
                <td className="truncate px-1.5 py-1 text-foreground/80" title={i.inspector}>
                  {i.inspector || '—'}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums text-foreground/80">{i.score}</td>
                <td className="px-1.5 py-1 text-center">
                  <SmallPublicGradeBadge grade={i.grade} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SmallPublicClassBadge({ candidate }: { candidate: SmallPublicCandidate }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-semibold',
        SMALL_PUBLIC_CLASS_BADGE[candidate]
      )}
    >
      {candidate === '제외' ? '제외' : `${candidate}시설`}
    </span>
  )
}

/** 반 칸(2열 중 하나)에 한 줄로 들어가는 대략 길이 — 한글 1, 영문·숫자·기호 0.6 */
const HALF_CELL_TEXT_UNITS = 10

function textUnits(text: string): number {
  let n = 0
  for (const ch of text) n += /[\u3131-\uD7A3]/.test(ch) ? 1 : 0.6
  return n
}

/** 반 칸에 두 줄로 넘칠 글자인지 — 넘치면 표에서 한 행 전체를 쓴다 */
export function smallPublicIsLongAttrText(text: string | null | undefined): boolean {
  return textUnits(String(text ?? '').trim()) > HALF_CELL_TEXT_UNITS
}

/** 속성 표 — 기본 2열, 긴 값(반 칸에서 두 줄이 될 글자)·전체 행 항목은 한 행 전체 (도로망도 상세 속성 표와 같은 모양) */
export function SmallPublicAttrTable({
  entries: rawEntries,
}: {
  entries: { key: string; label: string; value: ReactNode; full?: boolean }[]
}) {
  const entries = rawEntries.map((e) =>
    !e.full && typeof e.value === 'string' && smallPublicIsLongAttrText(e.value) ? { ...e, full: true } : e
  )
  const rows: { left: (typeof entries)[number]; right?: (typeof entries)[number] }[] = []
  for (let i = 0; i < entries.length; ) {
    const left = entries[i]!
    const right = entries[i + 1]
    if (left.full || !right || right.full) {
      rows.push({ left })
      i += 1
    } else {
      rows.push({ left, right })
      i += 2
    }
  }
  const cell = (e: (typeof entries)[number]) => (
    <div className="flex min-w-0 items-stretch">
      <div className="flex w-[6.5rem] shrink-0 items-center bg-muted px-1.5 py-1">
        <span className="whitespace-nowrap text-[11px] leading-snug text-muted-foreground">{e.label}</span>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden px-1.5 py-1">
        {typeof e.value === 'string' ? (
          <span
            className="block truncate text-[11px] leading-snug text-foreground/80"
            title={e.value === '—' ? undefined : e.value}
          >
            {e.value}
          </span>
        ) : (
          e.value
        )}
      </div>
    </div>
  )
  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      {rows.map((r, idx) => (
        <div
          key={r.left.key}
          className={cn(
            r.right ? 'grid grid-cols-2 divide-x divide-border' : '',
            idx < rows.length - 1 && 'border-b border-border'
          )}
        >
          {cell(r.left)}
          {r.right ? cell(r.right) : null}
        </div>
      ))}
    </div>
  )
}

function downloadSmallPublicFile(file: SmallPublicFile) {
  if (!file.url) {
    window.alert('예시 자료라 실제 파일이 없습니다. 직접 올린 파일만 내려받을 수 있습니다.')
    return
  }
  const a = document.createElement('a')
  a.href = file.url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * 첨부 크게 보기(이미지·PDF·엑셀) — group 을 주면 같은 목록의 파일을 모두 넘겨 미리보기 창 왼쪽 목록에서 바꿔 볼 수 있다.
 * 미리보기가 안 되는 파일은 내려받기.
 */
export function useSmallPublicFilePreview() {
  const [state, setState] = useState<{ items: ServiceFilePreviewItem[]; index: number } | null>(null)
  const open = useCallback((file: SmallPublicFile, group?: SmallPublicFile[]) => {
    if (!file.url) {
      window.alert('예시 자료라 실제 파일이 없습니다. 직접 올린 파일만 미리보기할 수 있습니다.')
      return
    }
    if (!buildServiceFilePreviewItem(file.name, file.url)) {
      downloadSmallPublicFile(file)
      return
    }
    const list = group && group.some((g) => g.id === file.id) ? group : [file]
    const items: ServiceFilePreviewItem[] = []
    let index = 0
    for (const g of list) {
      const item = g.url ? buildServiceFilePreviewItem(g.name, g.url) : null
      if (!item) continue
      if (g.id === file.id) index = items.length
      items.push(item)
    }
    setState({ items, index })
  }, [])
  const element = state ? (
    <ServiceFileImagePreview items={state.items} initialIndex={state.index} onClose={() => setState(null)} />
  ) : null
  return { open, element, download: downloadSmallPublicFile }
}

export function SmallPublicFileRow({
  file,
  onPreview,
  onDownload,
  onRemove,
}: {
  file: SmallPublicFile
  onPreview: () => void
  onDownload: () => void
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1.5">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground hover:text-primary hover:underline"
        title={`${file.name} 미리보기`}
      >
        {file.name}
      </button>
      {!file.url ? <span className="shrink-0 text-[10px] text-muted-foreground">예시</span> : null}
      <button
        type="button"
        onClick={onDownload}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="내려받기"
        aria-label="내려받기"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10"
          title="삭제"
          aria-label="삭제"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
