import { pgTable, serial, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

/** 대기 · 승인 · 등록중 · 등록완료 · 반려 */
export const SR_STATUS_PENDING = 'pending';
export const SR_STATUS_APPROVED = 'approved';
export const SR_STATUS_REGISTERING = 'registering';
export const SR_STATUS_REGISTERED = 'registered';
export const SR_STATUS_REJECTED = 'rejected';

export const SR_SHOOT_TYPES = ['ortho', 'drone', 'panorama', 'satellite'] as const;
export type SrShootType = (typeof SR_SHOOT_TYPES)[number];

export const shootingRequest = pgTable('shooting_request', {
  srKey: serial('sr_key').primaryKey().notNull(),
  /**
   * 신청자 (로그인 사용자).
   * 슈퍼계정(su)은 usr 테이블에 없을 수 있어 FK를 두지 않는다.
   */
  usrId: varchar('usr_id').notNull(),
  department: varchar('department').notNull(),
  applicantRankName: varchar('applicant_rank_name').notNull(),
  phone: varchar('phone'),
  manager: varchar('manager'),
  purpose: varchar('purpose').notNull(),
  address: varchar('address'),
  hasScope: boolean('has_scope').notNull().default(false),
  scopeLabel: varchar('scope_label'),
  /** EPSG:5181 POLYGON WKT */
  scopeWkt: text('scope_wkt'),
  shootDate: varchar('shoot_date'),
  useDate: varchar('use_date'),
  shootType: varchar('shoot_type').notNull(),
  detailRequest: text('detail_request'),
  status: varchar('status').notNull().default(SR_STATUS_PENDING),
  rejectReason: text('reject_reason'),
  decidedAt: timestamp('decided_at', { mode: 'string' }),
  decidedBy: varchar('decided_by'),
  /** 영상관리 작업단위 연결 표시용 */
  linkedWorkUnitLabel: varchar('linked_work_unit_label'),
  registeredAt: timestamp('registered_at', { mode: 'string' }),
  srIsDel: boolean('sr_is_del').notNull().default(false),
  srCreateDate: timestamp('sr_create_date', { mode: 'string' }),
  srCreateUser: varchar('sr_create_user'),
  srUpdateDate: timestamp('sr_update_date', { mode: 'string' }),
  srUpdateUser: varchar('sr_update_user'),
});

export const shootingRequestTableComment = '촬영요청(무인비행장치 촬영신청)';

export const shootingRequestColumnComments: Record<string, string> = {
  sr_key: '촬영요청키',
  usr_id: '신청자아이디',
  department: '부서명',
  applicant_rank_name: '신청자직급성명',
  phone: '전화번호',
  manager: '관리자',
  purpose: '신청목적',
  address: '촬영지역지번',
  has_scope: '범위지정여부',
  scope_label: '범위라벨',
  scope_wkt: '촬영범위WKT(5181)',
  shoot_date: '촬영요청기간',
  use_date: '사용일',
  shoot_type: '촬영형태',
  detail_request: '상세요청사항',
  status: '상태(pending|approved|registering|registered|rejected)',
  reject_reason: '반려사유',
  decided_at: '승인반려처리일시',
  decided_by: '승인반려처리자',
  linked_work_unit_label: '연결작업단위표시',
  registered_at: '자료등록일시',
  sr_is_del: '삭제여부',
  sr_create_date: '등록일시',
  sr_create_user: '등록자',
  sr_update_date: '수정일시',
  sr_update_user: '수정자',
};

export type ShootingRequest = typeof shootingRequest.$inferSelect;
export type NewShootingRequest = typeof shootingRequest.$inferInsert;
