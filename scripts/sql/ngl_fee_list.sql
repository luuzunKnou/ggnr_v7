-- next_gen_linkage.ngl_fee_list
-- 미납·수납 통합 테이블 (v7)
-- 컬럼 순서: fee_status → 공통 → 미납전용 → 수납전용 → 동기화
-- Agent가 DB에 자동 실행하지 않음. 필요 시 직접 실행.

CREATE SCHEMA IF NOT EXISTS next_gen_linkage;

CREATE TABLE IF NOT EXISTS next_gen_linkage.ngl_fee_list (
  id bigserial PRIMARY KEY,
  fee_status text NOT NULL CHECK (fee_status IN ('미납', '수납')),
  sgb_cd text,
  lvy_key text,
  dpt_nm text,
  dpt_cd text,
  fyr text,
  act_se_cd text,
  rprs_txm_cd text,
  rprs_txm_nm text,
  lvy_no text,
  itm_sn text,
  pyr_no text,
  pyr_nm text,
  pyr_addr text,
  lvy_ymd text,
  frst_pid_ymd text,
  gl_nm text,
  gl_mng_no text,
  gl_addr text,
  vtlac_bank_nm1 text,
  vr_actno1 text,
  vtlac_bank_nm2 text,
  vr_actno2 text,
  vtlac_bank_nm3 text,
  vr_actno3 text,
  vtlac_bank_nm4 text,
  vr_actno4 text,
  vtlac_bank_nm5 text,
  vr_actno5 text,
  vtlac_bank_nm6 text,
  vr_actno6 text,
  vtlac_bank_nm7 text,
  vr_actno7 text,
  vtlac_bank_nm8 text,
  vr_actno8 text,
  vtlac_bank_nm9 text,
  vr_actno9 text,
  vtlac_bank_nm10 text,
  vr_actno10 text,
  vtlac_bank_nm11 text,
  vr_actno11 text,
  vtlac_bank_nm12 text,
  vr_actno12 text,
  vtlac_bank_nm13 text,
  vr_actno13 text,
  vtlac_bank_nm14 text,
  vr_actno14 text,
  vtlac_bank_nm15 text,
  vr_actno15 text,
  vtlac_bank_nm16 text,
  vr_actno16 text,
  vtlac_bank_nm17 text,
  vr_actno17 text,
  vtlac_bank_nm18 text,
  vr_actno18 text,
  vtlac_bank_nm19 text,
  vr_actno19 text,
  vtlac_bank_nm20 text,
  vr_actno20 text,
  epay_no text,
  ledger_no text,
  acct_itm_cd text,
  -- 미납(부과/체납) 전용
  sgb_nm text,
  rcvmt_se_nm text,
  szr_se_nm text,
  pyr_se_cd text,
  pyr_mng_no text,
  pyr_addr_sn text,
  pyr_stt_cd text,
  pyr_stt_nm text,
  zip text,
  lotno_road_addr_se_cd text,
  pyr_cnpc_no text,
  pyr_mbl_cnpc_no text,
  lvy_se_cd text,
  last_pid_ymd text,
  pid_af_ymd text,
  pid_af_amt bigint,
  frst_pct_amt bigint,
  lvy_stt_se_nm text,
  last_pct_amt bigint,
  last_adtn_amt bigint,
  last_itm_intr_amt bigint,
  itm_se_nm text,
  unty_lvy_data_se_nm text,
  gl_lotno_road_addr_se_cd text,
  gl_zip text,
  mng_item_sn1 text,
  mng_item_sn2 text,
  mng_item_sn3 text,
  mng_item_sn4 text,
  mng_item_sn5 text,
  mng_item_sn6 text,
  arr_rsn_cd text,
  arr_rsn_nm text,
  dft_se_nm text,
  pyr_eml_addr text,
  auto_pay_se_cd text,
  rdt_se_nm text,
  rpm_szr_vhrno text,
  unty_rprs_key text,
  -- 수납 전용
  spac_biz_cd text,
  rcvmt_sn text,
  rcvmt_ymd text,
  rcvmt_pct_amt bigint,
  rcvmt_adtn_amt bigint,
  itm_intr_amt bigint,
  rcvmt_bank text,
  rcvmt_ty_cd text,
  rcvmt_ty_nm text,
  act_ymd text,
  pmk_ymd text,
  rcvmt_se_cd text,
  rcvmt_stt_se_cd text,
  taxn_no text,
  -- 동기화
  sync_status text,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ngl_fee_list_lvy_rcvmt_key UNIQUE (lvy_key, rcvmt_sn)
);

CREATE INDEX IF NOT EXISTS ngl_fee_list_fee_status_idx
  ON next_gen_linkage.ngl_fee_list (fee_status);
CREATE INDEX IF NOT EXISTS ngl_fee_list_lvy_no_idx
  ON next_gen_linkage.ngl_fee_list (lvy_no);
CREATE INDEX IF NOT EXISTS ngl_fee_list_ledger_no_idx
  ON next_gen_linkage.ngl_fee_list (ledger_no);
CREATE INDEX IF NOT EXISTS ngl_fee_list_mng_item_sn5_idx
  ON next_gen_linkage.ngl_fee_list (mng_item_sn5);
CREATE INDEX IF NOT EXISTS ngl_fee_list_mng_item_sn6_idx
  ON next_gen_linkage.ngl_fee_list (mng_item_sn6);

COMMENT ON TABLE next_gen_linkage.ngl_fee_list IS '점사용료 미납·수납 통합';
COMMENT ON COLUMN next_gen_linkage.ngl_fee_list.fee_status IS '미납 | 수납';
COMMENT ON COLUMN next_gen_linkage.ngl_fee_list.lvy_key IS '부과키(수납일련과 함께 유니크)';
COMMENT ON COLUMN next_gen_linkage.ngl_fee_list.mng_item_sn5 IS '관리항목5(대장 관리코드 매핑)';
COMMENT ON COLUMN next_gen_linkage.ngl_fee_list.mng_item_sn6 IS '관리항목6(대장 관리코드 매핑)';
