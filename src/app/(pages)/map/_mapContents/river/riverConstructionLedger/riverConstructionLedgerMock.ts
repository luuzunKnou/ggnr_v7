/** 하천 공사대장 — 임시 데이터·CRUD 헬퍼 (실DB 연동 시 교체) */

import type { LayerRowParcelItem } from "../../../_mapComponents/layerRowEdit/types";

export type RiverConstructionLedgerGeom = {
  type: "MultiPolygon";
  /** WGS84 — 폴리곤 여러 개: [ [ [ [lon,lat], ... 외곽선 ] ], ... ] 공사구간이 여러 구역으로 나뉠 수 있음 */
  coordinates: [number, number][][][];
};

export type RiverConstructionLedgerPreviewKind = "image" | "pdf" | "other";

/** 첨부 분류 — 상세 패널 첨부 탭 구분용 */
export type RiverConstructionLedgerAttachmentCategory = "drawing" | "spec" | "start" | "etc";

export const RIVER_CONSTRUCTION_ATTACHMENT_CATEGORIES: {
  value: RiverConstructionLedgerAttachmentCategory;
  label: string;
}[] = [
  { value: "drawing", label: "도면" },
  { value: "spec", label: "시방서" },
  { value: "start", label: "착수" },
  { value: "etc", label: "기타" },
];

export type RiverConstructionLedgerAttachment = {
  id: string;
  name: string;
  category: RiverConstructionLedgerAttachmentCategory;
  sizeLabel: string;
  uploadedAt: string;
  previewUrl?: string;
  previewKind?: RiverConstructionLedgerPreviewKind;
};

export type RiverConstructionLedgerRow = {
  id: string;
  /** 공사명 */
  name: string;
  /** 공사위치 */
  location: string;
  /** 공사량 */
  quantity: string;
  /** 대상 하천명 (복수) — 상세 «대상 하천» 섹션 */
  riverNames: string[];
  /** 계약일 */
  contractDate: string;
  /** 착수일자 */
  startDate: string;
  /** 준공일자 */
  endDate: string;
  /** 실준공일자 */
  actualEndDate: string;
  /** 업체명 */
  companyName: string;
  /** 대표자명 */
  representative: string;
  /** 전화번호 */
  phone: string;
  /** 업체주소 */
  companyAddress: string;
  /** 감독관 */
  supervisor: string;
  /** 감독관명 */
  supervisorName: string;
  /** 사업비_전 */
  budgetBefore: string;
  /** 사업비_증가 */
  budgetIncrease: string;
  /** 사업비_감소 */
  budgetDecrease: string;
  /** 사업비_후 */
  budgetAfter: string;
  /** 변경사유 */
  changeReason: string;
  /** 비고 */
  remark: string;
  geom: RiverConstructionLedgerGeom | null;
  attachments: RiverConstructionLedgerAttachment[];
  /** 공사구간 도형과 겹치는 필지 목록 — 도형 그리기/수정 시 자동 조회 + 수동 추가(도로점용과 동일 패턴) */
  parcels: LayerRowParcelItem[];
};

/** 목록·검색용 임시 하천 후보 (대량 선택 UI 확인용 ~60) */
export const RIVER_CONSTRUCTION_RIVER_PRESETS = [
  "남천",
  "동천",
  "서천",
  "북천",
  "왕피천",
  "매화천",
  "평해천",
  "후포천",
  "죽변천",
  "근남천",
  "기성천",
  "온정천",
  "금강천",
  "소광천",
  "부구천",
  "나곡천",
  "원남천",
  "삼근천",
  "두천천",
  "장천",
  "신림천",
  "오산천",
  "수산천",
  "화천",
  "덕신천",
  "울진천",
  "성류천",
  "광천",
  "선유천",
  "월송천",
  "오산천2",
  "사동천",
  "백암천",
  "석정천",
  "진조천",
  "수곡천",
  "향정천",
  "하당천",
  "상당천",
  "연호천",
  "청암천",
  "내성천",
  "외성천",
  "갈전천",
  "신화천",
  "도계천",
  "영해천",
  "영덕천",
  "창수천",
  "병곡천",
  "축산천",
  "송천",
  "노음천",
  "수비천",
  "석보천",
  "온천천",
  "달방천",
  "광음천",
  "매봉천",
  "백암온천천",
] as const;

