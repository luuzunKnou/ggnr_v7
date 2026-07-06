/** 폴더명 양식: YYYYMMDD_EPSG_그룹명_메모 */
export type ShpFolderMeta = {
  folderName: string;
  date?: string;
  epsg?: string;
  group?: string;
  workName?: string;
};

export function parseShpFolderName(folderName: string): ShpFolderMeta {
  const segs = folderName.split('_');
  const date = /^\d{8}$/.test(segs[0] ?? '') ? segs[0] : undefined;
  const epsg = /^\d{3,5}$/.test(segs[1] ?? '') ? segs[1] : undefined;
  const group = segs.length >= 3 ? segs[2] : undefined;
  const workName =
    segs.length >= 4 ? segs.slice(3).join('_') : segs.length >= 3 ? segs[2] : folderName;
  return { folderName, date, epsg, group, workName };
}

export function extractFolderPartsFromPath(shpPath: string): { group?: string; memo?: string } {
  const parts = shpPath.replace(/\\/g, '/').split('/');
  const shpDataIdx = parts.indexOf('shp_data');
  if (shpDataIdx >= 0 && shpDataIdx + 1 < parts.length) {
    const meta = parseShpFolderName(parts[shpDataIdx + 1]);
    return { group: meta.group, memo: meta.workName };
  }
  return {};
}
