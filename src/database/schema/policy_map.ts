/**
 * policy_map — 정책지도 바로가기(HTML 묶음)
 */
import { pgTable, serial, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const policyMap = pgTable('policy_map', {
  pmKey: serial('pm_key').primaryKey().notNull(),
  pmTitle: varchar('pm_title').notNull(),
  /** 사이트 루트 기준 진입 파일 (예: index.html) */
  pmEntry: varchar('pm_entry').notNull().default('index.html'),
  pmIsDel: boolean('pm_is_del').notNull().default(false),
  pmCreateDate: timestamp('pm_create_date', { mode: 'string' }),
  pmCreateUser: varchar('pm_create_user'),
  pmUpdateDate: timestamp('pm_update_date', { mode: 'string' }),
  pmUpdateUser: varchar('pm_update_user'),
});

export const policyMapTableComment = '정책지도 바로가기';

export const policyMapColumnComments: Record<string, string> = {
  pm_key: '바로가기 키',
  pm_title: '제목',
  pm_entry: '진입 HTML',
  pm_is_del: '삭제여부',
  pm_create_date: '등록일시',
  pm_create_user: '등록자',
  pm_update_date: '수정일시',
  pm_update_user: '수정자',
};

export type PolicyMap = typeof policyMap.$inferSelect;
export type NewPolicyMap = typeof policyMap.$inferInsert;
