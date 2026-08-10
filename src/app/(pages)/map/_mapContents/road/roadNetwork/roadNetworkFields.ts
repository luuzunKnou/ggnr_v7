import type {
  RoadNetworkOpenStatus,
  RoadNetworkType,
} from "./roadNetworkMock";

export type RoadNetworkFieldKey =
  | "roadName"
  | "roadType"
  | "openStatus"
  | "roadNo"
  | "dept"
  | "lengthAttr"
  | "defense"
  | "sinuosity"
  | "detailReason"
  | "address";

export type RoadNetworkFieldDef = {
  key: RoadNetworkFieldKey;
  label: string;
  input: "text" | "number" | "select-type" | "select-open";
  maxLength?: number;
  required?: boolean;
};

/** 개설/미개설이 서로 다른 공간자료 테이블로 나뉜 종류 */
export function roadTypeHasOpenStatus(type: RoadNetworkType): boolean {
  return type === "군도" || type === "농도";
}

/** DB에 관리기관(admin) 컬럼이 있는 종류 */
export function roadTypeHasDept(type: RoadNetworkType): boolean {
  return type === "군도" || type === "농도";
}

/** 길이·방위(·굴곡도) SHP 속성이 있는 종류 */
export function roadTypeHasGeomAttrs(type: RoadNetworkType): boolean {
  return (
    type === "입체교차로" ||
    type === "지방도" ||
    type === "국지도" ||
    type === "군도" ||
    type === "농도" ||
    type === "일반도로" ||
    type === "임도"
  );
}

/** 굴곡도 컬럼이 있는 종류 */
export function roadTypeHasSinuosity(type: RoadNetworkType): boolean {
  return (
    type === "입체교차로" ||
    type === "국지도" ||
    type === "군도" ||
    type === "농도" ||
    type === "임도"
  );
}

/** 도로종류별 속성정보 필드 (실제 공간자료 컬럼 기준) */
export function getRoadNetworkFieldsForType(
  type: RoadNetworkType
): RoadNetworkFieldDef[] {
  switch (type) {
    case "국도":
      return [
        { key: "roadName", label: "도로명", input: "text", maxLength: 27, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "roadNo", label: "도로번호", input: "number" },
      ];
    case "입체교차로":
      return [
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
        { key: "sinuosity", label: "굴곡도", input: "number" },
      ];
    case "국지도":
      return [
        { key: "roadName", label: "도로명주소", input: "text", maxLength: 80, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "roadNo", label: "도로번호", input: "number" },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
        { key: "sinuosity", label: "굴곡도", input: "number" },
        { key: "detailReason", label: "상세사유", input: "text", maxLength: 254 },
      ];
    case "지방도":
      return [
        { key: "roadName", label: "도로명주소", input: "text", maxLength: 10, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "roadNo", label: "도로번호", input: "number" },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
      ];
    case "군도":
      return [
        { key: "roadName", label: "명칭", input: "text", maxLength: 16, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "openStatus", label: "개설여부", input: "select-open" },
        { key: "roadNo", label: "도로번호", input: "number" },
        { key: "dept", label: "관리기관", input: "text", maxLength: 254 },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
        { key: "sinuosity", label: "굴곡도", input: "number" },
      ];
    case "농도":
      return [
        { key: "roadName", label: "명칭", input: "text", maxLength: 16, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "openStatus", label: "개설여부", input: "select-open" },
        { key: "roadNo", label: "도로번호", input: "number" },
        { key: "dept", label: "관리기관", input: "text", maxLength: 6 },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
        { key: "sinuosity", label: "굴곡도", input: "number" },
      ];
    case "일반도로":
      return [
        { key: "roadName", label: "도로명주소", input: "text", maxLength: 80, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "roadNo", label: "도로번호", input: "number" },
        { key: "address", label: "주소", input: "text", maxLength: 254 },
        { key: "detailReason", label: "상세사유", input: "text", maxLength: 254 },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
      ];
    case "임도":
      return [
        { key: "roadName", label: "도로명", input: "text", maxLength: 80, required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
        { key: "roadNo", label: "도로번호", input: "number" },
        { key: "address", label: "주소", input: "text", maxLength: 254 },
        { key: "detailReason", label: "상세설명", input: "text", maxLength: 254 },
        { key: "lengthAttr", label: "길이", input: "text" },
        { key: "defense", label: "방위", input: "text" },
        { key: "sinuosity", label: "굴곡도", input: "number" },
      ];
    default:
      return [
        { key: "roadName", label: "도로명", input: "text", required: true },
        { key: "roadType", label: "도로종류", input: "select-type" },
      ];
  }
}

export function defaultOpenStatusForType(
  type: RoadNetworkType,
  current?: RoadNetworkOpenStatus | ""
): RoadNetworkOpenStatus {
  if (!roadTypeHasOpenStatus(type)) return "개설";
  return current === "미개설" ? "미개설" : "개설";
}
