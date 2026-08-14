import { splitUsagePeriod, USAGE_PD_FIELD } from "@/lib/usageDataAsFieldUtils";
import { LAYER_ROW_GEOM_CLEAR_SENTINEL } from "./LayerRowGeomEditHandler";
import type { LayerRowEditPreset } from "./types";

function draftFieldValue(draft: Record<string, string>, field: string): string {
  if (field in draft) return String(draft[field] ?? "").trim();
  const key = Object.keys(draft).find((k) => k.toLowerCase() === field.toLowerCase());
  return key ? String(draft[key] ?? "").trim() : "";
}

/** 점용기간·도형 필수 검증. 통과 시 null, 아니면 안내 문구 */
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
