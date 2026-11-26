'use client'

/**
 * 서비스 상세 오픈 시 전역 레이어 클릭 상세를 «레이어+행키» 일치할 때만 닫기.
 * opened 토큰 목록으로 대상 서비스를 관리한다.
 * 관망: 소유 레이어 외 전역 상세 허용.
 * 시설·설비: 현재 직접 레이어 외(연관 포함) 전역 상세 허용.
 */
import type {
  IdentifyLayerResult,
  IdentifyPopupState,
} from '../../_mapComponents/hooks/useFeatureIdentify'
import {
  getWtlNetLayerDef,
  WTL_NET_LAYER_KEYS,
} from '../wtlAdmin/networkMap/wtlNetworkLayerCatalog'
import {
  getWtlNetMapSources,
  getWtlNetPhysicalTable,
} from '../wtlAdmin/networkMap/wtlNetworkMapSources'

export type LayerClickDetailMatchCloseDirectSlot = 'wtlFacility' | 'wtlEquipment'

/** 시설·설비 셸이 등록하는 현재 직접 레이어명(소문자) */
const directNamesBySlot = new Map<LayerClickDetailMatchCloseDirectSlot, Set<string>>()

/** 시설·설비 현재 직접 레이어명 등록(언마운트·탭 전환 시 갱신) */
export function setLayerClickDetailMatchCloseDirectNames(
  slot: LayerClickDetailMatchCloseDirectSlot,
  names: readonly string[] | null | undefined
): void {
  if (!names || names.length === 0) {
    directNamesBySlot.delete(slot)
    return
  }
  const next = new Set<string>()
  for (const raw of names) addName(next, raw)
  if (next.size === 0) {
    directNamesBySlot.delete(slot)
    return
  }
  directNamesBySlot.set(slot, next)
}

export function clearLayerClickDetailMatchCloseDirectNames(
  slot: LayerClickDetailMatchCloseDirectSlot
): void {
  directNamesBySlot.delete(slot)
}

export const LAYER_CLICK_DETAIL_CLOSE_ON_MATCH_OPENED = [
  'wtlNetworkMap',
  'wtlFacility',
  'wtlEquipment',
] as const

export type LayerClickDetailCloseOnMatchOpened =
  (typeof LAYER_CLICK_DETAIL_CLOSE_ON_MATCH_OPENED)[number]

export const LAYER_CLICK_DETAIL_MATCH_CLOSE_EVENT =
  'ggnr-layer-click-detail-match-close'

export type LayerClickDetailMatchClosePayload = {
  /** 표시명·물리명·fields 테이블 등 비교용 별칭 */
  tableNames: string[]
  /** define_field_is_key 값(없으면 ogc 폴백) — 정규화 문자열 */
  rowKey: string
  /** is_key 필드명(히트 data에서 동일 필드로 재추출할 때) */
  keyFieldName?: string | null
}

const MATCH_CLOSE_SET = new Set<string>(LAYER_CLICK_DETAIL_CLOSE_ON_MATCH_OPENED)

function normName(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase()
}

function addName(out: Set<string>, raw: string | null | undefined) {
  const n = normName(raw)
  if (n) out.add(n)
}

function collectNetworkOwnedNames(out: Set<string>) {
  for (const key of WTL_NET_LAYER_KEYS) {
    addName(out, key)
    const def = getWtlNetLayerDef(key)
    if (def) {
      addName(out, def.table)
      addName(out, def.defineTable)
    }
    addName(out, getWtlNetPhysicalTable(key))
    for (const src of getWtlNetMapSources()) {
      addName(out, getWtlNetPhysicalTable(key, src.id))
    }
  }
}

function addDirectSlotNames(
  out: Set<string>,
  slot: LayerClickDetailMatchCloseDirectSlot
) {
  const names = directNamesBySlot.get(slot)
  if (!names) return
  for (const n of names) out.add(n)
}

export function isLayerClickDetailCloseOnMatchOpened(
  openedTokens: readonly string[] | null | undefined
): boolean {
  const set = new Set(
    (openedTokens ?? []).map((t) => String(t ?? '').trim()).filter(Boolean)
  )
  return LAYER_CLICK_DETAIL_CLOSE_ON_MATCH_OPENED.some((k) => set.has(k))
}

/**
 * 키일치닫기 서비스가 전역 상세에서 제외할 레이어명.
 * 관망=소유 전체, 시설·설비=셸이 등록한 직접 레이어만.
 */
export function collectLayerClickDetailMatchCloseOwnedNames(
  openedTokens: readonly string[] | null | undefined
): Set<string> {
  const opened = new Set(
    (openedTokens ?? []).map((t) => String(t ?? '').trim()).filter(Boolean)
  )
  const out = new Set<string>()
  if (opened.has('wtlNetworkMap')) collectNetworkOwnedNames(out)
  if (opened.has('wtlFacility')) addDirectSlotNames(out, 'wtlFacility')
  if (opened.has('wtlEquipment')) addDirectSlotNames(out, 'wtlEquipment')
  return out
}

export function layerResultIsOwned(
  layer: IdentifyLayerResult,
  owned: Set<string>
): boolean {
  const names = [layer.tableName, layer.physicalTable].map(normName).filter(Boolean)
  return names.some((n) => owned.has(n))
}

export function isIdentifyTableOwned(
  tableName: string | null | undefined,
  physicalTable: string | null | undefined,
  owned: Set<string>
): boolean {
  const names = [tableName, physicalTable].map(normName).filter(Boolean)
  return names.some((n) => owned.has(n))
}

/** 소유 레이어 히트를 제외한 identify 결과. 남은 피처 없으면 null */
export function filterIdentifyPopupExcludingOwned(
  popup: IdentifyPopupState,
  owned: Set<string>
): IdentifyPopupState | null {
  if (owned.size === 0) return popup
  const results = (popup.results ?? []).filter(
    (r) => Array.isArray(r.features) && r.features.length > 0 && !layerResultIsOwned(r, owned)
  )
  if (results.length === 0) return null
  return {
    ...popup,
    results,
  }
}

export function requestCloseLayerClickDetailIfMatch(
  payload: LayerClickDetailMatchClosePayload
): void {
  if (typeof window === 'undefined') return
  const tableNames = (payload.tableNames ?? [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
  const rowKey = String(payload.rowKey ?? '').trim()
  if (tableNames.length === 0 || !rowKey) return
  window.dispatchEvent(
    new CustomEvent(LAYER_CLICK_DETAIL_MATCH_CLOSE_EVENT, {
      detail: {
        tableNames,
        rowKey,
        keyFieldName: payload.keyFieldName ?? null,
      } satisfies LayerClickDetailMatchClosePayload,
    })
  )
}

export function isMatchCloseOpenedToken(token: string): boolean {
  return MATCH_CLOSE_SET.has(String(token ?? '').trim())
}
