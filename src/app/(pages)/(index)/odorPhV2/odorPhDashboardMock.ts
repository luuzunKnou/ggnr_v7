/** odor_ph Index 대시보드 목업 — 통신율·등급·경보·읍면동·포인트 */

import { MOCK_ODOR_SENSORS_FROM_DB } from '@/service/odorSensorMock'

export { MOCK_ODOR_SENSORS_FROM_DB }

export type OdorGrade = 1 | 2 | 3 | 4 | 5;

export type OdorGradeStatus = 'normal' | 'caution' | 'warning';

export type AgencyCommRateMock = {
  agency: string;
  /** 0~100 */
  rate: number;
  /** DB 센서 없을 때 기기 수 목업 */
  deviceCount: number;
};

export type OdorGradeCounts = Record<OdorGrade, number>;

export type OdorAlertItem = {
  id: string;
  /** 센서 한글명 (목록 제목) */
  sensorKorNm: string;
  /** 센서 영문명 */
  sensorNm: string;
  agency: string;
  grade: OdorGrade;
  occurredAt: string;
  /** 인지 여부 (주의 경보 태그) */
  confirmed: boolean;
  /** ppm 측정값 */
  ppm: number;
  /** 저감설비 가동 여부 */
  abatementRunning: boolean;
  emdNm: string;
};

export type EmdGradeStatusMock = {
  emdCd: string;
  emdNm: string;
  status: OdorGradeStatus;
};

/** 지도 포인트 (WGS84) — 등급 분포와 건수 일치 */
export type OdorGradePointMock = {
  id: string;
  lon: number;
  lat: number;
  grade: OdorGrade;
  status: OdorGradeStatus;
  emdNm: string;
  label: string;
  agency: string;
};

/** @deprecated MOCK_ODOR_SENSORS_FROM_DB 기반 집계 사용 */
export const MOCK_FALLBACK_AGENCIES: AgencyCommRateMock[] = [
  { agency: '가람환경기술', rate: 88, deviceCount: 15 },
  { agency: '디오솔류션', rate: 72, deviceCount: 2 },
  { agency: '삼도환경', rate: 81, deviceCount: 4 },
];

/** 업체 아코디언용 기기 1대 */
export type AgencyDeviceMock = {
  id: string;
  label: string;
  /** 통신 정상 여부 목업 */
  online: boolean;
};

/** 업체 단위 기기 그룹 (기기수·통신율 + 하위 기기) */
export type AgencyDeviceGroupMock = {
  agency: string;
  deviceCount: number;
  rate: number;
  devices: AgencyDeviceMock[];
};

/** agency → 통신 정상율(%) 시드 목업 (실테이블에 통신율 컬럼 없음) */
/** 업체 비상연락·문의 담당 */
export type AgencyContactMock = {
  agency: string
  name: string
  title: string
  phone: string
  email: string
}

export const MOCK_AGENCY_CONTACTS: AgencyContactMock[] = [
  {
    agency: '디오솔류션',
    name: '이영곤',
    title: '과장',
    phone: '010-5737-5700',
    email: 'cnptommy@gmail.com',
  },
  {
    agency: '가람환경기술',
    name: '황상석',
    title: '상무이사',
    phone: '010-4388-0130',
    email: 'ss.hwang@thegaram.com',
  },
  {
    agency: '삼도환경',
    name: '정재용',
    title: '연구원',
    phone: '010-2665-0040',
    email: 'samdo@plalus.jp',
  },
]

export function resolveAgencyContact(agency: string): AgencyContactMock | null {
  const key = agency.trim()
  return MOCK_AGENCY_CONTACTS.find((c) => c.agency === key) ?? null
}

export const MOCK_AGENCY_COMM_RATES: Record<string, number> = {
  가람환경기술: 88,
  디오솔류션: 72,
  삼도환경: 81,
  포항맑은물: 92,
  동해환경: 71,
  영일만측정: 48,
  구룡포관측: 22,
  남구사업소: 85,
  북구사업소: 55,
  장기면측정: 30,
};

