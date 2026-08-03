-- Excel 업로드 이력: 이전 행 수 (TRUNCATE 직전)
-- 적용: 대상 DB에서 수동 실행 (Agent는 db:push 하지 않음)

ALTER TABLE public.excel_upload_history
  ADD COLUMN IF NOT EXISTS eh_old_row_count integer;

COMMENT ON COLUMN public.excel_upload_history.eh_old_row_count IS '이전 행 수(TRUNCATE 직전)';
COMMENT ON COLUMN public.excel_upload_history.eh_row_count IS '현재 행 수(삽입 후)';
