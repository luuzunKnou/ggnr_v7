import type { LayerRowEditPreset } from "./types";
import { USAGE_DATA_AS_FIELD_LABELS } from "../../_mapContents/river/usageDataAs/usageDataAsFieldLabels";
import { OCCUPATION_LEDGER_FIELD_LABELS } from "../../_mapContents/occupationLedger/occupationLedgerFieldLabels";
import {
  getOccupationLedgerBinding,
  type OccupationLedgerSerEng,
} from "@/lib/occupationLedgerBinding";

/**
 * 공통 점용대장(하천·도로·국공유지) — 테이블·칸 이름은 연결 설정(occupationLedgerBinding) 한 곳에서.
 * 점용 시작·종료·허가일자는 «영구»·«허가일로부터 ○개월» 등 글자도 들어와 날짜 선택을 쓰지 않는다.
 * 필드 정의가 아직 옛 칸 이름이어도 공통 칸은 저장되게 실제 DB 칸 저장을 허용한다.
 */
function occupationLedgerPreset(
  serEng: OccupationLedgerSerEng
): LayerRowEditPreset & { keyField: string; childTableName: string } {
  const b = getOccupationLedgerBinding({ serEng })!;
  const f = b.fields;
  return {
    tableName: b.mainTable,
    schema: b.schema,
    keyField: f.keyField,
    excludeFields: ["ogc_fid", "id", "extra", "geom"],
    includeHiddenDetail: true,
    dateFields: [],
    childTableName: b.jijukTable,
    additionalChildTableNames: [b.mgjTable],
    childParentField: f.childParentField,
    childAddressField: f.childAddressField,
    childAddressPartFields: f.childAddressPartFields,
    fieldLabels: OCCUPATION_LEDGER_FIELD_LABELS,
    allowEmptyGeom: true,
    allowPhysicalColumns: true,
    permitField: f.permitField,
  };
}

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
  usageDataAs: {
    tableName: "usage_data_as",
    schema: "layer",
    keyField: "cons_code",
    /** cons_code는 defineLayer 읽기전용 — insert 시 서버 자동 채번 */
    autoGenerateKeyOnCreate: true,
    excludeFields: [
      "ogc_fid",
      "gkey_code",
      "river_code",
      "mng_cde",
      "user_name",
      /** 상세 미표시 */
      "emd_code",
      "ri_code",
      "bobn",
      "bubn",
      "ledg_gbn",
      "temp_area",
    ],
    /** show_detail=false 속성은 더보기로 표시 */
    includeHiddenDetail: true,
    dateFields: [],
    childTableName: "usage_data_as_solo",
    additionalChildTableNames: ["usage_data_as_mgj"],
    childParentField: "cons_code",
    childAddressField: "usage_loc",
    fieldLabels: USAGE_DATA_AS_FIELD_LABELS,
    requirePeriodAndGeomOnSave: true,
    allowEmptyGeom: true,
  },
  waterOccupationLedger: occupationLedgerPreset("waterOccupationLedger"),
  roadOccupationLedger: occupationLedgerPreset("roadOccupationLedger"),
  publicOccupationLedger: occupationLedgerPreset("publicOccupationLedger"),
} as const satisfies Record<string, LayerRowEditPreset>;

export type LayerRowEditPresetKey = keyof typeof LAYER_ROW_EDIT_PRESETS;
