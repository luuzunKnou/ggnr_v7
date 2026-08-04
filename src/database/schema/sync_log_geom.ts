import { pgTable, serial, integer, varchar, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import { sl } from './sync_log';

/** PostGIS geometry — 실제 DDL은 geometry(Geometry, 5181) 권장. push 시 DB에 맞게 조정. */
const geometry5181 = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'geometry(Geometry, 5181)';
  },
});

/**
 * SHP 동기화 이력 도형 (sync_log JSON의 hash 메타와 분리).
 * layer 스키마 업로드 시 old/new 좌표를 여기에 저장. public_layer는 사용하지 않음.
 */
export const slg = pgTable('sync_log_geom', {
  slgKey: serial('slg_key').primaryKey().notNull(),
  slgSlKey: integer('slg_sl_key').notNull().references(() => sl.slKey, { onDelete: 'cascade' }),
  /** old | new */
  slgSide: varchar('slg_side', { length: 8 }).notNull(),
  slgGeom: geometry5181('slg_geom'),
}, (t) => [
  uniqueIndex('sync_log_geom_sl_side_uidx').on(t.slgSlKey, t.slgSide),
  index('sync_log_geom_sl_idx').on(t.slgSlKey),
]);

export const slgTableComment = '동기화 이력 도형 (전용 geometry)';

export const slgColumnComments: Record<string, string> = {
  slg_key: '이력 도형 키',
  slg_sl_key: '동기화 로그 키',
  slg_side: '쪽 (old/new)',
  slg_geom: '도형 (EPSG:5181)',
};

export type Slg = typeof slg.$inferSelect;
export type NewSlg = typeof slg.$inferInsert;
