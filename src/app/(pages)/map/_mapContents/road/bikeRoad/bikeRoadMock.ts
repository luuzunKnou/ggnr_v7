/** 자전거도로 프로토타입 — 목 데이터 (제공 이미지 기준) */

export type BikeRoadAttachment = {
  id: string;
  name: string;
  /** 프로토타입 미리보기용 공개 경로 (이미지 등) */
  url?: string;
};

export type BikeRoadHistoryItem = {
  id: string;
  action: string;
  at: string;
  user: string;
  detail: string;
};

/** 편측 중앙(C) · 양측 우측(R)/좌측(L) */
export type BikeRoadSegmentSide = "C" | "R" | "L";

export type BikeRoadSegment = {
  id: string;
  /** 일련번호 예: 1-1 */
  serialNo: string;
  /** 노선명 예: 삼성현로R */
  routeName: string;
  startName: string;
  endName: string;
  /** 총 연장 (자유 입력, km) */
  totalLength: string;
  roadLink: string;
  pathType: string;
  /** 폭원 */
  dedicatedRoad: string;
  dedicatedLane: string;
  priorityRoad: string;
  sharedSepBike: string;
  sharedSepWalk: string;
  sharedSepEffective: string;
  sharedNonSepRoad: string;
  sharedNonSepEffective: string;
  note: string;
  /** 측 — 없으면 표시용으로 C 취급 */
  side?: BikeRoadSegmentSide;
  /** 해당 측 폴리라인 [lon, lat] */
  lineCoords?: [number, number][];
  /** 양측일 때 오프셋 원본 중심선 */
  centerLineCoords?: [number, number][];
};

export type BikeRoadRoute = {
  id: string;
  /** 목록 제목: 시점~종점 */
  title: string;
  /** 예: 겸용도로(양측) */
  kind: string;
  /** 총 연장 (자유 입력) */
  totalLength: string;
  direction: string;
  startPoint: string;
  endPoint: string;
  bridges: string;
  subway: string;
  /** 우안·좌안 등 부가 경로 (없으면 빈 문자열) */
  sidePath: string;
  remark: string;
  attachments: BikeRoadAttachment[];
  segments: BikeRoadSegment[];
  history: BikeRoadHistoryItem[];
  /** 저장된 위치도 이미지 (data URL 등) */
  locationMapUrl?: string;
  /** 프로토타입 지도용 — [lon, lat] EPSG:4326 */
  lineCoords: [number, number][];
  startLabel: string;
  endLabel: string;
  /** 위치도 범례: 전용 / 겸용분리 / 겸용비분리 */
  pathStyle: "dedicated" | "sharedSep" | "sharedNonSep";
};

/** 노선 구분 (속성) */
export const BIKE_ROAD_KIND_OPTIONS = [
  "전용도로",
  "겸용도로(양측)",
  "겸용도로(편측)",
] as const;
export type BikeRoadKindOption = (typeof BIKE_ROAD_KIND_OPTIONS)[number];

/** 구간 · 자전거도로 종류 */
export const BIKE_ROAD_PATH_TYPE_OPTIONS = [
  "전용",
  "겸용(분리)",
  "겸용(비분리)",
] as const;
export type BikeRoadPathTypeOption = (typeof BIKE_ROAD_PATH_TYPE_OPTIONS)[number];

export function normalizeBikeRoadKind(kind: string): BikeRoadKindOption {
  const t = kind.trim();
  if (t === "전용도로" || t === "전용" || t.includes("전용")) return "전용도로";
  if (t.includes("편측")) return "겸용도로(편측)";
  if (t.includes("양측") || t.includes("겸용")) return "겸용도로(양측)";
  return "겸용도로(양측)";
}

/** 종류에 따라 보여줄 폭원 그룹 */
export function bikeRoadWidthGroup(
  pathType: string
): "dedicated" | "sharedSep" | "sharedNonSep" | null {
  const t = pathType.trim();
  if (!t) return null;
  if (t === "겸용(비분리)" || t.includes("비분리")) return "sharedNonSep";
  if (t === "겸용(분리)" || (t.includes("겸용") && t.includes("분리"))) return "sharedSep";
  if (t === "전용" || t.includes("전용")) return "dedicated";
  if (t.includes("겸용")) return "sharedSep";
  return null;
}

export function normalizeBikeRoadPathType(pathType: string): BikeRoadPathTypeOption | "" {
  const t = pathType.trim();
  if (!t) return "";
  if (t === "전용" || t === "전용도로") return "전용";
  if (t.includes("비분리")) return "겸용(비분리)";
  if (t.includes("분리") || t === "겸용도로" || t.includes("겸용")) return "겸용(분리)";
  if (t.includes("전용")) return "전용";
  return "";
}