function poly(ring: [number, number][]): RiverConstructionLedgerGeom {
  const closed =
    ring.length > 0 &&
    (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1])
      ? [...ring, ring[0]!]
      : ring;
  return { type: "MultiPolygon", coordinates: [[closed]] };
}

/** 울진군 일대 대략 폴리곤 (시각화용) */
const GEOM_NAMCHEON = poly([
  [129.398, 36.988],
  [129.405, 36.988],
  [129.406, 36.994],
  [129.399, 36.995],
]);
const GEOM_DONGCHEON = poly([
  [129.418, 37.05],
  [129.428, 37.05],
  [129.429, 37.058],
  [129.419, 37.058],
]);
const GEOM_SEOCHON = poly([
  [129.348, 36.725],
  [129.358, 36.725],
  [129.359, 36.732],
  [129.349, 36.732],
]);
const GEOM_BUKCHEON = poly([
  [129.275, 36.945],
  [129.288, 36.945],
  [129.289, 36.955],
  [129.276, 36.955],
]);

const MOCK_ROWS: RiverConstructionLedgerRow[] = [
  {
    id: "rcl-001",
    name: "남천 제방보강공사",
    location: "남천 일원",
    quantity: "제방 1.2km",
    riverNames: ["남천"],
    contractDate: "2024-02-15",
    startDate: "2024-03-01",
    endDate: "2024-11-30",
    actualEndDate: "2024-11-28",
    companyName: "(주)한강건설",
    representative: "김한강",
    phone: "054-123-4567",
    companyAddress: "경북 울진군 울진읍 중앙로 12",
    supervisor: "하천과",
    supervisorName: "이감독",
    budgetBefore: "1,100",
    budgetIncrease: "150",
    budgetDecrease: "0",
    budgetAfter: "1,250",
    changeReason: "토공량 증가",
    remark: "우기 전 제방 보강 완료",
    geom: GEOM_NAMCHEON,
    attachments: [],
    parcels: [],
  },
  {
    id: "rcl-002",
    name: "동천·왕피천 호안정비공사",
    location: "동천·왕피천 중류",
    quantity: "호안 0.8km",
    riverNames: ["동천", "왕피천"],
    contractDate: "2025-01-20",
    startDate: "2025-02-15",
    endDate: "2025-12-31",
    actualEndDate: "",
    companyName: "(주)동해토건",
    representative: "박동해",
    phone: "054-234-5678",
    companyAddress: "경북 울진군 근남면 수산리 45",
    supervisor: "하천과",
    supervisorName: "최감독",
    budgetBefore: "800",
    budgetIncrease: "60",
    budgetDecrease: "0",
    budgetAfter: "860",
    changeReason: "",
    remark: "호안 블록 교체 구간",
    geom: GEOM_DONGCHEON,
    attachments: [],
    parcels: [],
  },
  {
    id: "rcl-003",
    name: "서천 수문개보수공사",
    location: "서천 하류",
    quantity: "수문 2기",
    riverNames: ["서천"],
    contractDate: "",
    startDate: "",
    endDate: "",
    actualEndDate: "",
    companyName: "",
    representative: "",
    phone: "",
    companyAddress: "",
    supervisor: "하천과",
    supervisorName: "",
    budgetBefore: "420",
    budgetIncrease: "0",
    budgetDecrease: "0",
    budgetAfter: "420",
    changeReason: "",
    remark: "설계 검토 중",
    geom: GEOM_SEOCHON,
    attachments: [],
    parcels: [],
  },
  {
    id: "rcl-004",
    name: "북천 퇴적토준설공사",
    location: "북천 상류",
    quantity: "준설 3,200㎥",
    riverNames: ["북천"],
    contractDate: "2023-04-01",
    startDate: "2023-05-10",
    endDate: "2023-09-20",
    actualEndDate: "2023-09-18",
    companyName: "(주)청수환경",
    representative: "정청수",
    phone: "054-345-6789",
    companyAddress: "경북 울진군 북면 부구로 88",
    supervisor: "환경과",
    supervisorName: "한감독",
    budgetBefore: "550",
    budgetIncrease: "0",
    budgetDecrease: "20",
    budgetAfter: "530",
    changeReason: "준설량 축소",
    remark: "퇴적토 반출 완료",
    geom: GEOM_BUKCHEON,
    attachments: [],
    parcels: [],
  },
  {
    id: "rcl-005",
    name: "남천·매화천 생태복원공사",
    location: "남천·매화천 상류",
    quantity: "식생대 0.5km",
    riverNames: ["남천", "매화천"],
    contractDate: "2025-03-10",
    startDate: "2025-04-01",
    endDate: "2025-11-30",
    actualEndDate: "",
    companyName: "(주)녹색하천",
    representative: "윤녹색",
    phone: "054-456-7890",
    companyAddress: "경북 울진군 평해읍 평해로 3",
    supervisor: "하천과",
    supervisorName: "오감독",
    budgetBefore: "950",
    budgetIncrease: "30",
    budgetDecrease: "0",
    budgetAfter: "980",
    changeReason: "식생 보강",
    remark: "식생대 조성",
    geom: poly([
      [129.401, 36.996],
      [129.408, 36.996],
      [129.409, 37.001],
      [129.402, 37.001],
    ]),
    attachments: [],
    parcels: [],
  },
  {
    id: "rcl-060",
    name: "울진권역 통합 하천정비공사",
    location: "울진군 일원",
    quantity: "정비 다수 구간",
    riverNames: [...RIVER_CONSTRUCTION_RIVER_PRESETS] as string[],
    contractDate: "2025-12-01",
    startDate: "2026-01-15",
    endDate: "2026-12-31",
    actualEndDate: "",
    companyName: "(주)통합하천",
    representative: "강통합",
    phone: "054-567-8901",
    companyAddress: "경북 울진군 울진읍 연호로 100",
    supervisor: "하천과",
    supervisorName: "송감독",
    budgetBefore: "12,000",
    budgetIncrease: "500",
    budgetDecrease: "0",
    budgetAfter: "12,500",
    changeReason: "대상 구간 확대",
    remark: "대상 하천 60개 — 대량 UI 확인용 임시 데이터",
    geom: GEOM_NAMCHEON,
    attachments: [],
    parcels: [],
  },
];

function formatSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");
}

function guessPreviewKind(name: string, mime?: string): RiverConstructionLedgerPreviewKind {
  const lower = name.toLowerCase();
  if (mime?.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(lower)) return "image";
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  return "other";
}

export function normalizeRiverNames(names: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names ?? []) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function formatRiverNamesLabel(names: string[] | undefined | null): string {
  const list = normalizeRiverNames(names);
  return list.length > 0 ? list.join(", ") : "—";
}

/** 목록 표용 축약 — 많으면 «남천 외 59» */
export function formatRiverNamesShort(
  names: string[] | undefined | null,
  maxShow = 2
): string {
  const list = normalizeRiverNames(names);
  if (list.length === 0) return "—";
  if (list.length <= maxShow) return list.join(", ");
  return `${list.slice(0, maxShow).join(", ")} 외 ${list.length - maxShow}`;
}

/** 등록 가능한 하천명인지 (임시 하천 마스터) */
export function isKnownRiverName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return (RIVER_CONSTRUCTION_RIVER_PRESETS as readonly string[]).some(
    (p) => p.toLowerCase() === n.toLowerCase()
  );
}

/** 마스터에 있는 정식 하천명으로 정규화 (없으면 null) */
export function resolveKnownRiverName(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  const hit = (RIVER_CONSTRUCTION_RIVER_PRESETS as readonly string[]).find(
    (p) => p.toLowerCase() === n.toLowerCase()
  );
  return hit ?? null;
}

