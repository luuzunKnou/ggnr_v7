#!/usr/bin/env bash
# 20261117_prod_build_uj.dump (사용자 관련 테이블) 강제 restore
# 대상 예: 192.168.127.32 / 192.168.126.59 의 build_uj
#
#   bash scripts/force-restore-prod-user-dump.sh
#   HOSTS="192.168.127.32 192.168.126.59" bash scripts/force-restore-prod-user-dump.sh

set -euo pipefail

HOSTS="${HOSTS:-192.168.127.32 192.168.126.59}"
PORT="${PORT:-5433}"
DB="${DB:-build_uj}"
USER_NAME="${USER_NAME:-build_uj}"
export PGPASSWORD="${PGPASSWORD:-build_uj}"

DUMP="${1:-/c/Users/PC/Desktop/20261117_prod_build_uj.dump}"
if [[ ! -f "$DUMP" ]]; then
  echo "덤프 없음: $DUMP"
  exit 1
fi

PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe"
PG_RESTORE="/c/Program Files/PostgreSQL/18/bin/pg_restore.exe"
[[ -f "$PSQL" ]] || PSQL="psql"
[[ -f "$PG_RESTORE" ]] || PG_RESTORE="pg_restore"

LIST="$(mktemp -t restoreXXXX.list)"
trap 'rm -f "$LIST"' EXIT

# TOC에서 perm FK 등 덤프 밖 참조는 제외
"$PG_RESTORE" -l "$DUMP" | sed \
  -e '/up_map_perm_key_perm_perm_key_fk/s/^/;/' \
  > "$LIST"

restore_one() {
  local HOST="$1"
  echo
  echo "======== $HOST:$PORT / $DB ========"

  echo "[1/4] DROP 사용자 관련 테이블 ..."
  "$PSQL" -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -v ON_ERROR_STOP=0 <<'SQL'
DROP TABLE IF EXISTS public.usr_ser_grant CASCADE;
DROP TABLE IF EXISTS public.usr_sys_grant CASCADE;
DROP TABLE IF EXISTS public.usr_biz_notif_state CASCADE;
DROP TABLE IF EXISTS public.usr_access_request CASCADE;
DROP TABLE IF EXISTS public.user_detail_log CASCADE;
DROP TABLE IF EXISTS public.user_log CASCADE;
DROP TABLE IF EXISTS public.up_map CASCADE;
DROP TABLE IF EXISTS public.usr CASCADE;
DROP TABLE IF EXISTS public.ut CASCADE;
DROP TABLE IF EXISTS public.ug CASCADE;
SQL

  echo "[2/4] pre-data + data restore ..."
  "$PG_RESTORE" \
    --verbose \
    --no-owner \
    --no-acl \
    --section=pre-data \
    --section=data \
    -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" \
    -L "$LIST" \
    "$DUMP"

  echo "[3/4] 중복·고아 데이터 보정 ..."
  "$PSQL" -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
-- 중복 행 제거 (PK 달기 전)
DELETE FROM public.ug a USING public.ug b
 WHERE a.ctid < b.ctid AND a.ug_name = b.ug_name;
DELETE FROM public.ut a USING public.ut b
 WHERE a.ctid < b.ctid AND a.ut_name = b.ut_name;
DELETE FROM public.usr a USING public.usr b
 WHERE a.ctid < b.ctid AND a.usr_id = b.usr_id;

-- usr 가 참조하는데 ug/ut 에 없는 값 보충 (예: 123)
INSERT INTO public.ug (ug_name, ug_is_del, ug_is_hidden, ug_etc)
SELECT DISTINCT u.ug_name, false, false, 'restore-orphan'
FROM public.usr u
LEFT JOIN public.ug g ON g.ug_name = u.ug_name
WHERE u.ug_name IS NOT NULL AND g.ug_name IS NULL;

INSERT INTO public.ut (ut_name, ug_name, ut_is_del, ut_is_hidden, ut_etc)
SELECT DISTINCT u.ut_name, u.ug_name, false, false, 'restore-orphan'
FROM public.usr u
LEFT JOIN public.ut t ON t.ut_name = u.ut_name
WHERE u.ut_name IS NOT NULL AND t.ut_name IS NULL
  AND EXISTS (SELECT 1 FROM public.ug g WHERE g.ug_name = u.ug_name);

-- ut.ug_name 이 ug 에 없으면 부서도 보충
INSERT INTO public.ug (ug_name, ug_is_del, ug_is_hidden, ug_etc)
SELECT DISTINCT t.ug_name, false, false, 'restore-orphan'
FROM public.ut t
LEFT JOIN public.ug g ON g.ug_name = t.ug_name
WHERE t.ug_name IS NOT NULL AND g.ug_name IS NULL;
SQL

  echo "[4/4] post-data (PK/FK/INDEX) ..."
  set +e
  "$PG_RESTORE" \
    --verbose \
    --no-owner \
    --no-acl \
    --section=post-data \
    -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" \
    -L "$LIST" \
    "$DUMP"
  local RC=$?
  set -e

  echo "--- 건수 ---"
  "$PSQL" -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -c \
    "SELECT 'ug' t, count(*) FROM ug UNION ALL SELECT 'ut', count(*) FROM ut UNION ALL SELECT 'usr', count(*) FROM usr ORDER BY 1;"

  if [[ $RC -ne 0 ]]; then
    echo "경고: post-data 일부 오류(RC=$RC). 위 건수로 데이터 적재 여부 확인."
  else
    echo "OK: $HOST restore 완료"
  fi
}

for H in $HOSTS; do
  restore_one "$H"
done

echo
echo "전체 작업 끝."
