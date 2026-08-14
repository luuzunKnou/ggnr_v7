/**
 * 공통 점용대장 — 부서업무 WMS는 울진 하천점용과 동일 스타일명 사용.
 * 데이터조회는 레이어 기본 스타일(테이블명 SLD)을 그대로 쓴다.
 */
export const OCCUPATION_DEPT_WMS_STYLE = {
  parent: "usage_data_as",
  jijuk: "usage_data_as_solo",
  mgj: "usage_data_as_mgj",
} as const;

/** 부서업무 패널이 열린 경우 점용 레이어 → 울진 점용 스타일명. 아니면 null(기본=테이블명) */
export function resolveOccupationDeptWmsStyleName(
  layerName: string,
  deptPanelOpen: boolean
): string | null {
  if (!deptPanelOpen) return null;
  const t = String(layerName ?? "")
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (/^(water|road|public)_occupationledger$/.test(t)) {
    return OCCUPATION_DEPT_WMS_STYLE.parent;
  }
  if (/^(water|road|public)_occupationledger_jijuk$/.test(t)) {
    return OCCUPATION_DEPT_WMS_STYLE.jijuk;
  }
  if (/^(water|road|public)_occupationledger_mgj$/.test(t)) {
    return OCCUPATION_DEPT_WMS_STYLE.mgj;
  }
  return null;
}
