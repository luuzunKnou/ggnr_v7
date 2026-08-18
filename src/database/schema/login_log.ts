import { pgTable, serial, varchar, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * 사용자 접속(로그인) 이력 (v6 login_log).
 */
export const loginLog = pgTable(
  'login_log',
  {
    llKey: serial('ll_key').primaryKey().notNull(),
    loginUser: varchar('login_user').notNull(),
    loginTime: timestamp('login_time', { mode: 'string' }).defaultNow(),
    loginIp: varchar('login_ip'),
  },
  (t) => [
    index('login_log_time_idx').on(t.loginTime),
    index('login_log_user_idx').on(t.loginUser),
  ]
);

export const loginLogTableComment = '사용자 접속(로그인) 이력';

export const loginLogColumnComments: Record<string, string> = {
  ll_key: '이력 키',
  login_user: '로그인 사용자 아이디',
  login_time: '로그인 시각',
  login_ip: '접속 IP',
};

export type LoginLog = typeof loginLog.$inferSelect;
export type NewLoginLog = typeof loginLog.$inferInsert;
