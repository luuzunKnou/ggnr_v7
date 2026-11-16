CREATE OR REPLACE PROCEDURE layer.strip_path_prefix(p_table text, p_batch int DEFAULT 10000)
LANGUAGE plpgsql
AS $proc$
DECLARE
  n int;
  sql text;
BEGIN
  LOOP
    sql := format(
      $f$UPDATE layer.%I t
         SET "PATH_NAME" = regexp_replace("PATH_NAME", $re$^[A-Za-z]:\\[^\\]+\\$re$, '')
         WHERE t.ctid IN (
           SELECT ctid FROM layer.%I
           WHERE "PATH_NAME" ~ $re$^[A-Za-z]:\\[^\\]+\\$re$
           LIMIT %s
         )$f$,
      p_table, p_table, p_batch
    );
    EXECUTE sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '% updated %', p_table, n;
    COMMIT;
    EXIT WHEN n = 0;
    PERFORM pg_sleep(0.3);
  END LOOP;
END;
$proc$;

CALL layer.strip_path_prefix('dj_measure', 8000);
CALL layer.strip_path_prefix('dj_cadamap', 8000);
CALL layer.strip_path_prefix('dj_spms', 8000);
CALL layer.strip_path_prefix('ms_data', 8000);
CALL layer.strip_path_prefix('dj_landmove', 8000);

DROP PROCEDURE layer.strip_path_prefix(text, int);