export function pathStyleFromKind(
  kind: string
): BikeRoadRoute["pathStyle"] {
  return normalizeBikeRoadKind(kind) === "전용도로" ? "dedicated" : "sharedSep";
}

export const BIKE_ROAD_NEW_ID_PREFIX = "bike-new-";

export function isNewBikeRoadRouteId(id: string | null | undefined): boolean {
  return Boolean(id && String(id).startsWith(BIKE_ROAD_NEW_ID_PREFIX));
}

/** 프로토타입 — 속성만 채우는 신규 노선 (구간·도형은 비움) */
export function createEmptyBikeRoadRoute(): BikeRoadRoute {
  return {
    id: `${BIKE_ROAD_NEW_ID_PREFIX}${Date.now()}`,
    title: "새 노선",
    kind: "겸용도로(양측)",
    totalLength: "",
    direction: "",
    startPoint: "",
    endPoint: "",
    bridges: "",
    subway: "",
    sidePath: "",
    remark: "",
    attachments: [],
    segments: [],
    history: [],
    lineCoords: [],
    startLabel: "",
    endLabel: "",
    pathStyle: "sharedSep",
  };
}

const emptyWidth = {
  dedicatedRoad: "",
  dedicatedLane: "",
  priorityRoad: "",
  sharedSepBike: "",
  sharedSepWalk: "",
  sharedSepEffective: "",
  sharedNonSepRoad: "",
  sharedNonSepEffective: "",
  note: "",
} as const;

