import {
  STEEP_SLOPE_CHECK_GROUPS,
  type SteepSlopeCheckValue,
} from "./steepSlopeSafetyConfig";

export const STEEP_SLOPE_SAFETY_NEW_ID = "__new_steep_slope_safety__";

export function isNewSteepSlopeSafetyId(id: string | null | undefined): boolean {
  return String(id ?? "") === STEEP_SLOPE_SAFETY_NEW_ID;
}

export type SteepSlopeInspector = {
  org: string;
  title: string;
  name: string;
};

export type SteepSlopeCheckRow = {
  value: SteepSlopeCheckValue;
  note: string;
};

export type SteepSlopePhotoSlot = {
  key: string;
  label: string;
  /** 프로토타입 — 빈 문자열이면 자리만 */
  url: string;
};

/** 점검결과 고정 슬롯 외 추가 사진·파일 (프로토타입 메모리, 최대 6) */
export type SteepSlopeAttachment = {
  id: string;
  fileName: string;
  /** 인쇄 캡션(한글 원본: «중앙부 옹벽 균열» 등). 비면 fileName 사용 */
  label: string;
  /** blob: 또는 data: 등 미리보기용 */
  url: string;
};

export function steepSlopeAttachmentCaption(a: {
  label?: string;
  fileName?: string;
}): string {
  const label = String(a.label ?? "").trim();
  if (label) return label;
  const name = String(a.fileName ?? "").trim();
  if (!name) return "첨부";
  return name.replace(/\.[^.]+$/, "") || name;
}

export function steepSlopeAttachmentLabelFromFileName(fileName: string): string {
  const name = String(fileName ?? "").trim() || "첨부.jpg";
  return name.replace(/\.[^.]+$/, "") || name;
}

export type SteepSlopeSafetyCard = {
  id: string;
  /** 목록·표지용 연번 */
  serialNo: string;
  siteName: string;
  category: string;
  inspectYmd: string;
  lengthM: string;
  heightM: string;
  slopeDeg: string;
  address: string;
  inspectors: SteepSlopeInspector[];
  checks: Record<string, SteepSlopeCheckRow>;
  otherOpinion: string;
  expertFollowUp: boolean;
  /**
   * 점검결과 고정 사진 — 시설물전경 2 · 시점부 1 · 종점부 1
   */
  photos: SteepSlopePhotoSlot[];
  /** 세부·기타 사진은 첨부파일로 */
  attachments: SteepSlopeAttachment[];
  /** 지도 강조용 WGS84 */
  lon: number;
  lat: number;
};

export function emptyChecks(): Record<string, SteepSlopeCheckRow> {
  const out: Record<string, SteepSlopeCheckRow> = {};
  for (const g of STEEP_SLOPE_CHECK_GROUPS) {
    for (const it of g.items) {
      out[it.key] = { value: "", note: "" };
    }
  }
  return out;
}

export function createEmptySteepSlopeSafetyCard(): SteepSlopeSafetyCard {
  return {
    id: STEEP_SLOPE_SAFETY_NEW_ID,
    serialNo: "",
    siteName: "",
    category: "인공비탈면",
    inspectYmd: "",
    lengthM: "",
    heightM: "",
    slopeDeg: "",
    address: "",
    inspectors: [{ org: "", title: "", name: "" }],
    checks: emptyChecks(),
    otherOpinion: "",
    expertFollowUp: false,
    photos: defaultPhotoSlots(),
    attachments: [],
    lon: 128.85,
    lat: 35.82,
  };
}

/** 시설물전경 2장 + 시점·종점 전경 각 1장 (한글 서식 캡션) */
export function defaultPhotoSlots(): SteepSlopePhotoSlot[] {
  return [
    { key: "overview1", label: "시설물 전경", url: "" },
    { key: "overview2", label: "시설물 전경", url: "" },
    { key: "start", label: "시점부 전경", url: "" },
    { key: "end", label: "종점부 전경", url: "" },
  ];
}

function row(
  value: SteepSlopeCheckValue,
  note = ""
): SteepSlopeCheckRow {
  return { value, note };
}

