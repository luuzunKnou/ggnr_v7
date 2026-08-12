import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { notifyGnmsCancelFromServer } from '@/service/gnmsSourceFetchService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const jobId = String(body.jobId ?? '').trim();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId가 필요합니다' }, { status: 400 });
    }
    const result = await notifyGnmsCancelFromServer({
      jobId,
      version: typeof body.version === 'string' ? body.version : undefined,
      fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
      reason: typeof body.reason === 'string' ? body.reason : 'user_abort',
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'GNMS 취소 실패' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GNMS 취소 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
