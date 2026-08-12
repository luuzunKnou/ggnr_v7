-- layer.ngl_fee_list.geom 추가 (물건지주소 → jijuk 폴리곤)
-- Agent가 DB에 자동 실행하지 않음. 필요 시 직접 실행.

ALTER TABLE layer.ngl_fee_list
  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 5181);

CREATE INDEX IF NOT EXISTS ngl_fee_list_geom_gix
  ON layer.ngl_fee_list USING GIST (geom);

COMMENT ON COLUMN layer.ngl_fee_list.geom IS '물건지 필지 폴리곤(EPSG:5181)';
