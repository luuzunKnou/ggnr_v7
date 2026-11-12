'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, Loader2, Pencil, Save, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { smallPublicBtnDanger, smallPublicBtnGhost, smallPublicBtnPrimary } from './smallPublicConfig'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../_mapComponents/standard/ServiceFileImagePreview'
import { ServiceFilePdfPreview } from '../../_mapComponents/standard/ServiceFilePdfPreview'
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
        <span className="min-w-0 text-[12px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{title}</span>
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
/** 시설 유형 탭 — 맨 앞 «전체»('') 포함 */
export function SmallPublicTypeTabs({
  value,
  onChange,
}: {
  value: SmallPublicFacType | ''
  onChange: (type: SmallPublicFacType | '') => void
}) {
  const tabs: (SmallPublicFacType | '')[] = ['', ...SMALL_PUBLIC_FAC_TYPES]
  return (
    <div className="shrink-0 px-3 pt-2.5">
      <div className="grid grid-cols-7 gap-0.5 rounded-lg bg-muted p-1" role="tablist" aria-label="시설 유형">
        {tabs.map((t) => {
          const active = value === t
          return (
            <button
              key={t || '__all__'}
              title={t || '전체'}
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
              {t === '' ? '전체' : t === '마을진입로' ? '진입로' : t}
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
        <span className="whitespace-nowrap">{label}</span>
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
          <col />
          <col className="w-[3rem]" />
          <col className="w-[3.75rem]" />
          <col className="w-[4.25rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>점검일</th>
            <th>점검자</th>
            <th className="text-right">점수</th>
            <th className="text-center">등급</th>
            <th className="text-center">평가구분</th>
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
                <td className="truncate px-1.5 py-1 text-foreground/80" title={i.inspector}>
                  {i.inspector || '—'}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums text-foreground/80">{i.score}</td>
                <td className="px-1.5 py-1 text-center">
                  <SmallPublicGradeBadge grade={i.grade} />
                </td>
                <td className="px-1.5 py-1 text-center">
                  <SmallPublicClassBadge candidate={i.classResult} />
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
        'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded px-1.5 text-[10px] font-semibold',
        SMALL_PUBLIC_CLASS_BADGE[candidate]
      )}
    >
      {candidate === '제외' ? '제외' : `${candidate}시설`}
    </span>
  )
}

/** 후보지 평가 결과 — 구분 뱃지와 같은 크기 */
export function SmallPublicCandidateResultBadge({ result }: { result: '선정' | '선정제외' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded px-1.5 text-[10px] font-semibold',
        result === '선정' ? SMALL_PUBLIC_CLASS_BADGE.일반 : SMALL_PUBLIC_CLASS_BADGE.위험
      )}
    >
      {result}
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
  /** 한 줄에 항목 하나만 (점검 상세 등) */
  stacked = false,
}: {
  entries: { key: string; label: string; value: ReactNode; full?: boolean }[]
  stacked?: boolean
}) {
  const entries = rawEntries.map((e) =>
    !e.full && typeof e.value === 'string' && smallPublicIsLongAttrText(e.value) ? { ...e, full: true } : e
  )
  const rows: { left: (typeof entries)[number]; right?: (typeof entries)[number] }[] = []
  for (let i = 0; i < entries.length; ) {
    const left = entries[i]!
    const right = entries[i + 1]
    if (stacked || left.full || !right || right.full) {
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
      <div className="min-w-0 flex-1 px-1.5 py-1">
        {typeof e.value === 'string' ? (
          <span className="block whitespace-pre-wrap break-words text-[11px] leading-snug text-foreground/80">
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

/** 미리보기·행에 필요한 최소 첨부 정보(공사 첨부 등 kind 가 다른 자료도 포함) */
type SmallPublicFileRef = { id: string; name: string; url?: string }

function downloadSmallPublicFile(file: SmallPublicFileRef) {
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
 * 첨부 크게 보기 — group 을 주면 묶음 파일을 모두 넘긴다.
 * PDF만이면 기본계획도처럼 왼쪽 «PDF 목록»+«페이지» 썸네일 뷰어,
 * 이미지·엑셀이 섞이면 일반 미리보기.
 */
export function useSmallPublicFilePreview() {
  const [state, setState] = useState<{
    items: ServiceFilePreviewItem[]
    index: number
    key: number
    pdfOnly: boolean
    page: number
  } | null>(null)
  const open = useCallback((file: SmallPublicFileRef, group?: SmallPublicFileRef[], opts?: { page?: number }) => {
    if (!file.url) {
      window.alert('예시 자료라 실제 파일이 없습니다. 직접 올린 파일만 미리보기할 수 있습니다.')
      return
    }
    if (!buildServiceFilePreviewItem(file.name, file.url)) {
      downloadSmallPublicFile(file)
      return
    }
    const raw = group && group.length > 0 ? group : [file]
    const byId = new Map<string, SmallPublicFileRef>()
    for (const g of raw) byId.set(g.id, g)
    if (!byId.has(file.id)) byId.set(file.id, file)
    const list = [...byId.values()]
    const items: ServiceFilePreviewItem[] = []
    let index = 0
    for (const g of list) {
      const item = g.url ? buildServiceFilePreviewItem(g.name, g.url) : null
      if (!item) continue
      if (g.id === file.id || g.url === file.url) index = items.length
      items.push(item)
    }
    if (items.length === 0) {
      downloadSmallPublicFile(file)
      return
    }
    const pdfOnly = items.every((it) => it.kind === 'pdf')
    setState({ items, index, key: Date.now(), pdfOnly, page: Math.max(1, opts?.page ?? 1) })
  }, [])
  const pdfItems = useMemo(
    () => (state?.pdfOnly ? state.items.map((it) => ({ url: it.url, fileName: it.fileName })) : null),
    [state]
  )
  const element = state ? (
    state.pdfOnly && pdfItems ? (
      <ServiceFilePdfPreview
        key={state.key}
        items={pdfItems}
        initialIndex={state.index}
        initialPage={state.page}
        onClose={() => setState(null)}
      />
    ) : (
      <ServiceFileImagePreview
        key={state.key}
        items={state.items}
        initialIndex={state.index}
        onClose={() => setState(null)}
      />
    )
  ) : null
  return { open, element, download: downloadSmallPublicFile }
}

export function SmallPublicFileRow({
  file,
  onPreview,
  onDownload,
  onRemove,
}: {
  file: SmallPublicFileRef
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

/** 목록 옆 미리보기 — 이미지·PDF는 바로 보이고, 그 외는 아이콘 */
export function SmallPublicFileThumb({
  file,
  onClick,
  size = 'md',
}: {
  file: SmallPublicFileRef | null | undefined
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
}) {
  const box =
    size === 'lg' ? 'h-16 w-14' : size === 'sm' ? 'h-10 w-8' : 'h-14 w-12'
  if (!file) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/40 text-[9px] text-muted-foreground',
          box
        )}
      >
        없음
      </div>
    )
  }
  const isImage = !!file.url && /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
  const isPdf = !!file.url && /\.pdf$/i.test(file.name)
  const inner = isImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={file.url} alt="" className="h-full w-full object-cover" />
  ) : isPdf ? (
    <object data={`${file.url}#page=1&view=FitH`} type="application/pdf" className="pointer-events-none h-[200%] w-[200%] origin-top-left scale-50">
      <FileText className="m-auto h-5 w-5 text-muted-foreground" />
    </object>
  ) : (
    <FileText className="h-5 w-5 text-muted-foreground" />
  )
  const frame = cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/30',
    box,
    onClick && 'transition-colors hover:border-primary hover:ring-1 hover:ring-primary/30'
  )
  if (!onClick) {
    return <div className={frame}>{inner}</div>
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={frame}
      title={`${file.name} 미리보기`}
      aria-label={`${file.name} 미리보기`}
    >
      {inner}
    </button>
  )
}

/** 목록 아래 최근 결과 요약 칸 */
export function SmallPublicRecentResult({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-3 rounded-[5px] border border-border bg-muted/30 px-2.5 py-2">
      <p className="mb-1 text-[10px] font-semibold text-muted-foreground">{title ?? '최근 결과'}</p>
      <div className="text-[11px] leading-snug text-foreground/90">{children}</div>
    </div>
  )
}

/** 목록 아래 PDF — 로딩 표시 후 페이지 렌더. 휠로 페이지 이동, 클릭 시 현재 페이지로 크게 보기 */
function SmallPublicInlinePdfPreview({
  url,
  name,
  onOpenFull,
}: {
  url: string
  name: string
  onOpenFull?: (page: number) => void
}) {
  const rootRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const pageRef = useRef(1)
  const numPagesRef = useRef(0)
  pageRef.current = page
  numPagesRef.current = numPages

  useEffect(() => {
    let cancelled = false
    let removeWheel: (() => void) | null = null
    let releaseDoc: (() => void) | null = null
    setPhase('loading')
    setPage(1)
    setNumPages(0)

    void (async () => {
      try {
        const { configurePdfJsWorker } = await import('@/lib/pdfjsWorker')
        const { acquirePdfDocument, releasePdfDocument } = await import(
          '../../_mapComponents/standard/pdfDocumentCache'
        )
        configurePdfJsWorker()
        const pdf = await acquirePdfDocument(url)
        releaseDoc = () => releasePdfDocument(url)
        if (cancelled) {
          releaseDoc()
          return
        }

        const paint = async (pn: number) => {
          const canvas = canvasRef.current
          if (!canvas || cancelled) return
          setPhase('loading')
          const pg = await pdf.getPage(Math.min(Math.max(1, pn), pdf.numPages))
          if (cancelled) return
          const base = pg.getViewport({ scale: 1 })
          const maxW = Math.max(120, rootRef.current?.clientWidth ?? 280)
          const scale = Math.min(1.25, maxW / base.width)
          const viewport = pg.getViewport({ scale })
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await pg.render({ canvasContext: ctx, viewport }).promise
          if (!cancelled) setPhase('ready')
        }

        setNumPages(pdf.numPages)
        await paint(1)

        const onWheel = (e: WheelEvent) => {
          if (numPagesRef.current <= 1) return
          e.preventDefault()
          const dir = e.deltaY > 0 ? 1 : -1
          const next = Math.min(numPagesRef.current, Math.max(1, pageRef.current + dir))
          if (next === pageRef.current) return
          setPage(next)
          void paint(next)
        }
        const el = rootRef.current
        el?.addEventListener('wheel', onWheel, { passive: false })
        removeWheel = () => el?.removeEventListener('wheel', onWheel)
        if (cancelled) {
          removeWheel()
          releaseDoc()
        }
      } catch {
        if (!cancelled) setPhase('error')
      }
    })()

    return () => {
      cancelled = true
      removeWheel?.()
      releaseDoc?.()
    }
  }, [url])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[5px] border border-border bg-black">
      <button
        ref={rootRef}
        type="button"
        className={cn(
          'relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto',
          onOpenFull && 'cursor-zoom-in'
        )}
        onClick={() => onOpenFull?.(pageRef.current)}
        title={onOpenFull ? `${name} · ${page}페이지 크게 보기` : name}
        aria-label={onOpenFull ? '크게 보기' : name}
      >
        {phase === 'loading' ? (
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-black/55 text-[11px] text-white/80">
            <Loader2 className="h-6 w-6 animate-spin text-white/50" aria-hidden />
            불러오는 중…
          </div>
        ) : null}
        {phase === 'error' ? (
          <span className="px-3 text-center text-[11px] text-white/70">미리보기를 불러오지 못했습니다.</span>
        ) : (
          <canvas ref={canvasRef} className="mx-auto max-h-full max-w-full" />
        )}
      </button>
      {numPages > 0 ? (
        <div className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-white/80">
          {page} / {numPages}
          {numPages > 1 ? ' · 휠로 넘김' : ''}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 목록 아래 미리보기 — 이미지·PDF(pdf.js). PDF는 로딩 후 보이고, 휠로 페이지 이동.
 */
export function SmallPublicInlineFilePreview({
  file,
  emptyText = '목록에서 행을 선택하면 미리보기가 나타납니다.',
  onOpenFull,
}: {
  file: SmallPublicFileRef | null | undefined
  emptyText?: string
  /** page 는 PDF일 때 현재 보고 있는 페이지 */
  onOpenFull?: (page?: number) => void
}) {
  if (!file?.url) {
    return (
      <div className="flex h-full min-h-[8rem] items-center justify-center rounded-[5px] border border-dashed border-border bg-muted/20 px-3 text-center text-[11px] text-muted-foreground">
        {file && !file.url ? '예시 자료라 미리볼 파일이 없습니다.' : emptyText}
      </div>
    )
  }
  const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
  const isPdf = /\.pdf$/i.test(file.name)

  if (isPdf) {
    return (
      <SmallPublicInlinePdfPreview
        url={file.url}
        name={file.name}
        onOpenFull={onOpenFull ? (page) => onOpenFull(page) : undefined}
      />
    )
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[5px] border border-border bg-black">
      {isImage ? (
        <div
          className={cn('min-h-0 flex-1 overflow-auto', onOpenFull && 'cursor-zoom-in')}
          onClick={() => onOpenFull?.()}
          title={onOpenFull ? '클릭하면 크게 보기' : file.name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.url} alt="" className="mx-auto block max-w-full" draggable={false} />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center gap-1 text-[11px] text-white/70">
          <FileText className="h-4 w-4" />
          PDF·이미지만 미리볼 수 있습니다.
        </div>
      )}
    </div>
  )
}

/** 오른쪽 정렬 · 저장→수정→삭제(간격 10px) — 후보지·안전점검·정비계획 공통 */
export function SmallPublicCrudBar({
  onSave,
  onEdit,
  onDelete,
  saveDisabled,
  leading,
  trailing,
  className,
  bordered = true,
}: {
  onSave?: () => void
  onEdit?: () => void
  onDelete?: () => void
  saveDisabled?: boolean
  /** 왼쪽 안내 문구 등 */
  leading?: ReactNode
  /** 저장·수정·삭제 앞(보고서 등) */
  trailing?: ReactNode
  className?: string
  bordered?: boolean
}) {
  return (
    <div
      className={cn(
        'flex w-full shrink-0 items-center gap-2.5 px-3 py-1.5',
        bordered && 'border-t border-border',
        className
      )}
    >
      {leading ? <div className="min-w-0 flex-1">{leading}</div> : <div className="min-w-0 flex-1" />}
      <div className="flex shrink-0 items-center gap-2.5">
        {trailing}
        {onSave ? (
          <button type="button" className={smallPublicBtnPrimary} disabled={saveDisabled} onClick={onSave}>
            <Save className="h-3 w-3" />
            저장
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" className={smallPublicBtnGhost} onClick={onEdit}>
            <Pencil className="h-3 w-3" />
            수정
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" className={smallPublicBtnDanger} onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
            삭제
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 일반·관리 평가 이력 — 해마다 구분 평가 합계·평가구분(행을 누르면 구분 평가표) */
export function SmallPublicClassHistoryTable({
  inspections,
  onRowClick,
}: {
  /** 시설의 점검(최신 순) */
  inspections: SmallPublicInspection[]
  onRowClick: (inspectionId: string) => void
}) {
  const byYear = new Map<string, SmallPublicInspection>()
  for (const i of inspections) {
    if (!i.classEval) continue
    const y = i.date.slice(0, 4)
    if (!byYear.has(y)) byYear.set(y, i)
  }
  const rows = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
        평가 이력이 없습니다.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
        <colgroup>
          <col className="w-[3rem]" />
          <col />
          <col className="w-[3.5rem]" />
          <col className="w-[4.25rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>연도</th>
            <th>평가일</th>
            <th className="text-right">합계</th>
            <th className="text-center">평가구분</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([year, i]) => (
            <tr
              key={year}
              role="button"
              tabIndex={0}
              onClick={() => onRowClick(i.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onRowClick(i.id)
                }
              }}
              className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/50"
            >
              <td className="px-1.5 py-1 tabular-nums">{year}</td>
              <td className="truncate px-1.5 py-1 tabular-nums text-foreground/80">{i.date}</td>
              <td className="px-1.5 py-1 text-right tabular-nums text-foreground/80">{i.classEval?.total ?? 0}점</td>
              <td className="px-1.5 py-1 text-center">
                <SmallPublicClassBadge candidate={i.classResult} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
