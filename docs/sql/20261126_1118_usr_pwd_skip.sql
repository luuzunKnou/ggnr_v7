-- 임시 비밀번호 변경 안내 영구 넘김 여부 (usr.usr_pwd_skip)
-- 스키마: src/database/schema/usr.ts
-- 적용: 기동 시 additive 스키마 동기화(ADD COLUMN) 또는 대상 DB에서 수동 실행

ALTER TABLE public.usr
  ADD COLUMN IF NOT EXISTS usr_pwd_skip boolean DEFAULT false;

COMMENT ON COLUMN public.usr.usr_pwd_skip IS '임시 비밀번호 변경 안내 넘김 여부';
