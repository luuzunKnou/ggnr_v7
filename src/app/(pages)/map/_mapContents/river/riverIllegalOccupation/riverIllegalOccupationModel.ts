/**
 * 불법점용 관리카드 — 서버·클라이언트 공용 타입·순수 헬퍼 (`use client` 금지)
 */
import {
  RIVER_ILLEGAL_LINE_SEPARATOR,
  RIVER_ILLEGAL_STATUS_KINDS,
  type RiverIllegalOccupationFieldKey,
  type RiverIllegalStatusKindKey,
  type RiverIllegalStatusRowKey,
} from "./riverIllegalOccupationConfig";

export type RiverIllegalStatus = Record<RiverIllegalStatusKindKey, Record<RiverIllegalStatusRowKey, string>>;

/** 조치현황 합계 (DET_TOT / ACT_TOT / UNA_TOT) — DB 조회용. 화면·저장은 항목 합산 */
export type RiverIllegalStatusTotals = Record<RiverIllegalStatusRowKey, string>;

export type RiverIllegalOccupationCard = Record<RiverIllegalOccupationFieldKey, string> & {
  id: string;
  status: RiverIllegalStatus;
  statusTotals: RiverIllegalStatusTotals;
};

export const RIVER_ILLEGAL_OCCUPATION_NEW_ID = "__new_river_illegal_occupation__";

export function isNewRiverIllegalOccupationId(id: string | null | undefined): boolean {
  return String(id ?? "") === RIVER_ILLEGAL_OCCUPATION_NEW_ID;
}

export function emptyRiverIllegalStatus(): RiverIllegalStatus {
  const out = {} as RiverIllegalStatus;
  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    out[kind.key] = { detected: "", acted: "", notActed: "" };
  }
  return out;
}

export function emptyRiverIllegalStatusTotals(): RiverIllegalStatusTotals {
  return { detected: "", acted: "", notActed: "" };
}

export function createEmptyRiverIllegalOccupationCard(): RiverIllegalOccupationCard {
  return {
    id: RIVER_ILLEGAL_OCCUPATION_NEW_ID,
    mgmtNo: "",
    serialNo: "",
    riverType: "",
    firstCheckYmd: "",
    completeYmd: "",
    completeYn: "N",
    location: "",
    pnu: "",
    lon: "",
    lat: "",
    recurrence: "",
    actor: "",
    violation: "",
    relatedLaw: "",
    actionContent: "",
    actionPlan: "",
    manager: "",
    locationMapUrl: "",
    photo1Url: "",
    photo2Url: "",
    completePhotoUrl: "",
    status: emptyRiverIllegalStatus(),
    statusTotals: emptyRiverIllegalStatusTotals(),
  };
}

/** «@» 구분 값 → 화면 줄 목록 (빈 줄 제외) */
export function splitRiverIllegalLines(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(RIVER_ILLEGAL_LINE_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «@» 구분 값 → 입력칸 문자열(줄바꿈) */
export function riverIllegalLinesToText(value: string | null | undefined): string {
  return splitRiverIllegalLines(value).join("\n");
}

/** 입력칸 줄바꿈 → 저장 값(«@» 구분) */
export function riverIllegalTextToLines(text: string): string {
  return String(text ?? "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(RIVER_ILLEGAL_LINE_SEPARATOR))
    .map((s) => s.trim())
    .filter(Boolean)
    .join(RIVER_ILLEGAL_LINE_SEPARATOR);
}

function statusCellNumber(raw: string | null | undefined): number {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function riverIllegalStatusTotal(
  status: RiverIllegalStatus,
  row: RiverIllegalStatusRowKey
): number {
  return RIVER_ILLEGAL_STATUS_KINDS.reduce(
    (sum, kind) => sum + statusCellNumber(status[kind.key]?.[row]),
    0
  );
}

/**
 * 합계 표시·DB용 문자열.
 * 조치·미조치 합계는 항상 `#N#` (빨간 표시). 적발 합계는 숫자만.
 */
export function riverIllegalStatusTotalMarked(
  status: RiverIllegalStatus,
  row: RiverIllegalStatusRowKey
): string {
  const n = riverIllegalStatusTotal(status, row);
  if (!n) return "";
  if (row === "acted" || row === "notActed") return `#${n}#`;
  return String(n);
}

/** 관리번호 숫자부 (HCBJ_000474 → 474). 없으면 0 */
export function riverIllegalMgmtNoRank(mgmtNo: string | null | undefined): number {
  const m = /HCBJ_?(\d+)/i.exec(String(mgmtNo ?? "").trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}