export const MOCK_CAUTION_ALERTS: OdorAlertItem[] = [
  {
    id: 'c-1',
    sensorKorNm: '제동꽃집',
    sensorNm: 'A1',
    agency: '가람환경기술',
    grade: 3,
    occurredAt: '2026-11-16T10:42:00+09:00',
    confirmed: false,
    ppm: 3.2,
    abatementRunning: true,
    emdNm: '장량동',
  },
  {
    id: 'c-2',
    sensorKorNm: '순자수산',
    sensorNm: 'A2',
    agency: '가람환경기술',
    grade: 3,
    occurredAt: '2026-11-16T09:18:00+09:00',
    confirmed: false,
    ppm: 2.8,
    abatementRunning: false,
    emdNm: '양덕동',
  },
  {
    id: 'c-3',
    sensorKorNm: '영일대 #1',
    sensorNm: '1',
    agency: '디오솔류션',
    grade: 3,
    occurredAt: '2026-11-15T22:05:00+09:00',
    confirmed: true,
    ppm: 3.0,
    abatementRunning: true,
    emdNm: '구룡포읍',
  },
  {
    id: 'c-4',
    sensorKorNm: '선산회식당',
    sensorNm: 'A3',
    agency: '가람환경기술',
    grade: 3,
    occurredAt: '2026-11-15T18:40:00+09:00',
    confirmed: true,
    ppm: 2.6,
    abatementRunning: false,
    emdNm: '흥해읍',
  },
  {
    id: 'c-5',
    sensorKorNm: '영일대 #4',
    sensorNm: '4',
    agency: '디오솔류션',
    grade: 3,
    occurredAt: '2026-11-15T14:12:00+09:00',
    confirmed: false,
    ppm: 3.5,
    abatementRunning: true,
    emdNm: '상대동',
  },
];

export const MOCK_RECENT_ALERTS: OdorAlertItem[] = [
  {
    id: 'r-1',
    sensorKorNm: '동남대게수산',
    sensorNm: 'A4',
    agency: '가람환경기술',
    grade: 4,
    occurredAt: '2026-11-16T11:05:00+09:00',
    confirmed: false,
    ppm: 5.1,
    abatementRunning: true,
    emdNm: '해도동',
  },
  {
    id: 'r-2',
    sensorKorNm: '제동꽃집',
    sensorNm: 'A1',
    agency: '가람환경기술',
    grade: 3,
    occurredAt: '2026-11-16T10:42:00+09:00',
    confirmed: false,
    ppm: 3.2,
    abatementRunning: true,
    emdNm: '장량동',
  },
  {
    id: 'r-3',
    sensorKorNm: '운하 회/대게식당',
    sensorNm: 'A5',
    agency: '가람환경기술',
    grade: 5,
    occurredAt: '2026-11-16T10:11:00+09:00',
    confirmed: false,
    ppm: 8.4,
    abatementRunning: true,
    emdNm: '오천읍',
  },
  {
    id: 'r-4',
    sensorKorNm: '순자수산',
    sensorNm: 'A2',
    agency: '가람환경기술',
    grade: 3,
    occurredAt: '2026-11-16T09:18:00+09:00',
    confirmed: false,
    ppm: 2.8,
    abatementRunning: false,
    emdNm: '양덕동',
  },
  {
    id: 'r-5',
    sensorKorNm: '영일대 #1',
    sensorNm: '1',
    agency: '디오솔류션',
    grade: 4,
    occurredAt: '2026-11-16T08:55:00+09:00',
    confirmed: true,
    ppm: 4.7,
    abatementRunning: false,
    emdNm: '연일읍',
  },
  {
    id: 'r-6',
    sensorKorNm: '새마을금고',
    sensorNm: 'A6',
    agency: '가람환경기술',
    grade: 2,
    occurredAt: '2026-11-16T07:30:00+09:00',
    confirmed: true,
    ppm: 1.4,
    abatementRunning: false,
    emdNm: '대이동',
  },
];

