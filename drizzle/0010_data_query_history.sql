-- 데이터 조회 상세 피처(행)별 이력 (점검·보수·이상발생·준공)
CREATE TABLE IF NOT EXISTS data_query_history (
  dqh_key serial PRIMARY KEY NOT NULL,
  dqh_table varchar NOT NULL,
  dqh_row_key varchar NOT NULL,
  dqh_date date,
  dqh_type varchar,
  dqh_title varchar,
  dqh_contents text,
  dqh_author varchar,
  dqh_create_user varchar,
  dqh_create_date date
);

CREATE INDEX IF NOT EXISTS data_query_history_table_row_idx
  ON data_query_history (dqh_table, dqh_row_key);

COMMENT ON TABLE data_query_history IS '데이터조회 행 이력';
COMMENT ON COLUMN data_query_history.dqh_key IS '이력 키';
COMMENT ON COLUMN data_query_history.dqh_table IS '물리 테이블명';
COMMENT ON COLUMN data_query_history.dqh_row_key IS '행 키';
COMMENT ON COLUMN data_query_history.dqh_date IS '이력 일자';
COMMENT ON COLUMN data_query_history.dqh_type IS '유형(점검·보수·이상발생·준공)';
COMMENT ON COLUMN data_query_history.dqh_title IS '제목';
COMMENT ON COLUMN data_query_history.dqh_contents IS '내용';
COMMENT ON COLUMN data_query_history.dqh_author IS '담당';
COMMENT ON COLUMN data_query_history.dqh_create_user IS '등록 사용자';
COMMENT ON COLUMN data_query_history.dqh_create_date IS '등록일';
