/**
 * 관망조회 상세 보고서 — 기본정보·탭(첨부 제외·되돌리기 제외) HTML 생성
 */
import { call } from '@/lib/api'
import {
  formatDefineFieldDisplayValue,
} from '@/lib/defineLayerCodeDisplay'
import {
  loadWimsList,
  loadWimsStatus,
} from '@/app/(pages)/map/_mapComponents/landInfo/wimsClient'
import {
  getDefineFieldDisplayLabel,
  getRowKey,
  getRowValueByField,
  isDefineFieldFlagTrue,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { WIMS_GOJIKIND, WIMS_PAGE_SIZE, type WimsHistoryRow } from '@/lib/wimsTypes'
import {
  buildWtlFacilityDetailReportHtml,
  type FacilityReportAttrRow,
  type FacilityReportTableSection,
} from '../facility/wtlFacilityDetailReport'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from './wtlNetworkDefineDisplayCache'
import { isWtlMetaPsLayer } from './WtlNetworkWimsHistoryTab'
import type { WtlNetworkRow } from './wtlNetworkTypes'

const DATA_HISTORY_PAGE_SIZE = 30

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

const WIMS_COLUMNS: {
  key: keyof WimsHistoryRow
  label: string
  kind: 'code' | 'date' | 'number' | 'text'
}[] = [
  { key: 'gojikind', label: '종류', kind: 'code' },
  { key: 'meterDay', label: '검침일', kind: 'date' },
  { key: 'nabgiDate', label: '납기마감일', kind: 'date' },
  { key: 'meterNo', label: '계량기번호', kind: 'text' },
  { key: 'useQty', label: '사용량', kind: 'number' },
  { key: 'freeQty', label: '사용료', kind: 'number' },
  { key: 'induty', label: '업종', kind: 'text' },
  { key: 'delYn', label: '상태', kind: 'text' },
]

function trimId(value: unknown): string {
  return String(value ?? '').trim()
}

function formatYmd(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return raw.trim()
}

function formatNumber(raw: string): string {
  if (!raw.trim()) return ''
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return n.toLocaleString('ko-KR')
}

function formatWimsCell(
  row: WimsHistoryRow,
  key: keyof WimsHistoryRow,
  kind: string
): string {
  const raw = trimId(row[key])
  if (!raw) return '—'
  if (kind === 'code' && key === 'gojikind') return WIMS_GOJIKIND[raw] ?? raw
  if (kind === 'date') return formatYmd(raw) || '—'
  if (kind === 'number') return formatNumber(raw) || '—'
  return raw
}

function resolveParentFtrIdn(item: WtlNetworkRow): string {
  const record = item.record
  if (record) {
    const fromRecord = getRowValueByField(record, 'ftr_idn')
    if (fromRecord != null && String(fromRecord).trim()) {
      return String(fromRecord).trim()
    }
  }
  return String(item.name ?? '').trim()
}

function resolveOgcFid(item: WtlNetworkRow): number | null {
  const record = item.record
  if (record) {
    const fromRecord = getRowValueByField(record, 'ogc_fid')
    const n = Number(fromRecord)
    if (Number.isFinite(n)) return n
  }
  const raw = String(item.id ?? '').trim()
  const tail = raw.includes(':') ? Number(raw.slice(raw.lastIndexOf(':') + 1)) : Number.NaN
  return Number.isFinite(tail) ? tail : null
}

function resolveParentKey(item: WtlNetworkRow): string {
  const fromLayer = String(item.layerKey ?? '')
    .trim()
    .toLowerCase()
  if (fromLayer === 'wtl_pres_ps' || fromLayer === 'wtl_puri_as') return fromLayer
  const fromFields = String(item.fieldsTable ?? '')
    .trim()
    .toLowerCase()
  if (fromFields === 'wtl_pres_ps' || fromFields === 'wtl_puri_as') return fromFields
  return fromLayer
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

function collectHistoryKeyValues(
  item: WtlNetworkRow,
  fields: DefineFieldLike[]
): string[] {
  const out = new Set<string>()
  const record = item.record ?? {}
  const keyField =
    fields.find((f) =>
      isDefineFieldFlagTrue(
        (f as DefineFieldLike & { define_field_is_key?: unknown }).define_field_is_key
      )
    ) ?? null
  const keyName = String(keyField?.define_field_name ?? '').trim() || null
  const fromKey = getRowKey(record, keyName)
  if (fromKey != null && String(fromKey).trim()) out.add(String(fromKey).trim())

  const ftr = getRowValueByField(record, 'ftr_idn')
  if (ftr != null && String(ftr).trim()) out.add(String(ftr).trim())

  const ogcFid = resolveOgcFid(item)
  if (ogcFid != null) out.add(String(ogcFid))
  const ogc = getRowValueByField(record, 'ogc_fid')
  if (ogc != null && String(ogc).trim()) out.add(String(ogc).trim())

  return [...out]
}

async function fetchRelatedTabs(parentKey: string): Promise<RelatedTabDef[]> {
  if (parentKey !== 'wtl_pres_ps' && parentKey !== 'wtl_puri_as') return []
  try {
    const res = await call('', 'POST', {
      service: 'wtlNetworkService',
      action: 'listWtlNetworkRelatedChildTables',
      params: { parentLayerKey: parentKey },
    })
    const data = (res?.data ?? res) as { tabs?: RelatedTabDef[] } | undefined
    const raw = Array.isArray(data?.tabs) ? data.tabs : []
    return raw
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
  } catch {
    return []
  }
}

async function buildRelatedSection(
  tab: RelatedTabDef,
  ftrIdn: string
): Promise<FacilityReportTableSection> {
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

  if (!ftrIdn) {
    return {
      title: tab.label,
      columns: columns.length > 0 ? columns : ['—'],
      rows: [],
      emptyText: '관리번호를 찾을 수 없어 목록을 표시하지 않습니다.',
    }
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
    const data = (res?.data ?? res) as { rows?: RelatedRow[] } | undefined
    const rowsRaw = Array.isArray(data?.rows) ? data.rows : []
    const rows = rowsRaw.map((r) => {
      const record =
        r.record && typeof r.record === 'object'
          ? (r.record as Record<string, unknown>)
          : {}
      return listFields.map((f) => {
        const key = String(f.define_field_name ?? '').trim()
        const raw = getRowValueByField(record, key)
        return formatDefineFieldDisplayValue(
          raw,
          f.define_field_type,
          tabCodes[key.toLowerCase()],
          '—'
        )
      })
    })
    return {
      title: tab.label,
      columns: columns.length > 0 ? columns : ['—'],
      rows,
      emptyText: '해당 현황 데이터가 없습니다.',
    }
  } catch {
    return {
      title: tab.label,
      columns: columns.length > 0 ? columns : ['—'],
      rows: [],
      emptyText: '목록을 불러오지 못했습니다.',
    }
  }
}

async function buildWimsSection(
  item: WtlNetworkRow
): Promise<FacilityReportTableSection | null> {
  if (!isWtlMetaPsLayer(item)) return null
  const columns = WIMS_COLUMNS.map((c) => c.label)
  try {
    const status = await loadWimsStatus()
    if (!status.enabled) return null
    const record = item.record ?? {}
    const customerNo =
      trimId(getRowValueByField(record, 'HOM_NUM')) ||
      trimId(getRowValueByField(record, 'hom_num'))
    const meterNo =
      trimId(getRowValueByField(record, 'MET_NUM')) ||
      trimId(getRowValueByField(record, 'met_num'))
    if (!customerNo || !meterNo) {
      return {
        title: 'WIMS 검침 이력',
        columns,
        rows: [],
        emptyText: '수용가번호·계량기기물번호가 없어 조회할 수 없습니다.',
      }
    }
    if (status.connected === false) {
      return {
        title: 'WIMS 검침 이력',
        columns,
        rows: [],
        emptyText: 'WIMS에 연결할 수 없습니다.',
      }
    }
    const res = await loadWimsList({
      customerNo,
      meterNo,
      pairs: [{ customerNo, meterNo }],
      page: 1,
      pageSize: WIMS_PAGE_SIZE,
    })
    const list = res.dataList ?? []
    return {
      title: 'WIMS 검침 이력',
      columns,
      rows: list.map((row) =>
        WIMS_COLUMNS.map((c) => formatWimsCell(row, c.key, c.kind))
      ),
      emptyText: '검침 이력이 없습니다.',
    }
  } catch {
    return {
      title: 'WIMS 검침 이력',
      columns,
      rows: [],
      emptyText: 'WIMS 검침 이력을 불러오지 못했습니다.',
    }
  }
}

async function buildDataHistorySection(
  item: WtlNetworkRow,
  fields: DefineFieldLike[]
): Promise<FacilityReportTableSection> {
  const columns = ['일자', '사용자', '작업']
  const tableName = String(item.fieldsTable || item.layerKey || '')
    .trim()
    .replace(/^.*\./, '')
    .toLowerCase()
  const keyValues = collectHistoryKeyValues(item, fields)
  if (!tableName || keyValues.length === 0) {
    return {
      title: '데이터 이력관리',
      columns,
      rows: [],
      emptyText: '행 키를 찾을 수 없어 이력을 표시하지 않습니다.',
    }
  }
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
      return {
        title: '데이터 이력관리',
        columns,
        rows: [],
        emptyText: String(data?.error ?? '이력을 불러오지 못했습니다.'),
      }
    }
    const list =
      (data.data as Array<{
        date?: string
        userName?: string
        userId?: string
        workType?: string
      }>) ?? []
    return {
      title: '데이터 이력관리',
      columns,
      rows: list.map((r) => {
        const userLabel =
          [r.userName, r.userId]
            .filter((s) => String(s ?? '').trim())
            .join(' / ') || '—'
        return [
          String(r.date ?? '').trim() || '—',
          userLabel,
          String(r.workType ?? '').trim() || '—',
        ]
      }),
      emptyText: '이 데이터의 이력이 없습니다.',
    }
  } catch (e: unknown) {
    return {
      title: '데이터 이력관리',
      columns,
      rows: [],
      emptyText: e instanceof Error ? e.message : '이력을 불러오지 못했습니다.',
    }
  }
}

/** 관망조회 상세 → 보고서 HTML (첨부 제외, 이력 되돌리기 제외) */
export async function buildWtlNetworkDetailReportHtml(args: {
  title: string
  layerLabel: string
  basicAttrs: FacilityReportAttrRow[]
  item: WtlNetworkRow
  fields: DefineFieldLike[]
}): Promise<string> {
  const sections: FacilityReportTableSection[] = []
  const parentKey = resolveParentKey(args.item)
  const ftrIdn = resolveParentFtrIdn(args.item)
  const relatedTabs = await fetchRelatedTabs(parentKey)
  for (const tab of relatedTabs) {
    sections.push(await buildRelatedSection(tab, ftrIdn))
  }
  const wims = await buildWimsSection(args.item)
  if (wims) sections.push(wims)
  sections.push(await buildDataHistorySection(args.item, args.fields))

  return buildWtlFacilityDetailReportHtml({
    title: args.title,
    layerLabel: args.layerLabel,
    basicAttrs: args.basicAttrs,
    sections,
  })
}
