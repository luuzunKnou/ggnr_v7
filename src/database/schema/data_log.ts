import { pgTable, serial, varchar, integer, timestamp, text, index } from 'drizzle-orm/pg-core';

/**
 * 통합 데이터 로그 (v6 data_log).
 * 시스템·SHP·Excel 행 변경의 목록·되돌리기 헤더.
 */
export const dl = pgTable(
  'data_log',
  {
    dlKey: serial('dl_key').primaryKey().notNull(),
    /** 서비스/기능 키 (없으면 null) */
    dlServiceKey: integer('dl_service_key'),
    /** 목록 내용 — 보통 «키한글 | 키값» */
    dlContents: varchar('dl_contents'),
    /** 작업분류: 추가·수정·삭제·되돌리기·조회·저장 */
    dlType: varchar('dl_type'),
    /** 작업자 — usrId(usrName) 또는 표시 문자열 */
    dlUser: varchar('dl_user'),
    /** 구분·서비스 표시명 (예: 그룹-한글레이어, SHP 업로드) */
    dlServiceName: varchar('dl_service_name'),
    dlDate: timestamp('dl_date').defaultNow(),
    /** 키 필드명(영문, 복합키면 콤마) */
    dlKeyField: varchar('dl_key_field'),
    /** 키 값 */
    dlKeyValue: varchar('dl_key_value'),
    /** 실제 테이블 영문명 */
    dlTableName: varchar('dl_table_name'),
    /** 테이블 한글명 */
    dlTableKorName: varchar('dl_table_kor_name'),
    /** 그룹명 */
    dlGroup: varchar('dl_group'),
    /** 출처: 시스템 | SHP 업로드 | Excel 업로드 */
    dlSource: varchar('dl_source'),
    /** 업로드·정합성 회차 묶음 키 */
    dlBatchKey: varchar('dl_batch_key'),
  },
  (t) => [
    index('data_log_table_key_idx').on(t.dlTableName, t.dlKeyValue),
    index('data_log_date_idx').on(t.dlDate),
    index('data_log_source_idx').on(t.dlSource),
    index('data_log_batch_idx').on(t.dlBatchKey),
  ]
);

export const dlTableComment = '통합 데이터 로그';

export const dlColumnComments: Record<string, string> = {
  dl_key: '데이터 로그 키',
  dl_service_key: '서비스 키',
  dl_contents: '내용(키한글|키값 등)',
  dl_type: '작업분류',
  dl_user: '작업자',
  dl_service_name: '구분·서비스 표시명',
  dl_date: '작업 일시',
  dl_key_field: '키 필드명',
  dl_key_value: '키 값',
  dl_table_name: '테이블 영문명',
  dl_table_kor_name: '테이블 한글명',
  dl_group: '그룹',
  dl_source: '출처(시스템|SHP 업로드|Excel 업로드)',
  dl_batch_key: '작업묶음 키',
};

export type Dl = typeof dl.$inferSelect;
export type NewDl = typeof dl.$inferInsert;
