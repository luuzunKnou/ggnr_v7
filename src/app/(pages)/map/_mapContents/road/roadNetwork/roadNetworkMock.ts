/** 도로망도 임시 데이터·타입 — API 연동 시 교체 */

/** 목록·상세에 표시되는 도로종류 (국지도·입체교차로 포함) */
export const ROAD_NETWORK_TYPES = [
  "국도",
  "지방도",
  "국지도",
  "군도",
  "농도",
  "일반도로",
  "임도",
  "입체교차로",
] as const;
export type RoadNetworkType = (typeof ROAD_NETWORK_TYPES)[number];

/** 목록 필터 탭 — 국지도(국가지원지방도)는 지방도 탭, 입체교차로는 국도 탭에 묶음 */
export const ROAD_NETWORK_TYPE_FILTER_TABS = [
  "전체",
  "국도",
  "지방도",
  "군도",
  "농도",
  "일반도로",
  "임도",
] as const;
export type RoadNetworkTypeFilter = (typeof ROAD_NETWORK_TYPE_FILTER_TABS)[number];

export const ROAD_NETWORK_TYPE_FILTERS: RoadNetworkTypeFilter[] = [...ROAD_NETWORK_TYPE_FILTER_TABS];

/** 필터 탭에 해당 도로종류가 포함되는지 */
export function matchesRoadNetworkTypeFilter(
  roadType: RoadNetworkType,
  filter: RoadNetworkTypeFilter
): boolean {
  if (filter === "전체") return true;
  if (filter === "국도") return roadType === "국도" || roadType === "입체교차로";
  if (filter === "지방도") return roadType === "지방도" || roadType === "국지도";
  return roadType === filter;
}

/** 모든 도로종류 개설/미개설 */
export const ROAD_NETWORK_OPEN_STATUSES = ["개설", "미개설"] as const;
export type RoadNetworkOpenStatus = (typeof ROAD_NETWORK_OPEN_STATUSES)[number];
export type RoadNetworkOpenStatusFilter = "전체" | RoadNetworkOpenStatus;

export const ROAD_NETWORK_OPEN_STATUS_FILTERS: RoadNetworkOpenStatusFilter[] = [
  "전체",
  ...ROAD_NETWORK_OPEN_STATUSES,
];

/** @deprecated 개설여부는 전 종류 사용 — 항상 true */
export function roadTypeHasOpenStatus(_type: RoadNetworkType): boolean {
  return true;
}

export const ROAD_NETWORK_OPEN_STATUS_BADGE: Record<
  RoadNetworkOpenStatus,
  { bg: string; text: string; border: string }
> = {
  개설: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  미개설: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
};

export const ROAD_NETWORK_TYPE_BADGE: Record<
  RoadNetworkType,
  { bg: string; text: string; border: string }
> = {
  국도: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  지방도: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  국지도: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  군도: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  농도: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200" },
  일반도로: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  임도: { bg: "bg-lime-50", text: "text-lime-800", border: "border-lime-200" },
  입체교차로: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
};

export type RoadNetworkGeom =
  | {
      type: "LineString";
      coordinates: [number, number][];
    }
  | {
      type: "MultiLineString";
      coordinates: [number, number][][];
    };

export type RoadNetworkPreviewKind = "image" | "pdf" | "other";

export type RoadNetworkAttachment = {
  id: string;
  name: string;
  sizeLabel: string;
  uploadedAt: string;
  /** 미리보기용 object/data URL (이미지·PDF) */
  previewUrl?: string;
  previewKind?: RoadNetworkPreviewKind;
};

export type RoadNetworkHistoryItem = {
  id: string;
  at: string;
  user: string;
  action: string;
  detail: string;
};

export type RoadNetworkPoint = {
  /** WGS84 경도 */
  lon: number;
  /** WGS84 위도 */
  lat: number;
};

export type RoadNetworkMaintenanceItem = {
  id: string;
  date: string;
  workType: string;
  content: string;
  contractor: string;
  attachments?: RoadNetworkAttachment[];
  /** 현장 위치(지도 점) */
  point?: RoadNetworkPoint | null;
  /** 현장 좌표 역지오코딩 주소 */
  siteAddress?: string;
};

export type RoadNetworkComplaintItem = {
  id: string;
  state: string;
  date: string;
  name: string;
  /** 현장 좌표에서 채운 주소(직접 입력 없음) */
  address: string;
  content: string;
  attachments?: RoadNetworkAttachment[];
  /** 현장 위치(지도 점) */
  point?: RoadNetworkPoint | null;
};

