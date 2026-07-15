import { matchEpsgFromLooseText } from '@/lib/matchCoordinateSystemText';

/** 폴더명 양식: YYYYMMDD_EPSG_그룹명_메모 (EPSG 자리는 "5181" 같은 숫자 또는 "GRS중부60" 같은 좌표계 라벨도 인식) */
export type ShpFolderMeta = {
  folderName: string;
  date?: string;
  epsg?: string;
  group?: string;
  workName?: string;
};

function parseFolderEpsgSegment(seg: string | undefined): string | undefined {
  if (!seg) return undefined;
  if (/^\d{3,5}$/.test(seg)) return seg;
  const loose = matchEpsgFromLooseText(seg);
  return loose ? loose.replace(/^EPSG:/i, '') : undefined;
}

export function parseShpFolderName(folderName: string): ShpFolderMeta {
  const segs = folderName.split('_');
  const date = /^\d{8}$/.test(segs[0] ?? '') ? segs[0] : undefined;
  const epsg = parseFolderEpsgSegment(segs[1]);
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
