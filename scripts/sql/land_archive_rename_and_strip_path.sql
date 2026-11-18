BEGIN;

-- path_name에서 구 루트 D:\암호화지적이미지\ 제거
UPDATE layer."DJ_AREA" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_CADAMAP" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_HWANJI_IMAGE" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_LANDJOSA" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_LANDMOVE" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_MEASURE" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_NOCORP" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_SPMS" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_SURVCHKLIST" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."DJ_TOPOGRAPHIC" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';
UPDATE layer."MS_DATA" SET "PATH_NAME" = substring("PATH_NAME" from 13)
WHERE "PATH_NAME" LIKE E'D:\\암호화지적이미지\\%';

ALTER TABLE layer."DJ_AREA" RENAME TO dj_area;
ALTER TABLE layer."DJ_CADAMAP" RENAME TO dj_cadamap;
ALTER TABLE layer."DJ_HWANJI_IMAGE" RENAME TO dj_hwanji_image;
ALTER TABLE layer."DJ_LANDJOSA" RENAME TO dj_landjosa;
ALTER TABLE layer."DJ_LANDMOVE" RENAME TO dj_landmove;
ALTER TABLE layer."DJ_MEASURE" RENAME TO dj_measure;
ALTER TABLE layer."DJ_NOCORP" RENAME TO dj_nocorp;
ALTER TABLE layer."DJ_SPMS" RENAME TO dj_spms;
ALTER TABLE layer."DJ_SURVCHKLIST" RENAME TO dj_survchklist;
ALTER TABLE layer."DJ_TOPOGRAPHIC" RENAME TO dj_topographic;
ALTER TABLE layer."MS_DATA" RENAME TO ms_data;

ALTER SEQUENCE layer."DJ_AREA_area_no_seq" RENAME TO dj_area_area_no_seq;
ALTER SEQUENCE layer."DJ_CADAMAP_cadamap_no_seq" RENAME TO dj_cadamap_cadamap_no_seq;
ALTER SEQUENCE layer."DJ_HWANJI_IMAGE_himg_no_seq" RENAME TO dj_hwanji_image_himg_no_seq;
ALTER SEQUENCE layer."DJ_LANDJOSA_landjosa_no_seq" RENAME TO dj_landjosa_landjosa_no_seq;
ALTER SEQUENCE layer."DJ_LANDMOVE_landmove_no_seq" RENAME TO dj_landmove_landmove_no_seq;
ALTER SEQUENCE layer."DJ_MEASURE_mea_no_seq" RENAME TO dj_measure_mea_no_seq;
ALTER SEQUENCE layer."DJ_NOCORP_nocorp_no_seq" RENAME TO dj_nocorp_nocorp_no_seq;
ALTER SEQUENCE layer."DJ_SPMS_spms_no_seq" RENAME TO dj_spms_spms_no_seq;
ALTER SEQUENCE layer."DJ_SURVCHKLIST_surv_no_seq" RENAME TO dj_survchklist_surv_no_seq;
ALTER SEQUENCE layer."DJ_TOPOGRAPHIC_topographic_no_seq" RENAME TO dj_topographic_topographic_no_seq;
ALTER SEQUENCE layer."MS_DATA_data_no_seq" RENAME TO ms_data_data_no_seq;

ALTER TABLE layer.dj_area ALTER COLUMN area_no SET DEFAULT nextval('layer.dj_area_area_no_seq'::regclass);
ALTER TABLE layer.dj_cadamap ALTER COLUMN cadamap_no SET DEFAULT nextval('layer.dj_cadamap_cadamap_no_seq'::regclass);
ALTER TABLE layer.dj_hwanji_image ALTER COLUMN himg_no SET DEFAULT nextval('layer.dj_hwanji_image_himg_no_seq'::regclass);
ALTER TABLE layer.dj_landjosa ALTER COLUMN landjosa_no SET DEFAULT nextval('layer.dj_landjosa_landjosa_no_seq'::regclass);
ALTER TABLE layer.dj_landmove ALTER COLUMN landmove_no SET DEFAULT nextval('layer.dj_landmove_landmove_no_seq'::regclass);
ALTER TABLE layer.dj_measure ALTER COLUMN mea_no SET DEFAULT nextval('layer.dj_measure_mea_no_seq'::regclass);
ALTER TABLE layer.dj_nocorp ALTER COLUMN nocorp_no SET DEFAULT nextval('layer.dj_nocorp_nocorp_no_seq'::regclass);
ALTER TABLE layer.dj_spms ALTER COLUMN spms_no SET DEFAULT nextval('layer.dj_spms_spms_no_seq'::regclass);
ALTER TABLE layer.dj_survchklist ALTER COLUMN surv_no SET DEFAULT nextval('layer.dj_survchklist_surv_no_seq'::regclass);
ALTER TABLE layer.dj_topographic ALTER COLUMN topographic_no SET DEFAULT nextval('layer.dj_topographic_topographic_no_seq'::regclass);
ALTER TABLE layer.ms_data ALTER COLUMN data_no SET DEFAULT nextval('layer.ms_data_data_no_seq'::regclass);

COMMIT;
