'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import { FMS_EMPTY_INSPECTION_MESSAGE, FMS_INSPECTION_TITLE } from './fmsLinkageBinding'
import {
  buildFmsDetailSections,
  countHiddenFmsDetailItems,
  FMS_FACILITY_DETAIL_GROUPS,
  FMS_INSPECTION_DETAIL_GROUPS,
  type FmsDetailAttrGroup,
  type FmsDetailAttrItem,
  type FmsDetailAttrSection,
} from './fmsDetailAttrGroups'
import { getStateGradeBadgeClass } from './stateGradeBadge'

function StateGradeBadge({ grade }: { grade: string }) {
  const g = String(grade ?? '').trim()
  if (!g) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        'inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
        getStateGradeBadgeClass(g)
      )}
      title={g}
    >
      {g}
    </span>
  )
}

type DetailAttr = FmsDetailAttrItem

type ListRow = {
  id: string
  facilNm: string
}

type InspectionRow = {
  id: string
  dignSeq: string
  dignGbn: string
  startYmd: string
  endYmd: string
  stateGrade: string
  attributes: DetailAttr[]
}

type Props = {
  detailId: string
  onClose: () => void
  toastMsg?: string | null
  onToastClear?: () => void
}

const INSPECTION_PAGE_SIZE = 10
const FMS_ATTRS_SECTION_TITLE = '속성보기'
const FMS_ATTR_GROUP_LABEL_CLASS =
  'mb-1 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-muted-foreground'

function formatInspectionPeriod(item: Pick<InspectionRow, 'startYmd' | 'endYmd'>): string {
  if (!item.startYmd && !item.endYmd) return '—'
  return `${item.startYmd || '—'} ~ ${item.endYmd || '—'}`
}

const FMS_ATTR_LABEL_CLASS =
  'flex h-full shrink-0 items-center whitespace-nowrap border-b border-border bg-slate-100 px-2 py-1.5 align-middle font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground'
const FMS_ATTR_VALUE_CLASS =
  'flex min-w-0 items-start break-words border-b border-border bg-background px-2 py-1.5 text-slate-900 dark:text-foreground'

function AttrRows({ items }: { items: DetailAttr[] }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      {items.map((item, idx) => (
        <div
          key={item.field}
          className="grid grid-cols-[8.25rem_minmax(0,1fr)]"
        >
          <dt
            className={cn(
              FMS_ATTR_LABEL_CLASS,
              idx === items.length - 1 && 'border-b-0'
            )}
          >
            {item.label}
          </dt>
          <dd
            className={cn(
              FMS_ATTR_VALUE_CLASS,
              idx === items.length - 1 && 'border-b-0'
            )}
          >
            {item.field === 'state_grade' ? (
              <StateGradeBadge grade={item.value} />
            ) : (
              item.value || '—'
            )}
          </dd>
        </div>
      ))}
    </div>
  )
}

function GroupedAttrList({
  sections,
  expanded,
  onToggleExpanded,
}: {
  sections: FmsDetailAttrSection[]
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const visible = expanded ? sections : sections.filter((s) => s.primary)
  const hiddenCount = countHiddenFmsDetailItems(sections)

  return (
    <div className="space-y-2">
      {visible.map((section) => (
        <div key={section.id}>
          {section.label ? (
            <div className={FMS_ATTR_GROUP_LABEL_CLASS}>{section.label}</div>
          ) : null}
          <AttrRows items={section.items} />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="standard-detail-secondary-btn w-full py-1.5"
        >
          {expanded ? '접기' : `더보기 (${hiddenCount}건)`}
        </button>
      ) : null}
    </div>
  )
}

function useGroupedAttrs(
  items: DetailAttr[],
  groups: readonly FmsDetailAttrGroup[],
  resetKey: string
) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [resetKey])
  const sections = useMemo(() => buildFmsDetailSections(items, groups), [items, groups])
  return {
    sections,
    expanded,
    toggleExpanded: () => setExpanded((v) => !v),
  }
}

