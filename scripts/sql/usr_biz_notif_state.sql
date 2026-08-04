-- 계정별 업무 알림 읽음·지우기 상태
-- 적용: psql 또는 관리툴에서 실행 (Agent는 db:push 하지 않음)

CREATE TABLE IF NOT EXISTS public.usr_biz_notif_state (
  id bigserial PRIMARY KEY,
  usr_id varchar NOT NULL,
  notif_key varchar NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  is_dismissed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usr_biz_notif_state_usr_key UNIQUE (usr_id, notif_key)
);

COMMENT ON TABLE public.usr_biz_notif_state IS '업무 알림 읽음·지우기 상태';
COMMENT ON COLUMN public.usr_biz_notif_state.usr_id IS '사용자 아이디';
COMMENT ON COLUMN public.usr_biz_notif_state.notif_key IS '알림 키';
COMMENT ON COLUMN public.usr_biz_notif_state.is_read IS '읽음 여부';
COMMENT ON COLUMN public.usr_biz_notif_state.is_dismissed IS '지우기 여부';
COMMENT ON COLUMN public.usr_biz_notif_state.updated_at IS '수정시각';
