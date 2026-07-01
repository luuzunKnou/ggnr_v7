import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getSessionUsrId } from '@/lib/auth/guard';
import { userCanAccessServiceFileData } from '@/lib/serviceFileDataAccess';
import { assertSafeFileDataSegment } from '@/lib/serviceFileData';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';
import { createServiceFileDataZipStream } from '@/service/serviceFileDataZipService';

export const dynamic = 'force-dynamic';

function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'attachments.zip';
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

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

  const labelRaw = req.nextUrl.searchParams.get('label');
  const displayLabel =
    labelRaw != null && labelRaw.trim() !== '' ? labelRaw.trim().slice(0, 200) : null;

  try {
    const { stream, downloadFileName } = await createServiceFileDataZipStream({
      layerName: layer,
      keyValue: key,
      displayLabel,
    });
    const web = Readable.toWeb(stream);
    return new NextResponse(web as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDispositionAttachment(downloadFileName),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'ZIP 생성 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
