/**
 * cons_alert_setting — 상·하수도 공사대장 알림설정 (layer 스키마)
 * 공사 하나당 설정 하나. 계정마다 따로 두지 않는다.
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { boolean, integer, pgSchema, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

const layer = pgSchema('layer')

export const consAlertSetting = layer.table(
  'cons_alert_setting',
  {
    id: serial('id').primaryKey().notNull(),
    kind: varchar('kind', { length: 8 }).notNull(),
    consCode: varchar('cons_code', { length: 64 }).notNull(),
    cycleYears: integer('cycle_years').notNull().default(1),
    doneBeforeDays: integer('done_before_days').notNull().default(30),
    doneBeforeOn: boolean('done_before_on').notNull().default(true),
    doneAfterDays: integer('done_after_days').notNull().default(7),
    doneAfterOn: boolean('done_after_on').notNull().default(false),
    startBeforeDays: integer('start_before_days').notNull().default(14),
    startBeforeOn: boolean('start_before_on').notNull().default(true),
    startAfterDays: integer('start_after_days').notNull().default(7),
    startAfterOn: boolean('start_after_on').notNull().default(false),
    updatedBy: varchar('updated_by', { length: 64 }).notNull().default(''),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('cons_alert_setting_kind_code_uidx').on(t.kind, t.consCode)]
)

export const consAlertSettingTableComment = '상하수도 공사대장 알림설정'

export const consAlertSettingColumnComments: Record<string, string> = {
  id: '키',
  kind: '공사 종류(wtl 상수도, swl 하수도)',
  cons_code: '공사코드',
  cycle_years: '준공 주기(년). 0이면 미사용',
  done_before_days: '준공 며칠 전',
  done_before_on: '준공 전 알림 사용',
  done_after_days: '준공 며칠 후',
  done_after_on: '준공 후 알림 사용',
  start_before_days: '착수 며칠 전',
  start_before_on: '착수 전 알림 사용',
  start_after_days: '착수 며칠 후',
  start_after_on: '착수 후 알림 사용',
  updated_by: '수정한 사용자',
  updated_at: '수정시각',
}
