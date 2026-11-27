import { bigserial, customType, pgSchema, text } from 'drizzle-orm/pg-core';

/**
 * 소규모 공공시설 — 유형별 후보지 (도형 분리).
 * 위험도등급·점수·현장조사일·조사자는 두지 않음(점검결과로).
 * 점검·평가·정비는 cons_code 로 매핑.
 */
const layer = pgSchema('layer');

const geomLine = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(LineString,5187)';
  },
});

const geomPoint = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5187)';
  },
});

const attrs = {
  consCode: text('cons_code'),
  sisulName: text('sisul_name'),
  shpCode: text('shp_code'),
  emd: text('emd'),
  ri: text('ri'),
  address: text('address'),
  startXy: text('start_xy'),
  endXy: text('end_xy'),
  benArea: text('ben_area'),
  riskDate: text('risk_date'),
  candidate: text('candidate'),
  lne: text('lne'),
  width: text('width'),
  hight: text('hight'),
  parentConsCode: text('parent_cons_code'),
  parentFacName: text('parent_fac_name'),
} as const;

export const spfCreek = layer.table('spf_creek', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...attrs,
  geom: geomLine('geom'),
});

export const spfBridge = layer.table('spf_bridge', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...attrs,
  geom: geomPoint('geom'),
});

export const spfIntake = layer.table('spf_intake', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...attrs,
  geom: geomPoint('geom'),
});

export const spfVillage = layer.table('spf_village', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...attrs,
  geom: geomLine('geom'),
});

export const spfFarm = layer.table('spf_farm', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...attrs,
  geom: geomLine('geom'),
});

export const spfDrop = layer.table('spf_drop', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...attrs,
  geom: geomPoint('geom'),
});
