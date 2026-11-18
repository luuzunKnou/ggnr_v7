BEGIN;
CREATE SCHEMA IF NOT EXISTS layer;

-- 소유 시퀀스는 PG 18에서 테이블과 함께 layer로 따라감
ALTER TABLE public."DJ_AREA" SET SCHEMA layer;
ALTER TABLE public."DJ_CADAMAP" SET SCHEMA layer;
ALTER TABLE public."DJ_HWANJI_IMAGE" SET SCHEMA layer;
ALTER TABLE public."DJ_LANDJOSA" SET SCHEMA layer;
ALTER TABLE public."DJ_LANDMOVE" SET SCHEMA layer;
ALTER TABLE public."DJ_MEASURE" SET SCHEMA layer;
ALTER TABLE public."DJ_NOCORP" SET SCHEMA layer;
ALTER TABLE public."DJ_SPMS" SET SCHEMA layer;
ALTER TABLE public."DJ_SURVCHKLIST" SET SCHEMA layer;
ALTER TABLE public."DJ_TOPOGRAPHIC" SET SCHEMA layer;
ALTER TABLE public."MS_DATA" SET SCHEMA layer;

ALTER TABLE layer."DJ_AREA" ALTER COLUMN area_no SET DEFAULT nextval('layer."DJ_AREA_area_no_seq"'::regclass);
ALTER TABLE layer."DJ_CADAMAP" ALTER COLUMN cadamap_no SET DEFAULT nextval('layer."DJ_CADAMAP_cadamap_no_seq"'::regclass);
ALTER TABLE layer."DJ_HWANJI_IMAGE" ALTER COLUMN himg_no SET DEFAULT nextval('layer."DJ_HWANJI_IMAGE_himg_no_seq"'::regclass);
ALTER TABLE layer."DJ_LANDJOSA" ALTER COLUMN landjosa_no SET DEFAULT nextval('layer."DJ_LANDJOSA_landjosa_no_seq"'::regclass);
ALTER TABLE layer."DJ_LANDMOVE" ALTER COLUMN landmove_no SET DEFAULT nextval('layer."DJ_LANDMOVE_landmove_no_seq"'::regclass);
ALTER TABLE layer."DJ_MEASURE" ALTER COLUMN mea_no SET DEFAULT nextval('layer."DJ_MEASURE_mea_no_seq"'::regclass);
ALTER TABLE layer."DJ_NOCORP" ALTER COLUMN nocorp_no SET DEFAULT nextval('layer."DJ_NOCORP_nocorp_no_seq"'::regclass);
ALTER TABLE layer."DJ_SPMS" ALTER COLUMN spms_no SET DEFAULT nextval('layer."DJ_SPMS_spms_no_seq"'::regclass);
ALTER TABLE layer."DJ_SURVCHKLIST" ALTER COLUMN surv_no SET DEFAULT nextval('layer."DJ_SURVCHKLIST_surv_no_seq"'::regclass);
ALTER TABLE layer."DJ_TOPOGRAPHIC" ALTER COLUMN topographic_no SET DEFAULT nextval('layer."DJ_TOPOGRAPHIC_topographic_no_seq"'::regclass);
ALTER TABLE layer."MS_DATA" ALTER COLUMN data_no SET DEFAULT nextval('layer."MS_DATA_data_no_seq"'::regclass);

COMMIT;
