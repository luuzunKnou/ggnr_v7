#!/usr/bin/env bash
# build_uj 덤프 강제 restore
# - 대상 DB에 이미 있는 사용자 관련 테이블을 DROP CASCADE 후 복원
# - pg_restore --clean --if-exists 사용
#
# 사용 예:
#   bash scripts/force-restore-build-uj.sh
#   bash scripts/force-restore-build-uj.sh "/c/Users/PC/Desktop/20261117_build_uj.dump"
#   HOST=192.168.127.32 PORT=5433 DB=build_uj USER=build_uj PGPASSWORD=build_uj bash scripts/force-restore-build-uj.sh

set -euo pipefail

HOST="${HOST:-192.168.127.32}"
PORT="${PORT:-5433}"
DB="${DB:-build_uj}"
USER_NAME="${USER:-build_uj}"
DUMP="${1:-$HOME/Desktop/20261117_build_uj.dump}"

# Windows Git Bash: Desktop 경로
if [[ ! -f "$DUMP" && -f "/c/Users/PC/Desktop/20261117_build_uj.dump" ]]; then
  DUMP="/c/Users/PC/Desktop/20261117_build_uj.dump"
fi
if [[ ! -f "$DUMP" && -f "/c/Users/PC/Desktop/20261117_prod_build_uj.dump" ]]; then
  DUMP="/c/Users/PC/Desktop/20261117_prod_build_uj.dump"
fi

find_pg() {
  local c
  for c in \
    "pg_restore" \
    "/c/Program Files/PostgreSQL/18/bin/pg_restore.exe" \
    "/c/Program Files/PostgreSQL/17/bin/pg_restore.exe" \
    "/c/Program Files/PostgreSQL/16/bin/pg_restore.exe" \
    "/c/Program Files/PostgreSQL/15/bin/pg_restore.exe" \
    "/c/Program Files/PostgreSQL/14/bin/pg_restore.exe" \
    "/c/Program Files/PostgreSQL/13/bin/pg_restore.exe"
  do
    if command -v "$c" >/dev/null 2>&1; then
      echo "$c"
      return 0
    fi
    if [[ -x "$c" || -f "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

PG_RESTORE="$(find_pg)" || {
  echo "pg_restore 를 찾을 수 없습니다. PostgreSQL bin PATH를 확인하세요."
  exit 1
}
PG_BIN="$(dirname "$PG_RESTORE")"
PSQL="${PG_BIN}/psql"
[[ -f "${PSQL}.exe" ]] && PSQL="${PSQL}.exe"
command -v psql >/dev/null 2>&1 && PSQL="psql"

if [[ ! -f "$DUMP" ]]; then
  echo "덤프 파일이 없습니다: $DUMP"
  exit 1
fi

if [[ -z "${PGPASSWORD:-}" ]]; then
  export PGPASSWORD="${PGPASSWORD:-build_uj}"
fi

echo "== 강제 restore =="
echo " host=$HOST port=$PORT db=$DB user=$USER_NAME"
echo " dump=$DUMP"
echo " pg_restore=$PG_RESTORE"
echo

# 1) 충돌 나는 사용자 관련 객체 먼저 제거 (없으면 무시)
echo "[1/2] 기존 사용자 관련 테이블 DROP CASCADE ..."
"$PSQL" -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -v ON_ERROR_STOP=0 <<'SQL'
DROP TABLE IF EXISTS public.usr_ser_grant CASCADE;
DROP TABLE IF EXISTS public.usr_sys_grant CASCADE;
DROP TABLE IF EXISTS public.usr_biz_notif_state CASCADE;
DROP TABLE IF EXISTS public.usr_blz_notif_state CASCADE;
DROP TABLE IF EXISTS public.usr_access_request CASCADE;
DROP TABLE IF EXISTS public.user_detail_log CASCADE;
DROP TABLE IF EXISTS public.user_log CASCADE;
DROP TABLE IF EXISTS public.login_log CASCADE;
DROP TABLE IF EXISTS public.up_map CASCADE;
DROP TABLE IF EXISTS public.usr CASCADE;
DROP TABLE IF EXISTS public.ut CASCADE;
DROP TABLE IF EXISTS public.ug CASCADE;
DROP TABLE IF EXISTS layer.user_layer_control CASCADE;
SQL

# 2) 강제 복원
echo "[2/2] pg_restore --clean --if-exists ..."
set +e
"$PG_RESTORE" \
  --verbose \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  -h "$HOST" \
  -p "$PORT" \
  -U "$USER_NAME" \
  -d "$DB" \
  "$DUMP"
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  echo
  echo "exit-on-error 실패 → 오류 무시하고 재시도 (데이터·가능 객체만) ..."
  "$PG_RESTORE" \
    --verbose \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    -h "$HOST" \
    -p "$PORT" \
    -U "$USER_NAME" \
    -d "$DB" \
    "$DUMP" || true

  echo
  echo "PK/FK 누락 시 수동 보강 시도 ..."
  "$PSQL" -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -v ON_ERROR_STOP=0 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ug_pkey') THEN
    BEGIN
      ALTER TABLE public.ug ADD CONSTRAINT ug_pkey PRIMARY KEY (ug_name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ug_pkey skip: %', SQLERRM;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ut_pkey') THEN
    BEGIN
      ALTER TABLE public.ut ADD CONSTRAINT ut_pkey PRIMARY KEY (ut_name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ut_pkey skip: %', SQLERRM;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usr_pkey') THEN
    BEGIN
      ALTER TABLE public.usr ADD CONSTRAINT usr_pkey PRIMARY KEY (usr_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'usr_pkey skip: %', SQLERRM;
    END;
  END IF;
END $$;
SQL
fi

echo
echo "완료. 확인:"
"$PSQL" -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -c \
  "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind='r' AND c.relname IN
   ('ug','ut','usr','up_map','user_log','user_detail_log','usr_access_request',
    'usr_sys_grant','usr_ser_grant','usr_biz_notif_state','login_log','user_layer_control')
   ORDER BY 1,2;"
