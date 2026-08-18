/** PostGIS·define 테이블명: 영문/숫자/언더스코어만 */
export function safeTableName(basename: string): string {
  return (basename.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').toLowerCase()) || 'layer_table';
}

/**
 * SHP 상대경로 → 테이블명.
 * shp_data/작업폴더/파일.shp 는 파일명만 사용.
 * shp_data/작업폴더/하위폴더/파일.shp 는 하위폴더를 붙여 가로수·가로수test처럼 같은 파일명이 겹치지 않게 함.
 */
export function shpTableNameFromRelPath(pathOrResult: string): string {
  const parts = pathOrResult.replace(/\\/g, '/').split('/').filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  const basename = file.replace(/\.shp$/i, '');
  if (parts.length < 2) return safeTableName(basename);

  const parent = parts[parts.length - 2] ?? '';
  const shpIdx = parts.findIndex((p) => p.toLowerCase() === 'shp_data');
  if (shpIdx >= 0) {
    const depth = parts.length - shpIdx - 2;
    if (depth <= 1) return safeTableName(basename);
    return safeTableName(`${parent}_${basename}`);
  }
  return safeTableName(`${parent}_${basename}`);
}
