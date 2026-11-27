/**
 * odor_ph DB `odor_linkage.odor_sensor` 스냅샷 (2026-11-18 조회, WGS84).
 * 런타임은 DB 미접속·타 프로젝트에서도 동일 목업 사용.
 */
export type OdorSensorMockRow = {
  sensorKey: number;
  agency: string;
  sensorNm: string;
  sensorKorNm: string;
  lon: number;
  lat: number;
};

export const MOCK_ODOR_SENSORS_FROM_DB: ReadonlyArray<OdorSensorMockRow> = [
  { sensorKey: 1, agency: '가람환경기술', sensorNm: 'A1', sensorKorNm: '제동꽃집', lon: 129.3671570907434, lat: 36.03578294691696 },
  { sensorKey: 2, agency: '가람환경기술', sensorNm: 'A2', sensorKorNm: '순자수산', lon: 129.3683438204614, lat: 36.0366086829965 },
  { sensorKey: 3, agency: '가람환경기술', sensorNm: 'A3', sensorKorNm: '선산회식당', lon: 129.36822182804787, lat: 36.03623943566647 },
  { sensorKey: 4, agency: '가람환경기술', sensorNm: 'A4', sensorKorNm: '동남대게수산', lon: 129.36886577128018, lat: 36.03551717974927 },
  { sensorKey: 5, agency: '가람환경기술', sensorNm: 'A5', sensorKorNm: '운하 회/대게식당', lon: 129.36977883742844, lat: 36.03563202411568 },
  { sensorKey: 6, agency: '가람환경기술', sensorNm: 'A6', sensorKorNm: '새마을금고', lon: 129.36876777847513, lat: 36.03511592391623 },
  { sensorKey: 7, agency: '가람환경기술', sensorNm: 'A7', sensorKorNm: '케렌시아', lon: 129.3667471039069, lat: 36.03496438621267 },
  { sensorKey: 8, agency: '가람환경기술', sensorNm: 'A8', sensorKorNm: '만물상회', lon: 129.36678444072854, lat: 36.03472939149099 },
  { sensorKey: 9, agency: '가람환경기술', sensorNm: 'A9', sensorKorNm: '산체상회', lon: 129.36888522759415, lat: 36.03468563243269 },
  { sensorKey: 10, agency: '가람환경기술', sensorNm: 'A10', sensorKorNm: '경안상회', lon: 129.36794653123866, lat: 36.03399240154841 },
  { sensorKey: 11, agency: '가람환경기술', sensorNm: 'A11', sensorKorNm: '연지건어물', lon: 129.36899496190534, lat: 36.03436811701754 },
  { sensorKey: 12, agency: '가람환경기술', sensorNm: 'A12', sensorKorNm: '미도건어물', lon: 129.36921544368445, lat: 36.03478497104546 },
  { sensorKey: 13, agency: '가람환경기술', sensorNm: 'A13', sensorKorNm: '포항수산냉동', lon: 129.37010145602616, lat: 36.0350152240525 },
  { sensorKey: 14, agency: '가람환경기술', sensorNm: 'A14', sensorKorNm: '오라수산', lon: 129.3703988646214, lat: 36.034205209107206 },
  { sensorKey: 15, agency: '가람환경기술', sensorNm: 'A15', sensorKorNm: '공영주차장', lon: 129.36990931679844, lat: 36.034156326540426 },
  { sensorKey: 16, agency: '디오솔류션', sensorNm: '1', sensorKorNm: '영일대 #1', lon: 129.37991790741498, lat: 36.06059337875942 },
  { sensorKey: 17, agency: '디오솔류션', sensorNm: '4', sensorKorNm: '영일대 #4', lon: 129.38475206012723, lat: 36.0645066274399 },
  { sensorKey: 18, agency: '삼도환경', sensorNm: 'S1', sensorKorNm: '해도항 #1', lon: 129.375412, lat: 36.048216 },
  { sensorKey: 19, agency: '삼도환경', sensorNm: 'S2', sensorKorNm: '해도항 #2', lon: 129.376891, lat: 36.049104 },
  { sensorKey: 20, agency: '삼도환경', sensorNm: 'S3', sensorKorNm: '송도해변', lon: 129.372055, lat: 36.051883 },
  { sensorKey: 21, agency: '삼도환경', sensorNm: 'S4', sensorKorNm: '죽도시장 인근', lon: 129.365812, lat: 36.029447 },
];
