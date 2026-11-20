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
export const MOCK_AGENCY_COMM_RATES: Record<string, number> = {
  가람환경기술: 88,
  디오솔류션: 72,
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

/**
 * 기기 수 = 실시간 센서 건수(없으면 odor_ph 스냅샷 건수).
 * 등급 합·포인트 수 = 기기 수. 읍면동 색은 포인트 등급에서 유도.
 */
export function buildDashboardGradeMock(sensors: SensorLike[]): {
  deviceTotal: number;
  gradeCounts: OdorGradeCounts;
  points: OdorGradePointMock[];
  emdStatuses: EmdGradeStatusMock[];
} {
  const source: SensorLike[] =
    sensors.length > 0
      ? sensors
      : MOCK_ODOR_SENSORS_FROM_DB.map((s) => ({
          sensorKey: s.sensorKey,
          agency: s.agency,
          sensorNm: s.sensorNm,
          sensorKorNm: s.sensorKorNm,
          lon: s.lon,
          lat: s.lat,
        }));
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
  // 업체 통신율에 맞춰 개별 기기 정상/이상 비율 맞춤
  return seed % 100 < agencyRate;
}

/**
 * agency(업체) → 하위 sensor.
 * 실시간 sensors 우선, 없으면 odor_ph DB 스냅샷 목업.
 * 통신 정상/통신율만 목업.
 */
export function buildAgencyDeviceGroups(
  sensors: Array<{
    sensorKey: number;
    agency: string | null;
    sensorNm: string | null;
    sensorKorNm: string | null;
  }>
): AgencyDeviceGroupMock[] {
  const source =
    sensors.length > 0
      ? sensors
      : MOCK_ODOR_SENSORS_FROM_DB.map((s) => ({
          sensorKey: s.sensorKey,
          agency: s.agency,
          sensorNm: s.sensorNm,
          sensorKorNm: s.sensorKorNm,
        }));

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
