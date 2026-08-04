-- sync_log «대체됨» 컬럼 제거 (재비교 시 soft-delete 미사용 → 미결 DELETE로 전환)
DROP INDEX IF EXISTS sync_log_table_op_idx;
ALTER TABLE sync_log DROP COLUMN IF EXISTS sl_superseded_at;
CREATE INDEX sync_log_table_op_idx ON sync_log (sl_table_name, sl_operation);
