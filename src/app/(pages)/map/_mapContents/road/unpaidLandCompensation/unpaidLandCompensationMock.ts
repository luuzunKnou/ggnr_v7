/**
 * 미지급용지 보상 지급대장 — 프로토타입 목업
 * 2023·2026 엑셀 대장 사진 기준.
 *
 * 필지 1 : N 소유자
 * 부대비용 묶음은 필지 N건에 같은 id로 연결 가능. 표에서는 묶음 중 마지막 필지 아래에만 수수료 행.
 */

export const UNPAID_LAND_ROAD_TYPES = ["국도", "지방도", "시군도"] as const;
export type UnpaidLandRoadType = (typeof UNPAID_LAND_ROAD_TYPES)[number];

export type UnpaidLandFeeItem = {
  name: string;
  amount: number;
};

/** 부대비용 묶음 — 수수료 항목 한 세트 */
export type UnpaidLandExpenseSet = {
  id: string;
  /** 수수료 금액을 넣을 도로종류 칸 (국도·지방도·시군도 중 하나) */
  roadType?: UnpaidLandRoadType;
  items: UnpaidLandFeeItem[];
};

export type UnpaidLandParcel = {
  id: string;
  year: number;
  seq: number;
  address: string;
  jibun: string;
  landCat: string;
  /** 필지 전체 면적. 공유지분만 있으면 0 */
  area: number;
  /** 있으면 이 필지 블록 끝에 수수료 행 표시 */
  expenseSetId?: string | null;
};

export type UnpaidLandOwner = {
  id: string;
  parcelId: string;
  name: string;
  roadType: UnpaidLandRoadType;
  /** 문자열 필지 표기 (FK 아님) */
  parcelText: string;
  area: number;
  /** null 이면 amountNote 표시 (예: 소송) */
  amount: number | null;
  amountNote?: string;
  /** 면적 칸 보조 표기 예: 43(92/198) */
  areaNote?: string;
};

/** 부대비용 기본 표기 — 국도수수료 / 지방도수수료 / 시군도수수료 */
export function unpaidLandFeeLabelForRoad(roadType: UnpaidLandRoadType): string {
  return `${roadType}수수료`;
}

/** 필지 소유자 기준 도로종류(한 종류면 그것, 섞이면 금액 있는 행 우선) */
export function unpaidLandParcelRoadType(
  parcelId: string,
  owners: UnpaidLandOwner[]
): UnpaidLandRoadType | null {
  const list = owners.filter((o) => o.parcelId === parcelId);
  if (list.length === 0) return null;
  const types = [...new Set(list.map((o) => o.roadType))];
  if (types.length === 1) return types[0]!;
  return list.find((o) => o.amount != null)?.roadType ?? list[0]!.roadType;
}

export type UnpaidLandListRow = {
  parcel: UnpaidLandParcel;
  owners: UnpaidLandOwner[];
  expenseSet: UnpaidLandExpenseSet | null;
};

/** 부대비용 묶음 — 필지에 연결 (1건·여러 건 모두 동일) */
export const UNPAID_LAND_EXPENSE_SETS: UnpaidLandExpenseSet[] = [
  {
    id: "es-2023-hapgye",
    roadType: "시군도",
    items: [{ name: "합계수수료", amount: 18_994_800 }],
  },
  {
    id: "es-2026-bugiri-649-1",
    roadType: "지방도",
    items: [
      { name: "감정평가수수료", amount: 4_900_500 },
      { name: "등기수수료", amount: 1_806_000 },
    ],
  },
];

