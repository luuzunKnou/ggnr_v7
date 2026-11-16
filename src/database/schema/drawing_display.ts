/**
 * drawing_display — 도면 표시 업로드 목록 메타 (DXF 본문은 GGNR_DATA_DIR/file_data/drawing_display)
 */
import { pgTable, serial, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const drawingDisplay = pgTable('drawing_display', {
  ddKey: serial('dd_key').primaryKey().notNull(),
  ddFileName: varchar('dd_file_name', { length: 512 }).notNull(),
  ddStoredName: varchar('dd_stored_name', { length: 128 }).notNull(),
  ddUsrId: varchar('dd_usr_id', { length: 64 }).notNull(),
  ddCrs: varchar('dd_crs', { length: 16 }).notNull().default('5186'),
  ddManualCrs: boolean('dd_manual_crs').notNull().default(false),
  ddVisible: boolean('dd_visible').notNull().default(true),
  ddCreateDate: timestamp('dd_create_date', { mode: 'string' }),
});

export const drawingDisplayTableComment = '도면 표시 업로드';

export const drawingDisplayColumnComments: Record<string, string> = {
  dd_key: '도면 키',
  dd_file_name: '원본 파일명',
  dd_stored_name: '저장 파일명',
  dd_usr_id: '업로드 사용자',
  dd_crs: '좌표계 EPSG',
  dd_manual_crs: '좌표계 수동 여부',
  dd_visible: '표시 여부',
  dd_create_date: '업로드 일시',
};

export type DrawingDisplay = typeof drawingDisplay.$inferSelect;
export type NewDrawingDisplay = typeof drawingDisplay.$inferInsert;
