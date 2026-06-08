import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { getFileManagerDownloadTarget } from '@/service/fileManagerService';

export const dynamic = 'force-dynamic';

function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'download';
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(req: NextRequest) {
  const relativePath = req.nextUrl.searchParams.get('path')?.trim() ?? '';
  if (!relativePath) {
    return NextResponse.json({ error: 'path 파라미터가 필요합니다.' }, { status: 400 });
  }
  try {
    const target = await getFileManagerDownloadTarget({ relativePath });
    if (target.isDirectory) {
      return NextResponse.json({ error: '폴더는 ZIP 다운로드를 사용하세요.' }, { status: 400 });
    }
    const stream = createReadStream(target.absolutePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': contentDispositionAttachment(target.fileName),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '다운로드 실패' },
      { status: 400 }
    );
  }
}
