import { pgTable, serial, varchar, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';

export const notice = pgTable('notice', {
  noticeKey: serial('notice_key').primaryKey().notNull(),
  noticeTitle: varchar('notice_title').notNull(),
  noticeContents: text('notice_contents'),
  /** 접속 시 팝업 노출 여부 */
  noticeIsActive: boolean('notice_is_active').notNull().default(false),
  noticeStartDate: timestamp('notice_start_date', { mode: 'string' }),
  noticeEndDate: timestamp('notice_end_date', { mode: 'string' }),
  noticeIsDel: boolean('notice_is_del').notNull().default(false),
  noticeViewCnt: integer('notice_view_cnt').notNull().default(0),
  noticeCreateDate: timestamp('notice_create_date', { mode: 'string' }),
  noticeCreateUser: varchar('notice_create_user'),
  noticeUpdateDate: timestamp('notice_update_date', { mode: 'string' }),
  noticeUpdateUser: varchar('notice_update_user'),
});

export const noticeTableComment = '공지사항';

export const noticeColumnComments: Record<string, string> = {
  notice_key: '공지키',
  notice_title: '제목',
  notice_contents: '내용',
  notice_is_active: '공지여부',
  notice_start_date: '공지시작일',
  notice_end_date: '공지종료일',
  notice_is_del: '삭제여부',
  notice_view_cnt: '조회수',
  notice_create_date: '등록일시',
  notice_create_user: '등록자',
  notice_update_date: '수정일시',
  notice_update_user: '수정자',
};

export type Notice = typeof notice.$inferSelect;
export type NewNotice = typeof notice.$inferInsert;
