import { pgTable, serial, varchar, boolean, timestamp, integer, text } from 'drizzle-orm/pg-core';

/** 승인상태: Y=승인, P=진행중, N=거부 */
export const DRF_ACCEPT_Y = 'Y';
export const DRF_ACCEPT_P = 'P';
export const DRF_ACCEPT_N = 'N';

/** 승인주체: 빈값=자동승인, team=팀장, admin=관리자 */
export const DRF_AUTHOR_TEAM = 'team';
export const DRF_AUTHOR_ADMIN = 'admin';

export const dataRequestFile = pgTable('data_request_file', {
  drfKey: serial('drf_key').primaryKey().notNull(),
  /** 동일 요청 묶음 */
  fileGroupKey: integer('file_group_key').notNull(),
  fileUserId: varchar('file_user_id').notNull(),
  fileUserName: varchar('file_user_name'),
  /** v7 부서 한글명 */
  fileUgName: varchar('file_ug_name'),
  fileAccept: varchar('file_accept').notNull().default(DRF_ACCEPT_Y),
  fileAcceptAuthor: varchar('file_accept_author').notNull().default(''),
  fileAcceptDate: timestamp('file_accept_date', { mode: 'string' }),
  fileAcceptUser: varchar('file_accept_user'),
  /** GGNR_DATA_DIR 기준 상대 경로 (폴더) */
  filePath: varchar('file_path').notNull(),
  /** SHP, 레이어(SHP), ZIP, EXCEL, 첨부파일, 정사영상 등 */
  fileType: varchar('file_type').notNull(),
  fileDate: timestamp('file_date', { mode: 'string' }).notNull(),
  filePledge: boolean('file_pledge').notNull().default(true),
  fileLayer: varchar('file_layer'),
  fileLayerKor: varchar('file_layer_kor'),
  /** 파일 준비: Y=완료, N=실패 */
  fileSuccess: varchar('file_success').notNull().default('Y'),
  fileIsDel: boolean('file_is_del').notNull().default(false),
  userIp: varchar('user_ip'),
  /** 저장된 zip 파일명 */
  fileZipName: varchar('file_zip_name'),
  fileEtc: text('file_etc'),
});

export const dataRequestFileTableComment = '데이터요청(보안서약·다운로드)';

export const dataRequestFileColumnComments: Record<string, string> = {
  drf_key: '데이터요청키',
  file_group_key: '요청그룹키',
  file_user_id: '요청자아이디',
  file_user_name: '요청자성명',
  file_ug_name: '요청자부서',
  file_accept: '승인상태(Y|P|N)',
  file_accept_author: '승인주체(빈값|team|admin)',
  file_accept_date: '승인일시',
  file_accept_user: '승인자',
  file_path: '저장상대경로',
  file_type: '파일분류',
  file_date: '요청일시',
  file_pledge: '서약여부',
  file_layer: '레이어영문명',
  file_layer_kor: '레이어한글명',
  file_success: '파일준비(Y|N)',
  file_is_del: '삭제여부',
  user_ip: '요청IP',
  file_zip_name: 'ZIP파일명',
  file_etc: '비고',
};

export type DataRequestFile = typeof dataRequestFile.$inferSelect;
export type NewDataRequestFile = typeof dataRequestFile.$inferInsert;
