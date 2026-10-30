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
import type { RiverIllegalOccupationCard, RiverIllegalStatus } from "./riverIllegalOccupationStore";
import { emptyRiverIllegalStatus } from "./riverIllegalOccupationStore";

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
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.locationMapUrl.column]: card.locationMapUrl || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.photo1Url.column]: card.photo1Url || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.photo2Url.column]: card.photo2Url || null,
    [RIVER_ILLEGAL_OCCUPATION_COLUMNS.completePhotoUrl.column]: card.completePhotoUrl || null,
  };

  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
      const col = `${st.prefix}${kind.column}`;
      const raw = String(card.status[kind.key]?.[st.key] ?? "").trim();
      const digits = raw.replace(/[^0-9]/g, "");
      const n = digits ? Number(digits) : NaN;
      row[col] = Number.isFinite(n) ? n : null;
    }
  }
  // 합계 컬럼
  for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
    const totKey = `${st.prefix}TOT` as const;
    let sum = 0;
    let any = false;
    for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
      const v = row[`${st.prefix}${kind.column}`];
      if (typeof v === "number") {
        sum += v;
        any = true;
      }
    }
    row[totKey] = any ? sum : null;
  }
  return row;
}

function numToStatusCell(v: unknown): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "";
  return String(Math.trunc(n) === n ? Math.trunc(n) : n);
}

/** DB 행(또는 DBF 레코드) → 화면 카드 */
export function riverIllegalDbRowToCard(
  row: Record<string, unknown>,
  id: string
): RiverIllegalOccupationCard {
  const firstYmd =
    riverIllegalPartsToYmd({
      y: String(row[RIVER_ILLEGAL_FIRST_DATE_DB.y] ?? ""),
      m: String(row[RIVER_ILLEGAL_FIRST_DATE_DB.m] ?? ""),
      d: String(row[RIVER_ILLEGAL_FIRST_DATE_DB.d] ?? ""),
    }) || riverIllegalParseLooseDate(String(row.FIRST_DT ?? row.first_chk_ymd ?? ""));

  const endYmd =
    riverIllegalPartsToYmd({
      y: String(row[RIVER_ILLEGAL_END_DATE_DB.y] ?? ""),
      m: String(row[RIVER_ILLEGAL_END_DATE_DB.m] ?? ""),
      d: String(row[RIVER_ILLEGAL_END_DATE_DB.d] ?? ""),
    }) || riverIllegalParseLooseDate(String(row.END_DT ?? row.cmpl_ymd ?? ""));

  const status: RiverIllegalStatus = emptyRiverIllegalStatus();
  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    for (const st of RIVER_ILLEGAL_STATUS_ROWS) {
      const col = `${st.prefix}${kind.column}`;
      status[kind.key][st.key] = numToStatusCell(row[col]);
    }
  }

  const str = (col: string, ...alts: string[]) => {
    for (const k of [col, ...alts]) {
      const v = row[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  return {
    id,
    mgmtNo: str("MGMT_NO"),
    serialNo: str("SEQ_NO"),
    riverType: str("RIVER_TP"),
    firstCheckYmd: firstYmd,
    completeYmd: endYmd,
    completeYn: riverIllegalCompleteYnFromDb(row.END_YN ?? row.completeYn),
    location: str("LOCATION"),
    pnu: str("PNU"),
    lon: str("lon"),
    lat: str("lat"),
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
  };
}
