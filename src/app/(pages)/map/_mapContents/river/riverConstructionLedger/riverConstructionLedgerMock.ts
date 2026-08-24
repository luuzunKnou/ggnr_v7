/** 하천 공사대장 — 타입·매퍼·UI 헬퍼 (실데이터: cons_data_as) */

import type { LayerRowParcelItem } from "../../../_mapComponents/layerRowEdit/types";

export type RiverConstructionLedgerGeom = {
  type: "MultiPolygon";
  /** WGS84 — 폴리곤 여러 개: [ [ [ [lon,lat], ... 외곽선 ] ], ... ] */
  coordinates: [number, number][][][];
};

export type RiverConstructionLedgerPreviewKind = "image" | "pdf" | "other";

/** 첨부 폴더명(=탭). 루트 파일은 «기타» */
export type RiverConstructionLedgerAttachmentCategory = string;

export const CONS_ATTACH_ROOT_FOLDER = "기타";
export const CONS_DATA_AS_FILE_LAYER = "cons_data_as";
/** 목록에 넣지 않는 신규 등록 화면용 고정 id (점용·보상편입과 동일 패턴) */
export const CONS_DATA_AS_NEW_ID = "rcl-new";
/** 예전 timestamp 임시 행 호환 */
export const CONS_DATA_AS_NEW_ID_PREFIX = "rcl-new-";

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
  /** 대상 하천명 (복수 UI — DB river_name 단건은 [river_name]) */
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
  /** 첨부 — 폴더 탭에서 별도 로드 (행 캐시용, 비어 있을 수 있음) */
  attachments: RiverConstructionLedgerAttachment[];
  parcels: LayerRowParcelItem[];
};

/** 목록·검색용 임시 하천 후보 */
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

export type ConsDataAsApiRow = {
  consCode?: string;
  consName?: string;
  consLocat?: string;
  consVolum?: string;
  riverName?: string;
  contDate?: string;
  startDate?: string;
  doneDate?: string;
  sdoneDate?: string;
  businName?: string;
  ceoName?: string;
  businPhon?: string;
  businAddr?: string;
  directPos?: string;
  directNam?: string;
  amountPre?: string;
  amountVar?: string;
  amountCha?: string;
  amountAft?: string;
  reason?: string;
  descript?: string;
  geom?: RiverConstructionLedgerGeom | null;
  parcels?: Array<{
    address?: string;
    riverName?: string;
    remark?: string;
    pnu?: string;
    extent3857?: [number, number, number, number] | null;
    geometry3857?: Record<string, unknown> | null;
  }>;
};

function formatSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
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

export function guessPreviewKind(name: string, mime?: string): RiverConstructionLedgerPreviewKind {
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

export function isKnownRiverName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return (RIVER_CONSTRUCTION_RIVER_PRESETS as readonly string[]).some(
    (p) => p.toLowerCase() === n.toLowerCase()
  );
}

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

function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return [x, y];
}

function poly(ring: [number, number][]): RiverConstructionLedgerGeom {
  const closed =
    ring.length > 0 &&
    (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1])
      ? [...ring, ring[0]!]
      : ring;
  return { type: "MultiPolygon", coordinates: [[closed]] };
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
  const h = hashRiverName(name);
  const lon = 129.2 + ((h % 2500) / 2500) * 0.35;
  const lat = 36.7 + (((h >> 8) % 2500) / 2500) * 0.4;
  const dLon = 0.004;
  const dLat = 0.0035;
  const geom = poly([
    [lon, lat],
    [lon + dLon, lat],
    [lon + dLon, lat + dLat],
    [lon, lat + dLat],
  ]);
  const [x0, y0] = lonLatTo3857(lon, lat);
  const [x1, y1] = lonLatTo3857(lon + dLon, lat + dLat);
  const extent3857: [number, number, number, number] = [
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1),
  ];
  return { riverName: name, extent3857, geom };
}

/**
 * 편집모드 진입 시 — 예전 주소검색 방식으로 등록된 필지는 하천명·비고 값이 비어 있어
 * 입력란이 빈칸으로 보인다. 기존 address 값을 하천명 입력란에 채워 편집 중 사라지지 않게 한다.
 */
export function withRiverNameFallback(items: LayerRowParcelItem[]): LayerRowParcelItem[] {
  return items.map((p) => {
    if (p.riverName?.trim() || p.remark?.trim()) return p;
    const addr = String(p.address ?? "").trim();
    if (!addr || addr === "—") return p;
    return { ...p, riverName: addr };
  });
}

export function rowHasRiver(row: RiverConstructionLedgerRow, riverName: string): boolean {
  const target = riverName.trim();
  if (!target) return false;
  if (target === "(미지정)") {
    return normalizeRiverNames(row.riverNames).length === 0;
  }
  return normalizeRiverNames(row.riverNames).some((n) => n === target);
}

export function isNewRiverConstructionLedgerRow(row: Pick<RiverConstructionLedgerRow, "id">): boolean {
  const id = String(row.id ?? "");
  return id === CONS_DATA_AS_NEW_ID || id.startsWith(CONS_DATA_AS_NEW_ID_PREFIX);
}

