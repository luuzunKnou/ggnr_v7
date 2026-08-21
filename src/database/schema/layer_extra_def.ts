/**
 * layer_extra_def — 레이어별 추가속성(Extra) 정의 목록
 * 행 jsonb(extra)와 분리. 신규 등록 화면의 기본 항목 템플릿.
 */
import { pgTable, serial, varchar, integer, uniqueIndex } from 'drizzle-orm/pg-core';

export const layerExtraDef = pgTable(
  'layer_extra_def',
  {
    id: serial('id').primaryKey().notNull(),
    tableSchema: varchar('table_schema', { length: 64 }).notNull().default('layer'),
    tableName: varchar('table_name', { length: 128 }).notNull(),
    fieldName: varchar('field_name', { length: 128 }).notNull(),
    dataType: varchar('data_type', { length: 64 }).notNull().default('text'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('layer_extra_def_schema_table_field_uidx').on(
      t.tableSchema,
      t.tableName,
      t.fieldName
    ),
  ]
);

export const layerExtraDefTableComment = '레이어 추가속성 정의';

export const layerExtraDefColumnComments: Record<string, string> = {
  id: '키',
  table_schema: '스키마',
  table_name: '테이블명',
  field_name: '필드명(한글)',
  data_type: '데이터타입',
  sort_order: '순서',
};

export type LayerExtraDef = typeof layerExtraDef.$inferSelect;
export type NewLayerExtraDef = typeof layerExtraDef.$inferInsert;
