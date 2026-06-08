/**
 * layer.road_use_ledger — 도로점용 대장 (PostGIS)
 * GeoServer postgres_layer / 현장 DB 컬럼명과 동일하게 유지
 */
import { pgSchema, bigint, text, geometry } from 'drizzle-orm/pg-core';

const layerSchema = pgSchema('layer');

export const roadUseLedger = layerSchema.table('road_use_ledger', {
  id: bigint('id', { mode: 'bigint' }).primaryKey(),
  geom: geometry('geom', { srid: 5181 }),
  parcelAddress: text('parcel_address'),
  /** 허가번호 */
  useNo: text('use_no'),
  /** 허가일자 */
  usePermitDate: text('use_permit_date'),
  /** 도로종류 */
  useRoadType: text('use_road_type'),
  /** 노선명 */
  useRoadName: text('use_road_name'),
  /** 점용장소 */
  useAddr: text('use_addr'),
  /** 물건지 */
  useMgj: text('use_mgj'),
  /** 점용목적 */
  useWhy: text('use_why'),
  /** 피허가자 주소 */
  useLicAddr: text('use_lic_addr'),
  /** 피허가자 전화번호 */
  useLicTel: text('use_lic_tel'),
  /** 피허가자명 */
  useLicName: text('use_lic_name'),
  /** 점용면적(m²) */
  useArea: text('use_area'),
  /** 점용시작 */
  useStart: text('use_start'),
  /** 점용종료 */
  useEnd: text('use_end'),
});

export const roadUseLedgerTableComment = '도로점용 대장 (layer)';

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