export type RoadNetworkRow = {
  id: string;
  roadName: string;
  roadNo: string;
  roadType: RoadNetworkType;
  /** 개설/미개설 — 모든 도로종류 */
  openStatus: RoadNetworkOpenStatus;
  lengthM: number;
  sect: string;
  /** 담당부서(관리기관 표시명으로 사용) */
  dept: string;
  /** 관리원 */
  manager: string;
  /** 기점 주소(군도·농도 등) */
  startPoint: string;
  /** 종점 주소 */
  endPoint: string;
  /** 기점 좌표(지도 위치 지정) */
  startPointCoord?: RoadNetworkPoint | null;
  /** 종점 좌표(지도 위치 지정) */
  endPointCoord?: RoadNetworkPoint | null;
  /** 입체교차로 등 SHP 속성 — 길이 */
  lengthAttr?: string;
  /** SHP 속성 — 방위 */
  defense?: string;
  /** SHP 속성 — 굴곡도 */
  sinuosity?: string;
  /** 상세사유·상세설명 (alwnc_resn) */
  detailReason?: string;
  /** 주소 (rbp_cn / rep_cn) */
  address?: string;
  designateDate: string;
  /** WGS84 LineString — 지도 강조용. 신규 등록 시 null(미지정) */
  geom: RoadNetworkGeom | null;
  maintenance: RoadNetworkMaintenanceItem[];
  complaints: RoadNetworkComplaintItem[];
  /** 도로 공통 첨부(도면·대장 등) */
  attachments: RoadNetworkAttachment[];
  /** 수정이력 */
  history: RoadNetworkHistoryItem[];
};

/**
 * 울진군 내 실제 도로 노선에 맞춘 대략 LineString (WGS84).
 * 시각화용 임시 좌표이며, 실측 SHP·도로대장 geom과 1:1 일치하지 않는다.
 */
function corridor(coordinates: [number, number][]): RoadNetworkGeom {
  return { type: "LineString", coordinates };
}

/** 국도 7호선 — 동해안(후포→평해→기성→매화→울진읍→죽변→북면) */
const GEOM_ND7 = corridor([
  [129.352, 36.682],
  [129.365, 36.728],
  [129.378, 36.805],
  [129.392, 36.885],
  [129.400, 36.991],
  [129.422, 37.055],
  [129.405, 37.12],
]);

/** 국도 36호선 — 울진읍↔내륙(서면 방향) */
const GEOM_ND36 = corridor([
  [129.4, 36.991],
  [129.35, 36.97],
  [129.28, 36.94],
  [129.22, 36.91],
]);

/** 국도 88호선 — 평해↔내륙(영양 방향) */
const GEOM_ND88 = corridor([
  [129.365, 36.728],
  [129.3, 36.74],
  [129.24, 36.755],
  [129.18, 36.77],
]);

/** 지방도 917 — 북면·내륙 연결 */
const GEOM_LD917 = corridor([
  [129.405, 37.12],
  [129.36, 37.08],
  [129.3, 37.04],
  [129.25, 37.0],
]);

/** 지방도 920 — 근남·매화 일대 */
const GEOM_LD920 = corridor([
  [129.39, 36.92],
  [129.37, 36.9],
  [129.34, 36.88],
  [129.31, 36.86],
]);

/** 군도·농도·일반·임도 — 울진읍·근남·죽변 인근 지선 */
function ujBranch(lon: number, lat: number, dLon: number, dLat: number): RoadNetworkGeom {
  return corridor([
    [lon, lat],
    [lon + dLon * 0.45, lat + dLat * 0.55],
    [lon + dLon, lat + dLat],
  ]);
}