/** 2023·2026 목업 필지 */
export const UNPAID_LAND_PARCELS: UnpaidLandParcel[] = [
  // —— 2023 (엑셀 사진) ——
  { id: "p2023-01", year: 2023, seq: 1, address: "사정동", jibun: "43-4", landCat: "도", area: 74 },
  { id: "p2023-02", year: 2023, seq: 2, address: "자인면 신도리", jibun: "186-1", landCat: "답", area: 172 },
  { id: "p2023-03", year: 2023, seq: 3, address: "자인면 신도리", jibun: "185-1", landCat: "답", area: 119 },
  { id: "p2023-04", year: 2023, seq: 4, address: "삼북동", jibun: "230-3", landCat: "도", area: 53 },
  { id: "p2023-05", year: 2023, seq: 5, address: "중방동", jibun: "297-125", landCat: "도", area: 31 },
  { id: "p2023-06", year: 2023, seq: 6, address: "점촌동", jibun: "177-13", landCat: "전", area: 51 },
  { id: "p2023-08", year: 2023, seq: 8, address: "압량읍 부적리", jibun: "486-11", landCat: "도", area: 210.88 },
  { id: "p2023-10", year: 2023, seq: 10, address: "진량읍 평사리", jibun: "630-12", landCat: "답", area: 106 },
  { id: "p2023-13", year: 2023, seq: 13, address: "진량읍 상림리", jibun: "188-32", landCat: "도", area: 222 },
  { id: "p2023-14", year: 2023, seq: 14, address: "중방동", jibun: "272-35", landCat: "대", area: 5 },
  { id: "p2023-15", year: 2023, seq: 15, address: "진량읍 평사리", jibun: "105-1", landCat: "도", area: 103 },
  { id: "p2023-16", year: 2023, seq: 16, address: "와촌면 덕촌리", jibun: "62-5", landCat: "대", area: 45.28 },
  { id: "p2023-17", year: 2023, seq: 17, address: "와촌면 덕촌리", jibun: "237-3", landCat: "답", area: 89 },
  { id: "p2023-18", year: 2023, seq: 18, address: "남산면 전지리", jibun: "1140-1", landCat: "답", area: 27 },
  { id: "p2023-19", year: 2023, seq: 19, address: "압량읍", jibun: "73-1", landCat: "도", area: 34 },
  { id: "p2023-20", year: 2023, seq: 20, address: "진량읍 황제리", jibun: "135-2", landCat: "도", area: 53 },
  { id: "p2023-21", year: 2023, seq: 21, address: "남산면 인흥리", jibun: "417-1", landCat: "도", area: 50 },
  { id: "p2023-22", year: 2023, seq: 22, address: "남산면 상대리", jibun: "214", landCat: "전", area: 83 },
  { id: "p2023-23", year: 2023, seq: 23, address: "압량읍", jibun: "291-39", landCat: "도", area: 67 },
  {
    id: "p2023-24",
    year: 2023,
    seq: 24,
    address: "남천면 신석리",
    jibun: "277-4",
    landCat: "도",
    area: 6.5,
    expenseSetId: "es-2023-hapgye",
  },
  { id: "p2023-26", year: 2023, seq: 26, address: "진량읍 선화리", jibun: "1260-2", landCat: "도", area: 0 },
  { id: "p2023-27", year: 2023, seq: 27, address: "진량읍 신상리", jibun: "251-2", landCat: "도", area: 129 },
  { id: "p2023-28", year: 2023, seq: 28, address: "진량읍 신상리", jibun: "303-2", landCat: "도", area: 40 },
  { id: "p2023-29", year: 2023, seq: 29, address: "진량읍 신상리", jibun: "295-2", landCat: "도", area: 119 },
  { id: "p2023-30", year: 2023, seq: 30, address: "진량읍 선화리", jibun: "493-1", landCat: "도", area: 423 },
  { id: "p2023-31", year: 2023, seq: 31, address: "진량읍 신상리", jibun: "229-2", landCat: "도", area: 11 },
  { id: "p2023-32", year: 2023, seq: 32, address: "진량읍 신상리", jibun: "229-4", landCat: "도", area: 12 },
  { id: "p2023-33", year: 2023, seq: 33, address: "자인면 읍천리", jibun: "86-2", landCat: "도", area: 167.69 },
  { id: "p2023-34", year: 2023, seq: 34, address: "자인면 읍천리", jibun: "145-2", landCat: "도", area: 126.92 },
  { id: "p2023-35", year: 2023, seq: 35, address: "진량읍 마곡리", jibun: "241-2", landCat: "도", area: 144.61 },
  // —— 2026 (엑셀 사진) ——
  { id: "p2026-01", year: 2026, seq: 1, address: "임당동", jibun: "332-12", landCat: "도", area: 188 },
  { id: "p2026-02", year: 2026, seq: 2, address: "중방동", jibun: "838-13", landCat: "대", area: 16 },
  { id: "p2026-03", year: 2026, seq: 3, address: "중방동", jibun: "838-14", landCat: "대", area: 28 },
  { id: "p2026-04", year: 2026, seq: 4, address: "중방동", jibun: "841", landCat: "대", area: 33 },
  { id: "p2026-05", year: 2026, seq: 5, address: "사동", jibun: "956", landCat: "대", area: 6.8 },
  { id: "p2026-06", year: 2026, seq: 6, address: "사동", jibun: "964-3", landCat: "대", area: 24 },
  { id: "p2026-07", year: 2026, seq: 7, address: "사동", jibun: "964-4", landCat: "대", area: 23.5 },
  { id: "p2026-08", year: 2026, seq: 8, address: "사동", jibun: "964-5", landCat: "대", area: 22 },
  { id: "p2026-09", year: 2026, seq: 9, address: "사동", jibun: "965-3", landCat: "대", area: 23 },
  { id: "p2026-10", year: 2026, seq: 10, address: "사동", jibun: "965-4", landCat: "대", area: 15 },
  { id: "p2026-11", year: 2026, seq: 11, address: "사동", jibun: "965-5", landCat: "대", area: 18 },
  { id: "p2026-12", year: 2026, seq: 12, address: "사동", jibun: "산35-2", landCat: "임", area: 304.8 },
  { id: "p2026-13", year: 2026, seq: 13, address: "옥산동", jibun: "산65-3", landCat: "임", area: 79 },
  { id: "p2026-14", year: 2026, seq: 14, address: "옥산동", jibun: "산65-2", landCat: "임", area: 66 },
  { id: "p2026-15", year: 2026, seq: 15, address: "진량읍 다문리", jibun: "산22", landCat: "임", area: 117.8 },
  { id: "p2026-16", year: 2026, seq: 16, address: "자인면 울옥리", jibun: "91-3", landCat: "도", area: 0 },
  {
    id: "p2026-17",
    year: 2026,
    seq: 17,
    address: "진량읍 부기리",
    jibun: "649-1",
    landCat: "도",
    area: 0,
    expenseSetId: "es-2026-bugiri-649-1",
  },
];

