import { pgTable, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

export const eh = pgTable('excel_upload_history', {
  ehKey: serial('eh_key').primaryKey().notNull(),
  ehSourcePath: varchar('eh_source_path'),
  ehTableName: varchar('eh_table_name').notNull(),
  ehTableKorName: varchar('eh_table_kor_name'),
  ehGroup: varchar('eh_group'),
  ehRowCount: integer('eh_row_count'),
  ehResult: varchar('eh_result'),
  ehContents: varchar('eh_contents'),
  ehCreateDate: timestamp('eh_create_date'),
  ehCreateUser: integer('eh_create_user'),
  /** 도형 생성 대상 컬럼 한글명(Excel 헤더). 다음 업로드 시 자동 선택용 */
  ehGeocodingHeaderKor: varchar('eh_geocoding_header_kor'),
  /** 도형 생성 대상 컬럼 영문명(define_field_name). 다음 업로드 시 자동 선택용 */
  ehGeocodingHeaderEng: varchar('eh_geocoding_header_eng'),
  /** 도형 타입: Point | Polygon */
  ehGeometryType: varchar('eh_geometry_type'),
});

/** 테이블 코멘트 */
export const ehTableComment = 'Excel 업로드 이력';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const ehColumnComments: Record<string, string> = {
  eh_key: '이력 키',
  eh_source_path: '원본 파일 서버 경로',
  eh_table_name: '생성된 테이블 영문명',
  eh_table_kor_name: '한글명',
  eh_group: '그룹',
  eh_row_count: '삽입 행 수',
  eh_result: '결과 (성공/실패)',
  eh_contents: '요약 메시지',
  eh_create_date: '작업 일시',
  eh_create_user: '작업자',
  eh_geocoding_header_kor: '도형 대상 컬럼 한글명',
  eh_geocoding_header_eng: '도형 대상 컬럼 영문명',
  eh_geometry_type: '도형 타입 (Point/Polygon)',
};

export type Eh = typeof eh.$inferSelect;
export type NewEh = typeof eh.$inferInsert;
