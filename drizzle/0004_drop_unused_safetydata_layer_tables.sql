-- 미사용 safetydata 적재 테이블 제거 (주석 처리된 sd-108,52,749,1267,1269,1346,876,1128)
-- 기본 스키마는 SAFETYDATA_TARGET_SCHEMA 와 동일하게 `layer` 가정.
-- 운영에서 스키마가 다르면 아래 layer. 를 해당 스키마로 바꿔 실행.

DROP TABLE IF EXISTS layer.sd_mois_flood_trace CASCADE;
DROP TABLE IF EXISTS layer.sd_mois_local_disaster_risk_zone CASCADE;
DROP TABLE IF EXISTS layer.sd_life_loss_concern_area CASCADE;
DROP TABLE IF EXISTS layer.sd_water_play_mgmt_zone CASCADE;
DROP TABLE IF EXISTS layer.sd_water_play_risk_zone CASCADE;
DROP TABLE IF EXISTS layer.sd_integrated_evac_shelter CASCADE;
DROP TABLE IF EXISTS layer.sd_small_public_facility CASCADE;
DROP TABLE IF EXISTS layer.sd_small_public_facility_safety_inspection CASCADE;
