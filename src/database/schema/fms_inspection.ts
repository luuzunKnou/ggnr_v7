import { bigserial, pgSchema, text, timestamp, unique } from 'drizzle-orm/pg-core';

/** FMS 점검진단실적 — layer.road_fms_inspection 한 테이블(시설물은 road_fms_facility 와 facil_no 로 연결) */
const layer = pgSchema('layer');

export const roadFmsInspection = layer.table(
  'road_fms_inspection',
  {
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
  },
  (t) => [unique('road_fms_inspection_facil_dign_key').on(t.facilNo, t.dignSeq)]
);

export type FmsInspection = typeof roadFmsInspection.$inferSelect;
export type NewFmsInspection = typeof roadFmsInspection.$inferInsert;
