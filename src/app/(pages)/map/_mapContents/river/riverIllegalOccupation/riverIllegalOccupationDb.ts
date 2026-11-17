/**
 * 화면 카드 ↔ DB(레이어정의서) 매핑.
 * 일자: 화면 ISO(YYYY-MM-DD) ↔ FIRST_Y/M/D · END_Y/M/D
 * 완료: 화면 completeYn ↔ END_YN (Y/N)
 */
import {
  RIVER_ILLEGAL_END_DATE_DB,
  RIVER_ILLEGAL_FIRST_DATE_DB,
  RIVER_ILLEGAL_OCCUPATION_COLUMNS,
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
} from "./riverIllegalOccupationConfig";
import type {
  RiverIllegalOccupationCard,
  RiverIllegalStatus,
  RiverIllegalStatusTotals,
} from "./riverIllegalOccupationModel";
import { emptyRiverIllegalStatus, emptyRiverIllegalStatusTotals } from "./riverIllegalOccupationModel";

export type RiverIllegalDateParts = { y: string; m: string; d: string };

/** ISO YYYY-MM-DD → 년/월/일 (월·일은 2자리) */
export function riverIllegalYmdToParts(ymd: string | null | undefined): RiverIllegalDateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!m) return { y: "", m: "", d: "" };
  return { y: m[1]!, m: m[2]!, d: m[3]! };
}

/** 년/월/일 → ISO. 월·일만 있으면 패딩. 불완전하면 빈 문자열 */
export function riverIllegalPartsToYmd(parts: Partial<RiverIllegalDateParts> | null | undefined): string {
  const y = String(parts?.y ?? "").trim();
  const m = String(parts?.m ?? "").trim().replace(/\D/g, "");
  const d = String(parts?.d ?? "").trim().replace(/\D/g, "");
  if (!/^\d{4}$/.test(y)) return "";
  if (!m) return "";
  const mm = m.padStart(2, "0");
  if (!d) return "";
  const dd = d.padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * DBF·원본 표기(26.3.13. / 2026.3.14 / 26.4. / -) → ISO.
 * 일만 없으면 빈 값(화면 날짜칸은 완전한 날짜만).
 */
export function riverIllegalParseLooseDate(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s || s === "-" || s === "—") return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    return riverIllegalPartsToYmd({ y: iso[1]!, m: iso[2]!, d: iso[3]! });
  }
  const dotted = /^'?(\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})\.?$/.exec(s);
  if (dotted) {
    let y = dotted[1]!;
    if (y.length === 2) y = `20${y}`;
    return riverIllegalPartsToYmd({ y, m: dotted[2]!, d: dotted[3]! });
  }
  return "";
}

export function riverIllegalCompleteYnFromDb(raw: unknown): "Y" | "N" {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "Y" || s === "YES" || s === "완료" || s === "TRUE" || s === "1") return "Y";
  return "N";
}

export function riverIllegalCompleteYnToDb(yn: string | null | undefined): "Y" | "N" {
  return String(yn ?? "").trim().toUpperCase() === "Y" ? "Y" : "N";
}

/** 화면 카드 → DB 행(일자 분리·조치현황 접두어 포함) */
export function riverIllegalCardToDbRow(
  card: RiverIllegalOccupationCard
): Record<string, string | number | null> {
  const first = riverIllegalYmdToParts(card.firstCheckYmd);
  const end = riverIllegalYmdToParts(card.completeYmd);
  const row: Record<string, string | number | null> = {
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.mgmtNo.column]: card.mgmtNo || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.serialNo.column]: card.serialNo || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.riverType.column]: card.riverType || null,
    [RIVER_ILLEGAL_FIRST_DATE_DB.y]: first.y || null,
    [RIVER_ILLEGAL_FIRST_DATE_DB.m]: first.m || null,
    [RIVER_ILLEGAL_FIRST_DATE_DB.d]: first.d || null,
    [RIVER_ILLEGAL_END_DATE_DB.y]: end.y || null,
    [RIVER_ILLEGAL_END_DATE_DB.m]: end.m || null,
    [RIVER_ILLEGAL_END_DATE_DB.d]: end.d || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.completeYn.column]: riverIllegalCompleteYnToDb(card.completeYn),
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.location.column]: card.location || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.pnu.column]: card.pnu || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.recurrence.column]: card.recurrence || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.actor.column]: card.actor || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.violation.column]: card.violation || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.relatedLaw.column]: card.relatedLaw || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.actionContent.column]: card.actionContent || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.actionPlan.column]: card.actionPlan || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.manager.column]: card.manager || null,
    // 사진·위치도는 file_data/{레이어}/{MGMT_NO}/ 파일로만 관리 (DB 컬럼에는 쓰지 않음)
  };

  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
      const col = `${st.prefix}${kind.column}`;
      const raw = String(card.status[kind.key]?.[st.key] ?? "").trim();
      if (!raw) {
        row[col] = null;
        continue;
      }
      // 조치·미조치: `#1#` 등 화면 마크업을 DB에 그대로 저장 / 적발: 숫자만
      if (st.key === "acted" || st.key === "notActed") {
        const cleaned = raw.replace(/[^0-9#]/g, "");
        row[col] = cleaned || null;
      } else {
        const digits = raw.replace(/[^0-9]/g, "");
        const n = digits ? Number(digits) : NaN;
        row[col] = Number.isFinite(n) ? n : null;
      }
    }
  }
  // 합계 (DET_TOT / ACT_TOT / UNA_TOT) — 항목 합산. 조치·미조치 합계는 `#N#`로 저장
  for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
    const totKey = `${st.prefix}TOT` as const;
    let sum = 0;
    let any = false;
    for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
      const v = row[`${st.prefix}${kind.column}`];
      if (v == null || v === "") continue;
      const digits = String(v).replace(/[^0-9]/g, "");
      if (!digits) continue;
      const n = Number(digits);
      if (!Number.isFinite(n)) continue;
      sum += n;
      any = true;
    }
    if (!any) {
      row[totKey] = null;
    } else if (st.key === "acted" || st.key === "notActed") {
      row[totKey] = `#${sum}#`;
    } else {
      row[totKey] = sum;
    }
  }
  return row;
}

