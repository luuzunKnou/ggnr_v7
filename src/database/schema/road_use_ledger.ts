/**
 * road_use_ledger — 도로점용 대장 (PostGIS)
 * GeoServer postgres_layer / 현장 DB 컬럼명과 동일하게 유지
 * 스키마는 'layer' 또는 'public' 어느 쪽에 있어도 서비스가 자동 탐색함
 */

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
