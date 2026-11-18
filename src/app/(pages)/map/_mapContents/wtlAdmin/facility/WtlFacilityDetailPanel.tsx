'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
} from 'react'
import {
  ClipboardList,
  FileText,
  History,
  Loader2,
  Paperclip,
  Pencil,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { call } from '@/lib/api'
import {
  booleanDraftValue,
  formatBooleanYeobu,
  shouldUseBooleanCheckbox,
} from '@/lib/defineBooleanField'
import {
  formatDefineFieldDisplayValue,
  isDefineFieldCodeType,
  parseDefineBooleanValue,
} from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { COMPLAINT_DETAIL_PANEL_DEFAULT_TOP } from '../../../_mapComponents/complaint/complaintPanelLayout'
import {
  getDefineFieldDisplayLabel,
  getRowKey,
  getRowValueByField,
  isDefineFieldFlagTrue,
  isGeomLikeDefineFieldName,
  selectDefineLayerDetailFields,
  selectDefineLayerListFields,
  uniqueDefineLayerFields,
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
import {
  buildFacilityInfoByFtrIdnTarget,
  lookupFacilityByShowTitleValue,
  shouldShowFacilityInfoSearch,
} from '../../layerClickDetail/layerClickFacilityInfo'
import {
  WtlFacilityRelatedDetailFloating,
  WtlMappedFacilityFloating,
  type WtlMappedFacilityTarget,
} from './WtlFacilityRelatedDetailFloating'
import { facilityTabLabel } from './wtlFacilityCatalog'
import { WtlFacilityTableLoadingRow } from './WtlFacilityTableLoadingRow'
import { DataHistoryCardSection } from '../../../_mapComponents/dataHistoryCard/DataHistoryCardSection'
import { isTankHistoryGubun } from '../../../_mapComponents/dataHistoryCard/dataHistoryCardExtra'
import {
  buildWtlFacilityDetailReportHtml,
  type FacilityReportAttrRow,
  type FacilityReportTableSection,
} from './wtlFacilityDetailReport'

const SER_ENG = 'wtlFacility'

const editInputClass =
  'h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25'

const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50'

const DATA_HISTORY_PAGE_SIZE = 30

function collectHistoryKeyValues(
  row: WtlFacilityListRow,
  fields: DefineFieldLike[]
): string[] {
  const out = new Set<string>()
  const keyField =
    fields.find((f) =>
      isDefineFieldFlagTrue(
        (f as DefineFieldLike & { define_field_is_key?: unknown }).define_field_is_key
      )
    ) ?? null
  const keyName = String(keyField?.define_field_name ?? '').trim() || null
  const fromKey = getRowKey(row.record, keyName)
  if (fromKey != null && String(fromKey).trim()) out.add(String(fromKey).trim())

  const ftr = getRowValueByField(row.record, 'ftr_idn')
  if (ftr != null && String(ftr).trim()) out.add(String(ftr).trim())

  if (row.ogcFid != null && Number.isFinite(row.ogcFid)) {
    out.add(String(row.ogcFid))
  }
  const ogc = getRowValueByField(row.record, 'ogc_fid')
  if (ogc != null && String(ogc).trim()) out.add(String(ogc).trim())

  return [...out]
}

function relatedListFieldsFromBundle(
  bundle: WtlDefineDisplayBundle | null
): DefineFieldLike[] {
  const all = bundle?.fields ?? []
  const selected = selectDefineLayerListFields(all)
  if (selected.length > 0) return selected
  return all.filter((f) => {
    const name = String(f.define_field_name ?? '')
      .trim()
      .toLowerCase()
    return name && name !== 'geom' && name !== 'ogc_fid'
  })
}

type Props = {
  row: WtlFacilityListRow
  onClose: () => void
  /** layer / public_layer 등 — 없으면 layer */
  schema?: string
  onUpdated?: (row: WtlFacilityListRow) => void
  onDeleted?: (id: string) => void
  /** 이력 되돌리기 후 목록·상세 재조회 */
  onHistoryReverted?: () => void
  /** 설비관리 기본정보 — 가압장명·정수장명·사업장명 값 칸에 시설 정보 보기 */
  showFacilityInfoLink?: boolean
  /** 설비관리 — data_history 이력 카드 탭 (추가·수정·삭제, agency 공개) */
  showHistoryCard?: boolean
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

type ActiveTab = 'attach' | 'dataHistory' | 'historyCard' | string

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
  showFacilityInfoLink = false,
  showHistoryCard = false,
}: Props) {
  const canWrite = useSerWriteAccess(SER_ENG)
  const theme = useResolvedThemeSafe()
  const mapContext = useMapContext()
  const reportFloatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 56
  const [localRow, setLocalRow] = useState(rowProp)
  const [bundle, setBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('')
  const [relatedTabs, setRelatedTabs] = useState<RelatedTabDef[]>([])
  const [relatedRows, setRelatedRows] = useState<RelatedRow[]>([])
  const [relatedTotal, setRelatedTotal] = useState(0)
  const [relatedBundle, setRelatedBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedError, setRelatedError] = useState<string | null>(null)
  const [relatedDetail, setRelatedDetail] = useState<RelatedRow | null>(null)
  const [facilityInfo, setFacilityInfo] = useState<WtlMappedFacilityTarget | null>(null)
  const [facilityLookupBusy, setFacilityLookupBusy] = useState(false)
  const [facilityLookupError, setFacilityLookupError] = useState<string | null>(null)
  /** 상세 모달 접힘 — 다른 행을 열어도 유지 */
  const [detailCollapsed, setDetailCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  /** 행 전환 시 탭을 배열 첫 항목으로 되돌리기 위한 세대 */
  const [tabSelectEpoch, setTabSelectEpoch] = useState(0)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportHtml, setReportHtml] = useState('')
  const [printing, setPrinting] = useState(false)
  const reportIframeRef = useRef<HTMLIFrameElement | null>(null)
  /** 물리 컬럼명(소문자) → PG data_type — BOOLEAN 체크박스 판별 */
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({})
  const [columnTypesReady, setColumnTypesReady] = useState(false)

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

  useEffect(() => {
    const table = String(row.tableName || row.fieldsTable || '')
      .trim()
      .replace(/^.*\./, '')
      .toLowerCase()
    if (!table) {
      setColumnTypes({})
      setColumnTypesReady(false)
      return
    }
    let cancelled = false
    setColumnTypesReady(false)
    void call('', 'POST', {
      service: 'layerRowService',
      action: 'listTableColumnTypes',
      params: { table, schema },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { columns?: Array<{ name?: string; dataType?: string }> }
          | undefined
        const next: Record<string, string> = {}
        for (const c of Array.isArray(data?.columns) ? data.columns : []) {
          const name = String(c?.name ?? '')
            .trim()
            .toLowerCase()
          const dataType = String(c?.dataType ?? '')
            .trim()
            .toLowerCase()
          if (name && dataType) next[name] = dataType
        }
        setColumnTypes(next)
        setColumnTypesReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setColumnTypes({})
        setColumnTypesReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [row.tableName, row.fieldsTable, schema, row.id])

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
    setFacilityInfo(null)
    setFacilityLookupBusy(false)
    setFacilityLookupError(null)
    setActiveTab('')
    setTabSelectEpoch((n) => n + 1)

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
        setTabSelectEpoch((n) => n + 1)
      })
      .catch(() => {
        if (cancelled) return
        setRelatedTabs([])
        setTabSelectEpoch((n) => n + 1)
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

  const headerLayerLabel = useMemo(() => {
    const table = String(row.tableName || row.fieldsTable || row.layerKey || '').trim()
    if (!table) return ''
    return facilityTabLabel(table) || table
  }, [row.tableName, row.fieldsTable, row.layerKey])

  const detailFields = useMemo(() => {
    const selectedFields = selectDefineLayerDetailFields(allFields)
    if (selectedFields.length > 0) return selectedFields
    if (allFields.length > 0) {
      return uniqueDefineLayerFields(allFields).filter((f) => {
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
  const sourceTableKey = String(row.tableName || row.fieldsTable || '')
    .trim()
    .replace(/^.*\./, '')
    .toLowerCase()

  const openFacilityInfoSearch = useCallback(
    async (
      kind: 'byFtrIdn' | 'byNameLookup',
      fieldKey: string,
      korName: unknown,
      rawValue: unknown
    ) => {
      setFacilityLookupError(null)
      if (kind === 'byFtrIdn') {
        const target = buildFacilityInfoByFtrIdnTarget(
          fieldKey,
          korName,
          ftrIdn,
          schema
        )
        if (!target) {
          setFacilityLookupError('시설 정보를 찾을 수 없습니다.')
          return
        }
        setFacilityInfo(target)
        return
      }
      const value = rawValue != null ? String(rawValue).trim() : ''
      setFacilityLookupBusy(true)
      try {
        const { target, error } = await lookupFacilityByShowTitleValue({
          value,
          schema,
        })
        if (!target) {
          setFacilityLookupError(error || '일치하는 시설을 찾을 수 없습니다.')
          return
        }
        setFacilityInfo(target)
      } finally {
        setFacilityLookupBusy(false)
      }
    },
    [ftrIdn, schema]
  )

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
      if (
        shouldUseBooleanCheckbox(
          f.define_field_type,
          columnTypes[key.toLowerCase()],
          columnTypesReady
        )
      ) {
        next[key] = booleanDraftValue(raw)
      } else {
        next[key] = raw == null ? '' : String(raw)
      }
    }
    setDraft(next)
    setEditError(null)
    setEditing(true)
  }, [
    canWrite,
    editTarget,
    row.record,
    detailFields,
    isFieldEditable,
    columnTypes,
    columnTypesReady,
  ])

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

  const historyCardEnabled =
    showHistoryCard || isTankHistoryGubun(String(row.tableName ?? ''))

  const tabs = useMemo(() => {
    const out: { id: ActiveTab; label: string; icon: ElementType }[] = []
    for (const t of relatedTabs) {
      out.push({ id: t.table, label: t.label, icon: FileText })
    }
    if (historyCardEnabled) {
      out.push({ id: 'historyCard', label: '이력 카드', icon: ClipboardList })
    }
    out.push({ id: 'attach', label: '첨부파일', icon: Paperclip })
    out.push({ id: 'dataHistory', label: '데이터 이력관리', icon: History })
    return out
  }, [relatedTabs, historyCardEnabled])

  useEffect(() => {
    const first = tabs[0]?.id
    if (!first) return
    setActiveTab(first)
    // 행·연관탭 전환(epoch) 시에만 첫 탭으로 맞춤
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabSelectEpoch
  }, [tabSelectEpoch])

  useEffect(() => {
    const first = tabs[0]?.id
    if (!first) return
    if (!tabs.some((t) => t.id === activeTab)) {
      setActiveTab(first)
    }
  }, [tabs, activeTab])

  const closeReportModal = useCallback(() => {
    setReportOpen(false)
    setReportHtml('')
    setPrinting(false)
  }, [])

  const handlePrintReport = useCallback(async () => {
    setPrinting(true)
    setReportHtml('')
    setReportOpen(true)
    try {
      const loadColumnTypes = async (
        table: string,
        tableSchema: string
      ): Promise<Record<string, string>> => {
        const t = String(table ?? '')
          .trim()
          .replace(/^.*\./, '')
          .toLowerCase()
        if (!t) return {}
        try {
          const res = await call('', 'POST', {
            service: 'layerRowService',
            action: 'listTableColumnTypes',
            params: { table: t, schema: tableSchema },
          })
          const data = (res?.data ?? res) as
            | { columns?: Array<{ name?: string; dataType?: string }> }
            | undefined
          const next: Record<string, string> = {}
          for (const c of Array.isArray(data?.columns) ? data.columns : []) {
            const name = String(c?.name ?? '')
              .trim()
              .toLowerCase()
            const dataType = String(c?.dataType ?? '')
              .trim()
              .toLowerCase()
            if (name && dataType) next[name] = dataType
          }
          return next
        } catch {
          return {}
        }
      }

      const formatReportFieldValue = (
        raw: unknown,
        defineFieldType: unknown,
        codes: Parameters<typeof formatDefineFieldDisplayValue>[2],
        pgTypes: Record<string, string>,
        fieldKey: string
      ): string => {
        if (
          shouldUseBooleanCheckbox(
            defineFieldType,
            pgTypes[fieldKey.toLowerCase()],
            true
          )
        ) {
          return formatBooleanYeobu(raw, '—')
        }
        return formatDefineFieldDisplayValue(raw, defineFieldType, codes, '—')
      }

      const basicAttrs: FacilityReportAttrRow[] = detailFields.map((f) => {
        const key = String(f.define_field_name ?? '').trim()
        const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(row.record, key)
        const value = formatReportFieldValue(
          raw,
          f.define_field_type,
          codesByField[key.toLowerCase()],
          columnTypes,
          key
        )
        return { label, value }
      })

      let relatedFacility: {
        title: string
        attrs: FacilityReportAttrRow[]
      } | null = null
      if (showFacilityInfoLink && sourceTableKey) {
        for (const f of detailFields) {
          const key = String(f.define_field_name ?? '').trim()
          if (!key) continue
          const kind = shouldShowFacilityInfoSearch({
            sourceTableKey,
            fieldName: key,
            korName: f.define_field_kor_name,
            fields: allFields,
          })
          if (kind !== 'byNameLookup') continue
          const raw = getRowValueByField(row.record, key)
          const value = raw != null ? String(raw).trim() : ''
          if (!value) continue
          const { target } = await lookupFacilityByShowTitleValue({
            value,
            schema,
          })
          if (!target) break
          try {
            const res = await call('', 'POST', {
              service: 'wtlFacilityService',
              action: 'listFacilityRows',
              params: {
                table: target.table,
                schema: target.schema || schema,
                ftrIdn: target.ftrIdn,
                limit: 1,
                offset: 0,
              },
            })
            const data = (res?.data ?? res) as
              | { rows?: Array<{ record?: Record<string, unknown> }> }
              | undefined
            const found = Array.isArray(data?.rows) ? data.rows[0] : undefined
            const record = found?.record
            if (!record) break
            const fieldsTable =
              String(target.fieldsTable ?? target.table).trim() || target.table
            let facBundle = peekWtlDefineDisplayBundle(fieldsTable, null)
            if (!facBundle) {
              facBundle = await loadWtlDefineDisplayBundle(fieldsTable, null)
            }
            const facFieldsRaw = facBundle?.fields ?? []
            const facDetail =
              selectDefineLayerDetailFields(facFieldsRaw).length > 0
                ? selectDefineLayerDetailFields(facFieldsRaw)
                : uniqueDefineLayerFields(facFieldsRaw).filter((ff) => {
                    const n = String(ff.define_field_name ?? '')
                      .trim()
                      .toLowerCase()
                    return n && n !== 'geom'
                  })
            const facCodes = facBundle?.codesByField ?? {}
            const facColTypes = await loadColumnTypes(
              target.table,
              target.schema || schema
            )
            relatedFacility = {
              title: target.title,
              attrs: facDetail.map((ff) => {
                const fk = String(ff.define_field_name ?? '').trim()
                const flabel = getDefineFieldDisplayLabel(
                  fk,
                  ff.define_field_kor_name
                )
                const fraw = getRowValueByField(record, fk)
                return {
                  label: flabel,
                  value: formatReportFieldValue(
                    fraw,
                    ff.define_field_type,
                    facCodes[fk.toLowerCase()],
                    facColTypes,
                    fk
                  ),
                }
              }),
            }
          } catch {
            relatedFacility = null
          }
          break
        }
      }

      const sections: FacilityReportTableSection[] = []

      for (const tab of relatedTabs) {
        const defineTable = tab.defineTable || tab.table
        let tabBundle = peekWtlDefineDisplayBundle(defineTable, null)
        if (!tabBundle) {
          tabBundle = await loadWtlDefineDisplayBundle(defineTable, null)
        }
        const listFields = relatedListFieldsFromBundle(tabBundle)
        const columns = listFields.map((f) =>
          getDefineFieldDisplayLabel(
            String(f.define_field_name ?? '').trim(),
            f.define_field_kor_name
          )
        )
        const tabCodes = tabBundle?.codesByField ?? {}
        const tabColumnTypes = await loadColumnTypes(tab.table, schema)

        if (!ftrIdn) {
          sections.push({
            title: tab.label,
            columns,
            rows: [],
            emptyText: '관리번호를 찾을 수 없어 목록을 표시하지 않습니다.',
          })
          continue
        }

        try {
          const res = await call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'listWtlNetworkRelatedChildRows',
            params: {
              table: tab.table,
              defineTable,
              ftrIdn,
              limit: 200,
            },
          })
          const data = (res?.data ?? res) as
            | { rows?: RelatedRow[]; total?: number }
            | undefined
          const rowsRaw = Array.isArray(data?.rows) ? data.rows : []
          const rows = rowsRaw.map((r) => {
            const record =
              r.record && typeof r.record === 'object'
                ? (r.record as Record<string, unknown>)
                : {}
            return listFields.map((f) => {
              const key = String(f.define_field_name ?? '').trim()
              const raw = getRowValueByField(record, key)
              return formatReportFieldValue(
                raw,
                f.define_field_type,
                tabCodes[key.toLowerCase()],
                tabColumnTypes,
                key
              )
            })
          })
          sections.push({
            title: tab.label,
            columns: columns.length > 0 ? columns : ['—'],
            rows,
            emptyText: '해당 현황 데이터가 없습니다.',
          })
        } catch {
          sections.push({
            title: tab.label,
            columns: columns.length > 0 ? columns : ['—'],
            rows: [],
            emptyText: '목록을 불러오지 못했습니다.',
          })
        }
      }

      if (historyCardEnabled) {
        const hisGubun = String(row.tableName ?? '').trim()
        const columns = ['No', '내용', '업체', '작성자', '작성일시']
        if (!hisGubun || !ftrIdn) {
          sections.push({
            title: '이력 카드',
            columns,
            rows: [],
            emptyText: '이력 카드를 조회할 수 없습니다.',
          })
        } else {
          try {
            const res = await call('', 'POST', {
              service: 'safedataHistoryService',
              action: 'listByFacility',
              params: { hisGubun, ftrIdn },
            })
            const data = res?.data ?? res
            if (data?.error || data?.success === false) {
              sections.push({
                title: '이력 카드',
                columns,
                rows: [],
                emptyText: String(data?.error ?? '이력을 불러오지 못했습니다.'),
              })
            } else {
              const list = Array.isArray(data?.data) ? data.data : []
              const rows = list.map(
                (raw: Record<string, unknown>, index: number) => {
                  const content = String(
                    raw.content ?? raw.hisContents ?? ''
                  ).trim()
                  const author =
                    String(raw.author ?? raw.createdBy ?? '').trim() || '—'
                  const createdAt = String(raw.createdAt ?? '').trim() || '—'
                  const agency = String(raw.agency ?? '').trim() || '—'
                  return [
                    String(index + 1),
                    content || '—',
                    agency,
                    author,
                    createdAt,
                  ]
                }
              )
              sections.push({
                title: '이력 카드',
                columns,
                rows,
                emptyText: '이력이 없습니다.',
              })
            }
          } catch {
            sections.push({
              title: '이력 카드',
              columns,
              rows: [],
              emptyText: '이력을 불러오지 못했습니다.',
            })
          }
        }
      }

      {
        const histFields = allFields.length > 0 ? allFields : detailFields
        const tableName = String(row.tableName || row.fieldsTable || '')
          .trim()
          .replace(/^.*\./, '')
          .toLowerCase()
        const keyValues = collectHistoryKeyValues(row, histFields)
        const columns = ['일자', '사용자', '작업']
        if (!tableName || keyValues.length === 0) {
          sections.push({
            title: '데이터 이력관리',
            columns,
            rows: [],
            emptyText: '행 키를 찾을 수 없어 이력을 표시하지 않습니다.',
          })
        } else {
          try {
            const res = await call('', 'POST', {
              service: 'dataHistoryService',
              action: 'getDataHistoryList',
              params: {
                tableName,
                keyValue: keyValues,
                page: 1,
                limit: DATA_HISTORY_PAGE_SIZE,
                excludeWorkTypes: ['조회'],
              },
            })
            const data = res?.data ?? res
            if (!data?.success) {
              sections.push({
                title: '데이터 이력관리',
                columns,
                rows: [],
                emptyText: String(data?.error ?? '이력을 불러오지 못했습니다.'),
              })
            } else {
              const list = (data.data as Array<{
                date?: string
                userName?: string
                userId?: string
                workType?: string
              }>) ?? []
              const rows = list.map((r) => {
                const userLabel =
                  [r.userName, r.userId]
                    .filter((s) => String(s ?? '').trim())
                    .join(' / ') || '—'
                return [
                  String(r.date ?? '').trim() || '—',
                  userLabel,
                  String(r.workType ?? '').trim() || '—',
                ]
              })
              sections.push({
                title: '데이터 이력관리',
                columns,
                rows,
                emptyText: '이 데이터의 이력이 없습니다.',
              })
            }
          } catch (e: unknown) {
            sections.push({
              title: '데이터 이력관리',
              columns,
              rows: [],
              emptyText:
                e instanceof Error ? e.message : '이력을 불러오지 못했습니다.',
            })
          }
        }
      }

      const html = buildWtlFacilityDetailReportHtml({
        title: headerTitle,
        layerLabel: headerLayerLabel || headerTitle,
        basicAttrs,
        sections,
        relatedFacility,
      })
      setReportHtml(html)
    } catch {
      setReportOpen(false)
      setReportHtml('')
      window.alert('보고서 인쇄에 실패했습니다.')
    } finally {
      setPrinting(false)
    }
  }, [
    allFields,
    codesByField,
    columnTypes,
    detailFields,
    ftrIdn,
    headerLayerLabel,
    headerTitle,
    historyCardEnabled,
    relatedTabs,
    row,
    schema,
    showFacilityInfoLink,
    sourceTableKey,
  ])

  useEffect(() => {
    const doc = reportIframeRef.current?.contentDocument
    if (!doc?.documentElement) return
    doc.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme, reportHtml, reportOpen])

  const printReportFromModal = () => {
    if (printing || !reportHtml) return
    const win = reportIframeRef.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
  }

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <div className="standard-detail-float-heading pr-2">
          {headerLayerLabel && headerLayerLabel !== headerTitle ? (
            <span className="standard-detail-float-layer" title={headerLayerLabel}>
              {headerLayerLabel}
            </span>
          ) : null}
          <span
            className={
              headerLayerLabel && headerLayerLabel !== headerTitle
                ? 'standard-detail-float-title-below'
                : 'standard-detail-float-title'
            }
            title={headerTitle}
          >
            {headerTitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title={printing ? '보고서 준비 중…' : '보고서 인쇄'}
            disabled={printing}
            onClick={() => void handlePrintReport()}
            className="standard-detail-hdr-btn"
          >
            <Printer className="h-3 w-3" aria-hidden />
            {printing ? '준비 중…' : '보고서 인쇄'}
          </button>
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
                  const useBoolCheck = shouldUseBooleanCheckbox(
                    f.define_field_type,
                    columnTypes[key.toLowerCase()],
                    columnTypesReady
                  )
                  const codes = codesByField[key.toLowerCase()] ?? []
                  const facilitySearch = showFacilityInfoLink
                    ? shouldShowFacilityInfoSearch({
                        sourceTableKey,
                        fieldName: key,
                        korName: f.define_field_kor_name,
                        fields: allFields,
                      })
                    : null
                  const boolChecked = editable
                    ? parseDefineBooleanValue(draft[key])
                    : parseDefineBooleanValue(raw)
                  return (
                    <div key={key || `d-${i}`} className="contents">
                      <div className="standard-detail-attr-label standard-detail-attr-cell-border">
                        {label}
                      </div>
                      <div
                        className={cn(
                          'standard-detail-attr-value standard-detail-attr-cell-border text-foreground',
                          facilitySearch && 'flex items-center gap-1',
                          !editable &&
                            titleFieldName != null &&
                            key.toLowerCase() === titleFieldName.toLowerCase() &&
                            'standard-detail-attr-value-title'
                        )}
                        title={
                          editable
                            ? label
                            : useBoolCheck
                              ? formatBooleanYeobu(raw, '—')
                              : value
                        }
                      >
                        {editable ? (
                          <div className="min-w-0 flex-1">
                          {useBoolCheck ? (
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              title={label}
                              aria-label={label}
                              disabled={saving}
                              checked={boolChecked}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  [key]: booleanDraftValue(e.target.checked),
                                }))
                              }
                            />
                          ) : isDefineFieldCodeType(f.define_field_type) && codes.length > 0 ? (
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
                          )}
                          </div>
                        ) : useBoolCheck ? (
                          <input
                            type="checkbox"
                            className="pointer-events-none h-3.5 w-3.5 accent-primary"
                            title={formatBooleanYeobu(raw, '—')}
                            aria-label={label}
                            aria-readonly="true"
                            checked={boolChecked}
                            readOnly
                            tabIndex={-1}
                            onChange={() => {}}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 break-all">{value}</span>
                        )}
                        {facilitySearch ? (
                          <button
                            type="button"
                            title="시설 정보 보기"
                            aria-label="시설 정보 보기"
                            disabled={facilityLookupBusy}
                            className="ml-auto inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-primary hover:bg-primary/10 disabled:opacity-50"
                            onClick={() =>
                              void openFacilityInfoSearch(
                                facilitySearch,
                                key,
                                f.define_field_kor_name,
                                raw
                              )
                            }
                          >
                            {facilityLookupBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Search className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {facilityLookupError ? (
              <p className="mt-2 text-[11px] text-destructive" role="alert">
                {facilityLookupError}
              </p>
            ) : null}
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
                  id === 'dataHistory' || id === 'historyCard'
                    ? 'min-w-[7.5rem]'
                    : 'w-22',
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
            ) : activeTab === 'historyCard' ? (
              <DataHistoryCardSection
                hisGubun={String(row.tableName ?? '').trim()}
                ftrIdn={ftrIdn}
                showAgency
                variant="panel"
              />
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
          table={activeRelated.table}
          schema={schema}
          onClose={() => setRelatedDetail(null)}
          collapsed={detailCollapsed}
          onToggleCollapsed={() => setDetailCollapsed((v) => !v)}
        />
      ) : null}
      {facilityInfo ? (
        <WtlMappedFacilityFloating
          target={facilityInfo}
          onClose={() => setFacilityInfo(null)}
          collapsed={detailCollapsed}
          onToggleCollapsed={() => setDetailCollapsed((v) => !v)}
        />
      ) : null}

      {reportOpen ? (
        <MapFloatingPanel
          viewport
          zLayer="detailFloating"
          width="min(56rem, calc(100vw - 1.5rem))"
          maxHeight="min(90vh, 900px)"
          className="bg-background backdrop-blur-none"
          defaultPosition={{
            top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
            left: reportFloatingLeftPx,
          }}
          header={
            <>
              <div className="standard-detail-float-heading pr-2">
                <span
                  className="standard-detail-float-title"
                  title={`${headerTitle} 상세보고서`}
                >
                  {headerTitle} 상세보고서
                </span>
              </div>
              <button
                type="button"
                title="닫기"
                aria-label="닫기"
                onClick={closeReportModal}
                className="standard-panel-close cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="min-h-0 flex-1 bg-background">
              {reportHtml ? (
                <iframe
                  ref={reportIframeRef}
                  title={`${headerTitle} 상세보고서 미리보기`}
                  className="h-[min(70vh,720px)] w-full border-0 bg-background"
                  onLoad={(e) => {
                    const doc = e.currentTarget.contentDocument
                    if (!doc?.documentElement) return
                    doc.documentElement.classList.toggle(
                      'dark',
                      document.documentElement.classList.contains('dark')
                    )
                  }}
                  srcDoc={reportHtml}
                />
              ) : (
                <div
                  className="flex h-[min(70vh,720px)] flex-col items-center justify-center gap-3 px-6"
                  aria-live="polite"
                >
                  <p className="text-sm font-medium text-foreground">
                    보고서 준비 중…
                  </p>
                  {printing ? (
                    <p className="text-xs text-muted-foreground">
                      탭 현황·이력을 불러오는 중입니다.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="standard-detail-edit-footer gap-1">
              <button
                type="button"
                title={
                  printing || !reportHtml
                    ? '준비가 끝난 뒤 인쇄할 수 있습니다'
                    : '인쇄 / PDF 저장'
                }
                disabled={printing || !reportHtml}
                className={cn(btnPrimary, 'cursor-pointer disabled:opacity-50')}
                onClick={printReportFromModal}
              >
                <Printer className="h-3 w-3" aria-hidden />
                {printing ? '준비 중…' : '인쇄 / PDF 저장'}
              </button>
              <button
                type="button"
                title="닫기"
                className={cn(btnGhost, 'cursor-pointer')}
                onClick={closeReportModal}
              >
                닫기
              </button>
            </div>
          </div>
        </MapFloatingPanel>
      ) : null}
    </div>
  )
}
