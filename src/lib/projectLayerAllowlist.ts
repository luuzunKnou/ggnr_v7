/** 울산 UAV 계열에서 목록에 둘 표. 다른 시스템용 빈 표는 빼기 위함 */
const UAV_SYSTEM_KEYS = new Set(['uav', 'uav_view', 'spatial_view']);

const UAV_LAYER_TABLES = new Set([
  'file_unit',
  'tif_unit',
  'work_unit',
  'memo',
  'comp',
  'compd',
  'gcp',
]);

/** 켜진 시스템이 울산 UAV(조회·관리)뿐이면 true. 공간조회만 켜진 경우는 제외 */
export function isUavLayerScope(sysKeys: Iterable<string>): boolean {
  const keys = [...sysKeys].map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (keys.length === 0) return false;
  const hasUav = keys.includes('uav') || keys.includes('uav_view');
  return hasUav && keys.every((k) => UAV_SYSTEM_KEYS.has(k));
}

export function allowProjectLayerTable(tableName: string, sysKeys: Iterable<string>): boolean {
  if (!isUavLayerScope(sysKeys)) return true;
  return UAV_LAYER_TABLES.has(tableName.trim().toLowerCase());
}
