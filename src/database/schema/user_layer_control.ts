/**
 * layer.user_layer_control — 사용자별 QGIS 접속 키
 */
import { pgSchema, serial, varchar } from 'drizzle-orm/pg-core';
import { usr } from './usr';

const layer = pgSchema('layer');

export const userLayerControl = layer.table('user_layer_control', {
  controlId: serial('control_id').primaryKey().notNull(),
  usrId: varchar('usr_id')
    .notNull()
    .references(() => usr.usrId, { onDelete: 'cascade' }),
  qgisKey: varchar('qgis_key'),
});

export const userLayerControlTableComment = '사용자별 QGIS 레이어 권한 묶음';

export const userLayerControlColumnComments: Record<string, string> = {
  control_id: '권한묶음 ID',
  usr_id: '사용자 아이디',
  qgis_key: 'QGIS WFS 접속 키',
};

export type UserLayerControl = typeof userLayerControl.$inferSelect;
export type NewUserLayerControl = typeof userLayerControl.$inferInsert;