/** 포항 읍면동 대략 중심 (WGS84) — 포인트·폴리곤 매칭용 */
export const MOCK_EMD_CENTROIDS: Array<{ emdCd: string; emdNm: string; lon: number; lat: number }> = [
  { emdCd: '47110101', emdNm: '상도동', lon: 129.365, lat: 36.032 },
  { emdCd: '47110102', emdNm: '대도동', lon: 129.358, lat: 36.025 },
  { emdCd: '47110103', emdNm: '해도동', lon: 129.372, lat: 36.018 },
  { emdCd: '47110104', emdNm: '송도동', lon: 129.378, lat: 36.01 },
  { emdCd: '47110105', emdNm: '청림동', lon: 129.39, lat: 35.995 },
  { emdCd: '47110106', emdNm: '제철동', lon: 129.405, lat: 35.985 },
  { emdCd: '47110107', emdNm: '효곡동', lon: 129.345, lat: 36.045 },
  { emdCd: '47110108', emdNm: '대잠동', lon: 129.352, lat: 36.038 },
  { emdCd: '47110109', emdNm: '이동', lon: 129.36, lat: 36.028 },
  { emdCd: '47110110', emdNm: '환호동', lon: 129.385, lat: 36.055 },
  { emdCd: '47110111', emdNm: '여남동', lon: 129.395, lat: 36.048 },
  { emdCd: '47110112', emdNm: '상대동', lon: 129.34, lat: 36.02 },
  { emdCd: '47110113', emdNm: '장량동', lon: 129.335, lat: 36.065 },
  { emdCd: '47110114', emdNm: '양덕동', lon: 129.355, lat: 36.07 },
  { emdCd: '47110115', emdNm: '죽도동', lon: 129.365, lat: 36.04 },
  { emdCd: '47110116', emdNm: '용흥동', lon: 129.35, lat: 36.05 },
  { emdCd: '47110117', emdNm: '우창동', lon: 129.375, lat: 36.06 },
  { emdCd: '47110118', emdNm: '두호동', lon: 129.38, lat: 36.065 },
  { emdCd: '47110119', emdNm: '장성동', lon: 129.37, lat: 36.075 },
  { emdCd: '47110120', emdNm: '중앙동', lon: 129.365, lat: 36.035 },
  { emdCd: '47110250', emdNm: '구룡포읍', lon: 129.55, lat: 35.99 },
  { emdCd: '47110253', emdNm: '연일읍', lon: 129.32, lat: 36.0 },
  { emdCd: '47110256', emdNm: '오천읍', lon: 129.42, lat: 35.97 },
  { emdCd: '47110310', emdNm: '대송면', lon: 129.3, lat: 35.98 },
  { emdCd: '47110320', emdNm: '동해면', lon: 129.48, lat: 36.05 },
  { emdCd: '47110330', emdNm: '장기면', lon: 129.5, lat: 36.08 },
  { emdCd: '47110340', emdNm: '호미곶면', lon: 129.57, lat: 36.08 },
  { emdCd: '47110360', emdNm: '흥해읍', lon: 129.34, lat: 36.11 },
  { emdCd: '47110370', emdNm: '신광면', lon: 129.28, lat: 36.12 },
  { emdCd: '47110380', emdNm: '청하면', lon: 129.3, lat: 36.15 },
  { emdCd: '47110390', emdNm: '송라면', lon: 129.35, lat: 36.18 },
  { emdCd: '47110400', emdNm: '기계면', lon: 129.25, lat: 36.1 },
  { emdCd: '47110410', emdNm: '죽장면', lon: 129.22, lat: 36.14 },
  { emdCd: '47110420', emdNm: '기북면', lon: 129.2, lat: 36.08 },
];

export function gradeToStatus(grade: OdorGrade): OdorGradeStatus {
  if (grade <= 2) return 'normal';
  if (grade === 3) return 'caution';
  return 'warning';
}

export function sumGradeGroup(counts: OdorGradeCounts): {
  normal: number;
  caution: number;
  warning: number;
} {
  return {
    normal: counts[1] + counts[2],
    caution: counts[3],
    warning: counts[4] + counts[5],
  };
}

/** 저감설비 가동 대수 목업 (등급 합과 무관) */
export function mockAbatementRunningCount(deviceTotal: number): number {
  const n = Math.max(0, Math.floor(deviceTotal));
  if (n === 0) return 0;
  return Math.max(1, Math.round(n * 0.35));
}

/** 대시보드·P52 민원 관리 목업. 화면 표시는 완료→처리완료 */
export type OdorComplaintStatus = '접수' | '처리중' | '완료'

export type OdorComplaintLinkMock = {
  id: string
  title: string
  emdNm: string
  status: OdorComplaintStatus
  receivedAt: string
  /** 연관 센서 표시명(있으면) */
  sensorLabel?: string
  /** 민원 유형 */
  type?: string
  /** 민원인 */
  complainant?: string
  phone?: string
  /** 처리기한 ISO */
  dueAt?: string
  /** 상세 내용 */
  content?: string
  /** 위치 메모(주소 등) */
  locationNote?: string
  /** WGS84 경도 */
  lon?: number | null
  /** WGS84 위도 */
  lat?: number | null
}

