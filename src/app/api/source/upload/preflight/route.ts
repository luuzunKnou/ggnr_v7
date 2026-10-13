import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { checkRemoteTargetReady } from '@/service/sourceUploadRemote';

export const dynamic = 'force-dynamic';

/** 소스코드 업로드 사전 점검 — 이 서버가 GNMS에 접속해 확인 */
export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const pre = await checkRemoteTargetReady();
    return NextResponse.json({
      ok: pre.ok,
      remoteBase: pre.remoteBase,
      targetHost: pre.targetHost,
      targetIp: pre.targetIp,
      targetOrigin: pre.targetOrigin,
      targetLabel: pre.targetLabel,
      error: pre.ok ? undefined : pre.errorSummary,
      errorSummary: pre.errorSummary,
      checks: pre.checks,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'preflight failed';
    return NextResponse.json({ ok: false, error: message, checks: [] }, { status: 500 });
  }
}
