import type { CSSProperties } from "react";
import { formatFiniteNumberKoTrimZeros } from "@/lib/formatDetailScalar";
import { formatAddressStripSidoSigungu } from "@/lib/formatAddressStripAdmin";
import { darkerHex } from "@/lib/geoserverStyleUtils";

export type RoadLedgerNameSectLabelOptions = {
  /**
   * false: 해당 노선에 숫자 구간이 1만 있을 때(목록 API `roadLedgerShowSectSuffix`) — `…1구간` 생략하고 도로명만.
   * true/미지정: `도로명 2구간` 형태(sect는 숫자만이면 01→1).
   */
  showSectSuffix?: boolean;
};

/**
 * 노선번호·구간 등: 문자열 전체가 숫자(선행 0 포함)면 정수 문자열로 통일 (0208→208, 00→0).
 * 그 외(혼합·비숫자)는 trim만.
 */
export function formatRoadLedgerNumericToken(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    return String(parseInt(s, 10));
  }
  return s;
}

/**
 * 지도 라벨·목록: `도로명 2구간` 형태.
 * `showSectSuffix === false`이면 구간 접미어 없이 도로명만(노선 전체가 1구간만 있을 때 목록 API와 맞춤).
 */
export function formatRoadLedgerNameSectLabel(
  roadName: string,
  sectRaw: string,
  opts?: RoadLedgerNameSectLabelOptions
): string {
  const show = opts?.showSectSuffix !== false;
  const name = String(roadName ?? "").trim();
  const s = String(sectRaw ?? "").trim();

  if (!show) {
    if (!name && !s) return "—";
    return name || "—";
  }

  const sectDisplay = formatRoadLedgerNumericToken(s);
  if (!name && !s) return "—";
  if (!s) return name || "—";
  if (!name) return `${sectDisplay}구간`;
  return `${name} ${sectDisplay}구간`;
}

/**
 * 도로대장 숫자 표시: 소수 둘째 자리까지, 소수 부분이 모두 0이면 정수만 표시.
 * 천 단위 구분은 ko-KR.
 */
export function formatRoadLedgerDecimalKo(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return formatFiniteNumberKoTrimZeros(n);
}

/**
 * 소수 둘째 자리까지 절삭(0 방향). 소수부가 모두 0이면 정수만, 천단위는 ko-KR.
 */
export function formatRoadLedgerDecimalTruncateKo(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const t = Math.trunc(n * 100) / 100;
  return formatFiniteNumberKoTrimZeros(t);
}

/**
 * 목록·셀 표시용: 일반 숫자/소수 문자열만 절삭 포맷, 날짜·코드·비숫자는 trim 원문.
 */
export function formatRoadLedgerAttrNumericDisplay(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return formatFiniteNumberKoTrimZeros(raw);
  }
  const s = String(raw).trim();
  if (s === "") return "";
  if (!isLikelyPlainNumericString(s)) return s;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return s;
  return formatFiniteNumberKoTrimZeros(n);
}

function isLikelyPlainNumericString(s: string): boolean {
  const t = s.trim().replace(/,/g, "");
  if (t === "") return false;
  if (/^0\d+$/.test(t)) return false;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return false;
  if (/^-?\d{8}$/.test(t)) return false;
  const intPart = t.replace(/^-/, "").split(".")[0] ?? "";
  if (intPart.length >= 9) return false;
  return true;
}

/**
 * 시설 ADDRESS 등: 문자열 앞의 시·도·시·군·구 행정구역명을 제거한 나머지(읍면동·도로명 등).
 */
export function formatRoadLedgerAddressStripAdminPrefix(raw: unknown): string {
  return formatAddressStripSidoSigungu(raw);
}

/** 도로종류(ROAD_RANK) — 한글 표기 + 목록 벳지 기준색(#RRGGBB) */
export type RoadRankCodeDef = {
  label: string;
  toneHex: string;
};

