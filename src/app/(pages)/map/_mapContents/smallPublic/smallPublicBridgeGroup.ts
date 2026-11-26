/**
 * 소교량 리 묶음 — 정비계획은 위험 소교량을 리 단위로 묶어 한 건으로 다룬다.
 * 묶음 관리번호(예: 고성리_소교량_통합)는 layer.spf_bridge_group 과 spf_plan_fac.cons_code 에 같은 값으로 쓴다.
 * 리는 시설명 앞부분(고성리_소교량_001 → 고성리)으로 정한다(DB ri 열 오기 방지).
 */
export const BRIDGE_GROUP_SUFFIX = '_소교량_통합'

/** 이관 목록에서 묶음 줄을 구분하는 행 id 접두 */
export const BRIDGE_GROUP_ROW_PREFIX = 'bridge-group:'

export function bridgeRiOfName(name: string): string {
  return String(name ?? '').split('_')[0]?.trim() ?? ''
}

export function bridgeGroupCodeOfRi(ri: string): string {
  return `${ri}${BRIDGE_GROUP_SUFFIX}`
}

/** 소교량 시설명 → 묶음 관리번호 */
export function bridgeGroupCodeOfName(name: string): string {
  return bridgeGroupCodeOfRi(bridgeRiOfName(name))
}

/** 묶음 관리번호 → 리 */
export function bridgeRiOfGroupCode(groupCode: string): string {
  return groupCode.endsWith(BRIDGE_GROUP_SUFFIX) ? groupCode.slice(0, -BRIDGE_GROUP_SUFFIX.length) : groupCode
}

export function bridgeGroupRowId(groupCode: string): string {
  return `${BRIDGE_GROUP_ROW_PREFIX}${groupCode}`
}

export function groupCodeOfRowId(rowId: string): string | null {
  return rowId.startsWith(BRIDGE_GROUP_ROW_PREFIX) ? rowId.slice(BRIDGE_GROUP_ROW_PREFIX.length) : null
}
