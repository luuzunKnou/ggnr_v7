-- 신청 사유 (신청자 입력)
ALTER TABLE usr_access_request ADD COLUMN IF NOT EXISTS request_reason text;
