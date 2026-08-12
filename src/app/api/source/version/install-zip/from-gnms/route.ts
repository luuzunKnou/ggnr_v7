import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  notifyGnmsCancelFromServer,
  openGnmsInstallZipDownloadStream,
} from '@/service/gnmsSourceFetchService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const opened = await openGnmsInstallZipDownloadStream(req.signal);
    const onAbort = () => {
      opened.cleanup();
      if (opened.jobId) {
        void notifyGnmsCancelFromServer({
          jobId: opened.jobId,
          version: opened.version,
          fileName: opened.fileName,
        });
      }
    };
    if (req.signal.aborted) onAbort();
    else req.signal.addEventListener('abort', onAbort, { once: true });
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(opened.fileName)}"`,
      'Cache-Control': 'no-store',
      'X-Gnms-Version': encodeURIComponent(opened.version),
      'X-Gnms-FileName': encodeURIComponent(opened.fileName),
    };
    if (opened.jobId) headers['X-Gnms-JobId'] = opened.jobId;
    if (opened.size != null && opened.size > 0) {
      headers['Content-Length'] = String(opened.size);
    }
    return new NextResponse(opened.webStream, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GNMS 설치 ZIP 다운로드 실패';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
