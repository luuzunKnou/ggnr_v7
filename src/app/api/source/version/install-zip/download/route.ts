import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  openInstallZipDownloadStream,
  resolveInstallZipForDownload,
} from '@/service/sourceInstallZipService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const progressId = req.nextUrl.searchParams.get('progressId')?.trim() ?? '';
    const zipNameParam = req.nextUrl.searchParams.get('zipName')?.trim() ?? '';

    const zipPath = await resolveInstallZipForDownload({
      progressId: progressId || undefined,
      zipName: zipNameParam || undefined,
    });
    if (!zipPath) {
      return NextResponse.json(
        { error: 'ZIP 파일을 찾을 수 없습니다. build를 먼저 실행하세요.' },
        { status: 404 }
      );
    }

    const { fileName, size, webStream } = await openInstallZipDownloadStream(zipPath);
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'download failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
