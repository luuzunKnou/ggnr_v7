import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getUploadProgress, patchUploadProgress } from '@/service/sourceUploadProgress';
import { cancelRemoteSourceUpload } from '@/service/sourceUploadRemote';

export const dynamic = 'force-dynamic';

/** 소스코드 업로드 취소 — 서버 전송 루프를 멈추고 GNMS 세션을 취소 */
export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      progressId?: string;
      reason?: string;
      localOnly?: boolean;
    };

    const progressId = typeof body.progressId === 'string' ? body.progressId.trim() : '';
    let remoteCancelled = false;
    if (progressId) {
      const uploadId = getUploadProgress(progressId)?.remoteUploadId?.trim();
      patchUploadProgress(progressId, { cancelled: true });
      if (uploadId) {
        const cancelled = await cancelRemoteSourceUpload({
          uploadId,
          reason: body.reason?.trim() || 'user_abort',
        });
        remoteCancelled = cancelled.ok;
      }
    }

    return NextResponse.json({
      ok: true,
      localCleared: Boolean(progressId),
      remoteCancelled,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'cancel failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
