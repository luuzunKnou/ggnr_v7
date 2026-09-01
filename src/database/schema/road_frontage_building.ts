/**
 * 접도구역 기존 건축물(공작물) 관리대장 (layer 스키마)
 * 컬럼명은 수급 DBF(road_frontage_building.dbf)와 동일.
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
  /** 업무 키 — DBF ftr_idn */
  ftrIdn: text('ftr_idn'),
  roadType: text('road_type'),
  routeNo: text('route_no'),
  routeNam: text('route_nam'),
  serialNo: text('serial_no'),
  preYmd: text('pre_ymd'),
  locAdr: text('loc_adr'),
  resiNam: text('resi_nam'),
  resiNum: text('resi_num'),
  buildOnam: text('build_onam'),
  buildOnum: text('build_onum'),
  buildOadr: text('build_oadr'),
  landOnam: text('land_onam'),
  landOnum: text('land_onum'),
  landOadr: text('land_oadr'),
  writeDept: text('write_dept'),
  writeNam: text('write_nam'),
  writeYmd: text('write_ymd'),
  beforeYmd: text('before_ymd'),
  afterYmd: text('after_ymd'),
  isDel: boolean('is_del').notNull().default(false),
  creaYmd: text('crea_ymd'),
  creaNam: text('crea_nam'),
  updYmd: text('upd_ymd'),
  updNam: text('upd_nam'),
});

export const roadFrontageBuildingDetail = layer.table('road_frontage_building_detail', {
  id: serial('id').primaryKey().notNull(),
  /** 대장 시설식별번호 — 연결 키 */
  ftrIdn: text('ftr_idn').notNull(),
  dongNo: text('dong_no'),
  instYmd: text('inst_ymd'),
  structure: text('structure'),
  usageType: text('usage_type'),
  areaSqm: text('area_sqm'),
  locAdrR: text('loc_adr_r'),
  locAdrC: text('loc_adr_c'),
  badMarks: text('bad_marks'),
  sortNo: integer('sort_no').notNull().default(0),
});

export const roadFrontageBuildingConfirm = layer.table('road_frontage_building_confirm', {
  id: serial('id').primaryKey().notNull(),
  /** 대장 시설식별번호 — 연결 키 */
  ftrIdn: text('ftr_idn').notNull(),
  checkYmd: text('check_ymd'),
  checkNam: text('check_nam'),
  appNam: text('app_nam'),
  sortNo: integer('sort_no').notNull().default(0),
});

export const roadFrontageBuildingTableComment = '접도구역 기존 건축물 관리대장';

export const roadFrontageBuildingColumnComments: Record<string, string> = {
  id: 'id',
  geom: '위치',
  lon: '경도',
  lat: '위도',
  ftr_idn: '시설식별번호',
  road_type: '도로의 종류',
  route_no: '노선번호',
  route_nam: '노선명',
  serial_no: '일련번호',
  pre_ymd: '작성 연월일',
  loc_adr: '위치',
  resi_nam: '현 거주자',
  resi_num: '현 거주자 전화번호',
  build_onam: '건축물 소유자',
  build_onum: '건축물 소유자 전화번호',
  build_oadr: '건축물 소유자 주소',
  land_onam: '토지 소유자',
  land_onum: '토지 소유자 전화번호',
  land_oadr: '토지 소유자 주소',
  write_dept: '작성 부서',
  write_nam: '작성자',
  write_ymd: '작성 시각',
  before_ymd: '종전 촬영 연월일',
  after_ymd: '변경 촬영 연월일',
  is_del: '삭제여부',
  crea_ymd: '등록일시',
  crea_nam: '등록자',
  upd_ymd: '수정일시',
  upd_nam: '수정자',
};

export const roadFrontageBuildingDetailTableComment = '접도구역 건축물 내용';

export const roadFrontageBuildingDetailColumnComments: Record<string, string> = {
  id: 'id',
  ftr_idn: '시설식별번호(대장 연결 키)',
  dong_no: '동 구분',
  inst_ymd: '설치 연월일',
  structure: '구조',
  usage_type: '용도',
  area_sqm: '면적',
  loc_adr_r: '도로예정지',
  loc_adr_c: '접도구역',
  bad_marks: '불량 건축물 표시',
  sort_no: '정렬',
};

export const roadFrontageBuildingConfirmTableComment = '접도구역 건축물 확인 결과';

export const roadFrontageBuildingConfirmColumnComments: Record<string, string> = {
  id: 'id',
  ftr_idn: '시설식별번호(대장 연결 키)',
  check_ymd: '확인 연월일',
  check_nam: '확인자',
  app_nam: '결재자',
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
