/**
 * 보상편입용지 — UI 목업 데이터.
 * 편입 범위 도형은 건(case)당 1개. 필지목록은 도형과 교차하는 지적에서 자동 채운다.
 */

export type RoadRewardParcel = {
  id: string;
  /** 지적 PNU — 도형 교차 조회 결과 매칭·보존용 */
  pnu?: string;
  /** 읍면동 (읍/면 + 리/동을 하나로 표시) */
  eupmyeonDong: string;
  /** 지번(당초) */
  jibunOriginal: string;
  /** 지번(편입) */
  jibunIncluded: string;
  /** 당초면적(㎡) */
  areaOriginal: number;
  /** 편입면적(㎡) */
  areaIncluded: number;
  /** 지목 */
  jimok: string;
  /** 감정평가1 금액(원/㎡) — 감정기관명은 건(RoadRewardCase)마다 다름 */
  appraisal1Value: number;
  /** 감정평가2 금액(원/㎡) — 감정기관명은 건(RoadRewardCase)마다 다름 */
  appraisal2Value: number;
  /** 적용단가(원/㎡) — 감정평가1·2 평균으로 자동 계산 */
  appliedUnitPrice: number;
  /** 보상금액(원) — 적용단가 × 편입면적으로 자동 계산 */
  compensationAmount: number;
  /** 토지소유자 주소 (주소 검색 API로 입력) */
  ownerAddress: string;
  /** 토지소유자 성명 */
  ownerName: string;
  /** 비고 */
  note: string;
  /** 지적 필지 도형(조회 결과, EPSG:3857) — 건 편입 범위와 별개, 지도 하이라이트용 */
  geometry3857?: Record<string, unknown> | null;
  /** geometry3857의 바운딩 박스(EPSG:3857) */
  extent3857?: [number, number, number, number] | null;
  /** UI 목업·폴백 좌표(EPSG:4326) */
  mockLonLat: { lon: number; lat: number };
};

export type RoadRewardCase = {
  id: string;
  /** 건명 */
  name: string;
  /** 조직 */
  org: string;
  /** 정책 */
  policy: string;
  /** 단위 */
  unit: string;
  /** 세부 */
  detail: string;
  /** 편성목 */
  budgetItem: string;
  /** 통계목 */
  statItem: string;
  /** 감정평가기관1 명칭 — 건마다 다를 수 있음 */
  appraisal1Name: string;
  /** 감정평가기관2 명칭 — 건마다 다를 수 있음 */
  appraisal2Name: string;
  /** 편입 범위 도형(GeoJSON, EPSG:3857) — 건당 1개 */
  geometry3857?: Record<string, unknown> | null;
  /** 편입 범위 바운딩 박스(EPSG:3857) */
  extent3857?: [number, number, number, number] | null;
  parcels: RoadRewardParcel[];
  /** 목록 API의 필지 건수(상세 로드 전) */
  parcelCount?: number;
};

export type RoadRewardCaseField = {
  field: keyof Pick<
    RoadRewardCase,
    | "name"
    | "org"
    | "policy"
    | "unit"
    | "detail"
    | "budgetItem"
    | "statItem"
    | "appraisal1Name"
    | "appraisal2Name"
  >;
  label: string;
  /** 상세 속성 표에서 다른 항목과 짝 없이 한 줄 전체를 차지 */
  fullWidth?: boolean;
};

export const ROAD_REWARD_CASE_FIELDS: RoadRewardCaseField[] = [
  { field: "name", label: "건명", fullWidth: true },
  { field: "org", label: "조직" },
  { field: "policy", label: "정책" },
  { field: "unit", label: "단위" },
  { field: "detail", label: "세부" },
  { field: "budgetItem", label: "편성목" },
  { field: "statItem", label: "통계목" },
  { field: "appraisal1Name", label: "감정기관1" },
  { field: "appraisal2Name", label: "감정기관2" },
];

export type RoadRewardParcelField = {
  field: keyof Omit<RoadRewardParcel, "id" | "pnu" | "mockLonLat" | "geometry3857" | "extent3857">;
  label: string;
  numeric?: boolean;
  /** 입력폼에서 제외 — 자동 계산되어 표시만 함 */
  computed?: boolean;
};

