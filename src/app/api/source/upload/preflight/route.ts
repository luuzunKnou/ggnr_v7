import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getRemoteUploadBase } from '@/service/sourceUploadRemote';

export const dynamic = 'force-dynamic';

/**
 * 사전 점검 — 서버는 GNMS에 접속하지 않음.
 * 실제 연결 확인은 브라우저가 원격 전송 시 수행.
 */
export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const remoteBase = getRemoteUploadBase();
    return NextResponse.json({
      ok: true,
      remoteBase,
      targetHost: '',
      targetOrigin: '',
      targetLabel: `URL=${remoteBase}`,
      deferredBrowserCheck: true,
      checks: [
        {
          id: 'target',
          ok: true,
          message: `브라우저가 ${remoteBase} 로 직접 전송합니다 (서버 outbound 없음)`,
        },
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'preflight failed';
    return NextResponse.json({ ok: false, error: message, checks: [] }, { status: 500 });
  }
}
