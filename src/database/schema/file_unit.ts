/**
 * file_unit — 영상 작업단위 파일 (사진·동영상 등)
 * layer 스키마. 파일 1건 = 1행. work_unit.wu_key 로 소속.
 * GPS 있으면 geom(Point,5181) + x_5181/y_5181 동시 저장.
 */
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  integer,
  pgSchema,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const fileUnit = layer.table('file_unit', {
  fuKey: serial('fu_key').primaryKey().notNull(),
  /** 소속 작업단위 */
  wuKey: integer('wu_key').notNull(),
  fileName: varchar('file_name').notNull(),
  /** GGNR_DATA_DIR 기준 상대 경로 (슬래시) */
  relativePath: varchar('relative_path').notNull(),
  /** image | video */
  mediaType: varchar('media_type').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  /** EPSG:5181 X — GPS 없으면 null */
  x5181: doublePrecision('x_5181'),
  /** EPSG:5181 Y — GPS 없으면 null */
  y5181: doublePrecision('y_5181'),
  /** 촬영 위치 (좌표 있을 때만) */
  geom: geomPoint5181('geom'),
  fuIsDel: boolean('fu_is_del').notNull().default(false),
  fuCreateDate: timestamp('fu_create_date', { mode: 'string' }),
  fuCreateUser: varchar('fu_create_user'),
  fuUpdateDate: timestamp('fu_update_date', { mode: 'string' }),
  fuUpdateUser: varchar('fu_update_user'),
});

export const fileUnitTableComment = '영상작업단위파일';

export const fileUnitColumnComments: Record<string, string> = {
  fu_key: '파일키',
  wu_key: '작업단위키',
  file_name: '파일명',
  relative_path: '상대경로',
  media_type: '미디어유형(image|video)',
  file_size: '파일크기바이트',
  x_5181: '경도방향좌표5181',
  y_5181: '위도방향좌표5181',
  geom: '촬영위치',
  fu_is_del: '삭제여부',
  fu_create_date: '등록일시',
  fu_create_user: '등록자',
  fu_update_date: '수정일시',
  fu_update_user: '수정자',
};

export type FileUnit = typeof fileUnit.$inferSelect;
export type NewFileUnit = typeof fileUnit.$inferInsert;
