/**
 * 접도구역 기존 건축물(공작물) 관리대장 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import {
  boolean,
  customType,
  doublePrecision,
  integer,
  pgSchema,
  serial,
  text,
} from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const roadFrontageBuilding = layer.table('road_frontage_building', {
  id: serial('id').primaryKey().notNull(),
  geom: geomPoint5181('geom'),
  lon: doublePrecision('lon'),
  lat: doublePrecision('lat'),
  roadType: text('road_type'),
  routeNo: text('route_no'),
  routeName: text('route_name'),
  serialNo: text('serial_no'),
  preparedDate: text('prepared_date'),
  locationAddress: text('location_address'),
  residentName: text('resident_name'),
  residentPhone: text('resident_phone'),
  buildingOwnerName: text('building_owner_name'),
  buildingOwnerPhone: text('building_owner_phone'),
  buildingOwnerAddress: text('building_owner_address'),
  landOwnerName: text('land_owner_name'),
  landOwnerPhone: text('land_owner_phone'),
  landOwnerAddress: text('land_owner_address'),
  writerDept: text('writer_dept'),
  writerName: text('writer_name'),
  writtenAt: text('written_at'),
  attachShotBefore: text('attach_shot_before'),
  attachShotAfter: text('attach_shot_after'),
  isDel: boolean('is_del').notNull().default(false),
  createDate: text('create_date'),
  createUser: text('create_user'),
  updateDate: text('update_date'),
  updateUser: text('update_user'),
});

export const roadFrontageBuildingDetail = layer.table('road_frontage_building_detail', {
  id: serial('id').primaryKey().notNull(),
  parentId: integer('parent_id')
    .notNull()
    .references(() => roadFrontageBuilding.id, { onDelete: 'cascade' }),
  dongNo: integer('dong_no'),
  installedDate: text('installed_date'),
  structure: text('structure'),
  usageType: text('usage_type'),
  areaSqm: doublePrecision('area_sqm'),
  locationKind: text('location_kind'),
  badMarks: text('bad_marks'),
  sortNo: integer('sort_no').notNull().default(0),
});

export const roadFrontageBuildingConfirm = layer.table('road_frontage_building_confirm', {
  id: serial('id').primaryKey().notNull(),
  parentId: integer('parent_id')
    .notNull()
    .references(() => roadFrontageBuilding.id, { onDelete: 'cascade' }),
  confirmDate: text('confirm_date'),
  confirmerName: text('confirmer_name'),
  approverName: text('approver_name'),
  sortNo: integer('sort_no').notNull().default(0),
});

export const roadFrontageBuildingTableComment = '접도구역 기존 건축물 관리대장';

export const roadFrontageBuildingColumnComments: Record<string, string> = {
  id: 'id',
  geom: '위치',
  lon: '경도',
  lat: '위도',
  road_type: '도로의 종류',
  route_no: '노선번호',
  route_name: '노선명',
  serial_no: '일련번호',
  prepared_date: '작성 연월일',
  location_address: '위치',
  resident_name: '현 거주자',
  resident_phone: '현 거주자 전화번호',
  building_owner_name: '건축물 소유자',
  building_owner_phone: '건축물 소유자 전화번호',
  building_owner_address: '건축물 소유자 주소',
  land_owner_name: '토지 소유자',
  land_owner_phone: '토지 소유자 전화번호',
  land_owner_address: '토지 소유자 주소',
  writer_dept: '작성 부서',
  writer_name: '작성자',
  written_at: '작성 시각',
  attach_shot_before: '종전 촬영 연월일',
  attach_shot_after: '변경 촬영 연월일',
  is_del: '삭제여부',
  create_date: '등록일시',
  create_user: '등록자',
  update_date: '수정일시',
  update_user: '수정자',
};

export const roadFrontageBuildingDetailTableComment = '접도구역 건축물 내용';

export const roadFrontageBuildingDetailColumnComments: Record<string, string> = {
  id: 'id',
  parent_id: '관리대장 id',
  dong_no: '동 구분',
  installed_date: '설치 연월일',
  structure: '구조',
  usage_type: '용도',
  area_sqm: '면적',
  location_kind: '위치',
  bad_marks: '불량 건축물 표시',
  sort_no: '정렬',
};

export const roadFrontageBuildingConfirmTableComment = '접도구역 건축물 확인 결과';

export const roadFrontageBuildingConfirmColumnComments: Record<string, string> = {
  id: 'id',
  parent_id: '관리대장 id',
  confirm_date: '확인 연월일',
  confirmer_name: '확인자',
  approver_name: '결재자',
  sort_no: '정렬',
};
