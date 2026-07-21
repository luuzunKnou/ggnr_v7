import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getApplyRestartReadyState } from '@/service/flushPendingVersionHistory';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const state = getApplyRestartReadyState();
    return NextResponse.json({
      ready: state.ready,
      historyPending: state.historyPending,
      historyFlushed: state.historyFlushed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'apply-ready failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
