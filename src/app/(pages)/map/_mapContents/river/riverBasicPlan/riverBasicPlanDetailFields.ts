/**
 * 하천기본계획 상세 속성 표시 필드 (기존 defineLayer fields 상세표시 기준 하드코딩).
 * river_plan_as / river_plan_s_as 동일.
 */
export type RiverBasicPlanDetailField = {
  name: string;
  label: string;
};

const PLAN_AS_DETAIL_FIELDS: RiverBasicPlanDetailField[] = [
  { name: "plan_year", label: "기본계획 수립년도" },
  { name: "plan_name", label: "기본계획명" },
  { name: "plan_len", label: "하천기본계획연장" },
  { name: "river_name", label: "하천명" },
  { name: "rivp_name", label: "하천기본계획명" },
  { name: "river_len", label: "하천연장" },
  { name: "river_sta", label: "시점" },
  { name: "river_end", label: "종점" },
];

export function getRiverBasicPlanDetailFields(
  _tab: "river" | "smallRiver"
): RiverBasicPlanDetailField[] {
  return PLAN_AS_DETAIL_FIELDS;
}