function sample(
  partial: Omit<
    SteepSlopeSafetyCard,
    "checks" | "photos" | "inspectors" | "attachments"
  > & {
    inspectors?: SteepSlopeInspector[];
    checks: Record<string, SteepSlopeCheckRow>;
    photos?: SteepSlopePhotoSlot[];
    attachments?: SteepSlopeAttachment[];
  }
): SteepSlopeSafetyCard {
  return {
    inspectors: partial.inspectors ?? [
      { org: "대성건설기술단", title: "부장", name: "장용관" },
    ],
    photos: partial.photos ?? defaultPhotoSlots(),
    attachments: partial.attachments ?? [],
    ...partial,
  };
}

/** 서식 169~ 예시 기반 목업 (경산 용성 일대 대략 좌표) */
export const STEEP_SLOPE_SAFETY_SEED: SteepSlopeSafetyCard[] = [
  sample({
    id: "sss-169",
    serialNo: "169",
    siteName: "용성 고죽 N3지구",
    category: "인공비탈면",
    inspectYmd: "2026-08-25",
    lengthM: "177",
    heightM: "13",
    slopeDeg: "63",
    address: "경상북도 경산시 용성면 고죽리 산242-3",
    otherOpinion: "",
    expertFollowUp: false,
    lon: 128.872,
    lat: 35.798,
    checks: {
      ...emptyChecks(),
      s1: row("no"),
      s2: row("no"),
      s3: row("no"),
      p1: row("no"),
      p2: row("no"),
      p3: row("no"),
      p4: row("no"),
      p5: row("yes", "표층유실 및 세굴발생"),
      p7: row("yes", "상부 전도가능 수목"),
      f1: row("no"),
      f2: row("yes", "옹벽 균열"),
      f3: row("yes", "배수시설 낙엽적재"),
      g1: row("na"),
      g2: row("na"),
      a1: row("na"),
      a2: row("na"),
    },
  }),
  sample({
    id: "sss-170",
    serialNo: "170",
    siteName: "용성 덕천 N1지구",
    category: "인공비탈면",
    inspectYmd: "2026-08-25",
    lengthM: "170",
    heightM: "17",
    slopeDeg: "63",
    address: "경상북도 경산시 용성면 덕천리 산1-2",
    otherOpinion: "",
    expertFollowUp: false,
    lon: 128.861,
    lat: 35.805,
    checks: {
      ...emptyChecks(),
      s1: row("no"),
      s2: row("no"),
      s3: row("no"),
      p1: row("no"),
      p2: row("no"),
      p3: row("no"),
      p4: row("no"),
      p5: row("no"),
      p7: row("yes", "상부 뜬돌"),
      f1: row("no"),
      f2: row("yes", "옹벽 균열"),
      f3: row("no"),
      g1: row("na"),
      g2: row("na"),
      a1: row("na"),
      a2: row("na"),
    },
  }),
  sample({
    id: "sss-171",
    serialNo: "171",
    siteName: "용성 매남 N7지구",
    category: "인공비탈면",
    inspectYmd: "2026-09-08",
    lengthM: "101",
    heightM: "15",
    slopeDeg: "67",
    address: "경상북도 경산시 용성면 매남리 산427",
    otherOpinion: "상부 토석류 흔적에 대한 지속 관찰 필요",
    expertFollowUp: true,
    lon: 128.855,
    lat: 35.812,
    inspectors: [
      {
        org: "제이에스탑이앤지 종합건축사사무소",
        title: "상무",
        name: "김창호",
      },
      { org: "도로철도과", title: "시설8급", name: "이정민" },
    ],
    checks: {
      ...emptyChecks(),
      s1: row("no"),
      s2: row("yes", "토석류"),
      s3: row("no"),
      p1: row("no"),
      p2: row("no"),
      p3: row("no"),
      p4: row("no"),
      p5: row("yes", "표층유실"),
      p7: row("yes"),
      f1: row("no"),
      f2: row("no"),
      f3: row("no"),
      g1: row("na"),
      g2: row("na"),
      a1: row("na"),
      a2: row("na"),
    },
  }),
];

export function formatSteepSlopeSpec(card: SteepSlopeSafetyCard): string {
  const parts: string[] = [];
  if (card.lengthM.trim()) parts.push(`길이 ${card.lengthM.trim()}m`);
  if (card.heightM.trim()) parts.push(`높이${card.heightM.trim()}m`);
  if (card.slopeDeg.trim()) parts.push(`경사${card.slopeDeg.trim()}°`);
  return parts.join(", ");
}

export function formatSteepSlopeInspectors(card: SteepSlopeSafetyCard): string {
  return card.inspectors
    .map((p) => [p.org, p.title, p.name].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" / ");
}

export function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}
