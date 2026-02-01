import { pgTable, serial, integer, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { ug } from './ug';

export const usr = pgTable('usr', {
  usrKey: serial('usr_key').primaryKey().notNull(),
  ugKey: integer('ug_key').references(() => ug.ugKey, { onDelete: 'cascade' }),
  usrId: varchar('usr_id'),
  usrName: varchar('usr_name'),
  usrPwd: varchar('usr_pwd'),
  usrTel: varchar('usr_tel'),
  usrMail: varchar('usr_mail'),
  usrIsManager: boolean('usr_is_manager'),
  usrIsSo: boolean('usr_is_so'),
  usrIsDel: boolean('usr_is_del'),
  usrIsHidden: boolean('usr_is_hidden'),
  usrEtc: varchar('usr_etc'),
  usrReqTime: timestamp('usr_req_time', { mode: 'string' }),
  usrOkTime: timestamp('usr_ok_time', { mode: 'string' }),
  usrCancleTime: timestamp('usr_cancle_time', { mode: 'string' }),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const usrTableComment = '사용자';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const usrColumnComments: Record<string, string> = {
  usr_key: '사용자 키',
  ug_key: '사용자 그룹 키',
  usr_id: '사용자 아이디',
  usr_name: '사용자 이름',
  usr_pwd: '비밀번호',
  usr_tel: '전화번호',
  usr_mail: '메일',
  usr_is_manager: '부서관리자 여부',
  usr_is_so: '새올연동 여부',
  usr_is_del: '삭제여부',
  usr_is_hidden: '숨김여부',
  usr_etc: '비고',
  usr_req_time: '신청시간',
  usr_ok_time: '승인시간',
  usr_cancle_time: '반려시간',
};

export type Usr = typeof usr.$inferSelect;
export type NewUsr = typeof usr.$inferInsert;
