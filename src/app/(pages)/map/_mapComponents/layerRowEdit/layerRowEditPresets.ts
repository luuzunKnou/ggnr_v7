import type { LayerRowEditPreset } from "./types";

/** 화면별 preset — 새 기능 추가 시 여기만 등록 */
export const LAYER_ROW_EDIT_PRESETS = {
  publicLand: {
    tableName: "public_land",
    schema: "layer",
    keyField: "id",
    excludeFields: ["parcel_address", "value_017", "value_018", "value_019"],
    dateFields: ["value_006", "value_007"],
    childTableName: "public_land_jijuk",
    childParentField: "parent_id",
  },
  roadUseLedger: {
    tableName: "road_use_ledger",
    schema: "layer",
    keyField: "id",
    excludeFields: ["parcel_address"],
    dateFields: ["use_permit_date", "use_start", "use_end"],
    childTableName: "road_use_ledger_jijuk",
    childParentField: "parent_id",
  },
  riverUseLedger: {
    tableName: "river_use_ledger",
    schema: "layer",
    keyField: "id",
    excludeFields: ["parcel_address", "ledger_row_key"],
    dateFields: [],
    childTableName: "river_use_ledger_jijuk",
    childParentField: "parent_id",
  },
} as const satisfies Record<string, LayerRowEditPreset>;

export type LayerRowEditPresetKey = keyof typeof LAYER_ROW_EDIT_PRESETS;