export function odorComplaintStatusLabel(status: OdorComplaintStatus): string {
  return status === '완료' ? '처리완료' : status
}

/** 미완료 + 기한 지남 */
export function isOdorComplaintOverdue(
  c: Pick<OdorComplaintLinkMock, 'status' | 'dueAt'>,
  now = new Date()
): boolean {
  if (c.status === '완료' || !c.dueAt) return false
  const due = new Date(c.dueAt)
  if (Number.isNaN(due.getTime())) return false
  return due.getTime() < now.getTime()
}

export const MOCK_ODOR_COMPLAINT_LINKS: OdorComplaintLinkMock[] = [
  {
    id: 'cp-1',
    title: '하수맨홀 악취 지속',
    emdNm: '장량동',
    status: '접수',
    receivedAt: '2026-11-25T08:20:00+09:00',
    dueAt: '2026-11-26T18:00:00+09:00',
    sensorLabel: '공용주차장',
    type: '악취',
    complainant: '김○○',
    phone: '010-1234-5678',
    content: '맨홀 주변에서 저녁마다 악취가 심합니다.',
    locationNote: '장량동 공영주차장 인근',
    lon: 129.3699,
    lat: 36.0342,
  },
  {
    id: 'cp-2',
    title: '야간 악취 민원',
    emdNm: '양덕동',
    status: '처리중',
    receivedAt: '2026-11-25T07:05:00+09:00',
    dueAt: '2026-11-27T18:00:00+09:00',
    sensorLabel: '순자수산',
    type: '악취',
    complainant: '이○○',
    phone: '010-2222-3333',
    content: '야간에 하수구에서 냄새가 납니다.',
    locationNote: '양덕동 시장 일대',
    lon: 129.3683,
    lat: 36.0366,
  },
  {
    id: 'cp-3',
    title: '상가 주변 악취',
    emdNm: '죽도동',
    status: '접수',
    receivedAt: '2026-11-24T19:40:00+09:00',
    dueAt: '2026-11-25T12:00:00+09:00',
    type: '악취',
    complainant: '박○○',
    content: '상가 뒷골목 악취 신고',
    locationNote: '죽도시장 인근',
    lon: 129.3658,
    lat: 36.0294,
  },
  {
    id: 'cp-4',
    title: '맨홀뚜껑 개방 의심',
    emdNm: '흥해읍',
    status: '완료',
    receivedAt: '2026-11-24T14:10:00+09:00',
    dueAt: '2026-11-25T18:00:00+09:00',
    sensorLabel: '선산회식당',
    type: '시설',
    complainant: '최○○',
    content: '맨홀 뚜껑이 열려 악취가 납니다. 조치 완료.',
    locationNote: '흥해읍 중앙로',
    lon: 129.3682,
    lat: 36.0362,
  },
  {
    id: 'cp-5',
    title: '주거지 악취 신고',
    emdNm: '우창동',
    status: '처리중',
    receivedAt: '2026-11-24T11:30:00+09:00',
    dueAt: '2026-11-25T09:00:00+09:00',
    type: '악취',
    complainant: '정○○',
    phone: '010-5555-6666',
    content: '아파트 인근 하수 악취',
    locationNote: '우창동 주거단지',
    lon: 129.3721,
    lat: 36.0519,
  },
  {
    id: 'cp-6',
    title: '해안 산책로 악취',
    emdNm: '환호동',
    status: '접수',
    receivedAt: '2026-11-26T09:10:00+09:00',
    dueAt: '2026-11-28T18:00:00+09:00',
    type: '악취',
    complainant: '한○○',
    content: '산책로 맨홀에서 냄새가 납니다.',
    locationNote: '영일대 해안 산책로',
    lon: 129.3799,
    lat: 36.0606,
  },
]

/** 지점별 저감 가동 목업 — 경보·주의인데 미가동인 건을 일부 남김 */
export function mockPointAbatementRunning(
  sensorKey: string,
  status: OdorGradeStatus
): boolean {
  let h = 0;
  const s = sensorKey || 'x';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  if (status === 'warning') return h % 5 !== 0;
  if (status === 'caution') return h % 3 === 0;
  return h % 4 === 0;
}

