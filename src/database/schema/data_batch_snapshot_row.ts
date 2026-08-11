import {
  pgTable,
  serial,
  integer,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { dbs } from './data_batch_snapshot';

const geometry5181 = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'geometry(Geometry, 5181)';
  },
});

/**
 * 회차 스냅샷 행 — 속성(JSONB, geom 제외) + 도형 전용 컬럼.
 */
export const dbsr = pgTable(
  'data_batch_snapshot_row',
  {
    dbsrKey: serial('dbsr_key').primaryKey().notNull(),
    dbsrDbsKey: integer('dbsr_dbs_key')
      .notNull()
      .references(() => dbs.dbsKey, { onDelete: 'cascade' }),
    dbsrKeyValue: varchar('dbsr_key_value').notNull(),
    /** 속성 JSON (geom 키 제외) */
    dbsrData: jsonb('dbsr_data').$type<Record<string, unknown>>(),
    dbsrGeom: geometry5181('dbsr_geom'),
  },
  (t) => [
    uniqueIndex('data_batch_snapshot_row_dbs_key_uidx').on(t.dbsrDbsKey, t.dbsrKeyValue),
    index('data_batch_snapshot_row_dbs_idx').on(t.dbsrDbsKey),
  ]
);

export const dbsrTableComment = '회차 테이블 스냅샷 행';

export const dbsrColumnComments: Record<string, string> = {
  dbsr_key: '스냅샷 행 키',
  dbsr_dbs_key: '스냅샷 헤더 키',
  dbsr_key_value: '행 키 값',
  dbsr_data: '속성 JSON(도형 제외)',
  dbsr_geom: '도형 (EPSG:5181)',
};

export type Dbsr = typeof dbsr.$inferSelect;
export type NewDbsr = typeof dbsr.$inferInsert;
