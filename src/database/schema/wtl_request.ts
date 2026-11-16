/**
 * 단수·누수 탐색 수정요청 (layer 스키마)
 * 연결·제수변절단 케이스. 실행은 su만. 위상 수정요청(wtl_topo_request)과 분리.
 * 송수경로는 이력·탐색요청 대상이 아니다.
 */
import { doublePrecision, integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const wtlRequest = layer.table('wtl_request', {
  requestId: serial('request_id').primaryKey().notNull(),
  feature: text('feature').notNull(),
  status: text('status').notNull(),
  memo: text('memo'),
  /** 어떤 분석 이력에서 낸 요청인지(없으면 비움) */
  historyId: integer('history_id'),
  originX: doublePrecision('origin_x'),
  originY: doublePrecision('origin_y'),
  originKey: text('origin_key'),
  requestUser: text('request_user'),
  requestDate: timestamp('request_date', { withTimezone: true }).notNull(),
  executeUser: text('execute_user'),
  executeDate: timestamp('execute_date', { withTimezone: true }),
});

export const wtlRequestTableComment = '상수도 탐색 수정요청';

export const wtlRequestColumnComments: Record<string, string> = {
  request_id: '키',
  feature: '단수, 누수',
  status: '요청, 반영, 규칙',
  memo: '메모',
  history_id: '공간분석 이력(wtl_analysis_history). 없으면 비움',
  origin_x: '재현용 원점 X(레이어 좌표)',
  origin_y: '재현용 원점 Y(레이어 좌표)',
  origin_key: '재현용 키(제수변 id 목록 등)',
  request_user: '요청 계정',
  request_date: '요청 시각',
  execute_user: '실행 계정',
  execute_date: '실행 시각',
};
