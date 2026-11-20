/**
 * 악취 센서 (odor_linkage.odor_sensor) — odor_ph Index 대시보드용
 * 런타임은 odor_ph DB 스냅샷 목업만 사용 (타 프로젝트·DB 미접속 시 동일).
 */
import { MOCK_ODOR_SENSORS_FROM_DB } from './odorSensorMock';

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

/** odor_ph DB 스냅샷 목업 → 목록 형식 */
function mockSensors(): OdorSensorListItem[] {
  return MOCK_ODOR_SENSORS_FROM_DB.map((s) => ({
    sensorKey: s.sensorKey,
    agency: s.agency,
    sensorNm: s.sensorNm,
    sensorKorNm: s.sensorKorNm,
    lon: s.lon,
    lat: s.lat,
  }));
}

/** 센서 목록 (키·기관·센서명·한글명·좌표) — 목업 */
export async function listSensors(
  _params: Record<string, unknown> = {}
): Promise<OdorSensorListItem[]> {
  return mockSensors();
}
