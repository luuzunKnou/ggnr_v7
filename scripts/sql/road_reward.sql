-- 보상편입용지 (road_reward) + 필지목록 (road_reward_parcel)
-- layer 스키마. 편입 범위 geom은 건당 1개(EPSG:5181).
-- 필지는 부모 ogc_fid(reward_key)로 조인. 별도 관리코드 없음.
-- DB에 직접 실행. Agent는 자동 적용하지 않음(사용자 요청 시만).

CREATE SCHEMA IF NOT EXISTS layer;

-- 보상편입용지(건) — 편입 범위 도형 1개. PK = ogc_fid
CREATE TABLE IF NOT EXISTS layer.road_reward (
  ogc_fid SERIAL PRIMARY KEY,
  geom geometry(Geometry, 5181),
  name text,
  org text,
  policy text,
  unit text,
  detail text,
  budget_item text,
  stat_item text,
  appraisal1_name text,
  appraisal2_name text
);

CREATE INDEX IF NOT EXISTS road_reward_geom_idx
  ON layer.road_reward USING GIST (geom);

COMMENT ON TABLE layer.road_reward IS '보상편입용지';
COMMENT ON COLUMN layer.road_reward.ogc_fid IS '고유키';
COMMENT ON COLUMN layer.road_reward.geom IS '편입 범위 도형';
COMMENT ON COLUMN layer.road_reward.name IS '건명';
COMMENT ON COLUMN layer.road_reward.org IS '조직';
COMMENT ON COLUMN layer.road_reward.policy IS '정책';
COMMENT ON COLUMN layer.road_reward.unit IS '단위';
COMMENT ON COLUMN layer.road_reward.detail IS '세부';
COMMENT ON COLUMN layer.road_reward.budget_item IS '편성목';
COMMENT ON COLUMN layer.road_reward.stat_item IS '통계목';
COMMENT ON COLUMN layer.road_reward.appraisal1_name IS '감정기관1';
COMMENT ON COLUMN layer.road_reward.appraisal2_name IS '감정기관2';

-- 필지목록 — 부모 road_reward.ogc_fid 조인
CREATE TABLE IF NOT EXISTS layer.road_reward_parcel (
  ogc_fid SERIAL PRIMARY KEY,
  geom geometry(Geometry, 5181),
  reward_key integer NOT NULL,
  pnu text,
  eupmyeon_dong text,
  jibun_original text,
  jibun_included text,
  area_original double precision,
  area_included double precision,
  jimok text,
  appraisal1_value double precision,
  appraisal2_value double precision,
  applied_unit_price double precision,
  compensation_amount double precision,
  farming_compensation_amount double precision,
  obstacle_compensation_amount double precision,
  owner_address text,
  owner_name text,
  actual_owner text,
  actual_cultivator text,
  note text,
  CONSTRAINT road_reward_parcel_reward_ogc_fid_fkey
    FOREIGN KEY (reward_key) REFERENCES layer.road_reward (ogc_fid)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS road_reward_parcel_reward_ogc_fid_idx
  ON layer.road_reward_parcel (reward_key);
CREATE INDEX IF NOT EXISTS road_reward_parcel_pnu_idx
  ON layer.road_reward_parcel (pnu);
CREATE INDEX IF NOT EXISTS road_reward_parcel_geom_idx
  ON layer.road_reward_parcel USING GIST (geom);

COMMENT ON TABLE layer.road_reward_parcel IS '보상편입용지 필지목록';
COMMENT ON COLUMN layer.road_reward_parcel.ogc_fid IS '고유키';
COMMENT ON COLUMN layer.road_reward_parcel.geom IS '지적 필지 도형';
COMMENT ON COLUMN layer.road_reward_parcel.reward_key IS '보상편입용지 ogc_fid';
COMMENT ON COLUMN layer.road_reward_parcel.pnu IS 'PNU';
COMMENT ON COLUMN layer.road_reward_parcel.eupmyeon_dong IS '읍면동';
COMMENT ON COLUMN layer.road_reward_parcel.jibun_original IS '지번(당초)';
COMMENT ON COLUMN layer.road_reward_parcel.jibun_included IS '지번(편입)';
COMMENT ON COLUMN layer.road_reward_parcel.area_original IS '당초면적(㎡)';
COMMENT ON COLUMN layer.road_reward_parcel.area_included IS '편입면적(㎡)';
COMMENT ON COLUMN layer.road_reward_parcel.jimok IS '지목';
COMMENT ON COLUMN layer.road_reward_parcel.appraisal1_value IS '감정평가1(원/㎡)';
COMMENT ON COLUMN layer.road_reward_parcel.appraisal2_value IS '감정평가2(원/㎡)';
COMMENT ON COLUMN layer.road_reward_parcel.applied_unit_price IS '적용단가(원/㎡)';
COMMENT ON COLUMN layer.road_reward_parcel.compensation_amount IS '토지보상금액(원)';
COMMENT ON COLUMN layer.road_reward_parcel.farming_compensation_amount IS '영농보상금액(원)';
COMMENT ON COLUMN layer.road_reward_parcel.obstacle_compensation_amount IS '지장물보상금액(원)';
COMMENT ON COLUMN layer.road_reward_parcel.owner_address IS '토지소유자 주소';
COMMENT ON COLUMN layer.road_reward_parcel.owner_name IS '토지소유자 성명';
COMMENT ON COLUMN layer.road_reward_parcel.actual_owner IS '실소유자';
COMMENT ON COLUMN layer.road_reward_parcel.actual_cultivator IS '실경작자';
COMMENT ON COLUMN layer.road_reward_parcel.note IS '비고';
