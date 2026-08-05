import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { userCanAccessServiceFileData } from '@/lib/serviceFileDataAccess';
import { assertSafeFileDataSegment } from '@/lib/serviceFileData';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';
import {
  listServiceFileDataFiles,
  listServiceFileDataFolders,
} from '@/service/fileManagerService';

export const dynamic = 'force-dynamic';

/** 루트 파일 묶음 탭명 (공사대장 등과 동일) */
const ROOT_FOLDER_LABEL = '기타';

export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  const serEng = parseSerEngForServiceFileData(req.nextUrl.searchParams.get('serEng'));
  if (serEng == null) {
    return NextResponse.json({ error: '유효하지 않은 serEng 입니다.' }, { status: 400 });
  }
  if (!(await userCanAccessServiceFileData(usrId, serEng, 'read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const layer = req.nextUrl.searchParams.get('layer');
  const key = req.nextUrl.searchParams.get('key');
  if (layer == null || key == null) {
    return NextResponse.json({ error: 'layer, key 쿼리가 필요합니다.' }, { status: 400 });
  }

  if (assertSafeFileDataSegment(layer) == null || assertSafeFileDataSegment(key) == null) {
    return NextResponse.json({ error: '유효하지 않은 layer 또는 key 입니다.' }, { status: 400 });
  }

  const foldersOnly = req.nextUrl.searchParams.get('folders') === '1';
  if (foldersOnly) {
    const { folders, hasRootFiles } = await listServiceFileDataFolders({
      layerName: layer,
      keyValue: key,
    });
    const out = [...folders];
    if (hasRootFiles && !out.includes(ROOT_FOLDER_LABEL)) {
      out.push(ROOT_FOLDER_LABEL);
    }
    out.sort((a, b) => {
      if (a === ROOT_FOLDER_LABEL) return 1;
      if (b === ROOT_FOLDER_LABEL) return -1;
      return a.localeCompare(b, 'ko');
    });
    return NextResponse.json({ folders: out }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const subfolderRaw = req.nextUrl.searchParams.get('subfolder');
  const subfolderTrim = String(subfolderRaw ?? '').trim();
  let subfolder: string | undefined;
  if (subfolderTrim && subfolderTrim !== ROOT_FOLDER_LABEL) {
    if (assertSafeFileDataSegment(subfolderTrim) == null) {
      return NextResponse.json({ error: '유효하지 않은 subfolder 입니다.' }, { status: 400 });
    }
    subfolder = subfolderTrim;
  }

  const files = await listServiceFileDataFiles({
    layerName: layer,
    keyValue: key,
    subfolder,
  });
  return NextResponse.json({ files }, { headers: { 'Cache-Control': 'no-store' } });
}
