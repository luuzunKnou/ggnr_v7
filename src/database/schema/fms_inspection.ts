import { bigserial, pgSchema, text, timestamp, unique } from 'drizzle-orm/pg-core';

/** FMS 점검진단실적 — layer, 접두 water|road|public */
const layer = pgSchema('layer');

function buildFmsInspectionColumns() {
  return {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    facilNo: text('facil_no'),
    dignSeq: text('dign_seq'),
    startYmd: text('start_ymd'),
    endYmd: text('end_ymd'),
    dignGbn: text('dign_gbn'),
    regularGbn: text('regular_gbn'),
    repEngineerNm: text('rep_engineer_nm'),
    dignAmt: text('dign_amt'),
    stateGrade: text('state_grade'),
    dignContent: text('dign_content'),
    amendContent: text('amend_content'),
    wrtYmd: text('wrt_ymd'),
    wrtPersonNm: text('wrt_person_nm'),
    syncStatus: text('sync_status'),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  };
}

function defineFmsInspectionTable(tableName: string, uniqueConstraintName: string) {
  return layer.table(tableName, buildFmsInspectionColumns(), (t) => [
    unique(uniqueConstraintName).on(t.facilNo, t.dignSeq),
  ]);
}

export const waterFmsInspection = defineFmsInspectionTable(
  'water_fms_inspection',
  'water_fms_inspection_facil_dign_key'
);

export const roadFmsInspection = defineFmsInspectionTable(
  'road_fms_inspection',
  'road_fms_inspection_facil_dign_key'
);

export const publicFmsInspection = defineFmsInspectionTable(
  'public_fms_inspection',
  'public_fms_inspection_facil_dign_key'
);

export type FmsInspectionTable =
  | typeof waterFmsInspection
  | typeof roadFmsInspection
  | typeof publicFmsInspection;

export type FmsInspection = typeof waterFmsInspection.$inferSelect;
export type NewFmsInspection = typeof waterFmsInspection.$inferInsert;
