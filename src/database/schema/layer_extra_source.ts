/**
 * layer_extra_source — SHP에서 본문 컬럼으로 넣지 않고 extra로 뺀 원본 필드 이력
 * knownSources(누적) + active(현재 값 매핑) 용. layer_extra_def(현재 정의)와 별개.
 */
import {
  pgTable,
  serial,
  varchar,
  integer,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const layerExtraSource = pgTable(
  'layer_extra_source',
  {
    id: serial('id').primaryKey().notNull(),
    tableSchema: varchar('table_schema', { length: 64 }).notNull().default('layer'),
    tableName: varchar('table_name', { length: 128 }).notNull(),
    /** SHP 원본 속성명 */
    sourceField: varchar('source_field', { length: 128 }).notNull(),
    /** 표시용 라벨(한글 등) */
    fieldName: varchar('field_name', { length: 128 }).notNull(),
    dataType: varchar('data_type', { length: 64 }).notNull().default('text'),
    /** 현재 extra 값 반영에 쓰는 항목이면 true. false여도 이력(구조검사 면제)으로 유지 */
    isActive: boolean('is_active').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('layer_extra_source_schema_table_src_uidx').on(
      t.tableSchema,
      t.tableName,
      t.sourceField
    ),
  ]
);

export const layerExtraSourceTableComment =
  'SHP 추가속성 원본 필드 이력(구조검증·재업로드용)';

export const layerExtraSourceColumnComments: Record<string, string> = {
  id: '키',
  table_schema: '스키마',
  table_name: '테이블명',
  source_field: 'SHP 원본 속성명',
  field_name: '표시 라벨',
  data_type: '데이터타입',
  is_active: '현재 extra 반영 여부',
  sort_order: '순서',
};

export type LayerExtraSource = typeof layerExtraSource.$inferSelect;
export type NewLayerExtraSource = typeof layerExtraSource.$inferInsert;
