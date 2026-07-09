import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { initVersionRelay } from '@/service/sourceVersionRelayService';
import type { RestartMode } from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';

function toRestartMode(value: unknown): RestartMode {
  if (value === 'command') return 'command';
  if (value === 'exit') return 'exit';
  return 'none';
}

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const fileName = String(body.fileName ?? '').trim();
    const totalSize = Number(body.totalSize);
    const version = String(body.version ?? '').trim() || new Date().toISOString();
    const restart = body.restart === true;
    const restartMode = toRestartMode(body.restartMode);
    const includeNodeModules = body.includeNodeModules !== false;

    const result = await initVersionRelay({
      fileName,
      totalSize,
      version,
      requestedBy: String(usrId),
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
