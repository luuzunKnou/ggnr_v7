/**
 * tif_unit — 드론영상(정사) TIF 파일
 * layer 스키마. TIF 1건 = 1행. work_unit.wu_key 로 소속.
 * 업로드 후 변환 상태·타일 경로를 보관. 자체항공영상(tiles_jpg)과 분리.
 */
import {
  bigint,
  boolean,
  integer,
  pgSchema,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const tifUnit = layer.table('tif_unit', {
  tuKey: serial('tu_key').primaryKey().notNull(),
  /** 소속 작업단위 */
  wuKey: integer('wu_key').notNull(),
  fileName: varchar('file_name').notNull(),
  /** GGNR_DATA_DIR 기준 원본 상대 경로 (슬래시) */
  relativePath: varchar('relative_path').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  /** pending | converting | done | failed */
  convertStatus: varchar('convert_status').notNull().default('pending'),
  /** 변환 산출 루트 (슬래시) — aerial/ortho/{folder}/xyz/{slug} */
  tilesRelativePath: varchar('tiles_relative_path'),
  /** 원본 좌표계 예: EPSG:5181 */
  sourceCrs: varchar('source_crs'),
  convertError: text('convert_error'),
  convertStartedAt: timestamp('convert_started_at', { mode: 'string' }),
  convertFinishedAt: timestamp('convert_finished_at', { mode: 'string' }),
  tuIsDel: boolean('tu_is_del').notNull().default(false),
  tuCreateDate: timestamp('tu_create_date', { mode: 'string' }),
  tuCreateUser: varchar('tu_create_user'),
  tuUpdateDate: timestamp('tu_update_date', { mode: 'string' }),
  tuUpdateUser: varchar('tu_update_user'),
});

export const tifUnitTableComment = '드론영상TIF파일';

export const tifUnitColumnComments: Record<string, string> = {
  tu_key: 'TIF파일키',
  wu_key: '작업단위키',
  file_name: '파일명',
  relative_path: '원본상대경로',
  file_size: '파일크기바이트',
  convert_status: '변환상태(pending|converting|done|failed)',
  tiles_relative_path: '타일상대경로',
  source_crs: '원본좌표계',
  convert_error: '변환오류',
  convert_started_at: '변환시작일시',
  convert_finished_at: '변환완료일시',
  tu_is_del: '삭제여부',
  tu_create_date: '등록일시',
  tu_create_user: '등록자',
  tu_update_date: '수정일시',
  tu_update_user: '수정자',
};

export type TifUnit = typeof tifUnit.$inferSelect;
export type NewTifUnit = typeof tifUnit.$inferInsert;
