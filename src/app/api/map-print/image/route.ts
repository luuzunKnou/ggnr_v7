import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { storeMapPrintPng, takeMapPrintPng } from '@/service/mapPrintImageService';

export const dynamic = 'force-dynamic';

function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'map-image.png';
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** 캡처 PNG 업로드 → 일회성 다운로드 id */
export async function POST(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('image/png') && !contentType.includes('application/octet-stream')) {
    return NextResponse.json({ error: 'Content-Type은 image/png 이어야 합니다.' }, { status: 400 });
  }

  const fileNameHeader = req.headers.get('x-file-name');
  let fileName = 'map-image.png';
  if (fileNameHeader) {
    try {
      fileName = decodeURIComponent(fileNameHeader);
    } catch {
      fileName = fileNameHeader;
    }
  }

  try {
    const ab = await req.arrayBuffer();
    const id = storeMapPrintPng(ab, fileName);
    return NextResponse.json({ id });
  } catch (e: unknown) {
    const status = typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '이미지 저장 실패' },
      { status }
    );
  }
}

/** 일회성 PNG 첨부 다운로드 */
export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  const taken = takeMapPrintPng(id);
  if (!taken) {
    return NextResponse.json({ error: '다운로드 링크가 만료되었거나 없습니다.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(taken.buf), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': contentDispositionAttachment(taken.fileName),
      'Cache-Control': 'no-store',
    },
  });
}
