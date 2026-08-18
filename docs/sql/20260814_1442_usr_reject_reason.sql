-- 가입 반려 사유 (usr.usr_reject_reason)
-- 스키마: src/database/schema/usr.ts
-- 적용: 대상 DB에서 수동 실행 (또는 다음 npm run dev 시 drizzle push)

ALTER TABLE public.usr
  ADD COLUMN IF NOT EXISTS usr_reject_reason varchar;

COMMENT ON COLUMN public.usr.usr_reject_reason IS '가입 반려사유';
