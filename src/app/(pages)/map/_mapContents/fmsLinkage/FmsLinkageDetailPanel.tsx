'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { call } from '@/lib/api'
import {
  buildFmsDetailSections,
  countHiddenFmsDetailItems,
  FMS_FACILITY_DETAIL_GROUPS,
  type FmsDetailAttrGroup,
  type FmsDetailAttrItem,
  type FmsDetailAttrSection,
} from './fmsDetailAttrGroups'
import { FMS_INSPECTION_TITLE } from './fmsLinkageBinding'
import {
  FmsInspectionRecordsSection,
  type FmsInspectionRecordRow,
} from './FmsInspectionRecordsSection'
import { cn } from '@/lib/utils'

type DetailAttr = FmsDetailAttrItem

type ListRow = {
  id: string
  facilNm: string
}

type Props = {
  detailId: string
  onClose: () => void
  toastMsg?: string | null
  onToastClear?: () => void
}

const FMS_ATTRS_SECTION_TITLE = '속성보기'
const FMS_ATTR_GROUP_LABEL_CLASS =
  'mb-1 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-muted-foreground'
const FMS_ATTR_LABEL_CLASS =
  'flex h-full shrink-0 items-center whitespace-nowrap border-b border-border bg-slate-100 px-2 py-1.5 align-middle font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground'
const FMS_ATTR_VALUE_CLASS =
  'flex min-w-0 items-start break-words border-b border-border bg-background px-2 py-1.5 text-slate-900 dark:text-foreground'

function AttrRows({ items }: { items: DetailAttr[] }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      {items.map((item, idx) => (
        <div key={item.field} className="grid grid-cols-[8.25rem_minmax(0,1fr)]">
          <dt className={cn(FMS_ATTR_LABEL_CLASS, idx === items.length - 1 && 'border-b-0')}>
            {item.label}
          </dt>
          <dd className={cn(FMS_ATTR_VALUE_CLASS, idx === items.length - 1 && 'border-b-0')}>
            {item.value || '—'}
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
  const [inspections, setInspections] = useState<FmsInspectionRecordRow[]>([])
  const [inspectionOpen, setInspectionOpen] = useState(true)
  const [facilityAttrsOpen, setFacilityAttrsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          inspections?: FmsInspectionRecordRow[]
          error?: string
        }
        if (data?.error) {
          setError(data.error)
          return
        }
        setRow(data?.row ?? null)
        setAttributes(Array.isArray(data?.attributes) ? data.attributes : [])
        setInspections(Array.isArray(data?.inspections) ? data.inspections : [])
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
              <div className="standard-detail-section-body max-h-[50vh] overflow-y-auto scrollbar-thin text-[11px]">
                <GroupedAttrList
                  sections={facilityGroups.sections}
                  expanded={facilityGroups.expanded}
                  onToggleExpanded={facilityGroups.toggleExpanded}
                />
              </div>
            ) : null}
          </section>

          <section className="standard-detail-section flex min-h-0 min-w-0 max-h-[42vh] flex-1 flex-col !border-b-0">
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
              <FmsInspectionRecordsSection inspections={inspections} selfScroll />
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}
