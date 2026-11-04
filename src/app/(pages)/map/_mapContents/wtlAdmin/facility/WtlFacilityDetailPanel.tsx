'use client'

import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react'
import { FileText, History, Loader2, Paperclip, Pencil, Trash2, X } from 'lucide-react'
import { call } from '@/lib/api'
import {
  formatDefineFieldDisplayValue,
  isDefineFieldCodeType,
} from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import {
  getDefineFieldDisplayLabel,
  getRowKey,
  getRowValueByField,
  isDefineFieldFlagTrue,
  isGeomLikeDefineFieldName,
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
import { WtlFacilityDataHistoryTab } from './WtlFacilityDataHistoryTab'
import type { WtlFacilityListRow } from './WtlFacilityListView'
import { WtlFacilityRelatedDetailFloating } from './WtlFacilityRelatedDetailFloating'
import { WtlFacilityTableLoadingRow } from './WtlFacilityTableLoadingRow'

const SER_ENG = 'wtlFacility'

const editInputClass =
  'h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25'

type Props = {
  row: WtlFacilityListRow
  onClose: () => void
  /** layer / public_layer 등 — 없으면 layer */
  schema?: string
  onUpdated?: (row: WtlFacilityListRow) => void
  onDeleted?: (id: string) => void
  /** 이력 되돌리기 후 목록·상세 재조회 */
  onHistoryReverted?: () => void
}

type FieldEditMeta = DefineFieldLike & {
  define_field_is_key?: unknown
  define_field_read_only?: unknown
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

type ActiveTab = 'attach' | 'dataHistory' | string

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

export function WtlFacilityDetailPanel({
  row: rowProp,
  onClose,
  schema: schemaProp,
  onUpdated,
  onDeleted,
  onHistoryReverted,
}: Props) {
  const canWrite = useSerWriteAccess(SER_ENG)
  const [localRow, setLocalRow] = useState(rowProp)
  const [bundle, setBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('attach')
  const [relatedTabs, setRelatedTabs] = useState<RelatedTabDef[]>([])
  const [relatedRows, setRelatedRows] = useState<RelatedRow[]>([])
  const [relatedTotal, setRelatedTotal] = useState(0)
  const [relatedBundle, setRelatedBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedError, setRelatedError] = useState<string | null>(null)
  const [relatedDetail, setRelatedDetail] = useState<RelatedRow | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const row = localRow
  const schema =
    String(schemaProp ?? '')
      .trim()
      .toLowerCase() || 'layer'

  useEffect(() => {
    setLocalRow(rowProp)
    setEditing(false)
    setDraft({})
    setEditError(null)
    setSaving(false)
    setDeleting(false)
  }, [rowProp])

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
  const fieldsLoading = Boolean(String(row.fieldsTable ?? '').trim()) && bundle == null

  const editTarget = useMemo(() => {
    const table = String(row.tableName || row.fieldsTable || '')
      .trim()
      .replace(/^.*\./, '')
      .toLowerCase()
    if (!table || !row.record) return null

    let keyField = keyFieldName
    let keyValue: string | null = null
    if (keyField) {
      const fromKey = getRowKey(row.record, keyField)
      if (fromKey != null && String(fromKey).trim()) keyValue = String(fromKey).trim()
    }
    if (keyValue == null) {
      for (const f of ['ogc_fid', 'gid', 'id'] as const) {
        const v = getRowValueByField(row.record, f)
        if (v != null && String(v).trim()) {
          keyField = f
          keyValue = String(v).trim()
          break
        }
      }
    }
    if (keyValue == null && row.ogcFid != null && Number.isFinite(row.ogcFid)) {
      keyField = keyField || 'ogc_fid'
      keyValue = String(row.ogcFid)
    }
    if (!keyField || !keyValue) return null
    return { table, schema, keyField, keyValue }
  }, [row.tableName, row.fieldsTable, row.record, row.ogcFid, keyFieldName, schema])

  const isFieldEditable = useCallback(
    (f: FieldEditMeta) => {
      const key = String(f.define_field_name ?? '').trim()
      if (!key || isGeomLikeDefineFieldName(key)) return false
      if (
        keyFieldName &&
        key.toLowerCase() === keyFieldName.toLowerCase()
      ) {
        return false
      }
      if (isDefineFieldFlagTrue(f.define_field_read_only)) return false
      return true
    },
    [keyFieldName]
  )

  const beginEdit = useCallback(() => {
    if (!canWrite || !editTarget || !row.record) return
    const next: Record<string, string> = {}
    for (const f of detailFields as FieldEditMeta[]) {
      if (!isFieldEditable(f)) continue
      const key = String(f.define_field_name ?? '').trim()
      if (!key) continue
      const raw = getRowValueByField(row.record, key)
      next[key] = raw == null ? '' : String(raw)
    }
    setDraft(next)
    setEditError(null)
    setEditing(true)
  }, [canWrite, editTarget, row.record, detailFields, isFieldEditable])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraft({})
    setEditError(null)
  }, [])

  const handleSave = useCallback(async () => {
    if (!canWrite || !editTarget || !row.record) return
    setSaving(true)
    setEditError(null)
    try {
      const res = await call('', 'POST', {
        service: 'layerRowService',
        action: 'updateTableRowByKey',
        params: {
          table: editTarget.table,
          schema: editTarget.schema,
          keyValue: editTarget.keyValue,
          keyField: editTarget.keyField,
          changes: draft,
          includeHiddenDetail: false,
        },
      })
      const data = res?.data ?? res
      if (data?.error || data?.success === false) {
        setEditError(String(data?.error ?? '수정에 실패했습니다.'))
        return
      }
      const updatedRecord: Record<string, unknown> = { ...row.record, ...draft }
      const next: WtlFacilityListRow = {
        ...row,
        record: updatedRecord,
        name: (() => {
          if (titleFieldName) {
            const raw = getRowValueByField(updatedRecord, titleFieldName)
            const formatted = formatDefineFieldDisplayValue(
              raw,
              titleField?.define_field_type,
              codesByField[titleFieldName.toLowerCase()],
              ''
            )
            if (formatted.trim()) return formatted
          }
          return row.name
        })(),
      }
      setLocalRow(next)
      onUpdated?.(next)
      setEditing(false)
      setDraft({})
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : '수정에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }, [
    canWrite,
    editTarget,
    row,
    draft,
    titleFieldName,
    titleField?.define_field_type,
    codesByField,
    onUpdated,
  ])

  const handleDelete = useCallback(async () => {
    if (!canWrite || !editTarget) return
    const label = String(row.name || editTarget.keyValue).trim() || '이 시설'
    if (!window.confirm(`「${label}」을(를) 삭제할까요?`)) return
    setDeleting(true)
    setEditError(null)
    try {
      const res = await call('', 'POST', {
        service: 'layerRowService',
        action: 'deleteTableRowByKey',
        params: {
          table: editTarget.table,
          schema: editTarget.schema,
          keyValue: editTarget.keyValue,
          keyField: editTarget.keyField,
        },
      })
      const data = res?.data ?? res
      if (data?.error || data?.success === false) {
        setEditError(String(data?.error ?? '삭제에 실패했습니다.'))
        return
      }
      onDeleted?.(row.id)
      onClose()
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }, [canWrite, editTarget, row.name, row.id, onDeleted, onClose])

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
    out.push({ id: 'dataHistory', label: '데이터 이력관리', icon: History })
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
            <span className="standard-detail-section-title min-w-0 flex-1">기본정보</span>
            {canWrite ? (
              <div className="standard-detail-section-header-actions">
                {!editing ? (
                  <>
                    <button
                      type="button"
                      className="standard-detail-hdr-btn"
                      title="수정"
                      disabled={!editTarget || deleting}
                      onClick={beginEdit}
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      수정
                    </button>
                    <button
                      type="button"
                      className="standard-detail-hdr-btn-delete"
                      title="삭제"
                      disabled={!editTarget || deleting}
                      onClick={() => void handleDelete()}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      {deleting ? '삭제 중…' : '삭제'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="standard-detail-hdr-btn"
                      title="취소"
                      disabled={saving}
                      onClick={cancelEdit}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      className="standard-detail-hdr-btn-save"
                      title={saving ? '저장 중…' : '저장'}
                      disabled={saving}
                      onClick={() => void handleSave()}
                    >
                      {saving ? '저장 중…' : '저장'}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="standard-detail-section-body min-h-0 flex-1 overflow-auto scrollbar-thin">
            {fieldsLoading ? (
              <p className="standard-detail-loading justify-center px-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                불러오는 중…
              </p>
            ) : detailFields.length === 0 ? (
              <p className="standard-detail-attr-empty">표시할 상세 필드가 없습니다.</p>
            ) : (
              <div className="standard-detail-attr-table">
                {(detailFields as FieldEditMeta[]).map((f, i) => {
                  const key = String(f.define_field_name ?? '').trim()
                  const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
                  const raw = getRowValueByField(row.record, key)
                  const value = formatDefineFieldDisplayValue(
                    raw,
                    f.define_field_type,
                    codesByField[key.toLowerCase()],
                    '—'
                  )
                  const editable = editing && isFieldEditable(f)
                  const codes = codesByField[key.toLowerCase()] ?? []
                  return (
                    <div key={key || `d-${i}`} className="contents">
                      <div className="standard-detail-attr-label standard-detail-attr-cell-border">
                        {label}
                      </div>
                      <div
                        className={cn(
                          'standard-detail-attr-value standard-detail-attr-cell-border text-foreground',
                          !editable &&
                            titleFieldName != null &&
                            key.toLowerCase() === titleFieldName.toLowerCase() &&
                            'font-medium text-primary'
                        )}
                        title={editable ? label : value}
                      >
                        {editable ? (
                          isDefineFieldCodeType(f.define_field_type) && codes.length > 0 ? (
                            <select
                              className={editInputClass}
                              title={label}
                              disabled={saving}
                              value={draft[key] ?? ''}
                              onChange={(e) =>
                                setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                            >
                              <option value="">—</option>
                              {codes.map((c) => {
                                const code = String(c.define_code_name ?? '').trim()
                                if (!code) return null
                                const kor = String(c.define_code_kor_name ?? '').trim()
                                return (
                                  <option key={code} value={code}>
                                    {kor ? `${kor} (${code})` : code}
                                  </option>
                                )
                              })}
                            </select>
                          ) : (
                            <input
                              className={editInputClass}
                              title={label}
                              disabled={saving}
                              value={draft[key] ?? ''}
                              onChange={(e) =>
                                setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                            />
                          )
                        ) : (
                          value
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {editError ? (
              <p className="mt-2 text-[11px] text-destructive" role="alert">
                {editError}
              </p>
            ) : null}
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
                  'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1 px-2 text-[11px] font-medium transition-colors',
                  id === 'dataHistory' ? 'min-w-[7.5rem]' : 'w-[5.5rem]',
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
            ) : activeTab === 'dataHistory' ? (
              <WtlFacilityDataHistoryTab
                row={row}
                fields={allFields.length > 0 ? allFields : detailFields}
                onReverted={onHistoryReverted}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="standard-list-scroll">
                  <table className="standard-detail-tab-table">
                    <thead className="standard-detail-table-thead">
                      <tr>
                        {relatedListFields.length > 0 ? (
                          relatedListFields.map((f, i) => {
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
                          })
                        ) : (
                          <th className="standard-detail-table-th standard-table-th-left">—</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {relatedLoading ? (
                        <WtlFacilityTableLoadingRow
                          colSpan={Math.max(1, relatedListFields.length)}
                        />
                      ) : relatedError ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, relatedListFields.length)}
                            className="standard-table-empty text-destructive"
                          >
                            {relatedError}
                          </td>
                        </tr>
                      ) : !ftrIdn ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, relatedListFields.length)}
                            className="standard-table-empty"
                          >
                            관리번호를 찾을 수 없어 목록을 표시하지 않습니다.
                          </td>
                        </tr>
                      ) : relatedRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, relatedListFields.length)}
                            className="standard-table-empty"
                          >
                            해당 현황 데이터가 없습니다.
                          </td>
                        </tr>
                      ) : relatedListFields.length === 0 ? (
                        <tr>
                          <td colSpan={1} className="standard-table-empty">
                            표시할 필드가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        relatedRows.map((r, ri) => {
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
                                    className="standard-detail-tab-td"
                                    title={value}
                                  >
                                    {value}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
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
