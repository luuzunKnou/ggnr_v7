-- serp_map.ser_eng, sysp_map.sys_key, usr_ser_grant.ser_eng, usr_sys_grant.sys_key,
-- usr_access_request.ser_eng / sys_key 에서 ser / sys 로의 FK 제거
-- (serviceList.config · systemList.config 와 정합만 맞추면 됨)
-- 기존 DB에 수동 적용하거나, drizzle-kit push 가 스키마와 동기화할 때 함께 반영됩니다.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_schema, tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_catalog = kcu.constraint_catalog
      AND tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN (
        'serp_map',
        'sysp_map',
        'usr_ser_grant',
        'usr_sys_grant',
        'usr_access_request'
      )
      AND kcu.column_name IN ('ser_eng', 'sys_key')
    GROUP BY tc.table_schema, tc.table_name, tc.constraint_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      r.table_schema,
      r.table_name,
      r.constraint_name
    );
  END LOOP;
END $$;
