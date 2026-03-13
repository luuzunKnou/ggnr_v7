import { pgTable, serial, varchar, integer } from 'drizzle-orm/pg-core';
import { lh } from './layer_history';

export const dh = pgTable('layer_detail_history', {
  dhKey: serial('dh_key').primaryKey().notNull(),
  dhLhKey: integer('dh_lh_key').references(() => lh.lhKey),
  dhGroup: varchar('dh_group'),
  dhName: varchar('dh_name'),
  dhKorName: varchar('dh_kor_name'),
  dhType: varchar('dh_type'),
  dhOldData: integer('dh_old_data'),
  dhNewData: integer('dh_new_data'),
  dhAppendCount: integer('dh_append_count'),
  dhConflictCount: integer('dh_conflict_count'),
  dhRemoveCount: integer('dh_remove_count'),
  dhContents: varchar('dh_contents'),
  dhResult: varchar('dh_result'),
  dhShpPath: varchar('dh_shp_path'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const dhTableComment = '레이어 상세이력';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const dhColumnComments: Record<string, string> = {
  dh_key: '레이어 상세이력 키',
  dh_lh_key: '레이어 이력 키',
  dh_group: '그룹',
  dh_name: '레이어 영문명',
  dh_kor_name: '레이어 한글명',
  dh_type: '구분',
  dh_old_data: '이전 데이터 수',
  dh_new_data: '신규 데이터 수',
  dh_append_count: '신규 추가 건수',
  dh_conflict_count: '충돌 건수',
  dh_remove_count: '삭제 건수',
  dh_contents: '내용',
  dh_result: '결과',
  dh_shp_path: 'SHP 파일 경로',
};

export type Dh = typeof dh.$inferSelect;
export type NewDh = typeof dh.$inferInsert;
