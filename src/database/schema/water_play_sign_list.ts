/**
 * 물놀이 표지판 위치 (layer 스키마) — water_play_sign 1:N
 */
import { customType, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { waterPlaySign } from './water_play_sign';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const waterPlaySignList = layer.table('water_play_sign_list', {
  fid: serial('fid').primaryKey().notNull(),
  id: integer('id')
    .notNull()
    .references(() => waterPlaySign.id, { onDelete: 'cascade' }),
  addr: text('addr'),
  geom: geomPoint5181('geom'),
});

export const waterPlaySignListTableComment = '물놀이 표지판 위치';

export const waterPlaySignListColumnComments: Record<string, string> = {
  fid: '키',
  id: '관리 구간',
  addr: '주소',
  geom: '위치',
};
