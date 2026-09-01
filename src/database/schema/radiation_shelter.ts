/**
 * 방사선 대피소 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { customType, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const radiationShelter = layer.table('radiation_shelter', {
  id: serial('id').primaryKey().notNull(),
  ftnNm: text('ftn_nm'),
  addr: text('addr'),
  actcTnop: integer('actc_tnop'),
  remark: text('remark'),
  geom: geomPoint5181('geom'),
});

export const radiationShelterTableComment = '방사선 대피소';

export const radiationShelterColumnComments: Record<string, string> = {
  id: 'id',
  ftn_nm: '시설명',
  addr: '주소',
  actc_tnop: '수용인원',
  remark: '비고',
  geom: '위치',
};
