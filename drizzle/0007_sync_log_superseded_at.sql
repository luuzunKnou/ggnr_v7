-- sync_log 미결 행 재비교 시 하드 삭제 대신 supersede 표시하기 위한 컬럼 추가
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS sl_superseded_at timestamp;

COMMENT ON COLUMN sync_log.sl_superseded_at IS '대체됨(재비교로 무효화된) 일시';
