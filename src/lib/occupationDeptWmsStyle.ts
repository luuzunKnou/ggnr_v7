/**
 * 공통 점용대장 — 부서업무는 본표·필지 실레이어를 그대로 켠다.
 * (예전에는 울진 스타일명으로 바꿔 그렸으나, 실레이어와 겹쳐 보이지 않게 했다.)
 */
export const OCCUPATION_DEPT_WMS_STYLE = {
  parent: "usage_data_as",
  jijuk: "usage_data_as_solo",
  mgj: "usage_data_as_mgj",
} as const;

/** 부서업무는 테이블명 기본 스타일을 쓴다. */
export function resolveOccupationDeptWmsStyleName(
  _layerName: string,
  _deptPanelOpen: boolean
): string | null {
  return null;
}
