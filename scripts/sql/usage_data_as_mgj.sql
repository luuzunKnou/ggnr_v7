-- 울진 하천점용 물건지 (usage_data_as_mgj)
-- solo(필지)와 동일하게 jijuk 폴리곤 geom 저장
-- DB에 직접 실행 후 GeoServer data_dir 반영·재기동

CREATE TABLE IF NOT EXISTS layer.usage_data_as_mgj (
  ogc_fid SERIAL PRIMARY KEY,
  geom geometry(Geometry, 5181),
  cons_code text NOT NULL,
  usage_loc text NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_data_as_mgj_cons_code_idx ON layer.usage_data_as_mgj (cons_code);

-- 기존 Point 테이블 → 폴리곤(Geometry) 전환 (레이어 재업로드 전 1회 실행)
-- ALTER TABLE layer.usage_data_as_mgj
--   ALTER COLUMN geom TYPE geometry(Geometry, 5181)
--   USING CASE
--     WHEN geom IS NULL THEN NULL
--     WHEN ST_GeometryType(geom) IN ('ST_Point', 'ST_MultiPoint') THEN NULL
--     ELSE ST_SetSRID(ST_Multi(ST_Force2D(geom)), 5181)
--   END;
