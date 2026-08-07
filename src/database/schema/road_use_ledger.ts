/**
 * road_use_ledger / road_use_ledger_jijuk — 도로점용 대장 (PostGIS, layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { pgSchema, serial, integer, text, doublePrecision, customType } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPolygon5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Polygon,5181)';
  },
});

export const roadUseLedger = layer.table('road_use_ledger', {
  id: serial('id').primaryKey().notNull(),
  geom: geomPolygon5181('geom'),
  parcelAddress: text('parcel_address'),
  useNo: text('use_no'),
  usePermitDate: text('use_permit_date'),
  useRoadType: text('use_road_type'),
  useRoadName: text('use_road_name'),
  useAddr: text('use_addr'),
  useMgj: text('use_mgj'),
  useWhy: text('use_why'),
  useLicAddr: text('use_lic_addr'),
  useLicTel: text('use_lic_tel'),
  useLicName: text('use_lic_name'),
  useArea: doublePrecision('use_area'),
  useStart: text('use_start'),
  useEnd: text('use_end'),
});

export const roadUseLedgerJijuk = layer.table('road_use_ledger_jijuk', {
  id: serial('id').primaryKey().notNull(),
  parentId: integer('parent_id')
    .notNull()
    .references(() => roadUseLedger.id, { onDelete: 'cascade' }),
  geom: geomPolygon5181('geom'),
  parcelAddress: text('parcel_address'),
});

export const roadUseLedgerTableComment = '도로점용 대장';

export const roadUseLedgerColumnComments: Record<string, string> = {
  id: 'id',
  geom: 'geom',
  parcel_address: '필지이름',
  use_no: '허가번호',
  use_permit_date: '허가일자',
  use_road_type: '도로종류',
  use_road_name: '노선명',
  use_addr: '점용장소',
  use_mgj: '물건지',
  use_why: '점용목적',
  use_lic_addr: '피허가자 주소',
  use_lic_tel: '피허가자 전화번호',
  use_lic_name: '피허가자명',
  use_area: '점용면적(m²)',
  use_start: '점용시작',
  use_end: '점용종료',
};

export const roadUseLedgerJijukTableComment = '도로점용 대장 필지목록';

export const roadUseLedgerJijukColumnComments: Record<string, string> = {
  id: 'id',
  parent_id: '부모 id',
  geom: 'geom',
  parcel_address: '필지이름',
};
