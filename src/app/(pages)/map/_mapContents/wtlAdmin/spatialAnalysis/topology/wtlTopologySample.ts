/** 위상검증 타입 */

export type WtlTopoIssueKind = '접합확인필요' | '유수방향 확인필요'

export type WtlTopoIssueCode = 'orphan' | 'flow_meet' | 'flow_reverse'

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