/** 테스트용: 시드 기준 약 1/5를 통신오류로 고정 (지점 배지·통신율 공통) */
function mockForceCommOffline(seed: number): boolean {
  return seed % 5 === 0;
}

/** 지점별 통신 정상 목업 — 업체 통신율 시드와 동일 규칙 */
export function mockPointCommOnline(sensorKey: string, agency?: string | null): boolean {
  const n = Number.parseInt(sensorKey, 10);
  const seed = Number.isFinite(n) ? n : [...(sensorKey || 'x')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  if (mockForceCommOffline(seed)) return false;
  const rate = resolveAgencyCommRate(agency ?? '');
  return seed % 100 < rate;
}

/** 기기 대수 N에 맞춰 1~5등급 합 = N */
export function buildGradeCountsForDeviceTotal(deviceTotal: number): OdorGradeCounts {
  const n = Math.max(0, Math.floor(deviceTotal));
  if (n === 0) return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const weights = [0.38, 0.27, 0.18, 0.12, 0.05] as const;
  const raw = weights.map((w) => w * n);
  const floors = raw.map((v) => Math.floor(v));
  let rem = n - floors.reduce((a, b) => a + b, 0);
  const fracIdx = raw
    .map((v, i) => ({ i, f: v - floors[i]! }))
    .sort((a, b) => b.f - a.f);
  const counts = [...floors] as number[];
  for (let k = 0; k < rem; k++) {
    const idx = fracIdx[k % fracIdx.length]!.i;
    counts[idx]! += 1;
  }
  return {
    1: counts[0]!,
    2: counts[1]!,
    3: counts[2]!,
    4: counts[3]!,
    5: counts[4]!,
  };
}

function expandGrades(counts: OdorGradeCounts): OdorGrade[] {
  const out: OdorGrade[] = [];
  for (const g of [1, 2, 3, 4, 5] as const) {
    for (let i = 0; i < counts[g]; i++) out.push(g);
  }
  return out;
}

type SensorLike = {
  sensorKey: number;
  agency: string | null;
  sensorNm: string | null;
  sensorKorNm: string | null;
  lon: number | null;
  lat: number | null;
};

/** 화면 구성용 임시 측정지점(센서) 대수 — 실데이터 확정 전 */
export const ODOR_DASHBOARD_UI_DEVICE_TOTAL = 19;

function toSensorLikeFromMock(): SensorLike[] {
  return MOCK_ODOR_SENSORS_FROM_DB.map((s) => ({
    sensorKey: s.sensorKey,
    agency: s.agency,
    sensorNm: s.sensorNm,
    sensorKorNm: s.sensorKorNm,
    lon: s.lon,
    lat: s.lat,
  }));
}

/** 실시간·스냅샷을 UI 기준 대수로 맞춘다 (부족 시 목업으로 보강). */
function resolveDashboardSensorSource(sensors: SensorLike[]): SensorLike[] {
  const target = ODOR_DASHBOARD_UI_DEVICE_TOTAL;
  const base = sensors.length > 0 ? sensors : toSensorLikeFromMock();
  if (base.length >= target) return base.slice(0, target);

  const out = [...base];
  const seen = new Set(out.map((s) => s.sensorKey));
  for (const m of toSensorLikeFromMock()) {
    if (out.length >= target) break;
    if (seen.has(m.sensorKey)) continue;
    seen.add(m.sensorKey);
    out.push(m);
  }
  let pad = 9000;
  while (out.length < target) {
    const key = pad++;
    out.push({
      sensorKey: key,
      agency: '미지정',
      sensorNm: `P${key}`,
      sensorKorNm: `임시지점 ${out.length + 1}`,
      lon: null,
      lat: null,
    });
  }
  return out;
}

/**
 * 기기 수 = UI 기준 대수(임시 19).
 * 등급 합·포인트 수 = 기기 수. 읍면동 색은 포인트 등급에서 유도.
 */
export function buildDashboardGradeMock(sensors: SensorLike[]): {
  deviceTotal: number;
  gradeCounts: OdorGradeCounts;
  points: OdorGradePointMock[];
  emdStatuses: EmdGradeStatusMock[];
} {
  const source = resolveDashboardSensorSource(sensors);
  const deviceTotal = source.length;

  const gradeCounts = buildGradeCountsForDeviceTotal(deviceTotal);
  const grades = expandGrades(gradeCounts);
  const centroids = MOCK_EMD_CENTROIDS;
  const points: OdorGradePointMock[] = [];

  for (let i = 0; i < grades.length; i++) {
    const grade = grades[i]!;
    const sensor = source[i];
    const emd = centroids[i % centroids.length]!;
    const hasGeom =
      sensor &&
      sensor.lon != null &&
      sensor.lat != null &&
      Number.isFinite(sensor.lon) &&
      Number.isFinite(sensor.lat);

    const jitter = ((i % 7) - 3) * 0.004;
    const lon = hasGeom ? sensor!.lon! : emd.lon + jitter;
    const lat = hasGeom ? sensor!.lat! : emd.lat + ((i % 5) - 2) * 0.003;
    const label =
      (sensor?.sensorKorNm || sensor?.sensorNm || '').trim() ||
      `${emd.emdNm}-${String(i + 1).padStart(2, '0')}`;

    points.push({
      id: `pt-${sensor?.sensorKey ?? i + 1}`,
      lon,
      lat,
      grade,
      status: gradeToStatus(grade),
      emdNm: emd.emdNm,
      label,
      agency: (sensor?.agency ?? '').trim() || '미지정',
    });
  }

  const byEmd = new Map<string, OdorGradeStatus>();
  const rank: Record<OdorGradeStatus, number> = { normal: 0, caution: 1, warning: 2 };
  for (const p of points) {
    const cur = byEmd.get(p.emdNm);
    if (!cur || rank[p.status] > rank[cur]) byEmd.set(p.emdNm, p.status);
  }

  const emdStatuses: EmdGradeStatusMock[] = centroids.map((c) => ({
    emdCd: c.emdCd,
    emdNm: c.emdNm,
    status: byEmd.get(c.emdNm) ?? 'normal',
  }));

  return { deviceTotal, gradeCounts, points, emdStatuses };
}

/** 레거시/정적 import용 — 센서 없을 때 읍면동 등급 상태 목업 */
export const MOCK_EMD_GRADE_STATUS: EmdGradeStatusMock[] =
  buildDashboardGradeMock([]).emdStatuses;

/** 통신율 → 신호등 (33.3% 단위) */
export function commRateTrafficColor(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 66.7) return 'green';
  if (rate >= 33.3) return 'yellow';
  return 'red';
}

