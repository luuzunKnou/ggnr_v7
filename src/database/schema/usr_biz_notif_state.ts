import { bigserial, boolean, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

/** 계정별 업무 알림 읽음·지우기 상태 */
export const usrBizNotifState = pgTable(
  'usr_biz_notif_state',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    usrId: varchar('usr_id').notNull(),
    /** 예: usage-expiry:{cons_code}, occup-expiry:{prefix}:{id}, use-fee-due:{prefix}:{id} */
    notifKey: varchar('notif_key').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    isDismissed: boolean('is_dismissed').notNull().default(false),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [
    // drizzle-kit introspect 순서(notif_key, usr_id)와 맞추지 않으면 기동마다 unique 재추가 확인이 뜸
    unique('usr_biz_notif_state_usr_key').on(t.notifKey, t.usrId),
  ]
);

export const usrBizNotifStateTableComment = '업무 알림 읽음·지우기 상태';

export const usrBizNotifStateColumnComments: Record<string, string> = {
  id: 'id',
  usr_id: '사용자 아이디',
  notif_key: '알림 키',
  is_read: '읽음 여부',
  is_dismissed: '지우기 여부',
  updated_at: '수정시각',
};

export type UsrBizNotifState = typeof usrBizNotifState.$inferSelect;
export type NewUsrBizNotifState = typeof usrBizNotifState.$inferInsert;
