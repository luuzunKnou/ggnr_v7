import { pgTable, serial, varchar, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * 회차(batch) 단위 테이블 전체 스냅샷 헤더.
 * batchKey: excel:{ehKey} | shp:dh:{dhKey}
 */
export const dbs = pgTable(
  'data_batch_snapshot',
  {
    dbsKey: serial('dbs_key').primaryKey().notNull(),
    dbsBatchKey: varchar('dbs_batch_key').notNull(),
    dbsTableName: varchar('dbs_table_name').notNull(),
    dbsTableKorName: varchar('dbs_table_kor_name'),
    dbsGroup: varchar('dbs_group'),
    dbsKeyField: varchar('dbs_key_field').notNull(),
    dbsRowCount: integer('dbs_row_count').default(0),
    dbsSource: varchar('dbs_source'),
    dbsUser: varchar('dbs_user'),
    dbsDate: timestamp('dbs_date').defaultNow(),
  },
  (t) => [
    uniqueIndex('data_batch_snapshot_batch_uidx').on(t.dbsBatchKey),
    index('data_batch_snapshot_table_idx').on(t.dbsTableName),
    index('data_batch_snapshot_date_idx').on(t.dbsDate),
  ]
);

export const dbsTableComment = '회차 테이블 스냅샷 헤더';

export const dbsColumnComments: Record<string, string> = {
  dbs_key: '스냅샷 키',
  dbs_batch_key: '회차 묶음 키',
  dbs_table_name: '테이블 영문명',
  dbs_table_kor_name: '테이블 한글명',
  dbs_group: '그룹',
  dbs_key_field: '키 필드명',
  dbs_row_count: '스냅샷 행 수',
  dbs_source: '출처',
  dbs_user: '작업자',
  dbs_date: '저장 일시',
};

export type Dbs = typeof dbs.$inferSelect;
export type NewDbs = typeof dbs.$inferInsert;
