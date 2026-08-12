-- 점사용료 테이블 분리: ngl_fee_list → water_ngl_fee_list + road/public 신설
-- Agent가 자동 실행하지 않음. 운영 DB에 수동 적용.

BEGIN;

-- 1) 기존 통합 테이블을 하천용으로 이름 변경 (없으면 스킵)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'layer' AND table_name = 'ngl_fee_list'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'layer' AND table_name = 'water_ngl_fee_list'
  ) THEN
    ALTER TABLE layer.ngl_fee_list RENAME TO water_ngl_fee_list;
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ngl_fee_list_lvy_rcvmt_key'
    ) THEN
      ALTER TABLE layer.water_ngl_fee_list
        RENAME CONSTRAINT ngl_fee_list_lvy_rcvmt_key TO water_ngl_fee_list_lvy_rcvmt_key;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'layer' AND c.relname = 'ngl_fee_list_geom_gix'
    ) THEN
      ALTER INDEX layer.ngl_fee_list_geom_gix RENAME TO water_ngl_fee_list_geom_gix;
    END IF;
  END IF;
END $$;

-- 2) 도로·국공유지: 하천 테이블 구조 복사 (데이터 없음)
CREATE TABLE IF NOT EXISTS layer.road_ngl_fee_list (LIKE layer.water_ngl_fee_list INCLUDING ALL);
CREATE TABLE IF NOT EXISTS layer.public_ngl_fee_list (LIKE layer.water_ngl_fee_list INCLUDING ALL);

-- 유니크 제약 이름이 LIKE INCLUDING ALL 로 충돌할 수 있으면 — 필요 시 재명명
DO $$
BEGIN
  -- road
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'layer.road_ngl_fee_list'::regclass
      AND conname = 'water_ngl_fee_list_lvy_rcvmt_key'
  ) THEN
    ALTER TABLE layer.road_ngl_fee_list
      RENAME CONSTRAINT water_ngl_fee_list_lvy_rcvmt_key TO road_ngl_fee_list_lvy_rcvmt_key;
  END IF;
  -- public
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'layer.public_ngl_fee_list'::regclass
      AND conname = 'water_ngl_fee_list_lvy_rcvmt_key'
  ) THEN
    ALTER TABLE layer.public_ngl_fee_list
      RENAME CONSTRAINT water_ngl_fee_list_lvy_rcvmt_key TO public_ngl_fee_list_lvy_rcvmt_key;
  END IF;
END $$;

COMMENT ON TABLE layer.water_ngl_fee_list IS '하천점사용료 미납·수납';
COMMENT ON TABLE layer.road_ngl_fee_list IS '도로점사용료 미납·수납';
COMMENT ON TABLE layer.public_ngl_fee_list IS '국공유지점사용료 미납·수납';

COMMIT;
