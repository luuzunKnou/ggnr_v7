"use client";

import { useEffect, useState } from "react";
import {
  RIVER_ILLEGAL_OCCUPATION_COLUMNS,
  RIVER_ILLEGAL_OCCUPATION_TABLE,
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
  type RiverIllegalOccupationFieldKey,
  type RiverIllegalStatusKindKey,
  type RiverIllegalStatusRowKey,
} from "./riverIllegalOccupationConfig";

type DefineFieldRow = {
  define_field_name?: string;
  define_field_kor_name?: string;
};

export type RiverIllegalFieldLabels = {
  /** 카드 본문 항목 (일자 키는 호출측에서 고정 라벨 유지) */
  columns: Partial<Record<RiverIllegalOccupationFieldKey, string>>;
  /** 조치현황 행: 적발 / 조치 / 미조치 */
  statusRows: Partial<Record<RiverIllegalStatusRowKey, string>>;
  /** 조치현황 열: 평상등 · 그늘막 … */
  statusKinds: Partial<Record<RiverIllegalStatusKindKey, string>>;
  /** 합계 열 머리글 */
  statusTotalHeader: string;
};

const EMPTY: RiverIllegalFieldLabels = {
  columns: {},
  statusRows: {},
  statusKinds: {},
  statusTotalHeader: "합계",
};

const PREFIX_TO_ROW: Record<string, RiverIllegalStatusRowKey> = {
  DET: "detected",
  ACT: "acted",
  UNA: "notActed",
};

const SUFFIX_TO_KIND: Record<string, RiverIllegalStatusKindKey | "tot"> = {
  TOT: "tot",
  BED: "bench",
  SHD: "shade",
  BNG: "bungalow",
  BLD: "building",
  FRM: "farming",
  DCK: "deck",
  ALT: "landChange",
  STK: "storage",
  VNL: "vinylHouse",
  ETC: "etc",
};

function splitKorByUnderscore(kor: string): { left: string; right: string } | null {
  const s = String(kor ?? "").trim();
  const i = s.indexOf("_");
  if (i <= 0 || i >= s.length - 1) return null;
  return { left: s.slice(0, i).trim(), right: s.slice(i + 1).trim() };
}

function buildLabels(rows: DefineFieldRow[]): RiverIllegalFieldLabels {
  const byName = new Map<string, string>();
  for (const row of rows) {
    const name = String(row.define_field_name ?? "").trim();
    if (!name) continue;
    const kor = String(row.define_field_kor_name ?? "").trim();
    byName.set(name.toLowerCase(), kor || name);
  }

  const columns: Partial<Record<RiverIllegalOccupationFieldKey, string>> = {};
  for (const [key, meta] of Object.entries(RIVER_ILLEGAL_OCCUPATION_COLUMNS) as [
    RiverIllegalOccupationFieldKey,
    (typeof RIVER_ILLEGAL_OCCUPATION_COLUMNS)[RiverIllegalOccupationFieldKey],
  ][]) {
    const col = String(meta.column ?? "").trim();
    if (!col) continue;
    const hit = byName.get(col.toLowerCase());
    if (hit) columns[key] = hit;
  }

  const statusRows: Partial<Record<RiverIllegalStatusRowKey, string>> = {};
  const statusKinds: Partial<Record<RiverIllegalStatusKindKey, string>> = {};
  let statusTotalHeader = "합계";

  for (const [name, kor] of byName) {
    const m = /^(det|act|una)_(tot|bed|shd|bng|bld|frm|dck|alt|stk|vnl|etc)$/i.exec(name);
    if (!m) continue;
    const rowKey = PREFIX_TO_ROW[m[1]!.toUpperCase()];
    const kindOrTot = SUFFIX_TO_KIND[m[2]!.toUpperCase()];
    if (!rowKey || !kindOrTot) continue;

    const parts = splitKorByUnderscore(kor);
    if (parts?.left && !statusRows[rowKey]) statusRows[rowKey] = parts.left;

    if (kindOrTot === "tot") {
      if (parts?.right) statusTotalHeader = parts.right;
    } else if (parts?.right && !statusKinds[kindOrTot]) {
      statusKinds[kindOrTot] = parts.right;
    }
  }

  // 행·열 라벨이 비면 config 기본값으로 채움 (fallback은 화면에서 COLS 사용)
  for (const row of RIVER_ILLEGAL_STATUS_ROWS) {
    if (!statusRows[row.key]) statusRows[row.key] = row.label;
  }
  for (const kind of RIVER_ILLEGAL_STATUS_KINDS) {
    if (!statusKinds[kind.key]) statusKinds[kind.key] = kind.label;
  }

  return { columns, statusRows, statusKinds, statusTotalHeader };
}

/**
 * illegal_usage_as defineLayer 한글명.
 * 조치현황은 «적발_평상등»처럼 `_` 앞=행, 뒤=열.
 */
export function useRiverIllegalOccupationFieldLabels(): RiverIllegalFieldLabels {
  const [labels, setLabels] = useState<RiverIllegalFieldLabels>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const table = RIVER_ILLEGAL_OCCUPATION_TABLE;
    void (async () => {
      try {
        const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(table)}`);
        const json = (await res.json()) as { data?: DefineFieldRow[] } | DefineFieldRow[];
        const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        if (!cancelled) setLabels(buildLabels(rows));
      } catch {
        if (!cancelled) setLabels(EMPTY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return labels;
}

/** 일자·완료여부 등 화면 고정 라벨 키 — define 매핑 안 함 */
export const RIVER_ILLEGAL_FIXED_LABEL_KEYS = new Set<RiverIllegalOccupationFieldKey>([
  "firstCheckYmd",
  "completeYmd",
  "completeYn",
]);

export function riverIllegalColumnLabel(
  labels: RiverIllegalFieldLabels,
  key: RiverIllegalOccupationFieldKey
): string {
  if (RIVER_ILLEGAL_FIXED_LABEL_KEYS.has(key)) {
    return RIVER_ILLEGAL_OCCUPATION_COLUMNS[key].label;
  }
  return labels.columns[key] || RIVER_ILLEGAL_OCCUPATION_COLUMNS[key].label;
}
