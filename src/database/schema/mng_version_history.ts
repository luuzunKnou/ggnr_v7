import { pgTable, serial, varchar, text, timestamp } from 'drizzle-orm/pg-core';

/** 버전관리·소스 업로드 공통 이력 */
export const mvh = pgTable('mng_version_history', {
  mvhKey: serial('mvh_key').primaryKey().notNull(),
  /** source_upload | install_zip | apply_latest */
  mvhHistoryType: varchar('mvh_history_type', { length: 40 }).notNull(),
  /** success | fail */
  mvhStatus: varchar('mvh_status', { length: 20 }).notNull(),
  mvhMessage: text('mvh_message'),
  mvhIp: varchar('mvh_ip', { length: 64 }),
  /** 접속 주소·호스트 요약 */
  mvhClientHost: varchar('mvh_client_host', { length: 500 }),
  mvhCreateDate: timestamp('mvh_create_date'),
});

export const mvhTableComment = '버전관리·소스 업로드 공통 이력';

export const mvhColumnComments: Record<string, string> = {
  mvh_key: '이력 키',
  mvh_history_type: '기능 구분',
  mvh_status: '성공 여부',
  mvh_message: '메시지',
  mvh_ip: 'IP',
  mvh_client_host: '접속 주소',
  mvh_create_date: '생성 일시',
};

export type Mvh = typeof mvh.$inferSelect;
export type NewMvh = typeof mvh.$inferInsert;
