/**
 * 악취 센서 (odor_linkage.odor_sensor) — odor_ph Index 대시보드용
 */
import { db } from '@/database/db';
import { odorSensor } from '@/database/schema';
import { asc, sql } from 'drizzle-orm';

export type OdorSensorListItem = {
  sensorKey: number;
  agency: string | null;
  sensorNm: string | null;
  sensorKorNm: string | null;
  /** WGS84 경도 (없으면 null) */
  lon: number | null;
  /** WGS84 위도 (없으면 null) */
  lat: number | null;
};

/** 센서 목록 (키·기관·센서명·한글명·좌표) */
export async function listSensors(
  _params: Record<string, unknown> = {}
): Promise<OdorSensorListItem[]> {
  const rows = await db
    .select({
      sensorKey: odorSensor.sensorKey,
      agency: odorSensor.agency,
      sensorNm: odorSensor.sensorNm,
      sensorKorNm: odorSensor.sensorKorNm,
      lon: sql<string | null>`CASE WHEN ${odorSensor.geom} IS NULL THEN NULL ELSE ST_X(ST_Transform(${odorSensor.geom}, 4326)) END`,
      lat: sql<string | null>`CASE WHEN ${odorSensor.geom} IS NULL THEN NULL ELSE ST_Y(ST_Transform(${odorSensor.geom}, 4326)) END`,
    })
    .from(odorSensor)
    .orderBy(asc(odorSensor.agency), asc(odorSensor.sensorKey));

  return rows.map((r) => {
    const lon = r.lon != null && r.lon !== '' ? Number(r.lon) : null;
    const lat = r.lat != null && r.lat !== '' ? Number(r.lat) : null;
    return {
      sensorKey: r.sensorKey,
      agency: r.agency ?? null,
      sensorNm: r.sensorNm ?? null,
      sensorKorNm: r.sensorKorNm ?? null,
      lon: lon != null && Number.isFinite(lon) ? lon : null,
      lat: lat != null && Number.isFinite(lat) ? lat : null,
    };
  });
}
