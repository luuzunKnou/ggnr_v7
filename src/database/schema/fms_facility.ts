import { bigserial, customType, pgSchema, text, timestamp, unique } from 'drizzle-orm/pg-core';

/** FMS 시설물관리대장 — layer, 접두 water|road|public */
const layer = pgSchema('layer');

const geomPolygon5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(MultiPolygon,5181)';
  },
});

function buildFmsFacilityColumns() {
  return {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    facilNo: text('facil_no'),
    facilNm: text('facil_nm'),
    geom: geomPolygon5181('geom'),
    mngNo: text('mng_no'),
    mngMainCd: text('mng_main_cd'),
    permitOrgCd: text('permit_org_cd'),
    facilOwner: text('facil_owner'),
    routeClass: text('route_class'),
    routeDetail: text('route_detail'),
    facilClass: text('facil_class'),
    facilGbn: text('facil_gbn'),
    facilKind: text('facil_kind'),
    facilDescCd: text('facil_desc_cd'),
    addrSido: text('addr_sido'),
    addrGugun: text('addr_gugun'),
    addrDong: text('addr_dong'),
    addrDetail: text('addr_detail'),
    cplYmd: text('cpl_ymd'),
    tempYmd: text('temp_ymd'),
    rspToYmd: text('rsp_to_ymd'),
    designYmdFrom: text('design_ymd_from'),
    designYmdTo: text('design_ymd_to'),
    designerNm: text('designer_nm'),
    constYmdFrom: text('const_ymd_from'),
    constYmdTo: text('const_ymd_to'),
    constractorCd: text('constractor_cd'),
    constractorNm: text('constractor_nm'),
    constAmt: text('const_amt'),
    spvYmdFrom: text('spv_ymd_from'),
    spvYmdTo: text('spv_ymd_to'),
    supervisorNm: text('supervisor_nm'),
    constOrderCd: text('const_order_cd'),
    constOrderNm: text('const_order_nm'),
    constNm: text('const_nm'),
    constSpvsrNm: text('const_spvsr_nm'),
    dsnBookStYn: text('dsn_book_st_yn'),
    eqDsnAppYn: text('eq_dsn_app_yn'),
    gamReasonCd: text('gam_reason_cd'),
    whlPhtFileCt: text('whl_pht_file_ct'),
    etcPhtFileCt: text('etc_pht_file_ct'),
    upperNo: text('upper_no'),
    lnkFacilNo: text('lnk_facil_no'),
    etcRemark: text('etc_remark'),
    addrFull: text('addr_full'),
    syncStatus: text('sync_status'),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  };
}

function defineFmsFacilityTable(tableName: string, uniqueConstraintName: string) {
  return layer.table(tableName, buildFmsFacilityColumns(), (t) => [
    unique(uniqueConstraintName).on(t.facilNo),
  ]);
}

export const waterFmsFacility = defineFmsFacilityTable(
  'water_fms_facility',
  'water_fms_facility_facil_no_key'
);

export const roadFmsFacility = defineFmsFacilityTable(
  'road_fms_facility',
  'road_fms_facility_facil_no_key'
);

export const publicFmsFacility = defineFmsFacilityTable(
  'public_fms_facility',
  'public_fms_facility_facil_no_key'
);

export type FmsFacilityTable =
  | typeof waterFmsFacility
  | typeof roadFmsFacility
  | typeof publicFmsFacility;

export type FmsFacility = typeof waterFmsFacility.$inferSelect;
export type NewFmsFacility = typeof waterFmsFacility.$inferInsert;
