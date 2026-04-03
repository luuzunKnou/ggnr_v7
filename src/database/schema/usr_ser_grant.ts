import { pgTable, varchar, serial, smallint, uniqueIndex } from 'drizzle-orm/pg-core';
import { usr } from './usr';

export const usrSerGrant = pgTable(
  'usr_ser_grant',
  {
    usgKey: serial('usg_key').primaryKey().notNull(),
    usrId: varchar('usr_id')
      .references(() => usr.usrId, { onDelete: 'cascade' })
      .notNull(),
    /** serviceList.config 의 ser_eng 와 맞출 수 있도록 ser 테이블 FK 없음 */
    serEng: varchar('ser_eng').notNull(),
    serpType: smallint('serp_type').notNull(),
  },
  (t) => [uniqueIndex('usr_ser_grant_usr_ser_uq').on(t.usrId, t.serEng)]
);

export const usrSerGrantTableComment = '사용자별 서비스 접근(개인 부여)';

export const usrSerGrantColumnComments: Record<string, string> = {
  usg_key: '키',
  usr_id: '사용자',
  ser_eng: '서비스',
  serp_type: '접근단계',
};

export type UsrSerGrant = typeof usrSerGrant.$inferSelect;
export type NewUsrSerGrant = typeof usrSerGrant.$inferInsert;