/** 영양·경산 등 기본 (기존) */
const ROAD_RANK_CODE_KO_DEFAULT: Record<string, RoadRankCodeDef> = {
  "1501": { label: "고속국도", toneHex: "#F44336" },
  "1502": { label: "일반국도", toneHex: "#E91E63" },
  "1503": { label: "특별시도", toneHex: "#9C27B0" },
  "1504": { label: "지방도", toneHex: "#673AB7" },
  "1506": { label: "군도", toneHex: "#3F51B5" },
  "1508": { label: "면도", toneHex: "#2196F3" },
  "1509": { label: "리도", toneHex: "#03A9F4" },
  "1510": { label: "농도", toneHex: "#00BCD4" },
  "1599": { label: "기타", toneHex: "#009688" },
};

/** 울진(build_uj) */
const ROAD_RANK_CODE_KO_ULJIN: Record<string, RoadRankCodeDef> = {
  "1501": { label: "고속국도", toneHex: "#F44336" },
  "1502": { label: "일반국도", toneHex: "#E91E63" },
  "1503": { label: "특별시도", toneHex: "#9C27B0" },
  "1504": { label: "광역시도", toneHex: "#673AB7" },
  "1505": { label: "지방도", toneHex: "#3F51B5" },
  "1506": { label: "시도", toneHex: "#2196F3" },
  "1507": { label: "군도", toneHex: "#03A9F4" },
  "1508": { label: "구도", toneHex: "#00BCD4" },
  "1599": { label: "기타", toneHex: "#009688" },
};

export function resolveRoadLedgerProjectKey(project?: string | null): string {
  return String(project ?? process.env.GGNR_PROJECT ?? "")
    .trim()
    .toLowerCase();
}

export function isUljinRoadLedgerRankProject(project?: string | null): boolean {
  return resolveRoadLedgerProjectKey(project) === "build_uj";
}

function getRoadRankCodeTable(project?: string | null): Record<string, RoadRankCodeDef> {
  return isUljinRoadLedgerRankProject(project)
    ? ROAD_RANK_CODE_KO_ULJIN
    : ROAD_RANK_CODE_KO_DEFAULT;
}

function normalizeRoadRankCodeKey(raw: unknown, project?: string | null): string {
  const table = getRoadRankCodeTable(project);
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  if (!s) return "";
  if (s in table) return s;
  /** 전자리가 숫자면 선행 0 제거 후 코드 조회 (01506 → 1506) */
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) {
      const key = String(n);
      if (key in table) return key;
    }
  }
  const n = Number(s.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(n) && Number.isInteger(n) && String(n) in table) {
    return String(n);
  }
  return s;
}

/**
 * 목록용 괄호 — `(305호선 1구간)`.
 * 제목에 이미 `N구간`이 있으면 괄호에는 호선만 `(8호선)`.
 */
export function formatRoadLedgerParenRoadNoSectOnly(
  roadNo: unknown,
  sect: unknown,
  opts?: { sectInTitle?: boolean }
): string {
  const no = formatRoadLedgerNumericToken(roadNo);
  const sectDisp = formatRoadLedgerNumericToken(sect);
  const parts: string[] = [];
  if (no) parts.push(`${no}호선`);
  if (!opts?.sectInTitle && sectDisp) parts.push(`${sectDisp}구간`);
  if (parts.length === 0) return "";
  return `(${parts.join(" ")})`;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 코드표에 없는 ROAD_RANK — 단일 기본색 */
function toneHexForUnknownRank(): string {
  return "#64748b";
}

/** 목록 벳지 — 프로젝트별 ROAD_RANK 코드표 toneHex */
export function getRoadLedgerRankBadgeStyle(
  rankRaw: unknown,
  project?: string | null
): CSSProperties {
  const key = normalizeRoadRankCodeKey(rankRaw, project);
  const table = getRoadRankCodeTable(project);
  const hex = (key && table[key]?.toneHex) ?? toneHexForUnknownRank();
  return {
    backgroundColor: hexToRgba(hex, 0.14),
    color: darkerHex(hex, 0.52),
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: hexToRgba(hex, 0.38),
  };
}

/** 표·상세: 빈 값은 —, 매핑되면 한글, 아니면 원문 */
export function formatRoadLedgerRoadRankDisplay(
  raw: unknown,
  project?: string | null
): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const key = normalizeRoadRankCodeKey(raw, project);
  return getRoadRankCodeTable(project)[key]?.label ?? s;
}

