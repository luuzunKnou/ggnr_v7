/**
 * 공간분석 탭이 지도에 켜 주는 레이어 — 지하시설물 범례 없이도 속성조회(identify) 대상에 합침.
 * 표시용 WMS와 맞추되, 상수관은 분할 키도 넣어 범례·상세와 동일하게 잡히게 한다.
 */
import type { WtlSpatialTab } from './wtlSpatialSample'

/** 단수·누수 공통 — 상수관(분할+부모)·급수관·제수변 */
const PIPE_VALVE_TABLES = [
  'wtl_pipe_lm',
  'wtl_pipe_lm_etc',
  'wtl_pipe_lm_saa004',
  'wtl_pipe_lm_saa003',
  'wtl_sply_ls',
  'wtl_valv_ps',
] as const

/** 위상검증 배경과 동일 */
const TOPO_TABLES = [
  'wtl_pipe_lm_etc',
  'wtl_pipe_lm_saa004',
  'wtl_pipe_lm_saa003',
  'wtl_sply_ls',
  'wtl_serv_ps',
  'wtl_puri_as',
  'wtl_valv_ps',
  'wtl_flow_ps',
  'wtl_meta_ps',
] as const

/** 송수경로 시설 WMS */
const SUPPLY_TABLES = ['wtl_puri_as', 'wtl_serv_ps'] as const

export const WTL_SPATIAL_IDENTIFY_TABLES_BY_TAB: Record<WtlSpatialTab, readonly string[]> = {
  단수구역: [...PIPE_VALVE_TABLES, 'wtl_meta_ps'],
  누수분석: [...PIPE_VALVE_TABLES],
  송수경로: [...SUPPLY_TABLES],
  위상검증: [...TOPO_TABLES],
}

export function spatialIdentifyTablesForTab(tab: WtlSpatialTab | null | undefined): string[] {
  if (!tab) return []
  return [...(WTL_SPATIAL_IDENTIFY_TABLES_BY_TAB[tab] ?? [])]
}
