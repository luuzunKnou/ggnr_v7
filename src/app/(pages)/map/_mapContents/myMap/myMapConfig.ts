export const MY_MAP_OPENED_KEY = 'myMap';

export const MY_MAP_PANEL_DEFAULT_WIDTH = 420;
export const MY_MAP_PANEL_MIN_WIDTH = 360;
export const MY_MAP_PANEL_MAX_WIDTH = 720;

export const MY_MAP_DETAIL_DEFAULT_WIDTH = 400;
export const MY_MAP_DETAIL_MIN_WIDTH = 340;
export const MY_MAP_DETAIL_MAX_WIDTH = 640;

/** v6 지도 드롭과 동일 — Excel 1개 또는 shp+shx+dbf(±prj/cpg), zip 1개 */
export function matchMyMapDropFiles(files: FileList | File[]): File[] | null {
  const list = Array.from(files ?? []);
  if (list.length === 0) return null;
  const exts = list.map((f) => f.name.split('.').pop()?.toLowerCase() ?? '');
  const isExcel = list.length === 1 && (exts[0] === 'xls' || exts[0] === 'xlsx');
  const isZip = list.length === 1 && exts[0] === 'zip';
  const isShpBundle =
    exts.includes('shp') &&
    exts.includes('shx') &&
    exts.includes('dbf') &&
    exts.every((e) => ['shp', 'shx', 'dbf', 'prj', 'cpg'].includes(e));
  if (!isExcel && !isZip && !isShpBundle) return null;
  return list;
}
