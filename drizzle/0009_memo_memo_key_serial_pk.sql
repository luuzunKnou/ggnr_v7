-- layer.memo: ogc_fid 제거, memo_key를 serial PK로 (멱등)

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'memo' AND column_name = 'ogc_fid'
  ) THEN
    EXECUTE 'UPDATE layer.memo SET memo_key = ogc_fid WHERE memo_key IS NULL';
  END IF;
END $$;

UPDATE layer.memo
SET memo_key = sub.n
FROM (
  SELECT ctid, ROW_NUMBER() OVER (ORDER BY ctid) AS n
  FROM layer.memo
  WHERE memo_key IS NULL
) sub
WHERE layer.memo.ctid = sub.ctid;

ALTER TABLE layer.memo DROP CONSTRAINT IF EXISTS memo_pkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'memo' AND column_name = 'ogc_fid'
  ) THEN
    ALTER TABLE layer.memo DROP COLUMN ogc_fid;
  END IF;
END $$;

ALTER TABLE layer.memo
  ALTER COLUMN memo_key TYPE integer USING memo_key::integer;

CREATE SEQUENCE IF NOT EXISTS layer.memo_memo_key_seq;

SELECT setval(
  'layer.memo_memo_key_seq',
  GREATEST(COALESCE((SELECT MAX(memo_key) FROM layer.memo), 0), 1),
  (SELECT COALESCE(MAX(memo_key), 0) FROM layer.memo) > 0
);

ALTER TABLE layer.memo
  ALTER COLUMN memo_key SET DEFAULT nextval('layer.memo_memo_key_seq'),
  ALTER COLUMN memo_key SET NOT NULL;

ALTER SEQUENCE layer.memo_memo_key_seq OWNED BY layer.memo.memo_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'layer' AND t.relname = 'memo' AND c.contype = 'p'
  ) THEN
    ALTER TABLE layer.memo ADD PRIMARY KEY (memo_key);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'memo' AND column_name = 'memo_conte'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'memo' AND column_name = 'memo_contents'
  ) THEN
    ALTER TABLE layer.memo RENAME COLUMN memo_conte TO memo_contents;
  END IF;
END $$;

DROP SEQUENCE IF EXISTS layer.memo_ogc_fid_seq;
DROP SEQUENCE IF EXISTS public.memo_ogc_fid_seq;

COMMIT;