/** 감정기관명은 건(case)마다 다르므로 라벨을 그때그때 만들어 쓴다 */
export function getRoadRewardParcelFields(
  caseItem: Pick<RoadRewardCase, "appraisal1Name" | "appraisal2Name">
): RoadRewardParcelField[] {
  const name1 = caseItem.appraisal1Name?.trim() || "감정평가1";
  const name2 = caseItem.appraisal2Name?.trim() || "감정평가2";
  return [
    { field: "eupmyeonDong", label: "읍면동" },
    { field: "jibunOriginal", label: "지번(당초)" },
    { field: "jibunIncluded", label: "지번(편입)" },
    { field: "areaOriginal", label: "당초면적(㎡)", numeric: true },
    { field: "areaIncluded", label: "편입면적(㎡)", numeric: true },
    { field: "jimok", label: "지목" },
    { field: "appraisal1Value", label: `${name1}(원/㎡)`, numeric: true },
    { field: "appraisal2Value", label: `${name2}(원/㎡)`, numeric: true },
    { field: "appliedUnitPrice", label: "적용단가(원/㎡)", numeric: true, computed: true },
    { field: "compensationAmount", label: "보상금액(원)", numeric: true, computed: true },
    { field: "ownerAddress", label: "토지소유자 주소" },
    { field: "ownerName", label: "토지소유자 성명" },
    { field: "note", label: "비고" },
  ];
}

/** 적용단가 = 감정평가1·2 평균, 보상금액 = 적용단가 × 편입면적 (자동 계산, 수동 입력 아님) */
export function computeRoadRewardDerived(
  appraisal1Value: number,
  appraisal2Value: number,
  areaIncluded: number
): { appliedUnitPrice: number; compensationAmount: number } {
  const a1 = Number.isFinite(appraisal1Value) ? appraisal1Value : 0;
  const a2 = Number.isFinite(appraisal2Value) ? appraisal2Value : 0;
  const area = Number.isFinite(areaIncluded) ? areaIncluded : 0;
  const appliedUnitPrice = Math.round((a1 + a2) / 2);
  const compensationAmount = Math.round(appliedUnitPrice * area);
  return { appliedUnitPrice, compensationAmount };
}

/**
 * 지번 주소 문자열에서 읍면동·지번을 분리한다.
 * 예: "경상북도 울진군 울진읍 연지리 123-4" → { eupmyeonDong: "울진읍 연지리", jibun: "123-4" }
 */
export function parseParcelJibunAddress(jibunAddress: string): {
  eupmyeonDong: string;
  jibun: string;
} {
  const s = String(jibunAddress ?? "")
    .replace(/번지/g, "")
    .trim();
  if (!s) return { eupmyeonDong: "", jibun: "" };

  const tokens = s.split(/\s+/).filter(Boolean);
  let jibun = "";
  let jibunIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (/^산?\d+(-\d+)?$/.test(t)) {
      jibun = t;
      jibunIdx = i;
      break;
    }
  }

  const before = jibunIdx >= 0 ? tokens.slice(0, jibunIdx) : tokens;
  let emd = "";
  let ri = "";
  for (const t of before) {
    if (/(읍|면|동)$/.test(t)) emd = t;
    else if (/리$/.test(t)) ri = t;
  }
  if (!emd && before.length > 0) {
    const local = before.filter(
      (t) =>
        /(읍|면|동|리)$/.test(t) ||
        (!/(특별시|광역시|특별자치시|특별자치도|도)$/.test(t) && !/(시|군|구)$/.test(t))
    );
    if (local.length >= 2) {
      emd = local[local.length - 2]!;
      ri = local[local.length - 1]!;
    } else if (local.length === 1) {
      emd = local[0]!;
    }
  }

  return { eupmyeonDong: [emd, ri].filter(Boolean).join(" "), jibun };
}

let idSeq = 0;
export function createRoadRewardId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

/** 목업 지도 표시 기준점 — 울진군 대략 위치 (실제 지적 좌표 아님) */
const MOCK_BASE_LON = 129.4;
const MOCK_BASE_LAT = 36.99;

function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