export const UNPAID_LAND_OWNERS: UnpaidLandOwner[] = [
  // —— 2023 시군도 ——
  {
    id: "o2023-01",
    parcelId: "p2023-01",
    name: "손정득",
    roadType: "시군도",
    parcelText: "1",
    area: 74,
    amount: 110_593_000,
  },
  {
    id: "o2023-02",
    parcelId: "p2023-02",
    name: "최대섭",
    roadType: "시군도",
    parcelText: "1",
    area: 172,
    amount: 22_962_000,
  },
  {
    id: "o2023-03",
    parcelId: "p2023-03",
    name: "최문규",
    roadType: "시군도",
    parcelText: "1",
    area: 119,
    amount: 11_370_450,
  },
  {
    id: "o2023-04",
    parcelId: "p2023-04",
    name: "정효교",
    roadType: "시군도",
    parcelText: "1",
    area: 53,
    amount: 59_254_000,
  },
  {
    id: "o2023-05",
    parcelId: "p2023-05",
    name: "전인호",
    roadType: "시군도",
    parcelText: "1",
    area: 31,
    amount: 25_435_500,
  },
  {
    id: "o2023-06a",
    parcelId: "p2023-06",
    name: "박선혜",
    roadType: "시군도",
    parcelText: "1",
    area: 25.5,
    amount: 44_599_500,
  },
  {
    id: "o2023-06b",
    parcelId: "p2023-06",
    name: "이완수",
    roadType: "시군도",
    parcelText: "1",
    area: 25.5,
    amount: 44_599_500,
  },
  {
    id: "o2023-08a",
    parcelId: "p2023-08",
    name: "임지혁",
    roadType: "시군도",
    parcelText: "1",
    area: 210.88,
    amount: 151_728_160,
  },
  {
    id: "o2023-08b",
    parcelId: "p2023-08",
    name: "임미정",
    roadType: "시군도",
    parcelText: "1",
    area: 210.88,
    amount: 151_728_160,
  },
  {
    id: "o2023-08c",
    parcelId: "p2023-08",
    name: "최승연",
    roadType: "시군도",
    parcelText: "1",
    area: 52.72,
    amount: 37_932_040,
  },
  {
    id: "o2023-10a",
    parcelId: "p2023-10",
    name: "전종길",
    roadType: "시군도",
    parcelText: "1",
    area: 42.4,
    amount: 13_250_000,
  },
  {
    id: "o2023-10b",
    parcelId: "p2023-10",
    name: "전은주",
    roadType: "시군도",
    parcelText: "1",
    area: 63.6,
    amount: 19_875_000,
  },
  {
    id: "o2023-13",
    parcelId: "p2023-13",
    name: "김숙희",
    roadType: "시군도",
    parcelText: "1",
    area: 222,
    amount: 95_015_000,
  },
  {
    id: "o2023-14",
    parcelId: "p2023-14",
    name: "신정자",
    roadType: "시군도",
    parcelText: "1",
    area: 5,
    amount: 9_055_000,
  },
  {
    id: "o2023-15",
    parcelId: "p2023-15",
    name: "영일정씨사정공파",
    roadType: "시군도",
    parcelText: "1",
    area: 103,
    amount: 18_591_500,
  },
  {
    id: "o2023-16",
    parcelId: "p2023-16",
    name: "박재우",
    roadType: "시군도",
    parcelText: "1",
    area: 45.28,
    amount: 15_395_200,
  },
  {
    id: "o2023-17",
    parcelId: "p2023-17",
    name: "배해숙",
    roadType: "시군도",
    parcelText: "1",
    area: 89,
    amount: 28_435_500,
  },
  {
    id: "o2023-18",
    parcelId: "p2023-18",
    name: "신석하",
    roadType: "시군도",
    parcelText: "1",
    area: 27,
    amount: 3_442_500,
  },
  {
    id: "o2023-19",
    parcelId: "p2023-19",
    name: "김인수",
    roadType: "시군도",
    parcelText: "1",
    area: 34,
    amount: 29_376_000,
  },
  {
    id: "o2023-20",
    parcelId: "p2023-20",
    name: "권영모",
    roadType: "시군도",
    parcelText: "1",
    area: 53,
    amount: 4_966_100,
  },
  {
    id: "o2023-21",
    parcelId: "p2023-21",
    name: "이성호",
    roadType: "시군도",
    parcelText: "1",
    area: 50,
    amount: 8_750_000,
  },
  {
    id: "o2023-22",
    parcelId: "p2023-22",
    name: "김규해",
    roadType: "시군도",
    parcelText: "1",
    area: 83,
    amount: 12_616_000,
  },
  {
    id: "o2023-23",
    parcelId: "p2023-23",
    name: "매경주택",
    roadType: "시군도",
    parcelText: "1",
    area: 67,
    amount: 49_345_500,
  },
  {
    id: "o2023-24",
    parcelId: "p2023-24",
    name: "정재엽",
    roadType: "시군도",
    parcelText: "1",
    area: 6.5,
    amount: 1_036_750,
  },
  // —— 2023 지방도: 선화리 1260-2 소유자 10명 ——
  {
    id: "o2023-26a",
    parcelId: "p2023-26",
    name: "배숙영",
    roadType: "지방도",
    parcelText: "1",
    area: 21.15,
    amount: 2_527_280,
  },
  {
    id: "o2023-26b",
    parcelId: "p2023-26",
    name: "배숙정",
    roadType: "지방도",
    parcelText: "1",
    area: 21.15,
    amount: 2_527_280,
  },
  {
    id: "o2023-26c",
    parcelId: "p2023-26",
    name: "배정일",
    roadType: "지방도",
    parcelText: "1",
    area: 21.15,
    amount: 2_527_280,
  },
  {
    id: "o2023-26d",
    parcelId: "p2023-26",
    name: "배석수",
    roadType: "지방도",
    parcelText: "1",
    area: 57.88,
    amount: 6_916_770,
  },
  {
    id: "o2023-26e",
    parcelId: "p2023-26",
    name: "배석윤",
    roadType: "지방도",
    parcelText: "1",
    area: 57.88,
    amount: 6_916_770,
  },
  {
    id: "o2023-26f",
    parcelId: "p2023-26",
    name: "배석준",
    roadType: "지방도",
    parcelText: "1",
    area: 57.88,
    amount: 6_916_770,
  },
  {
    id: "o2023-26g",
    parcelId: "p2023-26",
    name: "배태숙",
    roadType: "지방도",
    parcelText: "1",
    area: 27.83,
    amount: 3_325_370,
  },
  {
    id: "o2023-26h",
    parcelId: "p2023-26",
    name: "배영숙",
    roadType: "지방도",
    parcelText: "1",
    area: 14.47,
    amount: 1_729_190,
  },
  {
    id: "o2023-26i",
    parcelId: "p2023-26",
    name: "정지이",
    roadType: "지방도",
    parcelText: "1",
    area: 27.83,
    amount: 3_325_370,
  },
  {
    id: "o2023-26j",
    parcelId: "p2023-26",
    name: "배분태",
    roadType: "지방도",
    parcelText: "1",
    area: 14.47,
    amount: 1_729_190,
  },
  {
    id: "o2023-27",
    parcelId: "p2023-27",
    name: "김상진",
    roadType: "지방도",
    parcelText: "1",
    area: 129,
    amount: 10_758_600,
  },
  {
    id: "o2023-28",
    parcelId: "p2023-28",
    name: "김상진",
    roadType: "지방도",
    parcelText: "1",
    area: 40,
    amount: 3_336_000,
  },
  {
    id: "o2023-29",
    parcelId: "p2023-29",
    name: "김상진",
    roadType: "지방도",
    parcelText: "1",
    area: 119,
    amount: 9_924_600,
  },
  {
    id: "o2023-30",
    parcelId: "p2023-30",
    name: "윤은표",
    roadType: "지방도",
    parcelText: "1",
    area: 423,
    amount: 280_991_000,
  },
  {
    id: "o2023-31",
    parcelId: "p2023-31",
    name: "김종엽",
    roadType: "지방도",
    parcelText: "1",
    area: 11,
    amount: 1_155_000,
  },
  {
    id: "o2023-32",
    parcelId: "p2023-32",
    name: "김종엽",
    roadType: "지방도",
    parcelText: "1",
    area: 12,
    amount: 1_260_000,
  },
  {
    id: "o2023-33",
    parcelId: "p2023-33",
    name: "윤현숙",
    roadType: "지방도",
    parcelText: "1",
    area: 167.69,
    amount: 14_714_790,
  },
  {
    id: "o2023-34",
    parcelId: "p2023-34",
    name: "윤현숙",
    roadType: "지방도",
    parcelText: "1",
    area: 126.92,
    amount: 15_166_940,
  },
  {
    id: "o2023-35",
    parcelId: "p2023-35",
    name: "윤현숙",
    roadType: "지방도",
    parcelText: "1",
    area: 144.61,
    amount: 18_654_690,
  },
  // —— 2026 ——
  {
    id: "o1",
    parcelId: "p2026-01",
    name: "정준택",
    roadType: "시군도",
    parcelText: "1",
    area: 188,
    amount: 81_874_000,
  },
  {
    id: "o2",
    parcelId: "p2026-02",
    name: "김춘자",
    roadType: "시군도",
    parcelText: "1",
    area: 16,
    amount: 12_288_000,
  },
  {
    id: "o3",
    parcelId: "p2026-03",
    name: "김춘자",
    roadType: "시군도",
    parcelText: "1",
    area: 28,
    amount: 21_504_000,
  },
  {
    id: "o4",
    parcelId: "p2026-04",
    name: "김춘자",
    roadType: "시군도",
    parcelText: "1",
    area: 33,
    amount: 25_344_000,
  },
  {
    id: "o5",
    parcelId: "p2026-05",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 6.8,
    amount: 10_200_000,
  },
  {
    id: "o6",
    parcelId: "p2026-06",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 24,
    amount: 36_000_000,
  },
  {
    id: "o7",
    parcelId: "p2026-07",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 23.5,
    amount: 35_250_000,
  },
  {
    id: "o8",
    parcelId: "p2026-08",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 22,
    amount: 33_000_000,
  },
  {
    id: "o9",
    parcelId: "p2026-09",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 23,
    amount: 34_500_000,
  },
  {
    id: "o10",
    parcelId: "p2026-10",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 15,
    amount: 22_500_000,
  },
  {
    id: "o11",
    parcelId: "p2026-11",
    name: "최병관",
    roadType: "시군도",
    parcelText: "1",
    area: 18,
    amount: 27_000_000,
  },
  {
    id: "o12",
    parcelId: "p2026-12",
    name: "최병관",
    roadType: "지방도",
    parcelText: "1",
    area: 304.8,
    amount: 18_288_000,
  },
  {
    id: "o13",
    parcelId: "p2026-13",
    name: "최병관",
    roadType: "지방도",
    parcelText: "1",
    area: 79,
    amount: 4_740_000,
  },
  {
    id: "o14",
    parcelId: "p2026-14",
    name: "최병관",
    roadType: "지방도",
    parcelText: "1",
    area: 66,
    amount: 3_960_000,
  },
  {
    id: "o15",
    parcelId: "p2026-15",
    name: "최병관",
    roadType: "지방도",
    parcelText: "1",
    area: 117.8,
    amount: 7_068_000,
  },
  {
    id: "o16a",
    parcelId: "p2026-16",
    name: "박태분",
    roadType: "지방도",
    parcelText: "1",
    area: 43,
    amount: 2_797_700,
    areaNote: "43(92/198)",
  },
  {
    id: "o16b",
    parcelId: "p2026-16",
    name: "박민경",
    roadType: "지방도",
    parcelText: "1",
    area: 0,
    amount: 1_578_900,
    areaNote: "43(52/198)",
  },
  {
    id: "o16c",
    parcelId: "p2026-16",
    name: "박원규",
    roadType: "지방도",
    parcelText: "1",
    area: 0,
    amount: 1_578_900,
    areaNote: "43(52/198)",
  },
  {
    id: "o17",
    parcelId: "p2026-17",
    name: "박치준",
    roadType: "지방도",
    parcelText: "1",
    area: 358,
    amount: 187_950_000,
  },
];

