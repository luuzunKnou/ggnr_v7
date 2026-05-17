/**
 * 시설 하위 목록 행 표시용 — 레이어(define_table_name)별 노출 DB 컬럼(코드표 순서).
 * 키는 소문자 테이블명. 값이 비어 있으면 기본(ogc_fid 제외·임의 필드 최대 5개) 표시로 폴백.
 */
import {
  formatRoadLedgerAddressStripAdminPrefix,
  formatRoadLedgerAttrNumericDisplay,
  pickRoadLedgerField,
} from "./roadLedgerFormat";

export const ROAD_LEDGER_TABLE_DISPLAY_FIELDS: Record<string, readonly string[]> = {
  a0020000: [],
  a0070000: ["brdg_name", "ADDRESS", "BRDG_LEN", "LANE_U", "LANE_D", "ED_DAY"],
  a0110020: ["TUN_NAME", "ADDRESS", "LEN_U", "LANE_U", "LANE_D", "END_DAY"],
  a0063321: ["OP_NAME", "ADDRESS", "LEN", "HIT", "ED_DAY"],
  a0093352: ["UR_NAME", "ADDRESS", "LEN", "LANE_U", "LANE_D", "END_DAY"],
  a0093351: ["HR_NAME", "ADDRESS", "ROAD_LEN", "LANE_U", "LANE_D", "ED_DAY"],
  a0100000: ["IC_NAME", "ADDRESS", "IC_DAY"],
  a0080000: ["X_NAME"],
  a0010000: ["SUID"],
  c0520000: ["RDID", "SECT_ST", "SECT_ED"],
  f9047226: ["RDID", "SECT_ST", "SECT_ED"],
  f9047224: ["RDID", "SECT_ST", "SECT_ED"],
  f9037222: ["RDID", "SECT_ST", "SECT_ED"],
  f9037221: ["RDID", "SECT_ST", "SECT_ED"],
  a9093353: ["US_NAME", "ADDRESS", "LEN", "ED_DAY"],
  a9990001: ["IP_NO"],
  a9990002: ["LEN", "LANE", "SLOPE"],
  a9990003: ["SECT_ST", "SECT_ED", "SLP_LEN", "SLOPE"],
  a9053327: ["SECT_ST", "SECT_ED", "EQP_LEN", "WID"],
  c0076117: ["SECT_ST", "SECT_ED", "EQP_LEN", "WID"],
  c9070001: ["SECT_ST", "EQP_LEN", "EQP_MET"],
  c9530005: ["SECT_ST", "SECT_ED", "EQP_LEN", "HIT", "INS_DAY"],
  c0410000: ["SB_KIND", "SB_NAME", "INST_DAY"],
  c9413426: ["SECT_ST", "DSP_TYPE", "EXP_TYPE"],
  c0223367: ["DUN_TYPE", "DUN_MAT", "LGT_TYPE", "INS_DAY"],
  c0493376: ["TYPE", "INS_DAY"],
  c0530000: ["EQP_KIND", "EQP_LEN", "HIT", "INS_DAY"],
  c9530001: ["SECT_ST", "EQP_KIND", "PRODUCT", "INS_DAY"],
  c0536114: ["SECT_ST", "SECT_ED", "TYPE", "HIT", "INS_DAY"],
  d0023372: ["SECT_ST", "SECT_ED", "TYPE", "HIT", "INS_DAY"],
  c0246120: ["SECT_ST", "SECT_ED", "DIP_KIND", "DIP_HIT", "DIP_DAY"],
  c0246341: ["PIP_NAME", "SECT_ST", "SECT_ED", "EQP_LEN", "DIP_HIT", "INS_DAY"],
  c9530006: ["SECT_ST", "TYPE", "INS_DAY"],
  c9530007: ["SECT_ST", "RS_TYPE", "INS_DAY"],
  c9530008: ["SECT_ST", "INS_DAY"],
  c9530009: ["SECT_ST", "TYPE", "INS_DAY"],
  c9530002: ["SECT_ST", "TYPE", "EQP_LEN", "INS_DAY"],
  c9530003: ["SECT_ST", "KIND", "INS_DAY"],
  c9530004: ["SECT_ST", "SECT_ED", "INS_DAY"],
  a9990011: ["SECT_ST", "SECT_ED", "LEN_ENT"],
  a9990007: ["SEC_ADRS", "OWN_DIT", "OWNER"],
  a9990008: ["SECT_ST", "SECT_ED", "LEN_ENT"],
  a9990009: ["SECT_ST", "SECT_ED", "TYPE", "REC_DAY"],
  a9990010: ["SECT_ST", "SECT_ED", "REC_DAY"],
  a9990004: [],
  a9990005: [],
  a9990006: [],
  a9990012: ["TARGET_DES", "STREET_NAM", "SET_DATE"],
  a9990013: ["SECT_ST"],
};

const clipCell = (t: string) => (t.length > 80 ? `${t.slice(0, 80)}…` : t);

/** 표 헤더·열 순서(첫 행 기준과 동일하게 유지) */
export function getRoadLedgerFacilityColumnKeys(
  defineTableNameLower: string,
  row: Record<string, unknown>
): string[] {
  const tn = defineTableNameLower.trim().toLowerCase();
  const fields = ROAD_LEDGER_TABLE_DISPLAY_FIELDS[tn];
  if (!fields || fields.length === 0) {
    const restKeys = Object.keys(row)
      .filter((k) => k.toLowerCase() !== "geom")
      .filter((k) => k.toLowerCase() !== "ogc_fid")
      .slice(0, 5);
    return [...restKeys];
  }

  return [...fields];
}

export function formatRoadLedgerFacilityCellValue(
  fieldKey: string,
  row: Record<string, unknown>
): string {
  const raw = pickRoadLedgerField(row, fieldKey);
  if (fieldKey.toUpperCase() === "ADDRESS") {
    const t = formatRoadLedgerAddressStripAdminPrefix(raw);
    return clipCell(t) || "—";
  }
  const t = formatRoadLedgerAttrNumericDisplay(raw);
  return clipCell(t) || "—";
}

/** define_table_name(소문자) + 행 → 목록 한 줄(컬럼명 없이 값만 · 로 연결) */
export function formatRoadLedgerFacilityRowLine(
  defineTableNameLower: string,
  row: Record<string, unknown>
): string {
  const keys = getRoadLedgerFacilityColumnKeys(defineTableNameLower, row);
  if (keys.length === 0) return "—";
  return keys.map((k) => formatRoadLedgerFacilityCellValue(k, row)).join(" · ");
}
