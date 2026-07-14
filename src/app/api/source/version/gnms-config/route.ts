import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getGnmsClientConfig, isRestartCommandConfigured } from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cfg = getGnmsClientConfig();
    const restartCommandConfigured = isRestartCommandConfigured();
    return NextResponse.json({
      ok: true,
      gnmsBaseUrl: cfg.gnmsBaseUrl,
      latestUrl: cfg.latestUrl,
      downloadUrlFallback: cfg.downloadUrlFallback,
      bearer: cfg.bearer,
      restartCommandConfigured,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'gnms config failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
