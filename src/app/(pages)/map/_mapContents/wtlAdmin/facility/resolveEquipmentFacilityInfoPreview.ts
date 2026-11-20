'use client'

import { call } from '@/lib/api'
import {
  getRowValueByField,
  isDefineFieldFlagTrue,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  FACILITY_INFO_BY_FTR_IDN_FIELDS_BY_SOURCE,
  facilityNameLookupFieldsForSource,
  isFacilityInfoByFtrIdnSource,
  isFacilityNameLookupSource,
} from '../../layerClickDetail/layerClickDetailRelatedConfig'
import {
  buildFacilityInfoByFtrIdnTarget,
  lookupFacilityByShowTitleValue,
} from '../../layerClickDetail/layerClickFacilityInfo'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'
import type { WtlMappedFacilityTarget } from './WtlFacilityRelatedDetailFloating'
import type { WtlFacilityListRow } from './WtlFacilityListView'

export type EquipmentFacilityInfoPreview = {
  target: WtlMappedFacilityTarget
  /** 헤더 — 사업장명(show_title) */
  siteName: string
  /** 본문 — 주소 */
  address: string
  geom: unknown | null
  tableName: string
}

function sourceTableKeyOf(row: WtlFacilityListRow): string {
  return String(row.fieldsTable || row.tableName || row.layerKey || '')
    .trim()
    .replace(/^.*\./, '')
    .toLowerCase()
}

function resolveFtrIdn(record: Record<string, unknown>): string {
  const v = getRowValueByField(record, 'ftr_idn')
  return v != null ? String(v).trim() : ''
}

function pickSiteName(
  record: Record<string, unknown>,
  fields: readonly DefineFieldLike[],
  listName: string | undefined
): string {
  const titleField = fields.find((f) =>
    isDefineFieldFlagTrue(f.define_field_show_title)
  )
  const key = String(titleField?.define_field_name ?? '').trim()
  if (key) {
    const raw = getRowValueByField(record, key)
    const text = raw != null ? String(raw).trim() : ''
    if (text) return text
  }
  const fromList = String(listName ?? '').trim()
  if (fromList) return fromList
  return '—'
}

function pickAddress(
  record: Record<string, unknown>,
  fields: readonly DefineFieldLike[]
): string {
  const byKor = fields.find(
    (f) => String(f.define_field_kor_name ?? '').trim() === '주소'
  )
  if (byKor) {
    const key = String(byKor.define_field_name ?? '').trim()
    if (key) {
      const raw = getRowValueByField(record, key)
      const text = raw != null ? String(raw).trim() : ''
      if (text) return text
    }
  }
  for (const key of [
    'srv_adr',
    'prs_loc',
    'bld_adr',
    'hom_adr',
    'address',
    'addr',
  ]) {
    const raw = getRowValueByField(record, key)
    const text = raw != null ? String(raw).trim() : ''
    if (text) return text
  }
  return '—'
}

/** 설비 행 → 시설정보 상세보기 대상 (없으면 null) */
export async function resolveEquipmentFacilityInfoTarget(
  row: WtlFacilityListRow,
  schema = 'layer'
): Promise<WtlMappedFacilityTarget | null> {
  const source = sourceTableKeyOf(row)
  if (!source) return null
  const schemaNorm = String(schema ?? 'layer').trim() || 'layer'

  if (isFacilityInfoByFtrIdnSource(source)) {
    const ftrIdn = resolveFtrIdn(row.record)
    if (!ftrIdn) return null
    const fields = FACILITY_INFO_BY_FTR_IDN_FIELDS_BY_SOURCE[source] ?? []
    for (const field of fields) {
      const target = buildFacilityInfoByFtrIdnTarget(
        field,
        null,
        ftrIdn,
        schemaNorm
      )
      if (target) return target
    }
    return null
  }

  if (isFacilityNameLookupSource(source)) {
    const fields = facilityNameLookupFieldsForSource(source)
    for (const field of fields) {
      const raw = getRowValueByField(row.record, field)
      const value = raw != null ? String(raw).trim() : ''
      if (!value) continue
      const { target } = await lookupFacilityByShowTitleValue({
        value,
        schema: schemaNorm,
      })
      if (target) return target
    }
  }

  return null
}

/** 대상 시설 조회 — 사업장명·주소·도형 */
export async function loadEquipmentFacilityInfoPreview(
  target: WtlMappedFacilityTarget
): Promise<EquipmentFacilityInfoPreview | null> {
  const schema = String(target.schema ?? 'layer').trim() || 'layer'
  const fieldsTable =
    String(target.fieldsTable ?? target.table).trim() || target.table

  let bundle = peekWtlDefineDisplayBundle(fieldsTable, null)
  if (!bundle) {
    bundle = await loadWtlDefineDisplayBundle(fieldsTable, null)
  }

  const res = await call('', 'POST', {
    service: 'wtlFacilityService',
    action: 'listFacilityRows',
    params: {
      table: target.table,
      schema,
      ftrIdn: target.ftrIdn,
      limit: 1,
      offset: 0,
    },
  })
  const data = (res?.data ?? res) as
    | {
        rows?: Array<{
          name?: string
          record?: Record<string, unknown>
          geom?: unknown | null
        }>
      }
    | undefined
  const found = Array.isArray(data?.rows) ? data.rows[0] : undefined
  const record = found?.record
  if (!record) return null

  const fields = bundle?.fields ?? []
  return {
    target,
    siteName: pickSiteName(record, fields, found?.name),
    address: pickAddress(record, fields),
    geom: found?.geom ?? null,
    tableName: target.table,
  }
}
