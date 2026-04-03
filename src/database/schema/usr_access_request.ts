import { pgTable, varchar, integer, serial, smallint, timestamp, text } from 'drizzle-orm/pg-core';
import { usr } from './usr';

export const ACCESS_REQ_PENDING = 'pending';
export const ACCESS_REQ_APPROVED = 'approved';
export const ACCESS_REQ_REJECTED = 'rejected';

export const TARGET_SER = 'ser';
export const TARGET_SYS = 'sys';

export const usrAccessRequest = pgTable('usr_access_request', {
  uarKey: serial('uar_key').primaryKey().notNull(),
  usrId: varchar('usr_id')
    .references(() => usr.usrId, { onDelete: 'cascade' })
    .notNull(),
  targetType: varchar('target_type').notNull(),
  /** serviceList.config 의 ser_eng 와 맞춤 — ser 테이블 FK 없음 */
  serEng: varchar('ser_eng'),
  /** DB serial 문자열 또는 systemList.config 의 sys_key */
  sysKey: text('sys_key'),
  requestedSerpType: smallint('requested_serp_type'),
  state: varchar('state').notNull().default(ACCESS_REQ_PENDING),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  processedAt: timestamp('processed_at', { mode: 'string' }),
  processedBy: varchar('processed_by'),
  rejectReason: varchar('reject_reason'),
  /** 신청자가 입력한 사유 */
  requestReason: text('request_reason'),
});

export const usrAccessRequestTableComment = '권한 신청';

export const usrAccessRequestColumnComments: Record<string, string> = {
  uar_key: '키',
  usr_id: '신청자',
  target_type: '대상종류 ser|sys',
  ser_eng: '서비스',
  sys_key: '시스템',
  requested_serp_type: '요청단계',
  state: '상태',
  created_at: '신청일시',
  processed_at: '처리일시',
  processed_by: '처리자',
  reject_reason: '반려사유',
  request_reason: '신청사유',
};

export type UsrAccessRequest = typeof usrAccessRequest.$inferSelect;
export type NewUsrAccessRequest = typeof usrAccessRequest.$inferInsert;
