import { pgTable, serial, varchar, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core';

/**
 * 무인비행장치 비행기록부(별지 제5호)
 * — 촬영요청(sr_key) 또는 작업단위 라벨에 연결
 */
export const flightLogbook = pgTable('flight_logbook', {
  flKey: serial('fl_key').primaryKey().notNull(),
  /** 촬영요청 키 (승인 상세에서 작성 시) */
  srKey: integer('sr_key'),
  /** 영상관리 작업단위 표시명 */
  workUnitLabel: varchar('work_unit_label'),
  dateFlightTime: varchar('date_flight_time'),
  shootTargetPurpose: varchar('shoot_target_purpose'),
  aircraftModel: varchar('aircraft_model'),
  pilotOrg: varchar('pilot_org'),
  pilotName: varchar('pilot_name'),
  gimbalOrg: varchar('gimbal_org'),
  gimbalName: varchar('gimbal_name'),
  flightArea: varchar('flight_area'),
  permissionControl: varchar('permission_control'),
  /** good | inspect | '' */
  aircraftCondition: varchar('aircraft_condition'),
  /** good | inspect | '' */
  cameraCondition: varchar('camera_condition'),
  safetyDone: boolean('safety_done').notNull().default(false),
  flightSummary: text('flight_summary'),
  securityDone: boolean('security_done').notNull().default(false),
  securityDetail: text('security_detail'),
  etc: text('etc'),
  flIsDel: boolean('fl_is_del').notNull().default(false),
  flCreateDate: timestamp('fl_create_date', { mode: 'string' }),
  flCreateUser: varchar('fl_create_user'),
  flUpdateDate: timestamp('fl_update_date', { mode: 'string' }),
  flUpdateUser: varchar('fl_update_user'),
});

export const flightLogbookTableComment = '무인비행장치 비행기록부';

export const flightLogbookColumnComments: Record<string, string> = {
  fl_key: '비행기록부키',
  sr_key: '촬영요청키',
  work_unit_label: '작업단위표시명',
  date_flight_time: '일자비행시간',
  shoot_target_purpose: '촬영대상목적',
  aircraft_model: '기종',
  pilot_org: '파일럿소속',
  pilot_name: '파일럿성명',
  gimbal_org: '짐벌소속',
  gimbal_name: '짐벌성명',
  flight_area: '비행지역',
  permission_control: '허가통제사항',
  aircraft_condition: '비행체상태(good|inspect)',
  camera_condition: '촬영장비상태(good|inspect)',
  safety_done: '안전조치완료',
  flight_summary: '비행촬영요약',
  security_done: '보안조치여부',
  security_detail: '보안조치내용',
  etc: '기타',
  fl_is_del: '삭제여부',
  fl_create_date: '등록일시',
  fl_create_user: '등록자',
  fl_update_date: '수정일시',
  fl_update_user: '수정자',
};

export type FlightLogbook = typeof flightLogbook.$inferSelect;
export type NewFlightLogbook = typeof flightLogbook.$inferInsert;
