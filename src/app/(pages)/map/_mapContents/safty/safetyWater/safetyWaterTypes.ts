export type SafetyWaterStationKind = 'water' | 'rain';

/** HRFCO 관측 시간 단위 */
export type FloodTimeType = '10M' | '1H' | '1D';

export type SafetyWaterStation = {
  id: string;
  code: string;
  kind: SafetyWaterStationKind;
  name: string;
  lon: number;
  lat: number;
  address: string;
};

export type SafetyWaterObservation = {
  code: string;
  value: number | null;
  observedAt: string;
  /** 관측값을 가져온 관측소 이름 (근접 매칭 시 상대 관측소명) */
  stationName?: string;
  /** 전체 평균 모드 */
  isAverage?: boolean;
  /** 평균에 사용된 건수 */
  averageCount?: number;
};

export type FloodBatchKindAvg = {
  average: number | null;
  count: number;
  observedAt: string;
};

export type SafetyWaterStatPoint = {
  date: string;
  value: number | null;
  count: number;
};

export type SafetyWaterRiskArea = {
  id: string;
  name: string;
  riskLevel: string;
  note: string;
  lon: number;
  lat: number;
};

/** 피해 예상 더미 필지 (지도 폴리곤 + 목록) */
export type SafetyWaterDummyRisk = SafetyWaterRiskArea & {
  /** 관측소에 가까울수록 1에 가까움(진한 파랑). 0~1 */
  proximity: number;
  /** 닫힌 링 [lon, lat][] — 필지형(네모·불규칙) */
  ring: [number, number][];
};

export type FloodErrorClass = 'provider' | 'ours';

export type FloodUiError = {
  errorClass: FloodErrorClass;
  uiMessage: string;
  code?: number;
};

/** 홍수예보 발령 (fldfct) — STTNM은 내부·필터용, UI 미표시 */
export type SafetyWaterForecast = {
  /** 발표일시 */
  ancdt: string;
  /** 발표자 */
  ancnm: string;
  /** 수위 도달 예상일시 */
  fctdt: string;
  /** 홍수예보 종류 */
  kind: string;
  /** 홍수예보 번호 */
  no: string;
  /** 지점 */
  obsnm: string;
  /** 강명 */
  rvrnm: string;
  /** 현재 일시 */
  sttcurdt: string;
  /** 현재 수위표수위 */
  sttcurhgt: string;
  /** 현재 해발수위 */
  sttcursealvl: string;
  /** 관측소 코드 (UI 미표시) */
  sttnm: string;
  /** 주의 지역 */
  wrnaranm: string;
};
