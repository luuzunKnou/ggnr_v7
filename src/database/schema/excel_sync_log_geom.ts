import { pgTable, serial, integer, varchar, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import { esl } from './excel_sync_log';

const geometry5181 = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'geometry(Geometry, 5181)';
  },
});

/**
 * Excel 동기화 이력 도형.
 * Excel은 항상 layer 스키마 → full geom 저장.
 */
export const eslg = pgTable('excel_sync_log_geom', {
  eslgKey: serial('eslg_key').primaryKey().notNull(),
  eslgEslKey: integer('eslg_esl_key').notNull().references(() => esl.eslKey, { onDelete: 'cascade' }),
  /** old | new */
  eslgSide: varchar('eslg_side', { length: 8 }).notNull(),
  eslgGeom: geometry5181('eslg_geom'),
}, (t) => [
  uniqueIndex('excel_sync_log_geom_esl_side_uidx').on(t.eslgEslKey, t.eslgSide),
  index('excel_sync_log_geom_esl_idx').on(t.eslgEslKey),
]);

export const eslgTableComment = 'Excel 동기화 이력 도형 (전용 geometry)';

export const eslgColumnComments: Record<string, string> = {
  eslg_key: '이력 도형 키',
  eslg_esl_key: 'Excel 동기화 로그 키',
  eslg_side: '쪽 (old/new)',
  eslg_geom: '도형 (EPSG:5181)',
};

export type Eslg = typeof eslg.$inferSelect;
export type NewEslg = typeof eslg.$inferInsert;
