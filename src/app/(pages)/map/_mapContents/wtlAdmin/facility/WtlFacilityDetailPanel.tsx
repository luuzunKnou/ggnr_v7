'use client'

import { useEffect, useMemo, useState, type ElementType } from 'react'
import { FileText, Paperclip, X } from 'lucide-react'
import { call } from '@/lib/api'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import {
  getDefineFieldDisplayLabel,
  getRowKey,
  getRowValueByField,
  isDefineFieldFlagTrue,
  selectDefineLayerDetailFields,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { WtlNetworkMapAttachmentSection } from '../networkMap/WtlNetworkMapAttachmentSection'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'
import type { WtlNetworkRow } from '../networkMap/wtlNetworkTypes'
import type { WtlFacilityListRow } from './WtlFacilityListView'
import { WtlFacilityRelatedDetailFloating } from './WtlFacilityRelatedDetailFloating'

type Props = {
  row: WtlFacilityListRow
  onClose: () => void
}

type RelatedTabDef = {
  table: string
  defineTable: string
  label: string
}

type RelatedRow = {
  ogcFid: number | null
  record: Record<string, unknown>
  geom: unknown | null
}

type ActiveTab = 'attach' | string

function toNetworkItem(row: WtlFacilityListRow): WtlNetworkRow {
  return {
    id: row.id,
    layerKey: row.relatedParentKey || row.layerKey || row.tableName,
    geomKind: 'point',
    name: row.name,
    diameter: '',
    material: '',
    length: '',
    year: '',
    status: '',
    hjd: '',
    attrs: [],
    geom: (row.geom as GeoJSON.Geometry | null) ?? null,
    record: row.record,
    fieldsTable: row.fieldsTable,
    fieldsTableFallback: row.fieldsTableFallback,
  }
}

function fallbackDetailFields(record: Record<string, unknown> | null): DefineFieldLike[] {
  if (!record) return []
  return Object.keys(record)
    .filter((k) => {
      const lower = k.toLowerCase()
      return lower !== 'geom' && lower !== 'geometry' && lower !== 'the_geom'
    })
    .map((name, idx) => ({
      define_field_name: name,
      define_field_kor_name: name,
      define_field_idx: idx,
      define_field_show_detail: true,
      define_field_type: 'TEXT',
    }))
}

function resolveParentFtrIdn(
  row: WtlFacilityListRow,
  keyFieldName: string | null
): string {
  const fromRecord = getRowValueByField(row.record, 'ftr_idn')
  if (fromRecord != null && String(fromRecord).trim()) {
    return String(fromRecord).trim()
  }
  const fromKey = getRowKey(row.record, keyFieldName)
  if (fromKey != null && String(fromKey).trim()) {
    return String(fromKey).trim()
  }
  return String(row.name ?? '').trim()
}

export function WtlFacilityDetailPanel({ row, onClose }: Props) {
  const [bundle, setBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('attach')
  const [relatedTabs, setRelatedTabs] = useState<RelatedTabDef[]>([])
  const [relatedRows, setRelatedRows] = useState<RelatedRow[]>([])
  const [relatedTotal, setRelatedTotal] = useState(0)
  const [relatedBundle, setRelatedBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedError, setRelatedError] = useState<string | null>(null)
  const [relatedDetail, setRelatedDetail] = useState<RelatedRow | null>(null)

  const networkItem = useMemo(() => toNetworkItem(row), [row])
  const parentKey = String(row.relatedParentKey || row.layerKey || '')
    .trim()
    .toLowerCase()

  useEffect(() => {
    const table = String(row.fieldsTable ?? '').trim()
    if (!table) {
      setBundle(null)
      return
    }
    const peeked = peekWtlDefineDisplayBundle(table, row.fieldsTableFallback)
    if (peeked) {
      setBundle(peeked)
      return
    }
    let cancelled = false
    void loadWtlDefineDisplayBundle(table, row.fieldsTableFallback).then((b) => {
      if (!cancelled) setBundle(b)
    })
    return () => {
      cancelled = true
    }
  }, [row.fieldsTable, row.fieldsTableFallback, row.id])

  useEffect(() => {
    setRelatedTabs([])
    setRelatedRows([])
    setRelatedTotal(0)
    setRelatedBundle(null)
    setRelatedError(null)
    setRelatedDetail(null)
    setActiveTab('attach')

    if (parentKey !== 'wtl_pres_ps' && parentKey !== 'wtl_puri_as') {
      return
    }

    let cancelled = false
    void call('', 'POST', {
      service: 'wtlNetworkService',
      action: 'listWtlNetworkRelatedChildTables',
      params: { parentLayerKey: parentKey },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { tabs?: RelatedTabDef[] } | undefined
        const raw = Array.isArray(data?.tabs) ? data.tabs : []
        const next = raw
          .map((t) => {
            const table = String(t.table ?? '')
              .trim()
              .toLowerCase()
            const defineTable =
              String(t.defineTable ?? '')
                .trim()
                .toLowerCase() || table
            return {
              table,
              defineTable,
              label: String(t.label ?? '').trim() || table,
            }
          })
          .filter((t) => t.table)
        setRelatedTabs(next)
        setActiveTab(next[0]?.table ?? 'attach')
      })
      .catch(() => {
        if (cancelled) return
        setRelatedTabs([])
        setActiveTab('attach')
      })

    return () => {
      cancelled = true
    }
  }, [parentKey, row.id])

  const allFields = bundle?.fields ?? []
  const keyField = useMemo(
    () =>
      allFields.find((f) =>
        isDefineFieldFlagTrue(
          (f as DefineFieldLike & { define_field_is_key?: unknown }).define_field_is_key
        )
      ) ?? null,
    [allFields]
  )
  const keyFieldName = String(keyField?.define_field_name ?? '').trim() || null
  const ftrIdn = resolveParentFtrIdn(row, keyFieldName)

  const titleField = useMemo(
    () => allFields.find((f) => isDefineFieldFlagTrue(f.define_field_show_title)) ?? null,
    [allFields]
  )
  const titleFieldName = String(titleField?.define_field_name ?? '').trim() || null

  const headerTitle = useMemo(() => {
    if (titleFieldName) {
      const raw = getRowValueByField(row.record, titleFieldName)
      const formatted = formatDefineFieldDisplayValue(
        raw,
        titleField?.define_field_type,
        bundle?.codesByField?.[titleFieldName.toLowerCase()],
        ''
      )
      if (formatted.trim()) return formatted
    }
    return row.name || '시설 상세'
  }, [
    bundle?.codesByField,
    row.name,
    row.record,
    titleField?.define_field_type,
    titleFieldName,
  ])

  const detailFields = useMemo(() => {
    const selectedFields = selectDefineLayerDetailFields(allFields)
    if (selectedFields.length > 0) return selectedFields
    if (allFields.length > 0) {
      return allFields.filter((f) => {
        const name = String(f.define_field_name ?? '')
          .trim()
          .toLowerCase()
        return name && name !== 'geom'
      })
    }
    return fallbackDetailFields(row.record)
  }, [allFields, row.record])

  const codesByField = bundle?.codesByField ?? {}

  const activeRelated = useMemo(
    () => relatedTabs.find((t) => t.table === activeTab) ?? null,
    [relatedTabs, activeTab]
  )

  useEffect(() => {
    if (!activeRelated || !ftrIdn) {
      setRelatedRows([])
      setRelatedTotal(0)
      setRelatedBundle(null)
      setRelatedError(null)
      setRelatedLoading(false)
      setRelatedDetail(null)
      return
    }

    let cancelled = false
    setRelatedLoading(true)
    setRelatedError(null)
    setRelatedRows([])
    setRelatedTotal(0)
    setRelatedDetail(null)

    const defineTable = activeRelated.defineTable || activeRelated.table
    const peeked = peekWtlDefineDisplayBundle(defineTable, null)
    if (peeked) setRelatedBundle(peeked)

    void Promise.all([
      call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'listWtlNetworkRelatedChildRows',
        params: {
          table: activeRelated.table,
          defineTable,
          ftrIdn,
          limit: 200,
        },
      }),
      peeked ? Promise.resolve(peeked) : loadWtlDefineDisplayBundle(defineTable, null),
    ])
      .then(([res, nextBundle]) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { rows?: RelatedRow[]; total?: number }
          | undefined
        const rows = Array.isArray(data?.rows)
          ? data.rows.map((r) => ({
              ogcFid:
                r.ogcFid != null && Number.isFinite(Number(r.ogcFid))
                  ? Number(r.ogcFid)
                  : null,
              record:
                r.record && typeof r.record === 'object'
                  ? (r.record as Record<string, unknown>)
                  : {},
              geom: r.geom ?? null,
            }))
          : []
        setRelatedRows(rows)
        setRelatedTotal(Number(data?.total ?? rows.length) || rows.length)
        setRelatedBundle(nextBundle)
      })
      .catch(() => {
        if (cancelled) return
        setRelatedRows([])
        setRelatedTotal(0)
        setRelatedError('목록을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeRelated, ftrIdn])

  const relatedListFields = useMemo(() => {
    const all = relatedBundle?.fields ?? []
    const selected = selectDefineLayerListFields(all)
    if (selected.length > 0) return selected
    return all.filter((f) => {
      const name = String(f.define_field_name ?? '')
        .trim()
        .toLowerCase()
      return name && name !== 'geom' && name !== 'ogc_fid'
    })
  }, [relatedBundle])

  const relatedCodes = relatedBundle?.codesByField ?? {}

  const tabs = useMemo(() => {
    const out: { id: ActiveTab; label: string; icon: ElementType }[] = []
    for (const t of relatedTabs) {
      out.push({ id: t.table, label: t.label, icon: FileText })
    }
    out.push({ id: 'attach', label: '첨부파일', icon: Paperclip })
    return out
  }, [relatedTabs])

  useEffect(() => {
    const first = tabs[0]?.id
    if (!first) return
    if (!tabs.some((t) => t.id === activeTab)) {
      setActiveTab(first)
    }
  }, [tabs, activeTab])

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title truncate pr-2" title={headerTitle}>
          {headerTitle}
        </span>
        <button
          type="button"
          className="standard-panel-close cursor-pointer"
          onClick={onClose}
          aria-label="닫기"
          title="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="standard-detail-section flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="standard-detail-section-header">
            <span className="standard-detail-section-title">기본정보</span>
          </div>
          <div className="standard-detail-section-body min-h-0 flex-1 overflow-auto scrollbar-thin">
            {detailFields.length === 0 ? (
              <p className="standard-detail-attr-empty">표시할 상세 필드가 없습니다.</p>
            ) : (
              <div className="standard-detail-attr-table">
                {detailFields.map((f, i) => {
                  const key = String(f.define_field_name ?? '').trim()
                  const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
                  const raw = getRowValueByField(row.record, key)
                  const value = formatDefineFieldDisplayValue(
                    raw,
                    f.define_field_type,
                    codesByField[key.toLowerCase()],
                    '—'
                  )
                  return (
                    <div key={key || `d-${i}`} className="contents">
                      <div className="standard-detail-attr-label standard-detail-attr-cell-border">
                        {label}
                      </div>
                      <div
                        className={cn(
                          'standard-detail-attr-value standard-detail-attr-cell-border text-foreground',
                          titleFieldName != null &&
                            key.toLowerCase() === titleFieldName.toLowerCase() &&
                            'font-medium text-primary'
                        )}
                        title={value}
                      >
                        {value}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <div className="flex min-h-0 shrink-0 flex-col border-t border-border">
          <div className="flex shrink-0 overflow-x-auto border-b border-border">
            {tabs.map(({ id, label, icon: TabIcon }) => (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => {
                  setActiveTab(id)
                  setRelatedDetail(null)
                }}
                className={cn(
                  'inline-flex h-9 w-[5.5rem] shrink-0 cursor-pointer items-center justify-center gap-1 px-2 text-[11px] font-medium transition-colors',
                  activeTab === id
                    ? 'border-b-2 border-primary bg-primary/5 text-primary'
                    : 'border-b-2 border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <TabIcon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="h-[250px] shrink-0 overflow-hidden">
            {activeTab === 'attach' ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-2">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
                  <WtlNetworkMapAttachmentSection
                    item={networkItem}
                    fields={allFields.length > 0 ? allFields : detailFields}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="standard-list-scroll">
                  {relatedLoading ? (
                    <p className="standard-detail-loading px-3 py-3">목록 불러오는 중…</p>
                  ) : relatedError ? (
                    <p className="px-3 py-3 text-xs text-destructive">{relatedError}</p>
                  ) : !ftrIdn ? (
                    <p className="standard-table-empty">
                      관리번호를 찾을 수 없어 목록을 표시하지 않습니다.
                    </p>
                  ) : relatedRows.length === 0 ? (
                    <p className="standard-table-empty">해당 현황 데이터가 없습니다.</p>
                  ) : relatedListFields.length === 0 ? (
                    <p className="standard-table-empty">표시할 필드가 없습니다.</p>
                  ) : (
                    <table className="standard-list-table">
                      <thead className="standard-detail-table-thead">
                        <tr>
                          {relatedListFields.map((f, i) => {
                            const key = String(f.define_field_name ?? '').trim()
                            return (
                              <th
                                key={key || `h-${i}`}
                                className="standard-detail-table-th standard-table-th-left"
                                title={getDefineFieldDisplayLabel(key, f.define_field_kor_name)}
                              >
                                {getDefineFieldDisplayLabel(key, f.define_field_kor_name)}
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {relatedRows.map((r, ri) => {
                          const selected =
                            relatedDetail != null &&
                            ((r.ogcFid != null && relatedDetail.ogcFid === r.ogcFid) ||
                              (r.ogcFid == null && relatedDetail === r))
                          return (
                            <tr
                              key={r.ogcFid ?? `r-${ri}`}
                              className={cn(
                                'standard-list-row cursor-pointer',
                                selected && 'standard-list-row-selected'
                              )}
                              title="상세보기"
                              onClick={() => setRelatedDetail(r)}
                            >
                              {relatedListFields.map((f, fi) => {
                                const key = String(f.define_field_name ?? '').trim()
                                const raw = getRowValueByField(r.record, key)
                                const value = formatDefineFieldDisplayValue(
                                  raw,
                                  f.define_field_type,
                                  relatedCodes[key.toLowerCase()],
                                  '—'
                                )
                                return (
                                  <td
                                    key={`${r.ogcFid ?? ri}-${key || fi}`}
                                    className="standard-table-td-compact"
                                    title={value}
                                  >
                                    {value}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="standard-list-footer">
                  {relatedLoading ? '조회 중…' : `총 ${relatedTotal}건`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {relatedDetail && activeRelated ? (
        <WtlFacilityRelatedDetailFloating
          title={activeRelated.label || '현황'}
          row={relatedDetail}
          bundle={relatedBundle}
          onClose={() => setRelatedDetail(null)}
        />
      ) : null}
    </div>
  )
}
