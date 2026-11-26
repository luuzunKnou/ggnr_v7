-- 교량(a0070000) 면형 → 방향 맞는 양쪽 선형 뷰 (EPSG:5181 MultiLineString)
-- 전 프로젝트 적용: npx tsx scripts/setup-a0070000-ls.ts all dev
-- (a0070000 있는 DB만 생성. rdid/brdg_name 없으면 스크립트가 NULL 처리)

CREATE OR REPLACE VIEW layer.a0070000_ls AS
WITH parts AS (
  SELECT ogc_fid, rdid, brdg_name,
         ST_OrientedEnvelope((ST_Dump(geom)).geom) AS env
  FROM layer.a0070000
  WHERE geom IS NOT NULL
    AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
),
p AS (
  SELECT ogc_fid, rdid, brdg_name,
    ST_PointN(ST_ExteriorRing(env), 1) a,
    ST_PointN(ST_ExteriorRing(env), 2) b,
    ST_PointN(ST_ExteriorRing(env), 3) c,
    ST_PointN(ST_ExteriorRing(env), 4) d
  FROM parts
  WHERE ST_GeometryType(env) = 'ST_Polygon'
),
s AS (
  SELECT ogc_fid, rdid, brdg_name,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN a ELSE b END AS a,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN b ELSE c END AS b,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN c ELSE d END AS c,
    CASE WHEN ST_Distance(a, b) >= ST_Distance(b, c) THEN d ELSE a END AS d
  FROM p
),
v AS (
  SELECT ogc_fid, rdid, brdg_name,
    ST_X(a) ax, ST_Y(a) ay, ST_X(b) bx, ST_Y(b) by,
    ST_X(c) cx, ST_Y(c) cy, ST_X(d) dx, ST_Y(d) dy,
    ST_Distance(a, b) lab, ST_Distance(a, d) lad,
    3.0 AS f,
    2.0 AS w
  FROM s
),
u AS (
  SELECT *,
    (bx - ax) / lab AS ux, (by - ay) / lab AS uy,
    (ax - dx) / lad AS nx, (ay - dy) / lad AS ny
  FROM v
  WHERE lab > 0 AND lad > 0
),
l AS (
  SELECT ogc_fid, rdid, brdg_name,
    ST_MakeLine(ARRAY[
      ST_MakePoint(ax - ux * f + nx * w, ay - uy * f + ny * w),
      ST_MakePoint(ax, ay),
      ST_MakePoint(bx, by),
      ST_MakePoint(bx + ux * f + nx * w, by + uy * f + ny * w)
    ]) AS line1,
    ST_MakeLine(ARRAY[
      ST_MakePoint(dx - ux * f - nx * w, dy - uy * f - ny * w),
      ST_MakePoint(dx, dy),
      ST_MakePoint(cx, cy),
      ST_MakePoint(cx + ux * f - nx * w, cy + uy * f - ny * w)
    ]) AS line2
  FROM u
)
SELECT ogc_fid,
       rdid,
       brdg_name,
       ST_SetSRID(ST_Multi(ST_Collect(x)), 5181)::geometry(MultiLineString, 5181) AS geom
FROM l, LATERAL unnest(ARRAY[line1, line2]) AS x
GROUP BY ogc_fid, rdid, brdg_name;

COMMENT ON VIEW layer.a0070000_ls IS '교량(a0070000) 양쪽 선형 표현 뷰';
