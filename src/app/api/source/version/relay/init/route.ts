import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { pickClientIpFromRequest } from '@/lib/requestClientMeta';
import { initVersionRelay } from '@/service/sourceVersionRelayService';
import { normalizeRestartMode } from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const fileName = String(body.fileName ?? '').trim();
    const totalSize = Number(body.totalSize);
    const version = String(body.version ?? '').trim() || new Date().toISOString();
    const restart = body.restart === true;
    const restartMode = normalizeRestartMode(body.restartMode);
    const includeNodeModules =
      typeof body.includeNodeModules === 'boolean' ? body.includeNodeModules : null;
    if (includeNodeModules == null) {
      return NextResponse.json(
        { error: 'includeNodeModules 필요 (개방망=false / 폐쇄망=true)' },
        { status: 400 }
      );
    }
    const bodyIp = typeof body.clientIp === 'string' ? body.clientIp.trim() : '';
    const clientIp = pickClientIpFromRequest(req, bodyIp);

    const result = await initVersionRelay({
      fileName,
      totalSize,
      version,
      requestedBy: String(usrId),
      clientIp,
      restart,
      restartMode,
      includeNodeModules,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'relay init failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
