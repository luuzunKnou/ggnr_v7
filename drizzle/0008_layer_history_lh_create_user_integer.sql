-- layer_history.lh_create_user: varchar/text → integer
-- drizzle-kit push 는 USING 없이 ALTER 해서 실패하므로 명시적 형변환 사용
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'layer_history'
      AND column_name = 'lh_create_user'
      AND udt_name <> 'int4'
  ) THEN
    ALTER TABLE layer_history
      ALTER COLUMN lh_create_user TYPE integer
      USING NULLIF(btrim(lh_create_user::text), '')::integer;
  END IF;
END $$;

COMMENT ON COLUMN layer_history.lh_create_user IS '작업자';