export function mapConsDataAsApiToLedgerRow(api: ConsDataAsApiRow): RiverConstructionLedgerRow {
  const consCode = String(api.consCode ?? "").trim();
  const riverName = String(api.riverName ?? "").trim();
  const parcels: LayerRowParcelItem[] = (api.parcels ?? [])
    .map((p) => {
      const riverName = String(p?.riverName ?? "").trim();
      const remark = String(p?.remark ?? "").trim();
      const address = String(p?.address ?? "").trim() || remark || riverName;
      const geometry3857 = p?.geometry3857 ?? null;
      if (!address && !riverName && !remark && !geometry3857) return null;
      const pnu = String(p?.pnu ?? "").trim();
      const ext = p?.extent3857;
      const extent3857 =
        Array.isArray(ext) &&
        ext.length === 4 &&
        ext.every((v) => Number.isFinite(Number(v)))
          ? ([Number(ext[0]), Number(ext[1]), Number(ext[2]), Number(ext[3])] as [
              number,
              number,
              number,
              number,
            ])
          : null;
      const displayParts = [riverName, remark].filter(Boolean);
      const displayText =
        displayParts.length > 0 ? displayParts.join(" · ") : undefined;
      const item: LayerRowParcelItem = {
        address: address || displayText || "—",
        extent3857,
        ...(geometry3857 ? { geometry3857 } : {}),
        ...(displayText ? { displayText } : {}),
        ...(pnu ? { pnu } : {}),
        ...(riverName ? { riverName } : {}),
        ...(remark ? { remark } : {}),
      };
      return item;
    })
    .filter((x): x is LayerRowParcelItem => x != null);

  let geom: RiverConstructionLedgerGeom | null = null;
  if (api.geom?.type === "MultiPolygon" && Array.isArray(api.geom.coordinates)) {
    geom = {
      type: "MultiPolygon",
      coordinates: api.geom.coordinates as RiverConstructionLedgerGeom["coordinates"],
    };
  }

  return {
    id: consCode,
    name: String(api.consName ?? "").trim(),
    location: String(api.consLocat ?? "").trim(),
    quantity: String(api.consVolum ?? "").trim(),
    riverNames: riverName ? normalizeRiverNames([riverName]) : [],
    contractDate: String(api.contDate ?? "").trim(),
    startDate: String(api.startDate ?? "").trim(),
    endDate: String(api.doneDate ?? "").trim(),
    actualEndDate: String(api.sdoneDate ?? "").trim(),
    companyName: String(api.businName ?? "").trim(),
    representative: String(api.ceoName ?? "").trim(),
    phone: String(api.businPhon ?? "").trim(),
    companyAddress: String(api.businAddr ?? "").trim(),
    supervisor: String(api.directPos ?? "").trim(),
    supervisorName: String(api.directNam ?? "").trim(),
    budgetBefore: String(api.amountPre ?? "").trim(),
    budgetIncrease: String(api.amountVar ?? "").trim(),
    budgetDecrease: String(api.amountCha ?? "").trim(),
    budgetAfter: String(api.amountAft ?? "").trim(),
    changeReason: String(api.reason ?? "").trim(),
    remark: String(api.descript ?? "").trim(),
    geom,
    attachments: [],
    parcels,
  };
}

/** UI 행 → DB 저장 values */
export function ledgerRowToConsDataAsValues(row: {
  name: string;
  location: string;
  quantity: string;
  riverNames: string[];
  contractDate: string;
  startDate: string;
  endDate: string;
  actualEndDate: string;
  companyName: string;
  representative: string;
  phone: string;
  companyAddress: string;
  supervisor: string;
  supervisorName: string;
  budgetBefore: string;
  budgetIncrease: string;
  budgetDecrease: string;
  budgetAfter: string;
  changeReason: string;
  remark: string;
}): Record<string, string> {
  const rivers = normalizeRiverNames(row.riverNames);
  return {
    cons_name: row.name.trim(),
    cons_locat: row.location.trim(),
    cons_volum: row.quantity.trim(),
    river_name: rivers.join(", "),
    cont_date: row.contractDate.trim(),
    start_date: row.startDate.trim(),
    done_date: row.endDate.trim(),
    sdone_date: row.actualEndDate.trim(),
    busin_name: row.companyName.trim(),
    ceo_name: row.representative.trim(),
    busin_phon: row.phone.trim(),
    busin_addr: row.companyAddress.trim(),
    direct_pos: row.supervisor.trim(),
    direct_nam: row.supervisorName.trim(),
    amount_pre: row.budgetBefore.trim(),
    amount_var: row.budgetIncrease.trim(),
    amount_cha: row.budgetDecrease.trim(),
    amount_aft: row.budgetAfter.trim(),
    reason: row.changeReason.trim(),
    descript: row.remark.trim(),
  };
}

export function createEmptyRiverConstructionLedgerRow(): RiverConstructionLedgerRow {
  return {
    id: CONS_DATA_AS_NEW_ID,
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

export function mapServiceFileToAttachment(
  file: { name: string; size: number; modified?: string },
  folder: string
): RiverConstructionLedgerAttachment {
  return {
    id: `${folder}:${file.name}`,
    name: file.name,
    category: folder,
    sizeLabel: formatSizeLabel(file.size),
    uploadedAt: formatUploadedAt(file.modified),
    previewKind: guessPreviewKind(file.name),
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
