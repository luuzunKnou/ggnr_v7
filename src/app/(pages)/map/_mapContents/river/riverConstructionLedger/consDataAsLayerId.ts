/** 공사대장 WMS 레이어 */
export const CONS_DATA_AS_WMS_LAYER_ID = "cons_data_as";
export const CONS_DATA_AS_SOLO_WMS_LAYER_ID = "cons_data_solo_as";

export const CONS_DATA_AS_CHILD_WMS_LAYER_IDS = [
  CONS_DATA_AS_SOLO_WMS_LAYER_ID,
] as const;

export const CONS_DATA_AS_WMS_LAYER_IDS = [
  CONS_DATA_AS_WMS_LAYER_ID,
  ...CONS_DATA_AS_CHILD_WMS_LAYER_IDS,
] as const;

export const CONS_DATA_AS_PANEL_WMS_LAYER_IDS = [
  ...CONS_DATA_AS_WMS_LAYER_IDS,
] as const;
