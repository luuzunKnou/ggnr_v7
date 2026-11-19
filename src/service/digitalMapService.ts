/**
 * 수치지형도 — GGNR_DATA_DIR/digital_map/수치지형도(축척).pmtiles
 * PMTiles 파일 목록이 곧 서비스 목록이다. (파일 읽기: @/lib/digitalMapPmtiles)
 */
import { getSessionUsrId } from '@/lib/auth/guard';
import { hasDigitalMapPmtiles, listDigitalMapPmtiles, type DigitalMapPmtilesInfo } from '@/lib/digitalMapPmtiles';

export type DigitalMapFolderInfo = DigitalMapPmtilesInfo;

/** 서비스할 PMTiles 가 하나라도 있는지 — 사이드 «수치지형도» 버튼 노출 여부 */
export async function available(): Promise<{ available: boolean }> {
  await getSessionUsrId();
  return { available: await hasDigitalMapPmtiles() };
}

/** 서비스 중인 PMTiles 목록 (이름·줌 범위·위치) */
export async function listFolders(): Promise<{ folders: DigitalMapFolderInfo[] }> {
  await getSessionUsrId();
  return { folders: await listDigitalMapPmtiles() };
}

export type DigitalMapExportFile = {
  /** ZIP 내 상대 경로 (수치지형도/폴더/파일.dxf) */
  entryName: string;
  absPath: string;
};

function boxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/** 내보내기용 — 세션 없이 digital_map 하위 폴더명만 */
async function listDigitalMapFolderNames(): Promise<string[]> {
  const root = rootDir();
  if (!existsSync(root)) return [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * EPSG:5181 bbox와 겹치는 수치지형도 DXF 목록.
 * - folderNames 지정: 해당 폴더만
 * - 미지정: 축척 폴더는 숫자 최소 폴더 우선, 없으면 전체 폴더
 */
export async function collectDigitalMapFilesIntersectingBbox5181(
  bbox5181: [number, number, number, number],
  opts?: { folderNames?: string[] | null }
): Promise<DigitalMapExportFile[]> {
  const [minX, minY, maxX, maxY] = bbox5181;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || !(maxX > minX) || !(maxY > minY)) {
    return [];
  }
  const query = { minX, minY, maxX, maxY };
  const folderNames = await listDigitalMapFolderNames();
  if (!folderNames.length) return [];

  const wanted = (opts?.folderNames ?? [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  let targets: string[];
  if (wanted.length > 0) {
    const want = new Set(wanted);
    targets = folderNames.filter((name) => want.has(name));
  } else {
    const { pickSmallestNumberFolder } = await import('@/service/digitalMapElevation');
    const preferred = pickSmallestNumberFolder(folderNames);
    targets = preferred ? [preferred] : folderNames;
  }
  if (!targets.length) return [];

  const { default: proj4 } = await import('proj4');
  proj4.defs(
    'EPSG:5181',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5186',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5187',
    '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5179',
    '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs'
  );

  const out: DigitalMapExportFile[] = [];
  for (const folderName of targets) {
    let index: DigitalMapFolderIndex;
    try {
      index = await ensureIndex(folderName, false);
    } catch {
      continue;
    }
    const crsCode = String(index.crs ?? CRS_FALLBACK).replace(/^EPSG:/i, '');
    const fromEpsg = `EPSG:${crsCode}`;
    if (!proj4.defs(fromEpsg)) {
      proj4.defs(
        fromEpsg,
        '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
      );
    }
    for (const sheet of index.sheets) {
      let sheet5181 = {
        minX: sheet.minX,
        minY: sheet.minY,
        maxX: sheet.maxX,
        maxY: sheet.maxY,
      };
      if (fromEpsg !== 'EPSG:5181') {
        try {
          const corners: Array<[number, number]> = [
            [sheet.minX, sheet.minY],
            [sheet.minX, sheet.maxY],
            [sheet.maxX, sheet.minY],
            [sheet.maxX, sheet.maxY],
          ];
          let sMinX = Infinity;
          let sMinY = Infinity;
          let sMaxX = -Infinity;
          let sMaxY = -Infinity;
          for (const c of corners) {
            const p = proj4(fromEpsg, 'EPSG:5181', c) as [number, number];
            sMinX = Math.min(sMinX, p[0]);
            sMinY = Math.min(sMinY, p[1]);
            sMaxX = Math.max(sMaxX, p[0]);
            sMaxY = Math.max(sMaxY, p[1]);
          }
          sheet5181 = { minX: sMinX, minY: sMinY, maxX: sMaxX, maxY: sMaxY };
        } catch {
          // 변환 실패 시 원본 좌표로 비교
        }
      }
      if (!boxesOverlap(query, sheet5181)) continue;
      const abs = fileAbs(folderName, sheet.file);
      if (!existsSync(abs)) continue;
      out.push({
        entryName: `수치지형도/${folderName}/${sheet.file}`,
        absPath: abs,
      });
    }
  }
  return out;
}

/** 수치지형도 DXF 등고 점 고도 — 폴더명 숫자 최소 폴더 */
export {
  getDigitalMapElevationAtPoint,
  hasDigitalMapFolders,
  pickSmallestNumberFolder,
} from '@/service/digitalMapElevation';
