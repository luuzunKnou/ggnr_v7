/**
 * 물놀이 표지판 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { customType, pgSchema, serial, text } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const waterPlaySign = layer.table('water_play_sign', {
  id: serial('id').primaryKey().notNull(),
  signNm: text('sign_nm'),
  addr: text('addr'),
  signType: text('sign_type'),
  remark: text('remark'),
  geom: geomPoint5181('geom'),
});

export const waterPlaySignTableComment = '물놀이 표지판';

export const waterPlaySignColumnComments: Record<string, string> = {
  id: 'id',
  sign_nm: '표지판명',
  addr: '주소',
  sign_type: '표지판종류',
  remark: '비고',
  geom: '위치',
};