function numToStatusCell(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s) return "";
  if (s.includes("#")) return s.replace(/[^0-9#]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return "";
  return String(Math.trunc(n) === n ? Math.trunc(n) : n);
}

/** SHP/PG 컬럼 대소문자 혼용 → 조회 키를 대·소문자 모두로 둔다 */
export function riverIllegalNormalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(row)) {
    out[k.toUpperCase()] = v;
    out[k.toLowerCase()] = v;
  }
  return out;
}

function pickRowValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && String(row[k]).trim() !== "") {
      return row[k];
    }
    const up = k.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(row, up) && row[up] != null && String(row[up]).trim() !== "") {
      return row[up];
    }
    const lo = k.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(row, lo) && row[lo] != null && String(row[lo]).trim() !== "") {
      return row[lo];
    }
  }
  return undefined;
}

/** DB 행(또는 DBF 레코드) → 화면 카드 */
export function riverIllegalDbRowToCard(
  raw: Record<string, unknown>,
  id: string
): RiverIllegalOccupationCard {
  const row = riverIllegalNormalizeRow(raw);
  const firstYmd =
    riverIllegalPartsToYmd({
      y: String(pickRowValue(row, RIVER_ILLEGAL_FIRST_DATE_DB.y) ?? ""),
      m: String(pickRowValue(row, RIVER_ILLEGAL_FIRST_DATE_DB.m) ?? ""),
      d: String(pickRowValue(row, RIVER_ILLEGAL_FIRST_DATE_DB.d) ?? ""),
    }) || riverIllegalParseLooseDate(String(pickRowValue(row, "FIRST_DT", "first_chk_ymd") ?? ""));

  const endYmd =
    riverIllegalPartsToYmd({
      y: String(pickRowValue(row, RIVER_ILLEGAL_END_DATE_DB.y) ?? ""),
      m: String(pickRowValue(row, RIVER_ILLEGAL_END_DATE_DB.m) ?? ""),
      d: String(pickRowValue(row, RIVER_ILLEGAL_END_DATE_DB.d) ?? ""),
    }) || riverIllegalParseLooseDate(String(pickRowValue(row, "END_DT", "cmpl_ymd") ?? ""));

  const status: RiverIllegalStatus = emptyRiverIllegalStatus();
  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
      const col = `${st.prefix}${kind.column}`;
      status[kind.key][st.key] = numToStatusCell(pickRowValue(row, col));
    }
  }

  const statusTotals: RiverIllegalStatusTotals = emptyRiverIllegalStatusTotals();
  for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
    statusTotals[st.key] = numToStatusCell(pickRowValue(row, `${st.prefix}TOT`));
  }

  const str = (...keys: string[]) => {
    const v = pickRowValue(row, ...keys);
    return v == null ? "" : String(v).trim();
  };

  return {
    id,
    mgmtNo: str("MGMT_NO"),
    serialNo: str("SEQ_NO"),
    riverType: str("RIVER_TP"),
    firstCheckYmd: firstYmd,
    completeYmd: endYmd,
    completeYn: riverIllegalCompleteYnFromDb(pickRowValue(row, "END_YN", "completeYn")),
    location: str("LOCATION"),
    pnu: str("PNU"),
    lon: str("lon", "LON", "x", "X"),
    lat: str("lat", "LAT", "y", "Y"),
    recurrence: str("RECUR_YN"),
    actor: str("ACTOR"),
    violation: str("VIOL_DESC"),
    relatedLaw: str("REL_LAW"),
    actionContent: str("ACT_DESC"),
    actionPlan: str("ACT_PLAN"),
    manager: str("MANAGER"),
    locationMapUrl: str("MAP_IMG"),
    photo1Url: str("PHOTO1"),
    photo2Url: str("PHOTO2"),
    completePhotoUrl: str("PHOTO_END"),
    status,
    statusTotals,
  };
}
