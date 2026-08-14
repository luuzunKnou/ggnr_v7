-- 사용자·권한 관리 이력 (v6 user_log / user_detail_log)
-- 스키마: public
-- ggnr_v7: src/database/schema/user_log.ts, user_detail_log.ts
-- 적용: 대상 DB에서 수동 실행 (Agent는 db:push 하지 않음)

CREATE TABLE IF NOT EXISTS public.user_log (
  ul_key         serial PRIMARY KEY,
  ul_cat         varchar NOT NULL,
  ul_contents    varchar,
  ul_detail      text,
  ul_type        varchar,
  ul_user        varchar,
  ul_group       varchar,
  ul_work_user   varchar,
  ul_sub_cat     varchar,
  ul_date        timestamp DEFAULT now()
);

COMMENT ON TABLE public.user_log IS '사용자·권한 관리 이력';
COMMENT ON COLUMN public.user_log.ul_key IS '이력 키';
COMMENT ON COLUMN public.user_log.ul_cat IS '분류(user|auth)';
COMMENT ON COLUMN public.user_log.ul_contents IS '내용';
COMMENT ON COLUMN public.user_log.ul_detail IS '상세';
COMMENT ON COLUMN public.user_log.ul_type IS '작업 분류';
COMMENT ON COLUMN public.user_log.ul_user IS '대상 사용자';
COMMENT ON COLUMN public.user_log.ul_group IS '대상 부서';
COMMENT ON COLUMN public.user_log.ul_work_user IS '작업자';
COMMENT ON COLUMN public.user_log.ul_sub_cat IS '하위 분류';
COMMENT ON COLUMN public.user_log.ul_date IS '일시';

CREATE INDEX IF NOT EXISTS user_log_cat_date_idx ON public.user_log (ul_cat, ul_date);
CREATE INDEX IF NOT EXISTS user_log_user_idx ON public.user_log (ul_user);
CREATE INDEX IF NOT EXISTS user_log_work_user_idx ON public.user_log (ul_work_user);

CREATE TABLE IF NOT EXISTS public.user_detail_log (
  ud_key       serial PRIMARY KEY,
  ud_ul_key    integer NOT NULL REFERENCES public.user_log (ul_key) ON DELETE CASCADE,
  ud_item      varchar,
  ud_before    text,
  ud_after     text,
  ud_col_name  varchar
);

COMMENT ON TABLE public.user_detail_log IS '사용자·권한 이력 상세';
COMMENT ON COLUMN public.user_detail_log.ud_key IS '상세 키';
COMMENT ON COLUMN public.user_detail_log.ud_ul_key IS '이력 키';
COMMENT ON COLUMN public.user_detail_log.ud_item IS '항목명';
COMMENT ON COLUMN public.user_detail_log.ud_before IS '변경 전';
COMMENT ON COLUMN public.user_detail_log.ud_after IS '변경 후';
COMMENT ON COLUMN public.user_detail_log.ud_col_name IS '컬럼명';

CREATE INDEX IF NOT EXISTS user_detail_log_ul_idx ON public.user_detail_log (ud_ul_key);
