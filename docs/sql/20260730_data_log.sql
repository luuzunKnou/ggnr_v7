-- 통합 데이터 로그 (v6 data_log / data_detail_log)
-- 스키마: public
-- ggnr_v7: src/database/schema/data_log.ts, data_detail_log.ts
-- 적용: 대상 DB에서 수동 실행 (Agent는 db:push 하지 않음)

CREATE TABLE IF NOT EXISTS public.data_log (
  dl_key              serial PRIMARY KEY,
  dl_service_key      integer,
  dl_contents         varchar,
  dl_type             varchar,
  dl_user             varchar,
  dl_service_name     varchar,
  dl_date             timestamp DEFAULT now(),
  dl_key_field        varchar,
  dl_key_value        varchar,
  dl_table_name       varchar,
  dl_table_kor_name   varchar,
  dl_group            varchar,
  dl_source           varchar,
  dl_batch_key        varchar
);

COMMENT ON TABLE public.data_log IS '통합 데이터 로그';
COMMENT ON COLUMN public.data_log.dl_key IS '데이터 로그 키';
COMMENT ON COLUMN public.data_log.dl_service_key IS '서비스 키';
COMMENT ON COLUMN public.data_log.dl_contents IS '내용(키한글|키값 등)';
COMMENT ON COLUMN public.data_log.dl_type IS '작업분류';
COMMENT ON COLUMN public.data_log.dl_user IS '작업자';
COMMENT ON COLUMN public.data_log.dl_service_name IS '구분·서비스 표시명';
COMMENT ON COLUMN public.data_log.dl_date IS '작업 일시';
COMMENT ON COLUMN public.data_log.dl_key_field IS '키 필드명';
COMMENT ON COLUMN public.data_log.dl_key_value IS '키 값';
COMMENT ON COLUMN public.data_log.dl_table_name IS '테이블 영문명';
COMMENT ON COLUMN public.data_log.dl_table_kor_name IS '테이블 한글명';
COMMENT ON COLUMN public.data_log.dl_group IS '그룹';
COMMENT ON COLUMN public.data_log.dl_source IS '출처(시스템|SHP 업로드|Excel 업로드)';
COMMENT ON COLUMN public.data_log.dl_batch_key IS '작업묶음 키';

CREATE INDEX IF NOT EXISTS data_log_table_key_idx ON public.data_log (dl_table_name, dl_key_value);
CREATE INDEX IF NOT EXISTS data_log_date_idx ON public.data_log (dl_date);
CREATE INDEX IF NOT EXISTS data_log_source_idx ON public.data_log (dl_source);
CREATE INDEX IF NOT EXISTS data_log_batch_idx ON public.data_log (dl_batch_key);

CREATE TABLE IF NOT EXISTS public.data_detail_log (
  dd_key        serial PRIMARY KEY,
  dd_dl_key     integer NOT NULL REFERENCES public.data_log (dl_key) ON DELETE CASCADE,
  dd_item       varchar,
  dd_before     text,
  dd_after      text,
  dd_col_name   varchar,
  dd_key_value  varchar
);

COMMENT ON TABLE public.data_detail_log IS '통합 데이터 상세 로그';
COMMENT ON COLUMN public.data_detail_log.dd_key IS '상세 로그 키';
COMMENT ON COLUMN public.data_detail_log.dd_dl_key IS '데이터 로그 키';
COMMENT ON COLUMN public.data_detail_log.dd_item IS '항목명';
COMMENT ON COLUMN public.data_detail_log.dd_before IS '변경 전';
COMMENT ON COLUMN public.data_detail_log.dd_after IS '변경 후';
COMMENT ON COLUMN public.data_detail_log.dd_col_name IS '컬럼 영문명';
COMMENT ON COLUMN public.data_detail_log.dd_key_value IS '키 값';

CREATE INDEX IF NOT EXISTS data_detail_log_dl_idx ON public.data_detail_log (dd_dl_key);
