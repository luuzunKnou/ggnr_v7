import { pgTable, serial, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

/** draft: 작성 중 · submitted: 제출 완료 */
export const SF_STATUS_DRAFT = 'draft';
export const SF_STATUS_SUBMITTED = 'submitted';

export const systemFeedback = pgTable('system_feedback', {
  sfKey: serial('sf_key').primaryKey().notNull(),
  usrId: varchar('usr_id').notNull(),
  usrName: varchar('usr_name').notNull(),
  systemKey: varchar('system_key'),
  serviceEng: varchar('service_eng'),
  serviceKor: varchar('service_kor'),
  contentHtml: text('content_html'),
  status: varchar('status').notNull().default(SF_STATUS_DRAFT),
  gnmsSent: boolean('gnms_sent').notNull().default(false),
  gnmsSentAt: timestamp('gnms_sent_at', { mode: 'string' }),
  gnmsError: text('gnms_error'),
  sfIsDel: boolean('sf_is_del').notNull().default(false),
  sfCreateDate: timestamp('sf_create_date', { mode: 'string' }),
  sfCreateUser: varchar('sf_create_user'),
  sfUpdateDate: timestamp('sf_update_date', { mode: 'string' }),
  sfUpdateUser: varchar('sf_update_user'),
});

export const systemFeedbackTableComment = '시스템 불편신고';

export const systemFeedbackColumnComments: Record<string, string> = {
  sf_key: '불편신고키',
  usr_id: '작성자아이디',
  usr_name: '작성자명',
  system_key: '시스템키',
  service_eng: '기능영문명(선택없음 null)',
  service_kor: '기능한글명',
  content_html: '내용HTML',
  status: '상태(draft|submitted)',
  gnms_sent: 'GNMS전송여부',
  gnms_sent_at: 'GNMS전송일시',
  gnms_error: 'GNMS전송오류',
  sf_is_del: '삭제여부',
  sf_create_date: '등록일시',
  sf_create_user: '등록자',
  sf_update_date: '수정일시',
  sf_update_user: '수정자',
};

export type SystemFeedback = typeof systemFeedback.$inferSelect;
export type NewSystemFeedback = typeof systemFeedback.$inferInsert;
