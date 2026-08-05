-- 민원 접수·처리내역: public → layer (뷰 제거 후 실테이블 이동)
CREATE SCHEMA IF NOT EXISTS layer;

DROP VIEW IF EXISTS layer.comp;

ALTER TABLE IF EXISTS public.comp SET SCHEMA layer;
ALTER TABLE IF EXISTS public.compd SET SCHEMA layer;

ALTER TABLE layer.comp ADD COLUMN IF NOT EXISTS geom geometry(Point, 5181);
COMMENT ON COLUMN layer.comp.geom IS '민원 위치 (주소 기반 Point, EPSG:5181)';
CREATE INDEX IF NOT EXISTS comp_geom_gix ON layer.comp USING GIST (geom);
