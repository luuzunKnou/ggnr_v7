import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { checkRemoteTargetReady } from '@/service/sourceUploadRemote';

export const dynamic = 'force-dynamic';

/** 원격(GNMS) 업로드 대상 서버 연결·API 사전 점검 */
export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await checkRemoteTargetReady();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'preflight failed';
    return NextResponse.json({ ok: false, error: message, checks: [] }, { status: 500 });
  }
}
