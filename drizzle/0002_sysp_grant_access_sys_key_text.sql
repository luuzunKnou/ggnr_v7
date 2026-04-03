-- sysp_map / usr_sys_grant / usr_access_request: sys_key 를 정수에서 text 로 변경
-- (DB serial 문자열 "1" 과 systemList.config 의 문자열 sys_key 공존)
ALTER TABLE sysp_map ALTER COLUMN sys_key TYPE text USING sys_key::text;
ALTER TABLE usr_sys_grant ALTER COLUMN sys_key TYPE text USING sys_key::text;
ALTER TABLE usr_access_request ALTER COLUMN sys_key TYPE text USING sys_key::text;
