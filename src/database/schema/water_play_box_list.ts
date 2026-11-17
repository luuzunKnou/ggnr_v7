/**
 * 물놀이 구조함 위치 (layer 스키마) — water_play_sign 1:N
 */
import { customType, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { waterPlaySign } from './water_play_sign';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const waterPlayBoxList = layer.table('water_play_box_list', {
  fid: serial('fid').primaryKey().notNull(),
  id: integer('id')
    .notNull()
    .references(() => waterPlaySign.id, { onDelete: 'cascade' }),
  addr: text('addr'),
  geom: geomPoint5181('geom'),
});

export const waterPlayBoxListTableComment = '물놀이 구조함';

export const waterPlayBoxListColumnComments: Record<string, string> = {
  fid: '키',
  id: '관리 구간',
  addr: '주소',
  geom: '위치',
};
