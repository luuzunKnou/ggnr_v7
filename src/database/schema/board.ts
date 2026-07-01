import { pgTable, serial, varchar, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';

export const board = pgTable('board', {
  boardKey: serial('board_key').primaryKey().notNull(),
  boardTitle: varchar('board_title').notNull(),
  boardContents: text('board_contents'),
  boardIsDel: boolean('board_is_del').notNull().default(false),
  boardViewCnt: integer('board_view_cnt').notNull().default(0),
  boardCreateDate: timestamp('board_create_date', { mode: 'string' }),
  boardCreateUser: varchar('board_create_user'),
  boardUpdateDate: timestamp('board_update_date', { mode: 'string' }),
  boardUpdateUser: varchar('board_update_user'),
});

export const boardTableComment = '자료실';

export const boardColumnComments: Record<string, string> = {
  board_key: '게시키',
  board_title: '제목',
  board_contents: '내용',
  board_is_del: '삭제여부',
  board_view_cnt: '조회수',
  board_create_date: '등록일시',
  board_create_user: '등록자',
  board_update_date: '수정일시',
  board_update_user: '수정자',
};

export type Board = typeof board.$inferSelect;
export type NewBoard = typeof board.$inferInsert;
