import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createFileManagerZipStream } from '@/service/fileManagerService';

export const dynamic = 'force-dynamic';

function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'download.zip';
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { paths?: string[] };
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    const { stream, downloadFileName } = await createFileManagerZipStream({ relativePaths: paths });
    const web = Readable.toWeb(stream);
    return new NextResponse(web as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDispositionAttachment(downloadFileName),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'ZIP 생성 실패' },
      { status: 400 }
    );
  }
}
