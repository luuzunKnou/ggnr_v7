import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getUploadProgress } from '@/service/sourceUploadProgress';
import { cancelRemoteSourceUpload } from '@/service/sourceUploadRemote';

export const dynamic = 'force-dynamic';

/** 현재 코드 자동 업로드 취소 → GNMS POST …/api/source/upload/cancel */
export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      uploadId?: string;
      progressId?: string;
      reason?: string;
    };

    let uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    const progressId = typeof body.progressId === 'string' ? body.progressId.trim() : '';

    if (!uploadId && progressId) {
      const snap = getUploadProgress(progressId);
      uploadId = snap?.remoteUploadId?.trim() ?? '';
    }

    if (!uploadId) {
      return NextResponse.json(
        { ok: false, error: 'uploadId 없음 (init 전이면 취소 통보 생략)' },
        { status: 400 }
      );
    }

    const result = await cancelRemoteSourceUpload({
      uploadId,
      reason: typeof body.reason === 'string' ? body.reason : 'user_abort',
    });

    if (!result.ok) {
      const status = result.status >= 400 && result.status < 600 ? result.status : 502;
      return NextResponse.json(
        {
          ok: false,
          uploadId,
          status: result.gnmsStatus,
          error: result.error ?? 'GNMS cancel 실패',
        },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      uploadId,
      status: result.gnmsStatus ?? 'cancelled',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'cancel failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
