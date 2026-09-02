/**
 * 물놀이 표지판 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { customType, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const waterPlaySign = layer.table('water_play_sign', {
  id: serial('id').primaryKey().notNull(),
  sido: text('sido'),
  sgg: text('sgg'),
  addr: text('addr'),
  addrDetail: text('addr_detail'),
  gubun: text('gubun'),
  isWarnig: text('is_warnig'),
  safeboxCnt: integer('safebox_cnt'),
  signCnt: integer('sign_cnt'),
  remark: text('remark'),
  geom: geomPoint5181('geom'),
});

export const waterPlaySignTableComment = '물놀이 표지판';

export const waterPlaySignColumnComments: Record<string, string> = {
  id: 'id',
  sido: '시도',
  sgg: '시군구',
  addr: '주소',
  addr_detail: '상세 주소',
  gubun: '구분',
  is_warnig: '관리지역 위험구역 여부',
  safebox_cnt: '구조함 수량',
  sign_cnt: '표지판 수량',
  remark: '비고',
  geom: '좌표',
};