/** 박치준 행의 국도 칸 «소송» — 도로종류와 별도 표기용 */
export const UNPAID_LAND_OWNER_EXTRA_NOTES: Record<
  string,
  Partial<Record<UnpaidLandRoadType, string>>
> = {
  o17: { 국도: "소송" },
};

export function unpaidLandExpenseSetTotal(set: UnpaidLandExpenseSet | null | undefined): number {
  if (!set) return 0;
  return set.items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0);
}

export function countParcelsInExpenseSet(
  expenseSetId: string,
  parcels: UnpaidLandParcel[] = UNPAID_LAND_PARCELS
): number {
  return parcels.filter((p) => p.expenseSetId === expenseSetId).length;
}

export function buildUnpaidLandListRows(
  parcels: UnpaidLandParcel[] = UNPAID_LAND_PARCELS,
  owners: UnpaidLandOwner[] = UNPAID_LAND_OWNERS,
  expenseSets: UnpaidLandExpenseSet[] = UNPAID_LAND_EXPENSE_SETS
): UnpaidLandListRow[] {
  const expenseById = new Map(expenseSets.map((e) => [e.id, e]));
  const ownersByParcel = new Map<string, UnpaidLandOwner[]>();
  for (const o of owners) {
    const list = ownersByParcel.get(o.parcelId) ?? [];
    list.push(o);
    ownersByParcel.set(o.parcelId, list);
  }
  return parcels
    .map((parcel) => ({
      parcel,
      owners: ownersByParcel.get(parcel.id) ?? [],
      expenseSet: parcel.expenseSetId
        ? expenseById.get(parcel.expenseSetId) ?? null
        : null,
    }))
    .sort((a, b) =>
      a.parcel.year !== b.parcel.year
        ? a.parcel.year - b.parcel.year
        : a.parcel.seq - b.parcel.seq
    );
}

export function formatUnpaidLandMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

export function formatUnpaidLandArea(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  return Number(n.toFixed(4)).toString();
}

export function summarizeUnpaidLandOwners(owners: UnpaidLandOwner[]): string {
  if (owners.length === 0) return "—";
  if (owners.length === 1) return owners[0]!.name;
  return `${owners[0]!.name} 외 ${owners.length - 1}`;
}
