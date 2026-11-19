/**
 * 위상검증 수정요청 첨부 (layer 스키마)
 * 파일 본문은 서버 파일 데이터 폴더에 두고 DB에는 경로만 남긴다.
 */
import { bigint, index, integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { wtlTopoRequest } from './wtl_topo_request';

const layer = pgSchema('layer');

export const wtlTopoRequestFile = layer.table(
  'wtl_topo_request_file',
  {
    fileId: serial('file_id').primaryKey().notNull(),
    requestId: integer('request_id')
      .notNull()
      .references(() => wtlTopoRequest.requestId, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }),
    mimeType: text('mime_type'),
    createUser: text('create_user'),
    createDate: timestamp('create_date', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wtl_topo_request_file_req_idx').on(t.requestId)]
);

export const wtlTopoRequestFileTableComment = '상수도 위상검증 수정요청 첨부';

export const wtlTopoRequestFileColumnComments: Record<string, string> = {
  file_id: '키',
  request_id: '위상검증 수정요청',
  file_name: '원본 파일명',
  file_path: '저장 경로(파일 데이터 폴더 기준 상대 경로)',
  file_size: '파일 크기(byte)',
  mime_type: '파일 형식',
  create_user: '첨부 계정',
  create_date: '첨부 시각',
};
