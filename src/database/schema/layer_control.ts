/**
 * layer.layer_control — 권한묶음별 레이어 읽기·쓰기
 */
import { integer, pgSchema, serial, varchar } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const layerControl = layer.table('layer_control', {
  layerControlId: serial('layer_control_id').primaryKey().notNull(),
  controlId: integer('control_id'),
  layerName: varchar('layer_name').notNull(),
  canRead: varchar('can_read'),
  canWrite: varchar('can_write'),
});

export const layerControlTableComment = 'QGIS 레이어별 읽기·쓰기 권한';

export const layerControlColumnComments: Record<string, string> = {
  layer_control_id: '레이어 권한 ID',
  control_id: '권한묶음 ID',
  layer_name: '레이어명(워크스페이스 제외)',
  can_read: '읽기 허용 Y/N',
  can_write: '쓰기 허용 Y/N',
};

export type LayerControl = typeof layerControl.$inferSelect;
export type NewLayerControl = typeof layerControl.$inferInsert;
