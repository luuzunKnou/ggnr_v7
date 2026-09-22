import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  clearPreparedGnmsLogSession,
  takePreparedGnmsLogPart,
} from '@/service/gnmsLogReceiveService';

export const dynamic = 'force-dynamic';

/** 브라우저→GNMS 로그 업로드용 바이트 */
export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim() ?? '';
    const index = Number(req.nextUrl.searchParams.get('index') ?? '-1');
    if (!sessionId || !Number.isFinite(index) || index < 0) {
      return NextResponse.json({ error: 'sessionId/index required' }, { status: 400 });
    }
    const part = takePreparedGnmsLogPart(sessionId, index);
    if (!part) {
      return NextResponse.json({ error: '세션·파일이 없습니다' }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(part.data), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(part.fileName)}"`,
        'X-Gnms-Log-Date': part.date,
        'X-Gnms-Log-Project': encodeURIComponent(part.project),
        'X-Gnms-Log-Type': encodeURIComponent(part.type),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'gnms log file failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim() ?? '';
    if (sessionId) clearPreparedGnmsLogSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'clear failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
