-- 지적기록물 목록: 파일명·경로 조회용 인덱스. CONCURRENTLY — 트랜잭션 없이 실행.
SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_ms_data_file
  ON layer.ms_data (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_landmove_file
  ON layer.dj_landmove (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_measure_file
  ON layer.dj_measure (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_area_file
  ON layer.dj_area (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_landjosa_file
  ON layer.dj_landjosa (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_spms_file
  ON layer.dj_spms (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_survchklist_file
  ON layer.dj_survchklist (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_topographic_file
  ON layer.dj_topographic (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_hwanji_image_file
  ON layer.dj_hwanji_image (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_nocorp_file
  ON layer.dj_nocorp (lower(btrim("FILE_NAME")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_cadamap_path_norm
  ON layer.dj_cadamap (
    (lower(trim(both '/' from replace(btrim("PATH_NAME"), chr(92), '/'))))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_land_archive_dj_measure_sub_keys
  ON layer.dj_measure_sub ("ROLL_NO", "FRAME_NO", "SR_NO");

ANALYZE layer.ms_data;
ANALYZE layer.dj_landmove;
ANALYZE layer.dj_measure;
ANALYZE layer.dj_measure_sub;
ANALYZE layer.dj_cadamap;
ANALYZE layer.dj_area;
ANALYZE layer.dj_landjosa;
ANALYZE layer.dj_spms;
ANALYZE layer.dj_survchklist;
ANALYZE layer.dj_topographic;
ANALYZE layer.dj_hwanji_image;
ANALYZE layer.dj_nocorp;
