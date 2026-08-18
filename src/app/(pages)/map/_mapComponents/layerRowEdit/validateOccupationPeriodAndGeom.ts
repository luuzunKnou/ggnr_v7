import type { LayerRowDetailAttr, LayerRowEditPreset } from "./types";
import { splitUsagePeriod, USAGE_PD_FIELD } from "@/lib/usageDataAsFieldUtils";
import { LAYER_ROW_GEOM_CLEAR_SENTINEL } from "./LayerRowGeomEditHandler";

const GEOM_FIELDS = new Set(["geom", "geometry", "the_geom", "shape"]);

function draftFieldValue(draft: Record<string, string>, field: string): string {
  if (field in draft) return String(draft[field] ?? "").trim();
  const key = Object.keys(draft).find((k) => k.toLowerCase() === field.toLowerCase());
  return key ? String(draft[key] ?? "").trim() : "";
}

function attrFieldValue(row: LayerRowDetailAttr, draft: Record<string, string>): string {
  const fromDraft = draftFieldValue(draft, row.field);
  if (fromDraft) return fromDraft;
  return String(row.value ?? "").trim();
}

/**
 * 레이어설정(define_field_is_required) 필수 항목 검증.
 * 통과 시 null, 아니면 안내 문구.
 */
export function validateDefineRequiredFields(
  attributes: LayerRowDetailAttr[],
  draft: Record<string, string>
): string | null {
  const missing: string[] = [];
  for (const row of attributes) {
    if (!row.required) continue;
    const fl = String(row.field ?? "").trim().toLowerCase();
    if (!fl || GEOM_FIELDS.has(fl)) continue;
    if (!attrFieldValue(row, draft)) {
      missing.push(String(row.label || row.field).trim() || fl);
    }
  }
  if (missing.length === 0) return null;
  if (missing.length === 1) return `${missing[0]}을(를) 입력해 주세요.`;
  return `필수 항목을 입력해 주세요. (${missing.join(", ")})`;
}

/** @deprecated 울진 하천점용 등 — 기간·도형 하드코딩 검증. 공통점용은 define 필수만 사용 */
export function validateOccupationPeriodAndGeom(
  preset: LayerRowEditPreset,
  draft: Record<string, string>,
  geomWktRaw: string | null | undefined
): string | null {
  if (!preset.requirePeriodAndGeomOnSave) return null;

  const table = String(preset.tableName ?? "").toLowerCase();
  if (table === "usage_data_as") {
    const { start, end } = splitUsagePeriod(draftFieldValue(draft, USAGE_PD_FIELD));
    if (!start || !end) {
      return "점용기간(시작일·종료일)을 입력해 주세요.";
    }
  } else {
    const start = draftFieldValue(draft, "perm_start_date");
    const end = draftFieldValue(draft, "perm_end_date");
    if (!start || !end) {
      return "점용기간(시작일·종료일)을 입력해 주세요.";
    }
  }

  const wkt = String(geomWktRaw ?? "").trim();
  if (!wkt || wkt === LAYER_ROW_GEOM_CLEAR_SENTINEL) {
    return "도형을 입력해 주세요.";
  }

  return null;
}
