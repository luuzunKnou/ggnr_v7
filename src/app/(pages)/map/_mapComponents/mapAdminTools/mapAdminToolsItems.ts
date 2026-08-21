/** 지도 점검 도구 목록 — 항목을 추가하면 메뉴에 그대로 붙는다 */
export type MapAdminToolId = 'geoserverLog' | 'useFeeSync';

export type MapAdminToolItem = {
  id: MapAdminToolId;
  label: string;
};

export const MAP_ADMIN_TOOL_ITEMS: MapAdminToolItem[] = [
  { id: 'geoserverLog', label: '로그 보기' },
  { id: 'useFeeSync', label: '점사용료 연계 실행' },
];
