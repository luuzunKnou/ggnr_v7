import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import { assertSafeFileDataSegment } from '@/lib/serviceFileData';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';
import { listServiceFileDataFiles } from '@/service/fileManagerService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serEng = parseSerEngForServiceFileData(req.nextUrl.searchParams.get('serEng'));
  if (serEng == null) {
    return NextResponse.json({ error: '유효하지 않은 serEng 입니다.' }, { status: 400 });
  }
  if (!(await userHasSerAccess(usrId, serEng, 'read'))) {
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

  const files = await listServiceFileDataFiles({ layerName: layer, keyValue: key });
  return NextResponse.json({ files }, { headers: { 'Cache-Control': 'no-store' } });
}
