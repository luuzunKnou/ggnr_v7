/**
 * 위상검증 수정요청 헤더 (layer 스키마)
 * 일반 사용자가 요청(요청) → su·admin이 승인(반영) 또는 반려(반려).
 * su·admin의 즉시수정도 같은 테이블에 «반영»으로 남겨 이력을 한곳에 모은다.
 * 반영할 때 직전 도형을 저장해 두고(wtl_topo_request_geom.applied_before), su·admin이 되돌릴 수 있다(되돌림).
 * 탐색 케이스 수정요청(wtl_request)과는 저장 내용·상태 흐름·권한이 달라 분리한다.
 */
import { boolean, index, jsonb, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const wtlTopoRequest = layer.table(
  'wtl_topo_request',
  {
    requestId: serial('request_id').primaryKey().notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(),
    applyMode: text('apply_mode').notNull(),
    /** 요청 계기가 된 위상검증 오류 (지도에서 직접 편집하면 없음) */
    issueId: text('issue_id'),
    issueCode: text('issue_code'),
    targetLabel: text('target_label'),
    memo: text('memo'),
    paramJson: jsonb('param_json').$type<Record<string, unknown>>(),
    requestUser: text('request_user').notNull(),
    requestDate: timestamp('request_date', { withTimezone: true }).notNull().defaultNow(),
    reviewUser: text('review_user'),
    reviewDate: timestamp('review_date', { withTimezone: true }),
    reviewMemo: text('review_memo'),
    errorMsg: text('error_msg'),
    /** 반영 실제 시각 — 승인(review)과 별도로, 반영이 끝난 시점 */
    applyDate: timestamp('apply_date', { withTimezone: true }),
    revertUser: text('revert_user'),
    revertDate: timestamp('revert_date', { withTimezone: true }),
    revertMemo: text('revert_memo'),
    deleteYn: boolean('delete_yn').notNull().default(false),
  },
  (t) => [
    index('wtl_topo_request_status_date_idx').on(t.status, t.requestDate),
    index('wtl_topo_request_user_date_idx').on(t.requestUser, t.requestDate),
  ]
);

export const wtlTopoRequestTableComment = '상수도 위상검증 수정요청';

export const wtlTopoRequestColumnComments: Record<string, string> = {
  request_id: '키',
  action: 'flow_reverse(유수방향 반전), geom_edit(도형 수정), feature_add(관로·시설 추가), data_request(데이터 수정요청)',
  status: '요청, 반영, 반려, 취소, 실패, 되돌림',
  apply_mode: 'request(승인 후 반영), immediate(su·admin 즉시반영)',
  issue_id: '위상검증 오류 id(지도에서 직접 편집하면 없음)',
  issue_code: 'orphan, flow_meet, flow_reverse',
  target_label: '대상 표시명(관로 #123, 관로 추가 등)',
  memo: '요청 사유·현장 메모',
  param_json: '작업 조건(관로 종류, 방향 반전 여부, 시설 종류 등)',
  request_user: '요청 계정',
  request_date: '요청 시각',
  review_user: '승인·반려 계정',
  review_date: '승인·반려 시각',
  review_memo: '승인 의견·반려 사유',
  error_msg: '반영·되돌리기 실패 사유',
  apply_date: '실제 반영 시각',
  revert_user: '되돌린 계정',
  revert_date: '되돌린 시각',
  revert_memo: '되돌린 사유',
  delete_yn: '삭제 여부',
};
