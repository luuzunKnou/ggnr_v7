-- 사용자 접속(로그인) 이력 (v6 login_log)
-- 스키마: public
-- ggnr_v7: src/database/schema/login_log.ts
-- 적용: 대상 DB에서 수동 실행 (Agent는 db:push 하지 않음)

CREATE TABLE IF NOT EXISTS public.login_log (
  ll_key      serial PRIMARY KEY,
  login_user  varchar NOT NULL,
  login_time  timestamp DEFAULT now(),
  login_ip    varchar
);

COMMENT ON TABLE public.login_log IS '사용자 접속(로그인) 이력';
COMMENT ON COLUMN public.login_log.ll_key IS '이력 키';
COMMENT ON COLUMN public.login_log.login_user IS '로그인 사용자 아이디';
COMMENT ON COLUMN public.login_log.login_time IS '로그인 시각';
COMMENT ON COLUMN public.login_log.login_ip IS '접속 IP';

CREATE INDEX IF NOT EXISTS login_log_time_idx ON public.login_log (login_time);
CREATE INDEX IF NOT EXISTS login_log_user_idx ON public.login_log (login_user);