/** 업체명 → 안정적인 목업 통신율(20~98). 테이블에 통신율 컬럼이 없어 목업만 부여 */
function hashAgencyMockRate(agency: string): number {
  let h = 0;
  for (let i = 0; i < agency.length; i++) h = (h * 31 + agency.charCodeAt(i)) >>> 0;
  return 20 + (h % 79);
}

export function resolveAgencyCommRate(agency: string): number {
  const key = agency.trim();
  if (Object.prototype.hasOwnProperty.call(MOCK_AGENCY_COMM_RATES, key)) {
    return MOCK_AGENCY_COMM_RATES[key]!;
  }
  return hashAgencyMockRate(key || '미분류');
}

function mockDeviceOnline(agencyRate: number, index: number, sensorKey?: number): boolean {
  const seed = sensorKey != null ? sensorKey : index;
  if (mockForceCommOffline(seed)) return false;
  // 업체 통신율에 맞춰 개별 기기 정상/이상 비율 맞춤
  return seed % 100 < agencyRate;
}

/**
 * agency(업체) → 하위 sensor.
 * UI 기준 대수(임시 19)로 맞춤. 통신 정상/통신율만 목업.
 */
export function buildAgencyDeviceGroups(
  sensors: Array<{
    sensorKey: number;
    agency: string | null;
    sensorNm: string | null;
    sensorKorNm: string | null;
  }>
): AgencyDeviceGroupMock[] {
  const source = resolveDashboardSensorSource(
    sensors.map((s) => ({
      sensorKey: s.sensorKey,
      agency: s.agency,
      sensorNm: s.sensorNm,
      sensorKorNm: s.sensorKorNm,
      lon: null,
      lat: null,
    }))
  );

  const map = new Map<string, typeof source>();
  for (const s of source) {
    const agency = (s.agency ?? '').trim() || '미분류';
    const list = map.get(agency) ?? [];
    list.push(s);
    map.set(agency, list);
  }

  return [...map.entries()]
    .map(([agency, list]) => {
      const sorted = [...list].sort((a, b) => a.sensorKey - b.sensorKey);
      const rateSeed = resolveAgencyCommRate(agency);
      const devices: AgencyDeviceMock[] = sorted.map((s, i) => {
        const label =
          (s.sensorKorNm || s.sensorNm || '').trim() || `sensor_key=${s.sensorKey}`;
        return {
          id: String(s.sensorKey),
          label,
          online: mockDeviceOnline(rateSeed, i, s.sensorKey),
        };
      });
      const onlineCount = devices.filter((d) => d.online).length;
      const derivedRate =
        devices.length > 0
          ? Math.round((onlineCount / devices.length) * 1000) / 10
          : rateSeed;
      return {
        agency,
        deviceCount: devices.length,
        rate: derivedRate,
        devices,
      };
    })
    .sort((a, b) => a.agency.localeCompare(b.agency, 'ko'));
}

