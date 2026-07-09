import fsSync from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { resolveLatestZipAbsolutePath } from '@/service/sourceVersionRegistryService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const resolved = await resolveLatestZipAbsolutePath();
    if (!resolved) {
      return NextResponse.json({ error: '최신 소스 ZIP 없음' }, { status: 404 });
    }
    const { absPath, meta } = resolved;
    const nodeStream = fsSync.createReadStream(absPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(meta.fileName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'download failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