function hashRiverName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** WGS84 → Web Mercator(EPSG:3857) 대략 변환 (임시 좌표용) */
function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

/**
 * 임시 하천명 → 울진 일대에 분산된 임시 위치.
 * DB 조회 없이 지도 이동·강조용.
 */
export function getMockRiverFocus(riverName: string): {
  riverName: string;
  extent3857: [number, number, number, number];
  geom: RiverConstructionLedgerGeom;
} | null {
  const name = riverName.trim();
  if (!name) return null;

  const presetIdx = (RIVER_CONSTRUCTION_RIVER_PRESETS as readonly string[]).indexOf(name);
  const i = presetIdx >= 0 ? presetIdx : hashRiverName(name) % 60;
  const col = i % 10;
  const row = Math.floor(i / 10);
  /** 울진군 일대 대략 격자 */
  const lon = 129.28 + col * 0.018;
  const lat = 36.72 + row * 0.032;
  const half = 0.0035;
  const geom = poly([
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half],
  ]);
  const corners = [
    lonLatTo3857(lon - half, lat - half),
    lonLatTo3857(lon + half, lat - half),
    lonLatTo3857(lon + half, lat + half),
    lonLatTo3857(lon - half, lat + half),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const extent3857: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  return { riverName: name, extent3857, geom };
}

export function rowHasRiver(row: RiverConstructionLedgerRow, riverName: string): boolean {
  const target = riverName.trim();
  if (!target) return false;
  if (target === "(미지정)") {
    return normalizeRiverNames(row.riverNames).length === 0;
  }
  return normalizeRiverNames(row.riverNames).some((n) => n === target);
}

export function cloneRiverConstructionLedgerRows(): RiverConstructionLedgerRow[] {
  return structuredClone(MOCK_ROWS).map((r) => ({
    ...r,
    riverNames: normalizeRiverNames(r.riverNames),
  }));
}

export function createEmptyRiverConstructionLedgerRow(): RiverConstructionLedgerRow {
  return {
    id: `rcl-new-${Date.now()}`,
    name: "",
    location: "",
    quantity: "",
    riverNames: [],
    contractDate: "",
    startDate: "",
    endDate: "",
    actualEndDate: "",
    companyName: "",
    representative: "",
    phone: "",
    companyAddress: "",
    supervisor: "",
    supervisorName: "",
    budgetBefore: "",
    budgetIncrease: "",
    budgetDecrease: "",
    budgetAfter: "",
    changeReason: "",
    remark: "",
    geom: null,
    attachments: [],
    parcels: [],
  };
}

export function createAttachmentFromFile(
  file: File,
  category: RiverConstructionLedgerAttachmentCategory = "etc"
): RiverConstructionLedgerAttachment {
  const previewKind = guessPreviewKind(file.name, file.type);
  const previewUrl =
    previewKind === "image" || previewKind === "pdf" ? URL.createObjectURL(file) : undefined;
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    category,
    sizeLabel: formatSizeLabel(file.size),
    uploadedAt: formatUploadedAt(),
    previewUrl,
    previewKind,
  };
}

export function revokeAttachmentPreview(att: RiverConstructionLedgerAttachment | undefined | null) {
  const url = att?.previewUrl;
  if (url?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

export function listRiverNames(rows: RiverConstructionLedgerRow[]): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const names = normalizeRiverNames(row.riverNames);
    if (names.length === 0) {
      map.set("(미지정)", (map.get("(미지정)") ?? 0) + 1);
      continue;
    }
    for (const name of names) {
      map.set(name, (map.get(name) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
