/**
 * 공간분석(누수·단수) 실행 이력 헤더 (layer 스키마)
 * «분석결과저장» 한 건. 이력은 전체 사용자 공유.
 * 송수경로는 조회·재생만 하므로 이력에 넣지 않는다.
 * 위상검증 오류 목록은 저장하지 않는다(탭 진입 시 재계산). 위상 수정요청은 wtl_topo_request.
 * 단수 사유·기간·문자 초안은 param_json에 둔다(reason, startAt, endAt, smsTitle, smsBody).
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const wtlAnalysisHistory = layer.table(
  'wtl_analysis_history',
  {
    historyId: serial('history_id').primaryKey().notNull(),
    feature: text('feature').notNull(),
    title: text('title'),
    /** 누수 결과에서 단수분석으로 전환한 경우 원본 이력 */
    srcHistoryId: integer('src_history_id'),
    status: text('status').notNull(),
    paramJson: jsonb('param_json').$type<Record<string, unknown>>(),
    inputLon: doublePrecision('input_lon'),
    inputLat: doublePrecision('input_lat'),
    gateCnt: integer('gate_cnt').notNull().default(0),
    pipeCnt: integer('pipe_cnt').notNull().default(0),
    parcelCnt: integer('parcel_cnt').notNull().default(0),
    addressCnt: integer('address_cnt').notNull().default(0),
    customerCnt: integer('customer_cnt').notNull().default(0),
    pipeLenM: doublePrecision('pipe_len_m'),
    truncatedYn: boolean('truncated_yn').notNull().default(false),
    editedYn: boolean('edited_yn').notNull().default(false),
    ruleSnapshot: jsonb('rule_snapshot').$type<Record<string, unknown>>(),
    elapsedMs: integer('elapsed_ms'),
    errorMsg: text('error_msg'),
    memo: text('memo'),
    createUser: text('create_user'),
    createDate: timestamp('create_date', { withTimezone: true }).notNull().defaultNow(),
    deleteYn: boolean('delete_yn').notNull().default(false),
  },
  (t) => [
    index('wtl_analysis_history_feature_date_idx').on(t.feature, t.createDate),
    index('wtl_analysis_history_user_date_idx').on(t.createUser, t.createDate),
    index('wtl_analysis_history_src_idx').on(t.srcHistoryId),
  ]
);

export const wtlAnalysisHistoryTableComment = '상수도 공간분석 이력';

export const wtlAnalysisHistoryColumnComments: Record<string, string> = {
  history_id: '키',
  feature: '누수, 단수',
  title: '이력 이름',
  src_history_id: '전환 원본 이력(누수 → 단수). 없으면 직접 실행',
  status:
    '누수: 완료, 실패. 단수: 분석완료, 설정완료, 문자발송 완료, 단수중, 종료(또는 실패)',
  param_json:
    '입력 조건·단수 업무칸(스냅 좌표, 제수변 id, 버퍼, reason, startAt, endAt, smsTitle, smsBody 등)',
  input_lon: '대표 입력 경도',
  input_lat: '대표 입력 위도',
  gate_cnt: '제수변 수',
  pipe_cnt: '관로 수',
  parcel_cnt: '필지 수',
  address_cnt: '주소 수',
  customer_cnt: '수용가 수',
  pipe_len_m: '관로 연장 합계(m)',
  truncated_yn: '탐색 한도로 결과 일부 누락 여부',
  edited_yn: '사용자 수정 여부(도형편집·결과 수정요청 반영 등)',
  rule_snapshot: '당시 탐색 기준(wtl_trace_criterion 스냅샷)',
  elapsed_ms: '수행 시간(ms)',
  error_msg: '실패 사유',
  memo: '메모',
  create_user: '저장 계정',
  create_date: '저장 시각',
  delete_yn: '삭제 여부',
};
