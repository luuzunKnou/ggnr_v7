import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { pickClientIpFromRequest } from '@/lib/requestClientMeta';
import { applyLatestSourceFromGnms, type RestartMode } from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';

function toRestartMode(value: unknown): RestartMode {
  if (value === 'command') return 'command';
  if (value === 'startB' || value === 'nodeWatch') return 'startB';
  if (value === 'launcher') return 'launcher';
  if (value === 'exit') return 'exit';
  return 'none';
}

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const restart = body.restart === true;
    const restartMode = toRestartMode(body.restartMode);
    const bodyIp = typeof body.clientIp === 'string' ? body.clientIp.trim() : '';
    const clientIp = pickClientIpFromRequest(req, bodyIp);

    const result = await applyLatestSourceFromGnms({
      requestedBy: String(usrId),
      clientIp,
      restart,
      restartMode,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'latest source update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