/** 노선 수정 중 «+»로 붙일 빈 구간 */
export function createEmptyBikeRoadSegment(opts?: {
  routePrefix?: string;
  index1?: number;
  side?: BikeRoadSegmentSide;
}): BikeRoadSegment {
  const prefix = (opts?.routePrefix ?? "1").trim() || "1";
  const index1 = opts?.index1 ?? 1;
  return {
    id: `seg-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    serialNo: `${prefix}-${index1}`,
    routeName: "",
    startName: "",
    endName: "",
    totalLength: "",
    roadLink: "",
    pathType: "겸용(분리)",
    side: opts?.side ?? "C",
    lineCoords: [],
    ...emptyWidth,
  };
}

/** 저장 시 일련번호를 `접두-1` … 형태로 다시 맞춤 */
export function renumberBikeRoadSegments(
  segments: BikeRoadSegment[],
  routePrefix = "1"
): BikeRoadSegment[] {
  const prefix = routePrefix.trim() || "1";
  return segments.map((s, i) => ({
    ...s,
    serialNo: `${prefix}-${i + 1}`,
  }));
}

/** 기존 구간 일련번호에서 접두(1-1 → 1) 추출 */
export function bikeRoadSerialPrefix(segments: BikeRoadSegment[]): string {
  const first = segments[0]?.serialNo?.trim();
  if (!first) return "1";
  const m = /^(\d+)\s*-/.exec(first);
  return m?.[1] ?? "1";
}

export const BIKE_ROAD_MOCK_ROUTES: BikeRoadRoute[] = [
  {
    id: "bike-route-1",
    title: "삼성현로(대구시계) ~ 대학로",
    kind: "겸용도로(양측)",
    totalLength: "17.24",
    direction: "삼성현로(대구시계) → 경안로 → 남매로 → 대학로",
    startPoint: "경산시 옥산동 671-1",
    endPoint: "경산시 압량면 부적리 535-11",
    bridges: "성암고가도로, 백옥교",
    subway: "임당역, 영남대역",
    sidePath: "",
    remark: "국가자전거구축사업으로 자전거도로 구축된 구간",
    attachments: [
      {
        id: "att-1-1",
        name: "삼성현로_현장_01.png",
        url: "/mock/bikeRoad/samsung_01.png",
      },
      {
        id: "att-1-2",
        name: "삼성현로_현장_02.png",
        url: "/mock/bikeRoad/samsung_02.png",
      },
      {
        id: "att-1-3",
        name: "삼성현로_현장_03.png",
        url: "/mock/bikeRoad/samsung_01.png",
      },
    ],
    history: [
      {
        id: "hist-1-1",
        action: "등록",
        at: "2024-03-12 10:20",
        user: "도로관리",
        detail: "국가자전거구축사업 노선 등록",
      },
      {
        id: "hist-1-2",
        action: "속성 수정",
        at: "2025-06-18 14:05",
        user: "도로관리",
        detail: "교량·지하철역 정보 보완",
      },
      {
        id: "hist-1-3",
        action: "정비",
        at: "2025-09-02 11:30",
        user: "도로관리",
        detail: "남매로 구간 노면 보수",
      },
    ],
    startLabel: "모레아장례식장",
    endLabel: "압량농협네거리",
    pathStyle: "sharedSep",
    /** 도심 도로처럼 꺾이는 대략 경로 (스크린 위치도 느낌) */
    lineCoords: [
      [128.702, 35.838],
      [128.708, 35.836],
      [128.712, 35.833],
      [128.716, 35.829],
      [128.719, 35.825],
      [128.724, 35.823],
      [128.729, 35.824],
      [128.735, 35.826],
      [128.741, 35.825],
      [128.747, 35.822],
      [128.752, 35.818],
      [128.756, 35.815],
      [128.761, 35.814],
      [128.767, 35.816],
      [128.773, 35.817],
      [128.778, 35.815],
      [128.783, 35.812],
      [128.788, 35.811],
    ],
    segments: [
      {
        id: "seg-1-1",
        serialNo: "1-1",
        routeName: "삼성현로R",
        startName: "모레아 장례식장",
        endName: "백천네거리",
        totalLength: "3.60",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "R",
        ...emptyWidth,
        sharedSepBike: "1.8",
        sharedSepWalk: "2.4~2.9",
        sharedSepEffective: "자 : 1.8 / 보 : 1.5",
      },
      {
        id: "seg-1-2",
        serialNo: "1-2",
        routeName: "삼성현로L",
        startName: "모레아 장례식장",
        endName: "백천네거리",
        totalLength: "3.60",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "L",
        ...emptyWidth,
        sharedSepBike: "1.5~1.8",
        sharedSepWalk: "2.2~2.9",
        sharedSepEffective: "자 : 1.5 / 보 : 2.2",
      },
      {
        id: "seg-1-3",
        serialNo: "1-3",
        routeName: "경안로R",
        startName: "백천네거리",
        endName: "상방삼거리",
        totalLength: "0.39",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "R",
        ...emptyWidth,
        sharedSepBike: "1.5",
        sharedSepWalk: "3(1.0/2.0)",
        sharedSepEffective: "자 : 1.5 / 보 : 1.6",
      },
      {
        id: "seg-1-4",
        serialNo: "1-4",
        routeName: "경안로L",
        startName: "백천네거리",
        endName: "상방삼거리",
        totalLength: "0.39",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "L",
        ...emptyWidth,
        sharedSepBike: "1.5",
        sharedSepWalk: "3(1.0/2.0)",
        sharedSepEffective: "자 : 1.5 / 보 : 1.6",
      },
      {
        id: "seg-1-5",
        serialNo: "1-5",
        routeName: "남매로R",
        startName: "상방삼거리",
        endName: "임당네거리",
        totalLength: "2.57",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "R",
        ...emptyWidth,
        sharedSepBike: "1.6",
        sharedSepWalk: "2.1(1), 1.3(2), /2.7",
        sharedSepEffective: "자 : 1.6 / 보 : 0.7(1) / 보 : 1.3(2)",
      },
      {
        id: "seg-1-6",
        serialNo: "1-6",
        routeName: "남매로L",
        startName: "상방삼거리",
        endName: "임당네거리",
        totalLength: "2.57",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "L",
        ...emptyWidth,
        sharedSepBike: "1.6",
        sharedSepWalk: "2.1(1), 1.3(2), /2.75(실내체육관4~시청4)",
        sharedSepEffective: "자 : 1.6 / 보 : 0.7(1) / 보 : 1.3(2)",
      },
      {
        id: "seg-1-7",
        serialNo: "1-7",
        routeName: "대학로R",
        startName: "임당네거리",
        endName: "압량농협 네거리",
        totalLength: "2.06",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "R",
        ...emptyWidth,
        sharedSepBike: "1.8",
        sharedSepWalk: "2.3(1), 2.1(2)",
        sharedSepEffective: "자 : 1.8 / 보 : 0.9(1) / 보 : 2.1(2)",
      },
      {
        id: "seg-1-8",
        serialNo: "1-8",
        routeName: "대학로L",
        startName: "임당네거리",
        endName: "압량농협 네거리",
        totalLength: "2.06",
        roadLink: "○",
        pathType: "겸용(분리)",
        side: "L",
        ...emptyWidth,
        sharedSepBike: "1.7",
        sharedSepWalk: "1.6(1), 2.0(2)",
        sharedSepEffective: "자 : 1.7 / 보 : 0.2(1) / 보 : 2.0(2)",
      },
    ],
  },
  {
    id: "bike-route-2",
    title: "금호강(대정동) ~ 금호강(와촌면)",
    kind: "전용도로",
    totalLength: "13.6",
    direction:
      "금호강(대정동) → 금호강(대구시 동구 금강동) → 금호강(압량면) → 금호강(하양읍) → 금호강(와촌면)",
    startPoint: "금호강(대정동)",
    endPoint: "금호강(와촌면)",
    bridges: "",
    subway: "",
    sidePath: "금호강(우안) → 하양교 → 금호강(좌안)",
    remark: "국가자전거구축사업으로 자전거도로 구축된 구간",
    attachments: [
      {
        id: "att-2-1",
        name: "금호강_현장_01.png",
        url: "/mock/bikeRoad/geumho_01.png",
      },
      {
        id: "att-2-2",
        name: "금호강_현장_02.png",
        url: "/mock/bikeRoad/geumho_02.png",
      },
      {
        id: "att-2-3",
        name: "금호강_현장_03.png",
        url: "/mock/bikeRoad/geumho_01.png",
      },
    ],
    history: [
      {
        id: "hist-2-1",
        action: "등록",
        at: "2023-11-02 09:40",
        user: "도로관리",
        detail: "금호강 전용도로 노선 등록",
      },
      {
        id: "hist-2-2",
        action: "구간 보완",
        at: "2025-01-09 16:22",
        user: "도로관리",
        detail: "하양교 겸용 구간(2-8) 폭원 반영",
      },
      {
        id: "hist-2-3",
        action: "정비",
        at: "2025-08-14 13:10",
        user: "도로관리",
        detail: "하양교 주변 안내표지 교체",
      },
    ],
    startLabel: "대정동",
    endLabel: "와촌면 계당리",
    pathStyle: "dedicated",
    /** 하천 따라 구불구불한 대략 경로 (스크린 위치도 느낌) */
    lineCoords: [
      [128.736, 35.846],
      [128.741, 35.851],
      [128.745, 35.857],
      [128.748, 35.863],
      [128.754, 35.868],
      [128.761, 35.871],
      [128.768, 35.875],
      [128.772, 35.881],
      [128.775, 35.887],
      [128.780, 35.892],
      [128.787, 35.896],
      [128.793, 35.901],
      [128.797, 35.907],
      [128.800, 35.912],
      [128.805, 35.916],
      [128.811, 35.919],
      [128.816, 35.923],
    ],
    segments: [
      {
        id: "seg-2-1",
        serialNo: "2-1",
        routeName: "금호강1",
        startName: "대정동",
        endName: "대정동",
        totalLength: "0.96",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.1",
      },
      {
        id: "seg-2-2",
        serialNo: "2-2",
        routeName: "금호강2",
        startName: "압량면 금구리",
        endName: "압량면 금구리",
        totalLength: "0.81",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.1",
      },
      {
        id: "seg-2-3",
        serialNo: "2-3",
        routeName: "금호강3",
        startName: "압량면 현흥리",
        endName: "압량면 현흥리",
        totalLength: "0.48",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.1",
      },
      {
        id: "seg-2-4",
        serialNo: "2-4",
        routeName: "금호강4",
        startName: "하양읍 환상리",
        endName: "하양읍 환상리",
        totalLength: "3.58",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.1",
      },
      {
        id: "seg-2-5",
        serialNo: "2-5",
        routeName: "금호강5",
        startName: "하양읍 대조리",
        endName: "하양읍 대조리",
        totalLength: "1.61",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.5",
      },
      {
        id: "seg-2-6",
        serialNo: "2-6",
        routeName: "금호강6",
        startName: "하양읍 금락리",
        endName: "하양읍 금락리",
        totalLength: "1.10",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.5",
      },
      {
        id: "seg-2-7",
        serialNo: "2-7",
        routeName: "금호강7",
        startName: "진량읍 부기리",
        endName: "진량읍 부기리",
        totalLength: "0.85",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.2",
      },
      {
        id: "seg-2-8",
        serialNo: "2-8",
        routeName: "금호강8",
        startName: "하양교",
        endName: "하양교",
        totalLength: "0.27",
        roadLink: "○",
        pathType: "겸용(비분리)",
        ...emptyWidth,
        sharedNonSepRoad: "2.4",
        sharedNonSepEffective: "2.4",
      },
      {
        id: "seg-2-9",
        serialNo: "2-9",
        routeName: "금호강9",
        startName: "하양읍 동서리",
        endName: "하양읍 동서리",
        totalLength: "1.62",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.0",
      },
      {
        id: "seg-2-10",
        serialNo: "2-10",
        routeName: "금호강10",
        startName: "와촌면 용천리",
        endName: "와촌면 용천리",
        totalLength: "1.23",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.0",
      },
      {
        id: "seg-2-11",
        serialNo: "2-11",
        routeName: "금호강11",
        startName: "와촌면 계당리",
        endName: "와촌면 계당리",
        totalLength: "1.09",
        roadLink: "○",
        pathType: "전용",
        ...emptyWidth,
        dedicatedRoad: "3.0",
      },
    ],
  },
];
