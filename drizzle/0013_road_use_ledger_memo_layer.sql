-- 도로점용대장·메모 (layer). 서버 기동 ensureLayerAppTables 와 동일 멱등 DDL.

CREATE SCHEMA IF NOT EXISTS layer;

CREATE TABLE IF NOT EXISTS layer.road_use_ledger (
  id SERIAL PRIMARY KEY,
  geom geometry(Polygon, 5181),
  parcel_address text,
  use_no text,
  use_permit_date text,
  use_road_type text,
  use_road_name text,
  use_addr text,
  use_mgj text,
  use_why text,
  use_lic_addr text,
  use_lic_tel text,
  use_lic_name text,
  use_area double precision,
  use_start text,
  use_end text
);
CREATE INDEX IF NOT EXISTS road_use_ledger_geom_gix ON layer.road_use_ledger USING GIST (geom);

CREATE TABLE IF NOT EXISTS layer.road_use_ledger_jijuk (
  id SERIAL PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES layer.road_use_ledger (id) ON DELETE CASCADE,
  geom geometry(Polygon, 5181),
  parcel_address text
);
CREATE INDEX IF NOT EXISTS road_use_ledger_jijuk_parent_id_idx ON layer.road_use_ledger_jijuk (parent_id);
CREATE INDEX IF NOT EXISTS road_use_ledger_jijuk_geom_gix ON layer.road_use_ledger_jijuk USING GIST (geom);

CREATE TABLE IF NOT EXISTS layer.memo (
  memo_key SERIAL PRIMARY KEY,
  geom geometry(Point, 5181),
  memo_title text,
  memo_contents text,
  memo_create_date text,
  memo_create_user text,
  memo_create_group text,
  memo_is_del boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS memo_geom_gix ON layer.memo USING GIST (geom);
