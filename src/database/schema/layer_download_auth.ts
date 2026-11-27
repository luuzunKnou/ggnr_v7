/**
 * layer_download_auth — 레이어별 SHP·엑셀 / 첨부 다운로드 승인 주체
 * 기동 시 ensureLayerAppTables 가 없으면 생성하고 geometry_columns 기준으로 시드한다.
 * SHP/엑셀=auto, 첨부=none
 */
import { pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

/** auto=자동승인, admin=관리자, team=팀장, none=서약없음·즉시 다운로드 */
export const LDA_AUTH_AUTO = 'auto';
export const LDA_AUTH_ADMIN = 'admin';
export const LDA_AUTH_TEAM = 'team';
export const LDA_AUTH_NONE = 'none';

export const LAYER_DOWNLOAD_AUTH_VALUES = [
  LDA_AUTH_AUTO,
  LDA_AUTH_ADMIN,
  LDA_AUTH_TEAM,
  LDA_AUTH_NONE,
] as const;

export type LayerDownloadAuthValue = (typeof LAYER_DOWNLOAD_AUTH_VALUES)[number];

export const layerDownloadAuth = pgTable(
  'layer_download_auth',
  {
    tableSchema: varchar('table_schema').notNull(),
    tableName: varchar('table_name').notNull(),
    shpExcel: varchar('shp_excel').notNull().default(LDA_AUTH_AUTO),
    attachment: varchar('attachment').notNull().default(LDA_AUTH_NONE),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tableSchema, t.tableName] })]
);

export const layerDownloadAuthTableComment = '레이어 다운로드 승인권한(SHP·엑셀/첨부)';

export const layerDownloadAuthColumnComments: Record<string, string> = {
  table_schema: '스키마(layer|public_layer)',
  table_name: '테이블명',
  shp_excel: 'SHP·엑셀 승인(auto|admin|team|none)',
  attachment: '첨부파일 승인(auto|admin|team|none)',
  updated_at: '수정시각',
};

export type LayerDownloadAuth = typeof layerDownloadAuth.$inferSelect;
export type NewLayerDownloadAuth = typeof layerDownloadAuth.$inferInsert;
