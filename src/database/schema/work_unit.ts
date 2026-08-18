/**
 * work_unit — 영상 작업단위 (폴더 1개 = 1행)
 * layer 스키마. 폴더 생성 시 insert. 파일은 file_unit.wu_key 로 연결
 */
import {
  boolean,
  date,
  integer,
  pgSchema,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const workUnit = layer.table('work_unit', {
  wuKey: serial('wu_key').primaryKey().notNull(),
  /** 작업단위 표시명 */
  workName: varchar('work_name').notNull(),
  /**
   * 촬영·자료 유형
   * ortho | drone | panorama | satellite
   */
  kind: varchar('kind').notNull(),
  /** 시스템 폴더명 aerial/{kind}/{folder_name} */
  folderName: varchar('folder_name').notNull(),
  /** 연결 촬영요청 */
  srKey: integer('sr_key'),
  /** 실제 작업일 */
  workDate: date('work_date', { mode: 'string' }),
  /** 작업 목적 */
  workPurpose: text('work_purpose'),
  author: varchar('author'),
  photographer: varchar('photographer'),
  memo: text('memo'),
  wuIsDel: boolean('wu_is_del').notNull().default(false),
  wuCreateDate: timestamp('wu_create_date', { mode: 'string' }),
  wuCreateUser: varchar('wu_create_user'),
  wuUpdateDate: timestamp('wu_update_date', { mode: 'string' }),
  wuUpdateUser: varchar('wu_update_user'),
});

export const workUnitTableComment = '영상작업단위';

export const workUnitColumnComments: Record<string, string> = {
  wu_key: '작업단위키',
  work_name: '작업단위명',
  kind: '유형(ortho|drone|panorama|satellite)',
  folder_name: '작업단위폴더명',
  sr_key: '촬영요청키',
  work_date: '작업일',
  work_purpose: '작업목적',
  author: '작성자',
  photographer: '촬영자',
  memo: '메모',
  wu_is_del: '삭제여부',
  wu_create_date: '등록일시',
  wu_create_user: '등록자',
  wu_update_date: '수정일시',
  wu_update_user: '수정자',
};

export type WorkUnit = typeof workUnit.$inferSelect;
export type NewWorkUnit = typeof workUnit.$inferInsert;