function mockLonLat(index: number): { lon: number; lat: number } {
  const angle = (index * 47) % 360;
  const radius = 0.01 + (index % 5) * 0.006;
  const rad = (angle * Math.PI) / 180;
  return {
    lon: Number((MOCK_BASE_LON + Math.cos(rad) * radius).toFixed(6)),
    lat: Number((MOCK_BASE_LAT + Math.sin(rad) * radius).toFixed(6)),
  };
}

function mockPolygonGeom(
  lon: number,
  lat: number,
  seed: number,
  scale = 1
): {
  geometry3857: Record<string, unknown>;
  extent3857: [number, number, number, number];
} {
  const [cx, cy] = lonLatTo3857(lon, lat);
  const halfW = (45 + (seed % 5) * 18) * scale;
  const halfH = (35 + (seed % 4) * 15) * scale;
  const ring: [number, number][] = [
    [cx - halfW, cy - halfH],
    [cx + halfW, cy - halfH],
    [cx + halfW, cy + halfH],
    [cx - halfW, cy + halfH],
    [cx - halfW, cy - halfH],
  ];
  return {
    geometry3857: { type: "Polygon", coordinates: [ring] },
    extent3857: [cx - halfW, cy - halfH, cx + halfW, cy + halfH],
  };
}

/** 여러 extent를 감싸는 건 단위 편입 범위(목업) */
function unionExtentAsCaseGeom(
  extents: [number, number, number, number][]
): {
  geometry3857: Record<string, unknown>;
  extent3857: [number, number, number, number];
} | null {
  if (extents.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of extents) {
    minX = Math.min(minX, e[0]);
    minY = Math.min(minY, e[1]);
    maxX = Math.max(maxX, e[2]);
    maxY = Math.max(maxY, e[3]);
  }
  const pad = 40;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return {
    geometry3857: {
      type: "Polygon",
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
    extent3857: [minX, minY, maxX, maxY],
  };
}

let parcelSeed = 0;
export function createEmptyRoadRewardParcel(): RoadRewardParcel {
  parcelSeed += 1;
  return {
    id: createRoadRewardId("parcel"),
    pnu: undefined,
    eupmyeonDong: "",
    jibunOriginal: "",
    jibunIncluded: "",
    areaOriginal: 0,
    areaIncluded: 0,
    jimok: "",
    appraisal1Value: 0,
    appraisal2Value: 0,
    appliedUnitPrice: 0,
    compensationAmount: 0,
    ownerAddress: "",
    ownerName: "",
    note: "",
    geometry3857: null,
    extent3857: null,
    mockLonLat: mockLonLat(parcelSeed + 100),
  };
}

export function createEmptyRoadRewardCase(): RoadRewardCase {
  return {
    id: createRoadRewardId("case"),
    name: "",
    org: "",
    policy: "",
    unit: "",
    detail: "",
    budgetItem: "",
    statItem: "",
    appraisal1Name: "",
    appraisal2Name: "",
    geometry3857: null,
    extent3857: null,
    parcels: [],
  };
}

function makeParcel(
  seed: number,
  data: Omit<
    RoadRewardParcel,
    | "id"
    | "pnu"
    | "mockLonLat"
    | "appliedUnitPrice"
    | "compensationAmount"
    | "geometry3857"
    | "extent3857"
  > & { pnu?: string }
): RoadRewardParcel {
  const { appliedUnitPrice, compensationAmount } = computeRoadRewardDerived(
    data.appraisal1Value,
    data.appraisal2Value,
    data.areaIncluded
  );
  const ll = mockLonLat(seed);
  const { geometry3857, extent3857 } = mockPolygonGeom(ll.lon, ll.lat, seed);
  return {
    id: createRoadRewardId("parcel"),
    pnu: data.pnu,
    eupmyeonDong: data.eupmyeonDong,
    jibunOriginal: data.jibunOriginal,
    jibunIncluded: data.jibunIncluded,
    areaOriginal: data.areaOriginal,
    areaIncluded: data.areaIncluded,
    jimok: data.jimok,
    appraisal1Value: data.appraisal1Value,
    appraisal2Value: data.appraisal2Value,
    appliedUnitPrice,
    compensationAmount,
    ownerAddress: data.ownerAddress,
    ownerName: data.ownerName,
    note: data.note,
    geometry3857,
    extent3857,
    mockLonLat: ll,
  };
}

function withCaseGeom(casePartial: Omit<RoadRewardCase, "geometry3857" | "extent3857">): RoadRewardCase {
  const extents = casePartial.parcels
    .map((p) => p.extent3857)
    .filter((e): e is [number, number, number, number] => Array.isArray(e) && e.length === 4);
  const union = unionExtentAsCaseGeom(extents);
  return {
    ...casePartial,
    geometry3857: union?.geometry3857 ?? null,
    extent3857: union?.extent3857 ?? null,
  };
}

/** 지적 교차 조회 결과 → 필지. 기존 필지(감정·소유자 등)는 pnu/주소로 보존. 지목·당초면적은 지적에서 채움 */
export function mergeJijukIntoRoadRewardParcels(
  jijukItems: Array<{
    address: string;
    pnu?: string;
    jimok?: string;
    areaSqm?: number;
    extent3857?: [number, number, number, number] | null;
    geometry3857?: Record<string, unknown> | null;
  }>,
  previous: RoadRewardParcel[]
): RoadRewardParcel[] {
  const byPnu = new Map<string, RoadRewardParcel>();
  const byAddr = new Map<string, RoadRewardParcel>();
  for (const p of previous) {
    const pnu = String(p.pnu ?? "").trim();
    if (pnu) byPnu.set(pnu, p);
    const addr = `${p.eupmyeonDong} ${p.jibunOriginal}`.trim().toLowerCase();
    if (addr) byAddr.set(addr, p);
  }

  return jijukItems.map((item) => {
    const address = String(item.address ?? "").trim();
    const pnu = String(item.pnu ?? "").trim();
    const { eupmyeonDong, jibun } = parseParcelJibunAddress(address);
    const prev =
      (pnu && byPnu.get(pnu)) ||
      byAddr.get(`${eupmyeonDong} ${jibun}`.trim().toLowerCase()) ||
      byAddr.get(address.toLowerCase()) ||
      null;

    const base = createEmptyRoadRewardParcel();
    let mockLonLat = base.mockLonLat;
    const ext = item.extent3857;
    if (ext && ext.every((v) => Number.isFinite(v))) {
      const cx = (ext[0] + ext[2]) / 2;
      const cy = (ext[1] + ext[3]) / 2;
      // 대략 역변환 (표시용)
      const lon = (cx * 180) / 20037508.34;
      const lat =
        (Math.atan(Math.exp((cy * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
      if (Number.isFinite(lon) && Number.isFinite(lat)) mockLonLat = { lon, lat };
    }

    const jijukJimok = String(item.jimok ?? "").trim();
    const jijukArea = Number(item.areaSqm);
    const areaFromGeom = Number.isFinite(jijukArea) && jijukArea > 0 ? jijukArea : 0;

    const next: RoadRewardParcel = {
      ...base,
      id: prev?.id ?? base.id,
      pnu: pnu || prev?.pnu,
      eupmyeonDong: eupmyeonDong || prev?.eupmyeonDong || "",
      jibunOriginal: jibun || prev?.jibunOriginal || "",
      jibunIncluded: prev?.jibunIncluded || jibun || "",
      // 도형 갱신 시 지적 도형 면적·지목을 우선 반영
      areaOriginal: areaFromGeom || prev?.areaOriginal || 0,
      areaIncluded: prev?.areaIncluded ?? 0,
      jimok: jijukJimok || prev?.jimok || "",
      appraisal1Value: prev?.appraisal1Value ?? 0,
      appraisal2Value: prev?.appraisal2Value ?? 0,
      appliedUnitPrice: prev?.appliedUnitPrice ?? 0,
      compensationAmount: prev?.compensationAmount ?? 0,
      ownerAddress: prev?.ownerAddress ?? "",
      ownerName: prev?.ownerName ?? "",
      note: prev?.note ?? "",
      geometry3857: item.geometry3857 ?? null,
      extent3857: item.extent3857 ?? null,
      mockLonLat: prev?.mockLonLat ?? mockLonLat,
    };
    const { appliedUnitPrice, compensationAmount } = computeRoadRewardDerived(
      next.appraisal1Value,
      next.appraisal2Value,
      next.areaIncluded
    );
    next.appliedUnitPrice = appliedUnitPrice;
    next.compensationAmount = compensationAmount;
    return next;
  });
}

export function createInitialRoadRewardCases(): RoadRewardCase[] {
  return [
    withCaseGeom({
      id: createRoadRewardId("case"),
      name: "동해대로 확장사업 보상편입",
      org: "도로과",
      policy: "도로정비사업",
      unit: "도로확장",
      detail: "동해대로 확장사업",
      budgetItem: "공유재산관리비",
      statItem: "보상금",
      appraisal1Name: "새롬감정",
      appraisal2Name: "대호감정",
      parcels: [
        makeParcel(1, {
          pnu: "4793025021101230004",
          eupmyeonDong: "울진읍 연지리",
          jibunOriginal: "123-4",
          jibunIncluded: "123-4",
          areaOriginal: 850,
          areaIncluded: 120,
          jimok: "전",
          appraisal1Value: 185000,
          appraisal2Value: 179000,
          ownerAddress: "경상북도 울진군 울진읍 연지리 45",
          ownerName: "김OO",
          note: "",
        }),
        makeParcel(2, {
          pnu: "4793025021101250001",
          eupmyeonDong: "울진읍 연지리",
          jibunOriginal: "125-1",
          jibunIncluded: "125-1",
          areaOriginal: 640,
          areaIncluded: 85,
          jimok: "답",
          appraisal1Value: 176000,
          appraisal2Value: 181000,
          ownerAddress: "경상북도 울진군 울진읍 연지리 12",
          ownerName: "이OO",
          note: "경계 협의 완료",
        }),
      ],
    }),
    withCaseGeom({
      id: createRoadRewardId("case"),
      name: "매화지방도 선형개량사업 보상편입",
      org: "도로과",
      policy: "도로정비사업",
      unit: "도로선형개량",
      detail: "매화지방도 선형개량사업",
      budgetItem: "공유재산관리비",
      statItem: "보상금",
      appraisal1Name: "정한감정",
      appraisal2Name: "미래새한감정",
      parcels: [
        makeParcel(3, {
          pnu: "4793035021100880002",
          eupmyeonDong: "매화면 매화리",
          jibunOriginal: "88-2",
          jibunIncluded: "88-3",
          areaOriginal: 920,
          areaIncluded: 260,
          jimok: "도로",
          appraisal1Value: 92000,
          appraisal2Value: 89500,
          ownerAddress: "경상북도 울진군 매화면 매화리 210",
          ownerName: "박OO",
          note: "",
        }),
      ],
    }),
    withCaseGeom({
      id: createRoadRewardId("case"),
      name: "구산로 확포장사업 보상편입",
      org: "도로과",
      policy: "도로정비사업",
      unit: "도로확포장",
      detail: "구산로 확포장사업",
      budgetItem: "시설비",
      statItem: "보상금",
      appraisal1Name: "가온감정",
      appraisal2Name: "현대감정",
      parcels: [
        makeParcel(4, {
          pnu: "4793031022103120001",
          eupmyeonDong: "근남면 행곡리",
          jibunOriginal: "312-1",
          jibunIncluded: "312-1",
          areaOriginal: 450,
          areaIncluded: 130,
          jimok: "구거",
          appraisal1Value: 65000,
          appraisal2Value: 67000,
          ownerAddress: "경상북도 울진군 근남면 행곡리 5",
          ownerName: "최OO",
          note: "",
        }),
        makeParcel(5, {
          pnu: "4793031022103140002",
          eupmyeonDong: "근남면 행곡리",
          jibunOriginal: "314-2",
          jibunIncluded: "314-2",
          areaOriginal: 380,
          areaIncluded: 95,
          jimok: "임야",
          appraisal1Value: 41000,
          appraisal2Value: 39500,
          ownerAddress: "경상북도 울진군 근남면 행곡리 21",
          ownerName: "정OO",
          note: "",
        }),
      ],
    }),
  ];
}
