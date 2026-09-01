/**
 * 접도구역 기존 건축물(공작물) 관리대장 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 테이블·컬럼 존재를 확인하고 없으면 생성·추가한다.
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

/** ensureLayerAppTables — 컬럼 DDL·구형 컬럼 매핑 (id 제외) */
export type RoadFrontageBuildingLayerColumnDef = {
  name: string;
  ddl: string;
  comment?: string;
  /** 구형 단일 컬럼 → 신규 컬럼 값 복사 */
  legacyFrom?: string;
  /** legacyFrom 대신 SQL 표현식으로 복사 */
  legacyCopyExpr?: string;
};

export const ROAD_FRONTAGE_BUILDING_LAYER_COLUMNS: RoadFrontageBuildingLayerColumnDef[] = [
  { name: 'geom', ddl: 'geometry(Point,5181)', comment: roadFrontageBuildingColumnComments.geom },
  { name: 'lon', ddl: 'double precision', comment: roadFrontageBuildingColumnComments.lon },
  { name: 'lat', ddl: 'double precision', comment: roadFrontageBuildingColumnComments.lat },
  { name: 'road_type', ddl: 'text', comment: roadFrontageBuildingColumnComments.road_type },
  { name: 'route_no', ddl: 'text', comment: roadFrontageBuildingColumnComments.route_no },
  {
    name: 'route_name',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.route_name,
    legacyFrom: 'route_nam',
  },
  { name: 'serial_no', ddl: 'text', comment: roadFrontageBuildingColumnComments.serial_no },
  {
    name: 'prepared_date',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.prepared_date,
    legacyFrom: 'pre_ymd',
  },
  {
    name: 'location_address',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.location_address,
    legacyFrom: 'loc_adr',
  },
  {
    name: 'resident_name',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.resident_name,
    legacyFrom: 'resi_nam',
  },
  {
    name: 'resident_phone',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.resident_phone,
    legacyFrom: 'resi_num',
  },
  {
    name: 'building_owner_name',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.building_owner_name,
    legacyFrom: 'build_onam',
  },
  {
    name: 'building_owner_phone',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.building_owner_phone,
    legacyFrom: 'build_onum',
  },
  {
    name: 'building_owner_address',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.building_owner_address,
    legacyFrom: 'build_oadr',
  },
  {
    name: 'land_owner_name',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.land_owner_name,
    legacyFrom: 'land_onam',
  },
  {
    name: 'land_owner_phone',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.land_owner_phone,
    legacyFrom: 'land_onum',
  },
  {
    name: 'land_owner_address',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.land_owner_address,
    legacyFrom: 'land_oadr',
  },
  {
    name: 'writer_dept',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.writer_dept,
    legacyFrom: 'write_dept',
  },
  {
    name: 'writer_name',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.writer_name,
    legacyFrom: 'write_nam',
  },
  {
    name: 'written_at',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.written_at,
    legacyFrom: 'write_ymd',
  },
  {
    name: 'attach_shot_before',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.attach_shot_before,
    legacyFrom: 'before_ymd',
  },
  {
    name: 'attach_shot_after',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.attach_shot_after,
    legacyFrom: 'after_ymd',
  },
  {
    name: 'is_del',
    ddl: 'boolean NOT NULL DEFAULT false',
    comment: roadFrontageBuildingColumnComments.is_del,
  },
  {
    name: 'create_date',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.create_date,
    legacyFrom: 'crea_ymd',
  },
  {
    name: 'create_user',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.create_user,
    legacyFrom: 'crea_nam',
  },
  {
    name: 'update_date',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.update_date,
    legacyFrom: 'upd_ymd',
  },
  {
    name: 'update_user',
    ddl: 'text',
    comment: roadFrontageBuildingColumnComments.update_user,
    legacyFrom: 'upd_nam',
  },
];

export const ROAD_FRONTAGE_BUILDING_DETAIL_LAYER_COLUMNS: RoadFrontageBuildingLayerColumnDef[] = [
  {
    name: 'parent_id',
    ddl: 'integer',
    comment: roadFrontageBuildingDetailColumnComments.parent_id,
    legacyCopyExpr: `NULLIF(TRIM(ftr_idn::text), '')::integer`,
  },
  { name: 'dong_no', ddl: 'integer', comment: roadFrontageBuildingDetailColumnComments.dong_no },
  {
    name: 'installed_date',
    ddl: 'text',
    comment: roadFrontageBuildingDetailColumnComments.installed_date,
    legacyFrom: 'inst_ymd',
  },
  { name: 'structure', ddl: 'text', comment: roadFrontageBuildingDetailColumnComments.structure },
  { name: 'usage_type', ddl: 'text', comment: roadFrontageBuildingDetailColumnComments.usage_type },
  { name: 'area_sqm', ddl: 'double precision', comment: roadFrontageBuildingDetailColumnComments.area_sqm },
  {
    name: 'location_kind',
    ddl: 'text',
    comment: roadFrontageBuildingDetailColumnComments.location_kind,
    legacyCopyExpr: `COALESCE(NULLIF(TRIM(loc_adr_r), ''), NULLIF(TRIM(loc_adr_c), ''))`,
  },
  { name: 'bad_marks', ddl: 'text', comment: roadFrontageBuildingDetailColumnComments.bad_marks },
  {
    name: 'sort_no',
    ddl: 'integer NOT NULL DEFAULT 0',
    comment: roadFrontageBuildingDetailColumnComments.sort_no,
  },
];

export const ROAD_FRONTAGE_BUILDING_CONFIRM_LAYER_COLUMNS: RoadFrontageBuildingLayerColumnDef[] = [
  {
    name: 'parent_id',
    ddl: 'integer',
    comment: roadFrontageBuildingConfirmColumnComments.parent_id,
    legacyCopyExpr: `NULLIF(TRIM(ftr_idn::text), '')::integer`,
  },
  {
    name: 'confirm_date',
    ddl: 'text',
    comment: roadFrontageBuildingConfirmColumnComments.confirm_date,
    legacyFrom: 'check_ymd',
  },
  {
    name: 'confirmer_name',
    ddl: 'text',
    comment: roadFrontageBuildingConfirmColumnComments.confirmer_name,
    legacyFrom: 'check_nam',
  },
  {
    name: 'approver_name',
    ddl: 'text',
    comment: roadFrontageBuildingConfirmColumnComments.approver_name,
    legacyFrom: 'app_nam',
  },
  {
    name: 'sort_no',
    ddl: 'integer NOT NULL DEFAULT 0',
    comment: roadFrontageBuildingConfirmColumnComments.sort_no,
  },
];