export function sortCautionAlerts(items: OdorAlertItem[]): OdorAlertItem[] {
  return [...items].sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  });
}

/** YYYY-MM-DD HH:MM */
export function formatAlertTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function gradeDotColor(grade: OdorGrade): string {
  if (grade <= 2) return '#22c55e';
  if (grade === 3) return '#eab308';
  if (grade === 4) return '#f97316';
  return '#ef4444';
}

export const ODOR_GRADE_COLORS: Record<OdorGrade, string> = {
  1: '#2563eb',
  2: '#22c55e',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
};

export function gradeSeverityLabel(grade: OdorGrade): '정상' | '주의' | '심각' {
  if (grade <= 2) return '정상';
  if (grade === 3) return '주의';
  return '심각';
}

export function gradeHintKo(grade: OdorGrade): string {
  switch (grade) {
    case 1:
      return '냄새 거의 없음'
    case 2:
      return '약한 냄새'
    case 3:
      return '뚜렷한 냄새'
    case 4:
      return '강한 냄새'
    case 5:
      return '매우 강한 냄새'
  }
}

/** 하수관로 악취 관리 지침(2020.3) — 관로 내 공기 중 H₂S 상한 */
export function gradeH2sPpmLabel(grade: OdorGrade): string {
  switch (grade) {
    case 1:
      return '≤1ppm'
    case 2:
      return '≤3ppm'
    case 3:
      return '≤5ppm'
    case 4:
      return '≤10ppm'
    case 5:
      return '>10ppm'
  }
}

/** 지점 H₂S 목업 ppm (등급 기반) */
export function mockPpmFromGrade(grade: OdorGrade, seed = 0): number {
  const base: Record<OdorGrade, number> = { 1: 0.4, 2: 1.1, 3: 2.9, 4: 5.2, 5: 8.1 };
  return Math.round((base[grade] + (seed % 7) * 0.07) * 10) / 10;
}

export type TodayTrendHourMock = { hour: number; alertCount: number; avgPpm: number };

/** 시안 G「시간대별 경보」목업 (0~23시) */
export function buildTodayTrendMock(seed = 7): TodayTrendHourMock[] {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const hours: TodayTrendHourMock[] = [];
  for (let h = 0; h <= 23; h++) {
    const base =
      h < 6 ? 0.2 : h < 9 ? 1.2 : h < 12 ? 2.4 : h < 15 ? 3.1 : h < 19 ? 2.6 : h < 22 ? 1.4 : 0.5;
    const alertCount = Math.max(
      0,
      Math.round(base + rnd() * 2.2 - 0.6 + (h === 11 || h === 13 || h === 17 ? 2 : 0))
    );
    const avgPpm = +(
      1.2 +
      (h <= 14 ? h * 0.18 : (24 - h) * 0.12) +
      rnd() * 1.4 +
      (h >= 10 && h <= 18 ? 1.5 : 0)
    ).toFixed(1);
    hours.push({ hour: h, alertCount, avgPpm });
  }
  return hours;
}

/** 업체 기기 통신율 가중 평균 */
export function mockOverallCommRate(
  sensors: Array<{ sensorKey: number; agency: string | null; sensorNm: string | null; sensorKorNm: string | null }>
): number {
  const groups = buildAgencyDeviceGroups(sensors);
  if (groups.length === 0) return 0;
  let online = 0;
  let total = 0;
  for (const g of groups) {
    total += g.deviceCount;
    online += g.devices.filter((d) => d.online).length;
  }
  if (total === 0) return 0;
  return Math.round((online / total) * 100);
}
