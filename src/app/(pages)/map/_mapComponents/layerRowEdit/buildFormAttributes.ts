import { call } from "@/lib/api";
import type { LayerRowDetailAttr, LayerRowEditPreset } from "./types";

const GEOM_FIELDS = new Set(["geom", "geometry", "the_geom", "shape"]);

function isTrueFlag(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

/** defineLayer fields JSON → 등록/수정 폼용 속성 목록 */
export function buildFormAttributesFromDefineFields(
  fields: Record<string, unknown>[],
  preset: LayerRowEditPreset
): LayerRowDetailAttr[] {
  const exclude = new Set(
    [...(preset.excludeFields ?? []), ...GEOM_FIELDS].map((f) => f.toLowerCase()).filter(Boolean)
  );
  const keyLower = String(preset.keyField ?? "id").toLowerCase();
  const includeHidden = preset.includeHiddenDetail === true;

  return fields
    .map((raw) => {
      const field = String(raw.define_field_name ?? "").trim();
      if (!field) return null;
      const lower = field.toLowerCase();
      if (exclude.has(lower)) return null;
      const showDetail = isTrueFlag(raw.define_field_show_detail);
      if (!showDetail && !includeHidden) return null;
      if (lower === keyLower) return null;
      return {
        field,
        label: String(raw.define_field_kor_name ?? field).trim() || field,
        value: "",
        showDetail,
        idx: parseInt(String(raw.define_field_idx ?? "999999"), 10) || 999999,
      };
    })
    .filter((x): x is LayerRowDetailAttr & { idx: number; showDetail: boolean } => x != null)
    .sort((a, b) => {
      if (a.showDetail !== b.showDetail) return a.showDetail ? -1 : 1;
      return a.idx !== b.idx ? a.idx - b.idx : a.field.localeCompare(b.field);
    })
    .map(({ field, label, value, showDetail }) => ({ field, label, value, showDetail }));
}

export async function fetchFormAttributesForPreset(
  preset: LayerRowEditPreset
): Promise<LayerRowDetailAttr[]> {
  try {
    const res = await call("", "POST", {
      service: "layerRowService",
      action: "getEditableFieldDefinitionsForTable",
      params: {
        table: preset.tableName,
        schema: preset.schema,
        excludeFields: preset.excludeFields,
        includeHiddenDetail: preset.includeHiddenDetail,
      },
    });
    const data = res?.data ?? res;
    const fields = Array.isArray(data?.fields) ? data.fields : [];
    if (fields.length > 0) {
      return fields.map(
        (d: { field?: string; label?: string; showDetail?: boolean }) => ({
          field: String(d.field ?? "").trim(),
          label: String(d.label ?? d.field ?? "").trim() || String(d.field ?? ""),
          value: "",
          showDetail: d.showDetail !== false,
        })
      );
    }
  } catch {
    // fallback below
  }

  const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(preset.tableName)}`);
  const body = (await res.json()) as { data?: Record<string, unknown>[] };
  const defineFields = Array.isArray(body?.data) ? body.data : [];
  return buildFormAttributesFromDefineFields(defineFields, preset);
}

export async function fetchReadOnlyFieldSet(
  preset: LayerRowEditPreset
): Promise<Set<string>> {
  const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(preset.tableName)}`);
  const body = (await res.json()) as { data?: Record<string, string>[] };
  const defs = Array.isArray(body?.data) ? body.data : [];
  const locked = new Set<string>([String(preset.keyField ?? "id").toLowerCase()]);
  for (const d of defs) {
    const name = String(d.define_field_name ?? "").trim().toLowerCase();
    if (!name) continue;
    if (String(d.define_field_read_only ?? "").toLowerCase() === "true") locked.add(name);
  }
  for (const ex of preset.excludeFields ?? []) locked.add(ex.toLowerCase());
  return locked;
}
