export type SafetyWaterStationKind = 'water' | 'rain';

/** HRFCO 관측 시간 단위 */
export type FloodTimeType = '10M' | '1H' | '1D';

/** 수위 관측소 제원 기준수위 (한강홍수통제소 waterlevel/info) */
export type SafetyWaterLevelThresholds = {
  /** 영점표고 EL.m */
  gdt: number | null;
  /** 관심 수위 m */
  attwl: number | null;
  /** 주의보 수위 m */
  wrnwl: number | null;
  /** 경보 수위 m */
  almwl: number | null;
  /** 심각 수위 m */
  srswl: number | null;
  /** 계획홍수위 m */
  pfh: number | null;
};

export type SafetyWaterStation = {
  id: string;
  code: string;
  kind: SafetyWaterStationKind;
  name: string;
  lon: number;
  lat: number;
  address: string;
} & Partial<SafetyWaterLevelThresholds>;

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
  /** 심각도 시각용 0~1 (진한 파랑일수록 높음) */
  proximity: number;
  /** 닫힌 링 [lon, lat][] */
  ring: [number, number][];
  elevM?: number;
  distM?: number;
  depthM?: number;
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
