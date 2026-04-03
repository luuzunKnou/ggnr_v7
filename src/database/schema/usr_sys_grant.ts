import { pgTable, varchar, serial, uniqueIndex, text } from 'drizzle-orm/pg-core';
import { usr } from './usr';

export const usrSysGrant = pgTable(
  'usr_sys_grant',
  {
    usyKey: serial('usy_key').primaryKey().notNull(),
    usrId: varchar('usr_id')
      .references(() => usr.usrId, { onDelete: 'cascade' })
      .notNull(),
    /** DB serial 문자열 또는 systemList.config 의 sys_key */
    sysKey: text('sys_key').notNull(),
  },
  (t) => [uniqueIndex('usr_sys_grant_usr_sys_uq').on(t.usrId, t.sysKey)]
);

export const usrSysGrantTableComment = '사용자별 시스템 접근(개인 부여)';

export const usrSysGrantColumnComments: Record<string, string> = {
  usy_key: '키',
  usr_id: '사용자',
  sys_key: '시스템',
};

export type UsrSysGrant = typeof usrSysGrant.$inferSelect;
export type NewUsrSysGrant = typeof usrSysGrant.$inferInsert;