export function FmsLinkageDetailPanel({
  detailId,
  onClose,
  toastMsg = null,
  onToastClear,
}: Props) {
  const [row, setRow] = useState<ListRow | null>(null)
  const [attributes, setAttributes] = useState<DetailAttr[]>([])
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const [inspectionPage, setInspectionPage] = useState(1)
  const [inspectionOpen, setInspectionOpen] = useState(true)
  const [facilityAttrsOpen, setFacilityAttrsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inspectionDetailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedInspectionId) return
    const el = inspectionDetailRef.current
    if (!el) return
    const frame = window.requestAnimationFrame(() => {
      let node: HTMLElement | null = el.parentElement
      while (node) {
        const { overflowY } = getComputedStyle(node)
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight
        ) {
          const containerTop = node.getBoundingClientRect().top
          const targetTop = el.getBoundingClientRect().top
          const nextTop = Math.max(0, targetTop - containerTop + node.scrollTop)
          node.scrollTo({ top: nextTop, behavior: 'smooth' })
          break
        }
        node = node.parentElement
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedInspectionId])

  useEffect(() => {
    if (!toastMsg) return
    const t = window.setTimeout(() => onToastClear?.(), 2000)
    return () => window.clearTimeout(t)
  }, [toastMsg, onToastClear])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setRow(null)
    setAttributes([])
    setInspections([])
    setSelectedInspectionId(null)
    setInspectionPage(1)
    void call('', 'POST', {
      service: 'fmsLinkageService',
      action: 'getFmsFacilityDetail',
      params: { id: detailId },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          row?: ListRow | null
          attributes?: DetailAttr[]
          inspections?: InspectionRow[]
          error?: string
        }
        if (data?.error) {
          setError(data.error)
          return
        }
        setRow(data?.row ?? null)
        setAttributes(Array.isArray(data?.attributes) ? data.attributes : [])
        const nextInspections = Array.isArray(data?.inspections) ? data.inspections : []
        setInspections(nextInspections)
        setSelectedInspectionId(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailId])

  const facilityGroups = useGroupedAttrs(attributes, FMS_FACILITY_DETAIL_GROUPS, detailId)

  const latestInspection = inspections[0] ?? null
  const selectedInspection = useMemo(
    () => inspections.find((item) => item.id === selectedInspectionId) ?? null,
    [inspections, selectedInspectionId]
  )
  const inspectionPageCount = Math.max(1, Math.ceil(inspections.length / INSPECTION_PAGE_SIZE))
  const safeInspectionPage = Math.min(inspectionPage, inspectionPageCount)
  const pagedInspections = useMemo(() => {
    const start = (safeInspectionPage - 1) * INSPECTION_PAGE_SIZE
    return inspections.slice(start, start + INSPECTION_PAGE_SIZE)
  }, [inspections, safeInspectionPage])
  const inspectionAttrs = selectedInspection?.attributes ?? []
  const inspectionResetKey = selectedInspection?.id ?? ''
  const inspectionGroups = useGroupedAttrs(
    inspectionAttrs,
    FMS_INSPECTION_DETAIL_GROUPS,
    inspectionResetKey
  )
  const latestDateLabel =
    latestInspection?.endYmd || latestInspection?.startYmd || '—'

  return (
    <div className="standard-panel-root">
      {toastMsg ? (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-3">
          <div
            className="pointer-events-none inline-block px-4 py-2 text-sm text-white shadow-md"
            style={{ backgroundColor: '#5191e4', borderRadius: 3 }}
            role="status"
          >
            {toastMsg}
          </div>
        </div>
      ) : null}
      <div className="standard-panel-header">
        <span className="standard-panel-title truncate">
          {row?.facilNm ? `시설물 상세 · ${row.facilNm}` : '시설물 상세'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && attributes.length === 0 ? (
        <div className="standard-detail-scroll standard-detail-loading justify-center">불러오는 중…</div>
      ) : error && attributes.length === 0 ? (
        <div className="standard-detail-scroll px-3 py-6">
          <div className="standard-detail-error">{error}</div>
        </div>
      ) : (
        <>
          <section className="standard-detail-section shrink-0">
            <div className="standard-detail-section-header">
              <button
                type="button"
                onClick={() => setFacilityAttrsOpen((v) => !v)}
                className="standard-detail-section-toggle"
                title={FMS_ATTRS_SECTION_TITLE}
              >
                {facilityAttrsOpen ? (
                  <ChevronDown className="standard-detail-section-chevron" />
                ) : (
                  <ChevronRight className="standard-detail-section-chevron" />
                )}
                <span className="standard-detail-section-toggle-label">{FMS_ATTRS_SECTION_TITLE}</span>
              </button>
            </div>
            {facilityAttrsOpen ? (
              <div className="standard-detail-section-body text-[11px]">
                <GroupedAttrList
                  sections={facilityGroups.sections}
                  expanded={facilityGroups.expanded}
                  onToggleExpanded={facilityGroups.toggleExpanded}
                />
              </div>
            ) : null}
          </section>

          <section className="standard-detail-section flex min-h-0 min-w-0 flex-1 flex-col !border-b-0">
            <div className="standard-detail-section-header">
              <button
                type="button"
                onClick={() => setInspectionOpen((v) => !v)}
                className="standard-detail-section-toggle"
                title={FMS_INSPECTION_TITLE}
              >
                {inspectionOpen ? (
                  <ChevronDown className="standard-detail-section-chevron" />
                ) : (
                  <ChevronRight className="standard-detail-section-chevron" />
                )}
                <span className="standard-detail-section-toggle-label">{FMS_INSPECTION_TITLE}</span>
              </button>
            </div>
            {inspectionOpen ? (
              <MapSideDetailScroll className="standard-detail-scroll scroll-smooth min-h-0 flex-1 text-[11px]">
                {inspections.length === 0 ? (
                  <div className="standard-detail-empty-dashed-compact">
                    {FMS_EMPTY_INSPECTION_MESSAGE}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-slate-50 px-2.5 py-2 dark:bg-muted">
                      <span className="inline-flex h-5 items-center gap-1.5 text-slate-500 dark:text-muted-foreground">
                        <span className="leading-none">최근 등급</span>
                        <StateGradeBadge grade={latestInspection?.stateGrade ?? ''} />
                      </span>
                      <span className="flex items-center gap-1.5 text-slate-500 dark:text-muted-foreground">
                        최근 점검일
                        <span className="font-medium text-slate-900 dark:text-foreground">{latestDateLabel}</span>
                      </span>
                      <span className="flex items-center gap-1 text-slate-500 dark:text-muted-foreground">
                        총
                        <span className="font-medium text-slate-900 dark:text-foreground">
                          {inspections.length.toLocaleString()}건
                        </span>
                      </span>
                    </div>

                    <div className="overflow-hidden rounded border border-border">
                      <table className="w-full table-fixed border-collapse text-left">
                        <colgroup>
                          <col className="w-[110px]" />
                          <col />
                          <col className="w-[3.75rem]" />
                        </colgroup>
                        <thead className="bg-slate-100 dark:bg-muted">
                          <tr>
                            <th className="border-b border-border px-2 py-1.5 align-middle font-semibold text-slate-500 dark:text-muted-foreground">
                              구분
                            </th>
                            <th className="border-b border-border px-2 py-1.5 align-middle font-semibold text-slate-500 dark:text-muted-foreground">
                              기간
                            </th>
                            <th className="border-b border-border px-2 py-1.5 text-center align-middle font-semibold text-slate-500 dark:text-muted-foreground">
                              등급
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedInspections.map((item) => {
                            const isSelected = selectedInspectionId === item.id
                            const selectInspection = () => {
                              setSelectedInspectionId((prev) =>
                                prev === item.id ? null : item.id
                              )
                            }
                            return (
                              <tr
                                key={item.id}
                                role="button"
                                tabIndex={0}
                                aria-selected={isSelected}
                                onClick={selectInspection}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    selectInspection()
                                  }
                                }}
                                className={cn(
                                  'cursor-pointer border-b border-border last:border-b-0 transition-colors',
                                  isSelected
                                    ? 'bg-primary/10 dark:bg-primary/25'
                                    : 'hover:bg-muted/50'
                                )}
                              >
                                <td
                                  className="truncate px-2 py-1.5 align-middle font-medium text-slate-900 dark:text-foreground"
                                  title={item.dignGbn || '점검'}
                                >
                                  {item.dignGbn || '점검'}
                                </td>
                                <td
                                  className="truncate px-2 py-1.5 align-middle tabular-nums text-slate-900 dark:text-foreground"
                                  title={formatInspectionPeriod(item)}
                                >
                                  {formatInspectionPeriod(item)}
                                </td>
                                <td className="px-2 py-1.5 text-center align-middle">
                                  <StateGradeBadge grade={item.stateGrade} />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between gap-2 px-0.5">
                      <button
                        type="button"
                        disabled={safeInspectionPage <= 1}
                        onClick={() => setInspectionPage((p) => Math.max(1, p - 1))}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        aria-label="이전 페이지"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        이전
                      </button>
                      <span className="tabular-nums text-muted-foreground">
                        {safeInspectionPage} / {inspectionPageCount}
                      </span>
                      <button
                        type="button"
                        disabled={safeInspectionPage >= inspectionPageCount}
                        onClick={() =>
                          setInspectionPage((p) => Math.min(inspectionPageCount, p + 1))
                        }
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        aria-label="다음 페이지"
                      >
                        다음
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {selectedInspection ? (
                      <div
                        ref={inspectionDetailRef}
                        className="rounded border border-border bg-muted/30 px-2.5 py-2"
                      >
                        <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
                          <span className="standard-detail-section-title">점검 상세</span>
                          <span className="font-normal text-black/40 dark:text-muted-foreground/50">·</span>
                          <span className="font-normal text-black/50 dark:text-muted-foreground">
                            {selectedInspection.dignGbn || '점검'}
                            {' · '}
                            {formatInspectionPeriod(selectedInspection)}
                          </span>
                        </div>
                        <GroupedAttrList
                          sections={inspectionGroups.sections}
                          expanded={inspectionGroups.expanded}
                          onToggleExpanded={inspectionGroups.toggleExpanded}
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </MapSideDetailScroll>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}
