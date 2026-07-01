-- 공지 기간·공지여부 추가, 상단고정 제거
ALTER TABLE notice ADD COLUMN IF NOT EXISTS notice_is_active boolean NOT NULL DEFAULT false;
ALTER TABLE notice ADD COLUMN IF NOT EXISTS notice_start_date timestamp;
ALTER TABLE notice ADD COLUMN IF NOT EXISTS notice_end_date timestamp;
ALTER TABLE notice DROP COLUMN IF EXISTS notice_is_pinned;

COMMENT ON COLUMN notice.notice_is_active IS '공지여부';
COMMENT ON COLUMN notice.notice_start_date IS '공지시작일';
COMMENT ON COLUMN notice.notice_end_date IS '공지종료일';
