'use client'

import { call } from '@/lib/api'
import {
  getRowValueByField,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils'
import type { WtlMappedFacilityTarget } from '../wtlAdmin/facility/WtlFacilityRelatedDetailFloating'
import {
  FACILITY_INFO_BY_FTR_IDN_FIELDS_BY_SOURCE,
  FACILITY_NAME_LOOKUP_TARGETS,
  facilityNameLookupFieldsForSource,
  isFacilityDetailTargetTable,
  isFacilityInfoByFtrIdnSource,
  isFacilityNameLookupSource,
  resolveFacilityInfoByFtrIdn,
} from './layerClickDetailRelatedConfig'

type FacilityListRow = {
  name?: string
  record?: Record<string, unknown>
}

function normalizeName(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
}

function resolveFtrIdnFromRecord(record: Record<string, unknown> | undefined): string {
  if (!record) return ''
  const v = getRowValueByField(record, 'ftr_idn')
  return v != null ? String(v).trim() : ''
}

/**
 * 설비관리와 동일 — 필드가 가압장명·정수장명이면 현재 행 ftr_idn 으로 대상 지정.
 */
export function buildFacilityInfoByFtrIdnTarget(
  fieldName: string,
  korName: unknown,
  ftrIdn: string,
  schema = 'layer'
): WtlMappedFacilityTarget | null {
  const id = String(ftrIdn ?? '').trim()
  if (!id) return null
  const def = resolveFacilityInfoByFtrIdn(fieldName, korName)
  if (!def) return null
  return {
    table: def.table,
    schema,
    title: def.title,
    fieldsTable: def.fieldsTable,
    ftrIdn: id,
  }
}

/**
 * 소스 테이블·필드에 Search(시설 상세보기)를 달지 여부.
 * - 가압장·배수지·정수장 본 시설: 비노출
 * - byFtrIdn: 펌프(가압장명·정수장명)·흡수정(가압장명)
 * - byNameLookup: 염소(inf_nam)·수질(mtr_nam) 고정 컬럼
 */
export function shouldShowFacilityInfoSearch(params: {
  sourceTableKey: string
  fieldName: string
  korName: unknown
  fields: readonly DefineFieldLike[]
}): 'byFtrIdn' | 'byNameLookup' | null {
  const source = String(params.sourceTableKey ?? '')
    .trim()
    .toLowerCase()
  const field = String(params.fieldName ?? '')
    .trim()
    .toLowerCase()
  if (!field || !source) return null
  if (isFacilityDetailTargetTable(source)) return null

  if (isFacilityInfoByFtrIdnSource(source)) {
    const allowed =
      FACILITY_INFO_BY_FTR_IDN_FIELDS_BY_SOURCE[source] ?? []
    const fieldAllowed = allowed.some((f) => f.toLowerCase() === field)
    if (fieldAllowed && resolveFacilityInfoByFtrIdn(field, params.korName)) {
      return 'byFtrIdn'
    }
  }

  if (!isFacilityNameLookupSource(source)) return null
  const allowed = facilityNameLookupFieldsForSource(source)
  if (!allowed.some((f) => f.toLowerCase() === field)) return null
  return 'byNameLookup'
}

/**
 * 가압장·배수지·정수장 시설명(목록 name)과 값 일치 1건 조회.
 */
export async function lookupFacilityByShowTitleValue(params: {
  value: string
  schema?: string
}): Promise<{ target: WtlMappedFacilityTarget | null; error: string | null }> {
  const value = String(params.value ?? '').trim()
  const schema = String(params.schema ?? 'layer').trim() || 'layer'
  if (!value) {
    return { target: null, error: '조회할 값이 없습니다.' }
  }
  const needle = normalizeName(value)

  for (const t of FACILITY_NAME_LOOKUP_TARGETS) {
    try {
      const res = await call('', 'POST', {
        service: 'wtlFacilityService',
        action: 'listFacilityRows',
        params: {
          table: t.table,
          schema,
          keyword: value,
          limit: 50,
          offset: 0,
        },
      })
      const data = (res?.data ?? res) as { rows?: FacilityListRow[] } | undefined
      const rows = Array.isArray(data?.rows) ? data.rows : []
      // listFacilityRows 의 name 은 show_title 필드 기반 — 완전 일치만 채택
      const exact = rows.find((r) => normalizeName(r.name) === needle) ?? null
      if (!exact) continue
      const ftrIdn = resolveFtrIdnFromRecord(exact.record)
      if (!ftrIdn) continue
      return {
        target: {
          table: t.table,
          schema,
          title: t.title,
          fieldsTable: t.fieldsTable,
          ftrIdn,
        },
        error: null,
      }
    } catch {
      /* 다음 대상 테이블 계속 */
    }
  }

  return { target: null, error: '일치하는 시설을 찾을 수 없습니다.' }
}
