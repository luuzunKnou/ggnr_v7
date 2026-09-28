import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { clearPreparedSourceZip } from '@/service/sourceUploadPreparedZip';

export const dynamic = 'force-dynamic';

/**
 * 로컬 준비 ZIP·progress 정리만 수행.
 * GNMS cancel 은 브라우저가 직접 호출합니다.
 */
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
    if (progressId) {
      await clearPreparedSourceZip(progressId);
    }

    return NextResponse.json({
      ok: true,
      localCleared: Boolean(progressId),
      note: 'GNMS cancel은 브라우저에서 직접 통지합니다',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'cancel failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