export const MOCK_ROAD_NETWORK_ROWS = [
  {
    id: "1",
    roadName: "국도 7호선",
    roadNo: "7",
    roadType: "국도",
    openStatus: "개설",
    lengthM: 48200,
    sect: "1",
    dept: "도로과 국도팀",
    manager: "김국도",
    startPoint: "울진군 후포면",
    endPoint: "울진군 북면",
    designateDate: "1998-03-12",
    geom: GEOM_ND7,
    maintenance: Array.from({ length: 12 }, (_, i) => ({
      id: `m1-${i + 1}`,
      date: `202${5 - Math.floor(i / 4)}-${String(((i * 2) % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      workType: ["포장보수", "배수시설", "표지판", "안전시설", "청소", "도색"][i % 6]!,
      content: `국도 7호선 유지보수 작업 ${i + 1}`,
      contractor: i % 2 === 0 ? "○○건설" : "직영",
      point:
        i % 3 === 0
          ? { lon: 129.4 + (i % 5) * 0.004, lat: 36.99 + (i % 4) * 0.008 }
          : null,
      siteAddress: i % 3 === 0 ? "울진군 울진읍 일대" : "",
    })),
    complaints: Array.from({ length: 12 }, (_, i) => ({
      id: `c1-${i + 1}`,
      state: (["접수", "처리중", "완료"] as const)[i % 3]!,
      date: `2026-${String(((i % 6) + 1)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      name: `${["이", "박", "최", "정", "한", "윤"][i % 6]}○○`,
      address: i % 2 === 0 ? "울진군 울진읍 일대" : "",
      content: `국도 7호선 관련 민원 내용 ${i + 1}`,
      point:
        i % 2 === 0
          ? { lon: 129.405 + (i % 4) * 0.005, lat: 36.995 + (i % 3) * 0.006 }
          : null,
    })),
  },
  {
    id: "2",
    roadName: "국도 36호선",
    roadNo: "36",
    roadType: "국도",
    openStatus: "개설",
    lengthM: 18600,
    sect: "1",
    dept: "도로과 국도팀",
    manager: "김국도",
    startPoint: "울진군 울진읍",
    endPoint: "울진군 서면",
    designateDate: "2001-07-01",
    geom: GEOM_ND36,
    maintenance: [
      { id: "m2-1", date: "2025-09-10", workType: "표지판", content: "안내표지 교체 3개소", contractor: "□□표지" },
    ],
    complaints: [
      {
        id: "c2-1",
        state: "접수",
        date: "2026-07-01",
        name: "최○○",
        address: "울진군 서면",
        content: "과속방지턱 설치 요청",
      },
    ],
  },
  {
    id: "3",
    roadName: "국도 88호선",
    roadNo: "88",
    roadType: "국도",
    openStatus: "개설",
    lengthM: 14200,
    sect: "1",
    dept: "도로과 국도팀",
    manager: "김국도",
    startPoint: "울진군 평해읍",
    endPoint: "울진군 온정면",
    designateDate: "2003-05-20",
    geom: GEOM_ND88,
    maintenance: [
      { id: "m3-1", date: "2025-04-14", workType: "절개면", content: "낙석 방호망 보수", contractor: "○○건설" },
      { id: "m3-2", date: "2023-10-02", workType: "포장보수", content: "포트홀 긴급보수", contractor: "직영" },
    ],
    complaints: [
      {
        id: "c3-1",
        state: "완료",
        date: "2025-12-11",
        name: "정○○",
        address: "울진군 평해읍",
        content: "낙엽·토사 쌓임으로 배수 불량",
      },
    ],
  },
  {
    id: "4",
    roadName: "국지도 69호선",
    roadNo: "69",
    roadType: "국지도",
    openStatus: "개설",
    lengthM: 9800,
    sect: "1",
    dept: "도로과 지방도팀",
    manager: "이지방",
    startPoint: "울진군 북면",
    endPoint: "울진군 금강송면",
    designateDate: "2005-04-22",
    geom: GEOM_LD917,
    maintenance: [
      { id: "m4-1", date: "2026-01-20", workType: "안전시설", content: "가드레일 교체", contractor: "△△시설" },
    ],
    complaints: [],
  },
  {
    id: "5",
    roadName: "지방도 920호선",
    roadNo: "920",
    roadType: "지방도",
    openStatus: "개설",
    lengthM: 7200,
    sect: "1",
    dept: "도로과 지방도팀",
    manager: "이지방",
    startPoint: "울진군 근남면",
    endPoint: "울진군 매화면",
    designateDate: "2008-11-15",
    geom: GEOM_LD920,
    maintenance: [
      { id: "m5-1", date: "2025-08-01", workType: "청소", content: "노면 청소·제초", contractor: "직영" },
    ],
    complaints: [
      {
        id: "c5-1",
        state: "처리중",
        date: "2026-05-18",
        name: "한○○",
        address: "울진군 근남면",
        content: "인도 경계석 파손",
      },
    ],
  },
  {
    id: "6",
    roadName: "군도 1호선",
    roadNo: "1",
    roadType: "군도",
    openStatus: "개설",
    lengthM: 3100,
    sect: "1",
    dept: "건설과 군도팀",
    manager: "박군도",
    startPoint: "울진군 울진읍",
    endPoint: "울진군 근남면",
    startPointCoord: { lon: 129.4, lat: 36.991 },
    endPointCoord: { lon: 129.42, lat: 36.951 },
    designateDate: "2010-02-08",
    geom: ujBranch(129.4, 36.991, 0.02, -0.04),
    maintenance: [
      { id: "m6-1", date: "2025-08-01", workType: "청소", content: "노면 청소·제초", contractor: "직영" },
    ],
    complaints: [
      {
        id: "c6-1",
        state: "처리중",
        date: "2026-05-18",
        name: "한○○",
        address: "울진군 울진읍",
        content: "인도 경계석 파손",
      },
    ],
  },
  {
    id: "7",
    roadName: "군도 5호선",
    roadNo: "5",
    roadType: "군도",
    openStatus: "미개설",
    lengthM: 2450,
    sect: "1",
    dept: "건설과 군도팀",
    manager: "박군도",
    startPoint: "울진군 죽변면",
    endPoint: "울진군 북면",
    startPointCoord: { lon: 129.42, lat: 37.055 },
    endPointCoord: { lon: 129.405, lat: 37.105 },
    designateDate: "2012-09-30",
    geom: ujBranch(129.42, 37.055, -0.015, 0.05),
    maintenance: [],
    complaints: [
      {
        id: "c7-1",
        state: "접수",
        date: "2026-06-28",
        name: "윤○○",
        address: "울진군 죽변면",
        content: "불법 주차로 통행 방해",
      },
    ],
  },
  {
    id: "8",
    roadName: "농도 3호선",
    roadNo: "3",
    roadType: "농도",
    openStatus: "개설",
    lengthM: 1800,
    sect: "1",
    dept: "농업기술센터",
    manager: "최농도",
    startPoint: "울진군 기성면 A리",
    endPoint: "울진군 기성면 B리",
    startPointCoord: { lon: 129.378, lat: 36.805 },
    endPointCoord: { lon: 129.353, lat: 36.815 },
    designateDate: "2015-05-01",
    geom: ujBranch(129.378, 36.805, -0.025, 0.01),
    maintenance: [
      { id: "m8-1", date: "2024-11-22", workType: "성토", content: "침하 구간 성토 복구", contractor: "□□농공" },
    ],
    complaints: [],
  },
  {
    id: "9",
    roadName: "농도 8호선",
    roadNo: "8",
    roadType: "농도",
    openStatus: "미개설",
    lengthM: 960,
    sect: "1",
    dept: "농업기술센터",
    manager: "최농도",
    startPoint: "울진군 평해읍",
    endPoint: "울진군 평해읍 농경지",
    designateDate: "2016-08-19",
    geom: ujBranch(129.365, 36.728, -0.02, 0.008),
    maintenance: [],
    complaints: [
      {
        id: "c9-1",
        state: "완료",
        date: "2025-09-03",
        name: "강○○",
        address: "울진군 평해읍",
        content: "농기계 통행 폭 부족 건의",
      },
    ],
  },
  {
    id: "10",
    roadName: "울진중앙로",
    roadNo: "101",
    roadType: "일반도로",
    openStatus: "개설",
    lengthM: 1320,
    sect: "1",
    dept: "도로과 시가지팀",
    manager: "정시가",
    startPoint: "울진군청",
    endPoint: "울진읍 시가지",
    designateDate: "1995-01-10",
    geom: ujBranch(129.4004, 36.991, 0.008, -0.004),
    maintenance: [
      { id: "m10-1", date: "2026-02-14", workType: "포장보수", content: "보도블록 교체", contractor: "○○건설" },
      { id: "m10-2", date: "2025-05-07", workType: "도색", content: "차선 재도색", contractor: "직영" },
    ],
    complaints: [
      {
        id: "c10-1",
        state: "처리중",
        date: "2026-07-08",
        name: "오○○",
        address: "울진군 울진읍",
        content: "횡단보도 신호 대기 시간 과다",
      },
    ],
  },
  {
    id: "11",
    roadName: "읍내로",
    roadNo: "102",
    roadType: "일반도로",
    openStatus: "개설",
    lengthM: 980,
    sect: "1",
    dept: "도로과 시가지팀",
    manager: "정시가",
    startPoint: "울진읍사무소",
    endPoint: "울진시장",
    designateDate: "2000-06-01",
    geom: ujBranch(129.402, 36.993, -0.006, 0.005),
    maintenance: [
      { id: "m11-1", date: "2025-12-01", workType: "가로수", content: "가로수 전정", contractor: "직영" },
    ],
    complaints: [],
  },
  {
    id: "12",
    roadName: "죽변항로",
    roadNo: "103",
    roadType: "일반도로",
    openStatus: "개설",
    lengthM: 1100,
    sect: "2",
    dept: "도로과 시가지팀",
    manager: "정시가",
    startPoint: "죽변면사무소",
    endPoint: "죽변항",
    designateDate: "2003-03-20",
    geom: ujBranch(129.422, 37.055, 0.012, 0.002),
    maintenance: [],
    complaints: [
      {
        id: "c12-1",
        state: "접수",
        date: "2026-06-15",
        name: "서○○",
        address: "울진군 죽변면",
        content: "심야 소음·과속 단속 요청",
      },
    ],
  },
  {
    id: "13",
    roadName: "임도 A노선",
    roadNo: "A1",
    roadType: "임도",
    openStatus: "개설",
    lengthM: 5200,
    sect: "1",
    dept: "산림과",
    manager: "임산림",
    startPoint: "울진군 금강송면",
    endPoint: "울진군 금강송면 임야",
    designateDate: "2018-04-05",
    geom: ujBranch(129.28, 36.95, -0.04, 0.03),
    maintenance: [
      { id: "m13-1", date: "2025-07-19", workType: "노면정리", content: "토사 유실 구간 복구", contractor: "□□산림" },
    ],
    complaints: [],
  },
  {
    id: "14",
    roadName: "임도 B노선",
    roadNo: "B2",
    roadType: "임도",
    openStatus: "개설",
    lengthM: 2800,
    sect: "1",
    dept: "산림과",
    manager: "임산림",
    startPoint: "울진군 온정면",
    endPoint: "울진군 온정면 임야",
    designateDate: "2019-10-11",
    geom: ujBranch(129.2, 36.78, 0.03, 0.02),
    maintenance: [
      { id: "m14-1", date: "2024-08-30", workType: "배수시설", content: "횡단배수관 설치", contractor: "□□산림" },
    ],
    complaints: [
      {
        id: "c14-1",
        state: "완료",
        date: "2025-04-22",
        name: "문○○",
        address: "울진군 온정면",
        content: "임도 출입 통제 안내 요청",
      },
    ],
  },
  {
    id: "15",
    roadName: "국지도 88호선(울진)",
    roadNo: "88",
    roadType: "국지도",
    openStatus: "개설",
    lengthM: 8400,
    sect: "1",
    dept: "도로과 지방도팀",
    manager: "이지방",
    startPoint: "울진군 평해읍",
    endPoint: "울진군 기성면",
    designateDate: "2009-08-15",
    geom: ujBranch(129.365, 36.728, -0.04, 0.02),
    maintenance: [],
    complaints: [
      {
        id: "c15-1",
        state: "접수",
        date: "2026-04-02",
        name: "조○○",
        address: "울진군 평해읍",
        content: "국지도 갓길 협소",
      },
    ],
  },
  /** 국도 탭에 함께 보이는 입체교차로 행 */
  {
    id: "16",
    roadName: "울진IC 고가",
    roadNo: "7-IC",
    roadType: "입체교차로",
    openStatus: "개설",
    lengthM: 420,
    sect: "1",
    dept: "도로과 국도팀",
    manager: "김국도",
    startPoint: "국도 7호선",
    endPoint: "국도 36호선 분기",
    designateDate: "2011-05-20",
    geom: ujBranch(129.4, 36.991, 0.004, -0.002),
    maintenance: [
      { id: "m16-1", date: "2025-06-01", workType: "안전시설", content: "난간 도색", contractor: "직영" },
    ],
    complaints: [],
  },
  {
    id: "17",
    roadName: "매화 지하차도",
    roadNo: "7-UC",
    roadType: "입체교차로",
    openStatus: "개설",
    lengthM: 280,
    sect: "1",
    dept: "도로과 국도팀",
    manager: "김국도",
    startPoint: "국도 7호선 매화",
    endPoint: "매화 접속로",
    designateDate: "2014-11-03",
    geom: ujBranch(129.392, 36.885, 0.003, 0.002),
    maintenance: [],
    complaints: [],
  },
  {
    id: "18",
    roadName: "온정 교차로",
    roadNo: "88-JC",
    roadType: "입체교차로",
    openStatus: "개설",
    lengthM: 350,
    sect: "1",
    dept: "도로과 국도팀",
    manager: "김국도",
    startPoint: "국도 88호선",
    endPoint: "온정면 진입",
    designateDate: "2016-02-18",
    geom: ujBranch(129.24, 36.755, 0.005, 0.003),
    maintenance: [],
    complaints: [],
  },
];

export function formatRoadNetworkLengthKm(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return "—";
  const km = m / 1000;
  return `${km.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}km`;
}

export const ROAD_NETWORK_COMPLAINT_STATES = ["접수", "처리중", "완료"] as const;

export const ROAD_NETWORK_COMPLAINT_STATE_FILTERS = ["전체", "접수", "처리중", "완료"] as const;
export type RoadNetworkComplaintStateFilter =
  (typeof ROAD_NETWORK_COMPLAINT_STATE_FILTERS)[number];

export function guessAttachmentPreviewKind(
  fileName: string,
  mime?: string
): RoadNetworkPreviewKind {
  const m = (mime ?? "").toLowerCase();
  const n = fileName.toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(n)) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  return "other";
}

function formatAttachmentSize(sizeBytes?: number): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes)) return "—";
  if (sizeBytes < 1024) return `${sizeBytes}B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)}KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 임시 시드용 SVG 이미지 미리보기 */
export function createDemoImagePreviewUrl(label: string): string {
  const safe = label.replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#cbd5e1"/></linearGradient></defs>
  <rect width="960" height="640" fill="url(#g)"/>
  <rect x="48" y="48" width="864" height="544" rx="12" fill="#fff" stroke="#94a3b8" stroke-width="2"/>
  <text x="480" y="300" text-anchor="middle" font-family="Malgun Gothic,sans-serif" font-size="28" fill="#334155">도로망도 임시 미리보기</text>
  <text x="480" y="350" text-anchor="middle" font-family="Malgun Gothic,sans-serif" font-size="18" fill="#64748b">${safe}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createEmptyAttachment(
  fileName: string,
  sizeBytes?: number,
  opts?: { previewUrl?: string; previewKind?: RoadNetworkPreviewKind }
): RoadNetworkAttachment {
  const kind = opts?.previewKind ?? guessAttachmentPreviewKind(fileName);
  return {
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: fileName,
    sizeLabel: formatAttachmentSize(sizeBytes),
    uploadedAt: new Date().toISOString().slice(0, 10),
    previewUrl: opts?.previewUrl,
    previewKind: kind,
  };
}

/** 로컬 파일 선택 → 미리보기 URL 포함 첨부 */
export function createAttachmentFromFile(file: File): RoadNetworkAttachment {
  const kind = guessAttachmentPreviewKind(file.name, file.type);
  const previewUrl =
    kind === "image" || kind === "pdf" ? URL.createObjectURL(file) : undefined;
  return createEmptyAttachment(file.name, file.size, { previewUrl, previewKind: kind });
}

export function revokeAttachmentPreview(att: RoadNetworkAttachment | undefined | null) {
  const url = att?.previewUrl;
  if (url?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

/** Asia/Seoul 기준 `YYYY-MM-DD HH:mm:ss` */
export function formatRoadNetworkHistoryAt(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function createHistoryItem(
  action: string,
  detail: string,
  user = "미확인"
): RoadNetworkHistoryItem {
  return {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: formatRoadNetworkHistoryAt(),
    user: user.trim() || "미확인",
    action,
    detail,
  };
}

function pointStatus(p?: RoadNetworkPoint | null): string {
  return p && Number.isFinite(p.lon) && Number.isFinite(p.lat) ? "지정" : "미지정";
}

function pushChange(out: string[], label: string, before: string, after: string) {
  if (before === after) return;
  out.push(`${label}: ${before || "—"} → ${after || "—"}`);
}

/** 속성 저장 시 변경된 항목만 요약 (줄바꿈 — 한 줄에 한 변경) */
export function describeAttrHistoryDetail(
  prev: RoadNetworkRow,
  next: {
    roadName: string;
    roadNo: string;
    roadType: RoadNetworkType;
    openStatus: RoadNetworkOpenStatus;
    dept: string;
    manager: string;
    startPoint?: string;
    endPoint?: string;
    startPointCoord?: RoadNetworkPoint | null;
    endPointCoord?: RoadNetworkPoint | null;
    lengthAttr?: string;
    defense?: string;
    sinuosity?: string;
    detailReason?: string;
    address?: string;
  }
): string {
  const changes: string[] = [];
  pushChange(changes, "도로명", prev.roadName, next.roadName);
  pushChange(changes, "도로종류", prev.roadType, next.roadType);
  pushChange(changes, "도로번호", prev.roadNo || "", next.roadNo || "");
  pushChange(changes, "개설여부", prev.openStatus ?? "", next.openStatus ?? "");
  pushChange(changes, "관리기관", prev.dept || "", next.dept || "");
  pushChange(changes, "담당자", prev.manager || "", next.manager || "");
  if (
    next.roadType === "입체교차로" ||
    next.roadType === "지방도" ||
    next.roadType === "국지도" ||
    next.roadType === "군도" ||
    next.roadType === "농도" ||
    next.roadType === "일반도로" ||
    next.roadType === "임도"
  ) {
    pushChange(changes, "길이", prev.lengthAttr || "", next.lengthAttr || "");
    pushChange(changes, "방위", prev.defense || "", next.defense || "");
  }
  if (
    next.roadType === "입체교차로" ||
    next.roadType === "국지도" ||
    next.roadType === "군도" ||
    next.roadType === "농도" ||
    next.roadType === "임도"
  ) {
    pushChange(changes, "굴곡도", prev.sinuosity || "", next.sinuosity || "");
  }
  if (next.roadType === "국지도" || next.roadType === "일반도로") {
    pushChange(changes, "상세사유", prev.detailReason || "", next.detailReason || "");
  }
  if (next.roadType === "임도") {
    pushChange(changes, "상세설명", prev.detailReason || "", next.detailReason || "");
  }
  if (next.roadType === "일반도로" || next.roadType === "임도") {
    pushChange(changes, "주소", prev.address || "", next.address || "");
  }
  if (changes.length === 0) return "변경 사항 없음";
  return changes.join("\n");
}

/** 유지보수 추가/수정 이력 상세 */
export function describeMaintHistoryDetail(
  prev: RoadNetworkMaintenanceItem | null,
  next: RoadNetworkMaintenanceItem,
  isNew: boolean
): string {
  const title = `${next.workType || "유지보수"} (${next.date})`;
  if (isNew || !prev) {
    const lines = [`«${title}» 등록`];
    if (next.siteAddress) lines.push(`현장: ${next.siteAddress}`);
    else if (next.point) lines.push("현장: 위치 지정");
    if ((next.attachments ?? []).length > 0) {
      lines.push(`첨부 ${(next.attachments ?? []).length}건`);
    }
    return lines.join("\n");
  }
  const changes: string[] = [];
  pushChange(changes, "작업유형", prev.workType, next.workType);
  pushChange(changes, "일자", prev.date, next.date);
  pushChange(changes, "내용", prev.content, next.content);
  pushChange(changes, "시공", prev.contractor || "", next.contractor || "");
  pushChange(
    changes,
    "현장",
    prev.siteAddress || pointStatus(prev.point),
    next.siteAddress || pointStatus(next.point)
  );
  const prevAtt = (prev.attachments ?? []).length;
  const nextAtt = (next.attachments ?? []).length;
  if (prevAtt !== nextAtt) changes.push(`첨부: ${prevAtt}건 → ${nextAtt}건`);
  if (changes.length === 0) return `«${title}» 변경 없음`;
  return [`«${title}»`, ...changes].join("\n");
}

/** 민원 추가/수정 이력 상세 */
export function describeComplaintHistoryDetail(
  prev: RoadNetworkComplaintItem | null,
  next: RoadNetworkComplaintItem,
  isNew: boolean
): string {
  const title = `${next.state} · ${(next.content || "민원").slice(0, 24)}`;
  if (isNew || !prev) {
    const lines = [`«${title}» 등록`];
    if (next.name) lines.push(`신청인: ${next.name}`);
    if (next.address) lines.push(`현장: ${next.address}`);
    else if (next.point) lines.push("현장: 위치 지정");
    if ((next.attachments ?? []).length > 0) {
      lines.push(`첨부 ${(next.attachments ?? []).length}건`);
    }
    return lines.join("\n");
  }
  const changes: string[] = [];
  pushChange(changes, "상태", prev.state, next.state);
  pushChange(changes, "접수일", prev.date, next.date);
  pushChange(changes, "신청인", prev.name || "", next.name || "");
  pushChange(changes, "내용", prev.content, next.content);
  pushChange(
    changes,
    "현장",
    prev.address || pointStatus(prev.point),
    next.address || pointStatus(next.point)
  );
  const prevAtt = (prev.attachments ?? []).length;
  const nextAtt = (next.attachments ?? []).length;
  if (prevAtt !== nextAtt) changes.push(`첨부: ${prevAtt}건 → ${nextAtt}건`);
  if (changes.length === 0) return `«${title}» 변경 없음`;
  return [`«${title}»`, ...changes].join("\n");
}

function normalizeRow(row: (typeof MOCK_ROAD_NETWORK_ROWS)[number]): RoadNetworkRow {
  return {
    ...row,
    attachments: ("attachments" in row && row.attachments) || [],
    history: ("history" in row && row.history) || [],
    maintenance: (row.maintenance ?? []).map((m) => ({
      ...m,
      attachments: ("attachments" in m && m.attachments) || [],
    })),
    complaints: (row.complaints ?? []).map((c) => ({
      ...c,
      attachments: ("attachments" in c && c.attachments) || [],
    })),
  } as RoadNetworkRow;
}

export function cloneRoadNetworkRows(): RoadNetworkRow[] {
  const rows = structuredClone(MOCK_ROAD_NETWORK_ROWS).map(normalizeRow);
  const first = rows.find((r) => r.id === "1");
  if (first) {
    first.attachments = [
      createEmptyAttachment("국도7호선_노선도.pdf", 1_240_000, {
        previewUrl: createDemoImagePreviewUrl("국도7호선_노선도.pdf (임시)"),
        previewKind: "image",
      }),
      createEmptyAttachment("국도7호선_현황사진.jpg", 2_100_000, {
        previewUrl: createDemoImagePreviewUrl("국도7호선_현황사진.jpg (임시)"),
        previewKind: "image",
      }),
    ];
    const seedUser = "도로담당";
    first.history = [
      {
        ...createHistoryItem(
          "속성 수정",
          "관리기관: 건설과 → 도로관리과\n담당자: 김○○ → 이○○",
          seedUser
        ),
        at: "2025-11-03 14:22:11",
      },
      {
        ...createHistoryItem(
          "유지보수 추가",
          "«포장보수 (2025-03-12)» 등록\n현장: 울진군 울진읍",
          seedUser
        ),
        at: "2025-03-12 09:41:05",
      },
      {
        ...createHistoryItem(
          "민원 등록",
          "«접수 · 노면 물고임» 등록\n신청인: 박○○\n현장: 울진군 근남면",
          seedUser
        ),
        at: "2025-06-18 16:08:33",
      },
      {
        ...createHistoryItem("첨부 추가", "국도7호선_노선도.pdf", seedUser),
        at: "2025-02-20 11:05:47",
      },
    ];
    if (first.maintenance[0]) {
      first.maintenance[0].attachments = [
        createEmptyAttachment("보수전후_비교.jpg", 420_000, {
          previewUrl: createDemoImagePreviewUrl("보수전후_비교.jpg"),
          previewKind: "image",
        }),
      ];
    }
    if (first.complaints[0]) {
      first.complaints[0].attachments = [
        createEmptyAttachment("현장사진_01.jpg", 380_000, {
          previewUrl: createDemoImagePreviewUrl("현장사진_01.jpg"),
          previewKind: "image",
        }),
      ];
    }
  }
  return rows;
}

export function createEmptyRoadNetworkRow(
  user = "미확인",
  id: string = `local-${Date.now()}`
): RoadNetworkRow {
  return {
    id,
    roadName: "",
    roadNo: "",
    roadType: "일반도로",
    openStatus: "개설",
    lengthM: 0,
    sect: "",
    dept: "",
    manager: "",
    startPoint: "",
    endPoint: "",
    startPointCoord: null,
    endPointCoord: null,
    designateDate: "",
    geom: null,
    maintenance: [],
    complaints: [],
    attachments: [],
    history: [],
  };
}

/** 목록에 넣지 않는 미저장 신규 선택 id */
export const ROAD_NETWORK_NEW_ID = "__new__";

export function isNewRoadNetworkRowId(id: string | null | undefined): boolean {
  return String(id ?? "").trim() === ROAD_NETWORK_NEW_ID;
}

export function createEmptyMaintenanceItem(): RoadNetworkMaintenanceItem {
  return {
    id: `m-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    workType: "포장보수",
    content: "",
    contractor: "",
    attachments: [],
    point: null,
    siteAddress: "",
  };
}

export function createEmptyComplaintItem(): RoadNetworkComplaintItem {
  return {
    id: `c-${Date.now()}`,
    state: "접수",
    date: new Date().toISOString().slice(0, 10),
    name: "",
    address: "",
    content: "",
    attachments: [],
    point: null,
  };
}

/** 사용자 표시용 — 좌표 숫자 대신 지정 여부만 */
export function formatRoadNetworkPoint(point?: RoadNetworkPoint | null): string {
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return "미지정";
  return "지정";
}
