/**
 * SHP 동기화 이력용 스냅샷 복사.
 * GGNR_DATA_DIR/shp_history/{dhKey}/ 아래에 원본과 동일 basename 사이드카를 복사하고
 * 상대 경로(…/*.shp)를 반환한다. 환경변수 추가 없음.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

function normalizeRel(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

/** 같은 basename의 Shapefile 사이드카(.shp/.shx/.dbf/.prj/.cpg 등) 복사 */
export async function archiveShpForLayerHistory(params: {
  dhKey: number;
  sourceRelativePath: string;
}): Promise<string | null> {
  const dhKey = Math.floor(Number(params.dhKey));
  const sourceRel = normalizeRel(params.sourceRelativePath ?? '');
  if (!Number.isFinite(dhKey) || dhKey <= 0 || !sourceRel) return null;

  // 이미 이력 스냅샷이면 재복사하지 않음
  const histPrefix = `${GGNR_DATA_PATHS.shpHistory}/`;
  if (sourceRel.startsWith(histPrefix)) return sourceRel;

  const baseResolved = path.resolve(GGNR_DATA_DIR);
  const absSource = path.resolve(baseResolved, ...sourceRel.split('/').filter(Boolean));
  if (absSource !== baseResolved && !absSource.startsWith(baseResolved + path.sep)) {
    return null;
  }

  try {
    await fs.stat(absSource);
  } catch {
    return null;
  }

  const srcDir = path.dirname(absSource);
  const basename = path.basename(sourceRel, path.extname(sourceRel));
  const baseLower = basename.toLowerCase();
  const destDir = path.join(baseResolved, GGNR_DATA_PATHS.shpHistory, String(dhKey));
  await fs.mkdir(destDir, { recursive: true });

  let copiedShp = false;
  try {
    const entries = await fs.readdir(srcDir);
    for (const name of entries) {
      const nameLower = name.toLowerCase();
      if (nameLower !== `${baseLower}.shp` && !nameLower.startsWith(`${baseLower}.`)) continue;
      await fs.copyFile(path.join(srcDir, name), path.join(destDir, name));
      if (nameLower.endsWith('.shp')) copiedShp = true;
    }
  } catch {
    return null;
  }

  if (!copiedShp) return null;
  return `${GGNR_DATA_PATHS.shpHistory}/${dhKey}/${basename}.shp`.replace(/\\/g, '/');
}

/** 위저드 취소 등으로 상세 이력이 삭제될 때 스냅샷 폴더 제거 (업로드 shp_data는 유지) */
export async function removeShpHistoryArchive(dhKey: number): Promise<void> {
  const key = Math.floor(Number(dhKey));
  if (!Number.isFinite(key) || key <= 0) return;
  const dir = path.join(path.resolve(GGNR_DATA_DIR), GGNR_DATA_PATHS.shpHistory, String(key));
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
