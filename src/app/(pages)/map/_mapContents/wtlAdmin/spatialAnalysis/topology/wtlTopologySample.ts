/** 위상검증 타입 */

export type WtlTopoIssueKind = '접합확인필요' | '유수방향 확인필요'

export type WtlTopoIssueCode = 'orphan' | 'flow_meet' | 'flow_reverse'

/** 양방향 만남 목록 라벨 (상단 필터 세분화 없음) */
export type WtlTopoMeetSubtype =
  | 'head_on'
  | 'multi_merge'
  | 'one_flip'
  | 'dead_end'
  | 'split'

/** 방향 판정 근거 */
export type WtlTopoBasis = 'main' | 'meter' | 'continuity' | 'facility' | 'unknown'

export type WtlTopoIssue = {
  id: string
  kind: WtlTopoIssueKind
  code: WtlTopoIssueCode
  target: string
  detail: string
  point: [number, number]
  line?: [number, number][]
  /** 수정용 메타 */
  table?: string
  ogcFid?: number
  geomKind?: 'point' | 'line'
  meetSubtype?: WtlTopoMeetSubtype
  meetSubtypeLabel?: string
  basis?: WtlTopoBasis
  relatedPipes?: WtlTopoRelatedPipe[]
}

export type WtlTopoRelatedPipe = {
  table: string
  ogcFid: number
  recommended?: boolean
}

export type WtlTopoMeetPipeLine = {
  table: string
  ogcFid: number
  /** 관리번호(ftr_idn) — 표시용 */
  ftrIdn?: string | null
  line: [number, number][]
  recommended?: boolean
  /** 실제 관로 스타일(GeoServer, saa_cde별) 선 색 */
  color?: string
}

export function wtlTopoPipeKey(table: string, ogcFid: number) {
  return `${table}:${ogcFid}`
}

export type WtlTopoResult = {
  at: string
  issues: WtlTopoIssue[]
  counts: {
    orphan: number
    flowMeet: number
    flowReverse: number
    total: number
  }
}

export type WtlTopoChangeAction =
  | 'flow_reverse'
  | 'geom_edit'
  | 'feature_add'
  | 'data_request'

export type WtlTopoChangeRequest = {
  id: string
  at: string
  action: WtlTopoChangeAction
  actionLabel: string
  issueId: string
  issueTarget: string
  memo: string
  files: { name: string; size: number; dataUrl?: string }[]
  applyMode: 'immediate' | 'request'
  status: '요청' | '즉시반영' | '실패'
  /** 요청·반영 계정(로그인 세션 id) */
  requestUser: string
  /** 표시명(이름 없으면 계정) */
  requestUserName: string
  message?: string
}

export const WTL_TOPO_KIND_FILTERS = ['전체', '접합확인필요', '유수방향 확인필요'] as const
export type WtlTopoKindFilter = (typeof WTL_TOPO_KIND_FILTERS)[number]

export const WTL_TOPO_ACTION_LABEL: Record<WtlTopoChangeAction, string> = {
  flow_reverse: '유수방향 반전',
  geom_edit: '도형 수정',
  feature_add: '관로·시설 추가',
  data_request: '데이터 수정요청',
}

/** 서버에서 색을 못 읽었을 때 쓰는 기본 선 색 */
export const WTL_TOPO_PIPE_DEFAULT_COLOR = '#dc2626'

/** 목록·지도 라벨 공통 이름 (예: 급수관 #ogc_fid). ftr_idn은 중복이 많아 쓰지 않음 */
export function wtlTopoPipeName(table: string, ogcFid: number): string {
  return `${table === 'wtl_sply_ls' ? '급수관' : '관로'} #${ogcFid}`
}

/** 관로 추가 시 고를 수 있는 종류 (지도 스타일이 테이블·용도코드로 갈린다) */
export const WTL_TOPO_ADD_PIPE_KINDS = [
  { id: 'saa004', label: '배수관', table: 'wtl_pipe_lm', saaCde: 'SAA004' },
  { id: 'saa003', label: '송수관', table: 'wtl_pipe_lm', saaCde: 'SAA003' },
  { id: 'sply', label: '급수관', table: 'wtl_sply_ls', saaCde: undefined },
  { id: 'etc', label: '기타 상수관', table: 'wtl_pipe_lm', saaCde: 'SAA999' },
] as const
export type WtlTopoAddPipeKindId = (typeof WTL_TOPO_ADD_PIPE_KINDS)[number]['id']

/** 시설 추가 시 고를 수 있는 종류 (테이블 + 지형지물부호) */
export const WTL_TOPO_ADD_FACILITY_KINDS = [
  { id: 'sa200', label: '제수변', table: 'wtl_valv_ps', ftrCde: 'SA200' },
  { id: 'sa202', label: '이토변', table: 'wtl_valv_ps', ftrCde: 'SA202' },
  { id: 'sa203', label: '배기변', table: 'wtl_valv_ps', ftrCde: 'SA203' },
  { id: 'sa204', label: '감압변', table: 'wtl_valv_ps', ftrCde: 'SA204' },
  { id: 'flow', label: '유량계', table: 'wtl_flow_ps', ftrCde: 'SA117' },
  { id: 'meta', label: '계량기', table: 'wtl_meta_ps', ftrCde: 'SA122' },
  { id: 'serv', label: '배수지', table: 'wtl_serv_ps', ftrCde: 'SA114' },
] as const
export type WtlTopoAddFacilityKindId = (typeof WTL_TOPO_ADD_FACILITY_KINDS)[number]['id']

/** 지도 도구모음으로 고른 편집 대상(관로·시설) — 오류 없이도 편집할 수 있다 */
export type WtlTopoEditTarget = {
  table: string
  ogcFid: number
  label: string
  geomKind: 'line' | 'point'
  line?: [number, number][]
  point?: [number, number]
  color?: string
}
