/**
 * 악취 센서 (odor_linkage 스키마)
 * odor_ph 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { customType, pgSchema, serial, varchar } from 'drizzle-orm/pg-core';

const odorLinkage = pgSchema('odor_linkage');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const odorSensor = odorLinkage.table('odor_sensor', {
  sensorKey: serial('sensor_key').primaryKey().notNull(),
  agency: varchar('agency'),
  sensorNm: varchar('sensor_nm'),
  sensorKorNm: varchar('sensor_kor_nm'),
  geom: geomPoint5181('geom'),
});

export type OdorSensor = typeof odorSensor.$inferSelect;

export const odorSensorTableComment = '악취 센서';

export const odorSensorColumnComments: Record<string, string> = {
  sensor_key: '센서 키',
  agency: '기관',
  sensor_nm: '센서명',
  sensor_kor_nm: '센서 한글명',
  geom: '위치',
};