/** 괄호 타이틀용: 빈 값이면 문자열 생략, 매핑되면 한글, 아니면 원문 */
export function formatRoadLedgerRoadRankForTitle(
  raw: unknown,
  project?: string | null
): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const key = normalizeRoadRankCodeKey(raw, project);
  return getRoadRankCodeTable(project)[key]?.label ?? s;
}

/**
 * 상세 타이틀 괄호 — `(도로종류한글 305호선 1구간)`.
 * ROAD_RANK는 프로젝트별 코드표. road_no·sect는 전자리가 숫자일 때만 선행 0 제거.
 */
export function formatRoadLedgerDetailTitleParen(
  rank: unknown,
  roadNo: unknown,
  sect: unknown,
  project?: string | null
): string {
  const r = formatRoadLedgerRoadRankForTitle(rank, project);
  const no = formatRoadLedgerNumericToken(roadNo);
  const sectDisp = formatRoadLedgerNumericToken(sect);
  const parts: string[] = [];
  if (r) parts.push(r);
  if (no) parts.push(`${no}호선`);
  if (sectDisp) parts.push(`${sectDisp}구간`);
  if (parts.length === 0) return "";
  return `(${parts.join(" ")})`;
}

/** 행에서 필드명 대소문자 무시 조회 */
export function pickRoadLedgerField(row: Record<string, unknown>, field: string): unknown {
  const lk = field.toLowerCase();
  const k = Object.keys(row).find((x) => x.toLowerCase() === lk);
  return k != null ? row[k] : undefined;
}

/** 식별·목록·시설 행 공통 — `ogc_fid` 정수 (없거나 유효하지 않으면 null) */
export function pickRoadLedgerOgcFid(row: Record<string, unknown> | null | undefined): number | null {
  if (!row || typeof row !== "object") return null;
  const raw = pickRoadLedgerField(row, "ogc_fid");
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** 상세·타이틀용 날짜 (목록과 동일 규칙, 빈 값은 placeholder) */
export function formatRoadLedgerDsgdateDisplay(raw: unknown, empty: string = "—"): string {
  const s = str(raw);
  if (!s) return empty;

  const datePart = s.includes("T") ? (s.split("T")[0] ?? s) : s;
  const digitsOnly = datePart.replace(/\D/g, "");
  if (digitsOnly.length === 8 && /^\d{8}$/.test(digitsOnly)) {
    return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4, 6)}-${digitsOnly.slice(6, 8)}`;
  }

  const parts = datePart.split(/[-/.]/).map((p) => p.trim()).filter(Boolean);
  const nums = parts.map((p) => (/^\d+$/.test(p) ? p : ""));
  const y = nums[0] ? nums[0].padStart(4, "0").slice(-4) : "0000";
  const mo = nums[1] ? nums[1].padStart(2, "0").slice(-2) : "00";
  const d = nums[2] ? nums[2].padStart(2, "0").slice(-2) : "00";
  return `${y}-${mo}-${d}`;
}

/** 연장 원문 → `1,234m` 등 */
export function formatRoadLedgerLenthWithUnit(raw: unknown): string {
  const s = str(raw);
  if (!s) return "—";
  const n = Number(String(s).replace(/,/g, ""));
  if (Number.isFinite(n)) {
    return `${formatRoadLedgerDecimalKo(n)}m`;
  }
  return `${s}m`;
}

/** 속성값 — 숫자·숫자 문자열만 위 규칙 적용, 그 외(코드·날짜 등)는 원문 유지 */
export function formatRoadLedgerAttrValue(_key: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return formatFiniteNumberKoTrimZeros(v);
  }
  if (typeof v === "string") {
    const raw = v.trim();
    if (raw === "") return "";
    if (!isLikelyPlainNumericString(raw)) return v;
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) return v;
    return formatFiniteNumberKoTrimZeros(n);
  }
  return String(v);
}
